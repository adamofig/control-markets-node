#!/usr/bin/env node
/**
 * Pruebas del lector de transcripción forense (CM-P7).
 *
 *   node scripts/agy-acp/test-transcript-tail.mjs
 *
 * No necesita `agy` ni login: escribe una transcripción sintética con la misma forma que la real
 * (verificada contra agy 1.1.10 el 2026-08-14) y comprueba qué termina en la tarjeta de
 * "Razonamiento interno".
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { createTranscriptTail, renderStepTrace, transcriptPathFor } from './transcript-tail.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Pasos reales, copiados de ~/.gemini/antigravity-cli/brain/<id>/.../transcript_full.jsonl
const STEP_WITH_THINKING = {
  step_index: 2,
  source: 'MODEL',
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  thinking: "**Defining Cortazar's Role**\n\nOkay, I'm focusing on defining Cortazar's role.\n\n\n",
  tool_calls: [{ name: 'list_dir', args: { DirectoryPath: '/tmp/wiki', toolAction: 'Listing wiki directory', toolSummary: 'List wiki directory contents' } }],
};
const STEP_TOOL_ONLY = {
  step_index: 5,
  type: 'PLANNER_RESPONSE',
  status: 'DONE',
  tool_calls: [{ name: 'search_web', args: { query: 'economonos', toolAction: 'Searching the web for the channel' } }],
};
const STEP_NO_RATIONALE = { step_index: 6, type: 'LIST_DIRECTORY', status: 'DONE', content: 'a\nb\nc' };
const STEP_TOOL_WITHOUT_ACTION = { step_index: 7, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'view_file', args: { TargetFile: '/tmp/x.md' } }] };

console.log('\n▶ renderStepTrace');
{
  const trace = renderStepTrace(STEP_WITH_THINKING);
  check('el pensamiento entra en el rastro', trace?.includes("Defining Cortazar's Role"));
  check('el pensamiento se etiqueta con su paso', trace?.includes('🧠 Paso 2 · pensamiento'));
  check('la herramienta aporta su justificación', trace?.includes('`list_dir`') && trace.includes('Listing wiki directory'));

  check('un paso sólo-herramienta produce rastro', renderStepTrace(STEP_TOOL_ONLY)?.includes('Searching the web for the channel'));
  check('un resultado de herramienta no produce rastro', renderStepTrace(STEP_NO_RATIONALE) === null);
  check('una llamada sin justificación no ensucia el rastro', renderStepTrace(STEP_TOOL_WITHOUT_ACTION) === null);
  check('thoughts-only descarta las líneas de herramienta', !renderStepTrace(STEP_WITH_THINKING, { includeToolRationale: false })?.includes('list_dir'));
  check('entrada basura no rompe', renderStepTrace(null) === null && renderStepTrace('x') === null);
}

console.log('\n▶ createTranscriptTail');
const root = await mkdtemp(path.join(os.tmpdir(), 'agy-transcript-test-'));
const conversationId = 'conv-1';
const file = transcriptPathFor(conversationId, root);
await mkdir(path.dirname(file), { recursive: true });

const line = step => JSON.stringify(step) + '\n';

try {
  // --- turno nuevo: el archivo aparece después de arrancar el tailer -----------------------------
  {
    const traces = [];
    let cid = null;
    const tail = createTranscriptTail({ getConversationId: () => cid, onTrace: t => traces.push(t), root, pollMs: 10 });
    tail.begin({ resumeFromEnd: false });

    await tail._pollOnce();
    check('sin conversationId no lee nada', traces.length === 0);

    cid = conversationId;
    await writeFile(file, line({ step_index: 0, type: 'USER_INPUT', content: 'hola' }));
    await tail._pollOnce();
    check('USER_INPUT no genera rastro', traces.length === 0);

    await appendFile(file, line(STEP_WITH_THINKING));
    await tail._pollOnce();
    check('el pensamiento se emite en cuanto se escribe', traces.length === 1 && traces[0].includes("Defining Cortazar's Role"));

    await tail._pollOnce();
    check('un poll sin novedades no re-emite', traces.length === 1);

    // Línea a medio escribir: la CLI hace flush por partes cuando el payload es grande.
    const partial = line(STEP_TOOL_ONLY);
    await appendFile(file, partial.slice(0, 20));
    await tail._pollOnce();
    check('una línea incompleta no se emite todavía', traces.length === 1);

    await appendFile(file, partial.slice(20));
    await tail._pollOnce();
    check('la línea se emite al completarse', traces.length === 2 && traces[1].includes('Searching the web'));

    await appendFile(file, line({ step_index: 8, type: 'PLANNER_RESPONSE', thinking: 'Cierre del turno.' }));
    await tail.finish({ attempts: 1, delayMs: 0 });
    check('finish() drena el último paso', traces.length === 3 && traces[2].includes('Cierre del turno'));
    tail.stop();
  }

  // --- turno siguiente de la misma conversación -------------------------------------------------
  {
    const traces = [];
    const tail = createTranscriptTail({ getConversationId: () => conversationId, onTrace: t => traces.push(t), root, pollMs: 10 });
    tail.begin({ resumeFromEnd: true });

    await tail._pollOnce();
    check('una conversación que continúa no repite el pensamiento anterior', traces.length === 0);

    await appendFile(file, line({ step_index: 9, type: 'PLANNER_RESPONSE', thinking: 'Pensamiento del segundo turno.' }));
    await tail._pollOnce();
    check('sí emite el pensamiento nuevo', traces.length === 1 && traces[0].includes('segundo turno'));
    tail.stop();
  }

  // --- acentos partidos entre dos lecturas ------------------------------------------------------
  {
    const traces = [];
    const cid2 = 'conv-utf8';
    const file2 = transcriptPathFor(cid2, root);
    await mkdir(path.dirname(file2), { recursive: true });
    const payload = Buffer.from(line({ step_index: 0, type: 'PLANNER_RESPONSE', thinking: 'Razonamiento con ñ y é' }));
    // Corta justo dentro del multibyte de la 'ñ' para forzar el caso.
    const cut = payload.indexOf(Buffer.from('ñ')) + 1;
    await writeFile(file2, payload.subarray(0, cut));

    const tail = createTranscriptTail({ getConversationId: () => cid2, onTrace: t => traces.push(t), root, pollMs: 10 });
    tail.begin();
    await tail._pollOnce();
    await appendFile(file2, payload.subarray(cut));
    await tail._pollOnce();
    check('un carácter UTF-8 partido entre lecturas se reconstruye', traces.length === 1 && traces[0].includes('con ñ y é'), traces[0]?.slice(-30));
    tail.stop();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificaciones OK`);
process.exit(failed.length ? 1 : 0);
