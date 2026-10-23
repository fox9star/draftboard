'use strict';
/* LocalAI — client for a model server running on this computer (Ollama).
   Nothing is sent to the internet and no credits are used. */
window.LocalAI = (() => {
  const KEY = 'draftboard.ai';
  const DEFAULTS = { endpoint: 'http://127.0.0.1:11434', model: '', ctx: 16384 };

  function cfg() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (e) { return { ...DEFAULTS }; }
  }

  function save(patch) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...cfg(), ...patch })); } catch (e) { /* settings stay for this visit */ }
  }

  const base = () => cfg().endpoint.replace(/\/+$/, '');

  async function models() {
    const r = await fetch(base() + '/api/tags');
    if (!r.ok) throw new Error(`모델 목록을 가져오지 못했습니다 (${r.status})`);
    const j = await r.json();
    return (j.models || []).map(m => ({
      name: m.name,
      params: (m.details && m.details.parameter_size) || '',
      caps: m.capabilities || [],
      size: m.size || 0,
    }));
  }

  // Preferred model: the saved one, then coding models, then general Qwen/Llama models.
  async function pickModel() {
    const list = await models();
    if (!list.length) throw new Error('설치된 모델이 없습니다. 터미널에서 "ollama pull qwen2.5:7b"를 실행하세요.');
    const saved = cfg().model;
    if (saved && list.some(m => m.name === saved)) return saved;
    const by = re => list.find(m => re.test(m.name));
    const m = by(/coder/i) || by(/^qwen2\.5:7b/i) || by(/^qwen/i) || by(/llama|gemma|mistral/i) || list[0];
    return m.name;
  }

  const hasVision = m => m.caps.includes('vision') || /llava|vision|bakllava|moondream|minicpm-v|qwen.*vl/i.test(m.name);

  // Streams a chat completion. onToken(piece, fullText) is called as text arrives.
  async function chat({ messages, model, signal, onToken, options = {} }) {
    const r = await fetch(base() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { num_ctx: cfg().ctx, ...options } }),
      signal,
    });
    if (!r.ok) {
      let msg = `${r.status}`;
      try { msg = (await r.json()).error || msg; } catch (e) { /* keep status */ }
      throw new Error('모델 응답 오류: ' + msg);
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        const piece = (j.message && j.message.content) || '';
        if (piece) {
          full += piece;
          if (onToken) onToken(piece, full);
        }
      }
    }
    return full;
  }

  function explain(err) {
    const m = String(err && err.message || err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return `로컬 AI 서버(${base()})에 연결할 수 없습니다. Ollama가 실행 중인지 확인하세요. 파일을 직접 열었다면 로컬 서버(http://127.0.0.1:8080)로 접속해야 합니다.`;
    }
    return m;
  }

  return { cfg, save, models, pickModel, hasVision, chat, explain };
})();
