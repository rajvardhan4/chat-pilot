/**
 * Factory for providers that speak the OpenAI Chat Completions shape.
 *
 * A large part of the market — Mistral, Groq, DeepSeek, OpenRouter, Together,
 * Fireworks, Perplexity, local Ollama and LM Studio — exposes the same two
 * endpoints (`GET /models`, `POST /chat/completions`) with the same request and
 * response bodies. Writing eight near-identical adapters would mean eight
 * places to fix the next bug, so they are all configuration of one
 * implementation.
 *
 * Anything genuinely different — Anthropic, Gemini — gets its own adapter.
 */
import { classifyProviderError, estimateTokens, extractErrorMessage, httpRequest } from './http.ts';
import type {
  DiscoveredModel,
  GenerateInput,
  GenerateResult,
  ProviderAdapter,
  ProviderCredentials,
  ProviderStatus,
  ProviderTestResult,
} from './types.ts';

export interface OpenAICompatibleConfig {
  slug: string;
  name: string;
  description: string;
  consoleUrl: string;
  /** What the key looks like, shown beside the field. */
  keyHint?: string;
  /** Default API root, e.g. https://api.mistral.ai/v1 */
  defaultBaseUrl: string;
  /** True when the customer must supply the base URL themselves. */
  requiresBaseUrl?: boolean;
  supportsOrgId?: boolean;
  /** Expected key prefix, used for a friendly validation message. */
  keyPrefix?: string;
  /** Substrings that disqualify a model id from chat use. */
  excludePatterns?: string[];
  /** When set, a model id must match one of these to be offered. */
  includePatterns?: RegExp[];
  /** Suggested defaults, best first. */
  preferredModels: string[];
  /** Extra headers some providers require (OpenRouter attribution, etc). */
  extraHeaders?: Record<string, string>;
}

const DEFAULT_EXCLUDES = [
  'embed', 'embedding', 'moderation', 'whisper', 'tts', 'dall-e', 'stable-diffusion',
  'rerank', 'ocr', 'transcribe', 'audio', 'realtime', 'image', 'vision-encoder',
  'guard', 'codestral-embed',
];

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): ProviderAdapter {
  const excludes = [...DEFAULT_EXCLUDES, ...(config.excludePatterns ?? [])];

  function base(creds: ProviderCredentials): string {
    const raw = (creds.baseUrl || '').trim();
    return (raw || config.defaultBaseUrl).replace(/\/+$/, '');
  }

  function headers(creds: ProviderCredentials): Record<string, string> {
    const out: Record<string, string> = {
      Authorization: 'Bearer ' + creds.apiKey,
      'Content-Type': 'application/json',
      ...(config.extraHeaders ?? {}),
    };
    if (config.supportsOrgId && creds.orgId) out['OpenAI-Organization'] = creds.orgId;
    return out;
  }

  function statusFor(errorType: string): ProviderStatus {
    if (errorType === 'authentication_error') return 'invalid_credential';
    if (errorType === 'quota_exceeded') return 'quota_limited';
    if (errorType === 'rate_limited') return 'rate_limited';
    if (errorType === 'model_unavailable') return 'model_unavailable';
    if (errorType === 'timeout_error' || errorType === 'provider_unavailable') {
      return 'temporarily_unavailable';
    }
    return 'connection_failed';
  }

  return {
    slug: config.slug,
    name: config.name,
    description: config.description,
    consoleUrl: config.consoleUrl,
    keyHint: config.keyHint ?? (config.keyPrefix ? config.keyPrefix + '…' : ''),
    requiresBaseUrl: Boolean(config.requiresBaseUrl),
    supportsOrgId: Boolean(config.supportsOrgId),

    validate(creds) {
      const key = (creds.apiKey ?? '').trim();
      if (!key || key.length < 8) {
        return { ok: false, message: 'Enter your ' + config.name + ' API key.' };
      }
      if (config.keyPrefix && !key.startsWith(config.keyPrefix)) {
        return {
          ok: false,
          message: 'A ' + config.name + ' API key starts with "' + config.keyPrefix + '".',
        };
      }
      const url = (creds.baseUrl ?? '').trim();
      if (config.requiresBaseUrl && !url) {
        return { ok: false, message: 'Enter the API base URL for this provider.' };
      }
      if (url && !/^https?:\/\//i.test(url)) {
        return { ok: false, message: 'The base URL must start with http:// or https://' };
      }
      return { ok: true };
    },

    async testConnection(creds, timeoutMs): Promise<ProviderTestResult> {
      const res = await httpRequest(
        base(creds) + '/models',
        { method: 'GET', headers: headers(creds) },
        timeoutMs,
      );

      if (res.ok) {
        return {
          ok: true,
          status: 'connected',
          message: 'Connected successfully.',
          latencyMs: res.latencyMs,
          httpStatus: res.status,
        };
      }

      const message = res.networkError ?? extractErrorMessage(res.body, 'Connection failed.');
      const errorType = classifyProviderError(res.status, message);
      return {
        ok: false,
        status: statusFor(errorType),
        message,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        errorType,
      };
    },

    async listModels(creds, timeoutMs): Promise<DiscoveredModel[]> {
      const res = await httpRequest(
        base(creds) + '/models',
        { method: 'GET', headers: headers(creds) },
        timeoutMs,
      );
      if (!res.ok) return [];

      let parsed: { data?: Array<{ id?: string; name?: string }> };
      try {
        parsed = JSON.parse(res.body) as { data?: Array<{ id?: string; name?: string }> };
      } catch {
        return [];
      }

      const out: DiscoveredModel[] = [];
      for (const item of parsed.data ?? []) {
        const id = String(item.id ?? '');
        if (!id) continue;
        const lower = id.toLowerCase();
        if (excludes.some((pattern) => lower.includes(pattern))) continue;
        if (config.includePatterns && !config.includePatterns.some((re) => re.test(lower))) continue;
        out.push({ id, displayName: item.name || id });
      }
      out.sort((a, b) => a.id.localeCompare(b.id));
      return out;
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const { credentials, model } = input;
      const messages = [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await httpRequest(
        base(credentials) + '/chat/completions',
        {
          method: 'POST',
          headers: headers(credentials),
          body: JSON.stringify({
            model,
            messages,
            temperature: input.temperature,
            max_tokens: input.maxOutputTokens,
          }),
        },
        input.timeoutMs,
      );

      if (!res.ok) {
        const message = res.networkError ?? extractErrorMessage(res.body, 'The AI provider request failed.');
        return {
          ok: false,
          errorType: classifyProviderError(res.status, message),
          message,
          httpStatus: res.status,
          retryAfter: res.headers?.get('retry-after') ?? undefined,
          latencyMs: res.latencyMs,
          model,
        };
      }

      let parsed: {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        model?: string;
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(res.body);
      } catch {
        return {
          ok: false,
          errorType: 'provider_error',
          message: 'The AI provider returned a malformed response.',
          httpStatus: res.status,
          latencyMs: res.latencyMs,
          model,
        };
      }

      // Some gateways answer 200 with an error object in the body.
      if (parsed.error?.message) {
        return {
          ok: false,
          errorType: classifyProviderError(res.status, parsed.error.message),
          message: parsed.error.message,
          httpStatus: res.status,
          latencyMs: res.latencyMs,
          model,
        };
      }

      const text = (parsed.choices?.[0]?.message?.content ?? '').trim();
      if (!text) {
        return {
          ok: false,
          errorType: 'provider_error',
          message: 'The AI provider returned an empty completion.',
          httpStatus: res.status,
          latencyMs: res.latencyMs,
          model,
        };
      }

      const inputTokens = parsed.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
      const outputTokens = parsed.usage?.completion_tokens ?? estimateTokens(text);
      return {
        ok: true,
        text,
        model: parsed.model ?? model,
        inputTokens,
        outputTokens,
        totalTokens: parsed.usage?.total_tokens ?? inputTokens + outputTokens,
        latencyMs: res.latencyMs,
      };
    },

    preferredModelOrder() {
      return config.preferredModels;
    },
  };
}
