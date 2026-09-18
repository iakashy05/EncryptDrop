/**
 * EncryptDrop Advanced P2P Transfer Manager
 * Handles multi-file & folder zipping, chunk streaming, AES-256-GCM encryption,
 * pause, resume, cancel, bi-directional transfers, and SHA-256 checksum verification.
 */
import JSZip from 'jszip';
import { encryptChunk, decryptChunk, deriveChunkIV, computeSHA256 } from './crypto.js';
import { playCompleteChime, triggerHapticSuccess } from './audioHaptics.js';

export const CHUNK_SIZE = 64 * 1024; // 64KB optimal WebRTC chunk size
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
  constructor(webrtcManager, cryptoKey) {
    this.webrtc = webrtcManager;
    this.cryptoKey = cryptoKey;

    // Bi-directional transfer state maps
    this.outgoingTransfers = new Map(); // fileId -> { file, name, path, size, isPaused, isCanceled, currentChunk }
    this.incomingTransfers = new Map(); // fileId -> { name, size, type, path, sha256, chunks: [], receivedBytes, isPaused, isCanceled }

    this.callbacks = {};
    this._bindEvents();
  }

  setCryptoKey(key) {
    this.cryptoKey = key;
  }

  _bindEvents() {
    if (!this.webrtc) return;

    this.webrtc.on('message', async (data) => {
      try {
        if (typeof data === 'string') {
          // Control JSON Packet (Header, Pause, Resume, Cancel)
          const packet = JSON.parse(data);
          await this._handleControlPacket(packet);
        } else if (data instanceof ArrayBuffer) {
          // Binary Encrypted Chunk Packet
          await this._handleBinaryChunk(data);
        }
      } catch (err) {
        console.error('[TransferManager] Error processing packet:', err);
      }
    });

    this.webrtc.on('buffered-amount-low', () => {
      this._emitEvent('buffer-low');
    });
  }

  /**
   * Parse dropped or selected FileList / Folders into a standardized manifest array.
   * If a folder is detected, automatically zips it into a single .zip file on-the-fly.
   * @param {FileList|File[]} fileList 
   * @returns {Promise<Array>}
   */
  async buildFolderManifest(fileList) {
    const manifest = [];
    let filesArray = Array.from(fileList);

    // If folder selection is detected, zip folder into a single .zip file on-the-fly
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
        type: file.type || 'application/zip',
        totalChunks,
        sha256: null,
        fileObject: file
      });
    }
    return manifest;
  }

  /**
   * Send a list of files or zipped folder hierarchy to connected peer.
   * @param {FileList|File[]} fileList 
   */
  async sendFiles(fileList) {
    if (!this.webrtc || !this.cryptoKey) {
      throw new Error('WebRTC or CryptoKey not initialized');
    }

    const manifest = await this.buildFolderManifest(fileList);
    const batchId = `batch_${Date.now()}`;

    // Store in outgoing map
    for (const item of manifest) {
      this.outgoingTransfers.set(item.fileId, {
        ...item,
        isPaused: false,
        isCanceled: false,
        currentChunk: 0,
        sentBytes: 0
      });
    }

    // 1. Send BATCH_START Header over WebRTC
    const headerPacket = {
      type: 'BATCH_START',
      batchId,
      files: manifest.map(({ fileObject, ...meta }) => meta)
    };
    this.webrtc.send(JSON.stringify(headerPacket));

    // 2. Stream files sequentially
    for (const item of manifest) {
      await this.streamFile(item.fileId);
    }
  }

  /**
   * Stream a single file chunk by chunk with backpressure and encryption.
   * @param {string} fileId 
   * @param {number} startChunkIndex 
   */
  async streamFile(fileId, startChunkIndex = 0) {
    const transfer = this.outgoingTransfers.get(fileId);
    if (!transfer || transfer.isCanceled || !transfer.fileObject) return;

    const file = transfer.fileObject;
    transfer.currentChunk = startChunkIndex;

    // First compute SHA-256 for integrity verification if not already done
    if (!transfer.sha256 && file && file.size > 0 && typeof file.arrayBuffer === 'function') {
      const fullBuffer = await file.arrayBuffer();
      transfer.sha256 = await computeSHA256(fullBuffer);

      if (this.webrtc) {
        this.webrtc.send(JSON.stringify({
          type: 'FILE_SHA256',
          fileId,
          sha256: transfer.sha256
        }));
      }
    }

    while (transfer.currentChunk < transfer.totalChunks) {
      if (transfer.isPaused || transfer.isCanceled) {
        console.log(`[TransferManager] Streaming ${transfer.isPaused ? 'PAUSED' : 'CANCELED'} for ${fileId}`);
        break;
      }

      const chunkIndex = transfer.currentChunk;
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const rawChunkSlice = file.slice ? file.slice(start, end) : new Blob([]);
      const rawBuffer = await rawChunkSlice.arrayBuffer();

      // Derive chunk IV and encrypt using Web Crypto API
      const iv = deriveChunkIV(fileId, chunkIndex);
      const encryptedBuffer = await encryptChunk(rawBuffer, this.cryptoKey, iv);

      // Packet format: [36-byte fileId header | 4-byte chunkIndex | Encrypted Payload]
      const packetBuffer = this._packChunkData(fileId, chunkIndex, encryptedBuffer);

      // Send over WebRTC DataChannel
      let isBufferOkay = true;
      if (this.webrtc) {
        isBufferOkay = this.webrtc.send(packetBuffer);
      }
      transfer.sentBytes += rawBuffer.byteLength;
      transfer.currentChunk++;

      const progressPercent = transfer.size > 0 ? Math.round((transfer.sentBytes / transfer.size) * 100) : 100;

      this._emitEvent('progress', {
        fileId,
        name: transfer.name,
        path: transfer.path,
        direction: 'upload',
        currentChunk: transfer.currentChunk,
        totalChunks: transfer.totalChunks,
        sentBytes: transfer.sentBytes,
        totalBytes: transfer.size,
        size: transfer.size,
        progressPercent: Math.min(progressPercent, 100)
      });

      // Throttle if WebRTC buffer is full
      if (!isBufferOkay && this.webrtc) {
        await this._waitForBufferLow();
      }
    }
  }

  /**
   * Pack binary metadata header with encrypted chunk into a single ArrayBuffer.
   * Layout: [36 bytes fileId | 4 bytes uint32 chunkIndex | N bytes payload]
   */
  _packChunkData(fileId, chunkIndex, encryptedBuffer) {
    const encoder = new TextEncoder();
    const safeId = fileId.substring(0, FILE_ID_HEADER_SIZE).padEnd(FILE_ID_HEADER_SIZE, ' ');
    const idBytes = encoder.encode(safeId);

    const indexBytes = new Uint8Array(4);
    const dataView = new DataView(indexBytes.buffer);
    dataView.setUint32(0, chunkIndex, false); // Big Endian uint32

    const packed = new Uint8Array(FILE_ID_HEADER_SIZE + 4 + encryptedBuffer.byteLength);
    packed.set(idBytes, 0);
    packed.set(indexBytes, FILE_ID_HEADER_SIZE);
    packed.set(new Uint8Array(encryptedBuffer), FILE_ID_HEADER_SIZE + 4);
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

    const cipherBuffer = packedBuffer.slice(FILE_ID_HEADER_SIZE + 4);

    return { fileId, chunkIndex, cipherBuffer };
  }

  /**
   * Handle incoming WebRTC control packets.
   */
  async _handleControlPacket(packet) {
    switch (packet.type) {
      case 'BATCH_START':
        for (const meta of packet.files) {
          this.incomingTransfers.set(meta.fileId, {
            ...meta,
            chunks: new Array(meta.totalChunks),
            receivedChunksCount: 0,
            receivedBytes: 0,
            isPaused: false,
            isCanceled: false,
            isCompleted: false,
            sha256Match: null
          });
        }
        this._emitEvent('batch-start', packet.files);
        break;

      case 'FILE_SHA256':
        if (this.incomingTransfers.has(packet.fileId)) {
          this.incomingTransfers.get(packet.fileId).sha256 = packet.sha256;
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
   * Handle incoming binary encrypted chunk packet from peer.
   */
  async _handleBinaryChunk(packedBuffer) {
    const { fileId, chunkIndex, cipherBuffer } = this._unpackChunkData(packedBuffer);
    const transfer = this.incomingTransfers.get(fileId);

    if (!transfer) {
      console.warn(`[TransferManager] Received chunk for unknown fileId: "${fileId}".`);
      return;
    }

    if (transfer.isCanceled || transfer.isPaused) return;

    try {
      // Derive IV and decrypt chunk using Web Crypto API
      const iv = deriveChunkIV(fileId, chunkIndex);
      const decryptedBuffer = await decryptChunk(cipherBuffer, this.cryptoKey, iv);

      transfer.chunks[chunkIndex] = decryptedBuffer;
      transfer.receivedChunksCount++;
      transfer.receivedBytes += decryptedBuffer.byteLength;

      const progressPercent = transfer.size > 0 ? Math.round((transfer.receivedBytes / transfer.size) * 100) : 100;

      this._emitEvent('progress', {
        fileId,
        name: transfer.name,
        path: transfer.path,
        direction: 'download',
        receivedChunksCount: transfer.receivedChunksCount,
        totalChunks: transfer.totalChunks,
        receivedBytes: transfer.receivedBytes,
        totalBytes: transfer.size,
        size: transfer.size,
        progressPercent: Math.min(progressPercent, 100)
      });

      // Check if single file download is complete
      if (transfer.receivedChunksCount === transfer.totalChunks && !transfer.isCompleted) {
        transfer.isCompleted = true;
        await this._finalizeFileDownload(fileId);
      }
    } catch (err) {
      console.error(`[TransferManager] Decryption failed for chunk ${chunkIndex} of file ${fileId}. Key mismatch!`, err);
      this._emitEvent('decryption-error', { fileId, error: 'Encryption key mismatch or corrupted chunk' });
    }
  }

  /**
   * Finalize received file download, verify SHA-256 hash, and play success sound.
   */
  async _finalizeFileDownload(fileId) {
    const transfer = this.incomingTransfers.get(fileId);
    if (!transfer) return;

    // Combine decrypted chunks into a single Blob
    const blob = new Blob(transfer.chunks, { type: transfer.type || 'application/zip' });
    const downloadUrl = URL.createObjectURL(blob);
    transfer.downloadUrl = downloadUrl;

    // Compute SHA-256 verification if hash available
    if (transfer.sha256) {
      const fullBuffer = await blob.arrayBuffer();
      const computedHash = await computeSHA256(fullBuffer);
      transfer.sha256Match = (computedHash === transfer.sha256);
      console.log(`[EncryptDrop Checksum] File ${transfer.name} SHA-256 Match:`, transfer.sha256Match);
    }

    playCompleteChime();
    triggerHapticSuccess();

    this._emitEvent('file-complete', {
      fileId,
      name: transfer.name,
      path: transfer.path,
      size: transfer.size,
      type: transfer.type,
      downloadUrl,
      sha256Match: transfer.sha256Match
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

  resumeTransfer(fileId, fromChunkIndex = 0, notifyPeer = true) {
    const outgoing = this.outgoingTransfers.get(fileId);
    if (outgoing) {
      outgoing.isPaused = false;
      this.streamFile(fileId, fromChunkIndex || outgoing.currentChunk);
    }

    const incoming = this.incomingTransfers.get(fileId);
    if (incoming) {
      incoming.isPaused = false;
    }

    if (notifyPeer && this.webrtc) {
      this.webrtc.send(JSON.stringify({
        type: 'RESUME',
        fileId,
        fromChunkIndex: outgoing ? outgoing.currentChunk : 0
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
      incoming.chunks = []; // Wipe RAM buffers
    }

    if (notifyPeer && this.webrtc) {
      this.webrtc.send(JSON.stringify({ type: 'CANCEL', fileId }));
    }
    this._emitEvent('transfer-canceled', { fileId });
  }

  _waitForBufferLow() {
    return new Promise((resolve) => {
      if (!this.webrtc || this.webrtc.isBufferLow()) {
        resolve();
      } else {
        const checkInterval = setInterval(() => {
          if (!this.webrtc || this.webrtc.isBufferLow()) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 20);
      }
    });
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  _emitEvent(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  /**
   * Revoke all Blob URLs and purge memory buffers on session disconnect.
   */
  clear() {
    for (const [, transfer] of this.incomingTransfers) {
      if (transfer.downloadUrl) {
        URL.revokeObjectURL(transfer.downloadUrl);
      }
      transfer.chunks = [];
    }
    this.outgoingTransfers.clear();
    this.incomingTransfers.clear();
    this.callbacks = {};
  }
}
