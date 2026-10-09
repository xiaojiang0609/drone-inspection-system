import { useEffect, useRef, useState } from 'react'
import { drawCollage } from '../utils/collage-renderer'
import { ensureFontLoaded } from '../utils/fonts'
import { constrainCollageElement } from '../utils/collage-layout'
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export default function CollageCanvas({ project, assetStore, selectedId, onSelect, onElementsPreview, onElementsCommit, onBackgroundCommit, editable, editVersion = 0, tool = 'elements', onEditBegin, onEditCancel }) {
 const canvas = useRef(null), stage = useRef(null), drag = useRef(null)
 const [error, setError] = useState(''), [retry, setRetry] = useState(0)
 useEffect(() => {
  let cancelled = false
  const render = async () => {
   try {
    await ensureFontLoaded()
    await document.fonts?.ready
    const ids = project.elements.filter(e=>e.type==='imageSticker').map(e=>e.assetId)
    if(project.background.kind==='photo')ids.push(project.background.assetId)
    await Promise.all(ids.map(id=>assetStore.get(id)?.ready))
    if(cancelled)return
    drawCollage(canvas.current.getContext('2d'),project,assetStore)
    setError('')
   } catch(reason) {if(!cancelled)setError(reason.message || '预览失败，请重试')}
  }
  render()
  return ()=>{cancelled=true}
 },[project,assetStore,retry])
 useEffect(()=>{drag.current=null},[editVersion,editable,tool])
 const begin = (event, element, kind = 'move') => {
  if(!editable || event.button!==0)return
  // Finish a focused text edit before the pointer gesture captures its baseline.
  if(document.activeElement?.matches('textarea, input[type=text]'))document.activeElement.blur()
  event.preventDefault();event.stopPropagation()
  if(tool==='background' && project.background.kind!=='photo')return
  const rect=stage.current.getBoundingClientRect()
  event.currentTarget.setPointerCapture(event.pointerId)
  onEditBegin?.()
  if(element)onSelect(element.id)
  else onSelect(null)
  const bg = project.background, record = assetStore.get(bg.assetId)
  const scale = record ? Math.max(1080/record.width,1440/record.height) : 0
  drag.current={pointerId:event.pointerId,kind:tool==='background'?'background':kind,id:element?.id,clientX:event.clientX,clientY:event.clientY,rect,x:element?.x,y:element?.y,width:element?.width,height:element?.height,fontSize:element?.fontSize,offsetX:bg.offsetX ?? .5,offsetY:bg.offsetY ?? .5,excessX:record?record.width*scale-1080:0,excessY:record?record.height*scale-1440:0}
 }
 const move = event => {
  const d=drag.current
  if(!d || d.pointerId!==event.pointerId)return
  if(!editable){drag.current=null;onEditCancel?.();return}
  const dx=(event.clientX-d.clientX)/d.rect.width*1000,dy=(event.clientY-d.clientY)/d.rect.height*1000
  if(d.kind==='background') {
   const offsetX=d.excessX>0?clamp(d.offsetX-dx*1.08/d.excessX,0,1):d.offsetX
   const offsetY=d.excessY>0?clamp(d.offsetY-dy*1.44/d.excessY,0,1):d.offsetY
   onElementsPreview(p=>({...p,background:{...p.background,offsetX,offsetY}}))
  } else onElementsPreview(p=>({...p,elements:p.elements.map(e=>{
   if(e.id!==d.id)return e
   if(d.kind==='resize') {
    const factor=clamp(1+dx/d.width,.15,5)
    const geometry=constrainCollageElement({...e,width:d.width*factor,height:e.height*(d.width*factor/e.width),...(d.fontSize?{fontSize:d.fontSize*factor}:{})})
    return {...e,x:geometry.x,y:geometry.y,width:geometry.width,height:geometry.height,...(d.fontSize?{fontSize:geometry.fontSize}:{})}
   }
   const geometry=constrainCollageElement({...e,x:d.x+dx,y:d.y+dy})
   return {...e,x:geometry.x,y:geometry.y}
  })}))
 }
 const end = event => {
  const d=drag.current
  if(!d || d.pointerId!==event.pointerId)return
  move(event);drag.current=null
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
  if(d.kind==='background')onBackgroundCommit()
  else onElementsCommit()
 }
 const cancel = () => {if(drag.current){drag.current=null;onEditCancel?.()}}
 return <div>
 <div ref={stage} className={`collage-stage ${tool==='background'?'collage-background-drag':''}`} data-testid="collage-canvas" data-offset-x={project.background.offsetX} data-offset-y={project.background.offsetY} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>
 <canvas ref={canvas} width="1080" height="1440" aria-label="拼贴作品预览" />
 <div className="collage-hit-layer" onPointerDown={event=>{if(event.target===event.currentTarget){if(tool==='background')begin(event,null);else onSelect(null)}}}>
 {editable && tool==='elements' && project.elements.map(e=><button type="button" key={e.id} className={`collage-element ${selectedId===e.id?'is-selected':''}`} aria-label={`移动${e.type==='imageSticker'?'贴纸':e.type==='text'?'文字':e.label || '手绘装饰'}`} data-testid="collage-element" data-element-type={e.type} data-element-role={e.role} data-text={e.text} data-x={e.x} data-y={e.y} data-element-id={e.id} data-asset-id={e.assetId} onFocus={()=>onSelect(e.id)} onPointerDown={event=>begin(event,e)} onClick={()=>onSelect(e.id)} style={{left:`${e.x/10}%`,top:`${e.y/10}%`,width:`${e.width/10}%`,height:`${e.height/10}%`,transform:`translate(-50%,-50%) rotate(${e.rotation || 0}deg)`}} />)}
 {editable && tool==='elements' && project.elements.filter(e=>e.id===selectedId).map(e=><button type="button" key={e.id} className="collage-resize" aria-label="拖动等比缩放" onPointerDown={event=>begin(event,e,'resize')} style={{left:`${(e.x+e.width/2)/10}%`,top:`${(e.y+e.height/2)/10}%`}}>↔</button>)}
 </div></div>
 {error && <div role="alert" className="collage-notice">预览暂不可用：{error}<button className="journal-button" onClick={()=>setRetry(n=>n+1)}>重试预览</button></div>}
 </div>
}
