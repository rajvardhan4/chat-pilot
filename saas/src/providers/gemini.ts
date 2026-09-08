import { classifyProviderError, estimateTokens, extractErrorMessage, httpRequest } from './http.ts';
import type {
  DiscoveredModel,
  GenerateInput,
  GenerateResult,
  ProviderAdapter,
  ProviderCredentials,
  ProviderTestResult,
} from './types.ts';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const EXCLUDE = [
  'embedding', 'aqa', 'imagen', 'classifier', 'realtime', 'audio', 'tts',
  'speech', 'veo', 'image', 'deep-research', 'nano-banana', 'antigravity',
];

function base(creds: ProviderCredentials): string {
  const raw = (creds.baseUrl || '').trim();
  return (raw || DEFAULT_BASE).replace(/\/+$/, '');
}

/**
 * The API key goes in a header, never in the URL, so it cannot leak through
 * request logs, proxies or error messages that echo the URL.
 */
function headers(creds: ProviderCredentials): Record<string, string> {
  return { 'x-goog-api-key': creds.apiKey, 'Content-Type': 'application/json' };
}

export const geminiProvider: ProviderAdapter = {
  slug: 'gemini',
  name: 'Google Gemini',
  description: 'Gemini models via the Google Generative Language API.',
  consoleUrl: 'https://aistudio.google.com/apikey',
  keyHint: 'AIza…',
  requiresBaseUrl: false,
  supportsOrgId: false,

  validate(creds) {
    if (!creds.apiKey || creds.apiKey.trim().length < 20) {
      return { ok: false, message: 'Enter your Google AI Studio API key.' };
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
    const res = await httpRequest(
      base(creds) + '/models?pageSize=200',
      { method: 'GET', headers: headers(creds) },
      timeoutMs,
    );
    if (!res.ok) return [];
    let parsed: {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    };
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return [];
    }
    const out: DiscoveredModel[] = [];
    for (const m of parsed.models ?? []) {
      const id = String(m.name ?? '').replace(/^models\//, '');
      if (!id) continue;
      const methods = m.supportedGenerationMethods ?? [];
      if (!methods.includes('generateContent')) continue;
      const lower = id.toLowerCase();
      if (EXCLUDE.some((p) => lower.includes(p))) continue;
      out.push({ id, displayName: m.displayName || id });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  },

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const { credentials, model } = input;

    const contents = input.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents,
      generationConfig: {
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
      },
    };

    const url = base(credentials) + '/models/' + encodeURIComponent(model) + ':generateContent';
    const res = await httpRequest(
      url,
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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return {
        ok: false, errorType: 'provider_error',
        message: 'The AI provider returned a malformed response.',
        httpStatus: res.status, latencyMs: res.latencyMs, model,
      };
    }

    const text = (parsed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      const finish = parsed.candidates?.[0]?.finishReason ?? 'unknown';
      return {
        ok: false, errorType: 'provider_error',
        message: 'The AI provider returned an empty completion (finishReason: ' + finish + ').',
        httpStatus: res.status, latencyMs: res.latencyMs, model,
      };
    }

    const inputTokens = parsed.usageMetadata?.promptTokenCount ?? estimateTokens(JSON.stringify(contents));
    const outputTokens = parsed.usageMetadata?.candidatesTokenCount ?? estimateTokens(text);
    return {
      ok: true,
      text,
      model,
      inputTokens,
      outputTokens,
      totalTokens: parsed.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
      latencyMs: res.latencyMs,
    };
  },

  preferredModelOrder() {
    return [
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-pro-latest',
    ];
  },
};
