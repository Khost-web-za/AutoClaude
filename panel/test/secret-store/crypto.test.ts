import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, SecretDecryptError } from '@/secret-store/crypto';

const key = randomBytes(32);

describe('secret crypto', () => {
  it('round-trips arbitrary bytes', () => {
    for (const plain of [Buffer.alloc(0), Buffer.from('hello'), randomBytes(4096)]) {
      const box = encrypt(plain, key, 1);
      expect(box.keyVersion).toBe(1);
      expect(decrypt(box, key)).toEqual(plain);
    }
  });

  it('uses a fresh 12-byte nonce each call', () => {
    const a = encrypt(Buffer.from('same'), key, 1);
    const b = encrypt(Buffer.from('same'), key, 1);
    expect(a.nonce).toHaveLength(12);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('fails with SecretDecryptError on a flipped ciphertext bit', () => {
    const box = encrypt(Buffer.from('top-secret-value'), key, 1);
    box.ciphertext[0]! ^= 1;
    expect(() => decrypt(box, key)).toThrow(SecretDecryptError);
  });

  it('fails on a flipped auth tag bit', () => {
    const box = encrypt(Buffer.from('top-secret-value'), key, 1);
    box.ciphertext[box.ciphertext.length - 1]! ^= 1;
    expect(() => decrypt(box, key)).toThrow(SecretDecryptError);
  });

  it('fails with the wrong key and never leaks plaintext in the message', () => {
    const box = encrypt(Buffer.from('top-secret-value'), key, 1);
    try {
      decrypt(box, randomBytes(32));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SecretDecryptError);
      expect((error as Error).message).not.toContain('top-secret-value');
    }
  });

  it('binds additional authenticated data', () => {
    const box = encrypt(Buffer.from('v'), key, 1, 'repo:a');
    expect(decrypt(box, key, 'repo:a').toString()).toBe('v');
    expect(() => decrypt(box, key, 'repo:b')).toThrow(SecretDecryptError);
    expect(() => decrypt(box, key)).toThrow(SecretDecryptError);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encrypt(Buffer.from('x'), randomBytes(16), 1)).toThrow();
  });
});
