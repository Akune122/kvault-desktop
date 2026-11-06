<div align="center">

<img src="./assets/banner.svg" alt="KVault Desktop Banner" width="100%" />

<br />

[![Version](https://img.shields.io/badge/version-0.1.0-0098FF?style=for-the-badge&logo=semanticrelease&logoColor=white)](./CHANGELOG.md)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011%20(.exe)-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#compilation-en-exécutable-windows-exe)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Infomaniak kDrive](https://img.shields.io/badge/Cloud-Infomaniak%20kDrive-00E5FF?style=for-the-badge&logo=icloud&logoColor=white)](#configuration-du-compte-kdrive-env)
[![Bitwarden Roadmap](https://img.shields.io/badge/Vault-Bitwarden%20(v0.2)-10B981?style=for-the-badge&logo=bitwarden&logoColor=white)](#feuille-de-route--versions-roadmap)
[![License](https://img.shields.io/badge/License-MIT-818CF8?style=for-the-badge)](./LICENSE)

<p align="center">
  <strong>Application Desktop Windows tout-en-un combinant un explorateur &amp; outil de sauvegarde directe pour <a href="https://www.infomaniak.com/fr/ksuite/kdrive">Infomaniak kDrive</a> et un futur coffre-fort de mots de passe <a href="https://bitwarden.com/">Bitwarden</a>.</strong>
</p>

</div>

---

## ✨ Présentation du projet

**KVault Desktop** est une application lourde Windows (`.exe`) pensée comme un **hub personnel sécurisé** permettant de centraliser :
1. **Vos fichiers, documents et photos sur Infomaniak kDrive** *(disponible dès la `v0.1.0`)* — naviguez dans vos dossiers cloud, prévisualisez vos photos et sauvegardez des fichiers ou dossiers entiers par simple *Glisser-Déposer* depuis Windows.
2. **Vos mots de passe et accès Bitwarden / Vaultwarden** *(prévu en `v0.2.0`)* — consultez, recherchez et copiez vos identifiants chiffrés depuis la même interface.

---

## 🚀 Fonctionnalités (`v0.1.0` — Module kDrive)

| Fonctionnalité | Description |
| :--- | :--- |
| ☁️ **Double moteur kDrive** | Connexion via l'**API REST officielle Infomaniak (`v2`/`v3`)** *(compatible 100% des offres, gratuites et payantes)* ou via **WebDAV**. |
| 📂 **Explorateur complet** | Navigation rapide dans les dossiers et sous-dossiers, fil d'Ariane (*Breadcrumbs*), Vue Grille & Vue Liste, recherche instantanée. |
| 📸 **Mode Photos & Aperçu** | Filtres dédiés (*Photos, Documents, Médias*) et visionneuse **Lightbox HD** intégrée pour prévisualiser vos images sans les télécharger. |
| ⬆️ **Sauvegarde Drag & Drop** | Glissez-déposez vos photos/fichiers depuis l'Explorateur Windows ou sauvegardez un dossier local entier en un clic avec barre de progression. |
| 📊 **Suivi du stockage** | Jauge d'espace disque kDrive en temps réel dans la barre latérale. |
| 🔒 **Secrets protégés** | Configuration propre via `.env` (ignoré par Git) ou directement depuis l'onglet **Connexion & `.env`** intégré à l'application. |

---

## 🛠️ Installation & Démarrage rapide

### Prérequis
- **Windows 10 / 11**
- **[Node.js](https://nodejs.org/)** `v18+` (testé avec `v24`) et `npm`

### 1. Cloner le dépôt & installer les dépendances
```powershell
git clone https://github.com/Akune122/kvault-desktop.git
cd kvault-desktop
npm install
```

### 2. Configurer vos identifiants kDrive
Copiez le modèle `.env.example` en `.env` (déjà créé localement) et renseignez vos 2 variables Infomaniak (voir le guide détaillé juste en dessous) :
```powershell
Copy-Item .env.example .env
```

### 3. Lancer l'application
```powershell
npm start
```

---

## 🔑 Configuration du compte kDrive (`.env`)

Ouvrez le fichier **`.env`** à la racine du projet (ou passez directement par le menu **⚙️ Connexion & .env** dans l'application) :

```ini
KDRIVE_CONNECTION_MODE=api
KDRIVE_ID=123456
KDRIVE_API_TOKEN=votre_token_api_infomaniak_ici
```

### Où trouver ces 2 valeurs sur Infomaniak ? (2 minutes)

1. **`KDRIVE_ID`** *(Identifiant numérique de votre Drive)* :
   - Ouvrez votre [kDrive Web](https://ksuite.infomaniak.com/kdrive) dans votre navigateur.
   - Regardez l'URL dans la barre d'adresse : `https://ksuite.infomaniak.com/.../drive/123456/files`
   - Le nombre juste après `/drive/` (ici `123456`) est votre **`KDRIVE_ID`**.

2. **`KDRIVE_API_TOKEN`** *(Jeton d'accès sécurisé)* :
   - Rendez-vous dans [Infomaniak Manager → Tokens API](https://manager.infomaniak.com/v3/ng/profile/user/token/list).
   - Cliquez sur **Créer un token**.
   - Donnez-lui le nom `KVault Desktop`, sélectionnez la permission / scope **`drive`** (*Gestion de kDrive*), puis validez.
   - Copiez le token généré dans `KDRIVE_API_TOKEN`.

> [!TIP]
> **Alternative WebDAV** : Si vous préférez utiliser WebDAV (disponible sur les offres payantes kDrive Solo / Pro), passez `KDRIVE_CONNECTION_MODE=webdav` et renseignez `KDRIVE_EMAIL` ainsi qu'un mot de passe d'application dans `KDRIVE_APP_PASSWORD`.

---

## 📦 Compilation en exécutable Windows (`.exe`)

Pour générer votre application autonome **`.exe`** (portable, prête à être lancée sur Windows sans terminal) :

```powershell
npm run build:exe
```

Une fois la compilation terminée, récupérez votre exécutable dans le dossier **`dist/`** :
- `dist/KVault-Desktop-0.1.0-Portable.exe`

*(Vous pouvez également générer un installateur Windows classique avec `npm run build:installer`).*

---

## 🧱 Architecture du projet

```text
kvault-desktop/
├── assets/
│   ├── banner.svg             # Bannière officielle GitHub
│   ├── icon.png               # Icône haute résolution de l'application (.exe)
│   └── logo.svg               # Logo vectoriel KVault
├── src/
│   ├── main/
│   │   ├── config.js          # Lecture/écriture sécurisée (.env + profil local)
│   │   ├── main.js            # Processus principal Electron & gestionnaires IPC
│   │   └── preload.js         # Pont sécurisé ContextBridge (isolation activée)
│   ├── services/
│   │   ├── kdrive-api.js      # Client REST API officiel Infomaniak kDrive (v2/v3)
│   │   ├── kdrive-webdav.js   # Client WebDAV Infomaniak natif
│   │   └── kdrive-manager.js  # Façade unifiée multi-protocole
│   └── renderer/
│       ├── index.html         # Interface utilisateur Desktop
│       ├── styles.css         # Thème Dark Glassmorphism
│       └── app.js             # Logique explorateur, Drag & Drop, aperçu photos
├── .env.example               # Modèle de configuration documenté pour GitHub
├── .gitignore                 # Exclut .env, node_modules/ et dist/
├── CHANGELOG.md               # Historique des versions (SemVer)
├── LICENSE                    # Licence MIT
└── package.json               # Scripts & configuration electron-builder
```

---

## 🗺️ Feuille de route & Versions (Roadmap)

- [x] **`v0.1.0` — Fondation & Connecteur Infomaniak kDrive**
  - Interface Desktop Windows (`.exe`), explorateur de dossiers, upload photos/fichiers en Drag & Drop, aperçu Lightbox HD, jauge de quota, support API REST & WebDAV.
- [ ] **`v0.2.0` — Intégration Coffre-fort Bitwarden / Vaultwarden**
  - Connexion chiffrée au coffre Bitwarden, recherche rapide de mots de passe, copie sécurisée d'identifiants & codes 2FA (TOTP), générateur de mots de passe forts.
- [ ] **`v0.3.0` — Sauvegardes automatisées & Synchronisation**
  - Planificateur de sauvegarde automatique de dossiers locaux Windows (ex: *Mes Images*, *Documents*) vers kDrive + export chiffré du coffre Bitwarden sur kDrive.

---

<div align="center">
  <sub>Développé par <strong>Loïc Zaercher</strong> • Projet IT Open-Source sous licence <a href="./LICENSE">MIT</a></sub>
</div>
