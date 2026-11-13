import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretDecryptError extends Error {
  override name = 'SecretDecryptError';
  constructor() {
    super('Secret could not be decrypted (wrong key, tampered data or mismatched context)');
  }
}

export type EncryptedBox = { ciphertext: Buffer; nonce: Buffer; keyVersion: number };

function assertKey(key: Buffer) {
  if (key.length !== KEY_BYTES) throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
}

/** AES-256-GCM with a fresh random nonce. The auth tag is appended to the ciphertext. */
export function encrypt(
  plain: Buffer,
  key: Buffer,
  keyVersion: number,
  aad?: string,
): EncryptedBox {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(aad ?? '', 'utf8'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyVersion };
}

export function decrypt(
  box: Pick<EncryptedBox, 'ciphertext' | 'nonce'>,
  key: Buffer,
  aad?: string,
): Buffer {
  assertKey(key);
  if (box.nonce.length !== NONCE_BYTES || box.ciphertext.length < TAG_BYTES) {
    throw new SecretDecryptError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, box.nonce);
    decipher.setAAD(Buffer.from(aad ?? '', 'utf8'));
    decipher.setAuthTag(box.ciphertext.subarray(box.ciphertext.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(box.ciphertext.subarray(0, box.ciphertext.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    throw new SecretDecryptError();
  }
}
