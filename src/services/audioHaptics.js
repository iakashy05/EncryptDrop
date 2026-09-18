/**
 * EncryptDrop Web Audio & Haptic Feedback Engine
 * Uses native Web Audio API oscillators (no external MP3 dependencies) and Vibration API.
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a pleasant ascending double-chime when devices pair.
 */
export function playConnectChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    // Frequencies: E5 (659.25Hz) -> A5 (880Hz)
    osc1.frequency.setValueAtTime(659.25, now);
    osc2.frequency.setValueAtTime(880.00, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.15);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.4);
  } catch (err) {
    console.warn('[AudioHaptics] Audio play failed:', err);
  }
}

/**
 * Play a descending soft chime when session is ended.
 */
export function playDisconnectChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    // Descending tones: A4 (440Hz) -> F4 (349.23Hz)
    osc1.frequency.setValueAtTime(440.00, now);
    osc2.frequency.setValueAtTime(349.23, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.12);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  } catch (err) {
    console.warn('[AudioHaptics] Disconnect chime failed:', err);
  }
}

/**
 * Play a triumphant 3-tone chime when a file transfer successfully completes.
 */
export function playCompleteChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);

      gain.gain.setValueAtTime(0.2, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.35);
    });
  } catch (err) {
    console.warn('[AudioHaptics] Audio play failed:', err);
  }
}

/**
 * Trigger mobile device vibration on success.
 */
export function triggerHapticSuccess() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([80, 40, 80]);
    } catch (e) {
      // Ignore vibration permissions error
    }
  }
}

/**
 * Trigger mobile device vibration on error.
 */
export function triggerHapticError() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([150, 50, 150]);
    } catch (e) {
      // Ignore
    }
  }
}
