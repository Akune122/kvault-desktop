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
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
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
        throw new Error(`Accès interdit (403) : votre Token API n'a pas la permission "drive" ou l'ID kDrive (${this.driveId}) ne correspond pas à votre compte.`);
      }
      if (res.status === 404) {
        throw new Error(`Ressource introuvable (404) : vérifiez que KDRIVE_ID=${this.driveId} est bien l'identifiant de votre kDrive.`);
      }
      throw new Error(`Erreur API kDrive (${res.status}) : ${apiErr}`);
    }

    return payload;
  }

  async testConnection() {
    this.validateCredentials();
    // Récupère les infos du Drive (nom, espace utilisé, quota total)
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
      // Vérifie au minimum l'accès au dossier racine (ID = 1)
      const rootRes = await this.requestJson(`/3/drive/${this.driveId}/files/1`);
      if (rootRes?.data?.name) {
        driveInfo.name = `kDrive (${this.driveId})`;
      }
    }

    // Valide également la lecture de la racine
    await this.listFiles('1');
    return driveInfo;
  }

  normalizeItem(item) {
    const isDir = item.type === 'dir';
    const timestampSec = item.last_modified_at || item.updated_at || item.added_at || item.created_at || 0;
    return {
      id: String(item.id),
      name: item.name || 'Sans nom',
      type: isDir ? 'dir' : 'file',
      size: Number(item.size || 0),
      mimeType: isDir ? 'inode/directory' : (item.mime_type || guessMimeType(item.name)),
      updatedAt: timestampSec ? timestampSec * 1000 : Date.now(),
      hasThumbnail: Boolean(item.has_thumbnail),
      path: item.path || ''
    };
  }

  async listFiles(folderId = '1') {
    this.validateCredentials();
    const targetId = folderId || '1';
    let rawItems = [];

    try {
      // API v3 avec pagination par curseur (récupère jusqu'à 500 éléments proprement)
      const res = await this.requestJson(
        `/3/drive/${this.driveId}/files/${encodeURIComponent(targetId)}/files?limit=200`
      );
      rawItems = Array.isArray(res?.data) ? res.data : [];
    } catch (errV3) {
      // Fallback API v2 si nécessaire
      const resV2 = await this.requestJson(
        `/2/drive/${this.driveId}/files/${encodeURIComponent(targetId)}/files?per_page=200`
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

  async getPreviewDataUrl(fileId, mimeType = 'image/jpeg') {
    this.validateCredentials();
    const urls = [
      `${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/thumbnail?width=1280&height=1280`,
      `${API_BASE}/2/drive/${this.driveId}/files/${encodeURIComponent(fileId)}/download`
    ];

    for (const url of urls) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        redirect: 'follow'
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || mimeType;
        const buf = Buffer.from(await res.arrayBuffer());
        return `data:${contentType};base64,${buf.toString('base64')}`;
      }
    }

    throw new Error('Aperçu indisponible pour ce fichier.');
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
}

module.exports = { KDriveApiClient, guessMimeType };
