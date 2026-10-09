import { COLLAGE_ASPECT, COLLAGE_COLORS, COLLAGE_HISTORY_LIMIT } from './collage-config.js'
import { constrainCollageElement } from './collage-layout.js'

// Keep browser objects, Files, promises and mutable caches out of every snapshot.
export function cloneCollageData(value) {
  const visit = item => {
    if (item === null || item === undefined || ['string', 'boolean'].includes(typeof item)) return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (Array.isArray(item)) { item.forEach(visit); return }
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) { Object.values(item).forEach(visit); return }
    throw new TypeError('Collage snapshots must contain ordinary plain data')
  }
  visit(value)
  return structuredClone(value)
}

export function createCollageState(epoch = 0) {
  return { project: { sourceIds: [], elements: [], background: { kind: 'paper-dark', color: COLLAGE_COLORS.dark, offsetX: .5, offsetY: .5 }, ink: 'auto' }, history: [], sources: {}, epoch }
}

export function commitProjectEdit(state, nextProject, nextSources = state.sources) {
  const project = cloneCollageData(nextProject), sources = cloneCollageData(nextSources)
  if (JSON.stringify(project) === JSON.stringify(state.project) && JSON.stringify(sources) === JSON.stringify(state.sources)) return state
  return { ...state, project, sources, history: [...state.history, cloneCollageData({ project: state.project, sources: state.sources })].slice(-COLLAGE_HISTORY_LIMIT) }
}

export function undoProjectEdit(state) {
  if (!state.history.length) return state
  const previous = cloneCollageData(state.history.at(-1))
  // Historical jobs are never resumed. Advancing epoch rejects even a source
  // removed and later restored while its older decoder is still in flight.
  for (const source of Object.values(previous.sources)) {
    source.version = Math.max(source.version, state.sources[source.id]?.version || 0) + 1
    if (['preparing', 'processing', 'paused'].includes(source.status)) source.status = source.assetId ? 'ready' : 'paused'
  }
  return { ...state, ...previous, history: state.history.slice(0, -1), epoch: state.epoch + 1 }
}

export function collectReferencedSourceIds(state) {
  const ids = new Set()
  for (const snapshot of [state, ...state.history]) {
    snapshot.project.sourceIds.forEach(id => ids.add(id))
    Object.keys(snapshot.sources).forEach(id => ids.add(id))
    snapshot.project.elements.forEach(element => { if (element.sourceId) ids.add(element.sourceId) })
  }
  return ids
}

export function collectReferencedAssetIds(state) {
  const ids = new Set()
  for (const snapshot of [state, ...state.history]) {
    if (snapshot.project.background.assetId) ids.add(snapshot.project.background.assetId)
    snapshot.project.elements.forEach(element => { if (element.assetId) ids.add(element.assetId) })
    Object.values(snapshot.sources).forEach(source => { if (source.assetId) ids.add(source.assetId) })
  }
  return ids
}

export function isCurrentCutout(state, { sourceId, version, epoch }) {
  return state.epoch === epoch && state.sources[sourceId]?.version === version
}

export function removeCollageSource(state, sourceId) {
  if (!state.sources[sourceId]) return state
  const sources = { ...state.sources }
  delete sources[sourceId]
  return commitProjectEdit(state, { ...state.project, sourceIds: state.project.sourceIds.filter(id => id !== sourceId), elements: state.project.elements.filter(element => element.sourceId !== sourceId) }, sources)
}

export function replaceCollageAsset(state, sourceId, asset, metadata = {}) {
  if (!state.sources[sourceId]) return state
  const elements = state.project.elements.map(element => element.type === 'imageSticker' && element.sourceId === sourceId
    ? constrainCollageElement({ ...element, assetId: asset.assetId, height: element.width * asset.height / asset.width / COLLAGE_ASPECT })
    : element)
  const sources = { ...state.sources, [sourceId]: { ...state.sources[sourceId], ...cloneCollageData(metadata), assetId: asset.assetId, status: 'ready', error: undefined } }
  return commitProjectEdit(state, { ...state.project, elements }, sources)
}
