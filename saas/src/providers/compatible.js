/**
 * Every provider that speaks the OpenAI Chat Completions shape, as
 * configuration rather than code.
 *
 * Adding another one is a single entry here — no new file, no new tests, and
 * no risk of the eight existing adapters drifting apart.
 */
import { createOpenAICompatibleProvider } from "./openAICompatible.js";
export const mistralProvider = createOpenAICompatibleProvider({
    slug: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral and Magistral models via the Mistral API.',
    consoleUrl: 'https://console.mistral.ai/api-keys',
    keyHint: 'a 32-character key',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    preferredModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
});
export const groqProvider = createOpenAICompatibleProvider({
    slug: 'groq',
    name: 'Groq',
    description: 'Open models (Llama, Qwen, Kimi) served at very low latency.',
    consoleUrl: 'https://console.groq.com/keys',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyPrefix: 'gsk_',
    preferredModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
});
export const deepseekProvider = createOpenAICompatibleProvider({
    slug: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek chat and reasoning models.',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyPrefix: 'sk-',
    preferredModels: ['deepseek-chat', 'deepseek-reasoner'],
});
export const togetherProvider = createOpenAICompatibleProvider({
    slug: 'together',
    name: 'Together AI',
    description: 'Hundreds of open models on a single key.',
    consoleUrl: 'https://api.together.xyz/settings/api-keys',
    keyHint: 'a 64-character key',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    preferredModels: [
        'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    ],
});
export const openRouterProvider = createOpenAICompatibleProvider({
    slug: 'openrouter',
    name: 'OpenRouter',
    description: 'One key, hundreds of models from many vendors including Claude, GPT and Gemini.',
    consoleUrl: 'https://openrouter.ai/keys',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPrefix: 'sk-or-',
    preferredModels: ['anthropic/claude-sonnet-5', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash'],
    // OpenRouter asks integrators to identify themselves; it affects nothing but
    // their dashboard attribution.
    extraHeaders: {
        'HTTP-Referer': 'https://localmarketinggeeks.com/chat-pilot',
        'X-Title': 'Chat Pilot',
    },
});
/**
 * The escape hatch. Anything OpenAI-compatible that is not listed above —
 * Fireworks, Perplexity, Azure OpenAI through a gateway, a self-hosted vLLM,
 * Ollama or LM Studio on the customer's own network — works by entering the
 * base URL.
 */
export const customProvider = createOpenAICompatibleProvider({
    slug: 'custom',
    name: 'Custom (OpenAI-compatible)',
    description: 'Any provider exposing /models and /chat/completions in the OpenAI format. ' +
        'Enter its base URL and key.',
    consoleUrl: '',
    keyHint: 'whatever your gateway issues',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    preferredModels: [],
});
