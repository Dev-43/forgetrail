import * as fs from 'fs';
import { E_BINARY, E_BUDGET, E_NOT_FOUND } from '../../shared/contracts';
import { READ_MAX_LINES } from '../../shared/limits';
import { validateWorkspacePath } from '../pathGuard';
import { runContext } from '../runContext';

export interface ReadFileParams {
  path: string;
  start_line?: number;
  end_line?: number;
}

/**
 * Checks if a buffer represents a binary file (contains null bytes in initial sample).
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * MCP Tool: read_file (core connector)
 * Returns plain text: one header line + file content range.
 */
export async function executeReadFile(
  params: ReadFileParams,
  workspaceRoot: string
): Promise<string> {
  const guard = validateWorkspacePath(params.path, workspaceRoot);
  if (!guard.ok) {
    return guard.error!;
  }

  const absPath = guard.absolutePath!;
  const relPath = guard.relativePath!;

  if (!fs.existsSync(absPath)) {
    return E_NOT_FOUND(relPath);
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(absPath);
    if (!stats.isFile()) {
      return E_NOT_FOUND(relPath);
    }
  } catch {
    return E_NOT_FOUND(relPath);
  }

  // Binary check
  const buffer = Buffer.alloc(1024);
  let fd: number;
  try {
    fd = fs.openSync(absPath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);
    if (isBinaryBuffer(buffer.subarray(0, bytesRead))) {
      return E_BINARY(relPath);
    }
  } catch {
    return E_NOT_FOUND(relPath);
  }

  const rawContent = fs.readFileSync(absPath, 'utf-8');
  // Handle both CRLF and LF lines
  const lines = rawContent.split(/\r?\n/);
  const totalLines = lines.length;

  let start = 1;
  let end = totalLines;
  let isTruncated = false;

  if (params.start_line !== undefined && params.start_line > 0) {
    start = Math.min(params.start_line, totalLines);
  }
  if (params.end_line !== undefined && params.end_line > 0) {
    end = Math.min(Math.max(params.end_line, start), totalLines);
  } else if (params.start_line === undefined) {
    if (totalLines > READ_MAX_LINES) {
      end = READ_MAX_LINES;
      isTruncated = true;
    }
  }

  const slice = lines.slice(start - 1, end);
  let body = slice.join('\n');
  if (isTruncated) {
    body += `\n... [truncated: file has ${totalLines} lines total. Request a narrower range to read more]`;
  }

  const estimatedTokens = Math.ceil(body.length / 4);
  const budgetResult = runContext.consumeBudget(estimatedTokens);

  if (budgetResult.used > runContext.budgetMax) {
    return E_BUDGET(budgetResult.used, runContext.budgetMax);
  }

  const header = `[${relPath} | lines ${start}-${end} of ${totalLines} | ~${estimatedTokens} tokens | budget left ${budgetResult.remaining}]`;
  return `${header}\n${body}`;
}
