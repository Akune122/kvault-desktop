const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function cleanBwStdout(rawStdout) {
  const lines = String(rawStdout || '')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('Could not find dir,') && !line.startsWith('Could not find data file,'));
  return lines.join('\n').trim();
}

function parseBwJson(rawStdout) {
  const cleaned = cleanBwStdout(rawStdout);
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  let start = -1;
  if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
  else start = firstObj !== -1 ? firstObj : firstArr;

  const candidate = start !== -1 ? cleaned.slice(start) : cleaned;
  return JSON.parse(candidate);
}

function formatBwError(rawErr) {
  const msg = String(rawErr || '').trim();
  const lower = msg.toLowerCase();

  if (lower.includes('invalid master password') || lower.includes('master password is required')) {
    return 'Mot de passe maître Bitwarden incorrect.';
  }
  if (lower.includes('username or password is incorrect')) {
    return 'Email ou mot de passe maître incorrect. Vérifiez aussi le serveur sélectionné (bitwarden.eu vs bitwarden.com).';
  }
  if (lower.includes('two-step login code') || lower.includes('two-factor') || lower.includes('2fa')) {
    return 'Double authentification (2FA) requise : saisissez votre code 2FA (Authenticator) ou connectez-vous via Clé API Bitwarden.';
  }
  if (lower.includes('captcha') || lower.includes('new device verification')) {
    return 'Bitwarden demande une vérification appareil/Captcha. Utilisez le mode "Clé API (Client ID + Secret)" qui contourne cette étape officielle !';
  }
  if (lower.includes('client_id') || lower.includes('invalid_client')) {
    return 'Clé API Bitwarden invalide (Client ID ou Client Secret incorrect). Vérifiez aussi le serveur (bitwarden.eu vs bitwarden.com).';
  }
  if (lower.includes('enotfound') || lower.includes('fetcherror') || lower.includes('econnrefused')) {
    return 'Impossible de joindre le serveur Bitwarden. Vérifiez votre connexion Internet et l\'URL du serveur.';
  }
  return msg || 'Erreur lors de la commande Bitwarden.';
}

class BitwardenService {
  constructor(app) {
    this.app = app;
    this.sessionKey = null;
  }

  getDataDir() {
    const dir = path.join(this.app.getPath('userData'), 'bw-vault');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getBwScriptPath() {
    const base = path.resolve(__dirname, '..', '..', 'node_modules', '@bitwarden', 'cli', 'build', 'bw.js');
    const unpacked = base.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
    return base;
  }

  runBw(args, extraEnv = {}, timeoutMs = 45000) {
    const scriptPath = this.getBwScriptPath();
    const dataDir = this.getDataDir();

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      BITWARDENCLI_APPDATA_DIR: dataDir,
      BW_NOINTERACTION: 'true',
      ...extraEnv
    };

    const fullArgs = [scriptPath, ...args, '--nointeraction'];

    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        fullArgs,
        {
          env,
          timeout: timeoutMs,
          maxBuffer: 25 * 1024 * 1024,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          const cleanOut = cleanBwStdout(stdout);
          const cleanErr = String(stderr || '').trim();

          if (error) {
            const combined = cleanErr || cleanOut || error.message;
            reject(new Error(formatBwError(combined)));
            return;
          }
          resolve({ stdout: cleanOut, stderr: cleanErr });
        }
      );
    });
  }

  async getStatus() {
    const args = ['status'];
    if (this.sessionKey) {
      args.push('--session', this.sessionKey);
    }

    const { stdout } = await this.runBw(args);
    const parsed = parseBwJson(stdout);

    if (parsed.status !== 'unlocked') {
      this.sessionKey = null;
    }

    return {
      status: parsed.status || 'unauthenticated', // 'unauthenticated' | 'locked' | 'unlocked'
      serverUrl: parsed.serverUrl || 'https://vault.bitwarden.eu',
      userEmail: parsed.userEmail || '',
      lastSync: parsed.lastSync || null
    };
  }

  normalizeServerUrl(url) {
    const clean = String(url || 'https://vault.bitwarden.eu').trim().replace(/\/+$/, '');
    return clean || 'https://vault.bitwarden.eu';
  }

  async ensureServerConfigured(targetServerUrl) {
    const desired = this.normalizeServerUrl(targetServerUrl);
    const current = await this.getStatus();
    const currentNorm = this.normalizeServerUrl(current.serverUrl || '');

    if (currentNorm.toLowerCase() !== desired.toLowerCase()) {
      if (current.status !== 'unauthenticated') {
        this.sessionKey = null;
        try {
          await this.runBw(['logout']);
        } catch (_) {
          // Ignore
        }
      }
      await this.runBw(['config', 'server', desired]);
    }
  }

  async loginAndUnlock({
    authMode = 'apikey',
    serverUrl,
    clientId,
    clientSecret,
    email,
    masterPassword,
    twoFactorCode
  }) {
    if (!masterPassword) {
      throw new Error('Veuillez saisir votre Mot de passe maître Bitwarden.');
    }

    await this.ensureServerConfigured(serverUrl);
    const st = await this.getStatus();

    if (st.status === 'unauthenticated') {
      if (authMode === 'apikey') {
        if (!clientId || !clientSecret) {
          throw new Error(
            'Renseignez BITWARDEN_CLIENT_ID et BITWARDEN_CLIENT_SECRET (dans .env ou Paramètres), ou basculez sur la connexion Email + Mot de passe.'
          );
        }
        await this.runBw(['login', '--apikey'], {
          BW_CLIENTID: String(clientId).trim(),
          BW_CLIENTSECRET: String(clientSecret).trim()
        });
      } else {
        if (!email) {
          throw new Error('Veuillez saisir votre adresse email Bitwarden.');
        }
        const loginArgs = ['login', String(email).trim(), '--passwordenv', 'BW_MASTER_PASS', '--raw'];
        if (twoFactorCode && String(twoFactorCode).trim() !== '') {
          loginArgs.push('--method', '0', '--code', String(twoFactorCode).trim());
        }
        const { stdout: loginToken } = await this.runBw(loginArgs, {
          BW_MASTER_PASS: String(masterPassword)
        });
        if (loginToken && loginToken.length > 16) {
          this.sessionKey = loginToken.split(/\r?\n/).pop().trim();
        }
      }
    }

    // Déverrouillage de la clé de session locale en RAM
    if (!this.sessionKey) {
      const { stdout: unlockToken } = await this.runBw(
        ['unlock', '--passwordenv', 'BW_MASTER_PASS', '--raw'],
        { BW_MASTER_PASS: String(masterPassword) }
      );
      const token = unlockToken.split(/\r?\n/).pop().trim();
      if (!token) {
        throw new Error('Impossible d\'obtenir la clé de session Bitwarden.');
      }
      this.sessionKey = token;
    }

    // Synchronise le coffre-fort
    try {
      await this.runBw(['sync', '--session', this.sessionKey]);
    } catch (_) {
      // Utilise le cache si hors-ligne temporaire
    }

    const updatedStatus = await this.getStatus();
    const items = await this.listItems();
    return {
      status: updatedStatus,
      items
    };
  }

  async unlock(masterPassword) {
    if (!masterPassword) {
      throw new Error('Veuillez saisir votre Mot de passe maître Bitwarden.');
    }

    const { stdout: unlockToken } = await this.runBw(
      ['unlock', '--passwordenv', 'BW_MASTER_PASS', '--raw'],
      { BW_MASTER_PASS: String(masterPassword) }
    );

    const token = unlockToken.split(/\r?\n/).pop().trim();
    if (!token) {
      throw new Error('Échec du déverrouillage du coffre-fort.');
    }
    this.sessionKey = token;

    try {
      await this.runBw(['sync', '--session', this.sessionKey]);
    } catch (_) {
      // Ignore
    }

    const updatedStatus = await this.getStatus();
    const items = await this.listItems();
    return {
      status: updatedStatus,
      items
    };
  }

  normalizeVaultItem(raw) {
    // Bitwarden types: 1 = Login, 2 = Secure Note, 3 = Card, 4 = Identity
    const typeMap = { 1: 'login', 2: 'note', 3: 'card', 4: 'identity' };
    const type = typeMap[raw.type] || 'other';
    const uris = Array.isArray(raw.login?.uris)
      ? raw.login.uris.map((u) => u.uri).filter(Boolean)
      : [];

    return {
      id: raw.id,
      name: raw.name || 'Sans titre',
      type,
      favorite: Boolean(raw.favorite),
      notes: raw.notes || '',
      revisionDate: raw.revisionDate || null,
      login: raw.login
        ? {
            username: raw.login.username || '',
            password: raw.login.password || '',
            hasTotp: Boolean(raw.login.totp),
            uris
          }
        : null,
      card: raw.card
        ? {
            cardholderName: raw.card.cardholderName || '',
            brand: raw.card.brand || '',
            number: raw.card.number || '',
            expMonth: raw.card.expMonth || '',
            expYear: raw.card.expYear || '',
            code: raw.card.code || ''
          }
        : null,
      identity: raw.identity
        ? {
            firstName: raw.identity.firstName || '',
            lastName: raw.identity.lastName || '',
            email: raw.identity.email || '',
            phone: raw.identity.phone || '',
            company: raw.identity.company || ''
          }
        : null
    };
  }

  async listItems() {
    if (!this.sessionKey) {
      throw new Error('Le coffre-fort Bitwarden est verrouillé.');
    }

    const { stdout } = await this.runBw(['list', 'items', '--session', this.sessionKey]);
    const rawItems = parseBwJson(stdout);
    if (!Array.isArray(rawItems)) return [];

    const items = rawItems.map((it) => this.normalizeVaultItem(it));
    items.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
    return items;
  }

  async syncVault() {
    if (!this.sessionKey) {
      throw new Error('Déverrouillez d\'abord le coffre-fort.');
    }
    await this.runBw(['sync', '--session', this.sessionKey]);
    const items = await this.listItems();
    const status = await this.getStatus();
    return { status, items };
  }

  async getTotpCode(itemId) {
    if (!this.sessionKey) {
      throw new Error('Le coffre-fort est verrouillé.');
    }
    const { stdout } = await this.runBw(['get', 'totp', String(itemId), '--session', this.sessionKey]);
    return stdout.split(/\r?\n/).pop().trim();
  }

  async createLoginItem({ name, username, password, uri, notes, favorite = false }) {
    if (!this.sessionKey) {
      throw new Error('Déverrouillez d\'abord votre coffre Bitwarden.');
    }
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new Error('Le nom de l\'identifiant est obligatoire.');
    }

    const payload = {
      organizationId: null,
      collectionIds: null,
      folderId: null,
      type: 1,
      name: cleanName,
      notes: String(notes || '').trim() || null,
      favorite: Boolean(favorite),
      fields: [],
      login: {
        uris: uri
          ? [{ match: null, uri: String(uri).trim() }]
          : [],
        username: String(username || '').trim() || null,
        password: String(password || '') || null,
        totp: null
      },
      secureNote: null,
      card: null,
      identity: null,
      reprompt: 0
    };

    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const { stdout } = await this.runBw(['create', 'item', encoded, '--session', this.sessionKey]);
    const created = parseBwJson(stdout);
    return this.normalizeVaultItem(created);
  }

  async deleteVaultItem(itemId) {
    if (!this.sessionKey) {
      throw new Error('Déverrouillez d\'abord votre coffre Bitwarden.');
    }
    await this.runBw(['delete', 'item', String(itemId), '--session', this.sessionKey]);
    return { deleted: true };
  }

  async lockVault() {
    this.sessionKey = null;
    try {
      await this.runBw(['lock']);
    } catch (_) {
      // Ignore
    }
    return this.getStatus();
  }

  async logoutVault() {
    this.sessionKey = null;
    try {
      await this.runBw(['logout']);
    } catch (_) {
      // Ignore
    }
    return this.getStatus();
  }

  generatePassword({
    length = 20,
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true
  } = {}) {
    const safeLen = Math.max(6, Math.min(128, Number(length) || 20));
    const pools = [];
    if (uppercase) pools.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (lowercase) pools.push('abcdefghijkmnopqrstuvwxyz');
    if (numbers) pools.push('23456789');
    if (symbols) pools.push('!@#$%^&*-_=+?');

    if (pools.length === 0) {
      pools.push('abcdefghijkmnopqrstuvwxyz23456789');
    }

    const allChars = pools.join('');
    const chars = [];

    // Garantit au moins 1 caractère de chaque catégorie cochée
    for (const pool of pools) {
      chars.push(pool[crypto.randomInt(0, pool.length)]);
    }

    while (chars.length < safeLen) {
      chars.push(allChars[crypto.randomInt(0, allChars.length)]);
    }

    // Mélange Fisher-Yates cryptographique
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  }
}

module.exports = { BitwardenService };
