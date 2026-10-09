import { drawArrow, drawDoodle } from './journal-marks.js'
import { createJournalLayout } from './journal-layout.js'
import { FONT_CN, FONT_EN } from './fonts.js'
import { wrapJournalText } from './journal-text.js'
import { drawSubjectContour } from './journal-contours.js'
export { elementBounds } from './journal-layout.js'

// This series owns its palette and layout rules; future series can supply another preset.
export const JOURNAL_STYLE = Object.freeze({
  id: 'white-handwritten-journal', name: '白色手绘手账', paper: '#f7f2e7', ink: '#665d50',
  accent: '#a18a6e', tape: '#d9cfb9', maxDoodles: 32, outlineWidth: 1.75,
  annotationType: 'text', maxPaperNotes: 0,
})

export function createJournalElements(detections, meta = {}, width = 1000, height = 1000, measure) {
  if (!measure && typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d')
    measure = (text, fontSize) => { ctx.font = `${fontSize}px ${FONT_CN}`; return ctx.measureText(text).width }
  }
  return createJournalLayout(detections, meta, width, height, JOURNAL_STYLE, measure)
}

function wrapText(ctx, text, maxWidth) {
  return wrapJournalText(text, maxWidth, value => ctx.measureText(value).width)
}

function fitText(ctx, text, maxWidth, maxHeight, fontSize, spacing) {
  const content = String(text || '').replace(/([，,])(?!\n)/g, '$1\n')
  const layout = size => {
    ctx.font = `${size}px ${FONT_CN}`
    const lines = wrapText(ctx, content, maxWidth)
    return { lines, fontSize: size, lineHeight: size * spacing,
      fits: Math.max(1, lines.length) * size * spacing <= maxHeight
        && lines.every(line => ctx.measureText(line).width <= maxWidth) }
  }
  const initial = layout(fontSize)
  if (initial.fits) return initial
  // Rewrapping changes the number of lines as font size changes. Search for the
  // largest fitting size rather than shrinking once from the old line count.
  let low = 0, high = fontSize
  for (let attempt = 0; attempt < 16; attempt++) {
    const middle = (low + high) / 2
    if (layout(middle).fits) low = middle
    else high = middle
  }
  return layout(Math.max(low, .000001))
}

function drawBubble(ctx, e, w, h) {
  if (!(w > 0 && h > 0)) return
  // The whole stroke and the tail belong to the element's declared rectangle.
  // Broad, shallow lobes leave room for a title without looking like stationery.
  const pad = Math.min(w, h) * .03
  const tail = Math.min(18, h * .14)
  const rx = w / 2 - pad, ry = (h - pad * 2 - tail) / 2, cy = -tail / 2
  ctx.strokeStyle = e.color || '#fffaf1'; ctx.lineWidth = Math.min(2.15, Math.min(w, h) * .025)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'transparent'
  ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(-rx, cy + ry * .05)
  ctx.bezierCurveTo(-rx, cy - ry * .45, -rx * .99, cy - ry * .95, -rx * .70, cy - ry * .91)
  ctx.bezierCurveTo(-rx * .55, cy - ry, -rx * .24, cy - ry, -rx * .12, cy - ry * .94)
  ctx.bezierCurveTo(rx * .10, cy - ry, rx * .38, cy - ry, rx * .50, cy - ry * .90)
  ctx.bezierCurveTo(rx * .79, cy - ry * .98, rx * .99, cy - ry * .64, rx * .96, cy - ry * .36)
  ctx.bezierCurveTo(rx, cy - ry * .11, rx, cy + ry * .18, rx * .96, cy + ry * .35)
  ctx.bezierCurveTo(rx * .98, cy + ry * .79, rx * .78, cy + ry, rx * .50, cy + ry * .90)
  ctx.bezierCurveTo(rx * .33, cy + ry * .96, rx * .20, cy + ry * .98, rx * .10, cy + ry * .91)
  ctx.lineTo(rx * .20, h / 2 - pad)
  ctx.quadraticCurveTo(rx * .06, h / 2 - pad - tail * .20, -rx * .05, cy + ry * .93)
  ctx.bezierCurveTo(-rx * .27, cy + ry, -rx * .48, cy + ry, -rx * .62, cy + ry * .90)
  ctx.bezierCurveTo(-rx * .91, cy + ry * .97, -rx, cy + ry * .60, -rx, cy + ry * .05)
  ctx.closePath(); ctx.stroke()

  const content = String(e.text || '').replace(/([，,])(?!\n)/g, '$1\n')
  const maxWidth = Math.max(1, w - 48), maxHeight = Math.max(1, h - Math.min(64, h * .5))
  let fontSize = e.fontSize || 32
  ctx.font = `${fontSize}px ${FONT_CN}`
  const widestGlyph = Math.max(1, ...Array.from(content, char => ctx.measureText(char).width))
  fontSize *= Math.min(1, maxWidth / widestGlyph)
  let lines
  // Manual resize and edited text may arrive with a smaller height than the
  // generated layout. Fit actual glyph measurements before drawing any text.
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${fontSize}px ${FONT_CN}`
    lines = wrapText(ctx, content, maxWidth)
    const required = Math.max(1, lines.length) * fontSize * 1.5
    if (required <= maxHeight) break
    fontSize *= maxHeight / required
  }
  ctx.font = `${fontSize}px ${FONT_CN}`
  ctx.fillStyle = e.color || '#fffaf1'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const lineHeight = fontSize * 1.5
  const top = cy - lines.length * lineHeight / 2 + (lineHeight - fontSize) / 2
  lines.forEach((line, i) => ctx.fillText(line, 0, top + i * lineHeight))
}

function drawNote(ctx, e, w, h) {
  const { paper, ink, accent, tape } = JOURNAL_STYLE
  ctx.shadowColor = '#00000028'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.moveTo(-w / 2, -h / 2 + 12)
  ctx.lineTo(w / 2, -h / 2 + 12)
  ctx.lineTo(w / 2, h / 2 - 9)
  for (let x = w / 2; x >= -w / 2; x -= 9) ctx.lineTo(x, h / 2 - 7 + 2.5 * Math.sin(x * .8))
  ctx.closePath(); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = tape
  ctx.save(); ctx.translate(-w * .15, -h / 2 + 15); ctx.rotate(-.09)
  ctx.globalAlpha = .9; ctx.fillRect(-w * .19, -13, w * .38, 27)
  ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1
  for (let x = -w * .19; x < w * .19; x += 9) { ctx.beginPath(); ctx.moveTo(x, -13); ctx.lineTo(x + 15, 14); ctx.stroke() }
  ctx.restore()
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = accent
  ctx.font = `16px ${FONT_EN}`; ctx.fillText(w < 280 ? 'little joys' : 'a little moment, kept forever', -w / 2 + 28, -h / 2 + 47)
  ctx.fillStyle = e.color || ink
  const fontSize = e.fontSize || 32
  ctx.font = `${fontSize}px ${FONT_CN}`
  const lines = wrapText(ctx, String(e.text || '').replace(/([，,])(?!\n)/g, '$1\n'), w - 56)
  const lineHeight = Math.min(fontSize * 1.5, (h - 92) / Math.max(lines.length, 1))
  lines.forEach((line, i) => ctx.fillText(line, -w / 2 + 28, -h / 2 + 79 + i * lineHeight))
  // A small clip connects the stationery rather than floating around the photograph.
  ctx.strokeStyle = '#9b968c'; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(w / 2 - 30, -h / 2 + 11)
  ctx.lineTo(w / 2 - 30, -h / 2 + 52)
  ctx.bezierCurveTo(w / 2 - 30, -h / 2 + 64, w / 2 - 14, -h / 2 + 64, w / 2 - 14, -h / 2 + 52)
  ctx.lineTo(w / 2 - 14, -h / 2 + 17)
  ctx.bezierCurveTo(w / 2 - 14, -h / 2 + 5, w / 2 - 25, -h / 2 + 5, w / 2 - 25, -h / 2 + 17)
  ctx.lineTo(w / 2 - 25, -h / 2 + 47); ctx.stroke()
}

export function drawJournal(ctx, width, height, detections, elements, showOutline = true) {
  const logicalHeight = 1000 * height / width
  ctx.save(); ctx.scale(width / 1000, width / 1000)
  if (showOutline) {
    // Outline every real boundary; never invent a box/ellipse for missing masks.
    for (const [index, detection] of detections.entries()) {
      const rings = detection.shape_contours?.length ? detection.shape_contours : [detection.shape_points]
      for (const [ringIndex, points] of rings.entries()) {
        drawSubjectContour(ctx, points, logicalHeight, {
          seed: `${detection.label || 'subject'}-${index}-${ringIndex}`,
          lineWidth: JOURNAL_STYLE.outlineWidth,
          // A small minority of subjects use broken pen lines; the rest keep
          // a continuous contour with a few natural pauses.
          dashed: index % 6 === 3,
        })
      }
    }
  }
  ctx.restore()
  for (const e of elements) drawJournalElement(ctx, width, height, e, { elements, detections })
}

export function drawJournalElement(ctx, width, height, e, { elements = [], detections = [] } = {}) {
  const logicalHeight = 1000 * height / width
  ctx.save(); ctx.scale(width / 1000, width / 1000)
    if (e.type === 'arrow') {
      const arrowCtx = e.color ? new Proxy(ctx, {
        get(target, key) { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value },
        set(target, key, value) { target[key] = key === 'strokeStyle' ? e.color : value; return true },
      }) : ctx
      drawArrow(arrowCtx, e, elements, detections, logicalHeight)
      ctx.restore()
      return
    }
    ctx.save(); ctx.translate(e.x, e.y * logicalHeight / 1000)
    ctx.rotate((e.rotation || 0) * Math.PI / 180)
    const w = e.width, h = e.height * logicalHeight / 1000
    if (e.type === 'note') drawNote(ctx, e, w, h)
    else if (e.type === 'bubble') drawBubble(ctx, e, w, h)
    else if (e.type === 'text') {
      if (w > 0 && h > 0) {
        const paddingX = Math.min(6, w * .2), paddingY = Math.min(6, h * .2)
        const fitted = fitText(ctx, e.text, Math.max(.001, w - paddingX * 2),
          Math.max(.001, h - Math.min(24, h * .6)), Number.isFinite(e.fontSize) && e.fontSize > 0 ? e.fontSize : 29, 1.35)
        ctx.fillStyle = e.color || '#fffaf1'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.shadowColor = '#252018bb'; ctx.shadowBlur = Math.min(3, Math.min(w, h) * .06)
        ctx.shadowOffsetY = Math.min(1, h * .02)
        const xStart = -w / 2 + paddingX, top = -h / 2 + paddingY
        fitted.lines.forEach((line, i) => ctx.fillText(line, xStart, top + i * fitted.lineHeight))
        if (e.underline) {
          const y = top + fitted.lines.length * fitted.lineHeight + Math.min(4, h * .1)
          ctx.strokeStyle = e.color || '#fffaf1b3'; ctx.lineWidth = Math.min(1.5, w * .04, h * .05)
          ctx.setLineDash([4, 7]); ctx.beginPath()
          for (let x = xStart; x < w / 2 - paddingX; x += Math.min(5, (w - paddingX * 2) / 4)) {
            if (x === xStart) ctx.moveTo(x, y)
            else ctx.lineTo(x, y + Math.sin(x * .15) * Math.min(1.8, h * .045))
          }
          ctx.stroke()
        }
      }
    } else if (e.type === 'stamp') {
      const r = Math.min(w, h) / 2 - 4
      ctx.strokeStyle = e.color || '#fffaf1d9'; ctx.fillStyle = e.color || '#fffaf1d9'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(0, 0, r - 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
      ctx.textAlign = 'center'; ctx.font = `16px ${FONT_EN}`; ctx.fillText('SLOW DAYS', 0, -17)
      ctx.font = `30px ${FONT_EN}`; ctx.fillText('daily', 0, 10)
      ctx.font = `13px ${FONT_EN}`; ctx.fillText('LITTLE JOYS', 0, 29)
    } else if (e.type === 'tape') {
      ctx.fillStyle = '#ddd3bcbb'; ctx.fillRect(-w / 2, -h / 2, w, h)
      ctx.strokeStyle = '#fff7'; ctx.lineWidth = 1
      for (let x = -w / 2; x < w / 2; x += 12) { ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x + h, h / 2); ctx.stroke() }
    } else drawDoodle(ctx, e.icon, Math.min(w, h), e.color, e.paths)
    ctx.restore()
  ctx.restore()
}
