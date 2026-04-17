const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let petWindow = null;
let settingsWindow = null;

// 璁剧疆鐢ㄦ埛鏁版嵁鐩綍浠ヨВ鍐虫潈闄愰棶棰?
const userDataPath = path.join(os.homedir(), '.goclaw');
app.setPath('userData', userDataPath);

// 鍒涘缓鏃ュ織鏂囦欢
const logFilePath = path.join(userDataPath, 'logs.txt');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  logStream.write(logLine);
  console.log(logLine);
}

logToFile('Electron application started');

const rendererBaseUrl = (process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173').replace(/\/+$/, '');
const shouldOpenDevTools = process.env.ELECTRON_OPEN_DEVTOOLS === '1';

function createPetWindow() {
  // 鑾峰彇灞忓箷鍙充笅瑙掍綅锟?
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // 妗屽疇绐楀彛澶у皬
  const petWidth = 280;
  const petHeight = 380;
  
  petWindow = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x: width - petWidth - 20,
    y: height - petHeight - 60,
    frame: false,           // 鏃犺竟锟?
    transparent: true,      // 閫忔槑鑳屾櫙
    alwaysOnTop: true,     // 缃《
    resizable: false,       // 涓嶅彲璋冩暣澶у皬
    skipTaskbar: true,     // 涓嶆樉绀哄湪浠诲姟锟?
    show: false,           // 鍔犺浇瀹屾垚鍚庢樉锟?
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  petWindow.loadURL(rendererBaseUrl);
  
  petWindow.once('ready-to-show', () => {
    petWindow.show();
  });

  petWindow.on('closed', () => {
    petWindow = null;
    app.quit();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
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
    transparent: true,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  settingsWindow.loadURL(`${rendererBaseUrl}/settings.html`);

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    if (shouldOpenDevTools) {
      settingsWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

// 鎺ユ敹鏉ヨ嚜娓叉煋杩涚▼鐨勬棩蹇?
ipcMain.on('renderer-log', (event, { level, args }) => {
  const message = args.map(arg => {
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
  if (settingsWindow) settingsWindow.minimize();
});

ipcMain.on('maximize-settings', () => {
  if (settingsWindow) {
    if (settingsWindow.isMaximized()) {
      settingsWindow.unmaximize();
    } else {
      settingsWindow.maximize();
    }
  }
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) settingsWindow.close();
});

ipcMain.on('settings-changed', (event, settings) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('settings-updated', settings);
  }
});

ipcMain.on('chat-history', (event, history) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('chat-history-updated', history);
  }
});

ipcMain.on('show-bubble', (event, data) => {
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
