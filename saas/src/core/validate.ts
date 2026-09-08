/**
 * Request validation helpers built on zod, returning AppError('validation_failed')
 * with per-field messages so both the JSON API and the server-rendered portal
 * can present the same result.
 */
import { z } from 'zod';
import { AppError } from './errors.ts';

export { z };

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0] ?? 'The submitted data is invalid.';
  throw new AppError('validation_failed', first, { fields });
}

/* ------------------------------------------------------- shared schemas -- */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address.')
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((v) => /[a-z]/i.test(v), 'Include at least one letter.')
  .refine((v) => /[0-9]/.test(v) || /[^A-Za-z0-9]/.test(v), 'Include a number or symbol.');

export const idSchema = z.string().trim().min(1).max(64);

/** ASCII control characters, excluding tab, newline and carriage return. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripControlChars(input: string): string {
  return String(input ?? '').replace(CONTROL_CHARS, '');
}

/** Trimmed plain text with a hard cap. Strips control characters. */
export function text(max: number, label = 'This field') {
  return z
    .string()
    .transform((v) => stripControlChars(v).trim())
    .refine((v) => v.length <= max, label + ' must be ' + max + ' characters or fewer.');
}

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #0678f9');

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitises assistant output before it is returned to a website visitor:
 * strips HTML tags and any embedded script/style so the widget can render
 * plain text plus its own light markdown-ish formatting safely.
 */
export function sanitiseAssistantText(input: string): string {
  return stripControlChars(String(input ?? ''))
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}
