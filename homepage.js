(() => {
  if (!/^\/(?:index\/\d+\/?)?$/.test(location.pathname)) return;
  if (document.getElementById('cf-random-picker-home')) return;
  const host = document.createElement('div');
  host.id = 'cf-random-picker-home';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif; }
    button { font: inherit; cursor: pointer; }
    .launch { position: fixed; right: 24px; bottom: 28px; z-index: 2147483646;
      border: 1px solid #3b8b71; border-radius: 12px; background: #146b54;
      color: white; padding: 13px 21px; box-shadow: 0 5px 20px #102c3526; font-weight: 700; }
    .launch:hover { background: #105540; }
    button:focus-visible { outline: 3px solid #e4a856; outline-offset: 3px; }
    dialog { position: fixed; border: 0; border-radius: 14px; padding: 0;
      width: min(410px, calc(100vw - 24px)); max-width: none;
      max-height: calc(100vh - 24px); background: #f3f6f5; box-shadow: 0 12px 70px #0004; }
    dialog::backdrop { background: #102c3566; }
    .bar { display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; color: #526e61; border-bottom: 1px solid #dde5e0; font-size: 12px; }
    .close { border: 0; background: transparent; color: #526e61; padding: 3px 8px; font-size: 20px; }
    iframe { display: block; border: 0; width: 100%; height: min(700px, calc(100vh - 86px)); }
  `;
  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.type = 'button';
  launch.textContent = '随机跳题 ↗';
  launch.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'CF Random 随机跳题');
  const bar = document.createElement('div');
  bar.className = 'bar';
  const caption = document.createElement('span');
  caption.textContent = 'CF Random · 筛选与抽题';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭随机跳题面板');
  bar.append(caption, close);
  dialog.append(bar);
  let frame;
  launch.addEventListener('click', () => {
    // Refresh settings/history when reopening after toolbar usage.
    frame?.remove();
    frame = document.createElement('iframe');
    frame.title = '随机跳题筛选面板';
    frame.src = chrome.runtime.getURL('popup.html');
    dialog.append(frame);
    dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { frame?.remove(); frame = undefined; launch.focus(); });
  shadow.append(style, launch, dialog);
  document.body.append(host);
})();
