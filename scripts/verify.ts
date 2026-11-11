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

// Find python executable in venv if available
let pythonExe = 'python';
const venvWin = resolve(flaskDir, '.venv', 'Scripts', 'python.exe');
const venvUnix = resolve(flaskDir, '.venv', 'bin', 'python');
if (existsSync(venvWin)) {
  pythonExe = venvWin;
} else if (existsSync(venvUnix)) {
  pythonExe = venvUnix;
}

const target = process.argv[2]?.toLowerCase() || 'a';

if (target === 'a') {
  console.log(`Running Task A verification in ${flaskDir}...`);
  try {
    const childEnv = { ...process.env, ...env, FLASK_DEBUG: 'off' };
    const out = execSync(`"${pythonExe}" -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`, {
      cwd: flaskDir,
      env: childEnv,
      encoding: 'utf8'
    }).trim();
    console.log(`Output: ${out}`);
    if (out === 'False') {
      console.log('PASS Task A: get_debug_flag() returned False with FLASK_DEBUG=off');
      process.exit(0);
    } else {
      console.log(`FAIL Task A: expected False, got ${out}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error('FAIL Task A execution error:', err.message);
    process.exit(1);
  }
} else if (target === 'b') {
  console.log(`Running Task B verification in ${flaskDir}...`);
  let allPass = true;

  // 1. git diff --stat touches >= 3 files
  try {
    const statOut = execSync('git diff --stat', { cwd: flaskDir, encoding: 'utf8' });
    const touchedFiles = statOut.split('\n').filter(l => l.includes('|')).length;
    if (touchedFiles >= 3) {
      console.log(`PASS 1: git diff touches ${touchedFiles} files (>= 3)`);
    } else {
      console.log(`FAIL 1: git diff touches ${touchedFiles} files (< 3)`);
      allPass = false;
    }
  } catch (e: any) {
    console.log(`FAIL 1: git diff error: ${e.message}`);
    allPass = false;
  }

  // 2. pytest tests/test_cli.py -q
  try {
    const pytestBin = existsSync(resolve(flaskDir, '.venv', 'Scripts', 'pytest.exe'))
      ? resolve(flaskDir, '.venv', 'Scripts', 'pytest.exe')
      : 'pytest';
    execSync(`"${pytestBin}" tests/test_cli.py -q`, { cwd: flaskDir, stdio: 'inherit' });
    console.log('PASS 2: pytest tests/test_cli.py -q passed');
  } catch (e: any) {
    console.log('FAIL 2: pytest tests/test_cli.py -q failed');
    allPass = false;
  }

  // 3. flask --app <repo>/demo/app config
  try {
    const flaskBin = existsSync(resolve(flaskDir, '.venv', 'Scripts', 'flask.exe'))
      ? resolve(flaskDir, '.venv', 'Scripts', 'flask.exe')
      : 'flask';
    const demoApp = resolve(process.cwd(), 'demo', 'app.py');
    const configOut = execSync(`"${flaskBin}" --app "${demoApp}" config`, {
      cwd: flaskDir,
      encoding: 'utf8'
    });
    const parsed = JSON.parse(configOut);
    let secretMasked = true;
    let normalVisible = false;
    for (const [k, v] of Object.entries(parsed)) {
      const isSensitive = /SECRET|PASSWORD|TOKEN|KEY/i.test(k);
      if (isSensitive && v !== '***') {
        secretMasked = false;
      }
      if (!isSensitive && v !== '***') {
        normalVisible = true;
      }
    }
    if (secretMasked && normalVisible) {
      console.log('PASS 3: flask config outputs JSON with sensitive keys masked as ***');
    } else {
      console.log(`FAIL 3: secretMasked=${secretMasked}, normalVisible=${normalVisible}`);
      allPass = false;
    }
  } catch (e: any) {
    console.log(`FAIL 3: flask config error: ${e.message}`);
    allPass = false;
  }

  // 4. flask --help contains config
  try {
    const flaskBin = existsSync(resolve(flaskDir, '.venv', 'Scripts', 'flask.exe'))
      ? resolve(flaskDir, '.venv', 'Scripts', 'flask.exe')
      : 'flask';
    const helpOut = execSync(`"${flaskBin}" --help`, { cwd: flaskDir, encoding: 'utf8' });
    const hasConfig = helpOut.split('\n').some(l => /^\s*config\s+/.test(l));
    if (hasConfig) {
      console.log('PASS 4: flask --help lists config command');
    } else {
      console.log('FAIL 4: flask --help does not list config command');
      allPass = false;
    }
  } catch (e: any) {
    console.log(`FAIL 4: flask --help error: ${e.message}`);
    allPass = false;
  }

  process.exit(allPass ? 0 : 1);
} else if (target === 'c') {
  console.log(`Running Task C (workspace clean check) in ${flaskDir}...`);
  try {
    const out = execSync('git status --porcelain', { cwd: flaskDir, encoding: 'utf8' }).trim();
    if (out.length === 0) {
      console.log('PASS workspace unchanged');
      process.exit(0);
    } else {
      console.log(`FAIL changed files:\n${out}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error('FAIL Task C error:', err.message);
    process.exit(1);
  }
} else {
  console.error(`Unknown verification target: ${target}`);
  process.exit(1);
}
