import { useEffect, useRef, useState } from 'react'
import { ensureFontLoaded } from '../utils/doodle'
import { drawJournal } from '../utils/journal'
import { DOODLE_OPTIONS } from '../utils/doodle-catalog'
import { constrainElementToImage } from '../utils/journal-layout'
import { resizeJournalTextElement } from '../utils/journal-text'
import { FONT_CN } from '../utils/fonts'

export default function CanvasEditor({ image, activeFilter, canvasRef, detections, elements, onElementsChange, editable, showOutline }) {
  const [selected, setSelected] = useState(null)
  const [text, setText] = useState('')
  const [doodle, setDoodle] = useState('camera')
  const baseRef = useRef(null)
  const sequence = useRef(0)
  const drag = useRef(null)
  const history = useRef([])
  useEffect(() => {
    const seq = ++sequence.current
    let cancelled = false
    const run = async () => {
      await ensureFontLoaded()
      if (cancelled || seq !== sequence.current || !canvasRef.current) return
      const width = image.naturalWidth, height = image.naturalHeight
      if (baseRef.current?.filter !== activeFilter || baseRef.current?.image !== image) {
        const base = document.createElement('canvas')
        base.width = width; base.height = height
        const context = base.getContext('2d')
        context.drawImage(image, 0, 0)
        if (activeFilter.apply) context.putImageData(activeFilter.apply(context.getImageData(0, 0, width, height)), 0, 0)
        baseRef.current = { canvas: base, image, filter: activeFilter }
      }
      const canvas = canvasRef.current
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(baseRef.current.canvas, 0, 0)
      drawJournal(ctx, width, height, detections, elements, showOutline)
    }
    run()
    return () => { cancelled = true }
  }, [image, activeFilter, canvasRef, detections, elements, showOutline])
  const remember = () => { history.current = [...history.current.slice(-19), structuredClone(elements)] }
  const measure = (value, fontSize) => {
    const ctx = canvasRef.current.getContext('2d')
    ctx.save(); ctx.font = `${fontSize}px ${FONT_CN}`
    const width = ctx.measureText(value).width
    ctx.restore(); return width
  }
  const update = (id, changes) => onElementsChange(elements.map(e => {
    if (e.id !== id) return e
    let next = { ...e, ...changes }
    if (Object.hasOwn(changes, 'text')) next = resizeJournalTextElement(next, measure)
    return constrainElementToImage(next)
  }))
  const selectedElement = elements.find(e => e.id === selected)
  const add = (type, icon) => {
    remember()
    const aspect = image.naturalHeight / image.naturalWidth
    const e = { id: crypto.randomUUID(), type, x: 500, y: 500, rotation: -2,
      width: type === 'note' ? 380 : type === 'stamp' ? 112 : 220,
      height: (type === 'note' ? 210 : type === 'stamp' ? 112 : 30) / aspect,
      text: text.trim() || '把这一刻，留在手账里', fontSize: 32, aspect }
    if (type === 'sparkle' || type === 'heart') Object.assign(e, {
      type: 'doodle', icon: type, width: 48, height: 48 / aspect, color: type === 'heart' ? '#f5d878' : '#fffaf1',
    })
    if (type === 'text') Object.assign(e, { width: 260 })
    if (type === 'bubble') Object.assign(e, { width: 340, fontSize: 34 })
    if (type === 'doodle') Object.assign(e, { icon, width: 86, height: 86 / aspect,
      label: DOODLE_OPTIONS.find(option => option.id === icon)?.label, color: '#fffaf1' })
    onElementsChange([...elements, constrainElementToImage(resizeJournalTextElement(e, measure))]); setSelected(e.id); setText('')
  }
  return <div>
    <div className="flex justify-center">
      <div style={{ position: 'relative', width: `min(100%, ${900 * image.naturalWidth / image.naturalHeight}px)` }}>
        <canvas ref={canvasRef} className="rounded-xl shadow-lg" style={{ width: '100%', height: 'auto', display: 'block' }} />
        {editable && <div style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
          onPointerDown={e => { if (e.target === e.currentTarget) setSelected(null) }}
          onPointerMove={e => {
            if (!drag.current) return
            const rect = canvasRef.current.getBoundingClientRect(), origin = drag.current
            const x = origin.x + (e.clientX - origin.clientX) / rect.width * 1000
            const y = origin.y + (e.clientY - origin.clientY) / rect.height * 1000
            onElementsChange(elements.map(el => el.id === origin.id ? constrainElementToImage({ ...el, x, y }) : el))
          }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
          {elements.filter(el => el.type !== 'arrow').map(el => <button key={el.id} aria-label={`移动${el.type === 'note' ? '纸框' : el.type === 'bubble' ? '气泡' : el.type === 'text' ? '手写标注' : el.type === 'stamp' ? '邮戳' : el.label || DOODLE_OPTIONS.find(option => option.id === el.icon)?.label || '装饰'}`}
            onPointerDown={event => {
              event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
              remember(); setSelected(el.id)
              drag.current = { id: el.id, x: el.x, y: el.y, clientX: event.clientX, clientY: event.clientY }
            }} style={{ position: 'absolute', left: `${(el.x - el.width / 2) / 10}%`, top: `${(el.y - el.height / 2) / 10}%`,
              width: `${el.width / 10}%`, height: `${el.height / 10}%`, transform: `rotate(${el.rotation || 0}deg)`,
              background: 'transparent', border: 'none', outline: selected === el.id ? '1.5px dashed #9c8263' : 'none',
              outlineOffset: 4, cursor: 'grab', borderRadius: 2 }} />)}
        </div>}
      </div>
    </div>
    {editable && <div className="mt-4 rounded-xl border border-stone-200 bg-white/80 p-4 space-y-3">
      <p className="text-xs text-stone-500">拖动文字与装饰调整位置，箭头随标注移动 · 点击元素后可缩放、旋转或删除</p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="手账文案" placeholder="写一句手账文案…" value={text} onChange={e => setText(e.target.value)}
          className="border border-stone-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-32" />
        <button className="journal-button" onClick={() => add('bubble')}>添加气泡</button>
        <button className="journal-button" onClick={() => add('text')}>添加手写文字</button>
        <button className="journal-button" onClick={() => add('note')}>添加纸框</button>
        <button className="journal-button" onClick={() => add('sparkle')}>添加星光</button>
        <button className="journal-button" onClick={() => add('heart')}>添加爱心</button>
        <select aria-label="手绘元素" value={doodle} onChange={e => setDoodle(e.target.value)}
          className="border border-stone-200 rounded-lg px-2 py-2 text-sm text-stone-600">
          {DOODLE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button className="journal-button" onClick={() => add('doodle', doodle)}>添加手绘元素</button>
        <button className="journal-button" onClick={() => add('stamp')}>添加邮戳</button>
        <button className="journal-button" onClick={() => add('tape')}>添加胶带</button>
        <button className="journal-button" onClick={() => { const previous = history.current.pop(); if (previous) { onElementsChange(previous); setSelected(null) } }}>撤销</button>
      </div>
      {selectedElement && <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-stone-500">选中元素</span>
        {[['缩小', .9], ['放大', 1.1]].map(([label, scale]) => <button className="journal-button" key={label} onClick={() => {
          const minWidth = selectedElement.type === 'doodle' ? 12 : 40
          const newWidth = Math.max(minWidth, Math.min(650, selectedElement.width * scale)), ratio = newWidth / selectedElement.width
          remember(); update(selected, { width: newWidth, height: selectedElement.height * ratio, fontSize: (selectedElement.fontSize || 32) * ratio })
        }}>{label}</button>)}
        <button className="journal-button" onClick={() => { remember(); update(selected, { rotation: (selectedElement.rotation || 0) + 5 }) }}>旋转</button>
        <button className="journal-button" onClick={() => { remember(); onElementsChange(elements.filter(e => e.id !== selected && e.labelId !== selected)); setSelected(null) }}>删除</button>
        {['note', 'text', 'bubble'].includes(selectedElement.type) && <input aria-label="修改标注文字" className="border border-stone-200 rounded-lg px-3 py-2 text-sm"
          value={selectedElement.text} onFocus={remember} onChange={e => update(selected, { text: e.target.value })} />}
      </div>}
    </div>}
  </div>
}
