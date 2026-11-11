import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** FLASK_DIR from the environment or .env (default ./dev/forge-spike/flask), resolved against the repo root. */
export function getFlaskDir(): string {
  let dir = process.env.FLASK_DIR;
  const envPath = resolve(process.cwd(), '.env');
  if (!dir && existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*FLASK_DIR\s*=\s*(.+?)\s*$/);
      if (m) dir = m[1];
    }
  }
  return resolve(process.cwd(), dir || './dev/forge-spike/flask');
}

/** The Task A selection: the whole get_debug_flag function, read from the file (keeps its real line endings). */
export function getDebugFlagSelection(flaskDir: string): { path: string; startLine: number; endLine: number; text: string } {
  const relPath = 'src/flask/helpers.py';
  const lines = readFileSync(join(flaskDir, relPath), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('def get_debug_flag'));
  if (start === -1) throw new Error(`get_debug_flag not found in ${relPath}`);
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(' ') || lines[end].trim() === '')) end++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return {
    path: relPath,
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end).join('\n').replace(/\r$/, ''),
  };
}
