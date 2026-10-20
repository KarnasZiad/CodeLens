import { type NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy } from './lib/csp';

/**
 * A fresh nonce per request: Next.js reads it from the request's CSP header and adds it to its own
 * scripts, so no inline script without it can run.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  // Static assets and the relayed API need no policy of their own.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.svg).*)' }],
};
