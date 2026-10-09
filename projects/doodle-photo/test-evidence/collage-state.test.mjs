import test from 'node:test'
import assert from 'node:assert/strict'
import { createCollageState, commitProjectEdit, undoProjectEdit, collectReferencedAssetIds, collectReferencedSourceIds, isCurrentCutout, removeCollageSource, replaceCollageAsset } from '../src/utils/collage-state.js'
import { createCollageSession } from '../src/hooks/useCollageSession.js'
import { createStickerAssetStore } from '../src/utils/image-stickers.js'
import { createCollageLayout, collageElementBounds } from '../src/utils/collage-layout.js'

const sticker = (assetId = 'before') => ({ id: 'e1', type: 'imageSticker', sourceId: 's1', assetId, x: 500, y: 600, width: 200, height: 150, rotation: 7, aspect: 4 / 3, borderStyle: 'solid', borderWidth: 6 })
const readyState = () => ({ ...createCollageState(), project: { ...createCollageState().project, sourceIds: ['s1'], elements: [sticker()] }, sources: { s1: { id: 's1', name: 'same.jpg', status: 'ready', version: 1, assetId: 'before' } } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const cutout = name => ({ image: 'blob:' + name, subject: { label: name }, caption: name, theme: 'daily' })
function harness(options = {}) {
  let id = 0, asset = 0
  const closed = [], revoked = []
  const store = options.assetStore || createStickerAssetStore({ idFactory: () => 'a' + ++asset, decodeImage: options.decodeImage || (async src => ({ width: 100, height: 80, close: () => closed.push(src) })), revokeUrl: src => revoked.push(src) })
  const layouts = []
  const session = createCollageSession({ assetStore: store, request: async file => cutout(file.name), validateBatch: async files => ({ files, errors: [] }), decodePreview: async file => ({ file, thumbnailUrl: 'data:preview:' + file.name, width: 100, height: 80 }), waitForFonts: async () => {}, idFactory: () => 's' + ++id, buildLayout: assets => { layouts.push(assets.map(a => a.assetId)); return assets.map((a, i) => ({ ...sticker(a.assetId), id: 'e' + i, sourceId: a.sourceId })) }, ...options })
  session.activate()
  return { session, store, layouts, closed, revoked }
}

test('undo_restores_replaced_asset_after_source_removal', () => {
  let state = readyState()
  state = replaceCollageAsset(state, 's1', { assetId: 'after', width: 80, height: 100 }, { caption: 'new' })
  state = removeCollageSource(state, 's1')
  assert.equal(state.project.sourceIds.length, 0)
  state = undoProjectEdit(state)
  assert.equal(state.sources.s1.assetId, 'after')
  state = undoProjectEdit(state)
  assert.equal(state.project.elements[0].assetId, 'before')
  assert.ok(collectReferencedAssetIds(state).has('before'))
  assert.equal(state.sources.s1.caption, undefined)
})
test('history_limit_is_twenty and removed cards retain source files through Undo', () => {
  let state = readyState()
  state = removeCollageSource(state, 's1')
  assert.ok(collectReferencedSourceIds(state).has('s1'))
  assert.equal(undoProjectEdit(state).project.sourceIds.length, 1)
  for (let i = 0; i < 21; i++) state = commitProjectEdit(state, { ...state.project, ink: i % 2 ? 'light' : 'dark' })
  assert.equal(state.history.length, 20)
  assert.equal(collectReferencedSourceIds(state).has('s1'), false)
  assert.equal(collectReferencedAssetIds(state).has('before'), false)
})
test('stale_epoch_cannot_apply and undo invalidates old pending identities', () => {
  const state = readyState()
  assert.equal(isCurrentCutout(state, { sourceId: 's1', version: 1, epoch: state.epoch }), true)
  assert.equal(isCurrentCutout({ ...state, epoch: state.epoch + 1 }, { sourceId: 's1', version: 1, epoch: state.epoch }), false)
  const pending = { ...state, sources: { s1: { ...state.sources.s1, status: 'processing' } } }
  const restored = undoProjectEdit(removeCollageSource(pending, 's1'))
  assert.equal(restored.sources.s1.status, 'ready')
  assert.equal(isCurrentCutout(restored, { sourceId: 's1', version: 1, epoch: state.epoch }), false)
})
test('replacement preserves geometry and layer and adjusts normalized height to decoded ratio', () => {
  const state = readyState()
  state.project.elements.push({ id: 'title', type: 'text', text: 'hello' })
  const next = replaceCollageAsset(state, 's1', { assetId: 'after', width: 80, height: 100 }, {})
  const e = next.project.elements[0]
  assert.deepEqual([e.x, e.y, e.width, e.rotation, e.id], [500, 600, 200, 7, 'e1'])
  assert.equal(e.height, 200 * 100 / 80 / (4 / 3))
  assert.equal(next.project.elements[1].id, 'title')
  assert.equal(state.project.elements[0].assetId, 'before')
})
test('project edit clones ordinary snapshots and rejects File/Image-like class instances', () => {
  const state = readyState(), project = structuredClone(state.project)
  project.elements[0].x = 10
  const next = commitProjectEdit(state, project)
  project.elements[0].x = 99
  assert.equal(next.project.elements[0].x, 10)
  assert.doesNotThrow(() => structuredClone(next))
  class ImageBoundary {}
  assert.throws(() => commitProjectEdit(state, { ...project, image: new ImageBoundary() }), /ordinary|plain/i)
})
test('initial batch waits for all results and fonts once; later batches only safely append', async () => {
  const font = deferred(), second = deferred()
  const h = harness({ waitForFonts: () => font.promise, request: file => file.name === 'b' ? second.promise : Promise.resolve(cutout(file.name)) })
  const work = h.session.addFiles([{ name: 'a' }, { name: 'b' }])
  await tick()
  assert.equal(h.layouts.length, 0)
  second.resolve(cutout('b')); await tick()
  assert.equal(h.layouts.length, 0)
  font.resolve(); await work
  assert.equal(h.layouts.length, 1)
  const before = structuredClone(h.session.getSnapshot().project.elements)
  await h.session.addFiles([{ name: 'c' }])
  assert.equal(h.layouts.length, 1)
  assert.deepEqual(h.session.getSnapshot().project.elements.slice(0, before.length), before)
  assert.equal(h.session.getSnapshot().project.elements.length, 3)
})
test('drag and continuous text previews produce a single commit and Undo', async () => {
  const { session } = harness()
  await session.addFiles([{ name: 'a' }])
  const initial = structuredClone(session.getSnapshot().project)
  const count = session.getSnapshot().history.length
  session.beginEdit()
  for (let i = 0; i < 10; i++) session.previewProject({ ...initial, elements: [{ ...initial.elements[0], x: 100 + i, text: String(i) }] })
  session.commitProject(session.getSnapshot().project)
  assert.equal(session.getSnapshot().history.length, count + 1)
  session.undo()
  assert.deepEqual(session.getSnapshot().project, initial)
})
test('failed replacement preserves last good asset and honest partial/all failure status', async () => {
  let fail = false
  const { session } = harness({ request: async file => { if (fail || file.name === 'bad') throw Error('failed'); return cutout(file.name) } })
  await session.addFiles([{ name: 'a' }, { name: 'bad' }])
  assert.equal(session.getStatus().kind, 'partial')
  const before = session.getSnapshot().sources.s1.assetId
  fail = true; await session.retrySource('s1')
  assert.equal(session.getSnapshot().sources.s1.assetId, before)
  assert.equal(session.getSnapshot().project.elements[0].assetId, before)
  const bad = harness({ request: async () => { throw Error('failed') } })
  await bad.session.addFiles([{ name: 'bad' }])
  assert.equal(bad.session.getStatus().kind, 'failed')
})
test('inactive and repeated StrictMode setup preserve complete work and recreate usable queues', async () => {
  const h = harness()
  await h.session.addFiles([{ name: 'a' }])
  const before = structuredClone(h.session.getSnapshot().project)
  h.session.deactivate(); h.session.activate()
  await h.session.addFiles([{ name: 'b' }])
  assert.deepEqual(h.session.getSnapshot().project.elements[0], before.elements[0])
  assert.equal(h.session.getSnapshot().sources.s2.status, 'ready')
  h.session.unmount(); h.session.mount(); h.session.activate(); await tick()
  await h.session.addFiles([{ name: 'c' }])
  assert.equal(h.session.getSnapshot().sources.s3.status, 'ready')
})
test('stale request and decode results never register after reset/inactive/removal', async () => {
  const request = deferred(), decoding = deferred()
  const first = harness({ request: () => request.promise })
  const add = first.session.addFiles([{ name: 'a' }]); await tick()
  first.session.reset(); request.resolve(cutout('late')); await add
  assert.equal(first.session.getSnapshot().project.elements.length, 0)
  assert.equal(first.store.get('a1'), undefined)
  const second = harness({ decodeImage: () => decoding.promise })
  const more = second.session.addFiles([{ name: 'a' }]); await tick()
  second.session.removeSource('s1')
  decoding.resolve({ width: 100, height: 80, close() {} }); await more
  assert.equal(second.store.get('a1'), undefined)
  assert.equal(second.session.getSnapshot().project.elements.length, 0)
})
test('deleting sticker keeps available source card and remove Undo restores file and slot', async () => {
  const { session } = harness()
  const file = { name: 'a' }
  await session.addFiles([file])
  session.commitProject({ ...session.getSnapshot().project, elements: [] })
  assert.equal(session.getSnapshot().sources.s1.status, 'ready')
  session.placeSource('s1')
  assert.equal(session.getSnapshot().project.elements.length, 1)
  session.removeSource('s1')
  assert.equal(Object.keys(session.getSnapshot().sources).length, 0)
  assert.equal(session.getSourceFile('s1'), file)
  session.undo()
  assert.equal(Object.keys(session.getSnapshot().sources).length, 1)
  assert.equal(session.getSourceFile('s1'), file)
})
test('history eviction releases old assets and file/preview refs; reset clears them', async () => {
  const { session, store, revoked } = harness()
  await session.addFiles([{ name: 'a' }])
  session.removeSource('s1')
  for (let i = 0; i < 21; i++) session.commitProject({ ...session.getSnapshot().project, ink: i % 2 ? 'light' : 'dark' })
  assert.equal(session.getSourceFile('s1'), undefined)
  assert.equal(store.get('a1'), undefined)
  assert.ok(revoked.includes('blob:a'))
  await session.addFiles([{ name: 'b' }])
  const epoch = session.getSnapshot().epoch
  session.reset()
  assert.equal(session.getSnapshot().epoch, epoch + 1)
  assert.equal(session.getSourcePreview('s2'), undefined)
  assert.equal(store.get('a2'), undefined)
})


test('initial placed sources report placed; no-space additions honestly remain waiting', async () => {
  const { session } = harness({ buildLayout: assets => [{ ...sticker(assets[0].assetId), sourceId: assets[0].sourceId, x: 500, y: 500, width: 990, height: 990, rotation: 0, borderStyle: 'none' }] })
  await session.addFiles([{ name: 'a' }])
  assert.equal(session.getStatus().waiting, 0)
  await session.addFiles([{ name: 'b' }])
  assert.equal(session.getSnapshot().project.elements.length, 1)
  assert.equal(session.getSnapshot().sources.s2.placement, 'waiting')
})
test('parallel decodes cannot collect another completed but unapplied asset', async () => {
  const a = deferred(), b = deferred()
  const h = harness({ decodeImage: src => src === 'blob:a' ? a.promise : b.promise })
  const add = h.session.addFiles([{ name: 'a' }, { name: 'b' }]); await tick()
  a.resolve({ width: 100, height: 80 }); b.resolve({ width: 100, height: 80 })
  await add
  assert.equal(h.session.getSnapshot().project.elements.length, 2)
  for (const e of h.session.getSnapshot().project.elements) assert.ok(h.store.get(e.assetId))
})
test('reset permits a fresh batch while an old ignored decoder is unresolved', async () => {
  const old = deferred()
  const h = harness({ decodeImage: src => src === 'blob:a' ? old.promise : Promise.resolve({ width: 100, height: 80 }) })
  const first = h.session.addFiles([{ name: 'a' }]); await tick()
  h.session.reset()
  await h.session.addFiles([{ name: 'b' }])
  assert.equal(Object.values(h.session.getSnapshot().sources)[0]?.name, 'b')
  old.resolve({ width: 100, height: 80 }); await first
  assert.equal(h.session.getSnapshot().project.elements.length, 1)
})
test('inactive font wait is superseded on next setup and cannot block current layout', async () => {
  const firstFont = deferred()
  let calls = 0
  const h = harness({ waitForFonts: () => ++calls === 1 ? firstFont.promise : Promise.resolve() })
  const add = h.session.addFiles([{ name: 'a' }]); await tick()
  h.session.deactivate(); h.session.activate(); await tick()
  assert.equal(h.layouts.length, 1)
  firstFont.resolve(); await add
  assert.equal(h.layouts.length, 1)
})
test('cleanup aborts jobs and global request slots survive repeated queue creation', async () => {
  const waits = [], signals = []
  let calls = 0
  const h = harness({ request: (_file, _subject, { signal }) => { calls++; signals.push(signal); const d = deferred(); waits.push(d); return d.promise } })
  const first = h.session.addFiles([{ name: 'a' }, { name: 'b' }]); await tick()
  assert.equal(calls, 2)
  h.session.deactivate()
  assert.ok(signals.every(s => s.aborted))
  h.session.activate()
  const fresh = h.session.addFiles([{ name: 'c' }]); await tick()
  assert.equal(calls, 2, 'ignored cancelled workers still occupy actual request slots')
  waits[0].resolve(cutout('old')); waits[1].resolve(cutout('old')); await tick()
  assert.equal(calls, 3)
  waits[2].resolve(cutout('c')); await Promise.all([first, fresh])
  assert.equal(h.session.getSnapshot().sources.s3.status, 'ready')
})
test('transient project preview retains background assets until grouped commit or cancel', async () => {
  const h = harness()
  const bg = await h.store.load({ src: 'blob:bg' })
  h.session.commitProject({ ...h.session.getSnapshot().project, background: { kind: 'photo', assetId: bg, offsetX: .5, offsetY: .5 } })
  h.session.beginEdit()
  h.session.previewProject({ ...h.session.getSnapshot().project, background: { kind: 'solid', color: '#fff' } })
  assert.ok(h.store.get(bg))
  h.session.cancelEdit()
  assert.equal(h.session.getSnapshot().project.background.assetId, bg)
})


test('paused original preview can be rebuilt on retry without resuming obsolete job', async () => {
  const preview = deferred()
  let previews = 0
  const h = harness({ decodePreview: async file => { if (++previews === 1) return preview.promise; return { file, thumbnailUrl: 'data:new', width: 123, height: 234 } } })
  const add = h.session.addFiles([{ name: 'a' }]); await tick()
  h.session.deactivate(); h.session.activate()
  await h.session.retrySource('s1')
  assert.equal(h.session.getSourcePreview('s1')?.width, 123)
  preview.resolve({ file: { name: 'old' }, thumbnailUrl: 'data:old', width: 9, height: 9 }); await add
  assert.equal(h.session.getSourceFile('s1').name, 'a')
})
test('manual relayout cannot apply an obsolete font wait after inactive/reactivation', async () => {
  const old = deferred()
  let fonts = 0, layout = 0
  const h = harness({ waitForFonts: () => ++fonts === 2 ? old.promise : Promise.resolve(), buildLayout: assets => [{ ...sticker(assets[0].assetId), sourceId: assets[0].sourceId, x: ++layout * 100 }] })
  await h.session.addFiles([{ name: 'a' }])
  const relayout = h.session.reLayout()
  h.session.deactivate(); h.session.activate()
  old.resolve(); assert.equal(await relayout, false)
  assert.equal(h.session.getSnapshot().project.elements[0].x, 100)
})
test('real unmount releases records and no subscriber receives obsolete results', async () => {
  const request = deferred()
  const h = harness({ request: file => file.name === 'b' ? request.promise : Promise.resolve(cutout(file.name)) })
  await h.session.addFiles([{ name: 'a' }])
  const work = h.session.addFiles([{ name: 'b' }]); await tick()
  let notifications = 0
  h.session.subscribe(() => notifications++)
  h.session.unmount(); const count = notifications
  await tick(); request.resolve(cutout('b')); await work
  assert.equal(notifications, 0, 'unmounted subscribers are never notified, including during cleanup')
  assert.equal(notifications, count)
  assert.equal(h.store.get('a1'), undefined)
  assert.ok(h.closed.includes('blob:a'))
})


test('unanimous short meaningful themes create editable title; mixed/missing/generic themes use fallback', async () => {
  const { createCollageLayout } = await import('../src/utils/collage-layout.js')
  for (const [themes, title] of [
    [['咖啡', ' 咖啡 '], '咖啡小记'],
    [['咖啡', '旅行'], '把日常，贴成一页'],
    [['咖啡', undefined], '把日常，贴成一页'],
    [['其他'], '把日常，贴成一页'],
    [['超过十二个字的非常冗长而且不可信主题文字'], '把日常，贴成一页'],
  ]) {
    const h = harness({ buildLayout: createCollageLayout, request: async file => ({ ...cutout(file.name), theme: themes[Number(file.name)] }) })
    await h.session.addFiles(themes.map((_theme, i) => ({ name: String(i) })))
    const element = h.session.getSnapshot().project.elements.find(e => e.role === 'title')
    assert.equal(element?.text, title)
    assert.equal(element?.type, 'text')
  }
})
test('relayout preserves edited title and accepts explicit title or fresh theme title', async () => {
  const { createCollageLayout } = await import('../src/utils/collage-layout.js')
  const h = harness({ buildLayout: createCollageLayout, request: async file => ({ ...cutout(file.name), theme: '咖啡' }) })
  await h.session.addFiles([{ name: 'a' }])
  const edited = { ...h.session.getSnapshot().project, elements: h.session.getSnapshot().project.elements.map(e => e.role === 'title' ? { ...e, text: '我的一天' } : e) }
  h.session.commitProject(edited)
  await h.session.reLayout()
  assert.equal(h.session.getSnapshot().project.elements.find(e => e.role === 'title').text, '我的一天')
  await h.session.reLayout({ title: '指定标题' })
  assert.equal(h.session.getSnapshot().project.elements.find(e => e.role === 'title').text, '指定标题')
  await h.session.reLayout({ freshTitle: true })
  assert.equal(h.session.getSnapshot().project.elements.find(e => e.role === 'title').text, '咖啡小记')
})

test('background load shares decode ownership with cutouts and consumes no sticker slot', async () => {
  const background = deferred(), stickerDecode = deferred()
  const h = harness({ createObjectUrl: () => 'blob:background', decodeImage: src => src === 'blob:background' ? background.promise : stickerDecode.promise })
  const bg = h.session.loadBackground({ name: 'background.jpg' })
  const add = h.session.addFiles([{ name: 'a' }]); await tick()
  background.resolve({ width: 100, height: 80 }); stickerDecode.resolve({ width: 100, height: 80 })
  assert.equal(await bg, true); await add
  const state = h.session.getSnapshot()
  assert.equal(state.project.background.kind, 'photo')
  assert.equal(state.project.sourceIds.length, 1)
  assert.equal(Object.keys(state.sources).length, 1)
  assert.ok(h.store.get(state.project.background.assetId))
  assert.ok(h.store.get(state.project.elements[0].assetId))
  h.session.undo()
  assert.ok(h.store.get(h.session.getSnapshot().project.background.assetId))
})
test('background failures preserve prior photo, reset suppresses late decode, and explicit edits cancel upload', async () => {
  const late = deferred()
  let urls = 0
  const h = harness({ createObjectUrl: () => 'blob:bg' + ++urls, decodeImage: src => src === 'blob:bg2' ? Promise.reject(Error('decode failed')) : src === 'blob:bg3' ? late.promise : Promise.resolve({ width: 100, height: 80 }) })
  assert.equal(await h.session.loadBackground({ name: 'first' }), true)
  const before = h.session.getSnapshot().project.background.assetId
  assert.equal(await h.session.loadBackground({ name: 'bad' }), false)
  assert.equal(h.session.getSnapshot().project.background.assetId, before)
  assert.match(h.session.getStatus().backgroundError, /decode failed/)
  const work = h.session.loadBackground({ name: 'late' }); await tick()
  h.session.reset()
  late.resolve({ width: 100, height: 80 }); assert.equal(await work, false)
  assert.equal(h.session.getSnapshot().project.background.kind, 'paper-dark')
  assert.equal(h.session.getStatus().backgroundBusy, false)
  const preview = deferred()
  const second = harness({ createObjectUrl: () => 'blob:edit', decodePreview: () => preview.promise })
  const load = second.session.loadBackground({ name: 'pending' })
  second.session.commitProject({ ...second.session.getSnapshot().project, background: { kind: 'solid', color: '#fff' } })
  preview.resolve({ file: { name: 'pending' }, thumbnailUrl: 'data:thumb', width: 100, height: 80 })
  assert.equal(await load, false)
  assert.equal(second.session.getSnapshot().project.background.kind, 'solid')
})

test('cancelled gesture and preview Undo preserve completed retry asset and ready source', async () => {
  for (const cancel of ['cancelEdit', 'undo']) {
    const retry = deferred()
    let requests = 0
    const h = harness({ request: file => ++requests === 1 ? Promise.resolve(cutout(file.name)) : retry.promise })
    await h.session.addFiles([{ name: 'a' }])
    const before = structuredClone(h.session.getSnapshot().project)
    const oldAsset = h.session.getSnapshot().sources.s1.assetId
    const history = h.session.getSnapshot().history.length
    const work = h.session.retrySource('s1'); await tick()
    assert.equal(h.session.getSnapshot().sources.s1.status, 'processing')
    h.session.beginEdit()
    h.session.previewProject({ ...before, elements: before.elements.map(e => ({ ...e, x: 700 })) })
    retry.resolve(cutout('replacement')); await work
    const replacement = h.session.getSnapshot().sources.s1.assetId
    assert.notEqual(replacement, oldAsset)
    h.session[cancel]()
    const after = h.session.getSnapshot()
    assert.equal(after.sources.s1.status, 'ready')
    assert.equal(after.sources.s1.assetId, replacement)
    assert.equal(after.project.elements[0].assetId, replacement)
    assert.equal(after.project.elements[0].x, before.elements[0].x)
    assert.equal(after.sources.s1.caption, 'replacement')
    assert.equal(after.history.length, history + 1, 'only successful replacement is committed')
    assert.equal(after.history.at(-1).project.elements[0].x, before.elements[0].x, 'replacement history excludes transient drag')
    assert.ok(h.store.get(replacement))
    h.session.undo()
    assert.equal(h.session.getSnapshot().project.elements[0].assetId, oldAsset)
    assert.equal(h.session.getSnapshot().project.elements[0].x, before.elements[0].x)
  }
})
test('committing gesture after completed correction keeps separate correction and gesture undo steps', async () => {
  const retry = deferred()
  let requests = 0
  const h = harness({ request: file => ++requests === 1 ? Promise.resolve(cutout(file.name)) : retry.promise })
  await h.session.addFiles([{ name: 'a' }])
  const before = structuredClone(h.session.getSnapshot().project)
  const oldAsset = h.session.getSnapshot().sources.s1.assetId
  const work = h.session.correctSource('s1', { label: 'new', box_2d: [100, 100, 900, 900] }); await tick()
  h.session.beginEdit()
  h.session.previewProject({ ...before, elements: before.elements.map(e => ({ ...e, x: 700 })) })
  retry.resolve(cutout('corrected')); await work
  const replacement = h.session.getSnapshot().sources.s1.assetId
  h.session.commitProject(h.session.getSnapshot().project)
  assert.equal(h.session.getSnapshot().project.elements[0].x, 700)
  h.session.undo()
  assert.equal(h.session.getSnapshot().sources.s1.status, 'ready')
  assert.equal(h.session.getSnapshot().project.elements[0].assetId, replacement)
  assert.equal(h.session.getSnapshot().project.elements[0].x, before.elements[0].x)
  h.session.undo()
  assert.equal(h.session.getSnapshot().project.elements[0].assetId, oldAsset)
  assert.equal(h.session.getSnapshot().project.elements[0].x, before.elements[0].x)
})
test('grouped background preview commit invalidates older upload before its decoder completes', async () => {
  const decoded = deferred()
  const h = harness({ createObjectUrl: () => 'blob:obsolete-bg', decodeImage: () => decoded.promise })
  const upload = h.session.loadBackground({ name: 'pending' }); await tick()
  assert.equal(h.session.getStatus().backgroundBusy, true)
  h.session.beginEdit()
  h.session.previewProject({ ...h.session.getSnapshot().project, background: { kind: 'solid', color: '#fff' } })
  h.session.commitProject(h.session.getSnapshot().project)
  decoded.resolve({ width: 100, height: 80 })
  assert.equal(await upload, false)
  assert.equal(h.session.getSnapshot().project.background.kind, 'solid')
  assert.equal(h.session.getSnapshot().project.background.color, '#fff')
  assert.equal(h.session.getStatus().backgroundBusy, false)
  assert.equal(h.store.get('a1'), undefined)
  assert.ok(h.revoked.includes('blob:obsolete-bg'))
  h.session.undo()
  assert.equal(h.session.getSnapshot().project.background.kind, 'paper-dark')
})

for (const ending of ['cancelEdit', 'undo', 'commitUndo']) {
  test(`first async placement survives ${ending} with independent history and source metadata`, async () => {
    const pending = deferred()
    const h = harness({ buildLayout: createCollageLayout, request: file => file.name === 'b' ? pending.promise : Promise.resolve(cutout(file.name)) })
    await h.session.addFiles([{ name: 'a' }])
    const work = h.session.addFiles([{ name: 'b' }]); await tick()
    const before = structuredClone(h.session.getSnapshot().project)
    const original = before.elements.find(e => e.sourceId === 's1')
    h.session.beginEdit()
    h.session.previewProject({ ...before, elements: before.elements.map(e => e.id === original.id ? { ...e, x: e.x + 40 } : e) })
    pending.resolve(cutout('b')); await work
    const newSticker = structuredClone(h.session.getSnapshot().project.elements.find(e => e.sourceId === 's2'))
    assert.ok(newSticker, 'default layout can append this asset')
    assert.equal(h.session.getSnapshot().project.elements.find(e => e.id === original.id).x, original.x + 40)
    if (ending === 'commitUndo') { h.session.commitProject(h.session.getSnapshot().project); h.session.undo() }
    else h.session[ending]()
    const after = h.session.getSnapshot()
    assert.deepEqual(after.project.elements.find(e => e.sourceId === 's2'), newSticker)
    assert.deepEqual(after.project.elements.find(e => e.id === original.id), original)
    assert.equal(after.sources.s2.status, 'ready')
    assert.equal(after.sources.s2.placement, 'placed')
    assert.equal(after.sources.s2.assetId, newSticker.assetId)
    assert.ok(h.store.get(newSticker.assetId))
    assert.deepEqual(after.history.at(-1).project, before, 'placement history excludes the gesture')
    h.session.undo()
    assert.deepEqual(h.session.getSnapshot().project, before)
    assert.equal(h.session.getSnapshot().sources.s2.placement, 'waiting')
    assert.ok(h.store.get(newSticker.assetId), 'available source retains the completed asset')
  })
}

test('first manual success after automatic failure is independent of an overlapping gesture', async () => {
  const pending = deferred()
  const h = harness({ buildLayout: createCollageLayout, request: (file, subject) => file.name === 'bad' ? subject ? pending.promise : Promise.reject(Error('automatic failed')) : Promise.resolve(cutout(file.name)) })
  await h.session.addFiles([{ name: 'a' }, { name: 'bad' }])
  const before = structuredClone(h.session.getSnapshot().project)
  const work = h.session.correctSource('s2', { label: 'manual', box_2d: [100, 100, 900, 900] }); await tick()
  h.session.beginEdit()
  h.session.previewProject({ ...before, elements: before.elements.map(e => e.sourceId === 's1' ? { ...e, x: e.x + 30 } : e) })
  pending.resolve(cutout('manual')); await work
  h.session.commitProject(h.session.getSnapshot().project); h.session.undo()
  assert.deepEqual(h.session.getSnapshot().project.elements.filter(e => e.sourceId !== 's2'), before.elements)
  assert.ok(h.session.getSnapshot().project.elements.some(e => e.sourceId === 's2'))
  assert.equal(h.session.getSnapshot().sources.s2.placement, 'placed')
  assert.equal(h.session.getSnapshot().sources.s2.caption, 'manual')
  h.session.undo()
  assert.deepEqual(h.session.getSnapshot().project, before)
  assert.equal(h.session.getSnapshot().sources.s2.placement, 'waiting')
})

for (const ending of ['cancelEdit', 'commitUndo']) {
  test(`initial font completion preserves manually placed geometry through ${ending}`, async () => {
    const fonts = deferred()
    const h = harness({ buildLayout: createCollageLayout, waitForFonts: () => fonts.promise })
    const work = h.session.addFiles([{ name: 'a' }, { name: 'b' }]); await tick()
    assert.equal(h.session.placeSource('s1'), true)
    const before = structuredClone(h.session.getSnapshot().project)
    const original = before.elements[0]
    h.session.beginEdit()
    h.session.previewProject({ ...before, elements: [{ ...original, x: original.x + 20 }] })
    fonts.resolve(); await work
    assert.equal(h.session.getSnapshot().project.elements.find(e => e.id === original.id).x, original.x + 20)
    if (ending === 'commitUndo') { h.session.commitProject(h.session.getSnapshot().project); h.session.undo() }
    else h.session.cancelEdit()
    assert.deepEqual(h.session.getSnapshot().project.elements.find(e => e.id === original.id), original)
    assert.ok(h.session.getSnapshot().project.elements.some(e => e.sourceId === 's2'))
    assert.equal(h.session.getSnapshot().sources.s2.placement, 'placed')
    assert.deepEqual(h.session.getSnapshot().history.at(-1).project, before)
    h.session.undo()
    assert.deepEqual(h.session.getSnapshot().project, before)
    assert.equal(h.session.getSnapshot().sources.s2.placement, 'waiting')
  })
}

test('replacement bounds constrain every duplicate at edges and extreme rotated aspect ratios; Undo restores all geometry', () => {
  for (const [width, height] of [[100, 400], [1, 1000], [1000, 1]]) for (const rotation of [0, 37, 90, -135]) for (const borderWidth of [0, 6, 16]) {
    const state = readyState()
    state.project.elements = [[500, 800], [160, 110], [850, 850]].map(([x, y], i) => ({ ...sticker(), id: `copy${i}`, x, y, width: 300, height: 75, rotation, borderWidth }))
    const next = replaceCollageAsset(state, 's1', { assetId: 'after', width, height })
    for (const element of next.project.elements) {
      const bounds = collageElementBounds(element)
      assert.ok(bounds.x1 >= -1e-7 && bounds.y1 >= -1e-7 && bounds.x2 <= 1000 + 1e-7 && bounds.y2 <= 1000 + 1e-7, JSON.stringify({ width, height, rotation, borderWidth, bounds }))
      assert.equal(element.assetId, 'after')
      assert.ok(Math.abs(element.height / element.width - height / width / (4 / 3)) < 1e-7)
      assert.ok(element.width <= 300)
      assert.equal(element.rotation, rotation)
    }
    assert.equal(next.sources.s1.assetId, 'after')
    const undone = undoProjectEdit(next)
    assert.deepEqual(undone.project, state.project)
    assert.equal(undone.sources.s1.assetId, 'before')
    assert.ok(collectReferencedAssetIds(next).has('before'))
  }
})

test('initial font completion respects occupied user geometry and leaves sources waiting when no safe space exists', async () => {
  const fonts = deferred()
  const h = harness({ buildLayout: createCollageLayout, waitForFonts: () => fonts.promise })
  const work = h.session.addFiles([{ name: 'a' }]); await tick()
  const title = { id: 'user-title', type: 'text', role: 'title', text: 'My page', x: 500, y: 500, width: 1000, height: 1000, rotation: 0, aspect: 4 / 3 }
  h.session.commitProject({ ...h.session.getSnapshot().project, elements: [title] })
  fonts.resolve(); await work
  assert.deepEqual(h.session.getSnapshot().project.elements, [title])
  assert.equal(h.session.getSnapshot().sources.s1.status, 'ready')
  assert.equal(h.session.getSnapshot().sources.s1.placement, 'waiting')
  assert.ok(h.store.get(h.session.getSnapshot().sources.s1.assetId))
})
