'use strict';
/* Draftboard theme — light, gray and dark. Loaded in <head> on every page so the
   colours are right before the first paint; other open tabs follow along. */
(() => {
  const KEY = 'draftboard.theme';
  const THEMES = [['light', '라이트'], ['gray', '그레이'], ['dark', '다크']];
  const ICONS = {
    light: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>',
    gray: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.4a5.6 5.6 0 010 11.2z" fill="currentColor"/></svg>',
    dark: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.6 5.6 0 106.8 6.8z"/></svg>',
  };
  const valid = t => THEMES.some(([k]) => k === t);

  function get() {
    try {
      const t = localStorage.getItem(KEY);
      return valid(t) ? t : 'light';
    } catch (e) { return 'light'; }
  }

  function apply(t) {
    const root = document.documentElement;
    root.dataset.theme = t;
    root.style.colorScheme = t === 'light' ? 'light' : 'dark';
  }

  const listeners = new Set();
  const notify = t => listeners.forEach(fn => { try { fn(t); } catch (e) { /* keep the others running */ } });

  function set(t) {
    if (!valid(t)) return;
    try { localStorage.setItem(KEY, t); } catch (e) { /* applies to this page only */ }
    apply(t);
    notify(t);
  }

  apply(get());
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const t = get();
    apply(t);
    notify(t);
  });

  const style = document.createElement('style');
  style.textContent = `.theme-switch{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:rgba(127,127,127,.18);flex:none}
.theme-opt{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;font-size:12px;cursor:pointer;opacity:.7}
.theme-opt:hover{opacity:1}
.theme-opt.on{opacity:1;background:rgba(127,127,127,.34);font-weight:700}
.theme-switch.compact .theme-opt{padding:0 7px}
.theme-switch.compact .theme-opt span{display:none}`;
  document.head.appendChild(style);

  // A three-way switch; any element with data-theme-switch gets one.
  function mount(el) {
    if (el.dataset.themeMounted) return;
    el.dataset.themeMounted = '1';
    el.classList.add('theme-switch');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '화면 테마');
    const render = () => {
      const cur = get();
      el.innerHTML = THEMES.map(([k, l]) =>
        `<button type="button" class="theme-opt${k === cur ? ' on' : ''}" data-theme-set="${k}" title="${l} 모드" aria-pressed="${k === cur}">${ICONS[k]}<span>${l}</span></button>`).join('');
    };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-theme-set]');
      if (b) set(b.dataset.themeSet);
    });
    listeners.add(render);
    render();
  }

  const mountAll = () => document.querySelectorAll('[data-theme-switch]').forEach(mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  window.Theme = { get, set, mount, list: THEMES, icons: ICONS, onChange: fn => listeners.add(fn) };
})();
