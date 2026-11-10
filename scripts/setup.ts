import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';

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

const env = loadEnv();
const TRUEFORGE_URL = env.TRUEFORGE_URL || 'http://localhost:8790';

// Command-line flag parsing
const args = process.argv.slice(2);
const breakPrimary = args.includes('--break-primary');
const noFallback = args.includes('--no-fallback');
const restore = args.includes('--restore');
let primaryOverride: string | null = null;
let fallbackOverride: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--primary' && args[i + 1]) {
    primaryOverride = args[i + 1];
    i++;
  } else if (args[i] === '--fallback' && args[i + 1]) {
    fallbackOverride = args[i + 1];
    i++;
  }
}

async function run() {
  console.log('ForgeTrail Setup Script starting...');
  const modelsConfigPath = resolve(process.cwd(), 'config', 'models.json');
  if (!existsSync(modelsConfigPath)) {
    console.error('Copy config/models.example.json to config/models.json.');
    process.exit(1);
  }

  // Step 1: trueforge-reachable
  try {
    const res = await fetch(`${TRUEFORGE_URL}/api/v1/catalogs/model-providers`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('PASS trueforge-reachable');
  } catch (err: any) {
    console.error(`FAIL trueforge-reachable: ${err.message}. Run "npm run trueforge" first.`);
    process.exit(1);
  }

  const secondaryKey = env.SECONDARY_API_KEY?.trim();

  // Step 2: providers-registered
  try {
    let geminiKey = env.GEMINI_API_KEY?.trim() || '';
    if (breakPrimary) {
      geminiKey = 'invalid-key-for-demo';
    }

    if (geminiKey) {
      const catalogRes = await fetch(`${TRUEFORGE_URL}/api/v1/catalogs/model-providers`);
      const catalogJson = await catalogRes.json();
      const geminiCatalog = catalogJson.data?.find((p: any) => p.type === 'google-gemini');
      const models = (geminiCatalog?.models ?? []).map((m: any) => ({
        model_id: m.model_id,
        name: m.name,
        properties: m.properties ?? { context_length: 1048576, max_output_tokens: 65536 }
      }));

      const payload = {
        manifest: {
          type: 'google-gemini',
          auth: { api_key: geminiKey },
          models
        }
      };

      const provRes = await fetch(`${TRUEFORGE_URL}/api/v1/settings/model-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!provRes.ok && provRes.status !== 409) {
        const body = await provRes.text();
        throw new Error(`Gemini provider registration failed: ${provRes.status} ${body}`);
      }
    }

    // Optional secondary provider if configured
    if (secondaryKey) {
      const secPayload = {
        manifest: {
          type: 'custom',
          name: 'secondary-provider',
          base_url: env.SECONDARY_BASE_URL || 'https://api.groq.com/openai/v1',
          auth: { api_key: secondaryKey },
          models: [
            {
              model_id: 'llama-3.3-70b-versatile',
              name: 'llama-3.3-70b-versatile',
              properties: { context_length: 131072, max_output_tokens: 4096 }
            }
          ]
        }
      };
      await fetch(`${TRUEFORGE_URL}/api/v1/settings/model-providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secPayload)
      });
    }

    console.log('PASS providers-registered');
  } catch (err: any) {
    console.error(`FAIL providers-registered: ${err.message}`);
    process.exit(1);
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

  // Step 3: connector-core
  try {
    const payload = {
      manifest: {
        type: 'remote',
        name: 'forgetrail-core',
        description: 'ForgeTrail Core local MCP server',
        url: 'http://127.0.0.1:3333/mcp-core'
      }
    };
    const res = await fetch(`${TRUEFORGE_URL}/api/v1/settings/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok || res.status === 409) {
      console.log('PASS connector-core');
    } else {
      const errText = await res.text();
      console.log(`WARN connector-core: status=${res.status} body=${errText}`);
    }
  } catch (err: any) {
    console.log(`WARN connector-core: ${err.message} (start the extension first)`);
  }

  // Step 4: connector-extra
  try {
    const payload = {
      manifest: {
        type: 'remote',
        name: 'forgetrail-extra',
        description: 'ForgeTrail Extra local MCP server',
        url: 'http://127.0.0.1:3333/mcp-extra'
      }
    };
    const res = await fetch(`${TRUEFORGE_URL}/api/v1/settings/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok || res.status === 409) {
      console.log('PASS connector-extra');
    } else {
      console.log('WARN connector-extra: start the extension (F5) first');
    }
  } catch (err: any) {
    console.log(`WARN connector-extra: ${err.message} (start the extension first)`);
  }

  // Step 5: agents-upserted
  try {
    const listRes = await fetch(`${TRUEFORGE_URL}/api/v1/agents`);
    const listData = await listRes.json();
    const existingAgents = listData.data || [];

    const agentFiles = [
      'inline.primary.json',
      'inline.fallback.json',
      'agent.primary.json',
      'agent.fallback.json'
    ];

    for (const filename of agentFiles) {
      if (noFallback && filename.includes('fallback')) {
        const toDelete = existingAgents.find((a: any) => a.name.includes('fallback'));
        if (toDelete) {
          await fetch(`${TRUEFORGE_URL}/api/v1/agents/${toDelete.id}`, { method: 'DELETE' });
        }
        continue;
      }

      const agentPath = resolve(process.cwd(), 'agents', filename);
      if (!existsSync(agentPath)) continue;
      const agentSpec = JSON.parse(readFileSync(agentPath, 'utf8'));

      if (primaryOverride && filename.includes('primary')) {
        agentSpec.manifest.model.name = primaryOverride;
      }
      if (fallbackOverride && filename.includes('fallback')) {
        agentSpec.manifest.model.name = fallbackOverride;
      } else if (!secondaryKey && filename.includes('fallback')) {
        // Fallback to primary provider model if secondary key is not configured
        agentSpec.manifest.model.name = 'google-gemini/gemini-3-1-flash-lite';
      }

      const existing = existingAgents.find((a: any) => a.name === agentSpec.name);
      if (existing) {
        const updateRes = await fetch(`${TRUEFORGE_URL}/api/v1/agents/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: agentSpec.description,
            manifest: agentSpec.manifest
          })
        });
        if (!updateRes.ok) {
          const errBody = await updateRes.text();
          throw new Error(`Failed to update ${agentSpec.name}: ${updateRes.status} ${errBody}`);
        }
      } else {
        const createRes = await fetch(`${TRUEFORGE_URL}/api/v1/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentSpec)
        });
        if (!createRes.ok) {
          const errBody = await createRes.text();
          throw new Error(`Failed to create ${agentSpec.name}: ${createRes.status} ${errBody}`);
        }
      }
    }
    console.log('PASS agents-upserted');
  } catch (err: any) {
    console.error(`FAIL agents-upserted: ${err.message}`);
    if (startedOwnMcp) await stopMcpServer().catch(() => {});
    process.exit(1);
  }

  // Step 6: smoke-primary and smoke-fallback
  const { TrueForge } = await import('@truefoundry/trueforge-sdk');
  const client = new TrueForge({ baseUrl: TRUEFORGE_URL, timeoutInSeconds: 30 });

  // Smoke test primary
  try {
    const { data: session } = await client.sessions.create({
      agent: { name: 'forgetrail-inline-primary' }
    });
    const stream = await client.sessions.createTurnStream(session.id, {
      input: [{ type: 'user.message', content: 'Reply with the single word: ready' }]
    });

    let reply = '';
    const allEvents: any[] = [];
    for await (const chunk of stream) {
      allEvents.push(chunk);
      const event = (chunk as any)?.data ?? chunk;
      if (event?.type === 'model.message.delta') {
        reply += (event as any).content ?? '';
      }
    }
    if (reply.toLowerCase().includes('ready')) {
      console.log('PASS smoke-primary');
    } else {
      console.log(`FAIL smoke-primary: unexpected reply "${reply.trim()}"`);
      console.log('Events received:', JSON.stringify(allEvents, null, 2));
      if (startedOwnMcp) await stopMcpServer().catch(() => {});
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`FAIL smoke-primary: ${err.message}`);
    if (startedOwnMcp) await stopMcpServer().catch(() => {});
    process.exit(1);
  }

  // Smoke test fallback (if not disabled)
  if (!noFallback && !breakPrimary) {
    try {
      const { data: session } = await client.sessions.create({
        agent: { name: 'forgetrail-inline-fallback' }
      });
      const stream = await client.sessions.createTurnStream(session.id, {
        input: [{ type: 'user.message', content: 'Reply with the single word: ready' }]
      });

      let reply = '';
      for await (const chunk of stream) {
        const event = (chunk as any)?.data ?? chunk;
        if (event?.type === 'model.message.delta') {
          reply += (event as any).content ?? '';
        }
      }
      if (reply.toLowerCase().includes('ready')) {
        console.log('PASS smoke-fallback');
      } else {
        console.log(`WARN smoke-fallback: reply was "${reply.trim()}"`);
      }
    } catch (err: any) {
      console.log(`WARN smoke-fallback: ${err.message}`);
    }
  }

  if (startedOwnMcp) {
    await stopMcpServer().catch(() => {});
  }

  console.log('Setup finished successfully.');
  process.exit(0);
}

run().catch(async (err) => {
  console.error('Setup error:', err);
  process.exit(1);
});
