/**
 * Conversations, messages and visitors.
 *
 * Session identity: the widget mints an opaque `session_key`. It is namespaced
 * by website (UNIQUE(website_id, session_key)), so two different sites can
 * never collide, and a session key from one site cannot address another site's
 * conversation.
 */
import { cascadeDeleteConversations, col, nowIso, withTransaction } from '../db/mongo.ts';
import { notFound } from '../core/errors.ts';
import { newId } from '../core/crypto.ts';
import { hashIp } from './audit.ts';
import { notifyNewConversation } from './notifications.ts';

export interface ConversationRow {
  id: string;
  account_id: string;
  website_id: string;
  visitor_id: string | null;
  form_id: string | null;
  session_key: string;
  source: 'widget' | 'preview';
  status: 'active' | 'completed' | 'archived';
  is_read: number;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string;
  summary: string;
  page_url: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  seq: number;
  metadata: string;
  created_at: string;
}

export interface VisitorInfo {
  key?: string;
  name?: string;
  email?: string;
  phone?: string;
}

type ConversationDoc = Omit<ConversationRow, 'id'> & { _id: string };
type MessageDoc = Omit<MessageRow, 'id'> & { account_id: string; website_id: string; _id: string };

function toConversationRow(d: ConversationDoc): ConversationRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}
function toMessageRow(d: MessageDoc): MessageRow {
  return { id: d._id, conversation_id: d.conversation_id, role: d.role, content: d.content, seq: d.seq, metadata: d.metadata, created_at: d.created_at };
}

async function upsertVisitor(
  accountId: string,
  websiteId: string,
  visitor: VisitorInfo | undefined,
  meta: { ip?: string; userAgent?: string },
): Promise<string | null> {
  const key = visitor?.key?.trim();
  if (!key) return null;
  const now = nowIso();
  const existing = await col<{ _id: string }>('visitors').findOne(
    { website_id: websiteId, visitor_key: key },
    { projection: { _id: 1 } },
  );
  if (existing) {
    const set: Record<string, unknown> = { last_seen_at: now };
    if (visitor?.name) set.name = visitor.name;
    if (visitor?.email) set.email = visitor.email;
    if (visitor?.phone) set.phone = visitor.phone;
    await col('visitors').updateOne({ _id: existing._id as never }, { $set: set });
    return existing._id;
  }
  const id = newId();
  await col('visitors').insertOne({
    _id: id, account_id: accountId, website_id: websiteId, visitor_key: key,
    name: visitor?.name ?? '', email: visitor?.email ?? '', phone: visitor?.phone ?? '',
    ip_hash: hashIp(meta.ip), user_agent: (meta.userAgent ?? '').slice(0, 250),
    first_seen_at: now, last_seen_at: now,
  });
  return id;
}

export interface FindOrCreateInput {
  accountId: string;
  websiteId: string;
  sessionKey: string;
  source: 'widget' | 'preview';
  pageUrl?: string;
  visitor?: VisitorInfo;
  ip?: string;
  userAgent?: string;
}

export async function findOrCreateConversation(input: FindOrCreateInput): Promise<ConversationRow> {
  const existing = await col<ConversationDoc>('conversations').findOne({ website_id: input.websiteId, session_key: input.sessionKey });
  if (existing) return toConversationRow(existing);

  const visitorId = await upsertVisitor(input.accountId, input.websiteId, input.visitor, {
    ip: input.ip, userAgent: input.userAgent,
  });

  // Carry over identity captured by a pre-chat form on the same session.
  const submission = await col<{ _id: string; form_id: string; name: string; email: string; phone: string }>('form_submissions')
    .find({ website_id: input.websiteId, session_key: input.sessionKey })
    .sort({ created_at: -1 })
    .limit(1)
    .next();

  const id = newId();
  const now = nowIso();
  const doc: ConversationDoc = {
    _id: id,
    account_id: input.accountId,
    website_id: input.websiteId,
    visitor_id: visitorId,
    form_id: submission?.form_id ?? null,
    session_key: input.sessionKey,
    source: input.source,
    status: 'active',
    is_read: 0,
    visitor_name: input.visitor?.name || submission?.name || '',
    visitor_email: input.visitor?.email || submission?.email || '',
    visitor_phone: input.visitor?.phone || submission?.phone || '',
    summary: '',
    page_url: (input.pageUrl ?? '').slice(0, 2000),
    message_count: 0,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };
  await col<ConversationDoc>('conversations').insertOne(doc);

  if (submission) {
    await col('form_submissions').updateOne(
      { _id: submission._id as never, website_id: input.websiteId },
      { $set: { conversation_id: id } },
    );
  }

  const row = toConversationRow(doc);
  await notifyNewConversation(row);
  return row;
}

export interface AppendScope {
  accountId: string;
  websiteId: string;
  conversationId: string;
}

export async function appendMessages(
  scope: AppendScope,
  entries: Array<{ role: 'user' | 'assistant'; content: string; metadata?: unknown }>,
  visitor?: VisitorInfo,
): Promise<void> {
  const now = nowIso();
  await withTransaction(async (session) => {
    const last = await col<MessageDoc>('messages')
      .find({ conversation_id: scope.conversationId }, { session })
      .sort({ seq: -1 })
      .limit(1)
      .next();
    let seq = last?.seq ?? 0;

    for (const entry of entries) {
      seq += 1;
      await col<MessageDoc>('messages').insertOne(
        {
          _id: newId(), account_id: scope.accountId, website_id: scope.websiteId,
          conversation_id: scope.conversationId, role: entry.role, content: entry.content,
          seq, metadata: JSON.stringify(entry.metadata ?? {}), created_at: now,
        },
        { session },
      );
    }

    const first = await col<MessageDoc>('messages')
      .find({ conversation_id: scope.conversationId, role: 'user' }, { session })
      .sort({ seq: 1 })
      .limit(1)
      .next();
    const summary = (first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);

    const set: Record<string, unknown> = {
      updated_at: now, last_activity_at: now, status: 'active', is_read: 0, summary,
    };
    if (visitor?.name) set.visitor_name = visitor.name;
    if (visitor?.email) set.visitor_email = visitor.email;
    if (visitor?.phone) set.visitor_phone = visitor.phone;

    // $set's keys are computed (only the visitor fields actually supplied),
    // which the driver's update typing cannot check statically against a
    // document typed only by its index signature - the object itself is
    // ordinary MongoDB update syntax.
    await col('conversations').updateOne(
      { _id: scope.conversationId as never, website_id: scope.websiteId, account_id: scope.accountId },
      { $set: set, $inc: { message_count: entries.length } } as never,
      { session },
    );
  });
}

export async function getHistory(
  accountId: string,
  websiteId: string,
  conversationId: string,
  limit = 20,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  // The tenancy check the SQL JOIN used to enforce: no conversation, no history.
  const owns = await col('conversations').findOne(
    { _id: conversationId as never, website_id: websiteId, account_id: accountId },
    { projection: { _id: 1 } },
  );
  if (!owns) return [];

  const rows = await col<MessageDoc>('messages')
    .find({ conversation_id: conversationId, role: { $in: ['user', 'assistant'] } })
    .sort({ seq: -1 })
    .limit(limit)
    .toArray();
  return rows.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
}

export async function getHistoryBySession(
  accountId: string,
  websiteId: string,
  sessionKey: string,
  limit = 20,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const conv = await col<{ _id: string }>('conversations').findOne(
    { website_id: websiteId, account_id: accountId, session_key: sessionKey },
    { projection: { _id: 1 } },
  );
  if (!conv) return [];
  return getHistory(accountId, websiteId, conv._id, limit);
}

/* ------------------------------------------------------------- queries -- */

export interface ConversationFilter {
  status?: string;
  source?: string;
  search?: string;
  formId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

function conversationQuery(accountId: string, websiteId: string, filter: ConversationFilter): Record<string, unknown> {
  const query: Record<string, unknown> = { website_id: websiteId, account_id: accountId };
  if (filter.status && filter.status !== 'all') query.status = filter.status;
  if (filter.source && filter.source !== 'all') query.source = filter.source;
  if (filter.formId) query.form_id = filter.formId;
  if (filter.search) {
    const pattern = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { visitor_name: { $regex: pattern, $options: 'i' } },
      { visitor_email: { $regex: pattern, $options: 'i' } },
      { summary: { $regex: pattern, $options: 'i' } },
    ];
  }
  if (filter.dateFrom || filter.dateTo) {
    const range: Record<string, string> = {};
    if (filter.dateFrom) range.$gte = filter.dateFrom + ' 00:00:00';
    if (filter.dateTo) range.$lte = filter.dateTo + ' 23:59:59';
    query.created_at = range;
  }
  return query;
}

export async function listConversations(
  accountId: string,
  websiteId: string,
  filter: ConversationFilter = {},
): Promise<ConversationRow[]> {
  const docs = await col<ConversationDoc>('conversations')
    .find(conversationQuery(accountId, websiteId, filter))
    .sort({ last_activity_at: -1 })
    .skip(filter.offset ?? 0)
    .limit(Math.min(filter.limit ?? 50, 200))
    .toArray();
  return docs.map(toConversationRow);
}

export async function countConversations(
  accountId: string,
  websiteId: string,
  filter: ConversationFilter = {},
): Promise<number> {
  // The original count ignored search/form/date filters (COUNT used only
  // status and source) - preserved exactly, including that omission.
  return col('conversations').countDocuments(
    conversationQuery(accountId, websiteId, { status: filter.status, source: filter.source }),
  );
}

export async function getConversation(accountId: string, websiteId: string, id: string): Promise<ConversationRow> {
  const row = await col<ConversationDoc>('conversations').findOne({ _id: id as never, website_id: websiteId, account_id: accountId });
  if (!row) throw notFound('Conversation not found.');
  return toConversationRow(row);
}

export async function getTranscript(accountId: string, websiteId: string, id: string): Promise<MessageRow[]> {
  await getConversation(accountId, websiteId, id);
  const docs = await col<MessageDoc>('messages').find({ conversation_id: id }).sort({ seq: 1 }).toArray();
  return docs.map(toMessageRow);
}

export async function setConversationStatus(
  accountId: string,
  websiteId: string,
  id: string,
  status: 'active' | 'completed' | 'archived',
): Promise<void> {
  await getConversation(accountId, websiteId, id);
  await col('conversations').updateOne(
    { _id: id as never, website_id: websiteId, account_id: accountId },
    { $set: { status, updated_at: nowIso() } },
  );
}

export async function markRead(accountId: string, websiteId: string, id: string, isRead = 1): Promise<void> {
  await getConversation(accountId, websiteId, id);
  await col('conversations').updateOne(
    { _id: id as never, website_id: websiteId, account_id: accountId },
    { $set: { is_read: isRead } },
  );
}

export async function deleteConversation(accountId: string, websiteId: string, id: string): Promise<void> {
  await getConversation(accountId, websiteId, id);
  await cascadeDeleteConversations({ _id: id, website_id: websiteId, account_id: accountId });
}

/** Moves conversations idle beyond the timeout to 'completed'. */
export async function completeInactiveConversations(websiteId: string, timeoutMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const res = await col('conversations').updateMany(
    { website_id: websiteId, status: 'active', last_activity_at: { $lt: cutoff } },
    { $set: { status: 'completed', updated_at: nowIso() } },
  );
  return res.modifiedCount;
}
