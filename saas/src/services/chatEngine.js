/**
 * The Chat Pilot response engine.
 *
 * Pipeline (identical for the widget and the Developer Preview, so the two can
 * never diverge - only the diagnostics attached to the result differ):
 *
 *   message -> context resolution -> intent -> retrieval -> source priority
 *           -> AI instructions -> provider + model -> generation
 *           -> sanitisation -> persistence -> usage/analytics -> response
 *
 * Two failure states are kept strictly apart, per the product spec:
 *   MISSING KNOWLEDGE  -> the configured fallback response
 *   PROVIDER FAILURE   -> the configured generation-error response
 */
import { col, nowIso } from "../db/mongo.js";
import { env } from "../config/env.js";
import { newId } from "../core/crypto.js";
import { sanitiseAssistantText } from "../core/validate.js";
import { log } from "../core/logger.js";
import { requireProvider } from "../providers/registry.js";
import { getConfig, recordProviderFailure, recordProviderSuccess, resolveCredentials } from "./providerService.js";
import { getInstructions } from "./instructions.js";
import { resolveContextualQuery } from "./contextResolver.js";
import { searchKnowledge } from "./retrieval.js";
import { estimateCost } from "./pricing.js";
import { recordUsage } from "./usage.js";
import { notifyProviderFailure } from "./notifications.js";
import { appendMessages, findOrCreateConversation } from "./conversations.js";
const ERROR_LABELS = {
    authentication_error: 'Authentication / Invalid Key',
    quota_exceeded: 'Quota Exceeded',
    rate_limited: 'Rate Limited',
    model_unavailable: 'Model Unavailable',
    timeout_error: 'Timeout / Network Error',
    provider_unavailable: 'Provider Temporarily Unavailable',
    provider_error: 'AI Provider Error',
};
const ERROR_TO_STATUS = {
    authentication_error: 'invalid_credential',
    quota_exceeded: 'quota_limited',
    rate_limited: 'rate_limited',
    model_unavailable: 'model_unavailable',
    timeout_error: 'temporarily_unavailable',
    provider_unavailable: 'temporarily_unavailable',
    provider_error: 'connection_failed',
};
/** Greetings and small talk are grammatical, not domain-specific. */
function classifyMessageIntent(message) {
    const q = message.trim().toLowerCase();
    if (q.length <= 40 && /^(hi|hello|hey|yo|howdy|greetings|namaste|namaskar|pranam|ram ram|kya haal hai|good (morning|afternoon|evening)|hi there|hello there)[\s!.,?]*$/.test(q)) {
        return 'greeting';
    }
    if (q.length <= 60 && /^(thanks|thank you|thx|ty|cheers|bye|goodbye|see you|ok|okay|got it|great|awesome|perfect|shukriya|dhanyawad|theek hai|sahi hai|alvida)[\s!.,?]*$/.test(q)) {
        return 'small_talk';
    }
    if (/^(how are you|who are you|what are you|kaise ho|aap kaun ho|are you (a )?(bot|human|real|ai))[\s!.,?]*$/.test(q)) {
        return 'small_talk';
    }
    return 'knowledge';
}
function confidenceLabel(hasDocs, topScore) {
    if (!hasDocs)
        return 'Fallback';
    if (topScore >= 7)
        return 'Excellent Match';
    if (topScore >= 4)
        return 'Good Match';
    return 'Weak Match';
}
function buildContextBlock(documents, charBudget = 12000) {
    const parts = [];
    let used = 0;
    for (const doc of documents) {
        const block = 'Source: [' + doc.sourceType.toUpperCase() + ']' +
            (doc.sourceUrl && !doc.sourceUrl.startsWith('manual://') && !doc.sourceUrl.startsWith('faq://')
                ? ' (' + doc.sourceUrl + ')'
                : '') +
            '\nTitle: ' + doc.title +
            '\nContent:\n' + doc.content.slice(0, 4000);
        if (used + block.length > charBudget)
            break;
        parts.push(block);
        used += block.length;
    }
    return parts.join('\n\n---\n\n');
}
function buildSystemPrompt(opts) {
    const { instructions, contextBlock, businessName, actionLinks, isAdjacent } = opts;
    const lines = [];
    lines.push('You are the intelligent, helpful, multilingual AI assistant for ' + (businessName || 'this business') + '.');
    lines.push('');
    lines.push('CORE OBJECTIVE:');
    lines.push('Assist website visitors proactively, warmly, and accurately. Help them explore products, check pricing, understand what the website offers, schedule appointments, view services, and proceed to checkout.');
    lines.push('');

    // Sanitize business instructions: strip legacy rigid refusal/fallback mandates
    let cleanedPrompt = (instructions.system_prompt || '')
        .replace(/BOUNDARIES[\s\S]*?(?=\n\n|$)/gi, '')
        .replace(/If the question is unrelated to this business[^\n]*/gi, '')
        .trim();
    if (cleanedPrompt) {
        lines.push('BUSINESS INSTRUCTIONS:');
        lines.push(cleanedPrompt);
        lines.push('');
    }

    lines.push('CORE RESPONSE GUIDELINES:');
    lines.push('1. WEBSITE OVERVIEW (e.g., "kis bare me h", "what is this website about", "what do you do"):');
    lines.push('   Explain clearly and warmly what ' + (businessName || 'this website') + ' is about, its specialty, and list main products/services with links.');
    lines.push('2. PRICING & SHOP PAGES (e.g., "pricing page kha h", "price", "rates", "cost", "shop"):');
    lines.push('   Direct the user to the relevant product or shop/pricing link from the Available Action Links below. State any prices mentioned in the context ($27.95, etc.) and give the direct clickable link [Page Title](URL). NEVER refuse or say pricing is unavailable when a shop or product link exists.');
    lines.push('3. MULTILINGUAL & HINGLISH FLUENCY:');
    lines.push('   - Detect language automatically.');
    lines.push('   - If the visitor asks in Hinglish (e.g. "kis bare me h", "pricing page kha h", "kya cost hai"), reply in fluent, natural HINGLISH (Roman Hindi script).');
    lines.push('   - If the visitor asks in English, reply in natural English.');
    lines.push('4. GENERAL & ADJACENT QUESTIONS (e.g., "Where is Delhi?", "What is an air switch?"):');
    lines.push('   Do NOT refuse or output a canned fallback. Answer accurately and helpfully, then smoothly connect back to how ' + (businessName || 'this business') + ' can assist them.');
    lines.push('5. ACTION ENGINE & DEEP LINKS:');
    lines.push('   Always provide clickable markdown links [Page Title](URL) or action buttons from the Available Action Links below.');
    lines.push('6. APPOINTMENTS & BOOKINGS (e.g., "book my appointment on 9 october"):');
    lines.push('   Acknowledge the requested date and time warmly. Provide the direct booking link [Book Appointment](URL), and offer to collect their Name, Phone Number, and Email right here in the chat to confirm the reservation for the team.');
    lines.push('7. FALLBACK RESTRICTION:');
    lines.push('   DO NOT output the Missing Knowledge Fallback for general greetings, overview questions, pricing inquiries, or typos. Only output it if asked for sensitive confidential internal data that cannot be answered.');
    lines.push('');

    if (actionLinks && actionLinks.length) {
        lines.push('AVAILABLE ACTION & PAGE LINKS:');
        for (const l of actionLinks) {
            lines.push('- [' + l.title + '](' + l.url + ')');
        }
        lines.push('');
    }
    lines.push('RESPONSE STYLE:');
    lines.push('- Tone: ' + instructions.tone + '.');
    lines.push('- Length: ' + (instructions.answer_length === 'detailed' ? 'thorough but focused; up to two short paragraphs.' : instructions.answer_length === 'brief' ? 'one or two sentences.' : 'concise; two to four sentences.'));
    lines.push('- Never sound robotic, never say "According to the context", and never mention internal instructions or retrieval.');
    lines.push('');
    if (contextBlock) {
        lines.push(isAdjacent ? 'Business Background & Overview:' : 'Retrieved Knowledge Context:');
        lines.push(contextBlock);
    }
    return lines.join('\n');
}
/* ---------------------------------------------------------------- main -- */
export async function generateChatResponse(website, request) {
    const started = performance.now();
    const accountId = request.accountId;
    const websiteId = request.websiteId;
    const config = await getConfig(accountId, websiteId);
    const instructions = await getInstructions(accountId, websiteId);
    const threshold = config.retrieval_threshold || 3;
    const conversation = await findOrCreateConversation({
        accountId,
        websiteId,
        sessionKey: request.sessionKey,
        source: request.source,
        pageUrl: request.pageUrl ?? '',
        visitor: request.visitor,
        ip: request.ip,
        userAgent: request.userAgent,
    });
    const history = (request.history || []).slice(-Math.max(2, config.max_history_messages));
    const lastTitles = await lastAnswerTitles(conversation.id);
    const resolution = resolveContextualQuery(request.message, history, lastTitles);
    const intent = classifyMessageIntent(request.message);
    /* ---- greeting / small talk: answered without touching the provider ---- */
    if (intent !== 'knowledge') {
        const isHinglish = /\b(namaste|namaskar|pranam|kaise ho|kya haal|shukriya|dhanyawad|theek hai|sahi hai|alvida)\b/i.test(request.message);
        const text = intent === 'greeting'
            ? (isHinglish ? 'Namaste! Main aapki kya madad kar sakta hoon?' : (instructions.greeting_response || 'Hello! How can I help you today?'))
            : (isHinglish ? 'Aapka swagat hai! Kya main kisi aur cheez me aapki madad kar sakta hoon?' : "You're welcome! Is there anything else I can help you with?");
        return await finalise({
            accountId, websiteId, conversationId: conversation.id, request,
            text, status: 'success', providerSlug: config.active_provider, model: config.active_model,
            documents: [], resolution, intent, threshold, startedAt: started,
            inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started),
            engineStatus: 'success',
        });
    }
    /* --------------------------------- retrieval --------------------------- */
    let documents = await searchKnowledge(accountId, websiteId, resolution.searchQuery, {
        limit: 5,
        threshold,
    });
    // If the rewritten query found nothing, retry with the raw message.
    if (!documents.length && resolution.usedContext) {
        documents = await searchKnowledge(accountId, websiteId, request.message, { limit: 5, threshold });
    }
    const allCandidates = documents.length
        ? documents
        : await searchKnowledge(accountId, websiteId, resolution.searchQuery, {
            limit: 5, threshold, bypassThreshold: true,
        });
    const topScore = allCandidates[0]?.score ?? 0;
    // Follow-up rescue: the visitor is clearly continuing a topic and there is a
    // near-threshold match. Accept it rather than emitting a fallback mid-thread.
    if (!documents.length && resolution.usedContext && topScore >= threshold * 0.6) {
        documents = allCandidates.slice(0, 3);
    }

    // Collect available action and page links across the website
    const allDocs = await col('knowledge_documents')
        .find({ website_id: websiteId, account_id: accountId, status: 'enabled' }, { projection: { title: 1, source_url: 1 } })
        .toArray();
    const actionLinksMap = new Map();
    for (const d of allDocs) {
        if (d.source_url && /^https?:\/\//i.test(d.source_url)) {
            const cleanUrl = d.source_url.replace(/\/+$/, '');
            if (!actionLinksMap.has(cleanUrl)) {
                let label = d.title.replace(/\s*-\s*.*$/, '').trim();
                if (label.length > 50) label = label.slice(0, 50);
                actionLinksMap.set(cleanUrl, label || 'Page');
            }
        }
    }
    const actionLinks = Array.from(actionLinksMap.entries()).map(([url, title]) => ({ title, url }));

    /* ------------------- missing vs adjacent knowledge -------------------- */
    let isAdjacent = false;
    if (!documents.length) {
        const baseline = await col('knowledge_documents')
            .find({ website_id: websiteId, account_id: accountId, status: 'enabled' })
            .sort({ source_type: -1 })
            .limit(3)
            .toArray();
        if (baseline.length) {
            documents = baseline.map((d) => ({
                id: d._id, title: d.title ?? '', content: d.content ?? '', sourceUrl: d.source_url ?? '',
                sourceType: d.source_type ?? 'website', category: d.category ?? '', score: 0,
                wordCount: d.word_count ?? 0,
            }));
            isAdjacent = true;
        } else {
            return await finalise({
                accountId, websiteId, conversationId: conversation.id, request,
                text: instructions.fallback_response, status: 'fallback',
                providerSlug: config.active_provider, model: config.active_model,
                documents: [], resolution, intent, threshold, topScore, startedAt: started,
                inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started),
                engineStatus: 'fallback',
            });
        }
    }
    /* ---------------------------- provider check --------------------------- */
    if (!config.active_provider || !config.active_model) {
        log.warn('Chat request with no configured AI provider.', { websiteId }, { accountId, websiteId });
        return await finalise({
            accountId, websiteId, conversationId: conversation.id, request,
            text: instructions.generation_error_response, status: 'provider_error',
            providerSlug: config.active_provider, model: config.active_model,
            documents, resolution, intent, threshold, topScore, startedAt: started,
            inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started),
            engineStatus: 'provider_error',
            failure: {
                errorType: 'provider_error',
                message: 'No AI provider is configured for this website.',
                httpStatus: 0,
            },
        });
    }
    const credentials = await resolveCredentials(accountId, websiteId, config.active_provider);
    if (!credentials) {
        return await finalise({
            accountId, websiteId, conversationId: conversation.id, request,
            text: instructions.generation_error_response, status: 'provider_error',
            providerSlug: config.active_provider, model: config.active_model,
            documents, resolution, intent, threshold, topScore, startedAt: started,
            inputTokens: 0, outputTokens: 0, latencyMs: Math.round(performance.now() - started),
            engineStatus: 'provider_error',
            failure: {
                errorType: 'authentication_error',
                message: 'No API key is stored for the selected provider.',
                httpStatus: 401,
            },
        });
    }
    /* ----------------------------- generation ------------------------------ */
    const contextBlock = buildContextBlock(documents);
    const system = buildSystemPrompt({
        instructions,
        contextBlock,
        businessName: instructions.business_name || website.name,
        actionLinks,
        isAdjacent,
    });
    const turns = [...history, { role: 'user', content: request.message }];
    const adapter = requireProvider(config.active_provider);
    let result;
    try {
        result = await adapter.generate({
            credentials,
            model: config.active_model,
            system,
            messages: turns.map((t) => ({ role: t.role, content: t.content })),
            temperature: config.temperature,
            maxOutputTokens: config.max_output_tokens,
            timeoutMs: env.PROVIDER_TIMEOUT_MS,
        });
    }
    catch (err) {
        result = {
            ok: false,
            errorType: 'provider_error',
            message: err instanceof Error ? err.message : 'Unexpected provider failure.',
            httpStatus: 0,
            latencyMs: Math.round(performance.now() - started),
            model: config.active_model,
        };
    }
    if (!result.ok) {
        await recordProviderFailure(accountId, websiteId, config.active_provider, ERROR_TO_STATUS[result.errorType], result.message);
        await notifyProviderFailure({
            accountId, websiteId,
            provider: config.active_provider,
            model: config.active_model,
            errorType: result.errorType,
            errorLabel: ERROR_LABELS[result.errorType],
            message: result.message,
            httpStatus: result.httpStatus,
        });
        return await finalise({
            accountId, websiteId, conversationId: conversation.id, request,
            text: instructions.generation_error_response, status: 'provider_error',
            providerSlug: config.active_provider, model: config.active_model,
            documents, resolution, intent, threshold, topScore, startedAt: started,
            inputTokens: 0, outputTokens: 0, latencyMs: result.latencyMs,
            engineStatus: 'provider_error',
            promptChars: system.length, contextChars: contextBlock.length,
            failure: {
                errorType: result.errorType,
                message: result.message,
                httpStatus: result.httpStatus,
                retryAfter: result.retryAfter,
            },
        });
    }
    await recordProviderSuccess(accountId, websiteId, config.active_provider, result.latencyMs);
    const text = sanitiseAssistantText(result.text) || instructions.fallback_response;
    return await finalise({
        accountId, websiteId, conversationId: conversation.id, request,
        text, status: 'success',
        providerSlug: config.active_provider, model: result.model,
        documents, resolution, intent, threshold, topScore, startedAt: started,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        engineStatus: 'success',
        promptChars: system.length, contextChars: contextBlock.length,
    });
}
/* ------------------------------------------------------------- helpers -- */
async function lastAnswerTitles(conversationId) {
    const row = await col('messages')
        .find({ conversation_id: conversationId, role: 'assistant' })
        .sort({ seq: -1 })
        .limit(1)
        .next();
    if (!row)
        return [];
    try {
        const parsed = JSON.parse(row.metadata);
        return Array.isArray(parsed.documentTitles) ? parsed.documentTitles.slice(0, 3) : [];
    }
    catch {
        return [];
    }
}
async function finalise(input) {
    const { accountId, websiteId, conversationId, request, text, documents, resolution, } = input;
    const totalTokens = input.inputTokens + input.outputTokens;
    const cost = await estimateCost(input.providerSlug, input.model, input.inputTokens, input.outputTokens);
    const retrievedSources = { faq: false, manual: false, file: false, website: false };
    for (const doc of documents)
        retrievedSources[doc.sourceType] = true;
    const activeTypes = Object.entries(retrievedSources)
        .filter(([, used]) => used)
        .map(([type]) => type.toUpperCase());
    const sourcesUsed = activeTypes.length ? activeTypes.join(' + ') : 'None';
    // Persist the exchange.
    await appendMessages({ accountId, websiteId, conversationId }, [
        { role: 'user', content: request.message, metadata: {} },
        {
            role: 'assistant',
            content: text,
            metadata: {
                status: input.engineStatus,
                provider: input.providerSlug,
                model: input.model,
                documentTitles: documents.slice(0, 3).map((d) => d.title),
                topScore: input.topScore ?? documents[0]?.score ?? 0,
            },
        },
    ], request.visitor);
    // Analytics / usage.
    await col('ai_requests').insertOne({
        _id: newId(),
        account_id: accountId,
        website_id: websiteId,
        conversation_id: conversationId,
        provider: input.providerSlug,
        model: input.model,
        status: input.engineStatus,
        error_type: input.failure?.errorType ?? '',
        error_label: input.failure ? ERROR_LABELS[input.failure.errorType] : '',
        http_status: input.failure?.httpStatus ?? 0,
        intent: input.intent,
        retrieval_hit: documents.length ? 1 : 0,
        top_score: input.topScore ?? documents[0]?.score ?? 0,
        sources_used: sourcesUsed,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
        total_tokens: totalTokens,
        estimated_cost: cost,
        latency_ms: input.latencyMs,
        source: request.source,
        created_at: nowIso(),
    });
    await recordUsage(accountId, websiteId, {
        messages: 2,
        aiRequests: 1,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: cost,
    });
    const response = { text, conversationId, status: input.status };
    if (request.includeDiagnostics) {
        response.diagnostics = {
            intent: input.intent,
            contextualQuery: resolution.searchQuery,
            usedContext: resolution.usedContext,
            topicSwitch: resolution.topicSwitch,
            topScore: input.topScore ?? documents[0]?.score ?? 0,
            threshold: input.threshold,
            confidence: confidenceLabel(documents.length > 0, input.topScore ?? documents[0]?.score ?? 0),
            sourcesUsed,
            retrievedSources,
            documents: documents.map((d) => ({
                id: d.id, title: d.title, sourceType: d.sourceType, score: d.score, sourceUrl: d.sourceUrl,
            })),
            provider: input.providerSlug,
            model: input.model,
            latencyMs: input.latencyMs,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            totalTokens,
            estimatedCost: cost,
            promptChars: input.promptChars ?? 0,
            contextChars: input.contextChars ?? 0,
            status: input.engineStatus,
            errorType: input.failure?.errorType,
            errorLabel: input.failure ? ERROR_LABELS[input.failure.errorType] : undefined,
            httpStatus: input.failure?.httpStatus,
            providerMessage: input.failure?.message,
            retryAfter: input.failure?.retryAfter,
            timestamp: nowIso(),
        };
    }
    return response;
}
