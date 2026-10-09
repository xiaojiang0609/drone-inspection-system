import test from 'node:test'
import assert from 'node:assert/strict'
import { requestCutout, validateCutoutSubject } from '../src/utils/cutout-client.js'
const subject={label:'cat',box_2d:[100,100,900,900],segmentation_regions:[{box_2d:[100,100,900,900],positive_points:[[500,500]],negative_points:[]}]}
const data=()=>({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAYAAAAsEj5rAAAAOklEQVR4nO3MsREAMAwCMYf9d3YuJTXfBQ2gszM7IJHZ0zAn4DANcwIO0zAn4DANcwIO0zAn4JjPwwsLdwI6CjlK0wAAAABJRU5ErkJggg==',width:20,height:30,original_width:100,original_height:100,crop_box:[10,10,90,90],contours:[[[0,0],[19,0],[19,29]]],subject:structuredClone(subject),caption:'猫',theme:'cat',emotion:'治愈',quality:[{accepted:true}]})
const source=new File(['original'],'photo.jpg',{type:'image/jpeg'})
const response=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}})
const withDecoder=async fn=>{const old=globalThis.Image;globalThis.Image=class{naturalWidth=20;naturalHeight=30;async decode(){} };try{await fn()}finally{globalThis.Image=old}}
test('asymmetric YXYX boxes and XY hints survive validation and serialized request/response; transposed hints fail',()=>withDecoder(async()=>{
 const asymmetric={label:'cat',box_2d:[100,600,400,900],segmentation_regions:[{box_2d:[100,600,400,900],positive_points:[[750,250]],negative_points:[]}]}
 assert.doesNotThrow(()=>validateCutoutSubject(asymmetric))
 const swapped=structuredClone(asymmetric);swapped.segmentation_regions[0].positive_points=[[250,750]]
 assert.throws(()=>validateCutoutSubject(swapped))
 let sent
 const payload=data();payload.subject=asymmetric
 const result=await requestCutout(source,asymmetric,{fetchImpl:async(_url,opts)=>{sent=JSON.parse(opts.body.get('subject'));return response({status:'success',data:payload})}})
 assert.deepEqual(sent.box_2d,[100,600,400,900]);assert.deepEqual(sent.segmentation_regions[0].positive_points,[[750,250]])
 assert.deepEqual(result.subject.box_2d,[100,600,400,900]);assert.deepEqual(result.subject.segmentation_regions[0].positive_points,[[750,250]])
 payload.subject=swapped
 await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:payload})}))
 let requests=0
 await assert.rejects(requestCutout(source,swapped,{fetchImpl:async()=>{requests++;return response({status:'success',data:data()})}}))
 assert.equal(requests,0)
}))
test('client sends original file and explicit subject and validates decoded response',()=>withDecoder(async()=>{
 let sent
 const result=await requestCutout(source,subject,{fetchImpl:async(url,opts)=>{sent={url,opts};return response({status:'success',data:data()})}})
 assert.equal(sent.url,'/api/cutout');assert.equal(sent.opts.method,'POST');assert.equal(await sent.opts.body.get('file').text(),'original');assert.deepEqual(JSON.parse(sent.opts.body.get('subject')),subject);assert.ok(sent.opts.signal);assert.equal(result.width,20)
}))
test('HTTP 413/422/502 expose readable errors and never become success',async()=>{
 for(const status of [413,422,502])await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({detail:'adjust the box'},status)}),e=>e.status===status&&e.message.includes('adjust the box'))
})
test('invalid successful JSON, geometry, dimensions and metadata are rejected',()=>withDecoder(async()=>{
 const mutations=[d=>d.width=0,d=>d.image='data:image/jpeg;base64,abcd',d=>d.subject.segmentation_regions[0].positive_points=[[50,500]],d=>d.subject.segmentation_regions=Array(9).fill(d.subject.segmentation_regions[0]),d=>d.subject.segmentation_regions[0].negative_points=[[500,500]],d=>d.crop_box=[0,0,101,10],d=>d.contours=[[[21,0],[1,1],[2,2]]],d=>d.quality={},d=>d.caption=null]
 for(const mutate of mutations){const d=data();mutate(d);await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:d})}))}
 for(const payload of [{success:true,data:data()},{status:'success'},{success:false,data:data()}])await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response(payload)}))
 await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>new Response('bad-json')}),/响应/)
}))
test('PNG decoding failure rejects; decoded dimensions must match declared dimensions',async()=>{
 const old=globalThis.Image
 try{globalThis.Image=class{async decode(){throw Error('bad png')}};await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:data()})}),/PNG/)
 globalThis.Image=class{naturalWidth=99;naturalHeight=30;async decode(){}};await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:data()})}),/尺寸/)
 }finally{globalThis.Image=old}
})
test('timeout and external abort reject even if fetch ignores AbortSignal',async()=>{
 let signal
 const controller=new AbortController()
 const hanging=(url,opts)=>{signal=opts.signal;return new Promise(()=>{})}
 const pending=requestCutout(source,null,{signal:controller.signal,fetchImpl:hanging});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(signal.aborted,true)
 await assert.rejects(requestCutout(source,null,{timeoutMs:5,fetchImpl:hanging}),/超时/);assert.equal(signal.aborted,true)
})
test('invalid outbound subject fails before sending a request',async()=>{
 let called=false
 await assert.rejects(requestCutout(source,{...subject,box_2d:[0,0,0,100]},{fetchImpl:async()=>{called=true}}));assert.equal(called,false)
})


test('PNG header dimension mismatch is rejected before browser decoding',async()=>{
 let decoded=false;const old=globalThis.Image
 globalThis.Image=class{naturalWidth=20;naturalHeight=30;async decode(){decoded=true}}
 try{const d=data();const bytes=Buffer.from(d.image.split(',')[1],'base64');bytes.writeUInt32BE(50000,16);d.image='data:image/png;base64,'+bytes.toString('base64')
 await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:d})}));assert.equal(decoded,false)
 }finally{globalThis.Image=old}
})
test('subject validator matches region hint limits, overlap and cross-region conflicts',()=>withDecoder(async()=>{
 const changes=[
  d=>d.subject.label=' ',d=>d.subject.box_2d=[true,100,900,900],d=>d.subject.segmentation_regions=[],
  d=>d.subject.segmentation_regions[0].positive_points=Array(5).fill([500,500]),
  d=>d.subject.segmentation_regions[0].negative_points=Array(9).fill([50,50]),
  d=>d.subject.segmentation_regions[0].positive_points=[[500,500],[500,500]],
  d=>d.subject.segmentation_regions[0].positive_points=null,
  d=>d.subject.segmentation_regions[0].negative_points=[[NaN,5]],
  d=>d.subject.segmentation_regions[0].box_2d=[0,0,99,99],
  d=>{d.subject.segmentation_regions.push({box_2d:[200,200,800,800],positive_points:[],negative_points:[[500,500]]});d.quality.push({accepted:true})},
 ]
 for(const change of changes){const d=data();change(d);await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:d})}))}
 const d=data();d.subject.segmentation_regions[0]={tightbox_2d:[100,100,900,900]};assert.equal((await requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:d})})).subject.label,'cat')
}))
test('already-aborted client does not call fetch and abort during response parsing never delivers data',async()=>{
 const controller=new AbortController();controller.abort();let called=false
 await assert.rejects(requestCutout(source,null,{signal:controller.signal,fetchImpl:async()=>{called=true}}),e=>e.name==='AbortError');assert.equal(called,false)
 const next=new AbortController();let complete
 const pending=requestCutout(source,null,{signal:next.signal,fetchImpl:async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{complete=resolve})})})
 await new Promise(resolve=>setTimeout(resolve,0));next.abort();await assert.rejects(pending,e=>e.name==='AbortError');complete({status:'success',data:data()})
})
test('backend contour point budget allows more than sixteen disconnected rings',()=>withDecoder(async()=>{
 const d=data();d.contours=Array.from({length:17},()=>[[0,0],[19,0],[19,29]])
 assert.equal((await requestCutout(source,null,{fetchImpl:async()=>response({status:'success',data:d})})).contours.length,17)
}))
test('HTTP errors with null JSON still retain their status and readable message',async()=>{
 await assert.rejects(requestCutout(source,null,{fetchImpl:async()=>response(null,502)}),error=>error.status===502&&/502/.test(error.message))
})
test('successful request clears timeout and removes external cancellation listener',()=>withDecoder(async()=>{
 const controller=new AbortController();let internal
 await requestCutout(source,null,{signal:controller.signal,timeoutMs:15,fetchImpl:async(url,opts)=>{internal=opts.signal;return response({status:'success',data:data()})}})
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(internal.aborted,false)
 controller.abort();assert.equal(internal.aborted,false)
}))
