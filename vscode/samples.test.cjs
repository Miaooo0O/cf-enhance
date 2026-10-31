const test=require('node:test');const assert=require('node:assert/strict');
const {execute,sameOutput,runSamples}=require('./samples.cjs');
test('sample output comparison normalizes line endings and final newlines, not inner content',()=>{assert(sameOutput('1\r\n2\n','1\n2'));assert(!sameOutput('1  2','1 2'));});
test('runner captures stdout, reports nonzero exit and kills a timed-out program',async()=>{
 const good=await execute(process.execPath,['-e','process.stdin.on("data",x=>process.stdout.write(x))'],{input:'abc\n'});assert.equal(good.stdout,'abc\n');assert.equal(good.code,0);
 const bad=await execute(process.execPath,['-e','process.exit(3)']);assert.equal(bad.code,3);
 const timeout=await execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100});assert.equal(timeout.reason,'运行超时');
});
test('C++ samples compile and run in a fresh temporary directory',async()=>{
 const compiler=process.env.CFE_TEST_COMPILER||'g++';
 const result=await runSamples('#include <iostream>\nint main(){int x;std::cin>>x;std::cout<<x*2<<"\\n";}',[{input:'21\n',output:'42\n'},{input:'2\n',output:'5\n'}],{compiler});assert.equal(result[0].passed,true);assert.equal(result[1].passed,false);
});
