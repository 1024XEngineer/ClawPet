const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  submitPrompt: (text) => ipcRenderer.send('file-prompt-submit', text || ''),
  cancelPrompt: () => ipcRenderer.send('file-prompt-cancel'),
})
