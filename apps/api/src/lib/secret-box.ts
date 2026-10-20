import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM for secrets kept server-side (GitHub user tokens in sessions): a dump of Redis alone
 * reveals nothing usable. Output: "v1.<iv>.<tag>.<ciphertext>", base64url.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox needs a 32-byte key');
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), encrypted]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws on any tampering: GCM authenticates the ciphertext. */
  open(sealed: string): string {
    const [version, iv, tag, encrypted] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || encrypted === undefined) {
      throw new Error('Malformed sealed value');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
