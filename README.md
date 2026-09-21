<div align="center">
  <img src="public/logo.png" alt="EncryptDrop Logo" width="120" />
  <h1>EncryptDrop</h1>
  <p><strong>Ultra-fast, zero-storage, browser-to-browser P2P file teleportation.</strong></p>
</div>

---

## Highlights

- ⚡ **Blazing Fast P2P Streaming**: Direct device-to-device file transfer over WebRTC DataChannels at full network line rate (50–100+ MB/s).
- 🛡️ **Zero Storage & Complete Privacy**: Direct peer-to-peer transport with zero cloud storage. Your files never touch a server or database.
- ✋ **Transfer Authorization**: Quick Share / AirDrop style approval modal — recipient inspects file names and sizes before accepting the transfer.
- 📦 **Lossless & Bit-Exact**: Raw binary streaming with zero quality loss or compression artifacts.
- 📁 **Folder Bundling on-the-Fly**: Drop entire folders to stream them preserving directory structures.
- 📱 **Instant Pairing**: Connect instantly with a 6-character room code or camera QR code scan.
- 🔄 **Session Resilience**: Tab refresh recovery and warnings to prevent accidental disconnects during active transfers.
- 🎨 **Responsive Dark UI**: Clean glassmorphic centered cards with custom P2P doodle vector background.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Signaling Server
```bash
npm run server
```
*Runs on `http://localhost:3001`.*

### 3. Start Frontend
```bash
npm run dev
```
*Runs on `http://localhost:3000`.*

---

## Verification & Build

```bash
# Run unit & integration tests
npm test

# Build for production
npm run build
```

---

<div align="center">
  <sub>Created with ❤️ by <strong>Akash Yadav</strong> • Licensed under MIT</sub>
</div>
