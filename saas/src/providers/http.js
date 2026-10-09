export async function httpRequest(url, init, timeoutMs) {
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            status: 0,
            body: '',
            headers: null,
            latencyMs: Math.round(performance.now() - started),
            networkError: err?.name === 'AbortError' ? 'Request timed out.' : message,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Maps an HTTP status plus provider error text onto the engine's error
 * taxonomy. Keeping this in one place is what stops "quota exceeded" from
 * being reported as a generic failure.
 */
export function classifyProviderError(status, rawMessage) {
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
    if (status >= 500)
        return 'provider_unavailable';
    return 'provider_error';
}
/** Extracts a provider error message from a JSON body, falling back safely. */
export function extractErrorMessage(body, fallback) {
    if (!body)
        return fallback;
    try {
        const parsed = JSON.parse(body);
        const error = parsed.error;
        if (typeof error === 'string')
            return error;
        if (error && typeof error === 'object') {
            const msg = error.message;
            if (typeof msg === 'string' && msg)
                return msg;
        }
        const message = parsed.message;
        if (typeof message === 'string' && message)
            return message;
    }
    catch {
        /* not JSON */
    }
    return body.slice(0, 300) || fallback;
}
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}
