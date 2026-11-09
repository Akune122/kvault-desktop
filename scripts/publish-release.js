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
  return `KVault Desktop ${tagName} — Galerie Multimédia Streaming & Intégration Windows Pro`;
}

function buildReleaseBody(version) {
  return `## 🚀 KVault Desktop \`v${version}\` — Galerie Multimédia Streaming & Intégration Windows Pro

Bienvenue dans la version **\`v${version}\`** de **KVault Desktop**, l'application Windows tout-en-un qui réunit votre cloud **Infomaniak kDrive** et votre coffre-fort de mots de passe **Bitwarden / Vaultwarden**.

---

### ✨ Nouveautés majeures de la \`v${version}\`

#### 🖼️ Pack Multimédia & Galerie Photo kDrive
- **Miniatures photos réelles** : affichage instantané des aperçus dans la grille et la liste avec **cache disque local** (\`thumb-cache\`) pour une navigation ultra-fluide.
- **Visionneuse universelle en streaming** *(sans téléchargement préalable sur le PC)* :
  - **Vidéos & Musiques** (\`.mp4\`, \`.webm\`, \`.mov\`, \`.mkv\`, \`.mp3\`, \`.flac\`, \`.wav\`, \`.m4a\`) diffusées en direct avec avance rapide HTTP \`Range\`.
  - **Lecteur PDF natif intégré** et lecteur **Texte / Code / JSON / Markdown / CSV**.
  - **Photos HD** avec zoom interactif (\`-\` / \`100%\` / \`+\` + molette souris) et navigation Galerie (\`❮\` / \`❯\` ou flèches clavier \`←\` / \`→\`).

#### 🪟 Pack Intégration Windows Pro & Gestion Avancée kDrive
- **System Tray Windows** : icône KVault près de l'horloge Windows avec menu rapide (*Ouvrir*, *Verrouiller maintenant*, *Quitter complètement*) et réduction en arrière-plan à la fermeture (\`MINIMIZE_TO_TRAY\`).
- **Verrouillage automatique par inactivité (\`AUTO_LOCK_MINUTES\`)** : verrouille automatiquement KVault Desktop et votre coffre Bitwarden après \`2\`, \`5\`, \`10\`, \`15\` ou \`30\` min d'inactivité Windows *(suspendu automatiquement pendant la lecture d'un film ou d'un fichier audio)*.
- **Liens de partage publics kDrive en 1 clic** : générez, copiez dans le presse-papiers ou désactivez un lien public Infomaniak directement depuis une carte ou le clic-droit.
- **Menu Clic-Droit, Renommer & Déplacer vers...** : organisez vos fichiers et dossiers kDrive avec un explorateur de destination intégré.

---

### 📦 Téléchargement & Utilisation rapide (\`.exe\`)

1. Téléchargez le fichier **\`KVault-Desktop-${version}-Portable.exe\`** ci-dessous dans la section **Assets**.
2. Lancez l'application et tapez votre code d'accès (**\`0000\`** par défaut lors d'une première installation).
3. Profitez de vos espaces **Infomaniak kDrive** et **Bitwarden** directement depuis votre bureau ou la barre des tâches Windows !`;
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
