(() => {
  const problem=location.pathname.match(/^\/(?:problemset\/problem|contest)\/(\d+)\/(?:problem\/)?([A-Za-z]\d*)\/?$/);
  if(problem){
    // Carry the exact problem in each link; no shared "last problem" state that
    // could mix up two simultaneously opened problem tabs.
    const session=new URL(location.href).searchParams.get('cfeSession');
    const mode=new URL(location.href).searchParams.get('cfeMode');
    const destination=`/contest/${problem[1]}/submit?submittedProblemIndex=${encodeURIComponent(problem[2])}&cfePractice=1`+(session?`&cfeSession=${encodeURIComponent(session)}`:'')+(mode==='random'?'&cfeMode=random':'');
    function updateLinks(){
      for(const link of document.querySelectorAll('a[href]')){
        let url;try{url=new URL(link.getAttribute('href'),location.href);}catch{continue;}
        if(url.origin===location.origin&&(/^\/problemset\/submit\/?$/.test(url.pathname)||url.pathname===`/contest/${problem[1]}/submit`))link.setAttribute('href',destination);
      }
    }
    updateLinks();
    let scheduled=false;
    const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;updateLinks();},100);}});
    // Only watch newly inserted links; changing href does not retrigger this.
    observer.observe(document.body,{childList:true,subtree:true});
  }
  const submit=location.pathname.match(/^\/contest\/(\d+)\/submit\/?$/);
  const index=new URL(location.href).searchParams.get('submittedProblemIndex');
  if(!submit||!index||!/^[A-Za-z]\d*$/.test(index))return;
  let finished=false;
  function fill(){
    const field=document.querySelector('select[name="submittedProblemIndex"]');
    if(!field)return;
    if(field.value&&field.value!==index){finished=true;return;}
    if(!Array.from(field.options).some(option=>option.value===index))return;
    if(field.value!==index){field.value=index;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
    finished=true;
  }
  fill();
  if(!finished){const observer=new MutationObserver(()=>{fill();if(finished)observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),15000);}
  // Never submit the form or modify language/source fields.
})();
