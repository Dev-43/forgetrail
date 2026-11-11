import * as path from 'path';
import { E_PATH_IGNORED, E_PATH_OUTSIDE } from '../shared/contracts';
import { isIgnoredPath } from '../context/ignore';

export interface PathValidationResult {
  ok: boolean;
  error?: string;
  relativePath?: string;
  absolutePath?: string;
}

/**
 * Normalizes input path:
 * - strips leading './'
 * - replaces all backslashes with forward slashes
 * - trims surrounding whitespace
 */
export function normalizePath(inputPath: string): string {
  let p = inputPath.trim().replace(/\\/g, '/');
  if (p.startsWith('./')) {
    p = p.slice(2);
  }
  return p;
}

/**
 * Validates and resolves a path against the open workspace root.
 * Enforces:
 * 1. Path must resolve inside the workspace root (E_PATH_OUTSIDE)
 * 2. Path must not touch ignored folders (E_PATH_IGNORED)
 */
export function validateWorkspacePath(
  inputPath: string,
  workspaceRoot: string
): PathValidationResult {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const cleanInput = normalizePath(inputPath);

  // If path is already absolute, check whether it is inside workspaceRoot
  let absPath: string;
  if (path.isAbsolute(cleanInput) || /^[a-zA-Z]:\//.test(cleanInput)) {
    absPath = path.resolve(cleanInput).replace(/\\/g, '/');
  } else {
    absPath = path.resolve(normalizedRoot, cleanInput).replace(/\\/g, '/');
  }

  // Check workspace containment
  if (!absPath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    return {
      ok: false,
      error: E_PATH_OUTSIDE(cleanInput),
    };
  }

  // Compute clean workspace-relative path with forward slashes
  let relPath = absPath.slice(normalizedRoot.length).replace(/^\/+/, '');
  if (!relPath) {
    relPath = '.';
  }

  // Check ignored folders
  if (isIgnoredPath(relPath)) {
    return {
      ok: false,
      error: E_PATH_IGNORED(relPath),
    };
  }

  return {
    ok: true,
    relativePath: relPath,
    absolutePath: absPath,
  };
}

