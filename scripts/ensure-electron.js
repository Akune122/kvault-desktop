const { downloadArtifact } = require('@electron/get');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const keepAlive = setInterval(() => {}, 500);

  try {
    const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron');
    const { version } = require(path.join(electronDir, 'package.json'));
    const checksums = require(path.join(electronDir, 'checksums.json'));
    const distDir = path.join(electronDir, 'dist');
    const exePath = path.join(distDir, 'electron.exe');
    const pathTxt = path.join(electronDir, 'path.txt');

    if (fs.existsSync(exePath) && fs.existsSync(pathTxt)) {
      console.log('Electron déjà prêt :', exePath);
      return;
    }

    console.log(`Récupération du cache Electron v${version}...`);
    const zipPath = await downloadArtifact({
      version,
      artifactName: 'electron',
      checksums,
      platform: process.platform,
      arch: process.arch
    });

    console.log('Décompression du runtime Windows Electron...');
    fs.mkdirSync(distDir, { recursive: true });
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${distDir}" -Force`
    ], { stdio: 'inherit' });

    fs.writeFileSync(pathTxt, 'electron.exe', 'utf8');
    console.log('Electron installé avec succès dans :', exePath);
  } finally {
    clearInterval(keepAlive);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
