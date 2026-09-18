/**
 * EncryptDrop Signaling Server (RAM-Only / Zero-DB)
 * Relays WebRTC SDP offers, answers, and ICE candidates between peers.
 */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Rooms state in RAM only: Map<sessionId, Set<socketId>>
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log(`[EncryptDrop Signaling] Client connected: ${socket.id}`);

  // 1. Create or Host a Session Room
  socket.on('create-room', ({ sessionId }) => {
    socket.join(sessionId);
    if (!activeRooms.has(sessionId)) {
      activeRooms.set(sessionId, new Set());
    }
    activeRooms.get(sessionId).add(socket.id);
    socket.emit('room-created', { sessionId, peerId: socket.id });
    console.log(`[EncryptDrop Signaling] Room created: ${sessionId} by ${socket.id}`);
  });

  // 2. Join an Existing Session Room
  socket.on('join-room', ({ sessionId }) => {
    const room = activeRooms.get(sessionId);
    if (!room || room.size === 0) {
      socket.emit('room-error', { message: 'Session ID not found or expired.' });
      return;
    }

    if (room.size >= 2) {
      socket.emit('room-error', { message: 'Session room is full (Max 2 peers allowed).' });
      return;
    }

    socket.join(sessionId);
    room.add(socket.id);

    // Notify existing peer in room to initiate WebRTC SDP offer
    socket.to(sessionId).emit('peer-joined', { peerId: socket.id });
    socket.emit('room-joined', { sessionId, peerId: socket.id });
    console.log(`[EncryptDrop Signaling] Peer ${socket.id} joined room: ${sessionId}`);
  });

  // 3. Relay WebRTC Signal Payload (Offer, Answer, ICE Candidates)
  socket.on('signal', ({ sessionId, targetPeerId, signalData }) => {
    socket.to(sessionId).emit('signal', {
      senderPeerId: socket.id,
      signalData
    });
  });

  // 4. End Session Signal
  socket.on('end-session', ({ sessionId }) => {
    socket.to(sessionId).emit('peer-left', { peerId: socket.id });
    if (activeRooms.has(sessionId)) {
      activeRooms.delete(sessionId);
    }
  });

  // 5. Leave / Disconnect
  socket.on('disconnecting', () => {
    for (const sessionId of socket.rooms) {
      if (sessionId !== socket.id && activeRooms.has(sessionId)) {
        const room = activeRooms.get(sessionId);
        room.delete(socket.id);
        socket.to(sessionId).emit('peer-left', { peerId: socket.id });
        if (room.size === 0) {
          activeRooms.delete(sessionId);
          console.log(`[EncryptDrop Signaling] Room purged from RAM: ${sessionId}`);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[EncryptDrop Signaling] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`⚡ EncryptDrop Signaling Server running on http://localhost:${PORT}`);
});
