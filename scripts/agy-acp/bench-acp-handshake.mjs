#!/usr/bin/env node
/**
 * bench-acp-handshake — mide el costo fijo de abrir una sesión en CADA motor ACP del bridge.
 *
 * Habla con los mismos comandos que `ENGINE_CONFIGS` en `src/local-agent/acp-bridge.service.ts`
 * (incluido el `stripEnv` de cada motor) y cronometra `initialize` y `session/new`.
 * **No manda ningún prompt**, así que no consume tokens de LLM: mide solo el arranque, que es
 * exactamente lo que un motor con ACP nativo paga una vez por sesión y `agy` no paga nunca
 * (porque su costo vive en cada `agy --print`).
 *
 * También reporta `agentInfo.name` y los `configOptions` que anuncia cada adaptador — útil para
 * saber qué se puede negociar por protocolo (modelo, esfuerzo, modo) sin leer su código.
 *
 * Uso:
 *   node scripts/agy-acp/bench-acp-handshake.mjs              # los cuatro motores
 *   node scripts/agy-acp/bench-acp-handshake.mjs agy claude   # solo algunos
 *
 * Ojo: la primera corrida de `claude`/`codex` incluye la descarga de npx y puede tardar decenas
 * de segundos. Corré dos veces y quedate con el número en caliente.
 * Ver wiki `02-references/09-agentic-profile-(borges)/local-agent-acp-connectors-performance.md`.
 */
import { ndJsonStream, ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDORED_AGY_ACP = fileURLToPath(new URL('./agy-acp.mjs', import.meta.url));
const CWD = process.env.BENCH_ACP_CWD?.trim() || path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TIMEOUT_MS = Number(process.env.BENCH_ACP_TIMEOUT ?? 60_000);

/** Mismos comandos y stripEnv que ENGINE_CONFIGS en acp-bridge.service.ts. */
const ENGINES = {
  claude: {
    command: ['npx', ['-y', '@agentclientprotocol/claude-agent-acp@0.59.0']],
    stripEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'],
    clientCapabilities: {},
  },
  codex: {
    command: ['npx', ['-y', '@agentclientprotocol/codex-acp@latest']],
    stripEnv: [],
    clientCapabilities: {},
  },
  agy: {
    command: [process.execPath, [VENDORED_AGY_ACP]],
    stripEnv: [],
    clientCapabilities: {},
  },
};

const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout tras ${ms}ms`)), ms).unref())]);

async function benchEngine(name) {
  const config = ENGINES[name];
  if (!config) return { engine: name, error: `motor desconocido (${Object.keys(ENGINES).join(', ')})` };

  const env = { ...process.env };
  for (const key of config.stripEnv) delete env[key];

  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  const child = spawn(config.command[0], config.command[1], { cwd: CWD, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => (stderr += chunk.toString('utf-8')));

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  // Cliente mínimo: nada de esto se ejecuta sin un prompt, pero la conexión exige los handlers.
  const connection = new ClientSideConnection(
    () => ({
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      sessionUpdate: async () => {},
      writeTextFile: async () => {},
      readTextFile: async () => ({ content: '' }),
    }),
    stream
  );

  const row = { engine: name };
  try {
    const init = await withTimeout(connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: config.clientCapabilities }), TIMEOUT_MS, 'initialize');
    row.initializeMs = elapsed();
    row.agent = init.agentInfo?.name ?? '—';
    const tNewSession = performance.now();
    const created = await withTimeout(connection.newSession({ cwd: CWD, mcpServers: [] }), TIMEOUT_MS, 'session/new');
    row.newSessionMs = Math.round(performance.now() - tNewSession);
    row.totalMs = elapsed();
    row.configOptions = (created.configOptions ?? []).map(option => option?.id).filter(Boolean).join('+') || '—';
  } catch (error) {
    row.error = `${error?.message ?? error}${stderr ? ` | stderr: ${stderr.slice(0, 200).trim()}` : ''}`;
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  }
  return row;
}

const requested = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENGINES);
console.log(`cwd de la sesión: ${CWD}\n`);
for (const name of requested) {
  const row = await benchEngine(name);
  console.log(
    row.error
      ? `${row.engine.padEnd(7)} ERROR: ${row.error}`
      : `${row.engine.padEnd(7)} initialize=${String(row.initializeMs).padStart(6)}ms  session/new=${String(row.newSessionMs).padStart(6)}ms  total=${String(row.totalMs).padStart(6)}ms  agent=${row.agent}  configOptions=${row.configOptions}`
  );
}
process.exit(0);
