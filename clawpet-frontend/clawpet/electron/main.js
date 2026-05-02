/**
 * ClawPet Electron 主进程
 * 
 * 功能说明：
 * 1. 创建和管理桌宠窗口（透明、置顶、无框）
 * 2. 创建和管理设置窗口（完整控制面板）
 * 3. 创建启动进度窗口（可选）
 * 4. 处理前后端进程间通信（IPC）
 * 
 * 架构说明：
 * - 桌宠窗口：加载 Next.js 的 /desktop-pet 页面，透明背景，显示宠物动画
 * - 设置窗口：加载 Next.js 的主面板，用于配置和聊天
 * - 后端服务：通过环境变量 GOCLAW_BACKEND_URL 连接（默认 18790）
 * - 前端面板：通过环境变量 GOCLAW_DASHBOARD_URL 连接（默认 3000）
 */

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

// 全局窗口引用
let petWindow = null;              // 桌宠窗口
let bubbleWindow = null;           // 气泡窗口
let settingsWindow = null;         // 设置窗口
let onboardingWindow = null;       // 初始化窗口
let startupWindow = null;          // 启动进度窗口
let startupPollTimer = null;       // startup polling timer
let petRendererRetryTimer = null;  // pet renderer retry timer
let petRendererRetryCount = 0;     // pet renderer retry count
let startupCompleted = false;      // startup completed flag
let petHoverMonitorTimer = null;
let petHovering = false;
let petClickThroughEnabled = false;
let petTopClampApplying = false;
let petDragActive = false;
let petTopCorrectionTimer = null;
let onboardingLocked = false;
let lastBubbleFingerprint = '';
let lastBubbleAt = 0;

// 后端进程引用
let gatewayProcess = null;         // Gateway 进程
let launcherProcess = null;        // Launcher 进程

// 桌宠窗口尺寸（缩小：宽度150px，高度180px）
const PET_WIDTH = 150;
const PET_HEIGHT = 180;
const PET_WINDOW_MARGIN = 16;
const PET_RENDERER_RETRY_DELAY_MS = 1200;
const PET_RENDERER_MAX_RETRIES = 60;
const BUBBLE_WINDOW_DEFAULT_WIDTH = 320;
const BUBBLE_WINDOW_DEFAULT_HEIGHT = 140;
const BUBBLE_WINDOW_MIN_WIDTH = 140;
const BUBBLE_WINDOW_MAX_WIDTH = 420;
const BUBBLE_WINDOW_MIN_HEIGHT = 72;
const BUBBLE_WINDOW_MAX_HEIGHT = 220;
const BUBBLE_PET_OVERLAP = 14;
let bubbleWindowWidth = BUBBLE_WINDOW_DEFAULT_WIDTH;
let bubbleWindowHeight = BUBBLE_WINDOW_DEFAULT_HEIGHT;

/**
 * 设置 Electron 用户数据目录
 * 使用 .picoclaw 目录存储日志等数据
 */
const userDataPath = path.join(os.homedir(), '.picoclaw');
app.setPath('userData', userDataPath);
const onboardingStatePath = path.join(userDataPath, 'onboarding-state.json');

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

function isLoopbackProxyValue(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
  } catch {
    return /^(https?|socks5h?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(trimmed);
  }
}

function getLoopbackProxyTarget(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const defaultPorts = {
    'http:': 80,
    'https:': 443,
    'socks5:': 1080,
    'socks5h:': 1080,
  };

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname;
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
      return null;
    }

    const parsedPort = Number(parsed.port || defaultPorts[parsed.protocol] || 0);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      return null;
    }

    return {
      host: hostname === '::1' ? '127.0.0.1' : hostname,
      port: parsedPort,
      cacheKey: `${hostname}:${parsedPort}`,
    };
  } catch {
    return null;
  }
}

const loopbackProxyReachabilityCache = new Map();

function canConnectToLoopbackProxy(target, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });

    const finalize = (reachable) => {
      socket.removeAllListeners();
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
  });
}

async function shouldKeepLoopbackProxy(value) {
  const target = getLoopbackProxyTarget(value);
  if (!target) {
    return false;
  }

  const cached = loopbackProxyReachabilityCache.get(target.cacheKey);
  if (typeof cached === 'boolean') {
    return cached;
  }

  const reachable = await canConnectToLoopbackProxy(target);
  loopbackProxyReachabilityCache.set(target.cacheKey, reachable);
  return reachable;
}

async function buildChildProcessEnv(extraEnv = {}) {
  const childEnv = { ...process.env };
  const proxyKeys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ];

  for (const key of proxyKeys) {
    if (!isLoopbackProxyValue(childEnv[key])) {
      continue;
    }

    // Keep valid loopback proxies such as Clash/mitmproxy when they are
    // actually reachable. We only strip stale loopback proxy env vars when
    // the local proxy endpoint is no longer accepting connections, because
    // that breaks packaged child processes while preserving intentional proxy
    // setups and required egress controls.
    const keepProxy = await shouldKeepLoopbackProxy(childEnv[key]);
    if (!keepProxy) {
      delete childEnv[key];
    }
  }

  return {
    ...childEnv,
    ...extraEnv,
  };
}

/**
 * 日志系统配置
 * 所有日志输出到 ~/.picoclaw/logs.txt
 */
const logFilePath = path.join(userDataPath, 'logs.txt');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function loadOnboardingState() {
  try {
    if (!fs.existsSync(onboardingStatePath)) {
      return null;
    }
    const raw = fs.readFileSync(onboardingStatePath, 'utf-8');
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    logToFile(`[ONBOARDING] failed to read onboarding state: ${String(error)}`);
    return null;
  }
}

function saveOnboardingState(state) {
  try {
    fs.writeFileSync(onboardingStatePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    logToFile(`[ONBOARDING] failed to save onboarding state: ${String(error)}`);
  }
}

function markOnboardingCompleted() {
  saveOnboardingState({
    completed: true,
    completedAt: new Date().toISOString(),
  });
}

function markOnboardingPending(reason = 'unknown') {
  saveOnboardingState({
    completed: false,
    requestedAt: new Date().toISOString(),
    reason,
  });
}

function stopAllMediaPlayback(reason = 'unknown') {
  logToFile(`[ONBOARDING] force-stop-media (${reason})`);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('force-stop-media');
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('force-stop-media');
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('force-stop-media');
  }
}

function hideRuntimeWindowsForOnboarding() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.hide();
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.hide();
  }
}

function enterOnboardingMode(reason = 'manual', { rerun = false } = {}) {
  // 只有在首次运行或手动重新引导时才进入引导模式
  // 避免在正常启动时意外触发引导
  const currentState = loadOnboardingState();
  const shouldEnter = !currentState || currentState.completed !== true || reason === 'manual-rerun';
  
  if (!shouldEnter) {
    logToFile('[ONBOARDING] skipping enterOnboardingMode - already completed');
    return;
  }
  
  onboardingLocked = true;
  markOnboardingPending(reason);
  stopAllMediaPlayback(reason);
  hideRuntimeWindowsForOnboarding();
  createOnboardingWindow(buildSettingsWindowUrl({ onboarding: true, rerun }));
}

function leaveOnboardingMode({ completed } = { completed: false }) {
  if (completed) {
    onboardingLocked = false;
    markOnboardingCompleted();
  }

  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
    onboardingWindow = null;
  }

  if (petWindow && !petWindow.isDestroyed()) {
    resetPetWindow();
    petWindow.show();
  }

  if (completed) {
    createSettingsWindow(buildSettingsWindowUrl());
  }
}

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  logStream.write(logLine);
  console.log(logLine);
}

logToFile('Electron application started');

const persistedOnboarding = loadOnboardingState();
onboardingLocked = !(persistedOnboarding && persistedOnboarding.completed === true);
logToFile(`[ONBOARDING] startup locked=${onboardingLocked}`);

const backendBaseUrl = (process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18790').trim().replace(/\/+$/, '');
const launcherBaseUrl = (process.env.GOCLAW_LAUNCHER_URL || 'http://127.0.0.1:18800').trim().replace(/\/+$/, '');
const rendererBaseUrl = (process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');
const dashboardBaseUrl = (process.env.GOCLAW_DASHBOARD_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
const embeddedLauncherTokenDefault = 'goclaw-local-token';
let launcherToken = (process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '').trim();
const configuredRendererPath = (process.env.GOCLAW_PET_RENDERER_PATH || '/desktop-pet').trim();
const shouldOpenDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === '1';  // 是否打开开发者工具
const startupMode = process.env.GOCLAW_SHOW_STARTUP !== '0';  // 默认显示启动进度窗口（除非明确设置为0）
const openPanelOnReady = process.env.GOCLAW_OPEN_PANEL_ON_READY !== '0';  // 就绪后是否打开面板
let needsFirstTimeOnboarding = false;  // 是否需要首次引导
let startupPollCount = 0;

// Avoid multi-instance contention that causes flaky startup and renderer timeouts.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/**
 * 从 URL 中提取端口号
 * @param {string} rawUrl - 原始 URL
 * @param {string} fallbackPort - 默认端口
 * @returns {string} 端口号
 */
function getPortLabel(rawUrl, fallbackPort) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.port) {
      return parsed.port;
    }
    return parsed.protocol === 'https:' ? '443' : fallbackPort;
  } catch {
    return fallbackPort;
  }
}

const backendPortLabel = getPortLabel(backendBaseUrl, '18790');
const dashboardPortLabel = getPortLabel(dashboardBaseUrl, '3000');
const isProduction = app.isPackaged;
let effectiveDashboardBaseUrl = dashboardBaseUrl;
let nextServerProcess = null;

async function startNextServer() {
  if (!isProduction) {
    return;
  }

  // Packaged app content lives under resources/app.asar.unpacked when asar is enabled,
  // or under resources/app when asar is disabled.
  const appDir = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..');
  const buildDir = path.join(appDir, '.next');
  const nextCliPath = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');

  if (!fs.existsSync(buildDir)) {
    logToFile(`[NEXT] .next directory not found at ${buildDir}, skip starting Next.js`);
    return;
  }

  if (!fs.existsSync(nextCliPath)) {
    logToFile(`[NEXT] Next.js CLI not found at ${nextCliPath}, skip starting Next.js`);
    return;
  }

  if (nextServerProcess) {
    return;
  }

  logToFile(`[NEXT] Starting Next.js from ${appDir}`);

  const childEnv = await buildChildProcessEnv({
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: '3000',
    NEXT_PUBLIC_PICOCLAW_API_URL: 'http://127.0.0.1:18800',
    NEXT_PUBLIC_PICOCLAW_WS_URL: 'ws://127.0.0.1:18800',
    NEXT_PUBLIC_PICOCLAW_DIRECT_GATEWAY_URL: 'http://127.0.0.1:18790',
  });

  nextServerProcess = spawn(process.execPath, [nextCliPath, 'start', '-p', '3000'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: childEnv,
  });

  nextServerProcess.stdout.on('data', (data) => {
    logToFile(`[NEXT] ${data.toString().trim()}`);
  });

  nextServerProcess.stderr.on('data', (data) => {
    logToFile(`[NEXT][ERR] ${data.toString().trim()}`);
  });

  nextServerProcess.on('error', (error) => {
    logToFile(`[NEXT] start failed: ${String(error)}`);
  });

  nextServerProcess.on('exit', (code, signal) => {
    logToFile(`[NEXT] exited code=${code} signal=${signal || 'none'}`);
    nextServerProcess = null;
  });
}

/**
 * 启动进度状态管理
 * 跟踪各个服务的启动状态：后端、网关、前端面板、桌宠渲染
 */
const startupState = {
  done: false,           // 是否全部完成
  percent: 0,            // 进度百分比
  title: '正在启动 ClawPet',
  subtitle: '准备后端与桌面面板，请稍候…',
  steps: [
    { key: 'backend', label: `后端服务 (${backendPortLabel})`, status: 'running', detail: '正在检测服务…' },
    { key: 'gateway', label: '网关状态（内部）', status: 'pending', detail: '等待后端状态…' },
    { key: 'petclaw', label: `桌面面板 (${dashboardPortLabel})`, status: 'pending', detail: '等待前端服务启动…' },
    { key: 'renderer', label: '桌宠渲染（petclaw /desktop-pet）', status: 'pending', detail: '等待渲染页面就绪…' },
  ],
};

function shouldOpenOnboardingFromGatewayStatus(data) {
  if (!data || data.gateway_status === 'running') {
    return false;
  }
  if (data.gateway_start_allowed !== false) {
    return false;
  }
  const reason = String(data.gateway_start_reason || '').toLowerCase();
  if (!reason) {
    return false;
  }
  return (
    reason.includes('no default model configured') ||
    reason.includes('has no credentials configured') ||
    reason.includes('model') && reason.includes('credential')
  );
}

function isOnboardingUrl(targetUrl) {
  return /\/onboarding(?:[/?]|$)|[?&]onboarding=1\b|[?&]mode=rerun\b/i.test(targetUrl || '');
}

function getPetBounds() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: area.x + area.width - PET_WIDTH - 20,
    y: area.y + area.height - PET_HEIGHT - 60,
    width: PET_WIDTH,
    height: PET_HEIGHT,
  };
}

function setPetWindowClickThrough(enabled) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  try {
    petClickThroughEnabled = Boolean(enabled);
    if (enabled) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      petWindow.setIgnoreMouseEvents(false);
    }
    logToFile(`[PET WINDOW] click-through ${petClickThroughEnabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    logToFile(`[PET WINDOW] setIgnoreMouseEvents failed: ${String(error)}`);
  }
}

function startPetHoverMonitor() {
  if (petHoverMonitorTimer) {
    return;
  }

  petHoverMonitorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      stopPetHoverMonitor();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    const hoveringNow =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height;

    if (hoveringNow === petHovering) {
      return;
    }

    petHovering = hoveringNow;
    setPetWindowClickThrough(!hoveringNow);
  }, 120);
}

function stopPetHoverMonitor() {
  if (petHoverMonitorTimer) {
    clearInterval(petHoverMonitorTimer);
    petHoverMonitorTimer = null;
  }
  petHovering = false;
}

function clearPetTopCorrectionTimer() {
  if (petTopCorrectionTimer) {
    clearTimeout(petTopCorrectionTimer);
    petTopCorrectionTimer = null;
  }
}

function clampPetWindowTopEdge() {
  if (!petWindow || petWindow.isDestroyed() || petTopClampApplying) {
    return;
  }

  const bounds = petWindow.getBounds();
  const nearestDisplay = screen.getDisplayNearestPoint({
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  });
  const minY = nearestDisplay.bounds.y;
  if (bounds.y >= minY) {
    return;
  }

  petTopClampApplying = true;
  try {
    petWindow.setPosition(bounds.x, minY, true);
  } finally {
    petTopClampApplying = false;
  }
}

function schedulePetTopClamp(delayMs = 80) {
  clearPetTopCorrectionTimer();
  petTopCorrectionTimer = setTimeout(() => {
    clampPetWindowTopEdge();
    petTopCorrectionTimer = null;
  }, delayMs);
}

function registerPetClickThroughShortcut() {
  const accelerator = 'CommandOrControl+Shift+P';
  const registered = globalShortcut.register(accelerator, () => {
    setPetWindowClickThrough(!petClickThroughEnabled);
  });

  if (!registered) {
    logToFile(`[SHORTCUT] failed to register ${accelerator}`);
    return;
  }
  logToFile(`[SHORTCUT] registered ${accelerator}`);
}

function updateStartupPercent() {
  const total = startupState.steps.length;
  let score = 0;
  for (const step of startupState.steps) {
    if (step.status === 'done' || step.status === 'warn') {
      score += 1;  // 完成或警告算 1 分
      continue;
    }
    if (step.status === 'running') {
      score += 0.5;  // 运行中算 0.5 分
    }
  }
  startupState.percent = Math.max(5, Math.min(100, Math.round((score / total) * 100)));
  if (startupState.done) {
    startupState.percent = 100;
  }
}

/**
 * 向启动窗口发送进度更新
 */
function emitStartupProgress() {
  updateStartupPercent();
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.webContents.send('startup-progress', startupState);
  }
}

/**
 * 设置某个步骤的状态
 * @param {string} key - 步骤标识
 * @param {string} status - 状态（done/warn/running/pending）
 * @param {string} detail - 详细信息
 */
function setStartupStepStatus(key, status, detail) {
  const step = startupState.steps.find((item) => item.key === key);
  if (!step) {
    return;
  }
  step.status = status;
  if (detail) {
    step.detail = detail;
  }
  emitStartupProgress();
}

/**
 * 带超时的 HTTP 请求
 * @param {string} url - 请求 URL
 * @param {object} init - 请求配置
 * @param {number} timeoutMs - 超时时间（毫秒）
 */
async function fetchWithTimeout(url, init = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查 HTTP 服务是否就绪
 * @param {string} url - 服务地址
 * @returns {boolean} 是否就绪
 */
async function isHttpReady(url) {
  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, 1200);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

/**
 * 获取桌宠渲染页面 URL
 * @returns {string} 渲染页面地址
 */
function getRendererUrl() {
  if (/^https?:\/\//i.test(configuredRendererPath)) {
    return configuredRendererPath;
  }
  const pathname = configuredRendererPath.startsWith('/')
    ? configuredRendererPath
    : `/${configuredRendererPath}`;
  return buildDashboardUrl(pathname);
}

function getBubbleRendererUrl() {
  return buildDashboardUrl('/desktop-pet-bubble');
}

/**
 * 检查桌宠渲染页面是否就绪
 * @returns {Promise<boolean>}
 */
async function isRendererReady() {
  return isHttpReady(getRendererUrl());
}

/**
 * 在目标窗口加载桌宠渲染页面
 * @param {BrowserWindow} targetWindow - 目标窗口
 */
function loadPetRenderer(targetWindow) {
  return targetWindow.loadURL(getRendererUrl());
}

function loadBubbleRenderer(targetWindow) {
  return targetWindow.loadURL(getBubbleRendererUrl());
}

function clampBubbleSize(width, height) {
  const safeWidth = Number.isFinite(width) ? Math.round(width) : BUBBLE_WINDOW_DEFAULT_WIDTH;
  const safeHeight = Number.isFinite(height) ? Math.round(height) : BUBBLE_WINDOW_DEFAULT_HEIGHT;
  return {
    width: Math.max(BUBBLE_WINDOW_MIN_WIDTH, Math.min(BUBBLE_WINDOW_MAX_WIDTH, safeWidth)),
    height: Math.max(BUBBLE_WINDOW_MIN_HEIGHT, Math.min(BUBBLE_WINDOW_MAX_HEIGHT, safeHeight)),
  };
}

function computeBubbleWindowPosition() {
  if (!petWindow || petWindow.isDestroyed()) {
    return null;
  }

  const petBounds = petWindow.getBounds();
  const centerPoint = {
    x: petBounds.x + Math.floor(petBounds.width / 2),
    y: petBounds.y + Math.floor(petBounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  const area = display.workArea;

  let x = Math.round(petBounds.x + (petBounds.width - bubbleWindowWidth) / 2);
  let y = Math.round(petBounds.y - bubbleWindowHeight + BUBBLE_PET_OVERLAP);

  const minX = area.x;
  const maxX = area.x + area.width - bubbleWindowWidth;
  const minY = area.y;
  const maxY = area.y + area.height - bubbleWindowHeight;

  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(minY, Math.min(maxY, y));

  return { x, y };
}

function syncBubbleWindowToPet({ show = false } = {}) {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }

  const position = computeBubbleWindowPosition();
  if (!position) {
    return;
  }

  bubbleWindow.setBounds({
    x: position.x,
    y: position.y,
    width: bubbleWindowWidth,
    height: bubbleWindowHeight,
  }, false);

  if (show && petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
    bubbleWindow.showInactive();
  }
}

function hideBubbleWindow() {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    return;
  }
  bubbleWindow.hide();
}

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    return;
  }

  const position = computeBubbleWindowPosition() || { x: 0, y: 0 };
  bubbleWindow = new BrowserWindow({
    width: bubbleWindowWidth,
    height: bubbleWindowHeight,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  bubbleWindow.setIgnoreMouseEvents(true, { forward: true });

  loadBubbleRenderer(bubbleWindow).catch((err) => {
    logToFile(`[BUBBLE WINDOW] load renderer failed: ${String(err)}`);
  });

  bubbleWindow.on('closed', () => {
    bubbleWindow = null;
  });
}

function getPetWindowBottomRightPosition() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const x = Math.max(area.x, area.x + area.width - PET_WIDTH - PET_WINDOW_MARGIN);
  const y = Math.max(area.y, area.y + area.height - PET_HEIGHT - PET_WINDOW_MARGIN);
  return { x, y };
}

function placePetWindowBottomRight(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }
  const { x, y } = getPetWindowBottomRightPosition();
  targetWindow.setPosition(x, y, false);
}

function clearPetRendererRetryTimer() {
  if (petRendererRetryTimer) {
    clearTimeout(petRendererRetryTimer);
    petRendererRetryTimer = null;
  }
}

function schedulePetRendererRetry(reason = 'unknown') {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  if (petRendererRetryTimer) {
    return;
  }
  if (petRendererRetryCount >= PET_RENDERER_MAX_RETRIES) {
    logToFile(`[PET WINDOW] renderer retry exhausted after ${petRendererRetryCount} attempts`);
    return;
  }

  petRendererRetryCount += 1;
  const attempt = petRendererRetryCount;
  const rendererUrl = getRendererUrl();
  logToFile(`[PET WINDOW] schedule renderer retry #${attempt} (${reason}) -> ${rendererUrl}`);

  petRendererRetryTimer = setTimeout(async () => {
    clearPetRendererRetryTimer();
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }

    const ready = await isRendererReady();
    if (!ready) {
      schedulePetRendererRetry(`renderer not ready #${attempt}`);
      return;
    }

    loadPetRenderer(petWindow).catch((err) => {
      logToFile(`[PET WINDOW] retry load failed #${attempt}: ${String(err)}`);
      schedulePetRendererRetry(`load failed #${attempt}`);
    });
  }, PET_RENDERER_RETRY_DELAY_MS);
}

/**
 * 创建桌宠窗口
 * 特性：透明背景、置顶、无框、不可调整大小、不在任务栏显示、默认居中显示
 */
function createPetWindow() {
  const { x, y } = getPetWindowBottomRightPosition();
  // Create pet window at bottom-right by default.
  petWindow = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Re-apply bottom-right placement to avoid OS window policy override.
  placePetWindowBottomRight(petWindow);
  createBubbleWindow();
  syncBubbleWindowToPet();

  loadPetRenderer(petWindow).catch((err) => {
    logToFile(`[PET WINDOW] load renderer failed: ${String(err)}`);
    schedulePetRendererRetry('initial load failed');
  });

  petWindow.webContents.on('did-fail-load', (_event, code, desc, validatedURL) => {
    if (code === -3) {
      return;
    }
    logToFile(`[PET WINDOW] did-fail-load code=${code} desc=${desc} url=${validatedURL}`);
    schedulePetRendererRetry(`did-fail-load ${code}`);
  });

  petWindow.webContents.on('did-finish-load', () => {
    petRendererRetryCount = 0;
    clearPetRendererRetryTimer();
    logToFile('[PET WINDOW] did-finish-load');
    // Ensure window is shown if ready-to-show didn't fire
    if (!onboardingLocked && petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()) {
      logToFile('[PET WINDOW] forcing show from did-finish-load');
      petWindow.show();
    }
  });

  petWindow.once('ready-to-show', () => {
    logToFile('[PET WINDOW] ready-to-show triggered');
    setPetWindowClickThrough(false);
    if (!onboardingLocked) {
      logToFile('[PET WINDOW] showing pet window from ready-to-show');
      petWindow.show();
      syncBubbleWindowToPet();
    } else {
      logToFile('[PET WINDOW] skipping show (onboarding locked)');
    }
  });

  petWindow.on('will-move', (event, newBounds) => {
    if (!petWindow || petWindow.isDestroyed() || petTopClampApplying) {
      return;
    }

    petDragActive = true;
    clearPetTopCorrectionTimer();

    const nearestDisplay = screen.getDisplayNearestPoint({
      x: newBounds.x + Math.floor(newBounds.width / 2),
      y: newBounds.y + Math.floor(newBounds.height / 2),
    });
    const minY = nearestDisplay.bounds.y;

    if (newBounds.y >= minY - 96) {
      return;
    }

    event.preventDefault();
    petTopClampApplying = true;
    try {
      petWindow.setPosition(newBounds.x, minY, true);
    } finally {
      petTopClampApplying = false;
    }
  });

  petWindow.on('moved', () => {
    petDragActive = false;
    schedulePetTopClamp(40);
    syncBubbleWindowToPet({ show: bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible() });
  });

  petWindow.on('move', () => {
    syncBubbleWindowToPet({ show: bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible() });
  });

  petWindow.on('show', () => {
    if (bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible()) {
      syncBubbleWindowToPet({ show: true });
    }
  });

  petWindow.on('hide', () => {
    hideBubbleWindow();
  });

  petWindow.on('blur', () => {
    if (!petDragActive) {
      schedulePetTopClamp(40);
    }
  });

  petWindow.on('closed', () => {
    clearPetTopCorrectionTimer();
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.close();
      bubbleWindow = null;
    }
    stopPetHoverMonitor();
    petWindow = null;
    app.quit();
  });
}
/**
 * 重置桌宠窗口状态
 * 用于从引导模式返回正常模式时恢复窗口属性
 */
function resetPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.setResizable(false);
  petWindow.setAlwaysOnTop(true);
  petWindow.setSkipTaskbar(true);
  petWindow.setBounds(getPetBounds(), true);
  setPetWindowClickThrough(false);
}

/**
 * 为 URL 添加 launcher token
 * 用于身份验证
 * @param {string} rawUrl - 原始 URL
 * @returns {string} 带 token 的 URL
 */
function withLauncherToken(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('ui_rev', '20260420_3');
    if (!parsed.searchParams.has('token')) {
      if (launcherToken) {
        parsed.searchParams.set('token', launcherToken);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * 构建前端面板 URL
 * @param {string} pathname - 路径名
 * @returns {string} 完整 URL
 */
function buildDashboardUrl(pathname = '') {
  const baseUrl = isProduction ? effectiveDashboardBaseUrl : dashboardBaseUrl;
  let resolved = baseUrl;

  if (pathname) {
    if (/^https?:\/\//i.test(pathname)) {
      resolved = pathname;
    } else {
      resolved = `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
    }
  }

  return withLauncherToken(resolved);
}

function buildSettingsWindowUrl({ onboarding = false, rerun = false } = {}) {
  return onboarding
    ? buildDashboardUrl(rerun ? '/onboarding?mode=rerun' : '/onboarding')
    : buildDashboardUrl('/?surface=console');
}

/**
 * 解析初始设置窗口目标 URL
 * @returns {Promise<string>}
 */
async function resolveInitialSettingsTargetUrl() {
  try {
    const headers = launcherToken ? { Authorization: `Bearer ${launcherToken}` } : {};
    const response = await fetchWithTimeout(`${launcherBaseUrl}/api/gateway/status`, { headers }, 1400);
    if (response.ok) {
      const data = await response.json();
      needsFirstTimeOnboarding = shouldOpenOnboardingFromGatewayStatus(data);
    }
  } catch {
    // Keep default panel route when status is temporarily unavailable.
  }
  return buildSettingsWindowUrl();
}

/**
 * 创建设置窗口
 * 用于显示控制面板和聊天界面
 * @param {string} targetUrl - 目标 URL
 */
function createSettingsWindow(targetUrl = buildSettingsWindowUrl()) {
  // 如果窗口已存在，则刷新或显示
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (targetUrl && settingsWindow.webContents.getURL() !== targetUrl) {
      settingsWindow.loadURL(targetUrl).catch((err) => {
        logToFile(`[SETTINGS WINDOW] reload failed: ${String(err)}`);
      });
    }
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  // 计算窗口尺寸（屏幕的 70%）
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const settingsWidth = Math.round(width * 0.72);
  const settingsHeight = Math.round(height * 0.76);

  settingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    minWidth: 600,
    minHeight: 400,
    center: true,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f7ecdf',  // 背景色
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const settingsUrl = targetUrl || buildDashboardUrl();
  logToFile(`[SETTINGS WINDOW] opening ${settingsUrl}`);

  // 监听加载失败事件
  settingsWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    logToFile(`[SETTINGS WINDOW] did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  // 监听加载完成事件
  settingsWindow.webContents.on('did-finish-load', () => {
    logToFile('[SETTINGS WINDOW] did-finish-load');
  });

  settingsWindow.loadURL(settingsUrl).catch((err) => {
    logToFile(`[SETTINGS WINDOW] loadURL failed: ${String(err)}`);
  });

  // 页面加载完成后显示窗口
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    settingsWindow.focus();
    if (shouldOpenDevTools) {
      settingsWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createOnboardingWindow(targetUrl = buildSettingsWindowUrl({ onboarding: true })) {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    if (targetUrl && onboardingWindow.webContents.getURL() !== targetUrl) {
      onboardingWindow.loadURL(targetUrl).catch((err) => {
        logToFile(`[ONBOARDING WINDOW] reload failed: ${String(err)}`);
      });
    }
    if (onboardingWindow.isMinimized()) {
      onboardingWindow.restore();
    }
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const onboardingWidth = Math.round(width * 0.82);
  const onboardingHeight = Math.round(height * 0.86);

  onboardingWindow = new BrowserWindow({
    width: onboardingWidth,
    height: onboardingHeight,
    minWidth: 980,
    minHeight: 680,
    center: true,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f7ecdf',
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const onboardingUrl = targetUrl || buildSettingsWindowUrl({ onboarding: true });
  logToFile(`[ONBOARDING WINDOW] opening ${onboardingUrl}`);

  onboardingWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    logToFile(`[ONBOARDING WINDOW] did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  onboardingWindow.webContents.on('did-finish-load', () => {
    logToFile('[ONBOARDING WINDOW] did-finish-load');
  });

  onboardingWindow.loadURL(onboardingUrl).catch((err) => {
    logToFile(`[ONBOARDING WINDOW] loadURL failed: ${String(err)}`);
  });

  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow.show();
    onboardingWindow.focus();
    if (shouldOpenDevTools) {
      onboardingWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
}

function createStartupWindow() {
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.show();
    startupWindow.focus();
    return;
  }

  startupWindow = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 760,
    minHeight: 500,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f7ecdf',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const startupHtmlPath = path.join(__dirname, 'startup.html');
  startupWindow.loadFile(startupHtmlPath).catch((err) => {
    logToFile(`[STARTUP WINDOW] loadFile failed: ${String(err)}`);
  });

  startupWindow.once('ready-to-show', () => {
    startupWindow.show();
    startupWindow.focus();
    emitStartupProgress();
  });

  startupWindow.on('closed', () => {
    startupWindow = null;
  });
}

/**
 * 完成启动流程，显示桌宠和设置窗口
 * @param {object} options - 选项
 * @param {boolean} options.openPanel - 是否打开面板
 */
function completeStartupAndShowDesktop(options = {}) {
  const { openPanel = openPanelOnReady } = options;
  if (startupCompleted) {
    return;
  }
  startupCompleted = true;
  startupState.done = true;
  startupState.title = '启动成功';
  startupState.subtitle = '正在打开桌宠与桌面面板…';
  emitStartupProgress();

  if (startupPollTimer) {
    clearInterval(startupPollTimer);
    startupPollTimer = null;
  }

  // 延迟创建窗口，确保状态更新
  setTimeout(() => {
    // 检查是否需要进入引导模式
    if (onboardingLocked) {
      logToFile('[STARTUP] onboarding locked after startup, entering onboarding mode');
      enterOnboardingMode('first-run');
      return;
    }

    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
    }
    const finish = async () => {
      if (openPanelOnReady) {
        const targetUrl = await resolveInitialSettingsTargetUrl();
        createSettingsWindow(targetUrl);
      } else if (openPanelOnReady) {
        logToFile('[STARTUP] panel not ready, skip auto-open for now');
      }
      if (startupWindow && !startupWindow.isDestroyed()) {
        startupWindow.close();
      }
    };
    void finish();
  }, 380);
}

/**
 * 轮询检查各个服务的启动状态
 * 每秒调用一次，直到所有服务就绪
 */
async function pollStartupProgress() {
  startupPollCount += 1;

  // 检查后端服务
  const backendReady = await isHttpReady(backendBaseUrl);
  if (backendReady) {
    setStartupStepStatus('backend', 'done', '后端服务已就绪');
  } else {
    setStartupStepStatus('backend', 'running', '等待后端服务响应…');
  }

  // 检查网关状态
  if (backendReady) {
    try {
      const response = await fetchWithTimeout(`${backendBaseUrl}/pet/token`, {}, 1400);
      if (response.ok) {
        const data = await response.json();
        if (data?.enabled && data?.ws_url) {
          setStartupStepStatus('gateway', 'done', 'Gateway 已运行（18790）');
        } else {
          setStartupStepStatus('gateway', 'pending', '等待 pet channel 就绪…');
        }
      } else {
        setStartupStepStatus('gateway', 'pending', '暂未获取到 pet channel 状态');
      }
    } catch {
      setStartupStepStatus('gateway', 'pending', '暂未获取到 pet channel 状态');
    }
  } else {
    setStartupStepStatus('gateway', 'pending', '等待后端服务状态…');
  }

  // 检查前端面板
  const panelReady = await isHttpReady(isProduction ? effectiveDashboardBaseUrl : dashboardBaseUrl);
  if (panelReady) {
    setStartupStepStatus('petclaw', 'done', '桌面面板已就绪');
  } else {
    setStartupStepStatus('petclaw', 'running', '启动桌面面板服务中…');
  }

  // 检查桌宠渲染页面
  const rendererReady = await isRendererReady();
  if (rendererReady) {
    setStartupStepStatus('renderer', 'done', '桌宠渲染页面已就绪');
  } else {
    if (panelReady) {
      setStartupStepStatus('renderer', 'running', '面板可访问，但 /desktop-pet 渲染页未就绪…');
      if (startupPollCount % 8 === 0) {
        logToFile(`[STARTUP] renderer not ready while panel is ready. rendererUrl=${getRendererUrl()}`);
      }
    } else {
      setStartupStepStatus('renderer', 'running', '等待 petclaw 桌宠页面就绪…');
    }
  }

  // 如果渲染页面就绪，完成启动流程
  if (rendererReady) {
    if (!backendReady) {
      setStartupStepStatus('backend', 'warn', '后端暂未就绪，桌宠先启动');
    }
    if (!panelReady) {
      setStartupStepStatus('petclaw', 'warn', '面板暂未就绪，可稍后点击桌宠 S 按钮打开');
    }
    completeStartupAndShowDesktop({ openPanel: panelReady && openPanelOnReady });
  }
}

/**
 * 启动启动流程
 * 创建启动窗口并开始轮询
 */
function startStartupFlow() {
  createStartupWindow();
  void pollStartupProgress();
  startupPollTimer = setInterval(() => {
    void pollStartupProgress();
  }, 1000);
}

/**
 * IPC 通信处理器
 * 处理渲染进程发来的各种请求
 */

// 打开设置窗口
ipcMain.on('open-settings', async () => {
  logToFile('[IPC] open-settings');
  const targetUrl = await resolveInitialSettingsTargetUrl();
  createSettingsWindow(targetUrl);
});

// 打开引导窗口
ipcMain.on('open-onboarding', () => {
  logToFile('[IPC] open-onboarding');
  enterOnboardingMode('manual-rerun', { rerun: true });
});

// 设置引导模式
ipcMain.on('set-onboarding-mode', (event, enabled) => {
  logToFile(`[IPC] set-onboarding-mode ${Boolean(enabled)}`);
  if (enabled) {
    const currentUrl = event.sender.getURL();
    enterOnboardingMode('renderer-request', {
      rerun: /[?&]mode=rerun\b/i.test(currentUrl),
    });
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target === onboardingWindow && onboardingWindow && !onboardingWindow.isDestroyed()) {
      onboardingWindow.focus();
    }
    return;
  }
  logToFile('[IPC] set-onboarding-mode false ignored (completion required)');
});

ipcMain.on('complete-onboarding', () => {
  logToFile('[IPC] complete-onboarding');
  leaveOnboardingMode({ completed: true });
});

ipcMain.on('set-pet-click-through', (_event, enabled) => {
  logToFile(`[IPC] set-pet-click-through ${Boolean(enabled)}`);
  setPetWindowClickThrough(Boolean(enabled));
});

ipcMain.on('bubble-window-size', (_event, payload) => {
  const next = clampBubbleSize(payload?.width, payload?.height);
  if (next.width === bubbleWindowWidth && next.height === bubbleWindowHeight) {
    return;
  }
  bubbleWindowWidth = next.width;
  bubbleWindowHeight = next.height;
  syncBubbleWindowToPet({ show: bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible() });
});

// 窗口最小化
ipcMain.on('window-minimize', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) {
    target.minimize();
  }
});

// 窗口最大化/还原
ipcMain.on('window-toggle-maximize', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) {
    return;
  }
  if (target.isMaximized()) {
    target.unmaximize();
  } else {
    target.maximize();
  }
});

// 窗口关闭
ipcMain.on('window-close', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) {
    target.close();
  }
});

// 渲染进程日志
ipcMain.on('renderer-log', (_event, { level, args }) => {
  const message = args.map((arg) => {
    if (typeof arg === 'object') {
      return JSON.stringify(arg);
    }
    return String(arg);
  }).join(' ');

  if (level === 'error') {
    logToFile(`[RENDERER ERROR] ${message}`);
  } else {
    logToFile(`[RENDERER] ${message}`);
  }
});

// 设置窗口最小化
ipcMain.on('minimize-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.minimize();
  }
});

// 设置窗口最大化
ipcMain.on('maximize-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMaximized()) {
      settingsWindow.unmaximize();
    } else {
      settingsWindow.maximize();
    }
  }
});

// 设置窗口关闭
ipcMain.on('close-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

// 设置变更通知
ipcMain.on('settings-changed', (_event, settings) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('settings-updated', settings);
  }
});

// 聊天历史更新
ipcMain.on('chat-history', (_event, history) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('chat-history-updated', history);
  }
});

// 显示气泡消息（桌宠说话）
ipcMain.on('show-bubble', (_event, data) => {
  const audio = typeof data?.audio === 'string' ? data.audio.trim() : '';
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  const emotion = typeof data?.emotion === 'string' ? data.emotion.trim() : '';
  const fingerprint = `${audio}|${text}|${emotion}`;
  const now = Date.now();
  const hasDetachedBubbleWindow = bubbleWindow && !bubbleWindow.isDestroyed();

  if (fingerprint && fingerprint === lastBubbleFingerprint && now - lastBubbleAt < 2500) {
    logToFile('[IPC] show-bubble dropped duplicated payload');
    return;
  }

  lastBubbleFingerprint = fingerprint;
  lastBubbleAt = now;

  if (!hasDetachedBubbleWindow && petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('bubble-show', data);
  }

  if (hasDetachedBubbleWindow) {
    syncBubbleWindowToPet({ show: true });
    bubbleWindow.webContents.send('bubble-show', data);
  }
});

// 连接活跃状态
ipcMain.on('connection-alive', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('connection-alive');
  }
});

// 获取启动状态
ipcMain.handle('startup-state', async () => startupState);

/**
 * 应用就绪后的初始化
 * 根据配置决定显示启动窗口还是直接创建桌宠窗口
 */
app.whenReady().then(async () => {
  registerPetClickThroughShortcut();
  // 自动启动后端服务
  await startBackendServices();
  
  if (startupMode) {
    logToFile('[STARTUP] startup progress page enabled');
    startStartupFlow();
    return;
  }
  createPetWindow();
  if (onboardingLocked) {
    enterOnboardingMode('first-run');
  }
});

app.on('second-instance', () => {
  if (startupWindow && !startupWindow.isDestroyed()) {
    if (startupWindow.isMinimized()) {
      startupWindow.restore();
    }
    startupWindow.show();
    startupWindow.focus();
    return;
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
  }
});

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 应用退出前清理定时器
app.on('before-quit', () => {
  clearPetTopCorrectionTimer();
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.close();
    bubbleWindow = null;
  }
  globalShortcut.unregisterAll();
  if (startupPollTimer) {
    clearInterval(startupPollTimer);
    startupPollTimer = null;
  }
  clearPetRendererRetryTimer();
  
  // 停止后端服务
  stopBackendServices();
});

/**
 * 启动后端服务（Gateway + Launcher）
 */
async function startBackendServices() {
  const exeDir = path.dirname(process.execPath);

  // electron-builder extraResources are placed in resources/ by default.
  // Keep exe-dir fallback for local debug layouts.
  const resolveEmbeddedBinary = (filename) => {
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, filename));
    }
    candidates.push(path.join(exeDir, filename));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Preserve a deterministic path for logs even when missing.
    return candidates[0];
  };
  // Resolve embedded backend binaries.
  const gatewayExe = resolveEmbeddedBinary('picoclaw.exe');
  const launcherExe = resolveEmbeddedBinary('picoclaw-web.exe');
  
  const hasGateway = fs.existsSync(gatewayExe);
  const hasLauncher = fs.existsSync(launcherExe);
  
  if (!hasGateway && !hasLauncher) {
    logToFile('[BACKEND] No embedded backend binaries found, assuming external services');
    return;
  }
  
  logToFile('[BACKEND] Starting embedded backend services...');
  if (isProduction) {
    try {
      await startNextServer();
    } catch (error) {
      logToFile(`[BACKEND] Failed to start Next.js: ${error.message}`);
    }
  }
  
  // 启动 Launcher (18800)
  if (hasLauncher) {
    try {
      await startLauncher(launcherExe, exeDir);
    } catch (error) {
      logToFile(`[BACKEND] Failed to start launcher: ${error.message}`);
    }
  }
  
  // 启动 Gateway (18790)
  if (hasGateway) {
    try {
      await startGateway(gatewayExe, exeDir);
    } catch (error) {
      logToFile(`[BACKEND] Failed to start gateway: ${error.message}`);
    }
  }
  
  logToFile('[BACKEND] Backend services startup initiated');
}

/**
 * 启动 Launcher 服务
 */
async function startLauncher(exePath, workDir) {
  const configDir = path.join(os.homedir(), '.picoclaw');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const configPath = path.join(configDir, 'config.json');
  
  if (!launcherToken) {
    launcherToken = embeddedLauncherTokenDefault;
  }
  process.env.GOCLAW_LAUNCHER_TOKEN = launcherToken;
  process.env.PICOCLAW_LAUNCHER_TOKEN = launcherToken;

  const childEnv = await buildChildProcessEnv({
    PICOCLAW_LAUNCHER_TOKEN: launcherToken,
    GOCLAW_LAUNCHER_TOKEN: launcherToken,
    PICOCLAW_HOME: configDir,
    PICOCLAW_CONFIG: configPath
  });

  return new Promise((resolve, reject) => {
    launcherProcess = spawn(exePath, [
      '-port', '18800',
      '-no-browser',
      configPath
    ], {
      cwd: workDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    
    launcherProcess.stdout.on('data', (data) => {
      logToFile(`[LAUNCHER] ${data.toString().trim()}`);
    });
    
    launcherProcess.stderr.on('data', (data) => {
      logToFile(`[LAUNCHER ERROR] ${data.toString().trim()}`);
    });
    
    launcherProcess.on('error', (error) => {
      logToFile(`[LAUNCHER] Process error: ${error.message}`);
      reject(error);
    });
    
    launcherProcess.on('exit', (code) => {
      logToFile(`[LAUNCHER] Process exited with code ${code}`);
      launcherProcess = null;
    });
    
    // 等待 Launcher 启动
    const checkLauncher = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const ready = await isHttpReady('http://127.0.0.1:18800/api/auth/status');
          if (ready) {
            logToFile('[LAUNCHER] Service ready');
            resolve();
            return;
          }
        } catch {}
      }
      reject(new Error('Launcher startup timeout'));
    };
    
    checkLauncher();
  });
}

/**
 * 启动 Gateway 服务
 */
async function startGateway(exePath, workDir) {
  const configDir = path.join(os.homedir(), '.picoclaw');
  const configPath = path.join(configDir, 'config.json');

  const childEnv = await buildChildProcessEnv({
    PICOCLAW_HOME: configDir,
    PICOCLAW_CONFIG: configPath
  });

  return new Promise((resolve, reject) => {
    
    logToFile(`[GATEWAY] Config dir: ${configDir}`);
    logToFile(`[GATEWAY] Config path: ${configPath}`);
    logToFile(`[GATEWAY] Config exists: ${fs.existsSync(configPath)}`);
    
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        const defaultModel = config.agents?.defaults?.model_name;
        const modelList = config.model_list || [];
        const defaultModelConfig = modelList.find(m => m.model_name === defaultModel);
        
        logToFile(`[GATEWAY] Default model: ${defaultModel}`);
        logToFile(`[GATEWAY] Model config found: ${!!defaultModelConfig}`);
        if (defaultModelConfig) {
          logToFile(`[GATEWAY] Has api_keys: ${!!defaultModelConfig.api_keys}`);
          logToFile(`[GATEWAY] api_keys length: ${defaultModelConfig.api_keys?.length || 0}`);
        }
      } catch (error) {
        logToFile(`[GATEWAY] Failed to read config: ${error.message}`);
      }
    }
    
    gatewayProcess = spawn(exePath, [
      'gateway',
      '-E'
    ], {
      cwd: workDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    
    gatewayProcess.stdout.on('data', (data) => {
      logToFile(`[GATEWAY] ${data.toString().trim()}`);
    });
    
    gatewayProcess.stderr.on('data', (data) => {
      logToFile(`[GATEWAY ERROR] ${data.toString().trim()}`);
    });
    
    gatewayProcess.on('error', (error) => {
      logToFile(`[GATEWAY] Process error: ${error.message}`);
      reject(error);
    });
    
    gatewayProcess.on('exit', (code) => {
      logToFile(`[GATEWAY] Process exited with code ${code}`);
      gatewayProcess = null;
    });
    
    // 等待 Gateway 启动
    const checkGateway = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const ready = await isHttpReady('http://127.0.0.1:18790/health');
          if (ready) {
            logToFile('[GATEWAY] Service ready');
            resolve();
            return;
          }
        } catch {}
      }
      reject(new Error('Gateway startup timeout'));
    };
    
    checkGateway();
  });
}

/**
 * 停止后端服务
 */
function stopBackendServices() {
  logToFile('[BACKEND] Stopping backend services...');

  if (nextServerProcess) {
    try {
      nextServerProcess.kill();
      logToFile('[NEXT] Process killed');
    } catch (error) {
      logToFile(`[NEXT] Kill failed: ${error.message}`);
    }
    nextServerProcess = null;
  }
  
  if (launcherProcess) {
    try {
      launcherProcess.kill();
      logToFile('[LAUNCHER] Process killed');
    } catch (error) {
      logToFile(`[LAUNCHER] Kill failed: ${error.message}`);
    }
    launcherProcess = null;
  }
  
  if (gatewayProcess) {
    try {
      gatewayProcess.kill();
      logToFile('[GATEWAY] Process killed');
    } catch (error) {
      logToFile(`[GATEWAY] Kill failed: ${error.message}`);
    }
    gatewayProcess = null;
  }
}
