#!/usr/bin/env node
/**
 * Conformance harness for the vendored agy-acp adapter.
 *
 * Drives `agy-acp.mjs` with the very same ACP client the backend uses (`ClientSideConnection`
 * from @agentclientprotocol/sdk), so a green run means AcpBridgeService can talk to it too.
 *
 *   node scripts/agy-acp/test-agy-acp.mjs            # full suite
 *   node scripts/agy-acp/test-agy-acp.mjs --quick    # skip the slow cancel/resume cases
 *
 * Requires a working `agy` login on this host; every prompt case really calls Antigravity.
 */
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';

const acp = await import('@agentclientprotocol/sdk');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = path.join(HERE, 'agy-acp.mjs');
const QUICK = process.argv.includes('--quick');
const STATE_FILE = path.join(os.tmpdir(), `agy-acp-test-state-${process.pid}.json`);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Boots one adapter process and returns an ACP client bound to it. */
function startAdapter(cwd, env = {}) {
  const child = spawn(process.execPath, [ADAPTER], {
    cwd,
    env: { ...process.env, AGY_ACP_DEBUG: '1', AGY_ACP_STATE_FILE: STATE_FILE, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = { text: '' };
  child.stderr.on('data', c => (stderr.text += c.toString()));

  const events = [];
  const handler = {
    sessionUpdate: async params => {
      events.push(params.update);
    },
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    readTextFile: async () => ({ content: '' }),
    writeTextFile: async () => ({}),
  };
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const connection = new acp.ClientSideConnection(() => handler, stream);
  return { child, connection, events, stderr, kill: () => child.kill('SIGTERM') };
}

const textOf = events =>
  events
    .filter(e => e.sessionUpdate === 'agent_message_chunk' && e.content?.type === 'text')
    .map(e => e.content.text)
    .join('');

async function main() {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), 'agy-acp-work-'));
  const extraRoot = await mkdtemp(path.join(os.tmpdir(), 'agy-acp-extra-'));
  await writeFile(path.join(workRoot, 'marcador.txt'), 'el codigo secreto es ZANZIBAR-77\n', 'utf-8');

  console.log(`\nAdapter: ${ADAPTER}`);
  console.log(`cwd:     ${workRoot}`);
  console.log(`extra:   ${extraRoot}\n`);

  const a = startAdapter(workRoot);
  let sessionId;

  try {
    // --- T1 handshake -------------------------------------------------------
    console.log('T1 · handshake ACP');
    const init = await a.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    check('initialize responde con protocolVersion', init.protocolVersion === acp.PROTOCOL_VERSION, `v${init.protocolVersion}`);
    check('anuncia promptCapabilities.embeddedContext', init.agentCapabilities?.promptCapabilities?.embeddedContext === true);
    check('anuncia sessionCapabilities.resume', Boolean(init.agentCapabilities?.sessionCapabilities?.resume));
    check('anuncia sessionCapabilities.additionalDirectories', Boolean(init.agentCapabilities?.sessionCapabilities?.additionalDirectories));
    check('agentInfo.version es el fork local', String(init.agentInfo?.version ?? '').includes('cm'), init.agentInfo?.version);

    // --- T2 session/new + config options ------------------------------------
    console.log('\nT2 · session/new con multi-root y configOptions');
    const created = await a.connection.newSession({ cwd: workRoot, mcpServers: [], additionalDirectories: [extraRoot] });
    sessionId = created.sessionId;
    const modelOption = created.configOptions?.find(o => o.id === 'model');
    const effortOption = created.configOptions?.find(o => o.id === 'effort');
    check('devuelve sessionId', Boolean(sessionId), sessionId);
    check('configOptions[id=model] con catálogo', (modelOption?.options?.length ?? 0) >= 6, `${modelOption?.options?.length} modelos, actual ${modelOption?.currentValue}`);
    check('configOptions[id=effort] presente', Boolean(effortOption), `actual ${effortOption?.currentValue}`);
    check('modos plan/accept-edits expuestos', (created.modes?.availableModes?.length ?? 0) === 2);

    // --- T3 set_config_option ----------------------------------------------
    console.log('\nT3 · session/set_config_option (model + effort)');
    const afterModel = await a.connection.setSessionConfigOption({ sessionId, configId: 'model', value: 'gemini-3.5-flash' });
    check('cambia el modelo', afterModel?.configOptions?.find(o => o.id === 'model')?.currentValue === 'gemini-3.5-flash');
    const afterEffort = await a.connection.setSessionConfigOption({ sessionId, configId: 'effort', value: 'low' });
    check('cambia el effort', afterEffort?.configOptions?.find(o => o.id === 'effort')?.currentValue === 'low');

    // --- T4 turno de texto + tokens ----------------------------------------
    console.log('\nT4 · turno de texto, streaming incremental y tokens (CM-P1)');
    a.events.length = 0;
    const t4 = await a.connection.prompt({
      sessionId,
      prompt: [
        { type: 'resource', resource: { uri: 'context://agentic-profile', mimeType: 'text/markdown', text: '# Perfil\nEres Borges, agente de Control Markets.' } },
        { type: 'text', text: 'Responde en una sola línea: ¿cómo te llamas según el contexto?' },
      ],
    });
    const chunks = a.events.filter(e => e.sessionUpdate === 'agent_message_chunk');
    check('stopReason end_turn', t4.stopReason === 'end_turn', t4.stopReason);
    check('llegan agent_message_chunk', chunks.length >= 1, `${chunks.length} chunks`);
    check('el texto reconstruido no está vacío', textOf(a.events).trim().length > 0, JSON.stringify(textOf(a.events).slice(0, 80)));
    check('el contexto embebido llegó al modelo', /borges/i.test(textOf(a.events)), 'respuesta menciona a Borges');
    check('PromptResponse.usage presente', Boolean(t4.usage), JSON.stringify(t4.usage ?? null));
    check('usage.inputTokens > 0', (t4.usage?.inputTokens ?? 0) > 0, String(t4.usage?.inputTokens));
    check('usage.outputTokens > 0', (t4.usage?.outputTokens ?? 0) > 0, String(t4.usage?.outputTokens));
    check(
      'usage.totalTokens coherente',
      (t4.usage?.totalTokens ?? 0) >= (t4.usage?.inputTokens ?? 0) + (t4.usage?.outputTokens ?? 0),
      `${t4.usage?.totalTokens} >= ${t4.usage?.inputTokens} + ${t4.usage?.outputTokens}`
    );
    check('usage_update (ocupación de contexto) emitido', a.events.some(e => e.sessionUpdate === 'usage_update'));

    // --- T5 continuidad de conversación -------------------------------------
    console.log('\nT5 · continuidad (--conversation reutilizado)');
    const state1 = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    const conversationId = state1.sessions[sessionId]?.conversationId;
    check('el state file guardó conversationId', Boolean(conversationId), conversationId);
    a.events.length = 0;
    await a.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'En una palabra: ¿qué nombre te di antes?' }] });
    check('el 2º turno recuerda el contexto previo', /borges/i.test(textOf(a.events)), JSON.stringify(textOf(a.events).slice(0, 80)));
    check('reusó --conversation en el spawn', a.stderr.text.includes(`--conversation ${conversationId}`));

    // --- T6 multi-root en la línea de comando -------------------------------
    console.log('\nT6 · multi-root propagado como --add-dir');
    check('el spawn incluye --add-dir del root extra', a.stderr.text.includes(`--add-dir ${extraRoot}`), extraRoot);
    check('el spawn incluye --print-timeout', /--print-timeout \S+/.test(a.stderr.text));
    check('el spawn incluye --dangerously-skip-permissions', a.stderr.text.includes('--dangerously-skip-permissions'));

    // --- T7 herramientas ----------------------------------------------------
    console.log('\nT7 · turno con herramientas (tool_call / tool_call_update)');
    a.events.length = 0;
    await a.connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: `Lee el archivo marcador.txt del directorio actual y dime literalmente el código secreto que contiene.` }],
    });
    const toolCalls = a.events.filter(e => e.sessionUpdate === 'tool_call');
    const toolUpdates = a.events.filter(e => e.sessionUpdate === 'tool_call_update');
    check('emitió tool_call', toolCalls.length > 0, toolCalls.map(t => t.title).join(', '));
    check('emitió tool_call_update', toolUpdates.length > 0, toolUpdates.map(t => t.status).join(', '));
    check('la herramienta leyó el archivo real', /ZANZIBAR-77/i.test(textOf(a.events)), JSON.stringify(textOf(a.events).slice(0, 120)));

    // CM-P7: el razonamiento no viaja por stream-json, se recupera de la transcripción en disco.
    // Un turno con herramientas siempre trae al menos la justificación de la llamada (`toolAction`);
    // el bloque `thinking` es esporádico, así que no se puede exigir.
    const thoughts = a.events.filter(e => e.sessionUpdate === 'agent_thought_chunk');
    const thoughtText = thoughts.map(e => e.content?.text ?? '').join('');
    check('emitió agent_thought_chunk (CM-P7)', thoughts.length > 0, `${thoughts.length} bloques`);
    check('el rastro justifica la herramienta', /🔧 Paso \d+ · `\w+`/.test(thoughtText), thoughtText.split('\n')[0]?.slice(0, 90));

    if (!QUICK) {
      // --- T8 cancelación ---------------------------------------------------
      console.log('\nT8 · cancelación a mitad de turno');
      a.events.length = 0;
      const pending = a.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Escribe un ensayo de 2000 palabras sobre la historia del ferrocarril.' }] });
      await new Promise(r => setTimeout(r, 4000));
      await a.connection.cancel({ sessionId });
      const t8 = await pending;
      check('stopReason cancelled', t8.stopReason === 'cancelled', t8.stopReason);

      // --- T9 resume tras respawn -------------------------------------------
      console.log('\nT9 · session/resume tras reiniciar el adaptador');
      a.kill();
      await new Promise(r => setTimeout(r, 500));
      const b = startAdapter(workRoot);
      try {
        const init2 = await b.connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
        check('el nuevo proceso anuncia resume', Boolean(init2.agentCapabilities?.sessionCapabilities?.resume));
        const resumed = await b.connection.resumeSession({ sessionId, cwd: workRoot, mcpServers: [], additionalDirectories: [extraRoot] });
        check('session/resume acepta el sessionId viejo', resumed.sessionId === sessionId);
        b.events.length = 0;
        await b.connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'En una palabra: ¿qué código secreto leíste antes?' }] });
        check('la conversación sobrevivió al respawn', /ZANZIBAR/i.test(textOf(b.events)), JSON.stringify(textOf(b.events).slice(0, 100)));
      } finally {
        b.kill();
      }
    }
  } finally {
    a.kill();
    await rm(workRoot, { recursive: true, force: true });
    await rm(extraRoot, { recursive: true, force: true });
    await rm(STATE_FILE, { force: true });
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} verificaciones OK`);
  if (failed.length) {
    console.log('Fallaron:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 Harness error:', err);
  process.exit(1);
});
