const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('cadweave', {
  request: (method, params = {}) => ipcRenderer.invoke('fixture:cad', method, params),
  local: (method, params = {}) => ipcRenderer.invoke('fixture:local', method, params),
  windowControl: () => {},
  exportFile: async () => ({ cancelled: true }),
})
