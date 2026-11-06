const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNER = 'Akune122';
const REPO = 'kvault-desktop';

function getGitHubTokenFromGitCredential() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();

  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execFileSync('git', ['credential', 'fill'], {
    input,
    encoding: 'utf8'
  });

  const match = out.match(/^password=(.+)$/m);
  if (!match) {
    throw new Error('Aucun token GitHub trouvé dans Git Credential Manager.');
  }
  return match[1].trim();
}

function buildReleaseBody(version) {
  return `## 🚀 KVault Desktop \`v${version}\` — Coffre-fort Bitwarden & Verrouillage Sécurisé

Bienvenue dans la version **\`v${version}\`** de **KVault Desktop**, l'application Windows tout-en-un qui réunit votre cloud **Infomaniak kDrive** et votre gestionnaire de mots de passe **Bitwarden / Vaultwarden**.

---

### ✨ Nouveautés majeures de la \`v${version}\`

- 🛡️ **Écran de verrouillage au démarrage (\`APP_LOCK_CODE\`)** :
  - Protection de l'application par code PIN (pavé numérique interactif) ou mot de passe complet.
  - **Code initial par défaut : \`0000\`** — modifiable à tout moment directement depuis **⚙️ Paramètres & Sécurité** dans l'application (aucun fichier \`.env\` requis pour les utilisateurs du \`.exe\` !).
  - Bouton **🔒 Verrouiller** accessible en permanence dans la barre supérieure.
- 🔐 **Coffre-fort Bitwarden & Vaultwarden intégré** :
  - Déchiffrement **100 % local** (votre Mot de passe maître ne quitte jamais votre ordinateur et n'est jamais écrit sur le disque).
  - Compatible **Bitwarden Europe (\`vault.bitwarden.eu\`)**, **Bitwarden US (\`vault.bitwarden.com\`)** et serveurs auto-hébergés **Vaultwarden**.
  - Connexion par **Clé API (\`Client ID\` + \`Client Secret\`)** *(recommandé)* ou par **Email + Mot de passe maître + 2FA**.
  - Recherche instantanée, filtres (*Favoris, Identifiants, Notes, Cartes*), ajout/suppression d'identifiants et récupération des codes **2FA TOTP**.
- 📋 **Presse-papiers auto-nettoyant & Générateur** :
  - Copie en 1 clic avec **effacement automatique du presse-papiers Windows après 20 secondes**.
  - Générateur cryptographique de mots de passe forts (8 à 64 caractères).
- ☁️ **Toujours inclus depuis la \`v0.1.0\`** :
  - Explorateur complet **Infomaniak kDrive** (API REST officielle & WebDAV), sauvegarde *Drag & Drop*, aperçu photo HD et suivi du quota disque.

---

### 📦 Téléchargement & Utilisation rapide (\`.exe\`)

1. Téléchargez le fichier **\`KVault-Desktop-${version}-Portable.exe\`** ci-dessous dans la section **Assets**.
2. Lancez l'application et tapez le code par défaut **\`0000\`**.
3. Allez dans **⚙️ Paramètres & Sécurité** pour personnaliser votre code d'accès et connecter vos comptes **kDrive** et **Bitwarden** !`;
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const version = pkg.version;
  const tagName = `v${version}`;
  const exeName = `KVault-Desktop-${version}-Portable.exe`;
  const exePath = path.resolve(__dirname, '..', 'dist', exeName);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Exécutable introuvable : ${exePath}. Lancez d'abord "npm run build:exe".`);
  }

  const token = getGitHubTokenFromGitCredential();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'KVault-Desktop-Release-Script'
  };

  console.log(`Création ou récupération de la Release GitHub ${tagName}...`);
  let release = null;

  const existingRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tagName}`, { headers });
  if (existingRes.ok) {
    release = await existingRes.json();
    const updateRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `KVault Desktop ${tagName} — Module Bitwarden & Verrouillage Sécurisé`,
        body: buildReleaseBody(version),
        draft: false,
        prerelease: false
      })
    });
    release = await updateRes.json();
  } else {
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tagName,
        target_commitish: 'main',
        name: `KVault Desktop ${tagName} — Module Bitwarden & Verrouillage Sécurisé`,
        body: buildReleaseBody(version),
        draft: false,
        prerelease: false
      })
    });
    if (!createRes.ok) {
      throw new Error(`Erreur API GitHub création release (${createRes.status}): ${await createRes.text()}`);
    }
    release = await createRes.json();
  }

  // Supprime l'ancien asset du même nom s'il existe déjà
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      if (asset.name === exeName) {
        await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`, {
          method: 'DELETE',
          headers
        });
      }
    }
  }

  console.log(`Envoi de ${exeName} sur la Release GitHub (cela peut prendre quelques secondes)...`);
  const fileBuffer = fs.readFileSync(exePath);
  const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(exeName)}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileBuffer.length)
    },
    body: fileBuffer
  });

  if (!uploadRes.ok) {
    throw new Error(`Erreur lors de l'upload du .exe (${uploadRes.status}): ${await uploadRes.text()}`);
  }

  console.log(`Release publiée avec succès : ${release.html_url}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
