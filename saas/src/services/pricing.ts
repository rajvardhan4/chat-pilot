/**
 * Estimated AI cost.
 *
 * This is Chat Pilot's own estimate from tracked token usage and a configurable
 * price table - explicitly NOT the provider's billed amount. Rates are stored
 * in platform_settings so the platform owner can update them without a deploy,
 * which is what keeps the estimate honest as provider pricing changes.
 *
 * All rates are USD per 1,000,000 tokens.
 */
import { col, nowIso } from '../db/mongo.ts';

export interface ModelRate {
  input: number;
  output: number;
}

const BUILTIN_RATES: Record<string, ModelRate> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  o1: { input: 15, output: 60 },
  'o3-mini': { input: 1.1, output: 4.4 },
  // Anthropic (Claude) - USD per 1M tokens
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Mistral
  'mistral-large': { input: 2, output: 6 },
  'mistral-medium': { input: 0.4, output: 2 },
  'mistral-small': { input: 0.1, output: 0.3 },
  // Llama-family, priced per host. Prefix keys, so dated and suffixed ids
  // ("llama-3.3-70b-versatile", "...-Instruct-Turbo") resolve correctly.
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'meta-llama/llama-3.3-70b': { input: 0.88, output: 0.88 },
  'meta-llama/meta-llama-3.1-8b': { input: 0.18, output: 0.18 },
  'meta-llama/llama-3.1-8b': { input: 0.18, output: 0.18 },
  // DeepSeek
  'deepseek-chat': { input: 0.28, output: 0.42 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Gemini
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-flash-latest': { input: 0.3, output: 2.5 },
  'gemini-pro-latest': { input: 1.25, output: 10 },
  // Testing
  'mock-small': { input: 0, output: 0 },
  'mock-large': { input: 0, output: 0 },
  // Fallback for an unrecognised model
  default: { input: 1.0, output: 3.0 },
};

const SETTINGS_KEY = 'pricing.model_rates';

async function overrides(): Promise<Record<string, ModelRate>> {
  const row = await col<{ _id: string; value: string }>('platform_settings').findOne({ _id: SETTINGS_KEY as never });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Record<string, ModelRate>;
  } catch {
    return {};
  }
}

export async function allRates(): Promise<Record<string, ModelRate>> {
  return { ...BUILTIN_RATES, ...(await overrides()) };
}

export async function setRateOverrides(rates: Record<string, ModelRate>): Promise<void> {
  await col('platform_settings').updateOne(
    { _id: SETTINGS_KEY as never },
    { $set: { value: JSON.stringify(rates), updated_at: nowIso() } },
    { upsert: true },
  );
}

/**
 * Normalises a model id so aggregator-namespaced ids resolve to the same rate
 * as the vendor's own id.
 *
 * Aggregators (OpenRouter, Together) prefix the vendor — "anthropic/claude-..." —
 * and some spell versions with dots where the vendor uses dashes. Without this,
 * every model routed through an aggregator would silently fall through to the
 * generic default rate and mis-state the customer's estimated cost.
 */
export function normaliseModelId(model: string): string[] {
  const raw = (model ?? '').trim().toLowerCase();
  const candidates = new Set<string>([raw]);

  const withoutVendor = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : '';
  if (withoutVendor) candidates.add(withoutVendor);

  // claude-sonnet-4.5 -> claude-sonnet-4-5
  for (const candidate of [...candidates]) {
    if (candidate.includes('.')) candidates.add(candidate.replace(/\./g, '-'));
  }
  return [...candidates].filter(Boolean);
}

export async function rateFor(model: string): Promise<ModelRate> {
  const rates = await allRates();
  const candidates = normaliseModelId(model);

  for (const candidate of candidates) {
    if (rates[candidate]) return rates[candidate];
  }
  const key = candidates[0] ?? '';
  // Longest prefix match handles dated ids like gpt-4o-2024-08-06.
  let best: { len: number; rate: ModelRate } | null = null;
  for (const candidate of candidates) {
    for (const [name, rate] of Object.entries(rates)) {
      if (name === 'default') continue;
      if (candidate.startsWith(name) && (!best || name.length > best.len)) {
        best = { len: name.length, rate };
      }
    }
  }
  void key;
  return best?.rate ?? (rates.default as ModelRate);
}

export async function estimateCost(
  _provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number> {
  if (!inputTokens && !outputTokens) return 0;
  const rate = await rateFor(model);
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}
