"use strict";

// ===== 音频预加载 =====
function preloadAudio() {
  Object.entries(AUDIO_FILES).forEach(([key, src]) => {
    const el = new Audio();
    el.preload = "auto";
    el.src = encodeURI(src);
    const entry = { el, ready: false, duration: 0 };
    el.addEventListener("loadedmetadata", () => {
      entry.duration = (isFinite(el.duration) && el.duration > 0.1) ? el.duration : 0;
      entry.ready = true;
    });
    el.addEventListener("error", () => { entry.ready = false; });
    audioBank[key] = entry;
  });
}

// 浏览器自动播放策略：需要在用户手势里静默播放一次来解锁全部音频元素
function unlockAudio() {
  Object.values(audioBank).forEach(({ el }) => {
    if (!el) return;
    el.muted = true; el.volume = 0;
    const p = el.play();
    if (p && p.catch) p.then(() => {
      // 若解锁期间该元素已被正式播放接管（muted 已被 playSfx 置回 false），则不要打断它
      if (el.muted) { el.pause(); el.currentTime = 0; el.muted = false; el.volume = 1; }
    }).catch(() => { el.muted = false; el.volume = 1; });
  });
}

// 播放一次性音效；成功返回音频元素（truthy），无可用文件返回 false（调用方可回退合成音）
function playSfx(key, volume = 0.9) {
  const entry = audioBank[key];
  if (!entry || !entry.ready) return false;
  try {
    const el = entry.el;
    el.pause(); el.currentTime = 0; el.loop = false; el.muted = false; el.volume = volume;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    return el;
  } catch (e) { return false; }
}

// 挥刀声在命中瞬间快速淡出（挥刀声比下劈动画长，不淡出会盖住倒地叫声）
function fadeOutSwing(ms = 70) {
  const el = swingAudioEl;
  swingAudioEl = null;
  if (!el || el.paused) return;
  const step = el.volume / 4;
  const timer = setInterval(() => {
    if (el.volume > step) { el.volume = Math.max(0, el.volume - step); }
    else { clearInterval(timer); el.pause(); try { el.currentTime = 0; } catch (e) {} }
  }, Math.max(15, ms / 4));
}

// 追逐循环 BGM：无脚步为主（80%），偶尔用带脚步的（20%）
// 若已在播放（如骗刀后快速重刀），保持连续不重启，只恢复音量
function startChaseLoop() {
  if (chaseAudio && !chaseAudio.paused) { game.chaseDimmed = false; return; }
  stopChaseLoop();
  const key = Math.random() < 0.2 ? "chaseSteps" : "chaseLoop";
  const entry = audioBank[key];
  if (!entry || !entry.ready) return;
  try {
    const el = entry.el;
    el.pause(); el.currentTime = 0; el.loop = true; el.muted = false; el.volume = CONFIG.chaseVolume;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    chaseAudio = el;
    game.chaseDimmed = false;
  } catch (e) {}
}
function stopChaseLoop() {
  if (chaseAudio) {
    try { chaseAudio.pause(); chaseAudio.currentTime = 0; } catch (e) {}
    chaseAudio = null;
  }
  game.chaseDimmed = false;
}
// "拉远"效果：追逐声不停，音量渐弱到 chaseDimVolume 后保持
function dimChaseLoop() { if (chaseAudio) game.chaseDimmed = true; }
// 每帧逼近目标音量（渐弱/恢复都平滑）
function updateChaseVolume(dt) {
  if (!chaseAudio) return;
  const target = game.chaseDimmed ? CONFIG.chaseDimVolume : CONFIG.chaseVolume;
  const v = chaseAudio.volume + (target - chaseAudio.volume) * clamp(dt * 0.0025, 0, 1);
  chaseAudio.volume = clamp(v, 0, 1);
}
// 取音频时长（毫秒）；取不到时用 fallbackMs（用于护士飞行时序）
function getAudioDuration(key, fallbackMs) {
  const entry = audioBank[key];
  if (entry && entry.ready && entry.duration) return entry.duration * 1000;
  return fallbackMs;
}

// ===== WebAudio 合成音效（兜底）=====
function initAudio() { if (audioCtx) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return; audioCtx = new C(); }
function resumeAudioIfNeeded() { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {}); }
function playTone(startFreq, duration, type = "sine", gainValue = 0.03, endFreq = null) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime; const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(startFreq, now);
  if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain); gain.connect(audioCtx.destination); osc.start(now); osc.stop(now + duration + 0.02);
}
function playSound(type) {
  if (!audioCtx) return;
  switch (type) {
    case "press":  playTone(620, 0.08, "triangle", 0.03, 760); break;
    case "swing":  playTone(180, 0.14, "sawtooth", 0.035, 80); playTone(260, 0.09, "triangle", 0.01, 140); break;
    case "success":playTone(440, 0.08, "triangle", 0.03, 660); setTimeout(() => playTone(700, 0.14, "triangle", 0.03, 920), 50); break;
    case "fail":   playTone(240, 0.1, "square", 0.028, 170); setTimeout(() => playTone(170, 0.16, "sawtooth", 0.026, 90), 50); break;
    case "feint":  playTone(420, 0.05, "square", 0.02, 330); break;
    case "clash":  playTone(900, 0.05, "square", 0.03, 1500); setTimeout(() => playTone(1300, 0.1, "triangle", 0.025, 900), 30); break;
  }
}

// ===== 资源加载（图片 + 音频）=====
function loadAssets() {
  Object.entries(assetManifest).forEach(([key, src]) => {
    const image = new Image();
    assets[key] = { image, loaded: false, failed: false };
    image.onload = () => { assets[key].loaded = true; };
    image.onerror = () => { assets[key].failed = true; };
    image.src = src;
  });
  preloadAudio(); // 同时预加载音效
}
