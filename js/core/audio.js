/**
 * core/audio.js · 发音、反馈音与环境白噪音
 */

let ctx = null;
let master = null;
let ambientNodes = [];
let currentAmbient = 'none';

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ---------- 语音朗读 ----------
let voicesReady = false;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const en = voices.filter(v => /^en(-|_)?(US|GB)?/i.test(v.lang));
  const prefer = ['Natural', 'Google', 'Samantha', 'Daniel', 'Aria', 'Jenny', 'Guy', 'Zira', 'David'];
  for (const p of prefer) {
    const hit = en.find(v => v.name.includes(p));
    if (hit) return hit;
  }
  return en[0] || null;
}

export function canSpeak() { return 'speechSynthesis' in window; }

export function speak(text, { rate = 0.92, lang = 'en-US' } = {}) {
  if (!text || !canSpeak()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const v = pickVoice();
  if (v) u.voice = v;
  synth.speak(u);
  return true;
}

if (canSpeak()) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => { voicesReady = true; });
}

// ---------- 反馈音 ----------
export function beep(success = true) {
  try {
    const c = getCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const now = c.currentTime;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(master);
    if (success) {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);
      gain.gain.setValueAtTime(0.10, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    } else {
      osc.frequency.setValueAtTime(261.63, now);
      osc.frequency.exponentialRampToValueAtTime(174.61, now + 0.16);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.start(now); osc.stop(now + 0.26);
    }
  } catch {}
}

// ---------- 环境声 ----------
export function stopAmbient(immediate = false) {
  const fade = immediate ? 0.05 : 0.8;
  const now = ctx ? ctx.currentTime : 0;
  for (const n of ambientNodes) {
    try {
      if (n.gain && ctx) {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setValueAtTime(n.gain.gain.value, now);
        n.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      }
      setTimeout(() => { try { n.src?.stop?.(); n.src?.disconnect?.(); n.lfo?.stop?.(); } catch {} }, fade * 1000 + 60);
    } catch {}
  }
  ambientNodes = [];
  currentAmbient = 'none';
}

function noiseBuffer(c, seconds, shaper) {
  const buf = c.createBuffer(2, c.sampleRate * seconds, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      if (shaper === 'pink') {
        b0 = 0.992 * b0 + w * 0.08;
        b1 = 0.95 * b1 + w * 0.12;
        b2 = 0.85 * b2 + w * 0.22;
        data[i] = (b0 + b1 + b2) * 0.05;
      } else {
        data[i] = w * 0.04;
      }
    }
  }
  return buf;
}

export function playAmbient(kind) {
  stopAmbient();
  if (kind === 'none') return;
  const c = getCtx();
  if (!c) return;
  currentAmbient = kind;
  const now = c.currentTime;

  if (kind === 'rain') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 4, 'pink');
    src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.36, now + 1.4);
    src.connect(lp); lp.connect(gain); gain.connect(master);
    src.start();
    ambientNodes.push({ src, gain });
  } else if (kind === 'waves') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 3, 'white');
    src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 1.6);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    src.connect(lp); lp.connect(gain); gain.connect(master);
    src.start(); lfo.start();
    ambientNodes.push({ src, gain, lfo });
  } else if (kind === 'fire') {
    // 壁炉：低频棕噪 + 随机噼啪
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 4, 'pink');
    src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.30, now + 1.2);
    src.connect(lp); lp.connect(gain); gain.connect(master);
    src.start();
    ambientNodes.push({ src, gain });
    const crackle = () => {
      if (currentAmbient !== 'fire') return;
      try {
        const o = c.createOscillator(); const g = c.createGain(); const t = c.currentTime;
        o.type = 'triangle'; o.frequency.value = 900 + Math.random() * 1800;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
      } catch {}
      setTimeout(crackle, 180 + Math.random() * 900);
    };
    setTimeout(crackle, 400);
  }
}

export function getAmbient() { return currentAmbient; }
