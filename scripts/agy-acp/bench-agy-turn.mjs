#!/usr/bin/env node
/**
 * bench-agy-turn — mide dónde se va el tiempo de UN turno headless de `agy`.
 *
 * Spawnea `agy --print … --output-format stream-json` exactamente como lo hace el adaptador
 * (agy-acp.mjs) y cronometra los cuatro hitos que importan:
 *
 *   PRIMER EVENTO   → cuánto tarda `agy` en arrancar antes de emitir NDJSON (el costo fijo)
 *   primer step     → conversación creada y mensaje enviado
 *   PRIMER text_delta → time-to-first-token real del modelo
 *   result          → status + usage del turno
 *
 * La diferencia entre "PRIMER EVENTO" y `result.duration_seconds` es el punto del ejercicio:
 * el arranque no es inferencia, y se paga en cada turno porque headless es un proceso por prompt.
 * Ver wiki `02-references/09-agentic-profile-(borges)/local-agent-acp-connectors-performance.md`.
 *
 * Uso:
 *   node scripts/agy-acp/bench-agy-turn.mjs
 *   node scripts/agy-acp/bench-agy-turn.mjs "otro prompt" --model gemini-3.6-flash --effort low
 *   node scripts/agy-acp/bench-agy-turn.mjs "sigue" --conversation <id>   # turno de continuación
 *
 * El primer argumento sin `--` es el prompt; el resto se pasa tal cual a `agy`.
 * Cada corrida consume una petición real al backend de Antigravity: usa prompts triviales.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function resolveAgyBin() {
  const configured = process.env.AGY_ACP_AGY_BIN?.trim();
  if (configured) return configured;
  const candidates = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'agy')), path.join(os.homedir(), '.local', 'bin', 'agy')];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return 'agy';
}

const argv = process.argv.slice(2);
const prompt = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'Responde solo con la palabra ok';
const args = ['--print', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions', ...argv];

const t0 = performance.now();
const ms = () => (performance.now() - t0).toFixed(0).padStart(6);

const child = spawn(resolveAgyBin(), args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
let buffer = '';
let sawEvent = false;
let sawStep = false;
let sawDelta = false;

child.stdout.on('data', chunk => {
  buffer += chunk.toString('utf-8');
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!sawEvent) {
      sawEvent = true;
      console.log(`${ms()}ms  PRIMER EVENTO (fin del arranque de agy)`);
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.event === 'step_update') {
      const step = event.step_update ?? {};
      if (!sawStep) {
        sawStep = true;
        console.log(`${ms()}ms  primer step_update (${step.step_type}/${step.state})`);
      }
      if (step.text_delta && !sawDelta) {
        sawDelta = true;
        console.log(`${ms()}ms  PRIMER text_delta — time-to-first-token`);
      }
    }
    if (event.event === 'result') {
      const result = event.result ?? {};
      console.log(`${ms()}ms  result status=${result.status} turns=${result.num_turns} modelo=${result.duration_seconds}s`);
      console.log(`        usage=${JSON.stringify(result.usage)}`);
    }
  }
});

child.stderr.on('data', chunk => process.stderr.write(`[agy stderr] ${chunk}`));
child.on('error', err => console.error(`no se pudo lanzar agy: ${err.message}`));
child.on('close', code => {
  console.log(`${ms()}ms  EXIT ${code}`);
  console.log(`        args: ${args.filter(a => a !== prompt).join(' ')}   cwd: ${process.cwd()}`);
});
