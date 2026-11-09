const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_CONFIG = {
  APP_LOCK_CODE: '0000',
  AUTO_LOCK_MINUTES: '10',
  MINIMIZE_TO_TRAY: 'true',
  GLOBAL_SHORTCUT: 'CommandOrControl+Shift+K',
  LAUNCH_AT_STARTUP: 'false',
  KDRIVE_CONNECTION_MODE: 'api',
  KDRIVE_ID: '',
  KDRIVE_API_TOKEN: '',
  KDRIVE_EMAIL: '',
  KDRIVE_APP_PASSWORD: '',
  BITWARDEN_SERVER_URL: 'https://vault.bitwarden.eu',
  BITWARDEN_EMAIL: '',
  BITWARDEN_CLIENT_ID: '',
  BITWARDEN_CLIENT_SECRET: ''
};

function getProjectEnvPath(app) {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env');
  }
  if (!app.isPackaged) {
    return path.resolve(__dirname, '..', '..', '.env');
  }
  return path.join(path.dirname(process.execPath), '.env');
}

function getUserConfigJsonPath(app) {
  return path.join(app.getPath('userData'), 'kvault-config.json');
}

function loadConfig(app) {
  const merged = { ...DEFAULT_CONFIG };

  // 1. Charge la sauvegarde locale de l'application (userData — utilisée notamment par le .exe)
  const jsonPath = getUserConfigJsonPath(app);
  if (fs.existsSync(jsonPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (saved[key] !== undefined && saved[key] !== '') {
          merged[key] = String(saved[key]).trim();
        }
      }
    } catch (_) {
      // Ignore fichier JSON corrompu
    }
  }

  // 2. Si un fichier .env existe, ses valeurs renseignées s'appliquent
  const envPath = getProjectEnvPath(app);
  if (fs.existsSync(envPath)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (parsed[key] !== undefined && String(parsed[key]).trim() !== '') {
          merged[key] = String(parsed[key]).trim();
        }
      }
    } catch (_) {
      // Ignore erreur de lecture .env
    }
  }

  if (!merged.APP_LOCK_CODE) {
    merged.APP_LOCK_CODE = '0000';
  }

  return {
    config: merged,
    envPath,
    hasEnvFile: fs.existsSync(envPath),
    jsonPath
  };
}

function writeEnvFile(targetEnvPath, updated) {
  const envContent = [
    '# ============================================================================',
    '# KVAULT DESKTOP — VOS IDENTIFIANTS PERSONNELS (PROTÉGÉ PAR .gitignore)',
    '# ============================================================================',
    '',
    '# 🛡️ Sécurité, Raccourci Global & Intégration Windows',
    `APP_LOCK_CODE=${updated.APP_LOCK_CODE || '0000'}`,
    `AUTO_LOCK_MINUTES=${updated.AUTO_LOCK_MINUTES ?? '10'}`,
    `MINIMIZE_TO_TRAY=${updated.MINIMIZE_TO_TRAY || 'true'}`,
    `GLOBAL_SHORTCUT=${updated.GLOBAL_SHORTCUT || 'CommandOrControl+Shift+K'}`,
    `LAUNCH_AT_STARTUP=${updated.LAUNCH_AT_STARTUP || 'false'}`,
    '',
    '# ☁️ Mode de connexion kDrive : "api" (recommandé, toutes offres) ou "webdav"',
    `KDRIVE_CONNECTION_MODE=${updated.KDRIVE_CONNECTION_MODE || 'api'}`,
    '',
    '# 1️⃣ Votre numéro ID kDrive (visible dans l\'URL web kDrive : .../drive/123456/...)',
    `KDRIVE_ID=${updated.KDRIVE_ID || ''}`,
    '',
    '# 2️⃣ Votre Token API Infomaniak (avec le scope "drive")',
    `KDRIVE_API_TOKEN=${updated.KDRIVE_API_TOKEN || ''}`,
    '',
    '# --- Alternative WebDAV (uniquement si KDRIVE_CONNECTION_MODE=webdav) ---',
    `KDRIVE_EMAIL=${updated.KDRIVE_EMAIL || ''}`,
    `KDRIVE_APP_PASSWORD=${updated.KDRIVE_APP_PASSWORD || ''}`,
    '',
    '# 🔐 Coffre-fort Bitwarden / Vaultwarden',
    `BITWARDEN_SERVER_URL=${updated.BITWARDEN_SERVER_URL || 'https://vault.bitwarden.eu'}`,
    `BITWARDEN_EMAIL=${updated.BITWARDEN_EMAIL || ''}`,
    `BITWARDEN_CLIENT_ID=${updated.BITWARDEN_CLIENT_ID || ''}`,
    `BITWARDEN_CLIENT_SECRET=${updated.BITWARDEN_CLIENT_SECRET || ''}`,
    ''
  ].join('\n');

  fs.writeFileSync(targetEnvPath, envContent, 'utf8');
}

function saveConfig(app, newValues) {
  const { config: current, envPath, hasEnvFile, jsonPath } = loadConfig(app);
  const updated = { ...current };

  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (newValues[key] !== undefined) {
      updated[key] = String(newValues[key]).trim();
    }
  }

  if (!updated.APP_LOCK_CODE) {
    updated.APP_LOCK_CODE = '0000';
  }

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');

  if (!app.isPackaged || hasEnvFile) {
    try {
      writeEnvFile(envPath, updated);
    } catch (_) {
      // Dossier en lecture seule : userData assure la persistance
    }
  }

  return updated;
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  writeEnvFile
};
