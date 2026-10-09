import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { correctionManualFlags, createCorrectionGeometry } from '../utils/subject-correction'
import CorrectionGeometryPanel from './CorrectionGeometryPanel'

function makeDraft(detection) {
  const geometry = createCorrectionGeometry(detection)
  return {
    geometry,
    label: detection?.label || '',
    contours: Array.isArray(detection?.shape_contours) && detection.shape_contours.length
      ? detection.shape_contours : [detection?.shape_points],
    manual: correctionManualFlags(detection, geometry?.segmentation_regions.length || 0),
    regionIndex: 0,
  }
}

function validContour(points) {
  return Array.isArray(points) && points.length >= 3 && points.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value)))
}

function CorrectionDialog({ image, detections, busy, disabled, onSegment, onRefine, onClose }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState(null)
  const [status, setStatus] = useState('先选主体，再在原图上调整范围或点位。')
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const titleId = useId()
  const instructionsId = useId()
  const subjectId = useId()
  const draft = drafts[selectedIndex] || makeDraft(detections[selectedIndex])
  const geometry = draft.geometry
  const regionIndex = draft.regionIndex
  const region = geometry?.segmentation_regions[regionIndex]
  const manual = draft.manual[regionIndex] || { positive: false, negative: false }
  const locked = busy || disabled || Boolean(sending)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector('select, button')?.focus()
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [onClose])

  const updateDraft = updater => {
    setDrafts(previous => ({
      ...previous,
      [selectedIndex]: updater(previous[selectedIndex] || makeDraft(detections[selectedIndex])),
    }))
  }

  const submit = async action => {
    if (locked || !geometry || !region) return
    const callback = action === 'segment' ? onSegment : onRefine
    if (!callback) { setError('主体纠错暂不可用，请稍后重试。'); return }
    setSending(action); setError('')
    setStatus(action === 'segment' ? '正在重新描边…' : '正在局部放大复核…')
    const index = selectedIndex, selectedRegion = regionIndex
    try {
      const result = await callback(index, {
        ...geometry,
        manual_hints: { positive: manual.positive, negative: manual.negative },
        manual_hint_regions: draft.manual.map(flags => ({ ...flags })),
      }, selectedRegion)
      const adopted = makeDraft(result)
      if (!result || !adopted.geometry) throw new Error('主体范围未能更新，请重试。')
      adopted.regionIndex = Math.min(selectedRegion, adopted.geometry.segmentation_regions.length - 1)
      setDrafts(previous => ({ ...previous, [index]: adopted }))
      const hasContour = adopted.contours.some(validContour)
      setStatus(hasContour
        ? result.outline_status === 'partial' ? '主体已更新，部分区域还没有可靠描边，可继续补充点位。' : '主体已更新，请查看白色描边是否贴合。'
        : '主体范围已更新，暂未得到可靠描边。可补充点位后再试。')
    } catch (reason) {
      setStatus('')
      setError(reason?.message || '纠错失败，请保留当前范围和点位后重试。')
    } finally {
      setSending(null)
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-3 sm:p-6"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={instructionsId}
      data-testid="subject-correction-dialog" className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-stone-800">纠正主体</h2>
          <p className="mt-1 text-sm text-stone-500">在原图上调整，让白色描边贴合真实主体。</p>
        </div>
        <button type="button" className="journal-button" onClick={onClose} data-testid="correction-close">关闭</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-stone-600">
        <label className="flex items-center gap-2" htmlFor={subjectId}>纠错主体
          <select id={subjectId} data-testid="correction-subject" value={selectedIndex} disabled={locked}
            className="rounded-lg border border-stone-200 bg-white px-2 py-2" onChange={event => {
              setSelectedIndex(Number(event.target.value)); setError(''); setStatus('已切换主体，之前的范围和点位会保留。')
            }}>
            {detections.map((detection, index) => <option key={index} value={index}>{drafts[index]?.label || detection.label || `主体 ${index + 1}`}</option>)}
          </select>
        </label>
      </div>
      <CorrectionGeometryPanel key={selectedIndex} image={image} draft={draft} locked={locked} onDraftChange={next => updateDraft(() => next)} />
      <div className="mt-3 min-h-6 text-sm">
        <p id={instructionsId} role="status" aria-live="polite" data-testid="correction-status">{status}</p>
        {error && <p role="alert" data-testid="correction-error">{error}</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-stone-100 pt-4">
        <div>
          <button type="button" className="journal-button" disabled={locked || !geometry || !onSegment} onClick={() => submit('segment')}
            data-testid="correction-segment">{sending === 'segment' ? '正在描边…' : '重新描边'}</button>
          <p className="mt-1 text-xs text-stone-500">使用当前范围和点位，不增加 AI 图片分析。</p>
        </div>
        <div>
          <button type="button" className="journal-button" disabled={locked || !geometry || !onRefine} onClick={() => submit('refine')}
            data-testid="correction-refine">{sending === 'refine' ? '正在复核…' : '局部放大复核'}</button>
          <p className="mt-1 text-xs text-stone-500">放大检查当前区域，会额外进行 1 次 AI 图片分析。</p>
        </div>
      </div>
      {(busy || sending) && <p className="mt-3 text-xs text-stone-500">关闭后仍会继续处理，完成后自动应用。</p>}
    </section>
  </div>
}

export default function SubjectCorrection({ image, detections = [], busy = false, disabled = false, onSegment, onRefine }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  if (!image) return null
  return <div>
    <button type="button" className="journal-button" disabled={busy || disabled || !detections.length}
      onClick={() => setOpen(true)} data-testid="subject-correction-open">纠正主体</button>
    {open && <CorrectionDialog key={image.src} image={image} detections={detections} busy={busy} disabled={disabled}
      onSegment={onSegment} onRefine={onRefine} onClose={close} />}
  </div>
}
