import { AppError } from "../core/errors.js";
import { log } from "../core/logger.js";
import { newId } from "../core/crypto.js";
/**
 * Framework-level failures that have a meaningful public equivalent. Anything
 * not listed here stays a generic 500 so internals cannot leak.
 */
function translateKnownError(err) {
    const candidate = err;
    if (!candidate || typeof candidate !== 'object')
        return null;
    if (candidate.type === 'entity.too.large') {
        return new AppError('payload_too_large', 'That request was too large.');
    }
    if (candidate.type === 'entity.parse.failed') {
        return new AppError('bad_request', 'The request body was not valid JSON.');
    }
    if (candidate.type === 'encoding.unsupported' || candidate.type === 'charset.unsupported') {
        return new AppError('bad_request', 'That request encoding is not supported.');
    }
    return null;
}
export function notFoundHandler(req, _res, next) {
    next(new AppError('not_found', 'That page could not be found.', { detail: { path: req.path } }));
}
function wantsJson(req) {
    if (req.path.startsWith('/api/'))
        return true;
    const accept = req.get('accept') ?? '';
    if (req.get('x-requested-with') === 'XMLHttpRequest')
        return true;
    return accept.includes('application/json') && !accept.includes('text/html');
}
export function errorHandler(err, req, res, next) {
    if (res.headersSent)
        return next(err);
    const appError = err instanceof AppError
        ? err
        : translateKnownError(err) ??
            new AppError('internal_error', 'An unexpected error occurred. Please try again.', {
                detail: err instanceof Error ? { message: err.message, stack: err.stack } : { value: String(err) },
            });
    const reference = newId().slice(0, 8);
    if (appError.status >= 500) {
        log.error('Unhandled request failure [' + reference + ']', {
            path: req.path,
            method: req.method,
            code: appError.code,
            detail: appError.detail,
        });
    }
    else {
        log.debug('Request rejected [' + appError.code + ']', { path: req.path, method: req.method });
    }
    if (wantsJson(req)) {
        res.status(appError.status).json({
            ok: false,
            error: {
                code: appError.code,
                message: appError.publicMessage,
                ...(appError.fields ? { fields: appError.fields } : {}),
                ...(appError.status >= 500 ? { reference } : {}),
            },
        });
        return;
    }
    res.status(appError.status).render('error', {
        title: appError.status === 404 ? 'Page not found' : 'Something went wrong',
        status: appError.status,
        message: appError.publicMessage,
        reference: appError.status >= 500 ? reference : '',
        user: req.user ?? null,
    });
}
/** Wraps an async route handler so rejections reach the error handler. */
export function asyncRoute(handler) {
    return (req, res, next) => {
        handler(req, res, next).catch(next);
    };
}
