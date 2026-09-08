import { env } from '../config/env.ts';
import { anthropicProvider } from './anthropic.ts';
import { geminiProvider } from './gemini.ts';
import { mockProvider } from './mock.ts';
import { openAIProvider } from './openai.ts';
import {
  customProvider,
  deepseekProvider,
  groqProvider,
  mistralProvider,
  openRouterProvider,
  togetherProvider,
} from './compatible.ts';
import type { ProviderAdapter } from './types.ts';

const registry = new Map<string, ProviderAdapter>();

function register(adapter: ProviderAdapter): void {
  registry.set(adapter.slug, adapter);
}

// Order matters: this is the order the customer sees on the AI Providers
// screen. Native adapters first, then the aggregators, then the escape hatch.
register(openAIProvider);
register(anthropicProvider);
register(geminiProvider);
register(mistralProvider);
register(groqProvider);
register(deepseekProvider);
register(togetherProvider);
register(openRouterProvider);
register(customProvider);

/**
 * The mock provider exists for tests and local development only. Two
 * independent conditions must hold, so it can never be reachable in a
 * production deployment even if the env var leaks into the environment.
 */
const mockEnabled =
  !env.isProd &&
  ['1', 'true', 'yes'].includes(String(process.env.CHAT_PILOT_ENABLE_MOCK_PROVIDER ?? '').toLowerCase());

if (mockEnabled) register(mockProvider);

export function getProvider(slug: string): ProviderAdapter | undefined {
  return registry.get(slug);
}

export function requireProvider(slug: string): ProviderAdapter {
  const adapter = registry.get(slug);
  if (!adapter) throw new Error('Unknown AI provider: ' + slug);
  return adapter;
}

export function listProviders(): ProviderAdapter[] {
  return [...registry.values()];
}

export function isKnownProvider(slug: string): boolean {
  return registry.has(slug);
}

export { mockEnabled as isMockProviderEnabled };
