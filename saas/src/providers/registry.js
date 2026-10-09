import { env } from "../config/env.js";
import { anthropicProvider } from "./anthropic.js";
import { geminiProvider } from "./gemini.js";
import { mockProvider } from "./mock.js";
import { openAIProvider } from "./openai.js";
import { customProvider, deepseekProvider, groqProvider, mistralProvider, openRouterProvider, togetherProvider, } from "./compatible.js";
const registry = new Map();
function register(adapter) {
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
const mockEnabled = !env.isProd &&
    ['1', 'true', 'yes'].includes(String(process.env.CHAT_PILOT_ENABLE_MOCK_PROVIDER ?? '').toLowerCase());
if (mockEnabled)
    register(mockProvider);
export function getProvider(slug) {
    return registry.get(slug);
}
export function requireProvider(slug) {
    const adapter = registry.get(slug);
    if (!adapter)
        throw new Error('Unknown AI provider: ' + slug);
    return adapter;
}
export function listProviders() {
    return [...registry.values()];
}
export function isKnownProvider(slug) {
    return registry.has(slug);
}
export { mockEnabled as isMockProviderEnabled };
