/**
 * EncryptDrop Crypto Engine
 * Web Crypto API (AES-256-GCM) & SHA-256 Checksum Module
 */

/**
 * Generate a new 256-bit AES-GCM symmetric key.
 * @returns {Promise<CryptoKey>}
 */
export async function generateAESKey() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true, // extractable for URL hash encoding
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a URL-safe Base64 String for QR Code hash fragments.
 * @param {CryptoKey} key 
 * @returns {Promise<string>}
 */
export async function exportKeyToHash(key) {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  const byteArray = new Uint8Array(exported);
  let binaryString = '';
  for (let i = 0; i < byteArray.byteLength; i++) {
    binaryString += String.fromCharCode(byteArray[i]);
  }
  return btoa(binaryString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Import a Base64URL string back into an AES-GCM CryptoKey.
 * @param {string} keyString 
 * @returns {Promise<CryptoKey>}
 */
export async function importKeyFromHash(keyString) {
  // Pad base64url string
  let base64 = keyString.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    'raw',
    bytes.buffer,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a 12-byte IV (Initialization Vector) deterministically from fileId & chunkIndex.
 * @param {string} fileId 
 * @param {number} chunkIndex 
 * @returns {Uint8Array}
 */
export function deriveChunkIV(fileId, chunkIndex) {
  const iv = new Uint8Array(12); // AES-GCM standard IV length
  const encoder = new TextEncoder();
  const fileBytes = encoder.encode(fileId);
  
  for (let i = 0; i < 8; i++) {
    iv[i] = fileBytes[i % fileBytes.length] || i;
  }
  
  iv[8] = (chunkIndex >> 24) & 0xff;
  iv[9] = (chunkIndex >> 16) & 0xff;
  iv[10] = (chunkIndex >> 8) & 0xff;
  iv[11] = chunkIndex & 0xff;

  return iv;
}

/**
 * Encrypt a single binary ArrayBuffer chunk using AES-GCM.
 * @param {ArrayBuffer} arrayBuffer 
 * @param {CryptoKey} key 
 * @param {Uint8Array} iv 
 * @returns {Promise<ArrayBuffer>}
 */
export async function encryptChunk(arrayBuffer, key, iv) {
  return await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    arrayBuffer
  );
}

/**
 * Decrypt a single binary ArrayBuffer chunk using AES-GCM.
 * @param {ArrayBuffer} cipherBuffer 
 * @param {CryptoKey} key 
 * @param {Uint8Array} iv 
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptChunk(cipherBuffer, key, iv) {
  return await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    cipherBuffer
  );
}

/**
 * Compute SHA-256 Hex Hash of an ArrayBuffer for bit-exact verification.
 * @param {ArrayBuffer} arrayBuffer 
 * @returns {Promise<string>}
 */
export async function computeSHA256(arrayBuffer) {
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
