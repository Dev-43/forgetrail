// Ignored folder names per BUILD_core.md C-2
export const IGNORED_FOLDERS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'build',
  'dist',
  '.tox',
  '.pytest_cache',
]);

/**
 * Checks if a workspace-relative path passes through an ignored folder.
 */
export function isIgnoredPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  return segments.some((segment) => IGNORED_FOLDERS.has(segment));
}
