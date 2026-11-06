const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config');
const { createKDriveClient, getRootFolderId, isConfigured } = require('../services/kdrive-manager');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#070B14',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function collectFilesFromFolder(localFolderPath) {
  const results = [];
  const entries = fs.readdirSync(localFolderPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(localFolderPath, entry.name);
    if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

// ============================================================================
// IPC : Contrôles de fenêtre & Utilitaires
// ============================================================================
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
  }
});

// ============================================================================
// IPC : Configuration (.env & userData)
// ============================================================================
ipcMain.handle('config:get', () => {
  const { config, envPath } = loadConfig(app);
  return {
    config,
    envPath,
    configured: isConfigured(config),
    rootId: getRootFolderId(config),
    appVersion: app.getVersion()
  };
});

ipcMain.handle('config:save', (_event, newValues) => {
  const updated = saveConfig(app, newValues);
  return {
    config: updated,
    configured: isConfigured(updated),
    rootId: getRootFolderId(updated)
  };
});

// ============================================================================
// IPC : Opérations Infomaniak kDrive
// ============================================================================
ipcMain.handle('kdrive:connect', async () => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const driveInfo = await client.testConnection();
    return {
      ok: true,
      driveInfo,
      rootId: getRootFolderId(config)
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:list', async (_event, folderId) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const targetFolder = folderId || getRootFolderId(config);
    const items = await client.listFiles(targetFolder);
    return { ok: true, items, folderId: targetFolder };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:createFolder', async (_event, { parentId, folderName }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const folder = await client.createFolder(parentId || getRootFolderId(config), folderName);
    return { ok: true, folder };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:pickAndUploadFiles', async (_event, { parentId, onlyImages = false }) => {
  try {
    const filters = onlyImages
      ? [{ name: 'Photos & Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'svg'] }]
      : [{ name: 'Tous les fichiers', extensions: ['*'] }];

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: onlyImages ? 'Sélectionner des photos à sauvegarder sur kDrive' : 'Sélectionner des fichiers à envoyer sur kDrive',
      properties: ['openFile', 'multiSelections'],
      filters
    });

    if (selection.canceled || !selection.filePaths.length) {
      return { ok: true, canceled: true, uploadedCount: 0 };
    }

    return await uploadBatchFiles(parentId, selection.filePaths);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:pickAndUploadFolder', async (_event, { parentId }) => {
  try {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner un dossier local à sauvegarder sur kDrive',
      properties: ['openDirectory']
    });

    if (selection.canceled || !selection.filePaths.length) {
      return { ok: true, canceled: true, uploadedCount: 0 };
    }

    const localFolder = selection.filePaths[0];
    const folderName = path.basename(localFolder);
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);

    // Crée le dossier correspondant sur kDrive puis envoie ses fichiers dedans
    const createdFolder = await client.createFolder(parentId || getRootFolderId(config), folderName);
    const targetFolderId = createdFolder.id || parentId;
    const filesInside = collectFilesFromFolder(localFolder);

    if (filesInside.length === 0) {
      return { ok: true, uploadedCount: 0, folderCreated: folderName };
    }

    const res = await uploadBatchFiles(targetFolderId, filesInside);
    return { ...res, folderCreated: folderName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:uploadDroppedPaths', async (_event, { parentId, filePaths }) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { ok: false, error: 'Aucun fichier valide détecté lors du glisser-déposer.' };
    }

    const validFiles = [];
    for (const p of filePaths) {
      if (p && fs.existsSync(p)) {
        const st = fs.statSync(p);
        if (st.isFile()) {
          validFiles.push(p);
        } else if (st.isDirectory()) {
          validFiles.push(...collectFilesFromFolder(p));
        }
      }
    }

    if (!validFiles.length) {
      return { ok: false, error: 'Aucun fichier lisible trouvé.' };
    }

    return await uploadBatchFiles(parentId, validFiles);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

async function uploadBatchFiles(parentId, filePaths) {
  const { config } = loadConfig(app);
  const client = createKDriveClient(config);
  const targetParent = parentId || getRootFolderId(config);

  let uploadedCount = 0;
  const totalFiles = filePaths.length;

  for (let i = 0; i < totalFiles; i++) {
    const filePath = filePaths[i];
    const fileName = path.basename(filePath);

    await client.uploadFile(targetParent, filePath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kdrive:uploadProgress', {
          fileIndex: i + 1,
          totalFiles,
          fileName,
          percent: progress.percent
        });
      }
    });

    uploadedCount++;
  }

  return { ok: true, uploadedCount, totalFiles };
}

ipcMain.handle('kdrive:download', async (_event, { fileId, fileName }) => {
  try {
    const saveChoice = await dialog.showSaveDialog(mainWindow, {
      title: 'Enregistrer le fichier sur cet ordinateur',
      defaultPath: fileName
    });

    if (saveChoice.canceled || !saveChoice.filePath) {
      return { ok: true, canceled: true };
    }

    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    await client.downloadFile(fileId, saveChoice.filePath);

    return { ok: true, savedPath: saveChoice.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:previewImage', async (_event, { fileId, mimeType }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const dataUrl = await client.getPreviewDataUrl(fileId, mimeType);
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:delete', async (_event, { fileId }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    await client.deleteItem(fileId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
