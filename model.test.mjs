import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,statusOf,candidates,generateTraining,nextContestProblem,acceptedPracticeSubmission} from './model.mjs';
const p=(index,rating=1400,tags=['dp'])=>({contestId:10,index,rating,tags,name:index});
const problems=[p('A'),p('B',1600,['math']),p('C',1800,['dp','math'])];
const account={handle:'sample',complete:true,states:{'10/A':{solved:true},'10/B':{solved:false}}};
test('AC is retained across later WA; pending counts as attempted; newest verdict is ordered by id',()=>{
  const states=summarize([{id:3,problem:p('A'),verdict:'WRONG_ANSWER'},{id:1,problem:p('A'),verdict:'OK'},{id:2,problem:p('B')}]);
  assert.equal(statusOf(states,'10/A'),'ac');assert.equal(states['10/A'].verdict,'WRONG_ANSWER');assert.equal(states['10/A'].attempts,2);assert.equal(statusOf(states,'10/B'),'tried');assert.equal(statusOf(states,'10/C'),'new');
});
test('exclude AC or all attempts independently of draw history',()=>{
  const base={min:800,max:2000,noRepeat:true};
  assert.deepEqual(candidates(problems,{...base,exclude:'ac'},[],account).map(p=>p.index),['B','C']);
  assert.deepEqual(candidates(problems,{...base,exclude:'tried'},[],account).map(p=>p.index),['C']);
  assert.deepEqual(candidates(problems,{...base,exclude:'none'},['10/A']).map(p=>p.index),['B','C']);
  assert.throws(()=>candidates(problems,base,[],{complete:false}),/同步/);
});
test('overlapping broad and narrow groups use matching to fill all slots without duplicates',()=>{
  const picked=generateTraining([p('A',1400),p('B',1600)],[{min:1400,max:1600,count:1},{min:1400,max:1400,count:1}],{exclude:'none'},[],null,()=>.999);
  assert.deepEqual(picked.map(p=>p.index),['B','A']);
});
test('training respects tag matching, exclusion and no-repeat for all groups',()=>{
  const picked=generateTraining(problems,[{min:800,max:2000,count:1,tags:['dp','math'],mode:'all'}],{exclude:'ac'},[],account);
  assert.equal(picked[0].index,'C');
  assert.throws(()=>generateTraining(problems,[{min:800,max:2000,count:2}],{exclude:'tried'},[],account),/不足/);
  assert.throws(()=>generateTraining(problems,[{min:800,max:2000,count:1}],{exclude:'tried',noRepeat:true},['10/C'],account),/不足/);
});
test('invalid or oversized training is rejected before changing anything',()=>{
  for(const groups of [[],[{count:0}],[{count:1.5}],[{min:1800,max:800,count:1}],[{count:30},{count:30}]])assert.throws(()=>generateTraining(problems,groups,{exclude:'none'},[],null));
});
test('future contest selector follows native order, wraps and skips solved',()=>{
  assert.equal(nextContestProblem(['A','B','C','D'],10,'C',{'10/D':{solved:true}}),'A');
  assert.equal(nextContestProblem(['A','B'],10,'A',{'10/B':{solved:true}}),null);
  assert.equal(nextContestProblem(['A','B'],10,'X',{}),null);
});
test('practice completion requires matching page, account, new submission id, problem and timestamp',()=>{
  const now=200000,pending={practice:true,handle:'sample',key:'10/A',started:199000,baseline:10};
  const good={id:11,problem:p('A'),verdict:'OK',creationTimeSeconds:200};
  const find=(patch={},subs=[good],path='/contest/10/my',handle='sample')=>acceptedPracticeSubmission({...pending,...patch},handle,path,subs,now);
  assert.equal(find(),good);
  assert.equal(find({},[{...good,id:9}]),null);assert.equal(find({},[{...good,creationTimeSeconds:180}]),null);
  assert.equal(find({},[{...good,verdict:'WRONG_ANSWER'}]),null);assert.equal(find({},[{...good,problem:p('B')}]),null);
  assert.equal(find({},[good],'/contest/20/my'),null);assert.equal(find({},[good],'/contest/10/my','other'),null);
  assert.equal(find({practice:false}),null);assert.equal(find({started:now-1200001}),null);
});
