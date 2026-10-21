/** A skin owns a shadow tree, so page CSS and skin CSS cannot accidentally style each other's controls. */
export function createScreen(container: HTMLElement, kind: string, markup: string): HTMLElement {
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: dark; font-family: system-ui, sans-serif; color: #edf2fa; }
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
    .hud { position:absolute; right:3%; bottom:5%; width:38%; max-width:420px; max-height:60%; overflow:auto; pointer-events:auto; padding:18px; background:#18212fee; border:1px solid #38465c; border-radius:14px; }
    .hud .stat { font-size:clamp(20px,3.5vw,40px); } .hud h2 { font-size:14px; } .hud dl { margin:10px 0; gap:5px; font-size:12px; }
    .hud button { padding:7px 10px; font-size:12px; } .hud .actions { margin-top:12px; }
    @media(max-width:650px) { .columns { grid-template-columns:1fr; } .rows { max-height:43vh; } header { flex-wrap:wrap; } .hud { right:8px; top:8px; bottom:auto; width:46%; max-height:30%; padding:10px; } .hud .muted { font-size:11px; } }
    @media(prefers-reduced-motion:no-preference) { button { transition:background .12s; } }
  `;
  const root = document.createElement('section');
  root.className = kind === 'gameplay' ? 'hud' : 'screen';
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
