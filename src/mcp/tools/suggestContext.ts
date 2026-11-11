import * as fs from 'fs';
import * as path from 'path';
import { extractKeywords } from '../../context/keywords';
import { walkWorkspace, extractPythonSymbols, extractJsTsSymbols } from '../../context/outline';
import { SUGGEST_MAX_FILES } from '../../shared/limits';
import { estimateTokens, recordRetrievalTokens } from '../budget';
import { E_BUDGET } from '../../shared/contracts';

export interface SuggestContextParams {
  task: string;
}

export interface SuggestedFile {
  path: string;
  score: number;
  reason: string;
  fileTokens: number;
}

const TEXT_EXTS = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.json', '.rst', '.md',
  '.toml', '.yaml', '.yml', '.txt', '.html', '.css', '.cfg', '.ini'
]);

const IGNORED_ROOT_DOCS = new Set([
  'changes.rst', 'authors.rst', 'contributing.rst', 'license.rst',
  'changes.md', 'authors.md', 'contributing.md', 'license.md'
]);

/**
 * MCP Tool: suggest_context (forgetrail-extra connector)
 * Suggests up to 8 relevant workspace files for a given task description with reasons.
 * Scores by path hits, symbol hits (from outline), and content hit counts.
 */
export async function executeSuggestContext(
  params: SuggestContextParams,
  workspaceRoot: string
): Promise<string> {
  const task = params?.task ?? '';
  const keywords = extractKeywords(task);

  if (keywords.length === 0) {
    return `[suggest_context | 0 files | ~0 tokens | budget left 12000]\nNo keywords extracted from task.`;
  }

  const files = walkWorkspace(workspaceRoot, workspaceRoot);
  const candidates: SuggestedFile[] = [];

  const taskMentionsTest = keywords.some((k) => k.startsWith('test'));
  const taskMentionsDoc = keywords.some((k) => k.startsWith('doc'));

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    if (!TEXT_EXTS.has(ext)) {
      continue;
    }

    const lowerPath = relPath.toLowerCase();
    const filename = path.basename(relPath).toLowerCase();
    const basenameNoExt = path.basename(relPath, ext).toLowerCase();

    // Deprioritize generic changelogs / licenses
    if (IGNORED_ROOT_DOCS.has(filename)) {
      continue;
    }

    const isTest = lowerPath.includes('test') || lowerPath.includes('spec');
    const isDoc = lowerPath.startsWith('docs/') || lowerPath.startsWith('doc/');
    const isSource = (lowerPath.startsWith('src/') || lowerPath.startsWith('lib/')) && !isTest;

    let score = 0;
    const reasons: string[] = [];

    // 1. Path hits
    for (const kw of keywords) {
      if (basenameNoExt === kw) {
        score += 15;
        reasons.push(`filename matches '${kw}'`);
      } else if (basenameNoExt.includes(kw)) {
        score += 8;
        reasons.push(`filename contains '${kw}'`);
      } else if (lowerPath.includes(kw)) {
        score += 4;
        reasons.push(`path contains '${kw}'`);
      }
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

    const fileTokens = estimateTokens(content);

    // 2. Symbol hits (from outline)
    const isPy = ext === '.py';
    const isJsTs = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
    if (isPy || isJsTs) {
      const symbols = isPy ? extractPythonSymbols(content) : extractJsTsSymbols(content);
      const matchedSymbols: string[] = [];
      let symbolPoints = 0;

      for (const kw of keywords) {
        for (const sym of symbols) {
          if (sym.name.toLowerCase().includes(kw)) {
            matchedSymbols.push(sym.name);
            symbolPoints += 3;
            if (symbolPoints >= 15) break;
          }
        }
        if (symbolPoints >= 15) break;
      }

      if (symbolPoints > 0) {
        score += symbolPoints;
        const symNames = Array.from(new Set(matchedSymbols)).slice(0, 3).join(', ');
        reasons.push(`symbols match ${symNames}`);
      }
    }

    // 3. Content hits
    const lowerContent = content.toLowerCase();
    let contentHitCount = 0;
    for (const kw of keywords) {
      if (lowerContent.includes(kw)) {
        let count = 0;
        let pos = 0;
        while ((pos = lowerContent.indexOf(kw, pos)) !== -1 && count < 6) {
          count++;
          pos += kw.length;
        }
        score += Math.min(count, 3);
        contentHitCount += count;
      }
    }

    if (contentHitCount > 0) {
      reasons.push(`${contentHitCount}+ content hits`);
    }

    // 4. Category weighting
    if (isSource && score > 0) {
      score += 10;
      reasons.push('core source');
    } else if (isTest && taskMentionsTest && score > 0) {
      score += 8;
      reasons.push('test suite');
    } else if (isDoc && taskMentionsDoc && score > 0) {
      // Documentation files don't define code symbols, so grant an equalizer bonus when task requests docs
      score += 16;
      reasons.push('documentation');
    }

    if (score > 0) {
      const summaryReason = Array.from(new Set(reasons)).slice(0, 3).join(', ');
      candidates.push({
        path: relPath,
        score,
        reason: summaryReason || 'relevant keyword matches',
        fileTokens,
      });
    }
  }

  // Sort descending by score, then ascending by fileTokens (tie-breaker: prefer smaller files)
  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.fileTokens - b.fileTokens;
  });

  const top = candidates.slice(0, SUGGEST_MAX_FILES);

  const lines = top.map(
    (c) => `- ${c.path} (~${c.fileTokens} tokens, score: ${c.score}): ${c.reason}`
  );

  const body = lines.join('\n');
  const tokens = estimateTokens(body);

  const budgetResult = recordRetrievalTokens(tokens);
  if (budgetResult.exhausted) {
    return E_BUDGET(budgetResult.used, budgetResult.max);
  }

  const header = `[suggest_context | ${top.length} files | ~${tokens} tokens | budget left ${budgetResult.remaining}]`;
  return `${header}\n\n${body.length > 0 ? body : '(No suggestions found)'}`;
}
