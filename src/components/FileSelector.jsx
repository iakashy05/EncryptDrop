import React, { useState, useRef } from 'react';
import { FiFolderPlus, FiFilePlus, FiSend, FiX, FiFile } from 'react-icons/fi';

export default function FileSelector({ onSendFiles, isConnected }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setSelectedFiles((prev) => [...prev, ...droppedFiles]);
    }
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setSelectedFiles([]);
  };

  const handleSend = () => {
    if (selectedFiles.length > 0) {
      onSendFiles(selectedFiles);
      setSelectedFiles([]);
    }
  };

  const getTotalSizeFormatted = () => {
    const bytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full max-w-md mx-auto bg-[#121824]/90 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-5">
      {/* Dropzone Container */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border border-dashed rounded-xl p-6 sm:p-8 text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
          isDragOver
            ? 'border-sky-500 bg-sky-500/5'
            : 'border-slate-800 hover:border-slate-700 bg-[#0b0f17]'
        }`}
      >
        <div className="w-20 h-20 mb-3 flex items-center justify-center">
          <img src="/logo.png" alt="EncryptDrop Icon" className="w-18 h-18 object-contain drop-shadow-md" />
        </div>

        <h3 className="text-sm font-semibold text-slate-200 mb-1">
          Drag & Drop Files or Folders
        </h3>
        <p className="text-xs text-slate-500 mb-5 max-w-xs">
          Uncompressed, 100% bit-exact direct P2P file teleportation.
        </p>

        {/* Hidden inputs */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          className="hidden"
        />
        <input
          type="file"
          ref={folderInputRef}
          onChange={handleFileChange}
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
        />

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-medium transition-all active:scale-95 shadow-sm shadow-sky-600/20"
          >
            <FiFilePlus className="w-3.5 h-3.5" />
            <span>Select Files</span>
          </button>

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium transition-all active:scale-95 shadow-sm"
          >
            <FiFolderPlus className="w-3.5 h-3.5" />
            <span>Select Folder</span>
          </button>
        </div>
      </div>

      {/* Selected Files Preview List */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <FiFile className="w-3.5 h-3.5 text-sky-400" />
              Selected Items ({selectedFiles.length}) • {getTotalSizeFormatted()}
            </span>
            <button
              onClick={clearAll}
              className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
            {selectedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 bg-[#0b0f17] border border-slate-800/80 rounded-xl text-xs"
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <span className="truncate text-slate-200">
                    {file.webkitRelativePath || file.name}
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="text-slate-500 hover:text-rose-400 p-1"
                >
                  <FiX className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handleSend}
            disabled={!isConnected}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium rounded-xl text-xs flex items-center justify-center space-x-2 transition-all active:scale-95 shadow-sm shadow-sky-600/20"
          >
            <FiSend className="w-3.5 h-3.5" />
            <span>{isConnected ? 'Send Files' : 'Waiting for Peer...'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
