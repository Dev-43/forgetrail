import * as fs from 'fs';
import * as path from 'path';
import { isIgnoredPath } from './ignore';
import { extractKeywords } from './keywords';
import { OUTLINE_MAX_TOKENS } from '../shared/limits';
import { estimateTokens } from '../mcp/budget';

export interface SymbolDefinition {
  name: string;
  line: number;
  kind: 'class' | 'function' | 'const';
  signature: string;
}

export interface FileOutline {
  path: string;
  score: number;
  symbols: SymbolDefinition[];
}

/**
 * Extracts definitions from Python source code:
 * - class X(...)
 * - def f(...)
 * - async def f(...)
 */
export function extractPythonSymbols(content: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // class definition
    const classMatch = line.match(/^\s*class\s+([A-Za-z0-9_]+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        line: i + 1,
        kind: 'class',
        signature: line.trim(),
      });
      continue;
    }

    // function / async function definition
    const defMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/);
    if (defMatch) {
      symbols.push({
        name: defMatch[1],
        line: i + 1,
        kind: 'function',
        signature: line.trim(),
      });
      continue;
    }
  }

  return symbols;
}

/**
 * Extracts definitions from TypeScript / JavaScript source code:
 * - function f(...)
 * - class X(...)
 * - export const f =
 */
export function extractJsTsSymbols(content: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // function definition
    const fnMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (fnMatch) {
      symbols.push({
        name: fnMatch[1],
        line: i + 1,
        kind: 'function',
        signature: line.trim(),
      });
      continue;
    }

    // class definition
    const classMatch = line.match(/^\s*(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        line: i + 1,
        kind: 'class',
        signature: line.trim(),
      });
      continue;
    }

    // export const f =
    const constMatch = line.match(/^\s*export\s+const\s+([A-Za-z0-9_]+)\s*=/);
    if (constMatch) {
      symbols.push({
        name: constMatch[1],
        line: i + 1,
        kind: 'const',
        signature: line.trim(),
      });
      continue;
    }
  }

  return symbols;
}

export function walkWorkspace(dir: string, baseDir: string): string[] {
  let fileList: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (isIgnoredPath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      fileList = fileList.concat(walkWorkspace(fullPath, baseDir));
    } else if (entry.isFile()) {
      fileList.push(relPath);
    }
  }

  return fileList;
}

/**
 * Builds the repo outline scored against query keywords:
 * - Path hit: +3 points per matching keyword
 * - Symbol hit: +2 points per matching keyword
 */
export function buildRepoOutline(
  query: string,
  workspaceRoot: string,
  maxTokens: number = OUTLINE_MAX_TOKENS,
  pathPrefix?: string
): { outlines: FileOutline[]; formattedText: string; tokens: number } {
  const keywords = extractKeywords(query);
  const files = walkWorkspace(workspaceRoot, workspaceRoot);
  const normalizedPrefix = pathPrefix ? pathPrefix.replace(/\\/g, '/').replace(/^\/+/, '') : undefined;
  const outlines: FileOutline[] = [];

  for (const relPath of files) {
    if (normalizedPrefix && !relPath.startsWith(normalizedPrefix)) {
      continue;
    }
    const ext = path.extname(relPath).toLowerCase();
    const isPy = ext === '.py';
    const isJsTs = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);

    if (!isPy && !isJsTs) {
      continue;
    }

    const absPath = path.join(workspaceRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    if (content.includes('\0')) {
      continue;
    }

    const symbols = isPy ? extractPythonSymbols(content) : extractJsTsSymbols(content);
    if (symbols.length === 0) {
      continue;
    }

    // Scoring
    let score = 0;
    const lowerPath = relPath.toLowerCase();
    const basenameNoExt = path.basename(relPath, ext).toLowerCase();
    const isTestFile = lowerPath.includes('test') || lowerPath.includes('spec');

    for (const kw of keywords) {
      // Basename exact or partial match: strong signal
      if (basenameNoExt === kw) {
        score += 10;
      } else if (basenameNoExt.includes(kw)) {
        score += 5;
      } else if (lowerPath.includes(kw)) {
        // Path match: +3
        score += 3;
      }

      // Symbol match: +2 per symbol matching keyword, capped at 10 points per keyword
      let symPointsForKw = 0;
      for (const sym of symbols) {
        if (sym.name.toLowerCase().includes(kw)) {
          symPointsForKw += 2;
          if (symPointsForKw >= 10) break;
        }
      }
      score += symPointsForKw;
    }

    // Source file bonus: non-test files get +5 if any keywords matched
    if (score > 0 && !isTestFile) {
      score += 5;
    }

    outlines.push({
      path: relPath,
      score,
      symbols,
    });
  }

  // Sort descending by score, then alphabetically
  outlines.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.path.localeCompare(b.path);
  });

  // Format into blocks until maxTokens is reached
  const outputBlocks: string[] = [];

  for (const fileOutline of outlines) {
    // Only include files if they have score > 0 or if there are few files
    if (keywords.length > 0 && fileOutline.score === 0) {
      continue;
    }

    const symLines = fileOutline.symbols
      .map((s) => `  L${s.line}: ${s.signature}`)
      .join('\n');
    const block = `## ${fileOutline.path} (score: ${fileOutline.score})\n${symLines}\n`;

    if (estimateTokens(outputBlocks.join('\n') + '\n' + block) > maxTokens) {
      break;
    }

    outputBlocks.push(block);
  }

  const formattedText = outputBlocks.join('\n');
  const tokens = estimateTokens(formattedText);

  return {
    outlines,
    formattedText,
    tokens,
  };
}
