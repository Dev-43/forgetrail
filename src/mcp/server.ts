import * as http from 'http';
import { randomUUID } from 'crypto';
// @ts-ignore
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
// @ts-ignore
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
import { z } from 'zod';
import { runContext } from './runContext';
import { executeReadFile } from './tools/readFile';
import { executeSearchWorkspace } from './tools/searchWorkspace';
import { executeProposeEdit } from './tools/proposeEdit';
import { executeRunCommand, commandShellNote } from './tools/runCommand';
import { executeRepoOutline } from './tools/repoOutline';
import { executeSuggestContext } from './tools/suggestContext';

let httpServer: http.Server | null = null;
const coreSessions = new Map<string, any>();
const extraSessions = new Map<string, any>();

let lastToolCallTime = 0;
const MIN_TOOL_INTERVAL_MS = 4500;

/**
 * Paces MCP tool execution to prevent bursting against provider rate limits (e.g. 15 RPM / 250k TPM).
 */
async function throttleTool(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastToolCallTime;
  if (elapsed < MIN_TOOL_INTERVAL_MS && lastToolCallTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, MIN_TOOL_INTERVAL_MS - elapsed));
  }
  lastToolCallTime = Date.now();
}

/**
 * Registers Core MCP tools (read_file, search_workspace, and later propose_edit, run_command).
 */
function registerCoreTools(server: any): void {
  server.tool(
    'read_file',
    'Reads a file inside the workspace (returns raw text of lines or up to READ_MAX_LINES).',
    {
      path: z.string().describe('Relative path to the file inside workspace'),
      start_line: z.number().int().positive().optional().describe('1-based starting line number'),
      end_line: z.number().int().positive().optional().describe('1-based ending line number (inclusive)'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeReadFile(params, runContext.workspaceRoot);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  server.tool(
    'search_workspace',
    'Searches for a regex query across non-ignored files in the workspace (returns up to 30 matches).',
    {
      query: z.string().describe('Regex search pattern'),
      path_prefix: z.string().optional().describe('Optional subfolder prefix to restrict search to'),
      case_sensitive: z.boolean().optional().describe('Whether the search is case-sensitive (default false)'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeSearchWorkspace(params, runContext.workspaceRoot);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  server.tool(
    'propose_edit',
    'Proposes an atomic edit to a file inside the workspace (one hunk; held at approval gate).',
    {
      path: z.string().describe('Relative path to the file inside workspace'),
      old_text: z.string().describe('Exact original text to replace (empty if creating file)'),
      new_text: z.string().describe('Proposed replacement text'),
      reason: z.string().max(200).describe('One-line reason for this specific edit (<= 200 chars)'),
      sources: z.array(z.string()).optional().describe('List of files informing this edit'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeProposeEdit(params);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  server.tool(
    'run_command',
    `Runs a terminal command in the workspace root with a 120s timeout limit. Use it to run tests or the changed program, not to read or search files (use read_file / search_workspace). The project's .venv is first on PATH. ${commandShellNote()}`,
    {
      command: z.string().describe('Terminal command to execute in workspace root'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeRunCommand(params, runContext.workspaceRoot);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );
}

/**
 * Registers Extra MCP tools (repo_outline, suggest_context).
 */
function registerExtraTools(server: any): void {
  server.tool(
    'repo_outline',
    'Extracts definitions (class, def, function) with line numbers ranked by keyword score.',
    {
      query: z.string().describe('Keywords to score and rank files by'),
      path_prefix: z.string().optional().describe('Optional subfolder path prefix'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeRepoOutline(params, runContext.workspaceRoot);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  server.tool(
    'suggest_context',
    'Suggests up to 8 relevant workspace files for a given task description with reasons.',
    {
      task: z.string().describe('Natural language description of the editing task'),
    },
    async (params: any) => {
      await throttleTool();
      const text = await executeSuggestContext(params, runContext.workspaceRoot);
      return {
        content: [{ type: 'text', text }],
      };
    }
  );
}

/**
 * Creates a new Streamable HTTP session transport for /mcp-core.
 */
async function createCoreSession(requestedId?: string): Promise<{ transport: any; id: string }> {
  const id = requestedId || randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => id,
  });
  const server = new McpServer({ name: 'forgetrail-core', version: '0.0.1' });
  registerCoreTools(server);
  await server.connect(transport);
  coreSessions.set(id, transport);
  return { transport, id };
}

/**
 * Creates a new Streamable HTTP session transport for /mcp-extra.
 */
async function createExtraSession(requestedId?: string): Promise<{ transport: any; id: string }> {
  const id = requestedId || randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => id,
  });
  const server = new McpServer({ name: 'forgetrail-extra', version: '0.0.1' });
  registerExtraTools(server);
  await server.connect(transport);
  extraSessions.set(id, transport);
  return { transport, id };
}

/**
 * Starts the local HTTP MCP server on 127.0.0.1:3333 with /mcp-core and /mcp-extra endpoints.
 */
export async function startMcpServer(port = 3333, host = '127.0.0.1'): Promise<http.Server> {
  if (httpServer) {
    return httpServer;
  }

  httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1:3333'}`);
    const pathname = url.pathname;

    // Health check endpoint
    if (pathname === '/health' || pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', activeRunId: runContext.activeRunId }));
      return;
    }

    // Core endpoint: /mcp-core
    if (pathname === '/mcp-core' || pathname.startsWith('/mcp-core/')) {
      try {
        const reqSessionId = req.headers['mcp-session-id'] as string | undefined;
        if (reqSessionId && coreSessions.has(reqSessionId)) {
          await coreSessions.get(reqSessionId)!.handleRequest(req, res);
          return;
        }

        const { transport } = await createCoreSession(reqSessionId);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message ?? 'Unknown MCP Core error' }));
        }
      }
      return;
    }

    // Extras endpoint: /mcp-extra
    if (pathname === '/mcp-extra' || pathname.startsWith('/mcp-extra/')) {
      try {
        const reqSessionId = req.headers['mcp-session-id'] as string | undefined;
        if (reqSessionId && extraSessions.has(reqSessionId)) {
          await extraSessions.get(reqSessionId)!.handleRequest(req, res);
          return;
        }

        const { transport } = await createExtraSession(reqSessionId);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message ?? 'Unknown MCP Extra error' }));
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
  });

  return new Promise((resolve, reject) => {
    httpServer!.listen(port, host, () => {
      resolve(httpServer!);
    });
    httpServer!.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Stops the MCP server and closes all active sessions.
 */
export async function stopMcpServer(): Promise<void> {
  coreSessions.clear();
  extraSessions.clear();

  if (httpServer) {
    try {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
    } catch {}
    return new Promise((resolve, reject) => {
      httpServer!.close((err) => {
        httpServer = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export function getMcpServer(): http.Server | null {
  return httpServer;
}
