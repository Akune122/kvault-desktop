const fs = require('fs');
const path = require('path');
const https = require('https');
const { guessMimeType } = require('./kdrive-api');

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTag(xmlBlock, localName) {
  const regex = new RegExp(`<(?:[a-zA-Z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${localName}>`, 'i');
  const match = xmlBlock.match(regex);
  return match ? match[1].trim() : '';
}

function hasTag(xmlBlock, localName) {
  const regex = new RegExp(`<(?:[a-zA-Z0-9]+:)?${localName}(?:\\s|>|\\/)`, 'i');
  return regex.test(xmlBlock);
}

class KDriveWebDavClient {
  constructor({ driveId, email, appPassword }) {
    this.driveId = String(driveId || '').trim();
    this.email = String(email || '').trim();
    this.appPassword = String(appPassword || '').trim();
  }

  validateCredentials() {
    if (!this.driveId || !/^\d+$/.test(this.driveId)) {
      throw new Error('KDRIVE_ID manquant ou invalide (ex: 123456).');
    }
    if (!this.email || !this.appPassword) {
      throw new Error(
        'En mode WebDAV, renseignez KDRIVE_EMAIL et KDRIVE_APP_PASSWORD (mot de passe d\'application Infomaniak).'
      );
    }
  }

  getBaseHost() {
    return `${this.driveId}.connect.kdrive.infomaniak.com`;
  }

  getAuthHeader() {
    const token = Buffer.from(`${this.email}:${this.appPassword}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  normalizeDavPath(davPath = '/') {
    if (!davPath || davPath === '1' || davPath === '/') return '/';
    let clean = davPath.startsWith('/') ? davPath : `/${davPath}`;
    return clean;
  }

  encodeDavPath(davPath) {
    return this.normalizeDavPath(davPath)
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }

  requestRaw(method, remotePath, headers = {}, bodyBuffer = null) {
    this.validateCredentials();
    const encodedPath = this.encodeDavPath(remotePath);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: this.getBaseHost(),
          port: 443,
          path: encodedPath,
          method,
          headers: {
            Authorization: this.getAuthHeader(),
            ...headers
          }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(
                new Error(
                  `Accès WebDAV refusé (${res.statusCode}). Vérifiez votre email, votre mot de passe d'application, et que votre offre kDrive inclut WebDAV (sinon utilisez le mode API !).`
                )
              );
              return;
            }
            resolve({ statusCode: res.statusCode, headers: res.headers, buffer });
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Erreur réseau WebDAV : ${err.message}`)));
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });
  }

  async testConnection() {
    await this.listFiles('/');
    return {
      id: this.driveId,
      name: `kDrive WebDAV (#${this.driveId})`,
      usedSize: null,
      totalSize: null,
      mode: 'webdav'
    };
  }

  async listFiles(folderPath = '/') {
    const target = this.normalizeDavPath(folderPath);
    const propfindXml = `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:">
        <d:prop>
          <d:displayname/>
          <d:getcontentlength/>
          <d:getcontenttype/>
          <d:getlastmodified/>
          <d:resourcetype/>
        </d:prop>
      </d:propfind>`;

    const res = await this.requestRaw(
      'PROPFIND',
      target,
      {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(propfindXml)
      },
      Buffer.from(propfindXml, 'utf8')
    );

    if (res.statusCode >= 400) {
      throw new Error(`Erreur WebDAV PROPFIND (HTTP ${res.statusCode}).`);
    }

    const xml = res.buffer.toString('utf8');
    const responseBlocks = xml.match(/<(?:[a-zA-Z0-9]+:)?response[^>]*>[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?response>/gi) || [];
    const normalizedCurrent = target.replace(/\/+$/, '') || '/';

    const items = [];
    for (const block of responseBlocks) {
      const rawHref = decodeXmlEntities(extractTag(block, 'href'));
      let decodedHref = rawHref;
      try {
        const parsedUrl = rawHref.startsWith('http') ? new URL(rawHref).pathname : rawHref;
        decodedHref = decodeURIComponent(parsedUrl);
      } catch (_) {
        decodedHref = rawHref;
      }

      const trimmedHref = decodedHref.replace(/\/+$/, '') || '/';
      if (trimmedHref === normalizedCurrent) {
        continue; // Ignore le dossier courant lui-même
      }

      const resTypeBlock = extractTag(block, 'resourcetype');
      const isDir = hasTag(resTypeBlock, 'collection') || decodedHref.endsWith('/');
      const displayName = decodeXmlEntities(extractTag(block, 'displayname')) || path.posix.basename(trimmedHref);
      const size = Number(extractTag(block, 'getcontentlength') || 0);
      const lastModStr = extractTag(block, 'getlastmodified');
      const updatedAt = lastModStr ? new Date(lastModStr).getTime() : Date.now();
      const contentType = extractTag(block, 'getcontenttype') || guessMimeType(displayName);

      items.push({
        id: trimmedHref,
        name: displayName,
        type: isDir ? 'dir' : 'file',
        size: isDir ? 0 : size,
        mimeType: isDir ? 'inode/directory' : contentType,
        updatedAt,
        hasThumbnail: false,
        path: trimmedHref
      });
    }

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });

    return items;
  }

  async createFolder(parentPath = '/', folderName) {
    const cleanName = String(folderName || '').trim();
    if (!cleanName) throw new Error('Le nom du dossier ne peut pas être vide.');
    const base = this.normalizeDavPath(parentPath).replace(/\/+$/, '');
    const fullPath = `${base}/${cleanName}`;

    const res = await this.requestRaw('MKCOL', fullPath);
    if (res.statusCode >= 400) {
      throw new Error(`Impossible de créer le dossier "${cleanName}" (HTTP ${res.statusCode}).`);
    }
    return { id: fullPath, name: cleanName, type: 'dir' };
  }

  uploadFile(parentPath = '/', localFilePath, onProgress) {
    this.validateCredentials();
    if (!fs.existsSync(localFilePath)) {
      return Promise.reject(new Error(`Fichier introuvable : ${localFilePath}`));
    }

    const stat = fs.statSync(localFilePath);
    const fileName = path.basename(localFilePath);
    const totalSize = stat.size;
    const base = this.normalizeDavPath(parentPath).replace(/\/+$/, '');
    const remotePath = `${base}/${fileName}`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: this.getBaseHost(),
          port: 443,
          path: this.encodeDavPath(remotePath),
          method: 'PUT',
          headers: {
            Authorization: this.getAuthHeader(),
            'Content-Type': guessMimeType(fileName),
            'Content-Length': totalSize
          }
        },
        (res) => {
          res.resume();
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ id: remotePath, name: fileName, type: 'file', size: totalSize });
            } else {
              reject(new Error(`Échec upload WebDAV de "${fileName}" (HTTP ${res.statusCode}).`));
            }
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Erreur réseau WebDAV : ${err.message}`)));

      if (totalSize === 0) {
        if (onProgress) onProgress({ fileName, loaded: 0, total: 0, percent: 100 });
        req.end();
        return;
      }

      let uploaded = 0;
      const stream = fs.createReadStream(localFilePath);
      stream.on('data', (chunk) => {
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
      stream.on('error', (err) => {
        req.destroy();
        reject(err);
      });
      stream.pipe(req);
    });
  }

  async downloadFile(remoteFilePath, destLocalPath) {
    const res = await this.requestRaw('GET', remoteFilePath);
    if (res.statusCode >= 400) {
      throw new Error(`Impossible de télécharger le fichier (HTTP ${res.statusCode}).`);
    }
    fs.writeFileSync(destLocalPath, res.buffer);
    return { savedPath: destLocalPath };
  }

  async getPreviewDataUrl(remoteFilePath, mimeType = 'image/jpeg') {
    const res = await this.requestRaw('GET', remoteFilePath);
    if (res.statusCode >= 400) {
      throw new Error(`Aperçu indisponible (HTTP ${res.statusCode}).`);
    }
    const contentType = res.headers['content-type'] || mimeType;
    return `data:${contentType};base64,${res.buffer.toString('base64')}`;
  }

  async deleteItem(remoteFilePath) {
    const res = await this.requestRaw('DELETE', remoteFilePath);
    if (res.statusCode >= 400) {
      throw new Error(`Suppression refusée (HTTP ${res.statusCode}).`);
    }
    return { deleted: true };
  }
}

module.exports = { KDriveWebDavClient };
