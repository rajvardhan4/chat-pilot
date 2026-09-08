/**
 * Knowledge Base: sources, documents, ingestion.
 *
 * Every read and write is scoped by (account_id, website_id). There is no
 * function in this module that can reach a document without both.
 */
import { createHash } from 'node:crypto';
import { cascadeDeleteKnowledgeSource, col, nowIso, withTransaction } from '../db/mongo.ts';
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

type SourceDoc = Omit<KnowledgeSourceRow, 'id'> & { _id: string };
type DocumentDoc = Omit<KnowledgeDocumentRow, 'id'> & { _id: string };

function toSourceRow(d: SourceDoc): KnowledgeSourceRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}
function toDocumentRow(d: DocumentDoc): KnowledgeDocumentRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

/** Escapes a string for safe use inside a MongoDB $regex. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export async function listSources(
  accountId: string,
  websiteId: string,
  type?: SourceType,
): Promise<KnowledgeSourceRow[]> {
  const filter: Record<string, unknown> = { website_id: websiteId, account_id: accountId };
  if (type) filter.type = type;
  const docs = await col<SourceDoc>('knowledge_sources').find(filter).sort({ created_at: -1 }).toArray();
  return docs.map(toSourceRow);
}

export async function getSource(accountId: string, websiteId: string, sourceId: string): Promise<KnowledgeSourceRow> {
  const row = await col<SourceDoc>('knowledge_sources').findOne({
    _id: sourceId as never, website_id: websiteId, account_id: accountId,
  });
  if (!row) throw notFound('Knowledge source not found.');
  return toSourceRow(row);
}

async function createSource(
  accountId: string,
  websiteId: string,
  type: SourceType,
  name: string,
  config: unknown,
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await col<SourceDoc>('knowledge_sources').insertOne({
    _id: id,
    account_id: accountId,
    website_id: websiteId,
    type,
    name: name.trim().slice(0, 200),
    config: JSON.stringify(config ?? {}),
    status: 'pending',
    error_message: '',
    last_sync_at: null,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function deleteSource(
  accountId: string,
  websiteId: string,
  sourceId: string,
  actorId: string,
): Promise<void> {
  await getSource(accountId, websiteId, sourceId);
  await cascadeDeleteKnowledgeSource(sourceId, websiteId, accountId);
  await audit({
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

export async function listDocuments(
  accountId: string,
  websiteId: string,
  filter: DocumentFilter = {},
): Promise<KnowledgeDocumentRow[]> {
  const query: Record<string, unknown> = { website_id: websiteId, account_id: accountId };
  if (filter.sourceId) query.source_id = filter.sourceId;
  if (filter.sourceType) query.source_type = filter.sourceType;
  if (filter.status) query.status = filter.status;
  if (filter.search) {
    const pattern = escapeRegex(filter.search);
    query.$or = [
      { title: { $regex: pattern, $options: 'i' } },
      { content: { $regex: pattern, $options: 'i' } },
    ];
  }
  const docs = await col<DocumentDoc>('knowledge_documents')
    .find(query)
    .sort({ created_at: -1 })
    .skip(filter.offset ?? 0)
    .limit(Math.min(filter.limit ?? 100, 500))
    .toArray();
  return docs.map(toDocumentRow);
}

export async function getDocument(accountId: string, websiteId: string, docId: string): Promise<KnowledgeDocumentRow> {
  const row = await col<DocumentDoc>('knowledge_documents').findOne({
    _id: docId as never, website_id: websiteId, account_id: accountId,
  });
  if (!row) throw notFound('Document not found.');
  return toDocumentRow(row);
}

export async function setDocumentStatus(
  accountId: string,
  websiteId: string,
  docId: string,
  status: 'enabled' | 'disabled',
): Promise<void> {
  await getDocument(accountId, websiteId, docId);
  await col('knowledge_documents').updateOne(
    { _id: docId as never, website_id: websiteId, account_id: accountId },
    { $set: { status, updated_at: nowIso() } },
  );
}

export async function deleteDocument(accountId: string, websiteId: string, docId: string): Promise<void> {
  await getDocument(accountId, websiteId, docId);
  await col('knowledge_documents').deleteOne({ _id: docId as never, website_id: websiteId, account_id: accountId });
}

export async function countDocuments(accountId: string, websiteId: string): Promise<number> {
  return col('knowledge_documents').countDocuments({ website_id: websiteId, account_id: accountId });
}

async function enforceDocumentQuota(accountId: string, websiteId: string, adding: number): Promise<void> {
  const limit = await planLimitFor(accountId, 'max_documents');
  if (limit <= 0) return;
  if ((await countDocuments(accountId, websiteId)) + adding > limit) {
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

async function replaceDocuments(
  accountId: string,
  websiteId: string,
  sourceId: string,
  sourceType: SourceType,
  docs: DocumentInput[],
): Promise<number> {
  const now = nowIso();
  return withTransaction(async (session) => {
    await col('knowledge_documents').deleteMany(
      { source_id: sourceId, website_id: websiteId, account_id: accountId },
      { session },
    );
    let inserted = 0;
    for (const doc of docs) {
      const content = cleanText(doc.content);
      if (!content) continue;
      await col<DocumentDoc>('knowledge_documents').insertOne(
        {
          _id: newId(),
          account_id: accountId,
          website_id: websiteId,
          source_id: sourceId,
          source_type: sourceType,
          title: (doc.title || 'Untitled').slice(0, 250),
          content,
          source_url: doc.sourceUrl ?? '',
          category: doc.category || classifyDocument(doc.title, content, doc.sourceUrl ?? ''),
          metadata: JSON.stringify(doc.metadata ?? {}),
          status: 'enabled',
          word_count: countWords(content),
          checksum: checksum(content),
          created_at: now,
          updated_at: now,
        },
        { session },
      );
      inserted += 1;
    }
    return inserted;
  });
}

async function finishSource(sourceId: string, ok: boolean, error = ''): Promise<void> {
  await col('knowledge_sources').updateOne(
    { _id: sourceId as never },
    { $set: { status: ok ? 'completed' : 'failed', error_message: error.slice(0, 500), last_sync_at: nowIso(), updated_at: nowIso() } },
  );
}

/* ------------------------------------------------------ manual knowledge -- */

export async function saveManualKnowledge(
  accountId: string,
  websiteId: string,
  input: { sourceId?: string; title: string; content: string; category?: string },
  actorId: string,
): Promise<KnowledgeSourceRow> {
  await getWebsiteForAccount(accountId, websiteId);
  const title = input.title.trim();
  const content = cleanText(input.content);
  if (!title) throw validationFailed('Give this knowledge entry a title.', { title: 'A title is required.' });
  if (!content) throw validationFailed('Add some content.', { content: 'Content is required.' });

  let sourceId = input.sourceId;
  if (sourceId) {
    await getSource(accountId, websiteId, sourceId);
    await col('knowledge_sources').updateOne(
      { _id: sourceId as never },
      { $set: { name: title, config: JSON.stringify({ category: input.category ?? '' }), updated_at: nowIso() } },
    );
  } else {
    await enforceDocumentQuota(accountId, websiteId, 1);
    sourceId = await createSource(accountId, websiteId, 'manual', title, { category: input.category ?? '' });
  }

  await replaceDocuments(accountId, websiteId, sourceId, 'manual', [
    { title, content, sourceUrl: 'manual://' + sourceId, category: input.category },
  ]);
  await finishSource(sourceId, true);

  await audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.manual_saved', targetType: 'knowledge_source', targetId: sourceId,
  });
  return getSource(accountId, websiteId, sourceId);
}

/* ------------------------------------------------------------------ faq -- */

export async function saveFaq(
  accountId: string,
  websiteId: string,
  input: { sourceId?: string; question: string; answer: string; category?: string },
  actorId: string,
): Promise<KnowledgeSourceRow> {
  await getWebsiteForAccount(accountId, websiteId);
  const question = input.question.trim();
  const answer = cleanText(input.answer);
  if (!question) throw validationFailed('Enter the question.', { question: 'A question is required.' });
  if (!answer) throw validationFailed('Enter the answer.', { answer: 'An answer is required.' });

  let sourceId = input.sourceId;
  if (sourceId) {
    await getSource(accountId, websiteId, sourceId);
    await col('knowledge_sources').updateOne(
      { _id: sourceId as never },
      {
        $set: {
          name: question.slice(0, 200),
          config: JSON.stringify({ question, answer, category: input.category ?? '' }),
          updated_at: nowIso(),
        },
      },
    );
  } else {
    await enforceDocumentQuota(accountId, websiteId, 1);
    sourceId = await createSource(accountId, websiteId, 'faq', question.slice(0, 200), {
      question, answer, category: input.category ?? '',
    });
  }

  // FAQ documents keep the Q/A shape so retrieval can match the question text.
  await replaceDocuments(accountId, websiteId, sourceId, 'faq', [
    {
      title: question.slice(0, 250),
      content: 'Question: ' + question + '\nAnswer: ' + answer,
      sourceUrl: 'faq://' + sourceId,
      category: 'FAQ',
      metadata: { question, answer },
    },
  ]);
  await finishSource(sourceId, true);

  await audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'knowledge.faq_saved', targetType: 'knowledge_source', targetId: sourceId,
  });
  return getSource(accountId, websiteId, sourceId);
}

/* -------------------------------------------------------------- uploads -- */

export async function saveUploadedDocument(
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
): Promise<KnowledgeSourceRow> {
  await getWebsiteForAccount(accountId, websiteId);
  await enforceDocumentQuota(accountId, websiteId, input.documents.length);

  const sourceId = await createSource(accountId, websiteId, 'file', input.originalName, {
    original_name: input.originalName,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
  });

  await col('uploaded_files').insertOne({
    _id: newId(),
    account_id: accountId,
    website_id: websiteId,
    source_id: sourceId,
    original_name: input.originalName,
    stored_path: input.storedPath,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    checksum: '',
    created_at: nowIso(),
  });

  const inserted = await replaceDocuments(
    accountId, websiteId, sourceId, 'file',
    input.documents.map((d) => ({ title: d.title, content: d.content, sourceUrl: 'file://' + input.originalName })),
  );
  await finishSource(sourceId, inserted > 0, inserted > 0 ? '' : 'No readable text was found in this file.');

  await audit({
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
  const site = await getWebsiteForAccount(accountId, websiteId);
  const startUrl = (input.startUrl || site.url || 'https://' + site.primary_domain).trim();
  const maxPages = Math.min(Math.max(input.maxPages ?? 15, 1), 100);

  let sourceId = input.sourceId;
  if (sourceId) {
    await getSource(accountId, websiteId, sourceId);
  } else {
    sourceId = await createSource(accountId, websiteId, 'website', site.primary_domain, {
      start_url: startUrl,
      max_pages: maxPages,
    });
  }
  await col('knowledge_sources').updateOne({ _id: sourceId as never }, { $set: { status: 'processing', updated_at: nowIso() } });

  try {
    const result = await crawlSite({
      startUrl,
      maxPages,
      restrictToHost: site.primary_domain,
      allowLocal: isLocalHost(site.primary_domain),
    });

    if (!result.pages.length) {
      await finishSource(sourceId, false, 'No readable pages could be imported from this website.');
      return {
        sourceId, pagesImported: 0, pagesVisited: result.visited,
        skipped: result.skipped, errors: result.errors,
      };
    }

    await enforceDocumentQuota(accountId, websiteId, result.pages.length);
    const inserted = await replaceDocuments(
      accountId, websiteId, sourceId, 'website',
      result.pages.map((p) => ({
        title: p.title,
        content: p.content,
        sourceUrl: p.url,
        metadata: { word_count: p.wordCount },
      })),
    );
    await finishSource(sourceId, true);

    await audit({
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
    await finishSource(sourceId, false, message);
    throw err;
  }
}

/** Ingests pre-fetched pages. Used by tests and by any future async worker. */
export async function importPages(
  accountId: string,
  websiteId: string,
  sourceName: string,
  pages: Array<{ url: string; title: string; content: string }>,
): Promise<ScanSummary> {
  await getWebsiteForAccount(accountId, websiteId);
  await enforceDocumentQuota(accountId, websiteId, pages.length);
  const sourceId = await createSource(accountId, websiteId, 'website', sourceName, { imported: true });
  const inserted = await replaceDocuments(
    accountId, websiteId, sourceId, 'website',
    pages.map((p) => ({ title: p.title, content: p.content, sourceUrl: p.url })),
  );
  await finishSource(sourceId, inserted > 0);
  return { sourceId, pagesImported: inserted, pagesVisited: pages.length, skipped: 0, errors: [] };
}

/** Counts by source type, for the Knowledge Base dashboard cards. */
export async function knowledgeStats(accountId: string, websiteId: string) {
  const rows = await col('knowledge_documents')
    .aggregate<{ _id: string; c: number; enabled: number }>([
      { $match: { website_id: websiteId, account_id: accountId } },
      {
        $group: {
          _id: '$source_type',
          c: { $sum: 1 },
          enabled: { $sum: { $cond: [{ $eq: ['$status', 'enabled'] }, 1, 0] } },
        },
      },
    ])
    .toArray();

  const base = {
    faq: { total: 0, enabled: 0 },
    manual: { total: 0, enabled: 0 },
    file: { total: 0, enabled: 0 },
    website: { total: 0, enabled: 0 },
  } as Record<string, { total: number; enabled: number }>;
  for (const r of rows) {
    base[r._id] = { total: Number(r.c), enabled: Number(r.enabled ?? 0) };
  }

  const totalWordsAgg = await col('knowledge_documents')
    .aggregate<{ w: number }>([
      { $match: { website_id: websiteId, account_id: accountId } },
      { $group: { _id: null, w: { $sum: '$word_count' } } },
    ])
    .toArray();
  const totalWords = totalWordsAgg[0]?.w ?? 0;

  return { byType: base, totalDocuments: await countDocuments(accountId, websiteId), totalWords };
}
