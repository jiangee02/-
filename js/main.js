"use strict";

// ===== 键盘输入 =====
function onKeyDown(event) {
  if (event.repeat) return;
  const key = event.key;
  if (game.awaitingKeyBind) {
    event.preventDefault();
    if (key === "Escape") { finishKeyBind(null); return; }
    const k = key.length === 1 ? key.toLowerCase() : key;
    game.trigger = { type: "key", key: k }; saveTrigger(game.trigger); finishKeyBind(k); return;
  }
  if (key === "Escape" && ui.settingsModal.classList.contains("open")) {
    event.preventDefault(); toggleSettings(false); return;
  }
  if (key === "Escape" && ui.helpPop && ui.helpPop.classList.contains("open")) {
    event.preventDefault(); ui.helpPop.classList.remove("open"); return;
  }
  const lower = key.toLowerCase();
  if (lower === "o") { event.preventDefault(); toggleSettings(true); return; }
  if (lower === "h") { event.preventDefault(); toggleUIHidden(); return; }
  if (lower === "p") { event.preventDefault(); togglePause(); return; }
  if (event.code === "Space") {
    event.preventDefault();
    if (ui.settingsModal.classList.contains("open")) return;
    if (game.state === GameState.MENU) startPractice(); else restartRoundOnly(); return;
  }
  if (lower === "r") { event.preventDefault(); resetStats(); return; }
  if (key === "Shift") { game.keyboardLookBack = true; syncLookBackState(); return; }
  if (game.trigger.type === "key" && game.trigger.key && lower === game.trigger.key) {
    event.preventDefault(); handlePressDeadHard();
  }
}
function onKeyUp(event) { if (event.key === "Shift") { game.keyboardLookBack = false; syncLookBackState(); } }

// ===== 鼠标滚轮触发 =====
function onWheel(event) {
  event.preventDefault();
  initAudio(); resumeAudioIfNeeded();
  const now = performance.now();
  if (now - game.lastWheelAt < 80) return;
  game.lastWheelAt = now;
  if (event.deltaY >= 0) return; // 向上滚（deltaY < 0）才触发
  if (game.trigger.type !== "wheel") return;
  handlePressDeadHard();
}

// ===== 全局暂停（P 键）=====
// 思路：暂停只记时间戳；恢复时把所有"未来时间锚点"整体后移暂停时长，计时无缝继续
function shiftTimestamps(delta) {
  if (delta <= 0) return;
  const r = game.round;
  if (r) ["windupAt", "t0EndAt", "hitAt", "invincibleUntil", "pressedAt", "pressWindupAt", "bounceStartAt"]
    .forEach(k => { if (typeof r[k] === "number") r[k] += delta; });
  ["cooldownEndAt", "resultEndAt", "speedBoostUntil", "successGlowUntil", "skillActiveUntil",
    "fakeNoticeUntil", "_verdictStartAt"].forEach(k => {
      if (typeof game[k] === "number" && game[k] > 0) game[k] += delta;
    });
  if (game.message && game.message.until > 0) game.message.until += delta;
  if (game.screenShake && game.screenShake.until > 0) game.screenShake.until += delta;
  if (game.weaponTrail) game.weaponTrail.forEach(s => { s.t += delta; });
  if (game.speedLines) game.speedLines.forEach(s => { if (typeof s.t === "number") s.t += delta; });
}
function pauseGameAudio() {
  if (chaseAudio) { try { chaseAudio.pause(); } catch (e) {} }
  const blink = audioBank.nurseBlink;
  if (blink && blink.ready && !blink.el.paused) { try { blink.el.pause(); } catch (e) {} }
}
function resumeGameAudio() {
  if (chaseAudio) {
    try { chaseAudio.volume = game.chaseDimmed ? CONFIG.chaseDimVolume : CONFIG.chaseVolume; const p = chaseAudio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  const blink = audioBank.nurseBlink;
  if (blink && blink.ready) { try { const p = blink.el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
}
function togglePause() {
  if (game.state === GameState.MENU || game.awaitingKeyBind) return;
  const now = performance.now();
  if (!game.paused) {
    game.paused = true; game.pauseStartAt = now;
    pauseGameAudio();
  } else {
    game.paused = false;
    shiftTimestamps(now - game.pauseStartAt);
    game.lastTime = now;
    resumeGameAudio();
  }
}
let pauseOverlayDrawn = false;
function drawPauseOverlay() {
  const w = canvas.width, h = canvas.height;
  ctx.save();
  ctx.fillStyle = "rgba(5, 10, 20, 0.55)"; ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(Math.min(w, h) * 0.085)}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = "#f1f5f9"; ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 14;
  ctx.fillText("已暂停", w / 2, h / 2 - Math.min(w, h) * 0.03);
  ctx.font = `600 ${Math.round(Math.min(w, h) * 0.032)}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
  ctx.fillText("点击屏幕继续", w / 2, h / 2 + Math.min(w, h) * 0.055);
  ctx.restore();
}

// ===== 主循环 =====
// FPS 调试：地址栏加 ?fps=1 时左上角显示实时帧率（默认关闭，不影响正常游玩）
const debugFps = /[?&]fps=1/.test(location.search);
let fpsFrameCount = 0, fpsWindowStart = 0, fpsValue = 0;
function drawFpsOverlay(now) {
  if (!debugFps) return;
  fpsFrameCount += 1;
  if (!fpsWindowStart) fpsWindowStart = now;
  if (now - fpsWindowStart >= 500) {
    fpsValue = Math.round((fpsFrameCount * 1000) / (now - fpsWindowStart));
    fpsFrameCount = 0; fpsWindowStart = now;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(8, 8, 118, 28);
  ctx.font = '600 16px ui-monospace, Consolas, monospace';
  ctx.fillStyle = fpsValue >= 55 ? "#4ade80" : (fpsValue >= 40 ? "#facc15" : "#f87171");
  ctx.fillText(`${fpsValue} fps`, 18, 28);
  ctx.restore();
}
function gameLoop(now) {
  if (game.paused) {
    if (!pauseOverlayDrawn) { drawPauseOverlay(); pauseOverlayDrawn = true; }
    requestAnimationFrame(gameLoop); return;
  }
  pauseOverlayDrawn = false;
  updateGame(now); draw(); drawFpsOverlay(now); requestAnimationFrame(gameLoop);
}

// ===== UI 切换 / 设置 =====
function toggleUIHidden() {
  game.uiHidden = !game.uiHidden;
  document.body.classList.toggle("ui-hidden", game.uiHidden);
  // 判定文字由 Canvas 绘制，不受此影响
  setMessage(game.uiHidden ? "UI 已隐藏" : "UI 已显示", "按 H 切换显示。", "#bfdbfe", 700);
}
function toggleSettings(open) {
  const isO = ui.settingsModal.classList.contains("open");
  const target = open === undefined ? !isO : open;
  ui.settingsModal.classList.toggle("open", target);
  if (target) { refreshSettingsUI(); game.awaitingKeyBind = false; ui.rebindHint.textContent = ""; }
}
function refreshSettingsUI() {
  const t = game.trigger; const isWheel = t.type === "wheel";
  ui.optWheel.classList.toggle("active", isWheel);
  ui.optKey.classList.toggle("active", !isWheel);
  ui.keyBindRow.style.display = isWheel ? "none" : "flex";
  ui.currentKey.textContent = (!isWheel && t.key) ? t.key : "--";
}
function startKeyBind() { game.awaitingKeyBind = true; ui.rebindHint.textContent = "请按下任意键（Esc 取消）…"; }
function finishKeyBind(key) {
  game.awaitingKeyBind = false;
  ui.rebindHint.textContent = key ? `已绑定：${key}` : "已取消";
  refreshSettingsUI(); updateHud();
}

// ===== 事件绑定 =====
function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", () => { game.keyboardLookBack = false; game.mouseLookBack = false; syncLookBackState(); });
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("mousedown", (e) => { if (e.button === 2) { e.preventDefault(); game.mouseLookBack = true; syncLookBackState(); } });
  window.addEventListener("mouseup", (e) => { if (e.button === 2) { e.preventDefault(); game.mouseLookBack = false; syncLookBackState(); } });
  // 暂停后点击游戏屏幕（canvas）即恢复，无需再按 P 或点暂停按钮
  canvas.addEventListener("pointerdown", () => { if (game.paused) togglePause(); });

  ui.startBtn.addEventListener("click", startPractice);
  if (ui.restartBtn.addEventListener) ui.restartBtn.addEventListener("click", restartRoundOnly);
  if (ui.resetBtn.addEventListener) ui.resetBtn.addEventListener("click", resetStats);
  ui.resetStatsBtn.addEventListener("click", resetStats);
  // 手机多指触摸兼容：触摸按钮统一用 pointerdown（按住回头时也能点开始/钢筋）
  ui.startTouchBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (game.state === GameState.MENU) startPractice(); else restartRoundOnly();
  });
  // 手机多指触摸兼容：改用 pointerdown 而非 click。
  // 原因：按住 Shift（第一指 pointerdown 已 setPointerCapture）时，第二指点击钢筋
  // 在手机上不会合成 click 事件，导致钢筋按不出。pointerdown 按指针独立触发，
  // 两个手指互不拦截，可同时触发 Shift + 钢筋。
  ui.deadHardBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handlePressDeadHard();
  });

  // 左下 Shift 触摸键：按住 = 向后看（掉黄条冻结/回头视角），松开恢复
  // 关键：必须同步调用 syncLookBackState() 更新 lookBackHeld，否则视角/黄条不响应
  const lookBtn = ui.lookBackBtn;
  lookBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { lookBtn.setPointerCapture(e.pointerId); } catch (_) {}
    game.keyboardLookBack = true; syncLookBackState(); lookBtn.classList.add("held");
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) =>
    lookBtn.addEventListener(ev, () => { game.keyboardLookBack = false; syncLookBackState(); lookBtn.classList.remove("held"); }));
  lookBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  ui.pauseBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); togglePause(); });
  // 桌面端：⚙ 设置按钮 + ? 操作说明按钮
  if (ui.settingsBtn) ui.settingsBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); toggleSettings(true); });
  if (ui.helpBtn) ui.helpBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); ui.helpPop.classList.toggle("open"); });
  if (ui.closeHelpBtn) ui.closeHelpBtn.addEventListener("click", () => ui.helpPop.classList.remove("open"));
  if (ui.helpPop) ui.helpPop.addEventListener("click", (e) => { if (e.target === ui.helpPop) ui.helpPop.classList.remove("open"); });
  ui.closeSettingsBtn.addEventListener("click", () => toggleSettings(false));
  ui.optWheel.addEventListener("click", () => { game.trigger = { type: "wheel", key: null }; saveTrigger(game.trigger); refreshSettingsUI(); updateHud(); });
  ui.optKey.addEventListener("click", () => { if (game.trigger.type !== "key") { game.trigger = { type: "key", key: game.trigger.key || "e" }; saveTrigger(game.trigger); } refreshSettingsUI(); updateHud(); });
  ui.rebindBtn.addEventListener("click", startKeyBind);
  ui.settingsModal.addEventListener("click", (e) => { if (e.target === ui.settingsModal) toggleSettings(false); });

  ["pointerdown", "touchstart"].forEach((n) => {
    window.addEventListener(n, () => { initAudio(); resumeAudioIfNeeded(); }, { passive: true });
  });
}

// ===== 启动 =====
function init() {
  loadAssets();
  buildDifficultyButtons();
  bindEvents();
  resizeCanvas();
  refreshSettingsUI();
  enterMenu();
  updateHud();
  requestAnimationFrame(gameLoop);
}

init();
