import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from './components/Navbar';
import SessionPairing from './components/SessionPairing';
import FileSelector from './components/FileSelector';
import TransferProgress from './components/TransferProgress';
import { FiDownload } from 'react-icons/fi';

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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function App() {
  const [sessionId, setSessionId] = useState('');
  const [pairingUrl, setPairingUrl] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [connectionState, setConnectionState] = useState('Disconnected');
  const [transfers, setTransfers] = useState([]);
  const [speedMbps, setSpeedMbps] = useState(0);

  // App-Level Security: Transfer Approval state
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);

  const webrtcRef = useRef(null);
  const transferManagerRef = useRef(null);
  const lastBytesRef = useRef(0);
  const speedIntervalRef = useRef(null);
  const disconnectTimerRef = useRef(null);

  // Clean address bar (removes ?session=... from browser bar without reload)
  const cleanAddressBar = useCallback(() => {
    if (window.location.search.includes('session=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // Save active session to sessionStorage for seamless refresh reconnection
  const saveSessionToStorage = (sid, isHost) => {
    try {
      if (sid) {
        sessionStorage.setItem('encryptdrop_active_session', JSON.stringify({
          sessionId: sid,
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
  const handleHostSession = useCallback(async (existingId = null) => {
    setIsJoining(false);
    setJoinError('');
    const newSessionId = existingId || generateSessionCode();
    setSessionId(newSessionId);

    // Clean, short URL without long cryptographic hashes
    const fullUrl = `${window.location.origin}${window.location.pathname}?session=${newSessionId}`;
    setPairingUrl(fullUrl);

    // Save session memory
    saveSessionToStorage(newSessionId, true);

    cleanAddressBar();
    initP2P(newSessionId, true);
  }, [cleanAddressBar]);

  // Join an Existing Session Room
  const handleJoinSession = useCallback(async (targetInput) => {
    let targetSessionId = targetInput ? targetInput.trim() : '';

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

    // Save session memory
    saveSessionToStorage(targetSessionId, false);

    cleanAddressBar();
    initP2P(targetSessionId, false);
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
        if (parsed.sessionId && Date.now() - (parsed.savedAt || 0) < 10 * 60 * 1000) {
          console.log('[EncryptDrop App] Auto-reconnecting restored session:', parsed.sessionId);
          if (parsed.isHost) {
            handleHostSession(parsed.sessionId);
            return;
          } else {
            handleJoinSession(parsed.sessionId);
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
  const initP2P = (roomSessionId, isHost) => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

    // Clear previous connections
    if (webrtcRef.current) webrtcRef.current.close();

    const webrtc = new WebRTCManager();
    webrtcRef.current = webrtc;

    const transferManager = new TransferManager(webrtc);
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
      console.log('[EncryptDrop App] Peer joined room! Creating SDP offer...');
      webrtc.createDataChannel('encryptdrop-data');
      const offer = await webrtc.createOffer();
      signalingService.sendSignal({ type: 'offer', offer });
    });

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
      if (signalData.type === 'offer') {
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

    // App-Level Security: Transfer Approval Events
    transferManager.on('incoming-request', (data) => {
      console.log('[EncryptDrop App] Received incoming transfer request:', data);
      setIncomingRequest(data);
    });

    transferManager.on('waiting-approval', () => {
      setIsWaitingApproval(true);
    });

    transferManager.on('transfer-accepted', () => {
      setIsWaitingApproval(false);
    });

    transferManager.on('transfer-rejected', () => {
      setIsWaitingApproval(false);
      alert('File transfer request was declined by the recipient.');
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

    transferManager.on('file-complete', ({ fileId, downloadUrl }) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.fileId === fileId
            ? { ...t, isCompleted: true, progressPercent: 100, downloadUrl }
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
        // Real MegaBytes per second (MB/s)
        const mbPerSec = (deltaBytes / (1024 * 1024)).toFixed(1);
        setSpeedMbps(parseFloat(mbPerSec));
      }
    }, 1000);
  };

  // Send selected file list / folder
  const handleSendFiles = async (fileList) => {
    if (!transferManagerRef.current || !isConnected) return;

    try {
      const manifest = await transferManagerRef.current.buildFolderManifest(fileList);
      setTransfers((prev) => [
        ...prev,
        ...manifest.map((item) => ({
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

      await transferManagerRef.current.requestSendFiles(fileList);
    } catch (err) {
      console.error('[EncryptDrop App] Error initiating file transfer:', err);
    }
  };

  // Transfer Approval Actions
  const handleAcceptTransfer = (batchId) => {
    if (transferManagerRef.current) {
      transferManagerRef.current.acceptTransfer(batchId);
    }
    setIncomingRequest(null);
  };

  const handleRejectTransfer = (batchId) => {
    if (transferManagerRef.current) {
      transferManagerRef.current.rejectTransfer(batchId);
    }
    setIncomingRequest(null);
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
    setIncomingRequest(null);
    setIsWaitingApproval(false);
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

            {/* Waiting for Recipient Approval Banner */}
            {isWaitingApproval && (
              <div className="max-w-md mx-auto p-3.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-300 text-xs flex items-center justify-center space-x-2.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-sky-400" />
                <span>Waiting for recipient to accept file transfer...</span>
              </div>
            )}

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

      {/* Quick Share / AirDrop Style Transfer Approval Modal */}
      {incomingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#121824] border border-slate-700/80 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                <FiDownload className="w-6 h-6" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-base font-semibold text-slate-100">Incoming File Transfer</h3>
                <p className="text-xs text-slate-400">
                  {incomingRequest.files.length} file{incomingRequest.files.length > 1 ? 's' : ''} • {formatBytes(incomingRequest.totalSize)}
                </p>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-2 pr-1 bg-[#0b0f17] p-3.5 rounded-xl border border-slate-800">
              {incomingRequest.files.map((f, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1 first:pt-0 last:pb-0">
                  <span className="text-slate-200 truncate max-w-[220px] font-medium">{f.name}</span>
                  <span className="text-slate-500 font-mono text-[11px] shrink-0 ml-2">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center space-x-3 pt-1">
              <button
                onClick={() => handleRejectTransfer(incomingRequest.batchId)}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition-colors"
              >
                Decline
              </button>
              <button
                onClick={() => handleAcceptTransfer(incomingRequest.batchId)}
                className="flex-1 py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl transition-colors shadow-lg shadow-sky-600/20"
              >
                Accept & Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
