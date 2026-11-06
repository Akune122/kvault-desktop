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
  pendingDeleteItem: null,
  previewItem: null,

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
// Helpers généraux
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

function getFileCategory(item) {
  if (item.type === 'dir') return 'dir';
  const mime = (item.mimeType || '').toLowerCase();
  const ext = (item.name.split('.').pop() || '').toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(ext)) {
    return 'images';
  }
  if (mime.startsWith('video/') || mime.startsWith('audio/') || ['mp4', 'mov', 'mkv', 'mp3', 'wav', 'flac'].includes(ext)) {
    return 'media';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('sheet') ||
    mime.includes('excel') ||
    mime.includes('presentation') ||
    mime.startsWith('text/') ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'].includes(ext)
  ) {
    return 'docs';
  }
  return 'other';
}

function getFileEmoji(item) {
  if (item.type === 'dir') return '📁';
  const cat = getFileCategory(item);
  if (cat === 'images') return '🖼️';
  if (cat === 'media') return '🎬';
  if (cat === 'docs') return '📄';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  return '📦';
}

function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ============================================================================
// Verrouillage de l'application (APP_LOCK_CODE, défaut : 0000)
// ============================================================================
function applyLockScreenUI(unlocked, isDefaultCode) {
  state.appUnlocked = unlocked;
  document.getElementById('appLockOverlay').classList.toggle('hidden', unlocked);
  document.getElementById('btnLockAppTop').classList.toggle('hidden', !unlocked);
  document.getElementById('defaultCodeHint').classList.toggle('hidden', !isDefaultCode);

  const pill = document.getElementById('lockCodeStatusPill');
  if (pill) {
    pill.textContent = isDefaultCode ? 'Par défaut (0000)' : 'Personnalisé ✓';
    pill.classList.toggle('custom', !isDefaultCode);
  }

  if (!unlocked) {
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
  document.getElementById('versionPill').textContent = `v${res.appVersion || '0.2.0'}`;
  document.getElementById('envPathDisplay').textContent = res.envPath || '.env';

  const pill = document.getElementById('lockCodeStatusPill');
  if (pill) {
    pill.textContent = res.isDefaultLockCode ? 'Par défaut (0000)' : 'Personnalisé ✓';
    pill.classList.toggle('custom', !res.isDefaultLockCode);
  }

  const cfg = res.config || {};
  const modeSelect = document.getElementById('inputMode');
  modeSelect.value = cfg.KDRIVE_CONNECTION_MODE || 'api';
  document.getElementById('inputDriveId').value = cfg.KDRIVE_ID || '';
  document.getElementById('inputApiToken').value = cfg.KDRIVE_API_TOKEN || '';
  document.getElementById('inputEmail').value = cfg.KDRIVE_EMAIL || '';
  document.getElementById('inputAppPassword').value = cfg.KDRIVE_APP_PASSWORD || '';

  // Champs Bitwarden dans Paramètres & pré-remplissage formulaire Bitwarden
  const bwServer = cfg.BITWARDEN_SERVER_URL || 'https://vault.bitwarden.eu';
  document.getElementById('inputBwServer').value = bwServer;
  document.getElementById('inputBwEmail').value = cfg.BITWARDEN_EMAIL || '';
  document.getElementById('inputBwClientId').value = cfg.BITWARDEN_CLIENT_ID || '';
  document.getElementById('inputBwClientSecret').value = cfg.BITWARDEN_CLIENT_SECRET || '';

  // Pré-remplissage de la carte de connexion Bitwarden
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

function renderFiles() {
  const container = document.getElementById('filesContainer');
  container.innerHTML = '';

  const query = state.searchQuery.trim().toLowerCase();
  const filtered = state.items.filter((item) => {
    if (query && !item.name.toLowerCase().includes(query)) return false;
    if (state.activeCategory !== 'all') {
      if (item.type === 'dir') return true;
      return getFileCategory(item) === state.activeCategory;
    }
    return true;
  });

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
    iconBox.textContent = getFileEmoji(item);

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
    } else {
      if (getFileCategory(item) === 'images') {
        const viewBtn = document.createElement('button');
        viewBtn.className = 'mini-btn';
        viewBtn.textContent = '👁 Aperçu';
        viewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openImagePreview(item);
        });
        actions.appendChild(viewBtn);
      }

      const dlBtn = document.createElement('button');
      dlBtn.className = 'mini-btn';
      dlBtn.textContent = '⬇ Sauver';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDownload(item);
      });
      actions.appendChild(dlBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-btn del';
    delBtn.title = 'Mettre à la corbeille';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      askDeleteItem(item);
    });
    actions.appendChild(delBtn);

    card.appendChild(iconBox);
    card.appendChild(meta);
    card.appendChild(actions);

    card.addEventListener('dblclick', () => {
      if (item.type === 'dir') enterFolder(item);
      else if (getFileCategory(item) === 'images') openImagePreview(item);
      else handleDownload(item);
    });

    container.appendChild(card);
  }
}

function enterFolder(folderItem) {
  state.breadcrumbs.push({ id: folderItem.id, name: folderItem.name });
  loadFolder(folderItem.id);
}

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

async function openImagePreview(item) {
  state.previewItem = item;
  const modal = document.getElementById('previewModal');
  const img = document.getElementById('previewImageEl');
  const spinner = document.getElementById('previewSpinner');

  document.getElementById('previewTitle').textContent = item.name;
  img.classList.add('hidden');
  img.src = '';
  spinner.classList.remove('hidden');
  modal.classList.remove('hidden');

  const res = await window.kvault.previewImage(item.id, item.mimeType);
  spinner.classList.add('hidden');

  if (!res.ok) {
    modal.classList.add('hidden');
    showToast(res.error, true);
    return;
  }

  img.src = res.dataUrl;
  img.classList.remove('hidden');
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
      const hay = [
        item.name,
        item.login?.username,
        ...(item.login?.uris || []),
        item.notes
      ]
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
        showToast(`🔑 Mot de passe copié (purge auto dans 20s)`);
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

// Générateur de mot de passe
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

  // Bouton Verrouiller l'application (Barre du haut)
  document.getElementById('btnLockAppTop').addEventListener('click', async () => {
    const info = await window.kvault.lockApp();
    applyLockScreenUI(false, info.isDefaultCode);
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

  // Modale Aperçu Image
  document.getElementById('btnClosePreview').addEventListener('click', () => {
    document.getElementById('previewModal').classList.add('hidden');
  });
  document.getElementById('btnDownloadPreview').addEventListener('click', () => {
    if (state.previewItem) handleDownload(state.previewItem);
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
  // Événements PARAMÈTRES & CODE D'ACCÈS
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

  document.getElementById('inputMode').addEventListener('change', (e) => toggleModeInputs(e.target.value));
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
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
