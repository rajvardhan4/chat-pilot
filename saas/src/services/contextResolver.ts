/**
 * Conversational context resolution.
 *
 * The plugin resolved follow-ups by pattern-matching one client's service
 * names ("board", "puppy", "day training") into a hardcoded topic list. That
 * cannot ship in a multi-tenant product, so this module derives the active
 * topic from the conversation itself and works for any business.
 *
 * Algorithm
 * ---------
 *  1. Is the new message *referential*? (pronoun/ellipsis with no subject of
 *     its own: "how much does that cost", "how long?", "is it available")
 *  2. If yes, take the active topic - the salient content terms carried by the
 *     most recent turns, preferring the document titles that actually answered
 *     the last question - and append them to the search query.
 *  3. If the message introduces its own subject that does not overlap the
 *     active topic, treat it as a topic switch and use it verbatim.
 */
import { tokenise } from './retrieval.ts';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TopicState {
  /** Salient terms describing what the conversation is currently about. */
  terms: string[];
  /** Human-readable label (usually the title of the document that answered). */
  label: string;
}

/**
 * Pronouns and elliptical forms that cannot stand alone as a search query.
 * These are grammatical, not domain vocabulary, so they are safe to hardcode.
 */
const REFERENTIAL_PATTERNS: RegExp[] = [
  /\b(it|that|this|those|these|they|them|one)\b/i,
  /\b(that|the) (one|option|service|program|plan|package|item)\b/i,
  /\b(the one (you|u) (mentioned|said|listed))\b/i,
  /\b(how (much|long|many|often|far|soon))\b/i,
  /\b(what about|and|also|then)\b/i,
  /\b(is|are) (it|that|this|they) (available|included|free|open)\b/i,
  /\b(which (is|one is) (better|cheaper|faster|best))\b/i,
  /\b(where|when|why|who)\s*\??$/i,
];

/** Words that carry no subject of their own. */
const CARRIER_WORDS = new Set([
  'cost', 'costs', 'price', 'prices', 'pricing', 'long', 'much', 'many', 'take',
  'takes', 'last', 'lasts', 'available', 'included', 'work', 'works', 'better',
  'best', 'cheaper', 'difference', 'different', 'age', 'old', 'where', 'when',
  'why', 'who', 'how', 'what', 'which', 'there', 'here', 'that', 'this', 'it',
  'them', 'they', 'one', 'ones', 'option', 'options', 'about', 'need', 'do',
  'does', 'is', 'are', 'can', 'you', 'your', 'me', 'my',
]);

/**
 * True when the message leans on prior context: it either contains an explicit
 * reference word, or is short and made only of carrier words.
 */
export function isReferential(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  const contentTokens = tokenise(trimmed).filter((t) => !CARRIER_WORDS.has(t));
  const wordCount = trimmed.split(/\s+/).length;

  // "How much?" / "and the cost?" - nothing of its own to search for.
  if (contentTokens.length === 0 && wordCount <= 8) return true;

  // Explicit pronoun or elliptical construction, and no strong new subject.
  const hasReferenceWord = REFERENTIAL_PATTERNS.some((re) => re.test(trimmed));
  if (hasReferenceWord && contentTokens.length <= 2 && wordCount <= 12) return true;

  return false;
}

/**
 * Builds the topic from recent turns. Later turns weigh more; document titles
 * from the previous answer weigh most, because they name what was discussed.
 */
export function deriveTopic(
  history: ConversationTurn[],
  lastAnswerTitles: string[] = [],
): TopicState {
  const weights = new Map<string, number>();
  const recent = history.slice(-6);

  /**
   * Only two sources may *introduce* a topic term: what the visitor actually
   * asked, and the titles of the documents that answered them. The assistant's
   * own prose can reinforce a term but never contribute one, otherwise its
   * phrasing ("Based on our information...") ends up in the search query and
   * dilutes retrieval.
   */
  const eligible = new Set<string>();
  for (const turn of recent) {
    if (turn.role !== 'user') continue;
    for (const token of tokenise(turn.content)) {
      if (!CARRIER_WORDS.has(token)) eligible.add(token);
    }
  }
  for (const title of lastAnswerTitles) {
    for (const token of tokenise(title)) {
      if (!CARRIER_WORDS.has(token)) eligible.add(token);
    }
  }

  recent.forEach((turn, index) => {
    // Assistant text is noisy; user questions state the subject more cleanly.
    const base = turn.role === 'user' ? 3 : 1;
    const recency = 1 + index / Math.max(1, recent.length);
    for (const token of tokenise(turn.content)) {
      if (CARRIER_WORDS.has(token) || !eligible.has(token)) continue;
      weights.set(token, (weights.get(token) ?? 0) + base * recency);
    }
  });

  for (const title of lastAnswerTitles) {
    for (const token of tokenise(title)) {
      if (CARRIER_WORDS.has(token)) continue;
      weights.set(token, (weights.get(token) ?? 0) + 12);
    }
  }

  const terms = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([term]) => term);

  const label = lastAnswerTitles[0] ?? terms.slice(0, 3).join(' ');
  return { terms, label };
}

export interface ResolutionResult {
  /** Query to send to retrieval. */
  searchQuery: string;
  /** True when history was folded in. */
  usedContext: boolean;
  /** True when we decided the visitor changed subject. */
  topicSwitch: boolean;
  topic: TopicState;
}

/**
 * Resolves the visitor's message into a standalone search query.
 */
export function resolveContextualQuery(
  message: string,
  history: ConversationTurn[],
  lastAnswerTitles: string[] = [],
): ResolutionResult {
  const topic = deriveTopic(history, lastAnswerTitles);
  const empty: TopicState = { terms: [], label: '' };

  if (!history.length || !topic.terms.length) {
    return { searchQuery: message, usedContext: false, topicSwitch: false, topic: empty };
  }

  if (isReferential(message)) {
    const extra = topic.terms.slice(0, 4).join(' ');
    return {
      searchQuery: (message + ' ' + extra).trim(),
      usedContext: true,
      topicSwitch: false,
      topic,
    };
  }

  // The message has its own subject. If it shares nothing with the active
  // topic, the visitor has moved on - do not drag the old topic along.
  const newTerms = tokenise(message).filter((t) => !CARRIER_WORDS.has(t));
  const overlap = newTerms.filter((t) => topic.terms.includes(t)).length;
  const topicSwitch = newTerms.length > 0 && overlap === 0;

  return {
    searchQuery: message,
    usedContext: false,
    topicSwitch,
    topic: topicSwitch ? empty : topic,
  };
}
