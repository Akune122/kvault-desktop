const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('./config');
const { createKDriveClient, getRootFolderId, isConfigured } = require('../services/kdrive-manager');
const { BitwardenService } = require('../services/bitwarden-service');

let mainWindow = null;
let isAppUnlocked = false;
let clipboardClearTimer = null;
let bitwardenService = null;

function getBitwarden() {
  if (!bitwardenService) {
    bitwardenService = new BitwardenService(app);
  }
  return bitwardenService;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 980,
    minHeight: 660,
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
// IPC : Contrôles de fenêtre, Presse-papiers sécurisé & Utilitaires
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

ipcMain.handle('clipboard:copy', (_event, { text, autoClearMs = 0 }) => {
  const secret = String(text || '');
  clipboard.writeText(secret);

  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }

  if (autoClearMs > 0 && secret) {
    clipboardClearTimer = setTimeout(() => {
      try {
        if (clipboard.readText() === secret) {
          clipboard.clear();
        }
      } catch (_) {
        // Ignore
      }
    }, autoClearMs);
  }

  return { ok: true };
});

// ============================================================================
// IPC : Verrouillage par Code / Mot de passe de l'application (APP_LOCK_CODE)
// ============================================================================
ipcMain.handle('auth:getLockInfo', () => {
  const { config } = loadConfig(app);
  const currentCode = String(config.APP_LOCK_CODE || '0000');
  return {
    unlocked: isAppUnlocked,
    isDefaultCode: currentCode === '0000'
  };
});

ipcMain.handle('auth:unlockApp', (_event, inputCode) => {
  const { config } = loadConfig(app);
  const expected = String(config.APP_LOCK_CODE || '0000');
  const candidate = String(inputCode ?? '');

  if (candidate === expected) {
    isAppUnlocked = true;
    return { ok: true, isDefaultCode: expected === '0000' };
  }

  return { ok: false, error: 'Code ou mot de passe incorrect.' };
});

ipcMain.handle('auth:lockApp', () => {
  isAppUnlocked = false;
  const { config } = loadConfig(app);
  return {
    ok: true,
    isDefaultCode: String(config.APP_LOCK_CODE || '0000') === '0000'
  };
});

ipcMain.handle('auth:changeLockCode', (_event, { currentCode, newCode }) => {
  const { config } = loadConfig(app);
  const expected = String(config.APP_LOCK_CODE || '0000');

  if (String(currentCode ?? '') !== expected) {
    return { ok: false, error: 'Le code actuel saisi est incorrect.' };
  }

  const trimmedNew = String(newCode ?? '').trim();
  if (trimmedNew.length < 4) {
    return { ok: false, error: 'Le nouveau code/mot de passe doit contenir au moins 4 caractères.' };
  }

  saveConfig(app, { APP_LOCK_CODE: trimmedNew });
  return {
    ok: true,
    isDefaultCode: trimmedNew === '0000'
  };
});

// ============================================================================
// IPC : Configuration (.env & userData)
// ============================================================================
ipcMain.handle('config:get', () => {
  const { config, envPath } = loadConfig(app);
  const safeConfig = { ...config };
  delete safeConfig.APP_LOCK_CODE; // Ne jamais exposer le code de verrouillage en clair au front

  return {
    config: safeConfig,
    isDefaultLockCode: String(config.APP_LOCK_CODE || '0000') === '0000',
    envPath,
    configured: isConfigured(config),
    rootId: getRootFolderId(config),
    appVersion: app.getVersion()
  };
});

ipcMain.handle('config:save', (_event, newValues) => {
  const cleanValues = { ...(newValues || {}) };
  delete cleanValues.APP_LOCK_CODE; // Modifiable uniquement via auth:changeLockCode

  const updated = saveConfig(app, cleanValues);
  const safeUpdated = { ...updated };
  delete safeUpdated.APP_LOCK_CODE;

  return {
    config: safeUpdated,
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

// ============================================================================
// IPC : Coffre-fort Bitwarden / Vaultwarden (v0.2.0)
// ============================================================================
ipcMain.handle('bw:status', async () => {
  try {
    const status = await getBitwarden().getStatus();
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:loginAndUnlock', async (_event, payload) => {
  try {
    const { config } = loadConfig(app);
    const serverUrl = payload?.serverUrl || config.BITWARDEN_SERVER_URL || 'https://vault.bitwarden.eu';
    const clientId = payload?.clientId || config.BITWARDEN_CLIENT_ID || '';
    const clientSecret = payload?.clientSecret || config.BITWARDEN_CLIENT_SECRET || '';
    const email = payload?.email || config.BITWARDEN_EMAIL || '';

    // Sauvegarde serveur & email (et clés API si saisies) pour éviter de les retaper
    const toPersist = { BITWARDEN_SERVER_URL: serverUrl };
    if (email) toPersist.BITWARDEN_EMAIL = email;
    if (payload?.saveApiKeys && clientId && clientSecret) {
      toPersist.BITWARDEN_CLIENT_ID = clientId;
      toPersist.BITWARDEN_CLIENT_SECRET = clientSecret;
    }
    saveConfig(app, toPersist);

    const res = await getBitwarden().loginAndUnlock({
      authMode: payload?.authMode || 'apikey',
      serverUrl,
      clientId,
      clientSecret,
      email,
      masterPassword: payload?.masterPassword || '',
      twoFactorCode: payload?.twoFactorCode || ''
    });

    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:unlock', async (_event, { masterPassword }) => {
  try {
    const res = await getBitwarden().unlock(masterPassword);
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:listItems', async () => {
  try {
    const items = await getBitwarden().listItems();
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:sync', async () => {
  try {
    const res = await getBitwarden().syncVault();
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:getTotp', async (_event, { itemId }) => {
  try {
    const code = await getBitwarden().getTotpCode(itemId);
    return { ok: true, code };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:createLogin', async (_event, itemData) => {
  try {
    const created = await getBitwarden().createLoginItem(itemData);
    return { ok: true, item: created };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:deleteItem', async (_event, { itemId }) => {
  try {
    await getBitwarden().deleteVaultItem(itemId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:lock', async () => {
  try {
    const status = await getBitwarden().lockVault();
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:logout', async () => {
  try {
    const status = await getBitwarden().logoutVault();
    return { ok: true, status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bw:generatePassword', (_event, options) => {
  const password = getBitwarden().generatePassword(options);
  return { ok: true, password };
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
