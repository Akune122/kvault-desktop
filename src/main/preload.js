const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kvault', {
  // Contrôles de fenêtre
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Configuration (.env + stockage local)
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (values) => ipcRenderer.invoke('config:save', values),

  // Infomaniak kDrive
  connectKDrive: () => ipcRenderer.invoke('kdrive:connect'),
  listFiles: (folderId) => ipcRenderer.invoke('kdrive:list', folderId),
  createFolder: (parentId, folderName) => ipcRenderer.invoke('kdrive:createFolder', { parentId, folderName }),
  pickAndUploadFiles: (parentId, onlyImages = false) =>
    ipcRenderer.invoke('kdrive:pickAndUploadFiles', { parentId, onlyImages }),
  pickAndUploadFolder: (parentId) => ipcRenderer.invoke('kdrive:pickAndUploadFolder', { parentId }),
  uploadDroppedPaths: (parentId, filePaths) =>
    ipcRenderer.invoke('kdrive:uploadDroppedPaths', { parentId, filePaths }),
  downloadFile: (fileId, fileName) => ipcRenderer.invoke('kdrive:download', { fileId, fileName }),
  previewImage: (fileId, mimeType) => ipcRenderer.invoke('kdrive:previewImage', { fileId, mimeType }),
  deleteItem: (fileId) => ipcRenderer.invoke('kdrive:delete', { fileId }),

  // Résolution des chemins locaux lors d'un Drag & Drop Windows (Electron 32+)
  getDroppedFilePath: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
    return file?.path || '';
  },

  // Événement de progression d'upload
  onUploadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('kdrive:uploadProgress', listener);
    return () => ipcRenderer.removeListener('kdrive:uploadProgress', listener);
  }
});
