'use strict';
/* Draftboard editor — tools, pointer and keyboard input, editing commands. */
(() => {
  const Ed = window.Ed, s = Ed.s, el = Ed.el, I = Ed.ICON;
  const { r2 } = Scene;
  const $ = (sel, root = document) => root.querySelector(sel);
  const svg = el.svg;

  // ---------- tools ----------
  const TOOLS = {
    select: ['이동', 'V'], hand: ['손 도구', 'H'], frame: ['프레임', 'F'],
    rect: ['사각형', 'R'], ellipse: ['원', 'O'], polygon: ['다각형', ''], star: ['별', ''],
    line: ['선', 'L'], arrow: ['화살표', 'Shift+L'],
    pen: ['펜', 'P'], pencil: ['연필', 'Shift+P'], marker: ['형광펜', 'M'],
    text: ['텍스트', 'T'], sticky: ['스티커 메모', 'S'], connector: ['연결선', 'X'], stamp: ['스탬프', 'E'],
    image: ['이미지 넣기', 'Ctrl+Shift+K'],
  };
  const GROUPS = [['select', 'hand'], ['frame'], ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow'],
    ['pen', 'pencil', 'marker'], ['text'], ['sticky', 'connector', 'stamp'], ['image']];
  const current = GROUPS.map(g => g[0]);
  const STAMPS = ['👍', '❤️', '😂', '🎉', '✅', '❓', '⭐', '🔥', '👀', '💡', '🙌', '❌'];
  const toolsEl = $('#tools');

  function renderTools() {
    toolsEl.innerHTML = GROUPS.map((g, gi) => {
      const t = current[gi], [label, key] = TOOLS[t];
      return `<div class="tool-group${g.includes(s.tool) ? ' active' : ''}"><button class="tb-btn tool" data-tool="${t}" title="${label}${key ? ` (${key})` : ''}">${I[t]}</button>${g.length > 1 ? `<button class="tb-btn caret" data-group="${gi}" data-dd-owner title="${label} 외 도구">${I.chevron}</button>` : ''}</div>`;
    }).join('');
  }

  toolsEl.addEventListener('click', e => {
    const caret = e.target.closest('[data-group]');
    if (caret) {
      const g = GROUPS[+caret.dataset.group], r = caret.getBoundingClientRect();
      Ed.dropdown(r.left - 30, r.bottom + 6, g.map(t => ({
        label: TOOLS[t][0], kbd: TOOLS[t][1], icon: I[t], checked: s.tool === t, run: () => pickTool(t),
      })));
      return;
    }
    const b = e.target.closest('[data-tool]');
    if (b) pickTool(b.dataset.tool);
  });

  function pickTool(t) {
    if (t === 'image') return Ed.run('importImage');
    Ed.setTool(t);
  }

  Ed.setTool = t => {
    if (s.pen && t !== 'pen') finishPen();
    if (s.vecEdit && t !== 'select') s.vecEdit = null;
    s.tool = t;
    const gi = GROUPS.findIndex(g => g.includes(t));
    if (gi >= 0) current[gi] = t;
    el.stage.dataset.tool = t;
    renderTools();
    const pal = $('#stamp-palette');
    pal.hidden = t !== 'stamp';
    if (t === 'stamp') pal.innerHTML = STAMPS.map(x => `<button class="stamp${x === s.stamp ? ' on' : ''}" data-stamp="${x}" title="${x} 스탬프">${x}</button>`).join('');
    Ed.renderOverlay();
  };

  $('#stamp-palette').addEventListener('click', e => {
    const b = e.target.closest('[data-stamp]');
    if (!b) return;
    s.stamp = b.dataset.stamp;
    Ed.setTool('stamp');
  });

  // ---------- helpers ----------
  const hitEl = t => (t && t.closest ? t.closest('[data-id]') : null);
  const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  const snap45 = (o, q) => {
    const ang = Math.round(Math.atan2(q[1] - o[1], q[0] - o[0]) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(q[0] - o[0], q[1] - o[1]);
    return [Math.round(o[0] + Math.cos(ang) * len), Math.round(o[1] + Math.sin(ang) * len)];
  };
  const CONNECTABLE = n => n && !['line', 'connector', 'path'].includes(n.type);

  // The shape under the pointer, ignoring the connector being drawn
  function targetAt(e, ...skip) {
    for (const node of document.elementsFromPoint(e.clientX, e.clientY)) {
      const h = hitEl(node);
      if (!h || !el.world.contains(h)) continue;
      const id = h.dataset.id;
      if (skip.includes(id)) continue;
      if (CONNECTABLE(Ed.byId(id))) return id;
    }
    return null;
  }

  function startTransform(type, p, extra = {}) {
    const sel = Ed.selNodes();
    const moving = type === 'move' ? Ed.withChildren(sel) : sel;
    s.drag = {
      type, start: p, origSnap: Ed.snapshot(), moved: false,
      orig: Object.fromEntries(moving.map(n => [n.id, Ed.clone(n)])),
      ids: moving.map(n => n.id), box: Ed.union(sel), ...extra,
    };
  }

  // ---------- pointer ----------
  svg.addEventListener('pointerdown', e => {
    if (s.editing) Ed.commitEdit();
    Ed.hideDropdown();
    if (e.button === 2) return;
    const p = Ed.toWorld(e);
    if (e.button === 1 || s.spaceDown || s.tool === 'hand') {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      s.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: s.view.x, vy: s.view.y };
      el.stage.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    const t = e.target, ds = t.dataset || {};
    if (s.tool === 'pen') return penDown(e, p);
    if (s.vecEdit && vectorDown(e, p, ds)) return;
    if (s.tool === 'select') return selectDown(e, p, t, ds);
    createDown(e, p);
  });

  function selectDown(e, p, t, ds) {
    if (ds.handle) return startTransform('resize', p, { handle: ds.handle });
    if (ds.rotate) return startRotate(p);
    if (ds.pt !== undefined) return startEndpoint(+ds.pt);
    const hit = hitEl(t);
    let n = hit && Ed.byId(hit.dataset.id);
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    // Clicking the empty area of a frame that holds layers starts a selection box, like on the canvas.
    if (n && n.type === 'frame' && !t.classList.contains('frame-label') && !s.selection.includes(n.id) && !toggle && Ed.childrenOf(n).length) n = null;
    if (n) {
      let clicked = null;
      if (toggle) s.selection = s.selection.includes(n.id) ? s.selection.filter(x => x !== n.id) : [...s.selection, n.id];
      else if (!s.selection.includes(n.id)) s.selection = [n.id];
      else clicked = n.id;
      if (!s.selection.length) return Ed.render();
      let committed = false;
      if (e.altKey) {
        Ed.checkpoint();
        const list = Ed.withChildren(Ed.selNodes());
        const copies = Ed.cloneSet(list);
        s.doc.nodes.push(...copies);
        s.selection = copies.filter((c, i) => s.selection.includes(list[i].id)).map(c => c.id);
        committed = true;
      }
      startTransform('move', p, { clickedId: clicked, committed });
      return Ed.render();
    }
    if (!toggle) s.selection = [];
    s.drag = { type: 'marquee', start: p, cur: p, base: [...s.selection] };
    Ed.render();
  }

  function startRotate(p) {
    const sel = Ed.selNodes();
    const single = sel.length === 1 ? sel[0] : null;
    const b = single && Scene.BOX_TYPES.has(single.type) ? Scene.localBox(single) : Ed.union(sel);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    startTransform('rotate', p, { c, a0: Math.atan2(p.y - c[1], p.x - c[0]), single: single ? Ed.clone(single) : null });
  }

  function startEndpoint(idx) {
    const n = Ed.selNodes()[0];
    if (!n) return;
    s.drag = { type: 'pt', id: n.id, idx: idx === 0 ? 0 : n.points.length - 1, origSnap: Ed.snapshot(), moved: false };
  }

  function createDown(e, p) {
    const x = Math.round(p.x), y = Math.round(p.y), tool = s.tool;
    if (tool === 'stamp') {
      Ed.checkpoint();
      const n = Ed.makeNode('text', { text: s.stamp, fontSize: 48, name: '스탬프 ' + s.stamp });
      n.x = r2(p.x - n.w / 2); n.y = r2(p.y - n.h / 2);
      s.doc.nodes.push(n);
      s.selection = [n.id];
      return Ed.changed();
    }
    if (tool === 'sticky') {
      // Editing starts on pointerup: focusing now would be undone by the mousedown that follows.
      Ed.checkpoint();
      const n = Ed.makeNode('sticky', { x: x - 100, y: y - 100, w: 200, h: 200, fill: s.stickyColor });
      s.doc.nodes.push(n);
      s.selection = [n.id];
      s.drag = { type: 'create', id: n.id, start: { x, y }, tool };
      Ed.render();
      return;
    }
    if (tool === 'connector') return connectDown(e, p);
    Ed.checkpoint();
    let n;
    if (tool === 'text') n = Ed.makeNode('text', { x, y, text: '' });
    else if (tool === 'line' || tool === 'arrow') {
      n = Ed.makeNode('line', { points: [[x, y], [x, y]], arrowEnd: tool === 'arrow' ? 'arrow' : 'none' });
      if (tool === 'arrow') n.name = '화살표 ' + n.name.split(' ').pop();
    } else if (tool === 'pencil') n = Ed.makeNode('path', { points: [[r2(p.x), r2(p.y)]] });
    else if (tool === 'marker') n = Ed.makeNode('path', { points: [[r2(p.x), r2(p.y)]], stroke: '#FFD43B', strokeWidth: 18, opacity: 0.55, name: '형광펜' });
    else n = Ed.makeNode(tool, { x, y, w: 0, h: 0 });
    s.doc.nodes.push(n);
    s.selection = [n.id];
    s.drag = { type: 'create', id: n.id, start: { x, y }, tool };
    Ed.render();
  }

  function connectDown(e, p) {
    Ed.checkpoint();
    const from = targetAt(e);
    const fn = from && Ed.byId(from);
    const start = fn ? (b => [r2(b.x + b.w / 2), r2(b.y + b.h / 2)])(Scene.bbox(fn)) : [r2(p.x), r2(p.y)];
    const n = Ed.makeNode('connector', {
      from: from ? { id: from } : null, points: [start, [r2(p.x), r2(p.y)]],
      route: s.doc.kind === 'whiteboard' ? 'elbow' : 'straight',
    });
    s.doc.nodes.push(n);
    s.selection = [n.id];
    s.drag = { type: 'connect', id: n.id, fromId: from, start: p };
    Ed.render();
  }

  // ---------- move snapping ----------
  function snapMove(d, dx, dy, off) {
    const box = d.box, guides = { x: [], y: [] };
    if (off || !box) return { dx, dy, guides };
    const thr = 6 / s.view.zoom, xs = [], ys = [];
    for (const n of s.doc.nodes) {
      if (d.ids.includes(n.id) || n.visible === false) continue;
      const b = Scene.bbox(n);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    const best = (cands, own) => {
      let r = null;
      for (const m of own) for (const c of cands) if (Math.abs(c - m) < thr && (r === null || Math.abs(c - m) < Math.abs(r))) r = c - m;
      return r;
    };
    const ownX = () => [box.x + dx, box.x + dx + box.w / 2, box.x + dx + box.w];
    const ownY = () => [box.y + dy, box.y + dy + box.h / 2, box.y + dy + box.h];
    const bx = best(xs, ownX());
    if (bx !== null) dx += bx;
    const by = best(ys, ownY());
    if (by !== null) dy += by;
    if (bx !== null) guides.x = ownX().filter(m => xs.some(c => Math.abs(c - m) < 0.01));
    if (by !== null) guides.y = ownY().filter(m => ys.some(c => Math.abs(c - m) < 0.01));
    return { dx: r2(dx), dy: r2(dy), guides };
  }

  // Resize one box-shaped node in its own (possibly rotated) axes
  function resizeBox(n, o, handle, p, shift) {
    const th = (o.rotation || 0) * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
    const c = [o.x + o.w / 2, o.y + o.h / 2];
    const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    if (!o.rotation) p = { x: Math.round(p.x), y: Math.round(p.y) };
    if (o.type === 'text') {
      if (!sx) return;
      const A = Scene.rot([sx > 0 ? o.x : o.x + o.w, o.y], o.rotation || 0, c);
      const dx = p.x - A[0], dy = p.y - A[1];
      const w = Math.max(8, (dx * cos + dy * sin) * sx);
      n.textMode = 'fixed';
      n.w = r2(w);
      Scene.fitText(n);
      const ox = sx * w / 2, oy = n.h / 2;
      n.x = r2(A[0] + ox * cos - oy * sin - w / 2);
      n.y = r2(A[1] + ox * sin + oy * cos - n.h / 2);
      return;
    }
    const A = Scene.rot([c[0] - sx * o.w / 2, c[1] - sy * o.h / 2], o.rotation || 0, c);
    const dx = p.x - A[0], dy = p.y - A[1];
    const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
    let w = sx ? Math.max(1, lx * sx) : o.w, h = sy ? Math.max(1, ly * sy) : o.h;
    if (shift && o.w && o.h) {
      const ratio = o.w / o.h;
      if (sx && sy) { if (w / h > ratio) h = w / ratio; else w = h * ratio; }
      else if (sx) h = w / ratio;
      else w = h * ratio;
    }
    const ox = sx * w / 2, oy = sy * h / 2;
    const cx = A[0] + ox * cos - oy * sin, cy = A[1] + ox * sin + oy * cos;
    n.w = r2(w); n.h = r2(h); n.x = r2(cx - w / 2); n.y = r2(cy - h / 2);
  }

  // Resize a selection (or a group / vector) by scaling its bounding box
  function resizeBounds(d, p, shift) {
    const B = d.box, hd = d.handle;
    let x1 = B.x, y1 = B.y, x2 = B.x + B.w, y2 = B.y + B.h;
    const px = Math.round(p.x), py = Math.round(p.y);
    if (hd.includes('w')) x1 = px;
    if (hd.includes('e')) x2 = px;
    if (hd.includes('n')) y1 = py;
    if (hd.includes('s')) y2 = py;
    if (shift && hd.length === 2 && B.w && B.h) {
      let w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      const ratio = B.w / B.h;
      if (w / h > ratio) h = w / ratio; else w = h * ratio;
      if (hd.includes('w')) x1 = x2 - w; else x2 = x1 + w;
      if (hd.includes('n')) y1 = y2 - h; else y2 = y1 + h;
    }
    const NB = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(B.w ? 1 : 0, Math.abs(x2 - x1)), h: Math.max(B.h ? 1 : 0, Math.abs(y2 - y1)) };
    const M = Ed.boxMap(B, NB);
    for (const id of Object.keys(d.orig)) Ed.mapNode(Ed.byId(id), d.orig[id], M);
  }

  svg.addEventListener('pointermove', e => {
    const p = Ed.toWorld(e);
    s.cursor = p;
    const d = s.drag;
    if (!d) {
      if (s.pen) { s.pen.cursor = p; Ed.renderOverlay(); return; }
      const h = hitEl(e.target);
      const id = h && el.world.contains(h) ? h.dataset.id : null;
      if (id !== s.hoverId) { s.hoverId = id; Ed.renderOverlay(); }
      return;
    }
    switch (d.type) {
      case 'pan':
        s.view.x = d.vx + e.clientX - d.sx;
        s.view.y = d.vy + e.clientY - d.sy;
        Ed.renderCanvas();
        break;
      case 'marquee': {
        d.cur = p;
        const m = Ed.rectFrom(d.start, p);
        const hit = s.doc.nodes.filter(n => n.visible !== false && !n.locked
          && (n.type === 'frame' ? Scene.inside(m, Scene.bbox(n)) : intersects(m, Scene.bbox(n)))).map(n => n.id);
        s.selection = [...new Set([...d.base, ...hit])];
        Ed.render();
        break;
      }
      case 'move': {
        let dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (!d.moved) {
          if (Math.hypot(dx, dy) * s.view.zoom < 3) return;
          d.moved = true;
          if (!d.committed) Ed.pushUndo(d.origSnap);
        }
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        dx = Math.round(d.box.x + dx) - d.box.x;
        dy = Math.round(d.box.y + dy) - d.box.y;
        const sn = snapMove(d, dx, dy, e.ctrlKey || e.metaKey);
        d.guides = sn.guides;
        for (const id of d.ids) Ed.translate(Ed.byId(id), d.orig[id], sn.dx, sn.dy);
        Ed.renderCanvas();
        break;
      }
      case 'resize': {
        if (!d.moved) { d.moved = true; Ed.pushUndo(d.origSnap); }
        const ids = Object.keys(d.orig);
        const one = ids.length === 1 ? d.orig[ids[0]] : null;
        if (one && Scene.BOX_TYPES.has(one.type)) resizeBox(Ed.byId(one.id), one, d.handle, p, e.shiftKey);
        else resizeBounds(d, p, e.shiftKey);
        Ed.renderCanvas();
        break;
      }
      case 'rotate': {
        let ang = (Math.atan2(p.y - d.c[1], p.x - d.c[0]) - d.a0) * 180 / Math.PI;
        if (!d.moved) {
          if (Math.abs(ang) < 0.5) return;
          d.moved = true;
          Ed.pushUndo(d.origSnap);
        }
        if (e.shiftKey) {
          const base = d.single ? d.single.rotation || 0 : 0;
          ang = Math.round((base + ang) / 15) * 15 - base;
        }
        for (const id of Object.keys(d.orig)) Ed.rotateNode(Ed.byId(id), d.orig[id], ang, d.c);
        Ed.renderCanvas();
        break;
      }
      case 'create': {
        const n = Ed.byId(d.id);
        if (n.type === 'sticky') break;
        if (n.type === 'line') {
          let q = [Math.round(p.x), Math.round(p.y)];
          if (e.shiftKey) q = snap45(n.points[0], q);
          n.points[1] = q;
        } else if (n.type === 'path') {
          const last = n.points[n.points.length - 1];
          if (Math.hypot(p.x - last[0], p.y - last[1]) * s.view.zoom > 2) n.points.push([r2(p.x), r2(p.y)]);
        } else if (n.type === 'text') {
          const w = Math.round(p.x) - d.start.x;
          if (Math.abs(w) > 4) {
            n.textMode = 'fixed';
            n.w = Math.abs(w);
            n.x = Math.min(d.start.x, Math.round(p.x));
            Scene.fitText(n);
          }
        } else {
          let w = Math.round(p.x) - d.start.x, h = Math.round(p.y) - d.start.y;
          if (e.shiftKey) {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m;
          }
          n.x = w < 0 ? d.start.x + w : d.start.x;
          n.y = h < 0 ? d.start.y + h : d.start.y;
          n.w = Math.abs(w); n.h = Math.abs(h);
        }
        Ed.renderCanvas();
        break;
      }
      case 'pt': {
        const n = Ed.byId(d.id);
        if (!d.moved) { d.moved = true; Ed.pushUndo(d.origSnap); }
        let q = [Math.round(p.x), Math.round(p.y)];
        const other = n.points[d.idx === 0 ? n.points.length - 1 : 0];
        if (e.shiftKey) q = snap45(other, q);
        if (n.type === 'connector') {
          n[d.idx === 0 ? 'from' : 'to'] = null;
          s.connectTarget = targetAt(e, n.id);
          s.hoverId = s.connectTarget;
        }
        n.points[d.idx] = q;
        Ed.renderCanvas();
        break;
      }
      case 'connect': {
        const n = Ed.byId(d.id);
        s.connectTarget = targetAt(e, n.id, d.fromId);
        s.hoverId = s.connectTarget;
        n.points[n.points.length - 1] = [r2(p.x), r2(p.y)];
        Ed.renderCanvas();
        break;
      }
      case 'pen': {
        const n = Ed.byId(s.pen && s.pen.id);
        if (!n) return;
        const a = n.anchors[d.idx];
        if (Math.hypot(p.x - a.x, p.y - a.y) * s.view.zoom < 3) return;
        a.ox = r2(p.x); a.oy = r2(p.y);
        a.ix = r2(2 * a.x - p.x); a.iy = r2(2 * a.y - p.y);
        Ed.renderCanvas();
        break;
      }
      case 'anchor': {
        if (!d.moved) { d.moved = true; Ed.pushUndo(d.origSnap); }
        const n = Ed.byId(d.id), o = d.origAnchors[d.idx];
        const dx = p.x - d.start.x, dy = p.y - d.start.y, mv = (v, k) => (v == null ? null : r2(v + k));
        n.anchors[d.idx] = { x: r2(o.x + dx), y: r2(o.y + dy), ix: mv(o.ix, dx), iy: mv(o.iy, dy), ox: mv(o.ox, dx), oy: mv(o.oy, dy) };
        Ed.renderCanvas();
        break;
      }
      case 'ctrl': {
        if (!d.moved) { d.moved = true; Ed.pushUndo(d.origSnap); }
        const a = Ed.byId(d.id).anchors[d.idx];
        const [k, other] = d.which === 'in' ? ['i', 'o'] : ['o', 'i'];
        a[k + 'x'] = r2(p.x); a[k + 'y'] = r2(p.y);
        if (!e.altKey && a[other + 'x'] != null) { a[other + 'x'] = r2(2 * a.x - p.x); a[other + 'y'] = r2(2 * a.y - p.y); }
        Ed.renderCanvas();
        break;
      }
    }
  });

  // Ramer–Douglas–Peucker simplification of freehand strokes
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let idx = -1, max = 0;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const dist = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (dist > max) { max = dist; idx = i; }
    }
    if (max <= eps) return [a, b];
    return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
  }

  // A node dropped inside a frame goes above it so it becomes part of the frame.
  function adoptIntoFrames(ids) {
    const nodes = s.doc.nodes;
    for (const id of ids) {
      const n = Ed.byId(id);
      if (!n || n.type === 'frame') continue;
      const b = Scene.bbox(n);
      let best = null, area = Infinity;
      for (const f of nodes) {
        if (f.type !== 'frame' || ids.includes(f.id) || f.visible === false) continue;
        const fb = Scene.bbox(f);
        if (Scene.inside(fb, b) && fb.w * fb.h < area) { best = f; area = fb.w * fb.h; }
      }
      if (!best) continue;
      const ni = nodes.indexOf(n), fi = nodes.indexOf(best);
      if (ni < fi) {
        nodes.splice(ni, 1);
        nodes.splice(nodes.indexOf(best) + 1, 0, n);
      }
    }
  }
  Ed.adoptIntoFrames = adoptIntoFrames;

  // A new frame drawn around existing layers slides under them so it contains them.
  function placeFrame(f) {
    const fb = Scene.bbox(f), nodes = s.doc.nodes;
    const idx = nodes.findIndex(n => n !== f && Scene.inside(fb, Scene.bbox(n)));
    const cur = nodes.indexOf(f);
    if (idx >= 0 && idx < cur) {
      nodes.splice(cur, 1);
      nodes.splice(idx, 0, f);
    }
  }

  function endDrag(e) {
    const d = s.drag;
    if (!d) return;
    s.drag = null;
    el.stage.classList.remove('panning');
    if (d.type === 'create') {
      const n = Ed.byId(d.id);
      if (n) {
        if (n.type === 'path') {
          if (n.points.length < 2) {
            s.doc.nodes = s.doc.nodes.filter(x => x !== n);
            s.selection = [];
            s.undo.pop();
          } else n.points = simplify(n.points, 0.8 / s.view.zoom).map(p => p.map(r2));
        } else if (n.type === 'line') {
          const b = Scene.bbox(n);
          if (b.w + b.h < 2) n.points[1] = [n.points[0][0] + 100, n.points[0][1]];
        } else if (n.type !== 'text' && n.type !== 'sticky' && n.w < 2 && n.h < 2) {
          const [w, h] = n.type === 'frame' ? [400, 300] : [100, 100];
          n.w = w; n.h = h;
        }
        if (n.type === 'frame') placeFrame(n);
        else if (s.doc.nodes.includes(n)) adoptIntoFrames([n.id]);
      }
      if (d.tool !== 'pencil' && d.tool !== 'marker') Ed.setTool('select');
      Ed.render();
      if (n && n.type === 'text') Ed.startEdit(n, 'text', true);
      if (n && n.type === 'sticky') Ed.startEdit(n, 'label', true);
      Ed.scheduleSave();
      return;
    }
    if (d.type === 'move') {
      if (!d.moved && d.clickedId && !(e.shiftKey || e.ctrlKey || e.metaKey)) s.selection = [d.clickedId];
      if (d.moved) adoptIntoFrames(d.ids);
    }
    if (d.type === 'pt' && d.moved) {
      const n = Ed.byId(d.id);
      if (n.type === 'connector' && s.connectTarget) n[d.idx === 0 ? 'from' : 'to'] = { id: s.connectTarget };
    }
    if (d.type === 'connect') {
      const n = Ed.byId(d.id);
      if (s.connectTarget) n.to = { id: s.connectTarget };
      else if (Math.hypot(n.points[0][0] - n.points[n.points.length - 1][0], n.points[0][1] - n.points[n.points.length - 1][1]) < 4) {
        n.points[n.points.length - 1] = [n.points[0][0] + 120, n.points[0][1]];
      }
      Ed.setTool('select');
    }
    if (d.type === 'pen' && d.closing) finishPen();
    s.connectTarget = null;
    Ed.render();
    if (!['pan', 'marquee'].includes(d.type)) Ed.scheduleSave();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', () => {
    if (!s.drag && s.hoverId) { s.hoverId = null; Ed.renderOverlay(); }
  });

  svg.addEventListener('dblclick', e => {
    if (s.pen) {
      const n = Ed.byId(s.pen.id);
      if (n) {
        const A = n.anchors;
        while (A.length > 1 && Math.hypot(A[A.length - 1].x - A[A.length - 2].x, A[A.length - 1].y - A[A.length - 2].y) * s.view.zoom < 4) A.pop();
      }
      return finishPen();
    }
    if (s.vecEdit && e.target.dataset && e.target.dataset.anchor !== undefined) return toggleSmooth(+e.target.dataset.anchor);
    const h = hitEl(e.target);
    if (!h) return;
    const n = Ed.byId(h.dataset.id);
    if (n) editNode(n);
  });

  function editNode(n) {
    if (n.locked) return;
    s.selection = [n.id];
    if (n.type === 'text') Ed.startEdit(n, 'text', false);
    else if (Scene.LABEL_TYPES.has(n.type)) Ed.startEdit(n, 'label', false);
    else if (n.type === 'vector') Ed.enterVectorEdit(n);
    else if (n.type === 'group' || n.type === 'boolean') Ed.toast('그룹 안의 레이어를 고치려면 그룹을 해제하세요 (Ctrl+Shift+G).');
  }

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    if (s.editing) Ed.commitEdit();
    if (e.ctrlKey || e.metaKey) {
      const r = svg.getBoundingClientRect();
      Ed.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    } else {
      s.view.x -= e.shiftKey ? e.deltaY : e.deltaX;
      s.view.y -= e.shiftKey ? 0 : e.deltaY;
      Ed.renderCanvas();
    }
  }, { passive: false });

  // ---------- pen ----------
  function penDown(e, p) {
    const q = { x: r2(p.x), y: r2(p.y) };
    const blank = (x, y) => ({ x, y, ix: null, iy: null, ox: null, oy: null });
    let n = s.pen && Ed.byId(s.pen.id);
    if (!n) {
      Ed.checkpoint();
      n = Ed.makeNode('vector', { anchors: [blank(q.x, q.y)] });
      s.doc.nodes.push(n);
      s.pen = { id: n.id, cursor: q };
      s.selection = [n.id];
      s.drag = { type: 'pen', idx: 0 };
      return Ed.render();
    }
    const A = n.anchors;
    if (A.length > 2 && Math.hypot(A[0].x - q.x, A[0].y - q.y) * s.view.zoom < 8) {
      n.closed = true;
      if (!n.fill) n.fill = '#D9D9D9';
      s.drag = { type: 'pen', idx: 0, closing: true };
      return Ed.renderCanvas();
    }
    const last = A[A.length - 1];
    if (e.shiftKey) [q.x, q.y] = snap45([last.x, last.y], [q.x, q.y]);
    A.push(blank(q.x, q.y));
    s.drag = { type: 'pen', idx: A.length - 1 };
    Ed.renderCanvas();
  }

  function finishPen() {
    const pen = s.pen;
    s.pen = null;
    if (!pen) return;
    const n = Ed.byId(pen.id);
    if (n && n.anchors.length < 2) {
      s.doc.nodes = s.doc.nodes.filter(x => x !== n);
      s.selection = [];
      s.undo.pop();
    } else if (n) {
      s.selection = [n.id];
      adoptIntoFrames([n.id]);
    }
    if (s.tool === 'pen') Ed.setTool('select');
    Ed.changed();
  }
  Ed.finishPen = finishPen;

  // ---------- vector point editing ----------
  Ed.enterVectorEdit = n => {
    s.vecEdit = { id: n.id, sel: null };
    s.selection = [n.id];
    Ed.render();
    Ed.toast('점 편집: 점과 핸들을 끌어 고치세요. 점을 더블클릭하면 곡선/직선 전환, Delete로 삭제, Esc로 끝냅니다.');
  };

  function vectorDown(e, p, ds) {
    const n = Ed.byId(s.vecEdit.id);
    if (!n) { s.vecEdit = null; return false; }
    if (ds.anchor !== undefined) {
      const idx = +ds.anchor;
      s.vecEdit.sel = idx;
      s.drag = { type: 'anchor', id: n.id, idx, start: p, origSnap: Ed.snapshot(), origAnchors: Ed.clone(n.anchors), moved: false };
      Ed.renderOverlay();
      return true;
    }
    if (ds.ctrl) {
      const [i, which] = ds.ctrl.split(':');
      s.drag = { type: 'ctrl', id: n.id, idx: +i, which, origSnap: Ed.snapshot(), moved: false };
      return true;
    }
    const h = hitEl(e.target);
    if (h && h.dataset.id === n.id) {
      s.vecEdit.sel = null;
      Ed.renderOverlay();
      return true;
    }
    s.vecEdit = null;
    return false;
  }

  function toggleSmooth(i) {
    const n = Ed.byId(s.vecEdit.id);
    if (!n) return;
    Ed.checkpoint();
    const A = n.anchors, a = A[i];
    if (a.ix != null || a.ox != null) {
      a.ix = a.iy = a.ox = a.oy = null;
    } else {
      const prev = A[i - 1] || (n.closed ? A[A.length - 1] : a), next = A[i + 1] || (n.closed ? A[0] : a);
      const tx = (next.x - prev.x) / 4, ty = (next.y - prev.y) / 4;
      a.ix = r2(a.x - tx); a.iy = r2(a.y - ty); a.ox = r2(a.x + tx); a.oy = r2(a.y + ty);
    }
    Ed.changed();
  }

  function deleteAnchor() {
    const n = Ed.byId(s.vecEdit.id);
    if (!n || s.vecEdit.sel == null) return;
    Ed.checkpoint();
    n.anchors.splice(s.vecEdit.sel, 1);
    s.vecEdit.sel = null;
    if (n.anchors.length < 2) {
      s.doc.nodes = s.doc.nodes.filter(x => x !== n);
      s.selection = [];
      s.vecEdit = null;
    } else if (n.anchors.length < 3) n.closed = false;
    Ed.changed();
  }

  // ---------- text & label editing ----------
  Ed.positionEditor = () => {
    const ed = s.editing;
    if (!ed) return;
    const n = Ed.byId(ed.id);
    if (!n) return;
    const z = s.view.zoom, V = s.view, ta = el.textEditor;
    let x, y, w, h, L, align, color, ws;
    if (ed.field === 'text') {
      L = Scene.textLayoutOf(n);
      x = n.x; y = n.y; h = L.h;
      align = n.align || 'left';
      w = n.textMode === 'fixed' ? n.w : L.w + (align === 'left' ? n.fontSize : 2);
      color = typeof n.fill === 'string' ? n.fill : '#1E1E1E';
      ws = n.textMode === 'fixed' ? 'pre-wrap' : 'pre';
    } else {
      L = Scene.labelLayout(n, n.label || ' ');
      x = n.x + L.pad; y = L.top; w = n.w - L.pad * 2; h = L.h;
      align = L.align; color = n.labelColor || '#1E1E1E'; ws = 'pre-wrap';
    }
    const lb = Scene.localBox(n);
    Object.assign(ta.style, {
      left: `${x * z + V.x}px`, top: `${y * z + V.y}px`,
      width: `${Math.max(4, w * z)}px`, height: `${Math.max(L.lh, h) * z}px`,
      font: `${L.italic ? 'italic ' : ''}${L.weight} ${L.size * z}px ${L.family}`,
      lineHeight: String(L.lh / L.size), textAlign: align, color, whiteSpace: ws,
      transform: n.rotation && Scene.BOX_TYPES.has(n.type) ? `rotate(${n.rotation}deg)` : '',
      transformOrigin: `${(lb.x + lb.w / 2 - x) * z}px ${(lb.y + lb.h / 2 - y) * z}px`,
    });
  };

  Ed.startEdit = (n, field, isNew) => {
    if (!n || n.locked) return;
    s.editing = { id: n.id, field, isNew, snap: isNew ? null : Ed.snapshot() };
    const ta = el.textEditor;
    ta.value = field === 'text' ? n.text : (n.label || '');
    ta.style.display = 'block';
    Ed.positionEditor();
    Ed.renderCanvas();
    ta.focus();
    if (!isNew) ta.select();
  };

  Ed.commitEdit = () => {
    const ed = s.editing;
    if (!ed) return;
    s.editing = null;
    el.textEditor.style.display = 'none';
    el.textEditor.blur();
    const n = Ed.byId(ed.id);
    if (n) {
      if (ed.field === 'text' && !n.text.trim()) {
        s.doc.nodes = s.doc.nodes.filter(x => x !== n);
        s.selection = s.selection.filter(x => x !== n.id);
        if (ed.isNew) s.undo.pop(); else Ed.pushUndo(ed.snap);
      } else if (!ed.isNew && ed.snap !== Ed.snapshot()) {
        Ed.pushUndo(ed.snap);
      }
    }
    Ed.changed();
  };

  el.textEditor.addEventListener('input', () => {
    const ed = s.editing;
    const n = ed && Ed.byId(ed.id);
    if (!n) return;
    const v = el.textEditor.value;
    if (ed.field === 'text') {
      n.text = v;
      if (n.nameAuto) n.name = Ed.firstLine(v) || Ed.TYPE_LABEL.text;
      Scene.fitText(n);
    } else n.label = v;
    Ed.positionEditor();
    el.textEditor.scrollLeft = 0;
    el.textEditor.scrollTop = 0;
    if (ed.field === 'label') Ed.renderCanvas(); else Ed.renderOverlay();
  });
  el.textEditor.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      Ed.commitEdit();
    }
  });
  el.textEditor.addEventListener('blur', () => Ed.commitEdit());

  // ---------- commands ----------
  const nodesNow = () => s.doc.nodes;

  function removeNodes(list) {
    const ids = new Set(list.map(n => n.id));
    s.doc.nodes = nodesNow().filter(n => !ids.has(n.id));
    s.selection = s.selection.filter(id => !ids.has(id));
  }

  // Insert after the top-most of `anchorNodes`
  function insertAbove(anchorNodes, items) {
    const nodes = nodesNow();
    const top = Math.max(-1, ...anchorNodes.map(n => nodes.indexOf(n)));
    nodes.splice(top + 1, 0, ...items);
  }

  const CLIP_KEY = 'draftboard.clipboard';
  let clipStamp = 0;

  function copy() {
    const sel = Ed.selNodes();
    if (!sel.length) return false;
    const list = Ed.clone(Ed.withChildren(sel));
    s.clipboard = list;
    s.pasteCount = 0;
    clipStamp = Date.now();
    const assets = {};
    Scene.walk(list, n => { if (n.asset) assets[n.asset] = Ed.assetData(n.asset); });
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify({ ts: clipStamp, file: s.fileId, nodes: list, assets }));
    } catch (e) { /* large images: clipboard stays inside this tab */ }
    return true;
  }

  function paste() {
    let list = s.clipboard, sameFile = true;
    try {
      const shared = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null');
      if (shared && shared.ts > clipStamp) {
        clipStamp = shared.ts;
        s.pasteCount = 0;
        sameFile = shared.file === s.fileId;
        const map = {};
        for (const [aid, data] of Object.entries(shared.assets || {})) map[aid] = Ed.addAsset(data);
        Scene.walk(shared.nodes, n => { if (n.asset && map[n.asset]) n.asset = map[n.asset]; });
        s.clipboard = list = shared.nodes;
      }
    } catch (e) { /* use the in-tab clipboard */ }
    if (!list || !list.length) return;
    Ed.checkpoint();
    s.pasteCount++;
    const off = sameFile ? 10 * s.pasteCount : 0;
    const copies = Ed.cloneSet(list, off, off);
    nodesNow().push(...copies);
    const parents = Scene.frameParents(nodesNow());
    s.selection = copies.filter(c => !parents.has(c.id) || !copies.some(o => o.id === parents.get(c.id))).map(c => c.id);
    Ed.changed();
  }

  function duplicate() {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    const list = Ed.withChildren(sel);
    const copies = Ed.cloneSet(list, 10, 10);
    insertAbove(list, copies);
    s.selection = copies.filter((c, i) => sel.includes(list[i])).map(c => c.id);
    Ed.changed();
  }

  function del() {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    removeNodes(Ed.withChildren(sel));
    Ed.changed();
  }

  function group() {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    const list = Ed.withChildren(sel);
    const nodes = nodesNow();
    const top = Math.max(...list.map(n => nodes.indexOf(n)));
    const above = nodes.slice(top + 1).find(n => !list.includes(n));
    const g = Ed.makeNode('group', { children: list });
    s.doc.nodes = nodes.filter(n => !list.includes(n));
    const at = above ? s.doc.nodes.indexOf(above) : s.doc.nodes.length;
    s.doc.nodes.splice(at, 0, g);
    s.selection = [g.id];
    Ed.changed();
  }

  function ungroup() {
    const groups = Ed.selNodes().filter(n => n.type === 'group' || n.type === 'boolean');
    if (!groups.length) return;
    Ed.checkpoint();
    const sel = [];
    for (const g of groups) {
      const i = nodesNow().indexOf(g);
      if (g.opacity < 1) g.children.forEach(c => { c.opacity = r2((c.opacity ?? 1) * g.opacity); });
      nodesNow().splice(i, 1, ...g.children);
      sel.push(...g.children.map(c => c.id));
    }
    s.selection = sel;
    Ed.changed();
  }

  const BOOL_NAMES = { union: '합치기', subtract: '빼기', intersect: '교차', exclude: '제외' };
  function booleanOp(op) {
    const sel = Ed.selNodes();
    if (sel.length === 1 && sel[0].type === 'boolean') {
      Ed.checkpoint();
      sel[0].op = op;
      sel[0].name = BOOL_NAMES[op];
      return Ed.changed();
    }
    const shapes = sel.filter(n => Scene.SHAPE_TYPES.has(n.type));
    if (shapes.length < 2) return Ed.toast('불리언 연산은 도형(사각형·원·다각형·별·벡터)을 두 개 이상 선택해야 합니다.');
    Ed.checkpoint();
    const nodes = nodesNow();
    const top = Math.max(...shapes.map(n => nodes.indexOf(n)));
    const above = nodes.slice(top + 1).find(n => !shapes.includes(n));
    const b = Ed.makeNode('boolean', { op, children: shapes, fill: shapes[0].fill || '#D9D9D9', name: BOOL_NAMES[op] });
    s.doc.nodes = nodes.filter(n => !shapes.includes(n));
    const at = above ? s.doc.nodes.indexOf(above) : s.doc.nodes.length;
    s.doc.nodes.splice(at, 0, b);
    s.selection = [b.id];
    Ed.changed();
  }

  const K = 0.5523;
  function toVector(n) {
    const A = (x, y, ix = null, iy = null, ox = null, oy = null) => ({ x, y, ix, iy, ox, oy });
    let anchors, closed = true;
    switch (n.type) {
      case 'rect': case 'frame': case 'sticky': case 'image': {
        const { x, y, w, h } = n, r = Math.min(n.radius || 0, w / 2, h / 2), k = r * K;
        anchors = !r ? [A(x, y), A(x + w, y), A(x + w, y + h), A(x, y + h)] : [
          A(x + r, y, x + r - k, y), A(x + w - r, y, null, null, x + w - r + k, y),
          A(x + w, y + r, x + w, y + r - k), A(x + w, y + h - r, null, null, x + w, y + h - r + k),
          A(x + w - r, y + h, x + w - r + k, y + h), A(x + r, y + h, null, null, x + r - k, y + h),
          A(x, y + h - r, x, y + h - r + k), A(x, y + r, null, null, x, y + r - k)];
        break;
      }
      case 'ellipse': {
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2, kx = n.w / 2 * K, ky = n.h / 2 * K;
        anchors = [A(cx, n.y, cx - kx, n.y, cx + kx, n.y), A(n.x + n.w, cy, n.x + n.w, cy - ky, n.x + n.w, cy + ky),
          A(cx, n.y + n.h, cx + kx, n.y + n.h, cx - kx, n.y + n.h), A(n.x, cy, n.x, cy + ky, n.x, cy - ky)];
        break;
      }
      case 'polygon': case 'star':
        anchors = Scene.polygonPoints(n).map(([x, y]) => A(x, y));
        break;
      case 'line':
        anchors = n.points.map(([x, y]) => A(x, y));
        closed = false;
        break;
      case 'path': {
        const P = n.points;
        anchors = P.map((p, i) => {
          const p0 = P[i - 1] || p, p2 = P[i + 1] || p, tx = (p2[0] - p0[0]) / 6, ty = (p2[1] - p0[1]) / 6;
          return A(p[0], p[1], i ? p[0] - tx : null, i ? p[1] - ty : null, i < P.length - 1 ? p[0] + tx : null, i < P.length - 1 ? p[1] + ty : null);
        });
        closed = false;
        break;
      }
      default:
        return null;
    }
    if (n.rotation && Scene.BOX_TYPES.has(n.type)) {
      const c = [n.x + n.w / 2, n.y + n.h / 2], R = (x, y) => Scene.rot([x, y], n.rotation, c);
      anchors = anchors.map(a => {
        const o = A(...R(a.x, a.y));
        if (a.ix != null) [o.ix, o.iy] = R(a.ix, a.iy);
        if (a.ox != null) [o.ox, o.oy] = R(a.ox, a.oy);
        return o;
      });
    }
    const round = v => (v == null ? null : r2(v));
    anchors = anchors.map(a => ({ x: r2(a.x), y: r2(a.y), ix: round(a.ix), iy: round(a.iy), ox: round(a.ox), oy: round(a.oy) }));
    const v = Ed.makeNode('vector', {
      name: n.name, anchors, closed, fill: closed ? n.fill : null, stroke: n.stroke, strokeWidth: n.strokeWidth,
      dash: n.dash, opacity: n.opacity, effects: n.effects ? Ed.clone(n.effects) : null,
    });
    if (n.link) v.link = n.link;
    if (n.anim) v.anim = n.anim;
    return v;
  }

  function flatten() {
    const sel = Ed.selNodes().filter(n => n.type !== 'frame');
    if (!sel.length) return;
    const out = sel.map(n => [n, toVector(n)]).filter(([, v]) => v);
    if (!out.length) return Ed.toast('이 레이어는 벡터로 바꿀 수 없습니다.');
    Ed.checkpoint();
    for (const [n, v] of out) nodesNow().splice(nodesNow().indexOf(n), 1, v);
    s.selection = out.map(([, v]) => v.id);
    Ed.changed();
  }

  function frameSelection() {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    const B = Ed.union(sel);
    const f = Ed.makeNode('frame', { x: Math.floor(B.x), y: Math.floor(B.y), w: Math.ceil(B.w), h: Math.ceil(B.h) });
    const idx = Math.min(...sel.map(n => nodesNow().indexOf(n)));
    nodesNow().splice(idx, 0, f);
    s.selection = [f.id];
    Ed.changed();
  }

  function moveAll(list, dx, dy) {
    for (const m of Ed.withChildren(list)) Ed.translate(m, Ed.clone(m), dx, dy);
  }

  function align(kind) {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    let B;
    if (sel.length === 1) {
      const pf = Ed.parentFrameOf(sel[0]);
      if (!pf) return Ed.toast('레이어 하나는 그 레이어를 담은 프레임 기준으로 정렬됩니다.');
      B = Scene.localBox(pf);
    } else B = Ed.union(sel);
    Ed.checkpoint();
    for (const n of sel) {
      const b = Scene.bbox(n);
      let dx = 0, dy = 0;
      if (kind === 'left') dx = B.x - b.x;
      if (kind === 'hcenter') dx = B.x + B.w / 2 - (b.x + b.w / 2);
      if (kind === 'right') dx = B.x + B.w - (b.x + b.w);
      if (kind === 'top') dy = B.y - b.y;
      if (kind === 'vcenter') dy = B.y + B.h / 2 - (b.y + b.h / 2);
      if (kind === 'bottom') dy = B.y + B.h - (b.y + b.h);
      moveAll([n], dx, dy);
    }
    Ed.changed();
  }

  function distribute(axis) {
    const sel = Ed.selNodes();
    if (sel.length < 3) return;
    Ed.checkpoint();
    const k = axis === 'h' ? 'x' : 'y', sz = axis === 'h' ? 'w' : 'h';
    const items = sel.map(n => ({ n, b: Scene.bbox(n) })).sort((a, b) => a.b[k] - b.b[k]);
    const B = Ed.union(sel);
    const gap = (B[sz] - items.reduce((t, i) => t + i.b[sz], 0)) / (items.length - 1);
    let pos = B[k];
    for (const { n, b } of items) {
      const dd = pos - b[k];
      moveAll([n], k === 'x' ? dd : 0, k === 'y' ? dd : 0);
      pos += b[sz] + gap;
    }
    Ed.changed();
  }

  function reorder(mode) {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    const ids = new Set(Ed.withChildren(sel).map(n => n.id));
    const arr = nodesNow();
    const inSet = arr.filter(n => ids.has(n.id)), rest = arr.filter(n => !ids.has(n.id));
    if (mode === 'front') s.doc.nodes = [...rest, ...inSet];
    else if (mode === 'back') s.doc.nodes = [...inSet, ...rest];
    else if (mode === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    } else if (mode === 'backward') {
      for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
    Ed.changed();
  }

  function nudge(dx, dy) {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    moveAll(sel, dx, dy);
    Ed.changed();
  }

  function toggle(prop) {
    const sel = Ed.selNodes();
    if (!sel.length) return;
    Ed.checkpoint();
    if (prop === 'visible') {
      const v = sel.every(n => n.visible === false);
      sel.forEach(n => { n.visible = v; });
    } else {
      const v = !sel.every(n => n.locked);
      sel.forEach(n => { n.locked = v; });
    }
    Ed.changed();
  }

  // ---------- images ----------
  Ed.readImageFile = file => new Promise(resolve => {
    if (!file || !/^image\//.test(file.type)) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ data: reader.result, w: img.naturalWidth || 200, h: img.naturalHeight || 200 });
      img.onerror = () => resolve(null);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

  Ed.insertImageFile = async (file, at) => {
    const im = await Ed.readImageFile(file);
    if (!im) return Ed.toast('이미지를 읽지 못했습니다.');
    const k = Math.min(1, 800 / Math.max(im.w, im.h));
    const w = Math.round(im.w * k), h = Math.round(im.h * k);
    if (!at) {
      const r = svg.getBoundingClientRect();
      at = { x: (r.width / 2 - s.view.x) / s.view.zoom, y: (r.height / 2 - s.view.y) / s.view.zoom };
    }
    Ed.checkpoint();
    const props = { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h, asset: Ed.addAsset(im.data) };
    const name = (file.name || '').replace(/\.[^.]+$/, '');
    if (name) props.name = name;
    const n = Ed.makeNode('image', props);
    nodesNow().push(n);
    adoptIntoFrames([n.id]);
    s.selection = [n.id];
    Ed.changed();
  };

  const imageInput = $('#image-input');
  imageInput.addEventListener('change', async () => {
    const files = [...imageInput.files];
    imageInput.value = '';
    const cb = imageInput._onPick;
    imageInput._onPick = null;
    if (cb) return cb(files);
    for (const f of files) await Ed.insertImageFile(f);
  });
  Ed.pickImages = cb => { imageInput._onPick = cb || null; imageInput.click(); };

  el.stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  el.stage.addEventListener('drop', async e => {
    e.preventDefault();
    const p = Ed.toWorld(e);
    const files = [...e.dataTransfer.files];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (/\.json$/i.test(f.name)) {
        try {
          const meta = await Store.importJSON(await f.text());
          location.href = `editor.html?file=${meta.id}`;
        } catch (err) { Ed.toast(err.message); }
        return;
      }
      await Ed.insertImageFile(f, { x: p.x + i * 24, y: p.y + i * 24 });
    }
  });

  document.addEventListener('paste', e => {
    if (e.target.matches && e.target.matches('input, textarea')) return;
    if (Ed.modalOpen()) return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find(i => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); Ed.insertImageFile(img.getAsFile()); return; }
    paste();
  });

  // ---------- context menu ----------
  svg.addEventListener('contextmenu', e => {
    e.preventDefault();
    const h = hitEl(e.target);
    if (h && !s.selection.includes(h.dataset.id)) { s.selection = [h.dataset.id]; Ed.render(); }
    const sel = Ed.selNodes(), has = sel.length > 0;
    const run = name => () => Ed.run(name);
    const items = [
      { label: '복사', kbd: 'Ctrl+C', run: run('copy'), disabled: !has },
      { label: '붙여넣기', kbd: 'Ctrl+V', run: run('paste') },
      { label: '복제', kbd: 'Ctrl+D', run: run('duplicate'), disabled: !has },
      { label: '삭제', kbd: 'Delete', run: run('delete'), disabled: !has },
      '-',
      { label: '그룹 만들기', kbd: 'Ctrl+G', run: run('group'), disabled: !has },
      { label: '그룹 해제', kbd: 'Ctrl+Shift+G', run: run('ungroup'), disabled: !sel.some(n => n.type === 'group' || n.type === 'boolean') },
      { label: '프레임으로 감싸기', kbd: 'Ctrl+Alt+G', run: run('frameSelection'), disabled: !has },
      { label: '벡터로 변환', kbd: 'Ctrl+E', run: run('flatten'), disabled: !has },
      '-',
      { label: '합치기', kbd: 'Ctrl+Alt+U', icon: I.union, run: run('union'), disabled: sel.length < 2 && !(sel[0] && sel[0].type === 'boolean') },
      { label: '빼기', kbd: 'Ctrl+Alt+S', icon: I.subtract, run: run('subtract'), disabled: sel.length < 2 && !(sel[0] && sel[0].type === 'boolean') },
      { label: '교차', kbd: 'Ctrl+Alt+I', icon: I.intersect, run: run('intersect'), disabled: sel.length < 2 && !(sel[0] && sel[0].type === 'boolean') },
      { label: '제외', kbd: 'Ctrl+Alt+E', icon: I.exclude, run: run('exclude'), disabled: sel.length < 2 && !(sel[0] && sel[0].type === 'boolean') },
      '-',
      { label: '맨 앞으로', kbd: 'Ctrl+Shift+]', run: run('front'), disabled: !has },
      { label: '앞으로', kbd: 'Ctrl+]', run: run('forward'), disabled: !has },
      { label: '뒤로', kbd: 'Ctrl+[', run: run('backward'), disabled: !has },
      { label: '맨 뒤로', kbd: 'Ctrl+Shift+[', run: run('back'), disabled: !has },
      '-',
      { label: '숨기기/표시', kbd: 'Ctrl+Shift+H', run: run('toggleVisible'), disabled: !has },
      { label: '잠금/해제', kbd: 'Ctrl+Shift+L', run: run('toggleLock'), disabled: !has },
      { label: '선택 영역 맞춤 보기', kbd: 'Shift+2', run: run('zoomSelection'), disabled: !has },
    ];
    Ed.dropdown(e.clientX, e.clientY, items);
  });

  // ---------- actions ----------
  Ed.actions = Object.assign(Ed.actions || {}, {
    undo: Ed.undo, redo: Ed.redo, copy,
    cut: () => { if (copy()) del(); },
    paste, duplicate, delete: del,
    selectAll: () => {
      const parents = Scene.frameParents(nodesNow());
      s.selection = nodesNow().filter(n => !n.locked && n.visible !== false && !parents.has(n.id)).map(n => n.id);
      Ed.render();
    },
    group, ungroup, flatten, frameSelection,
    union: () => booleanOp('union'), subtract: () => booleanOp('subtract'),
    intersect: () => booleanOp('intersect'), exclude: () => booleanOp('exclude'),
    front: () => reorder('front'), back: () => reorder('back'), forward: () => reorder('forward'), backward: () => reorder('backward'),
    toggleVisible: () => toggle('visible'), toggleLock: () => toggle('locked'),
    zoomIn: () => Ed.zoomCenter(1.25), zoomOut: () => Ed.zoomCenter(0.8), zoom100: () => Ed.zoomTo(1),
    zoomFit: () => Ed.zoomFit(), zoomSelection: () => Ed.zoomFit(Ed.selNodes(), 64),
    importImage: () => Ed.pickImages(),
  });
  Ed.align = align;
  Ed.distribute = distribute;
  Ed.nudge = nudge;
  Ed.editNode = editNode;
  Ed.run = name => {
    Ed.hideDropdown();
    const fn = Ed.actions[name];
    if (fn) fn();
  };

  // ---------- keyboard ----------
  const TOOL_KEYS = { v: 'select', h: 'hand', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', p: 'pen', m: 'marker', t: 'text', s: 'sticky', x: 'connector', e: 'stamp' };

  window.addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (Ed.modalOpen() || (Ed.present && Ed.present.active())) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), code = e.code;
    if (e.key === 'Alt') {
      e.preventDefault();
      if (!s.altDown) { s.altDown = true; Ed.renderOverlay(); }
      return;
    }
    if (code === 'Space') {
      e.preventDefault();
      if (!s.spaceDown) { s.spaceDown = true; el.stage.classList.add('space'); }
      return;
    }
    if (s.pen && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); return finishPen(); }
    if (s.vecEdit) {
      if (e.key === 'Escape' || e.key === 'Enter') { s.vecEdit = null; return Ed.render(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.vecEdit.sel != null) { e.preventDefault(); return deleteAnchor(); }
    }
    if (mod) {
      let action = null;
      if (e.altKey) {
        action = { u: 'union', s: 'subtract', i: 'intersect', e: 'exclude', g: 'frameSelection', enter: 'present' }[k] || null;
      } else if (e.shiftKey) {
        action = { z: 'redo', g: 'ungroup', h: 'toggleVisible', l: 'toggleLock', k: 'importImage', e: 'exportPNG' }[k] || null;
        if (code === 'BracketRight') action = 'front';
        if (code === 'BracketLeft') action = 'back';
      } else {
        action = {
          z: 'undo', y: 'redo', c: 'copy', x: 'cut', d: 'duplicate', a: 'selectAll', g: 'group', e: 'flatten',
          s: 'saveNow', o: 'openFiles', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', '0': 'zoom100', '/': 'shortcuts',
        }[k] || null;
        if (code === 'BracketRight') action = 'forward';
        if (code === 'BracketLeft') action = 'backward';
      }
      if (action) { e.preventDefault(); Ed.run(action); }
      return;
    }
    if (e.shiftKey && code === 'Digit0') return Ed.run('zoom100');
    if (e.shiftKey && code === 'Digit1') return Ed.run('zoomFit');
    if (e.shiftKey && code === 'Digit2') return Ed.run('zoomSelection');
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'Delete': case 'Backspace': e.preventDefault(); return Ed.run('delete');
      case 'Escape':
        Ed.hideDropdown();
        if (s.tool !== 'select') Ed.setTool('select');
        else { s.selection = []; Ed.render(); }
        return;
      case 'ArrowLeft': e.preventDefault(); return nudge(-step, 0);
      case 'ArrowRight': e.preventDefault(); return nudge(step, 0);
      case 'ArrowUp': e.preventDefault(); return nudge(0, -step);
      case 'ArrowDown': e.preventDefault(); return nudge(0, step);
      case 'Enter': {
        const sel = Ed.selNodes();
        if (sel.length === 1) { e.preventDefault(); editNode(sel[0]); }
        return;
      }
    }
    if (e.altKey) return;
    if (e.shiftKey) {
      if (k === 'l') return Ed.setTool('arrow');
      if (k === 'p') return Ed.setTool('pencil');
      return;
    }
    if (TOOL_KEYS[k]) Ed.setTool(TOOL_KEYS[k]);
  });

  window.addEventListener('keyup', e => {
    if (e.key === 'Alt') { e.preventDefault(); s.altDown = false; Ed.renderOverlay(); }
    if (e.code === 'Space') { s.spaceDown = false; el.stage.classList.remove('space'); }
  });
  window.addEventListener('blur', () => {
    s.spaceDown = false;
    el.stage.classList.remove('space');
    if (s.altDown) { s.altDown = false; Ed.renderOverlay(); }
  });

  Ed.renderTools = renderTools;
})();
