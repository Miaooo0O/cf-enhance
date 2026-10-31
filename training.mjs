import {request,getLocal,listenStorage} from './client.mjs';
import {key} from './core.mjs';
import {libraryUrl,sessionUrl,sessionProblemUrl,sessionProgress,sessionState,alias} from './sessions.mjs';
import {tagNames,displayTag,normalizeTag} from './tags.mjs';
const stateNames={ac:'已通过',tried:'尝试中',new:'未提交',unknown:'未同步'};
const verdictNames={OK:'通过',WRONG_ANSWER:'答案错误',TIME_LIMIT_EXCEEDED:'超时',MEMORY_LIMIT_EXCEEDED:'超内存',RUNTIME_ERROR:'运行错误',COMPILATION_ERROR:'编译错误',TESTING:'评测中',SKIPPED:'跳过',REJECTED:'拒绝',PARTIAL:'部分通过',PRESENTATION_ERROR:'格式错误',FAILED:'评测失败',CHALLENGED:'被挑战'};
function el(tag,attrs={},text){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
const button=(text,fn)=>{const b=el('button',{type:'button'},text);b.addEventListener('click',fn);return b;};
const link=(text,url)=>el('a',{href:url},text);
export const isTrainingPage=()=>location.pathname==='/problemset'&&new URL(location.href).searchParams.get('cfe')==='training';
function table(headers){const t=el('table'),head=el('thead'),row=el('tr');for(const h of headers)row.append(el('th',{},h));head.append(row);const body=el('tbody');t.append(head,body);return {table:t,body};}
function cell(text){return el('td',{},text);}
function note(message){return el('p',{class:'cfe-session-note'},message);}

export async function mountTrainingPage({content,root}){
  if(!isTrainingPage())return false;
  document.documentElement.classList.add('cfe-training-page');document.title='题单 · Codeforces';
  document.querySelector('#cfe-training-nav')?.classList.add('current');
  const view=el('section',{id:'cfe-training-page'});content.replaceChildren(root,view);
  const sidebar=document.querySelector('#sidebar');if(sidebar)sidebar.hidden=true;
  const params=new URL(location.href).searchParams,selectedId=params.get('session');
  let sessions=await request('sessions');const stored=await getLocal(['account','preferences','settings','trainingTrash']);let deleted=stored.trainingTrash||[],account=stored.account,chinese=!!stored.preferences?.chinese;
  let selected=sessions.find(s=>String(s.id)===selectedId);
  const nav=el('div',{class:'cfe-session-nav'});nav.append(link('题单 / 全部场次',libraryUrl()));if(selected)nav.append(el('span',{},' » '+selected.name));view.append(nav);
  const heading=el('h1',{},selected?.name||'我的训练场次');view.append(heading);
  const info=el('p',{role:'status','aria-live':'polite',class:'cfe-session-note'});view.append(info);
  if(selectedId&&!selected)info.textContent='这场训练不存在或已被删除。';
  async function changeSession(id,restore=false){const name=(restore?deleted:sessions).find(s=>String(s.id)===String(id))?.name||'题单';info.textContent=restore?'正在恢复…':'正在删除…';try{const result=await request(restore?'restoreSession':'deleteSession',{id});sessions=result.sessions;deleted=result.deleted;render();info.replaceChildren(document.createTextNode((restore?'已恢复':'已删除')+'「'+name+'」。'));if(!restore){const undo=button('撤销删除',()=>{void changeSession(id,true);});undo.className='cfe-session-restore';info.append(undo);}}catch(e){info.textContent=e.message;}}
  const accountBar=el('div',{class:'cfe-session-controls'}),handle=el('input',{placeholder:'CF handle','aria-label':'CF handle',value:account?.handle||''});
  const sync=button('同步做题状态',async()=>{sync.disabled=true;info.textContent='正在同步完整提交记录…';try{account=await request('sync',{handle:handle.value.trim(),force:true});render();info.textContent='做题状态已更新。';}catch(e){info.textContent=e.message;}finally{sync.disabled=false;}});accountBar.append(handle,sync);view.append(accountBar);
  const output=el('div',{id:'cfe-session-output'});
  let search,filter,detailControls;
  if(selectedId){
    const controls=el('div',{class:'cfe-session-controls'});detailControls=controls;search=el('input',{type:'search',placeholder:'搜索本场题目','aria-label':'搜索本场题目'});filter=el('select',{'aria-label':'筛选本场状态'});
    for(const [value,title]of [['all','全部题目'],['unviewed','未看过'],['viewed','已看过'],['new','未提交'],['tried','尝试中'],['ac','已通过']])filter.append(el('option',{value},title));
    search.oninput=render;filter.onchange=render;const remove=button('删除本场题单',()=>{void changeSession(selectedId);});remove.className='cfe-session-delete';controls.append(search,filter,remove);view.append(controls);
  }else{
    const builder=el('details',{class:'cfe-session-builder'});builder.open=!sessions.length;builder.append(el('summary',{},'创建新场次'));view.append(builder);
    const name=el('input',{placeholder:'场次名称',maxlength:'80',value:'我的训练'}),nameLabel=el('label',{},'场次名称 ');nameLabel.append(name);builder.append(nameLabel);
    builder.append(note('每行一组条件，支持混合分数、题数和标签；最多 12 组、总计 50 题。每次生成都会创建新场次，已有场次保留。'));
    const options=el('div',{class:'cfe-session-controls'}),exclude=el('select',{'aria-label':'排除题目'});for(const [v,t]of [['ac','排除已 AC'],['tried','排除尝试过'],['none','不排除提交过的题']])exclude.append(el('option',{value:v},t));exclude.value=stored.settings?.exclude||'ac';
    const noRepeat=el('input',{type:'checkbox'});noRepeat.checked=stored.settings?.noRepeat??true;const repeatLabel=el('label',{},' 排除以前抽过的题');repeatLabel.prepend(noRepeat);options.append(exclude,repeatLabel);builder.append(options);
    const groups=el('div',{class:'cfe-groups'}),suggestions=el('datalist',{id:'cfe-session-tags'});builder.append(groups,suggestions);
    let validTags=new Set(Object.keys(tagNames));
    function renderSuggestions(){suggestions.replaceChildren();for(const t of [...validTags].sort())suggestions.append(el('option',{value:displayTag(t,chinese)},chinese?(tagNames[t]||t):t));}
    renderSuggestions();
    request('database').then(db=>{validTags=new Set(db.problems.flatMap(p=>p.tags));renderSuggestions();}).catch(e=>info.textContent=e.message);
    function group(g={min:1400,max:1600,count:2,tags:[]}){
      const row=el('div',{class:'cfe-group'}),fields={};
      for(const [id,label,value]of [['min','最低分',g.min],['max','最高分',g.max],['count','题数',g.count]]){const l=el('label',{},label),input=el('input',{type:'number',value:String(value),min:id==='count'?'1':'0',step:id==='count'?'1':'100','aria-label':label});l.append(input);fields[id]=input;row.append(l);}
      const tags=el('input',{placeholder:'标签：动态规划, 数学','aria-label':'本组标签',list:'cfe-session-tags',value:(g.tags||[]).join(', ')}),mode=el('select',{'aria-label':'标签匹配'});mode.append(el('option',{value:'all'},'包含全部标签'),el('option',{value:'any'},'包含任一标签'));
      row.append(tags,mode,button('移除',()=>{if(groups.children.length>1)row.remove();}));row.read=()=>({min:Number(fields.min.value),max:Number(fields.max.value),count:Number(fields.count.value),tags:tags.value.split(/[,，]/).map(normalizeTag).filter(Boolean),mode:mode.value});groups.append(row);
    }
    group({min:1200,max:1400,count:2});group({min:1600,max:1800,count:2});
    const actions=el('div',{class:'cfe-session-controls'}),generate=button('创建场次并进入',async()=>{
      generate.disabled=true;info.textContent='正在生成新场次…';try{
        if(exclude.value!=='none'&&account&&handle.value.trim().toLowerCase()!==account.handle.toLowerCase())throw new Error('handle 已更改，请先同步新账号。');
        const conditions=[...groups.children].map(g=>g.read()),db=await request('database'),valid=new Set(db.problems.flatMap(p=>p.tags)),unknown=conditions.flatMap(g=>g.tags).find(t=>!valid.has(t));if(unknown)throw new Error('未知标签：'+unknown);
        const training=await request('training',{name:name.value,groups:conditions,options:{exclude:exclude.value,noRepeat:noRepeat.checked}});location.assign(sessionUrl(training.id));
      }catch(e){info.textContent=e.message;generate.disabled=false;}
    });actions.append(button('添加一组',()=>{if(groups.children.length<12)group();}),generate);builder.append(actions);
    // Refresh suggestion labels without replacing an in-progress form.
    const onPreferences=(changes,area)=>{if(area==='local'&&changes.preferences){chinese=!!changes.preferences.newValue?.chinese;renderSuggestions();}};const unlistenPreferences=listenStorage(onPreferences);window.addEventListener('pagehide',unlistenPreferences,{once:true});
  }
  view.append(output);
  function render(){
    selected=sessions.find(s=>String(s.id)===selectedId);output.replaceChildren();if(detailControls)detailControls.hidden=!!selectedId&&!selected;if(selectedId&&!selected){heading.textContent=deleted.some(s=>String(s.id)===selectedId)?'题单已删除':'找不到题单';output.append(note('这场题单不存在或已删除，跳题记录和 CF 做题状态仍保留。'),link('返回题单列表',libraryUrl()));if(deleted.some(s=>String(s.id)===selectedId))output.append(button('恢复本场题单',()=>{void changeSession(selectedId,true);}));return;}
    if(selected){
      const progress=sessionProgress(selected,account);document.title=selected.name+' · 训练场次';heading.textContent=selected.name;
      output.append(note(`${progress.total} 道题 · 已看 ${progress.viewed} · AC ${progress.solved} · ${account?.handle?'做题账号 '+account.handle:'未同步账号，做题状态未知'} · 创建于 ${new Date(selected.created).toLocaleString('zh-CN')}`));
      const {table:t,body}=table(['题号','题目','分数','标签','看题情况','做题状态','最近结果']);
      selected.problems.forEach((p,i)=>{
        const s=sessionState(selected,p,account),query=search.value.trim().toLowerCase(),wanted=filter.value;
        if(query&&!(`${alias(i)} ${p.name} ${key(p)}`).toLowerCase().includes(query))return;
        if(wanted==='unviewed'&&s.viewed||wanted==='viewed'&&!s.viewed||['ac','tried','new'].includes(wanted)&&wanted!==s.state)return;
        const row=el('tr',{'data-state':s.state});const title=cell();title.append(link(p.name,sessionProblemUrl(selected.id,p)));const tags=cell((p.tags||[]).map(t=>displayTag(t,chinese)).join(', '));tags.className='cfe-session-tags';const rating=cell(String(p.rating||'—'));rating.className='cfe-session-rating';
        row.append(cell(alias(i)),title,rating,tags,cell(s.viewed?'已看':'未看'),cell(stateNames[s.state]),cell(verdictNames[account?.states?.[key(p)]?.verdict]||account?.states?.[key(p)]?.verdict||'—'));body.append(row);
      });output.append(t);if(!body.children.length)output.append(note('没有符合筛选条件的题目。'));
    }else{
      const {table:t,body}=table(['场次','题数','已看','AC','创建时间','操作']);for(const s of sessions){const p=sessionProgress(s,account),title=cell();title.append(link(s.name,sessionUrl(s.id)));const row=el('tr');row.append(title,cell(String(p.total)),cell(String(p.viewed)),cell(account?String(p.solved):'未同步'),cell(new Date(s.created).toLocaleString('zh-CN')));const actions=cell(),remove=button('删除',()=>{void changeSession(s.id);});remove.className='cfe-session-delete';remove.setAttribute('aria-label','删除题单 '+s.name);actions.append(remove);row.append(actions);body.append(row);}output.append(t);if(!sessions.length)output.append(note('还没有训练场次，创建后会一直保存在这里。'));if(deleted.length){const trash=el('details',{class:'cfe-session-trash'});trash.append(el('summary',{},'已删除题单（'+deleted.length+'）'));for(const s of deleted){const row=el('div',{class:'cfe-session-trash-row'}),restore=button('恢复',()=>{void changeSession(s.id,true);});restore.className='cfe-session-restore';row.append(el('span',{},s.name),restore);trash.append(row);}output.append(trash);}
    }
  }
  render();
  const onChange=(changes,area)=>{if(area!=='local')return;if(changes.account)account=changes.account.newValue;if(changes.trainings)sessions=changes.trainings.newValue||[];if(changes.trainingTrash)deleted=changes.trainingTrash.newValue||[];if(changes.preferences)chinese=!!changes.preferences.newValue?.chinese;if(changes.account||changes.trainings||changes.trainingTrash||changes.preferences)render();};const unlisten=listenStorage(onChange);window.addEventListener('pagehide',unlisten,{once:true});
  return true;
}

export async function mountSessionContext(problem,id){
  const sessions=await request('sessions'),session=sessions.find(s=>String(s.id)===String(id));
  if(!session||!session.problems.some(p=>key(p)===key(problem)))return;
  let current=await request('viewed',{id,key:key(problem)}),account=(await getLocal('account')).account;
  const box=el('div',{id:'cfe-session-sidebar',class:'roundbox'}),caption=el('div',{class:'caption titled'},'→ 本场训练'),body=el('div',{class:'cfe-session-sidebody'});box.append(caption,body);
  const sidebar=document.getElementById('sidebar');if(sidebar)sidebar.prepend(box);else document.getElementById('cfe-root')?.after(box);
  function render(){if(!current){body.replaceChildren(note('本场题单已删除'),link('返回题单列表',libraryUrl()));return;}body.replaceChildren(link(current.name,sessionUrl(id)));const p=sessionProgress(current,account);body.append(note(`已看 ${p.viewed}/${p.total} · AC ${p.solved}/${p.total}`));const list=el('ol');current.problems.forEach((p,i)=>{const s=sessionState(current,p,account),li=el('li');if(key(p)===key(problem))li.className='cfe-session-current';li.append(link(`${alias(i)}. ${p.name}`,sessionProblemUrl(id,p)),el('small',{},` ${s.viewed?'已看':'未看'} · ${stateNames[s.state]}`));list.append(li);});body.append(list,link('返回本场 / 自由选题',sessionUrl(id)));}render();
  const listener=(changes,area)=>{if(area!=='local')return;if(changes.account)account=changes.account.newValue;if(changes.trainings)current=changes.trainings.newValue?.find(s=>String(s.id)===String(id))||null;if(changes.account||changes.trainings)render();};const unlisten=listenStorage(listener);window.addEventListener('pagehide',unlisten,{once:true});
}
