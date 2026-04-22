const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendBaseUrl: () => process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18790',
  getLauncherToken: () => process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '',
  openOnboarding: () => ipcRenderer.send('open-onboarding'),
  setOnboardingMode: (enabled) => ipcRenderer.send('set-onboarding-mode', Boolean(enabled)),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  openSettings: () => ipcRenderer.send('open-settings'),
  minimizeSettings: () => ipcRenderer.send('minimize-settings'),
  maximizeSettings: () => ipcRenderer.send('maximize-settings'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  sendSettingsChange: (settings) => ipcRenderer.send('settings-changed', settings),
  sendChatHistory: (history) => ipcRenderer.send('chat-history', history),
  showBubble: (payloadOrText, emotion, audio) => {
    const payload =
      payloadOrText && typeof payloadOrText === 'object'
        ? payloadOrText
        : { text: payloadOrText ?? null, emotion, audio }
    ipcRenderer.send('show-bubble', payload)
  },
  sendConnectionAlive: () => ipcRenderer.send('connection-alive'),
  onSettingsUpdate: (callback) => {
    ipcRenderer.on('settings-updated', (_event, settings) => callback(settings));
  },
  onChatHistoryUpdate: (callback) => {
    ipcRenderer.on('chat-history-updated', (_event, history) => callback(history));
  },
  onBubbleShow: (callback) => {
    ipcRenderer.on('bubble-show', (_event, data) => callback(data));
  },
  onConnectionAlive: (callback) => {
    ipcRenderer.on('connection-alive', () => callback());
  },
  onStartupProgress: (callback) => {
    ipcRenderer.on('startup-progress', (_event, payload) => callback(payload));
  },
  getStartupState: () => ipcRenderer.invoke('startup-state')
});
