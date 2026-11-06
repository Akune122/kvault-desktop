# Changelog

Toutes les modifications notables de **KVault Desktop** sont documentées dans ce fichier.
Ce projet respecte le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié] — Prévu pour `v0.3.0`
- Sauvegarde automatique programmée de dossiers locaux Windows vers Infomaniak kDrive.
- Export chiffré de secours du coffre-fort Bitwarden directement dans kDrive.

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
