// js/audio.js · Lexora 治愈系背景音乐与温润声学引擎
(() => {
  let audioCtx = null;
  let currentSound = 'none';
  let activeNodes = [];
  let masterGain = null;
  let chordTimer = null;
  let crackleTimer = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0.32, audioCtx.currentTime);
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function stopAmbientSound(immediate = false) {
    const fadeTime = immediate ? 0.05 : 0.6;
    const now = audioCtx ? audioCtx.currentTime : 0;

    activeNodes.forEach(item => {
      try {
        if (item.gainNode && audioCtx) {
          item.gainNode.gain.cancelScheduledValues(now);
          item.gainNode.gain.setValueAtTime(item.gainNode.gain.value, now);
          item.gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeTime);
        }
        setTimeout(() => {
          try {
            if (item.stop) item.stop();
            if (item.disconnect) item.disconnect();
          } catch (e) {}
        }, fadeTime * 1000 + 50);
      } catch (e) {}
    });

    activeNodes = [];
    currentSound = 'none';
  }

  // 1. 【窗外温润细雨 (Gentle Warm Rain)】
  // 大幅滤除 800Hz 以上尖锐毛刺，突出 150~450Hz 雨落窗台的蓬松饱满声
  function playRainSound() {
    const actx = getAudioContext();
    if (!actx) return;
    stopAmbientSound();
    currentSound = 'rain';

    const bufferSize = actx.sampleRate * 4; // 4秒大缓冲立体声无缝循环
    const noiseBuffer = actx.createBuffer(2, bufferSize, actx.sampleRate);
    const left = noiseBuffer.getChannelData(0);
    const right = noiseBuffer.getChannelData(1);

    let b0L = 0, b1L = 0, b2L = 0, b3L = 0;
    let b0R = 0, b1R = 0, b2R = 0, b3R = 0;

    for (let i = 0; i < bufferSize; i++) {
      const wL = Math.random() * 2 - 1;
      const wR = Math.random() * 2 - 1;
      // 温润粉红滤波器
      b0L = 0.992 * b0L + wL * 0.08;
      b1L = 0.95 * b1L + wL * 0.12;
      b2L = 0.85 * b2L + wL * 0.22;
      left[i] = (b0L + b1L + b2L) * 0.05;

      b0R = 0.992 * b0R + wR * 0.08;
      b1R = 0.95 * b1R + wR * 0.12;
      b2R = 0.85 * b2R + wR * 0.22;
      right[i] = (b0R + b1R + b2R) * 0.05;
    }

    const rainSrc = actx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;

    // 二级双二阶低通滤波
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, actx.currentTime);
    filter.Q.setValueAtTime(0.8, actx.currentTime);

    const gain = actx.createGain();
    const now = actx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 1.2);

    rainSrc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    rainSrc.start();

    activeNodes.push(rainSrc, filter, { gainNode: gain });
  }

  // 2. 【静谧深海潮汐 (Deep Ocean Breath)】
  // 12秒余弦慢周期呼吸感
  function playWavesSound() {
    const actx = getAudioContext();
    if (!actx) return;
    stopAmbientSound();
    currentSound = 'waves';

    const bufferSize = actx.sampleRate * 3;
    const noiseBuffer = actx.createBuffer(2, bufferSize, actx.sampleRate);
    const left = noiseBuffer.getChannelData(0);
    const right = noiseBuffer.getChannelData(1);

    for (let i = 0; i < bufferSize; i++) {
      left[i] = (Math.random() * 2 - 1) * 0.04;
      right[i] = (Math.random() * 2 - 1) * 0.04;
    }

    const noise = actx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, actx.currentTime);

    const gain = actx.createGain();
    const now = actx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 1.5);

    // 缓慢平滑的潮汐调制 LFO (0.08Hz, 约12.5秒一次呼吸)
    const lfo = actx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.08, now);
    const lfoGain = actx.createGain();
    lfoGain.gain.setValueAtTime(0.12, now);

    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    noise.start();
    lfo.start();

    activeNodes.push(noise, filter, lfo, lfoGain, { gainNode: gain });
  }

  // Apple 风格优雅交互反馈声
  function playBeep(success = true) {
    try {
      const actx = getAudioContext();
      if (!actx) return;
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      const now = actx.currentTime;

      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(masterGain);

      if (success) {
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.28);
      } else {
        osc.frequency.setValueAtTime(261.63, now); // C4
        osc.frequency.exponentialRampToValueAtTime(196.00, now + 0.15); // G3
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {}
  }

  window.LexoraAudio = {
    playRainSound,
    playWavesSound,
    stopAmbientSound,
    playBeep
  };
})();