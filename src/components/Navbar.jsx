import React from 'react';
import { FiPower, FiWifi, FiWifiOff } from 'react-icons/fi';

export default function Navbar({ connectionState, isConnected, onEndSession }) {
  return (
    <header className="w-full bg-[#0b0f17]/80 backdrop-blur-md border-b border-slate-800/70 px-4 sm:px-8 py-3 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Brand Logo & Name */}
        <div className="flex items-center space-x-3">
          <img
            src="/logo.png"
            alt="EncryptDrop Logo"
            className="w-8 h-8 sm:w-9 sm:h-9 object-contain drop-shadow-sm transition-transform hover:scale-105"
          />
          <div>
            <h1 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight leading-none">
              EncryptDrop
            </h1>
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium pt-0.5">
              Direct P2P Share
            </p>
          </div>
        </div>

        {/* Right Actions: Status & End Session */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Connection Status Badge (Responsive text) */}
          <div
            className={`flex items-center space-x-2 px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-medium border transition-colors shadow-sm ${
              isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
            }`}
          >
            {isConnected ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            ) : (
              <FiWifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>
              {isConnected ? (
                <>
                  <span className="hidden sm:inline">Peer Connected</span>
                  <span className="sm:hidden">Connected</span>
                </>
              ) : (
                connectionState || 'Disconnected'
              )}
            </span>
          </div>

          {/* End Session Button */}
          {isConnected && (
            <button
              onClick={onEndSession}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 text-[11px] sm:text-xs font-medium transition-all shadow-sm active:scale-95"
              title="End Session & Reset"
            >
              <FiPower className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">End Session</span>
              <span className="sm:hidden">End</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
