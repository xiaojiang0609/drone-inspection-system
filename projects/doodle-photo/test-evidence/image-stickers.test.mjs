import test from 'node:test'
import assert from 'node:assert/strict'
import { createStickerAssetStore } from '../src/utils/image-stickers.js'
import { createCollageLayout } from '../src/utils/collage-layout.js'
import { createExteriorBorderPixels, drawCollage, exportCollage } from '../src/utils/collage-renderer.js'

test('decoded records feed layout directly, collection retains references and releases unused assets', async () => {
  const closed = [], revoked = []
  const store = createStickerAssetStore({ decodeImage: async src => ({ width: 120, height: 80, close: () => closed.push(src) }), revokeUrl: url => revoked.push(url), idFactory: (() => { let i = 0; return () => `asset-${++i}` })() })
  const a = await store.load({ src: 'blob:a', sourceId: 'photo-1', meta: { caption: 'hello' } })
  const b = await store.load({ src: 'blob:b', sourceId: 'photo-1' })
  assert.notEqual(a, b)
  const record = store.get(a)
  assert.equal(record.width, 120)
  assert.equal(record.height, 80)
  assert.equal(record.sourceId, 'photo-1')
  assert.equal(createCollageLayout([record], {}).find(e => e.type === 'imageSticker').assetId, a)
  store.collect(new Set([a]))
  assert.ok(store.get(a))
  assert.equal(store.get(b), undefined)
  assert.deepEqual(revoked, ['blob:b'])
  assert.deepEqual(closed, ['blob:b'])
  store.dispose(); store.dispose()
  assert.equal(store.get(a), undefined)
  assert.deepEqual(revoked, ['blob:b', 'blob:a'])
})

test('failed decode never registers an asset and disposes its object URL', async () => {
  const revoked = []
  const store = createStickerAssetStore({ decodeImage: async () => { throw new Error('bad png') }, revokeUrl: src => revoked.push(src), idFactory: () => 'bad' })
  await assert.rejects(store.load({ src: 'blob:bad', sourceId: 's' }), /bad png/)
  assert.equal(store.get('bad'), undefined)
  assert.deepEqual(revoked, ['blob:bad'])
})

test('disposal while decoding prevents a late asset from surviving', async () => {
  let resolve
  const revoked = [], closed = []
  const store = createStickerAssetStore({ decodeImage: () => new Promise(r => { resolve = r }), revokeUrl: url => revoked.push(url) })
  const loading = store.load({ src: 'blob:pending', sourceId: 's' })
  store.dispose()
  resolve({ width: 20, height: 10, close: () => closed.push(true) })
  await assert.rejects(loading, /disposed/)
  assert.deepEqual(revoked, ['blob:pending'])
  assert.deepEqual(closed, [true])
})

test('outer border preserves sealed holes, detached pieces, and original alpha', () => {
  const width = 15, height = 12, data = new Uint8ClampedArray(width * height * 4)
  // A 5x5 hollow ring and a separate pixel. The ring's center is a sealed hole.
  for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) {
    if (x === 3 || x === 7 || y === 3 || y === 7) data[(y * width + x) * 4 + 3] = 255
  }
  data[(5 * width + 11) * 4 + 3] = 128
  const original = data.slice()
  const result = createExteriorBorderPixels({ data, width, height }, 2)
  const alpha = (x, y) => result.data[(y * width + x) * 4 + 3]
  assert.equal(alpha(5, 5), 0, 'the sealed transparent hole must stay empty')
  assert.equal(alpha(2, 5), 255, 'outer boundary must receive a border')
  assert.equal(alpha(9, 5), 255, 'separate foreground pieces get a border')
  assert.equal(alpha(11, 5), 0, 'foreground alpha is not painted by the border')
  assert.equal(alpha(1, 1), 0, 'Euclidean radius must not grow into a square')
  assert.deepEqual(data, original)
})

test('export retention keeps decoded assets alive across collection until release', async () => {
  const closed = [], revoked = []
  const store = createStickerAssetStore({ decodeImage: async () => ({ width: 4, height: 3, close: () => closed.push(true) }), revokeUrl: url => revoked.push(url), idFactory: () => 'held' })
  const id = await store.load({ src: 'blob:held', sourceId: 's' })
  const retained = store.retain([id])
  store.collect(new Set())
  assert.equal(store.get(id), undefined)
  assert.equal(retained.get(id).width, 4)
  assert.deepEqual(closed, [])
  assert.deepEqual(revoked, [])
  retained.release(); retained.release()
  assert.deepEqual(closed, [true])
  assert.deepEqual(revoked, ['blob:held'])
})

test('invalid decoded dimensions cannot become a successful cached asset', async () => {
  for (const [width, height] of [[Infinity, 1], [0, 1], [8000, 6000], [1.5, 2]]) {
    const store = createStickerAssetStore({ decodeImage: async () => ({ width, height }), idFactory: () => 'invalid' })
    await assert.rejects(store.load({ src: 'data:image/png;base64,x', sourceId: 's' }), /pixels|dimensions/)
    assert.equal(store.get('invalid'), undefined)
  }
})

test('export captures project and image references before fonts wait and uses cover crop fractions', async () => {
  // Trace the real renderer's coordinates and lifecycle across an asynchronous
  // font boundary. Pixel/PNG quality is deliberately left to browser tests.
  const previousDocument = globalThis.document, previousFontFace = globalThis.FontFace
  let finishFonts
  const ready = new Promise(resolve => { finishFonts = resolve }), draws = [], closed = []
  const fonts = []
  fonts.ready = ready; fonts.add = font => fonts.push(font); fonts.load = async () => []
  globalThis.FontFace = class {
    constructor(family) { this.family = family; this.status = 'unloaded' }
    async load() { this.status = 'loaded'; return this }
  }
  const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, translate(x, y) { draws.push(['translate', x, y]) }, rotate() {}, drawImage(image, ...coordinates) { draws.push([image.name, ...coordinates]) } }
  globalThis.document = { fonts, createElement() { return { width: 0, height: 0, getContext: () => ctx, toBlob(callback) { callback(new Blob([JSON.stringify({ width: this.width, height: this.height, draws })])) } } } }
  try {
    const store = createStickerAssetStore({ decodeImage: async () => ({ width: 2000, height: 1000, name: 'captured', close: () => closed.push(true) }), idFactory: () => 'a' })
    const assetId = await store.load({ src: 'data:image/png;base64,x', sourceId: 's' })
    const project = { background: { kind: 'photo', assetId, offsetX: 1, offsetY: .5 }, ink: 'auto', elements: [{ type: 'imageSticker', assetId, x: 500, y: 500, width: 200, height: 100, borderStyle: 'none' }] }
    const pending = exportCollage(project, store)
    project.elements[0].x = 900; project.background.offsetX = 0
    store.dispose()
    assert.deepEqual(closed, [])
    finishFonts()
    const exported = JSON.parse(await (await pending).text())
    assert.equal(exported.width, 1080); assert.equal(exported.height, 1440)
    assert.deepEqual(exported.draws, [['captured', -1800, 0, 2880, 1440], ['translate', 540, 720], ['captured', -108, -72, 216, 144]])
    assert.deepEqual(closed, [true])
  } finally { globalThis.document = previousDocument; globalThis.FontFace = previousFontFace }
})

test('renderer uses readable automatic ink for the actual paper after a retained-color kind switch', () => {
  const previousDocument = globalThis.document
  const frames = []
  globalThis.document = { createElement() {
    const result = { width: 0, height: 0 }
    const paperCtx = { fillRect() { result.baseColor ??= this.fillStyle } }
    result.getContext = () => paperCtx
    return result
  } }
  try {
    for (const [kind, color] of [['paper-light', '#000000'], ['paper-dark', '#ffffff'], ['photo', '#ffffff']]) {
      const frame = {}
      const ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {},
        drawImage(image) { frame.background = image.baseColor || image.name }, measureText(text) { return { width: text.length * parseFloat(this.font) } },
        fillText(text) { frame.text = text; frame.ink = this.fillStyle } }
      drawCollage(ctx, { background: { kind, color, assetId: 'photo' }, ink: 'auto', elements: [{ type: 'text', text: '日常', x: 500, y: 100, width: 300, height: 100 }] }, { get: () => ({ image: { name: 'photo' }, width: 1080, height: 1440 }) })
      frames.push(frame)
    }
    assert.deepEqual(frames, [
      { background: '#f7f2e7', text: '日常', ink: '#665d50' },
      { background: '#343638', text: '日常', ink: '#fffaf1' },
      { background: 'photo', text: '日常', ink: '#fffaf1' },
    ])
  } finally { globalThis.document = previousDocument }
})
