"use strict";

// ===== 冲刺速度倍率（背景脉动）=====
function getSpeedMultiplier() {
  const now = performance.now();
  if (game.state === GameState.SUCCESS && now < game.speedBoostUntil) {
    const t = clamp((now - (game.speedBoostUntil - CONFIG.speedBoostDuration)) / 300, 0, 1);
    return lerp(1, CONFIG.speedBoostBgMultiplier, easeOut(t));
  }
  return 1;
}

/* ===== 静态滤镜离屏缓存 =====
 * ctx.filter 在 Canvas 2D 里非常昂贵：每次使用都会对整张图跑一遍滤镜管线。
 * 背景图/屠夫/手部每帧都用同一个固定滤镜，改为「首次使用时预渲染一次到离屏 canvas」，
 * 之后每帧只做普通 drawImage —— 输出像素完全一致，但省掉每帧的滤镜开销。 */
const _filterCache = {};
function filteredSource(img, filter, key) {
  if (!img) return null;
  if (!filter || filter === "none") return img;
  const hit = _filterCache[key];
  if (hit && hit.src === img && hit.filter === filter) return hit.canvas;
  const off = document.createElement("canvas");
  off.width = img.naturalWidth || img.width;
  off.height = img.naturalHeight || img.height;
  const octx = off.getContext("2d");
  octx.filter = filter;
  octx.drawImage(img, 0, 0);
  _filterCache[key] = { canvas: off, src: img, filter };
  return off;
}

/* ===== 渐变缓存（vignette 暗角只与画布尺寸有关，无需每帧重建）===== */
let _vigCache = { w: 0, h: 0, grad: null };
function vignetteGradient() {
  if (_vigCache.grad && _vigCache.w === canvas.width && _vigCache.h === canvas.height) return _vigCache.grad;
  const w = canvas.width, h = canvas.height;
  const g = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.34, w / 2, h * 0.42, h * 0.95);
  g.addColorStop(0, "rgba(10, 15, 24, 0)"); g.addColorStop(1, "rgba(10, 15, 24, 0.5)");
  _vigCache = { w, h, grad: g };
  return g;
}

// ===== 场景坐标（屠夫位置 / 头部摆动 / 地面）=====
function getScenePositions(now) {
  const inMenu = game.state === GameState.MENU;
  const bob = inMenu ? 0 : Math.sin(now * 0.012) * 6;
  const sway = inMenu ? 0 : Math.cos(now * 0.008) * 4;
  const backBlend = inMenu ? 0 : game.lookBackBlend;
  const forwardX = canvas.width * 0.9, backwardX = canvas.width * 0.5;
  let killerX = forwardX + (backwardX - forwardX) * backBlend;
  let killerY = canvas.height * 0.56 + bob * 0.35 - backBlend * 22;
  let killerScale = (0.58 + backBlend * 0.7) * (game.weaponState.bodyScale || 1);

  if (game.state === GameState.SUCCESS && now < game.speedBoostUntil) {
    const t = clamp((now - (game.speedBoostUntil - CONFIG.speedBoostDuration)) / CONFIG.speedBoostDuration, 0, 1);
    const e = easeOut(t);
    killerScale *= lerp(1, CONFIG.sprintKillerShrink, e);
    killerX += CONFIG.sprintKillerMoveRight * e;
  }
  if (game.weaponState.feintStep) killerX += game.weaponState.feintStep;
  // 蓄力刀 t1/t2 阶段身体前冲（攻击距离更远）
  if (game.round && game.round.charged && !game.round.feint) {
    const ws = game.weaponState;
    if (ws.phase === "t1" || ws.phase === "t2") {
      const t1p = ws.phase === "t2" ? 1 : clamp((now - game.round.t0EndAt) / Math.max(1, game.round.hitAt - game.round.t0EndAt), 0, 1);
      killerX -= CONFIG.charged.lunge * easeOut(t1p); // 向玩家方向前冲
      killerScale *= lerp(1, CONFIG.charged.scaleBoost, easeOut(t1p));
    }
  }
  if (game.state === GameState.FAIL) { killerX -= 20 + backBlend * 60; killerY -= 4; killerScale *= 1.05; }
  return { headBobY: bob, headBobX: sway, groundY: canvas.height * 0.68 + bob * 0.35, killerX, killerY, killerScale, backBlend };
}

// ===== 主绘制入口 =====
function draw() {
  const now = performance.now();
  const scene = getScenePositions(now);
  ctx.save();
  // 菜单时不做屏幕抖动偏移（画面静止）
  if (game.state !== GameState.MENU) ctx.translate(game.screenShake.x, game.screenShake.y);
  drawBackground(now, scene);
  drawKiller(now, scene);
  drawFirstPersonArms(now, scene);
  drawSpeedLines(now);
  drawSuccessGlow(now);
  drawVerdictText(now);
  drawHudLayer(now, scene.groundY);
  ctx.restore();
  drawFlash();
}

/* ===== 背景：优先使用 1.jpg（正面图，回头时不切换）；未加载回退程序渐变 ===== */
function drawBackground(now, scene) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(scene.headBobX * 0.6, scene.headBobY * 0.9);

  const front = assets.bgFront;
  if (!front || !front.loaded) {
    // —— 回退：程序渐变（原图缺失时仍有画面）——
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, CONFIG.bg.top); sky.addColorStop(0.55, CONFIG.bg.mid); sky.addColorStop(1, CONFIG.bg.bottom);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore(); return;
  }

  // —— 正面背景图（cover 铺满 + 视差余量）——
  // 视野随步伐脉动：与手部摆臂同频同相（s 同公式），前摆时视野微微前压（放大）
  // —— 这是第一人称跑步镜头的关键：手和视野一起动，画面才像"人在跑"而不是"相机在抖"
  // 菜单时画面完全静止（不脉动、不晃动）
  const inMenu = game.state === GameState.MENU;
  const bgRunT = now * 0.010;                                     // 与手部 runT 完全一致
  const bgPhase = bgRunT + Math.sin(now * 0.0016) * 0.12;         // 与手部 phase 完全一致
  const bgS = inMenu ? 0 : (Math.sin(bgPhase) + Math.sin(bgPhase * 2 + 0.9) * 0.10);
  // 回头时视野脉动反相（背后景物的光流方向与前进相反）
  drawBgCover(front.image, 1, 1 + bgS * 0.018 * (1 - clamp(scene.backBlend, 0, 1) * 2));

  // 贴地雾效（两端都渐隐，避免画面中部留硬截断分界线）
  const fogTop = scene.groundY - 240, fogBottom = scene.groundY + 70;
  const fog = ctx.createLinearGradient(0, fogTop, 0, fogBottom);
  fog.addColorStop(0, "rgba(150, 170, 210, 0)");
  fog.addColorStop(0.55, "rgba(150, 170, 210, 0.15)");
  fog.addColorStop(1, "rgba(150, 170, 210, 0)");
  ctx.fillStyle = fog; ctx.fillRect(0, fogTop, canvas.width, fogBottom - fogTop);

  // —— 前进光流粒子：方向随视角反转 ——
  // 朝前跑：粒子从消失点向外加速掠过（景物向后流）；
  // 回头看：物理上光流反向——粒子从屏幕边缘向消失点汇聚（跑过的路向后追来）
  // 菜单时不生成粒子（画面静止）
  const flow = game.flowParticles || (game.flowParticles = []);
  const vcx = canvas.width / 2, vcy = scene.groundY - 40;  // 消失点（画面中心偏下）
  const lookingBack = clamp(scene.backBlend, 0, 1) > 0.5;
  const mode = lookingBack ? "in" : "out";
  if (game.flowMode !== mode) { game.flowMode = mode; flow.length = 0; } // 切换视角时重建粒子池
  if (!inMenu && flow.length < (lookingBack ? 30 : 24) && Math.random() < (lookingBack ? 0.5 : 0.35)) {
    const ang = Math.random() * Math.PI * 2;
    const r0 = 20 + Math.random() * 90;
    if (!lookingBack) {
      flow.push({
        x: vcx + Math.cos(ang) * r0 * 1.7, y: vcy + Math.sin(ang) * r0 * 0.55,
        vx: Math.cos(ang) * 0.6, vy: Math.sin(ang) * 0.3 + 0.2,
        born: now, last: now, max: 700 + Math.random() * 700
      });
    } else {
      // 汇聚模式（回头）＝正面辐射的镜像：粒子从两侧远处沿径向直线飞向中央深处
      // （加速度与速度严格共线；比正面更快更密更亮）
      const angSide = Math.random() < 0.5 ? 0 : 1;
      const ang = angSide === 1
        ? (Math.random() - 0.5) * 1.7                    // 右侧扇区
        : Math.PI + (Math.random() - 0.5) * 1.7;         // 左侧扇区
      const R = 400 + Math.random() * 700;               // 出生半径（屏幕边缘内外）
      flow.push({
        x: vcx + Math.cos(ang) * R,
        y: vcy + Math.sin(ang) * R * 0.55,
        vx: -Math.cos(ang) * 1.5, vy: -Math.sin(ang) * 0.55 * 1.5, // 沿径向指向消失点
        born: now, last: now, max: 700 + Math.random() * 600
      });
    }
  }
  for (let i = flow.length - 1; i >= 0; i -= 1) {
    const p = flow[i];
    const dt = clamp(now - p.last, 0, 50); p.last = now;   // 帧间隔（限幅防切页跳变）
    if (!lookingBack) {
      // 辐射模式：速度 ∝ 距消失点的距离（越近移动越快）
      p.vx += (p.x - vcx) * 0.0004 * dt; p.vy += (p.y - vcy) * 0.0004 * dt;
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
    } else {
      // 汇聚模式：加速度指向消失点（与径向速度严格共线 → 直线，不拐弯）
      p.vx += (vcx - p.x) * 0.0004 * dt; p.vy += (vcy - p.y) * 0.0004 * dt;
      p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
    }
    const t = (now - p.born) / p.max;
    const dist = Math.hypot(p.x - vcx, p.y - vcy) / (canvas.width * 0.55);
    const outOfView = p.x < -80 || p.x > canvas.width + 80 || p.y > canvas.height + 80;
    const reachedVP = lookingBack && dist < 0.09;            // 飞抵消失点即消亡
    if (t >= 1 || outOfView || reachedVP) { flow.splice(i, 1); continue; }
    // 屠夫判定区（中央上部）：回头粒子进入时压到近透明，绝不干扰出刀判断
    const nearKiller = lookingBack && Math.abs(p.x - vcx) < 200 && p.y < vcy + 60;
    // 辐射模式越近越大越亮；回头模式＝镜像（离消失点越远越大，退向远方的景物）
    const distFactor = lookingBack ? clamp(dist, 0, 1) : dist;
    const size = 1.5 + distFactor * 7;
    let aFlow = Math.sin(t * Math.PI) * clamp(0.2 + distFactor * 0.5, 0, 0.55);
    if (nearKiller) aFlow *= 0.15;                           // 屠夫区几乎透明
    ctx.fillStyle = `rgba(205, 218, 240, ${aFlow.toFixed(3)})`;
    // 回头粒子略拉长成速度线（方向可读），正面保持短椭圆
    ctx.beginPath(); ctx.ellipse(p.x, p.y, size * (lookingBack ? 2.0 : 1.6), size * 0.55, Math.atan2(p.vy, p.vx), 0, Math.PI * 2); ctx.fill();
  }

  // 四周暗角：聚焦中心（屠夫与判定区），统一游戏暗色调（渐变按画布尺寸缓存，不每帧重建）
  ctx.fillStyle = vignetteGradient(); ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** 背景图 cover 铺满 + zoom 随步伐脉动；手机端 baseCover=1.0（桌面1.04） */
function drawBgCover(img, alpha, zoom = 1) {
  if (alpha <= 0.01) return;
  const baseCover = (game && game.isMobile) ? 1.0 : 1.04;
  const s = Math.max(canvas.width / img.width, canvas.height / img.height) * baseCover * zoom;
  const w = img.width * s, h = img.height * s;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  // 滤镜改为离屏预渲染缓存：不再每帧对全屏图跑滤镜（这是最大的一处性能开销）
  const src = filteredSource(img, "brightness(0.72) saturate(0.9) contrast(1.04)", "bg") || img;
  ctx.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.restore();
}

/* ===== 屠夫：仅绘制身体（7.png 已含头部），无红框描边 ===== */
function drawKiller(now, scene) {
  const x = scene.killerX + scene.headBobX * 0.5;
  const y = scene.killerY + scene.headBobY * 0.22;
  const scale = scene.killerScale;
  const ws = game.weaponState;
  const bodyW = 150, bodyH = 230;
  // 武器旋转支点 = 屠夫右手手掌（再往下一点，从手腕移到手掌）
  const handX = -42, handY = 14;

  ctx.save();
  ctx.globalAlpha = 1; // 强制不透明
  ctx.translate(x, y); ctx.scale(scale, scale);

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.ellipse(0, bodyH / 2 + 6, 70, 18, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.rotate(ws.bodyTilt);
  drawKillerBody(bodyW, bodyH);
  ctx.save();
  ctx.translate(handX, handY);
  drawWeaponWithTrail(ws);
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

function drawKillerBody(bodyW, bodyH) {
  // 7.png 是屠夫全身模型（含头部），直接绘制并提亮（不叠加单独头模型、不画红框）
  const asset = assets.killerBody;
  const dx = -bodyW / 2, dy = -bodyH / 2 + 10;
  if (asset && asset.loaded) {
    ctx.save();
    const src = filteredSource(asset.image, "brightness(1.18) contrast(1.12)", "killer") || asset.image;
    ctx.drawImage(src, dx, dy, bodyW, bodyH); ctx.restore();
  } else {
    ctx.fillStyle = "#312e81"; roundRect(ctx, dx, dy, bodyW, bodyH, 24); ctx.fill();
    ctx.strokeStyle = "#1e1b4b"; ctx.lineWidth = 13; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-30, -10); ctx.lineTo(-58, 26); ctx.moveTo(30, -10); ctx.lineTo(58, 26); ctx.stroke();
  }
}
// 武器绘制：残影仅在下劈(t1)时短暂出现，主武器不加 glow 阴影（避免屠夫周围出现透明刀影）
function drawWeaponWithTrail(ws) {
  const w = CONFIG.weapon; const asset = assets.killerWeapon;
  const imgW = w.drawW, imgH = w.drawH;
  const px = -imgW * w.pivotFracX, py = -imgH * w.pivotFracY;
  if (game.weaponTrail.length && ws.phase === "t1") {
    for (let i = 0; i < game.weaponTrail.length; i += 1) {
      const s = game.weaponTrail[i];
      const fade = (i + 1) / game.weaponTrail.length;
      ctx.save(); ctx.globalAlpha = w.trailAlpha * fade * 0.5; ctx.rotate(s.angle);
      drawWeaponShape(asset, px, py, imgW, imgH); ctx.restore();
    }
  }
  ctx.save();
  ctx.rotate(ws.angle);
  drawWeaponShape(asset, px, py, imgW, imgH);
  ctx.restore();
}
function drawWeaponShape(asset, px, py, imgW, imgH) {
  if (asset && asset.loaded) ctx.drawImage(asset.image, px, py, imgW, imgH);
  else {
    ctx.fillStyle = "#9ca3af"; roundRect(ctx, px + imgW * 0.28, py, imgW * 0.44, imgH * 0.66, 4); ctx.fill();
    ctx.fillStyle = "#4b5563"; roundRect(ctx, px + imgW * 0.34, py + imgH * 0.66, imgW * 0.32, imgH * 0.34, 4); ctx.fill();
  }
}

/* ===== 第一人称手部：只有 10.png，无白色前臂矩形 =====
 * 左/右手都是同一张 10.png，正向使用；左手额外做水平镜像。
 */
function drawFirstPersonArms(now, scene) {
  const armAlpha = 1 - scene.backBlend * 1.1;
  const a = CONFIG.arms;
  // 黄色发光（手 + 底部光丘）只在钢筋判定成功后（冲刺加速期）出现，按钢瞬间不亮
  const sprinting = game.state === GameState.SUCCESS && now < game.speedBoostUntil;
  // 向后看时手臂不可见：钢筋发光效果改为屏幕底部的黄色柔光晕
  // （屏幕空间大椭圆弧光带：贴底窄窄一层、中间稍微突出，blur 柔化无硬边）
  // 注意：必须直接用 ctx.ellipse 画屏幕空间椭圆——不能用 scale 压圆，
  // 否则 lineWidth 会被非均匀缩放压细到几乎不可见
  if (sprinting) {
    const glowAlpha = clamp(scene.backBlend, 0, 1) * (1 - clamp(armAlpha, 0, 1));
    if (glowAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = clamp(glowAlpha, 0, 1);
      const rx = canvas.width * 0.5;                     // 椭圆水平半径（光丘宽度）
      const ry = Math.max(140, canvas.height * 0.18);    // 椭圆垂直半径（弧的扁度）
      const lift = Math.max(30, canvas.height * 0.035);  // 中点突出高度
      const cy = canvas.height + ry - lift;              // 圆心压在底边之下，只露浅弧
      ctx.filter = "blur(14px)";                         // 边缘柔化，无硬边
      // 实心光丘：填满整个上半椭圆（弧顶到底边之间不留空），径向渐变贴底边最亮
      const g = ctx.createRadialGradient(canvas.width / 2, cy, 0, canvas.width / 2, cy, rx);
      g.addColorStop(0, "rgba(253, 224, 71, 0.5)");
      g.addColorStop(0.2, "rgba(253, 224, 71, 0.45)");   // 弧顶一带
      g.addColorStop(0.6, "rgba(253, 224, 71, 0.22)");   // 向两侧渐淡
      g.addColorStop(1, "rgba(253, 224, 71, 0)");        // 弧两端完全渐隐
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, cy, rx, ry, 0, Math.PI, Math.PI * 2); // 上半椭圆
      ctx.closePath(); // 弦在屏幕外，屏幕内即实心光丘
      ctx.fill();
      ctx.restore();
    }
  }
  if (armAlpha <= 0.02) return;
  // 手锚点在屏幕底边之下 baseDrop 像素（画面底部）
  const baseY = canvas.height + a.baseDrop + scene.backBlend * 90;
  // —— 逃跑摆臂：双手严格镜像交替前伸 ——
  // 大步频（每秒约 1.3 步）+ 弧线摆动轨迹（绕屏幕外手腕关节转，显手臂长）
  // 一只手前摆：靠近放大、上抬、向中间前伸、手腕微立；另一只手镜像后收
  // 菜单时手臂静止（画面不动）
  const inMenu = game.state === GameState.MENU;
  const runT = now * 0.010;                                        // 步频主频（慢 = 大步狂奔）
  const phase = runT + Math.sin(now * 0.0016) * 0.12;              // 步频 + 缓慢漂移
  const s = inMenu ? 0 : (Math.sin(phase) + Math.sin(phase * 2 + 0.9) * 0.10);    // 纵向摆动量（含轻微急缓）
  const sx = inMenu ? 0 : (Math.sin(phase - 0.6) + Math.sin(phase * 2 - 0.3) * 0.10); // 横向分量（相位滞后 → 弧线轨迹）
  const sway = inMenu ? 0 : (scene.headBobX * 2.2);               // 头部摆动联动（双手一致）

  ctx.save(); ctx.globalAlpha = clamp(armAlpha, 0, 1);
  drawHand(canvas.width * a.leftX + sway + sx * a.bobAmp * 0.55,   // 前伸 = 向中间（滞后相位画弧）
           baseY - s * a.bobAmp,                                   // 前摆上抬（全幅）
           a.rotLeft + s * 0.09,                                   // 前伸手腕微立
           sprinting, -1, 1 + s * 0.09);                           // 靠近放大
  drawHand(canvas.width * a.rightX + sway - sx * a.bobAmp * 0.55,
           baseY + s * a.bobAmp,
           a.rotRight - s * 0.09,
           sprinting, 1, 1 - s * 0.09);
  ctx.restore();
}

/** 单手绘制：10.png 正向（指尖朝上），左手（dir<0）水平镜像。
 *  glowing=钢筋成功冲刺期发光；zScale=前后纵深缩放（近大远小）。 */
function drawHand(x, y, rot, glowing, dir, zScale) {
  const a = CONFIG.arms;
  const asset = assets.survivorHands;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  if (zScale && zScale !== 1) ctx.scale(zScale, zScale);

  ctx.shadowColor = a.shadowColor; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6;
  if (glowing) { ctx.shadowColor = "rgba(253, 224, 71, 0.8)"; ctx.shadowBlur = 22; }

  if (asset && asset.loaded) {
    const hw = a.handW * a.widthScale, hh = a.handH; // widthScale 只横向拉宽（调粗细）
    ctx.save();
    // 压暗去光泽：太亮太光滑的照片风手部图适配暗色游戏画面（调这里：arms.imgFilter）
    const src = filteredSource(asset.image, a.imgFilter, "hands") || asset.image;
    if (dir < 0) ctx.scale(-1, 1);  // 左手镜像（右手手背图镜像后即左手）
    // 图片底部贴在锚点上方 liftY 处：liftY 调大 = 手上移
    ctx.drawImage(src, -hw / 2, -hh - a.liftY, hw, hh);
    ctx.restore();
  } else if (asset && asset.failed) {
    // 仅加载失败才回退白色方块手；加载中（未成功也未失败）不画，避免刷新时 fallback 一闪而过
    const s = a.handW * 0.5;
    ctx.fillStyle = a.color;
    ctx.fillRect(-s / 2, -s - a.liftY, s, s);
  }
  ctx.restore();
}

function drawSpeedLines(now) {
  if (!game.speedLines.length) return;
  ctx.save(); ctx.lineCap = "round";
  for (let i = 0; i < game.speedLines.length; i += 1) {
    const p = game.speedLines[i];
    const t = clamp((now - p.born) / p.life, 0, 1);
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = p.green ? "#86efac" : "#ffffff";
    ctx.lineWidth = 2 + (1 - t) * 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * (p.len / 16), p.y - p.vy * (p.len / 16));
    ctx.stroke();
  }
  ctx.restore();
}

/* 成功绿色边缘光晕 */
function drawSuccessGlow(now) {
  if (now >= game.successGlowUntil) return;
  const t = clamp((game.successGlowUntil - now) / CONFIG.successGlowDuration, 0, 1);
  const alpha = t * 0.7;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = Math.max(canvas.width, canvas.height) * 0.75;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  grad.addColorStop(0, "rgba(74, 222, 128, 0)");
  grad.addColorStop(1, `rgba(74, 222, 128, ${alpha})`);
  ctx.save(); ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
}

/* 判定结果文字：在 Canvas 顶部绘制，不遮挡屠夫模型；淡入较慢，不干扰出刀时机判断；不受 UI 隐藏影响 */
function drawVerdictText(now) {
  let title = "", sub = "", color = "#ffffff";
  if (game.state === GameState.SUCCESS && now < game.speedBoostUntil) {
    title = "钢筋成功！"; sub = (game.round && game.round.verdictSub) || "好钢"; color = "#dcfce7";
  } else if (game.state === GameState.FAIL && now < game.resultEndAt) {
    // 用本回合 wasFeinted 判断（被骗交钢的中刀走正常"倒地！"，骗刀的词在交钢瞬间提示）
    title = (game.round && game.round.wasFeinted) ? "骗你钢筋呢" : "倒地！";
    sub = (game.round && game.round.verdictSub) || "";
    color = "#fecaca";
  } else return;

  // 记录本回合结果起始时间，做较慢的淡入（约 260ms），避免突然跳出干扰观察
  if (!game._verdictStartAt || game.state !== game._verdictLastState) {
    game._verdictStartAt = now; game._verdictLastState = game.state;
  }
  const fadeIn = clamp((now - game._verdictStartAt) / 260, 0, 1);
  const remain = clamp((game.resultEndAt - now) / 950, 0, 1);
  const alpha = Math.min(fadeIn, remain > 0.25 ? 1 : remain / 0.25);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color === "#dcfce7" ? "rgba(74, 222, 128, 0.85)" : "rgba(251, 113, 133, 0.85)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  // 放在屏幕最上部，不遮挡右侧屠夫模型；手机端顶栏占位多，下移避开
  const verdictY = window.innerWidth < 800 ? 0.15 : 0.09;
  const fontSize = Math.max(38, Math.min(52, window.innerWidth * 0.078));
  ctx.font = `900 ${fontSize}px 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  ctx.fillText(title, canvas.width / 2, canvas.height * verdictY);
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(18, Math.min(22, window.innerWidth * 0.026))}px 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  ctx.fillText(sub, canvas.width / 2, canvas.height * verdictY + fontSize * 0.95);
  ctx.restore();
}

function drawHudLayer(now, groundY) {
  const round = game.round;
  if (round && !round.resolved && now >= game.fakeNoticeStartAt && game.fakeNoticeUntil > now) {
    ctx.save();
    ctx.fillStyle = "#fde68a";
    ctx.font = "bold 28px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center"; // 居中：随机词长短不一，用对齐而不是手动偏移
    // 骗刀 Canvas 大字：文字在设置 fakeNoticeUntil 时随机抽好冻结（fakeNoticeText），
    // 不读当前回合状态——否则骗刀后的快速重刀轮一按钢就会被误判成"骗到"
    // 【手动改骗刀大字：改 CONFIG 里的 feintBaitedTexts / feintNoBaitTexts 两个池】
    ctx.fillText(game.fakeNoticeText, canvas.width / 2, groundY - 350);
    ctx.restore();
  }
}

function drawFlash() {
  if (game.flash.alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp(game.flash.alpha, 0, 1);
  if (game.flash.type === "edge") {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const r = Math.max(canvas.width, canvas.height) * 0.75;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, game.flash.color);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else { ctx.fillStyle = game.flash.color; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr); c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr); c.arcTo(x, y, x + w, y, rr); c.closePath();
}

/* ===== 自适应：Canvas 跟随窗口大小，坐标全部用比例 =====
 * 这里采用 1:1 CSS 像素（不做 DPR 放大），保证 canvas.width/height
 * 与 CSS 绘制坐标一致，所有按比例计算的位置（canvas.width*0.5 等）才正确。
 */
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
}
