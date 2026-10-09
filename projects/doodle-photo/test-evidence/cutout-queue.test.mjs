import test from 'node:test'
import assert from 'node:assert/strict'
import { createCutoutQueue } from '../src/utils/cutout-queue.js'
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
const job=(id,version=1,epoch=1)=>({sourceId:id,version,epoch,file:new File(['x'],'same.png'),subject:null})
test('queue_never_exceeds_two_and_ignores_cancelled_job',async()=>{
 let running=0,maxRunning=0;const started=[],controls=new Map()
 const queue=createCutoutQueue({concurrency:8,worker:(j,{signal})=>{running++;maxRunning=Math.max(maxRunning,running);started.push(j.sourceId);return new Promise(resolve=>controls.set(j.sourceId,{signal,finish(){running--;resolve(j.sourceId)}}))}})
 const a=queue.enqueue(job('photo-a')),b=queue.enqueue(job('photo-b')),c=queue.enqueue(job('photo-c')),d=queue.enqueue(job('photo-d'))
 await tick();assert.equal(maxRunning,2);assert.deepEqual(started,['photo-a','photo-b'])
 queue.cancel('photo-c');queue.cancel('photo-a');assert.equal(controls.get('photo-a').signal.aborted,true)
 assert.equal((await c).cancelled,true);assert.equal((await a).cancelled,true)
 controls.get('photo-a').finish();await tick();assert.deepEqual(started,['photo-a','photo-b','photo-d'])
 controls.get('photo-b').finish();controls.get('photo-d').finish();assert.equal((await b).data,'photo-b');assert.equal((await d).data,'photo-d');assert.equal(maxRunning,2);queue.dispose()
})
test('replacement identity suppresses old completion and preserves latest version and epoch',async()=>{
 const controls=[];const queue=createCutoutQueue({worker:(j)=>new Promise(resolve=>controls.push({j,resolve}))})
 const old=queue.enqueue(job('same',1,1)), next=queue.enqueue(job('same',2,1));assert.equal((await old).cancelled,true)
 controls[0].resolve('stale');controls[1].resolve('fresh');const result=await next;assert.equal(result.job.version,2);assert.equal(result.job.epoch,1);assert.equal(result.data,'fresh')
 const newer=queue.enqueue(job('same',1,2));controls[2].resolve('new-epoch');assert.equal((await newer).job.epoch,2);queue.dispose()
})
test('cancelAll and dispose suppress pending, active errors and late results',async()=>{
 const rejectors=[];let calls=0;const queue=createCutoutQueue({worker:()=>{calls++;return new Promise((resolve,reject)=>rejectors.push(reject))}})
 const promises=['a','b','c'].map(id=>queue.enqueue(job(id)));queue.cancelAll();for(const p of promises)assert.equal((await p).cancelled,true)
 rejectors.forEach(reject=>reject(Error('late failure')));await tick();assert.equal(calls,2);queue.dispose();assert.equal((await queue.enqueue(job('d'))).cancelled,true)
})
test('worker errors settle per-source and continue waiting work',async()=>{
 const queue=createCutoutQueue({concurrency:1,worker:async j=>{if(j.sourceId==='bad')throw Error('failed');return 'ok'}})
 const bad=queue.enqueue(job('bad')),good=queue.enqueue(job('good'));assert.match((await bad).error.message,/failed/);assert.equal((await good).data,'ok');queue.dispose()
})
test('queue lifecycle functions work when destructured by a consumer',async()=>{
 const {enqueue,dispose}=createCutoutQueue({worker:()=>new Promise(()=>{})});const pending=enqueue(job('a'));dispose();assert.equal((await pending).cancelled,true)
})
