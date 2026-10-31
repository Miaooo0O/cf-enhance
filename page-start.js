// Runs synchronously during parsing, before the native page paints.
(() => {
 const storageKey='cfe.display.v1',training=location.pathname==='/problemset'&&new URL(location.href).searchParams.get('cfe')==='training';
 let cached={};try{cached=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
 function classes(p){const root=document.documentElement;if(!root)return;root.classList.toggle('cfe-training-page',training);for(const [key,cls]of Object.entries({hideTags:'cfe-hide-tags',hideRating:'cfe-hide-rating',focus:'cfe-focus',readable:'cfe-readable'}))root.classList.toggle(cls,!!p[key]);}
 const translator=window.__cfeCreateTranslator(document);translator.setEnabled(cached.chinese);classes(cached);
 function ratings(node){if(!node||node.nodeType!==1)return;for(const tag of [...(node.matches('.tag-box')?[node]:[]),...node.querySelectorAll('.tag-box')])tag.classList.toggle('cfe-rating',/^\*\d+$/.test(tag.textContent.trim()));}
 const observer=new MutationObserver(records=>{classes(cached);for(const r of records){if(r.type==='characterData'){translator.scan(r.target);ratings(r.target.parentElement);}else for(const node of r.addedNodes)if(node.nodeType===1){ratings(node);translator.scan(node);}}});
 observer.observe(document,{childList:true,characterData:true,subtree:true});
 function apply(p){cached=p||{};classes(cached);translator.setEnabled(cached.chinese);try{localStorage.setItem(storageKey,JSON.stringify(cached));}catch{}}
 const changed=(changes,area)=>{if(area==='local'&&changes.preferences)apply(changes.preferences.newValue);};
 chrome.storage.onChanged.addListener(changed);chrome.storage.local.get('preferences').then(s=>apply(s.preferences)).catch(()=>{});
 window.__cfeEarlyTranslator=translator;
 window.addEventListener('pagehide',()=>{observer.disconnect();chrome.storage.onChanged.removeListener(changed);if(window.__cfeEarlyTranslator===translator)delete window.__cfeEarlyTranslator;},{once:true});
})();
