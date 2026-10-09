import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCollageSession } from '../hooks/useCollageSession'
import { exportCollage } from '../utils/collage-renderer'
import { constrainCollageElement } from '../utils/collage-layout'
import { DOODLE_OPTIONS } from '../utils/doodle-catalog'
import CollageCanvas from './CollageCanvas'
import CollageSubjectCorrection from './CollageSubjectCorrection'

const rangeChangeKeys=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'])
const statusNames={preparing:'准备图片…',processing:'正在提取主体…',ready:'可用',failed:'提取失败',paused:'已暂停，可重试'}
export default function CollageStudio({ active }) {
 const session=useCollageSession({active})
 const {state,status,assetStore}=session,project=state.project
 const latest=useRef(state), correctionVersion=useRef(0), textEditing=useRef(null)
 useLayoutEffect(()=>{latest.current=state},[state])
 const [editVersion,setEditVersion]=useState(0)
 const [selectedId,setSelectedId]=useState(null),[tool,setTool]=useState('elements'),[doodle,setDoodle]=useState('sparkle')
 const [correction,setCorrection]=useState(null),[notice,setNotice]=useState(''),[exporting,setExporting]=useState(false),[preview,setPreview]=useState(false)
 const cancelSessionEdit=session.cancelEdit
 const closeCorrection=useCallback(()=>{correctionVersion.current++;setCorrection(null)},[])
 const edit=(transform,transient=false)=>{
  const next=transform(latest.current.project)
  latest.current={...latest.current,project:next}
  if(transient)session.previewProject(next)
  else session.commitProject(next)
 }
 const finish=()=>{textEditing.current=null;session.commitProject(latest.current.project)}
 const cancel=()=>{textEditing.current=null;session.cancelEdit()}
 const beginRangeKey=event=>{
  if(rangeChangeKeys.has(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey)session.beginEdit()
 }
 const finishRangeKey=event=>{if(rangeChangeKeys.has(event.key))finish()}
 useEffect(()=>{
  if(!active){correctionVersion.current++;cancelSessionEdit()}
 },[active,cancelSessionEdit])
 const selected=project.elements.find(e=>e.id===selectedId)
 const updateSelected=(changes,transient=false)=>edit(p=>({...p,elements:p.elements.map(e=>{
  if(e.id!==selectedId)return e
  return constrainCollageElement({...e,...(typeof changes==='function'?changes(e):changes)})
 })}),transient)
 const upload=async event=>{
  const files=[...event.target.files];event.target.value='';setNotice('')
  const result=await session.addFiles(files)
  if(result.errors.length)setNotice(result.errors.map(e=>`${e.file.name}：${e.reason}`).join('；'))
 }
 const openCorrection=async source=>{
  const file=session.getSourceFile(source.id),version=++correctionVersion.current
  if(!file){setNotice('原图暂不可用，请删除后重新添加。');return}
  try {
   const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
   let image
   try {
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0)
    image=new Image();image.src=canvas.toDataURL('image/png');await image.decode()
   } finally {bitmap.close()}
   if(version===correctionVersion.current)setCorrection({sourceId:source.id,image})
  } catch(reason){setNotice(reason.message || '原图打开失败，请重试。')}
 }
 const submitCorrection=async(id,subject)=>{
  await session.correctSource(id,subject)
  await new Promise(resolve=>setTimeout(resolve,0))
  const source=latest.current.sources[id]
  if(source?.status==='failed')throw new Error(source.error || '主体提取失败，请保留当前范围后重试。')
  if(source?.status!=='ready')throw new Error('处理已暂停，可返回素材卡重试。')
 }
 const addDecoration=type=>{
  const id=crypto.randomUUID(),icon=DOODLE_OPTIONS.find(d=>d.id===doodle)
  const e=type==='text'?{id,type,role:'caption',text:'把这一刻，贴进日记',x:500,y:850,width:360,height:70,fontSize:32,rotation:0,aspect:4/3}:{id,type:'doodle',icon:doodle,label:icon.label,x:500,y:500,width:90,height:67.5,rotation:0,aspect:4/3}
  edit(p=>({...p,elements:[...p.elements,e]}));setSelectedId(id);setTool('elements')
 }
 const exportImage=async()=>{
  setExporting(true);setNotice('')
  try {
   const blob=await exportCollage(latest.current.project,assetStore)
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='doodle-collage-1080x1440.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)
  } catch(reason){setNotice(`导出失败：${reason.message}，请重试。`)}
  finally {setExporting(false)}
 }
 const source=correction && state.sources[correction.sourceId]
 const summary=status.kind==='empty'?'添加照片，开始一页拼贴。':status.kind==='failed'?'没有可用贴纸，请重试或手动纠正主体。':status.kind==='paused'?'处理已暂停，请在素材卡重试。':`${status.ready} 张贴纸可用${status.busy?` · ${status.busy} 张处理中`:''}${status.failed?` · ${status.failed} 张失败，可重试`:''}${status.waiting?` · ${status.waiting} 张等待空位`:''}`
 return <section className="collage-studio" aria-label="贴纸拼贴工作室">
 <header className="collage-heading"><div><span className="collage-eyebrow">STICKER JOURNAL</span><h2>把喜欢的日常，贴成一页。</h2><p>主体贴纸、手写短句与小小线稿，收藏属于你的美好。</p></div><div className="collage-actions"><button className="journal-button" data-testid="collage-undo" disabled={!state.history.length} onClick={()=>{textEditing.current=null;session.undo();setEditVersion(n=>n+1)}}>撤销</button><button className="journal-button" onClick={()=>setPreview(p=>!p)} data-testid="collage-preview">{preview?'继续编辑':'查看作品'}</button><button className="collage-primary" data-testid="collage-export" disabled={exporting || !project.elements.length} onClick={exportImage}>{exporting?'正在导出…':'导出图片'}</button></div></header>
 <p className="collage-summary" role="status" data-testid="collage-status">{summary}</p>
 {(notice || status.layoutError || status.backgroundError) && <div className="collage-notice" role="alert">{notice || status.layoutError || status.backgroundError}<button className="journal-button" onClick={()=>setNotice('')}>收起提示</button></div>}
 <div className="collage-workspace">
 <aside className="collage-panel collage-sources"><div className="collage-row"><h3>照片素材</h3><span>{project.sourceIds.length}/16</span></div>
 <label className="collage-upload">＋ 添加照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-testid="collage-upload" onChange={upload}/></label><p className="collage-help">最多 16 张 · JPG / PNG / WebP · 每张 20 MiB</p>
 <div className="collage-source-list">{project.sourceIds.map(id=>{
 const s=state.sources[id],thumbnail=session.getSourcePreview(id)?.thumbnailUrl,sticker=project.elements.find(e=>e.sourceId===id)
 return <article key={id} className={`collage-source ${sticker?.id===selectedId?'is-selected':''}`} data-testid="collage-source" data-source-status={s.status}>
 <button className="collage-source-select" disabled={!sticker} onClick={()=>{setSelectedId(sticker.id);setTool('elements');setPreview(false)}} aria-label={`选择${s.name}`}>
 {thumbnail?<img src={thumbnail} alt={s.name}/>:<span>照片</span>}<span><strong>{s.name}</strong><small>{statusNames[s.status]}{s.assetId && s.status==='failed'?' · 保留上次结果':''}</small></span></button>
 {s.error && <p className="collage-source-error">{s.error}</p>}{s.placement==='waiting' && <p className="collage-help">等待空位，可重新排版。</p>}
 <div className="collage-source-actions"><button className="journal-button" disabled={['preparing','processing'].includes(s.status)} onClick={()=>openCorrection(s)}>纠正主体</button>{['failed','paused'].includes(s.status) && <button className="journal-button" onClick={()=>session.retrySource(id)}>重试</button>}{s.assetId && <button className="journal-button" onClick={()=>{if(!session.placeSource(id))setNotice('没有合适的空位，请移动元素或重新排版。')}}>再放一张</button>}<button className="journal-button" aria-label={`移除${s.name}`} onClick={()=>session.removeSource(id)}>移除</button></div>
 </article>})}</div>
 <button className="journal-button collage-relayout" disabled={!status.ready} data-testid="collage-relayout" onClick={()=>{cancel();session.reLayout()}}>重新排版</button><p className="collage-help">重新安排所有可用贴纸，保留你的标题。</p>
 </aside>
 <main className="collage-board"><div className="collage-board-bar"><span>3:4 竖版 · 1080 × 1440</span><div>{!preview && <><button className="journal-button" aria-pressed={tool==='elements'} onClick={()=>setTool('elements')}>移动元素</button><button className="journal-button" data-testid="collage-background-tool" disabled={project.background.kind!=='photo'} aria-pressed={tool==='background'} onClick={()=>setTool('background')}>移动背景</button></>}</div></div>
 <CollageCanvas project={project} assetStore={assetStore} selectedId={selectedId} onSelect={setSelectedId} editable={active && !preview} editVersion={editVersion} tool={tool} onEditBegin={session.beginEdit} onEditCancel={cancel} onElementsPreview={transform=>edit(transform,true)} onElementsCommit={finish} onBackgroundCommit={finish}/>
 <p className="collage-help">{preview?'作品预览 · 编辑控件不会出现在导出的图片中':tool==='background'?'拖动照片调整取景，贴纸位置会保留。':'拖动元素调整位置，选中后可以缩放、旋转和改文字。'}</p>
 </main>
 <aside className="collage-panel collage-tools"><h3>页面与装饰</h3>
 <label>背景<select aria-label="拼贴背景" data-testid="collage-background-kind" value={project.background.kind} onChange={event=>{const kind=event.target.value;if(kind==='photo')return;edit(p=>({...p,background:{kind,color:kind==='paper-light'?'#f7f2e7':'#343638',offsetX:.5,offsetY:.5}}));setTool('elements')}}><option value="paper-dark">深色纹理纸</option><option value="paper-light">浅色纹理纸</option><option value="solid">纯色</option>{project.background.kind==='photo' && <option value="photo">背景照片</option>}</select></label>
 {project.background.kind==='solid' && <label>纸面颜色<input type="color" aria-label="纸面颜色" value={project.background.color || '#343638'} onChange={event=>edit(p=>({...p,background:{...p.background,color:event.target.value}}))}/></label>}
 <label className="collage-upload">{status.backgroundBusy?'正在载入背景…':'＋ 上传背景照片'}<input type="file" accept="image/jpeg,image/png,image/webp" data-testid="collage-background-upload" onChange={event=>{const file=event.target.files[0];event.target.value='';if(file)session.loadBackground(file)}}/></label>
 <label>文字与线稿<select aria-label="线稿颜色" value={project.ink} onChange={event=>edit(p=>({...p,ink:event.target.value}))}><option value="auto">自动配色</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
 <hr/><button className="journal-button" onClick={()=>addDecoration('text')}>添加短句</button><label>手绘线稿<select aria-label="手绘线稿" value={doodle} onChange={event=>setDoodle(event.target.value)}>{DOODLE_OPTIONS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label><button className="journal-button" onClick={()=>addDecoration('doodle')}>添加线稿</button>
 {selected && !preview && <div className="collage-inspector"><h3>选中{selected.type==='imageSticker'?'贴纸':selected.type==='text'?'文字':'线稿'}</h3>
 {selected.type==='text' && <label>修改文字<textarea data-testid="collage-text" aria-label="修改拼贴文字" value={selected.text} onFocus={()=>{session.beginEdit();textEditing.current=selectedId}} onChange={event=>updateSelected({text:event.target.value},true)} onBlur={()=>{if(textEditing.current)finish()}} /></label>}
 <div className="collage-row">{[['缩小',.9],['放大',1.1]].map(([label,factor])=><button key={label} className="journal-button" onClick={()=>updateSelected(e=>({width:e.width*factor,height:e.height*factor,...(e.fontSize?{fontSize:e.fontSize*factor}:{})}))}>{label}</button>)}</div>
 <label>旋转 {Math.round(selected.rotation || 0)}°<input type="range" min="-180" max="180" value={selected.rotation || 0} aria-label="旋转拼贴元素" onPointerDown={session.beginEdit} onChange={event=>updateSelected({rotation:Number(event.target.value)},true)} onPointerUp={finish} onPointerCancel={cancel} onKeyDown={beginRangeKey} onKeyUp={finishRangeKey} onBlur={finish}/></label>
 {selected.type==='imageSticker' && <><label>白色描边<select aria-label="贴纸描边" value={selected.borderStyle || 'solid'} onChange={event=>updateSelected({borderStyle:event.target.value})}><option value="solid">实线</option><option value="dashed">虚线</option><option value="none">无描边</option></select></label><label>描边宽度 {selected.borderWidth ?? 6}px<input type="range" min="0" max="16" value={selected.borderWidth ?? 6} aria-label="描边宽度" onPointerDown={session.beginEdit} onChange={event=>updateSelected({borderWidth:Number(event.target.value)},true)} onPointerUp={finish} onPointerCancel={cancel} onKeyDown={beginRangeKey} onKeyUp={finishRangeKey} onBlur={finish}/></label></>}
 <div className="collage-row"><button className="journal-button" onClick={()=>edit(p=>({...p,elements:[...p.elements.filter(e=>e.id!==selectedId),...p.elements.filter(e=>e.id===selectedId)]}))}>置顶</button><button className="journal-button" onClick={()=>edit(p=>({...p,elements:[...p.elements.filter(e=>e.id===selectedId),...p.elements.filter(e=>e.id!==selectedId)]}))}>置底</button><button className="journal-button" onClick={()=>{edit(p=>({...p,elements:p.elements.filter(e=>e.id!==selectedId)}));setSelectedId(null)}}>删除</button></div>
 </div>}
 </aside></div>
 {active && source && correction && <CollageSubjectCorrection key={source.id} source={source} image={correction.image} initialSubject={source.subject} busy={source.status==='processing'} onSubmit={submitCorrection} onClose={closeCorrection}/>}</section>
}
