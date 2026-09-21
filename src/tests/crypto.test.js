import { describe, it, expect } from 'vitest';
import { computeSHA256 } from '../services/crypto.js';

describe('EncryptDrop Crypto & Hash Utility Tests', () => {
  it('should compute exact matching SHA-256 hash for binary data', async () => {
    const encoder = new TextEncoder();
    const sampleBytes = encoder.encode('EncryptDrop Instant P2P File Share Teleportation');
    
    const hash = await computeSHA256(sampleBytes.buffer);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);

    const hash2 = await computeSHA256(sampleBytes.buffer);
    expect(hash).toBe(hash2);
  });

  it('should produce different hashes for different binary payloads', async () => {
    const encoder = new TextEncoder();
    const hashA = await computeSHA256(encoder.encode('Payload A').buffer);
    const hashB = await computeSHA256(encoder.encode('Payload B').buffer);

    expect(hashA).not.toEqual(hashB);
  });
});
