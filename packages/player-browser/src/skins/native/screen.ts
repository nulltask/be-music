/** A skin owns a shadow tree, so page CSS and skin CSS cannot accidentally style each other's controls. */
export function createScreen(container: HTMLElement, kind: string, markup: string): HTMLElement {
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { container-type:size; color-scheme: dark; font-family: system-ui, sans-serif; color: #edf2fa; }
    * { box-sizing: border-box; }
    .screen { height:100%; overflow:auto; pointer-events:auto; background:#10151f; padding:clamp(16px,3vw,36px); }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; }
    h1,h2,p { margin:0; } h1 { font-size:clamp(22px,3vw,36px); letter-spacing:-.035em; } h2 { font-size:18px; }
    .eyebrow { color:#8da7c7; letter-spacing:.14em; font-size:11px; text-transform:uppercase; margin-bottom:8px; }
    .muted { color:#9baac0; font-size:13px; line-height:1.7; }
    button,input,select { font:inherit; color:inherit; border:1px solid #38465c; border-radius:8px; background:#1a2433; padding:10px 14px; }
    button { cursor:pointer; } button:hover { background:#293950; } button:disabled { opacity:.45; cursor:default; }
    :focus-visible { outline:3px solid #91bfff; outline-offset:2px; }
    .primary { background:#abcaff; color:#10151f; border-color:#abcaff; font-weight:700; }
    .primary:hover { background:#d4e4ff; } .actions { display:flex; gap:8px; flex-wrap:wrap; }
    .columns { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(220px,1fr); gap:24px; }
    .panel { background:#18212f; border:1px solid #2c394c; border-radius:14px; padding:20px; }
    .options { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0; } label { display:grid; gap:6px; color:#b8c7da; font-size:12px; }
    input[type=search] { width:min(380px,100%); } .rows { list-style:none; margin:0; padding:0; max-height:55vh; overflow:auto; overscroll-behavior:contain; }
    .row { display:grid; grid-template-columns:48px 1fr; gap:12px; width:100%; text-align:left; margin-bottom:5px; border-color:transparent; }
    .row[aria-current=true] { background:#293d59; border-color:#8fbaff; }
    .row strong { display:block; overflow-wrap:anywhere; } .badge { color:#a9c8f8; font-variant-numeric:tabular-nums; }
    .details { display:grid; align-content:start; gap:18px; } .stat { font-size:clamp(24px,4vw,44px); font-variant-numeric:tabular-nums; font-weight:700; }
    dl { display:grid; grid-template-columns:1fr auto; gap:10px 18px; } dt { color:#9baac0; } dd { margin:0; font-variant-numeric:tabular-nums; }
    meter,progress { width:100%; height:18px; accent-color:#9cc4ff; } pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:30vh; overflow:auto; }
    .center { display:grid; place-content:center; gap:20px; max-width:720px; margin:auto; min-height:100%; }
    .gameplay { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(100cqw,calc(100cqh * var(--stage-ratio,1))); height:min(100cqh,calc(100cqw / var(--stage-ratio,1))); container-type:size; pointer-events:none; }
    .hud { position:absolute; right:2.8%; bottom:2%; width:32%; max-height:40%; overflow:auto; pointer-events:auto; padding:8px; background:#18212fee; border:1px solid #38465c; border-radius:8px; font-size:clamp(10px,1.4cqw,14px); }
    .hud-heading { display:flex; align-items:baseline; gap:6px; min-width:0; }
    .hud .eyebrow { margin:0; font-size:.75em; white-space:nowrap; }
    .hud h2 { font-size:1em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
    .hud .muted { font-size:.85em; line-height:1.2; }
    .hud-score { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
    .hud .stat { font-size:1.8em; }
    .hud dl { display:flex; flex-wrap:wrap; gap:4px 6px; margin:4px 0; font-size:.85em; }
    .hud dd { margin-right:6px; }
    .hud-gauge { gap:2px; font-size:.8em; }
    .hud meter { height:10px; }
    .hud button { padding:4px 8px; font-size:.85em; }
    .hud .actions { margin-top:4px; gap:4px; }
    .gameplay[data-orientation=portrait] .hud { top:.9%; left:2.5%; right:auto; bottom:auto; width:75%; height:11.5%; max-height:none; padding:2px 4px; border:0; border-radius:0; font-size:clamp(9px,2.5cqw,14px); }
    .gameplay[data-orientation=portrait] .hud-heading [data-stage] { margin-left:auto; }
    .gameplay[data-orientation=portrait] .hud-score { float:right; }
    .gameplay[data-orientation=portrait] .hud .stat { font-size:1.3em; }
    .gameplay[data-orientation=portrait] .hud dl { margin:2px 0; }
    .gameplay[data-orientation=portrait] .hud-gauge { display:flex; align-items:center; gap:6px; }
    .gameplay[data-orientation=portrait] .hud meter { flex:1; min-width:0; }
    .gameplay[data-orientation=portrait] .hud button { padding:2px 6px; }
    @media(max-width:650px) { .columns { grid-template-columns:1fr; } .rows { max-height:43vh; } header { flex-wrap:wrap; } }
    @media(prefers-reduced-motion:no-preference) { button { transition:background .12s; } }
  `;
  const root = document.createElement('section');
  root.className = kind === 'gameplay' ? 'gameplay' : 'screen';
  root.dataset.nativeScreen = kind;
  // Markup is a skin-authored literal. Chart metadata is always assigned with textContent below.
  root.innerHTML = markup;
  shadow.append(style, root);
  return root;
}

export function setText(element: Element, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing native skin element: ${selector}`);
  return found;
}
