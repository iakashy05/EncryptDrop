import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { FiMaximize, FiCamera, FiCopy, FiCheck, FiArrowRight, FiAlertCircle } from 'react-icons/fi';

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

  // Fallback for HTTP / unsupported contexts
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

export default function SessionPairing({ sessionId, pairingUrl, onJoinSession, onHostSession }) {
  const [activeTab, setActiveTab] = useState('host'); // 'host' | 'join'
  const [manualCode, setManualCode] = useState('');
  const [copiedSid, setCopiedSid] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'host' && !sessionId) {
      onHostSession();
    }
  }, [activeTab, sessionId, onHostSession]);

  const startCameraScan = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const codeReader = new BrowserQRCodeReader();
      codeReaderRef.current = codeReader;

      const videoElement = videoRef.current;
      if (!videoElement) return;

      await codeReader.decodeFromVideoDevice(undefined, videoElement, (result, err) => {
        if (result) {
          const text = result.getText();
          stopCameraScan();
          if (text.includes('#')) {
            window.location.hash = text.substring(text.indexOf('#'));
          }
          const extractedCode = text.includes('session=') 
            ? new URL(text).searchParams.get('session') || text 
            : text;

          onJoinSession(extractedCode);
        }
      });
    } catch (err) {
      console.error('[EncryptDrop QR Scanner] Error starting camera:', err);
      setScanError('Camera permission denied or camera unavailable.');
      setIsScanning(false);
    }
  };

  const stopCameraScan = () => {
    setIsScanning(false);
  };

  const handleCopySid = async () => {
    const ok = await copyTextToClipboard(sessionId);
    if (ok) {
      setCopiedSid(true);
      setTimeout(() => setCopiedSid(false), 2000);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onJoinSession(manualCode.trim());
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-[#121824] border border-slate-800 rounded-xl shadow-xl space-y-6">
      {/* Header Tabs */}
      <div className="flex bg-[#0b0f17] p-1 rounded-lg border border-slate-800">
        <button
          onClick={() => { setActiveTab('host'); stopCameraScan(); }}
          className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center space-x-2 ${
            activeTab === 'host' 
              ? 'bg-[#1e293b] text-slate-100 shadow-sm' 
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <FiMaximize className="w-3.5 h-3.5" />
          <span>Show QR</span>
        </button>

        <button
          onClick={() => setActiveTab('join')}
          className={`flex-1 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center space-x-2 ${
            activeTab === 'join' 
              ? 'bg-[#1e293b] text-slate-100 shadow-sm' 
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <FiCamera className="w-3.5 h-3.5" />
          <span>Scan / Join</span>
        </button>
      </div>

      {/* HOST TAB CONTENT */}
      {activeTab === 'host' && (
        <div className="flex flex-col items-center text-center space-y-5">
          <div className="p-3 bg-white rounded-lg border border-slate-200">
            {pairingUrl ? (
              <QRCodeSVG value={pairingUrl} size={180} level="M" includeMargin={true} />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-slate-400 text-xs">
                Generating session...
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">Scan QR Code</h3>
            <p className="text-xs text-slate-500 max-w-xs">
              Scan with mobile camera to pair directly.
            </p>
          </div>

          {/* Session Code & Copy Box */}
          <div className="w-full bg-[#0b0f17] p-3 rounded-lg border border-slate-800 flex items-center justify-between">
            <div className="text-left font-mono">
              <span className="text-[10px] text-slate-500 block uppercase">Session ID</span>
              <span className="text-xs font-medium text-sky-400">{sessionId || 'Loading...'}</span>
            </div>
            
            <button
              onClick={handleCopySid}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium transition-colors"
              title="Copy Session ID"
            >
              {copiedSid ? <FiCheck className="w-3.5 h-3.5 text-emerald-400" /> : <FiCopy className="w-3.5 h-3.5" />}
              <span>{copiedSid ? 'Copied' : 'Copy SID'}</span>
            </button>
          </div>
        </div>
      )}

      {/* JOIN TAB CONTENT */}
      {activeTab === 'join' && (
        <div className="flex flex-col space-y-5">
          {/* Camera Scanner View */}
          <div className="relative bg-[#0b0f17] rounded-lg border border-slate-800 overflow-hidden min-h-[180px] flex items-center justify-center">
            <video
              ref={videoRef}
              className={`w-full h-44 object-cover ${isScanning ? 'block' : 'hidden'}`}
            />
            {!isScanning && (
              <div className="text-center p-6 space-y-3">
                <FiCamera className="w-8 h-8 text-sky-400 mx-auto" />
                <button
                  onClick={startCameraScan}
                  className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-md transition-colors"
                >
                  Start Camera Scanner
                </button>
              </div>
            )}
            {scanError && (
              <div className="absolute inset-x-3 bottom-3 p-2 bg-rose-500/10 border border-rose-500/20 rounded-md text-rose-400 text-xs text-center flex items-center justify-center gap-1.5">
                <FiAlertCircle className="w-3.5 h-3.5" />
                <span>{scanError}</span>
              </div>
            )}
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-800 w-full"></div>
            <span className="bg-[#121824] px-3 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Or Manual Code</span>
          </div>

          <form onSubmit={handleManualSubmit} className="flex space-x-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Session ID (e.g. encryptdrop_123456)"
              className="flex-1 bg-[#0b0f17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium rounded-md text-xs flex items-center space-x-1.5 transition-colors"
            >
              <span>Connect</span>
              <FiArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
