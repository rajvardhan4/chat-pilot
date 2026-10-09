import { col, nowIso, toBool } from "../db/mongo.js";
import { newId } from "../core/crypto.js";
import { audit } from "./audit.js";
import { getWebsiteForAccount } from "./websites.js";
import { DEFAULT_FALLBACK, DEFAULT_GENERATION_ERROR, DEFAULT_GREETING, DEFAULT_SYSTEM_PROMPT, } from "./instructionDefaults.js";
function hydrate(doc) {
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
export async function getInstructions(accountId, websiteId) {
    const row = await col('ai_instructions').findOne({ website_id: websiteId, account_id: accountId });
    if (row)
        return hydrate(row);
    const id = newId();
    const now = nowIso();
    const doc = {
        _id: id, account_id: accountId, website_id: websiteId,
        business_name: '', system_prompt: DEFAULT_SYSTEM_PROMPT, tone: 'professional', answer_length: 'concise',
        fallback_response: DEFAULT_FALLBACK, greeting_response: DEFAULT_GREETING,
        generation_error_response: DEFAULT_GENERATION_ERROR, allow_small_talk: 1, strict_grounding: 1,
        created_at: now, updated_at: now,
    };
    await col('ai_instructions').insertOne(doc);
    return hydrate(doc);
}
export async function updateInstructions(accountId, websiteId, patch, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    await getInstructions(accountId, websiteId);
    const set = {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
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
export async function resetInstructions(accountId, websiteId, actorId) {
    return updateInstructions(accountId, websiteId, {
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        fallback_response: DEFAULT_FALLBACK,
        greeting_response: DEFAULT_GREETING,
        generation_error_response: DEFAULT_GENERATION_ERROR,
        tone: 'professional',
        answer_length: 'concise',
        strict_grounding: true,
    }, actorId);
}
