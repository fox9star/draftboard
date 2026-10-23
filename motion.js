'use strict';
/* Motion — animation presets, easing and evaluation shared by the editor,
   the presentation viewer and the site / SVG / video exporters. */
window.Motion = (() => {
  const r2 = v => Math.round(v * 100) / 100;

  // Keyframes list the state at each point; missing values mean "at rest"
  // (no offset, scale 1, no rotation, fully opaque).
  const PRESETS = {
    fade:   { label: '페이드 인', kf: [{ p: 0, o: 0 }, { p: 1 }] },
    up:     { label: '아래에서 올라오기', kf: [{ p: 0, ty: 40, o: 0 }, { p: 1 }] },
    down:   { label: '위에서 내려오기', kf: [{ p: 0, ty: -40, o: 0 }, { p: 1 }] },
    left:   { label: '오른쪽에서 들어오기', kf: [{ p: 0, tx: 60, o: 0 }, { p: 1 }] },
    right:  { label: '왼쪽에서 들어오기', kf: [{ p: 0, tx: -60, o: 0 }, { p: 1 }] },
    zoom:   { label: '커지며 나타나기', kf: [{ p: 0, s: 0.6, o: 0 }, { p: 1 }] },
    shrink: { label: '작아지며 나타나기', kf: [{ p: 0, s: 1.4, o: 0 }, { p: 1 }] },
    spinIn: { label: '돌며 나타나기', kf: [{ p: 0, r: -180, s: 0.4, o: 0 }, { p: 1 }] },
    bounce: { label: '통통 튀며 떨어지기', easing: 'ease-in', kf: [{ p: 0, ty: -90, o: 0 }, { p: 0.45, ty: 0 }, { p: 0.65, ty: -24 }, { p: 0.82, ty: 0 }, { p: 0.92, ty: -6 }, { p: 1 }] },
    pulse:  { label: '두근두근 (반복)', loop: true, easing: 'ease-in-out', kf: [{ p: 0 }, { p: 0.5, s: 1.08 }, { p: 1 }] },
    float:  { label: '둥실둥실 (반복)', loop: true, easing: 'ease-in-out', kf: [{ p: 0 }, { p: 0.5, ty: -12 }, { p: 1 }] },
    spin:   { label: '빙글빙글 (반복)', loop: true, easing: 'linear', kf: [{ p: 0 }, { p: 1, r: 360 }] },
    blink:  { label: '깜빡깜빡 (반복)', loop: true, easing: 'ease-in-out', kf: [{ p: 0 }, { p: 0.5, o: 0.2 }, { p: 1 }] },
    shake:  { label: '좌우로 흔들기 (반복)', loop: true, easing: 'ease-in-out', kf: [{ p: 0 }, { p: 0.25, r: -8 }, { p: 0.75, r: 8 }, { p: 1 }] },
  };

  const EASINGS = {
    'ease-out': { label: '천천히 멈춤', css: 'cubic-bezier(0, 0, .58, 1)', curve: [0, 0, 0.58, 1] },
    'ease-in': { label: '천천히 시작', css: 'cubic-bezier(.42, 0, 1, 1)', curve: [0.42, 0, 1, 1] },
    'ease-in-out': { label: '부드럽게', css: 'cubic-bezier(.42, 0, .58, 1)', curve: [0.42, 0, 0.58, 1] },
    linear: { label: '일정한 속도', css: 'linear', curve: null },
    spring: { label: '탄성', css: 'cubic-bezier(.34, 1.56, .64, 1)', curve: [0.34, 1.56, 0.64, 1] },
  };

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x, d = dx(t);
        if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
        let lo = 0, hi = 1;
        t = x;
        for (let i = 0; i < 30; i++) {
          if (sx(t) < x) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
      }
      return sy(t);
    };
  }

  const easeFns = {};
  for (const [k, v] of Object.entries(EASINGS)) easeFns[k] = v.curve ? bezier(...v.curve) : t => t;

  const REST = { tx: 0, ty: 0, s: 1, r: 0, o: 1 };
  const val = (k, prop) => (k[prop] != null ? k[prop] : REST[prop]);

  function sample(kf, p, ease) {
    let i = 0;
    while (i < kf.length - 2 && p > kf[i + 1].p) i++;
    const a = kf[i], b = kf[i + 1];
    const t = ease(b.p === a.p ? 1 : Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))));
    const out = {};
    for (const prop of Object.keys(REST)) out[prop] = val(a, prop) + (val(b, prop) - val(a, prop)) * t;
    return out;
  }

  const isLoop = anim => {
    const P = PRESETS[anim.preset];
    return anim.loop != null ? !!anim.loop : !!(P && P.loop);
  };

  // State of one animation at time t (ms since the screen appeared)
  function state(anim, t) {
    const P = anim && PRESETS[anim.preset];
    if (!P) return null;
    const d = Math.max(1, anim.duration || 600), local = t - (anim.delay || 0);
    let p;
    if (local < 0) p = 0;
    else if (isLoop(anim)) p = (local % d) / d;
    else p = Math.min(1, local / d);
    return sample(P.kf, p, easeFns[anim.easing || P.easing || 'ease-out'] || easeFns['ease-out']);
  }

  function statesAt(nodes, t) {
    const out = {};
    for (const n of nodes) {
      const s = n.anim && state(n.anim, t);
      if (s) out[n.id] = s;
    }
    return out;
  }

  // Length of one full play-through (loops count once)
  function total(nodes) {
    let t = 0;
    for (const n of nodes) {
      if (n.anim && PRESETS[n.anim.preset]) t = Math.max(t, (n.anim.delay || 0) + (n.anim.duration || 600));
    }
    return t;
  }

  const hasLoop = nodes => nodes.some(n => n.anim && PRESETS[n.anim.preset] && isLoop(n.anim));

  // CSS @keyframes + animation shorthand; u converts design pixels to CSS lengths.
  function css(name, anim, u = v => `${r2(v)}px`) {
    const P = anim && PRESETS[anim.preset];
    if (!P) return null;
    const frames = P.kf.map(k =>
      `${r2(k.p * 100)}%{transform:translate(${u(val(k, 'tx'))},${u(val(k, 'ty'))}) scale(${val(k, 's')}) rotate(${val(k, 'r')}deg);opacity:${val(k, 'o')}}`).join('');
    const ease = (EASINGS[anim.easing || P.easing || 'ease-out'] || EASINGS['ease-out']).css;
    return {
      keyframes: `@keyframes ${name}{${frames}}`,
      animation: `${name} ${anim.duration || 600}ms ${ease} ${anim.delay || 0}ms ${isLoop(anim) ? 'infinite' : '1'} both`,
    };
  }

  return { PRESETS, EASINGS, state, statesAt, total, hasLoop, isLoop, css };
})();
