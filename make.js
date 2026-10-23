'use strict';
/* Draftboard AI builder — describe an app, a local model writes it, the preview runs it. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = Scene.esc;
  const log = $('#log'), promptEl = $('#prompt'), frame = $('#frame'), codeEl = $('#code'), empty = $('#empty');

  const SYSTEM = `당신은 숙련된 프론트엔드 개발자입니다. 사용자가 설명한 웹 앱을 만듭니다.
규칙:
- 항상 하나의 완전한 HTML 문서(<!DOCTYPE html>부터 </html>까지)를 \`\`\`html 코드 블록 하나에 담아 답합니다.
- CSS와 JavaScript는 모두 그 파일 안에 넣습니다. 외부 라이브러리, CDN, 웹 글꼴, 외부 이미지 주소는 쓰지 않습니다. 아이콘이 필요하면 인라인 SVG나 이모지를 씁니다.
- 화면 문구는 한국어로 씁니다. 깔끔하고 현대적인 디자인, 충분한 여백, 모바일에서도 보기 좋은 반응형 레이아웃으로 만듭니다.
- 데이터를 저장해야 하면 localStorage를 씁니다.
- 수정 요청을 받으면 바뀐 부분만이 아니라 전체 파일을 다시 출력합니다.
- 코드 블록 앞에 무엇을 만들었는지 한두 문장으로 설명합니다.`;

  const EXAMPLES = [
    '할 일 목록 앱 — 추가, 완료 표시, 삭제, 남은 개수와 필터(전체/진행 중/완료)',
    '뽀모도로 타이머 — 25분 집중과 5분 휴식, 시작·일시정지·초기화, 남은 시간 원형 표시',
    '가계부 — 수입·지출 입력, 항목 목록, 이번 달 합계와 잔액, localStorage 저장',
    '카페 소개 랜딩 페이지 — 큰 제목, 메뉴 카드 6개, 영업시간과 위치 안내',
    '숫자 맞히기 게임 — 1부터 100까지, 크다/작다 힌트와 시도 횟수',
  ];

  let project = null, model = null, busy = false, abort = null, view = 'preview', liveTimer = null;

  // ---------- helpers ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function extractCode(text, partial = false) {
    const re = /```[ \t]*(?:html|HTML)?[ \t]*\n([\s\S]*?)```/g;
    let m, last = null;
    while ((m = re.exec(text))) last = m[1];
    if (last && /<[a-z!]/i.test(last)) return last.trim();
    if (partial) {
      const i = text.lastIndexOf('```');
      if (i >= 0) {
        const after = text.slice(i).replace(/^```[ \t]*(?:html|HTML)?[ \t]*\n?/, '');
        if (/<[a-z!]/i.test(after)) return after;
      }
    }
    const d = text.search(/<!doctype html|<html[\s>]/i);
    if (d >= 0) {
      const end = text.search(/<\/html>/i);
      return text.slice(d, end >= 0 ? end + 7 : undefined).trim();
    }
    return null;
  }

  const withoutCode = t => t.replace(/```[\s\S]*?(```|$)/g, '').trim();
  const newProject = () => ({ id: Store.newId('m'), name: '새 프로젝트', messages: [], code: '', createdAt: Date.now(), updatedAt: Date.now() });

  async function saveProject() {
    project.updatedAt = Date.now();
    try { await Store.put('make', project); } catch (e) { toast('프로젝트를 저장하지 못했습니다: ' + e.message); }
  }

  // ---------- rendering ----------
  function bubble(m) {
    if (m.role === 'note') return `<div class="msg note">${esc(m.content)}</div>`;
    if (m.role === 'error') return `<div class="msg err">${esc(m.content)}</div>`;
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    const text = withoutCode(m.content);
    const code = extractCode(m.content, true);
    const lines = code ? code.split('\n').length : 0;
    return `<div class="msg ai">${esc(text || (code ? '' : '생각 중…'))}${code ? `<div><span class="codechip">📄 HTML 코드 ${lines}줄${m.streaming ? ' 작성 중…' : ''}</span></div>` : ''}</div>`;
  }

  function renderLog() {
    if (!project.messages.length) {
      log.innerHTML = `<div class="welcome"><h3>무엇을 만들어 볼까요?</h3>
        <p>설명을 적으면 이 컴퓨터의 AI 모델이 HTML·CSS·JavaScript로 동작하는 앱을 만들어 오른쪽에 보여 줍니다. 결과를 보고 “버튼 색을 바꿔 줘”처럼 계속 고쳐 달라고 하세요.</p>
        <div class="chips">${EXAMPLES.map(x => `<button type="button" data-example="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
      return;
    }
    log.innerHTML = project.messages.map(bubble).join('');
    log.scrollTop = log.scrollHeight;
  }

  function updateLast() {
    const last = log.lastElementChild;
    const m = project.messages[project.messages.length - 1];
    if (last && m) last.outerHTML = bubble(m);
    log.scrollTop = log.scrollHeight;
  }

  function setPreview(code) {
    frame.srcdoc = code || '';
    empty.hidden = !!code;
  }

  function setCode(code) {
    codeEl.value = code || '';
    setPreview(code);
  }

  function setView(v) {
    view = v;
    $('#views').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    codeEl.hidden = v !== 'code';
    frame.hidden = v !== 'preview';
    if (v === 'preview') empty.hidden = !!project.code;
    else empty.hidden = true;
  }

  function setBusy(on) {
    busy = on;
    $('#send').disabled = on;
    $('#stop').hidden = !on;
    promptEl.disabled = on;
  }

  function showSetup(msg) {
    empty.innerHTML = `<div class="setup"><b>로컬 AI에 연결되지 않았습니다</b>
      <p>${esc(msg)}</p>
      <ol>
        <li><a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>를 설치하고 실행합니다.</li>
        <li>터미널에서 <code>ollama pull qwen2.5:7b</code>로 모델을 받습니다. (코드 품질을 높이려면 <code>qwen2.5-coder:7b</code>)</li>
        ${LocalAI.hosted()
          ? `<li>Ollama 설정 <code>OLLAMA_ORIGINS</code>에 <code>${esc(location.origin)}</code>을 넣고 Ollama를 다시 시작합니다.</li>
        <li>새로고침한 뒤 브라우저가 로컬 네트워크 접근을 물으면 ‘허용’을 누릅니다. 이미 차단했다면 주소창 왼쪽 아이콘 → 사이트 설정에서 허용합니다.</li>`
          : '<li>이 페이지를 로컬 서버(예: <code>http://127.0.0.1:8080/make.html</code>)로 열고 새로고침합니다.</li>'}
      </ol></div>`;
    empty.hidden = false;
  }

  function defaultEmpty() {
    if (!project.code) {
      empty.innerHTML = '<div>왼쪽에 만들고 싶은 앱을 설명하면<br>여기에서 바로 실행해 볼 수 있습니다.</div>';
      empty.hidden = view !== 'preview';
    }
  }

  // ---------- model ----------
  async function connect() {
    const status = $('#status'), select = $('#model');
    try {
      const list = await LocalAI.models();
      model = await LocalAI.pickModel();
      select.innerHTML = list.map(m => `<option value="${esc(m.name)}"${m.name === model ? ' selected' : ''}>${esc(m.name)}${m.params ? ` · ${esc(m.params)}` : ''}</option>`).join('');
      status.className = 'status-dot ok';
      status.title = `연결됨 — ${LocalAI.cfg().endpoint}`;
      defaultEmpty();
      return true;
    } catch (e) {
      model = null;
      select.innerHTML = '<option>연결 안 됨</option>';
      status.className = 'status-dot bad';
      status.title = LocalAI.explain(e);
      if (!project.code) showSetup(LocalAI.explain(e));
      return false;
    }
  }

  $('#model').addEventListener('change', e => {
    model = e.target.value;
    LocalAI.save({ model });
    toast(`모델을 ${model}(으)로 바꿨습니다.`);
  });

  // ---------- chat ----------
  async function send(text) {
    text = text.trim();
    if (busy || !text) return;
    if (!model && !(await connect())) return toast('로컬 AI에 연결할 수 없습니다.');
    if (!project.messages.some(m => m.role === 'user')) project.name = text.slice(0, 30);
    project.messages.push({ role: 'user', content: text });
    const msgs = [{ role: 'system', content: SYSTEM }];
    const history = project.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-7, -1);
    for (const m of history) msgs.push({ role: m.role, content: m.role === 'user' ? m.content : (withoutCode(m.content) || '코드를 작성했습니다.') });
    msgs.push({
      role: 'user',
      content: project.code
        ? `현재 앱 코드입니다:\n\`\`\`html\n${project.code}\n\`\`\`\n\n요청: ${text}\n\n요청을 반영한 전체 HTML 파일을 출력하세요.`
        : text,
    });
    const ai = { role: 'assistant', content: '', streaming: true };
    project.messages.push(ai);
    renderLog();
    setBusy(true);
    abort = new AbortController();
    try {
      await LocalAI.chat({
        model, messages: msgs, signal: abort.signal, options: { temperature: 0.4 },
        onToken: (piece, full) => {
          ai.content = full;
          updateLast();
          const partial = extractCode(full, true);
          if (partial && view === 'code') codeEl.value = partial;
          if (partial && !liveTimer) {
            liveTimer = setTimeout(() => {
              liveTimer = null;
              const now = extractCode(ai.content, true);
              if (now && view === 'preview' && /<\/body>|<\/html>/i.test(now)) setPreview(now);
            }, 1500);
          }
        },
      });
      ai.streaming = false;
      const code = extractCode(ai.content);
      if (code) {
        project.code = code;
        setCode(code);
      } else {
        project.messages.push({ role: 'note', content: '응답에 코드가 없어 미리보기를 그대로 두었습니다. 다시 요청해 보세요.' });
      }
    } catch (e) {
      ai.streaming = false;
      if (e.name === 'AbortError') project.messages.push({ role: 'note', content: '생성을 중지했습니다.' });
      else {
        project.messages.push({ role: 'error', content: LocalAI.explain(e) });
        connect();
      }
      if (!ai.content) project.messages.splice(project.messages.indexOf(ai), 1);
    } finally {
      clearTimeout(liveTimer);
      liveTimer = null;
      abort = null;
      setBusy(false);
      renderLog();
      saveProject();
      promptEl.focus();
    }
  }

  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const t = promptEl.value;
    promptEl.value = '';
    send(t);
  });
  promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#stop').addEventListener('click', () => { if (abort) abort.abort(); });
  log.addEventListener('click', e => {
    const b = e.target.closest('[data-example]');
    if (b) { promptEl.value = b.dataset.example; promptEl.focus(); }
  });

  // ---------- preview & code ----------
  $('#views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
  $('#devices').addEventListener('click', e => {
    const b = e.target.closest('[data-device]');
    if (!b) return;
    $('#devices').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#viewport').classList.toggle('mobile', b.dataset.device === 'mobile');
  });
  let codeTimer = null;
  codeEl.addEventListener('input', () => {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => {
      project.code = codeEl.value;
      setPreview(project.code);
      saveProject();
    }, 600);
  });
  codeEl.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = codeEl.selectionStart;
    codeEl.setRangeText('  ', s, codeEl.selectionEnd, 'end');
    codeEl.dispatchEvent(new Event('input'));
  });
  $('#reload').addEventListener('click', () => setPreview(project.code));
  $('#open-tab').addEventListener('click', () => {
    if (!project.code) return toast('아직 만든 앱이 없습니다.');
    window.open(URL.createObjectURL(new Blob([project.code], { type: 'text/html' })), '_blank');
  });
  $('#download').addEventListener('click', () => {
    if (!project.code) return toast('아직 만든 앱이 없습니다.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([project.code], { type: 'text/html' }));
    a.download = `${(project.name || 'app').replace(/[\\/:*?"<>|]/g, '_')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  // ---------- modal & menus ----------
  function modal(title, body) {
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `<div class="modal-box"><div class="modal-head"><span>${esc(title)}</span><button class="icon-btn" data-close>✕</button></div><div class="modal-body">${body}</div></div>`;
    document.body.appendChild(root);
    const close = () => root.remove();
    root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
    root.querySelector('[data-close]').addEventListener('click', close);
    root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    return { root, body: root.querySelector('.modal-body'), close };
  }

  $('#settings').addEventListener('click', () => {
    const c = LocalAI.cfg();
    const m = modal('로컬 AI 설정', `<div class="prm"><label>서버 주소 (Ollama)</label><input class="input" id="ai-endpoint" value="${esc(c.endpoint)}"></div>
      <div class="prm"><label>문맥 길이 (토큰)</label><input class="input" id="ai-ctx" type="number" min="2048" step="1024" value="${c.ctx}"></div>
      <p class="hint">길게 대화하거나 코드가 길면 문맥 길이를 늘리세요. 값이 클수록 메모리를 더 씁니다.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" data-close2>취소</button><button class="btn primary" id="ai-save">저장하고 연결</button></div>`);
    m.body.querySelector('[data-close2]').onclick = m.close;
    m.body.querySelector('#ai-save').onclick = async () => {
      LocalAI.save({ endpoint: m.body.querySelector('#ai-endpoint').value.trim() || 'http://127.0.0.1:11434', ctx: Math.max(2048, +m.body.querySelector('#ai-ctx').value || 16384) });
      m.close();
      toast((await connect()) ? '로컬 AI에 연결했습니다.' : '연결하지 못했습니다.');
    };
  });

  const dd = $('#dropdown');
  document.addEventListener('pointerdown', e => { if (!dd.hidden && !dd.contains(e.target) && e.target.id !== 'projects-btn') dd.hidden = true; });
  $('#projects-btn').addEventListener('click', async e => {
    if (!dd.hidden) { dd.hidden = true; return; }
    const all = (await Store.getAll('make')).sort((a, b) => b.updatedAt - a.updatedAt);
    const items = all.map(p => ({ label: (p.id === project.id ? '✓ ' : '') + p.name, run: () => open(p) }));
    items.push('-', { label: '이 프로젝트 삭제', danger: true, run: removeProject });
    dd.innerHTML = items.map((it, i) => it === '-' ? '<div class="dd-sep"></div>' : `<button class="dd-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
    dd.onclick = ev => { const b = ev.target.closest('[data-i]'); if (b) { dd.hidden = true; items[+b.dataset.i].run(); } };
    const r = e.currentTarget.getBoundingClientRect();
    dd.hidden = false;
    dd.style.left = Math.max(8, r.right - dd.getBoundingClientRect().width) + 'px';
    dd.style.top = r.bottom + 4 + 'px';
  });

  function open(p) {
    if (busy) return toast('생성이 끝난 뒤에 바꿀 수 있습니다.');
    project = p;
    localStorage.setItem('draftboard.make.last', p.id);
    renderLog();
    setCode(p.code);
    defaultEmpty();
    setView('preview');
  }

  async function removeProject() {
    if (!confirm(`‘${project.name}’ 프로젝트를 삭제할까요?`)) return;
    await Store.del('make', project.id);
    open(newProject());
    toast('삭제했습니다.');
  }

  $('#new-btn').addEventListener('click', () => {
    open(newProject());
    promptEl.focus();
  });

  // Turn a frame of a Draftboard file into a starting HTML page
  $('#import-design').addEventListener('click', async () => {
    const files = await Store.list();
    if (!files.length) return toast('가져올 Draftboard 파일이 없습니다.');
    const m = modal('디자인 가져오기', `<p class="hint">파일을 고르세요.</p><div class="pick-list">${files.map(f => `<button data-file="${f.id}"><b>${esc(f.name)}</b><span class="muted">${esc(f.kind)}</span></button>`).join('')}</div>`);
    m.body.addEventListener('click', async e => {
      const fb = e.target.closest('[data-file]');
      const frb = e.target.closest('[data-frame]');
      if (fb) {
        const f = await Store.loadFile(fb.dataset.file);
        if (!f) return;
        m.file = f;
        const parents = Scene.frameParents(f.doc.nodes);
        const frames = f.doc.nodes.filter(n => n.type === 'frame' && !parents.has(n.id));
        if (!frames.length) { m.body.innerHTML = '<p class="hint">이 파일에는 프레임이 없습니다.</p>'; return; }
        m.body.innerHTML = `<p class="hint">‘${esc(f.meta.name)}’에서 프레임을 고르세요.</p><div class="pick-list">${frames.map(fr => `<button data-frame="${fr.id}"><b>${esc(fr.name)}</b><span class="muted">${Math.round(fr.w)}×${Math.round(fr.h)}</span></button>`).join('')}</div>`;
      } else if (frb && m.file) {
        const doc = m.file.doc, assets = new Map(m.file.assets);
        doc.nodes.forEach(n => { if (n.type === 'text') Scene.fitText(n); });
        const fr = doc.nodes.find(n => n.id === frb.dataset.frame);
        const content = [fr, ...Scene.childrenIn(doc.nodes, fr)].filter(n => n.visible !== false);
        const code = Codegen.frameCode(fr, content, { imageHref: id => assets.get(id) || '', motion: true });
        const html = Codegen.documentHTML(fr.name, code.css + '\nbody { display: grid; place-items: start center; min-height: 100vh; background: #f4f4f5; }', code.html);
        m.close();
        if (busy) return;
        project.code = html;
        if (project.name === '새 프로젝트') project.name = fr.name;
        project.messages.push({ role: 'note', content: `‘${fr.name}’ 프레임을 코드로 가져왔습니다. 이제 “버튼을 누르면 목록에 추가되게 해 줘”처럼 동작을 요청하세요.` });
        setCode(html);
        setView('preview');
        renderLog();
        saveProject();
      }
    });
  });

  // ---------- start ----------
  (async () => {
    let p = null;
    try {
      const last = localStorage.getItem('draftboard.make.last');
      const all = (await Store.getAll('make')).sort((a, b) => b.updatedAt - a.updatedAt);
      p = all.find(x => x.id === last) || all[0] || null;
    } catch (e) { /* start fresh */ }
    project = p || newProject();
    renderLog();
    setCode(project.code);
    setView('preview');
    defaultEmpty();
    await connect();
  })();
})();
