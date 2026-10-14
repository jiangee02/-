"use strict";

/* ======================================================================
 * 素材清单（assets/）
 *  assets/7.png  -> killerBody      屠夫全身模型（已含头部）
 *  assets/6.png  -> killerWeapon    屠夫武器（刀柄在图片底部）
 *  assets/10.png -> survivorHands   人类第一人称手部
 *  兜底：任一加载失败回退 Canvas 图形，不报错。
 *
 * 武器旋转中心（刀柄）：CONFIG.weapon.pivotFracX/Y，默认 0.5/0.92。
 *   ctx.translate(手掌) → ctx.rotate(角度)
 *   → drawImage(weapon, -w*0.5, -h*0.92, w, h)，刀柄对齐旋转原点。
 * ====================================================================== */

const CONFIG = {
  invincibleWindow: 500,
  fatigueDuration: 20000,
  attackDelayMin: 1500, attackDelayMax: 5000,  // 每轮出刀时间 1.5-5 秒随机
  windupTime: 220, feintChance: 0.15,

  t0Ratio: 0.4, feintPauseMs: 100, feintStepBack: 30,
  attackLean: -0.14, attackChopLean: -0.2,
  bodyScale: { attackFwd: 1.04, feintBack: 0.92 },

  // 蓄力刀：前摇总时长 = windupTime × windupMult（挥刀更慢、抬手更久），
  // t1 下劈时身体前冲 lunge 像素（攻击距离更远）
  // chargedT0Ratio：蓄力刀前半圈（举刀）占比更高，后半圈（下劈）更快；简单模式用 easyT0Ratio 更快

  bg: { top: "#1a2230", mid: "#121826", bottom: "#0d1320" },
  outline: {
    bodyColor: "rgba(120, 12, 12, 0.55)", headColor: "rgba(150, 20, 20, 0.5)",
    weaponGlow: "rgba(252, 165, 70, 0.6)", enlarge: 7, lineWidth: 3
  },
  weapon: {
    pivotFracX: 0.5, pivotFracY: 0.92,
    restAngle: Math.PI * 1.5, raisedAngle: Math.PI * 0.25,
    feintRaisedAngle: Math.PI * 1.25, // 骗刀：从初始位置顺时针挥 45°（与真刀大幅举刀明显区分），随后停顿收回
    swungAngle: Math.PI * 1.25, bouncedAngle: Math.PI * 1.75,
    trailAlpha: 0.3, trailMaxFrames: 6, trailLifeMs: 130,
    drawW: 72, drawH: 138   // 武器尺寸（6.png）
  },

  // ===== 第一人称手部（10.png 正向使用；左手水平镜像 = 左右手） =====
  // 【手动微调手的位置就改这里】
  //   leftX / rightX : 两只手中心的水平位置（屏幕宽度比例，0~1）
  //   baseDrop       : 手的锚点埋在屏幕底边之下多少像素（调大 = 双手整体下移）
  //   liftY          : 手图片底部相对锚点再上抬多少像素（调大 = 手上移）
  //   handW / handH  : 10.png 的绘制宽/高（调手的大小）
  //   widthScale     : 横向拉宽倍数（>1 变粗，只拉宽不拉高；1 = 原比例）
  //   rotLeft / rotRight : 左右手倾斜角（弧度，0.16 ≈ 9°）
  arms: {
    leftX: 0.30, rightX: 0.70,
    baseDrop: 65, liftY: 30,
    handW: 200, handH: 218, widthScale: 1.0,
    rotLeft: -0.16, rotRight: 0.16,
    bobAmp: 12, color: "#ffffff", shadowColor: "rgba(0,0,0,0.5)",
    imgFilter: "brightness(0.85) saturate(0.8) contrast(1.08)"  // 手部图压暗去光泽（调太亮/太光滑就改这里）
  },

  speedBoostDuration: 2500, speedBoostBgMultiplier: 2.6,
  sprintKillerShrink: 0.42, sprintKillerMoveRight: 260,
  successGlowDuration: 1500,

  // ===== 护士瞬移（偶发事件）=====
  // chance      : 触发概率（0.18 = 约 18% 的轮次会飞）
  // shortenMin/Max : 有飞行时缩短版的反应窗口（毫秒），避免总等待过久
  nurseBlink: { chance: 0.18, shortenMin: 1000, shortenMax: 2500 },

  // 骗刀收回后的快速重刀：反应窗口 0.6~2 秒（符合游戏里骗招后立刻再砍的节奏）
  quickRetarget: { min: 600, max: 2000 },

  // 骗刀动作放慢倍数（举刀+停顿+收回整体时长 ×3.6，hitAt 判定点不变；调大更慢）
  feint: { windupMult: 3.6 },

  // 轻刀：抬手快(90ms)，下劈按难度分；手机端触摸响应更快，抬手80ms+下劈×0.6
  light: { raiseMs: 75, raiseMobileMs: 75, swingMs: { easy: 220, normal: 165, hard: 140 }, mobileMult: 1 },

  // 蓄力刀：桌面 windupMult 2.4，下劈(t1)固定130ms；手机端下劈155ms(慢一点)，整体×0.52
  charged: { windupMult: 2.2, lunge: 42, scaleBoost: 1.04, t1Ms: 180, t1MobileMs: 180, mobileMult: 1 },

  // ===== 追逐声 / 钢筋黄条 =====
  chaseVolume: 0.45,     // 追逐循环正常音量
  chaseDimVolume: 0.30,  // 成功/被骗后"拉远"渐弱到的音量（保持播放不停止）
  deadhardDrainMs: 4000, // 钢筋黄条按住回头时掉完所需时长（毫秒）
  speedLines: { count: 42, speed: 16, life: 650 },

  difficultyOptions: {
    easy: {
      label: "简单", attackDelayMin: 1500, attackDelayMax: 5000, windupTime: 220, feintChance: 0.00,
      attackPool: ["charged"], note: "只有蓄力刀，有手就行。"
    },
    normal: {
      label: "普通", attackDelayMin: 1500, attackDelayMax: 5000, windupTime: 220, feintChance: 0.12,
      attackPool: ["light","light","light","light","light","light","light","charged","charged","charged"], note: "轻刀与蓄力刀，适合综合练习。"
    },
    hard: {
      label: "困难", attackDelayMin: 1500, attackDelayMax: 5000, windupTime: 180, feintChance: 0.30,
      attackPool: ["light","light","feint","feint"], note: "只有轻刀和骗刀，难度较大。"
    }
  },

  /* ======================================================================
   * 【手动改这里】判定结果显示词（分难度，随机取一条）
   * tooEarly : 按在前摇（钢早了）     tooLate  : 按在下劈但无敌帧没覆盖到
   * noPress  : 没反应过来没按
   * success  : 钢筋成功
   * ====================================================================== */
  verdictTexts: {
    easy: {
      tooEarly: ["钢这么早","当位移呢"],
      tooLate:  ["我钢了！", "我真的钢了！！", "我钢筋呢！！！"],
      noPress:  ["老了老了", "你不适合钢筋"],
      success:  ["好钢"]
    },
    normal: {
      tooEarly: ["钢早了","手别抖啊","猜呢"],
      tooLate:  ["我钢了！", "我真的钢了！！", "我钢筋呢！！！"],
      noPress:  ["反应慢了", "你的钢呢"],
      success:  ["好钢", "好钢兄弟"]
    },
    hard: {
      tooEarly: ["早了","放松点","博弈失败","别太紧张"],
      tooLate:  ["我钢了！", "我真的钢了！！", "我钢筋呢！！！","可惜了"],
      noPress:  ["钢筋呢", "不如当个位移"],
      success:  ["好钢", "好钢兄弟", "兄弟好钢", "牛逼兄弟"]
    }
  },

  /* 【手动改这里】骗刀 Canvas 大字（屏幕中央，随机取一条，不分难度） */
  feintBaitedTexts: ["不吃钢筋", "等着你呢", "防着你呢"], // 骗到钢筋（交钢被骗）
  feintNoBaitTexts: ["有操作的", "不吃压迫", "大心脏！"]    // 没骗到（看清骗刀没交）
};

const GameState = { MENU:"MENU", CHASE:"CHASE", DASHING:"DASHING", SUCCESS:"SUCCESS", FAIL:"FAIL", COOLDOWN:"COOLDOWN" };
const STATE_LABELS = { MENU:"菜单", CHASE:"追击中", DASHING:"钢筋生效", SUCCESS:"钢筋成功", FAIL:"失败", COOLDOWN:"疲劳冷却" };

// 判定结果随机文案：按当前难度取 CONFIG.verdictTexts（【手动改这里】在 CONFIG 末尾）
function getVerdictTexts() {
  return CONFIG.verdictTexts[game.difficulty] || CONFIG.verdictTexts.normal;
}
const pickText = arr => arr[Math.floor(Math.random() * arr.length)];

const assetManifest = {
  killerBody: "assets/7.png",    // 屠夫全身模型（已含头部）
  killerWeapon: "assets/6.png",  // 屠夫武器
  bgFront: "assets/1.jpg",       // 正面背景（朝前跑时的场景；回头时不切图）
  survivorHands: "assets/10.png"  // 人类第一人称右手手背（视角：从眼睛看右手手背，指尖朝上）
};

/* ===== 音频清单（assets/ 下；文件缺失或播放失败时自动回退到合成音效）===== */
const AUDIO_FILES = {
  chaseLoop:    "assets/追逐声.mp3",        // 主追逐循环（无脚步，可无缝循环，为主）
  chaseSteps:   "assets/追逐带脚步.mp3",    // 备用追逐循环（带脚步，偶尔使用）
  swingLight:   "assets/轻刀声.mp3",        // 轻刀挥砍声
  swingCharged: "assets/蓄力刀.mp3",        // 蓄力刀挥砍声
  hurt1:        "assets/人类倒地叫声1.mp3", // 倒地叫声（3 选 1 随机）
  hurt2:        "assets/人类倒地叫声2.mp3",
  hurt3:        "assets/人类倒地叫声3.mp3",
  nurseBlink:   "assets/护士叫声.mp3",      // 护士飞行瞬移（必须放完才出刀）
  success:      "assets/钢筋成功声.mp3"     // 钢筋成功音效
};

const TRIGGER_STORAGE_KEY = "dbh_trigger_v1";
function loadTrigger() {
  try { const v = JSON.parse(localStorage.getItem(TRIGGER_STORAGE_KEY));
    if (v && (v.type === "wheel" || v.type === "key")) return v; } catch (e) {}
  return { type: "key", key: "e" }; // 默认触发为 E 键
}
function saveTrigger(t) { try { localStorage.setItem(TRIGGER_STORAGE_KEY, JSON.stringify(t)); } catch (e) {} }
function describeTrigger(t) {
  if (t.type === "wheel") return "鼠标滚轮向上";
  if (t.type === "key" && t.key) return `按键 ${t.key.toUpperCase()}`;
  return "未设置";
}

function getDifficultyConfig(name) {
  const o = CONFIG.difficultyOptions[name] || CONFIG.difficultyOptions.normal;
  return { invincibleWindow: CONFIG.invincibleWindow, fatigueDuration: CONFIG.fatigueDuration,
    attackDelayMin: o.attackDelayMin ?? CONFIG.attackDelayMin, attackDelayMax: o.attackDelayMax ?? CONFIG.attackDelayMax,
    windupTime: o.windupTime ?? CONFIG.windupTime, feintChance: o.feintChance ?? CONFIG.feintChance,
    label: o.label, note: o.note, tip: o.tip,
    attackPool: o.attackPool || ["light"] };
}

const randomRange = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
const easeIn = t => t*t;
const easeOut = t => 1 - (1-t)*(1-t);
const formatMs = ms => `${Math.round(ms)}ms`;
const formatPercent = (n, d) => d ? `${((n/d)*100).toFixed(1)}%` : "0%";
const formatCooldown = ms => ms <= 0 ? "就绪" : `${(ms/1000).toFixed(1)}s`;
