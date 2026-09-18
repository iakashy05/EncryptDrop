import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from './components/Navbar';
import SessionPairing from './components/SessionPairing';
import FileSelector from './components/FileSelector';
import TransferProgress from './components/TransferProgress';

import { generateAESKey, exportKeyToHash, importKeyFromHash } from './services/crypto';
import { signalingService } from './services/socketSignaling';
import { WebRTCManager } from './services/webrtc';
import { TransferManager } from './services/transferManager';
import { playConnectChime, playDisconnectChime, triggerHapticSuccess } from './services/audioHaptics';

export default function App() {
  const [sessionId, setSessionId] = useState('');
  const [pairingUrl, setPairingUrl] = useState('');
  const [cryptoKey, setCryptoKey] = useState(null);
  const [keyHashStr, setKeyHashStr] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('Disconnected');
  const [transfers, setTransfers] = useState([]);
  const [speedMbps, setSpeedMbps] = useState(0);

  const webrtcRef = useRef(null);
  const transferManagerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const speedIntervalRef = useRef(null);

  // Clean address bar (removes #key=... after importing key into RAM)
  const cleanAddressBar = useCallback(() => {
    if (window.location.hash.includes('key=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Initialize or Host a Session Room
  const handleHostSession = useCallback(async () => {
    const newSessionId = `encryptdrop_${Math.random().toString(36).substring(2, 8)}`;
    setSessionId(newSessionId);

    // Generate AES key and export to Hash
    const key = await generateAESKey();
    setCryptoKey(key);
    const keyHash = await exportKeyToHash(key);
    setKeyHashStr(keyHash);

    const fullUrl = `${window.location.origin}${window.location.pathname}?session=${newSessionId}#key=${keyHash}`;
    setPairingUrl(fullUrl);

    // Clean URL bar while preserving key in memory
    cleanAddressBar();

    // Initialize WebRTC & Signaling
    initP2P(newSessionId, key, true, keyHash);
  }, [cleanAddressBar]);

  // Join an Existing Session Room
  const handleJoinSession = useCallback(async (targetInput) => {
    let targetSessionId = targetInput;
    let keyHash = '';

    // If input is full URL or contains hash
    if (targetInput.includes('key=')) {
      keyHash = targetInput.split('key=')[1].split('&')[0];
    } else if (window.location.hash.includes('key=')) {
      keyHash = window.location.hash.split('key=')[1].split('&')[0];
    }

    if (targetInput.includes('session=')) {
      const urlObj = new URL(targetInput);
      targetSessionId = urlObj.searchParams.get('session') || targetInput;
    }

    setSessionId(targetSessionId);

    let key = null;
    if (keyHash) {
      key = await importKeyFromHash(keyHash);
      setCryptoKey(key);
      setKeyHashStr(keyHash);
    }

    cleanAddressBar();

    initP2P(targetSessionId, key, false, keyHash);
  }, [cleanAddressBar]);

  // Read URL params on page load for one-click QR join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
      handleJoinSession(sessionParam);
    } else {
      handleHostSession();
    }
  }, []);

  // Setup WebRTC and Socket Signaling
  const initP2P = (roomSessionId, key, isHost, hostKeyHash) => {
    // Clear previous connections
    if (webrtcRef.current) webrtcRef.current.close();

    const webrtc = new WebRTCManager();
    webrtcRef.current = webrtc;

    const transferManager = new TransferManager(webrtc, key);
    transferManagerRef.current = transferManager;

    // Dynamically connect to signaling server (Vercel env or local host IP fallback)
    const hostname = window.location.hostname || 'localhost';
    const signalingUrl = import.meta.env.VITE_SIGNALING_URL || `http://${hostname}:3001`;
    signalingService.connect(signalingUrl);

    webrtc.initPeerConnection((candidate) => {
      signalingService.sendSignal({ type: 'candidate', candidate });
    });

    if (isHost) {
      signalingService.createRoom(roomSessionId);
    } else {
      signalingService.joinRoom(roomSessionId);
    }

    // Signaling Callbacks
    signalingService.on('peer-joined', async () => {
      console.log('[EncryptDrop App] Peer joined room! Syncing key & Creating SDP offer...');
      if (hostKeyHash) {
        signalingService.sendSignal({ type: 'key-sync', keyHash: hostKeyHash });
      }

      webrtc.createDataChannel('encryptdrop-data');
      const offer = await webrtc.createOffer();
      signalingService.sendSignal({ type: 'offer', offer });
    });

    // Instant disconnect when remote peer leaves session
    signalingService.on('peer-left', () => {
      console.log('[EncryptDrop App] Peer left session! Disconnecting...');
      playDisconnectChime();
      cleanupAndResetSession();
    });

    signalingService.on('signal', async ({ signalData }) => {
      if (signalData.type === 'key-sync' && signalData.keyHash) {
        console.log('[EncryptDrop App] Received key-sync from Host:', signalData.keyHash);
        const importedKey = await importKeyFromHash(signalData.keyHash);
        setCryptoKey(importedKey);
        setKeyHashStr(signalData.keyHash);
        if (transferManagerRef.current) {
          transferManagerRef.current.setCryptoKey(importedKey);
        }
      } else if (signalData.type === 'offer') {
        const answer = await webrtc.handleOfferAndCreateAnswer(signalData.offer);
        signalingService.sendSignal({ type: 'answer', answer });
      } else if (signalData.type === 'answer') {
        await webrtc.handleAnswer(signalData.answer);
      } else if (signalData.type === 'candidate') {
        await webrtc.addIceCandidate(signalData.candidate);
      }
    });

    // WebRTC Events
    webrtc.on('channel-open', () => {
      console.log('[EncryptDrop App] DataChannel Connected & Ready!');
      setIsConnected(true);
      setConnectionState('Connected');
      playConnectChime();
      triggerHapticSuccess();
      startSpeedMeter();
    });

    webrtc.on('channel-close', () => {
      console.log('[EncryptDrop App] DataChannel Closed.');
      playDisconnectChime();
      cleanupAndResetSession();
    });

    webrtc.on('connection-state', (state) => {
      setConnectionState(state);
      if (state === 'failed' || state === 'closed' || state === 'disconnected') {
        if (isConnected) {
          playDisconnectChime();
          cleanupAndResetSession();
        }
      }
    });

    // Transfer Progress Events
    transferManager.on('progress', (data) => {
      setTransfers((prev) => {
        const existingIdx = prev.findIndex((t) => t.fileId === data.fileId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { ...updated[existingIdx], ...data };
          return updated;
        } else {
          return [...prev, data];
        }
      });
    });

    transferManager.on('batch-start', (files) => {
      setTransfers((prev) => [
        ...prev,
        ...files.map((f) => ({
          ...f,
          direction: 'download',
          receivedBytes: 0,
          totalBytes: f.size,
          progressPercent: 0
        }))
      ]);
    });

    transferManager.on('file-complete', (data) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.fileId === data.fileId
            ? {
                ...t,
                isCompleted: true,
                downloadUrl: data.downloadUrl,
                sha256Match: data.sha256Match
              }
            : t
        )
      );
    });

    transferManager.on('decryption-error', ({ fileId, error }) => {
      setTransfers((prev) =>
        prev.map((t) => (t.fileId === fileId ? { ...t, isCanceled: true, error } : t))
      );
    });
  };

  const startSpeedMeter = () => {
    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
    lastBytesRef.current = 0;

    speedIntervalRef.current = setInterval(() => {
      if (!transferManagerRef.current) return;
      let totalCurrentBytes = 0;

      for (const [, transfer] of transferManagerRef.current.outgoingTransfers) {
        totalCurrentBytes += transfer.sentBytes || 0;
      }
      for (const [, transfer] of transferManagerRef.current.incomingTransfers) {
        totalCurrentBytes += transfer.receivedBytes || 0;
      }

      const bytesDiff = totalCurrentBytes - lastBytesRef.current;
      lastBytesRef.current = totalCurrentBytes;
      const mbps = (bytesDiff / (1024 * 1024)); // MB/s
      setSpeedMbps(mbps);
    }, 1000);
  };

  const handleSendFiles = async (fileList) => {
    if (transferManagerRef.current) {
      await transferManagerRef.current.sendFiles(fileList);
    }
  };

  const handlePause = (fileId) => {
    if (transferManagerRef.current) {
      transferManagerRef.current.pauseTransfer(fileId);
      setTransfers((prev) =>
        prev.map((t) => (t.fileId === fileId ? { ...t, isPaused: true } : t))
      );
    }
  };

  const handleResume = (fileId) => {
    if (transferManagerRef.current) {
      transferManagerRef.current.resumeTransfer(fileId);
      setTransfers((prev) =>
        prev.map((t) => (t.fileId === fileId ? { ...t, isPaused: false } : t))
      );
    }
  };

  const handleCancel = (fileId) => {
    if (transferManagerRef.current) {
      transferManagerRef.current.cancelTransfer(fileId);
      setTransfers((prev) =>
        prev.map((t) => (t.fileId === fileId ? { ...t, isCanceled: true } : t))
      );
    }
  };

  const cleanupAndResetSession = () => {
    if (transferManagerRef.current) transferManagerRef.current.clear();
    if (webrtcRef.current) webrtcRef.current.close();
    signalingService.disconnect();

    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);

    setIsConnected(false);
    setConnectionState('Disconnected');
    setTransfers([]);
    setSpeedMbps(0);
    window.location.search = '';
    window.location.hash = '';

    handleHostSession();
  };

  const handleEndSession = () => {
    playDisconnectChime();
    if (signalingService.socket && sessionId) {
      signalingService.socket.emit('end-session', { sessionId });
    }
    cleanupAndResetSession();
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 pb-12 flex flex-col font-sans">
      <Navbar
        connectionState={connectionState}
        isConnected={isConnected}
        onEndSession={handleEndSession}
      />

      <main className="flex-1 px-4 py-6 max-w-5xl mx-auto w-full space-y-6">
        {!isConnected && (
          <SessionPairing
            sessionId={sessionId}
            pairingUrl={pairingUrl}
            onHostSession={handleHostSession}
            onJoinSession={handleJoinSession}
          />
        )}

        {isConnected && (
          <>
            <FileSelector onSendFiles={handleSendFiles} isConnected={isConnected} />
            <TransferProgress
              transfers={transfers}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
              speedMbps={speedMbps}
            />
          </>
        )}
      </main>
    </div>
  );
}
