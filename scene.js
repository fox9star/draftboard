'use strict';
/* Scene — geometry, text layout and SVG rendering of Draftboard nodes.
   Shared by the editor, its exporters and the other Draftboard tools. */
window.Scene = (() => {
  const DEFAULT_FONT = 'Malgun Gothic, Apple SD Gothic Neo, sans-serif';
  const BOX_TYPES = new Set(['frame', 'rect', 'ellipse', 'polygon', 'star', 'text', 'image', 'sticky']);
  const POINT_TYPES = new Set(['line', 'path', 'connector']);
  const LABEL_TYPES = new Set(['rect', 'ellipse', 'polygon', 'star', 'sticky']);
  const SHAPE_TYPES = new Set(['rect', 'ellipse', 'polygon', 'star', 'vector', 'path']);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = v => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rot = ([x, y], deg, [cx, cy]) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  };

  // ---------- text layout ----------
  const mctx = document.createElement('canvas').getContext('2d');
  const widthCache = new Map(), metricCache = new Map();

  function fontOf(o, size) {
    return `${o.italic ? 'italic ' : ''}${o.fontWeight || 400} ${size}px ${o.fontFamily || DEFAULT_FONT}`;
  }

  function textWidth(font, str) {
    const key = font + '|' + str;
    let w = widthCache.get(key);
    if (w === undefined) {
      mctx.font = font;
      w = mctx.measureText(str).width;
      if (widthCache.size > 5000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  }

  function fontMetrics(font, size) {
    let m = metricCache.get(font);
    if (!m) {
      mctx.font = font;
      const t = mctx.measureText('Hg가');
      m = { asc: t.fontBoundingBoxAscent || size * 0.92, desc: t.fontBoundingBoxDescent || size * 0.24 };
      metricCache.set(font, m);
    }
    return m;
  }

  // Greedy word wrap that keeps words together (like CSS word-break: keep-all)
  // and only splits a word when it is wider than the box on its own.
  function wrapPara(para, font, maxW) {
    if (maxW == null || textWidth(font, para) <= maxW) return [para];
    const lines = [];
    let line = '';
    const push = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };
    for (const tok of para.match(/\S+|\s+/g) || ['']) {
      if (/^\s+$/.test(tok)) { if (line) line += tok; continue; }
      if (textWidth(font, line + tok) <= maxW) { line += tok; continue; }
      if (line.trim()) push(); else line = '';
      if (textWidth(font, tok) <= maxW) { line = tok; continue; }
      for (const ch of tok) {
        if (line && textWidth(font, line + ch) > maxW) push();
        line += ch;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
    return lines;
  }

  function layoutText(text, o) {
    const size = o.size || 16, font = fontOf(o, size), lh = (o.lineHeight || 1.25) * size;
    const lines = [];
    for (const para of String(text == null ? '' : text).split('\n')) lines.push(...wrapPara(para, font, o.width));
    const ws = lines.map(l => textWidth(font, l));
    const m = fontMetrics(font, size);
    return {
      lines, widths: ws, font, size, lh,
      family: o.fontFamily || DEFAULT_FONT, weight: o.fontWeight || 400, italic: !!o.italic,
      baseline: (lh - (m.asc + m.desc)) / 2 + m.asc,
      w: Math.max(1, Math.ceil(Math.max(0, ...ws))),
      h: Math.max(1, Math.ceil(lines.length * lh)),
    };
  }

  const textLayoutOf = n => layoutText(n.text, {
    fontFamily: n.fontFamily, fontWeight: n.fontWeight, italic: n.italic,
    size: n.fontSize, lineHeight: n.lineHeight, width: n.textMode === 'fixed' ? n.w : null,
  });

  function fitText(n) {
    const L = textLayoutOf(n);
    if (n.textMode !== 'fixed') n.w = L.w;
    n.h = L.h;
    return L;
  }

  function labelLayout(n, text = n.label) {
    const sticky = n.type === 'sticky';
    const pad = sticky ? 16 : 10;
    const width = Math.max(1, n.w - pad * 2), maxH = Math.max(1, n.h - pad * 2);
    const opt = { fontFamily: n.fontFamily, fontWeight: n.labelWeight || (sticky ? 400 : 500), lineHeight: 1.3, width };
    let size = n.labelSize || (sticky ? 24 : 16);
    let L = layoutText(text, { ...opt, size });
    if (!n.labelSize) {
      while (L.h > maxH && size > 6) {
        size = Math.max(6, Math.floor(size * 0.88));
        L = layoutText(text, { ...opt, size });
      }
    }
    L.pad = pad;
    L.align = n.labelAlign || (sticky ? 'left' : 'center');
    L.top = sticky ? n.y + pad : n.y + (n.h - L.h) / 2;
    return L;
  }

  function textSVG(L, x, y, w, align, fill, extra = '') {
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;
    const spans = L.lines.map((l, i) =>
      `<tspan x="${r2(ax)}" y="${r2(y + i * L.lh + L.baseline)}">${l ? esc(l) : ' '}</tspan>`).join('');
    return `<text font-family="${esc(L.family)}" font-size="${L.size}" font-weight="${L.weight}"${L.italic ? ' font-style="italic"' : ''} text-anchor="${anchor}" fill="${fill}"${extra} style="white-space:pre">${spans}</text>`;
  }

  // ---------- geometry ----------
  function pointsBox(pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x1) x1 = x; if (y < y1) y1 = y;
      if (x > x2) x2 = x; if (y > y2) y2 = y;
    }
    if (x1 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  const cubicAt = (a, b, c, d, t) => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };

  // t values in (0, 1) where one coordinate of a cubic bezier has an extremum
  function cubicRoots(p0, p1, p2, p3) {
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const ts = [];
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) > 1e-9) ts.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
      }
    }
    return ts.filter(t => t > 0 && t < 1);
  }

  function vectorSegments(n) {
    const A = n.anchors || [], segs = [];
    const seg = (p, q) => [[p.x, p.y], [p.ox ?? p.x, p.oy ?? p.y], [q.ix ?? q.x, q.iy ?? q.y], [q.x, q.y]];
    for (let i = 1; i < A.length; i++) segs.push(seg(A[i - 1], A[i]));
    if (n.closed && A.length > 2) segs.push(seg(A[A.length - 1], A[0]));
    return segs;
  }

  function vectorBox(n) {
    const A = n.anchors || [];
    if (!A.length) return { x: 0, y: 0, w: 0, h: 0 };
    const pts = A.map(a => [a.x, a.y]);
    for (const [p0, p1, p2, p3] of vectorSegments(n)) {
      for (const k of [0, 1]) {
        for (const t of cubicRoots(p0[k], p1[k], p2[k], p3[k])) {
          pts.push([cubicAt(p0[0], p1[0], p2[0], p3[0], t), cubicAt(p0[1], p1[1], p2[1], p3[1], t)]);
        }
      }
    }
    return pointsBox(pts);
  }

  function polygonPoints(n) {
    const star = n.type === 'star';
    const k = star ? Math.max(3, n.starPoints || 5) * 2 : Math.max(3, n.sides || 3);
    const raw = [];
    for (let i = 0; i < k; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / k;
      const r = star && i % 2 ? (n.innerRatio ?? 0.45) : 1;
      raw.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const b = pointsBox(raw);
    return raw.map(([px, py]) => [n.x + (px - b.x) / (b.w || 1) * n.w, n.y + (py - b.y) / (b.h || 1) * n.h]);
  }

  function booleanBox(n) {
    const ch = (n.children || []).filter(c => c.visible !== false);
    if (!ch.length) return { x: 0, y: 0, w: 0, h: 0 };
    if (n.op === 'subtract') return bbox(ch[0]);
    if (n.op === 'intersect') {
      let x1 = -Infinity, y1 = -Infinity, x2 = Infinity, y2 = Infinity;
      for (const c of ch) {
        const b = bbox(c);
        x1 = Math.max(x1, b.x); y1 = Math.max(y1, b.y);
        x2 = Math.min(x2, b.x + b.w); y2 = Math.min(y2, b.y + b.h);
      }
      return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
    }
    return unionBox(ch);
  }

  // Unrotated box of a node in its own coordinates
  function localBox(n) {
    if (BOX_TYPES.has(n.type)) return { x: n.x, y: n.y, w: n.w, h: n.h };
    if (POINT_TYPES.has(n.type)) return pointsBox(n.points || []);
    if (n.type === 'vector') return vectorBox(n);
    if (n.type === 'group') return unionBox(n.children || []) || { x: 0, y: 0, w: 0, h: 0 };
    if (n.type === 'boolean') return booleanBox(n);
    return { x: n.x || 0, y: n.y || 0, w: n.w || 0, h: n.h || 0 };
  }

  const corners = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];

  // Axis-aligned bounds in world coordinates (rotation included)
  function bbox(n) {
    const b = localBox(n);
    if (!n.rotation || !BOX_TYPES.has(n.type)) return b;
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    return pointsBox(corners(b).map(p => rot(p, n.rotation, c)));
  }

  function unionBox(nodes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) {
      if (!n || n.visible === false && nodes.length > 1) continue;
      const b = bbox(n);
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    }
    if (x1 === Infinity) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  const inside = (a, b) => b.x >= a.x - 0.5 && b.y >= a.y - 0.5 && b.x + b.w <= a.x + a.w + 0.5 && b.y + b.h <= a.y + a.h + 0.5;

  // A frame owns every node above it in z-order that lies completely inside it.
  function childrenIn(nodes, frame) {
    const i = nodes.indexOf(frame), fb = bbox(frame);
    return nodes.filter((n, j) => j > i && inside(fb, bbox(n)));
  }

  // id -> id of the smallest frame that contains it
  function frameParents(nodes) {
    const boxes = nodes.map(bbox), parent = new Map(), area = new Map();
    nodes.forEach((f, i) => {
      if (f.type !== 'frame') return;
      const fb = boxes[i], a = fb.w * fb.h;
      for (let j = i + 1; j < nodes.length; j++) {
        if (!inside(fb, boxes[j])) continue;
        const id = nodes[j].id;
        if (!parent.has(id) || area.get(id) > a) { parent.set(id, f.id); area.set(id, a); }
      }
    });
    return parent;
  }

  function walk(nodes, fn) {
    for (const n of nodes) {
      fn(n);
      if (n.children) walk(n.children, fn);
    }
  }

  // ---------- paths ----------
  const polyD = (pts, close) => pts.length
    ? pts.map((p, i) => (i ? 'L' : 'M') + r2(p[0]) + ' ' + r2(p[1])).join('') + (close ? 'Z' : '')
    : '';

  // Catmull-Rom spline through freehand points, as cubic beziers
  function smoothD(pts) {
    if (pts.length < 3) return polyD(pts);
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`;
    }
    return d;
  }

  function vectorD(n) {
    const A = n.anchors || [];
    if (!A.length) return '';
    let d = `M${r2(A[0].x)} ${r2(A[0].y)}`;
    const seg = (p, q) => p.ox == null && q.ix == null
      ? `L${r2(q.x)} ${r2(q.y)}`
      : `C${r2(p.ox ?? p.x)} ${r2(p.oy ?? p.y)} ${r2(q.ix ?? q.x)} ${r2(q.iy ?? q.y)} ${r2(q.x)} ${r2(q.y)}`;
    for (let i = 1; i < A.length; i++) d += seg(A[i - 1], A[i]);
    if (n.closed && A.length > 2) d += seg(A[A.length - 1], A[0]) + 'Z';
    return d;
  }

  function rectD(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }

  function ellipseD(x, y, w, h) {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  }

  // Outline of a node in its own (unrotated) coordinates
  function shapeD(n) {
    switch (n.type) {
      case 'ellipse': return ellipseD(n.x, n.y, n.w, n.h);
      case 'polygon': case 'star': return polyD(polygonPoints(n), true);
      case 'vector': return vectorD(n);
      case 'path': return smoothD(n.points || []);
      case 'line': case 'connector': return polyD(n.points || []);
      default: return rectD(n.x, n.y, n.w, n.h, n.radius || 0);
    }
  }

  // Outline in world coordinates; rotated boxes are approximated by polygons
  function worldD(n) {
    if (!n.rotation || !BOX_TYPES.has(n.type)) return shapeD(n);
    let pts;
    if (n.type === 'ellipse') {
      pts = [];
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2;
        pts.push([n.x + n.w / 2 + Math.cos(a) * n.w / 2, n.y + n.h / 2 + Math.sin(a) * n.h / 2]);
      }
    } else if (n.type === 'polygon' || n.type === 'star') pts = polygonPoints(n);
    else pts = corners(n);
    const c = [n.x + n.w / 2, n.y + n.h / 2];
    return polyD(pts.map(p => rot(p, n.rotation, c)), true);
  }

  // How far strokes, arrowheads and effects reach outside a node's bounds
  function extent(n) {
    let m = n.stroke ? (n.strokeWidth || 1) / 2 : 0;
    if ((n.type === 'line' || n.type === 'connector') && n.stroke) m += (n.strokeWidth || 1) * 2 + 6;
    const fx = n.effects;
    if (fx && fx.shadow) m = Math.max(m, Math.abs(fx.shadow.x) + Math.abs(fx.shadow.y) + fx.shadow.blur);
    if (fx && fx.blur) m = Math.max(m, fx.blur * 2);
    if (n.children) for (const c of n.children) m = Math.max(m, extent(c));
    return m;
  }

  // ---------- rendering ----------
  function paint(p, gid, ctx) {
    if (!p) return 'none';
    if (typeof p === 'string') return p;
    const stops = (p.stops || []).map(s =>
      `<stop offset="${s.p}" stop-color="${s.c}"${s.a != null && s.a < 1 ? ` stop-opacity="${s.a}"` : ''}/>`).join('');
    if (p.type === 'radial') {
      ctx.defs.push(`<radialGradient id="${gid}" cx=".5" cy=".5" r=".5">${stops}</radialGradient>`);
    } else {
      const a = (p.angle ?? 180) * Math.PI / 180, sx = Math.sin(a) / 2, sy = -Math.cos(a) / 2;
      ctx.defs.push(`<linearGradient id="${gid}" x1="${r2(0.5 - sx)}" y1="${r2(0.5 - sy)}" x2="${r2(0.5 + sx)}" y2="${r2(0.5 + sy)}">${stops}</linearGradient>`);
    }
    return `url(#${gid})`;
  }

  function dashA(n, hasCap) {
    if (!n.dash || n.dash === 'solid') return '';
    const sw = n.strokeWidth || 1;
    if (n.dash === 'dot') return ` stroke-dasharray="0 ${r2(sw * 2)}"${hasCap ? '' : ' stroke-linecap="round"'}`;
    return ` stroke-dasharray="${r2(sw * 3)} ${r2(sw * 2)}"`;
  }

  function effectsA(n, lb, ctx) {
    const fx = n.effects;
    if (!fx || (!fx.shadow && !fx.blur)) return '';
    const s = fx.shadow, id = `${ctx.prefix || ''}${n.id}-x`;
    const m = (s ? Math.abs(s.x) + Math.abs(s.y) + s.blur * 1.5 : 0) + (fx.blur ? fx.blur * 3 : 0) + extent({ ...n, effects: null }) + 4;
    let prims = '', src = 'SourceGraphic';
    if (fx.blur) { prims += `<feGaussianBlur in="SourceGraphic" stdDeviation="${fx.blur}" result="bl"/>`; src = 'bl'; }
    if (s) prims += `<feDropShadow in="${src}" dx="${s.x}" dy="${s.y}" stdDeviation="${r2(s.blur / 2)}" flood-color="${s.color}" flood-opacity="${s.opacity}"/>`;
    ctx.defs.push(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${r2(lb.x - m)}" y="${r2(lb.y - m)}" width="${r2(lb.w + m * 2)}" height="${r2(lb.h + m * 2)}" color-interpolation-filters="sRGB">${prims}</filter>`);
    return ` filter="url(#${id})"`;
  }

  function hitStroke(n, d, ctx, top) {
    if (!ctx.hit || !top) return '';
    return `<path d="${d}" fill="none" stroke="transparent" stroke-width="${r2(Math.max(n.strokeWidth || 1, 10 / (ctx.zoom || 1)))}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function arrowHead(tip, from, sw, kind, color) {
    const dx = tip[0] - from[0], dy = tip[1] - from[1], len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, L = Math.min(Math.max(8, sw * 3 + 4), len);
    if (kind === 'circle') {
      const r = L / 2.6;
      return { base: [tip[0] - ux * r, tip[1] - uy * r], svg: `<circle cx="${r2(tip[0])}" cy="${r2(tip[1])}" r="${r2(r)}" fill="${color}"/>` };
    }
    const W = L * 0.9, bx = tip[0] - ux * L, by = tip[1] - uy * L, vx = -uy * W / 2, vy = ux * W / 2;
    return {
      base: [bx + ux * 0.5, by + uy * 0.5],
      svg: `<path d="M${r2(tip[0])} ${r2(tip[1])}L${r2(bx + vx)} ${r2(by + vy)}L${r2(bx - vx)} ${r2(by - vy)}Z" fill="${color}"/>`,
    };
  }

  function strokeSVG(n, ctx, top) {
    const pts = (n.points || []).map(p => [p[0], p[1]]);
    if (!pts.length) return '';
    const sw = n.strokeWidth || 1, color = n.stroke || 'none';
    let heads = '';
    if (n.type !== 'path' && n.stroke && pts.length > 1) {
      if (n.arrowEnd && n.arrowEnd !== 'none') {
        const h = arrowHead(pts[pts.length - 1], pts[pts.length - 2], sw, n.arrowEnd, color);
        heads += h.svg; pts[pts.length - 1] = h.base;
      }
      if (n.arrowStart && n.arrowStart !== 'none') {
        const h = arrowHead(pts[0], pts[1], sw, n.arrowStart, color);
        heads += h.svg; pts[0] = h.base;
      }
    }
    const d = n.type === 'path' ? smoothD(pts) : polyD(pts);
    const fill = n.type === 'path' && n.fill ? paint(n.fill, `${ctx.prefix || ''}${n.id}-f`, ctx) : 'none';
    return hitStroke(n, polyD(n.points), ctx, top)
      + `<path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashA(n, true)}/>` + heads;
  }

  function labelSVG(n, ctx) {
    if (!n.label || ctx.editingLabelId === n.id) return '';
    const L = labelLayout(n);
    return textSVG(L, n.x + L.pad, L.top, n.w - L.pad * 2, L.align, n.labelColor || '#1E1E1E');
  }

  // Booleans are drawn as a painted rectangle masked by the combined child outlines.
  function booleanSVG(n, ctx) {
    const ch = (n.children || []).filter(c => c.visible !== false);
    if (!ch.length) return '';
    const P = ctx.prefix || '', b = booleanBox(n), mid = `${P}${n.id}-m`;
    const path = (c, color) => `<path d="${worldD(c)}" fill="${color}"/>`;
    let mask;
    if (n.op === 'subtract') {
      mask = path(ch[0], 'white') + ch.slice(1).map(c => path(c, 'black')).join('');
    } else if (n.op === 'intersect') {
      mask = path(ch[0], 'white');
      ch.slice(1).forEach((c, i) => {
        const cid = `${P}${n.id}-k${i}`;
        ctx.defs.push(`<clipPath id="${cid}"><path d="${worldD(c)}"/></clipPath>`);
        mask = `<g clip-path="url(#${cid})">${mask}</g>`;
      });
    } else if (n.op === 'exclude') {
      mask = `<path d="${ch.map(worldD).join(' ')}" fill="white" fill-rule="evenodd"/>`;
    } else {
      mask = ch.map(c => path(c, 'white')).join('');
    }
    ctx.defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="${b.x - 2}" y="${b.y - 2}" width="${b.w + 4}" height="${b.h + 4}">${mask}</mask>`);
    return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${paint(n.fill, `${P}${n.id}-f`, ctx)}" mask="url(#${mid})"/>`;
  }

  // Transform for motion state + rotation, as used on a node's wrapper <g>
  function transformOf(n, a) {
    const tr = [];
    if (a) {
      const b = bbox(n), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      tr.push(`translate(${r2(cx + a.tx)} ${r2(cy + a.ty)}) scale(${r2(a.s)}) rotate(${r2(a.r)}) translate(${r2(-cx)} ${r2(-cy)})`);
    }
    if (n.rotation && BOX_TYPES.has(n.type)) {
      const lb = localBox(n);
      tr.push(`rotate(${r2(n.rotation)} ${r2(lb.x + lb.w / 2)} ${r2(lb.y + lb.h / 2)})`);
    }
    return tr.join(' ');
  }

  function nodeSVG(n, ctx, top = true) {
    if (!n || n.visible === false) return '';
    const P = ctx.prefix || '';
    const lb = localBox(n);
    const strokeA = n.stroke && n.strokeWidth > 0 ? ` stroke="${n.stroke}" stroke-width="${n.strokeWidth}"${dashA(n, false)}` : '';
    const fill = () => paint(n.fill, `${P}${n.id}-f`, ctx);
    let inner = '';
    switch (n.type) {
      case 'frame': case 'rect': case 'sticky':
        inner = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"${n.radius ? ` rx="${r2(Math.min(n.radius, n.w / 2, n.h / 2))}"` : ''} fill="${fill()}"${strokeA}/>` + labelSVG(n, ctx);
        break;
      case 'ellipse':
        inner = `<ellipse cx="${r2(n.x + n.w / 2)}" cy="${r2(n.y + n.h / 2)}" rx="${r2(n.w / 2)}" ry="${r2(n.h / 2)}" fill="${fill()}"${strokeA}/>` + labelSVG(n, ctx);
        break;
      case 'polygon': case 'star':
        inner = `<path d="${shapeD(n)}" fill="${fill()}"${strokeA} stroke-linejoin="round"/>` + labelSVG(n, ctx);
        break;
      case 'vector': {
        const d = vectorD(n);
        const sa = n.stroke && n.strokeWidth > 0 ? ` stroke="${n.stroke}" stroke-width="${n.strokeWidth}"${dashA(n, true)}` : '';
        inner = hitStroke(n, d, ctx, top) + `<path d="${d}" fill="${fill()}"${sa} stroke-linecap="round" stroke-linejoin="round"/>`;
        break;
      }
      case 'line': case 'connector': case 'path':
        inner = strokeSVG(n, ctx, top);
        break;
      case 'text': {
        const L = textLayoutOf(n);
        inner = (ctx.hit && top ? `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="transparent"/>` : '')
          + textSVG(L, n.x, n.y, n.w, n.align, fill(), strokeA);
        break;
      }
      case 'image': {
        const href = ctx.imageHref ? ctx.imageHref(n.asset) : '';
        const par = n.fit === 'fill' ? 'none' : n.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
        const rx = n.radius ? r2(Math.min(n.radius, n.w / 2, n.h / 2)) : 0;
        let clip = '';
        if (rx) {
          const cid = `${P}${n.id}-c`;
          ctx.defs.push(`<clipPath id="${cid}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${rx}"/></clipPath>`);
          clip = ` clip-path="url(#${cid})"`;
        }
        const box = `x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"`;
        inner = (ctx.hit && top ? `<rect ${box} fill="transparent"/>` : '')
          + (n.fill ? `<rect ${box}${rx ? ` rx="${rx}"` : ''} fill="${fill()}"/>` : '')
          + (href ? `<image href="${href}" ${box} preserveAspectRatio="${par}"${clip}/>` : `<rect ${box}${rx ? ` rx="${rx}"` : ''} fill="#E3E3E3"/>`)
          + (strokeA ? `<rect ${box}${rx ? ` rx="${rx}"` : ''} fill="none"${strokeA}/>` : '');
        break;
      }
      case 'group':
        inner = (n.children || []).map(c => nodeSVG(c, ctx, false)).join('');
        break;
      case 'boolean':
        inner = booleanSVG(n, ctx);
        break;
    }
    let attrs = '';
    if (top && ctx.hit) attrs += ` data-id="${n.id}"${n.locked ? ' pointer-events="none"' : ''}`;
    if (n.type === 'text' && ctx.editingId === n.id) attrs += ' visibility="hidden"';
    const a = ctx.anim && ctx.anim[n.id];
    const tr = transformOf(n, a);
    let op = n.opacity == null ? 1 : n.opacity;
    if (a) op *= a.o;
    return `<g${attrs}${tr ? ` transform="${tr}"` : ''}${op < 1 ? ` opacity="${r2(Math.max(0, op))}"` : ''}${effectsA(n, lb, ctx)}>${inner}</g>`;
  }

  // Update motion transforms in an already rendered tree without re-rendering it.
  function applyAnim(root, nodes, states) {
    for (const n of nodes) {
      const el = root.querySelector(`[data-id="${n.id}"]`);
      if (!el) continue;
      const a = states && states[n.id];
      const tr = transformOf(n, a);
      if (tr) el.setAttribute('transform', tr); else el.removeAttribute('transform');
      const op = (n.opacity == null ? 1 : n.opacity) * (a ? a.o : 1);
      if (op < 1) el.setAttribute('opacity', r2(Math.max(0, op))); else el.removeAttribute('opacity');
    }
  }

  function toSVG(nodes, o = {}) {
    const ctx = { defs: [], hit: !!o.hit, zoom: 1, prefix: o.prefix || 'e', imageHref: o.imageHref, anim: o.anim || null };
    const body = nodes.map(n => {
      const s = nodeSVG(n, ctx, true);
      return o.wrap ? o.wrap(n, s) : s;
    }).join('');
    let r = o.region;
    if (!r) {
      const b = unionBox(nodes.filter(n => n.visible !== false)) || { x: 0, y: 0, w: 1, h: 1 };
      const pad = o.pad != null ? o.pad : Math.ceil(Math.max(0, ...nodes.map(extent)));
      r = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    const w = Math.max(1, r.w), h = Math.max(1, r.h);
    const size = o.width ? ` width="${o.width}" height="${r2(o.width * h / w)}"` : ` width="${r2(w)}" height="${r2(h)}"`;
    const bg = o.bg ? `<rect x="${r.x}" y="${r.y}" width="${w}" height="${h}" fill="${o.bg}"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="${r2(r.x)} ${r2(r.y)} ${r2(w)} ${r2(h)}"${o.attrs || ''}>`
      + `${o.style ? `<style>${o.style}</style>` : ''}<defs>${ctx.defs.join('')}</defs>${bg}${body}</svg>`;
    return { svg, w, h, region: { x: r.x, y: r.y, w, h } };
  }

  function svgImage(svg) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG를 그리지 못했습니다.')); };
      img.src = url;
    });
  }

  async function toCanvas(nodes, o = {}) {
    const { svg, w, h } = toSVG(nodes, o);
    const scale = o.scale || 1;
    const img = await svgImage(svg);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext('2d');
    if (o.fillBg) { g.fillStyle = o.fillBg; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  const toPNG = (nodes, o) => toCanvas(nodes, o).then(c => new Promise(res => c.toBlob(res, 'image/png')));

  return {
    DEFAULT_FONT, BOX_TYPES, POINT_TYPES, LABEL_TYPES, SHAPE_TYPES,
    esc, r2, clamp, rot, corners, inside,
    fontOf, textWidth, layoutText, textLayoutOf, fitText, labelLayout,
    pointsBox, localBox, bbox, unionBox, childrenIn, frameParents, walk, extent,
    polygonPoints, vectorSegments, vectorD, smoothD, polyD, rectD, ellipseD, shapeD, cubicAt,
    nodeSVG, transformOf, applyAnim, toSVG, svgImage, toCanvas, toPNG,
  };
})();
