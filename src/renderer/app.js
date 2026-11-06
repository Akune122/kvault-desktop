const state = {
  connected: false,
  rootId: '1',
  currentFolderId: '1',
  breadcrumbs: [{ id: '1', name: 'Mon kDrive' }],
  items: [],
  activeCategory: 'all',
  searchQuery: '',
  viewMode: 'grid',
  pendingDeleteItem: null,
  previewItem: null
};

// Helpers de formatage
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
// Navigation entre les vues (kDrive / Bitwarden / Paramètres)
// ============================================================================
function switchView(viewName) {
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
}

// ============================================================================
// Chargement Config & Connexion kDrive
// ============================================================================
async function populateSettingsForm() {
  const res = await window.kvault.getConfig();
  document.getElementById('versionPill').textContent = `v${res.appVersion || '0.1.0'}`;
  document.getElementById('envPathDisplay').textContent = res.envPath || '.env';

  const cfg = res.config || {};
  const modeSelect = document.getElementById('inputMode');
  modeSelect.value = cfg.KDRIVE_CONNECTION_MODE || 'api';
  document.getElementById('inputDriveId').value = cfg.KDRIVE_ID || '';
  document.getElementById('inputApiToken').value = cfg.KDRIVE_API_TOKEN || '';
  document.getElementById('inputEmail').value = cfg.KDRIVE_EMAIL || '';
  document.getElementById('inputAppPassword').value = cfg.KDRIVE_APP_PASSWORD || '';

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
  document.getElementById('connectionText').textContent = labelText;
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
    updateConnectionStatus(false, 'Configuration requise');
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
    updateConnectionStatus(false, 'Erreur de connexion');
    showErrorBanner(conn.error);
    return;
  }

  state.rootId = conn.rootId;
  state.currentFolderId = conn.rootId;
  state.breadcrumbs = [{ id: conn.rootId, name: conn.driveInfo?.name || 'Mon kDrive' }];

  updateConnectionStatus(true, conn.driveInfo?.name || 'Connecté à kDrive');
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

// ============================================================================
// Rendu du fil d'Ariane & des fichiers
// ============================================================================
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
      if (item.type === 'dir') return true; // Toujours permettre de naviguer dans les dossiers
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
      if (item.type === 'dir') {
        enterFolder(item);
      } else if (getFileCategory(item) === 'images') {
        openImagePreview(item);
      } else {
        handleDownload(item);
      }
    });

    container.appendChild(card);
  }
}

function enterFolder(folderItem) {
  state.breadcrumbs.push({ id: folderItem.id, name: folderItem.name });
  loadFolder(folderItem.id);
}

// ============================================================================
// Actions : Upload, Nouveau Dossier, Téléchargement, Aperçu, Suppression
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
// Événements DOM
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Contrôles fenêtre Windows
  document.getElementById('btnMinimize').addEventListener('click', () => window.kvault.minimizeWindow());
  document.getElementById('btnMaximize').addEventListener('click', () => window.kvault.toggleMaximizeWindow());
  document.getElementById('btnClose').addEventListener('click', () => window.kvault.closeWindow());

  // Liens externes vers Infomaniak
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

  // Boutons Onboarding & Erreurs
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

  // Modale Nouveau Dossier
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

  // Modale Suppression
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

  // Formulaire Paramètres
  document.getElementById('inputMode').addEventListener('change', (e) => toggleModeInputs(e.target.value));
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
      KDRIVE_CONNECTION_MODE: document.getElementById('inputMode').value,
      KDRIVE_ID: document.getElementById('inputDriveId').value.trim(),
      KDRIVE_API_TOKEN: document.getElementById('inputApiToken').value.trim(),
      KDRIVE_EMAIL: document.getElementById('inputEmail').value.trim(),
      KDRIVE_APP_PASSWORD: document.getElementById('inputAppPassword').value.trim()
    };

    await window.kvault.saveConfig(values);
    showToast('💾 Configuration sauvegardée ! Test de connexion...');
    switchView('kdrive');
    await initConnectionAndLoad();
  });

  // Glisser-Déposer (Drag & Drop depuis l'Explorateur Windows)
  const dropZone = document.getElementById('dropZone');
  const dropOverlay = document.getElementById('dropOverlay');
  let dragCounter = 0;

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (state.connected) dropOverlay.classList.remove('hidden');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

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

    if (!state.connected) {
      showToast('Connectez votre compte kDrive avant d\'envoyer des fichiers.', true);
      return;
    }

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

  // Progression d'upload en temps réel
  window.kvault.onUploadProgress(({ fileIndex, totalFiles, fileName, percent }) => {
    const toast = document.getElementById('uploadToast');
    toast.classList.remove('hidden');
    document.getElementById('uploadToastTitle').textContent =
      `Envoi (${fileIndex}/${totalFiles})`;
    document.getElementById('uploadToastPercent').textContent = `${percent}%`;
    document.getElementById('uploadProgressFill').style.width = `${percent}%`;
    document.getElementById('uploadToastSub').textContent = fileName;
  });

  // Démarrage initial
  initConnectionAndLoad();
});
