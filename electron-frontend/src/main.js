const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let petWindow = null;
let settingsWindow = null;
let onboardingWindow = null;
let lastBubbleFingerprint = '';
let lastBubbleAt = 0;
let petHoverMonitorTimer = null;
let onboardingLocked = true;

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

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  try {
    petWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: Boolean(enabled) });
  } catch (error) {
    logToFile(`[PET WINDOW] setIgnoreMouseEvents fallback: ${String(error)}`);
    petWindow.setIgnoreMouseEvents(Boolean(enabled));
  }
}

function startPetHoverMonitor() {
  if (petHoverMonitorTimer) {
    clearInterval(petHoverMonitorTimer);
    petHoverMonitorTimer = null;
  }

  petHoverMonitorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    const hovered =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height;

    setPetWindowClickThrough(!hovered);
  }, 80);
}

function stopPetHoverMonitor() {
  if (petHoverMonitorTimer) {
    clearInterval(petHoverMonitorTimer);
    petHoverMonitorTimer = null;
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
    : buildDashboardUrl();
}

function showWindow(targetWindow, targetUrl, logPrefix) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return false;
  }

  if (targetUrl && targetWindow.webContents.getURL() !== targetUrl) {
    targetWindow.loadURL(targetUrl).catch((err) => {
      logToFile(`[${logPrefix}] reload failed: ${String(err)}`);
    });
  }
  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  targetWindow.show();
  targetWindow.focus();
  return true;
}

function createSettingsWindow(targetUrl = buildDashboardUrl()) {
  if (showWindow(settingsWindow, targetUrl, 'SETTINGS WINDOW')) {
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
  if (showWindow(onboardingWindow, targetUrl, 'ONBOARDING WINDOW')) {
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const onboardingWidth = Math.min(width - 24, Math.max(1180, Math.round(width * 0.9)));
  const onboardingHeight = Math.min(height - 24, Math.max(820, Math.round(height * 0.92)));

  onboardingWindow = new BrowserWindow({
    width: onboardingWidth,
    height: onboardingHeight,
    minWidth: 980,
    minHeight: 720,
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

  logToFile(`[ONBOARDING WINDOW] opening ${targetUrl}`);

  onboardingWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    logToFile(`[ONBOARDING WINDOW] did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  onboardingWindow.webContents.on('did-finish-load', () => {
    logToFile('[ONBOARDING WINDOW] did-finish-load');
  });

  onboardingWindow.loadURL(targetUrl).catch((err) => {
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
    if (onboardingLocked) {
      logToFile('[ONBOARDING] window closed while locked, quitting app');
      app.quit();
    }
  });
}

ipcMain.on('open-settings', () => {
  logToFile('[IPC] open-settings');
  if (onboardingLocked) {
    enterOnboardingMode('open-settings-while-locked', { rerun: false });
    return;
  }
  createSettingsWindow(buildSettingsWindowUrl());
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

app.whenReady().then(() => {
  createPetWindow();
  if (onboardingLocked) {
    enterOnboardingMode('first-run');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
