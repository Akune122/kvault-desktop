# Changelog

Toutes les modifications notables de **KVault Desktop** sont documentées dans ce fichier.
Ce projet respecte le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [Semantic Versioning](https://semver.org/lang/fr/).

## [Non publié] — Prévu pour `v0.2.0`
- Intégration du coffre-fort **Bitwarden / Vaultwarden** (déverrouillage local, recherche d'identifiants, copie sécurisée avec effacement auto du presse-papiers, générateur de mots de passe).
- Sauvegarde automatique programmée de dossiers locaux Windows vers kDrive.

## [0.1.0] - 2026-11-06
### Ajouté
- **Application Desktop Windows (`.exe`)** basée sur Electron avec barre de titre personnalisée et interface sombre moderne (*Dark Glassmorphism*).
- **Connecteur Cloud Infomaniak kDrive** avec double moteur au choix :
  - **API REST officielle Infomaniak (`v2`/`v3`)** : compatible avec toutes les offres kDrive (gratuites *my kSuite* et payantes).
  - **Protocole WebDAV** : connexion par email et mot de passe d'application pour les offres kDrive payantes.
- **Explorateur de fichiers complet** :
  - Navigation fluide dans les dossiers et sous-dossiers avec fil d'Ariane (*Breadcrumbs*).
  - Vue Grille (idéale pour les photos) et Vue Liste détaillée, avec recherche instantanée et filtres par type (Photos, Documents, Vidéos, Archives).
  - Aperçu rapide intégré (*Lightbox*) pour les photos et images stockées sur kDrive.
  - **Sauvegarde / Upload direct** par glisser-déposer (*Drag & Drop*) de fichiers/photos ou sélection multiple depuis Windows.
  - Création de nouveaux dossiers, téléchargement local et mise à la corbeille.
  - Jauge d'espace de stockage kDrive en temps réel.
- **Configuration hybride** via fichier `.env` ou directement depuis le panneau **Paramètres** intégré à l'application.
