import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  FiShare2,
  FiLogIn,
  FiCopy,
  FiCheck,
  FiLink,
  FiArrowRight,
  FiAlertCircle,
  FiShield,
  FiRefreshCw
} from 'react-icons/fi';

/**
 * Robust clipboard copy with fallback for all browser contexts (HTTP / HTTPS / mobile).
 */
async function copyTextToClipboard(textToCopy) {
  if (!textToCopy) return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(textToCopy);
      return true;
    }
  } catch (err) {
    console.warn('[Clipboard] Navigator clipboard failed, using fallback:', err);
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = textToCopy;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    console.error('[Clipboard] ExecCommand fallback failed:', err);
    return false;
  }
}

export default function SessionPairing({
  sessionId,
  pairingUrl,
  isJoining,
  joinError,
  onJoinSession,
  onHostSession,
  onCancelJoin
}) {
  const [activeTab, setActiveTab] = useState('share'); // 'share' | 'join'
  const [manualCode, setManualCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyCode = async () => {
    if (!sessionId) return;
    const ok = await copyTextToClipboard(sessionId);
    if (ok) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCopyLink = async () => {
    if (!pairingUrl) return;
    const ok = await copyTextToClipboard(pairingUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    // If user pasted a full URL
    if (raw.includes('session=')) {
      setManualCode(raw.trim());
      return;
    }
    // Auto-capitalize and keep only alphanumeric characters, max 6
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setManualCode(cleaned);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onJoinSession(manualCode.trim());
    }
  };

  // 1. DEDICATED CONNECTING VIEW (When joining via QR scan or URL)
  if (isJoining) {
    return (
      <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-[#121824]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl shadow-2xl flex flex-col items-center text-center space-y-6">
        <div className="relative flex items-center justify-center my-2">
          <div className="w-16 h-16 rounded-full bg-sky-500/10 border border-sky-500/30 flex items-center justify-center animate-pulse">
            <FiShield className="w-7 h-7 text-sky-400" />
          </div>
          <div className="absolute inset-0 rounded-full border border-sky-500/20 animate-ping" />
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-100">
            Connecting to Room
          </h3>
          <div className="inline-block px-4 py-1.5 bg-[#0b0f17] border border-slate-700/60 rounded-xl shadow-inner">
            <span className="font-mono text-xl font-bold tracking-[0.25em] text-sky-400">
              {sessionId || '------'}
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-xs mx-auto pt-1">
            Establishing direct peer-to-peer connection with peer...
          </p>
        </div>

        {joinError && (
          <div className="w-full p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
            <FiAlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="text-left flex-1">{joinError}</span>
          </div>
        )}

        <button
          onClick={onCancelJoin}
          className="px-4 py-2 bg-slate-800/90 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition-colors flex items-center space-x-2 border border-slate-700/50"
        >
          <FiRefreshCw className="w-3.5 h-3.5 text-slate-400" />
          <span>Cancel & Create New Room</span>
        </button>
      </div>
    );
  }

  // 2. STANDARD PAIRING VIEW (Share / Join Tabs)
  return (
    <div className="w-full max-w-md mx-auto p-5 sm:p-7 bg-[#121824]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl shadow-2xl space-y-6">
      {/* Header Tabs */}
      <div className="flex bg-[#0b0f17] p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('share')}
          className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center space-x-2 ${
            activeTab === 'share'
              ? 'bg-[#1e293b] text-slate-100 shadow-sm'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <FiShare2 className="w-3.5 h-3.5" />
          <span>Share Room</span>
        </button>
        <button
          onClick={() => setActiveTab('join')}
          className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center space-x-2 ${
            activeTab === 'join'
              ? 'bg-[#1e293b] text-slate-100 shadow-sm'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <FiLogIn className="w-3.5 h-3.5" />
          <span>Join with Code</span>
        </button>
      </div>

      {/* SHARE TAB CONTENT */}
      {activeTab === 'share' && (
        <div className="flex flex-col items-center text-center space-y-5">
          {/* High-Contrast Crisp QR Code */}
          <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-center max-w-full">
            {pairingUrl ? (
              <QRCodeSVG value={pairingUrl} size={170} level="M" includeMargin={false} className="max-w-full h-auto" />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-slate-400 text-xs">
                Generating room...
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">Scan QR Code</h3>
            <p className="text-xs text-slate-400 max-w-xs">
              Point your phone's camera to join instantly, or share the 6-character code below.
            </p>
          </div>

          {/* 6-Character Room Code & Actions */}
          <div className="w-full bg-[#0b0f17] p-4 rounded-xl border border-slate-800 flex flex-col items-center space-y-3">
            <div className="text-center">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold block mb-1">
                Room Code
              </span>
              <div className="text-2xl font-mono font-bold tracking-[0.25em] text-sky-400 select-all">
                {sessionId || '------'}
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full pt-1">
              <button
                onClick={handleCopyCode}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-all border border-slate-700/50 active:scale-95 shadow-sm"
                title="Copy 6-character code"
              >
                {copiedCode ? <FiCheck className="w-3.5 h-3.5 text-emerald-400" /> : <FiCopy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
              </button>

              <button
                onClick={handleCopyLink}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-all border border-slate-700/50 active:scale-95 shadow-sm"
                title="Copy share link"
              >
                {copiedLink ? <FiCheck className="w-3.5 h-3.5 text-emerald-400" /> : <FiLink className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN TAB CONTENT */}
      {activeTab === 'join' && (
        <div className="flex flex-col space-y-5">
          <div className="text-center space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">Enter Room Code</h3>
            <p className="text-xs text-slate-400">
              Enter the 6-character code from the host device or paste a share link.
            </p>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="space-y-1">
              <input
                type="text"
                value={manualCode}
                onChange={handleInputChange}
                placeholder="e.g. K9X2B4"
                autoFocus
                maxLength={manualCode.includes('session=') ? undefined : 6}
                className="w-full bg-[#0b0f17] border border-slate-800 rounded-xl px-4 py-3 text-center font-mono text-xl tracking-[0.25em] font-bold text-slate-100 placeholder:text-slate-600 placeholder:font-sans placeholder:tracking-normal placeholder:text-sm placeholder:font-normal focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all uppercase"
              />
            </div>

            {joinError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
                <FiAlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-left flex-1">{joinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={manualCode.trim().length < 6}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white font-medium rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shadow-sm shadow-sky-600/20"
            >
              <span>Connect to Room</span>
              <FiArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
