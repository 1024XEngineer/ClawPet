const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let petWindow = null;
let settingsWindow = null;
let onboardingWindow = null;
let startupWindow = null;
let startupPollTimer = null;
let startupCompleted = false;
let petHoverMonitorTimer = null;
let petHovering = false;

const PET_WIDTH = 280;
const PET_HEIGHT = 380;

const userDataPath = path.join(os.homedir(), '.goclaw');
app.setPath('userData', userDataPath);
const onboardingStatePath = path.join(userDataPath, 'onboarding-state.json');

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

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

const rendererBaseUrl = (process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');
const dashboardBaseUrl = (process.env.GOCLAW_DASHBOARD_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
const launcherToken = (process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '').trim();
const shouldOpenDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === '1';
const startupMode = process.env.GOCLAW_SHOW_STARTUP === '1';
const openPanelOnReady = process.env.GOCLAW_OPEN_PANEL_ON_READY !== '0';
let needsFirstTimeOnboarding = false;

const startupState = {
  done: false,
  percent: 0,
  title: '正在启动 ClawPet',
  subtitle: '准备桌宠与桌面面板，请稍候…',
  steps: [
    { key: 'launcher', label: 'Launcher (18800)', status: 'running', detail: '正在检测服务…' },
    { key: 'gateway', label: 'Gateway (18790)', status: 'pending', detail: '等待 launcher 状态…' },
    { key: 'petclaw', label: '桌面面板 (3000)', status: 'pending', detail: '等待前端服务启动…' },
    { key: 'renderer', label: '桌宠渲染 (5173)', status: 'pending', detail: '等待 Electron 渲染服务…' },
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
      score += 1;
      continue;
    }
    if (step.status === 'running') {
      score += 0.5;
    }
  }
  startupState.percent = Math.max(5, Math.min(100, Math.round((score / total) * 100)));
  if (startupState.done) {
    startupState.percent = 100;
  }
}

function emitStartupProgress() {
  updateStartupPercent();
  if (startupWindow && !startupWindow.isDestroyed()) {
    startupWindow.webContents.send('startup-progress', startupState);
  }
}

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

async function fetchWithTimeout(url, init = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isHttpReady(url) {
  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, 1200);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

function createPetWindow() {
  const bounds = getPetBounds();

  petWindow = new BrowserWindow({
    ...bounds,
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

  petWindow.loadURL(rendererBaseUrl).catch((err) => {
    logToFile(`[PET WINDOW] loadURL failed: ${String(err)}`);
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

async function resolveInitialSettingsTargetUrl() {
  try {
    const headers = launcherToken ? { Authorization: `Bearer ${launcherToken}` } : {};
    const response = await fetchWithTimeout('http://127.0.0.1:18800/api/gateway/status', { headers }, 1400);
    if (response.ok) {
      const data = await response.json();
      needsFirstTimeOnboarding = shouldOpenOnboardingFromGatewayStatus(data);
    }
  } catch {
    // Keep default panel route when status is temporarily unavailable.
  }
  return buildSettingsWindowUrl();
}

function createSettingsWindow(targetUrl = buildSettingsWindowUrl()) {
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
    backgroundColor: '#f7ecdf',
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

  settingsWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    logToFile(`[SETTINGS WINDOW] did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  settingsWindow.webContents.on('did-finish-load', () => {
    logToFile('[SETTINGS WINDOW] did-finish-load');
  });

  settingsWindow.loadURL(settingsUrl).catch((err) => {
    logToFile(`[SETTINGS WINDOW] loadURL failed: ${String(err)}`);
  });

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

  const startupHtmlPath = path.join(__dirname, '..', 'startup.html');
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

function completeStartupAndShowDesktop() {
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

  setTimeout(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
    }
    const finish = async () => {
      if (openPanelOnReady) {
        const targetUrl = await resolveInitialSettingsTargetUrl();
        createSettingsWindow(targetUrl);
      }
      if (startupWindow && !startupWindow.isDestroyed()) {
        startupWindow.close();
      }
    };
    void finish();
  }, 380);
}

async function pollStartupProgress() {
  const launcherReady = await isHttpReady('http://127.0.0.1:18800');
  if (launcherReady) {
    setStartupStepStatus('launcher', 'done', 'Launcher 已就绪');
  } else {
    setStartupStepStatus('launcher', 'running', '等待 launcher 响应…');
  }

  if (launcherReady) {
    try {
      const headers = launcherToken ? { Authorization: `Bearer ${launcherToken}` } : {};
      const response = await fetchWithTimeout('http://127.0.0.1:18800/api/gateway/status', { headers }, 1400);
      if (response.ok) {
        const data = await response.json();
        needsFirstTimeOnboarding = shouldOpenOnboardingFromGatewayStatus(data);
        if (data.gateway_status === 'running') {
          setStartupStepStatus('gateway', 'done', 'Gateway 已运行');
        } else if (data.gateway_start_allowed === false) {
          const reason = data.gateway_start_reason || '需要先完成模型配置';
          setStartupStepStatus('gateway', 'warn', `等待配置：${reason}`);
        } else if (data.gateway_status === 'starting' || data.gateway_status === 'restarting') {
          setStartupStepStatus('gateway', 'running', 'Gateway 启动中…');
        } else {
          setStartupStepStatus('gateway', 'pending', '等待 gateway 启动…');
        }
      } else {
        setStartupStepStatus('gateway', 'pending', '暂未获取到 gateway 状态');
      }
    } catch {
      setStartupStepStatus('gateway', 'pending', '暂未获取到 gateway 状态');
    }
  } else {
    setStartupStepStatus('gateway', 'pending', '等待 launcher 状态…');
  }

  const panelReady = await isHttpReady('http://127.0.0.1:3000');
  if (panelReady) {
    setStartupStepStatus('petclaw', 'done', '桌面面板已就绪');
  } else {
    setStartupStepStatus('petclaw', 'running', '启动桌面面板服务中…');
  }

  const rendererReady = await isHttpReady('http://127.0.0.1:5173');
  if (rendererReady) {
    setStartupStepStatus('renderer', 'done', '桌宠渲染服务已就绪');
  } else {
    setStartupStepStatus('renderer', 'running', '启动桌宠渲染服务中…');
  }

  if (launcherReady && panelReady && rendererReady) {
    completeStartupAndShowDesktop();
  }
}

function startStartupFlow() {
  createStartupWindow();
  void pollStartupProgress();
  startupPollTimer = setInterval(() => {
    void pollStartupProgress();
  }, 1000);
}

ipcMain.on('open-settings', async () => {
  logToFile('[IPC] open-settings');
  const targetUrl = await resolveInitialSettingsTargetUrl();
  createSettingsWindow(targetUrl);
});

ipcMain.on('open-onboarding', () => {
  logToFile('[IPC] open-onboarding');
  enterOnboardingMode('manual-rerun', { rerun: true });
});

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

ipcMain.on('window-minimize', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) {
    target.minimize();
  }
});

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

ipcMain.on('window-close', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) {
    target.close();
  }
});

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

ipcMain.on('minimize-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.minimize();
  }
});

ipcMain.on('maximize-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMaximized()) {
      settingsWindow.unmaximize();
    } else {
      settingsWindow.maximize();
    }
  }
});

ipcMain.on('close-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

ipcMain.on('settings-changed', (_event, settings) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('chat-history', (_event, history) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('chat-history-updated', history);
  }
});

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

ipcMain.on('connection-alive', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('connection-alive');
  }
});

ipcMain.handle('startup-state', async () => startupState);

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (startupPollTimer) {
    clearInterval(startupPollTimer);
    startupPollTimer = null;
  }
});
