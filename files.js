'use strict';
/* Draftboard — file browser: create, open, search, rename, duplicate, export and delete files. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;

  const KINDS = {
    design: { label: '디자인', color: '#7B61FF', desc: '화면 디자인과 클릭해서 넘기는 프로토타입', icon: ic('<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>') },
    whiteboard: { label: '화이트보드', color: '#F59F00', desc: '스티커 메모·연결선·스탬프로 아이디어 정리', icon: ic('<path d="M4 4h16v11l-5 5H4z"/><path d="M20 15h-5v5"/>') },
    slides: { label: '슬라이드', color: '#E8590C', desc: '발표 자료와 슬라이드 쇼, PDF 내보내기', icon: ic('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>') },
    site: { label: '사이트', color: '#1C7ED6', desc: '데스크톱·모바일 반응형 웹사이트로 내보내기', icon: ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>') },
    buzz: { label: '대량 제작', color: '#D6336C', desc: '템플릿과 표 데이터로 이미지를 한꺼번에 생성', icon: ic('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>') },
    motion: { label: '모션', color: '#2B8A3E', desc: '레이어 애니메이션과 동영상(WebM) 내보내기', icon: ic('<path d="M5 12c3-8 6-8 9 0s6 8 9 0"/><circle cx="5" cy="12" r="1.5"/>') },
  };
  const TOOLS = [
    { href: 'make.html', label: 'AI 빌더', color: '#0CA678', desc: '이 컴퓨터의 AI 모델로 프롬프트에서 웹 앱 만들기', icon: ic('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>') },
    { href: 'weave.html', label: '미디어 플로', color: '#5F3DC4', desc: '이미지·동영상·오디오를 노드로 연결해 처리', icon: ic('<circle cx="5" cy="7" r="2.5"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 7c5 0 5 5 9 5M7.5 17c5 0 5-5 9-5"/>') },
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

  function renderNew() {
    $('#new-grid').innerHTML = Object.entries(KINDS).map(([k, v]) =>
      `<a class="new-card" href="editor.html?new=${k}"><span class="tile" style="background:${v.color}">${v.icon}</span><div><b>${v.label}</b><span>${v.desc}</span></div></a>`).join('')
      + TOOLS.map(t => `<a class="new-card" href="${t.href}"><span class="tile" style="background:${t.color}">${t.icon}</span><div><b>${t.label}</b><span>${t.desc}</span></div></a>`).join('');
  }

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

  const importInput = $('#import-input');
  $('#import-btn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try {
      const meta = await Store.importJSON(await f.text());
      toast(`‘${meta.name}’을(를) 가져왔습니다.`);
      refresh();
    } catch (err) { toast(err.message); }
  });
  document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      if (!/\.json$/i.test(f.name)) continue;
      try { await Store.importJSON(await f.text()); } catch (err) { toast(err.message); }
    }
    refresh();
  });

  renderNew();
  (async () => {
    const migrated = await Store.migrateLegacy();
    if (migrated) toast('이전에 작업하던 파일을 불러왔습니다.');
    refresh();
  })();
  window.addEventListener('pageshow', e => { if (e.persisted) refresh(); });
})();
