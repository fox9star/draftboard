'use strict';
/* Draftboard editor — layers / slides panel and the design, prototype, motion and code tabs. */
(() => {
  const Ed = window.Ed, s = Ed.s, I = Ed.ICON;
  const { esc, r2, clamp } = Scene;
  const $ = (sel, root = document) => root.querySelector(sel);
  const leftTabs = $('#left-tabs'), leftBody = $('#left-body'), rightTabs = $('#right-tabs'), props = $('#props');

  const FILL_TYPES = new Set(['frame', 'rect', 'ellipse', 'polygon', 'star', 'vector', 'text', 'sticky', 'boolean']);
  const STROKE_TYPES = new Set(['frame', 'rect', 'ellipse', 'polygon', 'star', 'vector', 'text', 'sticky', 'line', 'path', 'connector', 'image']);
  const RADIUS_TYPES = new Set(['frame', 'rect', 'image', 'sticky']);
  const FONTS = [
    ['맑은 고딕', Scene.DEFAULT_FONT], ['시스템 UI', 'system-ui, sans-serif'], ['Arial', 'Arial, Helvetica, sans-serif'],
    ['Segoe UI', 'Segoe UI, sans-serif'], ['Georgia', 'Georgia, serif'], ['Times New Roman', 'Times New Roman, serif'],
    ['Courier New', 'Courier New, monospace'], ['Consolas', 'Consolas, monospace'], ['Impact', 'Impact, sans-serif'],
  ];
  const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
  const PRESETS = [
    ['', '크기 프리셋…'], ['1440x1024', '데스크톱 1440×1024'], ['1280x832', '노트북 1280×832'], ['768x1024', '태블릿 768×1024'],
    ['390x844', '모바일 390×844'], ['1920x1080', '슬라이드 16:9 1920×1080'], ['1024x768', '슬라이드 4:3 1024×768'],
    ['1080x1080', 'SNS 정사각형 1080×1080'], ['1080x1350', 'SNS 세로 1080×1350'], ['1080x1920', '스토리 1080×1920'],
    ['1280x720', '동영상 썸네일 1280×720'], ['595x842', 'A4 595×842'],
  ];
  const TRANSITIONS = [['instant', '즉시'], ['dissolve', '디졸브'], ['push-left', '밀어내기 ←'], ['push-right', '밀어내기 →'],
    ['push-up', '밀어내기 ↑'], ['push-down', '밀어내기 ↓'], ['slide-left', '덮기 ←'], ['slide-right', '덮기 →']];
  Ed.TRANSITIONS = TRANSITIONS;

  // ---------- small builders ----------
  const toHex6 = v => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000');
  const normHex = v => {
    v = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toUpperCase() : null;
  };
  const field = (label, key, value, o = {}) =>
    `<label class="field${o.cls ? ' ' + o.cls : ''}"${o.title ? ` title="${esc(o.title)}"` : ''}><span${o.scrub === false ? '' : ` data-scrub="${key}"`}>${label}</span><input data-f="${key}" value="${esc(value)}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''} spellcheck="false" autocomplete="off"></label>`;
  const select = (key, value, options, cls = '', label = '') =>
    `<label class="field${cls ? ' ' + cls : ''}">${label ? `<span>${label}</span>` : ''}<select data-f="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const colorRow = (key, val, removeKey) => {
    const v = typeof val === 'string' ? val : '#000000';
    return `<div class="row color-row"><label class="field"><span class="swatch" style="--c:${esc(v)}"><input type="color" data-f="${key}" value="${toHex6(v)}" title="색 고르기"></span><input data-f="${key}" data-hex value="${esc(v.replace('#', '').toUpperCase())}" maxlength="7" spellcheck="false"></label>${removeKey ? `<button class="icon-btn" data-remove="${removeKey}" title="제거">${I.minus}</button>` : ''}</div>`;
  };
  const sec = (title, body, action = '') => `<div class="sec"><div class="sec-title"><span>${title}</span>${action}</div>${body}</div>`;
  const addBtn = (key, title) => `<button class="icon-btn" data-add="${key}" title="${title}">${I.plus}</button>`;
  const removeBtn = (key, title) => `<button class="icon-btn" data-remove="${key}" title="${title}">${I.minus}</button>`;
  const hint = t => `<p class="hint">${t}</p>`;
  const btn = (action, label, cls = '') => `<button class="btn${cls ? ' ' + cls : ''}" data-action="${action}">${label}</button>`;

  // ---------- tabs ----------
  function renderTabs() {
    const slidesLabel = s.doc.kind === 'slides' ? '슬라이드' : '프레임';
    leftTabs.innerHTML = [['layers', '레이어'], ['slides', slidesLabel]].map(([k, l]) =>
      `<button class="tab${s.leftTab === k ? ' on' : ''}" data-ltab="${k}">${l}</button>`).join('');
    rightTabs.innerHTML = [['design', '디자인'], ['proto', '프로토타입'], ['motion', '모션'], ['code', '코드']].map(([k, l]) =>
      `<button class="tab${s.rightTab === k ? ' on' : ''}" data-rtab="${k}">${l}</button>`).join('');
  }
  leftTabs.addEventListener('click', e => {
    const b = e.target.closest('[data-ltab]');
    if (!b) return;
    s.leftTab = b.dataset.ltab;
    renderTabs();
    renderLeft();
  });
  rightTabs.addEventListener('click', e => {
    const b = e.target.closest('[data-rtab]');
    if (!b) return;
    s.rightTab = b.dataset.rtab;
    renderTabs();
    renderRight();
    Ed.renderOverlay();
  });

  Ed.renderPanels = () => {
    renderTabs();
    renderLeft();
    renderRight();
  };

  // ---------- layers ----------
  function layerRows() {
    const nodes = s.doc.nodes, parent = Scene.frameParents(nodes), kids = new Map();
    for (const n of nodes) {
      const p = parent.get(n.id) || null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    const out = [];
    const walk = (pid, depth) => {
      for (const n of (kids.get(pid) || []).slice().reverse()) {
        const has = n.type === 'frame' ? (kids.get(n.id) || []).length > 0 : (n.children || []).length > 0;
        const open = n.type === 'frame' ? !s.collapsed.has(n.id) : s.expanded.has(n.id);
        out.push({ n, depth, has, open });
        if (n.type === 'frame' && open) walk(n.id, depth + 1);
        if (n.children && open) {
          for (const c of n.children.slice().reverse()) out.push({ n: c, depth: depth + 1, inner: n.id });
        }
      }
    };
    walk(null, 0);
    return out;
  }

  function renderLayers() {
    if (!s.doc.nodes.length) {
      leftBody.innerHTML = `<div class="empty">레이어가 없습니다.<br>위쪽 도구로 캔버스에 그려 보세요.</div>`;
      return;
    }
    leftBody.innerHTML = `<ul class="layers">${layerRows().map(({ n, depth, has, open, inner }) => {
      const sel = s.selection.includes(inner || n.id);
      const pad = 10 + depth * 14;
      return `<li class="layer${sel ? ' selected' : ''}${n.visible === false ? ' is-hidden' : ''}${inner ? ' inner' : ''}" data-id="${inner || n.id}"${inner ? '' : ' draggable="true"'} style="padding-left:${pad}px">
        <button class="twisty${has ? '' : ' none'}" data-twisty="${n.id}" tabindex="-1">${has ? (open ? I.caretDown : I.caretRight) : ''}</button>
        <span class="licon">${I[n.type] || ''}</span><span class="lname">${esc(n.name)}</span>
        ${inner ? '' : `<button class="lbtn${n.locked ? ' on' : ''}" data-act="lock" title="잠금">${n.locked ? I.lock : I.unlock}</button><button class="lbtn${n.visible === false ? ' on' : ''}" data-act="eye" title="표시/숨기기">${n.visible === false ? I.eyeOff : I.eye}</button>`}
      </li>`;
    }).join('')}</ul>`;
  }

  // ---------- slides / frames ----------
  function renderSlides() {
    const frames = Ed.slideFrames();
    const kindSlides = s.doc.kind === 'slides';
    const head = `<div class="slides-head">
      <button class="btn small" data-action="addSlideMenu" data-dd-owner>${I.plus} ${kindSlides ? '새 슬라이드' : '새 프레임'}</button>
      <button class="btn small" data-action="${kindSlides ? 'slideshow' : 'present'}" title="${kindSlides ? '슬라이드 쇼' : '프레젠테이션'}">${I.play} 재생</button>
    </div>`;
    if (!frames.length) {
      leftBody.innerHTML = head + `<div class="empty">프레임이 없습니다.<br>${kindSlides ? '새 슬라이드를 추가해 발표 자료를 만드세요.' : '프레임 도구(F)로 화면을 만드세요.'}</div>`;
      return;
    }
    const busy = !!s.drag;
    leftBody.innerHTML = head + `<ol class="slides">${frames.map((f, i) => {
      const thumb = busy ? '' : Ed.svgOf(Ed.contentOf(f), { region: Scene.localBox(f), prefix: `t${f.id}-`, imageHref: Ed.assetURL }).svg;
      return `<li class="slide${s.selection.includes(f.id) ? ' selected' : ''}" data-slide="${f.id}" draggable="true">
        <span class="num">${i + 1}</span><div class="thumb" style="aspect-ratio:${r2(Math.max(1, f.w) / Math.max(1, f.h))}">${thumb}</div>
        <div class="slide-name">${esc(f.name)}</div></li>`;
    }).join('')}</ol>`;
  }

  function renderLeft() {
    if (s.leftTab === 'slides') renderSlides(); else renderLayers();
  }
  Ed.renderLeft = renderLeft;

  leftBody.addEventListener('click', e => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      if (actionBtn.dataset.action === 'addSlideMenu') {
        const r = actionBtn.getBoundingClientRect();
        return Ed.slideTemplateMenu(r.left, r.bottom + 4);
      }
      return Ed.run(actionBtn.dataset.action);
    }
    const slide = e.target.closest('[data-slide]');
    if (slide) {
      const f = Ed.byId(slide.dataset.slide);
      s.selection = [f.id];
      Ed.zoomFit([f]);
      return Ed.render();
    }
    const tw = e.target.closest('[data-twisty]');
    if (tw && !tw.classList.contains('none')) {
      const id = tw.dataset.twisty, n = Ed.byId(id);
      const set = n && n.type === 'frame' ? s.collapsed : s.expanded;
      if (set.has(id)) set.delete(id); else set.add(id);
      return renderLayers();
    }
    const li = e.target.closest('.layer');
    if (!li) return;
    const n = Ed.byId(li.dataset.id);
    if (!n) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      Ed.checkpoint();
      if (act.dataset.act === 'lock') n.locked = !n.locked;
      else n.visible = n.visible === false;
      return Ed.changed();
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      s.selection = s.selection.includes(n.id) ? s.selection.filter(x => x !== n.id) : [...s.selection, n.id];
    } else s.selection = [n.id];
    Ed.render();
  });

  leftBody.addEventListener('dblclick', e => {
    const nameEl = e.target.closest('.lname, .slide-name');
    if (!nameEl) return;
    const host = nameEl.closest('[data-id], [data-slide]');
    const n = host && Ed.byId(host.dataset.id || host.dataset.slide);
    if (!n || host.classList.contains('inner')) return;
    nameEl.innerHTML = `<input class="rename" value="${esc(n.name)}">`;
    const input = nameEl.firstChild;
    input.focus();
    input.select();
    const finish = ok => {
      input.onblur = null;
      if (ok && input.value.trim() && input.value.trim() !== n.name) {
        Ed.checkpoint();
        n.name = input.value.trim();
        n.nameAuto = false;
      }
      Ed.changed();
    };
    input.onblur = () => finish(true);
    input.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    };
  });

  leftBody.addEventListener('mouseover', e => {
    const li = e.target.closest('[data-id], [data-slide]');
    const id = li ? (li.dataset.id || li.dataset.slide) : null;
    if (id !== s.hoverId) { s.hoverId = id; Ed.renderOverlay(); }
  });
  leftBody.addEventListener('mouseleave', () => { s.hoverId = null; Ed.renderOverlay(); });

  let dragId = null, dragKind = null;
  leftBody.addEventListener('dragstart', e => {
    const li = e.target.closest('[draggable="true"]');
    if (!li) return;
    dragId = li.dataset.id || li.dataset.slide;
    dragKind = li.dataset.slide ? 'slide' : 'layer';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  leftBody.addEventListener('dragover', e => {
    const li = e.target.closest(dragKind === 'slide' ? '[data-slide]' : '.layer:not(.inner)');
    if (!li || !dragId) return;
    e.preventDefault();
    leftBody.querySelectorAll('.drop-above,.drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below'));
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
  });
  leftBody.addEventListener('drop', e => {
    const li = e.target.closest(dragKind === 'slide' ? '[data-slide]' : '.layer:not(.inner)');
    if (!li || !dragId) return;
    e.preventDefault();
    const above = li.classList.contains('drop-above');
    const target = li.dataset.id || li.dataset.slide, moved = dragId;
    dragId = null;
    if (moved === target) return Ed.render();
    Ed.checkpoint();
    if (dragKind === 'slide') {
      const order = Ed.slideFrames().map(f => f.id).filter(id => id !== moved);
      const ti = order.indexOf(target);
      order.splice(above ? ti : ti + 1, 0, moved);
      s.doc.slideOrder = order;
    } else {
      const node = Ed.byId(moved);
      s.doc.nodes = s.doc.nodes.filter(n => n !== node);
      const ti = s.doc.nodes.findIndex(n => n.id === target);
      // The list shows the top-most layer first, so "above" means later in the array.
      s.doc.nodes.splice(above ? ti + 1 : ti, 0, node);
    }
    Ed.changed();
  });
  leftBody.addEventListener('dragend', () => { dragId = null; renderLeft(); });

  // ---------- design tab ----------
  function docPanel() {
    const kind = s.doc.kind;
    const quick = {
      slides: btn('addSlide', `${I.plus} 새 슬라이드`) + btn('slideshow', `${I.play} 슬라이드 쇼`, 'primary') + btn('printSlides', 'PDF로 내보내기'),
      site: btn('sitePreview', '사이트 미리보기', 'primary') + btn('siteExport', 'HTML 내보내기'),
      buzz: btn('buzz', '대량 제작 열기', 'primary'),
      motion: btn('motionPlay', `${I.play} 애니메이션 재생`, 'primary') + btn('exportVideo', '동영상 내보내기'),
      whiteboard: btn('timer', `${I.timer} 타이머`) + btn('present', `${I.play} 프레젠테이션`),
      design: btn('present', `${I.play} 프로토타입 재생`, 'primary') + btn('sitePreview', '사이트로 미리보기'),
    }[kind] || '';
    const tips = {
      design: ['<kbd>F</kbd> 프레임 · <kbd>R</kbd> 사각형 · <kbd>T</kbd> 텍스트', '<kbd>P</kbd> 펜으로 곡선을 그리고 더블클릭해 점을 편집', '레이어를 선택하고 오른쪽 <b>프로토타입</b> 탭에서 화면을 연결', '<kbd>Alt</kbd>를 누른 채 다른 레이어를 가리키면 간격 측정'],
      whiteboard: ['<kbd>S</kbd> 스티커 메모 · <kbd>X</kbd> 연결선 · <kbd>E</kbd> 스탬프', '<kbd>M</kbd> 형광펜 · <kbd>Shift</kbd>+<kbd>P</kbd> 연필', '도형이나 메모를 더블클릭해 글자 입력', '연결선을 도형에서 도형으로 끌면 서로 붙습니다'],
      slides: ['왼쪽 <b>슬라이드</b> 탭에서 순서를 끌어 바꾸기', '프레임을 선택하고 프로토타입 탭에서 전환 효과 지정', '슬라이드 쇼에서 <kbd>N</kbd> 키로 발표자 노트'],
      site: ['프레임을 선택하고 디자인 탭 <b>사이트</b>에서 페이지 이름과 화면 크기 지정', '같은 페이지 이름의 데스크톱·태블릿·모바일 프레임이 반응형으로 묶입니다', '프로토타입 탭의 링크가 사이트 메뉴 링크가 됩니다'],
      buzz: ['템플릿 프레임의 텍스트·이미지 레이어 이름을 CSV 열 이름과 같게 맞추세요', '<b>대량 제작</b>에서 데이터를 붙여 넣고 한 번에 생성'],
      motion: ['레이어를 선택하고 <b>모션</b> 탭에서 효과·지연·길이 지정', '타임라인에서 순서를 확인하고 동영상(WebM)으로 내보내기'],
    }[kind] || [];
    const stickyRow = kind === 'whiteboard' ? sec('새 스티커 메모 색', stickySwatches(s.stickyColor, 'default')) : '';
    const themedBg = Ed.DEFAULT_BGS.includes(String(s.doc.bg).toUpperCase());
    return sec('캔버스', colorRow('bg', s.doc.bg) + (themedBg ? hint('기본 색이라 화면 테마(라이트·그레이·다크)를 따릅니다. 다른 색을 고르면 그 색으로 고정됩니다.') : ''))
      + (quick ? sec(`${Ed.KINDS[kind] || ''} 도구`, `<div class="btn-col">${quick}</div>`) : '')
      + stickyRow
      + sec('도움말', `<ul class="tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul><div class="btn-row">${btn('shortcuts', '단축키 전체 보기')}</div>`);
  }

  const stickySwatches = (cur, mode) => `<div class="swatches">${Ed.STICKY_COLORS.map(c =>
    `<button class="sw${c === cur ? ' on' : ''}" style="--c:${c}" data-sticky-color="${c}" data-mode="${mode}" title="${c}"></button>`).join('')}</div>`;

  function designTab(nodes) {
    if (!nodes.length) return docPanel();
    const n = nodes[0], multi = nodes.length > 1;
    const types = new Set(nodes.map(x => x.type));
    const all = set => [...types].every(t => set.has(t));
    const anyIn = set => [...types].some(t => set.has(t));
    const B = Ed.union(nodes);
    let h = '';

    h += `<div class="sec head">${multi
      ? `<div class="sec-title"><span>${nodes.length}개 선택됨</span></div>`
      : `<div class="type-badge">${I[n.type] || ''}<span>${Ed.TYPE_LABEL[n.type]}</span></div><input class="name-input" data-f="name" value="${esc(n.name)}" title="레이어 이름">`}</div>`;

    const canAlign = multi || !!Ed.parentFrameOf(n);
    h += `<div class="sec"><div class="align-row">${[['left', 'alignLeft', '왼쪽'], ['hcenter', 'alignHCenter', '가로 가운데'], ['right', 'alignRight', '오른쪽'],
      ['top', 'alignTop', '위쪽'], ['vcenter', 'alignVCenter', '세로 가운데'], ['bottom', 'alignBottom', '아래쪽']]
      .map(([k, ic, t]) => `<button class="icon-btn" data-align="${k}" title="${t} 정렬"${canAlign ? '' : ' disabled'}>${I[ic]}</button>`).join('')}
      <button class="icon-btn" data-dist="h" title="가로 간격 균등"${nodes.length > 2 ? '' : ' disabled'}>${I.distH}</button>
      <button class="icon-btn" data-dist="v" title="세로 간격 균등"${nodes.length > 2 ? '' : ' disabled'}>${I.distV}</button></div></div>`;

    if (!multi && n.type === 'frame') h += sec('프레임', select('framePreset', '', PRESETS, 'full'));

    const singleBox = !multi && Scene.BOX_TYPES.has(n.type);
    const g = singleBox ? Scene.localBox(n) : B;
    let geo = field('X', 'x', r2(g.x)) + field('Y', 'y', r2(g.y)) + field('W', 'w', r2(g.w)) + field('H', 'h', r2(g.h));
    const rotatable = all(Scene.BOX_TYPES) && !types.has('frame');
    if (rotatable) geo += field('↻', 'rot', r2(n.rotation || 0), { title: '회전 (도)' });
    if (all(RADIUS_TYPES)) geo += field('◜', 'radius', n.radius || 0, { title: '모서리 반경' });
    if (!multi && n.type === 'polygon') geo += field('변', 'sides', n.sides || 3, { title: '변의 수' });
    geo = geo.replace('<span data-scrub="radius">◜</span>', '<span data-scrub="radius">모서리</span>');
    if (!multi && n.type === 'star') geo += field('꼭짓점', 'starPoints', n.starPoints || 5) + field('비율', 'innerRatio', Math.round((n.innerRatio ?? 0.45) * 100), { title: '안쪽 반지름 (%)' });
    h += sec('위치와 크기', `<div class="grid2">${geo}</div>`);

    h += sec('레이어', `<div class="grid2">${field('%', 'opacity', Math.round((n.opacity ?? 1) * 100), { title: '불투명도' })}</div>`);

    if (all(new Set(['text']))) {
      const fam = FONTS.some(([, v]) => v === n.fontFamily) ? n.fontFamily : FONTS[0][1];
      h += sec('텍스트', `<div class="grid2">
        ${select('fontFamily', fam, FONTS.map(([l, v]) => [v, l]), 'full')}
        ${select('fontWeight', n.fontWeight || 400, WEIGHTS)}
        ${field('크기', 'fontSize', n.fontSize)}
        ${field('행간', 'lineHeight', Math.round((n.lineHeight || 1.25) * 100), { title: '줄 간격 (%)' })}
        <div class="seg">${[['left', 'textLeft'], ['center', 'textCenter'], ['right', 'textRight']].map(([a, ic]) => `<button class="icon-btn${(n.align || 'left') === a ? ' on' : ''}" data-text-align="${a}" title="${a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'} 정렬">${I[ic]}</button>`).join('')}</div>
        <div class="seg full"><button class="seg-btn${n.textMode !== 'fixed' ? ' on' : ''}" data-text-mode="auto">자동 너비</button><button class="seg-btn${n.textMode === 'fixed' ? ' on' : ''}" data-text-mode="fixed">고정 너비</button></div>
      </div>`);
    }

    if (anyIn(Scene.LABEL_TYPES)) {
      const ln = nodes.find(x => Scene.LABEL_TYPES.has(x.type));
      h += sec('글자', `<div class="grid2">
        ${field('크기', 'labelSize', ln.labelSize || '', { ph: '자동' })}
        ${select('fontWeight', ln.labelWeight || (ln.type === 'sticky' ? 400 : 500), WEIGHTS)}
        <div class="seg full">${[['left', 'textLeft'], ['center', 'textCenter'], ['right', 'textRight']].map(([a, ic]) => `<button class="icon-btn${(ln.labelAlign || (ln.type === 'sticky' ? 'left' : 'center')) === a ? ' on' : ''}" data-label-align="${a}">${I[ic]}</button>`).join('')}</div>
      </div>${colorRow('labelColor', ln.labelColor || '#1E1E1E')}${hint('더블클릭하거나 Enter를 누르면 글자를 입력합니다.')}`);
    }

    if (types.has('sticky')) h += sec('메모 색', stickySwatches(n.fill, 'node'));

    if (anyIn(FILL_TYPES)) {
      const fn = nodes.find(x => FILL_TYPES.has(x.type));
      const p = fn.fill;
      const kind = !p ? 'none' : typeof p === 'string' ? 'solid' : p.type;
      let body;
      if (kind === 'none') body = hint('채우기 없음');
      else {
        body = select('fillType', kind, [['solid', '단색'], ['linear', '선형 그라디언트'], ['radial', '원형 그라디언트']], 'full');
        if (kind === 'solid') body += colorRow('fill', p);
        else {
          body += colorRow('stop0', p.stops[0].c) + colorRow('stop1', p.stops[p.stops.length - 1].c);
          if (kind === 'linear') body += `<div class="grid2">${field('각도', 'angle', p.angle ?? 180)}</div>`;
        }
      }
      h += sec('채우기', body, kind === 'none' ? addBtn('fill', '채우기 추가') : removeBtn('fill', '채우기 제거'));
    }

    if (anyIn(STROKE_TYPES)) {
      const sn = nodes.find(x => STROKE_TYPES.has(x.type));
      let body = '';
      if (sn.stroke) {
        body = colorRow('stroke', sn.stroke) + `<div class="grid2">${field('두께', 'strokeWidth', sn.strokeWidth)}${select('dash', sn.dash || 'solid', [['solid', '실선'], ['dash', '파선'], ['dot', '점선']])}</div>`;
        if (types.has('line') || types.has('connector')) {
          const heads = [['none', '없음'], ['arrow', '화살표'], ['circle', '원']];
          body += `<div class="grid2">${select('arrowStart', sn.arrowStart || 'none', heads, '', '시작')}${select('arrowEnd', sn.arrowEnd || 'none', heads, '', '끝')}</div>`;
        }
        if (types.has('connector')) body += `<div class="grid2">${select('route', sn.route || 'straight', [['straight', '직선 연결'], ['elbow', '꺾은선 연결']], 'full')}</div>`;
      } else body = hint('선 없음');
      h += sec('선', body, sn.stroke ? removeBtn('stroke', '선 제거') : addBtn('stroke', '선 추가'));
    }

    if (!types.has('group') || nodes.length > 1 || true) {
      const fx = n.effects || {};
      let body = '';
      if (fx.shadow) {
        const sd = fx.shadow;
        body += `<div class="fx-title"><span>그림자</span>${removeBtn('shadow', '그림자 제거')}</div><div class="grid2">${field('X', 'shadowX', sd.x)}${field('Y', 'shadowY', sd.y)}${field('흐림', 'shadowBlur', sd.blur)}${field('%', 'shadowOpacity', Math.round(sd.opacity * 100), { title: '불투명도' })}</div>${colorRow('shadowColor', sd.color)}`;
      }
      if (fx.blur) body += `<div class="fx-title"><span>레이어 흐림</span>${removeBtn('blur', '흐림 제거')}</div><div class="grid2">${field('반경', 'blurR', fx.blur)}</div>`;
      const adds = `${fx.shadow ? '' : `<button class="btn small" data-add="shadow">+ 그림자</button>`}${fx.blur ? '' : `<button class="btn small" data-add="blur">+ 흐림</button>`}`;
      h += sec('효과', body + (adds ? `<div class="btn-row">${adds}</div>` : ''));
    }

    if (!multi && n.type === 'image') {
      h += sec('이미지', `<div class="grid2">${select('fit', n.fit || 'cover', [['cover', '채우기 (잘라냄)'], ['contain', '맞춤 (여백)'], ['fill', '늘이기']], 'full')}</div><div class="btn-row">${btn('replaceImage', '이미지 바꾸기')}</div>`);
    }

    if (!multi && n.type === 'boolean') {
      h += sec('불리언', `<div class="seg">${[['union', '합치기'], ['subtract', '빼기'], ['intersect', '교차'], ['exclude', '제외']].map(([op, l]) => `<button class="icon-btn${n.op === op ? ' on' : ''}" data-bool="${op}" title="${l}">${I[op]}</button>`).join('')}</div><div class="btn-row">${btn('ungroup', '도형으로 분리')}</div>`);
    }
    if (!multi && n.type === 'group') h += sec('그룹', `<div class="btn-row">${btn('ungroup', '그룹 해제')}</div>`);
    if (!multi && n.type === 'vector') h += sec('벡터', `<div class="btn-row">${btn('editVector', '점 편집')}</div>${hint(n.closed ? '닫힌 경로' : '열린 경로')}`);

    if (!multi && n.type === 'frame') {
      const site = n.site || {};
      const bps = Object.entries(Codegen.BREAKPOINTS).map(([k, v]) => [k, v.label]);
      h += sec('사이트', `<div class="grid2">${field('/', 'sitePage', site.page || '', { ph: '페이지 이름 (예: home)', scrub: false, cls: 'full' })}${site.page ? select('siteBp', site.bp || 'desktop', bps, 'full', '화면') : ''}</div>${hint('페이지 이름이 같은 프레임은 화면 크기별 버전으로 묶입니다.')}`);
      if (s.doc.kind === 'slides' || n.notes) h += sec('발표자 노트', `<textarea class="notes" data-f="notes" placeholder="슬라이드 쇼에서 N 키로 볼 수 있습니다">${esc(n.notes || '')}</textarea>`);
    }

    h += sec('내보내기', `<div class="grid2">${select('exportScale', s.exportScale, [[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']])}<div></div></div><div class="btn-row">${btn('exportPNG', 'PNG')}${btn('exportSVG', 'SVG')}${btn('copyPNG', '이미지 복사')}</div>`);
    return h;
  }

  // ---------- prototype tab ----------
  function protoTab(nodes) {
    const frames = Ed.topFrames();
    const frameOpts = frames.map(f => [f.id, f.name]);
    if (!nodes.length) {
      return sec('흐름', `<div class="grid2">${select('protoStart', s.doc.protoStart || '', [['', '시작 프레임 자동'], ...frameOpts], 'full', '시작')}</div>
        <div class="btn-row">${btn('present', `${I.play} 프레젠테이션`, 'primary')}</div>
        ${hint('버튼 같은 레이어를 선택한 뒤 “클릭하면” 이동할 프레임을 고르세요. 연결선은 이 탭이 열려 있을 때 캔버스에 표시됩니다.')}`)
        + sec('연결된 레이어', listLinks());
    }
    if (nodes.length > 1) return sec('상호작용', hint('상호작용은 레이어 하나씩 설정합니다.'));
    const n = nodes[0], link = n.link || {};
    let body = `<div class="rule-label">클릭하면</div><div class="grid2">${select('linkTarget', link.target || '', [['', '동작 없음'], ...frameOpts.filter(([id]) => id !== n.id).map(([id, l]) => [id, `→ ${l}`]), ['__back', '← 뒤로 가기'], ['__url', '↗ 외부 링크 열기']], 'full')}</div>`;
    if (link.target === '__url') body += `<div class="grid2">${field('URL', 'linkUrl', link.url || '', { scrub: false, cls: 'full', ph: 'https://' })}</div>`;
    else if (link.target && link.target !== '__back') body += `<div class="grid2">${select('linkTransition', link.transition || 'dissolve', TRANSITIONS, 'full', '전환')}${field('ms', 'linkDuration', link.duration ?? 300, { title: '전환 시간' })}</div>`;
    let h = sec('상호작용', body);
    if (n.type === 'frame') {
      h += sec('이 프레임', `<div class="btn-row">${btn('setStart', s.doc.protoStart === n.id ? '시작 프레임 ✓' : '시작 프레임으로 지정')}${btn('present', `${I.play} 여기서 재생`)}</div>
        <div class="grid2">${select('slideTransition', n.transition || 'dissolve', TRANSITIONS, 'full', '슬라이드 전환')}</div>`);
    }
    return h;
  }

  function listLinks() {
    const rows = s.doc.nodes.filter(n => n.link && n.link.target).map(n => {
      const t = n.link.target === '__back' ? '뒤로 가기' : n.link.target === '__url' ? (n.link.url || '외부 링크') : (Ed.byId(n.link.target) || {}).name || '(없는 프레임)';
      return `<li data-pick="${n.id}"><span>${esc(n.name)}</span><span class="muted">→ ${esc(t)}</span></li>`;
    });
    return rows.length ? `<ul class="link-list">${rows.join('')}</ul>` : hint('아직 연결이 없습니다.');
  }

  // ---------- motion tab ----------
  function motionScope() {
    const sel = Ed.selNodes();
    const f = sel.length ? (sel[0].type === 'frame' ? sel[0] : Ed.parentFrameOf(sel[0])) : null;
    return { frame: f, nodes: f ? Ed.contentOf(f) : s.doc.nodes };
  }
  Ed.motionScope = motionScope;

  function motionTab(nodes) {
    let h = '';
    if (nodes.length) {
      const n = nodes[0], a = n.anim || {};
      const presets = Object.entries(Motion.PRESETS).map(([k, v]) => [k, v.label]);
      let body = `<div class="grid2">${select('animPreset', a.preset || '', [['', '애니메이션 없음'], ...presets], 'full')}</div>`;
      if (a.preset) {
        body += `<div class="grid2">${field('지연', 'animDelay', a.delay || 0, { title: '시작 지연 (ms)' })}${field('길이', 'animDuration', a.duration || 600, { title: '재생 시간 (ms)' })}
          ${select('animEasing', a.easing || '', [['', '기본 곡선'], ...Object.entries(Motion.EASINGS).map(([k, v]) => [k, v.label])], 'full')}
          <label class="check full"><input type="checkbox" data-f="animLoop"${Motion.isLoop(a) ? ' checked' : ''}> 계속 반복</label></div>
          <div class="btn-row">${btn('motionPlay', `${I.play} 미리 보기`)}</div>`;
      }
      h += sec(nodes.length > 1 ? `애니메이션 (${nodes.length}개)` : '애니메이션', body);
    }
    const { frame, nodes: scope } = motionScope();
    const animated = scope.filter(n => n.anim && Motion.PRESETS[n.anim.preset]);
    const total = Math.max(1000, Motion.total(animated));
    const rows = animated.map(n => {
      const a = n.anim, left = (a.delay || 0) / total * 100, w = Math.max(2, (a.duration || 600) / total * 100);
      return `<li class="tl-row${s.selection.includes(n.id) ? ' selected' : ''}" data-pick="${n.id}"><span class="tl-name">${esc(n.name)}</span><span class="tl-track"><span class="tl-bar${Motion.isLoop(a) ? ' loop' : ''}" style="left:${r2(left)}%;width:${r2(Math.min(w, 100 - left))}%"></span></span></li>`;
    });
    h += sec(`타임라인${frame ? ` · ${esc(frame.name)}` : ''}`, (rows.length
      ? `<div class="tl-scale"><span>0</span><span>${(total / 1000).toFixed(1)}초</span></div><div class="tl-wrap"><ul class="timeline">${rows.join('')}</ul><div class="tl-head" id="tl-head"${s.animPlaying ? '' : ' hidden'}></div></div>`
      : hint('이 범위에 애니메이션이 없습니다. 레이어를 선택하고 효과를 고르세요.'))
      + `<div class="btn-row">${btn(s.animPlaying ? 'motionStop' : 'motionPlay', s.animPlaying ? '■ 정지' : `${I.play} 재생`, 'primary')}</div>`);
    h += sec('내보내기', `<div class="btn-col">${btn('exportVideo', '동영상 (WebM)')}${btn('exportAnimSVG', '애니메이션 SVG')}${btn('exportAnimHTML', 'HTML 페이지')}</div>${hint(frame ? `‘${esc(frame.name)}’ 프레임을 내보냅니다.` : '프레임을 선택하면 그 프레임만 내보냅니다.')}`);
    return h;
  }

  // ---------- code tab ----------
  const LANGS = [['css', 'CSS'], ['html', 'HTML'], ['react', 'React'], ['tailwind', 'Tailwind'], ['svg', 'SVG']];
  const codeImage = id => `images/${id}.png`;

  Ed.codeFor = (n, lang, imageHref = codeImage) => {
    const isFrame = n.type === 'frame';
    const parent = isFrame ? null : Ed.parentFrameOf(n);
    const content = isFrame ? Ed.contentOf(n) : [n];
    const opt = { imageHref };
    if (lang === 'svg') return Ed.svgOf(isFrame ? content : Ed.withChildren([n]), { region: isFrame ? Scene.localBox(n) : null, imageHref }).svg;
    if (lang === 'react') return Codegen.react(content, isFrame ? n : null, opt);
    if (lang === 'tailwind') {
      if (!isFrame) return `<div class="${Codegen.tailwind(n, parent ? Scene.localBox(parent) : Scene.bbox(n))}"></div>`;
      const o = Scene.localBox(n), fill = Codegen.cssPaint(n.fill);
      const kids = content.slice(1).filter(c => c.visible !== false).map(c => {
        const cls = Codegen.tailwind(c, o);
        if (Codegen.svgOnly(c)) return '  ' + Ed.svgOf([c], { prefix: `tw${c.id}-`, imageHref, attrs: ` class="${cls}"` }).svg;
        if (c.type === 'text') return `  <div class="${cls}">${esc(c.text)}</div>`;
        if (c.type === 'image') return `  <img class="${cls}" src="${imageHref(c.asset)}" alt="${esc(c.name)}">`;
        return `  <div class="${cls}">${c.label ? esc(c.label) : ''}</div>`;
      });
      return `<div class="relative overflow-hidden w-[${r2(o.w)}px] h-[${r2(o.h)}px]${fill ? ` bg-[${String(fill).replace(/\s+/g, '_')}]` : ''}">\n${kids.join('\n')}\n</div>`;
    }
    const code = isFrame ? Codegen.frameCode(n, content, opt) : Codegen.nodeCode(n, parent ? Scene.localBox(parent) : null, opt);
    if (lang === 'css') return code.css;
    return isFrame ? Codegen.documentHTML(n.name, code.css, code.html) : code.html;
  };

  function codeTab(nodes) {
    if (!nodes.length) return sec('개발 모드', hint('레이어를 선택하면 속성과 CSS · HTML · React · Tailwind · SVG 코드가 표시됩니다.') + hint('<kbd>Alt</kbd>를 누른 채 다른 레이어를 가리키면 두 레이어 사이의 간격이 표시됩니다.'));
    const n = nodes[0];
    const parent = n.type === 'frame' ? null : Ed.parentFrameOf(n);
    const o = parent ? Scene.localBox(parent) : { x: 0, y: 0 };
    const b = Codegen.svgOnly(n) ? Scene.bbox(n) : Scene.localBox(n);
    const st = Codegen.styles(n, o).filter(([k]) => !['position', 'left', 'top', 'width', 'height'].includes(k));
    const rows = [['이름', n.name], ['종류', Ed.TYPE_LABEL[n.type]], ['위치', `${r2(b.x - o.x)}, ${r2(b.y - o.y)}${parent ? ` (‘${parent.name}’ 기준)` : ''}`], ['크기', `${r2(b.w)} × ${r2(b.h)}`], ...st];
    const inspect = `<table class="inspect">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td data-copy-text="${esc(v)}" title="클릭해서 복사">${esc(v)}</td></tr>`).join('')}</table>`;
    let code;
    try { code = Ed.codeFor(n, s.codeLang); } catch (e) { code = '/* 코드를 만들지 못했습니다: ' + e.message + ' */'; }
    const langs = `<div class="seg wrap">${LANGS.map(([k, l]) => `<button class="seg-btn${s.codeLang === k ? ' on' : ''}" data-lang="${k}">${l}</button>`).join('')}</div>`;
    const imgNote = /images\//.test(code) ? hint('이미지는 images/ 폴더 경로로 표시됩니다. 내려받기를 누르면 이미지가 파일 안에 포함됩니다.') : '';
    return (nodes.length > 1 ? hint(`${nodes.length}개 중 첫 번째 레이어의 코드입니다.`) : '')
      + sec('속성', inspect)
      + sec('코드', `${langs}<pre class="code" id="code-view">${esc(code)}</pre><div class="btn-row"><button class="btn" data-copy-code>복사</button><button class="btn" data-download-code>내려받기</button></div>${imgNote}`);
  }

  // ---------- right panel ----------
  function renderRight() {
    const ae = document.activeElement;
    const key = ae && props.contains(ae) && ae.dataset ? ae.dataset.f : null;
    const nodes = Ed.selNodes();
    let html;
    try {
      html = s.rightTab === 'proto' ? protoTab(nodes)
        : s.rightTab === 'motion' ? motionTab(nodes)
          : s.rightTab === 'code' ? codeTab(nodes)
            : designTab(nodes);
    } catch (e) {
      html = sec('오류', hint('패널을 그리지 못했습니다: ' + esc(e.message)));
      console.error(e);
    }
    props.innerHTML = html;
    if (key) {
      const nx = props.querySelector(`[data-f="${key}"]:not([type=color])`);
      if (nx) { nx.focus(); if (nx.select) nx.select(); }
    }
  }
  Ed.renderRight = renderRight;

  // ---------- property editing ----------
  function evalNum(raw) {
    const t = String(raw).trim().replace(/,/g, '');
    if (/^[\d.+\-*/() ]+$/.test(t)) {
      try {
        const v = Function(`"use strict"; return (${t});`)();
        if (typeof v === 'number' && isFinite(v)) return v;
      } catch (e) { /* fall through */ }
    }
    return parseFloat(t);
  }

  function setGeo(key, v) {
    if (!isFinite(v)) return;
    const nodes = Ed.selNodes();
    if (nodes.length === 1 && Scene.BOX_TYPES.has(nodes[0].type)) {
      const n = nodes[0];
      if (key === 'x' || key === 'y') {
        const dx = key === 'x' ? v - n.x : 0, dy = key === 'y' ? v - n.y : 0;
        for (const m of Ed.withChildren([n])) Ed.translate(m, Ed.clone(m), dx, dy);
      } else if (n.type === 'text') {
        if (key === 'w') { n.textMode = 'fixed'; n.w = Math.max(1, v); Scene.fitText(n); }
      } else n[key] = Math.max(0, r2(v));
      return;
    }
    const B = Ed.union(nodes);
    if (key === 'x' || key === 'y') {
      const dx = key === 'x' ? v - B.x : 0, dy = key === 'y' ? v - B.y : 0;
      for (const m of Ed.withChildren(nodes)) Ed.translate(m, Ed.clone(m), dx, dy);
      return;
    }
    const M = Ed.boxMap(B, { ...B, [key]: Math.max(0, v) });
    for (const n of nodes) Ed.mapNode(n, Ed.clone(n), M);
  }

  const gradientOf = (p, type) => ({
    type, angle: p && p.angle != null ? p.angle : 180,
    stops: p && typeof p === 'object' ? p.stops : [{ c: typeof p === 'string' ? p : '#FFFFFF', p: 0 }, { c: '#000000', p: 1 }],
  });

  function ensureEffects(n) {
    if (!n.effects) n.effects = { shadow: null, blur: 0 };
    return n.effects;
  }

  function setField(key, raw) {
    const nodes = Ed.selNodes();
    const n = nodes[0];
    const num = () => evalNum(raw);
    const each = (pred, fn) => nodes.filter(pred).forEach(fn);
    switch (key) {
      case 'bg': s.doc.bg = raw; break;
      case 'name': if (n && String(raw).trim()) { n.name = String(raw).trim(); n.nameAuto = false; } break;
      case 'x': case 'y': case 'w': case 'h': setGeo(key, num()); break;
      case 'rot': {
        const v = num();
        if (!isFinite(v)) break;
        each(m => Scene.BOX_TYPES.has(m.type) && m.type !== 'frame', m => {
          const lb = Scene.localBox(m);
          Ed.rotateNode(m, Ed.clone(m), v - (m.rotation || 0), [lb.x + lb.w / 2, lb.y + lb.h / 2]);
        });
        break;
      }
      case 'opacity': { const v = num(); if (isFinite(v)) nodes.forEach(m => { m.opacity = clamp(v, 0, 100) / 100; }); break; }
      case 'radius': { const v = num(); if (isFinite(v)) each(m => RADIUS_TYPES.has(m.type), m => { m.radius = Math.max(0, v); }); break; }
      case 'sides': { const v = Math.round(num()); if (v >= 3) n.sides = Math.min(60, v); break; }
      case 'starPoints': { const v = Math.round(num()); if (v >= 3) n.starPoints = Math.min(60, v); break; }
      case 'innerRatio': { const v = num(); if (isFinite(v)) n.innerRatio = clamp(v, 5, 100) / 100; break; }
      case 'fontFamily':
        nodes.forEach(m => { if (m.type === 'text' || Scene.LABEL_TYPES.has(m.type)) m.fontFamily = raw; if (m.type === 'text') Scene.fitText(m); });
        break;
      case 'fontWeight':
        nodes.forEach(m => {
          if (m.type === 'text') { m.fontWeight = +raw; Scene.fitText(m); } else if (Scene.LABEL_TYPES.has(m.type)) m.labelWeight = +raw;
        });
        break;
      case 'fontSize': { const v = num(); if (v > 0) each(m => m.type === 'text', m => { m.fontSize = r2(v); Scene.fitText(m); }); break; }
      case 'lineHeight': { const v = num(); if (v > 0) each(m => m.type === 'text', m => { m.lineHeight = r2(v / 100); Scene.fitText(m); }); break; }
      case 'labelSize': { const v = num(); each(m => Scene.LABEL_TYPES.has(m.type), m => { m.labelSize = v > 0 ? r2(v) : null; }); break; }
      case 'labelColor': each(m => Scene.LABEL_TYPES.has(m.type), m => { m.labelColor = raw; }); break;
      case 'fill': each(m => FILL_TYPES.has(m.type), m => { m.fill = raw; }); break;
      case 'fillType':
        each(m => FILL_TYPES.has(m.type), m => {
          if (raw === 'solid') m.fill = typeof m.fill === 'object' && m.fill ? m.fill.stops[0].c : (m.fill || '#D9D9D9');
          else m.fill = gradientOf(m.fill, raw);
        });
        break;
      case 'stop0': case 'stop1':
        each(m => FILL_TYPES.has(m.type) && m.fill && typeof m.fill === 'object', m => {
          const st = m.fill.stops;
          st[key === 'stop0' ? 0 : st.length - 1].c = raw;
        });
        break;
      case 'angle': { const v = num(); if (isFinite(v)) each(m => m.fill && typeof m.fill === 'object', m => { m.fill.angle = ((v % 360) + 360) % 360; }); break; }
      case 'stroke': each(m => STROKE_TYPES.has(m.type), m => { m.stroke = raw; }); break;
      case 'strokeWidth': { const v = num(); if (v >= 0) each(m => STROKE_TYPES.has(m.type), m => { m.strokeWidth = r2(v); }); break; }
      case 'dash': each(m => STROKE_TYPES.has(m.type), m => { m.dash = raw; }); break;
      case 'arrowStart': case 'arrowEnd': each(m => m.type === 'line' || m.type === 'connector', m => { m[key] = raw; }); break;
      case 'route': each(m => m.type === 'connector', m => { m.route = raw; }); break;
      case 'shadowX': case 'shadowY': case 'shadowBlur': case 'shadowOpacity': {
        const v = num();
        if (!isFinite(v)) break;
        nodes.forEach(m => {
          const fx = ensureEffects(m);
          if (!fx.shadow) fx.shadow = { x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.25 };
          if (key === 'shadowX') fx.shadow.x = v;
          if (key === 'shadowY') fx.shadow.y = v;
          if (key === 'shadowBlur') fx.shadow.blur = Math.max(0, v);
          if (key === 'shadowOpacity') fx.shadow.opacity = clamp(v, 0, 100) / 100;
        });
        break;
      }
      case 'shadowColor': nodes.forEach(m => { const fx = ensureEffects(m); if (fx.shadow) fx.shadow.color = raw; }); break;
      case 'blurR': { const v = num(); if (v >= 0) nodes.forEach(m => { ensureEffects(m).blur = v; }); break; }
      case 'fit': each(m => m.type === 'image', m => { m.fit = raw; }); break;
      case 'framePreset': {
        const [w, h] = String(raw).split('x').map(Number);
        if (w && h) each(m => m.type === 'frame', m => { m.w = w; m.h = h; });
        break;
      }
      case 'sitePage': {
        const v = String(raw).trim().replace(/^\/+/, '');
        if (v) n.site = { page: Codegen.slug(v), bp: (n.site && n.site.bp) || 'desktop' };
        else delete n.site;
        break;
      }
      case 'siteBp': if (n.site) n.site.bp = raw; break;
      case 'notes': n.notes = raw; break;
      case 'exportScale': s.exportScale = +raw; break;
      case 'protoStart': s.doc.protoStart = raw || null; break;
      case 'linkTarget':
        if (!raw) delete n.link;
        else n.link = { target: raw, transition: (n.link && n.link.transition) || 'dissolve', duration: (n.link && n.link.duration) ?? 300, url: n.link && n.link.url };
        break;
      case 'linkTransition': if (n.link) n.link.transition = raw; break;
      case 'linkDuration': { const v = num(); if (n.link && v >= 0) n.link.duration = Math.round(v); break; }
      case 'linkUrl': if (n.link) n.link.url = String(raw).trim(); break;
      case 'slideTransition': n.transition = raw; break;
      case 'animPreset':
        nodes.forEach(m => {
          if (!raw) delete m.anim;
          else m.anim = { preset: raw, delay: (m.anim && m.anim.delay) || 0, duration: (m.anim && m.anim.duration) || 600, easing: (m.anim && m.anim.easing) || '' };
        });
        break;
      case 'animDelay': case 'animDuration': {
        const v = num();
        if (!isFinite(v) || v < 0) break;
        nodes.forEach(m => { if (m.anim) m.anim[key === 'animDelay' ? 'delay' : 'duration'] = Math.max(key === 'animDuration' ? 50 : 0, Math.round(v)); });
        break;
      }
      case 'animEasing': nodes.forEach(m => { if (m.anim) m.anim.easing = raw; }); break;
      case 'animLoop': nodes.forEach(m => { if (m.anim) m.anim.loop = !!raw; }); break;
    }
  }
  Ed.setField = setField;

  let propSnap = null;
  const commitSnap = () => { if (propSnap) { Ed.pushUndo(propSnap); propSnap = null; } };
  const refreshPanels = () => setTimeout(() => { Ed.renderLeft(); renderRight(); }, 0);
  const NO_UNDO = new Set(['exportScale']);

  props.addEventListener('focusin', e => {
    if (e.target.matches('input, select, textarea')) propSnap = Ed.snapshot();
  });
  props.addEventListener('focusout', () => { propSnap = null; });

  props.addEventListener('input', e => {
    const t = e.target;
    if (t.type !== 'color' || !t.dataset.f) return;
    if (!propSnap) propSnap = Ed.snapshot();
    commitSnap();
    setField(t.dataset.f, t.value.toUpperCase());
    t.parentElement.style.setProperty('--c', t.value);
    const hex = props.querySelector(`[data-f="${t.dataset.f}"][data-hex]`);
    if (hex) hex.value = t.value.slice(1).toUpperCase();
    Ed.renderCanvas();
    Ed.scheduleSave();
  });

  props.addEventListener('change', e => {
    const t = e.target, key = t.dataset.f;
    if (!key) return;
    if (t.type === 'color') return refreshPanels();
    if (!NO_UNDO.has(key)) commitSnap();
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.hex !== undefined) {
      v = normHex(v);
      if (!v) return refreshPanels();
    }
    setField(key, v);
    Ed.renderCanvas();
    Ed.scheduleSave();
    refreshPanels();
  });

  props.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
    if (e.key === 'Escape') { e.target.blur(); renderRight(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.matches('input[data-f]') && !e.target.dataset.hex) {
      const v = evalNum(e.target.value);
      if (!isFinite(v)) return;
      e.preventDefault();
      e.target.value = r2(v + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Drag a field's label left/right to change its value
  props.addEventListener('pointerdown', e => {
    const lab = e.target.closest('[data-scrub]');
    if (!lab) return;
    const input = lab.parentElement.querySelector('input');
    const start = evalNum(input.value);
    if (!isFinite(start)) return;
    e.preventDefault();
    const key = lab.dataset.scrub, x0 = e.clientX;
    let pushed = false;
    const move = ev => {
      const dv = Math.round((ev.clientX - x0) / 2) * (ev.shiftKey ? 10 : 1);
      if (!dv && !pushed) return;
      if (!pushed) { Ed.checkpoint(); pushed = true; }
      const v = start + dv;
      input.value = r2(v);
      setField(key, String(v));
      Ed.renderCanvas();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (pushed) { Ed.scheduleSave(); Ed.render(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  props.addEventListener('click', e => {
    const b = e.target.closest('button, [data-pick], [data-copy-text]');
    if (!b) return;
    const d = b.dataset;
    const nodes = Ed.selNodes();
    const apply = fn => { Ed.checkpoint(); fn(); Ed.changed(); };
    if (d.align) return Ed.align(d.align);
    if (d.dist) return Ed.distribute(d.dist);
    if (d.action) return Ed.run(d.action);
    if (d.pick) { s.selection = [d.pick]; return Ed.render(); }
    if (d.lang) { s.codeLang = d.lang; return renderRight(); }
    if (d.copyText !== undefined) {
      navigator.clipboard.writeText(d.copyText).then(() => Ed.toast('복사했습니다.'), () => Ed.toast('복사하지 못했습니다.'));
      return;
    }
    if (d.copyCode !== undefined) {
      const code = $('#code-view').textContent;
      navigator.clipboard.writeText(code).then(() => Ed.toast('코드를 복사했습니다.'), () => Ed.toast('복사하지 못했습니다.'));
      return;
    }
    if (d.downloadCode !== undefined) {
      const n = nodes[0];
      if (!n) return;
      const ext = { css: 'css', html: 'html', react: 'jsx', tailwind: 'html', svg: 'svg' }[s.codeLang];
      const code = Ed.codeFor(n, s.codeLang, Ed.assetData);
      return Ed.download(new Blob([code], { type: 'text/plain' }), `${Ed.safeName(n.name)}.${ext}`);
    }
    if (d.stickyColor) {
      if (d.mode === 'default') { s.stickyColor = d.stickyColor; return renderRight(); }
      return apply(() => nodes.forEach(m => { if (m.type === 'sticky') m.fill = d.stickyColor; }));
    }
    if (d.textAlign) return apply(() => nodes.forEach(m => { if (m.type === 'text') m.align = d.textAlign; }));
    if (d.labelAlign) return apply(() => nodes.forEach(m => { if (Scene.LABEL_TYPES.has(m.type)) m.labelAlign = d.labelAlign; }));
    if (d.textMode) return apply(() => nodes.forEach(m => { if (m.type === 'text') { m.textMode = d.textMode; Scene.fitText(m); } }));
    if (d.bool) return Ed.run(d.bool);
    if (d.add) {
      return apply(() => {
        if (d.add === 'fill') nodes.forEach(m => { if (FILL_TYPES.has(m.type)) m.fill = m.type === 'text' ? '#1E1E1E' : '#D9D9D9'; });
        if (d.add === 'stroke') nodes.forEach(m => { if (STROKE_TYPES.has(m.type)) { m.stroke = '#1E1E1E'; m.strokeWidth = m.strokeWidth || 1; } });
        if (d.add === 'shadow') nodes.forEach(m => { ensureEffects(m).shadow = { x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.25 }; });
        if (d.add === 'blur') nodes.forEach(m => { ensureEffects(m).blur = 4; });
      });
    }
    if (d.remove) {
      return apply(() => {
        if (d.remove === 'fill') nodes.forEach(m => { if (FILL_TYPES.has(m.type)) m.fill = null; });
        if (d.remove === 'stroke') nodes.forEach(m => { m.stroke = null; });
        if (d.remove === 'shadow') nodes.forEach(m => { if (m.effects) m.effects.shadow = null; });
        if (d.remove === 'blur') nodes.forEach(m => { if (m.effects) m.effects.blur = 0; });
      });
    }
  });

  // ---------- top bar file name ----------
  const nameInput = $('#doc-name');
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (v && v !== s.doc.name) { Ed.checkpoint(); s.doc.name = v; }
    Ed.changed();
  });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') nameInput.value = s.doc.name;
      nameInput.blur();
    }
  });
})();
