/** Pasos del pipeline automático de una escena, en orden de ejecución. */
export type ScenePipelineStepName = 'speech' | 'captions' | 'image' | 'video' | 'render';

/**
 * - `done`: el paso corrió y generó algo nuevo.
 * - `skipped`: ya estaba hecho y no se pidió `force` — no se gasta IA de nuevo.
 * - `blocked`: falta un insumo (guion, prompt o fondo). No es un error: la escena no está lista.
 * - `failed`: el paso corrió y se rompió; el detalle trae el mensaje.
 */
export type ScenePipelineStepStatus = 'done' | 'skipped' | 'blocked' | 'failed';

export interface IScenePipelineStep {
  step: ScenePipelineStepName;
  status: ScenePipelineStepStatus;
  detail?: string;
}

export interface IScenePipelineResult {
  sceneId: string;
  name?: string;
  steps: IScenePipelineStep[];
  /** false si algún paso terminó en `failed`. Un `blocked` no cuenta como fallo. */
  ok: boolean;
  /** true cuando la escena terminó con su MP4 final. */
  rendered: boolean;
}

export interface IScenePipelineOptions {
  /** Regenera media que ya existe. Por defecto sólo se completa lo que falta. */
  force?: boolean;
  /** Renderiza el MP4 final cuando la escena queda con voz + fondo. Por defecto sí. */
  render?: boolean;
}
