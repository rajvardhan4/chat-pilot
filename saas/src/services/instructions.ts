import { db, nowIso, toBool } from '../db/index.ts';
import { newId } from '../core/crypto.ts';
import { audit } from './audit.ts';
import { getWebsiteForAccount } from './websites.ts';
import {
  DEFAULT_FALLBACK,
  DEFAULT_GENERATION_ERROR,
  DEFAULT_GREETING,
  DEFAULT_SYSTEM_PROMPT,
} from './instructionDefaults.ts';

export interface InstructionsRow {
  id: string;
  account_id: string;
  website_id: string;
  business_name: string;
  system_prompt: string;
  tone: string;
  answer_length: string;
  fallback_response: string;
  greeting_response: string;
  generation_error_response: string;
  allow_small_talk: boolean;
  strict_grounding: boolean;
  created_at: string;
  updated_at: string;
}

function hydrate(row: Record<string, unknown>): InstructionsRow {
  return {
    ...(row as unknown as InstructionsRow),
    system_prompt: String(row.system_prompt || DEFAULT_SYSTEM_PROMPT),
    fallback_response: String(row.fallback_response || DEFAULT_FALLBACK),
    greeting_response: String(row.greeting_response || DEFAULT_GREETING),
    generation_error_response: String(row.generation_error_response || DEFAULT_GENERATION_ERROR),
    allow_small_talk: toBool(row.allow_small_talk),
    strict_grounding: toBool(row.strict_grounding),
  };
}

export function getInstructions(accountId: string, websiteId: string): InstructionsRow {
  const row = db.get<Record<string, unknown>>(
    'SELECT * FROM ai_instructions WHERE website_id = ? AND account_id = ?',
    websiteId, accountId,
  );
  if (row) return hydrate(row);

  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO ai_instructions (id, account_id, website_id, system_prompt, fallback_response,
                                  greeting_response, generation_error_response, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, accountId, websiteId, DEFAULT_SYSTEM_PROMPT, DEFAULT_FALLBACK,
    DEFAULT_GREETING, DEFAULT_GENERATION_ERROR, now, now,
  );
  return hydrate(db.get<Record<string, unknown>>('SELECT * FROM ai_instructions WHERE id = ?', id)!);
}

export interface InstructionsPatch {
  business_name?: string;
  system_prompt?: string;
  tone?: string;
  answer_length?: string;
  fallback_response?: string;
  greeting_response?: string;
  generation_error_response?: string;
  allow_small_talk?: boolean;
  strict_grounding?: boolean;
}

export function updateInstructions(
  accountId: string,
  websiteId: string,
  patch: InstructionsPatch,
  actorId: string,
): InstructionsRow {
  getWebsiteForAccount(accountId, websiteId);
  getInstructions(accountId, websiteId);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(key + ' = ?');
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(nowIso(), websiteId, accountId);
    db.run(
      `UPDATE ai_instructions SET ${sets.join(', ')} WHERE website_id = ? AND account_id = ?`,
      ...params,
    );
    audit({
      accountId, websiteId, actorType: 'user', actorId,
      action: 'instructions.updated', targetType: 'website', targetId: websiteId,
      metadata: { fields: Object.keys(patch) },
    });
  }
  return getInstructions(accountId, websiteId);
}

export function resetInstructions(accountId: string, websiteId: string, actorId: string): InstructionsRow {
  return updateInstructions(
    accountId, websiteId,
    {
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      fallback_response: DEFAULT_FALLBACK,
      greeting_response: DEFAULT_GREETING,
      generation_error_response: DEFAULT_GENERATION_ERROR,
      tone: 'professional',
      answer_length: 'concise',
      strict_grounding: true,
    },
    actorId,
  );
}
