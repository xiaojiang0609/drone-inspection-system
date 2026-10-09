import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const path = name => fileURLToPath(new URL(name, import.meta.url))
const fixture = name => path('collage-fixtures/' + name)
const url = () => process.env.COLLAGE_URL || 'http://127.0.0.1:8879/'
const settle = page => page.waitForFunction(() => [...document.querySelectorAll('[data-testid="collage-source"]')].every(e => !['preparing','processing'].includes(e.dataset.sourceStatus)))
const fresh = async page => { await page.goto(url()); await page.getByTestId('mode-collage').click() }
const ready = async (page, count) => { await settle(page); await page.waitForFunction(n => document.querySelectorAll('[data-element-type="imageSticker"]').length === n, count) }
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

// Decode the PNG independently into real browser RGBA pixels. Encoding bytes
// alone cannot establish visible equality (different PNG encoders are valid).
async function decodedEquality(page, preview, downloaded) {
 return page.evaluate(async ({preview,downloaded}) => {
  const decode = async src => { const image = new Image(); image.src = 'data:image/png;base64,'+src; await image.decode(); const c=document.createElement('canvas'); c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0); return {width:c.width,height:c.height,pixels:c.getContext('2d').getImageData(0,0,c.width,c.height).data} }
  const a=await decode(preview),b=await decode(downloaded);let different=0,maxDelta=0
  for(let i=0;i<a.pixels.length;i++){const d=Math.abs(a.pixels[i]-b.pixels[i]);if(d)different++;maxDelta=Math.max(maxDelta,d)}
  return {width:b.width,height:b.height,differentChannels:different,maxDelta}
 },{preview,downloaded})
}
async function downloadEqual(page, name) {
 await page.evaluate(() => document.fonts.ready);await frames(page)
 const preview=await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1])
 const pending=page.waitForEvent('download');await page.getByTestId('collage-export').click();const download=await pending
 await download.saveAs(path(name));const metrics=await decodedEquality(page,preview,(await readFile(path(name))).toString('base64'))
 assert.deepEqual(metrics,{width:1080,height:1440,differentChannels:0,maxDelta:0})
 return metrics
}

export async function verifyMatrix(browser) {
 const page=await browser.newPage({viewport:{width:1200,height:1100},acceptDownloads:true})
 const errors=[],requests=[],holds=[];let failNames=new Set(),hold=false,retryAttempts=0,distinguishRetry=false
 const png=await readFile(fixture('hole-fragments.png'))
 const oldPng=await readFile(fixture('cutout.png'))
 page.on('pageerror',e=>errors.push(e.message))
 // Route every API before the first upload; no unexpected endpoint falls through.
 await page.route('**/api/**',async route=>{
  assert.equal(new URL(route.request().url()).pathname,'/api/cutout')
  const body=route.request().postDataBuffer().toString('utf8'),name=body.match(/filename="([^"]+)"/)?.[1]
  requests.push(name)
  const attempt=distinguishRetry?++retryAttempts:0,obsolete=attempt===1
  const image=obsolete?oldPng:png,width=obsolete?110:160,height=obsolete?85:120
  const label=attempt?(obsolete?'obsolete-attempt':'new-retry-attempt'):'技术测试主体'
  const caption=attempt?(obsolete?'旧的过期结果':'新的重试结果'):'透明孔洞与分离部分'
  if(hold)await new Promise(resolve=>{resolve.fileName=name;holds.push(resolve)})
  try { if(failNames.has(name))await route.fulfill({status:422,json:{detail:'Controlled unavailable subject'}})
   else await route.fulfill({json:{status:'success',data:{image:'data:image/png;base64,'+image.toString('base64'),width,height,original_width:180,original_height:120,subject:{label,box_2d:[100,100,900,900],segmentation_regions:[{box_2d:[100,100,900,900],positive_points:[[500,500]],negative_points:[]}]},crop_box:[0,0,width,height],caption,theme:'其他',emotion:'平静',quality:[{outline_ready:true}],contours:[]}}})
  }catch(e){if(!/closed|cancel|invalid|intercept|handled/i.test(e.message))throw e}
 })
 const upload=files=>page.getByTestId('collage-upload').setInputFiles(files)
 const payload=async(name,source='source-1.png')=>({name,mimeType:'image/png',buffer:await readFile(fixture(source))})
 const results={}
 try {
  await fresh(page)
  failNames=new Set(['slot-16.png'])
  await upload(await Promise.all(Array.from({length:16},(_,i)=>payload(`slot-${i+1}.png`))))
  await ready(page,15)
  assert.equal(await page.getByTestId('collage-source').count(),16)
  assert.equal(await page.locator('[data-source-status="failed"]').count(),1)
  const calls=requests.length;await upload(await payload('seventeenth.png'))
  await page.getByRole('alert').filter({hasText:'最多添加 16'}).waitFor()
  assert.equal(await page.getByTestId('collage-source').count(),16);assert.equal(requests.length,calls)
  await page.getByTestId('collage-background-upload').setInputFiles(fixture('landscape.png'))
  await page.waitForFunction(()=>document.querySelector('[data-testid="collage-background-kind"]').value==='photo')
  assert.equal(await page.getByTestId('collage-source').count(),16,'background has a separate slot')
  await page.screenshot({path:path('sticker-collage-16-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:path('sticker-collage-16-mobile.png'),fullPage:true})
  await page.getByRole('button',{name:'移除slot-16.png',exact:true}).click()
  failNames.clear();await upload(await payload('replacement.png'));await ready(page,16)
  assert.equal(await page.getByTestId('collage-source').count(),16)
  await page.setViewportSize({width:1200,height:1100})
  await page.screenshot({path:path('sticker-collage-16-ready-desktop.png'),fullPage:true})
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path('sticker-collage-16-ready-mobile.png'),fullPage:true})
  results.slots={accepted:16,failedStillConsumesSlot:true,seventeenthRejected:true,removedFailureReleasesSlot:true,backgroundSeparate:true}
  await page.setViewportSize({width:1200,height:1100})
  await fresh(page);failNames=new Set(['source-2.png'])
  await upload(['source-1.png','source-2.png','source-3.png'].map(fixture));await ready(page,2)
  assert.match(await page.getByTestId('collage-status').textContent(),/2 张贴纸可用.*1 张失败/)
  await fresh(page);failNames=new Set(['source-1.png','source-2.png','source-3.png'])
  await upload(['source-1.png','source-2.png','source-3.png'].map(fixture));await settle(page)
  assert.match(await page.getByTestId('collage-status').textContent(),/没有可用贴纸/);assert.equal(await page.locator('[data-element-type="imageSticker"]').count(),0)
  results.failures={mixedReady:2,mixedFailed:1,allFailed:3}
  await fresh(page);failNames.clear();await upload([await payload('same.png'),await payload('same.png','source-2.png')]);await ready(page,2)
  const ids=await page.locator('[data-element-type="imageSticker"]').evaluateAll(es=>es.map(e=>e.dataset.elementId));assert.equal(new Set(ids).size,2)
  await page.getByRole('button',{name:'移除same.png',exact:true}).first().click();assert.equal(await page.getByTestId('collage-source').count(),1)
  results.sameNamesIndependent=true
  await fresh(page);const beforeInvalid=requests.length
  await upload([...await Promise.all(['animated.png','animated.webp','corrupt.png','over-pixels.png'].map(async name=>({name,mimeType:name.endsWith('.webp')?'image/webp':'image/png',buffer:await readFile(fixture(name))}))),{name:'over-size.png',mimeType:'image/png',buffer:Buffer.alloc(20*1024*1024+1)},{name:'mismatch.jpg',mimeType:'image/jpeg',buffer:await readFile(fixture('source-1.png'))}])
  await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/不支持动画/);assert.match(await page.getByRole('alert').textContent(),/图片头损坏/)
  assert.match(await page.getByRole('alert').textContent(),/4000 万/);assert.match(await page.getByRole('alert').textContent(),/20 MiB/);assert.match(await page.getByRole('alert').textContent(),/真实格式与文件类型不一致/)
  assert.equal(await page.getByTestId('collage-source').count(),0);assert.equal(requests.length,beforeInvalid)
  await upload(['landscape.png','portrait.png','static.webp'].map(fixture));await ready(page,3)
  results.formats={apngRejected:true,animatedWebpRejected:true,corruptRejected:true,over40MPRejected:true,over20MiBRejected:true,mimeMismatchRejected:true,wideTallStaticWebpAccepted:true}
  await fresh(page);hold=true;holds.length=0;const beforeCancel=requests.length
  await upload(['source-1.png','source-2.png','source-3.png'].map(fixture))
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="collage-source"]').length===3)
  for(let i=0;i<300&&holds.length<2;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(holds.length,2,'two real request slots; third queued')
  const queued=['source-1.png','source-2.png','source-3.png'].find(name=>!holds.some(release=>release.fileName===name))
  assert.ok(queued);await page.getByRole('button',{name:'移除'+queued,exact:true}).click()
  await page.getByTestId('mode-single').click();await page.getByTestId('mode-collage').click()
  assert.equal(await page.locator('[data-source-status="paused"]').count(),2)
  hold=false;await page.getByTestId('collage-source').first().getByRole('button',{name:'重试',exact:true}).click()
  while(holds.length)holds.shift()()
  await page.waitForFunction(()=>document.querySelectorAll('[data-source-status="ready"]').length===1)
  await page.getByTestId('collage-source').nth(1).getByRole('button',{name:'重试',exact:true}).click();await ready(page,2)
  assert.equal(requests.slice(beforeCancel).filter(n=>n===queued).length,0,'cancelled queued source never starts')
  results.queueCancellation={maxHeldRequests:2,queuedNeverStarted:true,pausedAndRetried:true}
  // Aborted network bodies cannot test a stale asset commit. Hold the old
  // store decode (second Image.decode after the client validation decode),
  // while still using the real browser decoder and unmodified UI/session.
  await fresh(page);distinguishRetry=true;retryAttempts=0
  await page.evaluate(oldSrc=>{
   const decode=Image.prototype.decode,randomUUID=crypto.randomUUID.bind(crypto)
   const probe=window.__lateRetry={oldDecodeCalls:0,oldHeld:false,oldReleased:false,postReleaseAssetIds:[]}
   Image.prototype.decode=async function(){await decode.call(this);if(this.src===oldSrc&&++probe.oldDecodeCalls===2){probe.oldHeld=true;probe.decodeBoundary=new Error().stack.includes('image-stickers.js')?'asset-store':'unknown';await new Promise(resolve=>{probe.release=resolve});probe.oldReleased=true}}
   crypto.randomUUID=()=>{const id=randomUUID();if(probe.oldReleased)probe.postReleaseAssetIds.push(id);return id}
   probe.restore=()=>{Image.prototype.decode=decode;crypto.randomUUID=randomUUID}
  },'data:image/png;base64,'+oldPng.toString('base64'))
  await upload(fixture('source-1.png'))
  await page.waitForFunction(()=>window.__lateRetry.oldHeld)
  assert.equal(await page.evaluate(()=>window.__lateRetry.decodeBoundary),'asset-store','old request reached the actual store decode boundary')
  await page.getByTestId('mode-single').click();await page.getByTestId('mode-collage').click()
  assert.equal(await page.locator('[data-source-status="paused"]').count(),1)
  await page.getByTestId('collage-source').getByRole('button',{name:'重试',exact:true}).click();await ready(page,1);await frames(page)
  const retrySticker=page.locator('[data-element-type="imageSticker"]')
  const newAssetId=await retrySticker.getAttribute('data-asset-id')
  const newCaption=await page.locator('[data-element-role="caption"]').getAttribute('data-text')
  assert.equal(newCaption,'新的重试结果');assert.equal(retryAttempts,2)
  const newPreview=await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1])
  assert.equal(await page.evaluate(()=>window.__lateRetry.oldReleased),false,'observe new ready asset before releasing the obsolete decode')
  await page.evaluate(()=>window.__lateRetry.release())
  await page.waitForFunction(()=>window.__lateRetry.postReleaseAssetIds.length===1)
  await frames(page)
  const obsoleteAssetId=await page.evaluate(()=>window.__lateRetry.postReleaseAssetIds[0])
  assert.notEqual(obsoleteAssetId,newAssetId,'obsolete asset actually registered after its held decode completed')
  assert.equal(await retrySticker.getAttribute('data-asset-id'),newAssetId,'old decode completion must not replace new retry asset')
  assert.equal(await page.locator('[data-source-status="ready"]').count(),1)
  assert.equal(await page.locator('[data-element-role="caption"]').getAttribute('data-text'),newCaption,'new retry caption retained')
  const afterOldPreview=await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1])
  const retainedPixels=await decodedEquality(page,newPreview,afterOldPreview)
  assert.equal(retainedPixels.differentChannels,0,'new retry pixels survive an actual obsolete asset decode completion')
  results.cancelLateRetry={boundary:'actual asset-store Image.decode',oldPng:[110,85],newPng:[160,120],newReadyBeforeOldRelease:true,obsoleteAssetRegistered:true,assetIdRetained:true,captionRetained:true,differentChannels:retainedPixels.differentChannels}
  await page.evaluate(()=>window.__lateRetry.restore());distinguishRetry=false
  await fresh(page);await upload(fixture('source-1.png'));await ready(page,1)
  await page.getByRole('button',{name:'选择source-1.png',exact:true}).click()
  const styles=[]
  for(const style of ['solid','dashed','none']){await page.getByRole('combobox',{name:'贴纸描边',exact:true}).selectOption(style);await frames(page);styles.push(await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1]))}
  assert.ok((await decodedEquality(page,styles[0],styles[1])).differentChannels>0);assert.ok((await decodedEquality(page,styles[1],styles[2])).differentChannels>0)
  await page.getByRole('combobox',{name:'贴纸描边',exact:true}).selectOption('solid');results.uiBorderStylesDistinct=true
  results.backgroundPixels={}
  for(const kind of ['paper-dark','paper-light','solid','photo']){
   if(kind==='photo'){await page.getByTestId('collage-background-upload').setInputFiles(fixture('landscape.png'));await page.waitForFunction(()=>document.querySelector('[data-testid="collage-background-kind"]').value==='photo')}
   else await page.getByTestId('collage-background-kind').selectOption(kind)
   // Selected editor controls are outside the canvas; compare their visible
   // and hidden states as well as the separately decoded download.
   await page.getByRole('button',{name:'选择source-1.png',exact:true}).click();await frames(page)
   const selected=await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1])
   await page.getByTestId('collage-preview').click();await frames(page)
   const hidden=await page.locator('[data-testid="collage-canvas"] canvas').evaluate(c=>c.toDataURL().split(',')[1])
   assert.equal((await decodedEquality(page,selected,hidden)).differentChannels,0)
   results.backgroundPixels[kind]=await downloadEqual(page,`sticker-collage-mock-${kind}.png`)
   if(kind==='paper-dark'){await page.screenshot({path:path('sticker-collage-mock-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path('sticker-collage-mock-mobile.png'),fullPage:true});await page.setViewportSize({width:1200,height:1100})}
   await page.getByTestId('collage-preview').click()
  }
  // Exercise actual renderer/store modules with an observable image-decode
  // boundary. Known fixture coordinates describe transparent holes, not a
  // second implementation of border generation.
  results.renderer=await page.evaluate(async png=>{
   const {createStickerAssetStore}=await import('/src/utils/image-stickers.js')
   const {drawCollage,exportCollage}=await import('/src/utils/collage-renderer.js')
   const {ensureFontLoaded}=await import('/src/utils/fonts.js');await ensureFontLoaded();await document.fonts.ready
   const {createCollageSession}=await import('/src/hooks/useCollageSession.js')
   let resourceReleases=0;const src=URL.createObjectURL(await (await fetch('data:image/png;base64,'+png)).blob())
   const store=createStickerAssetStore({revokeUrl:url=>{resourceReleases++;URL.revokeObjectURL(url)}})
   const id=await store.load({src,sourceId:'technical'}),image=store.get(id).image
   const element={id:'hole',type:'imageSticker',assetId:id,x:500,y:500,width:160/1080*1000,height:120/1440*1000,rotation:0,borderWidth:6}
   const project={sourceIds:[],background:{kind:'solid',color:'#203040'},ink:'light',elements:[element]}
   const render=style=>{element.borderStyle=style;const c=document.createElement('canvas');c.width=1080;c.height=1440;drawCollage(c.getContext('2d'),project,store);return c}
   const canvases=['solid','dashed','none'].map(render),pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data]
   const holes=canvases.map(c=>pixel(c,460+42,660+42)),pieces=canvases.map(c=>pixel(c,460+140,660+55)),bg=pixel(canvases[0],0,0)
   const a=canvases[0].getContext('2d').getImageData(0,0,1080,1440).data,b=canvases[1].getContext('2d').getImageData(0,0,1080,1440).data,n=canvases[2].getContext('2d').getImageData(0,0,1080,1440).data
   let solidWhite=0,dashedWhite=0,noneWhite=0,styleDifferent=0
   for(let i=0;i<a.length;i+=4){if(a[i]===255&&a[i+1]===255&&a[i+2]===255)solidWhite++;if(b[i]===255&&b[i+1]===255&&b[i+2]===255)dashedWhite++;if(n[i]===255&&n[i+1]===255&&n[i+2]===255)noneWhite++;if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])styleDifferent++}
   element.borderStyle='solid';const expected=render('solid').getContext('2d').getImageData(0,0,1080,1440).data
   const session=createCollageSession({assetStore:store});session.mount();session.activate();session.commitProject(project)
   let release;store.get(id).ready=new Promise(resolve=>{release=resolve});let completed=false
   const exporting=exportCollage(session.getSnapshot().project,store).then(blob=>{completed=true;return blob})
   await new Promise(resolve=>setTimeout(resolve,100));const waited=!completed
   element.x=100;project.background.color='#ff0000';project.elements=[];session.commitProject(project);session.reset();store.dispose();const releasedBefore=resourceReleases
   release(image);const output=await exporting;const out=await createImageBitmap(output);const c=document.createElement('canvas');c.width=1080;c.height=1440;c.getContext('2d').drawImage(out,0,0);out.close()
   const actual=c.getContext('2d').getImageData(0,0,1080,1440).data;let frozenDifferent=0;for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])frozenDifferent++
   session.unmount();return {holes,pieces,bg,solidWhite,dashedWhite,noneWhite,styleDifferent,waited,releasedBefore,releasedAfter:resourceReleases,frozenDifferent}
  },png.toString('base64'))
  const r=results.renderer;r.holes.forEach(p=>assert.deepEqual(p,r.bg));r.pieces.forEach(p=>assert.deepEqual(p,[108,155,113,255]));assert.ok(r.solidWhite>r.dashedWhite&&r.dashedWhite>0);assert.equal(r.noneWhite,0);assert.ok(r.styleDifferent>0);assert.ok(r.waited);assert.equal(r.releasedBefore,0);assert.equal(r.releasedAfter,1);assert.equal(r.frozenDifferent,0)
  assert.deepEqual(errors,[]);results.pageErrors=errors;results.mockRequests=requests.length
  await writeFile(path('sticker-collage-mock-results.json'),JSON.stringify(results,null,2)+'\n')
  console.log('PASS collage full mock matrix: '+JSON.stringify(results))
 }finally{while(holds.length)holds.shift()();await page.close()}
}

export async function verifyLive(chromium) {
 if(!process.env.COLLAGE_URL)throw new Error('--live requires explicit COLLAGE_URL for the built backend')
 const browser=await chromium.launch({headless:true,channel:'msedge'})
 const page=await browser.newPage({viewport:{width:1200,height:1100},acceptDownloads:true}),errors=[],calls=[],responseWork=[]
 await page.addInitScript(()=>{const original=window.fetch;window.__collageRequestFacts=[];window.fetch=function(input,options){if(input==='/api/cutout'){const form=options.body,subject=form.has('subject')?JSON.parse(form.get('subject')):null;window.__collageRequestFacts.push({name:form.get('file').name,manual:form.has('subject'),positivePoints:subject?.segmentation_regions?.[0]?.positive_points?.length||0})}return original.call(this,input,options)}})
 page.on('pageerror',e=>errors.push(e.message))
 // Exactly the three existing human-authorized photos, one automatic upload
 // each. Manual correction includes subject and uses local SAM only.
 let currentName,currentManual=false;const subjects=new Map()
 page.on('response',response=>{if(new URL(response.url()).pathname!=='/api/cutout')return;const name=currentName,manual=currentManual,elapsedMs=Math.round(Date.now()-starts.get(name));responseWork.push((async()=>{const data=await response.json(),d=data.data;if(d?.subject)subjects.set(name,d.subject);const call={name,manual,http:response.status(),elapsedMs,width:d?.width,height:d?.height,originalWidth:d?.original_width,originalHeight:d?.original_height,label:d?.subject?.label,quality:d?.quality,error:data.detail};calls.push(call);console.log('Real cutout result: '+JSON.stringify(call));if(d?.image)await writeFile(path('sticker-collage-real-'+name.replace('.jpg','')+(manual?'-manual':'')+'.png'),Buffer.from(d.image.split(',')[1],'base64'))})())})
 const starts=new Map(),result={mode:'real',photos:['coffee.jpg','cat.jpg','buffet.jpg']}
 try{
  const health=await (await page.request.get(new URL('/health',url()).href)).json();assert.equal(health.api_configured,true);assert.equal(health.sam_loaded,true);result.health={api_configured:true,sam_loaded:true}
  await fresh(page)
  for(const name of result.photos){currentName=name;starts.set(name,Date.now());await page.getByTestId('collage-upload').setInputFiles(path(name));await page.waitForFunction(name=>[...document.querySelectorAll('[data-testid="collage-source"]')].some(e=>e.textContent.includes(name)&&['ready','failed'].includes(e.dataset.sourceStatus)),name,{timeout:180000});await Promise.all(responseWork)}
  await settle(page);assert.equal(await page.getByTestId('collage-source').count(),3)
  result.status=await page.getByTestId('collage-status').textContent()
  const card=page.getByTestId('collage-source').filter({hasText:'coffee.jpg'});await card.getByRole('button',{name:'纠正主体',exact:true}).click();await page.getByTestId('correction-photo').waitFor()
  const beforeAsset=await page.locator('[data-element-type="imageSticker"]').first().getAttribute('data-asset-id')
  const region=subjects.get('coffee.jpg')?.segmentation_regions?.[0],bounds=region?.box_2d||[0,0,1000,1000],point=region?.positive_points?.[0]||[(bounds[1]+bounds[3])/2,(bounds[0]+bounds[2])/2]
  await page.getByTestId('correction-tool-positive').click();const stage=await page.getByTestId('correction-stage').boundingBox();await page.mouse.click(stage.x+stage.width*point[0]/1000,stage.y+stage.height*point[1]/1000)
  currentName='coffee.jpg';currentManual=true;starts.set('coffee.jpg',Date.now());await page.getByTestId('collage-correction-submit').click();await page.waitForFunction(()=>document.querySelector('[data-testid="collage-correction-status"]').textContent.includes('已更新'),null,{timeout:180000});await Promise.all(responseWork);await page.getByTestId('correction-close').click();result.manualSAMCorrection='coffee.jpg positive point, updated'
  assert.notEqual(await page.locator('[data-element-type="imageSticker"]').first().getAttribute('data-asset-id'),beforeAsset)
  result.pixels=await downloadEqual(page,'sticker-collage-real-export.png')
  await page.getByTestId('collage-preview').click();await page.screenshot({path:path('sticker-collage-real-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path('sticker-collage-real-mobile.png'),fullPage:true})
  assert.deepEqual(errors,[]);for(const name of result.photos)assert.equal(calls.filter(c=>c.name===name&&!c.manual).length,1)
  result.requestFacts=await page.evaluate(()=>window.__collageRequestFacts);assert.deepEqual(result.requestFacts.map(f=>[f.name,f.manual]),[['coffee.jpg',false],['cat.jpg',false],['buffet.jpg',false],['coffee.jpg',true]]);assert.ok(result.requestFacts.at(-1).positivePoints>0)
  result.calls=calls;result.pageErrors=errors;await writeFile(path('sticker-collage-real-results.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS real collage UI: '+JSON.stringify(result))
 }finally{result.calls=calls;result.pageErrors=errors;await writeFile(path('sticker-collage-real-results.json'),JSON.stringify(result,null,2)+'\n');await browser.close()}
}
