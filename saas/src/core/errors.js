const STATUS = {
    bad_request: 400,
    validation_failed: 422,
    unauthenticated: 401,
    invalid_credentials: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    rate_limited: 429,
    payload_too_large: 413,
    unsupported_media_type: 415,
    provider_error: 502,
    site_key_invalid: 401,
    site_key_revoked: 401,
    domain_mismatch: 403,
    website_disabled: 403,
    account_suspended: 403,
    subscription_inactive: 402,
    usage_limit_reached: 429,
    internal_error: 500,
};
export class AppError extends Error {
    code;
    status;
    publicMessage;
    detail;
    fields;
    constructor(code, publicMessage, options = {}) {
        super(publicMessage);
        this.name = 'AppError';
        this.code = code;
        this.status = STATUS[code] ?? 500;
        this.publicMessage = publicMessage;
        this.detail = options.detail;
        this.fields = options.fields;
    }
}
export const badRequest = (m, d) => new AppError('bad_request', m, { detail: d });
export const validationFailed = (m, fields) => new AppError('validation_failed', m, { fields });
export const unauthenticated = (m = 'Authentication is required.') => new AppError('unauthenticated', m);
export const forbidden = (m = 'You do not have access to this resource.') => new AppError('forbidden', m);
export const notFound = (m = 'The requested resource was not found.') => new AppError('not_found', m);
export const conflict = (m) => new AppError('conflict', m);
export const rateLimited = (m = 'Too many requests. Please slow down.') => new AppError('rate_limited', m);
export const internalError = (d) => new AppError('internal_error', 'An unexpected error occurred. Please try again.', { detail: d });
