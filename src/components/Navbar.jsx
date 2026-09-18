import React from 'react';
import { FiShield, FiPower, FiWifi, FiWifiOff } from 'react-icons/fi';

export default function Navbar({ connectionState, isConnected, onEndSession }) {
  return (
    <header className="w-full bg-[#121824] border-b border-slate-800/80 px-6 py-3.5 flex items-center justify-between">
      <div className="flex items-center space-x-3.5">
        <img src="/logo.png" alt="EncryptDrop" className="w-9 h-9 object-contain" />
        <div>
          <h1 className="text-base font-bold text-slate-100 tracking-tight">
            EncryptDrop
          </h1>
          <p className="text-[11px] text-slate-500">File Share</p>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {/* E2EE Badge */}
        <div className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
          <FiShield className="w-3.5 h-3.5" />
          <span>E2EE Active</span>
        </div>

        {/* Connection Status Badge */}
        <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${
          isConnected 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>
          {isConnected ? <FiWifi className="w-3.5 h-3.5" /> : <FiWifiOff className="w-3.5 h-3.5" />}
          <span>{isConnected ? 'Peer Connected' : connectionState || 'Disconnected'}</span>
        </div>

        {/* End Session Button */}
        {isConnected && (
          <button
            onClick={onEndSession}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-medium transition-colors"
            title="End Session & Purge RAM"
          >
            <FiPower className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">End Session</span>
          </button>
        )}
      </div>
    </header>
  );
}
