const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    ipcRenderer.on('settings-updated', (event, settings) => callback(settings));
  },
  onChatHistoryUpdate: (callback) => {
    ipcRenderer.on('chat-history-updated', (event, history) => callback(history));
  },
  onBubbleShow: (callback) => {
    ipcRenderer.on('bubble-show', (event, data) => callback(data));
  },
  onConnectionAlive: (callback) => {
    ipcRenderer.on('connection-alive', () => callback());
  }
});