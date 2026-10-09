/**
 * Retrieval engine (BM25-ish lexical ranking over the website's own documents).
 *
 * Two things changed versus the plugin's version, both deliberate:
 *
 *  1. Every query is bounded by (account_id, website_id). A website can never
 *     retrieve another website's knowledge, even inside the same account.
 *  2. Nothing here knows what industry the customer is in. The plugin hardcoded
 *     one client's programs ("Board and Train", "Puppy...") and another's
 *     services ("dumpking", "trailer|demolition|junk"). Those are gone; topic
 *     detection is now derived from the conversation itself.
 *
 * Scanning strategy: the SQL version pushed its LIKE '%token%' pre-filter and
 * per-token document-frequency count down to SQLite, but a substring LIKE has
 * no index to use there either - it is a table scan, same as this. So this
 * version fetches a website's enabled documents once per query and does the
 * candidate filter, the IDF count and the ranking pass together in memory,
 * which is both simpler and, for the corpus sizes a single website actually
 * has, no slower than round-tripping the database per token.
 */
import { col } from "../db/mongo.js";
/** Authority order from the product spec: FAQ > Manual > Documents > Website. */
export const SOURCE_PRIORITY = { faq: 4, manual: 3, file: 2, website: 1 };
const STOP_WORDS = new Set([
    // English stop words
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot',
    'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few',
    'for', 'from', 'further', 'get', 'gets', 'give', 'gives', 'go', 'goes', 'had', 'hadnt', 'has', 'hasnt', 'have',
    'havent', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id',
    'if', 'ill', 'im', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'ive', 'lets', 'like', 'make', 'makes', 'me',
    'more', 'most', 'my', 'myself', 'need', 'needs', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or',
    'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'please', 'same', 'she', 'should', 'so',
    'some', 'such', 'tell', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
    'there', 'theres', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'us',
    'use', 'uses', 'very', 'was', 'wasnt', 'we', 'well', 'were', 'what', 'whats', 'when', 'where', 'which', 'while',
    'who', 'whom', 'why', 'will', 'with', 'wont', 'would', 'you', 'your', 'yours', 'yourself', 'hi', 'hello', 'hey',
    // Hinglish / Roman Hindi conversational particles and grammatical markers
    'hai', 'h', 'hain', 'ho', 'hun', 'kya', 'kyu', 'kyun', 'kaise', 'kab', 'kaha', 'kahan', 'kidhar', 'kha',
    'kis', 'kisi', 'kisko', 'kiska', 'iski', 'iske', 'iska', 'unka', 'unki', 'unke', 'ka', 'ke', 'ki', 'ko',
    'se', 'me', 'mein', 'par', 'pe', 'aur', 'ya', 'bhi', 'to', 'toh', 'ye', 'yeh', 'wo', 'woh', 'aap',
    'tum', 'hum', 'mera', 'meri', 'mere', 'apka', 'apki', 'apke', 'batao', 'bataiye', 'chahiye',
    'karo', 'kare', 'karna', 'hoga', 'hogi', 'honge', 'tha', 'thi', 'the', 'raha', 'rahi', 'rahe',
    'wali', 'wala', 'wale', 'sirf', 'bas', 'ek', 'do', 'sab', 'bare', 'baare', 'bareme', 'baareme', 'kiske', 'kispe'
]);

export function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

const COMMON_CORRECTIONS = {
    'dor': 'door', 'dors': 'doors',
    'prouct': 'product', 'proucts': 'products', 'prodcut': 'product', 'prodcuts': 'products',
    'pricin': 'pricing', 'prce': 'price', 'prces': 'prices',
    'srvice': 'service', 'srvices': 'services', 'servce': 'service', 'servces': 'services',
    'contct': 'contact', 'cntact': 'contact', 'contac': 'contact',
    'apointment': 'appointment', 'appointmnt': 'appointment', 'apointmnt': 'appointment', 'apoint': 'appoint',
    'bok': 'book', 'boking': 'booking', 'schedual': 'schedule', 'schedul': 'schedule',
    'locaton': 'location', 'locatn': 'location', 'adrdess': 'address', 'adres': 'address',
    'replacment': 'replacement', 'replacemnt': 'replacement', 'enclosur': 'enclosure', 'enclosr': 'enclosure',
    'mecanism': 'mechanism', 'mechanim': 'mechanism', 'intermatc': 'intermatic',
    'checkot': 'checkout', 'checout': 'checkout', 'shippin': 'shipping', 'warenty': 'warranty'
};

export function correctTypo(word, vocabSet) {
    const w = word.toLowerCase();
    if (COMMON_CORRECTIONS[w]) {
        return COMMON_CORRECTIONS[w];
    }
    if (!vocabSet || vocabSet.has(w)) {
        return w;
    }
    const maxDist = w.length >= 6 ? 2 : 1;
    let closest = w;
    let bestDist = 999;
    for (const vocabWord of vocabSet) {
        if (Math.abs(vocabWord.length - w.length) > maxDist) continue;
        const d = levenshteinDistance(w, vocabWord);
        if (d <= maxDist && d < bestDist) {
            bestDist = d;
            closest = vocabWord;
        }
    }
    return closest;
}

/**
 * Groups a query into one entry per original word, each holding that word's
 * variants (stems, dash splits, typo corrections).
 */
export function tokenGroups(input, vocabSet) {
    const normalised = String(input ?? '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ');
    const groups = [];
    for (const word of normalised.split(/\s+/).filter(Boolean)) {
        if (word.length < 2 || STOP_WORDS.has(word))
            continue;
        const corrected = correctTypo(word, vocabSet);
        const variants = new Set([word, corrected]);
        if (word.includes('-')) {
            for (const part of word.split('-')) {
                if (part.length > 1 && !STOP_WORDS.has(part)) {
                    variants.add(part);
                    variants.add(correctTypo(part, vocabSet));
                }
            }
        }
        for (const variant of [...variants]) {
            if (variant.length > 3 && variant.endsWith('ies'))
                variants.add(variant.slice(0, -3) + 'y');
            else if (variant.length > 3 && variant.endsWith('es'))
                variants.add(variant.slice(0, -2));
            else if (variant.length > 3 && variant.endsWith('s'))
                variants.add(variant.slice(0, -1));
        }
        groups.push([...variants]);
    }
    return groups;
}

export function tokenise(input, vocabSet) {
    const normalised = String(input ?? '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ');
    const words = normalised.split(/\s+/).filter(Boolean);
    const tokens = [];
    for (const word of words) {
        if (word.length < 2 || STOP_WORDS.has(word))
            continue;
        const corrected = correctTypo(word, vocabSet);
        tokens.push(word);
        if (corrected !== word) {
            tokens.push(corrected);
        }
        if (word.includes('-')) {
            for (const part of word.split('-')) {
                if (part.length > 1 && !STOP_WORDS.has(part)) {
                    tokens.push(part);
                    const corrPart = correctTypo(part, vocabSet);
                    if (corrPart !== part) tokens.push(corrPart);
                }
            }
        }
    }
    // Light stemming so "services" also matches "service".
    const expanded = [];
    for (const token of tokens) {
        expanded.push(token);
        if (token.length > 3 && token.endsWith('ies'))
            expanded.push(token.slice(0, -3) + 'y');
        else if (token.length > 3 && token.endsWith('es'))
            expanded.push(token.slice(0, -2));
        else if (token.length > 3 && token.endsWith('s'))
            expanded.push(token.slice(0, -1));
    }
    // Fall back to any word over two characters if the query is all stop words.
    if (!expanded.length) {
        for (const word of words)
            if (word.length > 2)
                expanded.push(word);
    }
    return [...new Set(expanded)];
}

export function detectQueryIntent(query) {
    const q = query.toLowerCase().trim();
    if (/\b(price|pricing|cost|costs|rate|rates|fee|fees|how much|quote|charge|charges|packages?|daam|kimat|kitna|kitne|kharcha|paise|pricing page)\b/.test(q)) {
        return 'pricing';
    }
    if (/\b(contact|phone|telephone|call|email|e-mail|reach|get in touch|address|enquir|inquir|sampark|baat|call karo|number)\b/.test(q)) {
        return 'contact';
    }
    if (/\b(where|areas?|service area|located|location|locations|cities|city|county|coverage|zip|postcode|directions|kaha|kahan|kidhar|kha|address|pata|sthan)\b/.test(q)) {
        return 'locations';
    }
    if (/\b(about (you|us|the company)|who are you|who is|your (story|history|team)|history|mission|values|aap kaun|company ke baare|kis bare|kis baare|kiske bare|kiske baare|ye website kya|what is this website|website kis)\b/.test(q)) {
        return 'company';
    }
    if (/\b(book|booking|appointment|schedule|time slot|reserve|reservation|mulaqat|tarikh|date)\b/.test(q)) {
        return 'booking';
    }
    if (/\b(cart|checkout|buy|purchase|order|kharidna|lena|payment)\b/.test(q)) {
        return 'checkout';
    }
    if (/\b(what (do|does) (you|they|it)|what services|what can you|what options|list of|tell me about (your|the)|overview|everything|kya kya|kya offer|products|items|services|samaan)\b/.test(q)) {
        return 'overview';
    }
    return 'specific';
}

const INTENT_EXPANSIONS = {
    contact: ['contact', 'phone', 'email', 'call', 'reach', 'address', 'hours'],
    locations: ['location', 'area', 'serve', 'address', 'city', 'region', 'coverage'],
    company: ['about', 'company', 'business', 'team', 'history', 'story'],
    overview: ['product', 'service', 'offer', 'provide', 'option', 'solution', 'package'],
    pricing: ['price', 'cost', 'rate', 'fee', 'quote', 'package', 'pricing'],
    booking: ['book', 'booking', 'appointment', 'schedule', 'reservation', 'contact'],
    checkout: ['cart', 'checkout', 'order', 'buy', 'purchase', 'product'],
    specific: [],
};
/**
 * Ranks documents for a query.
 *
 * Scoring: token frequency weighted by IDF, a strong title-match bonus, a
 * phrase bonus, then normalised by document length so a 4000-word page cannot
 * out-rank a focused FAQ purely on volume.
 */
export async function searchKnowledge(accountId, websiteId, query, options = {}) {
    const corpus = await col('knowledge_documents')
        .find({ website_id: websiteId, account_id: accountId, status: 'enabled' }, { projection: { title: 1, content: 1, source_url: 1, source_type: 1, category: 1, word_count: 1 } })
        .toArray();
    if (!corpus.length)
        return [];
    const docs = corpus.map((d) => ({
        id: d._id, title: d.title ?? '', content: d.content ?? '', sourceUrl: d.source_url ?? '',
        sourceType: d.source_type ?? 'website', category: d.category ?? '', wordCount: d.word_count ?? 0,
        titleLower: (d.title ?? '').toLowerCase(), contentLower: (d.content ?? '').toLowerCase(),
    }));

    // Extract dynamic vocabulary from website documents for fuzzy typo tolerance
    const vocabSet = new Set();
    for (const doc of docs) {
        const words = (doc.titleLower + ' ' + doc.contentLower).match(/[a-z]{4,}/g) || [];
        for (const w of words) vocabSet.add(w);
    }

    const baseTokens = tokenise(query, vocabSet);
    if (!baseTokens.length)
        return [];
    const groups = tokenGroups(query, vocabSet);
    const intent = detectQueryIntent(query);
    const tokens = [...new Set([...baseTokens, ...INTENT_EXPANSIONS[intent]])];
    // The old WHERE clause: keep only documents that contain at least one token
    // (in title or content) before the scoring pass runs.
    const candidates = docs.filter((doc) => tokens.some((token) => doc.contentLower.includes(token) || doc.titleLower.includes(token)));
    if (!candidates.length)
        return [];
    const totalDocs = Math.max(1, docs.length);
    // IDF per token, computed once against this website's corpus only.
    const idf = new Map();
    for (const token of tokens) {
        const df = Math.max(1, docs.filter((doc) => doc.contentLower.includes(token) || doc.titleLower.includes(token)).length);
        idf.set(token, Math.log(totalDocs / df) + 1);
    }
    const queryLower = query.toLowerCase().trim();
    const scored = [];
    for (const row of candidates) {
        const content = row.contentLower;
        const title = row.titleLower;
        let score = 0;
        for (const token of tokens) {
            const weight = idf.get(token) ?? 1;
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const bodyMatches = content.match(new RegExp('\\b' + escaped + '\\b', 'g'))?.length ?? 0;
            score += bodyMatches * weight;
            if (new RegExp('\\b' + escaped + '\\b').test(title))
                score += 25 * weight;
        }
        if (baseTokens.length > 1) {
            if (content.includes(queryLower))
                score += 12;
            if (title.includes(queryLower))
                score += 25;
        }
        // Category alignment nudges structurally-matching pages upward.
        const category = row.category.toLowerCase();
        if ((intent === 'contact' && category === 'contact') ||
            (intent === 'locations' && category === 'locations') ||
            (intent === 'company' && category === 'company') ||
            (intent === 'pricing' && category === 'pricing')) {
            score += 8;
        }
        if (score <= 0)
            continue;
        /**
         * Coverage guard.
         *
         * Without this, one shared word is enough to look like a match: asking a
         * plumber about "replacement guitar strings" scored highly against
         * "Water heater replacement" purely on the title-match bonus, and the
         * visitor got a confidently wrong answer instead of the fallback. Score is
         * now weighted by how much of the actual question a document covers, and
         * documents that cover almost none of a multi-word question are dropped.
         */
        let matchedGroups = 0;
        for (const variants of groups) {
            const hit = variants.some((variant) => {
                const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp('\\b' + escaped + '\\b');
                return re.test(content) || re.test(title);
            });
            if (hit)
                matchedGroups += 1;
        }
        const coverage = groups.length ? matchedGroups / groups.length : 1;
        if (groups.length >= 3 && coverage < 0.34)
            continue;
        if (groups.length === 2 && matchedGroups === 0)
            continue;
        const wordCount = Math.max(1, row.wordCount);
        const weighted = (score * (0.4 + 0.6 * coverage)) / Math.log(wordCount + 1.5);
        scored.push({ row, score: Number(weighted.toFixed(4)) });
    }
    if (!scored.length)
        return [];
    const threshold = options.threshold ?? 3.0;
    let pool = options.bypassThreshold ? scored : scored.filter((s) => s.score >= threshold);
    if (!pool.length) {
        if (!options.bypassThreshold)
            return [];
        pool = scored;
    }
    // Deduplicate website pages by URL for broad questions so one long page does
    // not fill the whole context window.
    if (intent === 'overview' || intent === 'company') {
        const bestByUrl = new Map();
        const others = [];
        for (const item of pool) {
            if (item.row.sourceType === 'website') {
                const url = item.row.sourceUrl || item.row.id;
                const existing = bestByUrl.get(url);
                if (!existing || item.score > existing.score)
                    bestByUrl.set(url, item);
            }
            else {
                others.push(item);
            }
        }
        pool = [...others, ...bestByUrl.values()];
    }
    pool.sort((a, b) => {
        // A clearly better lexical match always wins.
        if (Math.abs(a.score - b.score) > 1.5)
            return b.score - a.score;
        // Otherwise the configured source authority decides.
        const pa = SOURCE_PRIORITY[a.row.sourceType] ?? 0;
        const pb = SOURCE_PRIORITY[b.row.sourceType] ?? 0;
        if (pa !== pb)
            return pb - pa;
        return b.score - a.score;
    });
    const limit = intent === 'overview' ? Math.max(options.limit ?? 5, 8) : (options.limit ?? 5);
    return pool.slice(0, limit).map(({ row, score }) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        sourceUrl: row.sourceUrl,
        sourceType: row.sourceType,
        category: row.category,
        wordCount: row.wordCount,
        score,
    }));
}
