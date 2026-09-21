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

// Clean 6-character uppercase alphanumeric code (unambiguous charset)
const generateSessionCode = () => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export default function App() {
  const [sessionId, setSessionId] = useState('');
  const [pairingUrl, setPairingUrl] = useState('');
  const [cryptoKey, setCryptoKey] = useState(null);
  const [keyHashStr, setKeyHashStr] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [connectionState, setConnectionState] = useState('Disconnected');
  const [transfers, setTransfers] = useState([]);
  const [speedMbps, setSpeedMbps] = useState(0);

  const webrtcRef = useRef(null);
  const transferManagerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const speedIntervalRef = useRef(null);
  const disconnectTimerRef = useRef(null);

  // Clean address bar (removes #key=... and ?session=... from browser bar without reload)
  const cleanAddressBar = useCallback(() => {
    if (window.location.hash.includes('key=') || window.location.search.includes('session=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Save active session to sessionStorage for seamless refresh reconnection
  const saveSessionToStorage = (sid, keyStr, isHost) => {
    try {
      if (sid) {
        sessionStorage.setItem('encryptdrop_active_session', JSON.stringify({
          sessionId: sid,
          keyHash: keyStr || '',
          isHost: !!isHost,
          savedAt: Date.now()
        }));
      }
    } catch (err) {
      console.warn('[EncryptDrop] Could not write session to sessionStorage:', err);
    }
  };

  const clearSessionFromStorage = () => {
    try {
      sessionStorage.removeItem('encryptdrop_active_session');
    } catch (err) {
      console.warn('[EncryptDrop] Could not clear sessionStorage:', err);
    }
  };

  // Initialize or Host a Session Room
  const handleHostSession = useCallback(async (existingId = null, existingKeyHash = null) => {
    setIsJoining(false);
    setJoinError('');
    const newSessionId = existingId || generateSessionCode();
    setSessionId(newSessionId);

    let key = null;
    let keyHash = existingKeyHash || '';

    if (existingKeyHash) {
      try {
        key = await importKeyFromHash(existingKeyHash);
      } catch (err) {
        console.warn('[EncryptDrop] Failed to import existing key hash:', err);
      }
    }

    if (!key) {
      key = await generateAESKey();
      keyHash = await exportKeyToHash(key);
    }

    setCryptoKey(key);
    setKeyHashStr(keyHash);

    const fullUrl = `${window.location.origin}${window.location.pathname}?session=${newSessionId}#key=${keyHash}`;
    setPairingUrl(fullUrl);

    // Save session memory
    saveSessionToStorage(newSessionId, keyHash, true);

    cleanAddressBar();
    initP2P(newSessionId, key, true, keyHash);
  }, [cleanAddressBar]);

  // Join an Existing Session Room
  const handleJoinSession = useCallback(async (targetInput, directKeyHash = null) => {
    let targetSessionId = targetInput ? targetInput.trim() : '';
    let keyHash = directKeyHash || '';

    if (targetInput.includes('key=')) {
      keyHash = targetInput.split('key=')[1].split('&')[0];
    } else if (window.location.hash.includes('key=')) {
      keyHash = window.location.hash.split('key=')[1].split('&')[0];
    }

    if (targetInput.includes('session=')) {
      try {
        const urlObj = new URL(targetInput.startsWith('http') ? targetInput : `https://${targetInput}`);
        targetSessionId = urlObj.searchParams.get('session') || targetSessionId;
      } catch {
        const match = targetInput.match(/session=([A-Za-z0-9]+)/);
        if (match) targetSessionId = match[1];
      }
    }

    targetSessionId = targetSessionId.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setSessionId(targetSessionId);
    setIsJoining(true);
    setJoinError('');
    setConnectionState('Connecting...');

    let key = null;
    if (keyHash) {
      try {
        key = await importKeyFromHash(keyHash);
        setCryptoKey(key);
        setKeyHashStr(keyHash);
      } catch (err) {
        console.warn('[EncryptDrop] Could not parse key from hash, waiting for host key-sync:', err);
      }
    }

    // Save session memory
    saveSessionToStorage(targetSessionId, keyHash, false);

    cleanAddressBar();
    initP2P(targetSessionId, key, false, keyHash);
  }, [cleanAddressBar]);

  const handleCancelJoin = () => {
    setIsJoining(false);
    setJoinError('');
    clearSessionFromStorage();
    if (webrtcRef.current) webrtcRef.current.close();
    signalingService.disconnect();
    window.history.replaceState(null, '', window.location.pathname);
    handleHostSession();
  };

  // Warn user before accidental refresh or tab close during active session or transfer
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const hasActiveTransfers = transfers.some((t) => !t.isCompleted && !t.isCanceled);
      if (isConnected || hasActiveTransfers) {
        e.preventDefault();
        e.returnValue = 'You have an active session or ongoing file transfer. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isConnected, transfers]);

  // Read URL params on page load for one-click QR join or restore from sessionStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');

    // 1. Direct QR scan or shared link in URL
    if (sessionParam) {
      setIsJoining(true);
      handleJoinSession(sessionParam);
      return;
    }

    // 2. Reconnection memory from sessionStorage (e.g. accidental page refresh)
    try {
      const stored = sessionStorage.getItem('encryptdrop_active_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Valid if within 10 minutes
        if (parsed.sessionId && Date.now() - (parsed.savedAt || 0) < 10 * 60 * 1000) {
          console.log('[EncryptDrop App] Auto-reconnecting restored session:', parsed.sessionId);
          if (parsed.isHost) {
            handleHostSession(parsed.sessionId, parsed.keyHash);
            return;
          } else {
            handleJoinSession(parsed.sessionId, parsed.keyHash);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[EncryptDrop App] Error reading sessionStorage:', err);
    }

    // 3. Fallback: Host a fresh session
    handleHostSession();
  }, []);

  // Setup WebRTC and Socket Signaling
  const initP2P = (roomSessionId, key, isHost, hostKeyHash) => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

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
    signalingService.on('room-error', ({ message }) => {
      console.warn('[EncryptDrop App] Room error from signaling:', message);
      setJoinError(message || 'Room not found or expired.');
      setConnectionState('Error');
    });

    signalingService.on('room-joined', () => {
      console.log('[EncryptDrop App] Joined signaling room, waiting for peer...');
      setConnectionState('Connecting to Peer...');
    });

    signalingService.on('peer-joined', async () => {
      console.log('[EncryptDrop App] Peer joined room! Syncing key & Creating SDP offer...');
      if (hostKeyHash) {
        signalingService.sendSignal({ type: 'key-sync', keyHash: hostKeyHash });
      }

      webrtc.createDataChannel('encryptdrop-data');
      const offer = await webrtc.createOffer();
      signalingService.sendSignal({ type: 'offer', offer });
    });

    // Handle peer left with explicit check:
    // If WebRTC DataChannel is actively OPEN, do NOT disconnect on temporary socket hiccups
    signalingService.on('peer-left', ({ explicit }) => {
      console.log('[EncryptDrop App] Signaling peer-left received. Explicit:', explicit);
      if (webrtc.dataChannel && webrtc.dataChannel.readyState === 'open' && !explicit) {
        console.log('[EncryptDrop App] DataChannel is active; ignoring temporary signaling disconnect.');
        return;
      }
      playDisconnectChime();
      cleanupAndResetSession(true);
    });

    signalingService.on('signal', async ({ signalData }) => {
      if (signalData.type === 'key-sync' && signalData.keyHash) {
        console.log('[EncryptDrop App] Received key-sync from Host:', signalData.keyHash);
        const importedKey = await importKeyFromHash(signalData.keyHash);
        setCryptoKey(importedKey);
        setKeyHashStr(signalData.keyHash);
        saveSessionToStorage(roomSessionId, signalData.keyHash, isHost);
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
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setIsConnected(true);
      setIsJoining(false);
      setJoinError('');
      setConnectionState('Connected');
      playConnectChime();
      triggerHapticSuccess();
      startSpeedMeter();
    });

    webrtc.on('channel-close', () => {
      console.log('[EncryptDrop App] DataChannel Closed.');
      playDisconnectChime();
      cleanupAndResetSession(true);
    });

    webrtc.on('connection-state', (state) => {
      console.log('[EncryptDrop App] WebRTC connection-state:', state);
      if (state === 'connected') {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setConnectionState('Connected');
      } else if (state === 'disconnected') {
        // Temporary interruption (e.g. mobile photo picker opened in background)
        // Give it 15 seconds to self-heal before considering it dead
        setConnectionState('Reconnecting...');
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => {
            console.log('[EncryptDrop App] WebRTC reconnection grace period expired.');
            playDisconnectChime();
            cleanupAndResetSession(true);
          }, 15000);
        }
      } else if (state === 'failed' || state === 'closed') {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setConnectionState('Disconnected');
        if (isConnected) {
          playDisconnectChime();
          cleanupAndResetSession(true);
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
          progressPercent: 0,
          isPaused: false,
          isCompleted: false,
          isCanceled: false
        }))
      ]);
    });

    transferManager.on('file-complete', ({ fileId, downloadUrl, sha256Match }) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.fileId === fileId
            ? { ...t, isCompleted: true, progressPercent: 100, downloadUrl, sha256Match }
            : t
        )
      );
    });
  };

  // Speedometer calculation
  const startSpeedMeter = () => {
    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
    speedIntervalRef.current = setInterval(() => {
      if (transferManagerRef.current) {
        const currentBytes = transferManagerRef.current.getTotalTransferredBytes();
        const deltaBytes = currentBytes - lastBytesRef.current;
        lastBytesRef.current = currentBytes;
        const mbps = ((deltaBytes * 8) / (1024 * 1024)).toFixed(1);
        setSpeedMbps(parseFloat(mbps));
      }
    }, 1000);
  };

  // Send selected file list / folder
  const handleSendFiles = async (fileList) => {
    if (!transferManagerRef.current || !isConnected) return;

    try {
      const items = await transferManagerRef.current.prepareFiles(fileList);
      setTransfers((prev) => [
        ...prev,
        ...items.map((item) => ({
          fileId: item.fileId,
          name: item.name,
          size: item.size,
          direction: 'upload',
          sentBytes: 0,
          totalBytes: item.size,
          progressPercent: 0,
          isPaused: false,
          isCompleted: false,
          isCanceled: false
        }))
      ]);

      await transferManagerRef.current.sendFiles(items);
    } catch (err) {
      console.error('[EncryptDrop App] Error sending files:', err);
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

  const cleanupAndResetSession = (isExplicitEnd = false) => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

    if (transferManagerRef.current) transferManagerRef.current.clear();
    if (webrtcRef.current) webrtcRef.current.close();
    signalingService.disconnect();

    if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);

    setIsConnected(false);
    setIsJoining(false);
    setJoinError('');
    setConnectionState('Disconnected');
    setTransfers([]);
    setSpeedMbps(0);
    window.history.replaceState(null, '', window.location.pathname);

    if (isExplicitEnd) {
      clearSessionFromStorage();
      handleHostSession();
    }
  };

  const handleEndSession = () => {
    playDisconnectChime();
    clearSessionFromStorage();
    if (signalingService.socket && sessionId) {
      signalingService.socket.emit('end-session', { sessionId });
    }
    cleanupAndResetSession(true);
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
            isJoining={isJoining}
            joinError={joinError}
            onHostSession={handleHostSession}
            onJoinSession={handleJoinSession}
            onCancelJoin={handleCancelJoin}
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
