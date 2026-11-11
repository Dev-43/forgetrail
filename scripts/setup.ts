import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';

/**
 * npm run setup — registers model providers, MCP connectors and the four ForgeTrail agents in
 * TrueForge, then smoke-tests the inline agents.
 *
 * Everything model-related comes from config/models.json (schema: config/models.example.json):
 *   providers[]  name, type ("builtin" = TrueForge catalog provider, "openai-compatible"), baseUrl,
 *                apiKeyEnv, models[] (model ids; openai-compatible only)
 *   models       primary, fallback, agentPrimary?, agentFallback?   as "<provider>/<model id>"
 *
 * Flags:
 *   --primary <ref>         override models.primary (and agentPrimary) for this run, files untouched
 *   --fallback <ref>        override models.fallback (and agentFallback)
 *   --agent-fallback <ref>  override models.agentFallback only (agent mode / Task B)
 *   --break-primary         register the primary model's provider with an invalid key (Task C demo)
 *   --no-fallback           do not create the two -fallback agents (Task C case 2)
 *   --restore               same as running with no flags: real keys, all four agents
 */

const TRUEFORGE_PREFIX = 'forgetrail-';
const AGENT_FILES = ['inline.primary.json', 'inline.fallback.json', 'agent.primary.json', 'agent.fallback.json'];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  }
  return env;
}

interface ProviderConfig {
  name: string;
  type: 'builtin' | 'openai-compatible';
  baseUrl?: string;
  apiKeyEnv: string;
  models?: Array<string | { id: string; contextLength?: number; maxOutputTokens?: number }>;
}

interface ModelsConfig {
  providers: ProviderConfig[];
  models: { primary: string; fallback?: string; agentPrimary?: string; agentFallback?: string };
}

/** TrueForge model and provider names: 2–64 chars, lowercase, letters/digits/hyphens, start with a letter. */
export function toTrueForgeName(id: string): string {
  let n = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  if (!/^[a-z]/.test(n)) n = `m-${n}`;
  return n.slice(0, 64).replace(/-+$/, '');
}

/** Splits "<provider>/<model id>" at the first slash (model ids may contain slashes). */
function splitRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf('/');
  if (i <= 0) throw new Error(`Model reference "${ref}" must look like <provider>/<model id>`);
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

const env = loadEnv();
const TRUEFORGE_URL = env.TRUEFORGE_URL || 'http://localhost:8790';
const api = (p: string) => `${TRUEFORGE_URL}/api/v1${p}`;

const args = process.argv.slice(2);
const breakPrimary = args.includes('--break-primary');
const noFallback = args.includes('--no-fallback');
const flagValue = (name: string): string | null => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const primaryOverride = flagValue('--primary');
const fallbackOverride = flagValue('--fallback');
const agentFallbackOverride = flagValue('--agent-fallback');

let failures = 0;
const pass = (name: string, extra = '') => console.log(`PASS ${name}${extra ? ` ${extra}` : ''}`);
const fail = (name: string, reason: string) => { failures++; console.log(`FAIL ${name}: ${reason}`); };
const warn = (name: string, reason: string) => console.log(`WARN ${name}: ${reason}`);
const redact = (s: string) => s.replace(/(AIza|AQ\.|gsk_|nvapi-|xai-|sk-)[A-Za-z0-9_\-.]+/g, '***');

async function readBody(res: Response): Promise<string> {
  try { return redact((await res.text()).slice(0, 400)); } catch { return ''; }
}

async function run() {
  console.log('ForgeTrail Setup Script starting...');
  if (args.includes('--restore')) {
    console.log('(--restore: registering real keys and all four agents)');
  }

  const modelsConfigPath = resolve(process.cwd(), 'config', 'models.json');
  if (!existsSync(modelsConfigPath)) {
    console.error('Copy config/models.example.json to config/models.json.');
    process.exit(1);
  }
  const config: ModelsConfig = JSON.parse(readFileSync(modelsConfigPath, 'utf8'));
  if (!Array.isArray(config.providers) || !config.models?.primary) {
    console.error('config/models.json needs "providers" and "models.primary".');
    process.exit(1);
  }

  // Resolve which model each agent uses (overrides beat config; agent-mode roles default to inline roles)
  const roles = {
    inlinePrimary: primaryOverride ?? config.models.primary,
    agentPrimary: primaryOverride ?? config.models.agentPrimary ?? config.models.primary,
    inlineFallback: fallbackOverride ?? config.models.fallback ?? null,
    agentFallback: agentFallbackOverride ?? fallbackOverride ?? config.models.agentFallback ?? config.models.fallback ?? null,
  };

  // Step 1: trueforge-reachable
  let catalog: any[] = [];
  try {
    const res = await fetch(api('/catalogs/model-providers'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = (await res.json()).data ?? [];
    pass('trueforge-reachable');
  } catch (err: any) {
    console.error(`FAIL trueforge-reachable: ${err.message}. Run "npm run trueforge" first.`);
    process.exit(1);
  }

  // Remove our own agents first: TrueForge refuses to delete a provider an agent still uses.
  // Agents that are not ForgeTrail's are left alone.
  try {
    const existing = (await (await fetch(api('/agents'))).json()).data ?? [];
    for (const a of existing) {
      if (typeof a.name === 'string' && a.name.startsWith(TRUEFORGE_PREFIX)) {
        await fetch(api(`/agents/${a.id}`), { method: 'DELETE' });
      }
    }
  } catch {
    // listed again below; creation will report real errors
  }

  // Step 2: providers-registered
  const primaryProvider = splitRef(roles.inlinePrimary).provider;
  // provider name -> (model id -> TrueForge model name)
  const registered = new Map<string, Map<string, string>>();

  for (const p of config.providers) {
    const key = env[p.apiKeyEnv]?.trim();
    if (!key) {
      warn(`provider-${p.name}`, `${p.apiKeyEnv} is empty in .env; provider skipped`);
      continue;
    }
    const apiKey = breakPrimary && p.name === primaryProvider ? 'invalid-key-for-demo' : key;

    let manifest: any;
    const names = new Map<string, string>();
    if (p.type === 'builtin') {
      const entry = catalog.find((c: any) => c.type === p.name);
      if (!entry) {
        fail(`provider-${p.name}`, `no TrueForge catalog provider of type "${p.name}"`);
        continue;
      }
      const models = (entry.models ?? []).map((m: any) => ({
        model_id: m.model_id,
        name: m.name,
        properties: m.properties ?? { context_length: 1048576, max_output_tokens: 65536 },
      }));
      for (const m of models) {
        names.set(m.model_id, m.name);
        names.set(m.name, m.name);
      }
      manifest = { type: p.name, auth: { api_key: apiKey }, models };
    } else {
      if (!p.baseUrl) {
        fail(`provider-${p.name}`, 'openai-compatible providers need "baseUrl"');
        continue;
      }
      const models = (p.models ?? []).map((m) => {
        const id = typeof m === 'string' ? m : m.id;
        const name = toTrueForgeName(id);
        names.set(id, name);
        names.set(name, name);
        return {
          model_id: id,
          name,
          properties: {
            context_length: typeof m === 'string' ? 131072 : m.contextLength ?? 131072,
            max_output_tokens: typeof m === 'string' ? 8192 : m.maxOutputTokens ?? 8192,
          },
        };
      });
      if (models.length === 0) {
        fail(`provider-${p.name}`, 'list at least one model id in "models"');
        continue;
      }
      manifest = { type: 'custom', name: p.name, base_url: p.baseUrl, auth: { api_key: apiKey }, models };
    }

    await fetch(api(`/settings/model-providers/${encodeURIComponent(p.name)}`), { method: 'DELETE' }).catch(() => null);
    const res = await fetch(api('/settings/model-providers'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest }),
    });
    if (!res.ok) {
      fail(`provider-${p.name}`, `${res.status} ${await readBody(res)}`);
      continue;
    }
    registered.set(p.name, names);
    pass(`provider-${p.name}`, breakPrimary && p.name === primaryProvider ? '(invalid key, --break-primary)' : '');
  }

  /** "<provider>/<model id>" -> "<provider>/<TrueForge model name>", or null if not registered. */
  const resolveRef = (ref: string | null): string | null => {
    if (!ref) return null;
    const { provider, model } = splitRef(ref);
    const names = registered.get(provider);
    if (!names) return null;
    const name = names.get(model) ?? names.get(toTrueForgeName(model));
    return name ? `${provider}/${name}` : null;
  };

  const resolved = {
    inlinePrimary: resolveRef(roles.inlinePrimary),
    agentPrimary: resolveRef(roles.agentPrimary),
    inlineFallback: noFallback ? null : resolveRef(roles.inlineFallback),
    agentFallback: noFallback ? null : resolveRef(roles.agentFallback),
  };
  // The agent-mode fallback may live on its own provider (e.g. NVIDIA for heavy Task B runs);
  // if that provider has no key, use the inline fallback model instead of creating nothing.
  if (!noFallback && !resolved.agentFallback && roles.agentFallback && roles.agentFallback !== roles.inlineFallback && resolved.inlineFallback) {
    warn('agent-fallback', `"${roles.agentFallback}" is not available (missing key?); using ${resolved.inlineFallback} instead`);
    resolved.agentFallback = resolved.inlineFallback;
    roles.agentFallback = roles.inlineFallback;
  }
  if (!resolved.inlinePrimary || !resolved.agentPrimary) {
    fail('models-resolved', `primary model "${roles.inlinePrimary}" is not offered by a registered provider`);
  } else {
    pass('models-resolved', `inline=${resolved.inlinePrimary} agent=${resolved.agentPrimary}`);
  }
  if (!noFallback) {
    for (const [role, ref] of [['inline-fallback', roles.inlineFallback], ['agent-fallback', roles.agentFallback]] as const) {
      const r = role === 'inline-fallback' ? resolved.inlineFallback : resolved.agentFallback;
      if (!ref) warn(role, 'no fallback model configured (models.fallback); fallback agent not created');
      else if (!r) fail(role, `"${ref}" is not offered by a registered provider (missing key or model id?)`);
      else if (splitRef(r).provider === primaryProvider) warn(role, `${r} uses the same provider as the primary; --break-primary will break both`);
      else pass(role, r);
    }
  }

  // Ensure MCP server is reachable on port 3333 (start temporarily in-process if extension is not running)
  let startedOwnMcp = false;
  try {
    const healthCheck = await fetch('http://127.0.0.1:3333/health').catch(() => null);
    if (!healthCheck || !healthCheck.ok) {
      runContext.setWorkspaceRoot(process.cwd());
      await startMcpServer(3333, '127.0.0.1');
      startedOwnMcp = true;
    }
  } catch (err: any) {
    console.error('MCP server startup error in setup:', err.message);
  }

  // Steps 3–4: connectors
  for (const [name, path] of [['forgetrail-core', 'mcp-core'], ['forgetrail-extra', 'mcp-extra']]) {
    try {
      const res = await fetch(api('/settings/mcp-servers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: { type: 'remote', name, description: `ForgeTrail ${path} local MCP server`, url: `http://127.0.0.1:3333/${path}` } }),
      });
      if (res.ok || res.status === 409) pass(`connector-${path.replace('mcp-', '')}`);
      else warn(`connector-${path.replace('mcp-', '')}`, `status=${res.status} ${await readBody(res)}`);
    } catch (err: any) {
      warn(`connector-${path.replace('mcp-', '')}`, `${err.message} (start the extension first)`);
    }
  }

  // Step 5: agents-upserted
  const modelFor: Record<string, string | null> = {
    'inline.primary.json': resolved.inlinePrimary,
    'inline.fallback.json': resolved.inlineFallback,
    'agent.primary.json': resolved.agentPrimary,
    'agent.fallback.json': resolved.agentFallback,
  };
  const created: string[] = [];
  for (const filename of AGENT_FILES) {
    const model = modelFor[filename];
    if (!model) continue; // reported above
    const agentSpec = JSON.parse(readFileSync(resolve(process.cwd(), 'agents', filename), 'utf8'));
    agentSpec.manifest.model.name = model;
    const res = await fetch(api('/agents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentSpec),
    });
    if (!res.ok) {
      fail(`agent-${agentSpec.name}`, `${res.status} ${await readBody(res)}`);
    } else {
      created.push(agentSpec.name);
    }
  }
  if (created.length) pass('agents-upserted', created.join(', '));

  // Step 6: smoke tests (through TrueForge sessions, never the provider directly)
  const { TrueForge } = await import('@truefoundry/trueforge-sdk');
  const client = new TrueForge({ baseUrl: TRUEFORGE_URL, timeoutInSeconds: 60 });
  const smoke = async (agent: string): Promise<{ reply: string; error: string }> => {
    const { data: session } = await client.sessions.create({ agent: { name: agent } });
    const stream = await client.sessions.createTurnStream(session.id, {
      input: [{ type: 'user.message', content: 'Reply with the single word: ready' }],
    });
    let reply = '';
    let error = '';
    for await (const chunk of stream) {
      const event = (chunk as any)?.data ?? chunk;
      if (event?.type === 'model.message.delta') reply += event.content ?? '';
      if (event?.type === 'turn.done' && event?.state?.status === 'error') error = String(event.state.message ?? '');
    }
    return { reply: reply.trim(), error: redact(error).slice(0, 200) };
  };

  for (const [label, agent] of [['smoke-primary', 'forgetrail-inline-primary'], ['smoke-fallback', 'forgetrail-inline-fallback']]) {
    if (!created.includes(agent)) {
      console.log(`SKIP ${label}: ${agent} not created`);
      continue;
    }
    try {
      const { reply, error } = await smoke(agent);
      if (label === 'smoke-primary' && breakPrimary) {
        pass(label, `(failed as intended under --break-primary: ${error || reply || 'no reply'})`);
      } else if (reply.toLowerCase().includes('ready')) {
        pass(label);
      } else {
        fail(label, error ? error : `unexpected reply "${reply}"`);
      }
    } catch (err: any) {
      if (label === 'smoke-primary' && breakPrimary) pass(label, `(failed as intended: ${err.message})`);
      else fail(label, err.message);
    }
  }

  if (startedOwnMcp) {
    await stopMcpServer().catch(() => {});
  }

  console.log(failures === 0 ? 'Setup finished successfully.' : `Setup finished with ${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (err) => {
  console.error('Setup error:', err);
  process.exit(1);
});
