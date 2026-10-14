"use strict";

// ===== 难度按钮构建 =====
function buildDifficultyButtons() {
  ui.difficultyButtons.innerHTML = "";
  Object.entries(CONFIG.difficultyOptions).forEach(([key, option]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = option.label;
    if (key === game.difficulty) b.classList.add("active");
    b.addEventListener("click", () => {
      game.difficulty = key; game.tuning = getDifficultyConfig(key);
      buildDifficultyButtons(); ui.difficultyNote.textContent = game.tuning.note;
      setMessage(`已切换到${game.tuning.label}`, game.tuning.note, "#bfdbfe", 1200);
      if (game.state !== GameState.MENU) restartRoundOnly();
    });
    ui.difficultyButtons.appendChild(b);
  });
  ui.difficultyNote.textContent = game.tuning.note;
}

function resetStats() {
  Object.assign(game.stats, { totalAttempts: 0, successCount: 0, failCount: 0, feintedCount: 0, currentStreak: 0, bestStreak: 0, reactionSum: 0, reactionCount: 0, lastReactionTime: null });
  updateHud(); setMessage("统计已清空", "重新记录。", "#f8fafc", 900);
}

// ===== 创建一回合（出刀时间线）=====
function createRound(baseTime = performance.now(), opts = {}) {
  // 护士瞬移（偶发事件）：概率触发护士叫声，飞行音放完后才出刀（还原游戏逻辑）。
  // 未触发的轮次：屠夫一直在场，反应窗口 1.5~5 秒不变。
  // 触发的轮次：飞行时长（音频真实时长）+ 缩短版反应窗口，总等待与普通轮接近。
  // opts.quick：骗刀收回后的快速重刀——0.6~2 秒内就出刀，且不再触发飞行。
  const hasBlink = !opts.quick && Math.random() < CONFIG.nurseBlink.chance;
  const reactMin = opts.quick ? CONFIG.quickRetarget.min
    : (hasBlink ? CONFIG.nurseBlink.shortenMin : game.tuning.attackDelayMin);
  const reactMax = opts.quick ? CONFIG.quickRetarget.max
    : (hasBlink ? CONFIG.nurseBlink.shortenMax : game.tuning.attackDelayMax);
  const flightMs = hasBlink ? getAudioDuration("nurseBlink", 2000) + 200 : 0;
  const delay = flightMs + randomRange(reactMin, reactMax);
  // 从攻击池里随机抽取一种攻击类型
  // 疲劳期内（cooldownEndAt 未到）玩家没有钢筋可用，骗刀无意义：一律真刀
  // 骗招后的快速重刀（quick）也必定真刀：避免"收回→马上又骗"的连续骗刀抽搐
  const pool = game.tuning.attackPool || ["light"];
  const attackType = (opts.quick || game.forceRealNext || game.cooldownEndAt > baseTime)
    ? "light" : pool[Math.floor(Math.random() * pool.length)];
  game.forceRealNext = false;
  const isFeint = attackType === "feint";
  const isCharged = attackType === "charged";
  const mobile = game.isMobile ? CONFIG.light.mobileMult : 1;
  // 蓄力刀：前摇更长，前半圈（举刀）占比更大；骗刀：整体动作放慢（feint.windupMult）
  // 轻刀：抬手快+下劈按难度分，手机端×0.9（触摸响应更快）
  const hitAt = baseTime + delay;
  let windupTime, windupAt, t0EndAt;
  if (isCharged) {
    // 蓄力刀：手机端 windupMult × mobileMult；下劈(t1)固定，手机端更慢
    const cMult = CONFIG.charged.windupMult * (game.isMobile ? CONFIG.charged.mobileMult : 1);
    windupTime = game.tuning.windupTime * cMult;
    windupAt = hitAt - windupTime;
    const t1Ms = game.isMobile ? CONFIG.charged.t1MobileMs : CONFIG.charged.t1Ms;
    t0EndAt = hitAt - t1Ms; // 下劈固定时长，举刀=总前摇-下劈
  } else if (isFeint) {
    windupTime = game.tuning.windupTime * CONFIG.feint.windupMult;
    windupAt = hitAt - windupTime;
    t0EndAt = windupAt + windupTime * CONFIG.t0Ratio;
  } else {
    // 轻刀：抬手+下劈按难度分，手机端抬手更短、下劈整体缩短
    const raiseMs = game.isMobile ? CONFIG.light.raiseMobileMs : CONFIG.light.raiseMs;
    const swingMs = CONFIG.light.swingMs[game.difficulty] * mobile;
    windupTime = raiseMs + swingMs;
    windupAt = hitAt - windupTime;
    t0EndAt = windupAt + raiseMs;
  }
  return { startAt: baseTime, hasBlink, flightMs,
    attackDelay: delay, windupAt, t0EndAt, hitAt,
    feint: isFeint, charged: isCharged, attackType,
    skillUsed: false, pressedAt: 0, pressWindupAt: 0, invincibleUntil: 0, swingPlayed: false,
    resolved: false, consumedSkill: false, outcome: "", bounceStartAt: 0 };
}

// ===== 状态机 =====
function changeState(nextState) {
  game.state = nextState; updateHud();
  // 标记菜单/游戏中状态，供 CSS 响应式使用（手机端游戏中隐藏顶栏不挡判定文字）
  document.body.classList.toggle("state-menu", nextState === GameState.MENU);
  document.body.classList.toggle("state-game", nextState !== GameState.MENU);
}

function enterMenu() {
  changeState(GameState.MENU);
  game.cooldownEndAt = 0; game.resultEndAt = 0; game.round = null;
  game.lookBackHeld = false; game.keyboardLookBack = false; game.mouseLookBack = false; game.lookBackBlend = 0;
  game.weaponTrail = []; game.speedBoostUntil = 0; game.successGlowUntil = 0; game.speedLines = [];
  game.deadhardCharge = 0; // 回菜单清空钢筋黄条
  stopChaseLoop(); // 回菜单停止追逐 BGM
  setMessage("准备练习", "空格开始，E 键触发钢筋，Shift/右键向后看，P 暂停，H 隐藏 UI，O 设置", "#ffffff", 999999);
  ui.menuCard.style.display = "block";
}
function startPractice() {
  initAudio(); resumeAudioIfNeeded(); unlockAudio();
  ui.menuCard.style.display = "none";
  game.speedBoostUntil = 0; game.cooldownEndAt = 0; game.deadhardCharge = 0;
  beginNewChase(performance.now());
  setMessage("追击开始", "注意屠夫抬手：前倾=真出刀，逆时针举刀=骗刀，慢抬手+前冲=蓄力刀。偶尔会护士瞬移，叫声结束后才出刀。", "#f8fafc", 1400);
}
function restartRoundOnly() {
  ui.menuCard.style.display = "none";
  game.cooldownEndAt = 0; game.resultEndAt = 0; game.speedBoostUntil = 0; game.weaponTrail = []; game.speedLines = [];
  game.deadhardCharge = 0;
  beginNewChase(performance.now());
  setMessage("重新开始", "本轮已重置。", "#f8fafc", 1000);
}
function beginNewChase(baseTime = performance.now(), opts = {}) {
  game.round = createRound(baseTime + 250, opts);
  game.fakeNoticeUntil = 0; game.weaponTrail = [];
  // 护士瞬移叫声：偶发事件（概率触发），放完后才进入出刀流程
  if (game.round.hasBlink) playSfx("nurseBlink", 0.85);
  // 追逐循环 BGM（无脚步为主，偶尔带脚步），结算时停止
  startChaseLoop();
  changeState(GameState.CHASE);
}
function startCooldown() {
  game.cooldownEndAt = performance.now() + game.tuning.fatigueDuration;
  changeState(GameState.COOLDOWN);
  setMessage("疲劳中", `冷却 ${Math.round(game.tuning.fatigueDuration/1000)} 秒，结束自动开下一轮。`, "#fde68a", 1200);
}

// ===== 结算 =====
function resolveSuccess(now) {
  if (!game.round || game.round.resolved) return;
  fadeOutSwing(); // 命中瞬间淡出挥刀声，别盖住成功音效
  game.round.resolved = true; game.round.outcome = "success"; game.round.bounceStartAt = now;
  game.stats.totalAttempts += 1; game.stats.successCount += 1;
  game.stats.currentStreak += 1; game.stats.bestStreak = Math.max(game.stats.bestStreak, game.stats.currentStreak);
  // 反应时间 = 按钢时刻 - 抬手起始（按钢瞬间的 windupAt 快照）
  const reaction = Math.max(0, game.round.pressedAt - (game.round.pressWindupAt || game.round.windupAt));
  game.stats.lastReactionTime = reaction; // 上次反应：是多少填多少，0也显示0
  if (reaction > 0) { game.stats.reactionSum += reaction; game.stats.reactionCount += 1; } // 只有成功且>0才进入平均
  game.speedBoostUntil = now + CONFIG.speedBoostDuration;
  game.successGlowUntil = now + CONFIG.successGlowDuration;
  game.resultEndAt = now + CONFIG.speedBoostDuration;
  game.skillActiveUntil = now + 1200;
  game.round.verdictSub = pickText(getVerdictTexts().success); // 成功随机副文案
  spawnSpeedLines();
  triggerFlash("rgba(74, 222, 128, 1)", 0.34, "full");
  triggerShake(6, 160);
  game.deadhardCharge = 1; // 钢筋成功：黄条充满并保持（回头才消退）
  dimChaseLoop(); // 追逐声不停止：音量渐弱保持（模拟拉远效果）
  if (!playSfx("success", 0.5)) { playSound("clash"); playSound("success"); } // 成功音降低音量
  setMessage("钢筋成功！", game.round.verdictSub, "#86efac", 1500);
  changeState(GameState.SUCCESS); updateHud();
}
function resolveFailure(now, title, desc, consumedSkill, countReaction = false, isFeinted = false) {
  if (!game.round || game.round.resolved) return;
  fadeOutSwing(); // 命中瞬间淡出挥刀声（70ms），让倒地叫声清晰不被盖住
  game.round.resolved = true; game.round.outcome = "fail"; game.round.consumedSkill = consumedSkill;
  game.round.resolvedAt = now; // 记录命中结算时刻（用于识别"钢晚了"：结算后才按钢）
  game.round.wasFeinted = !!isFeinted; // 记录本回合是否为骗刀失败（供判定文字区分）

  // 根据是否按技能、按的时机，选择随机副文案
  let sub = desc;
  if (isFeinted) {
    sub = pickText(CONFIG.feintBaitedTexts); // 被骗刀时按出钢筋：用骗到池
  } else if (consumedSkill) {
    // 按在前摇(t0)里 = 钢早了；按在下劈(t1)但无敌帧没覆盖到 = 钢晚了
    sub = (game.round.pressedAt < game.round.t0EndAt)
      ? pickText(getVerdictTexts().tooEarly)
      : pickText(getVerdictTexts().tooLate);
  } else {
    sub = pickText(getVerdictTexts().noPress);
  }
  game.round.verdictSub = sub;

  game.stats.totalAttempts += 1; game.stats.failCount += 1;
  if (isFeinted) game.stats.feintedCount += 1;
  game.stats.currentStreak = 0;
  // 失败一律记 0（上次反应显示0），不进入平均；只有成功才进平均
  game.stats.lastReactionTime = 0;
  game.resultEndAt = now + 950;
  triggerFlash("rgba(251, 113, 133, 1)", 0.55, "edge");
  triggerShake(10, 200);
  if (isFeinted) {
    // 被骗刀（没真砍中）：追逐声继续（渐弱保持），无倒地叫声
    dimChaseLoop();
    playSound("fail");
  } else {
    // 真吃刀倒地：追逐声不停（渐弱保持，避免戛然而止），随机播放 3 个倒地叫声之一
    dimChaseLoop();
    if (!playSfx(`hurt${1 + Math.floor(Math.random() * 3)}`, 1.0)) playSound("fail");
  }
  setMessage(title, sub, "#fda4af", 1200);
  changeState(GameState.FAIL); updateHud();
}

// ===== 玩家触发钢筋铁骨 =====
function handlePressDeadHard() {
  initAudio(); resumeAudioIfNeeded();
  const now = performance.now();
  if (game.state === GameState.MENU) { startPractice(); return; }
  // 钢晚了：命中结算后 250ms 内才按钢（手慢了），覆盖判定文字为"钢晚了"文案
  if (game.state === GameState.FAIL && game.round && game.round.resolved && !game.round.consumedSkill &&
      now - (game.round.resolvedAt || 0) <= 250) {
    game.round.verdictSub = pickText(getVerdictTexts().tooLate);
    game.round.wasFeinted = false; game.round.wasBaited = false;
    setMessage("钢晚了", game.round.verdictSub, "#fda4af", 900);
    playSound("feint"); return;
  }
  if (game.state === GameState.COOLDOWN) {
    setMessage("疲劳中", "冷却没结束，不能再次使用钢筋铁骨。", "#fde68a", 900); playSound("feint"); return;
  }
  if (![GameState.CHASE, GameState.DASHING].includes(game.state) || !game.round) return;
  // 疲劳期内（包括被骗交钢后的补刀轮）不能再按钢筋
  if (game.cooldownEndAt > now) {
    setMessage("疲劳中", "冷却没结束，不能再次使用钢筋铁骨。", "#fde68a", 900); playSound("feint"); return;
  }
  if (game.round.skillUsed) return;
  game.round.skillUsed = true; game.round.consumedSkill = true;
  game.round.pressedAt = now;
  // 快照此时抬手起始（windupAt），用于算反应时间（骗刀被交钢后会重算时间线，必须用按钢瞬间的值）
  game.round.pressWindupAt = game.round.windupAt;
  // 骗刀与出刀分离：骗刀动画（举→停→收回）完整播完不打断，收回完成后
  // 屠夫以正常速度重新起手，0.7~1 秒内命中——此时 0.5s 无敌帧必已过期，
  // 玩家在疲劳中也按不出钢筋，必定中刀。中刀判定词走正常逻辑。
  if (game.round.feint) {
    game.round.wasBaited = true;
    game.round.feintAnimEndAt = game.round.hitAt; // 骗刀动画原结束时刻（windupAt/t0EndAt 保持原值，动画完整播放）
    game.round.baitHitAt = game.round.hitAt + randomRange(700, 1000); // 收回完成后 0.7~1 秒内补刀命中
    game.round.swingPlayed = false; // 补刀是真刀：正常播挥刀声
    // 大字延迟到骗刀动画（举→停→收回）完整播完后才开始显示，时序：动作在前、字在后
    game.fakeNoticeStartAt = game.round.feintAnimEndAt;
    game.fakeNoticeUntil = game.round.feintAnimEndAt + 1000;
    game.fakeNoticeBaited = true; // 骗到钢筋：大字随机取一条（设置时冻结，避免每帧闪烁）
    game.fakeNoticeText = pickText(CONFIG.feintBaitedTexts);
    // feint 标志在 updateGame 中动画播完后再翻 false 并切换到补刀时间线
    // "骗你钢筋呢"提示在函数末尾统一设置（避免被"钢筋启动"覆盖）
  }
  // 蓄力刀：看到抬手（前摇开始）后交钢，无敌帧直接覆盖到命中点（必定成功）
  // 抬手前就按钢（落地秒按）不享受延长，走正常 500ms 无敌帧 → 距命中远时判"钢早了"
  const inWindup = now >= game.round.windupAt;
  const win = game.round.charged && inWindup && now < game.round.hitAt
    ? game.round.hitAt - now + 100
    : game.tuning.invincibleWindow;
  game.round.invincibleUntil = now + win;
  game.skillActiveUntil = now + 500;
  // 钢筋一按立刻进入疲劳（冷却从按下瞬间开始计时）
  game.cooldownEndAt = now + game.tuning.fatigueDuration;
  changeState(GameState.DASHING); playSound("press");
  const lead = game.round.hitAt - now;
  if (game.round.wasBaited) {
    // 被骗交钢：提示"骗你钢筋呢"（屠夫收回骗招后 0.7~1 秒内补刀，此时无敌帧必已过期）
    setMessage("骗你钢筋呢", pickText(CONFIG.feintBaitedTexts), "#fde68a", 900);
  } else {
    setMessage("钢筋启动", lead > 0 ? `距离预期命中约 ${Math.round(lead)}ms。` : "已经很晚了。", "#93c5fd", 650);
  }
  updateHud();
}

// ===== 武器状态计算（随时间线插值）=====
function computeWeaponState(now) {
  const w = CONFIG.weapon; const round = game.round;
  const st = { angle: w.restAngle, bodyTilt: 0, feintStep: 0, bodyScale: 1, phase: "rest" };
  if (!round || now < round.windupAt) {
    if (round && round.outcome === "success" && now >= round.bounceStartAt) {
      const bp = clamp((now - round.bounceStartAt) / 200, 0, 1);
      st.angle = lerp(w.swungAngle, w.bouncedAngle, easeOut(bp));
      st.bodyTilt = CONFIG.attackLean * (1 - bp) * 0.5;
      st.bodyScale = lerp(CONFIG.bodyScale.attackFwd, 1, easeOut(bp));
      st.phase = "bounce"; return st;
    }
    st.phase = "chase"; return st;
  }
  if (now < round.t0EndAt) {
    const p = clamp((now - round.windupAt) / Math.max(1, round.t0EndAt - round.windupAt), 0, 1);
    const e = easeInOut(p);
    // 真出刀/蓄力刀/骗刀都顺时针举刀到同一角度（骗刀更有欺骗性），骗刀举起后停顿收回
    const raised = round.feint ? w.feintRaisedAngle : w.raisedAngle;
    st.angle = lerp(w.restAngle, raised, e);
    // 骗刀不后仰（bodyTilt 为 0）
    st.bodyTilt = round.feint ? 0 : CONFIG.attackLean * e;
    st.bodyScale = 1 + ((round.feint ? CONFIG.bodyScale.feintBack : CONFIG.bodyScale.attackFwd) - 1) * e;
    st.phase = "t0"; return st;
  }
  if (now < round.hitAt) {
    if (round.feint) {
      const t1Dur = round.hitAt - round.t0EndAt;
      const pause = Math.min(CONFIG.feintPauseMs, t1Dur * 0.4);
      if (now < round.t0EndAt + pause) {
        st.angle = w.feintRaisedAngle; st.bodyTilt = 0;
        st.bodyScale = CONFIG.bodyScale.feintBack; st.phase = "feintPause"; return st;
      }
      const retP = clamp((now - (round.t0EndAt + pause)) / Math.max(1, t1Dur - pause), 0, 1);
      const e = easeInOut(retP);
      st.angle = lerp(w.feintRaisedAngle, w.restAngle, e);
      st.bodyTilt = 0;
      st.bodyScale = lerp(CONFIG.bodyScale.feintBack, 1, e);
      st.feintStep = CONFIG.feintStepBack * e;
      st.phase = "feintReturn"; return st;
    }
    const p = clamp((now - round.t0EndAt) / Math.max(1, round.hitAt - round.t0EndAt), 0, 1);
    const e = easeIn(p);
    // 蓄力刀与轻刀同一挥砍角度，只是 windup 时间更长（挥得更慢）
    st.angle = lerp(w.raisedAngle, w.swungAngle, e);
    st.bodyTilt = lerp(CONFIG.attackLean, CONFIG.attackChopLean, e);
    st.bodyScale = lerp(CONFIG.bodyScale.attackFwd, CONFIG.bodyScale.attackFwd * 1.03, e);
    st.phase = "t1"; return st;
  }
  if (round.outcome === "success") {
    const bp = clamp((now - round.bounceStartAt) / 200, 0, 1);
    st.angle = lerp(w.swungAngle, w.bouncedAngle, easeOut(bp));
    st.bodyTilt = CONFIG.attackChopLean * (1 - easeOut(bp));
    st.bodyScale = lerp(CONFIG.bodyScale.attackFwd, 1, easeOut(bp));
    st.phase = "bounce"; return st;
  }
  st.angle = w.swungAngle; st.bodyTilt = CONFIG.attackChopLean;
  st.bodyScale = CONFIG.bodyScale.attackFwd; st.phase = "t2"; return st;
}

// ===== 冲刺速度线 =====
function spawnSpeedLines() {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const cfg = CONFIG.speedLines;
  for (let i = 0; i < cfg.count; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 120;
    const speed = cfg.speed * (0.5 + Math.random() * 1.2);
    game.speedLines.push({
      x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      len: 20 + Math.random() * 40, born: performance.now(),
      life: cfg.life * (0.6 + Math.random() * 0.8), green: Math.random() < 0.5
    });
  }
}
function updateSpeedLines(now, dt) {
  if (!game.speedLines.length) return;
  const alive = [];
  for (let i = 0; i < game.speedLines.length; i += 1) {
    const p = game.speedLines[i];
    p.x += p.vx * (dt / 16); p.y += p.vy * (dt / 16);
    p.vx *= 1.02; p.vy *= 1.02;
    if (now - p.born < p.life) alive.push(p);
  }
  game.speedLines = alive;
}

// ===== 主更新循环逻辑 =====
function updateGame(now) {
  const dt = now - game.lastTime;
  game.lastTime = now; game.idleClock += dt;

  const target = game.lookBackHeld ? 1 : 0;
  const lookSpeed = clamp(dt * 0.01, 0, 0.22);
  game.lookBackBlend += (target - game.lookBackBlend) * lookSpeed;
  if (Math.abs(target - game.lookBackBlend) < 0.001) game.lookBackBlend = target;
  game.viewState = game.lookBackBlend > 0.5 ? "back" : "forward";

  if (now < game.screenShake.until) {
    const remain = clamp((game.screenShake.until - now) / Math.max(1, game.screenShake.duration || 1), 0, 1);
    const s = game.screenShake.intensity * remain;
    game.screenShake.x = (Math.random() * 2 - 1) * s;
    game.screenShake.y = (Math.random() * 2 - 1) * s * 0.7;
  } else { game.screenShake.x = 0; game.screenShake.y = 0; game.screenShake.intensity = 0; }

  if (game.flash.alpha > 0.001) game.flash.alpha = Math.max(0, game.flash.alpha - dt * 0.0014);
  else game.flash.alpha = 0;

  // 追逐声音量渐变（成功/被骗后渐弱"拉远"，新一轮恢复）
  updateChaseVolume(dt);
  // 钢筋黄条：按住回头（Shift/右键）时冻结保持，松开（正常向前）才慢慢消退
  if (game.deadhardCharge > 0 && !game.lookBackHeld) {
    game.deadhardCharge = Math.max(0, game.deadhardCharge - dt / CONFIG.deadhardDrainMs);
  }

  updateSpeedLines(now, dt);

  if (game.state === GameState.MENU) {
    game.weaponState = { angle: CONFIG.weapon.restAngle, bodyTilt: 0, feintStep: 0, bodyScale: 1, phase: "rest" };
    updateHud(); return;
  }
  if (game.state === GameState.COOLDOWN) {
    // 冷却中仍保持武器待发状态（不让画面看起来卡死）
    game.weaponState = { angle: CONFIG.weapon.restAngle, bodyTilt: 0, feintStep: 0, bodyScale: 1, phase: "rest" };
    if (now >= game.cooldownEndAt) { beginNewChase(now); setMessage("下一轮开始", "疲劳结束，重新进入追击。", "#f8fafc", 900); }
    updateHud(); return;
  }
  if ((game.state === GameState.SUCCESS || game.state === GameState.FAIL) && now >= game.resultEndAt) {
    if (game.pendingFatigue) {
      // 补刀轮结束（屠夫砍中倒地）：进入疲劳等待，红环继续转完剩下时间
      game.pendingFatigue = false;
      changeState(GameState.COOLDOWN);
    } else if (game.round && game.round.consumedSkill) {
      if (game.round.wasFeinted) {
        // 被骗交钢：屠夫立刻补一刀真刀（疲劳中你交不了钢，必倒地），补刀完才进疲劳等待
        game.pendingFatigue = true;
        beginNewChase(now + 300, { quick: true });
      } else {
        // 钢早/钢晚被砍中（真刀已砍中你）：直接进疲劳等待
        changeState(GameState.COOLDOWN);
      }
    } else {
      // 没交钢筋的失败/成功：短暂间隔后开下一轮
      beginNewChase(now + 300);
    }
    updateHud(); return;
  }
  if (!game.round || game.round.resolved) { game.weaponState = computeWeaponState(now); updateHud(); return; }

  if (game.state === GameState.DASHING && now > game.round.invincibleUntil) changeState(GameState.CHASE);

  // 被骗交钢：骗刀动画播完（feintAnimEndAt）后，翻成真刀并切换到补刀时间线
  // （必须在 computeWeaponState 和命中结算之前，保证动画与判定都用新时间线）
  if (game.round.feint && game.round.wasBaited && game.round.feintAnimEndAt && now >= game.round.feintAnimEndAt) {
    game.round.feint = false;
    const wt = game.tuning.windupTime;
    game.round.hitAt = game.round.baitHitAt;
    game.round.windupAt = game.round.hitAt - wt;
    game.round.t0EndAt = game.round.windupAt + wt * CONFIG.t0Ratio;
    game.round.feintAnimEndAt = 0;
  }

  game.weaponState = computeWeaponState(now);
  const sw = game.weaponState;
  // 挥刀声：真刀提前到 t0EndAt-120ms 播；骗刀在举刀开始(windupAt)就播，配合举刀动作
  if (!game.round.swingPlayed) {
    const sfxName = game.round.charged ? "swingCharged" : "swingLight";
    if (game.round.feint ? now >= game.round.windupAt : now >= game.round.t0EndAt - 120) {
      game.round.swingPlayed = true;
      swingAudioEl = playSfx(sfxName, 1.0) || null;
      if (!swingAudioEl) playSound("swing");
    }
  }
  if (sw.phase === "t1") {
    game.weaponTrail.push({ angle: sw.angle, t: now });
    if (game.weaponTrail.length > CONFIG.weapon.trailMaxFrames) game.weaponTrail.shift();
  }
  if (game.weaponTrail.length && now - game.weaponTrail[game.weaponTrail.length - 1].t > CONFIG.weapon.trailLifeMs) {
    game.weaponTrail = game.weaponTrail.filter(s => now - s.t < CONFIG.weapon.trailLifeMs);
  }
  if (sw.phase !== "t1" && game.weaponTrail.length && now > game.round.hitAt + 160) game.weaponTrail = [];

  if (now >= game.round.hitAt) {
    if (game.round.feint) {
      if (game.round.skillUsed) {
        resolveFailure(now, "骗你钢筋呢", "这刀是后仰骗招，你把钢筋交早了。", true, false, true);
      } else {
        game.fakeNoticeStartAt = now; game.fakeNoticeUntil = now + 650; game.fakeNoticeBaited = false;
        game.fakeNoticeText = pickText(CONFIG.feintNoBaitTexts); // 没骗到：大字随机取一条（设置时冻结）
        playSound("feint");
        setMessage("那是骗刀", "屠夫后仰收回，没有真的挥刀。", "#fde68a", 850);
        // 骗刀收回后快速重刀（0.6~2 秒内出刀，符合游戏节奏），追逐声保持连续
        game.round = createRound(now + randomRange(240, 640), { quick: true });
        changeState(GameState.CHASE);
      }
      updateHud(); return;
    }
    // 命中结算：无敌帧覆盖命中瞬间 = 钢筋成功；否则正常中刀判定词（骗刀的词已在交钢瞬间提示过）
    const isInvincible = game.round.skillUsed && now <= game.round.invincibleUntil;
    if (isInvincible) resolveSuccess(now);
    else {
      const desc = game.round.skillUsed
        ? "钢筋交得太早或太晚，无敌帧没覆盖到命中瞬间（t2）。"
        : "没有在命中前触发钢筋，直接吃刀倒地。";
      resolveFailure(now, "倒地！", desc, !!game.round.skillUsed, !!game.round.skillUsed, false);
    }
  }
  updateHud();
}

// ===== HUD 更新（DOM 统计 + 疲劳环 + 钢筋条）=====
function updateHud() {
  const s = game.stats; const cd = Math.max(0, game.cooldownEndAt - performance.now());
  const now = performance.now();
  ui.stateBadge.textContent = `状态：${STATE_LABELS[game.state] || game.state}`;
  ui.statTotal.textContent = String(s.totalAttempts);
  ui.statSuccess.textContent = String(s.successCount);
  ui.statFail.textContent = String(s.failCount);
  ui.statRate.textContent = formatPercent(s.successCount, s.totalAttempts);
  ui.statFeinted.textContent = String(s.feintedCount);
  ui.statAvgRt.textContent = s.reactionCount ? formatMs(s.reactionSum / s.reactionCount) : "--";
  // 疲劳状态：是否处于冷却（就绪 / 剩余秒数）
  ui.statBestStreak.textContent = game.state === GameState.COOLDOWN ? formatCooldown(cd) : "就绪";
  // 上次反应时间：是多少填多少，0也显示0（null=从未记录才显示--）
  ui.statCooldown.textContent = s.lastReactionTime !== null ? formatMs(s.lastReactionTime) : "--";
  // 时机练习栏只显示状态，不显示判定文字（判定文字由 Canvas 顶部统一显示，有/无 UI 都可见）
  ui.panelMsg.textContent = STATE_LABELS[game.state] || game.state;
  ui.panelMsg.style.color = "#bfdbfe";

  // —— 左侧两个独立条 ——
  // 1) 圆形疲劳条：只有按了钢筋（cooldownEndAt>0）才显示红色转圈，转完归零
  const fatiguePct = game.cooldownEndAt > now
    ? clamp(cd / game.tuning.fatigueDuration, 0, 1) * 100 : 0;
  ui.fatigueRing.style.setProperty("--pct", `${fatiguePct.toFixed(1)}%`);
  ui.fatigueRing.classList.toggle("idle", fatiguePct <= 0.05);

  // 2) 横向钢筋条：只有钢筋成功才充满变黄并保持不消退；
  //    按住回头（Shift/右键）时冻结，松开由 updateGame 慢慢扣减（模拟游戏掉黄条）
  ui.deadhardBar.style.width = `${(game.deadhardCharge * 100).toFixed(1)}%`;

  if (game.state === GameState.MENU) ui.menuCard.style.display = "block";
}
