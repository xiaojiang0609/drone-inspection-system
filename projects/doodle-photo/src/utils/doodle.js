/**
 * 手绘风箭头 + 手写字 + 像素轨迹轮廓 + 贴纸渲染工具
 *
 * 坐标约定：
 *   API 返回 0-1000 归一化坐标，
 *   渲染时乘以 canvas 实际宽高得到像素坐标。
 *
 * 轮廓数据优先级：
 *   shape_points (密集像素轨迹) > polygon (稀疏点集) > box_2d (矩形兜底)
 */

import { FONT_CN } from './fonts.js'
export { ensureFontLoaded } from './fonts.js'

function safeMeasureText(ctx, text) {
  return ctx.measureText(text)
}

// ─── 工具函数 ─────────────────────────────────────────────

function jitter(v, seed, amp = 1.2) {
  return v + Math.sin(seed * 3.17 + v * 0.08) * amp
}

/**
 * 确定性伪随机数生成器（mulberry32）
 */
function seededRandom(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function wobblyArc(ctx, cx, cy, r, startAngle, endAngle, seed, segs = 12) {
  const span = endAngle - startAngle
  for (let i = 0; i < segs; i++) {
    const a0 = startAngle + span * (i / segs)
    const a1 = startAngle + span * ((i + 0.5) / segs)
    const a2 = startAngle + span * ((i + 1) / segs)
    const w = 1.2
    const x0 = cx + (r + Math.sin(seed + i * 2.1) * w) * Math.cos(a0)
    const y0 = cy + (r + Math.sin(seed + i * 2.1) * w) * Math.sin(a0)
    const cpx = cx + (r + Math.sin(seed + i * 2.1 + 0.5) * w * 1.5) * Math.cos(a1)
    const cpy = cy + (r + Math.sin(seed + i * 2.1 + 0.5) * w * 1.5) * Math.sin(a1)
    const x2 = cx + (r + Math.sin(seed + (i + 1) * 2.1) * w) * Math.cos(a2)
    const y2 = cy + (r + Math.sin(seed + (i + 1) * 2.1) * w) * Math.sin(a2)
    if (i === 0) ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(cpx, cpy, x2, y2)
  }
}

function mapPoints(points, sx, sy) {
  return points.map(([x, y]) => [x * sx, y * sy])
}

// ─── 像素级轮廓描边（断线速写风 + 局部描边）────────────────────────────

/**
 * drawPerfectOutline — 不规则像素轨迹描边（支持断线呼吸感）
 *
 * 新增：当点数过多时，只抽取 ~30% 平滑路段绘制，
 * 形成"速写未完稿"的呼吸感，避免密集轮廓显得零碎杂乱。
 */
export function drawPerfectOutline(ctx, shapePoints, cw, ch, opts = {}) {
  if (!shapePoints || shapePoints.length < 2) return

  const {
    color = '#fff',
    lineWidth = 2,
    seed = 0,
    closed = false,
    jitterAmp = 0.8,
  } = opts

  const sx = cw / 1000
  const sy = ch / 1000
  const pts = mapPoints(shapePoints, sx, sy)
  const n = pts.length
  const rng = seededRandom(seed * 1337)

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = lineWidth * 2.5
  ctx.shadowOffsetX = lineWidth * 0.5
  ctx.shadowOffsetY = lineWidth * 0.5

  ctx.beginPath()

  // 间歇性手绘线：画 7 个点，跳 2 个点（空白率仅 22%，主体标记清晰）
  for (let i = 0; i < n; i++) {
    const jx = (rng() * 2 - 1) * jitterAmp
    const jy = (rng() * 2 - 1) * jitterAmp
    const x = pts[i][0] + jx
    const y = pts[i][1] + jy

    const cycle = i % 9
    if (cycle < 7) {
      if (cycle === 0 || i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    } else {
      ctx.moveTo(x, y)
    }
  }

  if (closed) ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/**
 * 通用轮廓描边（兼容 shape_points / polygon / box_2d）
 *
 * 返回像素坐标的点集（供箭头起点计算使用）
 */
function drawOutline(ctx, det, cw, ch, seed, sf = 1) {
  const sx = cw / 1000
  const sy = ch / 1000

  // 优先：密集 shape_points（不规则像素轨迹，不闭合）
  if (det.shape_points && det.shape_points.length >= 2) {
    drawPerfectOutline(ctx, det.shape_points, cw, ch, {
      color: '#fff', lineWidth: 3.0 * sf, seed, closed: false,
      jitterAmp: 0.8 * sf, gapRate: 0.15,
    })
    return mapPoints(det.shape_points, sx, sy)
  }

  // 次选：polygon（不规则多边形，闭合）
  if (det.polygon && det.polygon.length >= 3) {
    drawPerfectOutline(ctx, det.polygon, cw, ch, {
      color: '#fff', lineWidth: 2 * sf, seed, closed: true,
      jitterAmp: 1.0 * sf, gapRate: 0.2,
    })
    return mapPoints(det.polygon, sx, sy)
  }

  // 兜底：box_2d → 矩形 4 点，闭合
  if (det.box_2d) {
    const [y1, x1, y2, x2] = det.box_2d
    const rect = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
    drawPerfectOutline(ctx, rect, cw, ch, {
      color: '#fff', lineWidth: 2 * sf, seed, closed: true,
      jitterAmp: 1.2 * sf, gapRate: 0.2,
    })
    return mapPoints(rect, sx, sy)
  }

  return []
}

// ─── 箭头起点计算 ─────────────────────────────────────────

/**
 * 从轮廓像素点集中找到最佳箭头起点
 */
function findArrowOrigin(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 }

  const n = pts.length
  let bestIdx = 0
  let bestScore = -Infinity
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]
    const score = x * 1.0 - y * 0.3
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  const [ox, oy] = pts[bestIdx]
  const prev = pts[(bestIdx - 1 + n) % n]
  const next = pts[(bestIdx + 1) % n]
  const tx = next[0] - prev[0]
  const ty = next[1] - prev[1]
  const tlen = Math.sqrt(tx * tx + ty * ty) || 1
  const nx = -ty / tlen
  const ny = tx / tlen

  return {
    x: ox + nx * 10,
    y: oy + ny * 10,
  }
}

// ─── 手绘风箭头（虚线 + 尾部发散装饰线）───────────────────────

export function drawWobblyLine(ctx, x1, y1, x2, y2, opts = {}) {
  const { color = '#fff', lineWidth = 2, wobble = 1.5, seed = 0 } = opts

  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return

  const nx = -dy / len, ny = dx / len
  const cpOffset = Math.sin(seed * 1.7) * wobble * 2.5
  const cpx = x1 + dx * 0.5 + nx * cpOffset
  const cpy = y1 + dy * 0.5 + ny * cpOffset

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(cpx, cpy, x2, y2)
  ctx.stroke()
  ctx.restore()
}

/**
 * 手绘风箭头 — 贝塞尔曲线 + 虚线 + 尾部发散装饰线（彡 风格）
 */
export function drawWobblyArrow(ctx, x1, y1, x2, y2, opts = {}) {
  const {
    color = '#fff', lineWidth = 1.8, wobble = 1.5,
    seed = 0, dashed = true,
  } = opts

  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return

  const headLen = Math.min(14, len * 0.22)
  const ux = dx / len, uy = dy / len
  const endX = x2 - ux * headLen
  const endY = y2 - uy * headLen

  const nx = -dy / len, ny = dx / len
  const arc = Math.sin(seed * 1.3) * wobble * 4
  const cp1x = x1 + dx * 0.33 + nx * arc
  const cp1y = y1 + dy * 0.33 + ny * arc
  const cp2x = x1 + dx * 0.66 - nx * arc * 0.5
  const cp2y = y1 + dy * 0.66 - ny * arc * 0.5

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetX = 1.5
  ctx.shadowOffsetY = 1.5

  if (dashed) ctx.setLineDash([4, 4])

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY)
  ctx.stroke()

  ctx.setLineDash([])

  // 箭头三角
  const angle = Math.atan2(endY - cp2y, endX - cp2x)
  const spread = 0.4
  ctx.beginPath()
  ctx.moveTo(
    x2 - headLen * Math.cos(angle - spread),
    y2 - headLen * Math.sin(angle - spread),
  )
  ctx.lineTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + spread),
    y2 - headLen * Math.sin(angle + spread),
  )
  ctx.stroke()

  // ── 尾部发散装饰线（彡 风格，3 根不同角度）──
  const tailAngle = Math.atan2(dy, dx) + Math.PI // 箭头反方向
  ctx.lineWidth = lineWidth * 0.6
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 3; i++) {
    const spreadAngle = tailAngle + (i - 1) * 0.35
    const lineLen = 6 + i * 2
    const tx = x1 + Math.cos(spreadAngle) * lineLen
    const ty = y1 + Math.sin(spreadAngle) * lineLen
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(tx, ty)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ─── 灵魂贴纸库（精致手绘简笔画）─────────────────────────────

/** 手绘爱心 — 带双线条 + 不对称可爱感 */
export function drawStickerHeart(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2 * sf
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  const w = (v, i) => jitter(v, seed + i, s * 0.04)
  // 外框
  ctx.beginPath()
  ctx.moveTo(w(cx, 0), w(cy + s * 0.3, 1))
  ctx.bezierCurveTo(w(cx, 2), w(cy - s * 0.1, 3), w(cx - s * 0.5, 4), w(cy - s * 0.15, 5), w(cx - s * 0.5, 6), w(cy + s * 0.05, 7))
  ctx.bezierCurveTo(w(cx - s * 0.5, 8), w(cy + s * 0.3, 9), w(cx, 10), w(cy + s * 0.55, 11), w(cx, 12), w(cy + s * 0.6, 13))
  ctx.bezierCurveTo(w(cx, 14), w(cy + s * 0.55, 15), w(cx + s * 0.5, 16), w(cy + s * 0.3, 17), w(cx + s * 0.5, 18), w(cy + s * 0.05, 19))
  ctx.bezierCurveTo(w(cx + s * 0.5, 20), w(cy - s * 0.15, 21), w(cx, 22), w(cy - s * 0.1, 23), w(cx, 0), w(cy + s * 0.3, 1))
  ctx.stroke()
  // 内线（缩小版，不对称偏移）
  const inner = 0.6
  ctx.globalAlpha = 0.4
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(cx + s * 0.02, cy + s * 0.3 * inner + s * 0.12)
  ctx.bezierCurveTo(cx + s * 0.02, cy - s * 0.1 * inner + s * 0.12, cx - s * 0.45 * inner + s * 0.03, cy - s * 0.15 * inner + s * 0.12, cx - s * 0.45 * inner + s * 0.03, cy + s * 0.12)
  ctx.bezierCurveTo(cx - s * 0.45 * inner + s * 0.03, cy + s * 0.3 * inner + s * 0.12, cx + s * 0.02, cy + s * 0.5 * inner + s * 0.12, cx + s * 0.02, cy + s * 0.55 * inner + s * 0.12)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

/** 手绘星星 — 四角星 ✧ 大小不一闪烁 */
export function drawStickerStar(ctx, cx, cy, size, seed = 0, sf = 1) {
  const r = size * 0.5, ri = r * 0.4
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2 * sf
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2
    const rad = i % 2 === 0 ? r : ri
    const x = cx + jitter(Math.cos(angle) * rad, seed + i, 1.5)
    const y = cy + jitter(Math.sin(angle) * rad, seed + i + 10, 1.5)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()

  // 中心十字闪光
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 1
  const cr = r * 0.3
  ctx.beginPath()
  ctx.moveTo(cx - cr, cy)
  ctx.lineTo(cx + cr, cy)
  ctx.moveTo(cx, cy - cr)
  ctx.lineTo(cx, cy + cr)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

/** 双音符 🎵 */
export function drawStickerMusic(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineWidth = 2 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  const headRx = s * 0.18, headRy = s * 0.13
  const headX = cx - s * 0.1, headY = cy + s * 0.2
  ctx.beginPath()
  ctx.ellipse(jitter(headX, seed, 1), jitter(headY, seed + 1, 1), headRx, headRy, -0.3, 0, Math.PI * 2)
  ctx.fill()

  const stemX = jitter(cx + s * 0.06, seed + 2, 1)
  const stemTopY = jitter(cy - s * 0.35, seed + 3, 1.5)
  drawWobblyLine(ctx, stemX, headY - headRy * 0.5, stemX, stemTopY, { color: '#fff', lineWidth: 2 * sf, wobble: 0.8 * sf, seed: seed + 4 })

  ctx.beginPath()
  ctx.moveTo(stemX, stemTopY)
  ctx.bezierCurveTo(
    jitter(stemX + s * 0.2, seed + 5, 1), jitter(stemTopY + s * 0.05, seed + 6, 1),
    jitter(stemX + s * 0.25, seed + 7, 1), jitter(stemTopY + s * 0.15, seed + 8, 1),
    jitter(stemX + s * 0.1, seed + 9, 1), jitter(stemTopY + s * 0.25, seed + 10, 1),
  )
  ctx.stroke()

  // 第二个音符（偏右上，略小）
  const ox = s * 0.35, oy = -s * 0.15
  const headX2 = cx + ox - s * 0.08, headY2 = cy + oy + s * 0.18
  ctx.beginPath()
  ctx.ellipse(jitter(headX2, seed + 20, 1), jitter(headY2, seed + 21, 1), headRx * 0.8, headRy * 0.8, -0.3, 0, Math.PI * 2)
  ctx.fill()

  const stemX2 = cx + ox + s * 0.04
  const stemTopY2 = cy + oy - s * 0.28
  drawWobblyLine(ctx, stemX2, headY2 - headRy * 0.4, stemX2, stemTopY2, { color: '#fff', lineWidth: 1.8 * sf, wobble: 0.6 * sf, seed: seed + 22 })

  ctx.beginPath()
  ctx.moveTo(stemX2, stemTopY2)
  ctx.bezierCurveTo(
    stemX2 + s * 0.15, stemTopY2 + s * 0.03,
    stemX2 + s * 0.18, stemTopY2 + s * 0.1,
    stemX2 + s * 0.08, stemTopY2 + s * 0.18,
  )
  ctx.stroke()
  ctx.restore()
}

/** 花朵 */
export function drawStickerFlower(ctx, cx, cy, size, seed = 0, sf = 1) {
  const r = size * 0.45
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.8 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  for (let i = 0; i < 5; i++) {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
    const px = cx + Math.cos(angle) * r * 0.55
    const py = cy + Math.sin(angle) * r * 0.55
    ctx.beginPath()
    wobblyArc(ctx, jitter(px, seed + i, 1), jitter(py, seed + i + 5, 1),
              r * 0.38, angle - Math.PI * 0.7, angle + Math.PI * 0.7, seed + i * 7, 8)
    ctx.stroke()
  }
  // 花心
  ctx.beginPath()
  wobblyArc(ctx, cx, cy, r * 0.15, 0, Math.PI * 2, seed + 100, 8)
  ctx.stroke()
  ctx.restore()
}

/** 棉花糖云朵 */
export function drawStickerCloud(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.5
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.8 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  for (const b of [
    { ox: -s * 0.6, oy: 0, r: s * 0.35 },
    { ox: -s * 0.25, oy: -s * 0.2, r: s * 0.4 },
    { ox: s * 0.2, oy: -s * 0.15, r: s * 0.35 },
    { ox: s * 0.55, oy: 0, r: s * 0.3 },
  ]) {
    ctx.beginPath()
    wobblyArc(ctx, cx + jitter(b.ox, seed, 1.5), cy + jitter(b.oy, seed + 1, 1.5),
              b.r + Math.sin(seed + b.ox) * 1.2, Math.PI * 0.8, Math.PI * 2.2, seed + b.ox * 3, 10)
    ctx.stroke()
  }
  // 底部波浪线
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 1
  ctx.beginPath()
  const waveY = cy + s * 0.25
  for (let i = 0; i < 6; i++) {
    const wx = cx - s * 0.7 + i * s * 0.28
    const wy = waveY + Math.sin(seed + i * 1.5) * 2
    if (i === 0) ctx.moveTo(wx, wy)
    else ctx.lineTo(wx, wy)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

/** 双线条小爱心 ♡ */
export function drawStickerSmallHeart(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.4
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5 * sf
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 2 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1

  const w = (v, i) => jitter(v, seed + i, s * 0.05)
  // 外框
  ctx.beginPath()
  ctx.moveTo(w(cx, 0), w(cy + s * 0.25, 1))
  ctx.bezierCurveTo(w(cx, 2), w(cy - s * 0.15, 3), w(cx - s * 0.45, 4), w(cy - s * 0.2, 5), w(cx - s * 0.45, 6), w(cy, 7))
  ctx.bezierCurveTo(w(cx - s * 0.45, 8), w(cy + s * 0.25, 9), w(cx, 10), w(cy + s * 0.5, 11), w(cx, 12), w(cy + s * 0.55, 13))
  ctx.bezierCurveTo(w(cx, 14), w(cy + s * 0.5, 15), w(cx + s * 0.45, 16), w(cy + s * 0.25, 17), w(cx + s * 0.45, 18), w(cy, 19))
  ctx.bezierCurveTo(w(cx + s * 0.45, 20), w(cy - s * 0.2, 21), w(cx, 22), w(cy - s * 0.15, 23), w(cx, 0), w(cy + s * 0.25, 1))
  ctx.stroke()
  // 内线
  const inner = 0.65
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(cx, cy + s * 0.25 * inner + s * 0.1)
  ctx.bezierCurveTo(cx, cy - s * 0.15 * inner + s * 0.1, cx - s * 0.45 * inner, cy - s * 0.2 * inner + s * 0.1, cx - s * 0.45 * inner, cy + s * 0.1)
  ctx.bezierCurveTo(cx - s * 0.45 * inner, cy + s * 0.25 * inner + s * 0.1, cx, cy + s * 0.5 * inner + s * 0.1, cx, cy + s * 0.55 * inner + s * 0.1)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

/** 闪烁四角星 ✧ */
export function drawStickerSparkle(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.4
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.8 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 2 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4
    const r = i % 2 === 0 ? s : s * 0.45
    ctx.beginPath()
    ctx.moveTo(
      cx + jitter(Math.cos(a) * s * 0.15, seed + i, 0.5),
      cy + jitter(Math.sin(a) * s * 0.15, seed + i + 4, 0.5),
    )
    ctx.lineTo(
      cx + jitter(Math.cos(a) * r, seed + i + 8, 0.8),
      cy + jitter(Math.sin(a) * r, seed + i + 12, 0.8),
    )
    ctx.stroke()
  }
  ctx.restore()
}

/** 飘落叶子 */
export function drawStickerLeaf(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.5
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 2 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  const rot = Math.sin(seed) * 0.5
  ctx.translate(cx, cy)
  ctx.rotate(rot)

  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.bezierCurveTo(s * 0.6, -s * 0.5, s * 0.5, s * 0.3, 0, s)
  ctx.bezierCurveTo(-s * 0.5, s * 0.3, -s * 0.6, -s * 0.5, 0, -s)
  ctx.stroke()
  ctx.globalAlpha = 0.4
  ctx.lineWidth = 1 * sf
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.8)
  ctx.lineTo(0, s * 0.8)
  ctx.moveTo(0, -s * 0.2)
  ctx.lineTo(s * 0.2, -s * 0.5)
  ctx.moveTo(0, s * 0.2)
  ctx.lineTo(-s * 0.2, -s * 0.1)
  ctx.stroke()

  ctx.globalAlpha = 1
  ctx.restore()
}

/** 小蝴蝶 */
export function drawStickerButterfly(ctx, cx, cy, size, seed = 0, sf = 1) {
  void seed
  const s = size * 0.35
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 2 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  ctx.beginPath()
  ctx.ellipse(cx - s * 0.5, cy - s * 0.1, s * 0.5, s * 0.35, -0.3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(cx + s * 0.5, cy - s * 0.1, s * 0.5, s * 0.35, 0.3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - s * 0.5)
  ctx.lineTo(cx, cy + s * 0.4)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - s * 0.4)
  ctx.quadraticCurveTo(cx - s * 0.3, cy - s * 0.8, cx - s * 0.4, cy - s * 0.7)
  ctx.moveTo(cx, cy - s * 0.4)
  ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.8, cx + s * 0.4, cy - s * 0.7)
  ctx.stroke()

  ctx.restore()
}

/** 圆脸笑脸 (◡‿◡) — 歪歪扭扭手绘圆 */
export function drawStickerSmiley(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.5
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.8 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 3 * sf
  ctx.shadowOffsetX = 1 * sf
  ctx.shadowOffsetY = 1 * sf

  // 歪歪扭扭的脸圆：椭圆 + 手抖扰动，用 4 段贝塞尔拼接
  const rx = s * (1.0 + Math.sin(seed) * 0.08)  // 横向微扁
  const ry = s * (1.0 + Math.cos(seed) * 0.06)  // 纵向微扁
  const offX = Math.sin(seed * 2.3) * s * 0.04  // 圆心横向偏移
  const offY = Math.cos(seed * 1.7) * s * 0.03  // 圆心纵向偏移
  const k = 0.5523  // 贝塞尔逼近圆的系数
  ctx.beginPath()
  ctx.moveTo(cx + offX + rx, cy + offY)
  ctx.bezierCurveTo(cx + offX + rx, cy + offY - ry * k + Math.sin(seed + 1) * 2,
                     cx + offX - rx * k + Math.cos(seed + 2) * 2, cy + offY - ry,
                     cx + offX, cy + offY - ry)
  ctx.bezierCurveTo(cx + offX + rx * k + Math.sin(seed + 3) * 2, cy + offY - ry,
                     cx + offX + rx, cy + offY + ry * k + Math.cos(seed + 4) * 2,
                     cx + offX + rx, cy + offY)
  ctx.bezierCurveTo(cx + offX + rx, cy + offY + ry * k + Math.sin(seed + 5) * 2,
                     cx + offX + rx * k + Math.cos(seed + 6) * 2, cy + offY + ry,
                     cx + offX, cy + offY + ry)
  ctx.bezierCurveTo(cx + offX - rx * k + Math.sin(seed + 7) * 2, cy + offY + ry,
                     cx + offX - rx, cy + offY - ry * k + Math.cos(seed + 8) * 2,
                     cx + offX - rx, cy + offY)
  ctx.closePath()
  ctx.stroke()

  // 眼睛：两个不对称的小点
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.ellipse(cx - s * 0.28 + offX, cy - s * 0.12 + offY, s * 0.06, s * 0.08, Math.sin(seed) * 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + s * 0.32 + offX, cy - s * 0.14 + offY, s * 0.05, s * 0.07, Math.cos(seed) * 0.2, 0, Math.PI * 2)
  ctx.fill()

  // 笑嘴：歪歪的弧线
  ctx.lineWidth = 1.5 * sf
  ctx.beginPath()
  const mouthW = s * 0.28 + Math.sin(seed + 10) * s * 0.04
  ctx.moveTo(cx - mouthW + offX, cy + s * 0.08 + offY + Math.sin(seed) * 1.5)
  ctx.quadraticCurveTo(cx + offX + Math.sin(seed + 20) * 2, cy + s * 0.22 + offY,
                       cx + mouthW + offX, cy + s * 0.06 + offY + Math.cos(seed) * 1.5)
  ctx.stroke()

  // 腮红：两团不规则的
  ctx.globalAlpha = 0.3
  ctx.lineWidth = 2.5 * sf
  ctx.beginPath()
  ctx.arc(cx - s * 0.48 + offX, cy + s * 0.1 + offY, s * 0.12, -0.6, 0.4)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx + s * 0.5 + offX, cy + s * 0.08 + offY, s * 0.11, Math.PI - 0.4, Math.PI + 0.6)
  ctx.stroke()

  ctx.globalAlpha = 1
  ctx.restore()
}

/** 手绘小草 🌱 */
export function drawStickerGrass(ctx, cx, cy, size, seed = 0, sf = 1) {
  const s = size * 0.5
  ctx.save()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5 * sf
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.2)'
  ctx.shadowBlur = 2 * sf

  // 三根草叶，不同弯曲方向
  for (let i = 0; i < 3; i++) {
    const dx = (i - 1) * s * 0.3
    const bend = (i - 1) * s * 0.2
    ctx.beginPath()
    ctx.moveTo(cx + dx, cy)
    ctx.quadraticCurveTo(
      cx + dx + bend + jitter(0, seed + i, 2),
      cy - s * 0.6,
      cx + dx + bend * 1.5 + jitter(0, seed + i + 10, 3),
      cy - s * (0.8 + i * 0.1),
    )
    ctx.stroke()
  }
  ctx.restore()
}

const STICKER_DRAWERS = {
  heart: drawStickerHeart,
  star: drawStickerStar,
  music: drawStickerMusic,
  flower: drawStickerFlower,
  cloud: drawStickerCloud,
  smallHeart: drawStickerSmallHeart,
  sparkle: drawStickerSparkle,
  leaf: drawStickerLeaf,
  butterfly: drawStickerButterfly,
  smiley: drawStickerSmiley,
  grass: drawStickerGrass,
}

// ─── 整行文本绘制（严禁逐字拆分叠加，一行一个 fillText）──

/**
 * wrapLines — 将文本按 maxWidth 自动折行，返回整行数组
 * 绝不拆分单字做 X 偏移，只做行级切分
 */
function wrapLines(ctx, text, maxWidth) {
  const result = []
  const paragraphs = text.split('\n')

  for (const para of paragraphs) {
    if (para === '') {
      result.push('') // 空行保留
      continue
    }

    // 整段未超宽 → 直接作为一行
    if (safeMeasureText(ctx, para).width <= maxWidth) {
      result.push(para)
      continue
    }

    // 需要折行：逐字累加，找到超宽的临界点，整行切出
    let line = ''
    for (const ch of para) {
      const test = line + ch
      if (safeMeasureText(ctx, test).width > maxWidth && line.length > 0) {
        result.push(line)
        line = ch
      } else {
        line = test
      }
    }
    if (line) result.push(line)
  }

  return result
}

/**
 * drawHandText — 标准整行绘制，每行一个 fillText，Y 坐标硬性累加 lineHeight
 */
/**
 * drawHandText — 标签引出文字（fontSize=16×s，行高硬性 26px×s）
 */
export function drawHandText(ctx, text, x, y, opts = {}) {
  const { fontSize = 22, maxWidth = 160, lineHeightPx = 26, rotation = 0 } = opts

  ctx.save()
  ctx.translate(x, y)
  if (rotation) ctx.rotate(rotation)

  ctx.font = `${fontSize}px ${FONT_CN}`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1

  const lines = wrapLines(ctx, text, maxWidth)

  for (let i = 0; i < lines.length; i++) {
    const currentY = i * lineHeightPx
    if (lines[i] === '') continue
    ctx.fillText(lines[i], 0, currentY)
  }

  ctx.restore()
}

/**
 * 测量文本块的 bounding box
 */
function measureTextBox(ctx, text, fontSize, maxWidth, lineHeightPx = 26, padding = 12) {
  ctx.save()
  ctx.font = `${fontSize}px ${FONT_CN}`

  const lines = wrapLines(ctx, text, maxWidth)
  let maxW = 0
  for (const line of lines) {
    if (line === '') continue
    maxW = Math.max(maxW, safeMeasureText(ctx, line).width)
  }
  const totalH = lines.length * lineHeightPx

  ctx.restore()
  return {
    w: maxW + padding * 2,
    h: totalH + padding * 2,
  }
}

// ─── 智能排版防重叠 ───────────────────────────────────────

function resolveOverlaps(blocks, cw, ch, subjectAvoid = null) {
  if (blocks.length <= 1) return blocks

  const pad = Math.max(50, Math.min(cw, ch) * 0.06)   // 按比例保护区域（至少 50px）
  const maxIter = 30

  // 主体安全区避让：将文字块推出主体区域
  if (subjectAvoid) {
    for (const blk of blocks) {
      const overlapX = Math.min(blk.x + blk.w, subjectAvoid.x + subjectAvoid.w) - Math.max(blk.x, subjectAvoid.x)
      const overlapY = Math.min(blk.y + blk.h, subjectAvoid.y + subjectAvoid.h) - Math.max(blk.y, subjectAvoid.y)
      if (overlapX > 0 && overlapY > 0) {
        // 推到主体区域右侧或下方
        const pushRight = (subjectAvoid.x + subjectAvoid.w) - blk.x + pad
        const pushDown = (subjectAvoid.y + subjectAvoid.h) - blk.y + pad
        if (pushRight < pushDown) {
          blk.x += pushRight
        } else {
          blk.y += pushDown
        }
      }
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapX > -pad && overlapY > -pad) {
          const pushX = overlapX + pad
          const pushY = overlapY + pad
          if (pushX < pushY) {
            if (a.x < b.x) { b.x += pushX; a.x -= pushX * 0.3 }
            else { b.x -= pushX; a.x += pushX * 0.3 }
          } else {
            if (a.y < b.y) { b.y += pushY; a.y -= pushY * 0.3 }
            else { b.y -= pushY; a.y += pushY * 0.3 }
          }
          moved = true
        }
      }
    }
    if (!moved) break
  }

  for (const b of blocks) {
    b.x = Math.max(4, Math.min(cw - b.w - 4, b.x))
    b.y = Math.max(4, Math.min(ch - b.h - 4, b.y))
  }
  return blocks
}

// ─── 氛围感贴纸生成（无条件全图混搭撒贴纸）───────────────────

const ALL_STICKER_TYPES = ['sparkle', 'smallHeart', 'star', 'music', 'cloud', 'leaf', 'butterfly', 'smiley', 'grass', 'flower']

// 主题 → 推荐贴纸类型映射
const THEME_STICKERS = {
  '人物': ['smallHeart', 'sparkle', 'star', 'butterfly'],
  '旅行': ['cloud', 'star', 'leaf', 'sparkle'],
  '美食': ['smiley', 'smallHeart', 'sparkle', 'star'],
  '宠物': ['smallHeart', 'heart', 'sparkle', 'smiley'],
  '风景': ['cloud', 'leaf', 'butterfly', 'sparkle'],
  '建筑': ['star', 'cloud', 'sparkle', 'smallHeart'],
  '静物': ['flower', 'leaf', 'sparkle', 'smallHeart'],
  '其他': ALL_STICKER_TYPES,
}

function generateAmbientStickers(cw, ch, existingDetections, existingStickers, seed, textBlocks = [], layoutMeta = {}) {
  const rng = seededRandom(seed * 42 + 7)
  const safeDist = Math.max(0.04, 40 / Math.min(cw, ch))
  const theme = layoutMeta.theme || '其他'
  const themeStickers = THEME_STICKERS[theme] || ALL_STICKER_TYPES
  const decoZones = layoutMeta.decorationZones || []

  // ── 构建碰撞禁区 ──
  const occupied = []

  // safeZone（主体安全区）— 禁止一切装饰进入
  if (layoutMeta.safeZone) {
    const sz = layoutMeta.safeZone
    occupied.push({
      x: sz.x1 / 1000 - safeDist,
      y: sz.y1 / 1000 - safeDist,
      w: (sz.x2 - sz.x1) / 1000 + safeDist * 2,
      h: (sz.y2 - sz.y1) / 1000 + safeDist * 2,
    })
  }

  // 文字块避让
  for (const blk of textBlocks) {
    occupied.push({
      x: blk.x / cw - safeDist, y: blk.y / ch - safeDist,
      w: blk.w / cw + safeDist * 2, h: blk.h / ch + safeDist * 2,
    })
  }

  // 日记大文案占位（右下角）
  occupied.push({ x: 0.75, y: 0.80, w: 0.25, h: 0.20 })

  function overlapsAny(nx, ny, r) {
    for (const o of occupied) {
      const closestX = Math.max(o.x, Math.min(nx, o.x + o.w))
      const closestY = Math.max(o.y, Math.min(ny, o.y + o.h))
      const dx = nx - closestX
      const dy = ny - closestY
      if (dx * dx + dy * dy < (r + safeDist) * (r + safeDist)) return true
    }
    return false
  }

  // ── 在指定区域内生成贴纸坐标 ──
  function randomPointInZone(zone) {
    return {
      x: (zone.x1 + rng() * (zone.x2 - zone.x1)) / 1000,
      y: (zone.y1 + rng() * (zone.y2 - zone.y1)) / 1000,
    }
  }

  function findSpotInZones(r, attempts = 30) {
    if (decoZones.length > 0) {
      for (let i = 0; i < attempts; i++) {
        const zone = decoZones[Math.floor(rng() * decoZones.length)]
        const { x: nx, y: ny } = randomPointInZone(zone)
        if (nx > 0.05 && nx < 0.95 && ny > 0.05 && ny < 0.95 && !overlapsAny(nx, ny, r)) {
          return { nx, ny }
        }
      }
    }
    // 兜底：避开 safeZone 的随机位置
    for (let i = 0; i < attempts; i++) {
      const nx = 0.05 + rng() * 0.9
      const ny = 0.05 + rng() * 0.9
      if (!overlapsAny(nx, ny, r)) return { nx, ny }
    }
    return null
  }

  // ── 线条贴纸：优先用 Kimi 指定位置，不足时在 decorationZones 内补充 ──
  const ambient = []
  const targetCount = 6 + Math.floor(rng() * 4) // 目标 6-9 个线条贴纸

  // 1) 采纳 Kimi 的 decorations（经过碰撞验证）
  for (const dec of (layoutMeta.decorations || [])) {
    const nx = dec.x / 1000
    const ny = dec.y / 1000
    if (!overlapsAny(nx, ny, 0.05)) {
      ambient.push({ type: dec.type, x: dec.x, y: dec.y, scale: dec.scale || 1.0 })
      occupied.push({ x: nx - 0.06, y: ny - 0.06, w: 0.12, h: 0.12 })
    } else {
      // 碰撞 → 在附近寻找可用点
      const offsets = [[0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03], [0.04, 0.04], [-0.04, -0.04]]
      for (const [dx, dy] of offsets) {
        const ax = Math.max(0.05, Math.min(0.95, nx + dx))
        const ay = Math.max(0.05, Math.min(0.95, ny + dy))
        if (!overlapsAny(ax, ay, 0.05)) {
          ambient.push({ type: dec.type, x: Math.round(ax * 1000), y: Math.round(ay * 1000), scale: dec.scale || 1.0 })
          occupied.push({ x: ax - 0.06, y: ay - 0.06, w: 0.12, h: 0.12 })
          break
        }
      }
    }
  }

  // 2) 如果 Kimi 给的不够，在 decorationZones 内补充
  while (ambient.length < targetCount) {
    const spot = findSpotInZones(0.05, 30)
    if (!spot) break
    const type = themeStickers[Math.floor(rng() * themeStickers.length)]
    const scale = 0.6 + rng() * 0.4
    ambient.push({ type, x: Math.round(spot.nx * 1000), y: Math.round(spot.ny * 1000), scale })
    occupied.push({ x: spot.nx - 0.06, y: spot.ny - 0.06, w: 0.12, h: 0.12 })
  }

  // ── 白色手帐贴图：在 decorationZones 内生成 ──
  const white = []

  // 撕纸框/便利贴（1-2 个，可绑定文字）
  const paperCount = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < paperCount; i++) {
    const spot = findSpotInZones(0.07, 30)
    if (!spot) continue
    const bindIdx = (rng() < 0.5 && textBlocks.length > 0)
      ? Math.floor(rng() * textBlocks.length) : -1
    white.push({
      type: 'tornPaper',
      x: Math.round(spot.nx * 1000), y: Math.round(spot.ny * 1000),
      rotation: -4 + rng() * 8,
      widthPct: 20 + rng() * 8,
      bindTextIdx: bindIdx,
      seed: Math.floor(rng() * 9999),
    })
    occupied.push({ x: spot.nx - 0.08, y: spot.ny - 0.06, w: 0.16, h: 0.12 })
  }

  // 虚线胶带（2-3 条）
  const tapeCount = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < tapeCount; i++) {
    const spot = findSpotInZones(0.06, 25)
    if (!spot) continue
    white.push({
      type: 'dashedTape',
      x: Math.round(spot.nx * 1000), y: Math.round(spot.ny * 1000),
      rotation: -12 + rng() * 24,
      widthPct: 16 + rng() * 8,
    })
    occupied.push({ x: spot.nx - 0.06, y: spot.ny - 0.03, w: 0.12, h: 0.06 })
  }

  // 复古邮戳（1 个）
  const stampSpot = findSpotInZones(0.05, 25)
  if (stampSpot) {
    white.push({
      type: 'vintageStamp',
      x: Math.round(stampSpot.nx * 1000), y: Math.round(stampSpot.ny * 1000),
      rotation: -8 + rng() * 16,
      iconKey: ['sun', 'moon', 'star', 'cloud', 'flower'][Math.floor(rng() * 5)],
    })
    occupied.push({ x: stampSpot.nx - 0.04, y: stampSpot.ny - 0.04, w: 0.08, h: 0.08 })
  }

  // 小图钉/夹子（1-2 个）
  const clipCount = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < clipCount; i++) {
    const spot = findSpotInZones(0.03, 20)
    if (!spot) continue
    white.push({
      type: 'paperClip',
      x: Math.round(spot.nx * 1000), y: Math.round(spot.ny * 1000),
    })
    occupied.push({ x: spot.nx - 0.03, y: spot.ny - 0.04, w: 0.06, h: 0.08 })
  }

  return { ambient, white }
}

// ─── 日记风大文案排版（右下角强制注入）──────────────────────

export const DIARY_MESSAGES = [
  '这样简单又美好的一天，\n要好好加油呀！\n未来一定会闪闪发光 ✧',
  '生活收集到的可爱，\n都想打包分给你。\n今天也是满分的一天 ☁',
  '把温柔和可爱\n都装进口袋里，\n明天也要元气满满 ☀',
  '每一天的小确幸\n都值得被温柔收藏，\n你也是其中之一 ♡',
  '认真生活的人\n一定会被生活温柔以待，\n慢慢来，别着急 ❋',
]

export function drawDiaryMessage(ctx, cw, ch, seed, s = 1) {
  const rng = seededRandom(seed * 77 + 11)
  const msg = DIARY_MESSAGES[Math.floor(rng() * DIARY_MESSAGES.length)]
  const lines = msg.split('\n')

  const fontSize = Math.round(24 * s)
  const lineH = 40 * s   // 日记大文案：行高硬性 40px × scale
  const padding = 18 * s

  // 测量最宽行
  ctx.save()
  ctx.font = `${fontSize}px ${FONT_CN}`
  let maxLineW = 0
  for (const l of lines) {
    maxLineW = Math.max(maxLineW, safeMeasureText(ctx, l).width)
  }
  ctx.restore()

  const blockW = maxLineW + padding * 2
  const blockH = lines.length * lineH + padding * 2

  // 右下角定位（留出边距）
  const margin = Math.round(40 * s)
  const x = cw - blockW - margin
  const y = ch - blockH - margin - 30 * s

  // 纯手写无边框文字（无背景，靠阴影保证可读性）
  ctx.save()
  ctx.font = `${fontSize}px ${FONT_CN}`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + padding, y + padding + i * lineH)
  }
  ctx.restore()

  // 底部手绘笑脸或小草装饰
  const decoX = x + blockW * 0.5
  const decoY = y + blockH + 16 * s
  const decoType = rng() > 0.5 ? 'smiley' : 'grass'
  const drawFn = STICKER_DRAWERS[decoType]
  if (drawFn) {
    drawFn(ctx, decoX, decoY, Math.min(cw, ch) * 0.06, seed + 33, s)
  }
}

// ─── 内容哈希 ────────────────────────────────────────────

function contentHash(detections, stickers, cw, ch) {
  let h = cw * 31 + ch * 37
  for (const d of detections) {
    if (d.box_2d) h = (h * 131 + d.box_2d[0] + d.box_2d[2]) | 0
    if (d.caption) h = (h * 17 + d.caption.charCodeAt(0)) | 0
  }
  for (const s of stickers) h = (h * 41 + (s.x || 0) + (s.y || 0)) | 0
  return Math.abs(h)
}

// ─── 融合渲染入口 ─────────────────────────────────────────

/**
 * drawAnnotations — Canvas 层只画轮廓 + 箭头，返回数据供 HTML 覆盖层渲染
 *
 * layoutMeta: { theme, emotion, subjectArea, textArea, stickerArea }
 *   - subjectArea: {x1,y1,x2,y2} 归一化 0-1000，禁止文字覆盖
 *   - textArea: [{x1,y1,x2,y2}] 推荐文字放置区
 *   - stickerArea: [{x1,y1,x2,y2}] 推荐贴纸放置区
 */
export function drawAnnotations(ctx, cw, ch, detections, stickers = [], layoutMeta = {}) {
  const imgSeed = contentHash(detections, stickers, cw, ch)
  const s = cw / 1000

  // globalScale: 锁定 Canvas 物理像素与 DOM 视口像素的转换比例
  const canvasEl = ctx.canvas
  const rect = canvasEl ? canvasEl.getBoundingClientRect() : null
  const displayW = rect && rect.width > 0 ? rect.width : cw
  const globalScale = cw / displayW   // = canvas.width / rect.width

  // ── 1) 轮廓描边（线宽锁定 2 CSS 像素 = 2 * globalScale canvas 像素）──
  const outlinePoints = detections.map((det, i) => {
    return drawOutline(ctx, det, cw, ch, i * 7.3, globalScale)
  })

  // ── 2) 计算文本位置（根据 textPlacement 指令）──
  // 字号基于 CSS 像素目标：14px → 14 * globalScale canvas 像素
  const annotationFontSize = Math.round(14 * globalScale)
  const annotationLineH = 20 * globalScale
  const annotationMaxW = Math.round(160 * globalScale)
  const margin = Math.max(40 * globalScale, cw * 0.05)

  const textBlocks = detections.map((det, i) => {
    const pts = outlinePoints[i]
    const placement = det.textPlacement || 'right'
    let textX, textY

    if (det.box_2d) {
      const bx1 = det.box_2d[1] / 1000 * cw
      const by1 = det.box_2d[0] / 1000 * ch
      const bx2 = det.box_2d[3] / 1000 * cw
      const by2 = det.box_2d[2] / 1000 * ch
      const bcx = (bx1 + bx2) / 2
      const bcy = (by1 + by2) / 2

      switch (placement) {
        case 'left':
          textX = bx1 - margin
          textY = bcy - annotationLineH
          break
        case 'above':
          textX = bcx - annotationMaxW / 2
          textY = by1 - margin
          break
        case 'below':
          textX = bcx - annotationMaxW / 2
          textY = by2 + margin * 0.6
          break
        case 'right':
        default:
          textX = bx2 + margin * 0.6
          textY = bcy - annotationLineH
          break
      }
    } else if (pts.length > 0) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
      textX = cx + margin * 0.6
      textY = cy - annotationLineH
    } else {
      textX = 60 * s
      textY = (60 + i * 80) * s
    }

    // 边界夹紧
    textX = Math.max(8 * s, Math.min(cw - annotationMaxW - 8 * s, textX))
    textY = Math.max(8 * s, Math.min(ch - annotationLineH * 2 - 8 * s, textY))

    const box = measureTextBox(ctx, det.caption, annotationFontSize, annotationMaxW, annotationLineH)

    return {
      x: textX - 12 * globalScale,
      y: textY - 12 * globalScale,
      w: box.w + 10 * globalScale,
      h: box.h + 10 * globalScale,
      textX, textY,
      fontSize: annotationFontSize,
      maxWidth: annotationMaxW,
      lineHeightPx: annotationLineH,
      caption: det.caption,
      arrowOrigin: pts.length > 0 ? findArrowOrigin(pts) : null,
      seed: i * 5.7,
      sf: globalScale,
    }
  })

  // ── 3) 防重叠排版（含 safeZone 避让）──
  const subjectAvoid = layoutMeta.safeZone ? {
    x: layoutMeta.safeZone.x1 / 1000 * cw,
    y: layoutMeta.safeZone.y1 / 1000 * ch,
    w: (layoutMeta.safeZone.x2 - layoutMeta.safeZone.x1) / 1000 * cw,
    h: (layoutMeta.safeZone.y2 - layoutMeta.safeZone.y1) / 1000 * ch,
  } : null
  const resolved = resolveOverlaps(textBlocks, cw, ch, subjectAvoid)

  // ── 4) 画箭头（起点 = 离文字最近的轮廓点）──
  resolved.forEach((blk, i) => {
    const pts = outlinePoints[i]
    if (!pts || pts.length === 0) return

    // 找到离文字位置最近的轮廓点
    let bestIdx = 0
    let bestDist = Infinity
    for (let j = 0; j < pts.length; j++) {
      const dx = pts[j][0] - blk.textX
      const dy = pts[j][1] - blk.textY
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        bestIdx = j
      }
    }

    // 从最近点沿轮廓法线方向外推，避免箭头起点嵌入轮廓内部
    const [ox, oy] = pts[bestIdx]
    const prev = pts[(bestIdx - 1 + pts.length) % pts.length]
    const next = pts[(bestIdx + 1) % pts.length]
    const tx = next[0] - prev[0]
    const ty = next[1] - prev[1]
    const tlen = Math.sqrt(tx * tx + ty * ty) || 1
    const nx = -ty / tlen
    const ny = tx / tlen
    const originX = ox + nx * 8 * globalScale
    const originY = oy + ny * 8 * globalScale

    // 箭头终点：文字框的边缘（留出视觉间距）
    const targetX = blk.textX - 10 * globalScale
    const targetY = blk.textY + blk.fontSize * 0.6

    drawWobblyArrow(ctx, originX, originY, targetX, targetY, {
      color: '#fff', lineWidth: 2.0 * globalScale, wobble: 1.5 * globalScale, seed: blk.seed, dashed: true,
    })
  })

  // ── 5) 贴纸（Kimi 指定 + 白色手帐元素）──
  const { ambient, white } = generateAmbientStickers(
    cw, ch, detections, [], imgSeed, resolved, layoutMeta,
  )
  const allStickers = ambient

  return { outlinePoints, textBlocks: resolved, allStickers, whiteStickers: white, seed: imgSeed }
}

// ─── 导出专用：在 Canvas 上画文字（html2canvas 兜底方案）───

export function drawTextBlocks(ctx, cw, ch, textBlocks) {
  const FONT = FONT_CN

  textBlocks.forEach((blk) => {
    ctx.save()
    ctx.translate(blk.textX, blk.textY)
    ctx.font = `${blk.fontSize}px ${FONT}`
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetX = 2
    ctx.shadowOffsetY = 2

    const lines = wrapLines(ctx, blk.caption, blk.maxWidth)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '') continue
      ctx.fillText(lines[i], 0, i * blk.lineHeightPx)
    }
    ctx.restore()
  })
}

export function drawStickersToCanvas(ctx, cw, ch, stickers) {
  const s = cw / 1000
  const sx = cw / 1000
  const sy = ch / 1000

  stickers.forEach((sticker, i) => {
    const { type, x, y, scale = 1 } = sticker
    const drawFn = STICKER_DRAWERS[type]
    if (!drawFn) return
    drawFn(ctx, x * sx, y * sy, Math.min(cw, ch) * 0.05 * scale, i * 13.3, s)
  })
}

// ─── 纯白实体手帐贴图 Canvas 导出 ─────────────────────────

export function drawWhiteStickersToCanvas(ctx, cw, ch, whiteStickers) {
  if (!whiteStickers || whiteStickers.length === 0) return

  for (const ws of whiteStickers) {
    const px = ws.x / 1000 * cw
    const py = ws.y / 1000 * ch

    if (ws.type === 'tornPaper') {
      const paperW = cw * (ws.widthPct || 16) / 100
      const paperH = paperW * 0.7
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate((ws.rotation || 0) * Math.PI / 180)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(-paperW / 2, -paperH / 2, paperW, paperH)
      ctx.setLineDash([])
      ctx.globalAlpha = 0.08
      ctx.fillStyle = '#fff'
      ctx.fillRect(-paperW / 2, -paperH / 2, paperW, paperH)
      ctx.globalAlpha = 1
      ctx.restore()

    } else if (ws.type === 'dashedTape') {
      const tapeW = cw * (ws.widthPct || 12) / 100
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate((ws.rotation || 0) * Math.PI / 180)
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(-tapeW / 2, 0)
      ctx.lineTo(tapeW / 2, 0)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 0.8
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.moveTo(-tapeW / 2, -4)
      ctx.lineTo(-tapeW / 2, 4)
      ctx.moveTo(tapeW / 2, -4)
      ctx.lineTo(tapeW / 2, 4)
      ctx.stroke()
      ctx.restore()

    } else if (ws.type === 'vintageStamp') {
      const r = 22
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate((ws.rotation || 0) * Math.PI / 180)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 0.8
      ctx.setLineDash([3, 2])
      ctx.beginPath()
      ctx.arc(0, 0, r - 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      // 纯白手绘图标
      const icon = ws.iconKey || 'sun'
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      if (icon === 'sun') {
        ctx.beginPath()
        ctx.arc(0, 0, 4, 0, Math.PI * 2)
        ctx.stroke()
        for (let d = 0; d < 360; d += 45) {
          const rad = d * Math.PI / 180
          ctx.beginPath()
          ctx.moveTo(Math.cos(rad) * 5.5, Math.sin(rad) * 5.5)
          ctx.lineTo(Math.cos(rad) * 8, Math.sin(rad) * 8)
          ctx.stroke()
        }
      } else if (icon === 'moon') {
        ctx.beginPath()
        ctx.arc(2, 0, 6, 0.3, Math.PI * 2 - 0.3)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(-1, -1, 5, 0.8, Math.PI * 2 - 0.8)
        ctx.stroke()
      } else if (icon === 'star') {
        ctx.beginPath()
        for (let j = 0; j < 5; j++) {
          const a1 = (j * 72 - 90) * Math.PI / 180
          const a2 = ((j * 72 + 36) - 90) * Math.PI / 180
          const outer = 7, inner = 3
          if (j === 0) ctx.moveTo(Math.cos(a1) * outer, Math.sin(a1) * outer)
          else ctx.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer)
          ctx.lineTo(Math.cos(a2) * inner, Math.sin(a2) * inner)
        }
        ctx.closePath()
        ctx.stroke()
      } else if (icon === 'cloud') {
        ctx.beginPath()
        ctx.arc(-3, 1, 4, Math.PI, 0)
        ctx.arc(2, -1, 4, Math.PI * 1.2, Math.PI * 0.1)
        ctx.arc(5, 2, 3, Math.PI * 1.5, Math.PI * 0.5)
        ctx.lineTo(-5, 4)
        ctx.stroke()
      } else {
        // flower
        ctx.beginPath()
        ctx.arc(0, 0, 2, 0, Math.PI * 2)
        ctx.stroke()
        for (let j = 0; j < 5; j++) {
          const a = (j * 72 - 90) * Math.PI / 180
          ctx.beginPath()
          ctx.arc(Math.cos(a) * 5, Math.sin(a) * 5, 2.5, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()

    } else if (ws.type === 'paperClip') {
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-4, -12)
      ctx.lineTo(-4, 10)
      ctx.quadraticCurveTo(-4, 14, 0, 14)
      ctx.quadraticCurveTo(4, 14, 4, 10)
      ctx.lineTo(4, -8)
      ctx.quadraticCurveTo(4, -12, 0, -12)
      ctx.quadraticCurveTo(-4, -12, -4, -8)
      ctx.lineTo(-4, 6)
      ctx.quadraticCurveTo(-4, 10, 0, 10)
      ctx.quadraticCurveTo(4, 10, 4, 6)
      ctx.stroke()
      ctx.restore()
    }
  }
}
