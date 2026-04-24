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

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 全局窗口引用
let petWindow = null;              // 桌宠窗口
let settingsWindow = null;         // 设置窗口
let onboardingWindow = null;       // 初始化窗口
let startupWindow = null;          // 启动进度窗口
let startupPollTimer = null;       // startup polling timer
let petRendererRetryTimer = null;  // pet renderer retry timer
let petRendererRetryCount = 0;     // pet renderer retry count
let startupCompleted = false;      // startup completed flag
let petHoverMonitorTimer = null;
let petHovering = false;
let onboardingLocked = false;
let lastBubbleFingerprint = '';
let lastBubbleAt = 0;

// 桌宠窗口尺寸（宽度280px，高度380px）
const PET_WIDTH = 280;
const PET_HEIGHT = 380;
const PET_WINDOW_MARGIN = 16;
const PET_RENDERER_RETRY_DELAY_MS = 1200;
const PET_RENDERER_MAX_RETRIES = 60;

/**
 * 设置 Electron 用户数据目录
 * 使用 .goclaw 目录存储日志等数据
 */
const userDataPath = path.join(os.homedir(), '.goclaw');
app.setPath('userData', userDataPath);
const onboardingStatePath = path.join(userDataPath, 'onboarding-state.json');

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

/**
 * 日志系统配置
 * 所有日志输出到 ~/.goclaw/logs.txt
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
}

function hideRuntimeWindowsForOnboarding() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.hide();
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
}

function enterOnboardingMode(reason = 'manual', { rerun = false } = {}) {
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
const launcherToken = (process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '').trim();
const configuredRendererPath = (process.env.GOCLAW_PET_RENDERER_PATH || '/desktop-pet').trim();
const shouldOpenDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === '1';  // 是否打开开发者工具
const startupMode = process.env.GOCLAW_SHOW_STARTUP === '1';  // 是否显示启动进度窗口
const openPanelOnReady = process.env.GOCLAW_OPEN_PANEL_ON_READY !== '0';  // 就绪后是否打开面板
let needsFirstTimeOnboarding = false;  // 是否需要首次引导

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
    if (enabled) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      petWindow.setIgnoreMouseEvents(false);
    }
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
  });

  petWindow.once('ready-to-show', () => {
    setPetWindowClickThrough(true);
    startPetHoverMonitor();
    if (!onboardingLocked) {
      petWindow.show();
    }
  });

  petWindow.on('closed', () => {
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
  setPetWindowClickThrough(true);
  startPetHoverMonitor();
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
  let resolved = dashboardBaseUrl;

  if (pathname) {
    if (/^https?:\/\//i.test(pathname)) {
      resolved = pathname;
    } else {
      resolved = `${dashboardBaseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
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
  const panelReady = await isHttpReady(dashboardBaseUrl);
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
    setStartupStepStatus('renderer', 'running', '等待 petclaw 桌宠页面就绪…');
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

  if (fingerprint && fingerprint === lastBubbleFingerprint && now - lastBubbleAt < 2500) {
    logToFile('[IPC] show-bubble dropped duplicated payload');
    return;
  }

  lastBubbleFingerprint = fingerprint;
  lastBubbleAt = now;

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('bubble-show', data);
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
app.whenReady().then(() => {
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

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 应用退出前清理定时器
app.on('before-quit', () => {
  if (startupPollTimer) {
    clearInterval(startupPollTimer);
    startupPollTimer = null;
  }
  clearPetRendererRetryTimer();
});
