import { CUTOUT_CONCURRENCY } from './collage-config.js'

// Cancellation settles delivery immediately, but an in-flight worker keeps its
// slot until it exits so a worker ignoring AbortSignal cannot exceed the cap.
export function createCutoutQueue({ worker, concurrency = CUTOUT_CONCURRENCY }) {
  if (typeof worker !== 'function') throw new TypeError('worker is required')
  const limit = Math.max(1, Math.min(CUTOUT_CONCURRENCY, Math.floor(concurrency) || CUTOUT_CONCURRENCY))
  const pending = [], current = new Map()
  let active = 0, disposed = false
  const settle = (entry, result) => {
    if (entry.settled) return
    entry.settled = true
    entry.resolve(result)
  }
  const cancelEntry = entry => {
    entry.cancelled = true
    entry.controller.abort()
    settle(entry, { job: entry.job, cancelled: true })
    if (current.get(entry.job.sourceId) === entry) current.delete(entry.job.sourceId)
  }
  const pump = () => {
    while (!disposed && active < limit && pending.length) {
      const entry = pending.shift()
      if (entry.cancelled) continue
      active++
      let work
      try { work = worker(entry.job, { signal: entry.controller.signal }) } catch (error) { work = Promise.reject(error) }
      Promise.resolve(work).then(data => {
        if (!entry.cancelled && current.get(entry.job.sourceId) === entry) settle(entry, { job: entry.job, data, cancelled: false })
      }, error => {
        if (!entry.cancelled && current.get(entry.job.sourceId) === entry) settle(entry, { job: entry.job, error, cancelled: false })
      }).finally(() => {
        if (current.get(entry.job.sourceId) === entry) current.delete(entry.job.sourceId)
        active--
        pump()
      })
    }
  }
  const cancelAll = () => { for (const entry of current.values()) cancelEntry(entry); pending.length = 0 }
  return {
    enqueue(job) {
      if (!job || typeof job.sourceId !== 'string' || !Number.isInteger(job.version) || !Number.isInteger(job.epoch)) throw new TypeError('Queue job requires sourceId, version and epoch')
      if (disposed) return Promise.resolve({ job, cancelled: true })
      const old = current.get(job.sourceId)
      if (old) cancelEntry(old)
      let resolve
      const promise = new Promise(done => { resolve = done })
      const entry = { job: { ...job }, resolve, controller: new AbortController(), cancelled: false, settled: false }
      current.set(job.sourceId, entry); pending.push(entry); pump()
      return promise
    },
    cancel(sourceId) { const entry = current.get(sourceId); if (entry) cancelEntry(entry) },
    cancelAll,
    dispose() { disposed = true; cancelAll() },
  }
}
