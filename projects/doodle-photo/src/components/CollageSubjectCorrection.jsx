import { useEffect, useId, useRef, useState } from 'react'
import CorrectionGeometryPanel from './CorrectionGeometryPanel'
import { correctionManualFlags, createCorrectionGeometry } from '../utils/subject-correction'

export default function CollageSubjectCorrection({ source, image, initialSubject, busy, onSubmit, onClose }) {
 const [draft, setDraft] = useState(() => {
  const subject = initialSubject || {label:'主体',box_2d:[100,100,900,900]}
  const geometry = createCorrectionGeometry(subject)
  return {geometry,label:subject.label || '主体',contours:[],manual:correctionManualFlags(subject,geometry.segmentation_regions.length),regionIndex:0}
 })
 const [sending, setSending] = useState(false)
 const [status, setStatus] = useState('框住想保留的主体，必要时补充点位。')
 const dialog = useRef(null), title = useId()
 useEffect(() => {
  const focus = document.activeElement, overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.current.querySelector('button')?.focus()
  const key = event => {
   if(event.key === 'Escape') {event.preventDefault();onClose()}
   if(event.key !== 'Tab') return
   const items = [...dialog.current.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]')]
   const first=items[0],last=items.at(-1)
   if(event.shiftKey && (document.activeElement===first || !dialog.current.contains(document.activeElement))) {event.preventDefault();last?.focus()}
   else if(!event.shiftKey && (document.activeElement===last || !dialog.current.contains(document.activeElement))) {event.preventDefault();first?.focus()}
  }
  document.addEventListener('keydown',key)
  return ()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);if(focus?.isConnected)focus.focus()}
 },[onClose])
 const submit = async () => {
  setSending(true);setStatus('正在更新主体…')
  try {
   await onSubmit(source.id,{...draft.geometry,label:draft.label,manual_hint_regions:draft.manual.map(f=>({...f}))})
   setStatus('主体已更新，请查看拼贴效果。')
  } catch(error) {setStatus(error.message || '更新失败，请重试。')}
  finally {setSending(false)}
 }
 return <div className="collage-modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose()}}>
 <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={title} className="collage-modal" data-testid="collage-correction-dialog">
 <header className="collage-row"><div><h2 id={title}>纠正主体</h2><p>{source.name}</p></div><button className="journal-button" data-testid="correction-close" onClick={onClose}>关闭</button></header>
 <CorrectionGeometryPanel image={image} draft={draft} onDraftChange={setDraft} locked={busy || sending} />
 <p role="status" data-testid="collage-correction-status">{status}</p>
 <button className="journal-button" disabled={busy || sending} data-testid="collage-correction-submit" onClick={submit}>应用主体范围</button>
 {(busy || sending) && <p>关闭后仍会继续处理，完成后自动应用。</p>}
 </section></div>
}
