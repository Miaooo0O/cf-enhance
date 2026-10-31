import {key, filterProblems} from './core.mjs';
export const statusOf = (states, id) => states?.[id]?.solved ? 'ac' : states?.[id] ? 'tried' : 'new';
export function summarize(submissions) {
  const states = {};
  for (const s of submissions) {
    if (!Number.isInteger(s.problem?.contestId) || !s.problem?.index) continue;
    const id = key(s.problem), state = states[id] ||= {solved:false, attempts:0};
    state.attempts++;
    state.solved ||= s.verdict === 'OK';
    if (!state.latestId || s.id > state.latestId) Object.assign(state, {latestId:s.id, verdict:s.verdict || 'TESTING', time:s.creationTimeSeconds});
  }
  return states;
}
export function candidates(problems, settings, history, account) {
  const exclude = settings.exclude || 'ac';
  if (exclude !== 'none' && (!account?.complete || !account.handle)) throw new Error('请先填写 CF handle 并同步记录，或选择“不排除提交过的题”。');
  return filterProblems(problems, settings, history).filter(p => exclude === 'none' || (exclude === 'tried' ? !account.states[key(p)] : !account.states[key(p)]?.solved));
}
export function generateTraining(problems, groups, settings, history, account, random = Math.random) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 12) throw new Error('请设置 1–12 组条件。');
  let total = 0;
  const pools = groups.map(g => {
    if (!Number.isInteger(g.count) || g.count < 1 || g.count > 50) throw new Error('每组题数需为 1–50。');
    total += g.count;
    const pool = candidates(problems, {...settings, ...g}, history, account).slice();
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    return pool;
  });
  if(total > 50) throw new Error('每场训练最多 50 道题。');
  // Bipartite matching avoids starving a narrow group when a broad group overlaps it.
  const slots = groups.flatMap((g,group)=>Array.from({length:g.count},()=>group));
  const owners = new Map(), assignments = [];
  function assign(slot, visited) {
    for(const p of pools[slots[slot]]) {
      const id=key(p); if(visited.has(id))continue;visited.add(id);
      if(!owners.has(id)||assign(owners.get(id),visited)){owners.set(id,slot);assignments[slot]=p;return true;}
    }
    return false;
  }
  for(let i=0;i<slots.length;i++)if(!assign(i,new Set()))throw new Error('符合条件的不重复题目不足，请减少题数或放宽条件；原训练已保留。');
  return assignments;
}
export function nextContestProblem(indices, contestId, current, states) {
  const ordered=[...new Set(indices)].filter(i=>/^[A-Za-z]\d*$/.test(i));
  const pos=ordered.indexOf(current);
  if(pos<0)return null;
  return [...ordered.slice(pos+1),...ordered.slice(0,pos)].find(i=>!states?.[`${contestId}/${i}`]?.solved) || null;
}
export function acceptedPracticeSubmission(pending,handle,path,submissions,now=Date.now()) {
  if(!pending?.practice||!Number.isFinite(pending.baseline)||!Number.isFinite(pending.started)||now-pending.started>20*60*1000||pending.started>now)return null;
  if(pending.handle?.toLowerCase()!==handle?.toLowerCase())return null;
  const contest=pending.key?.match(/^(\d+)\/[A-Za-z]\d*$/)?.[1];
  if(!contest||!new RegExp(`^/contest/${contest}/(?:my|status)/?$`).test(path))return null;
  return submissions.find(s=>s.verdict==='OK'&&s.problem&&key(s.problem)===pending.key&&s.id>pending.baseline&&s.creationTimeSeconds>=Math.floor(pending.started/1000)-2) || null;
}

export function nextSessionProblem(session,currentKey,states={}) {const items=session?.problems||[],pos=items.findIndex(p=>key(p)===currentKey);if(pos<0)return null;return [...items.slice(pos+1),...items.slice(0,pos)].find(p=>!states[key(p)]?.solved)||null;}
