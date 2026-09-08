/**
 * Shared outbound HTTP helper for provider adapters: timeouts, latency
 * measurement and uniform error classification.
 */
import type { ProviderErrorType } from './types.ts';

export interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
  headers: Headers | null;
  latencyMs: number;
  networkError?: string;
}

export async function httpRequest(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      headers: res.headers,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      body: '',
      headers: null,
      latencyMs: Math.round(performance.now() - started),
      networkError: (err as Error)?.name === 'AbortError' ? 'Request timed out.' : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maps an HTTP status plus provider error text onto the engine's error
 * taxonomy. Keeping this in one place is what stops "quota exceeded" from
 * being reported as a generic failure.
 */
export function classifyProviderError(status: number, rawMessage: string): ProviderErrorType {
  const text = (rawMessage || '').toLowerCase();
  if (status === 429 || /quota|resource_exhausted|rate.?limit|insufficient_quota|too many requests/.test(text)) {
    return /rate.?limit|too many requests/.test(text) && !/quota|insufficient_quota/.test(text)
      ? 'rate_limited'
      : 'quota_exceeded';
  }
  if (status === 401 || status === 403 || /api.?key|unauthor|permission.?denied|invalid_api_key|forbidden/.test(text)) {
    return 'authentication_error';
  }
  if (status === 404 || /model.*(not found|not exist|unsupported|unavailable)|no such model/.test(text)) {
    return 'model_unavailable';
  }
  if (status === 0 || /timed out|timeout|econnreset|enotfound|network|fetch failed|socket/.test(text)) {
    return 'timeout_error';
  }
  if (status >= 500) return 'provider_unavailable';
  return 'provider_error';
}

/** Extracts a provider error message from a JSON body, falling back safely. */
export function extractErrorMessage(body: string, fallback: string): string {
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error as Record<string, unknown> | string | undefined;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const msg = error.message;
      if (typeof msg === 'string' && msg) return msg;
    }
    const message = parsed.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300) || fallback;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}
