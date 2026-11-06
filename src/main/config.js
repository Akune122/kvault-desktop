const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULT_CONFIG = {
  KDRIVE_CONNECTION_MODE: 'api',
  KDRIVE_ID: '',
  KDRIVE_API_TOKEN: '',
  KDRIVE_EMAIL: '',
  KDRIVE_APP_PASSWORD: '',
  BITWARDEN_SERVER_URL: 'https://vault.bitwarden.eu',
  BITWARDEN_CLIENT_ID: '',
  BITWARDEN_CLIENT_SECRET: ''
};

function getProjectEnvPath(app) {
  // Si lancé en exécutable portable (.exe), cherche un .env à côté du .exe
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const portableEnv = path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env');
    if (fs.existsSync(portableEnv)) {
      return portableEnv;
    }
  }
  // En mode développement / dossier projet
  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  return rootEnv;
}

function getUserConfigJsonPath(app) {
  return path.join(app.getPath('userData'), 'kvault-config.json');
}

function loadConfig(app) {
  const merged = { ...DEFAULT_CONFIG };

  // 1. Charge la sauvegarde locale de l'application (userData)
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

  // 2. Le fichier .env (s'il contient des valeurs renseignées) est prioritaire
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

  return {
    config: merged,
    envPath,
    jsonPath
  };
}

function saveConfig(app, newValues) {
  const { config: current, envPath, jsonPath } = loadConfig(app);
  const updated = { ...current };

  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (newValues[key] !== undefined) {
      updated[key] = String(newValues[key]).trim();
    }
  }

  // Sauvegarde dans userData (fonctionne toujours, même en .exe compilé)
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');

  // Si on est en mode projet ou si un .env existe à côté du .exe, on met aussi à jour .env
  const canWriteEnv = !app.isPackaged || Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  if (canWriteEnv) {
    try {
      const targetEnv = process.env.PORTABLE_EXECUTABLE_DIR
        ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env')
        : envPath;

      const envContent = [
        '# ============================================================================',
        '# KVAULT DESKTOP — VOS IDENTIFIANTS PERSONNELS (PROTÉGÉ PAR .gitignore)',
        '# ============================================================================',
        '',
        '# Mode de connexion : "api" (recommandé, toutes offres kDrive) ou "webdav"',
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
        '# --- Phase 2 : Bitwarden (v0.2.0) ---',
        `BITWARDEN_SERVER_URL=${updated.BITWARDEN_SERVER_URL || 'https://vault.bitwarden.eu'}`,
        `BITWARDEN_CLIENT_ID=${updated.BITWARDEN_CLIENT_ID || ''}`,
        `BITWARDEN_CLIENT_SECRET=${updated.BITWARDEN_CLIENT_SECRET || ''}`,
        ''
      ].join('\n');

      fs.writeFileSync(targetEnv, envContent, 'utf8');
    } catch (_) {
      // En cas de dossier en lecture seule, la sauvegarde userData suffit
    }
  }

  return updated;
}

module.exports = {
  loadConfig,
  saveConfig
};
