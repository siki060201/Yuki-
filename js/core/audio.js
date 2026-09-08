/**
 * core/audio.js · 发音、反馈音与环境音景
 *
 * 环境音全部用 Web Audio 实时合成（不依赖任何音频文件），每个音景由多层构成：
 *   底噪层（粉噪/棕噪，铺底）+ 中频层（细节纹理，带缓慢起伏）+ 事件层（随机颗粒声）
 * 统一经过一段合成脉冲响应的混响，让声音有空间感而不是干巴巴的噪声。
 *
 * 音量链：source → 各层 gain → ambientBus →（干/湿分路）→ ambientMaster → master → 输出
 */

const AMBIENT_KINDS = ['rain', 'waves', 'fire', 'forest', 'cafe', 'night'];

/** 环境音总增益。合成噪声本身电平很低，这里统一抬起来，再由限幅器兜住峰值。 */
const AMBIENT_GAIN = 3.2;
/** 各音景的响度配平（听感对齐，森林与夏夜本身偏薄） */
const KIND_TRIM = { rain: 1, waves: 0.92, fire: 0.95, forest: 1.45, cafe: 1.05, night: 1.35 };

export const AMBIENT_META = {
  none: { label: '静音', icon: 'volume-x' },
  rain: { label: '细雨', icon: 'cloud-rain' },
  waves: { label: '海浪', icon: 'waves' },
  fire: { label: '壁炉', icon: 'flame' },
  forest: { label: '森林', icon: 'trees' },
  cafe: { label: '咖啡馆', icon: 'coffee' },
  night: { label: '夏夜', icon: 'moon-star' },
};

let ctx = null;
let master = null;          // 总输出
let analyser = null;        // 输出电平探针
let levelBuf = null;
let ambientMaster = null;   // 环境音总音量（用户可调）
let ambientBus = null;      // 环境音干声汇总
let reverbWet = null;       // 混响湿声
let ambientVolume = 0.7;
let currentAmbient = 'none';
let nodes = [];             // 当前音景的节点，用于淡出与回收
let timers = [];            // 事件层定时器
let epoch = 0;              // 每次切换 +1，用于让旧的定时器自然退出

// ---------------------------------------------------------------- 基础设施
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 1;
    // 输出前挂一个分析节点：用于电平可视化与自检（开销极小）
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    ambientMaster = ctx.createGain();
    ambientMaster.gain.value = ambientVolume;
    ambientMaster.connect(master);

    // 限幅器：偶发的爆裂声（壁炉、雨滴）不会削波，同时让整体听感更饱满
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9;
    comp.knee.value = 9;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ambientMaster);

    ambientBus = ctx.createGain();
    ambientBus.gain.value = AMBIENT_GAIN;
    ambientBus.connect(comp);

    // 混响：干声直连 + 湿声经卷积
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx, 2.4, 2.6);
    reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.26;
    ambientBus.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(comp);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** 合成脉冲响应：指数衰减的噪声，得到一段自然的房间混响 */
function impulseResponse(c, seconds, decay) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

/**
 * 噪声缓冲。kind：
 *  white 白噪 · pink 粉噪（1/f，最像自然噪声）· brown 棕噪（更低沉）
 * 左右声道独立生成 → 天然的立体声宽度
 */
function noiseBuffer(c, seconds, kind = 'pink') {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    } else {
      // Paul Kellet 粉噪滤波器
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // 首尾交叉淡化，避免循环接缝的"咔"声
    const fade = Math.min(2048, Math.floor(len / 8));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[len - 1 - i] *= k;
    }
  }
  return buf;
}

/** 一个持续噪声层：噪声源 → 滤波 →（可选 LFO 调制音量）→ 总线 */
function noiseLayer(c, {
  kind = 'pink', seconds = 6, filter = 'lowpass', freq = 800, q = 0.7,
  gain = 0.2, attack = 2.2, lfoRate = 0, lfoDepth = 0, pan = 0, extraFilter = null,
}) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, seconds, kind);
  src.loop = true;

  const biquad = c.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = freq;
  biquad.Q.value = q;

  const g = c.createGain();
  const now = c.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);

  let tail = biquad;
  if (extraFilter) {
    const f2 = c.createBiquadFilter();
    f2.type = extraFilter.type;
    f2.frequency.value = extraFilter.freq;
    f2.Q.value = extraFilter.q ?? 0.7;
    biquad.connect(f2);
    tail = f2;
  }

  src.connect(biquad);
  tail.connect(g);

  let out = g;
  if (pan) {
    const panner = c.createStereoPanner();
    panner.pan.value = pan;
    g.connect(panner);
    out = panner;
  }
  out.connect(ambientBus);

  const entry = { src, gain: g, target: gain };
  if (lfoRate && lfoDepth) {
    const lfo = c.createOscillator();
    lfo.frequency.value = lfoRate;
    lfo.type = 'sine';
    const lfoGain = c.createGain();
    lfoGain.gain.value = lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start();
    entry.lfo = lfo;
  }
  src.start();
  nodes.push(entry);
  return entry;
}

/** 一次性噪声脉冲：雨滴、爆裂、杯碟等颗粒声的通用做法 */
function noiseBurst(c, { freq = 1200, q = 6, gain = 0.1, duration = 0.08, kind = 'white', pan = 0, decay = 3 }) {
  const len = Math.max(64, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const w = kind === 'brown' ? (Math.random() * 2 - 1) * 0.6 : Math.random() * 2 - 1;
    d[i] = w * Math.pow(1 - t, decay);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  const panner = c.createStereoPanner();
  panner.pan.value = pan;
  src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(ambientBus);
  src.start();
  src.stop(c.currentTime + duration + 0.05);
}

/** 水滴落水：短促的正弦下滑，带一点噪声起始 */
function waterDrop(c, { freq = 900, gain = 0.09, pan = 0 }) {
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.45, now + 0.11);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  const panner = c.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(g); g.connect(panner); panner.connect(ambientBus);
  osc.start(now); osc.stop(now + 0.2);
  noiseBurst(c, { freq: freq * 1.6, q: 3, gain: gain * 0.5, duration: 0.03, pan });
}

/** 鸟鸣：几种啭鸣模式 */
function birdCall(c, pan = 0) {
  const now = c.currentTime;
  const base = 1800 + Math.random() * 1600;
  const style = Math.floor(Math.random() * 3);
  const notes = style === 0 ? 2 : style === 1 ? 3 : 1;
  for (let n = 0; n < notes; n++) {
    const t = now + n * (0.1 + Math.random() * 0.07);
    const osc = c.createOscillator();
    osc.type = 'sine';
    const f = base * (1 + (Math.random() - 0.5) * 0.25);
    osc.frequency.setValueAtTime(f, t);
    if (style === 2) {
      osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.14);
    } else {
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, t + 0.05);
    }
    // 轻微颤音，避免电子味
    const vib = c.createOscillator();
    vib.frequency.value = 28 + Math.random() * 18;
    const vibGain = c.createGain();
    vibGain.gain.value = f * 0.02;
    vib.connect(vibGain); vibGain.connect(osc.frequency);
    vib.start(t); vib.stop(t + 0.2);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.03, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    const panner = c.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g); g.connect(panner); panner.connect(ambientBus);
    osc.start(t); osc.stop(t + 0.18);
  }
}

/** 虫鸣（夏夜）：高频短促脉冲串 */
function cricket(c, pan = 0) {
  const now = c.currentTime;
  const f = 4200 + Math.random() * 900;
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
    const t = now + i * 0.055;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    const panner = c.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g); g.connect(panner); panner.connect(ambientBus);
    osc.start(t); osc.stop(t + 0.04);
  }
}

/** 递归随机定时器；epoch 变化后自动停止 */
function schedule(fn, minMs, maxMs, myEpoch) {
  const id = setTimeout(() => {
    if (myEpoch !== epoch || currentAmbient === 'none') return;
    try { fn(); } catch {}
    schedule(fn, minMs, maxMs, myEpoch);
  }, minMs + Math.random() * (maxMs - minMs));
  timers.push(id);
}

const rand = (a, b) => a + Math.random() * (b - a);
const randPan = () => (Math.random() * 2 - 1) * 0.75;

// ---------------------------------------------------------------- 语音朗读
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

if (canSpeak()) window.speechSynthesis.addEventListener?.('voiceschanged', () => {});

// ---------------------------------------------------------------- 反馈音
export function beep(success = true) {
  try {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const notes = success ? [523.25, 783.99] : [261.63, 174.61];
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[0], now);
    osc.frequency.exponentialRampToValueAtTime(notes[1], now + (success ? 0.12 : 0.16));
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(success ? 0.09 : 0.11, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (success ? 0.3 : 0.26));
    osc.connect(g); g.connect(master);
    osc.start(now); osc.stop(now + 0.32);
  } catch {}
}

/** 番茄钟结束提示：柔和的三音上行铃 */
export function chime(up = true) {
  try {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const seq = up ? [523.25, 659.25, 783.99] : [659.25, 523.25, 392.0];
    seq.forEach((f, i) => {
      const t = now + i * 0.16;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 0.95);
      // 加一个八度泛音，铃声更亮
      const oh = c.createOscillator();
      const gh = c.createGain();
      oh.type = 'sine';
      oh.frequency.value = f * 2;
      gh.gain.setValueAtTime(0.0001, t);
      gh.gain.exponentialRampToValueAtTime(0.03, t + 0.02);
      gh.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      oh.connect(gh); gh.connect(master);
      oh.start(t); oh.stop(t + 0.55);
    });
  } catch {}
}

// ---------------------------------------------------------------- 环境音景
export function stopAmbient(immediate = false) {
  epoch++;
  timers.forEach(clearTimeout);
  timers = [];
  const fade = immediate ? 0.06 : 1.0;
  const now = ctx ? ctx.currentTime : 0;
  const dying = nodes;
  nodes = [];
  for (const n of dying) {
    try {
      if (n.gain && ctx) {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setValueAtTime(n.gain.gain.value, now);
        n.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      }
    } catch {}
    setTimeout(() => {
      try { n.src?.stop?.(); } catch {}
      try { n.lfo?.stop?.(); } catch {}
      try { n.src?.disconnect?.(); n.gain?.disconnect?.(); } catch {}
    }, fade * 1000 + 80);
  }
  currentAmbient = 'none';
  document.body?.setAttribute('data-ambient', 'none');
  notify();
}

const builders = {
  // 细雨：远处雨幕 + 中景沙沙 + 近处雨滴 + 屋檐滴水
  rain(c, e) {
    noiseLayer(c, { kind: 'pink', seconds: 8, filter: 'lowpass', freq: 620, q: 0.6, gain: 0.30, attack: 2.6, lfoRate: 0.045, lfoDepth: 0.05, extraFilter: { type: 'highpass', freq: 90 } });
    noiseLayer(c, { kind: 'white', seconds: 7, filter: 'bandpass', freq: 1900, q: 0.55, gain: 0.115, attack: 3.0, lfoRate: 0.07, lfoDepth: 0.035, pan: -0.25 });
    noiseLayer(c, { kind: 'white', seconds: 6, filter: 'bandpass', freq: 3400, q: 0.7, gain: 0.055, attack: 3.4, lfoRate: 0.11, lfoDepth: 0.022, pan: 0.28 });
    // 近处密集雨滴
    schedule(() => {
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        noiseBurst(c, { freq: rand(1600, 4200), q: rand(4, 9), gain: rand(0.012, 0.038), duration: rand(0.02, 0.05), pan: randPan(), decay: 4 });
      }
    }, 90, 300, e);
    // 屋檐滴水
    schedule(() => waterDrop(c, { freq: rand(620, 1250), gain: rand(0.035, 0.075), pan: randPan() }), 1400, 5200, e);
    // 远处闷雷
    schedule(() => {
      const now = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 3.2, 'brown');
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110; lp.Q.value = 0.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(rand(0.10, 0.2), now + rand(0.5, 1.2));
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);
      src.connect(lp); lp.connect(g); g.connect(ambientBus);
      src.start(now); src.stop(now + 3.2);
    }, 24000, 70000, e);
  },

  // 海浪：低频底噪 + 不规则涌浪包络 + 浪花碎沫
  waves(c, e) {
    noiseLayer(c, { kind: 'brown', seconds: 8, filter: 'lowpass', freq: 190, q: 0.5, gain: 0.34, attack: 3.0, lfoRate: 0.03, lfoDepth: 0.06 });
    noiseLayer(c, { kind: 'pink', seconds: 7, filter: 'bandpass', freq: 520, q: 0.5, gain: 0.10, attack: 3.2, lfoRate: 0.055, lfoDepth: 0.04 });
    // 一次涌浪：噪声扫过带通，模拟浪推上来再退去
    const swell = () => {
      const now = c.currentTime;
      const dur = rand(5.5, 9);
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, dur + 1, 'white');
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.4;
      bp.frequency.setValueAtTime(320, now);
      bp.frequency.linearRampToValueAtTime(rand(1500, 2600), now + dur * 0.42);
      bp.frequency.linearRampToValueAtTime(380, now + dur);
      const g = c.createGain();
      const peak = rand(0.16, 0.3);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak, now + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      const panner = c.createStereoPanner();
      panner.pan.value = rand(-0.4, 0.4);
      src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(ambientBus);
      src.start(now); src.stop(now + dur + 0.2);
    };
    swell();
    schedule(swell, 6500, 12000, e);
  },

  // 壁炉：低沉火吼 + 燃烧嘶嘶 + 大小爆裂
  fire(c, e) {
    noiseLayer(c, { kind: 'brown', seconds: 8, filter: 'lowpass', freq: 170, q: 0.6, gain: 0.36, attack: 2.0, lfoRate: 0.09, lfoDepth: 0.09 });
    noiseLayer(c, { kind: 'pink', seconds: 6, filter: 'bandpass', freq: 640, q: 0.45, gain: 0.085, attack: 2.4, lfoRate: 0.16, lfoDepth: 0.045 });
    noiseLayer(c, { kind: 'white', seconds: 5, filter: 'highpass', freq: 5200, q: 0.4, gain: 0.022, attack: 3.0, lfoRate: 0.23, lfoDepth: 0.012 });
    schedule(() => noiseBurst(c, { freq: rand(700, 2600), q: rand(2, 6), gain: rand(0.02, 0.06), duration: rand(0.03, 0.09), pan: randPan(), decay: 2.4 }), 130, 700, e);
    schedule(() => {
      // 偶发大爆裂：连续两三声
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        setTimeout(() => noiseBurst(c, { freq: rand(320, 1100), q: rand(1.5, 4), gain: rand(0.07, 0.13), duration: rand(0.08, 0.18), pan: randPan(), decay: 1.8 }), i * rand(40, 120));
      }
    }, 3000, 11000, e);
  },

  // 森林：树叶风声 + 鸟鸣 + 远处溪流
  forest(c, e) {
    noiseLayer(c, { kind: 'pink', seconds: 8, filter: 'bandpass', freq: 900, q: 0.4, gain: 0.20, attack: 3.0, lfoRate: 0.04, lfoDepth: 0.09 });
    noiseLayer(c, { kind: 'white', seconds: 7, filter: 'bandpass', freq: 2600, q: 0.5, gain: 0.055, attack: 3.4, lfoRate: 0.065, lfoDepth: 0.03, pan: 0.3 });
    noiseLayer(c, { kind: 'pink', seconds: 6, filter: 'highpass', freq: 1500, q: 0.5, gain: 0.045, attack: 3.0, pan: -0.35 });
    schedule(() => birdCall(c, randPan()), 2200, 9000, e);
    // 一阵风过
    schedule(() => {
      const now = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 6, 'pink');
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 0.35;
      bp.frequency.setValueAtTime(700, now);
      bp.frequency.linearRampToValueAtTime(2200, now + 2.2);
      bp.frequency.linearRampToValueAtTime(600, now + 5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(rand(0.09, 0.17), now + 2);
      g.gain.linearRampToValueAtTime(0.0001, now + 5);
      src.connect(bp); bp.connect(g); g.connect(ambientBus);
      src.start(now); src.stop(now + 5.4);
    }, 9000, 22000, e);
  },

  // 咖啡馆：人声低频嗡鸣 + 杯碟碰撞 + 偶发蒸汽
  cafe(c, e) {
    noiseLayer(c, { kind: 'brown', seconds: 8, filter: 'lowpass', freq: 330, q: 0.5, gain: 0.26, attack: 2.4, lfoRate: 0.07, lfoDepth: 0.05 });
    noiseLayer(c, { kind: 'pink', seconds: 7, filter: 'bandpass', freq: 700, q: 0.35, gain: 0.075, attack: 2.8, lfoRate: 0.13, lfoDepth: 0.035 });
    // 杯碟与勺子
    schedule(() => {
      const f = rand(2400, 5200);
      noiseBurst(c, { freq: f, q: rand(8, 18), gain: rand(0.02, 0.05), duration: rand(0.05, 0.13), pan: randPan(), decay: 2 });
    }, 2500, 9000, e);
    // 蒸汽奶泡
    schedule(() => {
      const now = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 3, 'white');
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
      const g = c.createGain();
      const dur = rand(1.2, 2.6);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(rand(0.03, 0.06), now + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      src.connect(hp); hp.connect(g); g.connect(ambientBus);
      src.start(now); src.stop(now + dur + 0.2);
    }, 15000, 45000, e);
  },

  // 夏夜：虫鸣 + 极低的夜风 + 偶发远处狗吠般的低鸣
  night(c, e) {
    noiseLayer(c, { kind: 'brown', seconds: 8, filter: 'lowpass', freq: 140, q: 0.5, gain: 0.22, attack: 3.0, lfoRate: 0.025, lfoDepth: 0.05 });
    noiseLayer(c, { kind: 'pink', seconds: 7, filter: 'bandpass', freq: 480, q: 0.4, gain: 0.05, attack: 3.2, lfoRate: 0.05, lfoDepth: 0.02 });
    noiseLayer(c, { kind: 'white', seconds: 6, filter: 'bandpass', freq: 4600, q: 1.2, gain: 0.018, attack: 3.6, lfoRate: 0.4, lfoDepth: 0.01 });
    schedule(() => cricket(c, randPan()), 400, 2200, e);
    schedule(() => waterDrop(c, { freq: rand(500, 800), gain: 0.03, pan: randPan() }), 12000, 40000, e);
  },
};

export function playAmbient(kind) {
  const next = AMBIENT_KINDS.includes(kind) ? kind : 'none';
  stopAmbient();
  if (next === 'none') return 'none';
  const c = getCtx();
  if (!c) return 'none';
  currentAmbient = next;
  const myEpoch = epoch;
  document.body?.setAttribute('data-ambient', next);
  // 按音景做响度配平
  const trim = AMBIENT_GAIN * (KIND_TRIM[next] || 1);
  ambientBus.gain.setTargetAtTime(trim, c.currentTime, 0.05);
  builders[next](c, myEpoch);
  notify();
  return next;
}

export function toggleAmbient(kind) {
  return playAmbient(currentAmbient === kind ? 'none' : kind);
}

export function getAmbient() { return currentAmbient; }
export function getAmbientKinds() { return [...AMBIENT_KINDS]; }

export function setAmbientVolume(value) {
  ambientVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (ambientMaster && ctx) {
    ambientMaster.gain.cancelScheduledValues(ctx.currentTime);
    ambientMaster.gain.setTargetAtTime(ambientVolume, ctx.currentTime, 0.05);
  }
  notify();
  return ambientVolume;
}

export function getAmbientVolume() { return ambientVolume; }

// ---------------------------------------------------------------- 订阅
const listeners = new Set();
export function onAmbientChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() {
  const detail = { kind: currentAmbient, volume: ambientVolume };
  listeners.forEach(fn => { try { fn(detail); } catch {} });
  window.dispatchEvent(new CustomEvent('ambient-change', { detail }));
}

/** 浏览器要求先有用户交互才能出声；调用一次即可解锁 */
export function unlock() {
  getCtx();
  return ctx?.state === 'running';
}

/** 当前输出电平：{ rms, peak, db }，用于音量可视化与自检 */
export function getLevel() {
  if (!analyser) return { rms: 0, peak: 0, db: -Infinity };
  if (!levelBuf || levelBuf.length !== analyser.fftSize) levelBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < levelBuf.length; i++) {
    const v = levelBuf[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / levelBuf.length);
  return { rms, peak, db: rms > 0 ? 20 * Math.log10(rms) : -Infinity };
}
