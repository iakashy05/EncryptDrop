/**
 * EncryptDrop WebRTC P2P Connection & DataChannel Engine
 * Handles peer connections, STUN candidates, backpressure throttling, and raw binary streaming.
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export class WebRTCManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.callbacks = {};
    this.MAX_BUFFER = 8 * 1024 * 1024; // 8MB high watermark threshold for high-speed pipelining
    this.LOW_BUFFER = 1024 * 1024;     // 1MB low watermark threshold
  }

  /**
   * Initialize RTCPeerConnection and wire up ICE candidate handlers.
   * @param {Function} onIceCandidate 
   */
  initPeerConnection(onIceCandidate) {
    if (this.peerConnection) return;

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && onIceCandidate) {
        onIceCandidate(event.candidate);
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      console.log('[WebRTC] Incoming DataChannel received:', event.channel.label);
      this._setupDataChannel(event.channel);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state changed:', this.peerConnection.connectionState);
      this._emitEvent('connection-state', this.peerConnection.connectionState);
    };
  }

  /**
   * Create an outgoing DataChannel (Host mode).
   * @param {string} label 
   */
  createDataChannel(label = 'encryptdrop-transfer-channel') {
    if (!this.peerConnection) return;
    const channel = this.peerConnection.createDataChannel(label, {
      ordered: false // Unordered reliable mode: eliminates Head-of-Line blocking for maximum speed
    });
    this._setupDataChannel(channel);
  }

  _setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.LOW_BUFFER;

    this.dataChannel.onopen = () => {
      console.log('[WebRTC] DataChannel connected & OPEN!');
      this._emitEvent('channel-open');
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTC] DataChannel CLOSED.');
      this._emitEvent('channel-close');
    };

    this.dataChannel.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err);
      this._emitEvent('channel-error', err);
    };

    this.dataChannel.onmessage = (event) => {
      this._emitEvent('message', event.data);
    };

    this.dataChannel.onbufferedamountlow = () => {
      this._emitEvent('buffered-amount-low');
    };
  }

  /**
   * Generate SDP Offer.
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async createOffer() {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  /**
   * Process incoming SDP Offer and generate SDP Answer.
   * @param {RTCSessionDescriptionInit} offer 
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async handleOfferAndCreateAnswer(offer) {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  /**
   * Process incoming SDP Answer.
   * @param {RTCSessionDescriptionInit} answer 
   */
  async handleAnswer(answer) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Process incoming ICE candidate.
   * @param {RTCIceCandidateInit} candidate 
   */
  async addIceCandidate(candidate) {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[WebRTC] Failed to add ICE candidate:', e);
    }
  }

  /**
   * Send binary payload or string JSON over DataChannel with backpressure check.
   * @param {ArrayBuffer|string} data 
   * @returns {boolean} returns false if buffer is high and sender should wait
   */
  send(data) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }

    this.dataChannel.send(data);
    return this.dataChannel.bufferedAmount < this.MAX_BUFFER;
  }

  /**
   * Check if channel buffer is low and ready for more chunks.
   * @returns {boolean}
   */
  isBufferLow() {
    if (!this.dataChannel) return true;
    return this.dataChannel.bufferedAmount <= this.LOW_BUFFER;
  }

  /**
   * Check if channel buffer is full (reached 8MB ceiling).
   * @returns {boolean}
   */
  isBufferFull() {
    if (!this.dataChannel) return false;
    return this.dataChannel.bufferedAmount >= this.MAX_BUFFER;
  }

  /**
   * Zero-delay Promise resolving on native bufferedamountlow event.
   * @returns {Promise<void>}
   */
  waitForBufferLow() {
    if (!this.dataChannel || this.isBufferLow()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let resolved = false;
      const onLow = () => {
        if (!resolved) {
          resolved = true;
          if (this.dataChannel) {
            this.dataChannel.removeEventListener('bufferedamountlow', onLow);
          }
          resolve();
        }
      };

      if (this.dataChannel) {
        this.dataChannel.addEventListener('bufferedamountlow', onLow, { once: true });
      } else {
        resolve();
      }

      // Safety timeout in case event is delayed
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (this.dataChannel) {
            this.dataChannel.removeEventListener('bufferedamountlow', onLow);
          }
          resolve();
        }
      }, 100);
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

  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.callbacks = {};
  }
}
