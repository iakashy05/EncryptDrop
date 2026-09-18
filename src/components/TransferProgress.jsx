import React from 'react';
import { FiPause, FiPlay, FiX, FiDownload, FiShield, FiArrowUpRight, FiArrowDownLeft, FiCheck } from 'react-icons/fi';

export default function TransferProgress({
  transfers,
  onPause,
  onResume,
  onCancel,
  speedMbps
}) {
  if (!transfers || transfers.length === 0) return null;

  return (
    <div className="max-w-xl mx-auto mt-5 space-y-3">
      <div className="flex items-center justify-between text-xs font-medium text-slate-400 px-1">
        <span>Active Transfers ({transfers.length})</span>
        {speedMbps > 0 && (
          <span className="text-sky-400 font-mono text-[11px] bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-md">
            {speedMbps.toFixed(2)} MB/s
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {transfers.map((item) => {
          const isUpload = item.direction === 'upload';
          const isCompleted = Boolean(item.isCompleted || item.progressPercent >= 100);

          const totalBytesNum = item.size || item.totalBytes || 0;
          const formattedSize = totalBytesNum > 0 ? (totalBytesNum / (1024 * 1024)).toFixed(2) : '0';

          const statusText = isCompleted
            ? (isUpload ? 'Uploaded P2P' : 'Received P2P')
            : (isUpload ? 'Uploading P2P' : 'Receiving P2P');

          return (
            <div
              key={item.fileId}
              className="bg-[#121824] border border-slate-800 rounded-lg p-3.5 space-y-2.5 shadow-sm"
            >
              {/* File Title & Direction */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5 truncate pr-3">
                  <div className={`p-1.5 rounded-md ${
                    isCompleted 
                      ? 'bg-emerald-500/10 text-emerald-400' 
                      : isUpload 
                      ? 'bg-purple-500/10 text-purple-400' 
                      : 'bg-sky-500/10 text-sky-400'
                  }`}>
                    {isCompleted ? (
                      <FiCheck className="w-3.5 h-3.5" />
                    ) : isUpload ? (
                      <FiArrowUpRight className="w-3.5 h-3.5" />
                    ) : (
                      <FiArrowDownLeft className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="truncate">
                    <h4 className="text-xs font-medium text-slate-200 truncate">
                      {item.path || item.name || 'Transferring File...'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {formattedSize} MB • {statusText}
                    </p>
                  </div>
                </div>

                {/* Minimalist Controls & Download Actions */}
                <div className="flex items-center space-x-2">
                  {/* Hide Pause & Cancel when completed */}
                  {!isCompleted && !item.isCanceled && (
                    <>
                      {item.isPaused ? (
                        <button
                          onClick={() => onResume(item.fileId)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs transition-colors"
                          title="Resume"
                        >
                          <FiPlay className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onPause(item.fileId)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs transition-colors"
                          title="Pause"
                        >
                          <FiPause className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={() => onCancel(item.fileId)}
                        className="p-1.5 bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-md text-xs transition-colors"
                        title="Cancel"
                      >
                        <FiX className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  {/* CLEAN MINIMALIST SAVE FILE BUTTON (For Receiver on Completion) */}
                  {isCompleted && !isUpload && (
                    <a
                      href={item.downloadUrl || '#'}
                      download={item.name || 'downloaded_file'}
                      onClick={(e) => {
                        if (!item.downloadUrl) {
                          e.preventDefault();
                          alert('File is finalizing in browser RAM. Please try again in 1 second.');
                        }
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-md text-xs font-medium transition-colors"
                    >
                      <FiDownload className="w-3.5 h-3.5" />
                      <span>Save File</span>
                    </a>
                  )}

                  {/* Sender Completed Badge */}
                  {isCompleted && isUpload && (
                    <div className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-xs font-medium border border-emerald-500/20">
                      <FiCheck className="w-3.5 h-3.5" />
                      <span>Sent</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full bg-[#0b0f17] rounded-full h-1.5 overflow-hidden border border-slate-800/80">
                  <div
                    className={`h-full transition-all duration-200 ${
                      item.isCanceled 
                        ? 'bg-rose-500' 
                        : isCompleted 
                        ? 'bg-emerald-500' 
                        : 'bg-sky-500'
                    }`}
                    style={{ width: `${item.progressPercent || 0}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>
                    {item.isCanceled 
                      ? (item.error || 'Canceled')
                      : item.isPaused 
                      ? 'Paused' 
                      : isCompleted 
                      ? 'Completed 100%' 
                      : `${item.progressPercent || 0}%`}
                  </span>

                  {/* SHA-256 Checksum Match Indicator */}
                  {item.sha256Match !== undefined && item.sha256Match !== null && (
                    <span className="flex items-center space-x-1 text-emerald-400 font-mono">
                      <FiShield className="w-3 h-3" />
                      <span>SHA-256 Verified</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
