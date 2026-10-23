'use strict';
/* Draftboard media flow — connect image, video, audio and local-AI nodes into a processing pipeline. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = Scene.esc;
  const graphEl = $('#graph'), inner = $('#graph-inner'), wires = $('#wires'), insp = $('#inspector');
  const COLORS = { image: '#1C7ED6', text: '#2B8A3E', video: '#E8590C', audio: '#AE3EC9', any: '#868E96' };
  const TYPE_LABEL = { image: '이미지', text: '텍스트', video: '동영상', audio: '오디오', any: '무엇이든' };

  // ---------- helpers ----------
  const canvasOf = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };
  const loadImg = src => new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    i.src = src;
  });
  const once = (el, ev) => new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('미디어를 읽지 못했습니다.')); };
    const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
    el.addEventListener(ev, ok);
    el.addEventListener('error', bad);
  });
  const seek = async (v, t) => {
    if (Math.abs(v.currentTime - t) < 0.001) v.currentTime = t + 0.002;
    const p = once(v, 'seeked');
    v.currentTime = t;
    await p;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fileToDataURL = f => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  let audioCtx = null;
  const actx = () => audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function wav(buffer) {
    const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
    const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, len * ch * 2, true);
    const data = [...Array(ch)].map((_, i) => buffer.getChannelData(i));
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = clamp(data[c][i], -1, 1);
        out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        o += 2;
      }
    }
    return new Blob([out], { type: 'audio/wav' });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  let modelCache = null;
  async function models() {
    if (!modelCache) {
      try { modelCache = await LocalAI.models(); } catch (e) { modelCache = []; }
    }
    return modelCache;
  }
  let fileCache = null;
  async function files() {
    if (!fileCache) fileCache = await Store.list();
    return fileCache;
  }

  const cleanAI = t => String(t || '').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '').trim();

  // ---------- node types ----------
  const NODES = {
    imageIn: {
      cat: '입력', label: '이미지 불러오기', desc: '컴퓨터의 이미지 파일을 불러옵니다.',
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [{ id: 'file', type: 'image', label: '이미지 파일' }],
      run: async (inp, p) => {
        if (!p.file) throw new Error('이미지 파일을 선택하세요.');
        const im = await loadImg(p.file), c = canvasOf(im.naturalWidth, im.naturalHeight);
        c.getContext('2d').drawImage(im, 0, 0);
        return { img: c };
      },
    },
    videoIn: {
      cat: '입력', label: '동영상 불러오기', desc: '동영상 파일을 불러옵니다. 파일은 저장되지 않아 새로고침하면 다시 선택해야 합니다.',
      outputs: [{ id: 'video', type: 'video', label: '동영상' }],
      params: [{ id: 'file', type: 'video', label: '동영상 파일' }],
      run: async (inp, p, node) => {
        const rt = runtime.get(node.id);
        if (!rt || !rt.url) throw new Error(p.fileName ? `‘${p.fileName}’ 파일을 다시 선택하세요.` : '동영상 파일을 선택하세요.');
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.playsInline = true;
        const ready = once(v, 'loadeddata');
        v.src = rt.url;
        await ready;
        return { video: { el: v, url: rt.url, w: v.videoWidth, h: v.videoHeight, duration: v.duration, name: p.fileName } };
      },
    },
    audioIn: {
      cat: '입력', label: '오디오 불러오기', desc: '오디오 파일(mp3, wav 등)을 불러옵니다.',
      outputs: [{ id: 'audio', type: 'audio', label: '오디오' }],
      params: [{ id: 'file', type: 'audio', label: '오디오 파일' }],
      run: async (inp, p, node) => {
        const rt = runtime.get(node.id);
        if (!rt || !rt.buffer) throw new Error(p.fileName ? `‘${p.fileName}’ 파일을 다시 선택하세요.` : '오디오 파일을 선택하세요.');
        return { audio: { buffer: rt.buffer, name: p.fileName } };
      },
    },
    textIn: {
      cat: '입력', label: '텍스트', desc: '직접 적은 글을 다음 노드로 보냅니다.',
      outputs: [{ id: 'text', type: 'text', label: '텍스트' }],
      params: [{ id: 'text', type: 'textarea', label: '내용', default: '' }],
      run: async (inp, p) => ({ text: p.text || '' }),
    },
    designIn: {
      cat: '입력', label: 'Draftboard 프레임', desc: 'Draftboard 파일의 프레임을 이미지로 가져옵니다.',
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [{ id: 'fileId', type: 'dbfile', label: '파일' }, { id: 'frameId', type: 'dbframe', label: '프레임' }, { id: 'scale', type: 'range', label: '배율', min: 0.25, max: 3, step: 0.25, default: 1 }],
      run: async (inp, p) => {
        if (!p.fileId) throw new Error('파일을 선택하세요.');
        const f = await Store.loadFile(p.fileId);
        if (!f) throw new Error('파일을 찾을 수 없습니다.');
        const assets = new Map(f.assets);
        f.doc.nodes.forEach(n => { if (n.type === 'text') Scene.fitText(n); });
        const fr = f.doc.nodes.find(n => n.id === p.frameId) || f.doc.nodes.find(n => n.type === 'frame');
        if (!fr) throw new Error('이 파일에는 프레임이 없습니다.');
        const content = [fr, ...Scene.childrenIn(f.doc.nodes, fr)].filter(n => n.visible !== false);
        return { img: await Scene.toCanvas(content, { region: Scene.localBox(fr), scale: +p.scale || 1, imageHref: id => assets.get(id) || '' }) };
      },
    },
    gradient: {
      cat: '만들기', label: '그라디언트 배경', desc: '두 색으로 된 배경 이미지를 만듭니다.',
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'w', type: 'number', label: '너비', default: 1080 }, { id: 'h', type: 'number', label: '높이', default: 1080 },
        { id: 'c1', type: 'color', label: '시작 색', default: '#7B61FF' }, { id: 'c2', type: 'color', label: '끝 색', default: '#2EC4B6' },
        { id: 'kind', type: 'select', label: '모양', options: [['linear', '선형'], ['radial', '원형']], default: 'linear' },
        { id: 'angle', type: 'range', label: '각도', min: 0, max: 360, step: 5, default: 135 },
      ],
      run: async (inp, p) => {
        const w = clamp(+p.w || 1080, 1, 8000), h = clamp(+p.h || 1080, 1, 8000), c = canvasOf(w, h), g = c.getContext('2d');
        let gr;
        if (p.kind === 'radial') gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 1.6);
        else {
          const a = (+p.angle || 0) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
          const L = Math.abs(w * dx) + Math.abs(h * dy);
          gr = g.createLinearGradient(w / 2 - dx * L / 2, h / 2 - dy * L / 2, w / 2 + dx * L / 2, h / 2 + dy * L / 2);
        }
        gr.addColorStop(0, p.c1);
        gr.addColorStop(1, p.c2);
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        return { img: c };
      },
    },
    llm: {
      cat: 'AI (내 컴퓨터)', label: 'AI 텍스트 생성', desc: '이 컴퓨터의 AI 모델(Ollama)이 지시에 따라 글을 씁니다. 입력 텍스트를 연결하면 함께 전달합니다.',
      inputs: [{ id: 'text', type: 'text', label: '입력', optional: true }],
      outputs: [{ id: 'text', type: 'text', label: '결과' }],
      params: [
        { id: 'prompt', type: 'textarea', label: '지시', default: '다음 내용을 짧고 매력적인 광고 문구 한 문장으로 바꿔 주세요. 문구만 출력하세요.' },
        { id: 'model', type: 'model', label: '모델', default: '' },
        { id: 'temp', type: 'range', label: '창의성', min: 0, max: 1.5, step: 0.1, default: 0.7 },
      ],
      run: async (inp, p, node) => {
        const model = p.model || await LocalAI.pickModel();
        const user = p.prompt + (inp.text ? `\n\n입력:\n${inp.text}` : '');
        try {
          const out = await LocalAI.chat({
            model, options: { temperature: +p.temp },
            messages: [{ role: 'system', content: '요청한 결과만 간결하게 한국어로 출력하세요. 설명이나 머리말을 붙이지 마세요.' }, { role: 'user', content: user }],
            onToken: (piece, full) => setPreviewText(node.id, full),
          });
          return { text: cleanAI(out) };
        } catch (e) { throw new Error(LocalAI.explain(e)); }
      },
    },
    vision: {
      cat: 'AI (내 컴퓨터)', label: 'AI 이미지 설명', desc: '비전 모델(예: llava)이 이미지를 보고 글로 설명합니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }],
      outputs: [{ id: 'text', type: 'text', label: '설명' }],
      params: [
        { id: 'prompt', type: 'textarea', label: '질문', default: '이 이미지를 한국어로 자세히 설명해 주세요.' },
        { id: 'model', type: 'model', label: '모델', default: '', vision: true },
      ],
      run: async (inp, p, node) => {
        const list = await models();
        const vis = list.filter(LocalAI.hasVision);
        const model = p.model || (vis[0] && vis[0].name);
        if (!model) throw new Error('이미지를 이해하는 비전 모델이 없습니다. 터미널에서 "ollama pull llava" 또는 "ollama pull qwen2.5vl"로 받아 주세요.');
        const src = inp.img, k = Math.min(1, 1024 / Math.max(src.width, src.height));
        const c = canvasOf(src.width * k, src.height * k);
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
        try {
          const out = await LocalAI.chat({
            model, messages: [{ role: 'user', content: p.prompt, images: [b64] }],
            onToken: (piece, full) => setPreviewText(node.id, full),
          });
          return { text: out.trim() };
        } catch (e) { throw new Error(LocalAI.explain(e)); }
      },
    },
    filter: {
      cat: '이미지', label: '필터', desc: '밝기, 대비, 채도, 색조, 흐림 등을 조절합니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'brightness', type: 'range', label: '밝기', min: 0, max: 200, step: 1, default: 100 },
        { id: 'contrast', type: 'range', label: '대비', min: 0, max: 200, step: 1, default: 100 },
        { id: 'saturate', type: 'range', label: '채도', min: 0, max: 300, step: 1, default: 100 },
        { id: 'hue', type: 'range', label: '색조 회전', min: -180, max: 180, step: 1, default: 0 },
        { id: 'blur', type: 'range', label: '흐림', min: 0, max: 30, step: 0.5, default: 0 },
        { id: 'grayscale', type: 'range', label: '흑백', min: 0, max: 100, step: 1, default: 0 },
        { id: 'sepia', type: 'range', label: '세피아', min: 0, max: 100, step: 1, default: 0 },
        { id: 'invert', type: 'range', label: '반전', min: 0, max: 100, step: 1, default: 0 },
      ],
      run: async (inp, p) => {
        const src = inp.img, c = canvasOf(src.width, src.height), g = c.getContext('2d');
        g.filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturate}%) hue-rotate(${p.hue}deg) blur(${p.blur}px) grayscale(${p.grayscale}%) sepia(${p.sepia}%) invert(${p.invert}%)`;
        g.drawImage(src, 0, 0);
        return { img: c };
      },
    },
    resize: {
      cat: '이미지', label: '크기·자르기', desc: '원하는 크기로 바꾸고 맞춤 방식을 고릅니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'w', type: 'number', label: '너비', default: 1080 }, { id: 'h', type: 'number', label: '높이', default: 1080 },
        { id: 'fit', type: 'select', label: '맞춤', options: [['cover', '채우기 (잘라냄)'], ['contain', '맞춤 (여백)'], ['fill', '늘이기']], default: 'cover' },
        { id: 'bg', type: 'color', label: '여백 색', default: '#ffffff' },
      ],
      run: async (inp, p) => {
        const src = inp.img, w = clamp(+p.w || src.width, 1, 8000), h = clamp(+p.h || src.height, 1, 8000);
        const c = canvasOf(w, h), g = c.getContext('2d');
        if (p.fit === 'fill') g.drawImage(src, 0, 0, w, h);
        else {
          const k = p.fit === 'contain' ? Math.min(w / src.width, h / src.height) : Math.max(w / src.width, h / src.height);
          if (p.fit === 'contain') { g.fillStyle = p.bg; g.fillRect(0, 0, w, h); }
          g.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
        }
        return { img: c };
      },
    },
    transform: {
      cat: '이미지', label: '회전·뒤집기', desc: '이미지를 돌리거나 뒤집습니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'rot', type: 'select', label: '회전', options: [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], default: '0' },
        { id: 'flipH', type: 'check', label: '좌우 뒤집기', default: false }, { id: 'flipV', type: 'check', label: '상하 뒤집기', default: false },
      ],
      run: async (inp, p) => {
        const src = inp.img, r = +p.rot, swap = r === 90 || r === 270;
        const c = canvasOf(swap ? src.height : src.width, swap ? src.width : src.height), g = c.getContext('2d');
        g.translate(c.width / 2, c.height / 2);
        g.rotate(r * Math.PI / 180);
        g.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
        g.drawImage(src, -src.width / 2, -src.height / 2);
        return { img: c };
      },
    },
    textOverlay: {
      cat: '이미지', label: '글자 넣기', desc: '이미지 위에 글자를 얹습니다. 텍스트 입력을 연결하면 그 글을 씁니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }, { id: 'text', type: 'text', label: '글자', optional: true }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'text', type: 'textarea', label: '글자 (입력이 없을 때)', default: '여기에 문구를 넣으세요', rows: 2 },
        { id: 'size', type: 'range', label: '크기', min: 12, max: 240, step: 1, default: 72 },
        { id: 'weight', type: 'select', label: '굵기', options: [['400', '보통'], ['700', '굵게'], ['900', '아주 굵게']], default: '700' },
        { id: 'color', type: 'color', label: '색', default: '#ffffff' },
        { id: 'pos', type: 'select', label: '세로 위치', options: [['top', '위'], ['middle', '가운데'], ['bottom', '아래']], default: 'middle' },
        { id: 'align', type: 'select', label: '정렬', options: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], default: 'center' },
        { id: 'pad', type: 'range', label: '여백', min: 0, max: 200, step: 1, default: 64 },
        { id: 'shadow', type: 'check', label: '그림자', default: true },
        { id: 'band', type: 'check', label: '어두운 띠 깔기', default: false },
      ],
      run: async (inp, p) => {
        const src = inp.img, c = canvasOf(src.width, src.height), g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        const text = inp.text != null && String(inp.text).trim() ? cleanAI(inp.text) : p.text;
        if (!text) return { img: c };
        const pad = +p.pad, size = +p.size;
        const L = Scene.layoutText(text, { size, fontWeight: +p.weight, fontFamily: Scene.DEFAULT_FONT, lineHeight: 1.25, width: Math.max(10, c.width - pad * 2) });
        const y0 = p.pos === 'top' ? pad : p.pos === 'bottom' ? c.height - pad - L.h : (c.height - L.h) / 2;
        if (p.band) {
          g.fillStyle = 'rgba(0,0,0,.45)';
          g.fillRect(0, y0 - pad / 2, c.width, L.h + pad);
        }
        g.font = L.font;
        g.fillStyle = p.color;
        g.textAlign = p.align;
        g.textBaseline = 'alphabetic';
        if (p.shadow) {
          g.shadowColor = 'rgba(0,0,0,.45)';
          g.shadowBlur = size * 0.25;
          g.shadowOffsetY = size * 0.06;
        }
        const x = p.align === 'left' ? pad : p.align === 'right' ? c.width - pad : c.width / 2;
        L.lines.forEach((ln, i) => g.fillText(ln, x, y0 + i * L.lh + L.baseline));
        return { img: c };
      },
    },
    composite: {
      cat: '이미지', label: '이미지 합성', desc: '바탕 이미지 위에 다른 이미지를 겹칩니다.',
      inputs: [{ id: 'base', type: 'image', label: '바탕' }, { id: 'over', type: 'image', label: '위에 얹을 이미지' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'x', type: 'range', label: '가로 위치 (%)', min: 0, max: 100, step: 1, default: 50 },
        { id: 'y', type: 'range', label: '세로 위치 (%)', min: 0, max: 100, step: 1, default: 50 },
        { id: 'scale', type: 'range', label: '크기 (바탕 너비 %)', min: 5, max: 150, step: 1, default: 50 },
        { id: 'opacity', type: 'range', label: '불투명도 (%)', min: 0, max: 100, step: 1, default: 100 },
        { id: 'blend', type: 'select', label: '혼합', options: [['source-over', '보통'], ['multiply', '곱하기'], ['screen', '스크린'], ['overlay', '오버레이'], ['soft-light', '소프트 라이트']], default: 'source-over' },
      ],
      run: async (inp, p) => {
        const a = inp.base, b = inp.over, c = canvasOf(a.width, a.height), g = c.getContext('2d');
        g.drawImage(a, 0, 0);
        const w = a.width * p.scale / 100, h = w * b.height / b.width;
        g.globalAlpha = p.opacity / 100;
        g.globalCompositeOperation = p.blend;
        g.drawImage(b, a.width * p.x / 100 - w / 2, a.height * p.y / 100 - h / 2, w, h);
        return { img: c };
      },
    },
    frameGrab: {
      cat: '동영상', label: '프레임 추출', desc: '동영상의 원하는 시점을 이미지로 꺼냅니다.',
      inputs: [{ id: 'video', type: 'video', label: '동영상' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [{ id: 't', type: 'number', label: '시점 (초)', default: 1, step: 0.1 }],
      run: async (inp, p) => {
        const v = inp.video.el;
        await seek(v, clamp(+p.t || 0, 0, Math.max(0, v.duration - 0.05)));
        const c = canvasOf(v.videoWidth, v.videoHeight);
        c.getContext('2d').drawImage(v, 0, 0);
        return { img: c };
      },
    },
    contactSheet: {
      cat: '동영상', label: '썸네일 시트', desc: '동영상 전체에서 고르게 장면을 뽑아 한 장에 모읍니다.',
      inputs: [{ id: 'video', type: 'video', label: '동영상' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'count', type: 'range', label: '장면 수', min: 2, max: 24, step: 1, default: 9 },
        { id: 'cols', type: 'range', label: '열 수', min: 1, max: 8, step: 1, default: 3 },
        { id: 'tw', type: 'number', label: '장면 너비', default: 360 },
      ],
      run: async (inp, p) => {
        const v = inp.video.el, n = +p.count, cols = Math.min(+p.cols, n), rows = Math.ceil(n / cols);
        const tw = clamp(+p.tw || 360, 40, 1920), th = tw * v.videoHeight / v.videoWidth, gap = 8;
        const c = canvasOf(cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap), g = c.getContext('2d');
        g.fillStyle = '#111';
        g.fillRect(0, 0, c.width, c.height);
        for (let i = 0; i < n; i++) {
          await seek(v, (i + 0.5) * v.duration / n);
          g.drawImage(v, gap + (i % cols) * (tw + gap), gap + Math.floor(i / cols) * (th + gap), tw, th);
        }
        return { img: c };
      },
    },
    waveform: {
      cat: '오디오', label: '파형 그림', desc: '소리의 파형을 이미지로 그립니다.',
      inputs: [{ id: 'audio', type: 'audio', label: '오디오' }],
      outputs: [{ id: 'img', type: 'image', label: '이미지' }],
      params: [
        { id: 'w', type: 'number', label: '너비', default: 1200 }, { id: 'h', type: 'number', label: '높이', default: 300 },
        { id: 'color', type: 'color', label: '파형 색', default: '#7B61FF' }, { id: 'bg', type: 'color', label: '배경', default: '#14121F' },
      ],
      run: async (inp, p) => {
        const buf = inp.audio.buffer, w = clamp(+p.w || 1200, 10, 6000), h = clamp(+p.h || 300, 10, 3000);
        const c = canvasOf(w, h), g = c.getContext('2d');
        g.fillStyle = p.bg;
        g.fillRect(0, 0, w, h);
        const chans = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
        const step = Math.max(1, Math.floor(buf.length / w));
        g.fillStyle = p.color;
        for (let x = 0; x < w; x++) {
          let min = 1, max = -1;
          for (let i = x * step; i < Math.min(buf.length, (x + 1) * step); i++) {
            let s = 0;
            for (const d of chans) s += d[i];
            s /= chans.length;
            if (s < min) min = s;
            if (s > max) max = s;
          }
          if (max < min) continue;
          g.fillRect(x, (1 - max) * h / 2, 1, Math.max(1, (max - min) * h / 2));
        }
        return { img: c };
      },
    },
    audioTrim: {
      cat: '오디오', label: '오디오 자르기', desc: '구간을 잘라 내고 음량과 페이드를 조절합니다.',
      inputs: [{ id: 'audio', type: 'audio', label: '오디오' }],
      outputs: [{ id: 'audio', type: 'audio', label: '오디오' }],
      params: [
        { id: 'start', type: 'number', label: '시작 (초)', default: 0, step: 0.1 }, { id: 'end', type: 'number', label: '끝 (초, 0이면 끝까지)', default: 0, step: 0.1 },
        { id: 'fadeIn', type: 'number', label: '페이드 인 (초)', default: 0, step: 0.1 }, { id: 'fadeOut', type: 'number', label: '페이드 아웃 (초)', default: 0, step: 0.1 },
        { id: 'gain', type: 'range', label: '음량 (%)', min: 0, max: 200, step: 1, default: 100 },
      ],
      run: async (inp, p) => {
        const src = inp.audio.buffer, sr = src.sampleRate, dur = src.duration;
        const s = clamp(+p.start || 0, 0, dur), e = +p.end > 0 ? clamp(+p.end, s, dur) : dur;
        const len = Math.max(1, Math.round((e - s) * sr));
        const out = new AudioBuffer({ length: len, numberOfChannels: src.numberOfChannels, sampleRate: sr });
        const fi = Math.round((+p.fadeIn || 0) * sr), fo = Math.round((+p.fadeOut || 0) * sr), gain = p.gain / 100, off = Math.round(s * sr);
        for (let ch = 0; ch < src.numberOfChannels; ch++) {
          const a = src.getChannelData(ch), b = out.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            let k = gain;
            if (fi && i < fi) k *= i / fi;
            if (fo && i > len - fo) k *= (len - i) / fo;
            b[i] = (a[off + i] || 0) * k;
          }
        }
        return { audio: { buffer: out, name: inp.audio.name } };
      },
    },
    output: {
      cat: '내보내기', label: '결과 보기·저장', desc: '연결한 결과를 크게 보고 파일로 저장합니다.',
      inputs: [{ id: 'in', type: 'any', label: '결과' }],
      outputs: [],
      params: [{ id: 'name', type: 'text', label: '파일 이름', default: '결과' }],
      run: async inp => ({ value: inp.in }),
    },
    toDesign: {
      cat: '내보내기', label: 'Draftboard로 보내기', desc: '이미지를 Draftboard 파일의 새 레이어로 넣습니다.',
      inputs: [{ id: 'img', type: 'image', label: '이미지' }],
      outputs: [],
      params: [{ id: 'fileId', type: 'dbfile', label: '보낼 파일', allowNew: true }],
      run: async inp => ({ value: inp.img }),
    },
  };

  // ---------- graph state ----------
  let graph = null;
  const results = new Map();
  const runtime = new Map();
  let selected = null, version = 0, running = false, rerun = false;

  const defaults = type => Object.fromEntries((NODES[type].params || []).map(p => [p.id, p.default ?? '']));
  const nid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nodeById = id => graph.nodes.find(n => n.id === id);

  function exampleGraph() {
    const n = (type, x, y, params = {}) => ({ id: nid(), type, x, y, params: { ...defaults(type), ...params } });
    const text = n('textIn', 40, 40, { text: '새로 문을 연 동네 빵집. 매일 아침 구운 소금빵이 대표 메뉴입니다.' });
    const llm = n('llm', 330, 30, { prompt: '다음 가게 소개를 바탕으로 포스터에 넣을 짧고 매력적인 문구를 20자 이내 한 문장으로 만들어 주세요. 문구만 출력하세요.' });
    const bg = n('gradient', 40, 330, { c1: '#FFB347', c2: '#FF5E62', angle: 135 });
    const over = n('textOverlay', 640, 250, { text: '갓 구운 소금빵, 오늘 아침에도', size: 88, weight: '900' });
    const filt = n('filter', 330, 360, { saturate: 120 });
    const out = n('output', 940, 260, { name: '빵집 포스터' });
    const e = (a, ap, b, bp) => ({ id: nid(), from: [a.id, ap], to: [b.id, bp] });
    return {
      id: 'default', name: '내 작업 흐름', view: { x: 40, y: 40, z: 1 },
      nodes: [text, llm, bg, filt, over, out],
      edges: [e(text, 'text', llm, 'text'), e(bg, 'img', filt, 'img'), e(filt, 'img', over, 'img'), e(llm, 'text', over, 'text'), e(over, 'img', out, 'in')],
    };
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Store.put('weave', graph).catch(e => toast('저장하지 못했습니다: ' + e.message)), 500);
  }

  // ---------- palette ----------
  function renderPalette() {
    const cats = {};
    for (const [type, def] of Object.entries(NODES)) (cats[def.cat] = cats[def.cat] || []).push([type, def]);
    $('#palette').innerHTML = Object.entries(cats).map(([cat, list]) =>
      `<h4>${esc(cat)}</h4>${list.map(([type, def]) => {
        const t = (def.outputs[0] || def.inputs[0] || { type: 'any' }).type;
        return `<button class="pal-item" data-add="${type}" draggable="true" title="${esc(def.desc)}"><i style="background:${COLORS[t]}"></i>${esc(def.label)}</button>`;
      }).join('')}`).join('')
      + '<p class="hint" style="margin:14px 4px 0">노드를 눌러 추가하고, 오른쪽 점에서 다른 노드의 왼쪽 점으로 끌어 연결하세요. 연결선을 누르면 끊어집니다.</p>';
  }

  function addNode(type, x, y) {
    const n = { id: nid(), type, x: Math.round(x), y: Math.round(y), params: defaults(type) };
    graph.nodes.push(n);
    selected = n.id;
    renderGraph();
    renderInspector();
    save();
    return n;
  }

  $('#palette').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const r = graphEl.getBoundingClientRect(), v = graph.view;
    addNode(b.dataset.add, (r.width / 2 - 110 - v.x) / v.z + (Math.random() * 40 - 20), (r.height / 2 - 80 - v.y) / v.z + (Math.random() * 40 - 20));
  });
  $('#palette').addEventListener('dragstart', e => {
    const b = e.target.closest('[data-add]');
    if (b) e.dataTransfer.setData('text/x-node', b.dataset.add);
  });
  graphEl.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-node')) e.preventDefault(); });
  graphEl.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/x-node');
    if (!type) return;
    e.preventDefault();
    const r = graphEl.getBoundingClientRect(), v = graph.view;
    addNode(type, (e.clientX - r.left - v.x) / v.z - 20, (e.clientY - r.top - v.y) / v.z - 16);
  });

  // ---------- graph rendering ----------
  // Zoom and centre so every node is visible
  function fitView() {
    const r = graphEl.getBoundingClientRect();
    const els = [...inner.querySelectorAll('.wnode')];
    if (!els.length || !r.width) { graph.view = { x: 40, y: 40, z: 1 }; applyView(); return; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of els) {
      const n = nodeById(el.dataset.node);
      x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
      x2 = Math.max(x2, n.x + el.offsetWidth); y2 = Math.max(y2, n.y + Math.max(el.offsetHeight, 240));
    }
    const z = clamp(Math.min((r.width - 60) / (x2 - x1), (r.height - 60) / (y2 - y1)), 0.35, 1);
    graph.view = { x: Math.round((r.width - (x2 - x1) * z) / 2 - x1 * z), y: Math.round(30 - y1 * z), z };
    applyView();
    renderWires();
  }

  function applyView() {
    const v = graph.view;
    inner.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    graphEl.style.backgroundPosition = `${v.x}px ${v.y}px`;
    graphEl.style.backgroundSize = `${20 * v.z}px ${20 * v.z}px`;
  }

  function previewHTML(id) {
    const r = results.get(id);
    if (!r) return '';
    if (r.error) return `<div class="wn-err">${esc(r.error)}</div>`;
    const val = outputValue(id);
    if (val == null) return r.state === 'running' && r.live ? `<div class="wn-preview"><div class="txt">${esc(r.live)}</div></div>` : '';
    if (val instanceof HTMLCanvasElement) return '<div class="wn-preview" data-canvas="1"></div>';
    if (typeof val === 'string') return `<div class="wn-preview"><div class="txt">${esc(val.slice(0, 240)) || '(빈 텍스트)'}</div></div>`;
    if (val.buffer) return `<div class="wn-preview"><div class="txt">🔊 ${val.buffer.duration.toFixed(1)}초 · ${(val.buffer.sampleRate / 1000).toFixed(1)}kHz · ${val.buffer.numberOfChannels}채널</div></div>`;
    if (val.el) return `<div class="wn-preview"><div class="txt">🎬 ${val.duration.toFixed(1)}초 · ${val.w}×${val.h}</div></div>`;
    return '';
  }

  function stateLabel(id) {
    const r = results.get(id);
    if (!r) return '';
    return { running: '실행 중…', done: '완료', error: '오류', idle: '입력 대기' }[r.state] || '';
  }

  function nodeHTML(n) {
    const def = NODES[n.type], r = results.get(n.id) || {};
    const head = (def.outputs[0] || def.inputs[0] || { type: 'any' }).type;
    const ins = (def.inputs || []).map(p => `<div class="wn-port in" data-port="in:${p.id}" data-type="${p.type}"><span class="wn-dot" style="background:${COLORS[p.type]}"></span>${esc(p.label)}${p.optional ? ' <span class="muted">(선택)</span>' : ''}</div>`).join('');
    const outs = def.outputs.map(p => `<div class="wn-port out" data-port="out:${p.id}" data-type="${p.type}">${esc(p.label)}<span class="wn-dot" style="background:${COLORS[p.type]}"></span></div>`).join('');
    return `<div class="wnode${selected === n.id ? ' sel' : ''}${r.state ? ' ' + r.state : ''}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px">
      <div class="wn-head"><i style="background:${COLORS[head]}"></i>${esc(def.label)}<span class="wn-state">${stateLabel(n.id)}</span></div>
      <div class="wn-body">${ins || outs ? `<div class="wn-ports"><div>${ins}</div><div>${outs}</div></div>` : ''}${previewHTML(n.id)}</div>
    </div>`;
  }

  function drawPreviewCanvas(id) {
    const host = inner.querySelector(`[data-node="${id}"] [data-canvas]`);
    const r = results.get(id), node = nodeById(id);
    if (!host || !r || !r.outputs) return;
    const def = NODES[node.type];
    const src = def.outputs.length ? r.outputs[def.outputs[0].id] : r.outputs.value;
    if (!(src instanceof HTMLCanvasElement)) return;
    const k = Math.min(1, 400 / src.width);
    const c = canvasOf(src.width * k, src.height * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    host.appendChild(c);
  }

  function renderGraph() {
    applyView();
    inner.querySelectorAll('.wnode').forEach(x => x.remove());
    inner.insertAdjacentHTML('beforeend', graph.nodes.map(nodeHTML).join(''));
    graph.nodes.forEach(n => drawPreviewCanvas(n.id));
    renderWires();
  }

  function updateNode(id) {
    const n = nodeById(id);
    const el = inner.querySelector(`[data-node="${id}"]`);
    if (!n || !el) return;
    el.outerHTML = nodeHTML(n);
    drawPreviewCanvas(id);
    renderWires();
  }

  function portPoint(nodeId, port) {
    const dot = inner.querySelector(`[data-node="${nodeId}"] [data-port="${port}"] .wn-dot`);
    if (!dot) return null;
    const r = dot.getBoundingClientRect(), base = inner.getBoundingClientRect(), z = graph.view.z;
    return [(r.left + r.width / 2 - base.left) / z, (r.top + r.height / 2 - base.top) / z];
  }

  const curve = (a, b) => {
    const k = Math.max(40, Math.abs(b[0] - a[0]) / 2);
    return `M${a[0]} ${a[1]}C${a[0] + k} ${a[1]} ${b[0] - k} ${b[1]} ${b[0]} ${b[1]}`;
  };

  let tempWire = null;
  function renderWires() {
    let h = '';
    for (const e of graph.edges) {
      const a = portPoint(e.from[0], 'out:' + e.from[1]), b = portPoint(e.to[0], 'in:' + e.to[1]);
      if (a && b) h += `<path d="${curve(a, b)}" data-edge="${e.id}"><title>클릭하면 연결을 끊습니다</title></path>`;
    }
    if (tempWire) h += `<path class="temp" d="${curve(tempWire.a, tempWire.b)}"/>`;
    wires.innerHTML = h;
  }

  // ---------- interaction ----------
  let drag = null;
  const toGraph = e => {
    const r = graphEl.getBoundingClientRect(), v = graph.view;
    return [(e.clientX - r.left - v.x) / v.z, (e.clientY - r.top - v.y) / v.z];
  };

  graphEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const edge = e.target.closest('[data-edge]');
    if (edge) {
      graph.edges = graph.edges.filter(x => x.id !== edge.dataset.edge);
      renderWires();
      save();
      schedule();
      return;
    }
    const dot = e.target.closest('.wn-dot');
    const nodeEl = e.target.closest('.wnode');
    if (dot) {
      const port = dot.closest('.wn-port'), nodeId = port.closest('.wnode').dataset.node;
      let [kind, pid] = port.dataset.port.split(':');
      let from = nodeId;
      if (kind === 'in') {
        // dragging from an input picks up its existing connection
        const ex = graph.edges.find(x => x.to[0] === nodeId && x.to[1] === pid);
        if (!ex) return;
        graph.edges = graph.edges.filter(x => x !== ex);
        from = ex.from[0];
        pid = ex.from[1];
        save();
        schedule();
      }
      const def = NODES[nodeById(from).type];
      drag = { type: 'wire', from, port: pid, ptype: def.outputs.find(o => o.id === pid).type };
      tempWire = { a: portPoint(from, 'out:' + pid), b: toGraph(e) };
      graphEl.setPointerCapture(e.pointerId);
      renderWires();
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.node;
      if (selected !== id) {
        selected = id;
        inner.querySelectorAll('.wnode').forEach(x => x.classList.toggle('sel', x.dataset.node === id));
        renderInspector();
      }
      if (e.target.closest('.wn-head')) {
        const n = nodeById(id);
        drag = { type: 'node', id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y };
        graphEl.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (selected) {
      selected = null;
      inner.querySelectorAll('.wnode.sel').forEach(x => x.classList.remove('sel'));
      renderInspector();
    }
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, x: graph.view.x, y: graph.view.y };
    graphEl.classList.add('panning');
    graphEl.setPointerCapture(e.pointerId);
  });

  graphEl.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.type === 'pan') {
      graph.view.x = drag.x + e.clientX - drag.sx;
      graph.view.y = drag.y + e.clientY - drag.sy;
      applyView();
    } else if (drag.type === 'node') {
      const n = nodeById(drag.id), z = graph.view.z;
      n.x = Math.round(drag.x + (e.clientX - drag.sx) / z);
      n.y = Math.round(drag.y + (e.clientY - drag.sy) / z);
      const el = inner.querySelector(`[data-node="${n.id}"]`);
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      renderWires();
    } else if (drag.type === 'wire') {
      tempWire.b = toGraph(e);
      renderWires();
    }
  });

  function wouldCycle(from, to) {
    const seen = new Set(), stack = [to];
    while (stack.length) {
      const id = stack.pop();
      if (id === from) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      graph.edges.filter(x => x.from[0] === id).forEach(x => stack.push(x.to[0]));
    }
    return false;
  }

  graphEl.addEventListener('pointerup', e => {
    const d = drag;
    drag = null;
    graphEl.classList.remove('panning');
    if (!d) return;
    if (d.type === 'wire') {
      tempWire = null;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const port = el && el.closest('.wn-port.in');
      if (port) {
        const to = port.closest('.wnode').dataset.node, pid = port.dataset.port.split(':')[1], ptype = port.dataset.type;
        if (to === d.from) toast('같은 노드끼리는 연결할 수 없습니다.');
        else if (ptype !== 'any' && ptype !== d.ptype) toast(`${TYPE_LABEL[d.ptype]} 출력은 ${TYPE_LABEL[ptype]} 입력에 연결할 수 없습니다.`);
        else if (wouldCycle(d.from, to)) toast('순환 연결은 만들 수 없습니다.');
        else {
          graph.edges = graph.edges.filter(x => !(x.to[0] === to && x.to[1] === pid));
          graph.edges.push({ id: nid(), from: [d.from, d.port], to: [to, pid] });
          schedule();
        }
      }
      renderWires();
    }
    save();
  });

  graphEl.addEventListener('wheel', e => {
    e.preventDefault();
    const v = graph.view;
    if (e.ctrlKey || e.metaKey) {
      const r = graphEl.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const z = clamp(v.z * Math.exp(-e.deltaY * 0.01), 0.25, 2.5);
      v.x = sx - (sx - v.x) * z / v.z;
      v.y = sy - (sy - v.y) * z / v.z;
      v.z = z;
      applyView();
      renderWires();
    } else {
      v.x -= e.deltaX;
      v.y -= e.deltaY;
      applyView();
    }
    save();
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      removeNode(selected);
    }
  });

  function removeNode(id) {
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.edges = graph.edges.filter(x => x.from[0] !== id && x.to[0] !== id);
    results.delete(id);
    runtime.delete(id);
    if (selected === id) selected = null;
    renderGraph();
    renderInspector();
    save();
    schedule();
  }

  // ---------- inspector ----------
  async function paramField(n, p) {
    const v = n.params[p.id];
    const lab = `<label>${esc(p.label)}</label>`;
    switch (p.type) {
      case 'textarea': return `<div class="prm">${lab}<textarea class="input" rows="${p.rows || 4}" data-param="${p.id}">${esc(v)}</textarea></div>`;
      case 'text': return `<div class="prm">${lab}<input class="input" data-param="${p.id}" value="${esc(v)}"></div>`;
      case 'number': return `<div class="prm">${lab}<input class="input" type="number" step="${p.step || 1}" data-param="${p.id}" value="${esc(v)}"></div>`;
      case 'range': return `<div class="prm">${lab}<div class="rng"><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" data-param="${p.id}" value="${esc(v)}"><output>${esc(v)}</output></div></div>`;
      case 'color': return `<div class="prm">${lab}<input class="input" type="color" style="padding:2px;height:34px" data-param="${p.id}" value="${esc(v)}"></div>`;
      case 'check': return `<div class="prm"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-param="${p.id}"${v ? ' checked' : ''}> ${esc(p.label)}</label></div>`;
      case 'select': return `<div class="prm">${lab}<select class="input" data-param="${p.id}">${p.options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      case 'image': case 'video': case 'audio': {
        const name = n.params.fileName || (p.type === 'image' && v ? '선택한 이미지' : '');
        const missing = (p.type !== 'image' && n.params.fileName && !(runtime.get(n.id) || {}).url && !(runtime.get(n.id) || {}).buffer);
        return `<div class="prm">${lab}<div style="display:flex;gap:8px;align-items:center"><button class="btn sm" data-pick="${p.type}">${name ? '바꾸기' : '파일 선택'}</button><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name || '선택한 파일 없음')}${missing ? ' — 다시 선택 필요' : ''}</span></div></div>`;
      }
      case 'model': {
        const list = await models();
        const opts = (p.vision ? list.filter(LocalAI.hasVision) : list).map(m => [m.name, m.name]);
        return `<div class="prm">${lab}<select class="input" data-param="${p.id}"><option value="">자동 선택</option>${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${!list.length ? '<p class="hint">로컬 AI(Ollama)에 연결되지 않았습니다.</p>' : (p.vision && !opts.length ? '<p class="hint">비전 모델이 없습니다. 예: <code>ollama pull llava</code></p>' : '')}</div>`;
      }
      case 'dbfile': {
        const list = await files();
        return `<div class="prm">${lab}<select class="input" data-param="${p.id}"><option value="">${p.allowNew ? '새 디자인 파일 만들기' : '파일 선택…'}</option>${list.map(f => `<option value="${f.id}"${f.id === v ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>`;
      }
      case 'dbframe': {
        let opts = [];
        if (n.params.fileId) {
          const f = await Store.loadFile(n.params.fileId);
          if (f) {
            const parents = Scene.frameParents(f.doc.nodes);
            opts = f.doc.nodes.filter(x => x.type === 'frame' && !parents.has(x.id)).map(x => [x.id, x.name]);
          }
        }
        return `<div class="prm">${lab}<select class="input" data-param="${p.id}"><option value="">첫 번째 프레임</option>${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      }
    }
    return '';
  }

  function outputValue(id) {
    const r = results.get(id), n = nodeById(id);
    if (!r || !r.outputs || !n) return null;
    const def = NODES[n.type];
    return def.outputs.length ? r.outputs[def.outputs[0].id] : r.outputs.value;
  }

  async function renderInspector() {
    const n = selected && nodeById(selected);
    if (!n) {
      insp.innerHTML = `<h3>미디어 플로</h3><p class="desc">왼쪽에서 노드를 추가하고 점끼리 이어 작업 흐름을 만드세요. 노드를 누르면 여기에서 설정을 바꿀 수 있습니다.</p>
        <p class="hint">AI 노드는 이 컴퓨터의 Ollama 모델을 씁니다. 인터넷이나 유료 API를 쓰지 않습니다.</p>
        <p class="hint">노드 ${graph.nodes.length}개 · 연결 ${graph.edges.length}개</p>`;
      return;
    }
    const def = NODES[n.type];
    const token = (renderInspector.token = (renderInspector.token || 0) + 1);
    const fields = (await Promise.all((def.params || []).map(p => paramField(n, p)))).join('');
    if (token !== renderInspector.token) return;
    const r = results.get(n.id);
    insp.innerHTML = `<h3>${esc(def.label)}</h3><p class="desc">${esc(def.desc)}</p>${fields}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn sm" data-act="rerun">이 노드 다시 실행</button>
        <button class="btn sm danger" data-act="delete">노드 삭제</button>
      </div>
      <div class="out-preview" id="out-preview">${r && r.error ? `<p class="wn-err">${esc(r.error)}</p>` : ''}</div>`;
    const box = $('#out-preview');
    const val = outputValue(n.id);
    if (val instanceof HTMLCanvasElement) {
      const c = canvasOf(val.width, val.height);
      c.getContext('2d').drawImage(val, 0, 0);
      box.insertAdjacentHTML('beforeend', `<p class="hint">${val.width} × ${val.height}px</p>`);
      box.insertBefore(c, box.firstChild);
      box.insertAdjacentHTML('beforeend', `<div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" data-act="png">PNG 저장</button><button class="btn sm" data-act="jpg">JPG 저장</button>${n.type === 'toDesign' ? '<button class="btn sm primary" data-act="send">Draftboard로 보내기</button>' : ''}</div>`);
    } else if (typeof val === 'string') {
      box.insertAdjacentHTML('beforeend', `<pre>${esc(val)}</pre><div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" data-act="copy">복사</button><button class="btn sm" data-act="txt">TXT 저장</button></div>`);
    } else if (val && val.buffer) {
      const url = URL.createObjectURL(wav(val.buffer));
      box.insertAdjacentHTML('beforeend', `<audio controls src="${url}"></audio><div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" data-act="wav">WAV 저장</button></div>`);
    } else if (val && val.el) {
      box.insertAdjacentHTML('beforeend', `<video controls src="${val.url}" style="width:100%"></video>`);
    } else if (r && r.state === 'idle') {
      box.insertAdjacentHTML('beforeend', '<p class="hint">필요한 입력을 연결하면 결과가 여기에 표시됩니다.</p>');
    } else if (!r) {
      box.insertAdjacentHTML('beforeend', '<p class="hint">▶ 실행을 누르면 결과가 여기에 표시됩니다.</p>');
    }
  }

  function setParam(key, value) {
    const n = nodeById(selected);
    if (!n) return;
    n.params[key] = value;
    save();
    schedule(true);
  }

  insp.addEventListener('input', e => {
    const t = e.target;
    if (!t.dataset.param) return;
    if (t.type === 'range') {
      t.nextElementSibling.textContent = t.value;
      setParam(t.dataset.param, +t.value);
    }
  });
  insp.addEventListener('change', e => {
    const t = e.target, key = t.dataset.param;
    if (!key || t.type === 'range') return;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
    setParam(key, v);
    if (key === 'fileId') { const n = nodeById(selected); if (n.params.frameId !== undefined) n.params.frameId = ''; renderInspector(); }
  });

  const mediaInput = $('#media-input');
  insp.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const n = nodeById(selected);
    if (!n) return;
    if (b.dataset.pick) {
      const kind = b.dataset.pick;
      mediaInput.accept = `${kind}/*`;
      mediaInput.onchange = async () => {
        const f = mediaInput.files[0];
        mediaInput.value = '';
        if (!f) return;
        try {
          if (kind === 'image') n.params.file = await fileToDataURL(f);
          else if (kind === 'video') {
            const old = runtime.get(n.id);
            if (old && old.url) URL.revokeObjectURL(old.url);
            runtime.set(n.id, { url: URL.createObjectURL(f) });
          } else {
            const buffer = await actx().decodeAudioData(await f.arrayBuffer());
            runtime.set(n.id, { buffer });
          }
          n.params.fileName = f.name;
          invalidate(n.id);
          save();
          renderInspector();
          schedule(true);
        } catch (err) { toast('파일을 읽지 못했습니다: ' + err.message); }
      };
      mediaInput.click();
      return;
    }
    const act = b.dataset.act, val = outputValue(n.id), name = (n.params.name || NODES[n.type].label).replace(/[\\/:*?"<>|]/g, '_');
    if (act === 'delete') return removeNode(n.id);
    if (act === 'rerun') { invalidate(n.id); return schedule(true); }
    if (act === 'png' || act === 'jpg') {
      val.toBlob(blob => download(blob, `${name}.${act}`), act === 'png' ? 'image/png' : 'image/jpeg', 0.92);
    }
    if (act === 'copy') navigator.clipboard.writeText(val).then(() => toast('복사했습니다.'));
    if (act === 'txt') download(new Blob([val], { type: 'text/plain' }), `${name}.txt`);
    if (act === 'wav') download(wav(val.buffer), `${name}.wav`);
    if (act === 'send') sendToDesign(n, val);
  });

  async function sendToDesign(n, canvas) {
    const data = canvas.toDataURL('image/png');
    let f = n.params.fileId ? await Store.loadFile(n.params.fileId) : null;
    const now = Date.now();
    let meta, doc;
    if (f) { meta = f.meta; doc = f.doc; }
    else {
      const id = Store.newId();
      meta = { id, name: '미디어 플로 결과', kind: 'design', thumb: '', createdAt: now, updatedAt: now };
      doc = { version: 2, kind: 'design', name: meta.name, bg: '#F5F5F5', nextId: 1, nodes: [], slideOrder: [], protoStart: null };
    }
    let maxId = 0;
    Scene.walk(doc.nodes, x => { maxId = Math.max(maxId, parseInt(String(x.id).slice(1), 10) || 0); });
    doc.nextId = Math.max(doc.nextId || 1, maxId + 1);
    const right = doc.nodes.length ? Math.max(...doc.nodes.map(x => { const b = Scene.bbox(x); return b.x + b.w; })) + 120 : 0;
    const k = Math.min(1, 1200 / Math.max(canvas.width, canvas.height));
    const aid = 'a' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    doc.nodes.push({
      id: 'n' + doc.nextId++, type: 'image', name: n.params.name || '미디어 플로 이미지', x: Math.round(right), y: 0,
      w: Math.round(canvas.width * k), h: Math.round(canvas.height * k), asset: aid, fit: 'cover', radius: 0,
      opacity: 1, visible: true, locked: false, rotation: 0, stroke: null, strokeWidth: 1, effects: null, fill: null,
    });
    meta.updatedAt = now;
    await Store.saveFile(meta, doc, [[aid, data]]);
    fileCache = null;
    toast(`‘${meta.name}’에 이미지를 넣었습니다.`);
    if (!n.params.fileId) { n.params.fileId = meta.id; save(); renderInspector(); }
    if (confirm('Draftboard 파일을 새 탭에서 열까요?')) window.open(`editor.html?file=${meta.id}`, '_blank');
  }

  // ---------- execution ----------
  // Each node keeps its outputs until its parameters or inputs change.
  function keyFor(n, inputVersions) {
    const p = { ...n.params };
    if (typeof p.file === 'string' && p.file.length > 200) p.file = p.file.length + ':' + p.file.slice(-64);
    return JSON.stringify([n.type, p, inputVersions]);
  }

  function invalidate(id) {
    const r = results.get(id);
    if (r) r.key = null;
  }

  function setPreviewText(id, text) {
    const r = results.get(id);
    if (!r) return;
    r.live = text;
    const host = inner.querySelector(`[data-node="${id}"] .wn-body`);
    if (!host) return;
    let box = host.querySelector('.wn-preview');
    if (!box) { host.insertAdjacentHTML('beforeend', '<div class="wn-preview"><div class="txt"></div></div>'); box = host.querySelector('.wn-preview'); }
    const t = box.querySelector('.txt');
    if (t) t.textContent = text.slice(-240);
  }

  function topo() {
    const indeg = new Map(graph.nodes.map(n => [n.id, 0]));
    graph.edges.forEach(e => indeg.set(e.to[0], (indeg.get(e.to[0]) || 0) + 1));
    const q = graph.nodes.filter(n => !indeg.get(n.id)).map(n => n.id), out = [];
    while (q.length) {
      const id = q.shift();
      out.push(id);
      graph.edges.filter(e => e.from[0] === id).forEach(e => {
        indeg.set(e.to[0], indeg.get(e.to[0]) - 1);
        if (!indeg.get(e.to[0])) q.push(e.to[0]);
      });
    }
    return out;
  }

  async function run(skipAI = false) {
    if (running) { rerun = true; return; }
    running = true;
    const t0 = performance.now();
    let count = 0, errors = 0, waitingAI = 0;
    $('#run-status').textContent = '실행 중…';
    try {
      for (const id of topo()) {
        const n = nodeById(id);
        if (!n) continue;
        const def = NODES[n.type];
        const inputs = {}, versions = {};
        let missing = false, upstreamError = false;
        for (const p of def.inputs || []) {
          const e = graph.edges.find(x => x.to[0] === id && x.to[1] === p.id);
          const src = e && results.get(e.from[0]);
          if (src && src.state === 'error') upstreamError = true;
          if (src && src.outputs && src.outputs[e.from[1]] != null) {
            inputs[p.id] = src.outputs[e.from[1]];
            versions[p.id] = src.version;
          } else if (!p.optional) missing = true;
        }
        const key = keyFor(n, versions);
        const prev = results.get(id);
        if (prev && prev.key === key && prev.state === 'done') continue;
        if (missing) {
          results.set(id, { state: upstreamError ? 'error' : 'idle', error: upstreamError ? '앞 단계에서 오류가 났습니다.' : null, key: null, outputs: null, version: ++version });
          updateNode(id);
          continue;
        }
        const isAI = n.type === 'llm' || n.type === 'vision';
        if (isAI && skipAI && prev && prev.key !== key) {
          waitingAI++;
          results.set(id, { ...prev, state: 'idle', key: null });
          updateNode(id);
          continue;
        }
        results.set(id, { state: 'running', key: null, outputs: null, version: prev ? prev.version : 0 });
        updateNode(id);
        try {
          const outputs = await def.run(inputs, n.params, n);
          results.set(id, { state: 'done', key, outputs, version: ++version });
          count++;
        } catch (err) {
          results.set(id, { state: 'error', key: null, error: err.message, outputs: null, version: ++version });
          errors++;
        }
        updateNode(id);
        if (selected === id) renderInspector();
      }
    } finally {
      running = false;
      const ms = Math.round(performance.now() - t0);
      $('#run-status').textContent = errors ? `오류 ${errors}개` : waitingAI ? `AI 노드는 ▶ 실행으로 갱신` : count ? `${count}개 노드 실행 · ${ms}ms` : '최신 상태';
      if (selected) renderInspector();
      if (rerun) { rerun = false; run(true); }
    }
  }

  let schedTimer = null;
  function schedule(fromEdit) {
    if (!$('#auto-run').checked) return;
    clearTimeout(schedTimer);
    schedTimer = setTimeout(() => run(true), fromEdit ? 350 : 0);
  }

  $('#run-btn').addEventListener('click', () => run(false));
  $('#example-btn').addEventListener('click', () => {
    if (graph.nodes.length && !confirm('지금 작업 흐름을 예제로 바꿀까요?')) return;
    graph = exampleGraph();
    results.clear();
    runtime.clear();
    selected = null;
    renderGraph();
    fitView();
    renderInspector();
    save();
    run(true);
  });
  $('#clear-btn').addEventListener('click', () => {
    if (!confirm('모든 노드를 지울까요?')) return;
    graph.nodes = [];
    graph.edges = [];
    results.clear();
    runtime.clear();
    selected = null;
    renderGraph();
    renderInspector();
    save();
  });
  window.addEventListener('resize', renderWires);

  // ---------- start ----------
  (async () => {
    renderPalette();
    try { graph = await Store.get('weave', 'default'); } catch (e) { graph = null; }
    const fresh = !graph || !Array.isArray(graph.nodes);
    if (fresh) graph = exampleGraph();
    graph.view = graph.view || { x: 40, y: 40, z: 1 };
    graph.nodes = graph.nodes.filter(n => NODES[n.type]);
    renderGraph();
    if (fresh) fitView();
    renderInspector();
    run(true);
  })();
})();
