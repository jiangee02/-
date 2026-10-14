"use strict";

// ===== Canvas 上下文 =====
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ===== DOM 引用缓存 =====
const ui = {
  stateBadge: document.getElementById("stateBadge"),
  panelMsg: document.getElementById("panelMsg"),
  menuCard: document.getElementById("menuCard"),
  difficultyButtons: document.getElementById("difficultyButtons"),
  difficultyNote: document.getElementById("difficultyNote"),
  statTotal: document.getElementById("statTotal"),
  statSuccess: document.getElementById("statSuccess"),
  statFail: document.getElementById("statFail"),
  statRate: document.getElementById("statRate"),
  statFeinted: document.getElementById("statFeinted"),
  statAvgRt: document.getElementById("statAvgRt"),
  statBestStreak: document.getElementById("statBestStreak"),
  statCooldown: document.getElementById("statCooldown"),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn") || {},
  resetBtn: document.getElementById("resetBtn") || {},
  resetStatsBtn: document.getElementById("resetStatsBtn"),
  startTouchBtn: document.getElementById("startTouchBtn"),
  deadHardBtn: document.getElementById("deadHardBtn"),
  lookBackBtn: document.getElementById("lookBackBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  helpBtn: document.getElementById("helpBtn"),
  helpPop: document.getElementById("helpPop"),
  closeHelpBtn: document.getElementById("closeHelpBtn"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  optWheel: document.getElementById("optWheel"),
  optKey: document.getElementById("optKey"),
  keyBindRow: document.getElementById("keyBindRow"),
  currentKey: document.getElementById("currentKey"),
  rebindBtn: document.getElementById("rebindBtn"),
  rebindHint: document.getElementById("rebindHint"),
  skillWidget: document.getElementById("skillWidget"),
  fatigueRing: document.getElementById("fatigueRing"),
  deadhardBar: document.getElementById("deadhardBar")
};

const assets = {};
let audioCtx = null;
const audioBank = {};   // key -> { el, ready, duration }
let chaseAudio = null;  // 当前正在循环播放的追逐音
let swingAudioEl = null;

// ===== 全局游戏状态 =====
const game = {
  state: GameState.MENU, difficulty: "normal", tuning: getDifficultyConfig("normal"),
  isMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1,
  lastTime: performance.now(), round: null, cooldownEndAt: 0, resultEndAt: 0,
  flash: { color: "rgba(255,255,255,0)", alpha: 0, type: "full" },
  message: { title: "准备练习", desc: "空格开始，E 键触发钢筋，Shift/右键向后看，P 暂停，H 隐藏 UI，O 设置", color: "#ffffff", until: 0 },
  fakeNoticeUntil: 0, fakeNoticeStartAt: 0, fakeNoticeBaited: false, fakeNoticeText: "", speedBoostUntil: 0, successGlowUntil: 0, speedLines: [], skillActiveUntil: 0,
  viewState: "forward", lookBackHeld: false, keyboardLookBack: false, mouseLookBack: false, lookBackBlend: 0,
  weaponState: { angle: CONFIG.weapon.restAngle, bodyTilt: 0, feintStep: 0, bodyScale: 1, phase: "rest" },
  weaponTrail: [], lastWheelAt: 0, uiHidden: false, trigger: loadTrigger(), awaitingKeyBind: false,
  forceRealNext: false,
  pendingFatigue: false, // 被骗交钢后的补刀标记：补刀轮结束后进入疲劳等待
  paused: false, pauseStartAt: 0, // 全局暂停（P 键）：冻结所有计时，恢复时整体平移时间戳
  deadhardCharge: 0,  // 钢筋黄条电量（0~1）：成功才充能，按住回头时消退
  chaseDimmed: false, // 追逐声是否处于"拉远"渐弱状态（成功/被骗后）
  screenShake: { x: 0, y: 0, intensity: 0, duration: 0, until: 0 }, idleClock: 0,
  stats: { totalAttempts: 0, successCount: 0, failCount: 0, feintedCount: 0, currentStreak: 0, bestStreak: 0, reactionSum: 0, reactionCount: 0, lastReactionTime: null }
};

// ===== 状态辅助：消息 / 闪光 / 震动 / 回头同步 =====
function setMessage(title, desc, color = "#ffffff", duration = 900) {
  game.message.title = title; game.message.desc = desc; game.message.color = color;
  game.message.until = performance.now() + duration;
}
function triggerFlash(color, alpha = 0.38, type = "full") { game.flash.color = color; game.flash.alpha = alpha; game.flash.type = type; }
function triggerShake(intensity = 12, duration = 220) {
  game.screenShake.intensity = intensity; game.screenShake.duration = duration;
  game.screenShake.until = performance.now() + duration;
}
function syncLookBackState() { game.lookBackHeld = game.keyboardLookBack || game.mouseLookBack; }
