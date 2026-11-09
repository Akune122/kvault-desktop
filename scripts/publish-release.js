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
  return `KVault Desktop ${tagName} — Module Budget & Dépenses de Couple`;
}

function buildReleaseBody(version) {
  return `## 🚀 KVault Desktop \`v${version}\` — Module Budget & Dépenses de Couple

Bienvenue dans la version **\`v${version}\`** de **KVault Desktop**, l'application Windows tout-en-un qui réunit votre cloud **Infomaniak kDrive**, votre coffre-fort de mots de passe **Bitwarden / Vaultwarden** et désormais votre gestionnaire complet de **Dépenses & Budget de Couple**.

---

### ✨ Nouveautés majeures de la \`v${version}\`

#### 💑 Nouveau Module : Dépenses & Budget de Couple
- **Calcul automatique de l'équilibre ("Qui doit combien à qui ?")** :
  - Séparation des **2 profils personnalisables** (prénoms, emojis, revenus mensuels optionnels).
  - Règles de partage flexibles sur chaque dépense : **50% / 50%**, **Prorata automatique des revenus** (ex: \`60% / 40%\`), **Pourcentage personnalisé**, **Montant exact en €** ou **Avance 100%**.
  - Calcul en temps réel de la part théorique vs dépenses payées par chacun et bouton **\`✅ Marquer comme remboursé\`** en 1 clic avec historique des virements.
- **Statut de paiement & Justificatifs liés à kDrive** :
  - Basculez une dépense entre **\`✅ Payé\`** et **\`⏳ À payer\`** en un clic, ajoutez des infos/notes et filtrez par payeur, statut ou catégorie (*Courses*, *Loyer*, *Factures*, *Resto*, *Maison*, *Vacances*).
  - **📎 Factures & Tickets de caisse sur kDrive** : joignez un PDF ou une photo de ticket directement depuis une dépense — il est sauvegardé automatiquement dans le dossier \`Justificatifs Budget\` de votre kDrive et s'ouvre dans la visionneuse intégrée !
- **📅 Calendrier mensuel & Paiements récurrents** :
  - Planifiez vos charges fixes mensuelles (*Loyer*, *Électricité*, *Fibre Internet*, *Abonnements*) avec leur jour de prélèvement.
  - Visualisez-les sur le **calendrier mensuel** (\`✅ Payé\`, \`⏳ À venir\`, \`⚠️ En retard\`) et pointez-les en 1 clic dès qu'elles sont payées pour les injecter dans les dépenses du mois.
- **🎯 Cagnottes & Projets communs à deux** :
  - Créez des cagnottes pour vos projets (*Vacances*, *Équipement maison*, *Cadeaux*) et suivez la barre de progression bicolore avec les contributions de chacun.

---

### 📦 Téléchargement & Utilisation rapide (\`.exe\`)

1. Téléchargez le fichier **\`KVault-Desktop-${version}-Portable.exe\`** ci-dessous dans la section **Assets**.
2. Lancez l'application et tapez votre code d'accès (**\`0000\`** par défaut lors d'une première installation).
3. Ouvrez l'onglet **\`💑 Dépenses Couple\`** dans la barre latérale gauche !`;
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
