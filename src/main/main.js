const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  protocol,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
  globalShortcut
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');
const { createKDriveClient, getRootFolderId, isConfigured } = require('../services/kdrive-manager');
const { BitwardenService } = require('../services/bitwarden-service');

// ============================================================================
// Protocole sécurisé de streaming local kDrive (v0.3.0+ : Vidéo, Audio, PDF, Miniatures)
// Doit impérativement être déclaré avant app.whenReady()
// ============================================================================
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kdrive-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hasShownTrayBalloon = false;
let isAppUnlocked = false;
let isMediaPlaying = false;
let autoLockTimer = null;
let clipboardClearTimer = null;
let bitwardenService = null;
let registeredShortcut = null;

// Verrou d'instance unique : si l'app est réduite dans le System Tray, relancer le .exe rouvre la fenêtre existante
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusMainWindow();
  });
}

function getBitwarden() {
  if (!bitwardenService) {
    bitwardenService = new BitwardenService(app);
  }
  return bitwardenService;
}

function showAndFocusMainWindow(bringToFrontPulse = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(false);
    return;
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (bringToFrontPulse) {
    try {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 280);
    } catch (_) {
      mainWindow.focus();
    }
  } else {
    mainWindow.focus();
  }
}

// ============================================================================
// v0.4.0 (Pack 3) : Gestionnaire local persistant des Favoris kDrive
// ============================================================================
function getFavoritesFilePath() {
  return path.join(app.getPath('userData'), 'kdrive-favorites.json');
}

function readFavoritesMap() {
  const favPath = getFavoritesFilePath();
  if (!fs.existsSync(favPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(favPath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeFavoritesMap(map) {
  const favPath = getFavoritesFilePath();
  fs.mkdirSync(path.dirname(favPath), { recursive: true });
  fs.writeFileSync(favPath, JSON.stringify(map, null, 2), 'utf8');
}

function getDriveFavoritesList(driveKey) {
  const all = readFavoritesMap();
  return Array.isArray(all[driveKey]) ? all[driveKey] : [];
}

function decorateItemsWithFavorites(items, driveKey) {
  const favList = getDriveFavoritesList(driveKey);
  const favIds = new Set(favList.map((f) => String(f.id)));
  return (items || []).map((it) => ({
    ...it,
    isFavorite: Boolean(it.isFavorite || favIds.has(String(it.id)))
  }));
}

// ============================================================================
// Cache disque & File d'attente de concurrence pour les miniatures Photos
// ============================================================================
const MAX_THUMB_CONCURRENCY = 4;
let activeThumbWorkers = 0;
const thumbWaitQueue = [];
const inflightThumbs = new Map();

function acquireThumbSlot() {
  if (activeThumbWorkers < MAX_THUMB_CONCURRENCY) {
    activeThumbWorkers++;
    return Promise.resolve();
  }
  return new Promise((resolve) => thumbWaitQueue.push(resolve));
}

function releaseThumbSlot() {
  const next = thumbWaitQueue.shift();
  if (next) {
    next();
  } else {
    activeThumbWorkers = Math.max(0, activeThumbWorkers - 1);
  }
}

function getThumbCacheDir() {
  const dir = path.join(app.getPath('userData'), 'thumb-cache');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function resolveCachedThumbnail({ config, fileId, mimeType, updatedAt, width, height }) {
  const cacheDir = getThumbCacheDir();
  const hash = crypto
    .createHash('sha1')
    .update(`${config.KDRIVE_CONNECTION_MODE}_${config.KDRIVE_ID}_${fileId}_${updatedAt}_${width}x${height}`)
    .digest('hex');

  const binPath = path.join(cacheDir, `${hash}.bin`);
  const metaPath = path.join(cacheDir, `${hash}.json`);

  if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const buffer = fs.readFileSync(binPath);
      if (buffer.length > 0) {
        return { buffer, contentType: meta.contentType || mimeType || 'image/jpeg' };
      }
    } catch (_) {
      // Cache corrompu : régénération transparente
    }
  }

  if (inflightThumbs.has(hash)) {
    return inflightThumbs.get(hash);
  }

  const job = (async () => {
    await acquireThumbSlot();
    try {
      const client = createKDriveClient(config);
      const result = await client.getThumbnailBuffer(fileId, width, height, mimeType);
      if (result?.buffer && result.buffer.length > 0 && result.buffer.length <= 4 * 1024 * 1024) {
        try {
          fs.writeFileSync(binPath, result.buffer);
          fs.writeFileSync(metaPath, JSON.stringify({ contentType: result.contentType || 'image/jpeg' }), 'utf8');
        } catch (_) {
          // Ignore erreur disque éventuelle
        }
      }
      return result;
    } finally {
      releaseThumbSlot();
      inflightThumbs.delete(hash);
    }
  })();

  inflightThumbs.set(hash, job);
  return job;
}

function registerKDriveMediaProtocol() {
  protocol.handle('kdrive-media', async (request) => {
    if (!isAppUnlocked) {
      return new Response('KVault Locked', { status: 403 });
    }

    try {
      const reqUrl = new URL(request.url);
      const route = reqUrl.pathname.replace(/^\/+/, '');
      const fileId = reqUrl.searchParams.get('id');
      const mimeParam = reqUrl.searchParams.get('mime') || '';

      if (!fileId) {
        return new Response('Missing file id', { status: 400 });
      }

      const { config } = loadConfig(app);

      if (route === 'thumb') {
        const width = Math.min(1800, Math.max(80, Number(reqUrl.searchParams.get('w')) || 380));
        const height = Math.min(1800, Math.max(80, Number(reqUrl.searchParams.get('h')) || 380));
        const updatedAt = reqUrl.searchParams.get('ts') || '0';

        const { buffer, contentType } = await resolveCachedThumbnail({
          config,
          fileId,
          mimeType: mimeParam || 'image/jpeg',
          updatedAt,
          width,
          height
        });

        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType || 'image/jpeg',
            'Content-Length': String(buffer.length),
            'Cache-Control': 'private, max-age=86400'
          }
        });
      }

      if (route === 'stream') {
        const client = createKDriveClient(config);
        const rangeHeader = request.headers.get('range') || null;
        const upstream = await client.streamFile(fileId, rangeHeader);

        const upstreamType = upstream.headers.get('content-type') || '';
        const resolvedMime =
          mimeParam && mimeParam !== 'application/octet-stream'
            ? mimeParam
            : upstreamType || 'application/octet-stream';

        const respHeaders = new Headers();
        respHeaders.set('Content-Type', resolvedMime);
        respHeaders.set('Content-Disposition', 'inline');
        respHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');

        const contentLen = upstream.headers.get('content-length');
        if (contentLen) respHeaders.set('Content-Length', contentLen);

        const contentRange = upstream.headers.get('content-range');
        if (contentRange) respHeaders.set('Content-Range', contentRange);

        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders
        });
      }

      return new Response('Unknown media route', { status: 404 });
    } catch (err) {
      return new Response(err.message || 'Media error', { status: 502 });
    }
  });
}

// ============================================================================
// Verrouillage global + Verrouillage automatique par inactivité
// ============================================================================
function performFullLock(reason = 'manual') {
  isAppUnlocked = false;
  isMediaPlaying = false;

  if (bitwardenService) {
    bitwardenService.lockVault().catch(() => {});
  }

  const { config } = loadConfig(app);
  const isDefaultCode = String(config.APP_LOCK_CODE || '0000') === '0000';

  updateTrayMenu();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:locked', {
      reason,
      isDefaultCode
    });
  }

  return { ok: true, isDefaultCode };
}

function startAutoLockWatcher() {
  if (autoLockTimer) clearInterval(autoLockTimer);

  autoLockTimer = setInterval(() => {
    if (!isAppUnlocked || isMediaPlaying) return;

    const { config } = loadConfig(app);
    const minutes = Number(config.AUTO_LOCK_MINUTES ?? 10);
    if (!minutes || minutes <= 0 || Number.isNaN(minutes)) return;

    try {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      if (idleSeconds >= minutes * 60) {
        performFullLock('inactivity');
      }
    } catch (_) {
      // Ignore
    }
  }, 10000);
}

// ============================================================================
// v0.4.0 (Pack 4) : Raccourci Clavier Global Quick-Vault & Démarrage Windows
// ============================================================================
function triggerQuickVaultFromSystem() {
  showAndFocusMainWindow(true);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:openQuickVault');
  }
}

function registerGlobalQuickVaultShortcut() {
  try {
    globalShortcut.unregisterAll();
    registeredShortcut = null;

    const { config } = loadConfig(app);
    const rawShortcut = String(config.GLOBAL_SHORTCUT ?? 'CommandOrControl+Shift+K').trim();
    if (!rawShortcut || rawShortcut.toLowerCase() === 'disabled' || rawShortcut.toLowerCase() === 'none') {
      return { ok: true, activeShortcut: null };
    }

    const ok = globalShortcut.register(rawShortcut, () => {
      triggerQuickVaultFromSystem();
    });

    if (ok) {
      registeredShortcut = rawShortcut;
    }
    return { ok, activeShortcut: registeredShortcut };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function applyWindowsStartupSetting() {
  if (process.platform !== 'win32') return;
  try {
    const { config } = loadConfig(app);
    const openAtLogin = String(config.LAUNCH_AT_STARTUP || 'false').toLowerCase() === 'true';
    app.setLoginItemSettings({
      openAtLogin,
      path: process.execPath,
      args: ['--hidden']
    });
  } catch (_) {
    // Ignore en environnement restreint
  }
}

// ============================================================================
// System Tray Windows (Zone de notification près de l'horloge)
// ============================================================================
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📂 Ouvrir KVault Desktop',
      click: () => showAndFocusMainWindow()
    },
    {
      label: '⚡ Quick-Vault Bitwarden (Ctrl+Maj+K)',
      click: () => triggerQuickVaultFromSystem()
    },
    {
      label: isAppUnlocked ? '🔒 Verrouiller maintenant' : '🔒 Application verrouillée',
      enabled: isAppUnlocked,
      click: () => performFullLock('tray')
    },
    { type: 'separator' },
    {
      label: '❌ Quitter complètement KVault',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function setupSystemTray() {
  if (tray) return;

  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    let trayIcon = nativeImage.createFromPath(iconPath);
    if (!trayIcon.isEmpty()) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('KVault Desktop — kDrive & Bitwarden');
    tray.on('click', () => showAndFocusMainWindow());
    tray.on('double-click', () => showAndFocusMainWindow());
    updateTrayMenu();
  } catch (_) {
    // Ignore si l'environnement ne supporte pas le System Tray
  }
}

function createMainWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 870,
    minWidth: 980,
    minHeight: 660,
    show: !startHidden,
    frame: false,
    backgroundColor: '#070B14',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    const { config } = loadConfig(app);
    const keepInTray = String(config.MINIMIZE_TO_TRAY ?? 'true').toLowerCase() !== 'false';

    if (keepInTray && tray) {
      event.preventDefault();
      isMediaPlaying = false;
      mainWindow.hide();

      if (!hasShownTrayBalloon && process.platform === 'win32' && typeof tray.displayBalloon === 'function') {
        hasShownTrayBalloon = true;
        try {
          tray.displayBalloon({
            iconType: 'info',
            title: 'KVault Desktop reste actif en arrière-plan',
            content: 'Astuce : appuyez sur Ctrl+Maj+K à tout moment pour ouvrir le Quick-Vault Bitwarden !'
          });
        } catch (_) {
          // Ignore
        }
      }
    }
  });

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

function compareSemver(vA, vB) {
  const cleanA = String(vA || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const cleanB = String(vB || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const a = cleanA[i] || 0;
    const b = cleanB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

// ============================================================================
// IPC : Contrôles de fenêtre, System Tray, Mises à jour GitHub & Utilitaires
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

ipcMain.handle('app:quitNow', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('media:setPlaying', (_event, playing) => {
  isMediaPlaying = Boolean(playing);
  return { ok: true };
});

ipcMain.handle('app:checkForUpdates', async () => {
  const currentVersion = app.getVersion();
  try {
    const res = await fetch('https://api.github.com/repos/Akune122/kvault-desktop/releases/latest', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'KVault-Desktop-App'
      }
    });

    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }

    const release = await res.json();
    const latestVersion = String(release.tag_name || currentVersion).replace(/^v/i, '');
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

    let exeAssetUrl = release.html_url;
    if (Array.isArray(release.assets)) {
      const exeAsset = release.assets.find((a) => String(a.name || '').endsWith('.exe'));
      if (exeAsset?.browser_download_url) {
        exeAssetUrl = exeAsset.browser_download_url;
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl: release.html_url || 'https://github.com/Akune122/kvault-desktop/releases',
      downloadUrl: exeAssetUrl || 'https://github.com/Akune122/kvault-desktop/releases'
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      error: err.message
    };
  }
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
    updateTrayMenu();
    return { ok: true, isDefaultCode: expected === '0000' };
  }

  return { ok: false, error: 'Code ou mot de passe incorrect.' };
});

ipcMain.handle('auth:lockApp', () => {
  return performFullLock('manual');
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
  delete safeConfig.APP_LOCK_CODE;

  return {
    config: safeConfig,
    isDefaultLockCode: String(config.APP_LOCK_CODE || '0000') === '0000',
    envPath,
    configured: isConfigured(config),
    rootId: getRootFolderId(config),
    appVersion: app.getVersion(),
    activeShortcut: registeredShortcut
  };
});

ipcMain.handle('config:save', (_event, newValues) => {
  const cleanValues = { ...(newValues || {}) };
  delete cleanValues.APP_LOCK_CODE;

  const updated = saveConfig(app, cleanValues);
  registerGlobalQuickVaultShortcut();
  applyWindowsStartupSetting();

  const safeUpdated = { ...updated };
  delete safeUpdated.APP_LOCK_CODE;

  return {
    config: safeUpdated,
    configured: isConfigured(updated),
    rootId: getRootFolderId(updated),
    activeShortcut: registeredShortcut
  };
});

// ============================================================================
// IPC : Opérations Infomaniak kDrive (v0.1 -> v0.4)
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
    const rawItems = await client.listFiles(targetFolder);
    const items = decorateItemsWithFavorites(rawItems, config.KDRIVE_ID || 'default');
    return { ok: true, items, folderId: targetFolder };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:search', async (_event, { query }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const rawItems = await client.searchFiles(query);
    const items = decorateItemsWithFavorites(rawItems, config.KDRIVE_ID || 'default');
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:getFavorites', () => {
  try {
    const { config } = loadConfig(app);
    const driveKey = config.KDRIVE_ID || 'default';
    const items = getDriveFavoritesList(driveKey).map((it) => ({ ...it, isFavorite: true }));
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:toggleFavorite', (_event, { item }) => {
  try {
    if (!item || !item.id) throw new Error('Élément invalide.');
    const { config } = loadConfig(app);
    const driveKey = config.KDRIVE_ID || 'default';
    const map = readFavoritesMap();
    const list = Array.isArray(map[driveKey]) ? map[driveKey] : [];
    const existingIdx = list.findIndex((f) => String(f.id) === String(item.id));

    let isFavorite = false;
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
      isFavorite = false;
    } else {
      list.unshift({
        id: String(item.id),
        parentId: item.parentId || '1',
        name: item.name,
        type: item.type,
        size: item.size || 0,
        mimeType: item.mimeType || 'application/octet-stream',
        updatedAt: item.updatedAt || Date.now(),
        hasThumbnail: Boolean(item.hasThumbnail),
        hasSharelink: Boolean(item.hasSharelink),
        isFavorite: true
      });
      isFavorite = true;
    }

    map[driveKey] = list;
    writeFavoritesMap(map);
    return { ok: true, isFavorite, items: list };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:listTrash', async () => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const items = await client.listTrash();
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:restoreTrash', async (_event, { fileIds }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    let restoredCount = 0;
    for (const id of ids) {
      await client.restoreTrashItem(id);
      restoredCount++;
    }
    return { ok: true, restoredCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:deleteTrashPermanently', async (_event, { fileIds }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    let deletedCount = 0;
    for (const id of ids) {
      await client.deleteTrashItemPermanently(id);
      deletedCount++;
    }
    return { ok: true, deletedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:emptyTrash', async () => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    await client.emptyTrash();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:batchDownload', async (_event, { items }) => {
  try {
    const filesToDownload = (Array.isArray(items) ? items : []).filter((it) => it && it.type === 'file');
    if (!filesToDownload.length) {
      return { ok: false, error: 'Sélectionnez au moins un fichier téléchargeable (les dossiers ne se téléchargent pas directement).' };
    }

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: `Choisir le dossier Windows où enregistrer les ${filesToDownload.length} fichier(s)`,
      properties: ['openDirectory', 'createDirectory']
    });

    if (selection.canceled || !selection.filePaths.length) {
      return { ok: true, canceled: true, downloadedCount: 0 };
    }

    const targetDir = selection.filePaths[0];
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    let downloadedCount = 0;

    for (const fileItem of filesToDownload) {
      const safeName = path.basename(fileItem.name || `file_${fileItem.id}`);
      const destPath = path.join(targetDir, safeName);
      await client.downloadFile(fileItem.id, destPath);
      downloadedCount++;
    }

    return { ok: true, downloadedCount, targetDir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:batchMove', async (_event, { fileIds, destinationFolderId }) => {
  try {
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const targetFolder = destinationFolderId || getRootFolderId(config);
    let movedCount = 0;

    for (const id of ids) {
      if (String(id) !== String(targetFolder)) {
        await client.moveItem(id, targetFolder);
        movedCount++;
      }
    }
    return { ok: true, movedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:batchDelete', async (_event, { fileIds }) => {
  try {
    const ids = Array.isArray(fileIds) ? fileIds : [fileIds];
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    let deletedCount = 0;

    for (const id of ids) {
      await client.deleteItem(id);
      deletedCount++;
    }
    return { ok: true, deletedCount };
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

ipcMain.handle('kdrive:readText', async (_event, { fileId }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const data = await client.readTextPreview(fileId);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:rename', async (_event, { fileId, newName }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const item = await client.renameItem(fileId, newName);
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:move', async (_event, { fileId, destinationFolderId }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    await client.moveItem(fileId, destinationFolderId || getRootFolderId(config));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:shareLink', async (_event, { fileId }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    const linkInfo = await client.createOrGetShareLink(fileId);
    return { ok: true, ...linkInfo };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:revokeShareLink', async (_event, { fileId }) => {
  try {
    const { config } = loadConfig(app);
    const client = createKDriveClient(config);
    await client.revokeShareLink(fileId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('kdrive:clearThumbCache', () => {
  try {
    const dir = getThumbCacheDir();
    const files = fs.readdirSync(dir);
    let removed = 0;
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
        removed++;
      } catch (_) {
        // Ignore
      }
    }
    return { ok: true, removed: Math.ceil(removed / 2) };
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
// IPC : Coffre-fort Bitwarden / Vaultwarden (v0.2.0+)
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

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.whenReady().then(() => {
  registerKDriveMediaProtocol();
  setupSystemTray();
  createMainWindow(process.argv.includes('--hidden'));
  startAutoLockWatcher();
  registerGlobalQuickVaultShortcut();
  applyWindowsStartupSetting();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(false);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
