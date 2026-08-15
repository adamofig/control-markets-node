/**
 * CM-P7 — Recuperación del razonamiento desde la transcripción forense de Antigravity.
 *
 * `agy --output-format stream-json` NO emite el pensamiento del modelo. Verificado el 2026-08-14
 * contra agy 1.1.10: ningún `step_update` trae un campo `thinking`, y `tool_info.parameters` llega
 * podado (sólo los argumentos funcionales de la herramienta).
 *
 * Lo que sí existe es la transcripción que la CLI escribe en disco mientras corre:
 *
 *   ~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl
 *
 * Ese archivo es JSONL append-only, se escribe paso a paso *durante* el turno (no al final), y su
 * `step_index` alinea 1:1 con el del NDJSON. Cada línea `PLANNER_RESPONSE` puede traer:
 *
 *   - `thinking`  → el resumen de cadena de pensamiento de Gemini (esporádico: en una corrida real
 *                   de 31 herramientas aparecieron 3 bloques).
 *   - `tool_calls[].args.toolAction` / `.toolSummary` → la justificación en lenguaje natural de por
 *                   qué se invoca esa herramienta. Esto sí aparece en *todas* las llamadas, y es lo
 *                   que responde "por qué tomó ese camino" cuando no hay `thinking`.
 *
 * Este módulo lee ese archivo de forma incremental y traduce cada paso a un bloque markdown que el
 * adaptador emite como `agent_thought_chunk` (ACP), y que termina persistido en
 * `agentic_conversations.messages[].reasoning`.
 *
 * Vive aparte de `agy-acp.mjs` para poder probarse sin levantar el proceso ACP
 * (`pnpm test:agy-transcript`).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { StringDecoder } from 'node:string_decoder';

/** Raíz donde la CLI guarda una carpeta por conversación. Override para tests y hosts atípicos. */
export function brainRoot() {
  return process.env.AGY_ACP_BRAIN_DIR?.trim() || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
}

export function transcriptPathFor(conversationId, root = brainRoot()) {
  return path.join(root, conversationId, '.system_generated', 'logs', 'transcript_full.jsonl');
}

const truthy = value => ['1', 'true', 'yes'].includes(String(value ?? '').toLowerCase());

/**
 * Convierte una línea de la transcripción en el bloque markdown que verá el usuario, o `null` si
 * ese paso no aporta trazabilidad (resultados de herramienta, checkpoints, historial…).
 *
 * Función pura a propósito: es el único punto donde se decide el formato del rastro, así que es lo
 * único que hay que probar para saber que la tarjeta de "Razonamiento interno" dice la verdad.
 */
export function renderStepTrace(step, { includeToolRationale = true } = {}) {
  if (!step || typeof step !== 'object') return null;
  const index = Number.isFinite(step.step_index) ? step.step_index : '?';
  const blocks = [];

  const thinking = typeof step.thinking === 'string' ? step.thinking.trim() : '';
  if (thinking) blocks.push(`**🧠 Paso ${index} · pensamiento**\n\n${thinking}`);

  if (includeToolRationale && Array.isArray(step.tool_calls)) {
    for (const call of step.tool_calls) {
      const name = call?.name ?? call?.tool_name;
      if (!name) continue;
      const args = call?.args ?? call?.parameters ?? {};
      // `toolAction` es la frase en presente continuo que la CLI muestra en su UI ("Listing wiki
      // directory"); `toolSummary` es la versión corta. Sin ninguna de las dos no se agrega la
      // línea: el acordeón de herramientas ya lista los nombres y repetirlos sería sólo ruido.
      const rationale = [args.toolAction, args.toolSummary].find(value => typeof value === 'string' && value.trim());
      if (!rationale) continue;
      blocks.push(`**🔧 Paso ${index} · \`${name}\`** — ${rationale.trim()}`);
    }
  }

  return blocks.length ? blocks.join('\n\n') : null;
}

/** Lee lo que se haya agregado al archivo desde `offset`, tolerando UTF-8 partido entre lecturas. */
async function readAppended(pathname, offset, decoder) {
  const stat = await fs.stat(pathname).catch(() => null);
  if (!stat) return { text: '', offset, missing: true };
  // Un archivo más chico que el offset significa que la CLI lo rotó o recreó: se relee entero.
  const from = stat.size < offset ? 0 : offset;
  if (stat.size === from) return { text: '', offset: from };

  const handle = await fs.open(pathname, 'r');
  try {
    const length = stat.size - from;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, from);
    return { text: decoder.write(buffer.subarray(0, bytesRead)), offset: from + bytesRead };
  } finally {
    await handle.close();
  }
}

/**
 * Seguidor incremental de la transcripción de un turno.
 *
 * `conversationId` puede no existir todavía cuando arranca el turno (en una conversación nueva
 * llega recién con el evento `init`), así que se consulta por callback en cada vuelta del poll.
 */
export function createTranscriptTail({ getConversationId, onTrace, root = brainRoot(), pollMs = 350, includeToolRationale = true, onDebug }) {
  let offset = 0;
  let pending = '';
  let decoder = new StringDecoder('utf8');
  let started = false;
  let stopped = false;
  let timer = null;
  let skipToEnd = false;
  const emitted = new Set();
  let inFlight = Promise.resolve();

  const debug = (...args) => onDebug?.(...args);

  function handleLine(line) {
    if (!line.trim()) return;
    let step;
    try {
      step = JSON.parse(line);
    } catch {
      return; // línea a medio escribir que ya no se va a completar; el poll siguiente trae la buena
    }
    const trace = renderStepTrace(step, { includeToolRationale });
    if (!trace || emitted.has(trace)) return;
    emitted.add(trace);
    onTrace(trace);
  }

  async function poll() {
    const conversationId = getConversationId?.();
    if (!conversationId) return;
    const pathname = transcriptPathFor(conversationId, root);

    if (!started) {
      started = true;
      // Una conversación que continúa (`--conversation <id>`) reusa el mismo archivo, que ya trae
      // los turnos anteriores. Arrancar desde el final es lo que evita re-emitir el pensamiento
      // viejo en cada turno nuevo.
      if (skipToEnd) {
        const stat = await fs.stat(pathname).catch(() => null);
        offset = stat?.size ?? 0;
        debug(`transcript tail: resuming ${pathname} at byte ${offset}`);
      } else {
        debug(`transcript tail: following ${pathname} from the start`);
      }
    }

    const result = await readAppended(pathname, offset, decoder);
    offset = result.offset;
    if (!result.text) return;

    pending += result.text;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = poll().catch(error => debug('transcript tail poll failed:', error?.message ?? error));
      inFlight.finally(schedule);
    }, pollMs);
    timer.unref?.();
  }

  return {
    /**
     * @param {{ resumeFromEnd?: boolean }} options `resumeFromEnd` cuando ya se conocía el
     * `conversationId` antes del turno, es decir cuando el archivo ya tiene historia previa.
     */
    begin({ resumeFromEnd = false } = {}) {
      skipToEnd = resumeFromEnd;
      schedule();
    },

    /**
     * Drena lo que falte tras la muerte del proceso `agy`. La última línea `PLANNER_RESPONSE` suele
     * escribirse en el mismo instante en que la CLI cierra stdout, así que un único read podría
     * perderla; se reintenta un puñado de veces antes de rendirse.
     */
    async finish({ attempts = 4, delayMs = 250 } = {}) {
      clearTimeout(timer);
      await inFlight.catch(() => undefined);
      for (let attempt = 0; attempt < attempts; attempt++) {
        await poll().catch(error => debug('transcript tail drain failed:', error?.message ?? error));
        if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      if (pending.trim()) handleLine(pending);
      stopped = true;
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
    },

    /** Sólo para pruebas: fuerza una vuelta del poll sin esperar al temporizador. */
    _pollOnce: poll,
  };
}

export const TRANSCRIPT_TAIL_DISABLED = () => truthy(process.env.AGY_ACP_NO_TRANSCRIPT);
export const TRANSCRIPT_THOUGHTS_ONLY = () => truthy(process.env.AGY_ACP_TRANSCRIPT_THOUGHTS_ONLY);
