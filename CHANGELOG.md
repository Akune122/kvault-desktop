# Changelog

Toutes les modifications notables de **KVault Desktop** sont documentées dans ce fichier.
Ce projet respecte le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié] — Prévu pour `v0.5.0`
- Sauvegarde automatique programmée de dossiers locaux Windows vers Infomaniak kDrive.
- Export chiffré de secours du coffre-fort Bitwarden directement dans kDrive.

## [0.4.0] - 2026-11-09
### Ajouté
- **🗂️ Pack Explorateur kDrive "Power-User"** :
  - **Multi-sélection & Actions groupées (Batch)** : cases à cocher sur les cartes, `Ctrl + Clic`, bouton `☑️ Tout` et barre flottante d'actions groupées (*Télécharger la sélection* vers un dossier Windows unique, *Déplacer vers...*, *Supprimer en lot* et *Restaurer la sélection*).
  - **Tri personnalisé** : tri instantané par Nom (`A → Z` / `Z → A`), Date (`Plus récents` / `Plus anciens`) ou Taille (`Plus volumineux` / `Plus légers`) avec maintien des dossiers en tête.
  - **Recherche globale sur tout kDrive** : bouton `🌐 Tout kDrive` permettant d'interroger l'intégralité du cloud Infomaniak (`/3/drive/{driveId}/files/search`).
  - **⭐ Favoris kDrive & 🗑️ Corbeille kDrive** : accès direct dans la barre latérale aux favoris épinglés (`kdrive-favorites.json`) et à la corbeille kDrive (*Restaurer*, *Supprimer définitivement*, *Vider la corbeille*).
- **⚡ Pack Expérience Windows "Productivité"** :
  - **Palette globale Quick-Vault (`Ctrl+Maj+K`, `GLOBAL_SHORTCUT`)** : raccourci système Windows ouvrant une recherche Spotlight Bitwarden au premier plan par-dessus n'importe quelle application, avec navigation clavier complète (`↑`/`↓`, `Entrée` mot de passe, `Ctrl+U` identifiant, `Ctrl+T` TOTP 2FA) et déverrouillage express intégré.
  - **Démarrage automatique avec Windows (`LAUNCH_AT_STARTUP`)** : lancement discret en arrière-plan (System Tray) à l'ouverture de session Windows.
  - **Vérificateur de mises à jour GitHub Releases** : vérification en 1 clic dans **⚙️ Paramètres & Sécurité** via l'API GitHub et téléchargement direct du dernier `.exe`.

## [0.3.0] - 2026-11-06
### Ajouté
- **🖼️ Pack Multimédia & Galerie Photo kDrive** :
  - **Miniatures photos réelles** chargées à la volée dans la grille et la liste via un protocole local sécurisé `kdrive-media://`, avec **cache disque local** (`thumb-cache`) et file de concurrence contrôlée.
  - **Visionneuse multimédia universelle en streaming** (sans téléchargement préalable) :
    - **Photos HD** avec contrôles de zoom (`−` / `100%` / `+` + molette souris) et support HEIC converti.
    - **Lecteur Vidéo & Audio en streaming HTTP `Range`** (`.mp4`, `.webm`, `.mov`, `.mkv`, `.mp3`, `.wav`, `.flac`, `.m4a`, `.ogg`).
    - **Lecteur PDF natif intégré** directement dans l'application.
    - **Visionneuse Texte / Code / JSON / Markdown / Logs** avec formatage JSON et copie rapide.
  - **Navigation Galerie** : boutons `❮ Précédent` / `Suivant ❯`, compteur de position et raccourcis clavier (`←`, `→`, `Échap`, `+`, `-`, `0`).
- **🪟 Pack Intégration Windows Pro & Gestion avancée kDrive** :
  - **System Tray Windows** : icône KVault dans la zone de notification près de l'horloge Windows avec menu rapide (*Ouvrir*, *Verrouiller maintenant*, *Quitter complètement*) et réduction en tâche de fond à la fermeture (`MINIMIZE_TO_TRAY`).
  - **Verrouillage d'instance unique** : relancer le `.exe` restaure automatiquement la fenêtre existante depuis la barre système.
  - **Verrouillage automatique par inactivité (`AUTO_LOCK_MINUTES`)** : verrouille KVault Desktop ainsi que le coffre Bitwarden après `2`, `5`, `10`, `15` ou `30` minutes d'inactivité Windows (suspendu automatiquement pendant la lecture d'une vidéo ou d'une musique).
  - **Liens de partage publics kDrive en 1 clic** : création, copie instantanée, ouverture navigateur et révocation des liens publics Infomaniak + badge `🔗` sur les éléments partagés.
  - **Menu contextuel Clic-Droit complet**, **Renommage** (avec sélection intelligente sans l'extension) et **Déplacement (`Déplacer vers...`)** via un explorateur de dossiers kDrive intégré.

## [0.2.0] - 2026-11-06
### Ajouté
- **🛡️ Verrouillage de sécurité de l'application (`APP_LOCK_CODE`)** :
  - Écran de verrouillage au démarrage avec pavé numérique interactif et saisie clavier.
  - Code par défaut réglé sur **`0000`** (via `.env` ou profil local), **entièrement personnalisable par l'utilisateur du `.exe`** dans **⚙️ Paramètres & Sécurité**, avec bouton de verrouillage rapide en barre supérieure.
- **🔐 Intégration complète du coffre-fort Bitwarden / Vaultwarden** :
  - Déchiffrement 100 % local via le moteur officiel `@bitwarden/cli` embarqué dans l'exécutable Windows (aucune installation externe requise).
  - Support multi-serveurs : **Bitwarden Europe (`vault.bitwarden.eu`)**, **Bitwarden US (`vault.bitwarden.com`)** et **Vaultwarden auto-hébergé**.
  - Double méthode de connexion : **Clé API (`BITWARDEN_CLIENT_ID` + `BITWARDEN_CLIENT_SECRET`) + Mot de passe maître** *(recommandé, contourne les captchas et compatible 2FA)* ou **Email + Mot de passe maître (+ code 2FA)**.
  - Vue Split-View complète : recherche instantanée, filtres (*Favoris*, *Identifiants*, *Notes sécurisées*, *Cartes bancaires*), création et suppression d'identifiants, synchronisation cloud (`Sync`).
  - **Presse-papiers sécurisé** : copie en 1 clic des identifiants, mots de passe et codes dynamiques **2FA TOTP**, avec **effacement automatique du presse-papiers après 20 secondes**.
  - **🎲 Générateur de mots de passe forts** intégré (8 à 64 caractères, majuscules, minuscules, chiffres, symboles).

## [0.1.0] - 2026-11-06
### Ajouté
- **Application Desktop Windows (`.exe`)** basée sur Electron avec barre de titre personnalisée et interface sombre moderne (*Dark Glassmorphism*).
- **Connecteur Cloud Infomaniak kDrive** avec double moteur : **API REST officielle (`v2`/`v3`)** et **WebDAV**.
- **Explorateur de fichiers complet** : navigation sous-dossiers, vue Grille/Liste, visionneuse photo HD (*Lightbox*), upload en *Drag & Drop*, jauge d'espace disque.
