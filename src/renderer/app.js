const state = {
  appUnlocked: false,
  currentView: 'kdrive',

  // kDrive
  connected: false,
  rootId: '1',
  currentFolderId: '1',
  breadcrumbs: [{ id: '1', name: 'Mon kDrive' }],
  items: [],
  activeCategory: 'all',
  searchQuery: '',
  viewMode: 'grid',

  // Actions contextuelles & Modales kDrive (v0.3.0)
  contextItem: null,
  pendingDeleteItem: null,
  pendingRenameItem: null,
  pendingMoveItem: null,
  moveStack: [],
  pendingShareItem: null,

  // Visionneuse multimédia universelle & Galerie (v0.3.0)
  previewItem: null,
  previewList: [],
  previewIndex: -1,
  previewTextContent: '',
  imageZoom: 1,

  // Bitwarden
  bwAuthMode: 'apikey',
  bwStatus: 'unauthenticated', // 'unauthenticated' | 'locked' | 'unlocked'
  bwItems: [],
  bwFilter: 'all',
  bwSearch: '',
  bwSelectedId: null,
  bwRevealPassword: false
};

// ============================================================================
// Helpers généraux & Détection des types multimédias
// ============================================================================
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

function formatDate(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch (_) {
    return '';
  }
}

function getFileExt(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getPreviewKind(item) {
  if (!item || item.type === 'dir') return null;
  const mime = (item.mimeType || '').toLowerCase();
  const ext = getFileExt(item.name);

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(ext)) {
    return 'audio';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    mime.startsWith('text/') ||
    ['txt', 'md', 'json', 'csv', 'log', 'xml', 'yml', 'yaml', 'js', 'ts', 'py', 'html', 'css', 'sql', 'ini', 'conf', 'sh', 'ps1', 'bat'].includes(ext)
  ) {
    return 'text';
  }
  return null;
}

function getFileCategory(item) {
  if (item.type === 'dir') return 'dir';
  const kind = getPreviewKind(item);
  if (kind === 'image') return 'images';
  if (kind === 'video' || kind === 'audio') return 'media';
  if (kind === 'pdf' || kind === 'text') return 'docs';

  const mime = (item.mimeType || '').toLowerCase();
  const ext = getFileExt(item.name);
  if (
    mime.includes('word') ||
    mime.includes('sheet') ||
    mime.includes('excel') ||
    mime.includes('presentation') ||
    ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods'].includes(ext)
  ) {
    return 'docs';
  }
  return 'other';
}

function getFileEmoji(item) {
  if (item.type === 'dir') return '📁';
  const kind = getPreviewKind(item);
  if (kind === 'image') return '🖼️';
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  if (kind === 'pdf') return '📕';
  if (kind === 'text') return '📝';
  if (getFileCategory(item) === 'docs') return '📄';
  const ext = getFileExt(item.name);
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  return '📦';
}

function buildThumbUrl(item, w = 380, h = 380) {
  const params = new URLSearchParams({
    id: String(item.id),
    mime: String(item.mimeType || 'image/jpeg'),
    ts: String(item.updatedAt || 0),
    w: String(w),
    h: String(h)
  });
  return `kdrive-media://local/thumb?${params.toString()}`;
}

function buildStreamUrl(item) {
  const params = new URLSearchParams({
    id: String(item.id),
    mime: String(item.mimeType || 'application/octet-stream'),
    name: String(item.name || 'file')
  });
  return `kdrive-media://local/stream?${params.toString()}`;
}

function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function hideAllFloatingModals() {
  hideContextMenu();
  closeUniversalPreview();
  ['folderModal', 'renameModal', 'moveModal', 'shareModal', 'deleteModal', 'newBwItemModal', 'generatorModal'].forEach(
    (id) => document.getElementById(id)?.classList.add('hidden')
  );
}

// ============================================================================
// Verrouillage de l'application (APP_LOCK_CODE + Auto-Lock Windows)
// ============================================================================
function applyLockScreenUI(unlocked, isDefaultCode, reason = '') {
  state.appUnlocked = unlocked;
  document.getElementById('appLockOverlay').classList.toggle('hidden', unlocked);
  document.getElementById('btnLockAppTop').classList.toggle('hidden', !unlocked);
  document.getElementById('defaultCodeHint').classList.toggle('hidden', !isDefaultCode);

  const subEl = document.getElementById('lockSubtitleText');
  if (subEl) {
    subEl.textContent =
      reason === 'inactivity'
        ? 'Session verrouillée automatiquement après une période d\'inactivité Windows.'
        : 'Entrez votre code d\'accès ou mot de passe pour déverrouiller vos espaces.';
  }

  const pill = document.getElementById('lockCodeStatusPill');
  if (pill) {
    pill.textContent = isDefaultCode ? 'Par défaut (0000)' : 'Personnalisé ✓';
    pill.classList.toggle('custom', !isDefaultCode);
  }

  if (!unlocked) {
    hideAllFloatingModals();
    state.bwItems = [];
    state.bwSelectedId = null;
    if (state.bwStatus === 'unlocked') {
      showBwPanelForStatus({ status: 'locked' });
    }
    const inp = document.getElementById('appUnlockInput');
    inp.value = '';
    setTimeout(() => inp.focus(), 60);
  }
}

async function checkInitialAppLock() {
  const info = await window.kvault.getLockInfo();
  applyLockScreenUI(info.unlocked, info.isDefaultCode);
  if (info.unlocked) {
    await startWorkspace();
  }
}

async function startWorkspace() {
  await initConnectionAndLoad();
  await refreshBitwardenStatus(false);
}

// ============================================================================
// Navigation entre les vues (kDrive / Bitwarden / Paramètres)
// ============================================================================
function switchView(viewName) {
  state.currentView = viewName;
  hideContextMenu();
  document.getElementById('viewKdrive').classList.toggle('hidden', viewName !== 'kdrive');
  document.getElementById('viewBitwarden').classList.toggle('hidden', viewName !== 'bitwarden');
  document.getElementById('viewSettings').classList.toggle('hidden', viewName !== 'settings');

  document.querySelectorAll('.nav-item').forEach((btn) => {
    const matchesView = btn.dataset.view === viewName;
    if (viewName === 'kdrive') {
      btn.classList.toggle('active', matchesView && btn.dataset.filter === state.activeCategory);
    } else {
      btn.classList.toggle('active', matchesView);
    }
  });

  if (viewName === 'bitwarden') {
    refreshBitwardenStatus(false);
  }
}

// ============================================================================
// Chargement Config & Connexion kDrive
// ============================================================================
async function populateSettingsForm() {
  const res = await window.kvault.getConfig();
  document.getElementById('versionPill').textContent = `v${res.appVersion || '0.3.0'}`;
  document.getElementById('envPathDisplay').textContent = res.envPath || '.env';

  const pill = document.getElementById('lockCodeStatusPill');
  if (pill) {
    pill.textContent = res.isDefaultLockCode ? 'Par défaut (0000)' : 'Personnalisé ✓';
    pill.classList.toggle('custom', !res.isDefaultLockCode);
  }

  const cfg = res.config || {};

  // Intégration Windows Pro (v0.3.0)
  const autoLockVal = String(cfg.AUTO_LOCK_MINUTES ?? '10');
  const autoSelect = document.getElementById('inputAutoLockMinutes');
  if ([...autoSelect.options].some((o) => o.value === autoLockVal)) {
    autoSelect.value = autoLockVal;
  } else {
    autoSelect.value = '10';
  }
  document.getElementById('inputMinimizeToTray').checked =
    String(cfg.MINIMIZE_TO_TRAY ?? 'true').toLowerCase() !== 'false';

  // Connexion kDrive
  const modeSelect = document.getElementById('inputMode');
  modeSelect.value = cfg.KDRIVE_CONNECTION_MODE || 'api';
  document.getElementById('inputDriveId').value = cfg.KDRIVE_ID || '';
  document.getElementById('inputApiToken').value = cfg.KDRIVE_API_TOKEN || '';
  document.getElementById('inputEmail').value = cfg.KDRIVE_EMAIL || '';
  document.getElementById('inputAppPassword').value = cfg.KDRIVE_APP_PASSWORD || '';

  // Champs Bitwarden
  const bwServer = cfg.BITWARDEN_SERVER_URL || 'https://vault.bitwarden.eu';
  document.getElementById('inputBwServer').value = bwServer;
  document.getElementById('inputBwEmail').value = cfg.BITWARDEN_EMAIL || '';
  document.getElementById('inputBwClientId').value = cfg.BITWARDEN_CLIENT_ID || '';
  document.getElementById('inputBwClientSecret').value = cfg.BITWARDEN_CLIENT_SECRET || '';

  const serverSel = document.getElementById('bwServerSelect');
  if (bwServer === 'https://vault.bitwarden.eu' || bwServer === 'https://vault.bitwarden.com') {
    serverSel.value = bwServer;
    document.getElementById('bwCustomServerRow').classList.add('hidden');
  } else {
    serverSel.value = 'custom';
    document.getElementById('bwCustomServerInput').value = bwServer;
    document.getElementById('bwCustomServerRow').classList.remove('hidden');
  }

  if (cfg.BITWARDEN_CLIENT_ID) document.getElementById('bwClientIdInput').value = cfg.BITWARDEN_CLIENT_ID;
  if (cfg.BITWARDEN_CLIENT_SECRET) document.getElementById('bwClientSecretInput').value = cfg.BITWARDEN_CLIENT_SECRET;
  if (cfg.BITWARDEN_EMAIL) document.getElementById('bwEmailInput').value = cfg.BITWARDEN_EMAIL;

  toggleModeInputs(modeSelect.value);
  return res;
}

function toggleModeInputs(mode) {
  const isWebdav = mode === 'webdav';
  document.getElementById('apiFieldsGroup').classList.toggle('hidden', isWebdav);
  document.getElementById('webdavFieldsGroup').classList.toggle('hidden', !isWebdav);
}

function updateConnectionStatus(connected, labelText) {
  state.connected = connected;
  const badge = document.getElementById('connectionBadge');
  badge.classList.toggle('connected', connected);
  badge.classList.toggle('disconnected', !connected);
  document.getElementById('connectionText').textContent = `kDrive : ${labelText}`;
}

function updateBwTopBadge(statusText, unlocked) {
  const badge = document.getElementById('bwTopBadge');
  badge.classList.toggle('connected', unlocked);
  badge.classList.toggle('disconnected', !unlocked);
  document.getElementById('bwTopText').textContent = `Bitwarden : ${statusText}`;
  document.getElementById('bwSidebarBadge').textContent = unlocked ? 'Ouvert' : 'Fermé';
}

function updateQuotaCard(driveInfo) {
  const nameEl = document.getElementById('driveNameLabel');
  const pctEl = document.getElementById('quotaPercentLabel');
  const fillEl = document.getElementById('quotaBarFill');
  const subEl = document.getElementById('quotaDetailLabel');

  if (!driveInfo) {
    nameEl.textContent = 'Espace kDrive';
    pctEl.textContent = '—';
    fillEl.style.width = '0%';
    subEl.textContent = 'Non connecté';
    return;
  }

  nameEl.textContent = driveInfo.name || `kDrive #${driveInfo.id}`;
  if (typeof driveInfo.usedSize === 'number' && typeof driveInfo.totalSize === 'number' && driveInfo.totalSize > 0) {
    const pct = Math.min(100, Math.round((driveInfo.usedSize / driveInfo.totalSize) * 100));
    pctEl.textContent = `${pct}%`;
    fillEl.style.width = `${pct}%`;
    subEl.textContent = `${formatBytes(driveInfo.usedSize)} utilisés sur ${formatBytes(driveInfo.totalSize)}`;
  } else {
    pctEl.textContent = 'Actif';
    fillEl.style.width = '100%';
    subEl.textContent = `Connecté (${driveInfo.mode === 'webdav' ? 'WebDAV' : 'API Infomaniak'})`;
  }
}

async function initConnectionAndLoad() {
  const cfgState = await populateSettingsForm();

  if (!cfgState.configured) {
    updateConnectionStatus(false, 'Non configuré');
    document.getElementById('onboardingCard').classList.remove('hidden');
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('filesContainer').innerHTML = '';
    return;
  }

  document.getElementById('onboardingCard').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('loadingState').classList.remove('hidden');

  const conn = await window.kvault.connectKDrive();
  if (!conn.ok) {
    document.getElementById('loadingState').classList.add('hidden');
    updateConnectionStatus(false, 'Erreur');
    showErrorBanner(conn.error);
    return;
  }

  state.rootId = conn.rootId;
  state.currentFolderId = conn.rootId;
  state.breadcrumbs = [{ id: conn.rootId, name: conn.driveInfo?.name || 'Mon kDrive' }];

  updateConnectionStatus(true, conn.driveInfo?.name || 'Connecté');
  updateQuotaCard(conn.driveInfo);

  await loadFolder(state.rootId);
}

function showErrorBanner(msg) {
  document.getElementById('errorMessageText').textContent = msg || 'Erreur inconnue.';
  document.getElementById('errorState').classList.remove('hidden');
}

async function loadFolder(folderId) {
  hideContextMenu();
  document.getElementById('onboardingCard').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('filesContainer').innerHTML = '';
  document.getElementById('loadingState').classList.remove('hidden');

  const res = await window.kvault.listFiles(folderId);
  document.getElementById('loadingState').classList.add('hidden');

  if (!res.ok) {
    showErrorBanner(res.error);
    return;
  }

  state.currentFolderId = res.folderId;
  state.items = res.items || [];
  renderBreadcrumbs();
  renderFiles();
}

function renderBreadcrumbs() {
  const container = document.getElementById('breadcrumbs');
  container.innerHTML = '';

  state.breadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      container.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.className = `crumb-btn${idx === state.breadcrumbs.length - 1 ? ' current' : ''}`;
    btn.textContent = idx === 0 ? `🏠 ${crumb.name}` : crumb.name;
    btn.addEventListener('click', () => {
      if (idx < state.breadcrumbs.length - 1) {
        state.breadcrumbs = state.breadcrumbs.slice(0, idx + 1);
        loadFolder(crumb.id);
      }
    });
    container.appendChild(btn);
  });

  document.getElementById('btnBack').disabled = state.breadcrumbs.length <= 1;
}

function getVisibleFilteredItems() {
  const query = state.searchQuery.trim().toLowerCase();
  return state.items.filter((item) => {
    if (query && !item.name.toLowerCase().includes(query)) return false;
    if (state.activeCategory !== 'all') {
      if (item.type === 'dir') return true;
      return getFileCategory(item) === state.activeCategory;
    }
    return true;
  });
}

// ============================================================================
// Affichage Grille & Liste avec Miniatures Photos Réelles (Pack 1)
// ============================================================================
function renderFiles() {
  const container = document.getElementById('filesContainer');
  container.innerHTML = '';

  const filtered = getVisibleFilteredItems();
  if (filtered.length === 0) {
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  document.getElementById('emptyState').classList.add('hidden');

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = 'file-card';

    const iconBox = document.createElement('div');
    iconBox.className = 'file-icon-box';

    const fallbackEmoji = document.createElement('span');
    fallbackEmoji.className = 'file-emoji-fallback';
    fallbackEmoji.textContent = getFileEmoji(item);
    iconBox.appendChild(fallbackEmoji);

    const previewKind = getPreviewKind(item);
    const shouldLoadThumb = item.type === 'file' && (previewKind === 'image' || item.hasThumbnail);

    if (shouldLoadThumb) {
      const thumbImg = document.createElement('img');
      thumbImg.className = 'file-thumb-img';
      thumbImg.loading = 'lazy';
      thumbImg.alt = item.name;
      thumbImg.src = buildThumbUrl(item, 380, 380);
      thumbImg.addEventListener('load', () => {
        thumbImg.classList.add('loaded');
        fallbackEmoji.style.display = 'none';
      });
      thumbImg.addEventListener('error', () => {
        thumbImg.remove();
      });
      iconBox.appendChild(thumbImg);

      if (previewKind === 'video') {
        const playBadge = document.createElement('span');
        playBadge.className = 'thumb-play-badge';
        playBadge.textContent = '▶';
        iconBox.appendChild(playBadge);
      }
    }

    if (item.hasSharelink) {
      const linkBadge = document.createElement('span');
      linkBadge.className = 'share-link-badge';
      linkBadge.title = 'Lien de partage public actif';
      linkBadge.textContent = '🔗';
      iconBox.appendChild(linkBadge);
    }

    const meta = document.createElement('div');
    meta.className = 'file-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.title = item.name;
    nameEl.textContent = item.name;

    const subEl = document.createElement('div');
    subEl.className = 'file-sub';
    subEl.textContent = item.type === 'dir'
      ? `Dossier • ${formatDate(item.updatedAt)}`
      : `${formatBytes(item.size)} • ${formatDate(item.updatedAt)}`;

    meta.appendChild(nameEl);
    meta.appendChild(subEl);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    if (item.type === 'dir') {
      const openBtn = document.createElement('button');
      openBtn.className = 'mini-btn';
      openBtn.textContent = 'Ouvrir';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enterFolder(item);
      });
      actions.appendChild(openBtn);
    } else if (previewKind) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'mini-btn';
      viewBtn.textContent = previewKind === 'video' || previewKind === 'audio' ? '▶ Lire' : '👁 Aperçu';
      viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openUniversalPreview(item);
      });
      actions.appendChild(viewBtn);
    } else {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'mini-btn';
      dlBtn.textContent = '⬇ Sauver';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDownload(item);
      });
      actions.appendChild(dlBtn);
    }

    const shareBtn = document.createElement('button');
    shareBtn.className = 'mini-btn icon-only';
    shareBtn.title = 'Lien de partage public kDrive';
    shareBtn.textContent = '🔗';
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openShareModal(item);
    });
    actions.appendChild(shareBtn);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'mini-btn icon-only';
    moreBtn.title = 'Plus d\'actions (Renommer, Déplacer, Supprimer...)';
    moreBtn.textContent = '⋯';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = moreBtn.getBoundingClientRect();
      openFileContextMenu(rect.left, rect.bottom + 4, item);
    });
    actions.appendChild(moreBtn);

    card.appendChild(iconBox);
    card.appendChild(meta);
    card.appendChild(actions);

    card.addEventListener('dblclick', () => openItemDefaultAction(item));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFileContextMenu(e.clientX, e.clientY, item);
    });

    container.appendChild(card);
  }
}

function openItemDefaultAction(item) {
  if (!item) return;
  if (item.type === 'dir') {
    enterFolder(item);
  } else if (getPreviewKind(item)) {
    openUniversalPreview(item);
  } else {
    handleDownload(item);
  }
}

function enterFolder(folderItem) {
  state.breadcrumbs.push({ id: folderItem.id, name: folderItem.name });
  loadFolder(folderItem.id);
}

// ============================================================================
// Menu Contextuel Clic-Droit + Renommer + Déplacer + Lien Public (Pack 4)
// ============================================================================
function openFileContextMenu(x, y, item) {
  state.contextItem = item;
  const menu = document.getElementById('fileContextMenu');
  document.getElementById('ctxDownload').classList.toggle('hidden', item.type === 'dir');
  document.getElementById('ctxOpen').textContent =
    item.type === 'dir' ? '📂 Ouvrir le dossier' : getPreviewKind(item) ? '👁 Ouvrir l\'aperçu' : '⬇️ Télécharger';

  menu.classList.remove('hidden');
  const menuWidth = 230;
  const menuHeight = 250;
  const posX = Math.max(10, Math.min(x, window.innerWidth - menuWidth));
  const posY = Math.max(48, Math.min(y, window.innerHeight - menuHeight));
  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function hideContextMenu() {
  document.getElementById('fileContextMenu')?.classList.add('hidden');
}

function openRenameModal(item) {
  state.pendingRenameItem = item;
  const modal = document.getElementById('renameModal');
  const inp = document.getElementById('renameInput');
  document.getElementById('renameModalSub').textContent = `Renommer "${item.name}" sur votre kDrive :`;
  inp.value = item.name;
  modal.classList.remove('hidden');
  inp.focus();

  const dotIdx = item.type === 'file' ? item.name.lastIndexOf('.') : -1;
  if (dotIdx > 0) {
    inp.setSelectionRange(0, dotIdx);
  } else {
    inp.select();
  }
}

async function openMoveModal(item) {
  state.pendingMoveItem = item;
  const rootCrumbName = state.breadcrumbs[0]?.name || 'Mon kDrive';
  state.moveStack = [{ id: state.rootId, name: rootCrumbName }];

  document.getElementById('moveModalSub').textContent = `Choisissez où déplacer "${item.name}" :`;
  document.getElementById('moveModal').classList.remove('hidden');
  await refreshMoveModalFolders();
}

async function refreshMoveModalFolders() {
  const listEl = document.getElementById('moveFolderList');
  const current = state.moveStack[state.moveStack.length - 1];
  document.getElementById('moveCurrentPathLabel').textContent =
    state.moveStack.map((s, idx) => (idx === 0 ? `🏠 ${s.name}` : s.name)).join(' › ');
  document.getElementById('btnMoveBack').disabled = state.moveStack.length <= 1;

  listEl.innerHTML = '<div class="state-box" style="padding:24px"><div class="spinner"></div></div>';
  const res = await window.kvault.listFiles(current.id);

  if (!res.ok) {
    listEl.innerHTML = `<div class="state-box" style="padding:20px"><p>${res.error}</p></div>`;
    return;
  }

  const folders = (res.items || []).filter(
    (it) => it.type === 'dir' && String(it.id) !== String(state.pendingMoveItem?.id)
  );

  listEl.innerHTML = '';
  if (folders.length === 0) {
    listEl.innerHTML = '<div class="state-box" style="padding:28px"><p>Aucun sous-dossier ici. Cliquez sur "Déplacer ici" pour valider cet emplacement.</p></div>';
    return;
  }

  for (const dir of folders) {
    const row = document.createElement('div');
    row.className = 'move-folder-row';
    row.innerHTML = `<span>📁 ${dir.name}</span><span class="hint">Ouvrir ›</span>`;
    row.addEventListener('click', () => {
      state.moveStack.push({ id: dir.id, name: dir.name });
      refreshMoveModalFolders();
    });
    listEl.appendChild(row);
  }
}

async function openShareModal(item) {
  state.pendingShareItem = item;
  showToast('🔗 Récupération du lien public kDrive...');
  const res = await window.kvault.createShareLink(item.id);
  if (!res.ok) {
    showToast(res.error, true);
    return;
  }

  item.hasSharelink = true;
  renderFiles();

  const urlInput = document.getElementById('shareUrlInput');
  urlInput.value = res.url;
  document.getElementById('shareModalSub').textContent = `Lien public pour "${item.name}" :`;
  document.getElementById('shareModal').classList.remove('hidden');

  await window.kvault.copyToClipboard(res.url, 0);
  showToast('🔗 Lien public copié dans le presse-papiers !');
}

// ============================================================================
// Visionneuse Multimédia Universelle & Galerie (Pack 1)
// ============================================================================
let previewRenderToken = 0;

function stopActiveMediaPreview() {
  previewRenderToken++;

  const imgStage = document.getElementById('previewImageStage');
  const videoEl = document.getElementById('previewVideoEl');
  const audioCard = document.getElementById('previewAudioCard');
  const audioEl = document.getElementById('previewAudioEl');
  const pdfEl = document.getElementById('previewPdfFrame');
  const codeBox = document.getElementById('previewCodeBox');
  const imgEl = document.getElementById('previewImageEl');

  if (imgEl) {
    imgEl.onload = null;
    imgEl.onerror = null;
    imgEl.removeAttribute('src');
    imgEl.style.transform = 'scale(1)';
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  }
  if (pdfEl) {
    pdfEl.src = 'about:blank';
  }
  if (codeBox) {
    codeBox.textContent = '';
  }

  [imgStage, videoEl, audioCard, pdfEl, codeBox].forEach((el) => el?.classList.add('hidden'));

  window.kvault.setMediaPlaying(false);
}

function closeUniversalPreview() {
  stopActiveMediaPreview();
  state.previewItem = null;
  state.previewTextContent = '';
  document.getElementById('previewModal')?.classList.add('hidden');
}

function applyImageZoom(newZoom) {
  state.imageZoom = Math.min(4, Math.max(0.4, Math.round(newZoom * 100) / 100));
  const imgEl = document.getElementById('previewImageEl');
  const lbl = document.getElementById('btnZoomReset');
  if (imgEl) imgEl.style.transform = `scale(${state.imageZoom})`;
  if (lbl) lbl.textContent = `${Math.round(state.imageZoom * 100)}%`;
}

async function openUniversalPreview(item) {
  const kind = getPreviewKind(item);
  if (!kind) {
    handleDownload(item);
    return;
  }

  const candidates = getVisibleFilteredItems().filter((it) => it.type === 'file' && getPreviewKind(it) !== null);
  state.previewList = candidates.length ? candidates : [item];
  state.previewIndex = Math.max(
    0,
    state.previewList.findIndex((it) => String(it.id) === String(item.id))
  );

  await renderPreviewAtCurrentIndex();
}

async function navigatePreview(delta) {
  if (!state.previewList.length) return;
  const nextIdx = state.previewIndex + delta;
  if (nextIdx < 0 || nextIdx >= state.previewList.length) return;
  state.previewIndex = nextIdx;
  await renderPreviewAtCurrentIndex();
}

async function renderPreviewAtCurrentIndex() {
  const item = state.previewList[state.previewIndex];
  if (!item) return;

  stopActiveMediaPreview();
  const currentToken = previewRenderToken;

  state.previewItem = item;
  state.previewTextContent = '';
  state.imageZoom = 1;

  const kind = getPreviewKind(item);
  const modal = document.getElementById('previewModal');
  const spinner = document.getElementById('previewSpinner');
  const imgStage = document.getElementById('previewImageStage');
  const imgEl = document.getElementById('previewImageEl');
  const videoEl = document.getElementById('previewVideoEl');
  const audioCard = document.getElementById('previewAudioCard');
  const audioEl = document.getElementById('previewAudioEl');
  const pdfFrame = document.getElementById('previewPdfFrame');
  const codeBox = document.getElementById('previewCodeBox');

  document.getElementById('previewTitle').textContent = item.name;
  document.getElementById('previewCounter').textContent = `${state.previewIndex + 1} / ${state.previewList.length}`;
  document.getElementById('btnPrevPreview').disabled = state.previewIndex <= 0;
  document.getElementById('btnNextPreview').disabled = state.previewIndex >= state.previewList.length - 1;

  document.getElementById('previewZoomBar').classList.toggle('hidden', kind !== 'image');
  document.getElementById('btnCopyPreviewText').classList.add('hidden');
  applyImageZoom(1);

  [imgStage, videoEl, audioCard, pdfFrame, codeBox].forEach((el) => el.classList.add('hidden'));
  spinner.classList.remove('hidden');
  modal.classList.remove('hidden');

  const ext = getFileExt(item.name);

  if (kind === 'image') {
    const primaryUrl = ext === 'heic' ? buildThumbUrl(item, 1600, 1600) : buildStreamUrl(item);
    imgEl.onload = () => {
      if (currentToken !== previewRenderToken) return;
      spinner.classList.add('hidden');
      imgStage.classList.remove('hidden');
    };
    imgEl.onerror = () => {
      if (currentToken !== previewRenderToken) return;
      const fallbackUrl = buildThumbUrl(item, 1600, 1600);
      if (imgEl.src !== fallbackUrl) {
        imgEl.src = fallbackUrl;
      } else {
        spinner.classList.add('hidden');
        showToast('Impossible d\'afficher cet aperçu image.', true);
      }
    };
    imgEl.src = primaryUrl;
    return;
  }

  if (kind === 'video') {
    spinner.classList.add('hidden');
    videoEl.src = buildStreamUrl(item);
    videoEl.classList.remove('hidden');
    videoEl.play().catch(() => {});
    return;
  }

  if (kind === 'audio') {
    spinner.classList.add('hidden');
    document.getElementById('previewAudioTitle').textContent = item.name;
    audioEl.src = buildStreamUrl(item);
    audioCard.classList.remove('hidden');
    audioEl.play().catch(() => {});
    return;
  }

  if (kind === 'pdf') {
    spinner.classList.add('hidden');
    pdfFrame.src = buildStreamUrl({ ...item, mimeType: 'application/pdf' });
    pdfFrame.classList.remove('hidden');
    return;
  }

  if (kind === 'text') {
    const res = await window.kvault.readTextFile(item.id);
    if (currentToken !== previewRenderToken) return;
    spinner.classList.add('hidden');
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    let formatted = res.text || '';
    if (ext === 'json') {
      try {
        formatted = JSON.stringify(JSON.parse(formatted), null, 2);
      } catch (_) {
        // Garde le texte brut
      }
    }
    state.previewTextContent = formatted;
    codeBox.textContent = res.truncated ? `${formatted}\n\n--- [Aperçu tronqué à 512 Ko] ---` : formatted;
    codeBox.classList.remove('hidden');
    document.getElementById('btnCopyPreviewText').classList.remove('hidden');
  }
}

// ============================================================================
// Uploads, Téléchargement & Suppression kDrive
// ============================================================================
async function handleUploadFiles(onlyImages = false) {
  if (!state.connected) {
    showToast('Connectez d\'abord votre compte kDrive dans Paramètres.', true);
    switchView('settings');
    return;
  }

  const res = await window.kvault.pickAndUploadFiles(state.currentFolderId, onlyImages);
  document.getElementById('uploadToast').classList.add('hidden');

  if (!res.ok) {
    showToast(res.error, true);
    return;
  }
  if (!res.canceled && res.uploadedCount > 0) {
    showToast(`✅ ${res.uploadedCount} fichier(s) sauvegardé(s) sur kDrive !`);
    await loadFolder(state.currentFolderId);
  }
}

async function handleUploadFolder() {
  if (!state.connected) {
    showToast('Connectez d\'abord votre compte kDrive dans Paramètres.', true);
    switchView('settings');
    return;
  }

  const res = await window.kvault.pickAndUploadFolder(state.currentFolderId);
  document.getElementById('uploadToast').classList.add('hidden');

  if (!res.ok) {
    showToast(res.error, true);
    return;
  }
  if (!res.canceled) {
    showToast(`✅ Dossier "${res.folderCreated}" sauvegardé (${res.uploadedCount} fichier(s)) !`);
    await loadFolder(state.currentFolderId);
  }
}

async function handleDownload(item) {
  const res = await window.kvault.downloadFile(item.id, item.name);
  if (!res.ok) {
    showToast(res.error, true);
    return;
  }
  if (!res.canceled) {
    showToast(`✅ Enregistré sous : ${res.savedPath}`);
  }
}

function askDeleteItem(item) {
  state.pendingDeleteItem = item;
  document.getElementById('deleteModalText').textContent =
    `Voulez-vous déplacer "${item.name}" vers la corbeille de votre kDrive ?`;
  document.getElementById('deleteModal').classList.remove('hidden');
}

// ============================================================================
// MODULE BITWARDEN / VAULTWARDEN (v0.2.0)
// ============================================================================
function setBwLoading(visible, message = 'Communication sécurisée avec Bitwarden...') {
  document.getElementById('bwLoadingText').textContent = message;
  document.getElementById('bwLoadingBox').classList.toggle('hidden', !visible);
  if (visible) {
    document.getElementById('bwLoginCard').classList.add('hidden');
    document.getElementById('bwUnlockCard').classList.add('hidden');
    document.getElementById('bwVaultWorkspace').classList.add('hidden');
  }
}

function showBwPanelForStatus(statusObj) {
  state.bwStatus = statusObj?.status || 'unauthenticated';
  document.getElementById('bwLoadingBox').classList.add('hidden');
  document.getElementById('bwLoginCard').classList.toggle('hidden', state.bwStatus !== 'unauthenticated');
  document.getElementById('bwUnlockCard').classList.toggle('hidden', state.bwStatus !== 'locked');
  document.getElementById('bwVaultWorkspace').classList.toggle('hidden', state.bwStatus !== 'unlocked');

  if (state.bwStatus === 'unlocked') {
    updateBwTopBadge('Déverrouillé', true);
  } else if (state.bwStatus === 'locked') {
    updateBwTopBadge('Verrouillé', false);
    const infoText = statusObj?.userEmail
      ? `Session de ${statusObj.userEmail} (${statusObj.serverUrl || 'Bitwarden'})`
      : `Serveur : ${statusObj?.serverUrl || 'Bitwarden'}`;
    document.getElementById('bwLockedAccountInfo').textContent = infoText;
  } else {
    updateBwTopBadge('Non connecté', false);
  }
}

async function refreshBitwardenStatus(loadItemsIfUnlocked = true) {
  const res = await window.kvault.bwStatus();
  if (!res.ok) {
    showBwPanelForStatus({ status: 'unauthenticated' });
    return;
  }

  showBwPanelForStatus(res.status);
  if (res.status.status === 'unlocked' && loadItemsIfUnlocked) {
    const listRes = await window.kvault.bwListItems();
    if (listRes.ok) {
      state.bwItems = listRes.items || [];
      renderBwItemsList();
      renderBwSelectedDetail();
    }
  }
}

function getBwItemIcon(item) {
  if (item.type === 'login') return '🔑';
  if (item.type === 'note') return '📝';
  if (item.type === 'card') return '💳';
  if (item.type === 'identity') return '🪪';
  return '🛡️';
}

function getBwItemSubtitle(item) {
  if (item.type === 'login') return item.login?.username || item.login?.uris?.[0] || 'Identifiant';
  if (item.type === 'card') return `${item.card?.brand || 'Carte'} •••• ${(item.card?.number || '').slice(-4)}`;
  if (item.type === 'identity') return item.identity?.email || `${item.identity?.firstName || ''} ${item.identity?.lastName || ''}`.trim();
  return 'Note sécurisée';
}

function renderBwItemsList() {
  const listEl = document.getElementById('bwItemsList');
  listEl.innerHTML = '';

  const q = state.bwSearch.trim().toLowerCase();
  const filtered = state.bwItems.filter((item) => {
    if (state.bwFilter === 'favorites' && !item.favorite) return false;
    if (['login', 'note', 'card'].includes(state.bwFilter) && item.type !== state.bwFilter) return false;

    if (q) {
      const hay = [item.name, item.login?.username, ...(item.login?.uris || []), item.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'state-box';
    empty.innerHTML = '<p>Aucun élément correspondant dans votre coffre.</p>';
    listEl.appendChild(empty);
    return;
  }

  for (const item of filtered) {
    const row = document.createElement('div');
    row.className = `bw-row${state.bwSelectedId === item.id ? ' selected' : ''}`;

    const icon = document.createElement('div');
    icon.className = 'bw-row-icon';
    icon.textContent = getBwItemIcon(item);

    const meta = document.createElement('div');
    meta.className = 'bw-row-meta';

    const title = document.createElement('div');
    title.className = 'bw-row-title';
    title.textContent = `${item.favorite ? '⭐ ' : ''}${item.name}`;

    const sub = document.createElement('div');
    sub.className = 'bw-row-sub';
    sub.textContent = getBwItemSubtitle(item);

    meta.appendChild(title);
    meta.appendChild(sub);

    const quick = document.createElement('div');
    quick.className = 'bw-quick-btns';

    if (item.login?.username) {
      const btnUser = document.createElement('button');
      btnUser.className = 'bw-icon-action';
      btnUser.title = 'Copier l\'identifiant';
      btnUser.textContent = '👤';
      btnUser.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.kvault.copyToClipboard(item.login.username, 0);
        showToast(`👤 Identifiant de "${item.name}" copié !`);
      });
      quick.appendChild(btnUser);
    }

    if (item.login?.password) {
      const btnPass = document.createElement('button');
      btnPass.className = 'bw-icon-action';
      btnPass.title = 'Copier le mot de passe (effacé après 20s)';
      btnPass.textContent = '🔑';
      btnPass.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.kvault.copyToClipboard(item.login.password, 20000);
        showToast('🔑 Mot de passe copié (purge auto dans 20s)');
      });
      quick.appendChild(btnPass);
    }

    row.appendChild(icon);
    row.appendChild(meta);
    row.appendChild(quick);

    row.addEventListener('click', () => {
      state.bwSelectedId = item.id;
      state.bwRevealPassword = false;
      renderBwItemsList();
      renderBwSelectedDetail();
    });

    listEl.appendChild(row);
  }
}

function createDetailField(label, value, { masked = false, onToggleMask = null, copyValue = null, clearMs = 0, openUrl = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-field';

  const info = document.createElement('div');
  info.className = 'detail-field-info';

  const lbl = document.createElement('div');
  lbl.className = 'detail-field-label';
  lbl.textContent = label;

  const val = document.createElement('div');
  val.className = 'detail-field-val selectable';
  val.textContent = masked ? '••••••••••••••••' : (value || '—');

  info.appendChild(lbl);
  info.appendChild(val);

  const btns = document.createElement('div');
  btns.className = 'detail-field-btns';

  if (onToggleMask) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-secondary';
    toggleBtn.textContent = masked ? '👁 Afficher' : '🙈 Masquer';
    toggleBtn.addEventListener('click', onToggleMask);
    btns.appendChild(toggleBtn);
  }

  if (copyValue) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-accent-outline';
    copyBtn.textContent = '📋 Copier';
    copyBtn.addEventListener('click', async () => {
      await window.kvault.copyToClipboard(copyValue, clearMs);
      showToast(clearMs > 0 ? '📋 Copié ! (effacé du presse-papiers dans 20s)' : '📋 Copié dans le presse-papiers !');
    });
    btns.appendChild(copyBtn);
  }

  if (openUrl) {
    const urlBtn = document.createElement('button');
    urlBtn.className = 'btn btn-secondary';
    urlBtn.textContent = '🌐 Ouvrir';
    urlBtn.addEventListener('click', () => {
      const target = openUrl.startsWith('http') ? openUrl : `https://${openUrl}`;
      window.kvault.openExternal(target);
    });
    btns.appendChild(urlBtn);
  }

  wrap.appendChild(info);
  wrap.appendChild(btns);
  return wrap;
}

function renderBwSelectedDetail() {
  const detailEl = document.getElementById('bwItemDetail');
  const item = state.bwItems.find((it) => it.id === state.bwSelectedId);

  if (!item) {
    detailEl.innerHTML = `
      <div class="bw-detail-empty">
        <div class="empty-illustration">🛡️</div>
        <h3>Sélectionnez un élément</h3>
        <p>Cliquez sur un identifiant à gauche pour afficher ses détails, copier le mot de passe ou ouvrir le site web.</p>
      </div>`;
    return;
  }

  detailEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'detail-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'detail-title-group';

  const badge = document.createElement('div');
  badge.className = 'detail-badge-icon';
  badge.textContent = getBwItemIcon(item);

  const hText = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = `${item.favorite ? '⭐ ' : ''}${item.name}`;
  const small = document.createElement('small');
  small.className = 'hint';
  small.textContent = item.revisionDate ? `Mis à jour le ${formatDate(item.revisionDate)}` : 'Coffre Bitwarden';
  hText.appendChild(h3);
  hText.appendChild(small);

  titleGroup.appendChild(badge);
  titleGroup.appendChild(hText);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger';
  delBtn.textContent = '🗑 Supprimer';
  delBtn.addEventListener('click', async () => {
    const res = await window.kvault.bwDeleteItem(item.id);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`🗑 "${item.name}" supprimé du coffre.`);
    state.bwSelectedId = null;
    const listRes = await window.kvault.bwListItems();
    if (listRes.ok) state.bwItems = listRes.items || [];
    renderBwItemsList();
    renderBwSelectedDetail();
  });

  header.appendChild(titleGroup);
  header.appendChild(delBtn);
  detailEl.appendChild(header);

  if (item.login) {
    if (item.login.username) {
      detailEl.appendChild(
        createDetailField('Identifiant / Nom d\'utilisateur', item.login.username, {
          copyValue: item.login.username
        })
      );
    }

    if (item.login.password) {
      detailEl.appendChild(
        createDetailField('Mot de passe', item.login.password, {
          masked: !state.bwRevealPassword,
          onToggleMask: () => {
            state.bwRevealPassword = !state.bwRevealPassword;
            renderBwSelectedDetail();
          },
          copyValue: item.login.password,
          clearMs: 20000
        })
      );
    }

    if (item.login.hasTotp) {
      const totpWrap = document.createElement('div');
      totpWrap.className = 'detail-field';
      totpWrap.innerHTML = `
        <div class="detail-field-info">
          <div class="detail-field-label">Double Authentification (TOTP 2FA)</div>
          <div class="detail-field-val">Code dynamique configuré</div>
        </div>
      `;
      const btnTotp = document.createElement('button');
      btnTotp.className = 'btn btn-primary';
      btnTotp.textContent = '⏱ Copier le code 2FA';
      btnTotp.addEventListener('click', async () => {
        const res = await window.kvault.bwGetTotp(item.id);
        if (!res.ok) {
          showToast(res.error, true);
          return;
        }
        await window.kvault.copyToClipboard(res.code, 20000);
        showToast(`⏱ Code 2FA (${res.code}) copié !`);
      });
      totpWrap.appendChild(btnTotp);
      detailEl.appendChild(totpWrap);
    }

    for (const uri of item.login.uris || []) {
      detailEl.appendChild(
        createDetailField('Site Web (URI)', uri, {
          copyValue: uri,
          openUrl: uri
        })
      );
    }
  }

  if (item.card) {
    if (item.card.cardholderName) {
      detailEl.appendChild(createDetailField('Titulaire', item.card.cardholderName, { copyValue: item.card.cardholderName }));
    }
    if (item.card.number) {
      detailEl.appendChild(
        createDetailField('Numéro de carte', item.card.number, {
          masked: !state.bwRevealPassword,
          onToggleMask: () => {
            state.bwRevealPassword = !state.bwRevealPassword;
            renderBwSelectedDetail();
          },
          copyValue: item.card.number,
          clearMs: 20000
        })
      );
    }
    if (item.card.expMonth || item.card.expYear) {
      detailEl.appendChild(createDetailField('Expiration', `${item.card.expMonth || '--'} / ${item.card.expYear || '--'}`));
    }
    if (item.card.code) {
      detailEl.appendChild(
        createDetailField('Code CVV', item.card.code, {
          masked: !state.bwRevealPassword,
          copyValue: item.card.code,
          clearMs: 20000
        })
      );
    }
  }

  if (item.notes) {
    detailEl.appendChild(createDetailField('Notes sécurisées', item.notes, { copyValue: item.notes }));
  }
}

async function refreshGeneratorPreview() {
  const options = {
    length: Number(document.getElementById('genLengthRange').value) || 20,
    uppercase: document.getElementById('genUpper').checked,
    lowercase: document.getElementById('genLower').checked,
    numbers: document.getElementById('genNum').checked,
    symbols: document.getElementById('genSym').checked
  };
  document.getElementById('genLengthValue').textContent = String(options.length);
  const res = await window.kvault.bwGeneratePassword(options);
  if (res.ok) {
    document.getElementById('generatedPasswordBox').textContent = res.password;
  }
  return res.password;
}

// ============================================================================
// Événements DOM
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Contrôles fenêtre Windows
  document.getElementById('btnMinimize').addEventListener('click', () => window.kvault.minimizeWindow());
  document.getElementById('btnMaximize').addEventListener('click', () => window.kvault.toggleMaximizeWindow());
  document.getElementById('btnClose').addEventListener('click', () => window.kvault.closeWindow());

  // Écoute du verrouillage déclenché par le Main Process (Auto-lock ou System Tray)
  window.kvault.onAppLocked(({ reason, isDefaultCode }) => {
    applyLockScreenUI(false, isDefaultCode, reason);
  });

  // Bouton Verrouiller l'application (Barre du haut)
  document.getElementById('btnLockAppTop').addEventListener('click', async () => {
    const info = await window.kvault.lockApp();
    applyLockScreenUI(false, info.isDefaultCode, 'manual');
    showToast('🔒 Application verrouillée.');
  });

  // Pavé numérique + Formulaire de déverrouillage APP_LOCK_CODE
  const unlockInput = document.getElementById('appUnlockInput');
  document.querySelectorAll('.pin-key[data-digit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      unlockInput.value += btn.dataset.digit;
      unlockInput.focus();
    });
  });
  document.getElementById('btnPinClear').addEventListener('click', () => {
    unlockInput.value = '';
    unlockInput.focus();
  });
  document.getElementById('btnPinBack').addEventListener('click', () => {
    unlockInput.value = unlockInput.value.slice(0, -1);
    unlockInput.focus();
  });

  document.getElementById('appUnlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('appUnlockError');
    errBox.classList.add('hidden');

    const res = await window.kvault.unlockApp(unlockInput.value);
    if (!res.ok) {
      errBox.textContent = res.error || 'Code incorrect.';
      errBox.classList.remove('hidden');
      unlockInput.select();
      return;
    }

    applyLockScreenUI(true, res.isDefaultCode);
    await startWorkspace();
  });

  // Fermeture globale du menu contextuel au clic ailleurs
  document.addEventListener('click', () => hideContextMenu());
  document.getElementById('viewKdrive').addEventListener('scroll', () => hideContextMenu());

  // Actions du menu contextuel Clic-Droit (Pack 4)
  document.getElementById('ctxOpen').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it) openItemDefaultAction(it);
  });
  document.getElementById('ctxShare').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it) openShareModal(it);
  });
  document.getElementById('ctxRename').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it) openRenameModal(it);
  });
  document.getElementById('ctxMove').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it) openMoveModal(it);
  });
  document.getElementById('ctxDownload').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it && it.type === 'file') handleDownload(it);
  });
  document.getElementById('ctxDelete').addEventListener('click', () => {
    const it = state.contextItem;
    hideContextMenu();
    if (it) askDeleteItem(it);
  });

  // Liens externes
  document.querySelectorAll('[data-ext]').forEach((btn) => {
    btn.addEventListener('click', () => window.kvault.openExternal(btn.dataset.ext));
  });

  // Navigation Sidebar
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (btn.dataset.filter) {
        state.activeCategory = btn.dataset.filter;
        renderFiles();
      }
      switchView(targetView);
    });
  });

  // Onboarding & Erreurs kDrive
  document.getElementById('btnGoSettings').addEventListener('click', () => switchView('settings'));
  document.getElementById('btnRetryConnect').addEventListener('click', () => initConnectionAndLoad());
  document.getElementById('btnErrorSettings').addEventListener('click', () => switchView('settings'));
  document.getElementById('btnErrorRetry').addEventListener('click', () => initConnectionAndLoad());

  // Barre d'outils kDrive
  document.getElementById('btnBack').addEventListener('click', () => {
    if (state.breadcrumbs.length > 1) {
      state.breadcrumbs.pop();
      const parent = state.breadcrumbs[state.breadcrumbs.length - 1];
      loadFolder(parent.id);
    }
  });

  document.getElementById('btnRefresh').addEventListener('click', () => {
    if (state.connected) loadFolder(state.currentFolderId);
    else initConnectionAndLoad();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderFiles();
  });

  document.getElementById('btnGridView').addEventListener('click', () => {
    state.viewMode = 'grid';
    document.getElementById('btnGridView').classList.add('active');
    document.getElementById('btnListView').classList.remove('active');
    const c = document.getElementById('filesContainer');
    c.classList.add('grid-mode');
    c.classList.remove('list-mode');
  });

  document.getElementById('btnListView').addEventListener('click', () => {
    state.viewMode = 'list';
    document.getElementById('btnListView').classList.add('active');
    document.getElementById('btnGridView').classList.remove('active');
    const c = document.getElementById('filesContainer');
    c.classList.add('list-mode');
    c.classList.remove('grid-mode');
  });

  document.getElementById('btnUploadFiles').addEventListener('click', () => handleUploadFiles(false));
  document.getElementById('btnUploadPhotos').addEventListener('click', () => handleUploadFiles(true));
  document.getElementById('btnUploadFolder').addEventListener('click', () => handleUploadFolder());

  // Modale Nouveau Dossier kDrive
  const folderModal = document.getElementById('folderModal');
  const folderInput = document.getElementById('newFolderInput');
  document.getElementById('btnNewFolder').addEventListener('click', () => {
    if (!state.connected) {
      showToast('Connectez d\'abord votre kDrive.', true);
      return;
    }
    folderInput.value = '';
    folderModal.classList.remove('hidden');
    folderInput.focus();
  });

  document.getElementById('btnCancelFolder').addEventListener('click', () => folderModal.classList.add('hidden'));
  document.getElementById('btnConfirmFolder').addEventListener('click', async () => {
    const name = folderInput.value.trim();
    if (!name) return;
    folderModal.classList.add('hidden');
    const res = await window.kvault.createFolder(state.currentFolderId, name);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`📁 Dossier "${name}" créé !`);
    await loadFolder(state.currentFolderId);
  });
  folderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnConfirmFolder').click();
  });

  // Modale Renommer kDrive (v0.3.0)
  const renameModal = document.getElementById('renameModal');
  const renameInput = document.getElementById('renameInput');
  document.getElementById('btnCancelRename').addEventListener('click', () => renameModal.classList.add('hidden'));
  document.getElementById('btnConfirmRename').addEventListener('click', async () => {
    const item = state.pendingRenameItem;
    const newName = renameInput.value.trim();
    if (!item || !newName || newName === item.name) {
      renameModal.classList.add('hidden');
      return;
    }
    renameModal.classList.add('hidden');
    const res = await window.kvault.renameItem(item.id, newName);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`✏️ Renommé en "${newName}" !`);
    await loadFolder(state.currentFolderId);
  });
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnConfirmRename').click();
  });

  // Modale Déplacer vers... kDrive (v0.3.0)
  const moveModal = document.getElementById('moveModal');
  document.getElementById('btnCancelMove').addEventListener('click', () => moveModal.classList.add('hidden'));
  document.getElementById('btnMoveBack').addEventListener('click', () => {
    if (state.moveStack.length > 1) {
      state.moveStack.pop();
      refreshMoveModalFolders();
    }
  });
  document.getElementById('btnConfirmMove').addEventListener('click', async () => {
    const item = state.pendingMoveItem;
    const dest = state.moveStack[state.moveStack.length - 1];
    moveModal.classList.add('hidden');
    if (!item || !dest) return;
    if (String(dest.id) === String(state.currentFolderId)) {
      showToast('Cet élément se trouve déjà dans ce dossier.');
      return;
    }
    const res = await window.kvault.moveItem(item.id, dest.id);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`📂 "${item.name}" déplacé vers "${dest.name}" !`);
    await loadFolder(state.currentFolderId);
  });

  // Modale Lien de partage public kDrive (v0.3.0)
  const shareModal = document.getElementById('shareModal');
  document.getElementById('btnCloseShareModal').addEventListener('click', () => shareModal.classList.add('hidden'));
  document.getElementById('btnCopyShareUrl').addEventListener('click', async () => {
    const url = document.getElementById('shareUrlInput').value;
    if (url) {
      await window.kvault.copyToClipboard(url, 0);
      showToast('📋 Lien public copié !');
    }
  });
  document.getElementById('btnOpenShareExternal').addEventListener('click', () => {
    const url = document.getElementById('shareUrlInput').value;
    if (url) window.kvault.openExternal(url);
  });
  document.getElementById('btnRevokeShareUrl').addEventListener('click', async () => {
    const item = state.pendingShareItem;
    if (!item) return;
    const res = await window.kvault.revokeShareLink(item.id);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    item.hasSharelink = false;
    shareModal.classList.add('hidden');
    renderFiles();
    showToast('🚫 Lien de partage public désactivé.');
  });

  // Modale Suppression kDrive
  const deleteModal = document.getElementById('deleteModal');
  document.getElementById('btnCancelDelete').addEventListener('click', () => deleteModal.classList.add('hidden'));
  document.getElementById('btnConfirmDelete').addEventListener('click', async () => {
    const item = state.pendingDeleteItem;
    deleteModal.classList.add('hidden');
    if (!item) return;
    const res = await window.kvault.deleteItem(item.id);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`🗑️ "${item.name}" déplacé vers la corbeille.`);
    await loadFolder(state.currentFolderId);
  });

  // Visionneuse Multimédia Universelle & Galerie (v0.3.0)
  const videoEl = document.getElementById('previewVideoEl');
  const audioEl = document.getElementById('previewAudioEl');
  [videoEl, audioEl].forEach((media) => {
    media.addEventListener('play', () => window.kvault.setMediaPlaying(true));
    media.addEventListener('pause', () => window.kvault.setMediaPlaying(false));
    media.addEventListener('ended', () => window.kvault.setMediaPlaying(false));
  });

  document.getElementById('btnClosePreview').addEventListener('click', () => closeUniversalPreview());
  document.getElementById('btnDownloadPreview').addEventListener('click', () => {
    if (state.previewItem) handleDownload(state.previewItem);
  });
  document.getElementById('btnSharePreview').addEventListener('click', () => {
    if (state.previewItem) openShareModal(state.previewItem);
  });
  document.getElementById('btnCopyPreviewText').addEventListener('click', async () => {
    if (state.previewTextContent) {
      await window.kvault.copyToClipboard(state.previewTextContent, 0);
      showToast('📋 Contenu texte copié dans le presse-papiers !');
    }
  });

  document.getElementById('btnPrevPreview').addEventListener('click', () => navigatePreview(-1));
  document.getElementById('btnNextPreview').addEventListener('click', () => navigatePreview(1));
  document.getElementById('btnZoomIn').addEventListener('click', () => applyImageZoom(state.imageZoom + 0.25));
  document.getElementById('btnZoomOut').addEventListener('click', () => applyImageZoom(state.imageZoom - 0.25));
  document.getElementById('btnZoomReset').addEventListener('click', () => applyImageZoom(1));

  document.getElementById('previewImageStage').addEventListener(
    'wheel',
    (e) => {
      if (document.getElementById('previewImageStage').classList.contains('hidden')) return;
      e.preventDefault();
      applyImageZoom(state.imageZoom + (e.deltaY < 0 ? 0.15 : -0.15));
    },
    { passive: false }
  );

  // Raccourcis clavier Galerie & Modales
  document.addEventListener('keydown', (e) => {
    if (!state.appUnlocked) return;

    const previewOpen = !document.getElementById('previewModal').classList.contains('hidden');
    if (previewOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeUniversalPreview();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePreview(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigatePreview(1);
      } else if (e.key === '+' || e.key === '=') {
        applyImageZoom(state.imageZoom + 0.25);
      } else if (e.key === '-') {
        applyImageZoom(state.imageZoom - 0.25);
      } else if (e.key === '0') {
        applyImageZoom(1);
      }
      return;
    }

    if (e.key === 'Escape') {
      hideContextMenu();
      ['folderModal', 'renameModal', 'moveModal', 'shareModal', 'deleteModal', 'newBwItemModal', 'generatorModal'].forEach(
        (id) => document.getElementById(id)?.classList.add('hidden')
      );
    }
  });

  // ==========================================================================
  // Événements BITWARDEN
  // ==========================================================================
  document.getElementById('bwServerSelect').addEventListener('change', (e) => {
    document.getElementById('bwCustomServerRow').classList.toggle('hidden', e.target.value !== 'custom');
  });

  document.getElementById('tabBwApiKey').addEventListener('click', () => {
    state.bwAuthMode = 'apikey';
    document.getElementById('tabBwApiKey').classList.add('active');
    document.getElementById('tabBwEmail').classList.remove('active');
    document.getElementById('bwApiKeyFields').classList.remove('hidden');
    document.getElementById('bwEmailFields').classList.add('hidden');
  });

  document.getElementById('tabBwEmail').addEventListener('click', () => {
    state.bwAuthMode = 'password';
    document.getElementById('tabBwEmail').classList.add('active');
    document.getElementById('tabBwApiKey').classList.remove('active');
    document.getElementById('bwEmailFields').classList.remove('hidden');
    document.getElementById('bwApiKeyFields').classList.add('hidden');
  });

  document.getElementById('bwLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('bwLoginError');
    errEl.classList.add('hidden');

    const serverChoice = document.getElementById('bwServerSelect').value;
    const serverUrl = serverChoice === 'custom'
      ? document.getElementById('bwCustomServerInput').value.trim()
      : serverChoice;

    const payload = {
      authMode: state.bwAuthMode,
      serverUrl,
      clientId: document.getElementById('bwClientIdInput').value.trim(),
      clientSecret: document.getElementById('bwClientSecretInput').value.trim(),
      saveApiKeys: document.getElementById('bwSaveApiKeysCheck').checked,
      email: document.getElementById('bwEmailInput').value.trim(),
      twoFactorCode: document.getElementById('bwTwoFactorInput').value.trim(),
      masterPassword: document.getElementById('bwLoginMasterPass').value
    };

    setBwLoading(true, 'Authentification et déchiffrement local de votre coffre Bitwarden...');
    const res = await window.kvault.bwLoginAndUnlock(payload);

    if (!res.ok) {
      setBwLoading(false);
      showBwPanelForStatus({ status: 'unauthenticated' });
      errEl.textContent = res.error;
      errEl.classList.remove('hidden');
      return;
    }

    document.getElementById('bwLoginMasterPass').value = '';
    state.bwItems = res.items || [];
    state.bwSelectedId = state.bwItems[0]?.id || null;
    showBwPanelForStatus(res.status);
    renderBwItemsList();
    renderBwSelectedDetail();
    await populateSettingsForm();
    showToast(`🔐 Coffre Bitwarden déverrouillé (${state.bwItems.length} éléments) !`);
  });

  document.getElementById('bwUnlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('bwUnlockError');
    errEl.classList.add('hidden');

    const masterPassword = document.getElementById('bwUnlockMasterPass').value;
    setBwLoading(true, 'Déverrouillage du coffre Bitwarden...');
    const res = await window.kvault.bwUnlock(masterPassword);

    if (!res.ok) {
      setBwLoading(false);
      showBwPanelForStatus({ status: 'locked' });
      errEl.textContent = res.error;
      errEl.classList.remove('hidden');
      return;
    }

    document.getElementById('bwUnlockMasterPass').value = '';
    state.bwItems = res.items || [];
    state.bwSelectedId = state.bwItems[0]?.id || null;
    showBwPanelForStatus(res.status);
    renderBwItemsList();
    renderBwSelectedDetail();
    showToast('🔓 Coffre Bitwarden déverrouillé !');
  });

  document.querySelectorAll('[data-bwfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.bwFilter = btn.dataset.bwfilter;
      document.querySelectorAll('[data-bwfilter]').forEach((b) => b.classList.toggle('active', b === btn));
      renderBwItemsList();
    });
  });

  document.getElementById('bwSearchInput').addEventListener('input', (e) => {
    state.bwSearch = e.target.value;
    renderBwItemsList();
  });

  document.getElementById('btnBwSync').addEventListener('click', async () => {
    showToast('🔄 Synchronisation Bitwarden en cours...');
    const res = await window.kvault.bwSync();
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    state.bwItems = res.items || [];
    renderBwItemsList();
    renderBwSelectedDetail();
    showToast('✅ Coffre Bitwarden synchronisé !');
  });

  document.getElementById('btnBwLock').addEventListener('click', async () => {
    const res = await window.kvault.bwLock();
    state.bwItems = [];
    state.bwSelectedId = null;
    showBwPanelForStatus(res.status || { status: 'locked' });
    showToast('🔒 Coffre Bitwarden verrouillé.');
  });

  const handleBwLogout = async () => {
    const res = await window.kvault.bwLogout();
    state.bwItems = [];
    state.bwSelectedId = null;
    showBwPanelForStatus(res.status || { status: 'unauthenticated' });
    showToast('Compte Bitwarden déconnecté.');
  };
  document.getElementById('btnBwLogout').addEventListener('click', handleBwLogout);
  document.getElementById('btnBwLogoutFromLocked').addEventListener('click', handleBwLogout);

  // Modale Nouvel Identifiant Bitwarden
  const newBwModal = document.getElementById('newBwItemModal');
  document.getElementById('btnOpenNewLogin').addEventListener('click', () => {
    document.getElementById('newBwItemForm').reset();
    newBwModal.classList.remove('hidden');
    document.getElementById('newBwName').focus();
  });
  document.getElementById('btnCancelNewBwItem').addEventListener('click', () => newBwModal.classList.add('hidden'));
  document.getElementById('btnFillGeneratedPass').addEventListener('click', async () => {
    const res = await window.kvault.bwGeneratePassword({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true });
    if (res.ok) document.getElementById('newBwPassword').value = res.password;
  });

  document.getElementById('newBwItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemData = {
      name: document.getElementById('newBwName').value.trim(),
      username: document.getElementById('newBwUsername').value.trim(),
      password: document.getElementById('newBwPassword').value,
      uri: document.getElementById('newBwUri').value.trim(),
      notes: document.getElementById('newBwNotes').value.trim(),
      favorite: document.getElementById('newBwFavorite').checked
    };

    const res = await window.kvault.bwCreateLogin(itemData);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }

    newBwModal.classList.add('hidden');
    showToast(`✅ "${itemData.name}" ajouté dans Bitwarden !`);
    const listRes = await window.kvault.bwListItems();
    if (listRes.ok) {
      state.bwItems = listRes.items || [];
      state.bwSelectedId = res.item?.id || state.bwSelectedId;
      renderBwItemsList();
      renderBwSelectedDetail();
    }
  });

  // Modale Générateur de mots de passe
  const genModal = document.getElementById('generatorModal');
  const openGenerator = async () => {
    genModal.classList.remove('hidden');
    await refreshGeneratorPreview();
  };
  document.getElementById('btnOpenGenerator').addEventListener('click', openGenerator);
  document.getElementById('btnOpenGenFromLogin').addEventListener('click', openGenerator);
  document.getElementById('btnCloseGenerator').addEventListener('click', () => genModal.classList.add('hidden'));
  document.getElementById('btnRegeneratePass').addEventListener('click', refreshGeneratorPreview);
  ['genLengthRange', 'genUpper', 'genLower', 'genNum', 'genSym'].forEach((id) => {
    document.getElementById(id).addEventListener('input', refreshGeneratorPreview);
  });
  document.getElementById('btnCopyGeneratedPass').addEventListener('click', async () => {
    const pwd = document.getElementById('generatedPasswordBox').textContent;
    await window.kvault.copyToClipboard(pwd, 20000);
    showToast('📋 Mot de passe généré copié !');
  });

  // ==========================================================================
  // Événements PARAMÈTRES, SÉCURITÉ & INTÉGRATION WINDOWS PRO
  // ==========================================================================
  document.getElementById('lockCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = document.getElementById('inputCurrentLockCode').value;
    const next = document.getElementById('inputNewLockCode').value.trim();
    const conf = document.getElementById('inputConfirmLockCode').value.trim();

    if (next !== conf) {
      showToast('La confirmation du nouveau code ne correspond pas.', true);
      return;
    }

    const res = await window.kvault.changeLockCode(cur, next);
    if (!res.ok) {
      showToast(res.error, true);
      return;
    }

    document.getElementById('lockCodeForm').reset();
    applyLockScreenUI(true, res.isDefaultCode);
    showToast('🛡️ Code de verrouillage mis à jour avec succès !');
  });

  document.getElementById('btnClearThumbCache').addEventListener('click', async () => {
    const res = await window.kvault.clearThumbCache();
    if (res.ok) {
      showToast(`🧹 Cache des miniatures vidé (${res.removed || 0} élément(s)) !`);
    } else {
      showToast(res.error, true);
    }
  });

  document.getElementById('btnQuitCompletely').addEventListener('click', () => {
    window.kvault.quitAppNow();
  });

  document.getElementById('inputMode').addEventListener('change', (e) => toggleModeInputs(e.target.value));
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
      AUTO_LOCK_MINUTES: document.getElementById('inputAutoLockMinutes').value,
      MINIMIZE_TO_TRAY: document.getElementById('inputMinimizeToTray').checked ? 'true' : 'false',
      KDRIVE_CONNECTION_MODE: document.getElementById('inputMode').value,
      KDRIVE_ID: document.getElementById('inputDriveId').value.trim(),
      KDRIVE_API_TOKEN: document.getElementById('inputApiToken').value.trim(),
      KDRIVE_EMAIL: document.getElementById('inputEmail').value.trim(),
      KDRIVE_APP_PASSWORD: document.getElementById('inputAppPassword').value.trim(),
      BITWARDEN_SERVER_URL: document.getElementById('inputBwServer').value.trim() || 'https://vault.bitwarden.eu',
      BITWARDEN_EMAIL: document.getElementById('inputBwEmail').value.trim(),
      BITWARDEN_CLIENT_ID: document.getElementById('inputBwClientId').value.trim(),
      BITWARDEN_CLIENT_SECRET: document.getElementById('inputBwClientSecret').value.trim()
    };

    await window.kvault.saveConfig(values);
    showToast('💾 Configuration sauvegardée !');
    await initConnectionAndLoad();
  });

  // Glisser-Déposer (Drag & Drop vers kDrive)
  const dropZone = document.getElementById('dropZone');
  const dropOverlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (state.currentView !== 'kdrive' || !state.connected) return;
    dragCounter++;
    dropOverlay.classList.remove('hidden');
  });

  dropZone.addEventListener('dragover', (e) => e.preventDefault());

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.add('hidden');
    }
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');

    if (state.currentView !== 'kdrive' || !state.connected) return;

    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files.map((f) => window.kvault.getDroppedFilePath(f)).filter(Boolean);
    if (!paths.length) return;

    const res = await window.kvault.uploadDroppedPaths(state.currentFolderId, paths);
    document.getElementById('uploadToast').classList.add('hidden');

    if (!res.ok) {
      showToast(res.error, true);
      return;
    }
    showToast(`✅ ${res.uploadedCount} fichier(s) déposé(s) sur kDrive !`);
    await loadFolder(state.currentFolderId);
  });

  window.kvault.onUploadProgress(({ fileIndex, totalFiles, fileName, percent }) => {
    const toast = document.getElementById('uploadToast');
    toast.classList.remove('hidden');
    document.getElementById('uploadToastTitle').textContent = `Envoi (${fileIndex}/${totalFiles})`;
    document.getElementById('uploadToastPercent').textContent = `${percent}%`;
    document.getElementById('uploadProgressFill').style.width = `${percent}%`;
    document.getElementById('uploadToastSub').textContent = fileName;
  });

  // Vérification du verrouillage au lancement
  checkInitialAppLock();
});
