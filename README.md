<div align="center">

<img src="./assets/banner.svg" alt="KVault Desktop Banner" width="100%" />

<br />

[![Version](https://img.shields.io/badge/version-0.6.0-0098FF?style=for-the-badge&logo=semanticrelease&logoColor=white)](https://github.com/Akune122/kvault-desktop/releases)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011%20(.exe)-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Akune122/kvault-desktop/releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Infomaniak kDrive](https://img.shields.io/badge/Cloud-Infomaniak%20kDrive-00E5FF?style=for-the-badge&logo=icloud&logoColor=white)](#1-configuration-infomaniak-kdrive)
[![Bitwarden](https://img.shields.io/badge/Vault-Bitwarden%20%2F%20Vaultwarden-10B981?style=for-the-badge&logo=bitwarden&logoColor=white)](#2-configuration-bitwarden--vaultwarden)
[![License](https://img.shields.io/badge/License-MIT-818CF8?style=for-the-badge)](./LICENSE)

<p align="center">
  <strong>Hub personnel sécurisé sur Windows (<code>.exe</code>) réunissant un explorateur, éditeur cloud &amp; galerie multimédia <a href="https://www.infomaniak.com/fr/ksuite/kdrive">Infomaniak kDrive</a>, un gestionnaire de mots de passe <a href="https://bitwarden.com/">Bitwarden / Vaultwarden</a> avec Quick-Vault (<code>Ctrl+Maj+K</code>) et un gestionnaire complet de <strong>Budget &amp; Dépenses de Couple synchronisé dans le Cloud</strong>.</strong>
</p>

</div>

---

## 📥 Téléchargement direct (`.exe` Windows)

<div align="center">

[![Télécharger KVault Desktop v0.6.0 (.exe)](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_T%C3%A9l%C3%A9charger_KVault--Desktop--0.6.0--Portable.exe-0098FF?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Akune122/kvault-desktop/releases/download/v0.6.0/KVault-Desktop-0.6.0-Portable.exe)

</div>

Vous souhaitez utiliser l'application directement sans installer Node.js ?
1. Cliquez sur le bouton ci-dessus ou rendez-vous dans l'onglet **[Releases GitHub](https://github.com/Akune122/kvault-desktop/releases/tag/v0.6.0)** pour télécharger **`KVault-Desktop-0.6.0-Portable.exe`**.
2. Lancez l'exécutable : le **code de déverrouillage initial par défaut est `0000`**.
3. Rendez-vous dans **⚙️ Paramètres & Sécurité** dans l'application pour définir votre propre code/mot de passe et connecter votre **kDrive** ainsi que votre coffre **Bitwarden** !

---

## ✨ Fonctionnalités principales (`v0.6.0`)

| Module | Fonctionnalités incluses |
| :--- | :--- |
| 💑 **Budget & Dépenses Couple (Cloud Sync)** | **Synchronisation Cloud partagée sur kDrive** (`/Budget Couple/couple-budget.json`) entre vos 2 PC, **2 profils personnalisables**, calcul automatique **"Qui doit combien à qui"** (`50/50`, prorata revenus, `%`, montant exact), **Édition complète (`✏️`)**, **Liste de courses partagée convertible en 1 clic en dépense**, **Calendrier récurrent**, **Cagnottes**, **Bilan 12 mois** & **Exports CSV (Excel) / PDF**. |
| 📝 **Éditeur Cloud Direct & Notes kDrive** | **Modification directe des fichiers texte / code / JSON / Markdown dans le cloud** sans téléchargement préalable (`✏️ Modifier dans le cloud` + `💾 Enregistrer sur kDrive`), **rendu Markdown formaté (`👁 Aperçu Markdown`)** et bouton **`📝 + Note`** pour créer des notes `.md`/`.txt` directement dans un dossier kDrive. |
| ⚡ **Quick-Vault Global (`Ctrl+Maj+K`)** | **Palette Spotlight Bitwarden** invocable depuis n'importe quelle application Windows (`Ctrl+Maj+K`), navigation clavier (`↑`/`↓`, `Entrée` mot de passe, `Ctrl+U` identifiant, `Ctrl+T` 2FA TOTP) et déverrouillage express intégré. |
| 🗂️ **Explorateur kDrive Power-User** | **Multi-sélection & Actions groupées (Batch)** (*Télécharger*, *Déplacer*, *Supprimer*, *Restaurer*), **Tri personnalisé** (Nom, Date, Taille), **Recherche globale sur tout kDrive**, **⭐ Favoris** et **🗑️ Corbeille kDrive** intégrée. |
| 🖼️ **Galerie & Streaming Multimédia** | **Miniatures photos réelles** avec cache disque rapide + **Visionneuse universelle en streaming** sans téléchargement préalable (**Vidéo**, **Audio**, **PDF natif**, **Photos avec Zoom**, **Code/JSON/Markdown**) et navigation clavier (`←` / `→`). |
| ☁️ **Gestion Avancée kDrive** | Explorateur complet (API REST `v2`/`v3` + WebDAV), sauvegarde *Drag & Drop*, **menu Clic-Droit**, **Renommer**, **Déplacer vers...**, et **Liens de partage publics Infomaniak en 1 clic** (création, copie & révocation). |
| 🪟 **Intégration Windows Pro** | **System Tray Windows**, **Démarrage automatique avec Windows**, **Vérificateur de mises à jour GitHub intégré**, et **verrouillage automatique par inactivité** (`AUTO_LOCK_MINUTES`, mis en pause pendant la lecture vidéo/audio). |
| 🔐 **Coffre Bitwarden & Sécurité** | Déchiffrement 100 % local (`bitwarden.eu`, `bitwarden.com` ou **Vaultwarden**), connexion Clé API ou Email/2FA, **purge automatique du presse-papiers après 20 secondes** et générateur cryptographique de mots de passe forts. |

---

## 🛠️ Installation développeur (Code source)

### Prérequis
- **Windows 10 / 11**
- **[Node.js](https://nodejs.org/)** `v18+` (testé avec `v24`) et `npm`

```powershell
git clone https://github.com/Akune122/kvault-desktop.git
cd kvault-desktop
npm install
Copy-Item .env.example .env
npm start
```

---

## ⚙️ Configuration (`.env` ou Interface de l'application)

Toutes les variables peuvent être renseignées soit dans le fichier **`.env`** (ignoré par Git), soit directement depuis le menu **⚙️ Paramètres & Sécurité** de l'application :

```ini
# Sécurité & Intégration Windows
APP_LOCK_CODE=0000
AUTO_LOCK_MINUTES=10
MINIMIZE_TO_TRAY=true
GLOBAL_SHORTCUT=CommandOrControl+Shift+K
LAUNCH_AT_STARTUP=false

# --- MODULE 1 : INFOMANIAK KDRIVE ---
KDRIVE_CONNECTION_MODE=api
KDRIVE_ID=123456
KDRIVE_API_TOKEN=votre_token_api_infomaniak

# --- MODULE 2 : BITWARDEN / VAULTWARDEN ---
BITWARDEN_SERVER_URL=https://vault.bitwarden.eu
BITWARDEN_EMAIL=vous@exemple.com
BITWARDEN_CLIENT_ID=user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
BITWARDEN_CLIENT_SECRET=votre_client_secret_bitwarden
```

### 1. Configuration Infomaniak kDrive
- **`KDRIVE_ID`** : ouvrez [kDrive Web](https://ksuite.infomaniak.com/kdrive) et copiez les chiffres situés après `/drive/` dans l'URL (`.../drive/123456/files`).
- **`KDRIVE_API_TOKEN`** : générez un token avec la permission **`drive`** dans [Infomaniak Manager → Tokens API](https://manager.infomaniak.com/v3/ng/profile/user/token/list).

### 2. Configuration Bitwarden / Vaultwarden
- Sur votre coffre web Bitwarden (**Paramètres → Sécurité → Clés → Voir la clé API**), récupérez votre `client_id` et votre `client_secret` *(recommandé : évite les blocages Captcha et fonctionne avec la 2FA)*.
- **Sécurité Zero-Knowledge** : votre **Mot de passe maître Bitwarden** n'est **jamais** stocké dans `.env` ni sur le disque — il vous est demandé uniquement lors du déverrouillage en mémoire vive.

---

## 📦 Générer l'exécutable Windows (`.exe`)

```powershell
npm run build:exe
```

L'exécutable autonome est généré dans :
- `dist/KVault-Desktop-0.6.0-Portable.exe`

---

## 🧱 Architecture du projet

```text
kvault-desktop/
├── assets/
│   ├── banner.svg               # Bannière officielle GitHub
│   ├── icon.png                 # Icône haute résolution Windows (.exe & System Tray)
│   └── logo.svg                 # Logo vectoriel KVault
├── scripts/
│   ├── ensure-electron.js       # Vérification & extraction du runtime Electron
│   ├── prepare-build.js         # Préparation Windows des outils d'icône (.exe)
│   ├── publish-release.js       # Publication automatisée de Release GitHub + upload .exe
│   └── start-electron.js        # Lanceur propre isolé des variables IDE
├── src/
│   ├── main/
│   │   ├── config.js            # Gestion hybride .env + profil local userData
│   │   ├── main.js              # Processus principal, kdrive-media://, Quick-Vault global, System Tray
│   │   └── preload.js           # Pont ContextBridge sécurisé
│   ├── services/
│   │   ├── bitwarden-service.js # Moteur local chiffré Bitwarden / Vaultwarden
│   │   ├── budget-service.js    # Moteur Budget Couple (Sync kDrive, Liste de courses, Bilan 12 mois, Exports)
│   │   ├── kdrive-api.js        # Client REST API Infomaniak kDrive (streaming, uploadBuffer, corbeille, partage)
│   │   ├── kdrive-webdav.js     # Client WebDAV Infomaniak natif
│   │   └── kdrive-manager.js    # Façade multi-protocole kDrive
│   └── renderer/
│       ├── index.html           # Interface Desktop (kDrive, Budget Couple, Quick-Vault, Bitwarden, Settings)
│       ├── styles.css           # Thème Dark Glassmorphism
│       └── app.js               # Logique frontend complète
├── .env.example                 # Modèle de configuration documenté
├── CHANGELOG.md                 # Historique des versions (SemVer)
└── package.json                 # Configuration Electron & electron-builder
```

---

## 🗺️ Feuille de route (Roadmap)

- [x] **`v0.1.0` — Fondation & Connecteur Infomaniak kDrive**
- [x] **`v0.2.0` — Coffre-fort Bitwarden / Vaultwarden & Verrouillage Application (`APP_LOCK_CODE`)**
- [x] **`v0.3.0` — Galerie Multimédia Streaming, Partage Public kDrive & Intégration Windows System Tray**
- [x] **`v0.4.0` — Explorateur kDrive Power-User (Multi-sélection, Tri, Favoris, Corbeille) & Quick-Vault Global (`Ctrl+Maj+K`)**
- [x] **`v0.5.0` — Module Budget & Dépenses de Couple (Profils, Calcul automatique, Calendrier récurrent, Cagnottes & Tickets kDrive)**
- [x] **`v0.6.0` — Sync Cloud Budget Couple sur kDrive, Liste de Courses convertible, Bilan 12 Mois/CSV/PDF & Éditeur Cloud Direct / Notes Markdown kDrive**

---

<div align="center">
  <sub>Développé par <strong>Loïc Zaercher (<a href="https://github.com/Akune122">Akune122</a>)</strong> • Licence <a href="./LICENSE">MIT</a></sub>
</div>
