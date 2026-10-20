import type { Request } from 'express';

/** Reads the Cookie header; malformed pairs are skipped, never thrown. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * HttpOnly, SameSite=Lax (the OAuth callback is a cross-site top-level navigation), path /.
 * Secure cookies use the __Host- prefix: no Domain attribute can widen them to other hosts.
 */
export function cookieName(name: string, secure: boolean): string {
  return secure ? `__Host-${name}` : name;
}

export function serializeCookie(
  name: string,
  value: string,
  { secure, maxAgeSeconds }: CookieOptions,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
