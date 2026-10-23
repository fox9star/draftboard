'use strict';
/* Draftboard editor — prototype player and slide show. */
(() => {
  const Ed = window.Ed, s = Ed.s;
  const { esc, r2 } = Scene;
  let P = null;
  let seq = 0;

  const topFrameOf = f => {
    let cur = f;
    for (let i = 0; i < 50; i++) {
      const p = Ed.parentFrameOf(cur);
      if (!p) return cur;
      cur = p;
    }
    return cur;
  };

  function sizeScreen(div) {
    const f = div._frame;
    const W = innerWidth, H = innerHeight - 56;
    const k = Math.max(0.05, Math.min((W - 32) / Math.max(1, f.w), (H - 32) / Math.max(1, f.h)));
    const svg = div.firstElementChild;
    svg.setAttribute('width', r2(f.w * k));
    svg.setAttribute('height', r2(f.h * k));
    div._scale = k;
  }

  function screen(frame) {
    const content = Ed.contentOf(frame).filter(n => n.visible !== false);
    const { svg } = Scene.toSVG(content, {
      region: Scene.localBox(frame), hit: true, prefix: `p${++seq}-`, imageHref: Ed.assetURL,
    });
    const div = document.createElement('div');
    div.className = 'pr-screen';
    div.innerHTML = svg;
    div._frame = frame;
    div._content = content;
    for (const n of content) {
      if (n.link && n.link.target) {
        const g = div.querySelector(`[data-id="${n.id}"]`);
        if (g) g.style.cursor = 'pointer';
      }
    }
    sizeScreen(div);
    return div;
  }

  const KF = (W, H) => ({
    dissolve: [[{ opacity: 0 }, { opacity: 1 }], null],
    'push-left': [[{ transform: `translateX(${W}px)` }, { transform: 'none' }], [{ transform: 'none' }, { transform: `translateX(${-W}px)` }]],
    'push-right': [[{ transform: `translateX(${-W}px)` }, { transform: 'none' }], [{ transform: 'none' }, { transform: `translateX(${W}px)` }]],
    'push-up': [[{ transform: `translateY(${H}px)` }, { transform: 'none' }], [{ transform: 'none' }, { transform: `translateY(${-H}px)` }]],
    'push-down': [[{ transform: `translateY(${-H}px)` }, { transform: 'none' }], [{ transform: 'none' }, { transform: `translateY(${H}px)` }]],
    'slide-left': [[{ transform: `translateX(${W}px)` }, { transform: 'none' }], null],
    'slide-right': [[{ transform: `translateX(${-W}px)` }, { transform: 'none' }], null],
  });

  function stopMotion() {
    if (P && P.raf) cancelAnimationFrame(P.raf);
    if (P) P.raf = null;
  }

  function playMotion(div) {
    const animated = div._content.filter(n => n.anim && Motion.PRESETS[n.anim.preset]);
    if (!animated.length) return;
    const svgEl = div.firstElementChild;
    const total = Motion.total(animated), loop = Motion.hasLoop(animated), t0 = performance.now();
    Scene.applyAnim(svgEl, animated, Motion.statesAt(animated, 0));
    const tick = now => {
      if (!P || !div.isConnected) return;
      const t = now - t0;
      Scene.applyAnim(svgEl, animated, Motion.statesAt(animated, t));
      if (t < total || loop) P.raf = requestAnimationFrame(tick);
    };
    P.raf = requestAnimationFrame(tick);
  }

  function go(frame, transition = 'instant', duration = 300, push = true) {
    if (!P || !frame) return;
    P.ended = false;
    P.endEl.hidden = true;
    if (push && P.current && P.current !== frame) P.history.push(P.current.id);
    P.current = frame;
    stopMotion();
    const old = [...P.layer.children];
    const neu = screen(frame);
    P.layer.appendChild(neu);
    const kf = KF(innerWidth, innerHeight)[transition];
    if (!kf || !old.length || !duration) old.forEach(o => o.remove());
    else {
      const opt = { duration, easing: 'cubic-bezier(.3, 0, .2, 1)' };
      neu.animate(kf[0], opt);
      if (kf[1]) old.forEach(o => o.animate(kf[1], { ...opt, fill: 'forwards' }));
      setTimeout(() => old.forEach(o => o.remove()), duration);
    }
    playMotion(neu);
    hud();
  }

  function hud() {
    const i = P.frames.indexOf(P.current);
    P.count.textContent = i >= 0 ? `${i + 1} / ${P.frames.length}` : '';
    P.title.textContent = P.current ? P.current.name : '';
    P.notes.textContent = (P.current && P.current.notes) || '이 슬라이드에는 노트가 없습니다.';
  }

  function follow(link) {
    if (link.target === '__back') return back();
    if (link.target === '__url') {
      if (link.url) window.open(link.url, '_blank', 'noopener');
      return;
    }
    const f = Ed.byId(link.target);
    if (f) go(topFrameOf(f), link.transition || 'dissolve', link.duration ?? 300);
  }

  function back() {
    const id = P.history.pop();
    const f = id && Ed.byId(id);
    if (f) go(f, 'dissolve', 250, false);
  }

  function next() {
    if (P.ended) return close();
    const i = P.frames.indexOf(P.current);
    if (i < P.frames.length - 1) {
      const f = P.frames[i + 1];
      if (P.mode === 'slides') go(f, f.transition || 'dissolve', f.transition === 'instant' ? 0 : 450);
      else go(f, 'push-left', 300);
    } else if (P.mode === 'slides') {
      P.ended = true;
      P.endEl.hidden = false;
    }
  }

  function prev() {
    if (P.ended) { P.ended = false; P.endEl.hidden = true; return; }
    const i = P.frames.indexOf(P.current);
    if (P.mode !== 'slides') return back();
    if (i > 0) go(P.frames[i - 1], 'instant', 0, false);
  }

  function flashHotspots() {
    const div = P.layer.lastElementChild;
    if (!div) return;
    const f = div._frame, k = div._scale, r = div.firstElementChild.getBoundingClientRect();
    for (const n of div._content) {
      if (!n.link || !n.link.target) continue;
      const b = Scene.bbox(n);
      const hs = document.createElement('div');
      hs.className = 'pr-hot';
      Object.assign(hs.style, {
        left: `${r.left + (b.x - f.x) * k}px`, top: `${r.top + (b.y - f.y) * k}px`,
        width: `${b.w * k}px`, height: `${b.h * k}px`,
      });
      P.root.appendChild(hs);
      setTimeout(() => hs.remove(), 700);
    }
  }

  function onKey(e) {
    if (!P) return;
    const k = e.key;
    let handled = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter') next();
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') prev();
    else if (k === 'r' || k === 'R') go(P.frames.includes(P.start) ? P.start : P.frames[0], 'instant', 0, false);
    else if (k === 'n' || k === 'N') P.notes.hidden = !P.notes.hidden;
    else if (k === 'f' || k === 'F') toggleFull();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (P) P.root.requestFullscreen().catch(() => {});
  }

  function onResize() {
    if (!P) return;
    [...P.layer.children].forEach(sizeScreen);
  }

  function start(mode = 'proto', startId) {
    if (P) close();
    if (s.editing) Ed.commitEdit();
    const frames = mode === 'slides' ? Ed.slideFrames() : Ed.topFrames();
    if (!frames.length) return Ed.toast('재생할 프레임이 없습니다. 먼저 프레임(F)을 만드세요.');
    let first = startId ? Ed.byId(startId) : null;
    if (!first) {
      const sel = Ed.selNodes()[0];
      const f = sel && (sel.type === 'frame' ? sel : Ed.parentFrameOf(sel));
      first = f ? topFrameOf(f) : null;
    }
    if (!first && mode !== 'slides' && s.doc.protoStart) first = Ed.byId(s.doc.protoStart);
    if (!first || !frames.includes(first)) first = frames[0];

    const root = document.createElement('div');
    root.className = 'present';
    root.innerHTML = `<div class="pr-layer"></div>
      <div class="pr-end" hidden><div><b>슬라이드 쇼가 끝났습니다.</b><span>클릭하거나 Esc를 누르면 닫힙니다.</span></div></div>
      <div class="pr-notes" hidden></div>
      <div class="pr-hud">
        <button data-pr="prev" title="이전 (←)">‹</button><span class="pr-count"></span><button data-pr="next" title="다음 (→)">›</button>
        <span class="pr-title"></span>
        <button data-pr="restart" title="처음부터 (R)">처음부터</button>
        ${mode === 'slides' ? '<button data-pr="notes" title="발표자 노트 (N)">노트</button>' : ''}
        <button data-pr="full" title="전체 화면 (F)">전체 화면</button>
        <button data-pr="close" title="닫기 (Esc)">닫기</button>
      </div>`;
    document.body.appendChild(root);
    P = {
      mode, frames, root, start: first, history: [], current: null, raf: null, ended: false,
      layer: root.querySelector('.pr-layer'), count: root.querySelector('.pr-count'), title: root.querySelector('.pr-title'),
      notes: root.querySelector('.pr-notes'), endEl: root.querySelector('.pr-end'),
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-pr]');
      if (b) {
        const a = b.dataset.pr;
        if (a === 'prev') prev();
        if (a === 'next') next();
        if (a === 'restart') go(P.start, 'instant', 0, false);
        if (a === 'notes') P.notes.hidden = !P.notes.hidden;
        if (a === 'full') toggleFull();
        if (a === 'close') close();
        return;
      }
      if (e.target.closest('.pr-hud, .pr-notes')) return;
      if (P.ended) return close();
      const h = e.target.closest('[data-id]');
      const div = P.layer.lastElementChild;
      const n = h && div && div._content.find(x => x.id === h.dataset.id);
      if (n && n.link && n.link.target) return follow(n.link);
      if (P.mode === 'slides') next(); else flashHotspots();
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    go(first, 'instant', 0, false);
    if (mode === 'slides') root.requestFullscreen && root.requestFullscreen().catch(() => {});
  }

  function close() {
    if (!P) return;
    stopMotion();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    P.root.remove();
    P = null;
  }

  Ed.present = { start, close, active: () => !!P };
  Ed.actions = Object.assign(Ed.actions || {}, {
    present: () => start('proto'),
    slideshow: () => start('slides'),
  });
})();
