const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('writeeDesktop', {
  savePdf: (suggestedName) => ipcRenderer.invoke('writee:save-pdf', suggestedName),
})
