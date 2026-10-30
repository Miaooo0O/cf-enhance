import {request,getLocal,setLocal,listenStorage,contextActive,isContextError,refreshMessage} from './client.mjs';
import {key,problemUrl} from './core.mjs';
import {statusOf,acceptedPracticeSubmission} from './model.mjs';
import {mountPicker} from './popup.mjs';
import {createTranslator} from './i18n.mjs';
import {libraryUrl,sessionUrl} from './sessions.mjs';
import {mountTrainingPage,mountSessionContext} from './training.mjs';
const defaults={hideTags:false,hideRating:false,focus:false,readable:false,chinese:false};
function el(tag,attrs={},text){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else n.setAttribute(k,v);}if(text!==undefined)n.textContent=text;return n;}
const button=(text,fn)=>{const b=el('button',{type:'button'},text);b.addEventListener('click',fn);return b;};
export function pageProblem(path=location.pathname){const m=path.match(/^\/(?:problemset\/problem\/(\d+)|contest\/(\d+)\/problem)\/([A-Za-z]\d*)\/?$/);return m?{contestId:Number(m[1]||m[2]),index:m[3]}:null;}
function loginHandle(){const links=document.querySelectorAll('#header .lang-chooser a[href*="/profile/"]');return links.length?decodeURIComponent(new URL(links[0].href,location.href).pathname.split('/').pop()):'';}
export async function mount(){
  if(document.getElementById('cfe-root'))return;
  const content=document.querySelector('#pageContent')||document.querySelector('#body')||document.body;
  const root=el('section',{id:'cfe-root','aria-label':'Codeforces 增强工具'}),bar=el('div',{class:'cfe-bar'}),panels=el('div');
  root.append(bar,panels);const nativeMenu=content.querySelector('.second-level-menu');if(nativeMenu)nativeMenu.after(root);else content.prepend(root);
  const notice=el('p',{id:'cfe-notice',role:'status',class:'cfe-hint'});root.append(notice);
  let stopped=false,timer;const cleanups=[];
  function stop(){if(stopped)return;stopped=true;clearInterval(timer);for(const cleanup of cleanups.splice(0))cleanup();}
  function invalidated(){stop();notice.textContent=refreshMessage;for(const n of root.querySelectorAll('button,input,select'))n.disabled=true;}
  window.addEventListener('cfe-context-invalidated',invalidated);window.addEventListener('pagehide',stop,{once:true});cleanups.push(()=>window.removeEventListener('cfe-context-invalidated',invalidated));
  let stored=await getLocal(['preferences','account']);
  let preferences={...defaults,...stored.preferences},account=stored.account;
  const panelMap=new Map();let active='',pickerAssets,pickerDispose,trainingNav,languageNav;
  const translator=createTranslator(document);
  function tab(name,title){const p=el('div',{class:'cfe-panel roundbox',hidden:''});const b=button(title,()=>open(name).catch(e=>{notice.textContent=e.message;}));b.className='cfe-tab';b.setAttribute('aria-expanded','false');bar.append(b);panels.append(p);panelMap.set(name,{p,b});return p;}
  async function open(name){pickerDispose?.();pickerDispose=null;active=active===name?'':name;for(const [id,{p,b}]of panelMap){p.hidden=id!==active;b.setAttribute('aria-expanded',String(id===active));}
    if(active==='picker'||active==='history'){
      pickerAssets ||= Promise.all(['popup.html','popup.css'].map(file=>fetch(chrome.runtime.getURL(file)).then(r=>{if(!r.ok)throw new Error('面板加载失败，请刷新网页。');return r.text();}))).catch(e=>{pickerAssets=null;throw e;});
      const [html,css]=await pickerAssets;if(active!==name)return;
      const p=panelMap.get(name).p;p.replaceChildren();const host=el('div'),shadow=host.attachShadow({mode:'open'}),style=el('style');style.textContent=css;
      const wrapper=el('div');wrapper.append(document.importNode(new DOMParser().parseFromString(html,'text/html').querySelector('main'),true));shadow.append(style,wrapper);p.append(host);
      const dispose=await mountPicker(shadow,{view:name,embedded:true});if(active!==name)dispose();else pickerDispose=dispose;
    }
  }
  tab('picker','随机跳题');tab('history','刷题记录');const prefsPanel=tab('preferences','显示设置');
  function applyPreferences(){
    for(const [field,cls]of Object.entries({hideTags:'cfe-hide-tags',hideRating:'cfe-hide-rating',focus:'cfe-focus',readable:'cfe-readable'}))document.documentElement.classList.toggle(cls,!!preferences[field]);
    for(const n of document.querySelectorAll('.tag-box'))n.classList.toggle('cfe-rating',/^\*\d+$/.test(n.textContent.trim()));
    translator.setEnabled(preferences.chinese);
    if(languageNav){languageNav.textContent=preferences.chinese?'English':'中文';languageNav.setAttribute('aria-pressed',String(preferences.chinese));}
  }
  const prefInputs={};
  function prefCheck(field,text){const input=el('input',{type:'checkbox'});input.checked=preferences[field];input.onchange=async()=>{preferences[field]=input.checked;applyPreferences();try{await request('save',{field:'preferences',value:preferences});}catch(e){notice.textContent=e.message;}};const label=el('label');label.append(input,document.createTextNode(text));prefsPanel.append(label);prefInputs[field]=input;return input;}
  prefsPanel.append(el('h3',{},'原网页显示'));
  const tagCheck=prefCheck('hideTags','隐藏题目标签'),ratingCheck=prefCheck('hideRating','隐藏分数');prefCheck('focus','专注题面（收起侧栏）');prefCheck('readable','放大题面与行距');
  const chineseCheck=prefCheck('chinese','中文界面（仅菜单与按钮）');
  prefsPanel.append(el('p',{class:'cfe-hint'},'设置会在所有 CF 页面间同步。标签与分数可分别显示；专注模式可随时关闭。'));
  const quickTags=button('',()=>{tagCheck.checked=!preferences.hideTags;tagCheck.dispatchEvent(new Event('change'));quickLabels();});
  const quickRating=button('',()=>{ratingCheck.checked=!preferences.hideRating;ratingCheck.dispatchEvent(new Event('change'));quickLabels();});
  function quickLabels(){quickTags.textContent=preferences.hideTags?'显示标签':'隐藏标签';quickRating.textContent=preferences.hideRating?'显示分数':'隐藏分数';}
  bar.append(quickTags,quickRating);quickLabels();applyPreferences();
  const help=[...document.querySelectorAll('a[href]')].find(a=>a.getAttribute('href')==='/help'&&a.closest('li'));
  if(help){
    const item=el('li',{id:'cfe-training-nav'});trainingNav=el('a',{href:libraryUrl()},'题单');
    item.append(trainingNav);help.closest('li').after(item);
    const languageItem=el('li',{id:'cfe-language-nav'});languageNav=el('a',{href:'#cfe-language',role:'button','aria-pressed':String(preferences.chinese)},preferences.chinese?'English':'中文');
    languageNav.addEventListener('click',event=>{event.preventDefault();chineseCheck.checked=!preferences.chinese;chineseCheck.dispatchEvent(new Event('change'));});languageItem.append(languageNav);item.after(languageItem);
  }else bar.append(el('a',{href:libraryUrl()},'题单'));
  let scheduled=false;const observer=new MutationObserver(records=>{if(!scheduled&&records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.tag-box')||n.querySelector?.('.tag-box'))))){scheduled=true;setTimeout(()=>{scheduled=false;applyPreferences();},100);}});observer.observe(document.body,{childList:true,subtree:true});
  const languageObserver=new MutationObserver(records=>{if(!preferences.chinese)return;for(const r of records){if(r.type==='characterData')translator.scan(r.target);else for(const n of r.addedNodes)if(n.nodeType===1)translator.scan(n);}});languageObserver.observe(document.body,{childList:true,characterData:true,subtree:true});
  cleanups.push(()=>observer.disconnect(),()=>languageObserver.disconnect(),()=>pickerDispose?.());
  for(const block of document.querySelectorAll('.sample-test .input,.sample-test .output')){
    if(block.querySelector('.input-output-copier,.cfe-copy'))continue;
    const title=block.querySelector('.title'),pre=block.querySelector('pre');if(!title||!pre)continue;
    title.append(button('复制',async event=>{const b=event.currentTarget;try{await navigator.clipboard.writeText(pre.innerText);b.textContent='已复制';}catch{b.textContent='复制失败';}setTimeout(()=>b.textContent='复制',1500);}));title.lastChild.classList.add('cfe-copy');
  }
  const current=pageProblem();let completedKey=current?key(current):null;
  let completedSession=new URL(location.href).searchParams.get('cfeSession');
  await mountTrainingPage({content,root});
  if(current&&completedSession)await mountSessionContext(current,completedSession);
  const ac=el('div',{id:'cfe-ac',hidden:'','role':'status','aria-live':'polite'}),acLabel=el('strong',{},'AC'),acText=el('p');
  const next=button('再跳一题 →',async()=>{next.disabled=true;try{if(completedSession){location.assign(sessionUrl(completedSession));return;}const p=await request('draw',{omitKey:completedKey});location.assign(problemUrl(p));}catch(e){acText.textContent=e.message;next.disabled=false;}});ac.append(acLabel,acText,next);if(completedSession)next.textContent='返回本场选题 →';if(current)root.after(ac);
  let celebrated=false;
  function renderAC(){if(!current)return;const solved=account?.states?.[key(current)]?.solved;ac.hidden=!solved;
    if(solved){acText.replaceChildren(document.createTextNode(`${current.contestId}${current.index} · Accepted`),el('span',{class:'cfe-sub'},`${account.handle} 已通过这道题`));if(!celebrated){celebrated=true;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)ac.animate?.([{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}],{duration:320});}}
  }
  renderAC();
  // Only practice polling is implemented. Future contest/VS Code integration
  // must use its own explicit session and submission IDs (docs/INTEGRATION.md).
  let polling=false,latestSubmissionId=null;
  async function checkRecent(force=false){
    if(stopped||polling||document.hidden||!account?.handle)return;
    if(!contextActive()){invalidated();return;}
    polling=true;
    try{
    const pending=(await getLocal('pendingSubmit')).pendingSubmit;
    const practice=current&&location.pathname.startsWith('/problemset/');
    const pendingContest=pending?.key?.split('/')[0];
    const resultPage=pendingContest&&new RegExp(`^/contest/${pendingContest}/(?:my|status)/?$`).test(location.pathname);
    const pendingPractice=resultPage&&pending?.practice&&pending.handle.toLowerCase()===account.handle.toLowerCase()&&Date.now()-pending.started<20*60*1000;
    if(!practice&&!pendingPractice&&!force)return;
    const recent=await request('recent',{handle:account.handle,force});latestSubmissionId=Math.max(0,...recent.map(s=>s.id));if(force)notice.textContent='提交状态已检查。';
      if(pendingPractice){const accepted=acceptedPracticeSubmission(pending,account.handle,location.pathname,recent);
        if(accepted){completedKey=pending.key;if(pending.sessionId){completedSession=pending.sessionId;next.textContent='返回本场选题 →';}if(!ac.isConnected)root.after(ac);ac.hidden=false;acText.replaceChildren(document.createTextNode(`${pending.key.replace('/','')} · Accepted`),el('span',{class:'cfe-sub'},'本次提交已通过，继续下一道练习吧。'));await request('save',{field:'pendingSubmit',value:null});}
      }
    }catch(e){if(isContextError(e))invalidated();else notice.textContent='状态同步失败：'+e.message;}finally{polling=false;}
  }
  const submitMatch=location.pathname.match(/^\/contest\/(\d+)\/submit\/?$/),fromPractice=new URL(location.href).searchParams.get('cfePractice')==='1';
  if(submitMatch&&fromPractice){
    let baseline=null;const handle=loginHandle()||account?.handle;
    if(handle)request('recent',{handle}).then(s=>baseline=Math.max(0,...s.map(x=>x.id))).catch(e=>{if(isContextError(e))invalidated();});
    const form=document.querySelector('select[name="submittedProblemIndex"]')?.closest('form');
    form?.addEventListener('submit',()=>{const index=form.querySelector('select[name="submittedProblemIndex"]')?.value;if(!handle||baseline===null||!index)return;
      setLocal({pendingSubmit:{key:`${submitMatch[1]}/${index}`,handle,baseline,started:Date.now(),practice:true,sessionId:completedSession}}).catch(e=>{notice.textContent=e.message;});
    });
  }
  if(current&&location.pathname.startsWith('/problemset/')){
    // The native problem-page sidebar also has a quick file submission form.
    // Observe it without cancelling submission or changing any form values.
    for(const form of document.querySelectorAll('form')){
      const action=new URL(form.getAttribute('action')||location.href,location.href);
      if(!action.pathname.includes('/submit'))continue;
      form.addEventListener('submit',()=>{
        const handle=loginHandle()||account?.handle;
        if(!handle||latestSubmissionId===null||handle.toLowerCase()!==account?.handle.toLowerCase())return;
        setLocal({pendingSubmit:{key:key(current),handle,baseline:latestSubmissionId,started:Date.now(),practice:true,sessionId:completedSession}}).catch(e=>{notice.textContent=e.message;});
      });
    }
  }
  const manual=button('检查 AC 状态',async()=>{manual.disabled=true;try{await checkRecent(true);if(!account)await open('picker');}catch(e){notice.textContent=e.message;}finally{manual.disabled=stopped;}});if(current)bar.append(manual);
  timer=setInterval(()=>{void checkRecent();},30000);const visibility=()=>{if(!document.hidden)void checkRecent();};document.addEventListener('visibilitychange',visibility);cleanups.push(()=>document.removeEventListener('visibilitychange',visibility));void checkRecent();
  const unlisten=listenStorage((changes,area)=>{if(area!=='local')return;
    if(changes.account){account=changes.account.newValue;renderAC();}
    if(changes.preferences){preferences={...defaults,...changes.preferences.newValue};for(const [k,n]of Object.entries(prefInputs))n.checked=preferences[k];quickLabels();applyPreferences();}
  });cleanups.push(unlisten);
}
