// Harness and some Node hosts set this flag. It must not leak into desktop Electron.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../apps/desktop/package.json'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(req('electron'), [path.resolve(__dirname, '../apps/desktop')], { env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
