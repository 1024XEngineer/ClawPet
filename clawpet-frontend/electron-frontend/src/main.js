const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let petWindow = null;
let settingsWindow = null;
let startupWindow = null;
let startupPollTimer = null;
let startupCompleted = false;

const PET_WIDTH = 280;
const PET_HEIGHT = 380;

const userDataPath = path.join(os.homedir(), '.goclaw');
app.setPath('userData', userDataPath);

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

const logFilePath = path.join(userDataPath, 'logs.txt');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  logStream.write(logLine);
  console.log(logLine);
}

logToFile('Electron application started');

const backendBaseUrl = (process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18790').trim().replace(/\/+$/, '');
const dashboardBaseUrl = (process.env.GOCLAW_DASHBOARD_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
const launcherToken = (process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '').trim();
const configuredRendererPath = (process.env.GOCLAW_PET_RENDERER_PATH || '/desktop-pet').trim();
const shouldOpenDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === '1';
const startupMode = process.env.GOCLAW_SHOW_STARTUP === '1';
const openPanelOnReady = process.env.GOCLAW_OPEN_PANEL_ON_READY !== '0';
let needsFirstTimeOnboarding = false;

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

const startupState = {
  done: false,
  percent: 0,
  title: '正在启动 ClawPet',
  subtitle: '准备后端与桌面面板，请稍候…',
  steps: [
    { key: 'backend', label: `后端服务 (${backendPortLabel})`, status: 'running', detail: '正在检测服务…' },
    { key: 'gateway', label: '网关状态（内部）', status: 'pending', detail: '等待后端状态…' },
    { key: 'petclaw', label: `桌面面板 (${dashboardPortLabel})`, status: 'pending', detail: '等待前端服务启动…' },
    { key: 'renderer', label: '桌宠渲染（petclaw /desktop-pet）', status: 'pending', detail: '等待渲染页面就绪…' },
  ],
};

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

function getRendererUrl() {
  if (/^https?:\/\//i.test(configuredRendererPath)) {
    return configuredRendererPath;
  }
  const pathname = configuredRendererPath.startsWith('/')
    ? configuredRendererPath
    : `/${configuredRendererPath}`;
  return buildDashboardUrl(pathname);
}

async function isRendererReady() {
  return isHttpReady(getRendererUrl());
}

function loadPetRenderer(targetWindow) {
  return targetWindow.loadURL(getRendererUrl());
}

function createPetWindow() {
  petWindow = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  petWindow.center();

  loadPetRenderer(petWindow).catch((err) => {
    logToFile(`[PET WINDOW] load renderer failed: ${String(err)}`);
  });

  petWindow.once('ready-to-show', () => {
    petWindow.show();
  });

  petWindow.on('closed', () => {
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
  petWindow.setSize(PET_WIDTH, PET_HEIGHT);
  petWindow.center();
}

function withLauncherToken(rawUrl) {
  if (!launcherToken) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has('token')) {
      parsed.searchParams.set('token', launcherToken);
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

function buildSettingsWindowUrl({ onboarding = false } = {}) {
  return onboarding
    ? buildDashboardUrl('/onboarding?mode=rerun')
    : buildDashboardUrl();
}

async function resolveInitialSettingsTargetUrl() {
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
  const settingsWidth = Math.round(width * 0.7);
  const settingsHeight = Math.round(height * 0.7);

  settingsWindow = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    minWidth: 600,
    minHeight: 400,
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

  setTimeout(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
    }
    const finish = async () => {
      if (openPanel) {
        const targetUrl = needsFirstTimeOnboarding
          ? buildSettingsWindowUrl({ onboarding: true })
          : await resolveInitialSettingsTargetUrl();
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

async function pollStartupProgress() {
  const backendReady = await isHttpReady(backendBaseUrl);
  if (backendReady) {
    setStartupStepStatus('backend', 'done', '后端服务已就绪');
  } else {
    setStartupStepStatus('backend', 'running', '等待后端服务响应…');
  }

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

  const panelReady = await isHttpReady(dashboardBaseUrl);
  if (panelReady) {
    setStartupStepStatus('petclaw', 'done', '桌面面板已就绪');
  } else {
    setStartupStepStatus('petclaw', 'running', '启动桌面面板服务中…');
  }

  const rendererReady = await isRendererReady();
  if (rendererReady) {
    setStartupStepStatus('renderer', 'done', '桌宠渲染页面已就绪');
  } else {
    setStartupStepStatus('renderer', 'running', '等待 petclaw 桌宠页面就绪…');
  }

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
  createSettingsWindow(buildSettingsWindowUrl({ onboarding: true }));
});

ipcMain.on('set-onboarding-mode', (event, enabled) => {
  logToFile(`[IPC] set-onboarding-mode ${Boolean(enabled)}`);
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target === petWindow) {
    resetPetWindow();
    return;
  }
  logToFile('[IPC] set-onboarding-mode ignored for non-pet window');
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
