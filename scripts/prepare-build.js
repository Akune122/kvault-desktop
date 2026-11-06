const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WINCODESIGN_URL =
  'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';

async function main() {
  if (process.platform !== 'win32') return;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;

  const cacheDir = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign');
  const targetDir = path.join(cacheDir, 'winCodeSign-2.6.0');
  const rceditPath = path.join(targetDir, 'rcedit-x64.exe');

  if (fs.existsSync(rceditPath)) {
    return;
  }

  console.log('Préparation des outils d\'icône Windows (winCodeSign sans liens symboliques macOS)...');
  fs.mkdirSync(cacheDir, { recursive: true });

  const archivePath = path.join(cacheDir, 'winCodeSign-2.6.0.7z');
  if (!fs.existsSync(archivePath)) {
    const res = await fetch(WINCODESIGN_URL, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Impossible de télécharger winCodeSign (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(archivePath, buf);
  }

  const sevenZip = path.resolve(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  fs.mkdirSync(targetDir, { recursive: true });

  // Extrait tout sauf le dossier macOS "darwin" qui échoue sans privilège Administrateur sous Windows
  execFileSync(sevenZip, ['x', '-bd', '-y', '-xr!darwin', archivePath, `-o${targetDir}`], {
    stdio: 'inherit'
  });

  console.log('Outils winCodeSign prêts (icône personnalisée activée) !');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
