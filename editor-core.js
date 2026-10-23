'use strict';
/* Draftboard editor — state, document model, history, saving and canvas rendering. */
(() => {
  const { esc, r2, clamp } = Scene;
  const $ = (sel, root = document) => root.querySelector(sel);
  const params = new URLSearchParams(location.search);

  const Ed = window.Ed = {};
  const s = Ed.s = {
    doc: null, meta: null, fileId: null, assets: new Map(), savedAssets: new Set(),
    view: { x: 0, y: 0, zoom: 1 }, selection: [], tool: 'select',
    undo: [], redo: [], clipboard: null, pasteCount: 0,
    drag: null, hoverId: null, spaceDown: false, altDown: false,
    editing: null, vecEdit: null, pen: null, anim: null, connectTarget: null,
    rightTab: 'design', leftTab: 'layers', codeLang: 'css', exportScale: 2,
    stamp: '👍', stickyColor: '#FFE066', collapsed: new Set(), expanded: new Set(),
    demo: params.has('demo'),
  };
  const el = Ed.el = {
    stage: $('#stage'), svg: $('#canvas'), world: $('#world'), overlay: $('#overlay'), textEditor: $('#text-editor'),
  };

  Ed.TYPE_LABEL = {
    frame: '프레임', rect: '사각형', ellipse: '원', polygon: '다각형', star: '별', line: '선', path: '그리기',
    vector: '벡터', text: '텍스트', image: '이미지', sticky: '스티커 메모', connector: '연결선', group: '그룹', boolean: '불리언',
  };
  Ed.KINDS = { design: '디자인', illustration: '일러스트', whiteboard: '화이트보드', slides: '슬라이드', site: '사이트', buzz: '대량 제작', motion: '모션' };
  Ed.STICKY_COLORS = ['#FFE066', '#FFC9C9', '#B2F2BB', '#A5D8FF', '#D0BFFF', '#FFD8A8', '#E9ECEF', '#FFFFFF'];
  Ed.DEFAULT_BGS = ['#F5F5F5', '#F4F1EA'];
  const FONT = Scene.DEFAULT_FONT;
  const DEFAULTS = {
    frame: { fill: '#FFFFFF', radius: 0 },
    rect: { fill: '#D9D9D9', radius: 0 },
    ellipse: { fill: '#D9D9D9' },
    polygon: { fill: '#D9D9D9', sides: 3 },
    star: { fill: '#D9D9D9', starPoints: 5, innerRatio: 0.45 },
    line: { fill: null, stroke: '#1E1E1E', strokeWidth: 2, arrowStart: 'none', arrowEnd: 'none' },
    path: { fill: null, stroke: '#1E1E1E', strokeWidth: 3 },
    vector: { fill: null, stroke: '#1E1E1E', strokeWidth: 2, anchors: [], closed: false },
    text: { fill: '#1E1E1E', fontSize: 24, fontWeight: 400, fontFamily: FONT, text: '', textMode: 'auto', align: 'left', lineHeight: 1.25 },
    image: { fill: null, fit: 'cover', radius: 0 },
    sticky: { fill: '#FFE066', label: '', radius: 2, fontFamily: FONT, effects: { shadow: { x: 0, y: 2, blur: 8, color: '#000000', opacity: 0.15 }, blur: 0 } },
    connector: { fill: null, stroke: '#1E1E1E', strokeWidth: 2, from: null, to: null, points: [[0, 0], [0, 0]], route: 'straight', arrowStart: 'none', arrowEnd: 'arrow' },
    group: { children: [] },
    boolean: { fill: '#D9D9D9', op: 'union', children: [] },
  };

  const clone = Ed.clone = o => JSON.parse(JSON.stringify(o));
  Ed.firstLine = t => String(t || '').split('\n')[0].trim().slice(0, 40);

  // ---------- nodes ----------
  Ed.makeNode = (type, props = {}, d = s.doc) => {
    const count = d.nodes.filter(n => n.type === type).length + 1;
    const n = {
      id: 'n' + d.nextId++, type, name: `${Ed.TYPE_LABEL[type]} ${count}`,
      opacity: 1, visible: true, locked: false, rotation: 0, stroke: null, strokeWidth: 1, effects: null,
      ...clone(DEFAULTS[type] || {}), ...props,
    };
    if (type === 'text') {
      n.nameAuto = !props.name;
      Scene.fitText(n);
      if (n.nameAuto && n.text) n.name = Ed.firstLine(n.text);
    }
    return n;
  };

  function reid(n, map) {
    const nid = 'n' + s.doc.nextId++;
    map.set(n.id, nid);
    n.id = nid;
    if (n.children) n.children.forEach(c => reid(c, map));
  }

  // Deep copies with fresh ids; connectors inside the set stay attached to the copies.
  Ed.cloneSet = (nodes, dx = 0, dy = 0) => {
    const map = new Map();
    const out = nodes.map(n => { const c = clone(n); reid(c, map); return c; });
    for (const c of out) {
      if (c.type === 'connector') {
        for (const end of ['from', 'to']) {
          if (!c[end]) continue;
          const nid = map.get(c[end].id);
          c[end] = nid ? { id: nid } : null;
        }
      }
      if (dx || dy) Ed.translate(c, clone(c), dx, dy);
    }
    return out;
  };

  Ed.byId = id => s.doc.nodes.find(n => n.id === id);
  Ed.selNodes = () => s.doc.nodes.filter(n => s.selection.includes(n.id));
  Ed.union = nodes => Scene.unionBox(nodes);
  Ed.childrenOf = f => Scene.childrenIn(s.doc.nodes, f);
  Ed.contentOf = f => [f, ...Ed.childrenOf(f)];
  Ed.parentFrameOf = n => {
    const p = Scene.frameParents(s.doc.nodes).get(n.id);
    return p ? Ed.byId(p) : null;
  };
  Ed.topFrames = () => {
    const p = Scene.frameParents(s.doc.nodes);
    return s.doc.nodes.filter(n => n.type === 'frame' && !p.has(n.id));
  };
  // Selected nodes plus everything inside selected frames, in z-order
  Ed.withChildren = nodes => {
    const ids = new Set(nodes.map(n => n.id));
    for (const n of nodes) if (n.type === 'frame') for (const c of Ed.childrenOf(n)) ids.add(c.id);
    return s.doc.nodes.filter(n => ids.has(n.id));
  };

  // Frames in presentation order (doc.slideOrder, then by position)
  Ed.slideFrames = () => {
    const frames = Ed.topFrames();
    const order = (s.doc.slideOrder || []).filter(id => frames.some(f => f.id === id));
    const rest = frames.filter(f => !order.includes(f.id)).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    s.doc.slideOrder = [...order, ...rest.map(f => f.id)];
    return s.doc.slideOrder.map(Ed.byId);
  };

  // ---------- geometry edits ----------
  // M maps points: { pt([x, y]) -> [x, y], sx, sy }
  function mapNode(n, o, M) {
    switch (o.type) {
      case 'line': case 'path': case 'connector':
        n.points = o.points.map(p => M.pt(p).map(r2));
        break;
      case 'vector':
        n.anchors = o.anchors.map(a => {
          const [x, y] = M.pt([a.x, a.y]);
          const out = { x: r2(x), y: r2(y), ix: null, iy: null, ox: null, oy: null };
          if (a.ix != null) [out.ix, out.iy] = M.pt([a.ix, a.iy]).map(r2);
          if (a.ox != null) [out.ox, out.oy] = M.pt([a.ox, a.oy]).map(r2);
          return out;
        });
        break;
      case 'group': case 'boolean':
        n.children.forEach((c, i) => mapNode(c, o.children[i], M));
        break;
      case 'text': {
        const [cx, cy] = M.pt([o.x + o.w / 2, o.y + o.h / 2]);
        if (o.textMode === 'fixed') n.w = Math.max(1, r2(o.w * Math.abs(M.sx)));
        Scene.fitText(n);
        n.x = r2(cx - n.w / 2);
        n.y = r2(cy - n.h / 2);
        break;
      }
      default:
        if (o.rotation) {
          const [cx, cy] = M.pt([o.x + o.w / 2, o.y + o.h / 2]);
          const a = o.rotation * Math.PI / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
          const w = o.w * Math.hypot(M.sx * c, M.sy * sn), h = o.h * Math.hypot(M.sx * sn, M.sy * c);
          n.w = r2(w); n.h = r2(h); n.x = r2(cx - w / 2); n.y = r2(cy - h / 2);
        } else {
          const [x1, y1] = M.pt([o.x, o.y]), [x2, y2] = M.pt([o.x + o.w, o.y + o.h]);
          n.x = r2(Math.min(x1, x2)); n.y = r2(Math.min(y1, y2));
          n.w = r2(Math.abs(x2 - x1)); n.h = r2(Math.abs(y2 - y1));
        }
    }
  }
  Ed.mapNode = mapNode;

  Ed.translate = (n, o, dx, dy) => {
    if (o.type === 'text') {
      n.x = r2(o.x + dx); n.y = r2(o.y + dy);
      return;
    }
    mapNode(n, o, { pt: ([x, y]) => [x + dx, y + dy], sx: 1, sy: 1 });
  };

  Ed.boxMap = (B, NB) => {
    const SX = B.w ? NB.w / B.w : 1, SY = B.h ? NB.h / B.h : 1;
    return { pt: ([x, y]) => [NB.x + (x - B.x) * SX, NB.y + (y - B.y) * SY], sx: SX, sy: SY };
  };

  const normAngle = a => {
    a = ((a % 360) + 360) % 360;
    return r2(a > 180 ? a - 360 : a);
  };

  function rotateNode(n, o, ang, c) {
    const R = p => Scene.rot(p, ang, c).map(r2);
    switch (o.type) {
      case 'line': case 'path': case 'connector':
        n.points = o.points.map(R);
        break;
      case 'vector':
        n.anchors = o.anchors.map(a => {
          const [x, y] = R([a.x, a.y]);
          const out = { x, y, ix: null, iy: null, ox: null, oy: null };
          if (a.ix != null) [out.ix, out.iy] = R([a.ix, a.iy]);
          if (a.ox != null) [out.ox, out.oy] = R([a.ox, a.oy]);
          return out;
        });
        break;
      case 'group': case 'boolean':
        n.children.forEach((ch, i) => rotateNode(ch, o.children[i], ang, c));
        break;
      default: {
        const [nx, ny] = Scene.rot([o.x + o.w / 2, o.y + o.h / 2], ang, c);
        n.x = r2(nx - o.w / 2); n.y = r2(ny - o.h / 2);
        n.rotation = normAngle((o.rotation || 0) + ang);
      }
    }
  }
  Ed.rotateNode = rotateNode;
  Ed.normAngle = normAngle;

  // Keep connector ends glued to the shapes they are attached to
  function anchorPoint(node, toward) {
    const b = Scene.bbox(node), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = toward[0] - cx, dy = toward[1] - cy;
    if (!dx && !dy) return [cx, cy];
    let t;
    if (node.type === 'ellipse') t = 1 / Math.sqrt((dx / (b.w / 2 || 1)) ** 2 + (dy / (b.h / 2 || 1)) ** 2);
    else t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
    return [r2(cx + dx * t), r2(cy + dy * t)];
  }

  function syncConnectors() {
    for (const c of s.doc.nodes) {
      if (c.type !== 'connector') continue;
      const A = c.from && Ed.byId(c.from.id), B = c.to && Ed.byId(c.to.id);
      if (c.from && !A) c.from = null;
      if (c.to && !B) c.to = null;
      if (!A && !B) continue;
      const pts = c.points;
      const p0 = pts[0], p1 = pts[pts.length - 1];
      const ca = A ? center(A) : p0, cb = B ? center(B) : p1;
      if (c.route === 'elbow') {
        const ba = A ? Scene.bbox(A) : { x: ca[0], y: ca[1], w: 0, h: 0 };
        const bb = B ? Scene.bbox(B) : { x: cb[0], y: cb[1], w: 0, h: 0 };
        const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
        let s0, s1, mid;
        if (Math.abs(dx) >= Math.abs(dy)) {
          s0 = [dx >= 0 ? ba.x + ba.w : ba.x, ca[1]];
          s1 = [dx >= 0 ? bb.x : bb.x + bb.w, cb[1]];
          const mx = r2((s0[0] + s1[0]) / 2);
          mid = [[mx, s0[1]], [mx, s1[1]]];
        } else {
          s0 = [ca[0], dy >= 0 ? ba.y + ba.h : ba.y];
          s1 = [cb[0], dy >= 0 ? bb.y : bb.y + bb.h];
          const my = r2((s0[1] + s1[1]) / 2);
          mid = [[s0[0], my], [s1[0], my]];
        }
        c.points = [s0, ...mid, s1].map(p => p.map(r2));
      } else {
        c.points = [A ? anchorPoint(A, cb) : p0, B ? anchorPoint(B, ca) : p1];
      }
    }
  }
  const center = n => { const b = Scene.bbox(n); return [b.x + b.w / 2, b.y + b.h / 2]; };
  Ed.syncConnectors = syncConnectors;

  // ---------- history ----------
  Ed.snapshot = () => JSON.stringify(s.doc);
  Ed.pushUndo = snap => {
    s.undo.push(snap);
    if (s.undo.length > 150) s.undo.shift();
    s.redo.length = 0;
  };
  Ed.checkpoint = () => Ed.pushUndo(Ed.snapshot());
  function restore(json) {
    s.doc = JSON.parse(json);
    s.selection = s.selection.filter(id => Ed.byId(id));
    s.vecEdit = null;
    s.pen = null;
    Ed.changed();
  }
  Ed.undo = () => {
    if (s.editing) Ed.commitEdit();
    if (!s.undo.length) return;
    s.redo.push(Ed.snapshot());
    restore(s.undo.pop());
  };
  Ed.redo = () => {
    if (!s.redo.length) return;
    s.undo.push(Ed.snapshot());
    restore(s.redo.pop());
  };
  Ed.changed = () => {
    Ed.render();
    Ed.scheduleSave();
  };

  // ---------- assets ----------
  const blobURLs = new Map();
  function dataToBlob(d) {
    const i = d.indexOf(',');
    const head = d.slice(0, i), body = d.slice(i + 1);
    const mime = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
    if (!/;base64/.test(head)) return new Blob([decodeURIComponent(body)], { type: mime });
    const bin = atob(body), u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: mime });
  }
  Ed.addAsset = dataURL => {
    for (const [id, v] of s.assets) if (v === dataURL) return id;
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    s.assets.set(id, dataURL);
    return id;
  };
  Ed.assetData = id => s.assets.get(id) || '';
  Ed.assetURL = id => {
    let u = blobURLs.get(id);
    if (!u) {
      const d = s.assets.get(id);
      if (!d) return '';
      u = URL.createObjectURL(dataToBlob(d));
      blobURLs.set(id, u);
    }
    return u;
  };

  // ---------- documents ----------
  function normalizeNode(n) {
    if (n.opacity == null) n.opacity = 1;
    if (n.visible == null) n.visible = true;
    if (n.rotation == null) n.rotation = 0;
    if (n.strokeWidth == null) n.strokeWidth = 1;
    if (n.type === 'text') {
      n.textMode = n.textMode || 'auto';
      n.align = n.align || 'left';
      n.lineHeight = n.lineHeight || 1.25;
      n.fontFamily = n.fontFamily || FONT;
      Scene.fitText(n);
    }
    if (n.children) n.children.forEach(normalizeNode);
    return n;
  }

  Ed.normalizeDoc = d => {
    d.version = 2;
    d.name = d.name || '제목 없음';
    d.kind = d.kind || 'design';
    d.bg = d.bg || (d.kind === 'whiteboard' ? '#F4F1EA' : '#F5F5F5');
    d.nodes = (d.nodes || []).map(normalizeNode);
    d.slideOrder = d.slideOrder || [];
    let max = 0;
    Scene.walk(d.nodes, n => { max = Math.max(max, parseInt(String(n.id).slice(1), 10) || 0); });
    d.nextId = Math.max(d.nextId || 1, max + 1);
    return d;
  };

  Ed.blankDoc = (kind = 'design', name) => ({
    version: 2, kind, name: name || `제목 없는 ${Ed.KINDS[kind] || '파일'}`,
    bg: kind === 'whiteboard' ? '#F4F1EA' : '#F5F5F5', nextId: 1, nodes: [], slideOrder: [], protoStart: null,
  });

  // ---------- saving ----------
  let saveTimer = null, thumbTimer = null, lastThumb = 0, thumbDirty = false;
  const saveState = $('#save-state');
  const setSaveState = t => { if (saveState) saveState.textContent = t; };

  Ed.scheduleSave = () => {
    if (s.demo || !s.fileId) return;
    setSaveState('저장 중…');
    thumbDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(Ed.saveNow, 400);
  };

  Ed.saveNow = async () => {
    clearTimeout(saveTimer);
    if (s.demo || !s.fileId) return;
    s.meta.name = s.doc.name;
    s.meta.kind = s.doc.kind;
    s.meta.updatedAt = Date.now();
    const fresh = [...s.assets].filter(([id]) => !s.savedAssets.has(id));
    try {
      await Store.saveFile({ ...s.meta }, s.doc, fresh);
      fresh.forEach(([id]) => s.savedAssets.add(id));
      setSaveState('저장됨');
    } catch (e) {
      setSaveState('저장 실패');
      Ed.toast('저장하지 못했습니다: ' + e.message);
    }
    if (thumbDirty) {
      clearTimeout(thumbTimer);
      thumbTimer = setTimeout(makeThumb, Math.max(300, 2500 - (Date.now() - lastThumb)));
    }
  };

  // Called before leaving the editor so the file list shows an up-to-date picture.
  Ed.flushThumb = async () => {
    clearTimeout(thumbTimer);
    if (thumbDirty && !s.demo && s.fileId) await makeThumb();
  };

  async function makeThumb() {
    lastThumb = Date.now();
    thumbDirty = false;
    try {
      const frames = s.doc.kind === 'slides' ? Ed.slideFrames() : [];
      const nodes = frames.length ? Ed.contentOf(frames[0]) : s.doc.nodes.filter(n => n.visible !== false);
      if (!nodes.length) s.meta.thumb = '';
      else {
        const region = frames.length ? Scene.localBox(frames[0]) : null;
        const b = region || Scene.unionBox(nodes);
        const scale = Math.min(1, 480 / Math.max(1, b.w + 40), 300 / Math.max(1, b.h + 40));
        const c = await Ed.canvasOf(nodes, { region, scale, pad: 20, fillBg: frames.length ? null : s.doc.bg });
        s.meta.thumb = c.toDataURL('image/png');
      }
      await Store.putMeta({ ...s.meta });
    } catch (e) { /* thumbnails are optional */ }
  }

  // Drop stored images that no node uses any more (done on open, never mid-session)
  async function collectGarbage() {
    const used = new Set();
    Scene.walk(s.doc.nodes, n => { if (n.asset) used.add(n.asset); });
    const unused = [...s.assets.keys()].filter(id => !used.has(id));
    if (!unused.length) return;
    unused.forEach(id => { s.assets.delete(id); s.savedAssets.delete(id); });
    try { await Store.removeAssets(s.fileId, unused); } catch (e) { /* keep going */ }
  }

  Ed.openFile = async id => {
    const f = await Store.loadFile(id);
    if (!f) return false;
    s.fileId = id;
    s.meta = f.meta;
    s.doc = Ed.normalizeDoc(f.doc);
    s.doc.kind = s.doc.kind || f.meta.kind;
    s.assets = new Map(f.assets);
    s.savedAssets = new Set(s.assets.keys());
    s.undo = []; s.redo = []; s.selection = [];
    await collectGarbage();
    return true;
  };

  Ed.createFile = async (kind, doc) => {
    const id = Store.newId(), now = Date.now();
    s.fileId = id;
    s.doc = Ed.normalizeDoc(doc || Ed.blankDoc(kind));
    s.meta = { id, name: s.doc.name, kind: s.doc.kind, thumb: '', createdAt: now, updatedAt: now };
    s.undo = []; s.redo = []; s.selection = [];
    thumbDirty = true;
    await Ed.saveNow();
    history.replaceState(null, '', `editor.html?file=${id}`);
  };

  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Ed.saveNow(); });
  window.addEventListener('pagehide', () => Ed.saveNow());

  // ---------- rendering ----------
  Ed.render = () => {
    Ed.renderCanvas();
    if (Ed.renderPanels) Ed.renderPanels();
  };

  function frameLabels() {
    const z = s.view.zoom;
    const parents = Scene.frameParents(s.doc.nodes);
    const slides = s.doc.kind === 'slides' ? Ed.slideFrames() : [];
    return s.doc.nodes.filter(n => n.type === 'frame' && n.visible !== false && !parents.has(n.id)).map(n => {
      const i = slides.indexOf(n);
      let name = (i >= 0 && !n.name.includes(String(i + 1)) ? `${i + 1}.  ` : '') + n.name;
      if (n.site && n.site.page) name += `  ·  /${n.site.page}  ${(Codegen.BREAKPOINTS[n.site.bp] || Codegen.BREAKPOINTS.desktop).label}`;
      return `<text class="frame-label${s.selection.includes(n.id) ? ' sel' : ''}" data-id="${n.id}"${n.locked ? ' pointer-events="none"' : ''} x="${n.x}" y="${r2(n.y - 6 / z)}" style="font-size:${r2(11 / z)}px">${esc(name)}</text>`;
    }).join('');
  }

  Ed.renderCanvas = () => {
    syncConnectors();
    const z = s.view.zoom, V = s.view;
    const ctx = {
      defs: [], hit: true, zoom: z, prefix: 'w', imageHref: Ed.assetURL, anim: s.anim,
      editingId: s.editing && s.editing.field === 'text' ? s.editing.id : null,
      editingLabelId: s.editing && s.editing.field === 'label' ? s.editing.id : null,
    };
    const body = s.doc.nodes.map(n => Scene.nodeSVG(n, ctx, true)).join('');
    el.world.setAttribute('transform', `translate(${r2(V.x)} ${r2(V.y)}) scale(${z})`);
    el.world.innerHTML = `<defs>${ctx.defs.join('')}</defs>${body}${frameLabels()}`;

    let step = 20 * z;
    while (step < 12) step *= 2;
    while (step > 48) step /= 2;
    // An untouched default background follows the light / gray / dark theme.
    el.stage.style.backgroundColor = Ed.DEFAULT_BGS.includes(String(s.doc.bg).toUpperCase()) ? '' : s.doc.bg;
    el.stage.classList.toggle('board', s.doc.kind === 'whiteboard');
    el.stage.style.backgroundSize = `${step}px ${step}px`;
    el.stage.style.backgroundPosition = `${V.x}px ${V.y}px`;

    Ed.renderOverlay();
    $('#zoom-btn').textContent = Math.round(z * 100) + '%';
    $('#undo-btn').disabled = !s.undo.length;
    $('#redo-btn').disabled = !s.redo.length;
    const nameInput = $('#doc-name');
    if (document.activeElement !== nameInput) nameInput.value = s.doc.name;
    $('#kind-badge').textContent = Ed.KINDS[s.doc.kind] || '';
    document.title = `${s.doc.name} – Draftboard`;
    if (s.editing && Ed.positionEditor) Ed.positionEditor();
  };

  // ---------- overlay (selection, handles, guides) ----------
  const ANGLES = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  function resizeCursor(handle, rotation) {
    const a = ((ANGLES[handle] + (rotation || 0)) % 180 + 180) % 180;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(a / 45) % 4];
  }

  Ed.renderOverlay = () => {
    const z = s.view.zoom, V = s.view;
    const S = ([x, y]) => [r2(x * z + V.x), r2(y * z + V.y)];
    const SB = b => ({ x: r2(b.x * z + V.x), y: r2(b.y * z + V.y), w: r2(b.w * z), h: r2(b.h * z) });
    const poly = (pts, cls) => `<polygon class="${cls}" points="${pts.map(p => S(p).join(',')).join(' ')}"/>`;
    const outline = (n, cls) => {
      if ((n.type === 'line' || n.type === 'connector') && n.points) {
        return `<polyline class="${cls}" points="${n.points.map(p => S(p).join(',')).join(' ')}"/>`;
      }
      if (n.rotation && Scene.BOX_TYPES.has(n.type)) {
        const lb = Scene.localBox(n), c = [lb.x + lb.w / 2, lb.y + lb.h / 2];
        return poly(Scene.corners(lb).map(p => Scene.rot(p, n.rotation, c)), cls);
      }
      const b = SB(Scene.bbox(n));
      return `<rect class="${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
    };
    const d = s.drag;
    let h = '';

    if (s.rightTab === 'proto') h += protoOverlay(S);

    const hov = s.hoverId && !s.selection.includes(s.hoverId) && Ed.byId(s.hoverId);
    if (hov && (!d || d.type === 'connect' || d.type === 'pt')) h += outline(hov, d ? 'target' : 'hover');

    const nodes = Ed.selNodes();
    if (nodes.length && !s.pen) {
      const single = nodes.length === 1 ? nodes[0] : null;
      if (single && s.vecEdit && s.vecEdit.id === single.id) {
        h += vectorOverlay(single, S);
      } else {
        if (!single) for (const n of nodes) h += outline(n, 'outline');
        const isLine = single && (single.type === 'line' || single.type === 'connector');
        const rotated = single && single.rotation && Scene.BOX_TYPES.has(single.type);
        let pts, sizeW, sizeH;
        if (rotated) {
          const lb = Scene.localBox(single), c = [lb.x + lb.w / 2, lb.y + lb.h / 2];
          pts = Scene.corners(lb).map(p => Scene.rot(p, single.rotation, c));
          sizeW = lb.w; sizeH = lb.h;
        } else {
          const B = Ed.union(nodes);
          pts = Scene.corners(B);
          sizeW = B.w; sizeH = B.h;
        }
        if (isLine) h += outline(single, 'sel');
        else h += poly(pts, 'sel');
        const busy = d && (d.type === 'move' || d.type === 'rotate') && d.moved;
        if (!s.editing && !busy && !nodes.some(n => n.locked)) {
          if (isLine) {
            const P = single.points;
            [0, P.length - 1].forEach(i => {
              const [x, y] = S(P[i]);
              h += `<circle class="handle pt" data-pt="${i}" cx="${x}" cy="${y}" r="5"/>`;
            });
          } else {
            const sp = pts.map(S);
            const mid = (a, b) => [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)];
            const H = [['nw', sp[0]], ['n', mid(sp[0], sp[1])], ['ne', sp[1]], ['e', mid(sp[1], sp[2])],
              ['se', sp[2]], ['s', mid(sp[2], sp[3])], ['sw', sp[3]], ['w', mid(sp[3], sp[0])]];
            const wS = Math.hypot(sp[1][0] - sp[0][0], sp[1][1] - sp[0][1]);
            const hS = Math.hypot(sp[3][0] - sp[0][0], sp[3][1] - sp[0][1]);
            const cx = (sp[0][0] + sp[2][0]) / 2, cy = (sp[0][1] + sp[2][1]) / 2;
            if (!nodes.some(n => n.type === 'frame')) {
              for (const [name, [x, y]] of H) {
                if (name.length !== 2) continue;
                const len = Math.hypot(x - cx, y - cy) || 1;
                h += `<circle class="rot-zone" data-rotate="1" cx="${r2(x + (x - cx) / len * 9)}" cy="${r2(y + (y - cy) / len * 9)}" r="10"/>`;
              }
            }
            const textOnly = single && single.type === 'text';
            const rotation = rotated ? single.rotation : 0;
            for (const [name, [x, y]] of H) {
              if ((name === 'n' || name === 's') && (wS < 24 || textOnly)) continue;
              if ((name === 'e' || name === 'w') && hS < 24 && !textOnly) continue;
              h += `<rect class="handle" data-handle="${name}" x="${x - 4}" y="${y - 4}" width="8" height="8" style="cursor:${resizeCursor(name, rotation)}"/>`;
            }
          }
        }
        if (!isLine) {
          const sp = pts.map(S);
          const label = `${r2(sizeW)} × ${r2(sizeH)}`;
          const lw = label.length * 6.4 + 12;
          const lx = (Math.min(...sp.map(p => p[0])) + Math.max(...sp.map(p => p[0]))) / 2 - lw / 2;
          const ly = Math.max(...sp.map(p => p[1])) + 8;
          h += `<rect class="size-bg" x="${r2(lx)}" y="${r2(ly)}" width="${r2(lw)}" height="18" rx="3"/><text class="size-text" x="${r2(lx + lw / 2)}" y="${r2(ly + 13)}" text-anchor="middle">${label}</text>`;
        }
      }
    }

    if (s.pen) {
      const n = Ed.byId(s.pen.id);
      if (n) {
        h += vectorOverlay(n, S, true);
        const A = n.anchors;
        if (A.length && s.pen.cursor && !(d && d.type === 'pen')) {
          const last = A[A.length - 1];
          const [x1, y1] = S([last.x, last.y]), [x2, y2] = S([s.pen.cursor.x, s.pen.cursor.y]);
          h += last.ox != null
            ? `<path class="rubber" d="M${x1} ${y1}Q${S([last.ox, last.oy]).join(' ')} ${x2} ${y2}"/>`
            : `<line class="rubber" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
        }
      }
    }

    if (d && d.type === 'marquee') {
      const m = SB(rectFrom(d.start, d.cur));
      h += `<rect class="marquee" x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}"/>`;
    }
    if (d && d.guides) {
      for (const gx of d.guides.x) { const x = r2(gx * z + V.x); h += `<line class="guide" x1="${x}" y1="0" x2="${x}" y2="100%"/>`; }
      for (const gy of d.guides.y) { const y = r2(gy * z + V.y); h += `<line class="guide" x1="0" y1="${y}" x2="100%" y2="${y}"/>`; }
    }
    if (!d) h += measureOverlay(S, SB);
    el.overlay.innerHTML = h;
  };

  function rectFrom(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  Ed.rectFrom = rectFrom;

  function vectorOverlay(n, S, drafting) {
    const A = n.anchors || [];
    const sn = { anchors: A.map(a => {
      const [x, y] = S([a.x, a.y]);
      const o = { x, y, ix: null, iy: null, ox: null, oy: null };
      if (a.ix != null) [o.ix, o.iy] = S([a.ix, a.iy]);
      if (a.ox != null) [o.ox, o.oy] = S([a.ox, a.oy]);
      return o;
    }), closed: n.closed };
    let h = `<path class="vec-path" d="${Scene.vectorD(sn)}"/>`;
    const sel = s.vecEdit ? s.vecEdit.sel : A.length - 1;
    sn.anchors.forEach((a, i) => {
      const near = drafting || A.length <= 16 || Math.abs(i - sel) <= 1;
      if (!near) return;
      if (a.ix != null) h += `<line class="ctrl-line" x1="${a.x}" y1="${a.y}" x2="${a.ix}" y2="${a.iy}"/><circle class="ctrl" data-ctrl="${i}:in" cx="${a.ix}" cy="${a.iy}" r="4"/>`;
      if (a.ox != null) h += `<line class="ctrl-line" x1="${a.x}" y1="${a.y}" x2="${a.ox}" y2="${a.oy}"/><circle class="ctrl" data-ctrl="${i}:out" cx="${a.ox}" cy="${a.oy}" r="4"/>`;
    });
    sn.anchors.forEach((a, i) => {
      const closeHint = drafting && i === 0 && A.length > 2 && s.pen && s.pen.cursor && Math.hypot(A[0].x - s.pen.cursor.x, A[0].y - s.pen.cursor.y) * s.view.zoom < 8;
      h += `<rect class="anchor${i === sel ? ' on' : ''}${closeHint ? ' close' : ''}" data-anchor="${i}" x="${r2(a.x - 4)}" y="${r2(a.y - 4)}" width="8" height="8"/>`;
    });
    return h;
  }

  function protoOverlay(S) {
    let h = '';
    const start = s.doc.protoStart && Ed.byId(s.doc.protoStart);
    if (start) {
      const [x, y] = S([start.x, start.y]);
      h += `<g class="proto-start" transform="translate(${x} ${r2(y - 40)})"><rect width="58" height="18" rx="4"/><text x="9" y="13">▶ 시작</text></g>`;
    }
    for (const n of s.doc.nodes) {
      if (!n.link || !n.link.target || n.link.target.startsWith('__')) continue;
      const t = Ed.byId(n.link.target);
      if (!t) continue;
      const a = Scene.bbox(n), b = Scene.bbox(t);
      const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
      const near = (v, lo, hi) => clamp(v, lo + Math.min(20, (hi - lo) / 2), hi - Math.min(20, (hi - lo) / 2));
      // Leave sideways when the target is beside the layer, otherwise up or down.
      let p1, p2, d1, d2;
      if (b.x > a.x + a.w) { p1 = [a.x + a.w, ac[1]]; p2 = [b.x, near(ac[1], b.y, b.y + b.h)]; d1 = [1, 0]; d2 = [-1, 0]; }
      else if (b.x + b.w < a.x) { p1 = [a.x, ac[1]]; p2 = [b.x + b.w, near(ac[1], b.y, b.y + b.h)]; d1 = [-1, 0]; d2 = [1, 0]; }
      else if (bc[1] >= ac[1]) { p1 = [ac[0], a.y + a.h]; p2 = [near(ac[0], b.x, b.x + b.w), b.y]; d1 = [0, 1]; d2 = [0, -1]; }
      else { p1 = [ac[0], a.y]; p2 = [near(ac[0], b.x, b.x + b.w), b.y + b.h]; d1 = [0, -1]; d2 = [0, 1]; }
      const P1 = S(p1), P2 = S(p2);
      const k = Math.max(30, Math.hypot(P2[0] - P1[0], P2[1] - P1[1]) / 3);
      const head = d2[0] ? `l${d2[0] * 8} -5v10z` : `l-5 ${d2[1] * 8}h10z`;
      h += `<path class="proto-link" d="M${P1[0]} ${P1[1]}C${r2(P1[0] + d1[0] * k)} ${r2(P1[1] + d1[1] * k)} ${r2(P2[0] + d2[0] * k)} ${r2(P2[1] + d2[1] * k)} ${P2[0]} ${P2[1]}"/>`
        + `<circle class="proto-dot" cx="${P1[0]}" cy="${P1[1]}" r="4"/>`
        + `<path class="proto-head" d="M${P2[0]} ${P2[1]}${head}"/>`;
    }
    return h;
  }

  function measureOverlay(S, SB) {
    if (!s.altDown || !s.selection.length || !s.hoverId || s.selection.includes(s.hoverId)) return '';
    const other = Ed.byId(s.hoverId);
    if (!other) return '';
    const A = Ed.union(Ed.selNodes()), B = Scene.bbox(other);
    const lines = [];
    if (Scene.inside(B, A)) {
      const cy = A.y + A.h / 2, cx = A.x + A.w / 2;
      lines.push([[B.x, cy], [A.x, cy]], [[A.x + A.w, cy], [B.x + B.w, cy]], [[cx, B.y], [cx, A.y]], [[cx, A.y + A.h], [cx, B.y + B.h]]);
    } else {
      const oy1 = Math.max(A.y, B.y), oy2 = Math.min(A.y + A.h, B.y + B.h);
      const ox1 = Math.max(A.x, B.x), ox2 = Math.min(A.x + A.w, B.x + B.w);
      const my = oy2 > oy1 ? (oy1 + oy2) / 2 : A.y + A.h / 2;
      const mx = ox2 > ox1 ? (ox1 + ox2) / 2 : A.x + A.w / 2;
      if (A.x + A.w <= B.x) lines.push([[A.x + A.w, my], [B.x, my]]);
      else if (B.x + B.w <= A.x) lines.push([[B.x + B.w, my], [A.x, my]]);
      if (A.y + A.h <= B.y) lines.push([[mx, A.y + A.h], [mx, B.y]]);
      else if (B.y + B.h <= A.y) lines.push([[mx, B.y + B.h], [mx, A.y]]);
    }
    const ob = SB(B);
    let h = `<rect class="measure-box" x="${ob.x}" y="${ob.y}" width="${ob.w}" height="${ob.h}"/>`;
    for (const [p, q] of lines) {
      const len = r2(Math.hypot(q[0] - p[0], q[1] - p[1]));
      if (!len) continue;
      const [x1, y1] = S(p), [x2, y2] = S(q);
      const lw = String(len).length * 6.4 + 10, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      h += `<line class="measure" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
        + `<rect class="measure-bg" x="${r2(mx - lw / 2)}" y="${r2(my - 9)}" width="${r2(lw)}" height="18" rx="3"/>`
        + `<text class="measure-text" x="${r2(mx)}" y="${r2(my + 4)}" text-anchor="middle">${len}</text>`;
    }
    return h;
  }

  // ---------- view ----------
  Ed.toWorld = e => {
    const r = el.svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - s.view.x) / s.view.zoom, y: (e.clientY - r.top - s.view.y) / s.view.zoom };
  };
  Ed.zoomAt = (sx, sy, factor) => {
    const z = clamp(s.view.zoom * factor, 0.02, 64);
    const wx = (sx - s.view.x) / s.view.zoom, wy = (sy - s.view.y) / s.view.zoom;
    s.view.zoom = z;
    s.view.x = sx - wx * z;
    s.view.y = sy - wy * z;
    Ed.renderCanvas();
  };
  Ed.zoomCenter = factor => {
    const r = el.svg.getBoundingClientRect();
    Ed.zoomAt(r.width / 2, r.height / 2, factor);
  };
  Ed.zoomTo = z => Ed.zoomCenter(z / s.view.zoom);
  Ed.zoomFit = (nodes, maxZoom = 8) => {
    const list = (nodes && nodes.length ? nodes : s.doc.nodes).filter(n => n.visible !== false);
    const r = el.svg.getBoundingClientRect();
    if (!list.length) {
      s.view = { x: r.width / 2, y: r.height / 2, zoom: 1 };
      return Ed.renderCanvas();
    }
    const B = Scene.unionBox(list), pad = 80;
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(B.w, 1), (r.height - pad * 2) / Math.max(B.h, 1)), 0.02, maxZoom);
    s.view.zoom = z;
    s.view.x = r.width / 2 - (B.x + B.w / 2) * z;
    s.view.y = r.height / 2 - (B.y + B.h / 2) * z;
    Ed.renderCanvas();
  };

  // ---------- export ----------
  Ed.svgOf = (nodes, o = {}) => Scene.toSVG(nodes, { imageHref: Ed.assetData, ...o });
  Ed.canvasOf = (nodes, o = {}) => Scene.toCanvas(nodes, { imageHref: Ed.assetData, ...o });
  Ed.safeName = (name = s.doc.name) => String(name || 'draftboard').replace(/[\\/:*?"<>|]/g, '_').trim() || 'draftboard';

  // What to export: a single selected frame exports exactly its area
  Ed.exportTarget = () => {
    const sel = Ed.selNodes();
    if (sel.length === 1 && sel[0].type === 'frame') {
      return { nodes: Ed.contentOf(sel[0]).filter(n => n.visible !== false), region: Scene.localBox(sel[0]), name: sel[0].name };
    }
    const nodes = (sel.length ? Ed.withChildren(sel) : s.doc.nodes).filter(n => n.visible !== false);
    return { nodes, region: null, name: sel.length === 1 ? sel[0].name : s.doc.name };
  };

  Ed.download = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // ---------- UI helpers ----------
  let toastTimer = null;
  Ed.toast = msg => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  Ed.modal = ({ title, body, wide, onClose }) => {
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `<div class="modal-box${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}"><div class="modal-head"><span>${esc(title)}</span><button class="icon-btn" data-close title="닫기">✕</button></div><div class="modal-body">${body}</div></div>`;
    document.body.appendChild(root);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => {
      root.remove();
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
    root.querySelector('[data-close]').addEventListener('click', close);
    return { root, body: root.querySelector('.modal-body'), close };
  };
  Ed.modalOpen = () => !!document.querySelector('.modal');

  const dropdown = $('#dropdown');
  let ddItems = [];
  // items: { label, run, kbd, disabled, checked } or '-' or { heading }
  Ed.dropdown = (x, y, items, owner) => {
    ddItems = items;
    dropdown.innerHTML = items.map((it, i) => {
      if (it === '-') return '<div class="dd-sep"></div>';
      if (it.heading) return `<div class="dd-head">${esc(it.heading)}</div>`;
      return `<button class="dd-item${it.checked ? ' checked' : ''}" data-i="${i}"${it.disabled ? ' disabled' : ''}><span>${it.icon ? `<span class="dd-ic">${it.icon}</span>` : ''}${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`;
    }).join('');
    dropdown.hidden = false;
    dropdown.dataset.owner = owner || '';
    const r = dropdown.getBoundingClientRect();
    dropdown.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    dropdown.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  };
  Ed.hideDropdown = () => { dropdown.hidden = true; dropdown.dataset.owner = ''; };
  dropdown.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    const it = ddItems[+b.dataset.i];
    Ed.hideDropdown();
    if (it && it.run) it.run();
  });
  document.addEventListener('pointerdown', e => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && !e.target.closest('[data-dd-owner]')) Ed.hideDropdown();
  });

  // ---------- icons ----------
  const ic = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
  Ed.ICON = {
    select: ic('<path d="M4 2l8.5 6.2-3.9.7 2.2 4.2-1.6.8-2.2-4.2L4 12.5z"/>'),
    hand: ic('<path d="M5.5 8.5V3.8a1 1 0 012 0V8M7.5 7.5V2.8a1 1 0 012 0v4.7M9.5 7.5V3.8a1 1 0 012 0V9M11.5 8V6.3a1 1 0 012 0V10a4.5 4.5 0 01-4.5 4.5H8.5A4.5 4.5 0 015 12.3L3 9.3a1 1 0 011.6-1.2l.9 1.2"/>'),
    frame: ic('<path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13"/>'),
    rect: ic('<rect x="2.5" y="3.5" width="11" height="9" rx=".5"/>'),
    ellipse: ic('<circle cx="8" cy="8" r="5.5"/>'),
    polygon: ic('<path d="M8 2.5l6 10.5H2z"/>'),
    star: ic('<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>'),
    line: ic('<path d="M3 13L13 3"/>'),
    arrow: ic('<path d="M3 13L13 3M7 3h6v6"/>'),
    pen: ic('<path d="M8 1.5l4.5 6.5L9 14.5H7L3.5 8z"/><circle cx="8" cy="8.5" r="1.2"/><path d="M8 1.5v5.8"/>'),
    pencil: ic('<path d="M10.5 2.5l3 3-8 8h-3v-3z M9 4l3 3"/>'),
    marker: ic('<path d="M9.5 2.5l4 4-6 6-4-4z"/><path d="M3.5 8.5L2 14l5.5-1.5"/>'),
    text: ic('<path d="M3 3.5h10M8 3.5V13M6 13h4"/>'),
    sticky: ic('<path d="M2.5 2.5h11v7l-4 4h-7z"/><path d="M13.5 9.5h-4v4"/>'),
    connector: ic('<circle cx="3.5" cy="12.5" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><path d="M5 12.5h3.5a1 1 0 001-1v-7a1 1 0 011-1H11"/>'),
    stamp: ic('<circle cx="8" cy="8" r="6"/><path d="M5.5 9.5a3 3 0 005 0"/><circle cx="6" cy="6.5" r=".4"/><circle cx="10" cy="6.5" r=".4"/>'),
    image: ic('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 11l3.5-3.5 3 3 2-2 3.5 3.5"/><circle cx="10.5" cy="6" r="1"/>'),
    path: ic('<path d="M2.5 12c2-6 4-7 5.5-3s3.5 3 5.5-4"/>'),
    vector: ic('<path d="M3 12C4 6 7 4 13 4"/><rect x="1.5" y="10.5" width="3" height="3"/><rect x="11.5" y="2.5" width="3" height="3"/>'),
    group: ic('<rect x="2" y="2" width="12" height="12" stroke-dasharray="2 2"/><rect x="5" y="5" width="6" height="6"/>'),
    boolean: ic('<rect x="2" y="2" width="8" height="8"/><rect x="6" y="6" width="8" height="8"/>'),
    union: ic('<path d="M2 2h8v4h4v8H6v-4H2z"/>'),
    subtract: ic('<path d="M2 2h8v4H6v4H2z"/><rect x="6" y="6" width="8" height="8" stroke-dasharray="2 1.5"/>'),
    intersect: ic('<rect x="2" y="2" width="8" height="8" stroke-dasharray="2 1.5"/><rect x="6" y="6" width="8" height="8" stroke-dasharray="2 1.5"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/>'),
    exclude: ic('<path d="M2 2h8v4H6v4H2zM10 6h4v8H6v-4h4z" fill="currentColor" fill-opacity=".35"/><rect x="2" y="2" width="8" height="8"/><rect x="6" y="6" width="8" height="8"/>'),
    eye: ic('<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
    eyeOff: ic('<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/>'),
    lock: ic('<rect x="3.5" y="7" width="9" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>'),
    unlock: ic('<rect x="3.5" y="7" width="9" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 014.8-1"/>'),
    alignLeft: ic('<path d="M2 1.5v13M4 4.5h9M4 10.5h5"/>'),
    alignHCenter: ic('<path d="M8 1.5v13M3 4.5h10M5 10.5h6"/>'),
    alignRight: ic('<path d="M14 1.5v13M3 4.5h9M7 10.5h5"/>'),
    alignTop: ic('<path d="M1.5 2h13M4.5 4v9M10.5 4v5"/>'),
    alignVCenter: ic('<path d="M1.5 8h13M4.5 3v10M10.5 5v6"/>'),
    alignBottom: ic('<path d="M1.5 14h13M4.5 3v9M10.5 7v5"/>'),
    distH: ic('<path d="M1.5 2v12M14.5 2v12M6 5v6M10 5v6"/>'),
    distV: ic('<path d="M2 1.5h12M2 14.5h12M5 6h6M5 10h6"/>'),
    textLeft: ic('<path d="M2.5 4h11M2.5 8h7M2.5 12h9"/>'),
    textCenter: ic('<path d="M2.5 4h11M4.5 8h7M3.5 12h9"/>'),
    textRight: ic('<path d="M2.5 4h11M6.5 8h7M4.5 12h9"/>'),
    play: ic('<path d="M5 3l8 5-8 5z"/>'),
    chevron: '<svg viewBox="0 0 8 8" width="8" height="8"><path d="M1 3l3 3 3-3" stroke="currentColor" fill="none"/></svg>',
    caretRight: '<svg viewBox="0 0 8 8" width="8" height="8"><path d="M3 1l3 3-3 3" stroke="currentColor" fill="none"/></svg>',
    caretDown: '<svg viewBox="0 0 8 8" width="8" height="8"><path d="M1 3l3 3 3-3" stroke="currentColor" fill="none"/></svg>',
    plus: ic('<path d="M8 3v10M3 8h10"/>'),
    minus: ic('<path d="M3 8h10"/>'),
    timer: ic('<circle cx="8" cy="9" r="5.5"/><path d="M8 9V6M6 1.5h4"/>'),
  };
})();
