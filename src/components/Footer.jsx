import React from 'react';
import { FiHeart, FiZap, FiLock, FiShield } from 'react-icons/fi';

export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-800/60 py-6 px-4 z-10 mt-auto bg-[#0b0f17]/70 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 text-center sm:text-left">
        {/* Left: App info */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1 text-slate-400">
          <span className="font-semibold text-slate-200">EncryptDrop</span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="flex items-center gap-1 text-slate-400">
            <FiZap className="w-3 h-3 text-sky-400" /> Direct P2P
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="flex items-center gap-1 text-slate-400">
            <FiLock className="w-3 h-3 text-emerald-400" /> Zero Storage
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="flex items-center gap-1 text-slate-400">
            <FiShield className="w-3 h-3 text-indigo-400" /> End-to-End
          </span>
        </div>

        {/* Right: Author credit */}
        <div className="flex items-center justify-center space-x-1.5 text-slate-400">
          <span>Created with</span>
          <FiHeart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 inline-block animate-pulse" />
          <span>by</span>
          <span className="font-medium text-slate-200 hover:text-sky-400 transition-colors">
            Akash Yadav
          </span>
        </div>
      </div>
    </footer>
  );
}
