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

function buildReleaseTitle(tagName) {
  return `KVault Desktop ${tagName} — Explorateur kDrive Power-User & Quick-Vault Windows`;
}

function buildReleaseBody(version) {
  return `## 🚀 KVault Desktop \`v${version}\` — Explorateur kDrive Power-User & Expérience Windows Productivité

Bienvenue dans la version **\`v${version}\`** de **KVault Desktop**, l'application Windows tout-en-un qui réunit votre cloud **Infomaniak kDrive** et votre coffre-fort de mots de passe **Bitwarden / Vaultwarden**.

---

### ✨ Nouveautés majeures de la \`v${version}\`

#### 🗂️ Pack Explorateur kDrive "Power-User"
- **Multi-sélection & Actions groupées (Batch)** :
  - Cases à cocher sur les cartes fichiers, sélection rapide avec \`Ctrl + Clic\` et bouton **\`☑️ Tout\`** dans la barre d'outils.
  - Barre flottante d'actions groupées : **Télécharger la sélection** *(choisissez un dossier Windows une seule fois)*, **Déplacer vers...** et **Supprimer en lot**.
- **Tri personnalisé & Recherche globale kDrive** :
  - Tri instantané par **Nom (\`A → Z\` / \`Z → A\`)**, **Date (\`Plus récents\` / \`Plus anciens\`)** ou **Taille (\`Plus volumineux\` / \`Plus légers\`)** (les dossiers restent toujours groupés en tête).
  - Bouton **\`🌐 Tout kDrive\`** (\`Entrée\`) pour rechercher un fichier ou dossier dans l'intégralité de votre kDrive via l'API Infomaniak.
- **⭐ Favoris kDrive & 🗑️ Corbeille kDrive intégrée** :
  - Épinglez vos dossiers et fichiers fréquents dans **\`⭐ Favoris kDrive\`** via le clic-droit ou le bouton étoile.
  - Gérez votre **\`🗑️ Corbeille kDrive\`** directement dans l'application : **Restaurer** un ou plusieurs éléments, **Supprimer définitivement** ou **Vider la corbeille**.

#### ⚡ Pack Expérience Windows "Productivité"
- **Palette globale Quick-Vault (\`Ctrl+Maj+K\` partout dans Windows)** :
  - Appuyez sur **\`Ctrl+Maj+K\`** depuis n'importe quel navigateur, jeu ou logiciel Windows pour faire surgir la recherche rapide **Bitwarden Quick-Vault** au premier plan.
  - Navigation 100 % clavier (\`↑\` / \`↓\`, \`Entrée\` pour copier le mot de passe avec purge auto 20s, \`Ctrl+U\` pour l'identifiant, \`Ctrl+T\` pour le code 2FA TOTP, déverrouillage express intégré si le coffre est verrouillé).
- **Démarrage automatique avec Windows (\`LAUNCH_AT_STARTUP\`)** :
  - Option activable en 1 clic dans **⚙️ Paramètres & Sécurité** pour lancer KVault Desktop discrètement dans le System Tray à l'ouverture de session Windows.
- **Vérificateur de mise à jour GitHub intégré** :
  - Vérifiez en 1 clic depuis **⚙️ Paramètres & Sécurité** si une nouvelle version GitHub Release est disponible et téléchargez directement le nouveau \`.exe\`.

---

### 📦 Téléchargement & Utilisation rapide (\`.exe\`)

1. Téléchargez le fichier **\`KVault-Desktop-${version}-Portable.exe\`** ci-dessous dans la section **Assets**.
2. Lancez l'application et tapez votre code d'accès (**\`0000\`** par défaut lors d'une première installation).
3. Utilisez **\`Ctrl+Maj+K\`** à tout moment sous Windows pour ouvrir votre palette **Quick-Vault Bitwarden** !`;
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
        name: buildReleaseTitle(tagName),
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
        name: buildReleaseTitle(tagName),
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
