const test=require('node:test'),assert=require('node:assert/strict'),{InteractiveSession}=require('./interactive.cjs');
const waitFor=async check=>{const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw Error('Interactive state timed out');await new Promise(r=>setTimeout(r,20));}};
test('live C++ interaction streams output before input, keeps stdin open, accepts replies and EOF',async()=>{
 const s=new InteractiveSession();try{
  await s.start({languageId:'cpp',sourceName:'interactive.cpp',source:'#include <iostream>\nint main(){std::cout<<"? 1 2"<<std::endl;int n;std::cin>>n;std::cout<<"! "<<n+1<<std::endl;while(std::cin>>n){} }'});
  await waitFor(()=>s.state.logs.some(r=>r.kind==='out'&&r.text.includes('? 1 2')));assert.equal(s.state.status,'running');assert(!s.state.stdinClosed);
  s.send('41');await waitFor(()=>s.state.logs.some(r=>r.kind==='out'&&r.text.includes('! 42')));s.eof();await s.exited;assert.equal(s.state.exitCode,0);assert.equal(s.state.status,'finished');assert(s.state.logs.some(r=>r.kind==='in'&&r.text==='41\n'));
 }finally{await s.dispose();}assert.equal(s.dir,null);
});
test('interactive compile errors, stopping, restart and output limits never leave an owned program running',async()=>{
 const s=new InteractiveSession();try{
  await s.start({languageId:'cpp',source:'invalid C++'});assert.equal(s.state.status,'error');
  const snapshot={languageId:'cpp',source:'#include <iostream>\nint main(){int x;std::cin>>x;}'};await s.start(snapshot);assert.equal(s.state.status,'running');s.stop();await s.exited;assert.equal(s.state.status,'stopped');
  await s.start({languageId:'cpp',source:'#include <cstdio>\nint main(){while(true)puts("spam");}'});await s.exited;assert.equal(s.state.status,'stopped');assert(s.bytes>1024*1024);assert(Buffer.byteLength(s.state.logs.map(r=>r.text).join(''))<=1024*1024+4);assert.equal(s.child,null);
 }finally{await s.dispose();}
});
