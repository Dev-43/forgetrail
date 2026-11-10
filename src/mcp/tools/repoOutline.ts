import { buildRepoOutline } from '../../context/outline';
import { E_BUDGET } from '../../shared/contracts';
import { recordRetrievalTokens } from '../budget';

export interface RepoOutlineParams {
  query?: string;
  path_prefix?: string;
}

/**
 * MCP Tool: repo_outline (forgetrail-extra connector)
 * Scans workspace Python/JS/TS definitions and returns scored outlines up to OUTLINE_MAX_TOKENS.
 */
export async function executeRepoOutline(
  params: RepoOutlineParams,
  workspaceRoot: string
): Promise<string> {
  const query = params?.query ?? '';
  const pathPrefix = params?.path_prefix;
  const { formattedText, tokens } = buildRepoOutline(query, workspaceRoot, undefined, pathPrefix);

  const budgetResult = recordRetrievalTokens(tokens);
  if (budgetResult.exhausted) {
    return E_BUDGET(budgetResult.used, budgetResult.max);
  }

  const header = `[repo_outline | ~${tokens} tokens | budget left ${budgetResult.remaining}]`;
  return `${header}\n\n${formattedText.length > 0 ? formattedText : '(No symbols found)'}`;
}
