import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync, ChildProcess } from 'child_process';
import { COMMAND_OUTPUT_MAX_LINES, COMMAND_TIMEOUT_MS } from '../../shared/limits';
import { E_CANCELLED, E_TIMEOUT } from '../../shared/contracts';
import { runContext } from '../runContext';

export interface RunCommandParams {
  command: string;
}

let activeChildProcess: ChildProcess | null = null;

/**
 * Kills a process and all of its descendants (process tree termination per C-19).
 */
export function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // process may have already exited
    }
  }
}

/**
 * Force-terminates any running command immediately (called on run cancellation).
 */
export function killActiveCommand(): void {
  if (activeChildProcess && activeChildProcess.pid) {
    killProcessTree(activeChildProcess.pid);
    activeChildProcess = null;
  }
}

/**
 * Commands allowed automatically without prompt per BUILD.md C5.
 */
export function isCommandAutoAllowed(command: string): boolean {
  const trimmed = command.trim();
  // Anything that could chain, pipe, redirect or substitute another command needs the user's OK
  // (e.g. "pytest && del /s ..." or "git status; curl ..."). Newlines count as separators too.
  if (/[;&|<>`$\r\n^%]/.test(trimmed) || /\$\(/.test(trimmed)) {
    return false;
  }
  // Match whole words: "pytest" or "pytest <args>", not "pytestevil".
  return /^(pytest|python -m pytest|git status|git diff)(\s|$)/.test(trimmed);
}

/**
 * Environment for run_command: the workspace's .venv (if any) first on the search path, so
 * `python` / `pytest` are the project's, not the system's. On Windows the variable is usually
 * spelled "Path"; spreading process.env loses its case-insensitivity, and adding a separate
 * "PATH" key left the original "Path" in force (the venv was silently ignored, bug C3).
 */
export function buildCommandEnv(
  workspaceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const venvDir = path.join(workspaceRoot, '.venv');
  const venvScripts = path.join(venvDir, 'Scripts');
  const venvBin = path.join(venvDir, 'bin');
  const extraPath = fs.existsSync(venvScripts) ? venvScripts : (fs.existsSync(venvBin) ? venvBin : '');
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (!extraPath) return env;

  const pathKey = platform === 'win32'
    ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path')
    : 'PATH';
  const delimiter = platform === 'win32' ? ';' : ':';
  env[pathKey] = `${extraPath}${delimiter}${env[pathKey] ?? ''}`;
  env.VIRTUAL_ENV = venvDir;
  return env;
}

/** Shell that run_command uses, stated in the tool description so the model writes matching commands (C2). */
export function commandShellNote(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? 'Commands run in Windows cmd.exe: join commands with &&, never ;. Unix tools such as head, sed, ls, grep or /dev/null may not exist.'
    : 'Commands run in /bin/sh.';
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
    let timer: NodeJS.Timeout | null = null;

    const childEnv = buildCommandEnv(workspaceRoot);

    const child = exec(
      params.command,
      {
        cwd: workspaceRoot,
        env: childEnv,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (timer) clearTimeout(timer);
        activeChildProcess = null;

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

    activeChildProcess = child;

    timer = setTimeout(() => {
      killed = true;
      if (child.pid) {
        killProcessTree(child.pid);
      } else {
        child.kill();
      }
      activeChildProcess = null;
      resolve(E_TIMEOUT(COMMAND_TIMEOUT_MS));
    }, COMMAND_TIMEOUT_MS);
  });
}
