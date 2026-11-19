/**
 * Subtle Web Audio notification chimes for Kitchen Display & Billing Counter
 */
(function (global) {
  'use strict';

  let audioCtx = null;
  let muted = false;

  function getCtx() {
    if (muted) return null;
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playTone(freq, startOffset, duration, gainPeak = 0.12, type = 'sine') {
    const ctx = getCtx();
    if (!ctx) return;
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playNewOrderChime() {
    // Warm two-note kitchen pass bell (E5 -> B5)
    playTone(659.25, 0, 0.25, 0.14, 'triangle');
    playTone(987.77, 0.14, 0.42, 0.12, 'sine');
  }

  function playBillRequestChime() {
    // Crisp three-note counter bell (C5 -> E5 -> G5)
    playTone(523.25, 0, 0.18, 0.10, 'sine');
    playTone(659.25, 0.11, 0.18, 0.10, 'sine');
    playTone(783.99, 0.22, 0.35, 0.11, 'sine');
  }

  function playSuccessTick() {
    playTone(880, 0, 0.14, 0.07, 'sine');
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  global.SoundFX = {
    playNewOrderChime,
    playBillRequestChime,
    playSuccessTick,
    isMuted,
    toggleMute
  };
})(window);
