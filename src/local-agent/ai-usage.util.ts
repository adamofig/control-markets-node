import { IAgenticTokenUsage } from '../agentic-conversation/models/agentic-conversation.models';

const PRICING_VERSION = 'google-2026-07-09';
const GOOGLE_STANDARD_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cachedInput: 0.025 },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cachedInput: 0.05 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, cachedInput: 0.2 },
  'gemini-2.5-flash-lite-preview-09-2025': { input: 0.1, output: 0.4, cachedInput: 0.01 },
};

const numberOrZero = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeTokenUsage(
  raw: any,
  metadata: Pick<IAgenticTokenUsage, 'provider' | 'model' | 'source'>,
): IAgenticTokenUsage | undefined {
  if (!raw) return undefined;
  const inputTokens = numberOrZero(raw.inputTokens ?? raw.promptTokens);
  const outputTokens = numberOrZero(raw.outputTokens ?? raw.completionTokens);
  const totalTokens = numberOrZero(raw.totalTokens) || inputTokens + outputTokens;
  const reasoningTokens = numberOrZero(raw.reasoningTokens ?? raw.thoughtTokens);
  const cachedInputTokens = numberOrZero(raw.cachedInputTokens ?? raw.cachedReadTokens);
  const cacheWriteTokens = numberOrZero(raw.cacheWriteTokens ?? raw.cachedWriteTokens);

  if (!inputTokens && !outputTokens && !totalTokens && !reasoningTokens && !cachedInputTokens && !cacheWriteTokens) return undefined;

  const usage: IAgenticTokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens ? { reasoningTokens } : {}),
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
    ...metadata,
  };
  const price = metadata.provider === 'google' && metadata.model ? GOOGLE_STANDARD_PRICING[metadata.model] : undefined;
  if (price) {
    const regularInput = Math.max(0, inputTokens - cachedInputTokens);
    usage.estimatedCostUsd =
      (regularInput * price.input + cachedInputTokens * (price.cachedInput ?? price.input) + outputTokens * price.output) / 1_000_000;
    usage.pricingVersion = PRICING_VERSION;
  }
  return usage;
}
