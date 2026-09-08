/**
 * Conversations, messages and visitors.
 *
 * Session identity: the widget mints an opaque `session_key`. It is namespaced
 * by website (UNIQUE(website_id, session_key)), so two different sites can
 * never collide, and a session key from one site cannot address another site's
 * conversation.
 */
import { db, nowIso } from '../db/index.ts';
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

function upsertVisitor(
  accountId: string,
  websiteId: string,
  visitor: VisitorInfo | undefined,
  meta: { ip?: string; userAgent?: string },
): string | null {
  const key = visitor?.key?.trim();
  if (!key) return null;
  const now = nowIso();
  const existing = db.get<{ id: string }>(
    'SELECT id FROM visitors WHERE website_id = ? AND visitor_key = ?',
    websiteId, key,
  );
  if (existing) {
    db.run(
      `UPDATE visitors
          SET last_seen_at = ?,
              name = CASE WHEN ? <> '' THEN ? ELSE name END,
              email = CASE WHEN ? <> '' THEN ? ELSE email END,
              phone = CASE WHEN ? <> '' THEN ? ELSE phone END
        WHERE id = ?`,
      now,
      visitor?.name ?? '', visitor?.name ?? '',
      visitor?.email ?? '', visitor?.email ?? '',
      visitor?.phone ?? '', visitor?.phone ?? '',
      existing.id,
    );
    return existing.id;
  }
  const id = newId();
  db.run(
    `INSERT INTO visitors (id, account_id, website_id, visitor_key, name, email, phone,
                           ip_hash, user_agent, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, accountId, websiteId, key,
    visitor?.name ?? '', visitor?.email ?? '', visitor?.phone ?? '',
    hashIp(meta.ip), (meta.userAgent ?? '').slice(0, 250), now, now,
  );
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

export function findOrCreateConversation(input: FindOrCreateInput): ConversationRow {
  const existing = db.get<ConversationRow>(
    'SELECT * FROM conversations WHERE website_id = ? AND session_key = ?',
    input.websiteId, input.sessionKey,
  );
  if (existing) return existing;

  const visitorId = upsertVisitor(input.accountId, input.websiteId, input.visitor, {
    ip: input.ip, userAgent: input.userAgent,
  });

  // Carry over identity captured by a pre-chat form on the same session.
  const submission = db.get<{ id: string; form_id: string; name: string; email: string; phone: string }>(
    `SELECT id, form_id, name, email, phone FROM form_submissions
      WHERE website_id = ? AND session_key = ? ORDER BY created_at DESC LIMIT 1`,
    input.websiteId, input.sessionKey,
  );

  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO conversations
       (id, account_id, website_id, visitor_id, form_id, session_key, source, status, is_read,
        visitor_name, visitor_email, visitor_phone, page_url, message_count,
        created_at, updated_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, 0, ?, ?, ?)`,
    id, input.accountId, input.websiteId, visitorId, submission?.form_id ?? null,
    input.sessionKey, input.source,
    input.visitor?.name || submission?.name || '',
    input.visitor?.email || submission?.email || '',
    input.visitor?.phone || submission?.phone || '',
    (input.pageUrl ?? '').slice(0, 2000), now, now, now,
  );

  if (submission) {
    db.run(
      'UPDATE form_submissions SET conversation_id = ? WHERE id = ? AND website_id = ?',
      id, submission.id, input.websiteId,
    );
  }

  const row = db.get<ConversationRow>('SELECT * FROM conversations WHERE id = ?', id)!;
  notifyNewConversation(row);
  return row;
}

export interface AppendScope {
  accountId: string;
  websiteId: string;
  conversationId: string;
}

export function appendMessages(
  scope: AppendScope,
  entries: Array<{ role: 'user' | 'assistant'; content: string; metadata?: unknown }>,
  visitor?: VisitorInfo,
): void {
  const now = nowIso();
  db.tx(() => {
    const seqRow = db.get<{ maxSeq: number | null }>(
      'SELECT MAX(seq) AS maxSeq FROM messages WHERE conversation_id = ?',
      scope.conversationId,
    );
    let seq = Number(seqRow?.maxSeq ?? 0);

    for (const entry of entries) {
      seq += 1;
      db.run(
        `INSERT INTO messages (id, account_id, website_id, conversation_id, role, content, seq, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), scope.accountId, scope.websiteId, scope.conversationId,
        entry.role, entry.content, seq, JSON.stringify(entry.metadata ?? {}), now,
      );
    }

    const first = db.get<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY seq ASC LIMIT 1",
      scope.conversationId,
    );
    const summary = (first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);

    db.run(
      `UPDATE conversations
          SET message_count = message_count + ?, updated_at = ?, last_activity_at = ?,
              status = 'active', is_read = 0, summary = ?,
              visitor_name  = CASE WHEN ? <> '' THEN ? ELSE visitor_name END,
              visitor_email = CASE WHEN ? <> '' THEN ? ELSE visitor_email END,
              visitor_phone = CASE WHEN ? <> '' THEN ? ELSE visitor_phone END
        WHERE id = ? AND website_id = ? AND account_id = ?`,
      entries.length, now, now, summary,
      visitor?.name ?? '', visitor?.name ?? '',
      visitor?.email ?? '', visitor?.email ?? '',
      visitor?.phone ?? '', visitor?.phone ?? '',
      scope.conversationId, scope.websiteId, scope.accountId,
    );
  });
}

export function getHistory(
  accountId: string,
  websiteId: string,
  conversationId: string,
  limit = 20,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const rows = db.all<{ role: string; content: string }>(
    `SELECT m.role, m.content FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ? AND c.website_id = ? AND c.account_id = ?
        AND m.role IN ('user','assistant')
      ORDER BY m.seq DESC LIMIT ?`,
    conversationId, websiteId, accountId, limit,
  );
  return rows.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
}

export function getHistoryBySession(
  accountId: string,
  websiteId: string,
  sessionKey: string,
  limit = 20,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conv = db.get<{ id: string }>(
    'SELECT id FROM conversations WHERE website_id = ? AND account_id = ? AND session_key = ?',
    websiteId, accountId, sessionKey,
  );
  if (!conv) return [];
  return getHistory(accountId, websiteId, conv.id, limit);
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

export function listConversations(
  accountId: string,
  websiteId: string,
  filter: ConversationFilter = {},
): ConversationRow[] {
  const where = ['website_id = ?', 'account_id = ?'];
  const params: unknown[] = [websiteId, accountId];
  if (filter.status && filter.status !== 'all') {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.source && filter.source !== 'all') {
    where.push('source = ?');
    params.push(filter.source);
  }
  if (filter.formId) {
    where.push('form_id = ?');
    params.push(filter.formId);
  }
  if (filter.search) {
    where.push('(visitor_name LIKE ? OR visitor_email LIKE ? OR summary LIKE ?)');
    const like = '%' + filter.search.replace(/[%_]/g, '') + '%';
    params.push(like, like, like);
  }
  if (filter.dateFrom) {
    where.push('created_at >= ?');
    params.push(filter.dateFrom + ' 00:00:00');
  }
  if (filter.dateTo) {
    where.push('created_at <= ?');
    params.push(filter.dateTo + ' 23:59:59');
  }
  params.push(Math.min(filter.limit ?? 50, 200), filter.offset ?? 0);
  return db.all<ConversationRow>(
    `SELECT * FROM conversations WHERE ${where.join(' AND ')}
      ORDER BY last_activity_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export function countConversations(accountId: string, websiteId: string, filter: ConversationFilter = {}): number {
  const where = ['website_id = ?', 'account_id = ?'];
  const params: unknown[] = [websiteId, accountId];
  if (filter.status && filter.status !== 'all') {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.source && filter.source !== 'all') {
    where.push('source = ?');
    params.push(filter.source);
  }
  return db.scalar<number>(
    `SELECT COUNT(*) AS c FROM conversations WHERE ${where.join(' AND ')}`, ...params,
  ) ?? 0;
}

export function getConversation(accountId: string, websiteId: string, id: string): ConversationRow {
  const row = db.get<ConversationRow>(
    'SELECT * FROM conversations WHERE id = ? AND website_id = ? AND account_id = ?',
    id, websiteId, accountId,
  );
  if (!row) throw notFound('Conversation not found.');
  return row;
}

export function getTranscript(accountId: string, websiteId: string, id: string): MessageRow[] {
  getConversation(accountId, websiteId, id);
  return db.all<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC',
    id,
  );
}

export function setConversationStatus(
  accountId: string,
  websiteId: string,
  id: string,
  status: 'active' | 'completed' | 'archived',
): void {
  getConversation(accountId, websiteId, id);
  db.run(
    'UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND website_id = ? AND account_id = ?',
    status, nowIso(), id, websiteId, accountId,
  );
}

export function markRead(accountId: string, websiteId: string, id: string, isRead = 1): void {
  getConversation(accountId, websiteId, id);
  db.run(
    'UPDATE conversations SET is_read = ? WHERE id = ? AND website_id = ? AND account_id = ?',
    isRead, id, websiteId, accountId,
  );
}

export function deleteConversation(accountId: string, websiteId: string, id: string): void {
  getConversation(accountId, websiteId, id);
  db.run(
    'DELETE FROM conversations WHERE id = ? AND website_id = ? AND account_id = ?',
    id, websiteId, accountId,
  );
}

/** Moves conversations idle beyond the timeout to 'completed'. */
export function completeInactiveConversations(websiteId: string, timeoutMinutes: number): number {
  const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const res = db.run(
    "UPDATE conversations SET status = 'completed', updated_at = ? WHERE website_id = ? AND status = 'active' AND last_activity_at < ?",
    nowIso(), websiteId, cutoff,
  );
  return res.changes;
}
