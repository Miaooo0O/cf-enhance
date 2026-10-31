const test=require('node:test');const assert=require('node:assert/strict');
const {Bridge}=require('./bridge.cjs');const {startAvailable}=require('./ports.cjs');
test('automatic ports support concurrent windows and recover from remembered port collisions',async()=>{
 const first=new Bridge(),second=new Bridge();
 try{await startAvailable(first);assert(first.port>=1024);const result=await startAvailable(second,{preferred:first.port});assert(result.fallback);assert.notEqual(first.port,second.port);}finally{await first.close();await second.close();}
});
test('legacy default migrates to automatic selection; low and invalid fixed ports are rejected',async()=>{
 let chosen;const fake={port:54321,start:async p=>{chosen=p;}};
 await startAvailable(fake,{configured:27121});assert.equal(chosen,0);
 await startAvailable(fake,{preferred:52345});assert.equal(chosen,52345);
 for(const configured of [1,-1,65536,1.5,'0'])await assert.rejects(startAvailable(fake,{configured}),/端口/);
});
