# EncryptDrop 🔒

> Zero-database, end-to-end encrypted, browser-to-browser P2P file sharing web app.

![EncryptDrop Logo](public/logo.png)

## Features

- **100% Bit-Exact & Lossless**: Stream raw binary chunks directly via WebRTC DataChannels with zero compression or pixel distortion.
- **End-to-End Encrypted (E2EE)**: AES-256-GCM encryption with keys generated in the browser and automatically synced via WebRTC signaling.
- **Zero Database / 100% Anonymous**: Ephemeral RAM-only signaling. All buffers and keys are wiped when the session ends.
- **Folder Zipping on-the-fly**: Select or drop folders and EncryptDrop automatically compresses them into a `.zip` in memory before transfer.
- **Pair via QR or Session ID**: Scan QR code with your camera or enter the Session ID manually.
- **Pause, Resume & Cancel**: Full control over active transfers with deterministic IV offset seeking.
- **Audio & Haptic Feedback**: Native Web Audio API synth chimes and mobile vibration on connect, complete, and disconnect.

---

## Getting Started Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Signaling Server
```bash
npm run server
```
*Signaling server runs on `http://localhost:3001`.*

### 3. Start the Frontend
```bash
npm run dev
```
*App will open at `http://localhost:3000`.*

---

## Deployment Guide

### Deploy Signaling Server to Render (Free)
1. Push this repository to GitHub.
2. Go to [Render.com](https://render.com) and click **New +** > **Web Service**.
3. Connect your repository.
4. Set **Start Command**: `node server/index.js`
5. Copy your Render service URL (e.g. `https://your-signaling.onrender.com`).

### Deploy Frontend to Vercel
1. Import the repository in [Vercel](https://vercel.com/new).
2. Set Environment Variable:
   - `VITE_SIGNALING_URL`: `https://your-signaling.onrender.com`
3. Click **Deploy**!

---

## Automated Tests

Run unit and integration tests:
```bash
npm test
```

Build for production:
```bash
npm run build
```

## License

MIT
