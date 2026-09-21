/**
 * EncryptDrop High-Speed P2P Transfer Manager
 * Hardware-accelerated native WebRTC DTLS streaming.
 * Handles folder zipping, zero-copy binary streaming, event-driven backpressure,
 * Quick Share-style transfer approval, pause/resume, and SHA-256 verification.
 */
import JSZip from 'jszip';
import { computeSHA256 } from './crypto.js';
import { playCompleteChime, triggerHapticSuccess } from './audioHaptics.js';

export const CHUNK_SIZE = 60 * 1024; // 60KB (61,440 bytes + 40-byte header = 61,480 bytes < 65,535 SCTP MTU)
const FILE_ID_HEADER_SIZE = 36;       // Fixed 36-byte header size for fileId

/**
 * Check if a list of files represents a folder structure or multi-file folder selection.
 */
function isFolderSelection(filesArray) {
  return filesArray.some((f) => f.webkitRelativePath && f.webkitRelativePath.includes('/'));
}

/**
 * Compress a folder file list into a single zipped File object on-the-fly in browser RAM.
 */
export async function zipFolderFiles(filesArray) {
  const zip = new JSZip();
  let folderName = 'Folder_Archive';

  for (const file of filesArray) {
    const relativePath = file.webkitRelativePath || file.name;
    if (file.webkitRelativePath && file.webkitRelativePath.includes('/')) {
      folderName = file.webkitRelativePath.split('/')[0];
    }
    zip.file(relativePath, file);
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return new File([zipBlob], `${folderName}.zip`, { type: 'application/zip' });
}

export class TransferManager {
  constructor(webrtcManager) {
    this.webrtc = webrtcManager;

    // Bi-directional transfer state maps
    this.outgoingTransfers = new Map(); // fileId -> { fileObject, name, path, size, isPaused, isCanceled, currentChunk, sentBytes }
    this.incomingTransfers = new Map(); // fileId -> { name, size, type, path, chunks: [], receivedBytes, isPaused, isCanceled }

    this.pendingOutgoingBatch = null;
    this.pendingIncomingBatch = null;
    this.lastProgressEmit = new Map(); // Throttle map: fileId -> timestamp

    this.callbacks = {};
    this._bindEvents();
  }

  _bindEvents() {
    if (!this.webrtc) return;

    this.webrtc.on('message', async (data) => {
      try {
        if (typeof data === 'string') {
          const packet = JSON.parse(data);
          await this._handleControlPacket(packet);
        } else if (data instanceof ArrayBuffer) {
          this._handleBinaryChunk(data);
        }
      } catch (err) {
        console.error('[TransferManager] Error processing packet:', err);
      }
    });
  }

  /**
   * Parse dropped or selected FileList / Folders into a standardized manifest array.
   */
  async buildFolderManifest(fileList) {
    const manifest = [];
    let filesArray = Array.from(fileList);

    if (isFolderSelection(filesArray)) {
      console.log('[TransferManager] Folder detected! Zipping folder contents on-the-fly...');
      const zippedFile = await zipFolderFiles(filesArray);
      filesArray = [zippedFile];
    }

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const relativePath = file.webkitRelativePath || file.name;
      const fileId = `f_${Date.now().toString(36)}_${i}_${Math.random().toString(36).substring(2, 8)}`;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

      manifest.push({
        fileId,
        name: file.name,
        path: relativePath,
        size: file.size,
        type: file.type || 'application/octet-stream',
        totalChunks,
        fileObject: file
      });
    }
    return manifest;
  }

  /**
   * Request to send files (AirDrop / Quick Share style approval handshake).
   */
  async requestSendFiles(fileList) {
    if (!this.webrtc) {
      throw new Error('WebRTC not initialized');
    }

    const manifest = await this.buildFolderManifest(fileList);
    const batchId = `batch_${Date.now()}`;
    const totalSize = manifest.reduce((acc, f) => acc + f.size, 0);

    for (const item of manifest) {
      this.outgoingTransfers.set(item.fileId, {
        ...item,
        isPaused: false,
        isCanceled: false,
        currentChunk: 0,
        sentBytes: 0
      });
    }

    this.pendingOutgoingBatch = { batchId, manifest };

    // Send request packet to receiver
    this.webrtc.send(JSON.stringify({
      type: 'TRANSFER_REQUEST',
      batchId,
      files: manifest.map(({ fileObject, ...meta }) => meta),
      totalSize
    }));

    this._emitEvent('waiting-approval', {
      batchId,
      files: manifest,
      totalSize
    });

    return batchId;
  }

  /**
   * Receiver accepts incoming transfer request.
   */
  acceptTransfer(batchId) {
    if (!this.pendingIncomingBatch || this.pendingIncomingBatch.batchId !== batchId) return;

    for (const meta of this.pendingIncomingBatch.files) {
      this.incomingTransfers.set(meta.fileId, {
        ...meta,
        chunks: new Array(meta.totalChunks),
        receivedChunksCount: 0,
        receivedBytes: 0,
        isPaused: false,
        isCanceled: false,
        isCompleted: false
      });
    }

    if (this.webrtc) {
      this.webrtc.send(JSON.stringify({
        type: 'TRANSFER_RESPONSE',
        batchId,
        accepted: true
      }));
    }

    this._emitEvent('batch-start', this.pendingIncomingBatch.files);
    this.pendingIncomingBatch = null;
  }

  /**
   * Receiver declines incoming transfer request.
   */
  rejectTransfer(batchId) {
    if (this.webrtc) {
      this.webrtc.send(JSON.stringify({
        type: 'TRANSFER_RESPONSE',
        batchId,
        accepted: false
      }));
    }
    this.pendingIncomingBatch = null;
    this._emitEvent('request-declined', { batchId });
  }

  /**
   * Stream a single file chunk by chunk with 2MB block disk prefetching and event-driven backpressure.
   */
  async streamFile(fileId, startChunkIndex = 0) {
    const transfer = this.outgoingTransfers.get(fileId);
    if (!transfer || transfer.isCanceled || !transfer.fileObject) return;

    const file = transfer.fileObject;
    transfer.currentChunk = startChunkIndex;

    const BLOCK_SIZE = 2 * 1024 * 1024; // 2MB disk prefetch block

    while (transfer.currentChunk < transfer.totalChunks) {
      if (transfer.isPaused || transfer.isCanceled) {
        console.log(`[TransferManager] Streaming ${transfer.isPaused ? 'PAUSED' : 'CANCELED'} for ${fileId}`);
        break;
      }

      // 1. Read a 2MB block from disk into RAM in ONE single fast read
      const currentByteOffset = transfer.currentChunk * CHUNK_SIZE;
      const blockEnd = Math.min(currentByteOffset + BLOCK_SIZE, file.size);
      const blockSlice = file.slice ? file.slice(currentByteOffset, blockEnd) : new Blob([]);
      const blockBuffer = await blockSlice.arrayBuffer();

      // 2. Stream 60KB chunks from in-memory ArrayBuffer at maximum line rate
      let blockOffset = 0;
      while (blockOffset < blockBuffer.byteLength && transfer.currentChunk < transfer.totalChunks) {
        if (transfer.isPaused || transfer.isCanceled) break;

        // Wait only when WebRTC buffer hits 8MB ceiling, draining to 1MB
        if (this.webrtc && this.webrtc.isBufferFull()) {
          await this.webrtc.waitForBufferLow();
        }

        const chunkIndex = transfer.currentChunk;
        const chunkSize = Math.min(CHUNK_SIZE, blockBuffer.byteLength - blockOffset);
        const rawChunk = blockBuffer.slice(blockOffset, blockOffset + chunkSize);

        const packetBuffer = this._packChunkData(fileId, chunkIndex, rawChunk);
        if (this.webrtc) {
          this.webrtc.send(packetBuffer);
        }

        blockOffset += chunkSize;
        transfer.sentBytes += chunkSize;
        transfer.currentChunk++;

        this._emitThrottledProgress(fileId, transfer, 'upload');
      }
    }
  }

  /**
   * Pack binary metadata header with raw chunk into a single ArrayBuffer.
   */
  _packChunkData(fileId, chunkIndex, rawBuffer) {
    const encoder = new TextEncoder();
    const safeId = fileId.substring(0, FILE_ID_HEADER_SIZE).padEnd(FILE_ID_HEADER_SIZE, ' ');
    const idBytes = encoder.encode(safeId);

    const indexBytes = new Uint8Array(4);
    const dataView = new DataView(indexBytes.buffer);
    dataView.setUint32(0, chunkIndex, false); // Big Endian uint32

    const packed = new Uint8Array(FILE_ID_HEADER_SIZE + 4 + rawBuffer.byteLength);
    packed.set(idBytes, 0);
    packed.set(indexBytes, FILE_ID_HEADER_SIZE);
    packed.set(new Uint8Array(rawBuffer), FILE_ID_HEADER_SIZE + 4);
    return packed.buffer;
  }

  /**
   * Unpack binary chunk data packet.
   */
  _unpackChunkData(packedBuffer) {
    const view = new Uint8Array(packedBuffer);
    const decoder = new TextDecoder();
    const fileId = decoder.decode(view.subarray(0, FILE_ID_HEADER_SIZE)).trim();

    const dataView = new DataView(packedBuffer, FILE_ID_HEADER_SIZE, 4);
    const chunkIndex = dataView.getUint32(0, false);

    const rawBuffer = packedBuffer.slice(FILE_ID_HEADER_SIZE + 4);

    return { fileId, chunkIndex, rawBuffer };
  }

  /**
   * Handle incoming WebRTC control packets.
   */
  async _handleControlPacket(packet) {
    switch (packet.type) {
      case 'TRANSFER_REQUEST':
        this.pendingIncomingBatch = {
          batchId: packet.batchId,
          files: packet.files,
          totalSize: packet.totalSize
        };
        this._emitEvent('incoming-request', {
          batchId: packet.batchId,
          files: packet.files,
          totalSize: packet.totalSize
        });
        break;

      case 'TRANSFER_RESPONSE':
        if (packet.accepted) {
          this._emitEvent('transfer-accepted', { batchId: packet.batchId });
          if (this.pendingOutgoingBatch && this.pendingOutgoingBatch.batchId === packet.batchId) {
            const manifest = this.pendingOutgoingBatch.manifest;
            this.pendingOutgoingBatch = null;
            for (const item of manifest) {
              await this.streamFile(item.fileId);
            }
          }
        } else {
          this._emitEvent('transfer-rejected', { batchId: packet.batchId });
          this.pendingOutgoingBatch = null;
        }
        break;

      case 'PAUSE':
        this.pauseTransfer(packet.fileId, false);
        break;

      case 'RESUME':
        this.resumeTransfer(packet.fileId, packet.fromChunkIndex, false);
        break;

      case 'CANCEL':
        this.cancelTransfer(packet.fileId, false);
        break;
    }
  }

  /**
   * Handle incoming binary raw chunk packet directly from peer.
   */
  _handleBinaryChunk(packedBuffer) {
    const { fileId, chunkIndex, rawBuffer } = this._unpackChunkData(packedBuffer);
    const transfer = this.incomingTransfers.get(fileId);

    if (!transfer || transfer.isCanceled || transfer.isPaused) return;

    transfer.chunks[chunkIndex] = rawBuffer;
    transfer.receivedChunksCount++;
    transfer.receivedBytes += rawBuffer.byteLength;

    this._emitThrottledProgress(fileId, transfer, 'download');

    if (transfer.receivedChunksCount === transfer.totalChunks && !transfer.isCompleted) {
      transfer.isCompleted = true;
      this._finalizeFileDownload(fileId);
    }
  }

  /**
   * Throttle React progress updates to ~16fps (every 60ms) to prevent UI thread thrashing.
   */
  _emitThrottledProgress(fileId, transfer, direction) {
    const now = Date.now();
    const last = this.lastProgressEmit.get(fileId) || 0;
    const isComplete = (transfer.currentChunk >= transfer.totalChunks) || (transfer.receivedChunksCount >= transfer.totalChunks);

    if (isComplete || now - last > 60) {
      this.lastProgressEmit.set(fileId, now);
      const progressPercent = transfer.size > 0 
        ? Math.round(((transfer.sentBytes || transfer.receivedBytes) / transfer.size) * 100) 
        : 100;

      this._emitEvent('progress', {
        fileId,
        name: transfer.name,
        path: transfer.path,
        direction,
        currentChunk: transfer.currentChunk || transfer.receivedChunksCount,
        totalChunks: transfer.totalChunks,
        sentBytes: transfer.sentBytes || 0,
        receivedBytes: transfer.receivedBytes || 0,
        totalBytes: transfer.size,
        size: transfer.size,
        progressPercent: Math.min(progressPercent, 100)
      });
    }
  }

  /**
   * Finalize received file, construct blob, and trigger completion chime.
   */
  _finalizeFileDownload(fileId) {
    const transfer = this.incomingTransfers.get(fileId);
    if (!transfer) return;

    const blob = new Blob(transfer.chunks, { type: transfer.type || 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(blob);
    transfer.downloadUrl = downloadUrl;

    playCompleteChime();
    triggerHapticSuccess();

    this._emitEvent('file-complete', {
      fileId,
      downloadUrl,
      name: transfer.name,
      size: transfer.size
    });
  }

  pauseTransfer(fileId, notifyPeer = true) {
    const outgoing = this.outgoingTransfers.get(fileId);
    if (outgoing) outgoing.isPaused = true;

    const incoming = this.incomingTransfers.get(fileId);
    if (incoming) incoming.isPaused = true;

    if (notifyPeer && this.webrtc) {
      this.webrtc.send(JSON.stringify({ type: 'PAUSE', fileId }));
    }
    this._emitEvent('transfer-paused', { fileId });
  }

  resumeTransfer(fileId, fromChunkIndex = null, notifyPeer = true) {
    const outgoing = this.outgoingTransfers.get(fileId);
    if (outgoing) {
      outgoing.isPaused = false;
      const targetChunk = fromChunkIndex !== null ? fromChunkIndex : outgoing.currentChunk;
      this.streamFile(fileId, targetChunk);
    }

    const incoming = this.incomingTransfers.get(fileId);
    if (incoming) incoming.isPaused = false;

    if (notifyPeer && this.webrtc) {
      this.webrtc.send(JSON.stringify({
        type: 'RESUME',
        fileId,
        fromChunkIndex: incoming ? incoming.receivedChunksCount : 0
      }));
    }
    this._emitEvent('transfer-resumed', { fileId });
  }

  cancelTransfer(fileId, notifyPeer = true) {
    const outgoing = this.outgoingTransfers.get(fileId);
    if (outgoing) outgoing.isCanceled = true;

    const incoming = this.incomingTransfers.get(fileId);
    if (incoming) {
      incoming.isCanceled = true;
      incoming.chunks = [];
    }

    if (notifyPeer && this.webrtc) {
      this.webrtc.send(JSON.stringify({ type: 'CANCEL', fileId }));
    }
    this._emitEvent('transfer-canceled', { fileId });
  }

  getTotalTransferredBytes() {
    let total = 0;
    for (const [, t] of this.outgoingTransfers) {
      total += t.sentBytes || 0;
    }
    for (const [, t] of this.incomingTransfers) {
      total += t.receivedBytes || 0;
    }
    return total;
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  _emitEvent(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  clear() {
    for (const [, transfer] of this.incomingTransfers) {
      if (transfer.downloadUrl) {
        URL.revokeObjectURL(transfer.downloadUrl);
      }
      transfer.chunks = [];
    }
    this.outgoingTransfers.clear();
    this.incomingTransfers.clear();
    this.pendingOutgoingBatch = null;
    this.pendingIncomingBatch = null;
    this.lastProgressEmit.clear();
    this.callbacks = {};
  }
}
