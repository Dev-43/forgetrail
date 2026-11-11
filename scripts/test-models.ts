import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

interface ModelBenchmark {
  provider: string;
  model: string;
  plainChat: boolean;
  toolCall3x: boolean;
  avgLatencyMs: number;
  rateLimitObserved?: string;
  freeTierLimits: string;
  contextWindow: string;
  notes: string;
}

async function benchmarkCandidate(
  name: string,
  agentName: string
): Promise<ModelBenchmark> {
  const { TrueForge } = await import('@truefoundry/trueforge-sdk');
  const client = new TrueForge({ baseUrl: TRUEFORGE_URL, timeoutInSeconds: 30 });

  const record: ModelBenchmark = {
    provider: name.split('/')[0] || 'unknown',
    model: name.split('/')[1] || name,
    plainChat: false,
    toolCall3x: false,
    avgLatencyMs: 0,
    freeTierLimits: '15 RPM / 250k TPM / 500 RPD',
    contextWindow: '1M tokens',
    notes: '',
  };

  try {
    // 1. Plain chat test
    const startTime = Date.now();
    const { data: session } = await client.sessions.create({ agent: { name: agentName } });
    const stream = await client.sessions.createTurnStream(session.id, {
      input: [{ type: 'user.message', content: 'Say the word ready' }]
    });

    let reply = '';
    for await (const chunk of stream) {
      const event = (chunk as any)?.data ?? chunk;
      if (event?.type === 'model.message.delta') {
        reply += (event as any).content ?? '';
      }
    }
    const duration = Date.now() - startTime;
    record.avgLatencyMs = duration;
    record.plainChat = reply.toLowerCase().includes('ready');

    // 2. Tool call test (3 iterations)
    let toolSuccesses = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const { data: toolSession } = await client.sessions.create({ agent: { name: agentName } });
        const toolStream = await client.sessions.createTurnStream(toolSession.id, {
          input: [{ type: 'user.message', content: 'Call read_file for package.json lines 1 to 5' }]
        });
        let hasToolCall = false;
        for await (const chunk of toolStream) {
          const event = (chunk as any)?.data ?? chunk;
          if (event?.type === 'tool.call' || event?.type === 'tool.response') {
            hasToolCall = true;
          }
        }
        if (hasToolCall) toolSuccesses++;
      } catch {
        // failed iteration
      }
    }
    record.toolCall3x = toolSuccesses === 3;
    record.notes = `Tool calls passed: ${toolSuccesses}/3`;
  } catch (err: any) {
    record.notes = `Failed: ${err.message}`;
    if (err.message.includes('429')) {
      record.rateLimitObserved = '429 Quota Exceeded (Free Tier limit hit)';
    }
  }

  return record;
}

async function main() {
  console.log('Testing model candidates against local TrueForge...');
  const results: ModelBenchmark[] = [];

  const candidates = [
    { name: 'google-gemini/gemini-flash-lite-latest', agent: 'forgetrail-inline-primary' },
    { name: 'google-gemini/gemini-3-1-flash-lite', agent: 'forgetrail-inline-fallback' },
  ];

  for (const c of candidates) {
    console.log(`Benchmarking ${c.name}...`);
    const bench = await benchmarkCandidate(c.name, c.agent);
    results.push(bench);
  }

  console.log('\n========================================');
  console.log('Model Benchmark Matrix:');
  console.log('========================================');
  console.table(results);
}

if (process.argv[1] && process.argv[1].includes('test-models')) {
  main().catch(console.error);
}

export { benchmarkCandidate };
