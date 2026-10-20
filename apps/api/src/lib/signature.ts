import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

export function sign(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * Checks `X-Hub-Signature-256`: HMAC-SHA256 of the raw body, compared in constant time against
 * every active secret. The body must be the exact bytes received, before any JSON parsing.
 */
export function verifySignature(
  body: Buffer,
  header: string | undefined,
  secrets: readonly string[],
): boolean {
  const received = SIGNATURE.exec(header ?? '')?.[1];
  if (received === undefined) return false;
  const actual = Buffer.from(received, 'hex');
  let valid = false;
  // Every secret is tried, so the time taken does not reveal which one matched.
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(body).digest();
    valid = timingSafeEqual(expected, actual) || valid;
  }
  return valid;
}
