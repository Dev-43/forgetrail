import * as fs from 'fs';
import * as path from 'path';
import { READ_MAX_LINES } from '../shared/limits';
import { estimateTokens } from '../mcp/budget';
import { walkWorkspace, extractPythonSymbols, extractJsTsSymbols, SymbolDefinition } from './outline';
import { isIgnoredPath } from './ignore';

export interface ResolvedMention {
  raw: string;
  type: 'file' | 'symbol';
  target: string;
  found: boolean;
  path?: string;
  lineRange?: { start: number; end: number };
  content?: string;
  reason: 'mentioned by user';
  estimatedTokens: number;
  note?: string;
}

export interface ParseMentionsResult {
  cleanedInstruction: string;
  mentions: ResolvedMention[];
  attachedContextText: string;
  totalTokens: number;
}

/**
 * Extracts a Python definition body starting from startLine (1-based)
 * until indentation returns to or below the definition's base indentation level.
 */
function extractPythonBody(lines: string[], startLine1: number): { endLine1: number; bodyText: string } {
  const startIdx = startLine1 - 1;
  const defLine = lines[startIdx] || '';
  const baseIndentMatch = defLine.match(/^(\s*)/);
  const baseIndent = baseIndentMatch ? baseIndentMatch[1].length : 0;

  let endIdx = startIdx;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Blank lines or comments are included in the function body
    if (line.trim().length === 0) {
      endIdx = i;
      continue;
    }

    const indentMatch = line.match(/^(\s*)/);
    const lineIndent = indentMatch ? indentMatch[1].length : 0;

    if (lineIndent <= baseIndent) {
      // Exited function/class body
      break;
    }

    endIdx = i;
  }

  // Trim trailing empty lines from the extracted range
  while (endIdx > startIdx && lines[endIdx].trim().length === 0) {
    endIdx--;
  }

  const bodyLines = lines.slice(startIdx, endIdx + 1);
  return {
    endLine1: endIdx + 1,
    bodyText: bodyLines.join('\n'),
  };
}

/**
 * Extracts a definition body for non-Python languages (JS/TS etc.) up to max 60 lines.
 */
function extractGenericBody(lines: string[], startLine1: number, maxLines = 60): { endLine1: number; bodyText: string } {
  const startIdx = startLine1 - 1;
  const endIdx = Math.min(lines.length - 1, startIdx + maxLines - 1);
  const bodyLines = lines.slice(startIdx, endIdx + 1);
  return {
    endLine1: endIdx + 1,
    bodyText: bodyLines.join('\n'),
  };
}

/**
 * Parses and resolves explicit mentions in instruction:
 * `@file:<path>` and `@symbol:<name>`.
 */
export function resolveMentions(instruction: string, workspaceRoot: string): ParseMentionsResult {
  const mentions: ResolvedMention[] = [];
  const mentionBlocks: string[] = [];

  // Match @file:<path>
  const fileRegex = /@file:([^\s]+)/g;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = fileRegex.exec(instruction)) !== null) {
    const raw = fileMatch[0];
    const targetPath = fileMatch[1].replace(/\\/g, '/');

    const absPath = path.resolve(workspaceRoot, targetPath);
    const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');

    // Security & existence check
    if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath) || isIgnoredPath(relPath) || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      mentions.push({
        raw,
        type: 'file',
        target: targetPath,
        found: false,
        reason: 'mentioned by user',
        estimatedTokens: 0,
        note: `Mention not found: ${raw}`,
      });
      mentionBlocks.push(`### ${raw}\nMention not found: ${raw}\n`);
      continue;
    }

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(absPath, 'utf-8');
    } catch {
      mentions.push({
        raw,
        type: 'file',
        target: targetPath,
        found: false,
        reason: 'mentioned by user',
        estimatedTokens: 0,
        note: `Mention not found: ${raw}`,
      });
      mentionBlocks.push(`### ${raw}\nMention not found: ${raw}\n`);
      continue;
    }

    const allLines = fileContent.split(/\r?\n/);
    const isTruncated = allLines.length > READ_MAX_LINES;
    const linesToInclude = isTruncated ? allLines.slice(0, READ_MAX_LINES) : allLines;
    let blockText = '';
    let note: string | undefined;

    if (isTruncated) {
      note = `Truncated: showing first ${READ_MAX_LINES} of ${allLines.length} lines. Full file outline included below.`;
      const ext = path.extname(relPath).toLowerCase();
      let symbols: SymbolDefinition[] = [];
      if (ext === '.py') {
        symbols = extractPythonSymbols(fileContent);
      } else if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        symbols = extractJsTsSymbols(fileContent);
      }

      const outlineText = symbols.length > 0
        ? 'Outline of symbols in this file:\n' + symbols.map((s) => `  L${s.line}: ${s.signature}`).join('\n') + '\n\n'
        : '';

      blockText = `### ${raw} (${relPath}:1-${READ_MAX_LINES} of ${allLines.length})\n[${note}]\n\n${outlineText}\`\`\`\n${linesToInclude.join('\n')}\n\`\`\`\n`;
    } else {
      blockText = `### ${raw} (${relPath}:1-${allLines.length})\n\`\`\`\n${linesToInclude.join('\n')}\n\`\`\`\n`;
    }

    const tokens = estimateTokens(blockText);
    mentions.push({
      raw,
      type: 'file',
      target: targetPath,
      found: true,
      path: relPath,
      lineRange: { start: 1, end: linesToInclude.length },
      content: linesToInclude.join('\n'),
      reason: 'mentioned by user',
      estimatedTokens: tokens,
      note,
    });

    mentionBlocks.push(blockText);
  }

  // Match @symbol:<name>
  const symbolRegex = /@symbol:([A-Za-z0-9_]+)/g;
  let symMatch: RegExpExecArray | null;
  while ((symMatch = symbolRegex.exec(instruction)) !== null) {
    const raw = symMatch[0];
    const targetSymbol = symMatch[1];

    // Search for symbol definitions across workspace
    const allFiles = walkWorkspace(workspaceRoot, workspaceRoot);
    const matchingDefs: Array<{
      relPath: string;
      sym: SymbolDefinition;
      ext: string;
    }> = [];

    for (const relPath of allFiles) {
      const ext = path.extname(relPath).toLowerCase();
      const isPy = ext === '.py';
      const isJsTs = ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
      if (!isPy && !isJsTs) continue;

      const abs = path.join(workspaceRoot, relPath);
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }

      const symbols = isPy ? extractPythonSymbols(content) : extractJsTsSymbols(content);
      for (const s of symbols) {
        if (s.name === targetSymbol) {
          matchingDefs.push({ relPath, sym: s, ext });
          if (matchingDefs.length >= 3) break;
        }
      }
      if (matchingDefs.length >= 3) break;
    }

    if (matchingDefs.length === 0) {
      mentions.push({
        raw,
        type: 'symbol',
        target: targetSymbol,
        found: false,
        reason: 'mentioned by user',
        estimatedTokens: 0,
        note: `Mention not found: ${raw}`,
      });
      mentionBlocks.push(`### ${raw}\nMention not found: ${raw}\n`);
      continue;
    }

    // Include up to 3 definitions
    for (const match of matchingDefs) {
      const abs = path.join(workspaceRoot, match.relPath);
      const content = fs.readFileSync(abs, 'utf-8');
      const lines = content.split(/\r?\n/);

      const isPy = match.ext === '.py';
      const { endLine1, bodyText } = isPy
        ? extractPythonBody(lines, match.sym.line)
        : extractGenericBody(lines, match.sym.line, 60);

      const block = `### ${raw} (${match.relPath}:${match.sym.line}-${endLine1})\n\`\`\`\n${bodyText}\n\`\`\`\n`;
      const tokens = estimateTokens(block);

      mentions.push({
        raw,
        type: 'symbol',
        target: targetSymbol,
        found: true,
        path: match.relPath,
        lineRange: { start: match.sym.line, end: endLine1 },
        content: bodyText,
        reason: 'mentioned by user',
        estimatedTokens: tokens,
      });

      mentionBlocks.push(block);
    }
  }

  let attachedContextText = '';
  if (mentionBlocks.length > 0) {
    attachedContextText = `ATTACHED CONTEXT:\n\n${mentionBlocks.join('\n')}`;
  }

  const totalTokens = estimateTokens(attachedContextText);

  return {
    cleanedInstruction: instruction,
    mentions,
    attachedContextText,
    totalTokens,
  };
}
