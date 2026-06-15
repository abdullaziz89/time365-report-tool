const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectExcel: () => ipcRenderer.invoke('select-excel'),
  selectOutput: () => ipcRenderer.invoke('select-output'),
  defaultOutput: () => ipcRenderer.invoke('default-output'),
  run: (params) => ipcRenderer.invoke('run', params),
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
  // Returns the absolute path of a dropped File (Electron 32 way).
  getPathForFile: (file) => webUtils.getPathForFile(file)
});
