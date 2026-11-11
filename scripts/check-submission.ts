import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface CheckItem {
  name: string;
  passed: boolean;
  message?: string;
}

const checks: CheckItem[] = [];

function getTrackedFiles(): string[] {
  try {
    const out = execSync('git ls-files', { encoding: 'utf-8' });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const trackedFiles = getTrackedFiles();

// 1. No tracked .env or *.sqlite
const badTracked = trackedFiles.filter((f) => f === '.env' || f.endsWith('.sqlite') || f.endsWith('.sqlite-wal') || f.endsWith('.sqlite-shm'));
checks.push({
  name: 'no-tracked-secrets-or-db',
  passed: badTracked.length === 0,
  message: badTracked.length ? `Tracked sensitive files: ${badTracked.join(', ')}` : undefined,
});

// 2. No key patterns in tracked files (AIza, nvapi-, gsk_, sk-, hf_)
const keyRegex = /(AIza[0-9A-Za-z-_]{35}|nvapi-[0-9A-Za-z-_]{60,}|gsk_[0-9A-Za-z]{30,}|sk-[0-9A-Za-z]{30,}|hf_[0-9A-Za-z]{30,})/;
const filesWithKeys: string[] = [];
for (const file of trackedFiles) {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      if (keyRegex.test(content)) {
        filesWithKeys.push(file);
      }
    } catch {
      // ignore binary or unreadable files
    }
  }
}
checks.push({
  name: 'no-secret-keys-in-git',
  passed: filesWithKeys.length === 0,
  message: filesWithKeys.length ? `Potential API keys found in: ${filesWithKeys.join(', ')}` : undefined,
});

// 3. LICENSE exists
checks.push({
  name: 'license-exists',
  passed: fs.existsSync('LICENSE'),
});

// 4. Four agents/*.json exist
const agentFiles = [
  'agents/inline.primary.json',
  'agents/inline.fallback.json',
  'agents/agent.primary.json',
  'agents/agent.fallback.json',
];
const missingAgents = agentFiles.filter((f) => !fs.existsSync(f));
checks.push({
  name: 'four-agents-exist',
  passed: missingAgents.length === 0,
  message: missingAgents.length ? `Missing agents: ${missingAgents.join(', ')}` : undefined,
});

// 5. .env.example and config/models.example.json exist
checks.push({
  name: 'env-and-models-examples-exist',
  passed: fs.existsSync('.env.example') && fs.existsSync('config/models.example.json'),
});

// 6. README contains required headings per A-7
const requiredHeadings = [
  'What it is',
  'Requirements',
  'Setup from a clean clone',
  'Flask setup',
  'Run the three tasks',
  'Models and switching',
  'Starting point',
  'Licence and credits',
  'Models used and cost',
  'Known limitations',
];
let readmePassed = false;
let missingHeadings: string[] = [];
if (fs.existsSync('README.md')) {
  const readmeText = fs.readFileSync('README.md', 'utf-8');
  missingHeadings = requiredHeadings.filter((h) => !readmeText.toLowerCase().includes(h.toLowerCase()));
  readmePassed = missingHeadings.length === 0;
}
checks.push({
  name: 'readme-required-headings',
  passed: readmePassed,
  message: missingHeadings.length ? `Missing headings: ${missingHeadings.join(', ')}` : undefined,
});

// 7. package.json contains no @latest
let noLatestPassed = true;
if (fs.existsSync('package.json')) {
  const pkgContent = fs.readFileSync('package.json', 'utf-8');
  noLatestPassed = !pkgContent.includes('"latest"') && !pkgContent.includes('@latest');
}
checks.push({
  name: 'no-latest-in-package-json',
  passed: noLatestPassed,
});

// 8. No provider names in non-test files under src/ (BUILD.md R11 / M1)
const providerNames = ['gemini', 'nvidia', 'openai', 'groq', 'anthropic', 'huggingface'];
const srcFiles = trackedFiles.filter((f) => f.startsWith('src/') && !f.includes('test') && (f.endsWith('.ts') || f.endsWith('.js')));
const filesWithProviderNames: string[] = [];

for (const f of srcFiles) {
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf-8');
    for (const p of providerNames) {
      const regex = new RegExp(`\\b${p}\\b`, 'i');
      if (regex.test(content)) {
        filesWithProviderNames.push(`${f} (${p})`);
        break;
      }
    }
  }
}
checks.push({
  name: 'model-independence-src-clean',
  passed: filesWithProviderNames.length === 0,
  message: filesWithProviderNames.length ? `Provider names found in: ${filesWithProviderNames.join(', ')}` : undefined,
});

// 9. docs/model-matrix.md exists
checks.push({
  name: 'docs-model-matrix-exists',
  passed: fs.existsSync('docs/model-matrix.md'),
});

// 10. docs/writeup/ exists
checks.push({
  name: 'docs-writeup-directory-exists',
  passed: fs.existsSync('docs/writeup'),
});

// 11. DECISIONS.md has at least 15 decision entries and no TO FILL in Understanding notes for finished modules
let decisionsPassed = false;
let decisionsMsg: string | undefined;
if (fs.existsSync('DECISIONS.md')) {
  const decText = fs.readFileSync('DECISIONS.md', 'utf-8');
  const dMatches = decText.match(/### D-\d+/g) || [];
  const count = dMatches.length;
  if (count < 15) {
    decisionsMsg = `Only ${count} decisions found (< 15 required)`;
  } else {
    decisionsPassed = true;
  }
}
checks.push({
  name: 'decisions-md-complete',
  passed: decisionsPassed,
  message: decisionsMsg,
});

console.log('========================================');
console.log('ForgeTrail Pre-Submission Verification:');
console.log('========================================');

let allPassed = true;
for (const c of checks) {
  const status = c.passed ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(5)} [${c.name}]${c.message ? ` — ${c.message}` : ''}`);
  if (!c.passed) {
    allPassed = false;
  }
}

console.log('========================================');
if (allPassed) {
  console.log('OVERALL: ALL PRE-SUBMISSION CHECKS PASSED.');
  process.exit(0);
} else {
  console.log('OVERALL: SOME CHECKS FAILED. Fix the items marked FAIL above.');
  process.exit(1);
}
