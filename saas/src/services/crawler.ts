/**
 * Website scanner.
 *
 * Fetches same-host pages, strips chrome (nav/footer/script/style), and
 * produces one knowledge document per page. SSRF-guarded: only http(s), only
 * the registered host, never private address literals unless the website
 * itself is registered on a local host.
 */
import { cleanText, countWords, decodeEntities } from './parsers.ts';
import { canonicalHost, isLocalHost, normaliseHost } from '../core/domain.ts';

export interface CrawledPage {
  url: string;
  title: string;
  content: string;
  wordCount: number;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  allowLocal: boolean;
  timeoutMs?: number;
  /** Only follow links whose host canonically equals this. */
  restrictToHost: string;
}

const STRIP_BLOCKS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'header', 'footer',
  'form', 'template', 'aside',
];

export function extractTitle(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) return decodeEntities(og[1]).trim().slice(0, 200);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t?.[1]) return decodeEntities(t[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1?.[1]) return decodeEntities(h1[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 200);
  return 'Untitled page';
}

export function htmlToText(html: string): string {
  let out = html;
  for (const tag of STRIP_BLOCKS) {
    out = out.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi'), ' ');
    out = out.replace(new RegExp('<' + tag + '\\b[^>]*\\/?>', 'gi'), ' ');
  }
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  // Preserve block structure as newlines so paragraphs stay separate.
  out = out.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<li\b[^>]*>/gi, '\n- ');
  out = out.replace(/<[^>]+>/g, ' ');
  return cleanText(decodeEntities(out));
}

/** Rejects anything that is not an http(s) URL on the permitted host. */
export function isCrawlable(url: string, restrictToHost: string, allowLocal: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (canonicalHost(parsed.hostname) !== canonicalHost(restrictToHost)) return false;
  if (!allowLocal && isLocalHost(parsed.hostname)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|zip|rar|mp4|mp3|avi|woff2?|ttf|eot|pdf|xml|json)(\?|$)/i.test(parsed.pathname)) {
    return false;
  }
  return true;
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[1] as string).trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue;
    }
    try {
      const abs = new URL(href, baseUrl);
      abs.hash = '';
      out.add(abs.toString().replace(/\/$/, ''));
    } catch {
      /* unparseable href */
    }
  }
  return [...out];
}

async function fetchPage(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'ChatPilotBot/1.0 (+https://chatpilot.app/bot)', Accept: 'text/html' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('application/xhtml')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CrawlResult {
  pages: CrawledPage[];
  visited: number;
  skipped: number;
  errors: string[];
}

export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const host = normaliseHost(options.restrictToHost);
  const start = options.startUrl.includes('://') ? options.startUrl : 'https://' + host;

  const queue: string[] = [start.replace(/\/$/, '')];
  const seen = new Set<string>(queue);
  const pages: CrawledPage[] = [];
  const errors: string[] = [];
  let skipped = 0;

  while (queue.length && pages.length < options.maxPages) {
    const url = queue.shift() as string;
    if (!isCrawlable(url, host, options.allowLocal)) {
      skipped += 1;
      continue;
    }

    const html = await fetchPage(url, timeoutMs);
    if (html === null) {
      errors.push('Could not fetch ' + url);
      continue;
    }

    const content = htmlToText(html);
    if (content.length >= 80) {
      pages.push({ url, title: extractTitle(html), content, wordCount: countWords(content) });
    } else {
      skipped += 1;
    }

    for (const link of extractLinks(html, url)) {
      if (seen.size >= options.maxPages * 6) break;
      if (!seen.has(link) && isCrawlable(link, host, options.allowLocal)) {
        seen.add(link);
        queue.push(link);
      }
    }
  }

  return { pages, visited: seen.size, skipped, errors };
}
