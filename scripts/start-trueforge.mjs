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
const defaultAllowedHosts = [
  '127.0.0.1',
  'localhost',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.openai.com',
  'openrouter.ai',
  'api.anthropic.com'
];
// Also allow the host of every OpenAI-compatible provider in config/models.json, so adding a
// provider there (e.g. NVIDIA's integrate.api.nvidia.com) does not get blocked by TrueForge.
const modelsConfigPath = resolve(process.cwd(), 'config', 'models.json');
if (existsSync(modelsConfigPath)) {
  try {
    const cfg = JSON.parse(readFileSync(modelsConfigPath, 'utf8'));
    for (const p of cfg.providers ?? []) {
      if (p.baseUrl) {
        const host = new URL(p.baseUrl).hostname;
        if (!defaultAllowedHosts.includes(host)) defaultAllowedHosts.push(host);
      }
    }
  } catch (err) {
    console.warn(`Could not read provider hosts from config/models.json: ${err.message}`);
  }
}
if (!envVars['OUTBOUND_URL_ALLOWED_HOSTS']) {
  envVars['OUTBOUND_URL_ALLOWED_HOSTS'] = JSON.stringify(defaultAllowedHosts);
}
console.log(`Outbound hosts allowed: ${JSON.parse(envVars['OUTBOUND_URL_ALLOWED_HOSTS']).join(', ')}`);
envVars['SQLITE_PATH'] = resolve(process.cwd(), 'forge.sqlite');

console.log('Starting TrueForge 0.184.2 on http://localhost:8790...');

// Run local trueforge cli with node directly if installed, else fallback to npx
const localCli = resolve(process.cwd(), 'node_modules', '@truefoundry', 'trueforge', 'dist', 'cli.js');
const isWindows = process.platform === 'win32';
const command = existsSync(localCli) ? process.execPath : (isWindows ? 'npx.cmd' : 'npx');
const args = existsSync(localCli) ? [localCli] : ['-y', '@truefoundry/trueforge@0.184.2'];

const child = spawn(command, args, {
  env: envVars,
  stdio: 'inherit',
  shell: !existsSync(localCli) && isWindows
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
