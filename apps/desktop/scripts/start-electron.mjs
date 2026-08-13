import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const appDirectory = path.resolve(import.meta.dirname, '..');
const environment = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://localhost:5173'
};

delete environment.ELECTRON_RUN_AS_NODE;

const electron = spawn(electronPath, ['.'], {
  cwd: appDirectory,
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

electron.on('error', (error) => {
  console.error('Não foi possível iniciar o Electron:', error);
  process.exitCode = 1;
});

electron.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!electron.killed) electron.kill(signal);
  });
}
