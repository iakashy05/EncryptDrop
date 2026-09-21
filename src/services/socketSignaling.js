/**
 * EncryptDrop Socket Signaling Service
 * Manages WebSocket connection to signaling server for initial WebRTC handshakes.
 */
import { io } from 'socket.io-client';

class SocketSignalingService {
  constructor() {
    this.socket = null;
    this.sessionId = null;
    this.callbacks = {};
  }

  /**
   * Connect to signaling server.
   * @param {string} serverUrl 
   */
  connect(serverUrl = window.location.origin.replace(/^http/, 'ws')) {
    if (this.socket) {
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return;
    }

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true
    });

    this.socket.on('connect', () => {
      console.log('[EncryptDrop Signaling] Socket connected:', this.socket.id);
      if (this.sessionId) {
        if (this.isHost) {
          this.socket.emit('create-room', { sessionId: this.sessionId });
        } else {
          this.socket.emit('join-room', { sessionId: this.sessionId });
        }
      }
    });

    this.socket.on('room-created', (data) => this._emitEvent('room-created', data));
    this.socket.on('room-joined', (data) => this._emitEvent('room-joined', data));
    this.socket.on('peer-joined', (data) => this._emitEvent('peer-joined', data));
    this.socket.on('signal', (data) => this._emitEvent('signal', data));
    this.socket.on('peer-left', (data) => this._emitEvent('peer-left', data));
    this.socket.on('room-error', (data) => this._emitEvent('room-error', data));
  }

  createRoom(sessionId) {
    this.sessionId = sessionId;
    this.isHost = true;
    if (this.socket) {
      this.socket.emit('create-room', { sessionId });
    }
  }

  joinRoom(sessionId) {
    this.sessionId = sessionId;
    this.isHost = false;
    if (this.socket) {
      this.socket.emit('join-room', { sessionId });
    }
  }

  sendSignal(signalData) {
    if (this.socket && this.sessionId) {
      this.socket.emit('signal', {
        sessionId: this.sessionId,
        signalData
      });
    }
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  _emitEvent(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.sessionId = null;
      this.callbacks = {};
    }
  }
}

export const signalingService = new SocketSignalingService();
