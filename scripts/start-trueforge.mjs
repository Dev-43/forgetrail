import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Check Node version >= 22.14
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  console.error('Node 22.14 or newer is required.');
  process.exit(1);
}

// Read .env if present
const envVars = { ...process.env };
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      envVars[key] = val;
    }
  }
}

// Set required TrueForge environment variables
envVars['OUTBOUND_URL_ALLOWED_HOSTS'] = JSON.stringify(['127.0.0.1', 'localhost']);
envVars['SQLITE_PATH'] = resolve(process.cwd(), 'forge.sqlite');

console.log('Starting TrueForge 0.184.2 on http://localhost:8790...');

// Try running local binary if installed, else fallback to npx
const isWindows = process.platform === 'win32';
const localBin = resolve(process.cwd(), 'node_modules', '.bin', isWindows ? 'trueforge.cmd' : 'trueforge');
const command = existsSync(localBin) ? localBin : (isWindows ? 'npx.cmd' : 'npx');
const args = existsSync(localBin) ? [] : ['-y', '@truefoundry/trueforge@0.184.2'];

const child = spawn(command, args, {
  env: envVars,
  stdio: 'inherit',
  shell: isWindows
});

child.on('error', (err) => {
  console.error('Failed to start TrueForge:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
