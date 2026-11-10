import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { COMMAND_OUTPUT_MAX_LINES, COMMAND_TIMEOUT_MS } from '../../shared/limits';
import { E_CANCELLED, E_TIMEOUT } from '../../shared/contracts';
import { runContext } from '../runContext';

export interface RunCommandParams {
  command: string;
}

/**
 * Commands allowed automatically without prompt per BUILD.md C5.
 */
export function isCommandAutoAllowed(command: string): boolean {
  const trimmed = command.trim();
  return (
    trimmed.startsWith('pytest') ||
    trimmed.startsWith('python -m pytest') ||
    trimmed.startsWith('git status') ||
    trimmed.startsWith('git diff')
  );
}

/**
 * MCP Tool: run_command (core connector)
 * Executes command in workspace root with COMMAND_TIMEOUT_MS limit.
 * Returns `EXIT <code>` followed by up to 200 lines of combined output.
 */
export async function executeRunCommand(
  params: RunCommandParams,
  workspaceRoot = runContext.workspaceRoot
): Promise<string> {
  if (runContext.cancelled) {
    return E_CANCELLED;
  }

  return new Promise((resolve) => {
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
      resolve(E_TIMEOUT(COMMAND_TIMEOUT_MS));
    }, COMMAND_TIMEOUT_MS);

    const venvScripts = path.join(workspaceRoot, '.venv', 'Scripts');
    const venvBin = path.join(workspaceRoot, '.venv', 'bin');
    const extraPath = fs.existsSync(venvScripts) ? venvScripts : (fs.existsSync(venvBin) ? venvBin : '');
    const childEnv = extraPath
      ? { ...process.env, PATH: `${extraPath}${path.delimiter}${process.env.PATH || ''}` }
      : process.env;

    const child = exec(
      params.command,
      {
        cwd: workspaceRoot,
        env: childEnv,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        if (killed) {
          return;
        }

        if (runContext.cancelled) {
          return resolve(E_CANCELLED);
        }

        const exitCode = error ? (error.code ?? 1) : 0;
        const combined = `${stdout}\n${stderr}`.trim();
        const lines = combined.split(/\r?\n/);
        const tailLines = lines.slice(-COMMAND_OUTPUT_MAX_LINES);

        resolve(`EXIT ${exitCode}\n${tailLines.join('\n')}`);
      }
    );
  });
}
