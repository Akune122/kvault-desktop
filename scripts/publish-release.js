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
  return `KVault Desktop ${tagName} — Sync Cloud Budget Couple, Liste de Courses, Bilan 12 Mois & Éditeur Cloud kDrive`;
}

function buildReleaseBody(version) {
  return `## 🚀 KVault Desktop \`v${version}\` — Budget Couple Cloud Partagé & Éditeur Cloud Direct kDrive

Bienvenue dans la version **\`v${version}\`** de **KVault Desktop**, l'application Windows tout-en-un qui réunit votre cloud **Infomaniak kDrive**, votre coffre-fort de mots de passe **Bitwarden / Vaultwarden** et votre gestionnaire complet de **Dépenses & Budget de Couple**.

---

### ✨ Nouveautés majeures de la \`v${version}\`

#### 💑 Pack 1 — Budget Couple "Niveau Pro & Cloud Partagé"
- **☁️ Synchronisation Cloud partagée sur kDrive (\`/Budget Couple/couple-budget.json\`)** :
  - Synchronisez et fusionnez intelligemment votre budget directement sur votre kDrive Infomaniak en 1 clic (**\`☁️ Sync kDrive\`**) ou automatiquement à chaque modification.
  - Idéal pour partager exactement les mêmes comptes, dépenses, échéances et listes de courses entre vos **2 PC** !
- **✏️ Édition complète des dépenses et des échéances récurrentes** :
  - Bouton **\`✏️\`** sur chaque dépense et chaque paiement récurrent pour corriger un montant, changer le payeur, ajuster la répartition, modifier la date ou ajouter un justificatif kDrive après coup.
- **🛒 Liste de courses partagée & Conversion 1-clic en Dépense** :
  - Nouvel onglet **\`Liste de courses\`** pour noter vos achats à prévoir à deux (article, quantité, prix estimé, ajouté par Loïc / Cloé).
  - Cochez vos articles en faisant les courses puis cliquez sur **\`🧾 Convertir les cochés en Dépense\`** : la dépense commune est pré-remplie automatiquement avec la somme et le détail des articles en note !
- **📈 Bilan Annuel, Graphiques 12 mois & Exports CSV / Rapport PDF** :
  - Nouvel onglet **\`Bilan & Export\`** avec graphique interactif sur 12 mois, total annuel, moyenne mensuelle et premier poste de dépense.
  - Export **\`📊 Exporter CSV (Excel)\`** (encodage UTF-8 BOM compatible Excel) et **\`🖨️ Bilan Imprimable / PDF\`** en 1 clic.

#### 📝 Pack 3 — Éditeur Cloud Direct & Création de Notes / Markdown sur kDrive
- **✏️ Éditeur Cloud Direct dans la visionneuse (sans télécharger)** :
  - Ouvrez n'importe quel fichier texte, Markdown (\`.md\`), JSON, CSV, script ou note sur votre kDrive, cliquez sur **\`✏️ Modifier dans le cloud\`**, éditez votre texte et cliquez sur **\`💾 Enregistrer sur kDrive\`** : le fichier est mis à jour directement sur le cloud Infomaniak !
  - Bouton **\`👁 Aperçu Markdown\`** pour basculer entre le rendu Markdown mis en page et le code brut.
- **📝 Création rapide de Note / Document Markdown (\`+ Note\`)** :
  - Nouveau bouton **\`📝 + Note\`** dans la barre d'outils de l'explorateur kDrive avec barre de formatage Markdown (\`H1\`, \`Gras\`, \`Liste\`, \`Tâche\`, \`Code\`, \`Aperçu\`) pour créer des notes directement dans le dossier kDrive courant.

---

### 📦 Téléchargement & Utilisation rapide (\`.exe\`)

1. Téléchargez le fichier **\`KVault-Desktop-${version}-Portable.exe\`** ci-dessous dans la section **Assets**.
2. Lancez l'application (ou utilisez **\`⚙️ Paramètres & Sécurité\` → \`🔄 Vérifier les mises à jour\`** depuis une version précédente).`;
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
