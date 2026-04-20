const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Show native save dialog, return chosen path or null
  saveDialog: (defaultPath) => ipcRenderer.invoke('dialog:save', defaultPath),

  // Show native folder picker, return chosen path or null
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // Write binary data to file at path
  writeFile: (filePath, arrayBuffer) => ipcRenderer.invoke('fs:writeFile', filePath, arrayBuffer),
});
