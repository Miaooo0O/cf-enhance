const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {createHash}=require('node:crypto');const {importSamples,refreshCph}=require('./cph.cjs');
test('CPH import uses the existing file identity, preserves custom tests/options, and deduplicates repeated imports',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cfe-cph-'));try{
  const filePath=path.join(root,'anything.cpp');fs.writeFileSync(filePath,'unchanged source');const problem={contestId:10,index:'A'},samples=[{input:'1\n',output:'2\n'}];
  const first=importSamples({filePath,problem,samples});assert.equal(first.added,1);assert.equal(path.basename(first.destination),`.anything.cpp_${createHash('md5').update(filePath).digest('hex')}.prob`);
  const data=JSON.parse(fs.readFileSync(first.destination));data.tests.push({id:123,input:'my custom test',output:'custom answer',customChecker:'keep'});data.customCheckerPath='checker.py';data.timeLimit=5000;fs.writeFileSync(first.destination,JSON.stringify(data));
  const again=importSamples({filePath,problem,samples:[{input:'1\r\n',output:'2\r\n'},{input:'3\n',output:'4\n'}]});assert.equal(again.added,1);assert.equal(again.total,3);assert.equal(again.problem.tests[1].customChecker,'keep');assert.equal(again.problem.customCheckerPath,'checker.py');assert.equal(again.problem.timeLimit,5000);assert.equal(again.problem.srcPath,filePath);assert.equal(again.problem.url,'https://codeforces.com/contest/10/problem/A');assert.equal(fs.readFileSync(filePath,'utf8'),'unchanged source');assert(new Set(again.problem.tests.map(t=>t.id)).size===3);
  fs.writeFileSync(first.destination,'broken json');assert.throws(()=>importSamples({filePath,problem,samples}),/保留/);assert.equal(fs.readFileSync(first.destination,'utf8'),'broken json');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('CPH import honors its configured save directory and rejects missing source files or samples',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cfe-cph-'));try{const filePath=path.join(root,'solve.py'),saveLocation=path.join(root,'cases');fs.writeFileSync(filePath,'print(1)');fs.mkdirSync(saveLocation);const args={filePath,saveLocation,problem:{contestId:12,index:'B'},samples:[{input:'',output:'1'}]};assert.equal(path.dirname(importSamples(args).destination),saveLocation);assert.throws(()=>importSamples({...args,samples:[]}),/样例/);assert.throws(()=>importSamples({...args,filePath:path.join(root,'missing.cpp')}),/保存/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('CPH refresh restores the selected source and closes only its newly opened preview without running code',async()=>{
 const old={input:{uri:{toString:()=> 'old'}}},tabs=[old],commands=[],shown=[],document={fileName:'solve.cpp'};let closed;
 const uri={toString:()=> 'prob'};
 const vscode={Uri:{file:()=>uri},window:{tabGroups:{all:[{tabs}],close:async t=>{closed=t;}},showTextDocument:async d=>{shown.push(d);if(d===uri)tabs.push({input:{uri},isDirty:false});}},commands:{executeCommand:async c=>commands.push(c)}};
 await refreshCph(vscode,{activate:async()=>undefined},document,{destination:'cases.prob',problem:{}});assert.equal(shown.at(-1),document);assert.equal(closed,tabs[1]);assert.notEqual(closed,old);assert.deepEqual(commands,['cph.judgeView.focus']);
});
