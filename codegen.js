'use strict';
/* Codegen — turns Draftboard nodes into HTML/CSS, React, Tailwind and
   responsive single-file websites. */
window.Codegen = (() => {
  const { r2, esc, bbox, localBox } = Scene;
  const px = v => `${r2(v)}px`;
  const CSS_TYPES = new Set(['frame', 'rect', 'ellipse', 'text', 'image', 'sticky']);
  const svgOnly = n => !CSS_TYPES.has(n.type);

  function rgba(hex, a) {
    let h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${r2(a)})`;
  }

  function cssPaint(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    const stops = (p.stops || []).map(s => `${s.a != null && s.a < 1 ? rgba(s.c, s.a) : s.c} ${r2(s.p * 100)}%`).join(', ');
    return p.type === 'radial' ? `radial-gradient(closest-side, ${stops})` : `linear-gradient(${p.angle ?? 180}deg, ${stops})`;
  }

  const shadowCSS = (s, u) => `${u(s.x)} ${u(s.y)} ${u(s.blur)} ${rgba(s.color, s.opacity)}`;

  // Box an inline SVG needs so strokes, arrowheads and shadows are not cut off
  function svgBox(n) {
    const b = bbox(n), p = Math.ceil(Scene.extent(n)) + 1;
    return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
  }

  // CSS declarations for one node, positioned relative to origin box o
  function styles(n, o, u = px) {
    const b = svgOnly(n) ? svgBox(n) : localBox(n);
    const st = [['position', 'absolute'], ['left', u(b.x - o.x)], ['top', u(b.y - o.y)], ['width', u(b.w)], ['height', u(b.h)]];
    if (svgOnly(n)) return st;
    if (n.rotation) st.push(['transform', `rotate(${r2(n.rotation)}deg)`]);
    if (n.opacity != null && n.opacity < 1) st.push(['opacity', r2(n.opacity)]);
    const fx = n.effects || {};
    const fill = cssPaint(n.fill);
    if (n.type === 'text') {
      if (fill && typeof n.fill === 'object') {
        st.push(['background', fill], ['-webkit-background-clip', 'text'], ['background-clip', 'text'], ['color', 'transparent']);
      } else if (fill) st.push(['color', fill]);
      st.push(['font-family', n.fontFamily || Scene.DEFAULT_FONT], ['font-size', u(n.fontSize)], ['font-weight', n.fontWeight || 400]);
      if (n.italic) st.push(['font-style', 'italic']);
      st.push(['line-height', r2(n.lineHeight || 1.25)], ['text-align', n.align || 'left'], ['white-space', n.textMode === 'fixed' ? 'pre-wrap' : 'pre']);
      if (n.textMode === 'fixed') st.push(['word-break', 'keep-all'], ['overflow-wrap', 'anywhere']);
      if (n.stroke && n.strokeWidth) st.push(['-webkit-text-stroke', `${u(n.strokeWidth)} ${n.stroke}`]);
      if (fx.shadow) st.push(['text-shadow', shadowCSS(fx.shadow, u)]);
    } else {
      if (fill) st.push(['background', fill]);
      if (n.type === 'ellipse') st.push(['border-radius', '50%']);
      else if (n.radius) st.push(['border-radius', u(n.radius)]);
      if (n.stroke && n.strokeWidth) {
        const style = n.dash === 'dash' ? 'dashed' : n.dash === 'dot' ? 'dotted' : 'solid';
        st.push(['outline', `${u(n.strokeWidth)} ${style} ${n.stroke}`], ['outline-offset', u(-n.strokeWidth / 2)]);
      }
      if (fx.shadow) st.push(['box-shadow', shadowCSS(fx.shadow, u)]);
      if (n.type === 'image') st.push(['object-fit', n.fit || 'cover'], ['display', 'block']);
      if (n.type === 'frame') st.push(['overflow', 'hidden']);
      if (n.label) {
        const L = Scene.labelLayout(n);
        st.push(['display', 'flex'], ['align-items', n.type === 'sticky' ? 'flex-start' : 'center'],
          ['justify-content', L.align === 'center' ? 'center' : L.align === 'right' ? 'flex-end' : 'flex-start'],
          ['box-sizing', 'border-box'], ['padding', u(L.pad)], ['font-family', L.family], ['font-size', u(L.size)],
          ['font-weight', L.weight], ['line-height', 1.3], ['text-align', L.align], ['color', n.labelColor || '#1E1E1E'],
          ['white-space', 'pre-wrap'], ['word-break', 'keep-all'], ['overflow-wrap', 'anywhere']);
      }
    }
    if (fx.blur) st.push(['filter', `blur(${u(fx.blur)})`]);
    return st;
  }

  const decl = st => st.map(([k, v]) => `${k}: ${v};`).join(' ');

  function elementHTML(n, o, u, opt) {
    const cls = `n-${n.id}`;
    if (svgOnly(n)) {
      return Scene.toSVG([n], {
        region: svgBox(n), prefix: `${opt.prefix || 'c'}${n.id}-`, imageHref: opt.imageHref,
        attrs: ` class="${cls}" aria-label="${esc(n.name)}"`,
      }).svg;
    }
    if (n.type === 'text') return `<div class="${cls}">${esc(n.text)}</div>`;
    if (n.type === 'image') return `<img class="${cls}" src="${opt.imageHref ? opt.imageHref(n.asset) : ''}" alt="${esc(n.name)}">`;
    return `<div class="${cls}">${n.label ? esc(n.label) : ''}</div>`;
  }

  // HTML + CSS for a frame and the layers inside it (absolute layout)
  function frameCode(frame, content, opt = {}) {
    const u = opt.unit || px, o = localBox(frame), css = [];
    const fill = cssPaint(frame.fill);
    css.push(`.n-${frame.id} { position: relative; width: ${u(o.w)}; height: ${u(o.h)}; overflow: hidden;${fill ? ` background: ${fill};` : ''}${frame.radius ? ` border-radius: ${u(frame.radius)};` : ''} }`);
    const parts = [];
    for (const n of content) {
      if (n === frame || n.visible === false) continue;
      css.push(`.n-${n.id} { ${decl(styles(n, o, u))} }`);
      let el = elementHTML(n, o, u, opt);
      if (opt.href && n.link) {
        const href = opt.href(n.link);
        if (href) el = `<a href="${esc(href)}"${n.link.target === '__url' ? ' target="_blank" rel="noopener"' : ''}>${el}</a>`;
      }
      if (opt.motion && n.anim && window.Motion) {
        const m = Motion.css(`k${n.id}`, n.anim, u);
        if (m) {
          const b = bbox(n);
          css.push(m.keyframes, `.a-${n.id} { position: absolute; inset: 0; pointer-events: none; transform-origin: ${u(b.x + b.w / 2 - o.x)} ${u(b.y + b.h / 2 - o.y)}; animation: ${m.animation}; }`, `.a-${n.id} > * { pointer-events: auto; }`);
          el = `<div class="a-${n.id}">${el}</div>`;
        }
      }
      parts.push(el);
    }
    return { html: `<div class="n-${frame.id}">\n${parts.map(p => '  ' + p).join('\n')}\n</div>`, css: css.join('\n') };
  }

  function documentHTML(title, css, body) {
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  // Code for a single node (not a frame): CSS relative to its parent frame
  function nodeCode(n, parentBox, opt = {}) {
    const o = parentBox || { x: bbox(n).x, y: bbox(n).y };
    return { html: elementHTML(n, o, px, opt), css: `.n-${n.id} { ${decl(styles(n, o, px))} }`, styles: styles(n, o, px) };
  }

  // ---------- React ----------
  const camel = s => s.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const jsxAttrs = svg => svg
    .replace(/\sclass="/g, ' className="')
    .replace(/\sstyle="white-space:pre"/g, " style={{ whiteSpace: 'pre' }}")
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (_, a) => ' ' + camel(a) + '=');

  function styleObject(st) {
    return '{{ ' + st.map(([k, v]) => `${camel(k)}: ${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "\\'")}'`}`).join(', ') + ' }}';
  }

  function jsxElement(n, o, opt) {
    const st = styleObject(styles(n, o, px));
    if (svgOnly(n)) {
      const svg = Scene.toSVG([n], { region: svgBox(n), prefix: `r${n.id}-`, imageHref: opt.imageHref }).svg;
      return jsxAttrs(svg).replace('<svg ', `<svg style=${st} `);
    }
    if (n.type === 'text') return `<div style=${st}>{${JSON.stringify(n.text)}}</div>`;
    if (n.type === 'image') return `<img style=${st} src="${opt.imageHref ? opt.imageHref(n.asset) : ''}" alt=${JSON.stringify(n.name)} />`;
    return `<div style=${st}>${n.label ? `{${JSON.stringify(n.label)}}` : ''}</div>`;
  }

  function componentName(name) {
    const s = String(name || 'Design').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/)
      .map(w => w[0].toUpperCase() + w.slice(1)).join('');
    return /^[A-Za-z]/.test(s) ? s : 'Design' + (/^[A-Za-z0-9]+$/.test(s) ? s : '');
  }

  function react(nodes, frame, opt = {}) {
    let body;
    if (frame) {
      const o = localBox(frame), fill = cssPaint(frame.fill);
      const root = [['position', 'relative'], ['width', px(o.w)], ['height', px(o.h)], ['overflow', 'hidden']];
      if (fill) root.push(['background', fill]);
      const kids = nodes.filter(n => n !== frame && n.visible !== false).map(n => '      ' + jsxElement(n, o, opt));
      body = `    <div style=${styleObject(root)}>\n${kids.join('\n')}\n    </div>`;
    } else {
      const b = Scene.unionBox(nodes) || { x: 0, y: 0, w: 0, h: 0 };
      body = `    <div style={{ position: 'relative', width: '${px(b.w)}', height: '${px(b.h)}' }}>\n${nodes.map(n => '      ' + jsxElement(n, b, opt)).join('\n')}\n    </div>`;
    }
    return `export default function ${componentName(frame ? frame.name : nodes[0] && nodes[0].name)}() {\n  return (\n${body}\n  );\n}\n`;
  }

  // ---------- Tailwind ----------
  const tw = v => String(v).replace(/_/g, '\\_').replace(/\s+/g, '_');
  const TW = {
    position: v => v,
    left: v => `left-[${v}]`, top: v => `top-[${v}]`, width: v => `w-[${v}]`, height: v => `h-[${v}]`,
    background: v => (/gradient/.test(v) ? `bg-[${tw(v)}]` : `bg-[${v}]`),
    color: v => `text-[${v}]`,
    'border-radius': v => (v === '50%' ? 'rounded-full' : `rounded-[${v}]`),
    opacity: v => `opacity-[${v}]`,
    'font-size': v => `text-[length:${v}]`, 'font-weight': v => `font-[${v}]`, 'line-height': v => `leading-[${v}]`,
    'text-align': v => `text-${v}`, 'white-space': v => (v === 'pre' ? 'whitespace-pre' : 'whitespace-pre-wrap'),
    'box-shadow': v => `shadow-[${tw(v)}]`, 'object-fit': v => `object-${v}`, overflow: v => `overflow-${v}`,
    display: v => v, 'align-items': v => `items-${v.replace('flex-', '')}`, 'justify-content': v => `justify-${v.replace('flex-', '')}`,
    'word-break': v => (v === 'keep-all' ? 'break-keep' : `[word-break:${v}]`),
  };

  function tailwind(n, o) {
    return styles(n, o, px).map(([k, v]) => (TW[k] ? TW[k](String(v)) : `[${k}:${tw(v)}]`)).join(' ');
  }

  // ---------- responsive site ----------
  const BREAKPOINTS = {
    desktop: { label: '데스크톱', media: '(min-width: 1024px)', order: ['desktop', 'tablet', 'mobile'] },
    tablet: { label: '태블릿', media: '(min-width: 768px) and (max-width: 1023.98px)', order: ['tablet', 'desktop', 'mobile'] },
    mobile: { label: '모바일', media: '(max-width: 767.98px)', order: ['mobile', 'tablet', 'desktop'] },
  };

  const slug = s => String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'page';

  function sitePages(doc) {
    const nodes = doc.nodes;
    let list = nodes.filter(n => n.type === 'frame' && n.site && n.site.page)
      .map(f => ({ f, page: slug(f.site.page), bp: BREAKPOINTS[f.site.bp] ? f.site.bp : 'desktop' }));
    if (!list.length) {
      const parents = Scene.frameParents(nodes);
      list = nodes.filter(n => n.type === 'frame' && !parents.has(n.id) && n.visible !== false)
        .map(f => ({ f, page: slug(f.name), bp: 'desktop' }));
    }
    const pages = new Map();
    for (const it of list) {
      if (!pages.has(it.page)) pages.set(it.page, { page: it.page, name: it.f.name, vars: {} });
      const p = pages.get(it.page);
      if (!p.vars[it.bp]) p.vars[it.bp] = it.f;
    }
    return [...pages.values()];
  }

  function site(doc, opt = {}) {
    const pages = sitePages(doc);
    const pageOf = new Map();
    pages.forEach(p => Object.values(p.vars).forEach(f => pageOf.set(f.id, p.page)));
    const href = link => {
      if (!link) return null;
      if (link.target === '__url') return link.url || null;
      if (link.target === '__back') return 'javascript:history.back()';
      const page = pageOf.get(link.target);
      return page ? `#/${encodeURIComponent(page)}` : null;
    };
    const css = [], sections = [], media = { desktop: [], tablet: [], mobile: [] };
    pages.forEach((p, i) => {
      const vars = [];
      for (const [bp, f] of Object.entries(p.vars)) {
        const W = Math.max(1, f.w);
        const content = [f, ...Scene.childrenIn(doc.nodes, f)];
        const code = frameCode(f, content, { unit: v => `${r2(v / W * 100)}cqw`, imageHref: opt.imageHref, href, motion: true, prefix: `s${i}` });
        css.push(code.css);
        vars.push(`<div class="var v-${f.id}" data-bp="${bp}">\n${code.html}\n</div>`);
      }
      for (const range of Object.keys(BREAKPOINTS)) {
        const bp = BREAKPOINTS[range].order.find(b => p.vars[b]);
        if (bp) media[range].push(`.v-${p.vars[bp].id} { display: block; }`);
      }
      sections.push(`<section class="page" data-page="${esc(p.page)}" data-title="${esc(p.name)}">\n${vars.join('\n')}\n</section>`);
    });
    const first = pages[0] && (pages[0].vars.desktop || Object.values(pages[0].vars)[0]);
    const bodyBg = first && typeof first.fill === 'string' ? first.fill : '#ffffff';
    const base = `body { background: ${bodyBg}; }
.page { display: none; }
.page.on { display: block; }
.var { display: none; width: 100%; container-type: inline-size; }
.var > div { width: 100cqw !important; }
a { color: inherit; text-decoration: none; }`;
    const mq = Object.entries(media).filter(([, r]) => r.length).map(([k, r]) => `@media ${BREAKPOINTS[k].media} {\n  ${r.join('\n  ')}\n}`).join('\n');
    const router = `<script>
(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  function show() {
    var m = location.hash.match(/^#\\/(.+)$/);
    var id = m ? decodeURIComponent(m[1]) : '';
    var cur = pages.filter(function (p) { return p.getAttribute('data-page') === id; })[0] || pages[0];
    pages.forEach(function (p) { p.classList.toggle('on', p === cur); });
    if (cur) document.title = cur.getAttribute('data-title') + ' – ' + ${JSON.stringify(doc.name || 'Draftboard')};
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show);
  show();
})();
</script>`;
    return documentHTML(doc.name || 'Draftboard', [base, ...css, mq].join('\n'), sections.join('\n') + '\n' + router);
  }

  return { cssPaint, rgba, styles, frameCode, nodeCode, documentHTML, react, tailwind, site, sitePages, slug, BREAKPOINTS, svgOnly };
})();
