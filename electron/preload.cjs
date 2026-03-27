const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  isElectron: true,
  onBackendReady: (callback) => ipcRenderer.on('backend-ready', (_event, port) => callback(port)),
});
