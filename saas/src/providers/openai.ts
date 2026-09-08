import { classifyProviderError, estimateTokens, extractErrorMessage, httpRequest } from './http.ts';
import type {
  DiscoveredModel,
  GenerateInput,
  GenerateResult,
  ProviderAdapter,
  ProviderCredentials,
  ProviderTestResult,
} from './types.ts';

const DEFAULT_BASE = 'https://api.openai.com/v1';

/** Model ids that are never usable for chat completions. */
const EXCLUDE = [
  'dall-e', 'tts-', 'whisper', 'moderation', 'embed', 'realtime', 'audio',
  'similarity', 'search', 'edit', 'insert', 'babbage', 'curie', 'ada', 'image',
  'transcribe', 'sora', 'codex-mini',
];

function base(creds: ProviderCredentials): string {
  const raw = (creds.baseUrl || '').trim();
  return (raw || DEFAULT_BASE).replace(/\/+$/, '');
}

function headers(creds: ProviderCredentials): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: 'Bearer ' + creds.apiKey,
    'Content-Type': 'application/json',
  };
  if (creds.orgId) h['OpenAI-Organization'] = creds.orgId;
  return h;
}

export const openAIProvider: ProviderAdapter = {
  slug: 'openai',
  name: 'OpenAI',
  description: 'GPT models via the OpenAI Chat Completions API.',
  consoleUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'sk-…',
  requiresBaseUrl: false,
  supportsOrgId: true,

  validate(creds) {
    if (!creds.apiKey || creds.apiKey.trim().length < 20) {
      return { ok: false, message: 'Enter your OpenAI API key (it starts with "sk-").' };
    }
    if (creds.baseUrl && !/^https:\/\//i.test(creds.baseUrl.trim())) {
      return { ok: false, message: 'The base URL must start with https://' };
    }
    return { ok: true };
  },

  async testConnection(creds, timeoutMs): Promise<ProviderTestResult> {
    const res = await httpRequest(base(creds) + '/models', { method: 'GET', headers: headers(creds) }, timeoutMs);
    if (res.ok) {
      return { ok: true, status: 'connected', message: 'Connected successfully.', latencyMs: res.latencyMs, httpStatus: res.status };
    }
    const message = res.networkError ?? extractErrorMessage(res.body, 'Connection failed.');
    const errorType = classifyProviderError(res.status, message);
    return {
      ok: false,
      status:
        errorType === 'authentication_error' ? 'invalid_credential'
        : errorType === 'quota_exceeded' ? 'quota_limited'
        : errorType === 'rate_limited' ? 'rate_limited'
        : errorType === 'provider_unavailable' || errorType === 'timeout_error' ? 'temporarily_unavailable'
        : 'connection_failed',
      message,
      latencyMs: res.latencyMs,
      httpStatus: res.status,
      errorType,
    };
  },

  async listModels(creds, timeoutMs): Promise<DiscoveredModel[]> {
    const res = await httpRequest(base(creds) + '/models', { method: 'GET', headers: headers(creds) }, timeoutMs);
    if (!res.ok) return [];
    let parsed: { data?: Array<{ id?: string }> };
    try {
      parsed = JSON.parse(res.body) as { data?: Array<{ id?: string }> };
    } catch {
      return [];
    }
    const out: DiscoveredModel[] = [];
    for (const item of parsed.data ?? []) {
      const id = String(item.id ?? '');
      if (!id) continue;
      const lower = id.toLowerCase();
      if (EXCLUDE.some((p) => lower.includes(p))) continue;
      // Positive heuristic: chat-capable families only.
      if (!/^(gpt-|o\d|chatgpt-)/.test(lower)) continue;
      out.push({ id, displayName: id });
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
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: input.temperature,
      max_completion_tokens: input.maxOutputTokens,
    };

    const res = await httpRequest(
      base(credentials) + '/chat/completions',
      { method: 'POST', headers: headers(credentials), body: JSON.stringify(payload) },
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
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
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
    return ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  },
};
