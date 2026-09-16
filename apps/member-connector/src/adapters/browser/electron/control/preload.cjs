const { contextBridge, ipcRenderer } = require('electron')

// No generic IPC, URL, script, cookie, filesystem, or event objects cross this Interface.
contextBridge.exposeInMainWorld('gotgotganDesktop', Object.freeze({
  collect: () => ipcRenderer.invoke('gotgotgan-desktop:command', 'collect'),
  cancel: () => ipcRenderer.invoke('gotgotgan-desktop:command', 'cancel'),
}))
