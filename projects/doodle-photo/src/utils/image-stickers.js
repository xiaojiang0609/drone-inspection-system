import { MAX_IMAGE_PIXELS } from './collage-config.js'

async function browserDecode(src) {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

// Decoded images and mutable rendering caches live outside project/history data.
export function createStickerAssetStore({ decodeImage = browserDecode, revokeUrl = url => URL.revokeObjectURL(url), idFactory = () => crypto.randomUUID() } = {}) {
  const records = new Map()
  const lifecycle = new WeakMap()
  let disposed = false
  const release = record => {
    const state = lifecycle.get(record)
    if (state.released || state.pins) return
    state.released = true
    record.image.close?.()
    if (record.src.startsWith('blob:')) revokeUrl(record.src)
    record.borderCache.clear()
  }
  return {
    async load({ src, sourceId, meta = {} }) {
      if (disposed) throw new Error('Asset store disposed')
      let image
      try {
        image = await decodeImage(src)
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height
        if (disposed) throw new Error('Asset store disposed')
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) throw new Error('Decoded image has invalid pixel dimensions')
        const assetId = idFactory()
        if (records.has(assetId)) throw new Error('Duplicate asset ID')
        const record = { assetId, sourceId, src, width, height, image, meta: structuredClone(meta), ready: Promise.resolve(image), borderCache: new Map() }
        lifecycle.set(record, { pins: 0, retired: false, released: false })
        records.set(assetId, record)
        return assetId
      } catch (error) {
        image?.close?.()
        if (typeof src === 'string' && src.startsWith('blob:')) revokeUrl(src)
        throw error
      }
    },
    get(assetId) { return records.get(assetId) },
    collect(liveIds) {
      for (const [id, record] of records) if (!liveIds.has(id)) {
        records.delete(id); lifecycle.get(record).retired = true; release(record)
      }
    },
    // Pin synchronous records before export awaits fonts. Collection can remove
    // them from the store, but image.close/URL revocation waits for release.
    retain(assetIds) {
      const captured = new Map()
      for (const id of new Set(assetIds)) {
        const record = records.get(id)
        if (!record) throw new Error(`Missing image asset: ${id}`)
        captured.set(id, record)
      }
      for (const record of captured.values()) lifecycle.get(record).pins++
      let done = false
      return { get: id => captured.get(id), release() {
        if (done) return
        done = true
        for (const record of captured.values()) { const state = lifecycle.get(record); state.pins--; if (state.retired) release(record) }
      } }
    },
    dispose() {
      disposed = true
      for (const record of records.values()) { lifecycle.get(record).retired = true; release(record) }
      records.clear()
    },
  }
}
