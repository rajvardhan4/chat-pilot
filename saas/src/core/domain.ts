/**
 * Domain / host normalisation used by site validation.
 *
 * A registered website owns a canonical host. The plugin will present the URL
 * of the site it is installed on; we compare normalised hosts, and treat
 * "www." as equivalent to the bare host. Everything else must be added by the
 * customer as an explicit additional domain.
 */

/** Strips scheme, port, path, trailing dot and lowercases. Returns '' if unusable. */
export function normaliseHost(input: string): string {
  if (!input) return '';
  let value = String(input).trim().toLowerCase();
  if (!value) return '';
  if (!value.includes('://')) value = 'http://' + value;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return '';
  }
  host = host.replace(/\.$/, '');
  if (!host || host.length > 253) return '';
  // Reject anything that is not a plausible hostname or IP literal.
  if (!/^[a-z0-9.-]+$/.test(host)) return '';
  return host;
}

/** Canonical comparison form: drops a leading "www.". */
export function canonicalHost(input: string): string {
  const host = normaliseHost(input);
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** True when two hosts refer to the same site for authorisation purposes. */
export function hostsMatch(a: string, b: string): boolean {
  const ca = canonicalHost(a);
  const cb = canonicalHost(b);
  return ca !== '' && ca === cb;
}

/** True for localhost / private-network hosts (allowed for development sites). */
export function isLocalHost(host: string): boolean {
  const h = canonicalHost(host);
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.test')) {
    return true;
  }
  if (h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/** Extracts the origin (scheme://host[:port]) of a URL, or '' when invalid. */
export function originOf(input: string): string {
  try {
    const u = new URL(input);
    return u.origin;
  } catch {
    return '';
  }
}
