import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createTenant, db, startServer, type Tenant, type TestServer } from './helpers.ts';

let server: TestServer;
let tenant: Tenant;

const portal = (path: string) => '/api/v1/portal/websites/' + tenant.websiteId + path;

async function api(path: string, payload: unknown) {
  await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/knowledge');
  return tenant.client.postJson(portal(path), payload);
}

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'kb.example.com' });
});
after(async () => {
  await server.close();
});

describe('Manual knowledge and FAQs', () => {
  it('stores a manual entry as an indexed document', async () => {
    const res = await api('/knowledge/manual', {
      title: 'Opening hours',
      content: 'We are open Monday to Friday, 8am until 6pm, and Saturday mornings until noon.',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.stats.byType.manual.total, 1);

    const doc = db.get<{ title: string; source_type: string; word_count: number; account_id: string }>(
      'SELECT title, source_type, word_count, account_id FROM knowledge_documents WHERE website_id = ?',
      tenant.websiteId,
    );
    assert.equal(doc?.source_type, 'manual');
    assert.equal(doc?.account_id, tenant.accountId);
    assert.ok((doc?.word_count ?? 0) > 5);
  });

  it('rejects an empty manual entry', async () => {
    const res = await api('/knowledge/manual', { title: 'Empty', content: '' });
    assert.equal(res.status, 422);
  });

  it('stores an FAQ in question/answer form', async () => {
    const res = await api('/knowledge/faq', {
      question: 'Do you charge for quotes?',
      answer: 'No. All quotes are free and there is no obligation.',
    });
    assert.equal(res.status, 200);

    const doc = db.get<{ content: string; source_type: string; category: string }>(
      "SELECT content, source_type, category FROM knowledge_documents WHERE source_type = 'faq' AND website_id = ?",
      tenant.websiteId,
    );
    assert.equal(doc?.source_type, 'faq');
    assert.equal(doc?.category, 'FAQ');
    assert.match(doc!.content, /^Question: Do you charge for quotes\?\nAnswer: No\./);
  });

  it('enables, disables and deletes a document', async () => {
    const doc = db.get<{ id: string }>(
      "SELECT id FROM knowledge_documents WHERE website_id = ? AND source_type = 'manual'",
      tenant.websiteId,
    );

    const disabled = await api('/knowledge/documents/' + doc!.id + '/status', { status: 'disabled' });
    assert.equal(disabled.status, 200);
    assert.equal(
      db.get<{ status: string }>('SELECT status FROM knowledge_documents WHERE id = ?', doc!.id)?.status,
      'disabled',
    );

    // A disabled document must not be retrievable.
    const search = await api('/knowledge/test-retrieval', { query: 'opening hours Monday Friday' });
    const titles = search.body.data.results.map((r: { title: string }) => r.title);
    assert.ok(!titles.includes('Opening hours'));

    await api('/knowledge/documents/' + doc!.id + '/status', { status: 'enabled' });
    const reSearch = await api('/knowledge/test-retrieval', { query: 'opening hours Monday Friday' });
    assert.ok(reSearch.body.data.results.some((r: { title: string }) => r.title === 'Opening hours'));

    const deleted = await api('/knowledge/documents/' + doc!.id + '/delete', {});
    assert.equal(deleted.status, 200);
    assert.equal(db.get('SELECT id FROM knowledge_documents WHERE id = ?', doc!.id), undefined);
  });
});

describe('Document uploads', () => {
  function upload(filename: string, content: Buffer | string, mime = '') {
    return api('/knowledge/upload', {
      filename,
      mime_type: mime,
      content_base64: Buffer.isBuffer(content)
        ? content.toString('base64')
        : Buffer.from(content, 'utf8').toString('base64'),
    });
  }

  it('imports a plain text document', async () => {
    const res = await upload(
      'services.txt',
      'Our boiler servicing package includes a full safety inspection and a written report.',
      'text/plain',
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.stats.byType.file.total, 1);
  });

  it('rejects an unsupported extension', async () => {
    const res = await upload('payload.exe', 'MZ binary content', 'application/octet-stream');
    assert.equal(res.status, 415);
    assert.match(res.body.error.message, /\.txt, \.md, \.csv, \.pdf or \.docx/);
  });

  it('rejects a file whose magic bytes do not match its extension', async () => {
    // A Windows executable renamed to .pdf.
    const fake = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const res = await upload('malware.pdf', fake, 'application/pdf');
    assert.equal(res.status, 415);
    assert.match(res.body.error.message, /does not look like a valid PDF/i);
  });

  it('rejects a declared MIME type that contradicts the extension', async () => {
    const res = await upload('notes.txt', 'harmless text', 'application/pdf');
    assert.equal(res.status, 415);
  });

  it('rejects a file above the size limit', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41); // 11 MB of "A"
    const res = await upload('huge.txt', big, 'text/plain');
    assert.equal(res.status, 413);
  });

  it('extracts text from a real DOCX container', async () => {
    const xml =
      '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>' +
      'Emergency boiler repair is available within four hours across the county.' +
      '</w:t></w:r></w:p></w:body></w:document>';
    const docx = buildZip([{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }]);

    const res = await upload(
      'handbook.docx',
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    assert.equal(res.status, 200);

    const doc = db.get<{ content: string }>(
      "SELECT content FROM knowledge_documents WHERE title = 'handbook.docx'",
    );
    assert.match(doc!.content, /Emergency boiler repair is available within four hours/);
  });

  it('refuses a scanned PDF instead of indexing an unreadable placeholder', async () => {
    const pdf = Buffer.from('%PDF-1.4 1 0 obj << /Type /Catalog >> endobj trailer %%EOF', 'latin1');
    const res = await upload('scanned.pdf', pdf, 'application/pdf');
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /scanned or image-only/i);

    // Nothing must be indexed: a "could not read this" note would otherwise be
    // retrievable and could be quoted back at a visitor.
    assert.equal(db.get("SELECT id FROM knowledge_documents WHERE title = 'scanned.pdf'"), undefined);
  });

  it('stores uploads under an opaque per-tenant path', () => {
    const file = db.get<{ stored_path: string; original_name: string }>(
      "SELECT stored_path, original_name FROM uploaded_files WHERE original_name = 'services.txt'",
    );
    assert.ok(file);
    assert.ok(file!.stored_path.includes(tenant.accountId));
    assert.ok(file!.stored_path.includes(tenant.websiteId));
    // The visitor-supplied filename must not become the path.
    assert.ok(!file!.stored_path.endsWith('services.txt'));
  });
});

describe('Website scanner', () => {
  it('refuses to crawl a host that is not the registered domain', async () => {
    const res = await api('/knowledge/scan', { start_url: 'https://someone-else.example.org', max_pages: 2 });
    // The crawler is host-restricted, so nothing is importable.
    assert.equal(res.status, 200);
    assert.equal(res.body.data.summary.pagesImported, 0);
  });

  it('imports pre-fetched pages through the same ingestion path', async () => {
    const { importPages } = await import('../src/services/knowledge.ts');
    const summary = importPages(tenant.accountId, tenant.websiteId, 'kb.example.com', [
      {
        url: 'https://kb.example.com/about',
        title: 'About our company',
        content: 'We have served the county since 1998 with a team of twelve engineers.',
      },
      {
        url: 'https://kb.example.com/contact',
        title: 'Contact us',
        content: 'Call 555-0188 or email hello@kb.example.com. Our office is on Bridge Street.',
      },
    ]);
    assert.equal(summary.pagesImported, 2);

    const categories = db.all<{ title: string; category: string }>(
      "SELECT title, category FROM knowledge_documents WHERE source_type = 'website'",
    );
    assert.equal(categories.find((c) => c.title === 'About our company')?.category, 'Company');
    assert.equal(categories.find((c) => c.title === 'Contact us')?.category, 'Contact');
  });
});

describe('Knowledge helpers', () => {
  it('extracts readable text from HTML and drops chrome', async () => {
    const { htmlToText, extractTitle, extractLinks, isCrawlable } = await import('../src/services/crawler.ts');
    const html =
      '<html><head><title>Acme &amp; Co</title><style>.x{color:red}</style></head>' +
      '<body><nav>Home About</nav><script>alert(1)</script>' +
      '<h1>Welcome</h1><p>We fix pipes.</p><footer>Copyright</footer></body></html>';

    assert.equal(extractTitle(html), 'Acme & Co');
    const text = htmlToText(html);
    assert.match(text, /Welcome/);
    assert.match(text, /We fix pipes\./);
    assert.doesNotMatch(text, /alert\(1\)/);
    assert.doesNotMatch(text, /color:red/);
    assert.doesNotMatch(text, /Copyright/);

    assert.deepEqual(
      extractLinks('<a href="/services">S</a><a href="mailto:x@y.z">M</a>', 'https://kb.example.com/'),
      ['https://kb.example.com/services'],
    );
    assert.equal(isCrawlable('https://kb.example.com/a', 'kb.example.com', false), true);
    assert.equal(isCrawlable('https://evil.example.net/a', 'kb.example.com', false), false);
    assert.equal(isCrawlable('file:///etc/passwd', 'kb.example.com', false), false);
    assert.equal(isCrawlable('http://127.0.0.1/a', '127.0.0.1', false), false);
  });

  it('classifies documents by structural intent, not industry words', async () => {
    const { classifyDocument } = await import('../src/services/knowledge.ts');
    assert.equal(classifyDocument('Contact us', 'Call us today', '/contact'), 'Contact');
    assert.equal(classifyDocument('Areas we serve', 'Our service area covers...', '/areas'), 'Locations');
    assert.equal(classifyDocument('About the team', 'Founded in 1998', '/about'), 'Company');
    assert.equal(classifyDocument('Pricing', 'Our rates start at', '/pricing'), 'Pricing');
    assert.equal(classifyDocument('Boiler installation', 'We install boilers', '/boilers'), 'Services');
  });
});

/** Builds a minimal ZIP archive (deflate) so the DOCX parser can be tested. */
function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
