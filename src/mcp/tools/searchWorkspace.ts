import * as fs from 'fs';
import * as path from 'path';
import { E_BUDGET } from '../../shared/contracts';
import { SEARCH_LINE_MAX_CHARS, SEARCH_MAX_MATCHES } from '../../shared/limits';
import { isIgnoredPath } from '../../context/ignore';
import { runContext } from '../runContext';

export interface SearchWorkspaceParams {
  query: string;
  path_prefix?: string;
  case_sensitive?: boolean;
}

interface MatchResult {
  path: string;
  line: number;
  text: string;
}

function walkFiles(dir: string, baseDir: string, pathPrefix?: string): string[] {
  let results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (isIgnoredPath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      results = results.concat(walkFiles(fullPath, baseDir, pathPrefix));
    } else if (entry.isFile()) {
      if (!pathPrefix || relPath.startsWith(pathPrefix)) {
        results.push(relPath);
      }
    }
  }

  return results;
}

export async function executeSearchWorkspace(
  params: SearchWorkspaceParams,
  workspaceRoot: string
): Promise<string> {
  let regex: RegExp;
  try {
    regex = new RegExp(params.query, params.case_sensitive ? '' : 'i');
  } catch {
    // If regex compilation fails, fallback to escaped literal search
    const escaped = params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, params.case_sensitive ? '' : 'i');
  }

  const prefix = params.path_prefix ? params.path_prefix.replace(/\\/g, '/').replace(/^\/+/, '') : undefined;
  const files = walkFiles(workspaceRoot, workspaceRoot, prefix);
  const matches: MatchResult[] = [];

  for (const file of files) {
    if (matches.length >= SEARCH_MAX_MATCHES) {
      break;
    }

    const absPath = path.join(workspaceRoot, file);
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    // Skip binary files (null character present)
    if (content.includes('\0')) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= SEARCH_MAX_MATCHES) {
        break;
      }
      const lineText = lines[i];
      if (regex.test(lineText)) {
        const truncated = lineText.slice(0, SEARCH_LINE_MAX_CHARS);
        matches.push({
          path: file,
          line: i + 1,
          text: truncated,
        });
      }
    }
  }

  const linesOutput = matches.map((m) => `${m.path}:${m.line}:${m.text}`).join('\n');
  const body = matches.length === 0 ? 'No matches found.' : linesOutput;

  const estimatedTokens = Math.ceil(body.length / 4);
  const budgetResult = runContext.consumeBudget(estimatedTokens);

  if (budgetResult.used > runContext.budgetMax) {
    return E_BUDGET(budgetResult.used, runContext.budgetMax);
  }

  const header = `[search: ${params.query} | ${matches.length} matches | ~${estimatedTokens} tokens | budget left ${budgetResult.remaining}]`;
  return `${header}\n${body}`;
}

