import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  }
  return env;
}

const env = loadEnv();
const flaskDir = resolve(process.cwd(), env.FLASK_DIR || './dev/forge-spike/flask');

if (!existsSync(flaskDir)) {
  console.error(`FLASK_DIR does not exist: ${flaskDir}`);
  process.exit(1);
}

try {
  const head = execSync('git rev-parse HEAD', { cwd: flaskDir, encoding: 'utf8' }).trim();
  if (!head.startsWith('22d92470')) {
    console.error(`Refusing reset: HEAD does not begin with 22d92470 (found: ${head})`);
    process.exit(1);
  }

  execSync('git checkout -- .', { cwd: flaskDir, stdio: 'inherit' });
  execSync('git clean -fd', { cwd: flaskDir, stdio: 'inherit' });
  const status = execSync('git status --short', { cwd: flaskDir, encoding: 'utf8' }).trim();
  if (status.length > 0) {
    console.error(`Git status not empty after reset: ${status}`);
    process.exit(1);
  }
  console.log('RESET OK');
} catch (err: any) {
  console.error('Reset failed:', err.message);
  process.exit(1);
}
