const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photoWorld', {
  engineProcess: () => ipcRenderer.invoke('engine:process')
});
