'use strict';
/* Store — Draftboard files in IndexedDB.
   meta: { id, name, kind, thumb, createdAt, updatedAt }
   docs: { id, doc }            assets: { key: "<fileId>/<assetId>", data: dataURL }
   kv: small settings           make / weave: projects of the AI builder and media flow */
window.Store = (() => {
  const DB_NAME = 'draftboard', VERSION = 1, LEGACY_KEY = 'draftboard.doc.v1';
  let dbp = null;

  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          if (!d.objectStoreNames.contains('make')) d.createObjectStore('make', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('weave')) d.createObjectStore('weave', { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    return dbp;
  }

  const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const done = t => new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error || new Error('저장 공간에 쓰지 못했습니다.'));
  });
  const range = id => IDBKeyRange.bound(id + '/', id + '/￿');

  const newId = (p = 'f') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // assets: [[assetId, dataURL], ...] — only the ones not stored yet
  async function saveFile(meta, doc, assets = []) {
    const t = (await db()).transaction(['meta', 'docs', 'assets'], 'readwrite');
    t.objectStore('meta').put(meta);
    t.objectStore('docs').put({ id: meta.id, doc });
    const as = t.objectStore('assets');
    for (const [aid, data] of assets) as.put({ key: `${meta.id}/${aid}`, data });
    return done(t);
  }

  async function loadFile(id) {
    const t = (await db()).transaction(['meta', 'docs', 'assets']);
    const [meta, rec, assets] = await Promise.all([
      req(t.objectStore('meta').get(id)),
      req(t.objectStore('docs').get(id)),
      req(t.objectStore('assets').getAll(range(id))),
    ]);
    if (!meta || !rec) return null;
    return { meta, doc: rec.doc, assets: assets.map(a => [a.key.slice(id.length + 1), a.data]) };
  }

  async function list() {
    const all = await req((await db()).transaction('meta').objectStore('meta').getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function getMeta(id) {
    return req((await db()).transaction('meta').objectStore('meta').get(id));
  }

  async function putMeta(meta) {
    const t = (await db()).transaction('meta', 'readwrite');
    t.objectStore('meta').put(meta);
    return done(t);
  }

  async function remove(id) {
    const t = (await db()).transaction(['meta', 'docs', 'assets'], 'readwrite');
    t.objectStore('meta').delete(id);
    t.objectStore('docs').delete(id);
    t.objectStore('assets').delete(range(id));
    return done(t);
  }

  async function removeAssets(id, assetIds) {
    if (!assetIds.length) return;
    const t = (await db()).transaction('assets', 'readwrite');
    for (const a of assetIds) t.objectStore('assets').delete(`${id}/${a}`);
    return done(t);
  }

  async function kvGet(key) {
    return req((await db()).transaction('kv').objectStore('kv').get(key));
  }

  async function kvSet(key, value) {
    const t = (await db()).transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    return done(t);
  }

  async function getAll(store) {
    return req((await db()).transaction(store).objectStore(store).getAll());
  }
  async function get(store, id) {
    return req((await db()).transaction(store).objectStore(store).get(id));
  }
  async function put(store, value) {
    const t = (await db()).transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    return done(t);
  }
  async function del(store, id) {
    const t = (await db()).transaction(store, 'readwrite');
    t.objectStore(store).delete(id);
    return done(t);
  }

  // Version-1 documents kept image data inline; move it into the asset list.
  function fromLegacy(old) {
    const assets = [];
    const nodes = (old.nodes || []).map(n => {
      const c = { ...n };
      if (c.type === 'image' && c.src) {
        const aid = 'a' + assets.length.toString(36) + Math.random().toString(36).slice(2, 6);
        assets.push([aid, c.src]);
        c.asset = aid;
        delete c.src;
      }
      if (c.type === 'text') { c.lineHeight = c.lineHeight || 1.2; c.textMode = c.textMode || 'auto'; c.align = c.align || 'left'; }
      return c;
    });
    return { doc: { ...old, version: 2, nodes }, assets };
  }

  // Import a file exported from the editor (or an older single-document save)
  async function importJSON(text) {
    const data = JSON.parse(text);
    let doc, assets, kind = 'design', name;
    if (data && data.format === 'draftboard') {
      doc = data.doc;
      assets = Object.entries(data.assets || {});
      kind = (data.meta && data.meta.kind) || doc.kind || 'design';
      name = (data.meta && data.meta.name) || doc.name;
    } else if (data && Array.isArray(data.nodes)) {
      ({ doc, assets } = fromLegacy(data));
      name = doc.name;
    } else {
      throw new Error('Draftboard 파일이 아닙니다.');
    }
    const id = newId(), now = Date.now();
    doc.kind = doc.kind || kind;
    const meta = { id, name: name || '가져온 파일', kind: doc.kind, thumb: '', createdAt: now, updatedAt: now };
    await saveFile(meta, doc, assets);
    return meta;
  }

  async function exportJSON(id) {
    const f = await loadFile(id);
    if (!f) throw new Error('파일을 찾을 수 없습니다.');
    return JSON.stringify({ format: 'draftboard', version: 2, meta: { name: f.meta.name, kind: f.meta.kind }, doc: f.doc, assets: Object.fromEntries(f.assets) });
  }

  // Every file in one object, for backups and for moving files between addresses
  async function exportAll() {
    const files = [];
    for (const m of await list()) {
      const f = await loadFile(m.id);
      if (f) files.push({ meta: f.meta, doc: f.doc, assets: Object.fromEntries(f.assets) });
    }
    return { format: 'draftboard-backup', version: 1, exportedAt: Date.now(), files };
  }

  // Adds files keeping their ids, so bringing the same files over twice updates them
  // instead of making copies. A copy that is newer than the incoming one is kept.
  async function importFiles(files) {
    let added = 0, updated = 0, skipped = 0;
    for (const f of files || []) {
      if (!f || !f.meta || !f.meta.id || !f.doc || !Array.isArray(f.doc.nodes)) continue;
      const cur = await getMeta(f.meta.id);
      if (cur && cur.updatedAt > f.meta.updatedAt) { skipped++; continue; }
      await saveFile(f.meta, f.doc, Object.entries(f.assets || {}));
      if (cur) updated++; else added++;
    }
    return { added, updated, skipped };
  }

  // A single exported file is added as a new copy; a backup restores all of its files.
  async function importText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON 파일을 읽지 못했습니다.'); }
    if (data && data.format === 'draftboard-backup' && Array.isArray(data.files)) {
      return { backup: true, ...(await importFiles(data.files)) };
    }
    return { backup: false, meta: await importJSON(text) };
  }

  async function duplicate(id) {
    const f = await loadFile(id);
    if (!f) throw new Error('파일을 찾을 수 없습니다.');
    const nid = newId(), now = Date.now();
    const meta = { ...f.meta, id: nid, name: f.meta.name + ' 사본', createdAt: now, updatedAt: now };
    const doc = { ...f.doc, name: meta.name };
    await saveFile(meta, doc, f.assets);
    return meta;
  }

  // Bring over the document saved by the first single-file version of the editor.
  async function migrateLegacy() {
    try {
      if (await kvGet('legacyMigrated')) return null;
      const raw = localStorage.getItem(LEGACY_KEY);
      await kvSet('legacyMigrated', true);
      if (!raw) return null;
      const old = JSON.parse(raw);
      if (!old || !Array.isArray(old.nodes) || !old.nodes.length) return null;
      const { doc, assets } = fromLegacy(old);
      doc.kind = 'design';
      const id = newId(), now = Date.now();
      const meta = { id, name: doc.name || '제목 없음', kind: 'design', thumb: '', createdAt: now, updatedAt: now };
      await saveFile(meta, doc, assets);
      return meta;
    } catch (e) {
      return null;
    }
  }

  async function usage() {
    try { return await navigator.storage.estimate(); } catch (e) { return null; }
  }

  return {
    newId, saveFile, loadFile, list, getMeta, putMeta, remove, removeAssets,
    kvGet, kvSet, getAll, get, put, del, importJSON, importText, importFiles, exportAll, exportJSON, duplicate, migrateLegacy, usage,
  };
})();
