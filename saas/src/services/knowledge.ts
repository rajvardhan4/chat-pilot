/**
 * Knowledge Base: sources, documents, ingestion.
 *
 * Every read and write is scoped by (account_id, website_id). There is no
 * function in this module that can reach a document without both.
 */
import { createHash } from 'node:crypto';
import { db, nowIso } from '../db/index.ts';
import { AppError, notFound, validationFailed } from '../core/errors.ts';
import { newId } from '../core/crypto.ts';
import { audit } from './audit.ts';
import { getWebsiteForAccount, planLimitFor } from './websites.ts';
import { cleanText, countWords } from './parsers.ts';
import { crawlSite } from './crawler.ts';
import { isLocalHost } from '../core/domain.ts';

export type SourceType = 'website' | 'manual' | 'file' | 'faq';

export interface KnowledgeSourceRow {
  id: string;
  account_id: string;
  website_id: string;
  type: SourceType;
  name: string;
  config: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentRow {
  id: string;
  account_id: string;
  website_id: string;
  source_id: string;
  source_type: SourceType;
  title: string;
  content: string;
  source_url: string;
  category: string;
  metadata: string;
  status: 'enabled' | 'disabled';
  word_count: number;
  checksum: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------ retrieval -- */

/**
 * Business-agnostic category classifier. Only structural intents (contact,
 * locations, company, services) - no industry vocabulary.
 */
export function classifyDocument(title: string, content: string, url = ''): string {
  const t = title.toLowerCase();
  const u = url.toLowerCase();
  const head = content.slice(0, 600).toLowerCase();

  if (/\b(contact|get in touch|reach us|phone|email|enquir|inquir)\b/.test(t + ' ' + u) ||
      /\bcontact us\b/.test(head)) {
    return 'Contact';
  }
  if (/\b(location|locations|areas?|service area|cities|coverage|directions|where)\b/.test(t + ' ' + u) ||
      /\bservice area\b/.test(head)) {
    return 'Locations';
  }
  if (/\b(about|who we are|our story|history|team|mission|values|overview|home)\b/.test(t + ' ' + u)) {
    return 'Company';
  }
  if (/\b(faq|frequently asked|questions)\b/.test(t + ' ' + u)) {
    return 'FAQ';
  }
  if (/\b(price|pricing|rates?|cost|packages?|plans?)\b/.test(t + ' ' + u)) {
    return 'Pricing';
  }
  return 'Services';
}

function checksum(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

/* -------------------------------------------------------------- sources -- */

export function listSources(accountId: string, websiteId: string, type?: SourceType): KnowledgeSourceRow[] {
  const params: unknown[] = [websiteId, accountId];
  let sql = 'SELECT * FROM knowledge_sources WHERE website_id = ? AND account_id = ?';
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  sql += ' ORDER BY created_at DESC';
  return db.all<KnowledgeSourceRow>(sql, ...params);
}

export function getSource(accountId: string, websiteId: string, sourceId: string): KnowledgeSourceRow {
  const row = db.get<KnowledgeSourceRow>(
    'SELECT * FROM knowledge_sources WHERE id = ? AND website_id = ? AND account_id = ?',
    sourceId, websiteId, accountId,
  );
  if (!row) throw notFound('Knowledge source not found.');
  return row;
}

function createSource(
  accountId: string,
  websiteId: string,
  type: SourceType,
  name: string,
  config: unknown,
): string {
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO knowledge_sources (id, account_id, website_id, type, name, config, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, accountId, websiteId, type, name.trim().slice(0, 200), JSON.stringify(config ?? {}), now, now,
  );
  return id;
}

export function deleteSource(accountId: string, websiteId: string, sourceId: string, actorId: string): void {
  getSource(accountId, websiteId, sourceId);
  db.run(
    'DELETE FROM knowledge_sources WHERE id = ? AND website_id = ? AND account_id = ?',
    sourceId, websiteId, accountId,
  );
  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.source_deleted', targetType: 'knowledge_source', targetId: sourceId,
  });
}

/* ------------------------------------------------------------ documents -- */

export interface DocumentFilter {
  sourceId?: string;
  sourceType?: SourceType;
  status?: 'enabled' | 'disabled';
  search?: string;
  limit?: number;
  offset?: number;
}

export function listDocuments(
  accountId: string,
  websiteId: string,
  filter: DocumentFilter = {},
): KnowledgeDocumentRow[] {
  const where = ['d.website_id = ?', 'd.account_id = ?'];
  const params: unknown[] = [websiteId, accountId];
  if (filter.sourceId) {
    where.push('d.source_id = ?');
    params.push(filter.sourceId);
  }
  if (filter.sourceType) {
    where.push('d.source_type = ?');
    params.push(filter.sourceType);
  }
  if (filter.status) {
    where.push('d.status = ?');
    params.push(filter.status);
  }
  if (filter.search) {
    where.push('(d.title LIKE ? OR d.content LIKE ?)');
    const like = '%' + filter.search.replace(/[%_]/g, '') + '%';
    params.push(like, like);
  }
  params.push(Math.min(filter.limit ?? 100, 500), filter.offset ?? 0);
  return db.all<KnowledgeDocumentRow>(
    `SELECT d.* FROM knowledge_documents d
      WHERE ${where.join(' AND ')}
      ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export function getDocument(accountId: string, websiteId: string, docId: string): KnowledgeDocumentRow {
  const row = db.get<KnowledgeDocumentRow>(
    'SELECT * FROM knowledge_documents WHERE id = ? AND website_id = ? AND account_id = ?',
    docId, websiteId, accountId,
  );
  if (!row) throw notFound('Document not found.');
  return row;
}

export function setDocumentStatus(
  accountId: string,
  websiteId: string,
  docId: string,
  status: 'enabled' | 'disabled',
): void {
  getDocument(accountId, websiteId, docId);
  db.run(
    'UPDATE knowledge_documents SET status = ?, updated_at = ? WHERE id = ? AND website_id = ? AND account_id = ?',
    status, nowIso(), docId, websiteId, accountId,
  );
}

export function deleteDocument(accountId: string, websiteId: string, docId: string): void {
  getDocument(accountId, websiteId, docId);
  db.run(
    'DELETE FROM knowledge_documents WHERE id = ? AND website_id = ? AND account_id = ?',
    docId, websiteId, accountId,
  );
}

export function countDocuments(accountId: string, websiteId: string): number {
  return (
    db.scalar<number>(
      'SELECT COUNT(*) AS c FROM knowledge_documents WHERE website_id = ? AND account_id = ?',
      websiteId, accountId,
    ) ?? 0
  );
}

function enforceDocumentQuota(accountId: string, websiteId: string, adding: number): void {
  const limit = planLimitFor(accountId, 'max_documents');
  if (limit <= 0) return;
  if (countDocuments(accountId, websiteId) + adding > limit) {
    throw new AppError(
      'usage_limit_reached',
      'Your plan allows ' + limit + ' knowledge documents per website. Remove some, or upgrade your plan.',
    );
  }
}

interface DocumentInput {
  title: string;
  content: string;
  sourceUrl?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

function replaceDocuments(
  accountId: string,
  websiteId: string,
  sourceId: string,
  sourceType: SourceType,
  docs: DocumentInput[],
): number {
  const now = nowIso();
  return db.tx(() => {
    db.run(
      'DELETE FROM knowledge_documents WHERE source_id = ? AND website_id = ? AND account_id = ?',
      sourceId, websiteId, accountId,
    );
    let inserted = 0;
    for (const doc of docs) {
      const content = cleanText(doc.content);
      if (!content) continue;
      db.run(
        `INSERT INTO knowledge_documents
           (id, account_id, website_id, source_id, source_type, title, content, source_url,
            category, metadata, status, word_count, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?, ?)`,
        newId(), accountId, websiteId, sourceId, sourceType,
        (doc.title || 'Untitled').slice(0, 250), content, doc.sourceUrl ?? '',
        doc.category || classifyDocument(doc.title, content, doc.sourceUrl ?? ''),
        JSON.stringify(doc.metadata ?? {}), countWords(content), checksum(content), now, now,
      );
      inserted += 1;
    }
    return inserted;
  });
}

function finishSource(sourceId: string, ok: boolean, error = ''): void {
  db.run(
    `UPDATE knowledge_sources SET status = ?, error_message = ?, last_sync_at = ?, updated_at = ? WHERE id = ?`,
    ok ? 'completed' : 'failed', error.slice(0, 500), nowIso(), nowIso(), sourceId,
  );
}

/* ------------------------------------------------------ manual knowledge -- */

export function saveManualKnowledge(
  accountId: string,
  websiteId: string,
  input: { sourceId?: string; title: string; content: string; category?: string },
  actorId: string,
): KnowledgeSourceRow {
  getWebsiteForAccount(accountId, websiteId);
  const title = input.title.trim();
  const content = cleanText(input.content);
  if (!title) throw validationFailed('Give this knowledge entry a title.', { title: 'A title is required.' });
  if (!content) throw validationFailed('Add some content.', { content: 'Content is required.' });

  let sourceId = input.sourceId;
  if (sourceId) {
    getSource(accountId, websiteId, sourceId);
    db.run(
      'UPDATE knowledge_sources SET name = ?, config = ?, updated_at = ? WHERE id = ?',
      title, JSON.stringify({ category: input.category ?? '' }), nowIso(), sourceId,
    );
  } else {
    enforceDocumentQuota(accountId, websiteId, 1);
    sourceId = createSource(accountId, websiteId, 'manual', title, { category: input.category ?? '' });
  }

  replaceDocuments(accountId, websiteId, sourceId, 'manual', [
    { title, content, sourceUrl: 'manual://' + sourceId, category: input.category },
  ]);
  finishSource(sourceId, true);

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.manual_saved', targetType: 'knowledge_source', targetId: sourceId,
  });
  return getSource(accountId, websiteId, sourceId);
}

/* ------------------------------------------------------------------ faq -- */

export function saveFaq(
  accountId: string,
  websiteId: string,
  input: { sourceId?: string; question: string; answer: string; category?: string },
  actorId: string,
): KnowledgeSourceRow {
  getWebsiteForAccount(accountId, websiteId);
  const question = input.question.trim();
  const answer = cleanText(input.answer);
  if (!question) throw validationFailed('Enter the question.', { question: 'A question is required.' });
  if (!answer) throw validationFailed('Enter the answer.', { answer: 'An answer is required.' });

  let sourceId = input.sourceId;
  if (sourceId) {
    getSource(accountId, websiteId, sourceId);
    db.run(
      'UPDATE knowledge_sources SET name = ?, config = ?, updated_at = ? WHERE id = ?',
      question.slice(0, 200), JSON.stringify({ question, answer, category: input.category ?? '' }),
      nowIso(), sourceId,
    );
  } else {
    enforceDocumentQuota(accountId, websiteId, 1);
    sourceId = createSource(accountId, websiteId, 'faq', question.slice(0, 200), {
      question, answer, category: input.category ?? '',
    });
  }

  // FAQ documents keep the Q/A shape so retrieval can match the question text.
  replaceDocuments(accountId, websiteId, sourceId, 'faq', [
    {
      title: question.slice(0, 250),
      content: 'Question: ' + question + '\nAnswer: ' + answer,
      sourceUrl: 'faq://' + sourceId,
      category: 'FAQ',
      metadata: { question, answer },
    },
  ]);
  finishSource(sourceId, true);

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.faq_saved', targetType: 'knowledge_source', targetId: sourceId,
  });
  return getSource(accountId, websiteId, sourceId);
}

/* -------------------------------------------------------------- uploads -- */

export function saveUploadedDocument(
  accountId: string,
  websiteId: string,
  input: {
    originalName: string;
    storedPath: string;
    mimeType: string;
    sizeBytes: number;
    documents: Array<{ title: string; content: string; wordCount: number }>;
  },
  actorId: string,
): KnowledgeSourceRow {
  getWebsiteForAccount(accountId, websiteId);
  enforceDocumentQuota(accountId, websiteId, input.documents.length);

  const sourceId = createSource(accountId, websiteId, 'file', input.originalName, {
    original_name: input.originalName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
  });

  db.run(
    `INSERT INTO uploaded_files
       (id, account_id, website_id, source_id, original_name, stored_path, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(), accountId, websiteId, sourceId, input.originalName, input.storedPath,
    input.mimeType, input.sizeBytes, nowIso(),
  );

  const inserted = replaceDocuments(
    accountId, websiteId, sourceId, 'file',
    input.documents.map((d) => ({ title: d.title, content: d.content, sourceUrl: 'file://' + input.originalName })),
  );
  finishSource(sourceId, inserted > 0, inserted > 0 ? '' : 'No readable text was found in this file.');

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.file_uploaded', targetType: 'knowledge_source', targetId: sourceId,
    metadata: { name: input.originalName, bytes: input.sizeBytes, documents: inserted },
  });
  return getSource(accountId, websiteId, sourceId);
}

/* ------------------------------------------------------- website scanner -- */

export interface ScanSummary {
  sourceId: string;
  pagesImported: number;
  pagesVisited: number;
  skipped: number;
  errors: string[];
}

export async function scanWebsite(
  accountId: string,
  websiteId: string,
  input: { startUrl?: string; maxPages?: number; sourceId?: string },
  actorId: string,
): Promise<ScanSummary> {
  const site = getWebsiteForAccount(accountId, websiteId);
  const startUrl = (input.startUrl || site.url || 'https://' + site.primary_domain).trim();
  const maxPages = Math.min(Math.max(input.maxPages ?? 15, 1), 100);

  let sourceId = input.sourceId;
  if (sourceId) {
    getSource(accountId, websiteId, sourceId);
  } else {
    sourceId = createSource(accountId, websiteId, 'website', site.primary_domain, {
      start_url: startUrl,
      max_pages: maxPages,
    });
  }
  db.run("UPDATE knowledge_sources SET status = 'processing', updated_at = ? WHERE id = ?", nowIso(), sourceId);

  try {
    const result = await crawlSite({
      startUrl,
      maxPages,
      restrictToHost: site.primary_domain,
      allowLocal: isLocalHost(site.primary_domain),
    });

    if (!result.pages.length) {
      finishSource(sourceId, false, 'No readable pages could be imported from this website.');
      return {
        sourceId, pagesImported: 0, pagesVisited: result.visited,
        skipped: result.skipped, errors: result.errors,
      };
    }

    enforceDocumentQuota(accountId, websiteId, result.pages.length);
    const inserted = replaceDocuments(
      accountId, websiteId, sourceId, 'website',
      result.pages.map((p) => ({
        title: p.title,
        content: p.content,
        sourceUrl: p.url,
        metadata: { word_count: p.wordCount },
      })),
    );
    finishSource(sourceId, true);

    audit({
      accountId, websiteId, actorType: 'user', actorId,
      action: 'knowledge.website_scanned', targetType: 'knowledge_source', targetId: sourceId,
      metadata: { pages: inserted, startUrl },
    });

    return {
      sourceId, pagesImported: inserted, pagesVisited: result.visited,
      skipped: result.skipped, errors: result.errors,
    };
  } catch (err) {
    const message = err instanceof AppError ? err.publicMessage : 'The website scan failed.';
    finishSource(sourceId, false, message);
    throw err;
  }
}

/** Ingests pre-fetched pages. Used by tests and by any future async worker. */
export function importPages(
  accountId: string,
  websiteId: string,
  sourceName: string,
  pages: Array<{ url: string; title: string; content: string }>,
): ScanSummary {
  getWebsiteForAccount(accountId, websiteId);
  enforceDocumentQuota(accountId, websiteId, pages.length);
  const sourceId = createSource(accountId, websiteId, 'website', sourceName, { imported: true });
  const inserted = replaceDocuments(
    accountId, websiteId, sourceId, 'website',
    pages.map((p) => ({ title: p.title, content: p.content, sourceUrl: p.url })),
  );
  finishSource(sourceId, inserted > 0);
  return { sourceId, pagesImported: inserted, pagesVisited: pages.length, skipped: 0, errors: [] };
}

/** Counts by source type, for the Knowledge Base dashboard cards. */
export function knowledgeStats(accountId: string, websiteId: string) {
  const rows = db.all<{ source_type: string; c: number; enabled: number }>(
    `SELECT source_type,
            COUNT(*) AS c,
            SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) AS enabled
       FROM knowledge_documents
      WHERE website_id = ? AND account_id = ?
      GROUP BY source_type`,
    websiteId, accountId,
  );
  const base = {
    faq: { total: 0, enabled: 0 },
    manual: { total: 0, enabled: 0 },
    file: { total: 0, enabled: 0 },
    website: { total: 0, enabled: 0 },
  } as Record<string, { total: number; enabled: number }>;
  for (const r of rows) {
    base[r.source_type] = { total: Number(r.c), enabled: Number(r.enabled ?? 0) };
  }
  const totalWords = db.scalar<number>(
    'SELECT COALESCE(SUM(word_count), 0) AS w FROM knowledge_documents WHERE website_id = ? AND account_id = ?',
    websiteId, accountId,
  ) ?? 0;
  return { byType: base, totalDocuments: countDocuments(accountId, websiteId), totalWords };
}
