const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendBaseUrl: () => process.env.GOCLAW_BACKEND_URL || 'http://127.0.0.1:18800',
  getLauncherToken: () => process.env.GOCLAW_LAUNCHER_TOKEN || process.env.PICOCLAW_LAUNCHER_TOKEN || '',
  openOnboarding: () => ipcRenderer.send('open-onboarding'),
  completeOnboarding: () => ipcRenderer.send('complete-onboarding'),
  setOnboardingMode: (enabled) => ipcRenderer.send('set-onboarding-mode', Boolean(enabled)),
  setPetClickThrough: (enabled) => ipcRenderer.send('set-pet-click-through', Boolean(enabled)),
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
    const listener = (_event, settings) => callback(settings)
    ipcRenderer.on('settings-updated', listener)
    return () => ipcRenderer.removeListener('settings-updated', listener)
  },
  onChatHistoryUpdate: (callback) => {
    const listener = (_event, history) => callback(history)
    ipcRenderer.on('chat-history-updated', listener)
    return () => ipcRenderer.removeListener('chat-history-updated', listener)
  },
  onBubbleShow: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('bubble-show', listener)
    return () => ipcRenderer.removeListener('bubble-show', listener)
  },
  onConnectionAlive: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('connection-alive', listener)
    return () => ipcRenderer.removeListener('connection-alive', listener)
  },
  onForceStopMedia: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('force-stop-media', listener)
    return () => ipcRenderer.removeListener('force-stop-media', listener)
  }
});
