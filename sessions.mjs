import {key,problemUrl} from './core.mjs';
import {statusOf} from './model.mjs';
export const libraryUrl=()=> 'https://codeforces.com/problemset?cfe=training';
export const sessionUrl=id=>`${libraryUrl()}&session=${encodeURIComponent(id)}`;
export const sessionProblemUrl=(id,p)=>`${problemUrl(p)}?cfeSession=${encodeURIComponent(id)}`;
export function readSessions(stored){
  const result=Array.isArray(stored.trainings)?structuredClone(stored.trainings):[];
  const old=stored.training;
  if(old?.id&&Array.isArray(old.problems)&&!result.some(s=>String(s.id)===String(old.id)))result.unshift({...structuredClone(old),id:String(old.id),viewed:{}});
  return result;
}
export function markViewed(sessions,id,problemKey,now=Date.now()){
  const result=structuredClone(sessions),s=result.find(s=>String(s.id)===String(id));
  if(!s)throw new Error('场次不存在，请返回题单列表。');
  if(!s.problems.some(p=>key(p)===problemKey))throw new Error('这道题不属于本场训练。');
  s.viewed||={};s.viewed[problemKey]={first:s.viewed[problemKey]?.first||now,last:now};return result;
}
export function sessionState(session,p,account){
  return {viewed:!!session.viewed?.[key(p)],state:account?.handle?statusOf(account.states,key(p)):'unknown'};
}
export function sessionProgress(session,account){
  return {total:session.problems.length,viewed:session.problems.filter(p=>sessionState(session,p,account).viewed).length,solved:session.problems.filter(p=>sessionState(session,p,account).state==='ac').length};
}
export const alias=i=>i<26?String.fromCharCode(65+i):'A'+String.fromCharCode(65+i-26);
