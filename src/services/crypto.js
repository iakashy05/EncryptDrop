/**
 * EncryptDrop Checksum & Hash Utility
 * Uses Web Crypto API for hardware-accelerated SHA-256 verification.
 */

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
