export interface CustomUrlValidationOptions {
  /** Allow explicit http://localhost / 127.0.0.1 / [::1] endpoints for local self-hosted models. */
  allowLocalLoopback?: boolean;
}

const BLOCKED_EXACT_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
]);

function normalizeHost(hostname: string): string {
  const withoutBrackets = hostname.replace(/^\[|\]$/g, '');
  return withoutBrackets.replace(/\.$/, '').toLowerCase();
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    // Disallow octal/hex/padded ambiguity like 0177 or +10
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const val = Number(part);
    if (val < 0 || val > 255) return null;
    octets.push(val);
  }

  return [octets[0], octets[1], octets[2], octets[3]];
}

function isBlockedIpv4Octets(
  octets: [number, number, number, number],
  allowLoopback127001: boolean
): boolean {
  const [a, b, c] = octets;

  if (a === 0) return true; // 0.0.0.0/8 (current network)
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918 private)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / cloud metadata)
  if (a === 127) {
    const isExact127001 = a === 127 && b === 0 && c === 0 && octets[3] === 1;
    return !(allowLoopback127001 && isExact127001);
  }
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & cloud IMDS)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918 private)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918 private)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved

  return false;
}

function parseIpv6Hextets(rawIp: string): number[] | null {
  const ip = rawIp.split('%')[0].toLowerCase();
  if (!ip.includes(':')) return null;

  const doubleColonParts = ip.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (segmentStr: string): number[] | null => {
    if (!segmentStr) return [];
    const tokens = segmentStr.split(':');
    const out: number[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.includes('.')) {
        // Embedded dotted IPv4 only valid at the very end
        if (i !== tokens.length - 1) return null;
        const v4 = parseIpv4Octets(tok);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(parseInt(tok, 16));
      }
    }

    return out;
  };

  if (doubleColonParts.length === 2) {
    const left = parseSegmentList(doubleColonParts[0]);
    const right = parseSegmentList(doubleColonParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...Array<number>(missing).fill(0), ...right];
  }

  const parts = parseSegmentList(ip);
  if (!parts || parts.length !== 8) return null;
  return parts;
}

export function isBlockedIpAddress(
  rawIp: string,
  allowExplicitLoopback: boolean = false
): boolean {
  const host = normalizeHost(rawIp);

  const ipv4 = parseIpv4Octets(host);
  if (ipv4) {
    return isBlockedIpv4Octets(ipv4, allowExplicitLoopback);
  }

  const ipv6 = parseIpv6Hextets(host);
  if (ipv6) {
    const isAllZero = ipv6.every((h) => h === 0);
    if (isAllZero) return true; // :: unspecified

    const isLoopback =
      ipv6.slice(0, 7).every((h) => h === 0) && ipv6[7] === 1;
    if (isLoopback) {
      return !allowExplicitLoopback; // ::1
    }

    // IPv4-mapped IPv6 (::ffff:0:0/96)
    const isIpv4Mapped =
      ipv6[0] === 0 &&
      ipv6[1] === 0 &&
      ipv6[2] === 0 &&
      ipv6[3] === 0 &&
      ipv6[4] === 0 &&
      ipv6[5] === 0xffff;
    if (isIpv4Mapped) {
      const mappedOctets: [number, number, number, number] = [
        ipv6[6] >> 8,
        ipv6[6] & 0xff,
        ipv6[7] >> 8,
        ipv6[7] & 0xff,
      ];
      return isBlockedIpv4Octets(mappedOctets, false);
    }

    // Deprecated IPv4-compatible IPv6 (::/96)
    if (ipv6.slice(0, 6).every((h) => h === 0)) {
      const compatOctets: [number, number, number, number] = [
        ipv6[6] >> 8,
        ipv6[6] & 0xff,
        ipv6[7] >> 8,
        ipv6[7] & 0xff,
      ];
      return isBlockedIpv4Octets(compatOctets, false);
    }

    // NAT64 (64:ff9b::/96 and 64:ff9b:1::/48)
    if (
      ipv6[0] === 0x0064 &&
      (ipv6[1] === 0xff9b || ipv6[1] === 0x0001)
    ) {
      return true;
    }

    // fc00::/7 Unique Local IPv6 (includes AWS fd00:ec2::254 metadata)
    if ((ipv6[0] & 0xfe00) === 0xfc00) return true;

    // fe80::/10 Link-Local IPv6
    if ((ipv6[0] & 0xffc0) === 0xfe80) return true;

    // ff00::/8 Multicast IPv6
    if ((ipv6[0] & 0xff00) === 0xff00) return true;

    // 100::/64 Discard prefix & 2001:db8::/32 documentation
    if (
      (ipv6[0] === 0x0100 && ipv6[1] === 0 && ipv6[2] === 0 && ipv6[3] === 0) ||
      (ipv6[0] === 0x2001 && ipv6[1] === 0x0db8)
    ) {
      return true;
    }

    return false;
  }

  return false;
}

export function isExplicitLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isLocalLoopbackOptInEnabled(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env?.ALLOW_LOCAL_AI_ENDPOINTS === 'true'
  );
}

/**
 * Checks whether a base URL strictly points to an explicitly allowed local loopback endpoint
 * when ALLOW_LOCAL_AI_ENDPOINTS=true is enabled on the host.
 */
export function isPermittedLocalLoopbackBaseUrl(
  rawUrl?: string,
  allowLocalLoopback: boolean = isLocalLoopbackOptInEnabled()
): boolean {
  if (!allowLocalLoopback || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password || parsed.hash) {
      return false;
    }
    return isExplicitLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Validates user-supplied Custom OpenAI-compatible base URLs to prevent SSRF attacks
 * against private networks, link-local cloud metadata endpoints, and localhost services.
 */
export function validateCustomBaseUrl(
  rawUrl: string,
  options: CustomUrlValidationOptions = {}
): string {
  const allowLocalLoopback =
    options.allowLocalLoopback ?? isLocalLoopbackOptInEnabled();

  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Custom AI base URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid Custom AI base URL format.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Custom AI base URL must not contain embedded credentials.');
  }

  if (parsed.hash) {
    throw new Error('Custom AI base URL must not contain a fragment (#).');
  }

  if (parsed.search) {
    throw new Error('Custom AI base URL must not contain query parameters.');
  }

  const host = normalizeHost(parsed.hostname);
  if (!host) {
    throw new Error('Custom AI base URL must include a valid hostname.');
  }

  const isLoopback = isExplicitLoopbackHost(host);

  if (parsed.protocol === 'https:') {
    // Permitted if hostname checks pass below
  } else if (parsed.protocol === 'http:' && allowLocalLoopback && isLoopback) {
    return trimmed;
  } else if (parsed.protocol === 'http:') {
    throw new Error(
      'Custom AI base URL must use HTTPS. Local HTTP endpoints (localhost/127.0.0.1) require ALLOW_LOCAL_AI_ENDPOINTS=true on the server.'
    );
  } else {
    throw new Error(
      `Unsupported URL protocol "${parsed.protocol}". Custom AI base URL must use HTTPS.`
    );
  }

  if (isLoopback) {
    if (!allowLocalLoopback) {
      throw new Error(
        'Unsafe Custom AI base URL: loopback addresses (localhost / 127.0.0.1 / ::1) are blocked unless ALLOW_LOCAL_AI_ENDPOINTS=true is set.'
      );
    }
    return trimmed;
  }

  if (
    BLOCKED_EXACT_HOSTS.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(
      `Unsafe Custom AI base URL: internal or reserved hostname "${host}" is not allowed.`
    );
  }

  // Block raw IPv4/IPv6 private, link-local, metadata, multicast, and reserved ranges
  if (isBlockedIpAddress(host, false)) {
    throw new Error(
      `Unsafe Custom AI base URL: private, link-local, or reserved IP "${host}" is blocked.`
    );
  }

  // Reject single-label hostnames or unnormalized numeric/hex IPs (e.g. http://redis, https://2130706433)
  const isIpLiteral = parseIpv4Octets(host) !== null || parseIpv6Hextets(host) !== null;
  if (!isIpLiteral) {
    if (!host.includes('.')) {
      throw new Error(
        `Unsafe Custom AI base URL: single-label internal hostname "${host}" is blocked.`
      );
    }
    const labels = host.split('.');
    const tld = labels[labels.length - 1];
    if (/^\d+$/.test(tld) || /^0x[0-9a-f]+$/i.test(tld)) {
      throw new Error('Unsafe Custom AI base URL: obfuscated IP hostnames are blocked.');
    }
  }

  return trimmed;
}

/**
 * Resolves DeepSeek's API base URL safely without trusting arbitrary hostnames.
 */
export function resolveSafeDeepSeekBaseUrl(rawUrl?: string): string {
  const defaultUrl = 'https://api.deepseek.com';
  if (!rawUrl || !rawUrl.trim()) return defaultUrl;
  try {
    const parsed = new URL(rawUrl.trim().replace(/\/+$/, ''));
    if (
      parsed.protocol === 'https:' &&
      normalizeHost(parsed.hostname) === 'api.deepseek.com' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    ) {
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // Fall back to canonical endpoint
  }
  return defaultUrl;
}
