/**
 * Anthropic (Claude) adapter.
 *
 * The only adapter that uses a vendor SDK rather than raw HTTP. That is
 * deliberate: the SDK exposes typed error classes, which map onto Chat Pilot's
 * provider-error taxonomy exactly, instead of the string matching every
 * raw-HTTP adapter has to fall back on. Getting that taxonomy right is what
 * keeps "the provider failed" distinct from "we have no knowledge about this",
 * which the product treats as two different states.
 *
 * Retries are disabled (`maxRetries: 0`) because retry policy belongs to the
 * chat engine, not to one provider — a silent SDK retry would blow through the
 * request timeout the engine is counting on.
 */
import Anthropic from '@anthropic-ai/sdk';
import { estimateTokens } from './http.ts';
import type {
  DiscoveredModel,
  GenerateInput,
  GenerateResult,
  ProviderAdapter,
  ProviderCredentials,
  ProviderErrorType,
  ProviderStatus,
  ProviderTestResult,
} from './types.ts';

function client(creds: ProviderCredentials, timeoutMs: number): Anthropic {
  return new Anthropic({
    apiKey: creds.apiKey,
    ...(creds.baseUrl ? { baseURL: creds.baseUrl.replace(/\/+$/, '') } : {}),
    maxRetries: 0,
    timeout: timeoutMs,
  });
}

/**
 * Pulls the human sentence out of an SDK error.
 *
 * `err.message` is prefixed with the status and carries the raw JSON body
 * ('401 {"type":"error",...}'), which is not something to show a customer. The
 * parsed body hangs off `.error` and holds the readable message.
 */
function readableMessage(err: unknown, fallback: string): string {
  const body = (err as { error?: { error?: { message?: string }; message?: string } })?.error;
  const nested = body?.error?.message ?? body?.message;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  if (err instanceof Error && err.message) {
    // Strip a leading status code if that is all we have.
    return err.message.replace(/^\d{3}\s+/, '').slice(0, 300);
  }
  return fallback;
}

/** Maps the SDK's typed errors onto the engine's error taxonomy. */
function classify(err: unknown): { errorType: ProviderErrorType; message: string; httpStatus: number } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return {
      errorType: 'authentication_error',
      message: readableMessage(err, 'That Anthropic API key was rejected.'),
      httpStatus: err.status ?? 401,
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    // Anthropic returns 429 for both a rate limit and a spent credit balance.
    // The message is the only thing that separates them, and the customer needs
    // to know which one they are looking at.
    const message = readableMessage(err, 'Anthropic rate limit reached.');
    const quota = /credit|balance|quota|billing/i.test(message);
    return {
      errorType: quota ? 'quota_exceeded' : 'rate_limited',
      message,
      httpStatus: 429,
    };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return {
      errorType: 'model_unavailable',
      message: readableMessage(err, 'That Anthropic model is not available to this key.'),
      httpStatus: 404,
    };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { errorType: 'timeout_error', message: 'The request to Anthropic timed out.', httpStatus: 0 };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      errorType: 'timeout_error',
      message: readableMessage(err, 'Could not reach Anthropic.'),
      httpStatus: 0,
    };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return {
      errorType: 'provider_unavailable',
      message: readableMessage(err, 'Anthropic is temporarily unavailable.'),
      httpStatus: err.status ?? 500,
    };
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A bad model id also arrives as a 400 rather than a 404.
    const message = readableMessage(err, 'Anthropic rejected the request.');
    const badModel = /model/i.test(message);
    return {
      errorType: badModel ? 'model_unavailable' : 'provider_error',
      message,
      httpStatus: 400,
    };
  }
  if (err instanceof Anthropic.APIError) {
    return {
      errorType: 'provider_error',
      message: readableMessage(err, 'The Anthropic request failed.'),
      httpStatus: err.status ?? 0,
    };
  }
  return {
    errorType: 'provider_error',
    message: err instanceof Error ? err.message : String(err),
    httpStatus: 0,
  };
}

function statusFor(errorType: ProviderErrorType): ProviderStatus {
  switch (errorType) {
    case 'authentication_error':
      return 'invalid_credential';
    case 'quota_exceeded':
      return 'quota_limited';
    case 'rate_limited':
      return 'rate_limited';
    case 'model_unavailable':
      return 'model_unavailable';
    case 'timeout_error':
    case 'provider_unavailable':
      return 'temporarily_unavailable';
    default:
      return 'connection_failed';
  }
}

export const anthropicProvider: ProviderAdapter = {
  slug: 'anthropic',
  name: 'Anthropic (Claude)',
  description: 'Claude models via the Anthropic Messages API.',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  keyHint: 'sk-ant-…',
  requiresBaseUrl: false,
  supportsOrgId: false,

  validate(creds) {
    const key = (creds.apiKey ?? '').trim();
    if (!key) {
      return { ok: false, message: 'Enter your Anthropic API key.' };
    }
    if (!key.startsWith('sk-ant-')) {
      return { ok: false, message: 'An Anthropic API key starts with "sk-ant-".' };
    }
    return { ok: true };
  },

  async testConnection(creds, timeoutMs): Promise<ProviderTestResult> {
    const started = performance.now();
    try {
      // Listing models is the cheapest authenticated call: it proves the key
      // works without spending a single token.
      await client(creds, timeoutMs).models.list({ limit: 1 });
      return {
        ok: true,
        status: 'connected',
        message: 'Connected successfully.',
        latencyMs: Math.round(performance.now() - started),
        httpStatus: 200,
      };
    } catch (err) {
      const detail = classify(err);
      return {
        ok: false,
        status: statusFor(detail.errorType),
        message: detail.message,
        latencyMs: Math.round(performance.now() - started),
        httpStatus: detail.httpStatus,
        errorType: detail.errorType,
      };
    }
  },

  async listModels(creds, timeoutMs): Promise<DiscoveredModel[]> {
    try {
      const out: DiscoveredModel[] = [];
      // The SDK auto-paginates, so every model the key can reach is returned.
      for await (const model of client(creds, timeoutMs).models.list({ limit: 100 })) {
        if (!model.id) continue;
        out.push({ id: model.id, displayName: model.display_name || model.id });
      }
      out.sort((a, b) => a.displayName.localeCompare(b.displayName));
      return out;
    } catch {
      return [];
    }
  },

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const started = performance.now();
    try {
      const response = await client(input.credentials, input.timeoutMs).messages.create({
        model: input.model,
        max_tokens: input.maxOutputTokens,
        temperature: input.temperature,
        // Anthropic takes the system prompt as a top-level field rather than a
        // message, which suits us: the retrieved context can never be mistaken
        // for something the visitor said.
        system: input.system,
        messages: input.messages.map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        })),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      if (!text) {
        // A safety refusal is a legitimate empty answer, and the customer
        // should see why rather than a blank bubble.
        const reason = response.stop_reason === 'refusal'
          ? 'Claude declined to answer this request.'
          : 'The AI provider returned an empty completion (stop reason: ' + response.stop_reason + ').';
        return {
          ok: false,
          errorType: 'provider_error',
          message: reason,
          httpStatus: 200,
          latencyMs: Math.round(performance.now() - started),
          model: input.model,
        };
      }

      const inputTokens = response.usage?.input_tokens ?? estimateTokens(input.system);
      const outputTokens = response.usage?.output_tokens ?? estimateTokens(text);

      return {
        ok: true,
        text,
        model: response.model ?? input.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      const detail = classify(err);
      return {
        ok: false,
        errorType: detail.errorType,
        message: detail.message,
        httpStatus: detail.httpStatus,
        retryAfter:
          err instanceof Anthropic.APIError
            ? (err.headers?.get?.('retry-after') ?? undefined)
            : undefined,
        latencyMs: Math.round(performance.now() - started),
        model: input.model,
      };
    }
  },

  preferredModelOrder() {
    return ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'];
  },
};
