import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCollageState, cloneCollageData, commitProjectEdit, undoProjectEdit, collectReferencedAssetIds, collectReferencedSourceIds, isCurrentCutout, removeCollageSource, replaceCollageAsset } from '../utils/collage-state.js'
import { createStickerAssetStore } from '../utils/image-stickers.js'
import { createCutoutQueue } from '../utils/cutout-queue.js'
import { requestCutout, validateCutoutSubject } from '../utils/cutout-client.js'
import { decodeSourcePreview, validateUploadBatch } from '../utils/collage-files.js'
import { createCollageLayout, placeAdditionalSticker, collageElementBounds } from '../utils/collage-layout.js'
import { MAX_COLLAGE_SOURCES, CUTOUT_CONCURRENCY, COLLAGE_DEFAULT_TITLE, collageInk } from '../utils/collage-config.js'
import { ensureFontLoaded } from '../utils/fonts.js'

async function handwritingReady() {
  await ensureFontLoaded()
  if (document.fonts && ['Long Cang', 'Caveat'].some(family => ![...document.fonts].some(font => font.family.replaceAll('"', '').replaceAll("'", '') === family && font.status === 'loaded'))) throw new Error('手写字体暂不可用，请重试排版')
  await document.fonts?.ready
}

// Browser resources and asynchronous work belong to this session, never its
// cloneable project/history. Dependency boundaries also allow deterministic tests.
export function createCollageSession({
  assetStore, request = requestCutout, buildLayout = createCollageLayout,
  decodePreview = decodeSourcePreview, validateBatch = validateUploadBatch,
  waitForFonts = handwritingReady, idFactory = () => crypto.randomUUID(),
  createObjectUrl = file => URL.createObjectURL(file),
} = {}) {
  let state = createCollageState(), store = assetStore || createStickerAssetStore()
  let queue = null, active = false, mounted = true, lifecycle = 0, disposed = false
  let initialLayout = false, layoutWork = null, layoutError = null, editStart = null
  let decodeCount = 0, adding = false
  let backgroundVersion = 0, backgroundBusy = false, backgroundError = null
  const files = new Map(), listeners = new Set()
  // Request slots survive queue replacement when an injected worker ignores abort.
  let requestCount = 0
  const requestWaiters = []
  const pendingSources = () => Object.values(state.sources).some(source => ['preparing', 'processing'].includes(source.status))
  const requestSlot = signal => new Promise((resolve, reject) => {
    const entry = { signal, resolve, reject }
    entry.abort = () => { const index = requestWaiters.indexOf(entry); if (index >= 0) requestWaiters.splice(index, 1); reject(new DOMException('Cancelled', 'AbortError')) }
    if (signal.aborted) { entry.abort(); return }
    if (requestCount < CUTOUT_CONCURRENCY) { requestCount++; resolve(); return }
    signal.addEventListener('abort', entry.abort, { once: true })
    requestWaiters.push(entry)
  })
  const releaseRequest = () => {
    requestCount--
    while (requestCount < CUTOUT_CONCURRENCY && requestWaiters.length) {
      const entry = requestWaiters.shift()
      entry.signal.removeEventListener('abort', entry.abort)
      if (entry.signal.aborted) { entry.abort(); continue }
      requestCount++; entry.resolve()
    }
  }
  const worker = async (job, options) => {
    await requestSlot(options.signal)
    try {
      if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      return await request(job.file, job.subject, options)
    } finally { releaseRequest() }
  }
  const versions = new Map()
  const publish = next => { state = next; if (mounted) for (const listener of listeners) listener() }
  const collect = () => {
    // Two load() calls can install records before either awaiting consumer runs.
    // Defer collection until every decoder has passed its application boundary.
    const retainedState = editStart ? { ...state, history: [...state.history, editStart] } : state
    if (!decodeCount) store.collect(collectReferencedAssetIds(retainedState))
    const referenced = collectReferencedSourceIds(retainedState)
    for (const id of files.keys()) if (!referenced.has(id)) files.delete(id)
  }
  const update = next => { publish(next); collect() }
  const versionFor = id => { const version = Math.max(versions.get(id) || 0, state.sources[id]?.version || 0) + 1; versions.set(id, version); return version }
  const current = (job, ownedQueue) => mounted && active && !disposed && queue === ownedQueue && isCurrentCutout(state, job)
  const sourceUpdate = (id, patch) => {
    if (!state.sources[id]) return
    const sources = { ...state.sources, [id]: { ...state.sources[id], ...patch } }
    if (editStart) editStart.sources = cloneCollageData(sources)
    update({ ...state, sources })
  }
  // An async asset commit is independent of a user's transient gesture. Apply
  // it to both visible geometry and the cancellation baseline; its history
  // records the committed baseline, never a halfway drag or text input.
  const commitAsyncEdit = edit => {
    const next = edit(state)
    if (!editStart) { update(next); return }
    const baseline = edit({ ...state, ...editStart })
    editStart = cloneCollageData({ project: baseline.project, sources: baseline.sources })
    update({ ...next, history: baseline.history })
  }
  const usableAssets = () => state.project.sourceIds.map(id => store.get(state.sources[id]?.assetId)).filter(Boolean)
  const themeTitle = () => {
    const themes = usableAssets().map(asset => typeof asset.meta.theme === 'string' ? asset.meta.theme.trim() : '')
    const theme = themes[0]
    return theme && [...theme].length <= 12 && ![...theme].some(character => character.charCodeAt(0) < 32 || '<>'.includes(character)) && !['其他', '未知', '混合', 'other', 'unknown', 'mixed'].includes(theme.toLowerCase()) && themes.every(value => value === theme) ? theme + '小记' : COLLAGE_DEFAULT_TITLE
  }
  const currentTitle = () => state.project.elements.find(element => element.type === 'text' && element.role === 'title')?.text
  const cancelBackground = () => { backgroundVersion++; backgroundBusy = false; backgroundError = null }
  const stop = () => {
    active = false
    cancelBackground()
    layoutWork = null
    queue?.dispose(); queue = null
    const sources = { ...state.sources }
    for (const source of Object.values(sources)) if (['preparing', 'processing'].includes(source.status)) sources[source.id] = { ...source, version: versionFor(source.id), status: source.assetId ? 'ready' : 'paused' }
    update({ ...state, sources })
  }
  const buildInitial = async () => {
    if (initialLayout || pendingSources() || !active || !mounted) return
    if (layoutWork) return layoutWork
    const epoch = state.epoch, ownedQueue = queue
    const assets = usableAssets()
    if (!assets.length) return
    const work = (async () => {
      try {
        await waitForFonts()
        if (!mounted || !active || epoch !== state.epoch || queue !== ownedQueue || pendingSources() || initialLayout) return
        const assets = usableAssets()
        const elements = buildLayout(assets, { title: currentTitle() ?? themeTitle(), ink: collageInk(state.project.background, state.project.ink) })
        const existing = (editStart?.project || state.project).elements
        const additions = existing.length ? [] : elements
        if (existing.length) {
          // User edits made during the font wait take precedence. Append into
          // the committed free space once, so cancel/Undo use the same positions.
          for (const asset of assets) {
            if (existing.some(element => element.type === 'imageSticker' && element.sourceId === asset.sourceId)) continue
            const placed = placeAdditionalSticker(asset, [...existing, ...additions])
            if (placed) additions.push(placed)
          }
          for (const element of elements.filter(element => element.type !== 'imageSticker')) {
            const occupied = [...existing, ...additions], bounds = collageElementBounds(element)
            if (occupied.some(other => other.id === element.id || (element.role === 'title' && other.role === 'title'))) continue
            if (occupied.some(other => { const b = collageElementBounds(other); return bounds.x1 < b.x2 + 6 && bounds.x2 + 6 > b.x1 && bounds.y1 < b.y2 + 6 && bounds.y2 + 6 > b.y1 })) continue
            additions.push(element)
          }
        }
        initialLayout = true
        layoutError = null
        commitAsyncEdit(currentState => {
          const merged = [...currentState.project.elements, ...additions]
          return commitProjectEdit(currentState, { ...currentState.project, elements: merged }, placedSources(merged, currentState.sources))
        })
      } catch (error) {
        if (mounted && active && epoch === state.epoch && queue === ownedQueue) { layoutError = error.message; publish({ ...state }) }
      }
    })()
    layoutWork = work
    try { await work } finally { if (layoutWork === work) layoutWork = null }
  }
  const placedSources = (elements, sources = state.sources) => Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, source.assetId ? { ...source, placement: elements.some(element => element.type === 'imageSticker' && element.sourceId === id) ? 'placed' : 'waiting' } : source]))
  const append = sourceId => {
    const source = state.sources[sourceId], asset = store.get(source?.assetId)
    if (!asset) return false
    const element = placeAdditionalSticker(asset, (editStart?.project || state.project).elements)
    if (!element) { sourceUpdate(sourceId, { placement: 'waiting' }); return false }
    commitAsyncEdit(currentState => commitProjectEdit(currentState, { ...currentState.project, elements: [...currentState.project.elements, element] }, { ...currentState.sources, [sourceId]: { ...currentState.sources[sourceId], placement: 'placed' } }))
    return true
  }
  const processSource = async (sourceId, subject = state.sources[sourceId]?.subject || null) => {
    if (!active || !mounted || !queue || !state.sources[sourceId] || !files.has(sourceId)) return
    const version = versionFor(sourceId), epoch = state.epoch, ownedQueue = queue, ownedStore = store
    const job = { sourceId, version, epoch, file: files.get(sourceId).file, subject: subject ? cloneCollageData(subject) : null }
    sourceUpdate(sourceId, { version, status: 'processing', error: undefined })
    try {
      if (!files.get(sourceId).preview) {
        const preview = await decodePreview(job.file)
        if (!current(job, ownedQueue)) return
        files.set(sourceId, { file: preview.file, preview: { thumbnailUrl: preview.thumbnailUrl, width: preview.width, height: preview.height } })
      }
      const result = await ownedQueue.enqueue(job)
      if (!current(job, ownedQueue) || result.cancelled) return
      if (result.error) throw result.error
      const data = result.data
      let assetId
      decodeCount++
      try {
        assetId = await ownedStore.load({ src: data.image, sourceId, meta: { subject: data.subject, caption: data.caption, theme: data.theme, emotion: data.emotion, quality: data.quality, contours: data.contours } })
        // Re-check after decode. A removed, reset, retried or paused source must
        // not overwrite a newer asset or restore itself to the project.
        if (!current(job, ownedQueue) || store !== ownedStore) return
        const metadata = { subject: data.subject, caption: data.caption, theme: data.theme, error: undefined }
        const source = state.sources[sourceId]
        if (source.assetId) commitAsyncEdit(currentState => replaceCollageAsset(currentState, sourceId, ownedStore.get(assetId), metadata))
        else {
          sourceUpdate(sourceId, { ...metadata, assetId, status: 'ready', placement: 'waiting' })
          if (initialLayout) append(sourceId)
        }
      } finally {
        decodeCount--
        if (ownedStore !== store) ownedStore.collect(new Set())
        collect()
      }
    } catch (error) {
      if (current(job, ownedQueue)) sourceUpdate(sourceId, { status: 'failed', error: error.message || '抠图失败，请重试' })
    } finally {
      if (mounted && active) await buildInitial()
    }
  }
  const api = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    get assetStore() { return store },
    getSourceFile: id => files.get(id)?.file,
    getSourcePreview: id => files.get(id)?.preview,
    getStatus() {
      const sources = Object.values(state.sources), busy = sources.filter(s => ['preparing', 'processing'].includes(s.status)).length
      const failed = sources.filter(s => s.status === 'failed').length, ready = sources.filter(s => s.assetId).length
      return { kind: busy ? 'processing' : !sources.length ? 'empty' : failed === sources.length && !ready ? 'failed' : failed ? 'partial' : ready ? 'ready' : 'paused', busy, failed, ready, waiting: sources.filter(s => s.placement === 'waiting').length, layoutError, backgroundBusy, backgroundError }
    },
    mount() { if (disposed) return; mounted = true; lifecycle++ },
    activate() {
      if (disposed) return
      mounted = true; active = true
      if (!queue) queue = createCutoutQueue({ worker })
      void buildInitial()
    },
    deactivate: stop,
    unmount() {
      mounted = false
      stop()
      const ticket = ++lifecycle
      // React StrictMode's synchronous setup-cleanup-setup cancels destruction.
      // A real unmount owns no further callbacks and releases browser resources.
      queueMicrotask(() => {
        if (mounted || ticket !== lifecycle) return
        disposed = true; files.clear(); listeners.clear()
        if (assetStore) store.collect(new Set())
        else store.dispose()
      })
    },
    async addFiles(candidates) {
      if (!active || !mounted || disposed || adding) return { sourceIds: [], errors: [] }
      const addition = {}
      adding = addition
      const epoch = state.epoch, ownedQueue = queue
      try {
        const result = await validateBatch(Array.from(candidates), Object.keys(state.sources).length)
        if (!active || !mounted || state.epoch !== epoch || queue !== ownedQueue) return { sourceIds: [], errors: result.errors }
        const sourceIds = [], errors = [...result.errors], sources = { ...state.sources }
        for (const file of result.files) {
          if (Object.keys(sources).length >= MAX_COLLAGE_SOURCES) { errors.push({ file, reason: '单个作品最多 16 张素材' }); continue }
          const id = idFactory()
          if (sources[id] || files.has(id)) throw new Error('Duplicate source ID')
          sourceIds.push(id)
          sources[id] = { id, name: file.name, status: 'preparing', version: versionFor(id) }
          files.set(id, { file })
        }
        update(commitProjectEdit(state, { ...state.project, sourceIds: [...state.project.sourceIds, ...sourceIds] }, sources))
        // Reserve every card first; preparing/processing statuses hold the
        // initial layout until this and any concurrent batch have settled.
        adding = false
        await Promise.all(sourceIds.map(async id => {
          const job = { sourceId: id, version: sources[id].version, epoch }
          try {
            const preview = await decodePreview(files.get(id).file)
            if (!current(job, ownedQueue)) return
            files.set(id, { file: preview.file, preview: { thumbnailUrl: preview.thumbnailUrl, width: preview.width, height: preview.height } })
            await processSource(id)
          } catch (error) {
            if (current(job, ownedQueue)) sourceUpdate(id, { status: 'failed', error: error.message })
          }
        }))
        await buildInitial()
        return { sourceIds, errors }
      } finally { if (adding === addition) adding = false }
    },
    async loadBackground(file) {
      if (!active || !mounted || disposed) return false
      const version = ++backgroundVersion, epoch = state.epoch, ownedQueue = queue, ownedStore = store
      const valid = () => mounted && active && !disposed && backgroundVersion === version && state.epoch === epoch && queue === ownedQueue && store === ownedStore
      backgroundBusy = true; backgroundError = null; publish({ ...state })
      try {
        // Validate identical file limits and oriented full-photo dimensions.
        // The original File supplies the photo; the thumbnail is never rendered.
        const preview = await decodePreview(file)
        if (!valid()) return false
        decodeCount++
        try {
          const assetId = await ownedStore.load({ src: createObjectUrl(file), sourceId: 'background' })
          if (!valid()) return false
          const asset = ownedStore.get(assetId)
          if (asset.width !== preview.width || asset.height !== preview.height) throw new Error('背景照片方向或解码尺寸不一致，请重试')
          commitAsyncEdit(currentState => commitProjectEdit(currentState, { ...currentState.project, background: { ...currentState.project.background, kind: 'photo', assetId, offsetX: .5, offsetY: .5 } }))
          return true
        } finally {
          decodeCount--
          if (ownedStore !== store) ownedStore.collect(new Set())
          collect()
        }
      } catch (error) {
        if (valid()) backgroundError = error.message || '背景照片加载失败，请重试'
        return false
      } finally {
        if (backgroundVersion === version) { backgroundBusy = false; if (mounted) publish({ ...state }) }
      }
    },
    removeSource(id) { editStart = null; queue?.cancel(id); update(removeCollageSource(state, id)); void buildInitial() },
    retrySource: id => processSource(id),
    correctSource(id, subject) { validateCutoutSubject(subject); return processSource(id, subject) },
    beginEdit() { if (!editStart) editStart = cloneCollageData({ project: state.project, sources: state.sources }) },
    previewProject(project) {
      if (JSON.stringify(project.background) !== JSON.stringify(state.project.background)) cancelBackground()
      if (!editStart) api.beginEdit()
      update({ ...state, project: cloneCollageData(project) })
    },
    cancelEdit() { if (editStart) { const previous = editStart; editStart = null; update({ ...state, project: previous.project }) } },
    commitProject(project) {
      if (JSON.stringify(project.background) !== JSON.stringify(state.project.background)) cancelBackground()
      const base = editStart ? { ...state, ...editStart } : state
      editStart = null
      update(commitProjectEdit(base, project, state.sources))
    },
    undo() {
      if (editStart) { api.cancelEdit(); return }
      if (!state.history.length) return
      queue?.cancelAll(); layoutWork = null; cancelBackground()
      update(undoProjectEdit(state))
      void buildInitial()
    },
    placeSource: append,
    async reLayout(options = {}) {
      const epoch = state.epoch, ownedQueue = queue
      try {
        await waitForFonts()
        if (!mounted || !active || state.epoch !== epoch || queue !== ownedQueue) return false
        initialLayout = true; layoutError = null; editStart = null
        const { freshTitle = false, ...layoutOptions } = options
        const elements = buildLayout(usableAssets(), { title: freshTitle ? themeTitle() : currentTitle() ?? themeTitle(), ink: collageInk(state.project.background, state.project.ink), ...layoutOptions })
        update(commitProjectEdit(state, { ...state.project, elements }, placedSources(elements)))
        return true
      } catch (error) {
        if (mounted && active && state.epoch === epoch && queue === ownedQueue) { layoutError = error.message; publish({ ...state }) }
        return false
      }
    },
    reset() {
      cancelBackground()
      queue?.dispose(); queue = null
      adding = false; files.clear(); versions.clear(); editStart = null
      initialLayout = false; layoutWork = null; layoutError = null
      if (assetStore) store.collect(new Set())
      else { store.dispose(); store = createStickerAssetStore() }
      update(createCollageState(state.epoch + 1))
      if (active && mounted) api.activate()
    },
  }
  return api
}

export function useCollageSession({ active, assetStore, request = requestCutout, buildLayout = createCollageLayout }) {
  // The caller keeps supplied store/request/layout identities stable for the
  // lifetime of the Studio; reset is the explicit way to replace owned data.
  const [session] = useState(() => createCollageSession({ assetStore, request, buildLayout }))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => {
    session.mount()
    return () => session.unmount()
  }, [session])
  useEffect(() => {
    if (active) session.activate()
    else session.deactivate()
    return () => session.deactivate()
  }, [active, session])
  return { state, status: session.getStatus(), assetStore: session.assetStore, loadBackground: session.loadBackground, addFiles: session.addFiles, removeSource: session.removeSource, retrySource: session.retrySource, correctSource: session.correctSource, commitProject: session.commitProject, undo: session.undo, reset: session.reset, getSourceFile: session.getSourceFile, getSourcePreview: session.getSourcePreview, beginEdit: session.beginEdit, previewProject: session.previewProject, cancelEdit: session.cancelEdit, placeSource: session.placeSource, reLayout: session.reLayout }
}
