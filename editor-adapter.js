// MAIN world: only synchronize the existing CF editor with its native textarea.
// This adapter never submits a form, reads credentials or executes received code.
document.addEventListener('cfe-editor-fill',event=>{
 const {nonce,source}=event.detail||{};if(typeof nonce!=='string'||typeof source!=='string'||source.length>1024*1024)return;
 const field=document.querySelector('textarea[name="source"],textarea#sourceCodeTextarea');if(!field)return;
 const mirror=document.querySelector('.CodeMirror')?.CodeMirror;
 if(mirror){mirror.setValue(source);mirror.save();}
 else if(window.ace&&document.querySelector('#editor')){try{window.ace.edit('editor').setValue(source,-1);}catch{}}
 field.value=source;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
 document.dispatchEvent(new CustomEvent('cfe-editor-filled',{detail:{nonce}}));
});
document.addEventListener('cfe-editor-sync',()=>{try{document.querySelector('.CodeMirror')?.CodeMirror?.save();}catch{}});
