import test from 'node:test'
import assert from 'node:assert/strict'
import { drawJournal } from '../src/utils/journal.js'
import { journalTextHeight } from '../src/utils/journal-text.js'
import * as textMetrics from '../src/utils/journal-text.js'
import { elementBounds, constrainElementToImage } from '../src/utils/journal-layout.js'

// Record the renderer's canvas output, including its real transforms and text
// measurement contract. No browser, image analysis or remote service is needed.
function canvasTrace() {
  const strokes = [], texts = [], fills = [], stack = []
  let matrix = [1, 0, 0, 1, 0, 0], path = []
  const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
  const multiply = ([a, b, c, d, e, f]) => {
    const [A, B, C, D, E, F] = matrix
    matrix = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d,
      A * e + C * f + E, B * e + D * f + F]
  }
  const ctx = {
    font: '10px sans-serif', lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', textAlign: 'start', textBaseline: 'alphabetic',
    save() { stack.push({ matrix: [...matrix], font: this.font, lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, textAlign: this.textAlign, textBaseline: this.textBaseline }) },
    restore() { const state = stack.pop(); matrix = state.matrix; Object.assign(this, state) },
    scale(x, y) { multiply([x, 0, 0, y, 0, 0]) },
    translate(x, y) { multiply([1, 0, 0, 1, x, y]) },
    rotate(angle) { multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]) },
    beginPath() { path = [] }, closePath() {}, setLineDash() {},
    moveTo(x, y) { path.push(point(x, y)) }, lineTo(x, y) { path.push(point(x, y)) },
    quadraticCurveTo(...coords) { for (let i = 0; i < coords.length; i += 2) path.push(point(coords[i], coords[i + 1])) },
    bezierCurveTo(...coords) { for (let i = 0; i < coords.length; i += 2) path.push(point(coords[i], coords[i + 1])) },
    stroke() { strokes.push({ points: [...path], color: this.strokeStyle, width: this.lineWidth * Math.hypot(matrix[0], matrix[1]) }) },
    fill() { fills.push([...path]) }, fillRect(...args) { fills.push(args) },
    measureText(value) { return { width: String(value).length * Number.parseFloat(this.font) } },
    fillText(value, x, y) { texts.push({ value, x, y, point: point(x, y), matrix: [...matrix], font: this.font,
      color: this.fillStyle, align: this.textAlign, baseline: this.textBaseline, width: this.measureText(value).width }) },
  }
  return { ctx, strokes, texts, fills }
}

test('bubble sizing reserves room for its border and tail before wrapping text', () => {
  const measure = (value, fontSize) => value.length * fontSize
  assert.equal(journalTextHeight('bubble', 'abcdefghijkl', 240, 30, measure), 154)
  assert.equal(journalTextHeight('bubble', 'abcdefghijkl', 180, 30, measure), 199)
  assert.equal(journalTextHeight('bubble', 'abc\ndef\nhi', 240, 30, measure), 199)
  assert.equal(journalTextHeight('bubble', '', 240, 30, measure), 109)
  assert.equal(journalTextHeight('text', 'abcdefghijkl', 240, 30, measure), 105)
  assert.equal(journalTextHeight('note', 'abcdefghijkl', 240, 30, measure), 194)
  assert.equal(journalTextHeight(undefined, 'abcdefghijkl', 240, 30, measure), 105)
})

test('bubble output is an unfilled white cloud with centered handwritten text', () => {
  const trace = canvasTrace()
  const bubble = { type: 'bubble', x: 400, y: 250, width: 240, height: 154, fontSize: 30,
    text: 'abcdefghijkl', rotation: -3, aspect: 1 }
  drawJournal(trace.ctx, 1000, 1000, [], [bubble], false)
  assert.equal(trace.fills.length, 0, 'a speech bubble must not add paper, tape or a filled card')
  assert.ok(trace.strokes.some(stroke => stroke.points.length >= 16), 'the bubble outline must be drawn')
  assert.ok(trace.strokes.every(stroke => stroke.color === '#fffaf1' && stroke.width <= 2.5))
  assert.deepEqual(trace.texts.map(text => text.value), ['abcdef', 'ghijkl'])
  assert.ok(trace.texts.every(text => text.align === 'center' && text.x === 0))
  assert.ok(trace.texts.every(text => text.color === '#fffaf1' && text.font.includes('Long Cang')))
  assert.equal(trace.texts[1].y - trace.texts[0].y, 45)
})

test('bubble strokes including the tail stay inside the declared rotated bounds at every photo aspect', () => {
  for (const aspect of [.683, 1, 1.5]) {
    const trace = canvasTrace()
    const bubble = { type: 'bubble', x: 400, y: 250, width: 320, height: 169 / aspect,
      fontSize: 35, text: '周末的小小快乐', rotation: 11, aspect }
    drawJournal(trace.ctx, 1000, 1000 * aspect, [], [bubble], false)
    assert.ok(trace.strokes.some(stroke => stroke.points.length >= 16), 'bubble geometry must include its full border')
    const bounds = elementBounds(bubble)
    for (const stroke of trace.strokes) for (const [x, y] of stroke.points) {
      assert.ok(x - stroke.width / 2 >= bounds.x1 && x + stroke.width / 2 <= bounds.x2,
        `bubble border escapes the declared horizontal bounds at aspect ${aspect}`)
      assert.ok(y - stroke.width / 2 >= bounds.y1 * aspect && y + stroke.width / 2 <= bounds.y2 * aspect,
        `bubble tail escapes the declared vertical bounds at aspect ${aspect}`)
    }
  }
})

test('a manually shortened bubble fits long text inside its width and height', () => {
  const trace = canvasTrace()
  const bubble = { type: 'bubble', x: 500, y: 500, width: 180, height: 82, fontSize: 32,
    text: '把这一刻的小小快乐留在手账里，下次再来一杯咖啡', rotation: 0, aspect: 1 }
  drawJournal(trace.ctx, 1000, 1000, [], [bubble], false)
  assert.ok(trace.texts.length > 0, 'manual bubbles must render their text')
  for (const text of trace.texts) {
    const fontSize = Number.parseFloat(text.font)
    assert.ok(text.width <= 132, 'wrapped glyphs must fit the horizontal padding')
    assert.ok(text.y >= -41 && text.y + fontSize <= 41, 'text must not escape a resized bubble')
  }
})

test('manual text edits and creation measure every text-bearing element before constraining it', () => {
  const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(3)
  const measure = (value, fontSize) => value.length * fontSize
  for (const [type, width, fontSize, expectedHeight] of [
    ['text', 260, 32, 542.4], ['note', 380, 32, 488], ['bubble', 340, 34, 574],
  ]) {
    const original = { type, text, width, height: 60, fontSize, aspect: 1.5 }
    const sized = textMetrics.resizeJournalTextElement?.(original, measure)
    assert.ok(sized?.height > 60, `${type} must grow to include all 78 edited characters`)
    assert.ok(Math.abs(sized.height * 1.5 - expectedHeight) < .001, `${type} must use measured logical text height`)
    assert.equal(sized.fontSize, fontSize, 'editing should grow the element before reducing its font')
    assert.equal(original.height, 60, 'history snapshots must not be mutated during sizing')
  }
})

test('a 60-pixel legacy text box fits all 78 characters and its underline without clipping', () => {
  const trace = canvasTrace()
  const element = { type: 'text', x: 500, y: 500, width: 260, height: 60, fontSize: 32,
    text: 'abcdefghijklmnopqrstuvwxyz'.repeat(3), rotation: 0, aspect: 1, underline: true }
  drawJournal(trace.ctx, 1000, 1000, [], [element], false)
  assert.equal(trace.texts.map(text => text.value).join(''), element.text, 'every edited character must remain visible')
  assert.ok(trace.texts.every(text => Number.parseFloat(text.font) >= 8), 'choose the largest fitting font instead of one-step over-shrinking')
  for (const text of trace.texts) {
    assert.ok(text.x >= -130 && text.x + text.width <= 130, 'wrapped text must stay inside the declared width')
    assert.ok(text.y >= -30 && text.y + Number.parseFloat(text.font) <= 30, 'edited text must stay inside the declared height')
    assert.ok(text.font.includes('Long Cang'))
  }
  const bounds = elementBounds(element)
  assert.ok(trace.strokes.length > 0, 'the underline must remain visible')
  for (const stroke of trace.strokes) for (const [x, y] of stroke.points) {
    assert.ok(x - stroke.width / 2 >= bounds.x1 && x + stroke.width / 2 <= bounds.x2)
    assert.ok(y - stroke.width / 2 >= bounds.y1 && y + stroke.width / 2 <= bounds.y2, 'underline must fit with the text')
  }
})

test('text wrapping is fitted again after image constraints scale width and font size', () => {
  const trace = canvasTrace()
  const element = constrainElementToImage({ type: 'text', x: 500, y: 500, width: 480, height: 900,
    fontSize: 44, text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(14), rotation: 55, aspect: .683, underline: true })
  assert.ok(element.width < 480, 'the fixture must exercise image-constrained dimensions')
  drawJournal(trace.ctx, 1000, 683, [], [element], false)
  assert.equal(trace.texts.map(text => text.value).join(''), element.text)
  for (const text of trace.texts) {
    assert.ok(text.x + text.width <= element.width / 2, 'scaled text must rewrap to the scaled width')
    assert.ok(text.y + Number.parseFloat(text.font) <= element.height * .683 / 2,
      'scaled text must fit the actual post-constraint height')
  }
})
