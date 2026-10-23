'use strict';
/* Draftboard — file browser: create, open, search, rename, duplicate, export and delete files. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;

  const KINDS = {
    design: { label: '디자인', color: '#7B61FF', desc: '화면 디자인과 클릭해서 넘기는 프로토타입', icon: ic('<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>') },
    illustration: { label: '일러스트', color: '#1098AD', desc: '펜·점 편집·불리언·그라디언트로 그리는 벡터 그림', icon: ic('<path d="M12 3l6 9-6 9-6-9z"/><circle cx="12" cy="12" r="2"/>') },
    whiteboard: { label: '화이트보드', color: '#F59F00', desc: '스티커 메모·연결선·스탬프로 아이디어 정리', icon: ic('<path d="M4 4h16v11l-5 5H4z"/><path d="M20 15h-5v5"/>') },
    slides: { label: '슬라이드', color: '#E8590C', desc: '발표 자료와 슬라이드 쇼, PDF 내보내기', icon: ic('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>') },
    site: { label: '사이트', color: '#1C7ED6', desc: '데스크톱·모바일 반응형 웹사이트로 내보내기', icon: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>') },
    buzz: { label: '대량 제작', color: '#D6336C', desc: '템플릿과 표 데이터로 이미지를 한꺼번에 생성', icon: ic('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>') },
    motion: { label: '모션', color: '#2B8A3E', desc: '레이어 애니메이션과 동영상(WebM) 내보내기', icon: ic('<path d="M5 12c3-8 6-8 9 0s6 8 9 0"/><circle cx="5" cy="12" r="1.5"/>') },
  };
  const TOOLS = [
    { id: 'make', href: 'make.html', label: 'AI 빌더', color: '#0CA678', desc: '이 컴퓨터의 AI 모델로 프롬프트에서 웹 앱 만들기', icon: ic('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>') },
    { id: 'weave', href: 'weave.html', label: '미디어 플로', color: '#5F3DC4', desc: '이미지·동영상·오디오를 노드로 연결해 처리', icon: ic('<circle cx="5" cy="7" r="2.5"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 7c5 0 5 5 9 5M7.5 17c5 0 5-5 9-5"/>') },
  ];

  let files = [], filter = 'all', query = '';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    return new Date(ts).toLocaleDateString('ko-KR');
  }

  // Same ten entries, in the same order, as the home page
  const DEV = { label: '개발 모드', color: '#2F9E44', desc: '레이어의 속성과 CSS·HTML·React·Tailwind·SVG 코드 보기', icon: ic('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>') };
  const NEW_ITEMS = [['kind', 'design', '디자인 & 프로토타입'], ['kind', 'slides'], ['tool', 'make'], ['kind', 'illustration'], ['tool', 'weave'],
    ['kind', 'site'], ['dev'], ['kind', 'buzz'], ['kind', 'motion'], ['kind', 'whiteboard']];

  const card = (tag, attrs, v, title) =>
    `<${tag} class="new-card" ${attrs}><span class="tile" style="background:${v.color}">${v.icon}</span><div><b>${esc(title || v.label)}</b><span>${esc(v.desc)}</span></div></${tag}>`;

  function renderNew() {
    $('#new-grid').innerHTML = NEW_ITEMS.map(([type, key, title]) => {
      if (type === 'kind') return card('a', `href="editor.html?new=${key}"`, KINDS[key], title);
      if (type === 'tool') { const t = TOOLS.find(x => x.id === key); return card('a', `href="${t.href}"`, t); }
      return card('button', 'type="button" id="dev-card"', DEV);
    }).join('');
  }

  // Dev mode is a tab of the editor, so the card opens an existing file (or an example) in it.
  function devModeDialog() {
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `<div class="modal-box" role="dialog" aria-label="개발 모드"><div class="modal-head"><span>개발 모드로 열기</span><button class="icon-btn" data-dev="close" aria-label="닫기">✕</button></div>
      <div class="modal-body">
        <p class="hint" style="margin-top:0">파일을 고르면 오른쪽 <b>코드</b> 탭이 열린 상태로 열립니다. 레이어를 선택하면 속성과 CSS · HTML · React · Tailwind · SVG 코드가 표시됩니다.</p>
        <div class="pick-list" style="margin:12px 0">${files.length
          ? files.slice(0, 60).map(f => `<button data-dev-file="${f.id}"><b>${esc(f.name)}</b><span class="muted">${esc((KINDS[f.kind] || KINDS.design).label)} · ${ago(f.updatedAt)}</span></button>`).join('')
          : '<p class="hint">아직 파일이 없습니다. 예제 화면으로 시작해 보세요.</p>'}</div>
        <div style="display:flex;justify-content:flex-end"><a class="btn primary" href="editor.html?new=design&sample=ui&panel=code">예제 화면으로 열기</a></div>
      </div></div>`;
    document.body.appendChild(root);
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', e => {
      if (e.target === root || e.target.closest('[data-dev="close"]')) return close();
      const b = e.target.closest('[data-dev-file]');
      if (b) location.href = `editor.html?file=${b.dataset.devFile}&panel=code`;
    });
  }
  $('#new-grid').addEventListener('click', e => { if (e.target.closest('#dev-card')) devModeDialog(); });

  function renderFilters() {
    const counts = { all: files.length };
    files.forEach(f => { counts[f.kind] = (counts[f.kind] || 0) + 1; });
    $('#filters').innerHTML = [['all', '전체'], ...Object.entries(KINDS).map(([k, v]) => [k, v.label])]
      .filter(([k]) => k === 'all' || counts[k])
      .map(([k, l]) => `<button class="chip${filter === k ? ' on' : ''}" data-filter="${k}">${l} ${counts[k] || 0}</button>`).join('');
  }

  function renderFiles() {
    const q = query.trim().toLowerCase();
    const list = files.filter(f => (filter === 'all' || f.kind === filter) && (!q || f.name.toLowerCase().includes(q)));
    const grid = $('#file-grid');
    if (!list.length) {
      grid.innerHTML = `<div class="empty-files">${files.length ? '조건에 맞는 파일이 없습니다.' : '아직 파일이 없습니다. 위에서 새 파일을 만들어 보세요.'}</div>`;
      return;
    }
    grid.innerHTML = list.map(f => {
      const k = KINDS[f.kind] || KINDS.design;
      return `<div class="file-card" data-id="${f.id}" tabindex="0">
        <div class="thumb"${f.thumb ? ` style="background-image:url('${f.thumb}')"` : ''}>${f.thumb ? '' : k.icon}</div>
        <div class="meta"><span class="name">${esc(f.name)}</span><span class="sub"><span class="badge" style="background:${k.color}">${k.label}</span>${ago(f.updatedAt)}</span></div>
        <button class="icon-btn more" data-more="${f.id}" title="더 보기" aria-label="${esc(f.name)} 메뉴">⋯</button>
      </div>`;
    }).join('');
  }

  async function refresh() {
    files = await Store.list();
    renderFilters();
    renderFiles();
    const u = await Store.usage();
    $('#storage').textContent = `파일 ${files.length}개 · 모든 파일은 이 브라우저(IndexedDB)에 저장되며 서버로 전송되지 않습니다.`
      + (u && u.usage != null ? ` 사용량 약 ${(u.usage / 1048576).toFixed(1)}MB` : '');
  }

  const dd = $('#dropdown');
  let ddActions = [];
  function menu(x, y, items) {
    ddActions = items;
    dd.innerHTML = items.map((it, i) => it === '-' ? '<div class="dd-sep"></div>' : `<button class="dd-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
    dd.hidden = false;
    const r = dd.getBoundingClientRect();
    dd.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    dd.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  dd.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    dd.hidden = true;
    ddActions[+b.dataset.i].run();
  });
  document.addEventListener('pointerdown', e => {
    if (!dd.hidden && !dd.contains(e.target) && !e.target.closest('[data-more]')) dd.hidden = true;
  });

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function rename(id) {
    const card = $(`.file-card[data-id="${id}"]`);
    const f = files.find(x => x.id === id);
    if (!card || !f) return;
    const nameEl = card.querySelector('.name');
    nameEl.innerHTML = `<input class="rename" value="${esc(f.name)}">`;
    const input = nameEl.firstChild;
    input.focus();
    input.select();
    const done = async ok => {
      input.onblur = null;
      const v = input.value.trim();
      if (ok && v && v !== f.name) {
        const meta = await Store.getMeta(id);
        meta.name = v;
        meta.updatedAt = Date.now();
        await Store.putMeta(meta);
        const loaded = await Store.loadFile(id);
        if (loaded) await Store.saveFile(meta, { ...loaded.doc, name: v });
      }
      refresh();
    };
    input.onblur = () => done(true);
    input.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
    input.onclick = e => e.stopPropagation();
  }

  function fileMenu(id, x, y) {
    const f = files.find(v => v.id === id);
    menu(x, y, [
      { label: '열기', run: () => { location.href = `editor.html?file=${id}`; } },
      { label: '새 탭에서 열기', run: () => window.open(`editor.html?file=${id}`, '_blank') },
      '-',
      { label: '이름 바꾸기', run: () => rename(id) },
      { label: '복제', run: async () => { await Store.duplicate(id); toast('복제했습니다.'); refresh(); } },
      { label: 'JSON 파일로 내보내기', run: async () => download(new Blob([await Store.exportJSON(id)], { type: 'application/json' }), `${f.name}.draftboard.json`) },
      '-',
      {
        label: '삭제', danger: true,
        run: async () => {
          if (!confirm(`‘${f.name}’ 파일을 삭제할까요? 되돌릴 수 없습니다.`)) return;
          await Store.remove(id);
          toast('삭제했습니다.');
          refresh();
        },
      },
    ]);
  }

  $('#file-grid').addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const r = more.getBoundingClientRect();
      return fileMenu(more.dataset.more, r.left, r.bottom + 4);
    }
    if (e.target.closest('.rename')) return;
    const card = e.target.closest('.file-card');
    if (card) location.href = `editor.html?file=${card.dataset.id}`;
  });
  $('#file-grid').addEventListener('contextmenu', e => {
    const card = e.target.closest('.file-card');
    if (!card) return;
    e.preventDefault();
    fileMenu(card.dataset.id, e.clientX, e.clientY);
  });
  $('#file-grid').addEventListener('keydown', e => {
    const card = e.target.closest('.file-card');
    if (card && e.key === 'Enter' && e.target === card) location.href = `editor.html?file=${card.dataset.id}`;
  });
  $('#filters').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    renderFilters();
    renderFiles();
  });
  $('#search').addEventListener('input', e => { query = e.target.value; renderFiles(); });

  const summary = r => `새 파일 ${r.added}개, 갱신 ${r.updated}개${r.skipped ? `, 이곳이 더 최신이라 건너뜀 ${r.skipped}개` : ''}`;

  async function importFile(f) {
    const r = await Store.importText(await f.text());
    toast(r.backup ? `백업을 가져왔습니다: ${summary(r)}` : `‘${r.meta.name}’을(를) 가져왔습니다.`);
  }

  const importInput = $('#import-input');
  $('#import-btn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try { await importFile(f); } catch (err) { toast(err.message); }
    refresh();
  });
  document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      if (!/\.json$/i.test(f.name)) continue;
      try { await importFile(f); } catch (err) { toast(err.message); }
    }
    refresh();
  });

  $('#backup-btn').addEventListener('click', async () => {
    const data = await Store.exportAll();
    if (!data.files.length) return toast('백업할 파일이 없습니다.');
    const day = new Date().toISOString().slice(0, 10);
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `draftboard-backup-${day}.json`);
    toast(`파일 ${data.files.length}개를 백업했습니다. 다른 주소의 ‘가져오기’로 한 번에 복원할 수 있습니다.`);
  });

  // ---------- moving files from the local server to this address ----------
  // Files live in each address's own browser storage. The local page sends them over
  // with postMessage, and only after the person confirms in that window.
  const LOCAL_ORIGIN = 'http://127.0.0.1:8080';
  const pullBtn = $('#pull-btn');
  pullBtn.hidden = location.origin === LOCAL_ORIGIN;
  pullBtn.addEventListener('click', () => {
    const w = window.open(`${LOCAL_ORIGIN}/files.html?transfer=${encodeURIComponent(location.origin)}`, 'draftboard-transfer', 'width=560,height=660');
    if (!w) return toast('팝업이 차단되었습니다. 주소창에서 이 사이트의 팝업을 허용해 주세요.');
    toast('새 창에서 ‘보내기’를 누르세요. 창이 열리지 않으면 로컬 서버(127.0.0.1:8080)가 실행 중인지 확인하세요.');
    const onMessage = async e => {
      if (e.origin !== LOCAL_ORIGIN || !e.data || e.data.type !== 'draftboard-transfer') return;
      window.removeEventListener('message', onMessage);
      try {
        const r = await Store.importFiles(e.data.files);
        toast(`이 PC의 파일을 가져왔습니다: ${summary(r)}`);
        if (e.source) e.source.postMessage({ type: 'draftboard-transfer-done', ...r }, LOCAL_ORIGIN);
      } catch (err) { toast('가져오지 못했습니다: ' + err.message); }
      refresh();
    };
    window.addEventListener('message', onMessage);
  });

  function transferDialog(target) {
    let origin;
    try { origin = new URL(target).origin; } catch (e) { return; }
    if (!window.opener || origin === location.origin) return;
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `<div class="modal-box"><div class="modal-head"><span>파일 보내기</span></div><div class="modal-body" id="tx-body">불러오는 중…</div></div>`;
    document.body.appendChild(root);
    const body = root.querySelector('#tx-body');
    (async () => {
      const metas = await Store.list();
      if (!metas.length) {
        body.innerHTML = '<p>이 주소에는 보낼 파일이 없습니다.</p><div style="display:flex;justify-content:flex-end"><button class="btn" data-tx="close">닫기</button></div>';
        return;
      }
      body.innerHTML = `<p><b>${esc(origin)}</b> 에서 이 PC(${esc(location.origin)})의 Draftboard 파일 <b>${metas.length}개</b>를 가져가려고 합니다.</p>
        <ul class="hint" style="max-height:200px;overflow:auto;margin:10px 0;padding-left:18px">${metas.map(m => `<li>${esc(m.name)}</li>`).join('')}</ul>
        <p class="hint">직접 연 사이트가 맞을 때만 보내세요. 보낸 뒤에도 이 PC의 파일은 그대로 남습니다.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" data-tx="close">취소</button><button class="btn primary" data-tx="send">보내기</button></div>`;
    })();
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-tx]');
      if (!b) return;
      if (b.dataset.tx === 'close') { window.close(); root.remove(); return; }
      b.disabled = true;
      b.textContent = '보내는 중…';
      const data = await Store.exportAll();
      window.addEventListener('message', ev => {
        if (ev.origin !== origin || !ev.data || ev.data.type !== 'draftboard-transfer-done') return;
        body.innerHTML = `<p>보냈습니다. ${esc(summary(ev.data))}</p><p class="hint">이 창은 닫아도 됩니다.</p>`;
        setTimeout(() => window.close(), 1500);
      });
      window.opener.postMessage({ type: 'draftboard-transfer', files: data.files }, origin);
      body.innerHTML = '<p>보내는 중입니다…</p>';
    });
  }

  const transferTo = new URLSearchParams(location.search).get('transfer');
  if (transferTo) transferDialog(transferTo);

  renderNew();
  (async () => {
    const migrated = await Store.migrateLegacy();
    if (migrated) toast('이전에 작업하던 파일을 불러왔습니다.');
    refresh();
  })();
  window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
})();
