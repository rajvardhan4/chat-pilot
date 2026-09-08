/**
 * Deterministic in-process provider used by the automated test suite and by
 * local development when no real provider key is available.
 *
 * It is registered ONLY when NODE_ENV !== 'production' AND
 * CHAT_PILOT_ENABLE_MOCK_PROVIDER=true (the test runner sets both). It can
 * never appear in a production install - see registry.ts.
 *
 * Behaviour is driven by the API key so tests can exercise every branch:
 *   mock-ok-*            -> succeeds, answers from the supplied context
 *   mock-quota-*         -> HTTP 429 quota_exceeded
 *   mock-auth-*          -> HTTP 401 authentication_error
 *   mock-timeout-*       -> network timeout
 *   mock-badmodel-*      -> HTTP 404 model_unavailable
 *   mock-empty-*         -> succeeds with an empty completion
 */
import type {
  DiscoveredModel,
  GenerateInput,
  GenerateResult,
  ProviderAdapter,
  ProviderCredentials,
  ProviderTestResult,
} from './types.ts';
import { estimateTokens } from './http.ts';

const MODELS: DiscoveredModel[] = [
  { id: 'mock-small', displayName: 'Mock Small' },
  { id: 'mock-large', displayName: 'Mock Large' },
  { id: 'mock-legacy', displayName: 'Mock Legacy' },
];

function mode(creds: ProviderCredentials): string {
  const m = /^mock-([a-z]+)-/.exec(creds.apiKey.trim());
  return m ? (m[1] as string) : 'unknown';
}

/**
 * Composes a grounded-looking answer from the prompt so tests can assert that
 * retrieval context actually reached the model.
 */
function synthesise(input: GenerateInput): string {
  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
  const question = lastUser?.content ?? '';
  const contextMatch = /Retrieved Knowledge Context:\n([\s\S]*?)(?:\n\nConversation|$)/.exec(input.system);
  const context = contextMatch ? (contextMatch[1] as string) : '';

  if (!context.trim()) {
    // No context: echo the configured fallback the way a grounded model would.
    const fb = /Missing Knowledge Fallback:\s*"([^"]+)"/.exec(input.system);
    return fb ? (fb[1] as string) : 'I could not find that information.';
  }

  const facts = context
    .split('\n')
    .filter((line) => line.trim() && !/^(Source|Title|Content|---)/.test(line.trim()))
    .slice(0, 4)
    .join(' ');

  return ('Based on our information: ' + facts).slice(0, 900) + ' [q:' + question.slice(0, 60) + ']';
}

export const mockProvider: ProviderAdapter = {
  slug: 'mock',
  name: 'Mock Provider (testing)',
  description: 'Deterministic provider for automated tests and local development.',
  consoleUrl: '',
  keyHint: 'any value',
  requiresBaseUrl: false,
  supportsOrgId: false,

  validate(creds) {
    if (!/^mock-[a-z]+-/.test(creds.apiKey.trim())) {
      return { ok: false, message: 'Mock keys look like "mock-ok-anything".' };
    }
    return { ok: true };
  },

  async testConnection(creds): Promise<ProviderTestResult> {
    switch (mode(creds)) {
      case 'auth':
        return { ok: false, status: 'invalid_credential', message: 'Invalid API key.', latencyMs: 5, httpStatus: 401, errorType: 'authentication_error' };
      case 'quota':
        return { ok: false, status: 'quota_limited', message: 'Quota exceeded.', latencyMs: 5, httpStatus: 429, errorType: 'quota_exceeded' };
      case 'timeout':
        return { ok: false, status: 'temporarily_unavailable', message: 'Request timed out.', latencyMs: 5, httpStatus: 0, errorType: 'timeout_error' };
      default:
        return { ok: true, status: 'connected', message: 'Connected successfully.', latencyMs: 5, httpStatus: 200 };
    }
  },

  async listModels(creds): Promise<DiscoveredModel[]> {
    if (['auth', 'quota', 'timeout'].includes(mode(creds))) return [];
    return MODELS;
  },

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const m = mode(input.credentials);
    if (m === 'auth') {
      return { ok: false, errorType: 'authentication_error', message: 'API key invalid or revoked.', httpStatus: 401, latencyMs: 4, model: input.model };
    }
    if (m === 'quota') {
      return { ok: false, errorType: 'quota_exceeded', message: 'Resource has been exhausted (check quota).', httpStatus: 429, retryAfter: '60', latencyMs: 4, model: input.model };
    }
    if (m === 'timeout') {
      return { ok: false, errorType: 'timeout_error', message: 'Request timed out.', httpStatus: 0, latencyMs: 4, model: input.model };
    }
    if (m === 'badmodel') {
      return { ok: false, errorType: 'model_unavailable', message: 'Model not found: ' + input.model, httpStatus: 404, latencyMs: 4, model: input.model };
    }
    if (m === 'empty') {
      return { ok: false, errorType: 'provider_error', message: 'The AI provider returned an empty completion.', httpStatus: 200, latencyMs: 4, model: input.model };
    }

    const text = synthesise(input);
    const inputTokens = estimateTokens(input.system + JSON.stringify(input.messages));
    const outputTokens = estimateTokens(text);
    return {
      ok: true,
      text,
      model: input.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: 4,
    };
  },

  preferredModelOrder() {
    return ['mock-small', 'mock-large'];
  },
};
