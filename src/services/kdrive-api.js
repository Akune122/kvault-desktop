const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://api.infomaniak.com';

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.py': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function guessMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

class KDriveApiClient {
  constructor({ driveId, apiToken }) {
    this.driveId = String(driveId || '').trim();
    this.apiToken = String(apiToken || '').trim();
  }

  validateCredentials() {
    if (!this.driveId || !/^\d+$/.test(this.driveId)) {
      throw new Error(
        'KDRIVE_ID manquant ou invalide. Il doit contenir uniquement les chiffres présents après "/drive/" dans l\'URL de votre kDrive (ex: 123456).'
      );
    }
    if (!this.apiToken) {
      throw new Error(
        'KDRIVE_API_TOKEN manquant. Générez un Token API Infomaniak avec le droit "drive" et renseignez-le dans .env ou dans Paramètres.'
      );
    }
  }

  getHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
      ...extra
    };
  }

  async requestJson(endpointPath, options = {}) {
    this.validateCredentials();
    const url = endpointPath.startsWith('http') ? endpointPath : `${API_BASE}${endpointPath}`;
    const res = await fetch(url, {
      ...options,
      headers: this.getHeaders(options.headers || {})
    });

    let payload = null;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_) {
      payload = null;
    }

    if (!res.ok || (payload && payload.result === 'error')) {
      const apiErr = payload?.error?.description || payload?.error?.code || text || `HTTP ${res.status}`;
      if (res.status === 401) {
        throw new Error(`Authentification refusée (401) : vérifiez votre KDRIVE_API_TOKEN et qu'il possède bien le scope "drive". (${apiErr})`);
      }
      if (res.status === 403) {
        throw new Error(`Accès interdit (403) : votre Token API n'a pas la permission nécessaire ou l'ID kDrive (${this.driveId}) est incorrect.`);
      }
      if (res.status === 404) {
        throw new Error(`Ressource introuvable (404) : ${apiErr}`);
      }
      throw new Error(`Erreur API kDrive (${res.status}) : ${apiErr}`);
    }

    return payload;
  }

  async testConnection() {
    this.validateCredentials();
    let driveInfo = {
      id: this.driveId,
      name: `kDrive #${this.driveId}`,
      usedSize: null,
      totalSize: null,
      mode: 'api'
    };

    try {
      const infoRes = await this.requestJson(`/2/drive/${this.driveId}`);
      if (infoRes?.data) {
        driveInfo.name = infoRes.data.name || driveInfo.name;
        driveInfo.usedSize = typeof infoRes.data.used_size === 'number' ? infoRes.data.used_size : null;
        driveInfo.totalSize = typeof infoRes.data.size === 'number' ? infoRes.data.size : null;
      }
    } catch (_) {
      const rootRes = await this.requestJson(`/3/drive/${this.driveId}/files/1`);
      if (rootRes?.data?.name) {
        driveInfo.name = `kDrive (${this.driveId})`;
      }
    }

    await this.listFiles('1');
    return driveInfo;
  }

  normalizeItem(item) {
    const isDir = item.type === 'dir';
    const timestampSec = item.last_modified_at || item.updated_at || item.added_at || item.created_at || 0;
    return {
      id: String(item.id),
      parentId: item.parent_id ? String(item.parent_id) : '1',
      name: item.name || 'Sans nom',
      type: isDir ? 'dir' : 'file',
      size: Number(item.size || 0),
      mimeType: isDir ? 'inode/directory' : (item.mime_type || guessMimeType(item.name)),
      updatedAt: timestampSec ? timestampSec * 1000 : Date.now(),
      hasThumbnail: Boolean(item.has_thumbnail),
      hasSharelink: Boolean(item.has_sharelink || item.sharelink),
      isFavorite: Boolean(item.is_favorite),
      path: item.path || ''
    };
  }

  async listFiles(folderId = '1') {
    this.validateCredentials();
    const targetId = folderId || '1';
    let rawItems = [];

    try {
      const res = await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(targetId)}/files?limit=250&with=sharelink`
      );
      rawItems = Array.isArray(res?.data) ? res.data : [];
    } catch (_) {
      const resV2 = await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(targetId)}/files?per_page=250`
      );
      rawItems = Array.isArray(resV2?.data) ? resV2.data : [];
    }

    const items = rawItems.map((it) => this.normalizeItem(it));
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });

    return items;
  }

  async createFolder(parentId = '1', folderName) {
    this.validateCredentials();
    const cleanName = String(folderName || '').trim();
    if (!cleanName) {
      throw new Error('Le nom du dossier ne peut pas être vide.');
    }

    try {
      const res = await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(parentId || '1')}/directory`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanName })
        }
      );
      return res?.data ? this.normalizeItem(res.data) : { name: cleanName, type: 'dir' };
    } catch (_) {
      const resV2 = await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(parentId || '1')}/directory`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanName })
        }
      );
      return resV2?.data ? this.normalizeItem(resV2.data) : { name: cleanName, type: 'dir' };
    }
  }

  uploadFile(parentId = '1', localFilePath, onProgress) {
    this.validateCredentials();
    if (!fs.existsSync(localFilePath)) {
      return Promise.reject(new Error(`Fichier local introuvable : ${localFilePath}`));
    }

    const stat = fs.statSync(localFilePath);
    const fileName = path.basename(localFilePath);
    const totalSize = stat.size;
    const targetDir = parentId || '1';
    const lastModified = Math.floor(stat.mtimeMs / 1000);

    const query = new URLSearchParams({
      directory_id: String(targetDir),
      file_name: fileName,
      total_size: String(totalSize),
      conflict: 'version',
      last_modified_at: String(lastModified)
    });

    const uploadPath = `/3/drive/${this.driveId}/upload?${query.toString()}`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        `${API_BASE}${uploadPath}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': totalSize,
            Accept: 'application/json'
          }
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            try {
              parsed = body ? JSON.parse(body) : null;
            } catch (_) {
              parsed = null;
            }

            if (res.statusCode >= 200 && res.statusCode < 300 && parsed?.result !== 'error') {
              resolve(parsed?.data ? this.normalizeItem(parsed.data) : { name: fileName });
            } else {
              const detail = parsed?.error?.description || parsed?.error?.code || body || `HTTP ${res.statusCode}`;
              reject(new Error(`Échec de l'envoi de "${fileName}" : ${detail}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Erreur réseau lors de l'upload : ${err.message}`)));

      if (totalSize === 0) {
        if (onProgress) onProgress({ fileName, loaded: 0, total: 0, percent: 100 });
        req.end();
        return;
      }

      let uploaded = 0;
      const fileStream = fs.createReadStream(localFilePath);
      fileStream.on('data', (chunk) => {
        uploaded += chunk.length;
        if (onProgress) {
          onProgress({
            fileName,
            loaded: uploaded,
            total: totalSize,
            percent: Math.min(100, Math.round((uploaded / totalSize) * 100))
          });
        }
      });
      fileStream.on('error', (err) => {
        req.destroy();
        reject(err);
      });
      fileStream.pipe(req);
    });
  }

  async downloadFile(fileId, destLocalPath) {
    this.validateCredentials();
    const endpoints = [
      `${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`,
      `${API_BASE}/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`
    ];

    let response = null;
    let lastError = null;

    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        redirect: 'follow'
      });
      if (res.ok) {
        response = res;
        break;
      }
      lastError = `HTTP ${res.status}`;
    }

    if (!response) {
      throw new Error(`Impossible de télécharger le fichier (${lastError || 'erreur inconnue'}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(destLocalPath, Buffer.from(arrayBuffer));
    return { savedPath: destLocalPath };
  }

  // ==========================================================================
  // v0.3.0 : Miniatures, Streaming Vidéo/Audio/PDF, Aperçu Texte
  // ==========================================================================
  async getThumbnailBuffer(fileId, width = 420, height = 420, mimeType = 'image/jpeg') {
    this.validateCredentials();
    const urls = [
      `${API_BASE}/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/thumbnail?width=${width}&height=${height}`,
      `${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/thumbnail?width=${width}&height=${height}`
    ];

    // Pour les petites images (ex: SVG, petites icônes sans thumbnail généré), fallback sur download si < 6 Mo
    if (String(mimeType).startsWith('image/')) {
      urls.push(`${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`);
    }

    for (const url of urls) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        redirect: 'follow'
      });

      if (res.ok) {
        const lenHeader = Number(res.headers.get('content-length') || 0);
        if (url.endsWith('/download') && lenHeader > 8 * 1024 * 1024) {
          continue; // Évite de charger en miniature une image brute très lourde
        }
        const ct = res.headers.get('content-type') || mimeType || 'image/jpeg';
        if (ct.includes('application/json')) {
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 0) {
          return { buffer, contentType: ct };
        }
      }
    }

    throw new Error('Miniature indisponible');
  }

  async streamFile(fileId, rangeHeader = null) {
    this.validateCredentials();
    const headers = { Authorization: `Bearer ${this.apiToken}` };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const endpoints = [
      `${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`,
      `${API_BASE}/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`
    ];

    for (const url of endpoints) {
      const res = await fetch(url, {
        headers,
        redirect: 'follow'
      });
      if (res.ok || res.status === 206) {
        return res;
      }
    }

    throw new Error('Flux média indisponible sur kDrive.');
  }

  async readTextPreview(fileId, maxBytes = 512 * 1024) {
    const res = await this.streamFile(fileId, `bytes=0-${maxBytes - 1}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length >= maxBytes;
    return {
      text: buf.toString('utf8'),
      truncated
    };
  }

  async getPreviewDataUrl(fileId, mimeType = 'image/jpeg') {
    const { buffer, contentType } = await this.getThumbnailBuffer(fileId, 1600, 1600, mimeType);
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  // ==========================================================================
  // v0.3.0 : Renommer, Déplacer & Liens de partage public kDrive
  // ==========================================================================
  async renameItem(fileId, newName) {
    this.validateCredentials();
    const cleanName = String(newName || '').trim();
    if (!cleanName) {
      throw new Error('Le nouveau nom ne peut pas être vide.');
    }

    try {
      const res = await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/rename`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanName })
        }
      );
      return res?.data ? this.normalizeItem(res.data) : { id: fileId, name: cleanName };
    } catch (_) {
      const resV2 = await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/rename`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanName })
        }
      );
      return resV2?.data ? this.normalizeItem(resV2.data) : { id: fileId, name: cleanName };
    }
  }

  async moveItem(fileId, destinationFolderId) {
    this.validateCredentials();
    const destId = String(destinationFolderId || '1').trim();
    if (String(fileId) === destId) {
      throw new Error('Impossible de déplacer un dossier dans lui-même.');
    }

    try {
      await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/move/${encodeURIComponent(destId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conflict: 'rename' })
        }
      );
    } catch (_) {
      await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/move/${encodeURIComponent(destId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conflict: 'rename' })
        }
      );
    }
    return { moved: true };
  }

  async createOrGetShareLink(fileId) {
    this.validateCredentials();

    // 1. Vérifie si un lien de partage existe déjà
    for (const ver of ['2', '3']) {
      try {
        const existing = await this.requestJson(`/${ver}/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/link`);
        if (existing?.data?.url) {
          return { url: existing.data.url, right: existing.data.right || 'public', existed: true };
        }
      } catch (_) {
        // Pas encore de lien actif
      }
    }

    // 2. Crée un lien de partage public en lecture + téléchargement autorisé
    const body = JSON.stringify({
      right: 'public',
      can_download: true,
      can_edit: false
    });

    try {
      const created = await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        }
      );
      if (created?.data?.url) {
        return { url: created.data.url, right: created.data.right || 'public', existed: false };
      }
    } catch (_) {
      const createdV3 = await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        }
      );
      if (createdV3?.data?.url) {
        return { url: createdV3.data.url, right: createdV3.data.right || 'public', existed: false };
      }
    }

    throw new Error('Impossible de générer le lien de partage (vérifiez les droits de votre Token API).');
  }

  async revokeShareLink(fileId) {
    this.validateCredentials();
    try {
      await this.requestJson(`/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/link`, {
        method: 'DELETE'
      });
    } catch (_) {
      await this.requestJson(`/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/link`, {
        method: 'DELETE'
      });
    }
    return { revoked: true };
  }

  async deleteItem(fileId) {
    this.validateCredentials();
    try {
      await this.requestJson(`/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      });
    } catch (_) {
      await this.requestJson(`/3/drive/${this.driveId}/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      });
    }
    return { deleted: true };
  }

  // ==========================================================================
  // v0.4.0 (Pack 3) : Recherche Globale kDrive & Gestion de la Corbeille
  // ==========================================================================
  async searchFiles(query) {
    this.validateCredentials();
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return [];

    const endpoints = [
      `/3/drive/${this.driveId}/files/search?query=${encodeURIComponent(cleanQuery)}&limit=100&with=sharelink`,
      `/2/drive/${this.driveId}/files/search?query=${encodeURIComponent(cleanQuery)}&per_page=100`,
      `/2/drive/${this.driveId}/files/search?name=${encodeURIComponent(cleanQuery)}&per_page=100`
    ];

    let rawItems = [];
    let lastErr = null;

    for (const ep of endpoints) {
      try {
        const res = await this.requestJson(ep);
        if (Array.isArray(res?.data)) {
          rawItems = res.data;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!rawItems.length && lastErr) {
      // Fallback si l'endpoint search global n'a rien renvoyé : recherche récursive légère à la racine
      try {
        const rootItems = await this.listFiles('1');
        const qLower = cleanQuery.toLowerCase();
        return rootItems.filter((it) => it.name.toLowerCase().includes(qLower));
      } catch (_) {
        throw lastErr;
      }
    }

    return rawItems.map((it) => this.normalizeItem(it));
  }

  async listTrash() {
    this.validateCredentials();
    const endpoints = [
      `/2/drive/${this.driveId}/trash?per_page=200`,
      `/3/drive/${this.driveId}/trash?limit=200`,
      `/2/drive/${this.driveId}/files/trash?per_page=200`
    ];

    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const res = await this.requestJson(ep);
        if (Array.isArray(res?.data)) {
          return res.data.map((it) => ({
            ...this.normalizeItem(it),
            isTrash: true
          }));
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (lastErr) throw lastErr;
    return [];
  }

  async restoreTrashItem(fileId) {
    this.validateCredentials();
    const endpoints = [
      `/2/drive/${this.driveId}/trash/${encodeURIComponent(fileId)}/restore`,
      `/3/drive/${this.driveId}/trash/${encodeURIComponent(fileId)}/restore`
    ];

    let lastErr = null;
    for (const ep of endpoints) {
      try {
        await this.requestJson(ep, { method: 'POST' });
        return { restored: true };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Impossible de restaurer cet élément depuis la corbeille.');
  }

  async deleteTrashItemPermanently(fileId) {
    this.validateCredentials();
    try {
      await this.requestJson(`/2/drive/${this.driveId}/trash/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      });
    } catch (_) {
      await this.requestJson(`/3/drive/${this.driveId}/trash/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      });
    }
    return { deletedPermanently: true };
  }

  async emptyTrash() {
    this.validateCredentials();
    try {
      await this.requestJson(`/2/drive/${this.driveId}/trash`, {
        method: 'DELETE'
      });
    } catch (_) {
      await this.requestJson(`/3/drive/${this.driveId}/trash`, {
        method: 'DELETE'
      });
    }
    return { emptied: true };
  }

  /**
   * Envoie ou met à jour directement un Buffer en mémoire (ex: note Markdown, code, fichier JSON de budget)
   */
  async uploadBuffer(parentFolderId = 1, fileName = 'note.md', contentBuffer = Buffer.alloc(0), existingFileId = null) {
    this.validateCredentials();
    const buf = Buffer.isBuffer(contentBuffer) ? contentBuffer : Buffer.from(String(contentBuffer || ''), 'utf8');
    const totalSize = buf.length;
    const lastModified = Math.floor(Date.now() / 1000);
    const targetDir = parentFolderId || 1;

    const sendWithQuery = (queryObj) => {
      const qs = new URLSearchParams(queryObj).toString();
      const uploadPath = `/3/drive/${this.driveId}/upload?${qs}`;

      return new Promise((resolve, reject) => {
        const req = https.request(
          `${API_BASE}${uploadPath}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              'Content-Type': 'application/octet-stream',
              'Content-Length': totalSize,
              Accept: 'application/json'
            }
          },
          (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              let parsed = null;
              try {
                parsed = body ? JSON.parse(body) : null;
              } catch (_) {
                parsed = null;
              }
              if (res.statusCode >= 200 && res.statusCode < 300 && parsed?.result !== 'error') {
                resolve(parsed?.data ? this.normalizeItem(parsed.data) : { id: existingFileId, name: fileName });
              } else {
                const detail = parsed?.error?.description || parsed?.error?.code || body || `HTTP ${res.statusCode}`;
                reject(new Error(`Échec de l'enregistrement de "${fileName}" : ${detail}`));
              }
            });
          }
        );

        req.on('error', (err) => reject(new Error(`Erreur réseau lors de l'enregistrement : ${err.message}`)));
        req.end(buf);
      });
    };

    if (existingFileId) {
      try {
        return await sendWithQuery({
          file_id: String(existingFileId),
          total_size: String(totalSize),
          last_modified_at: String(lastModified)
        });
      } catch (_) {
        // Fallback par directory_id + conflict=version
      }
    }

    return sendWithQuery({
      directory_id: String(targetDir),
      file_name: fileName,
      total_size: String(totalSize),
      conflict: 'version',
      last_modified_at: String(lastModified)
    });
  }
}

module.exports = { KDriveApiClient, guessMimeType };
