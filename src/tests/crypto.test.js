import { describe, it, expect } from 'vitest';
import {
  generateAESKey,
  exportKeyToHash,
  importKeyFromHash,
  deriveChunkIV,
  encryptChunk,
  decryptChunk,
  computeSHA256
} from '../services/crypto.js';

describe('EncryptDrop Crypto Engine Unit Tests', () => {
  it('should generate an AES-256-GCM key and roundtrip export/import to URL hash', async () => {
    const originalKey = await generateAESKey();
    expect(originalKey).toBeDefined();

    const hashString = await exportKeyToHash(originalKey);
    expect(typeof hashString).toBe('string');
    expect(hashString.length).toBeGreaterThan(10);

    const importedKey = await importKeyFromHash(hashString);
    expect(importedKey).toBeDefined();
  });

  it('should derive a deterministic 12-byte IV for pause/resume offset seeking', () => {
    const fileId = 'file_abc123';
    const chunkIndex = 42;

    const iv1 = deriveChunkIV(fileId, chunkIndex);
    const iv2 = deriveChunkIV(fileId, chunkIndex);
    const ivDifferentChunk = deriveChunkIV(fileId, 43);

    expect(iv1.length).toBe(12);
    expect(iv1).toEqual(iv2);
    expect(iv1).not.toEqual(ivDifferentChunk);
  });

  it('should encrypt and decrypt binary ArrayBuffer chunks with 100% bit fidelity', async () => {
    const key = await generateAESKey();
    const fileId = 'test_file_001';
    const chunkIndex = 0;
    const iv = deriveChunkIV(fileId, chunkIndex);

    // Sample payload: 64KB uncompressed binary test data
    const originalData = new Uint8Array(65536);
    for (let i = 0; i < originalData.length; i++) {
      originalData[i] = i % 256;
    }

    const encryptedBuffer = await encryptChunk(originalData.buffer, key, iv);
    expect(encryptedBuffer).toBeDefined();
    expect(encryptedBuffer.byteLength).toBeGreaterThan(originalData.byteLength);

    const decryptedBuffer = await decryptChunk(encryptedBuffer, key, iv);
    const decryptedData = new Uint8Array(decryptedBuffer);

    expect(decryptedData.byteLength).toBe(originalData.byteLength);
    expect(decryptedData).toEqual(originalData);
  });

  it('should compute exact matching SHA-256 hash for binary data', async () => {
    const encoder = new TextEncoder();
    const sampleBytes = encoder.encode('EncryptDrop Instant P2P File Share Teleportation');
    
    const hash = await computeSHA256(sampleBytes.buffer);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);

    const hash2 = await computeSHA256(sampleBytes.buffer);
    expect(hash).toBe(hash2);
  });
});
