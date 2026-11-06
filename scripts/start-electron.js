const { spawn } = require('child_process');
const path = require('path');

// Supprime ELECTRON_RUN_AS_NODE au cas où la commande est lancée depuis un terminal VS Code / Antigravity
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const extraArgs = process.argv.slice(2);

const child = spawn(electronBinary, [projectRoot, ...extraArgs], {
  stdio: 'inherit',
  env: cleanEnv,
  windowsHide: false
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
