'use strict';
/* Draftboard editor — motion playback and export, sites, bulk creation, slides, timer, menus and start-up. */
(() => {
  const Ed = window.Ed, s = Ed.s, el = Ed.el, I = Ed.ICON;
  const { esc, r2 } = Scene;
  const $ = (sel, root = document) => root.querySelector(sel);
  const visible = list => list.filter(n => n.visible !== false);

  // ---------- motion playback ----------
  let motionRaf = null;

  function stopMotion(quiet) {
    if (motionRaf) cancelAnimationFrame(motionRaf);
    motionRaf = null;
    s.anim = null;
    s.animPlaying = false;
    if (!quiet) { Ed.renderCanvas(); Ed.renderRight(); }
  }

  function playMotion() {
    const { nodes } = Ed.motionScope();
    const animated = nodes.filter(n => n.anim && Motion.PRESETS[n.anim.preset]);
    if (!animated.length) return Ed.toast('재생할 애니메이션이 없습니다. 레이어를 선택하고 모션 탭에서 효과를 고르세요.');
    stopMotion(true);
    const total = Motion.total(animated), loop = Motion.hasLoop(animated), t0 = performance.now();
    s.animPlaying = true;
    if (s.rightTab === 'motion') Ed.renderRight();
    const tick = now => {
      const t = now - t0;
      s.anim = Motion.statesAt(animated, t);
      Scene.applyAnim(el.world, animated, s.anim);
      const head = $('#tl-head');
      if (head) head.style.setProperty('--p', Math.min(1, (loop ? t % Math.max(total, 1000) : t) / Math.max(1000, total)));
      if (t < total + 250 || (loop && t < 20000)) motionRaf = requestAnimationFrame(tick);
      else stopMotion();
    };
    motionRaf = requestAnimationFrame(tick);
  }

  // ---------- motion export ----------
  function scopeForExport() {
    const { frame, nodes } = Ed.motionScope();
    const content = visible(nodes);
    let region;
    if (frame) region = Scene.localBox(frame);
    else {
      const b = Scene.unionBox(content) || { x: 0, y: 0, w: 100, h: 100 };
      region = { x: b.x - 24, y: b.y - 24, w: b.w + 48, h: b.h + 48 };
    }
    return { frame, content, region };
  }

  // Static runs of layers are drawn once; animated layers are drawn once and moved per frame.
  async function buildLayers(content, region, scale) {
    const layers = [];
    let run = [];
    const flush = async () => {
      if (!run.length) return;
      layers.push({ canvas: await Ed.canvasOf(run, { region, scale }) });
      run = [];
    };
    for (const n of content) {
      if (n.anim && Motion.PRESETS[n.anim.preset]) {
        await flush();
        const b = Scene.bbox(n), pad = Math.ceil(Scene.extent(n)) + 2;
        const r = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        layers.push({ n, r, cx: b.x + b.w / 2, cy: b.y + b.h / 2, canvas: await Ed.canvasOf([n], { region: r, scale }) });
      } else run.push(n);
    }
    await flush();
    return layers;
  }

  function drawFrame(g, layers, region, scale, t, bg) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, g.canvas.width, g.canvas.height); }
    for (const L of layers) {
      if (!L.n) { g.drawImage(L.canvas, 0, 0); continue; }
      const st = Motion.state(L.n.anim, t);
      const cx = (L.cx - region.x) * scale, cy = (L.cy - region.y) * scale;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, st.o));
      g.translate(cx + st.tx * scale, cy + st.ty * scale);
      g.scale(st.s, st.s);
      g.rotate(st.r * Math.PI / 180);
      g.translate(-cx, -cy);
      g.drawImage(L.canvas, (L.r.x - region.x) * scale, (L.r.y - region.y) * scale);
      g.restore();
    }
  }

  async function exportVideo() {
    if (!window.MediaRecorder) return Ed.toast('이 브라우저는 동영상 녹화를 지원하지 않습니다.');
    const { frame, content, region } = scopeForExport();
    if (!content.length) return Ed.toast('내보낼 내용이 없습니다.');
    const animated = content.filter(n => n.anim && Motion.PRESETS[n.anim.preset]);
    const duration = Math.min(30000, Math.max(1500, Motion.total(animated) + 600, Motion.hasLoop(animated) ? 4000 : 0));
    const scale = Math.min(2, 1920 / region.w, 1920 / region.h);
    const W = Math.max(2, Math.round(region.w * scale / 2) * 2), H = Math.max(2, Math.round(region.h * scale / 2) * 2);
    const m = Ed.modal({ title: '동영상 내보내기', body: `<p class="hint">화면을 실제 시간으로 녹화하고 있습니다. 이 탭을 계속 열어 두세요.</p><div class="progress"><span id="vid-bar"></span></div><p class="hint" id="vid-text">준비 중…</p>` });
    try {
      const layers = await buildLayers(content, region, scale);
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d');
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      const bg = frame ? null : s.doc.bg;
      drawFrame(g, layers, region, scale, 0, bg);
      const rec = new MediaRecorder(canvas.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      rec.start(200);
      const t0 = performance.now();
      await new Promise(resolve => {
        const tick = () => {
          const t = performance.now() - t0;
          drawFrame(g, layers, region, scale, Math.min(t, duration), bg);
          const bar = $('#vid-bar'), txt = $('#vid-text');
          if (bar) bar.style.width = `${Math.min(100, t / duration * 100)}%`;
          if (txt) txt.textContent = `${(Math.min(t, duration) / 1000).toFixed(1)}초 / ${(duration / 1000).toFixed(1)}초`;
          if (t >= duration) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      rec.stop();
      await stopped;
      Ed.download(new Blob(chunks, { type: 'video/webm' }), `${Ed.safeName(frame ? frame.name : s.doc.name)}.webm`);
      m.close();
      Ed.toast('동영상(WebM)을 저장했습니다.');
    } catch (e) {
      m.close();
      Ed.toast('동영상을 만들지 못했습니다: ' + e.message);
    }
  }

  function animatedSVG() {
    const { frame, content, region } = scopeForExport();
    const css = [];
    let { svg } = Ed.svgOf(content, {
      region, prefix: 'm',
      wrap: (n, markup) => {
        const m = n.anim && Motion.css(`k${n.id}`, n.anim);
        if (!m) return markup;
        const b = Scene.bbox(n);
        css.push(m.keyframes, `.k${n.id}{transform-box:view-box;transform-origin:${r2(b.x + b.w / 2)}px ${r2(b.y + b.h / 2)}px;animation:${m.animation}}`);
        return `<g class="k${n.id}">${markup}</g>`;
      },
    });
    if (css.length) svg = svg.replace('<defs>', `<style>${css.join('')}</style><defs>`);
    return { svg, frame };
  }

  function exportAnimSVG() {
    const { svg, frame } = animatedSVG();
    Ed.download(new Blob([svg], { type: 'image/svg+xml' }), `${Ed.safeName(frame ? frame.name : s.doc.name)}-motion.svg`);
  }

  function exportAnimHTML() {
    const { frame, content, region } = scopeForExport();
    const root = frame || { id: 'root', type: 'frame', x: region.x, y: region.y, w: region.w, h: region.h, fill: s.doc.bg };
    const code = Codegen.frameCode(root, frame ? content : [root, ...content], { imageHref: Ed.assetData, motion: true });
    const html = Codegen.documentHTML(frame ? frame.name : s.doc.name, code.css + '\nbody { display: grid; place-items: center; min-height: 100vh; background: #f0f0f0; }', code.html);
    Ed.download(new Blob([html], { type: 'text/html' }), `${Ed.safeName(frame ? frame.name : s.doc.name)}-motion.html`);
  }

  // ---------- image export ----------
  async function exportPNG() {
    const t = Ed.exportTarget();
    if (!t.nodes.length) return Ed.toast('내보낼 레이어가 없습니다.');
    try {
      const blob = await Scene.toPNG(t.nodes, { region: t.region, scale: s.exportScale || 2, imageHref: Ed.assetData });
      Ed.download(blob, `${Ed.safeName(t.name)}@${s.exportScale || 2}x.png`);
    } catch (e) { Ed.toast('PNG를 만들지 못했습니다: ' + e.message); }
  }

  function exportSVG() {
    const t = Ed.exportTarget();
    if (!t.nodes.length) return Ed.toast('내보낼 레이어가 없습니다.');
    Ed.download(new Blob([Ed.svgOf(t.nodes, { region: t.region }).svg], { type: 'image/svg+xml' }), `${Ed.safeName(t.name)}.svg`);
  }

  async function copyPNG() {
    const t = Ed.exportTarget();
    if (!t.nodes.length) return Ed.toast('복사할 레이어가 없습니다.');
    try {
      const blob = await Scene.toPNG(t.nodes, { region: t.region, scale: s.exportScale || 2, imageHref: Ed.assetData });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      Ed.toast('이미지를 클립보드에 복사했습니다.');
    } catch (e) { Ed.toast('이미지를 복사하지 못했습니다. PNG 내보내기를 이용하세요.'); }
  }

  async function saveJSON() {
    const data = JSON.stringify({ format: 'draftboard', version: 2, meta: { name: s.doc.name, kind: s.doc.kind }, doc: s.doc, assets: Object.fromEntries(s.assets) });
    Ed.download(new Blob([data], { type: 'application/json' }), `${Ed.safeName()}.draftboard.json`);
  }

  function openJSON() {
    const input = $('#file-input');
    input.onchange = async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      try {
        const r = await Store.importText(await f.text());
        location.href = r.backup ? 'files.html' : `editor.html?file=${r.meta.id}`;
      } catch (e) { Ed.toast(e.message); }
    };
    input.click();
  }

  function replaceImage() {
    const n = Ed.selNodes().find(x => x.type === 'image');
    if (!n) return;
    Ed.pickImages(async files => {
      const im = await Ed.readImageFile(files[0]);
      if (!im) return Ed.toast('이미지를 읽지 못했습니다.');
      Ed.checkpoint();
      n.asset = Ed.addAsset(im.data);
      Ed.changed();
    });
  }

  // ---------- site ----------
  function siteHTML() {
    if (!Ed.topFrames().length) { Ed.toast('사이트로 만들 프레임이 없습니다.'); return null; }
    return Codegen.site(s.doc, { imageHref: Ed.assetData });
  }
  function sitePreview() {
    const html = siteHTML();
    if (!html) return;
    const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
    if (!w) Ed.toast('팝업이 차단되었습니다. HTML 내보내기를 이용하세요.');
  }
  function siteExport() {
    const html = siteHTML();
    if (html) Ed.download(new Blob([html], { type: 'text/html' }), `${Ed.safeName()}-site.html`);
  }

  // ---------- bulk creation ----------
  function parseTable(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!t) return [];
    const delim = t.split('\n')[0].includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && !cell.trim()) { q = true; cell = ''; }
      else if (c === delim) { row.push(cell.trim()); cell = ''; }
      else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell.trim());
    rows.push(row);
    return rows;
  }

  function buzzFields(tpl) {
    return Ed.childrenOf(tpl).filter(n => n.type === 'text' || n.type === 'image' || Scene.LABEL_TYPES.has(n.type))
      .map(n => ({ id: n.id, name: n.name, kind: n.type === 'image' ? '이미지' : '글자' }));
  }

  const SAMPLE_CSV = '제목,설명,가격,사진\n여름 한정 메뉴,시원한 과일 음료를 만나 보세요,"4,500원",\n수박 주스,갓 갈아 만든 수박으로 만든 주스,"5,000원",\n레몬 에이드,상큼한 레몬과 탄산의 조합,"4,000원",\n복숭아 아이스티,달콤한 복숭아 향 가득,"4,500원",';

  function openBuzz() {
    const frames = Ed.topFrames();
    if (!frames.length) return Ed.toast('템플릿으로 쓸 프레임을 먼저 만드세요.');
    const sel = Ed.selNodes()[0];
    let tpl = sel && (sel.type === 'frame' ? sel : Ed.parentFrameOf(sel));
    if (!tpl || !frames.includes(tpl)) tpl = frames[0];
    const images = new Map();
    const fieldNames = buzzFields(tpl).map(f => f.name);
    const sample = ['제목', '설명'].every(x => fieldNames.includes(x)) ? SAMPLE_CSV : '';
    const m = Ed.modal({
      title: '대량 제작', wide: true,
      body: `<div class="bz">
        <div class="bz-col">
          <label class="lbl">템플릿 프레임</label>
          <select class="input" data-bz="tpl">${frames.map(f => `<option value="${f.id}"${f === tpl ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
          <label class="lbl">데이터 <span class="muted">— CSV 또는 엑셀에서 복사한 표, 첫 줄은 열 이름</span></label>
          <textarea class="input bz-data" data-bz="data" spellcheck="false" placeholder="제목,설명&#10;첫 번째,설명 1&#10;두 번째,설명 2">${esc(sample)}</textarea>
          <div class="btn-row"><button class="btn" data-bz="csv">CSV 파일 불러오기</button><button class="btn" data-bz="images">이미지 파일 선택</button><span class="muted" data-bz="imgcount"></span></div>
          <p class="hint">이미지 열에는 선택한 이미지 파일의 이름(예: photo1.jpg)을 적으세요.</p>
        </div>
        <div class="bz-col">
          <label class="lbl">레이어 ↔ 열 연결</label>
          <div data-bz="map"></div>
          <label class="lbl">미리 보기</label>
          <div class="bz-preview" data-bz="preview"></div>
        </div>
      </div>
      <div class="bz-foot"><span class="muted" data-bz="status"></span><button class="btn" data-bz="zip">PNG 묶음(ZIP)으로 내보내기</button><button class="btn primary" data-bz="canvas">캔버스에 만들기</button></div>`,
    });
    const B = sel2 => m.body.querySelector(`[data-bz="${sel2}"]`);
    const csvInput = document.createElement('input');
    csvInput.type = 'file';
    csvInput.accept = '.csv,.tsv,.txt,text/csv';

    const state = () => {
      const rows = parseTable(B('data').value);
      const head = rows[0] || [], data = rows.slice(1).filter(r => r.some(c => c));
      return { head, data };
    };

    function refresh() {
      tpl = Ed.byId(B('tpl').value) || tpl;
      const { head, data } = state();
      const fields = buzzFields(tpl);
      const prev = {};
      m.body.querySelectorAll('[data-field]').forEach(x => { prev[x.dataset.field] = x.value; });
      B('map').innerHTML = fields.length ? `<table class="bz-map">${fields.map(f => {
        const auto = head.findIndex(h => h.trim().toLowerCase() === f.name.trim().toLowerCase());
        const val = prev[f.id] !== undefined ? prev[f.id] : String(auto);
        return `<tr><td>${esc(f.name)} <span class="muted">${f.kind}</span></td><td><select class="input" data-field="${f.id}"><option value="-1">바꾸지 않음</option>${head.map((h, i) => `<option value="${i}"${String(i) === val ? ' selected' : ''}>${esc(h || `${i + 1}번째 열`)}</option>`).join('')}</select></td></tr>`;
      }).join('')}</table>` : '<p class="hint">이 프레임 안에 텍스트·이미지 레이어가 없습니다.</p>';
      B('preview').innerHTML = head.length ? `<table class="bz-table"><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${data.slice(0, 8).map(r => `<tr>${head.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</table>${data.length > 8 ? `<p class="hint">… 외 ${data.length - 8}줄</p>` : ''}` : '<p class="hint">데이터를 붙여 넣으세요.</p>';
      B('status').textContent = `${data.length}개를 만듭니다.`;
      B('imgcount').textContent = images.size ? `이미지 ${images.size}개` : '';
    }

    async function variants() {
      const { data } = state();
      if (!data.length) { Ed.toast('데이터 줄이 없습니다.'); return null; }
      const content = Ed.contentOf(tpl);
      const mapping = [...m.body.querySelectorAll('[data-field]')].map(x => [x.dataset.field, +x.value]).filter(([, c]) => c >= 0);
      const out = [];
      for (let i = 0; i < data.length; i++) {
        const copies = Ed.cloneSet(content);
        for (const [id, col] of mapping) {
          const c = copies[content.findIndex(n => n.id === id)];
          const v = data[i][col] ?? '';
          if (!c) continue;
          if (c.type === 'text') { c.text = v; Scene.fitText(c); }
          else if (c.type === 'image') {
            const key = v.trim().toLowerCase();
            const hit = images.get(key) || images.get(key.replace(/\.[^.]+$/, ''));
            if (hit) c.asset = Ed.addAsset(hit);
            else if (/^data:image\//.test(v)) c.asset = Ed.addAsset(v);
          } else c.label = v;
        }
        copies[0].name = `${tpl.name} ${i + 1}${data[i][0] ? ' · ' + data[i][0] : ''}`;
        out.push(copies);
      }
      return out;
    }

    m.body.addEventListener('input', e => { if (e.target.matches('[data-bz="data"]')) refresh(); });
    m.body.addEventListener('change', e => { if (e.target.matches('[data-bz="tpl"]')) refresh(); });
    csvInput.onchange = async () => {
      const f = csvInput.files[0];
      csvInput.value = '';
      if (f) { B('data').value = await f.text(); refresh(); }
    };
    m.body.addEventListener('click', async e => {
      const b = e.target.closest('[data-bz]');
      if (!b) return;
      const a = b.dataset.bz;
      if (a === 'csv') return csvInput.click();
      if (a === 'images') {
        return Ed.pickImages(async files => {
          for (const f of files) {
            const im = await Ed.readImageFile(f);
            if (!im) continue;
            images.set(f.name.toLowerCase(), im.data);
            images.set(f.name.toLowerCase().replace(/\.[^.]+$/, ''), im.data);
          }
          refresh();
        });
      }
      if (a === 'canvas') {
        const out = await variants();
        if (!out) return;
        Ed.checkpoint();
        const cols = Math.ceil(Math.sqrt(out.length)), gap = 80;
        out.forEach((copies, i) => {
          const dx = tpl.w + 200 + (i % cols) * (tpl.w + gap), dy = Math.floor(i / cols) * (tpl.h + gap);
          copies.forEach(c => Ed.translate(c, Ed.clone(c), dx, dy));
          s.doc.nodes.push(...copies);
        });
        s.selection = out.map(c => c[0].id);
        m.close();
        Ed.changed();
        Ed.zoomFit([tpl, ...out.map(c => c[0])]);
        Ed.toast(`${out.length}개를 만들었습니다.`);
      }
      if (a === 'zip') {
        const out = await variants();
        if (!out) return;
        const files = [];
        try {
          for (let i = 0; i < out.length; i++) {
            B('status').textContent = `이미지 만드는 중… ${i + 1} / ${out.length}`;
            const blob = await Scene.toPNG(visible(out[i]), { region: Scene.localBox(out[i][0]), scale: s.exportScale || 1, imageHref: Ed.assetData });
            files.push({ name: `${String(i + 1).padStart(3, '0')}-${Ed.safeName(out[i][0].name).slice(0, 60)}.png`, data: blob });
          }
          Ed.download(await Zip.make(files), `${Ed.safeName(tpl.name)}-${files.length}개.zip`);
          B('status').textContent = `${files.length}개 이미지를 ZIP으로 저장했습니다.`;
        } catch (err) {
          B('status').textContent = '내보내지 못했습니다: ' + err.message;
        }
      }
    });
    refresh();
  }

  // ---------- slides ----------
  const SLIDE_TEMPLATES = [['blank', '빈 슬라이드'], ['title', '제목'], ['titleBody', '제목과 본문'], ['twoCol', '2단 구성'], ['imageText', '이미지와 글'], ['section', '구역 제목'], ['end', '마무리']];

  function slideNodes(tpl, x, y, w, h, d) {
    const k = w / 1920, out = [];
    const T = p => out.push(Ed.makeNode('text', {
      textMode: 'fixed', fontFamily: Scene.DEFAULT_FONT, fill: '#1E1E1E', ...p,
      x: r2(x + p.x * k), y: r2(y + p.y * k), w: r2(p.w * k), fontSize: r2(p.fontSize * k),
    }, d));
    const body = '• 첫 번째 핵심 내용\n• 두 번째 핵심 내용\n• 세 번째 핵심 내용';
    switch (tpl) {
      case 'title':
        T({ x: 160, y: 390, w: 1600, text: '발표 제목', fontSize: 104, fontWeight: 800, align: 'center', name: '제목' });
        T({ x: 160, y: 560, w: 1600, text: '부제목 또는 발표자 이름', fontSize: 44, align: 'center', fill: '#666666', name: '부제목' });
        break;
      case 'titleBody':
        T({ x: 140, y: 120, w: 1640, text: '슬라이드 제목', fontSize: 72, fontWeight: 800, name: '제목' });
        T({ x: 140, y: 300, w: 1640, text: body, fontSize: 42, lineHeight: 1.7, fill: '#333333', name: '본문' });
        break;
      case 'twoCol':
        T({ x: 140, y: 120, w: 1640, text: '두 가지 비교', fontSize: 72, fontWeight: 800, name: '제목' });
        T({ x: 140, y: 300, w: 780, text: '왼쪽 내용\n\n장점과 특징을 적어 보세요.', fontSize: 40, lineHeight: 1.6, fill: '#333333', name: '왼쪽' });
        T({ x: 1000, y: 300, w: 780, text: '오른쪽 내용\n\n비교할 점을 적어 보세요.', fontSize: 40, lineHeight: 1.6, fill: '#333333', name: '오른쪽' });
        break;
      case 'imageText':
        out.push(Ed.makeNode('rect', {
          x: r2(x + 120 * k), y: r2(y + 120 * k), w: r2(840 * k), h: r2(840 * k), radius: r2(24 * k), fill: '#EDEDED',
          label: '이미지를 여기에 끌어 놓으세요', labelColor: '#888888', name: '이미지 자리',
        }, d));
        T({ x: 1040, y: 300, w: 760, text: '이미지 설명 제목', fontSize: 64, fontWeight: 800, name: '제목' });
        T({ x: 1040, y: 460, w: 760, text: '이미지와 함께 전할 내용을 두세 줄로 적어 보세요.', fontSize: 38, lineHeight: 1.6, fill: '#444444', name: '본문' });
        break;
      case 'section':
        T({ x: 160, y: 420, w: 1600, text: '구역 제목', fontSize: 110, fontWeight: 800, fill: '#FFFFFF', name: '제목' });
        T({ x: 160, y: 590, w: 1600, text: '이 구역에서 다룰 내용', fontSize: 44, fill: '#B5B3C9', name: '부제목' });
        break;
      case 'end':
        T({ x: 160, y: 400, w: 1600, text: '감사합니다', fontSize: 120, fontWeight: 800, align: 'center', name: '제목' });
        T({ x: 160, y: 580, w: 1600, text: '질문이 있으면 편하게 말씀해 주세요', fontSize: 44, align: 'center', fill: '#666666', name: '부제목' });
        break;
    }
    return out;
  }

  function addSlide(tpl = 'titleBody') {
    const frames = Ed.slideFrames();
    const sel = Ed.selNodes()[0];
    let cur = sel && (sel.type === 'frame' ? sel : Ed.parentFrameOf(sel));
    while (cur && Ed.parentFrameOf(cur)) cur = Ed.parentFrameOf(cur);
    const last = frames[frames.length - 1];
    const w = last ? last.w : 1920, h = last ? last.h : 1080;
    const x = last ? Math.max(...frames.map(f => f.x + f.w)) + 160 : 0, y = last ? frames[0].y : 0;
    Ed.checkpoint();
    const f = Ed.makeNode('frame', { x, y, w, h, fill: tpl === 'section' ? '#1E1E2E' : '#FFFFFF', name: `슬라이드 ${frames.length + 1}`, transition: 'dissolve' });
    s.doc.nodes.push(f, ...slideNodes(tpl, x, y, w, h, s.doc));
    const order = Ed.slideFrames().map(fr => fr.id).filter(id => id !== f.id);
    const at = cur ? order.indexOf(cur.id) + 1 : order.length;
    order.splice(at > 0 ? at : order.length, 0, f.id);
    s.doc.slideOrder = order;
    s.selection = [f.id];
    Ed.changed();
    Ed.zoomFit([f]);
  }

  Ed.slideTemplateMenu = (x, y) => Ed.dropdown(x, y, SLIDE_TEMPLATES.map(([k, l]) => ({ label: l, run: () => addSlide(k) })));

  function printSlides() {
    const frames = Ed.slideFrames();
    if (!frames.length) return Ed.toast('PDF로 만들 슬라이드(프레임)가 없습니다.');
    const root = $('#print-root');
    root.innerHTML = frames.map(f => `<div class="print-page">${Ed.svgOf(visible(Ed.contentOf(f)), { region: Scene.localBox(f), prefix: `pp${f.id}-` }).svg}</div>`).join('');
    let st = $('#print-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'print-style';
      document.head.appendChild(st);
    }
    st.textContent = `@page { size: ${frames[0].w}px ${frames[0].h}px; margin: 0; }`;
    const cleanup = () => { root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    Ed.toast('인쇄 창에서 “PDF로 저장”을 고르세요.');
    setTimeout(() => window.print(), 200);
  }

  // ---------- timer ----------
  let timerId = null, timerEnd = 0;
  const chip = $('#timer');

  function beep() {
    try {
      const ac = new AudioContext();
      [0, 0.3, 0.6].forEach(t => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 880;
        o.connect(g);
        g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.25);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + 0.3);
      });
    } catch (e) { /* sound is optional */ }
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
    chip.hidden = true;
    chip.classList.remove('done');
  }

  function startTimer(sec) {
    stopTimer();
    timerEnd = Date.now() + sec * 1000;
    chip.hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
      chip.textContent = `⏱ ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      if (!left) {
        clearInterval(timerId);
        timerId = null;
        chip.classList.add('done');
        chip.textContent = '⏱ 시간 종료';
        beep();
        Ed.toast('타이머가 끝났습니다.');
      }
    };
    tick();
    timerId = setInterval(tick, 250);
  }

  chip.addEventListener('click', stopTimer);

  function timerMenu() {
    const b = $('#menu-btn').getBoundingClientRect();
    Ed.dropdown(innerWidth / 2 - 100, b.bottom + 6, [
      { heading: '타이머' },
      ...[1, 3, 5, 10, 15].map(mn => ({ label: `${mn}분`, run: () => startTimer(mn * 60) })),
      '-',
      { label: '타이머 끄기', run: stopTimer, disabled: chip.hidden },
    ]);
  }

  // ---------- shortcuts ----------
  const SHORTCUTS = [
    ['도구', [['이동 / 손 도구', 'V / H'], ['프레임', 'F'], ['사각형 / 원', 'R / O'], ['선 / 화살표', 'L / Shift+L'], ['펜 / 연필 / 형광펜', 'P / Shift+P / M'], ['텍스트', 'T'], ['스티커 메모 / 연결선 / 스탬프', 'S / X / E'], ['이미지 넣기', 'Ctrl+Shift+K']]],
    ['편집', [['실행 취소 / 다시 실행', 'Ctrl+Z / Ctrl+Shift+Z'], ['복사 / 잘라내기 / 붙여넣기', 'Ctrl+C / X / V'], ['복제', 'Ctrl+D'], ['드래그 복제', 'Alt+드래그'], ['그룹 / 해제', 'Ctrl+G / Ctrl+Shift+G'], ['프레임으로 감싸기', 'Ctrl+Alt+G'], ['벡터로 변환', 'Ctrl+E'], ['합치기 / 빼기 / 교차 / 제외', 'Ctrl+Alt+U / S / I / E'], ['글자·점 편집', 'Enter / 더블클릭'], ['새 슬라이드 (슬라이드 파일)', '슬라이드 선택 후 Enter'], ['1px / 10px 이동', '방향키 / Shift+방향키']]],
    ['정리', [['앞으로 / 뒤로', 'Ctrl+] / Ctrl+['], ['맨 앞 / 맨 뒤', 'Ctrl+Shift+] / ['], ['숨기기 / 잠금', 'Ctrl+Shift+H / L'], ['전체 선택', 'Ctrl+A'], ['비율 유지·축 고정', 'Shift+드래그'], ['15° 단위 회전', 'Shift+회전'], ['스냅 끄기', 'Ctrl+드래그'], ['간격 재기', 'Alt+가리키기']]],
    ['보기·파일', [['확대 / 축소', 'Ctrl+휠, Ctrl+= / -'], ['100% / 전체 / 선택', 'Shift+0 / 1 / 2'], ['화면 이동', 'Space+드래그, 휠'], ['프레젠테이션', 'Ctrl+Alt+Enter'], ['PNG 내보내기', 'Ctrl+Shift+E'], ['저장 / 파일 목록', 'Ctrl+S / Ctrl+O'], ['단축키', 'Ctrl+/']]],
  ];

  function showShortcuts() {
    Ed.modal({
      title: '키보드 단축키', wide: true,
      body: `<div class="sc-grid">${SHORTCUTS.map(([g, rows]) => `<div><h4>${g}</h4>${rows.map(([a, b]) => `<div class="sc-row"><span>${a}</span><kbd>${esc(b)}</kbd></div>`).join('')}</div>`).join('')}</div>`,
    });
  }

  // ---------- menus ----------
  const NEW_KINDS = [['design', '디자인 파일'], ['whiteboard', '화이트보드'], ['slides', '슬라이드'], ['site', '사이트'], ['buzz', '대량 제작'], ['motion', '모션']];

  function mainMenu() {
    const b = $('#menu-btn').getBoundingClientRect();
    Ed.dropdown(b.left, b.bottom + 4, [
      { label: '파일 목록으로', kbd: 'Ctrl+O', run: () => Ed.run('openFiles'), disabled: s.demo },
      { heading: '새로 만들기' },
      ...NEW_KINDS.map(([k, l]) => ({ label: l, run: () => { location.href = `editor.html?new=${k}`; }, disabled: s.demo })),
      '-',
      { label: 'JSON 파일로 저장', run: saveJSON },
      { label: 'JSON 파일 열기…', run: openJSON, disabled: s.demo },
      { label: '이미지 넣기…', kbd: 'Ctrl+Shift+K', run: () => Ed.run('importImage') },
      '-',
      { label: '실행 취소', kbd: 'Ctrl+Z', run: Ed.undo, disabled: !s.undo.length },
      { label: '다시 실행', kbd: 'Ctrl+Shift+Z', run: Ed.redo, disabled: !s.redo.length },
      '-',
      { label: 'AI 빌더 열기', run: () => window.open('make.html', '_blank') },
      { label: '미디어 플로 열기', run: () => window.open('weave.html', '_blank') },
      '-',
      { label: '키보드 단축키', kbd: 'Ctrl+/', run: showShortcuts },
      { heading: '테마' },
      ...Theme.list.map(([k, l]) => ({ label: `${l} 모드`, checked: Theme.get() === k, run: () => Theme.set(k) })),
    ], 'menu');
  }

  // The logo goes home; it saves first so nothing is lost on the way out.
  $('#home-btn').addEventListener('click', async e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (s.demo) {
      (window.top || window).location.href = 'index.html';
      return;
    }
    await Ed.saveNow();
    await Ed.flushThumb();
    location.href = 'index.html';
  });

  function exportMenu() {
    const b = $('#export-btn').getBoundingClientRect();
    const target = s.selection.length ? '선택한 레이어' : '전체';
    Ed.dropdown(b.right - 250, b.bottom + 4, [
      { heading: `이미지 (${target})` },
      { label: `PNG ${s.exportScale || 2}x`, kbd: 'Ctrl+Shift+E', run: exportPNG },
      { label: 'SVG', run: exportSVG },
      { label: '이미지 복사', run: copyPNG },
      { heading: '문서' },
      { label: 'PDF (슬라이드 인쇄)', run: printSlides },
      { label: 'JSON 파일', run: saveJSON },
      { heading: '웹·코드' },
      { label: '사이트 미리보기', run: sitePreview },
      { label: '사이트 HTML 내보내기', run: siteExport },
      { label: '코드 보기 (개발 모드)', run: () => { s.rightTab = 'code'; Ed.renderPanels(); } },
      { heading: '모션' },
      { label: '동영상 (WebM)', run: exportVideo },
      { label: '애니메이션 SVG', run: exportAnimSVG },
      { heading: '대량' },
      { label: '대량 제작…', run: openBuzz },
    ], 'export');
  }

  function playMenu() {
    const b = $('#play-caret').getBoundingClientRect();
    Ed.dropdown(b.right - 220, b.bottom + 4, [
      { label: '프로토타입 재생', kbd: 'Ctrl+Alt+Enter', run: () => Ed.run('present') },
      { label: '슬라이드 쇼', run: () => Ed.run('slideshow') },
      { label: '애니메이션 미리 보기', run: playMotion },
      { label: '사이트 미리보기', run: sitePreview },
    ], 'play');
  }

  function zoomMenu() {
    const b = $('#zoom-btn').getBoundingClientRect();
    Ed.dropdown(b.right - 220, b.bottom + 4, [
      { label: '확대', kbd: 'Ctrl+=', run: () => Ed.run('zoomIn') },
      { label: '축소', kbd: 'Ctrl+-', run: () => Ed.run('zoomOut') },
      '-',
      { label: '100%', kbd: 'Shift+0', run: () => Ed.run('zoom100') },
      { label: '전체 맞춤', kbd: 'Shift+1', run: () => Ed.run('zoomFit') },
      { label: '선택 영역 맞춤', kbd: 'Shift+2', run: () => Ed.run('zoomSelection'), disabled: !s.selection.length },
    ], 'zoom');
  }

  const toggleMenu = (owner, fn) => () => {
    if (!$('#dropdown').hidden && $('#dropdown').dataset.owner === owner) return Ed.hideDropdown();
    fn();
  };
  $('#menu-btn').addEventListener('click', toggleMenu('menu', mainMenu));
  $('#export-btn').addEventListener('click', toggleMenu('export', exportMenu));
  $('#play-caret').addEventListener('click', toggleMenu('play', playMenu));
  $('#zoom-btn').addEventListener('click', toggleMenu('zoom', zoomMenu));
  $('#play-btn').addEventListener('click', () => Ed.run(s.doc.kind === 'slides' ? 'slideshow' : 'present'));
  $('#undo-btn').addEventListener('click', () => Ed.undo());
  $('#redo-btn').addEventListener('click', () => Ed.redo());
  window.addEventListener('resize', () => Ed.renderCanvas());

  Ed.actions = Object.assign(Ed.actions || {}, {
    motionPlay: playMotion, motionStop: () => stopMotion(),
    exportVideo, exportAnimSVG, exportAnimHTML, exportPNG, exportSVG, copyPNG, saveJSON, openJSON, replaceImage,
    sitePreview, siteExport, buzz: openBuzz, addSlide: () => addSlide('titleBody'), printSlides,
    timer: timerMenu, shortcuts: showShortcuts,
    editVector: () => { const n = Ed.selNodes()[0]; if (n && n.type === 'vector') Ed.enterVectorEdit(n); },
    setStart: () => {
      const n = Ed.selNodes()[0];
      if (!n || n.type !== 'frame') return;
      Ed.checkpoint();
      s.doc.protoStart = n.id;
      Ed.changed();
    },
    saveNow: async () => { await Ed.saveNow(); if (!s.demo) Ed.toast('저장했습니다. 작업은 자동으로도 저장됩니다.'); },
    openFiles: async () => {
      if (s.demo) return;
      await Ed.saveNow();
      await Ed.flushThumb();
      location.href = 'files.html';
    },
  });

  // ---------- starter documents ----------
  const grad = (type, a, b, angle = 135) => ({ type, angle, stops: [{ c: a, p: 0 }, { c: b, p: 1 }] });

  function starter(kind) {
    const d = Ed.blankDoc(kind);
    const add = (type, props) => { const n = Ed.makeNode(type, props, d); d.nodes.push(n); return n; };
    if (kind === 'slides') {
      const f = add('frame', { x: 0, y: 0, w: 1920, h: 1080, name: '슬라이드 1', transition: 'dissolve' });
      d.nodes.push(...slideNodes('title', 0, 0, 1920, 1080, d));
      d.slideOrder = [f.id];
    } else if (kind === 'site') {
      const about = Ed.makeNode('frame', { x: 0, y: 1100, w: 1440, h: 900, name: '소개 · 데스크톱', site: { page: 'about', bp: 'desktop' } }, d);
      const home = add('frame', { x: 0, y: 0, w: 1440, h: 900, name: '홈 · 데스크톱', site: { page: 'home', bp: 'desktop' } });
      const T = (p, extra = {}) => add('text', { textMode: 'fixed', fill: '#111111', ...p, ...extra });
      T({ x: 80, y: 40, w: 300, text: 'Brand', fontSize: 28, fontWeight: 800, name: '로고' });
      T({ x: 1200, y: 46, w: 80, text: '소개', fontSize: 18, name: '메뉴 소개' }, { link: { target: about.id, transition: 'dissolve', duration: 300 } });
      T({ x: 80, y: 250, w: 860, text: '아이디어를 웹사이트로 바로 옮기세요', fontSize: 72, fontWeight: 800, lineHeight: 1.15, name: '헤드라인' });
      T({ x: 80, y: 520, w: 640, text: '프레임을 그리고 페이지 이름을 정하면 반응형 사이트로 내보낼 수 있습니다.', fontSize: 24, lineHeight: 1.5, fill: '#555555', name: '설명' });
      add('rect', { x: 80, y: 640, w: 220, h: 64, radius: 32, fill: '#111111', label: '자세히 보기', labelColor: '#FFFFFF', labelSize: 20, name: '버튼', link: { target: about.id, transition: 'push-left', duration: 350 } });
      add('ellipse', { x: 960, y: 220, w: 380, h: 380, fill: grad('radial', '#7B61FF', '#2EC4B6'), name: '장식 원', anim: { preset: 'zoom', delay: 0, duration: 900, easing: 'spring' } });
      add('frame', { x: 1600, y: 0, w: 390, h: 844, name: '홈 · 모바일', site: { page: 'home', bp: 'mobile' } });
      T({ x: 1624, y: 28, w: 200, text: 'Brand', fontSize: 22, fontWeight: 800, name: '로고' });
      T({ x: 1624, y: 150, w: 342, text: '아이디어를 웹사이트로 바로 옮기세요', fontSize: 40, fontWeight: 800, lineHeight: 1.2, name: '헤드라인' });
      T({ x: 1624, y: 320, w: 342, text: '프레임을 그리고 페이지 이름을 정하면 반응형 사이트로 내보낼 수 있습니다.', fontSize: 17, lineHeight: 1.5, fill: '#555555', name: '설명' });
      add('rect', { x: 1624, y: 440, w: 342, h: 56, radius: 28, fill: '#111111', label: '자세히 보기', labelColor: '#FFFFFF', labelSize: 18, name: '버튼', link: { target: about.id, transition: 'push-left', duration: 350 } });
      add('ellipse', { x: 1695, y: 560, w: 200, h: 200, fill: grad('radial', '#7B61FF', '#2EC4B6'), name: '장식 원' });
      d.nodes.push(about);
      T({ x: 80, y: 1260, w: 900, text: '소개', fontSize: 64, fontWeight: 800, name: '제목' });
      T({ x: 80, y: 1380, w: 760, text: '이 페이지는 두 번째 페이지 예시입니다. 버튼에 연결된 링크를 따라 이동합니다.', fontSize: 24, lineHeight: 1.6, fill: '#555555', name: '본문' });
      add('rect', { x: 80, y: 1520, w: 200, h: 60, radius: 30, fill: '#FFFFFF', stroke: '#111111', strokeWidth: 2, label: '← 홈으로', labelSize: 18, name: '홈 버튼', link: { target: home.id, transition: 'push-right', duration: 350 } });
      d.protoStart = home.id;
    } else if (kind === 'buzz') {
      add('frame', { x: 0, y: 0, w: 1080, h: 1080, name: '카드 템플릿', fill: grad('linear', '#FFF4E6', '#FFE3EC', 160) });
      add('image', { x: 80, y: 80, w: 920, h: 560, radius: 32, name: '사진' });
      add('text', { x: 80, y: 690, w: 920, textMode: 'fixed', text: '여름 한정 메뉴', fontSize: 64, fontWeight: 800, fill: '#1E1E1E', name: '제목' });
      add('text', { x: 80, y: 790, w: 920, textMode: 'fixed', text: '시원한 과일 음료를 만나 보세요', fontSize: 34, fill: '#555555', name: '설명' });
      add('rect', { x: 80, y: 900, w: 280, h: 96, radius: 48, fill: '#FF5C5C', name: '가격 배경' });
      add('text', { x: 80, y: 922, w: 280, textMode: 'fixed', align: 'center', text: '4,500원', fontSize: 40, fontWeight: 800, fill: '#FFFFFF', name: '가격' });
    } else if (kind === 'motion') {
      add('frame', { x: 0, y: 0, w: 1280, h: 720, name: '모션 장면', fill: '#14121F' });
      add('ellipse', { x: 140, y: 200, w: 300, h: 300, fill: grad('radial', '#9C88FF', '#2EC4B6'), name: '원', anim: { preset: 'zoom', delay: 0, duration: 800, easing: 'spring' } });
      add('text', { x: 520, y: 220, w: 660, textMode: 'fixed', text: '움직이는 디자인', fontSize: 64, fontWeight: 800, fill: '#FFFFFF', name: '제목', anim: { preset: 'up', delay: 250, duration: 700, easing: 'ease-out' } });
      add('text', { x: 520, y: 320, w: 640, textMode: 'fixed', text: '레이어마다 효과와 타이밍을 정하고 동영상으로 내보내세요.', fontSize: 28, lineHeight: 1.5, fill: '#B9B6D3', name: '설명', anim: { preset: 'up', delay: 450, duration: 700, easing: 'ease-out' } });
      add('rect', { x: 520, y: 470, w: 220, h: 64, radius: 32, fill: '#2EC4B6', label: '재생해 보기', labelColor: '#0B1F1D', labelSize: 20, name: '버튼', anim: { preset: 'left', delay: 650, duration: 600, easing: 'ease-out' } });
      add('star', { x: 1100, y: 70, w: 110, h: 110, fill: '#FFD43B', name: '별', anim: { preset: 'spin', delay: 0, duration: 4000, easing: 'linear' } });
    }
    return d;
  }

  function demoDoc() {
    const d = Ed.blankDoc('design', 'Draftboard 체험');
    const add = (type, props) => { const n = Ed.makeNode(type, props, d); d.nodes.push(n); return n; };
    add('frame', { x: 0, y: 0, w: 800, h: 520, name: '데스크톱' });
    add('rect', { x: 48, y: 48, w: 704, h: 180, radius: 16, fill: grad('linear', '#EAF2FF', '#F3EDFF', 90) });
    add('text', { x: 80, y: 92, text: 'Draftboard에 오신 것을 환영합니다', fontSize: 32, fontWeight: 700, fill: '#1E1E1E' });
    add('text', { x: 80, y: 146, text: '로컬에서 무료로 동작하는 디자인 도구입니다.\n위쪽 도구를 골라 캔버스에 그려 보세요.', fontSize: 16, fill: '#555555', lineHeight: 1.4 });
    add('ellipse', { x: 48, y: 268, w: 200, h: 200, fill: '#FFB020', effects: { shadow: { x: 0, y: 8, blur: 24, color: '#FFB020', opacity: 0.35 }, blur: 0 } });
    add('rect', { x: 296, y: 268, w: 200, h: 200, radius: 24, fill: '#0D8BFF', rotation: -8 });
    add('star', { x: 556, y: 268, w: 196, h: 196, fill: '#E71D36' });
    add('sticky', { x: 860, y: 60, w: 200, h: 200, fill: '#FFE066', label: '스티커 메모도 붙일 수 있어요!' });
    return d;
  }

  // ---------- start-up ----------
  async function boot() {
    const params = new URLSearchParams(location.search);
    try {
      if (s.demo) {
        s.doc = Ed.normalizeDoc(demoDoc());
      } else if (params.get('file')) {
        if (!await Ed.openFile(params.get('file'))) {
          document.body.insertAdjacentHTML('beforeend', '<div class="fatal">파일을 찾을 수 없습니다. <a href="files.html">파일 목록으로 이동</a></div>');
          return;
        }
      } else if (params.get('new')) {
        const kind = Ed.KINDS[params.get('new')] ? params.get('new') : 'design';
        await Ed.createFile(kind, starter(kind));
      } else {
        location.replace('files.html');
        return;
      }
    } catch (e) {
      document.body.insertAdjacentHTML('beforeend', `<div class="fatal">파일을 열지 못했습니다: ${esc(e.message)} <a href="files.html">파일 목록으로 이동</a></div>`);
      return;
    }
    document.body.classList.toggle('demo', s.demo);
    if (s.doc.kind === 'slides') s.leftTab = 'slides';
    if (s.doc.kind === 'motion') s.rightTab = 'motion';
    Ed.setTool('select');
    Ed.render();
    Ed.zoomFit(null, 1);
    document.body.classList.add('ready');
  }

  boot();
})();
