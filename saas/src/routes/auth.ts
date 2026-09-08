/**
 * Authentication screens: sign up, sign in, sign out, password reset.
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { emailSchema, parseOrThrow, passwordSchema, text } from '../core/validate.ts';
import { AppError } from '../core/errors.ts';
import { asyncRoute } from '../middleware/errors.ts';
import { clientIp, rateLimit } from '../middleware/security.ts';
import {
  changePassword,
  consumePasswordReset,
  createPasswordReset,
  login,
  revokeSession,
  signup,
} from '../services/accounts.ts';
import { clearSessionCookie, requireAuth, requireCsrf, setSessionCookie } from '../middleware/session.ts';
import { enqueueNotification } from '../services/notifications.ts';
import { log } from '../core/logger.ts';

export const authRouter: Router = Router();

const authLimiter = rateLimit({
  limit: env.RATE_LIMIT_AUTH_PER_15MIN,
  windowMs: 15 * 60_000,
  scope: 'auth',
});

function redirectAfterLogin(role: string): string {
  return role === 'super_admin' ? '/admin' : '/app';
}

/* --------------------------------------------------------------- login -- */

authRouter.get('/login', (req, res) => {
  if (req.user) return res.redirect(redirectAfterLogin(req.user.platform_role));
  res.render('auth/login', {
    title: 'Sign in',
    error: typeof req.query.error === 'string' ? req.query.error : '',
    notice: typeof req.query.notice === 'string' ? req.query.notice : '',
    email: '',
  });
});

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
});

authRouter.post(
  '/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    let parsed: z.infer<typeof loginSchema>;
    try {
      parsed = parseOrThrow(loginSchema, req.body ?? {});
    } catch (err) {
      res.status(422).render('auth/login', {
        title: 'Sign in',
        error: err instanceof AppError ? err.publicMessage : 'Check your details and try again.',
        notice: '',
        email: String((req.body as Record<string, unknown>)?.email ?? ''),
      });
      return;
    }

    try {
      const result = await login(parsed.email, parsed.password, {
        ip: clientIp(req),
        userAgent: req.get('user-agent') ?? '',
      });
      setSessionCookie(res, result.session.id);
      res.redirect(redirectAfterLogin(result.user.platform_role));
    } catch (err) {
      // Preserve the error's own status: a suspended account is 403 and a
      // locked-out one is 429, neither of which is "bad credentials".
      const appError = err instanceof AppError ? err : null;
      res.status(appError?.status ?? 401).render('auth/login', {
        title: 'Sign in',
        error: appError?.publicMessage ?? 'Email or password is incorrect.',
        notice: '',
        email: parsed.email,
      });
    }
  }),
);

/* -------------------------------------------------------------- signup -- */

authRouter.get('/signup', (req, res) => {
  if (req.user) return res.redirect(redirectAfterLogin(req.user.platform_role));
  res.render('auth/signup', { title: 'Create your account', error: '', fields: {}, values: {} });
});

const signupSchema = z.object({
  full_name: text(120, 'Your name').refine((v) => v.length >= 2, 'Enter your name.'),
  company_name: text(160, 'Company name').refine((v) => v.length >= 2, 'Enter your company name.'),
  email: emailSchema,
  password: passwordSchema,
});

authRouter.post(
  '/signup',
  authLimiter,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseOrThrow(signupSchema, raw);
      const result = await signup({
        email: parsed.email,
        password: parsed.password,
        fullName: parsed.full_name,
        companyName: parsed.company_name,
        ip: clientIp(req),
      });
      const session = await login(parsed.email, parsed.password, {
        ip: clientIp(req),
        userAgent: req.get('user-agent') ?? '',
      });
      setSessionCookie(res, session.session.id);
      log.info('New account created.', { accountId: result.account.id });
      res.redirect('/app/websites/new?welcome=1');
    } catch (err) {
      const appError = err instanceof AppError ? err : null;
      res.status(appError?.status ?? 422).render('auth/signup', {
        title: 'Create your account',
        error: appError?.publicMessage ?? 'Please check the form and try again.',
        fields: appError?.fields ?? {},
        values: {
          full_name: String(raw.full_name ?? ''),
          company_name: String(raw.company_name ?? ''),
          email: String(raw.email ?? ''),
        },
      });
    }
  }),
);

/* -------------------------------------------------------------- logout -- */

authRouter.post('/logout', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  if (req.session) await revokeSession(req.session.id);
  clearSessionCookie(res);
  res.redirect('/login?notice=' + encodeURIComponent('You have been signed out.'));
}));

/* ------------------------------------------------------ password reset -- */

authRouter.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Reset your password',
    notice: typeof req.query.notice === 'string' ? req.query.notice : '',
    error: '',
  });
});

authRouter.post(
  '/forgot-password',
  authLimiter,
  asyncRoute(async (req, res) => {
    const email = String((req.body as Record<string, unknown>)?.email ?? '').trim();
    const result = email ? await createPasswordReset(email) : null;

    if (result) {
      await enqueueNotification({
        type: 'auth.password_reset',
        recipient: result.user.email,
        subject: 'Reset your Chat Pilot password',
        body:
          'Use this link within the next hour to choose a new password:\n' +
          env.APP_URL + '/reset-password?token=' + result.token,
        allowSecretsInBody: true,
      });
    }

    // Always the same response, so the form cannot enumerate accounts.
    res.render('auth/forgot-password', {
      title: 'Reset your password',
      notice: 'If that email address has a Chat Pilot account, a reset link is on its way.',
      error: '',
    });
  }),
);

authRouter.get('/reset-password', (req, res) => {
  res.render('auth/reset-password', {
    title: 'Choose a new password',
    token: typeof req.query.token === 'string' ? req.query.token : '',
    error: '',
  });
});

const resetSchema = z.object({
  token: z.string().trim().min(10).max(200),
  password: passwordSchema,
});

authRouter.post(
  '/reset-password',
  authLimiter,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseOrThrow(resetSchema, raw);
      const ok = await consumePasswordReset(parsed.token, parsed.password);
      if (!ok) {
        res.status(400).render('auth/reset-password', {
          title: 'Choose a new password',
          token: '',
          error: 'That reset link is invalid or has expired. Request a new one.',
        });
        return;
      }
      res.redirect('/login?notice=' + encodeURIComponent('Your password has been updated. Please sign in.'));
    } catch (err) {
      res.status(422).render('auth/reset-password', {
        title: 'Choose a new password',
        token: String(raw.token ?? ''),
        error: err instanceof AppError ? err.publicMessage : 'Please choose a stronger password.',
      });
    }
  }),
);

/* ------------------------------------------------------ change password -- */

authRouter.post(
  '/account/password',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseOrThrow(
        z.object({ current_password: z.string().min(1), new_password: passwordSchema }),
        raw,
      );
      await changePassword(req.user!.id, parsed.current_password, parsed.new_password);
      res.redirect('/app/account?notice=' + encodeURIComponent('Your password has been updated.'));
    } catch (err) {
      const message = err instanceof AppError ? err.publicMessage : 'Could not update your password.';
      res.redirect('/app/account?error=' + encodeURIComponent(message));
    }
  }),
);
