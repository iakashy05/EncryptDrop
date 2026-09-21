import { describe, it, expect } from 'vitest';
import { TransferManager } from '../services/transferManager.js';

describe('EncryptDrop High-Speed Transfer Logic Unit Tests', () => {
  it('should parse multi-file & folder hierarchies preserving relative paths and zipping on-the-fly', async () => {
    const transferManager = new TransferManager(null);
    const file1 = new File(['dummy doc content'], 'document.pdf', { type: 'application/pdf' });
    const file2 = new File(['dummy photo content'], 'photo.jpg', { type: 'image/jpeg' });

    Object.defineProperty(file1, 'webkitRelativePath', { value: 'project/docs/document.pdf' });
    Object.defineProperty(file2, 'webkitRelativePath', { value: 'project/images/photo.jpg' });

    const mockFiles = [file1, file2];

    const manifest = await transferManager.buildFolderManifest(mockFiles);
    expect(manifest.length).toBe(1);
    expect(manifest[0].name).toBe('project.zip');
    expect(manifest[0].type).toBe('application/zip');
    expect(manifest[0].totalChunks).toBeGreaterThanOrEqual(1);
  });

  it('should pack and unpack binary chunk data headers accurately for zero-copy streaming', () => {
    const transferManager = new TransferManager(null);
    const fileId = 'file_12345';
    const chunkIndex = 5;
    const mockPayload = new Uint8Array([10, 20, 30, 40, 50]).buffer;

    const packed = transferManager._packChunkData(fileId, chunkIndex, mockPayload);
    expect(packed).toBeDefined();

    const unpacked = transferManager._unpackChunkData(packed);
    expect(unpacked.fileId).toBe(fileId);
    expect(unpacked.chunkIndex).toBe(chunkIndex);
    expect(new Uint8Array(unpacked.rawBuffer)).toEqual(new Uint8Array(mockPayload));
  });

  it('should handle pause, resume, and cancel states cleanly', () => {
    const transferManager = new TransferManager(null);
    const fileId = 'file_test_pause';

    transferManager.outgoingTransfers.set(fileId, {
      fileId,
      fileObject: { size: 1024 },
      isPaused: false,
      isCanceled: false,
      currentChunk: 10
    });

    transferManager.pauseTransfer(fileId, false);
    expect(transferManager.outgoingTransfers.get(fileId).isPaused).toBe(true);

    transferManager.resumeTransfer(fileId, 10, false);
    expect(transferManager.outgoingTransfers.get(fileId).isPaused).toBe(false);

    transferManager.cancelTransfer(fileId, false);
    expect(transferManager.outgoingTransfers.get(fileId).isCanceled).toBe(true);
  });

  it('should handle transfer approval requests and rejection', () => {
    const transferManager = new TransferManager(null);
    transferManager.pendingIncomingBatch = {
      batchId: 'batch_test_1',
      files: [{ fileId: 'f1', name: 'test.mp4', size: 5000, totalChunks: 1 }],
      totalSize: 5000
    };

    let declinedBatch = null;
    transferManager.on('request-declined', ({ batchId }) => {
      declinedBatch = batchId;
    });

    transferManager.rejectTransfer('batch_test_1');
    expect(declinedBatch).toBe('batch_test_1');
    expect(transferManager.pendingIncomingBatch).toBeNull();
  });

  it('should purge RAM buffers and revoke download URLs on clear()', () => {
    const transferManager = new TransferManager(null);
    transferManager.incomingTransfers.set('file_99', {
      downloadUrl: 'blob:http://localhost/test-uuid',
      chunks: [new ArrayBuffer(100)]
    });

    transferManager.clear();
    expect(transferManager.incomingTransfers.size).toBe(0);
    expect(transferManager.outgoingTransfers.size).toBe(0);
  });
});
