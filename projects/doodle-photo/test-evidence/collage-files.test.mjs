import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectImageMetadata, validateUploadMetadata, validateUploadBatch, decodeSourcePreview } from '../src/utils/collage-files.js'
const png = (w=20,h=30,animated=false) => {
  const bytes = new Uint8Array(animated ? 77 : 57), v=new DataView(bytes.buffer)
  bytes.set([137,80,78,71,13,10,26,10]); v.setUint32(8,13); bytes.set([73,72,68,82],12); v.setUint32(16,w);v.setUint32(20,h);bytes[24]=8;bytes[25]=6
  let at=33
  if(animated){v.setUint32(at,8);bytes.set([97,99,84,76],at+4);v.setUint32(at+8,2);at+=20}
  bytes.set([73,68,65,84],at+4);at+=12;bytes.set([73,69,78,68],at+4)
  return bytes
}
const webp=(animated=false)=>{const b=new Uint8Array(44),v=new DataView(b.buffer); b.set([82,73,70,70]);v.setUint32(4,b.length-8,true);b.set([87,69,66,80,86,80,56,88],8);v.setUint32(16,10,true);b[20]=animated?2:0;b[24]=19;b[27]=29;if(animated){b.set([65,78,73,77],30);v.setUint32(34,6,true)}else {b.set([86,80,56,76],30);v.setUint32(34,5,true);b[38]=47;v.setUint32(39,19+(29<<14),true)}return b}
const file=(bytes,type='image/png',name='same.png')=>new File([bytes],name,{type})
test('real static headers and animation markers are inspected before decoding',()=>{
 assert.deepEqual(inspectImageMetadata(png()),{format:'png',width:20,height:30,animated:false})
 assert.equal(inspectImageMetadata(png(20,30,true)).animated,true)
 assert.deepEqual(inspectImageMetadata(webp()),{format:'webp',width:20,height:30,animated:false})
 assert.equal(inspectImageMetadata(webp(true)).animated,true)
 const jpeg=Uint8Array.from([255,216,255,192,0,11,8,0,30,0,20,1,1,17,0,255,218,0,8,1,1,0,0,63,0,255,217])
 assert.deepEqual(inspectImageMetadata(jpeg),{format:'jpeg',width:20,height:30,animated:false})
 for(const bad of [png().slice(0,20),webp().slice(0,25),Uint8Array.from([255,216,255,192,0,50]),new Uint8Array(40)]) assert.throws(()=>inspectImageMetadata(bad),/损坏|格式/)
})
test('file MIME, file bytes, pixel and source count limits reject independently',()=>{
 const meta=inspectImageMetadata(png())
 assert.equal(validateUploadMetadata({size:20*1024*1024+1,type:'image/png'},meta,0).ok,false)
 assert.equal(validateUploadMetadata(file(png()),meta,16).ok,false)
 assert.equal(validateUploadMetadata(file(png()),{...meta,width:10000,height:4001},0).ok,false)
 assert.equal(validateUploadMetadata(file(png(),'image/jpeg'),meta,0).ok,false)
 assert.equal(validateUploadMetadata(file(png()),{...meta,animated:true},0).ok,false)
 assert.equal(validateUploadMetadata({size:20*1024*1024,type:'image/png'}, {...meta,width:10000,height:4000},15).ok,true)
})
test('partial batches preserve original Files including matching names and reject items separately',async()=>{
 const a=file(png()), b=file(png()), bad=file(png(),'image/jpeg')
 const result=await validateUploadBatch([a,b,bad],0)
 assert.deepEqual(result.files,[a,b]);assert.equal(result.errors.length,1);assert.equal(result.errors[0].file,bad)
 const limited=await validateUploadBatch([bad,a,b],15)
 assert.deepEqual(limited.files,[a]);assert.equal(limited.errors.length,2)
})
test('preview uses oriented bitmap, retains File and closes decoded image on success or failure',async()=>{
 const original=file(png()); const previous=globalThis.createImageBitmap, doc=globalThis.document
 let closed=0, options, drawing
 globalThis.createImageBitmap=async(f,o)=>{assert.equal(f,original); options=o;return {width:1200,height:2400,close(){closed++}}}
 globalThis.document={createElement(){return {getContext(){return {drawImage(...args){drawing=args}}},toDataURL(){return 'data:image/jpeg;base64,thumb'}}}}
 try{ const r=await decodeSourcePreview(original); assert.equal(r.file,original);assert.equal(r.width,1200);assert.equal(r.height,2400);assert.equal(drawing[3],160);assert.equal(drawing[4],320);assert.equal(options.imageOrientation,'from-image');assert.equal(closed,1)
 globalThis.document.createElement=()=>({getContext(){throw Error('canvas unavailable')}});await assert.rejects(decodeSourcePreview(original),/canvas/);assert.equal(closed,2)
 }finally{globalThis.createImageBitmap=previous;globalThis.document=doc}
})


test('oversized source preview fails before reading bytes or allocating a decoder',async()=>{
 let read=false
 await assert.rejects(decodeSourcePreview({size:20*1024*1024+1,type:'image/png',async arrayBuffer(){read=true;return png().buffer}}),/20 MiB/)
 assert.equal(read,false)
})
test('lossless and lossy WebP headers work and malformed PNG/JPEG structure fails',()=>{
 const lossless=webp().slice(30);const b=new Uint8Array(26),v=new DataView(b.buffer);b.set([82,73,70,70]);v.setUint32(4,18,true);b.set([87,69,66,80],8);b.set(lossless,12)
 assert.deepEqual(inspectImageMetadata(b),{format:'webp',width:20,height:30,animated:false})
 const lossy=new Uint8Array(30),lv=new DataView(lossy.buffer);lossy.set([82,73,70,70]);lv.setUint32(4,22,true);lossy.set([87,69,66,80,86,80,56,32],8);lv.setUint32(16,10,true);lossy.set([0,0,0,157,1,42,20,0,30,0],20)
 assert.deepEqual(inspectImageMetadata(lossy),{format:'webp',width:20,height:30,animated:false})
 const bad=png();bad[25]=9;assert.throws(()=>inspectImageMetadata(bad));assert.throws(()=>inspectImageMetadata(png().slice(0,45)))
})
test('static WebP extended canvas cannot conceal different bitstream dimensions',()=>{
 const bytes=webp();bytes[24]=1;assert.throws(()=>inspectImageMetadata(bytes),/损坏/)
})

// Genuine decoder-valid JPEGs, embedded to keep trailer regressions portable.
const smallJpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAScf/2Q==','base64'))
const progressiveJpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUAQEAAAAAAAAAAAAAAAAAAAAE/9oADAMBAAIQAxAAAAGICO//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEPP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==','base64'))

const jpegHeader = Uint8Array.from([255,216,255,192,0,11,8,0,30,0,20,1,1,17,0,255,218,0,8,1,1,0,0,63,0])
const joinBytes = (...parts) => Uint8Array.from(parts.flatMap(part => Array.from(part)))
test('actual existing buffet JPEG accepts its decoder-valid 24-byte trailer',async()=>{
 const {readFile}=await import('node:fs/promises')
 const bytes=new Uint8Array(await readFile(new URL('./buffet.jpg',import.meta.url)))
 assert.deepEqual(inspectImageMetadata(bytes),{format:'jpeg',width:1707,height:1280,animated:false})
 const original=file(bytes,'image/jpeg','buffet.jpg')
 const batch=await validateUploadBatch([original],0)
 assert.equal(batch.files[0],original);assert.deepEqual(batch.errors,[])
 assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes)
})
test('small genuine JPEG trailer survives metadata, batch and source preview without changing File',async()=>{
 const bytes=joinBytes(smallJpeg,new Uint8Array(24).fill(37))
 assert.deepEqual(inspectImageMetadata(bytes),{format:'jpeg',width:2,height:3,animated:false})
 const original=file(bytes,'image/jpeg','trailer.jpg'), batch=await validateUploadBatch([original],0)
 assert.equal(batch.files[0],original);assert.deepEqual(batch.errors,[])
 assert.equal(validateUploadMetadata(original,inspectImageMetadata(bytes),0).ok,true)
 const oldBitmap=globalThis.createImageBitmap,oldDocument=globalThis.document;let closed=0
 globalThis.createImageBitmap=async decoded=>{assert.equal(decoded,original);return {width:2,height:3,close(){closed++}}}
 globalThis.document={createElement(){return {getContext(){return {drawImage(){}}},toDataURL(){return 'data:image/jpeg;base64,thumbnail'}}}}
 try{const preview=await decodeSourcePreview(original);assert.equal(preview.file,original);assert.equal(preview.width,2);assert.equal(preview.height,3);assert.equal(closed,1);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes)}
 finally{globalThis.createImageBitmap=oldBitmap;globalThis.document=oldDocument}
})
test('genuine progressive JPEG accepts a trailer through all bounded scan segments',()=>{
 assert.deepEqual(inspectImageMetadata(joinBytes(progressiveJpeg,[11,22,33])),{format:'jpeg',width:2,height:3,animated:false})
})
test('JPEG scan handles stuffed FF, restart markers and fill bytes before real EOI',()=>{
 const bytes=joinBytes(jpegHeader,[12,255,0,217,255,208,34,255,255,209,56,255,255,217,37])
 assert.deepEqual(inspectImageMetadata(bytes),{format:'jpeg',width:20,height:30,animated:false})
})
test('JPEG EOI inside metadata or stuffed data cannot replace the missing scan terminator',()=>{
 const beforeScan=joinBytes(jpegHeader.slice(0,2),[255,226,0,4,255,217],jpegHeader.slice(2),[12,34])
 const betweenScans=joinBytes(jpegHeader,[12,255,226,0,4,255,217])
 const stuffed=joinBytes(jpegHeader,[12,255,0,217])
 for(const bytes of [smallJpeg.slice(0,-2),beforeScan,betweenScans,stuffed,joinBytes(jpegHeader,[255]),joinBytes(jpegHeader,[255,255])])assert.throws(()=>inspectImageMetadata(bytes),/损坏/)
})
test('JPEG rejects corrupt interscan segment lengths even with trailing FF D9',()=>{
 assert.throws(()=>inspectImageMetadata(joinBytes(jpegHeader,[12,255,226,0,50,1,2,255,217])),/损坏/)
 assert.throws(()=>inspectImageMetadata(joinBytes(jpegHeader,[12,255,226,0,1,255,217])),/损坏/)
 assert.throws(()=>inspectImageMetadata(joinBytes(jpegHeader.slice(0,15),[255,217])),/损坏/)
})
