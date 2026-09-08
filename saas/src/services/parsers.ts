/**
 * Document text extraction.
 *
 * Ports the plugin's parser behaviour (txt / docx / pdf) with the same
 * pragmatic limits: PDFs whose text is stored as FlateDecode or plain text
 * streams extract cleanly; scanned/image-only PDFs cannot and are reported as
 * such rather than silently producing an empty document.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';

export interface ParsedDocument {
  title: string;
  content: string;
  sourceUrl: string;
  wordCount: number;
}

export function cleanText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’',
    lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©',
    reg: '®', trade: '™', deg: '°', eacute: 'é',
  };
  return String(input ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

/* ------------------------------------------------------------ plain text -- */

export function parsePlainText(buffer: Buffer, filename: string): ParsedDocument[] {
  const content = cleanText(buffer.toString('utf8'));
  if (!content) return [];
  return [{ title: filename, content, sourceUrl: 'file://' + filename, wordCount: countWords(content) }];
}

/* ------------------------------------------------------------------ zip -- */

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Minimal ZIP reader (stored + deflate) so .docx can be opened without a
 * third-party dependency. Reads the End Of Central Directory record, then each
 * central directory entry, then the local header for the data offset.
 */
function readZip(buffer: Buffer): ZipEntry[] {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66_000; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < entryCount; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const lNameLen = buffer.readUInt16LE(localOffset + 26);
      const lExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      try {
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
        entries.push({ name, data });
      } catch {
        /* skip unreadable entry */
      }
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ----------------------------------------------------------------- docx -- */

export function parseDocx(buffer: Buffer, filename: string): ParsedDocument[] {
  const entries = readZip(buffer);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) return [];

  const xml = doc.data.toString('utf8');
  const text = xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<[^>]+>/g, '');

  const content = cleanText(decodeEntities(text));
  if (!content) return [];
  return [{ title: filename, content, sourceUrl: 'file://' + filename, wordCount: countWords(content) }];
}

/* ------------------------------------------------------------------ pdf -- */

function pdfDecodeTextOperators(chunk: string): string {
  let out = '';
  // Tj / TJ text-showing operators carry the visible strings.
  const re = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(chunk)) !== null) {
    const token = match[0] as string;
    if (token.startsWith('(')) {
      out +=
        token
          .slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\n')
          .replace(/\\t/g, ' ')
          .replace(/\\([()\\])/g, '$1')
          .replace(/\\(\d{1,3})/g, (_m, oct: string) => String.fromCharCode(parseInt(oct, 8))) + ' ';
    } else if (match[1]) {
      const hex = match[1].replace(/\s+/g, '');
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      out += s + ' ';
    }
  }
  return out;
}

export function parsePdf(buffer: Buffer, filename: string): ParsedDocument[] {
  const latin = buffer.toString('latin1');
  let extracted = '';

  const streamRe = /stream\r?\n?/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end === -1) break;
    streamRe.lastIndex = end + 9;

    const header = latin.slice(Math.max(0, m.index - 250), m.index);
    const raw = Buffer.from(latin.slice(start, end), 'latin1');

    let body = '';
    if (/FlateDecode/.test(header)) {
      try {
        body = inflateSync(raw).toString('latin1');
      } catch {
        try {
          body = inflateRawSync(raw).toString('latin1');
        } catch {
          continue;
        }
      }
    } else if (/\/Filter/.test(header)) {
      continue; // DCTDecode / other binary filters carry no extractable text
    } else {
      body = raw.toString('latin1');
    }

    if (/(TJ|Tj|BT)/.test(body)) extracted += pdfDecodeTextOperators(body) + '\n';
  }

  const content = cleanText(decodeEntities(extracted));
  // Returning nothing is deliberate: indexing a "could not read this" note as a
  // knowledge document would let it surface in retrieval and be quoted at a
  // visitor. The caller reports the failure to the customer instead.
  if (!content) return [];
  return [{ title: filename, content, sourceUrl: 'file://' + filename, wordCount: countWords(content) }];
}

/* ------------------------------------------------------------ dispatch -- */

export const ALLOWED_UPLOAD_TYPES: Record<string, { ext: string; mimes: string[] }> = {
  txt: { ext: 'txt', mimes: ['text/plain'] },
  md: { ext: 'md', mimes: ['text/markdown', 'text/plain'] },
  csv: { ext: 'csv', mimes: ['text/csv', 'text/plain', 'application/csv'] },
  pdf: { ext: 'pdf', mimes: ['application/pdf'] },
  docx: {
    ext: 'docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
};

/** Magic-byte check so a renamed executable cannot masquerade as a document. */
export function sniffFileType(buffer: Buffer, extension: string): string | null {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (!ALLOWED_UPLOAD_TYPES[ext]) return null;

  if (ext === 'pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-' ? 'pdf' : null;
  if (ext === 'docx') return buffer.subarray(0, 2).toString('latin1') === 'PK' ? 'docx' : null;

  // Text formats: reject anything containing NUL bytes in the first 8 KB.
  const head = buffer.subarray(0, 8192);
  if (head.includes(0)) return null;
  return ext;
}

export function parseUpload(buffer: Buffer, filename: string, kind: string): ParsedDocument[] {
  switch (kind) {
    case 'pdf':
      return parsePdf(buffer, filename);
    case 'docx':
      return parseDocx(buffer, filename);
    default:
      return parsePlainText(buffer, filename);
  }
}
