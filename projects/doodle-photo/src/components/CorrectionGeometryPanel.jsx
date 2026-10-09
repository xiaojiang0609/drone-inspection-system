import { useId, useRef, useState } from 'react'
import { addCorrectionPoint, boxFromDrag, normalizedPointer, POINT_LIMITS, replaceCorrectionRegion } from '../utils/subject-correction'
function validContour(points) {
  return Array.isArray(points) && points.length >= 3 && points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value)))
}
export default function CorrectionGeometryPanel({ image, draft, onDraftChange, locked }) {
  const [tool, setTool] = useState('box')
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('在原图上调整主体范围和点位。')
  const [error, setError] = useState('')
  const stageRef = useRef(null)
  const dragRef = useRef(null)
  const regionId = useId()
  const instructionsId = useId()
  const geometry = draft.geometry
  const regionIndex = draft.regionIndex
  const region = geometry?.segmentation_regions[regionIndex]
  const manual = draft.manual[regionIndex] || { positive: false, negative: false }
  const ratio = (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1)
  const updateDraft = updater => onDraftChange(updater(draft))
  const stopDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    setPreview(null)
    if (drag && stageRef.current?.hasPointerCapture(drag.pointerId)) stageRef.current.releasePointerCapture(drag.pointerId)
  }

  const changeTool = value => {
    if (locked) return
    stopDrag(); setTool(value); setError('')
  }

  const changeRegion = value => {
    if (locked) return
    stopDrag()
    updateDraft(current => ({ ...current, regionIndex: value }))
    setError(''); setStatus(`已选择区域 ${value + 1}，其他区域会保留。`)
  }

  const updateRegion = (nextRegion, nextManual) => {
    updateDraft(current => ({
      ...current,
      geometry: replaceCorrectionRegion(current.geometry, current.regionIndex, nextRegion),
      manual: current.manual.map((value, index) => index === current.regionIndex ? nextManual : value),
      contours: [],
    }))
  }

  const addPoint = point => {
    if (!region || !point || locked) return
    const kind = tool === 'positive' ? 'positive_points' : 'negative_points'
    const flag = tool === 'positive' ? 'positive' : 'negative'
    const name = tool === 'positive' ? '主体点' : '背景点'
    const [x, y] = point, [y1, x1, y2, x2] = region.box_2d
    if (tool === 'positive' && (x < x1 || x > x2 || y < y1 || y > y2)) {
      setError('请在框内点选主体，或先重新框选。'); return
    }
    const otherKind = tool === 'positive' ? 'negative_points' : 'positive_points'
    if (region[otherKind].some(old => old[0] === x && old[1] === y)) {
      setError('这个位置已有另一类点位，请换一个位置。'); return
    }
    if (manual[flag] && region[kind].length >= POINT_LIMITS[kind]) {
      setError(`${name}最多 ${POINT_LIMITS[kind]} 个，可先撤销一个。`); return
    }
    const nextRegion = addCorrectionPoint(region, kind, point, !manual[flag])
    updateRegion(nextRegion, { ...manual, [flag]: true })
    setError(''); setStatus(`已添加${name}，当前 ${nextRegion[kind].length} 个。`)
  }

  const pointerDown = event => {
    if (locked || !region || event.button !== 0) return
    const point = normalizedPointer(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    if (!point) return
    event.preventDefault()
    if (tool !== 'box') { addPoint(point); return }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: point }
    setPreview({ start: point, end: point })
    setError('')
  }

  const pointerMove = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (locked) { stopDrag(); return }
    const end = normalizedPointer(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    if (end) setPreview({ start: drag.start, end })
  }

  const pointerUp = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const end = normalizedPointer(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    const box = boxFromDrag(drag.start, end)
    stopDrag()
    if (locked) return
    if (!box) { setError('范围太小，请拖出一个能包住主体的框。'); return }
    updateRegion({ box_2d: box, positive_points: [], negative_points: [] }, { positive: false, negative: false })
    setError(''); setStatus('范围已调整，旧点位已清除。可点选真实主体，再重新描边。')
  }

  const clearPoints = () => {
    if (locked || !region) return
    stopDrag()
    updateRegion({ ...region, positive_points: [], negative_points: [] }, { positive: false, negative: false })
    setError(''); setStatus('当前区域的点位已清除，其他区域会保留。')
  }

  const undoPoint = kind => {
    if (locked || !region || !region[kind].length) return
    const flag = kind === 'positive_points' ? 'positive' : 'negative'
    updateRegion({ ...region, [kind]: region[kind].slice(0, -1) }, { ...manual, [flag]: true })
    setError(''); setStatus(`已撤销最后一个${flag === 'positive' ? '主体点' : '背景点'}。`)
  }

  const shownBox = preview ? [
    Math.min(preview.start[1], preview.end[1]), Math.min(preview.start[0], preview.end[0]),
    Math.max(preview.start[1], preview.end[1]), Math.max(preview.start[0], preview.end[0]),
  ] : region?.box_2d
  const instruction = tool === 'box' ? '在原图上拖动，框住当前区域的真实主体。重新框选会清除该区域点位。'
    : tool === 'positive' ? '点选框内的真实主体，最多 4 个点。首次点选会替换当前主体点。'
      : '点选需要排除的背景或相邻物体，最多 8 个点。首次点选会替换当前背景点。'

  return <>
        {geometry?.segmentation_regions.length > 1 && <label className="flex items-center gap-2" htmlFor={regionId}>分割区域
          <select id={regionId} data-testid="correction-region" value={regionIndex} disabled={locked}
            className="rounded-lg border border-stone-200 bg-white px-2 py-2" onChange={event => changeRegion(Number(event.target.value))}>
            {geometry.segmentation_regions.map((_, index) => <option key={index} value={index}>区域 {index + 1}</option>)}
          </select>
        </label>}
<div className="mb-3 flex flex-wrap gap-2">
<button type="button" className="journal-button" disabled={locked || !geometry || geometry.segmentation_regions.length >= 8} data-testid="correction-add-region" onClick={() => {
 const regions = [...geometry.segmentation_regions, {box_2d:[100,100,900,900],positive_points:[],negative_points:[]}]
 onDraftChange({...draft, geometry:{box_2d:[Math.min(...regions.map(r=>r.box_2d[0])),Math.min(...regions.map(r=>r.box_2d[1])),Math.max(...regions.map(r=>r.box_2d[2])),Math.max(...regions.map(r=>r.box_2d[3]))],segmentation_regions:regions}, manual:[...draft.manual,{positive:false,negative:false}],regionIndex:regions.length-1,contours:[]})
}}>添加区域</button>
</div>      <div role="group" aria-label="纠错工具" className="mb-3 flex flex-wrap gap-2">
        {[[ 'box', '框选主体' ], [ 'positive', '点选主体' ], [ 'negative', '排除背景' ]].map(([value, label]) =>
          <button type="button" key={value} className="journal-button" aria-pressed={tool === value} disabled={locked || !region}
            data-testid={`correction-tool-${value}`} onClick={() => changeTool(value)}
            style={tool === value ? { background: '#efe7da', borderColor: '#9c8263', color: '#493d2f' } : undefined}>{label}</button>)}
        <button type="button" className="journal-button" disabled={locked || !region || !(region.positive_points.length || region.negative_points.length)}
          onClick={clearPoints} data-testid="correction-clear">清除点位</button>
        <button type="button" className="journal-button" disabled={locked || !region?.positive_points.length}
          onClick={() => undoPoint('positive_points')} data-testid="correction-undo-positive">撤销主体点</button>
        <button type="button" className="journal-button" disabled={locked || !region?.negative_points.length}
          onClick={() => undoPoint('negative_points')} data-testid="correction-undo-negative">撤销背景点</button>
      </div>
      <p id={instructionsId} className="mb-2 text-xs leading-relaxed text-stone-500">{instruction}</p>
      {!geometry && <p role="alert" className="mb-3 text-sm text-red-700">这个主体没有可用范围，请先重新分析照片。</p>}

      <div className="flex justify-center rounded-xl bg-stone-100 p-1">
        <div ref={stageRef} data-testid="correction-stage" onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={pointerUp} onPointerCancel={stopDrag} onLostPointerCapture={() => {
            if (dragRef.current) { dragRef.current = null; setPreview(null) }
          }} style={{ position: 'relative', width: `min(100%, ${54 * ratio}vh)`, touchAction: 'none', cursor: locked ? 'wait' : 'crosshair' }}>
          <img src={image.src} alt="用于纠错的原始照片" draggable="false" data-testid="correction-photo"
            style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, userSelect: 'none' }} />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" data-testid="correction-overlay"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {draft.contours.filter(validContour).map((points, index) => <polygon key={index}
              points={points.map(point => point.join(',')).join(' ')} fill="none" stroke="#fffaf1" strokeWidth="2.5"
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" style={{ filter: 'drop-shadow(0 1px 1px #211e1880)' }} />)}
            {geometry?.segmentation_regions.map((part, index) => {
              const box = index === regionIndex ? shownBox : part.box_2d
              if (!box) return null
              return <rect key={index} x={box[1]} y={box[0]} width={box[3] - box[1]} height={box[2] - box[0]}
                fill="none" stroke={index === regionIndex ? '#ffe3a8' : '#fffaf1'} strokeWidth={index === regionIndex ? 2 : 1}
                strokeDasharray="6 4" vectorEffect="non-scaling-stroke" opacity={index === regionIndex ? 1 : .5}
                style={{ filter: 'drop-shadow(0 1px 1px #211e1880)' }} />
            })}
          </svg>
          {region && [['positive_points', '#2f9e79', '主体点'], ['negative_points', '#d65454', '背景点']].flatMap(([kind, color, label]) =>
            region[kind].map(([x, y], index) => <span key={`${kind}-${index}`} title={`${label} ${index + 1}`}
              data-testid={`correction-${kind}-${index}`} style={{ position: 'absolute', left: `${x / 10}%`, top: `${y / 10}%`,
                transform: 'translate(-50%, -50%)', width: 18, height: 18, borderRadius: '50%', background: color,
                border: '2px solid white', color: 'white', fontSize: 10, lineHeight: '14px', textAlign: 'center',
                boxShadow: '0 1px 3px #211e1866', pointerEvents: 'none' }}>{index + 1}</span>))}
        </div>
      </div>

      {region && <p className="mt-2 text-xs leading-relaxed text-stone-500" data-testid="correction-point-summary">
        <span style={{ color: '#237d60' }}>主体点 {region.positive_points.length}/4（{manual.positive ? '手动标注' : '分析建议'}）</span>
        {' · '}<span style={{ color: '#b34141' }}>背景点 {region.negative_points.length}/8（{manual.negative ? '手动标注' : '分析建议'}）</span>
        {' · '}图中数字对应当前区域点位
      </p>}
      <div className="mt-3 min-h-6 text-sm">
        <p role="status" aria-live="polite" className="text-stone-600" data-testid="correction-geometry-status">{status}</p>
        {error && <p role="alert" className="mt-1 text-red-700" data-testid="correction-geometry-error">{error}</p>}
      </div>
  </>
}
