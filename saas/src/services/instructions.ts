import { col, nowIso, toBool } from '../db/mongo.ts';
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

type InstructionsDoc = Omit<InstructionsRow, 'id' | 'allow_small_talk' | 'strict_grounding'> & {
  _id: string;
  allow_small_talk: unknown;
  strict_grounding: unknown;
};

function hydrate(doc: InstructionsDoc): InstructionsRow {
  const { _id, ...rest } = doc;
  return {
    id: _id,
    ...rest,
    system_prompt: String(rest.system_prompt || DEFAULT_SYSTEM_PROMPT),
    fallback_response: String(rest.fallback_response || DEFAULT_FALLBACK),
    greeting_response: String(rest.greeting_response || DEFAULT_GREETING),
    generation_error_response: String(rest.generation_error_response || DEFAULT_GENERATION_ERROR),
    allow_small_talk: toBool(doc.allow_small_talk),
    strict_grounding: toBool(doc.strict_grounding),
  };
}

export async function getInstructions(accountId: string, websiteId: string): Promise<InstructionsRow> {
  const row = await col<InstructionsDoc>('ai_instructions').findOne({ website_id: websiteId, account_id: accountId });
  if (row) return hydrate(row);

  const id = newId();
  const now = nowIso();
  const doc = {
    _id: id, account_id: accountId, website_id: websiteId,
    business_name: '', system_prompt: DEFAULT_SYSTEM_PROMPT, tone: 'professional', answer_length: 'concise',
    fallback_response: DEFAULT_FALLBACK, greeting_response: DEFAULT_GREETING,
    generation_error_response: DEFAULT_GENERATION_ERROR, allow_small_talk: 1, strict_grounding: 1,
    created_at: now, updated_at: now,
  } as InstructionsDoc;
  await col<InstructionsDoc>('ai_instructions').insertOne(doc);
  return hydrate(doc);
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

export async function updateInstructions(
  accountId: string,
  websiteId: string,
  patch: InstructionsPatch,
  actorId: string,
): Promise<InstructionsRow> {
  await getWebsiteForAccount(accountId, websiteId);
  await getInstructions(accountId, websiteId);

  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    set[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  if (Object.keys(set).length) {
    set.updated_at = nowIso();
    await col('ai_instructions').updateOne({ website_id: websiteId, account_id: accountId }, { $set: set });
    await audit({
      accountId, websiteId, actorType: 'user', actorId,
      action: 'instructions.updated', targetType: 'website', targetId: websiteId,
      metadata: { fields: Object.keys(patch) },
    });
  }
  return getInstructions(accountId, websiteId);
}

export async function resetInstructions(accountId: string, websiteId: string, actorId: string): Promise<InstructionsRow> {
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
