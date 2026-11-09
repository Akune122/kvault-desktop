const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kvault', {
  // Contrôles de fenêtre, System Tray & Utilitaires
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  quitAppNow: () => ipcRenderer.invoke('app:quitNow'),
  setMediaPlaying: (playing) => ipcRenderer.invoke('media:setPlaying', playing),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyToClipboard: (text, autoClearMs = 0) =>
    ipcRenderer.invoke('clipboard:copy', { text, autoClearMs }),

  // Verrouillage de l'application (APP_LOCK_CODE — défaut 0000 + Auto-lock)
  getLockInfo: () => ipcRenderer.invoke('auth:getLockInfo'),
  unlockApp: (code) => ipcRenderer.invoke('auth:unlockApp', code),
  lockApp: () => ipcRenderer.invoke('auth:lockApp'),
  changeLockCode: (currentCode, newCode) =>
    ipcRenderer.invoke('auth:changeLockCode', { currentCode, newCode }),
  onAppLocked: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:locked', listener);
    return () => ipcRenderer.removeListener('app:locked', listener);
  },

  // Configuration (.env + stockage local)
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (values) => ipcRenderer.invoke('config:save', values),

  // Infomaniak kDrive (v0.1 -> v0.3)
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
  readTextFile: (fileId) => ipcRenderer.invoke('kdrive:readText', { fileId }),
  renameItem: (fileId, newName) => ipcRenderer.invoke('kdrive:rename', { fileId, newName }),
  moveItem: (fileId, destinationFolderId) => ipcRenderer.invoke('kdrive:move', { fileId, destinationFolderId }),
  createShareLink: (fileId) => ipcRenderer.invoke('kdrive:shareLink', { fileId }),
  revokeShareLink: (fileId) => ipcRenderer.invoke('kdrive:revokeShareLink', { fileId }),
  clearThumbCache: () => ipcRenderer.invoke('kdrive:clearThumbCache'),
  deleteItem: (fileId) => ipcRenderer.invoke('kdrive:delete', { fileId }),

  // Résolution des chemins locaux lors d'un Drag & Drop Windows (Electron 32+)
  getDroppedFilePath: (file) => {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file);
    }
    return file?.path || '';
  },

  onUploadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('kdrive:uploadProgress', listener);
    return () => ipcRenderer.removeListener('kdrive:uploadProgress', listener);
  },

  // Bitwarden / Vaultwarden (v0.2.0)
  bwStatus: () => ipcRenderer.invoke('bw:status'),
  bwLoginAndUnlock: (payload) => ipcRenderer.invoke('bw:loginAndUnlock', payload),
  bwUnlock: (masterPassword) => ipcRenderer.invoke('bw:unlock', { masterPassword }),
  bwListItems: () => ipcRenderer.invoke('bw:listItems'),
  bwSync: () => ipcRenderer.invoke('bw:sync'),
  bwGetTotp: (itemId) => ipcRenderer.invoke('bw:getTotp', { itemId }),
  bwCreateLogin: (itemData) => ipcRenderer.invoke('bw:createLogin', itemData),
  bwDeleteItem: (itemId) => ipcRenderer.invoke('bw:deleteItem', { itemId }),
  bwLock: () => ipcRenderer.invoke('bw:lock'),
  bwLogout: () => ipcRenderer.invoke('bw:logout'),
  bwGeneratePassword: (options) => ipcRenderer.invoke('bw:generatePassword', options)
});
