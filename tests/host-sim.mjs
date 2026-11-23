import { afterEach } from 'node:test';
// Minimal simulated SillyTavern host for running the BUILT script (dist/plot-injector.js) end-to-end.
// Simulates: SillyTavern.getContext (chat, chatMetadata, eventSource, eventTypes), /api/files via fetch,
// TavernHelper-less button wiring, and a fake AutoCardUpdaterAPI with the OFFICIAL shujuku public API only (spv8.9.2).
// Every LLM request goes through fetch to a URL we count, so "no extra model calls" is checkable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import YAML from 'yaml';

const testWindows = new Set();
afterEach(async()=>{for(const w of testWindows){try{await w.__plotInjector?.destroy();}finally{w.close();}}testWindows.clear();});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createHost({ tables = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window; testWindows.add(w);
  // jsdom window lacks a few globals real browsers have.
  for (const k of ['TextEncoder', 'TextDecoder', 'AbortController', 'structuredClone']) if (!w[k]) w[k] = globalThis[k];
  const files = new Map();
  const llmCalls = [];
  const llm = { reply: null };
  const listeners = new Map();
  const eventTypes = {
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', CHAT_CHANGED: 'chat_id_changed', MESSAGE_RECEIVED: 'message_received',
    MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped',
    GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped',
    CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  };
  const eventSource = {
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); },
    removeListener(name, fn) { const l = listeners.get(name) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    async emit(name, ...args) { for (const fn of [...(listeners.get(name) || [])]) await fn(...args); },
    count(name) { return (listeners.get(name) || []).length; },
  };
  const state = {
    chat: [], chatMetadata: {}, chatId: 'chat-1', saves: 0, server: {}, saveFails: false,
  };
  const ctxObj = {
    get chat() { return state.chat; },
    get chatMetadata() { return state.chatMetadata; },
    characterId: 0,
    characters: [{ avatar: 'card.png', name: '测试卡' }],
    eventSource, eventTypes,
    getCurrentChatId: () => state.chatId,
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    saveMetadataDebounced: () => { state.saves++; },
    // Real ST saveMetadata swallows errors and timeouts; the server copy is what /api/chats/get returns.
    saveMetadata: async () => { state.saves++; if (!state.saveFails) state.server = JSON.parse(JSON.stringify(state.chatMetadata)); },
    getTokenCountAsync: async (t) => Math.ceil(String(t).length / 2),
    // "tavern" LLM source goes through generateRaw — count it as a model call.
    // llmReply: tests can set host.llm.reply to control what the model returns (default: an outline-check JSON).
    // llm.respond(body): optional per-request script (may throw to simulate a failure); takes precedence over llm.reply.
    generateRaw: async (args) => { const body = JSON.stringify(args); llmCalls.push({ url: 'generateRaw', body, args }); if (llm.respond) return llm.respond(body); return llm.reply ?? '{"done":[],"stageDone":false,"offTrack":false,"reason":"未演完"}'; },
  };
  w.SillyTavern = { getContext: () => ctxObj, libs: { yaml: YAML } };
  const toasts = [];
  w.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map((k) => [k, (msg) => { toasts.push({ type: k, msg: String(msg) }); }]));
  w.fetch = async (url, init = {}) => {
    const u = String(url);
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (u.startsWith('/user/files/')) {
      const name = decodeURIComponent(u.slice('/user/files/'.length).split('?')[0]);
      return files.has(name) ? ok(files.get(name)) : ok('not found', 404);
    }
    if (u === '/api/files/upload') {
      const body = JSON.parse(init.body);
      const name = body.name || path.basename(body.path || '');
      files.set(name, Buffer.from(body.data, 'base64').toString('utf8'));
      return ok({ path: `user/files/${name}` });
    }
    if (u === '/api/files/delete') { files.delete(path.basename(JSON.parse(init.body).path)); return ok({}); }
    if (u === '/api/files/verify') return ok({});
    // ST /api/chats/get: whole chat file, element 0 is the header with chat_metadata
    if (u === '/api/chats/get' || u === '/api/chats/group/get') return ok([{ chat_metadata: JSON.parse(JSON.stringify(state.server)), user_name: 'unused', character_name: 'unused' }, ...state.chat]);
    llmCalls.push({ url: u, body: init.body });
    return ok({ choices: [{ message: { content: '{}' } }] });
  };

  // Fake database API: tables snapshot, official table-update callbacks, CRUD / SQL / template APIs.
  const tableCallbacks = [];
  let currentTables = JSON.parse(JSON.stringify(tables));
  const api = {
    exportTableAsJson: () => currentTables,
    registerTableUpdateCallback: (fn) => { if (!tableCallbacks.includes(fn)) tableCallbacks.push(fn); },
    unregisterTableUpdateCallback: (fn) => { const i = tableCallbacks.indexOf(fn); if (i >= 0) tableCallbacks.splice(i, 1); },
    fillStartCallbacks: [],
    registerTableFillStartCallback: (fn) => { api.fillStartCallbacks.includes(fn) || api.fillStartCallbacks.push(fn); },
    unregisterTableFillStartCallback: (fn) => { const i = api.fillStartCallbacks.indexOf(fn); if (i >= 0) api.fillStartCallbacks.splice(i, 1); },
    // Official deleteRow (spv8.9.2 table-crud-api): ({tableName, rowIndex}), rowIndex is the content index (1 = first row);
    // returns a boolean. Writes a manual_crud log entry with operations [{kind:'row_delete', sheetKey, rowId}] on the latest
    // AI floor that carries a frame (else the latest AI floor).
    deleted: [],
    deleteRow: async (a, b) => {
      const tableName = typeof a === 'object' ? a.tableName : a, rowIndex = typeof a === 'object' ? a.rowIndex : b;
      if (api.deleteFails) return false;
      const entry = Object.entries(currentTables).find(([, s]) => s && s.name === tableName);
      if (!entry || rowIndex < 1 || !entry[1].content[rowIndex]) return false;
      const [sheetKey, sheet] = entry, rowId = sheet.content[rowIndex][0];
      let target = -1;
      for (let i = state.chat.length - 1; i >= 0; i--) if (state.chat[i] && !state.chat[i].is_user) { if (target < 0) target = i; if (state.chat[i].TavernDB_ACU_IsolatedData) { target = i; break; } }
      if (target < 0) return false;
      sheet.content.splice(rowIndex, 1);
      const msg = state.chat[target];
      const iso = msg.TavernDB_ACU_IsolatedData || (msg.TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, logEntries: [] } } });
      const frame = iso[''].storageFrame || (iso[''].storageFrame = { version: 2, logEntries: [] });
      frame.logEntries.push({ seq: frame.logEntries.length + 1, source: 'manual_crud', targetMessageIndex: target, filledSheetKeys: [], changedSheetKeys: [sheetKey], operations: rowId != null ? [{ kind: 'row_delete', sheetKey, rowId }] : [] });
      api.deleted.push({ tableName, rowId, floor: target });
      return true;
    },
    // Official insertRow semantics: (tableName, {列名: 值}) or ({tableName, data}); appends a row; unknown column → -1 (SQLite rejects).
    insertRow: async (a, b) => {
      const tableName = typeof a === 'object' ? a.tableName : a, data = typeof a === 'object' ? a.data : b;
      const sheet = Object.values(currentTables).find((s) => s && s.name === tableName);
      if (!sheet) return -1;
      const head = sheet.content[0];
      if (Object.keys(data).some((k) => !head.includes(k))) return -1;
      const row = head.map((h, i) => (i === 0 ? sheet.content.length : (data[h] ?? '')));
      sheet.content.push(row);
      api.inserted.push({ tableName, data });
      return sheet.content.length - 1;
    },
    inserted: [],
    // Official manual fill (spv8.9.2 settings-config-api + handleManualUpdate_ACU): the selection lives in settings;
    // manualUpdate shows a confirm (manualCancel = the user clicked 取消), then deletes the selected sheets' data in the
    // refill range and fills from empty: here every selected sheet becomes header-only, one group_fill entry lists them
    // on the latest AI floor (aiFloor = AI count), and a per-sheet 'manual' checkpoint stores the emptied sheet.
    manualSel: { selectedTables: [], hasManualSelection: false },
    manualCalls: [],
    getManualSelectedTables: () => ({ selectedTables: [...api.manualSel.selectedTables], hasManualSelection: api.manualSel.hasManualSelection }),
    setManualSelectedTables: (keys) => { api.manualSel = { selectedTables: keys.filter((k) => currentTables[k]), hasManualSelection: true }; return true; },
    clearManualSelectedTables: () => { api.manualSel = { selectedTables: [], hasManualSelection: false }; return true; },
    manualUpdate: async () => {
      const keys = [...api.manualSel.selectedTables];
      const call = { keys, insertedBefore: api.inserted.length };
      api.manualCalls.push(call);
      if (api.confirmDelay) await new Promise((r) => setTimeout(r, api.confirmDelay));
      if (api.manualCancel || !keys.length) return;
      // like the real fill, the tables stay readable until it commits
      for (const fn of api.fillStartCallbacks) fn();
      if (api.manualBusy) { api.manualBusy--; for (const fn of tableCallbacks) fn(currentTables); return; }
      let target = -1, n = 0;
      for (let i = 0; i < state.chat.length; i++) if (state.chat[i] && !state.chat[i].is_user) { n++; target = i; }
      if (target < 0) return;
      const msg = state.chat[target];
      const iso = msg.TavernDB_ACU_IsolatedData || (msg.TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, logEntries: [] } } });
      const frame = iso[''].storageFrame || (iso[''].storageFrame = { version: 2, logEntries: [] });
      frame.perSheetCheckpoints = frame.perSheetCheckpoints || {};
      call.insertedBefore = api.inserted.length;
      for (const k of keys) {
        currentTables[k].content = [currentTables[k].content[0]];
        frame.perSheetCheckpoints[k] = { kind: 'sheet_full', reason: 'manual', createdAt: Date.now(), sheetKey: k, data: { content: [currentTables[k].content[0]] } };
      }
      frame.logEntries.push({ seq: frame.logEntries.length + 1, source: 'group_fill', targetMessageIndex: target, aiFloor: n, filledSheetKeys: keys, changedSheetKeys: [], groupKeys: keys });
      for (const fn of tableCallbacks) fn(currentTables);
    },
    // Official updateCell (spv8.9.2 table-crud-api): ({tableName, rowIndex, colIdentifier, value}); rowIndex is the content index.
    updateCell: async (a) => {
      const sheet = Object.values(currentTables).find((s) => s && s.name === a.tableName);
      if (!sheet || !sheet.content[a.rowIndex]) return false;
      const c = sheet.content[0].indexOf(a.colIdentifier);
      if (c < 1) return false;
      sheet.content[a.rowIndex][c] = a.value; api.updated.push({ ...a });
      if (!a.skipNotify) for (const fn of tableCallbacks) fn(currentTables);
      return true;
    },
    // Official updateRow (spv8.9.2): (tableName, rowIndex, {列名: 值}); rowIndex is the content index (0 = header).
    updateRow: async (tableName, rowIndex, data) => {
      const sheet = Object.values(currentTables).find((s) => s && s.name === tableName);
      if (!sheet || rowIndex < 1 || !sheet.content[rowIndex]) return false;
      for (const [k, v] of Object.entries(data || {})) { const c = sheet.content[0].indexOf(k); if (c >= 1) sheet.content[rowIndex][c] = v; }
      api.updated.push({ tableName, rowIndex, row: { ...data } });
      return true;
    },
    updated: [],
    // Official SQL API (spv8.9.2 sql-api.ts), minimal: only `UPDATE <表> SET <列> = ?[, <列> = ?] WHERE <列> = ?` with display
    // names (the real one rebinds them to physical names). querySql exists only in SQLite mode once the runtime is ready
    // (installRuntimeGatedSqlReadApi_ACU); tests set api.sqlite = false to simulate native storage.
    // api.beforeSql(sql, params): optional async hook run before each mutation (tests interleave reorders / chat switches here).
    sqlite: true,
    sqlCalls: [],
    executeSqlMutation: async (sql, params = []) => {
      if (api.beforeSql) await api.beforeSql(sql, params);
      if (sql && typeof sql === 'object') ({ sql, params = [] } = sql);
      api.sqlCalls.push({ sql, params: [...params], chat: state.chatId });
      if (api.sqlFails) return { changes: 0, errors: [api.sqlFails] };
      const del = /^DELETE FROM (\S+) WHERE row_id = \? AND (\S+) = \?$/.exec(sql);
      if (del) {
        const sheet = Object.values(currentTables).find((s) => s && s.name === del[1]);
        if (!sheet) return { changes: 0, errors: [`no such table: ${del[1]}`] };
        const c = sheet.content[0].indexOf(del[2]);
        if (c < 1) return { changes: 0, errors: ['no such column'] };
        const before = sheet.content.length;
        sheet.content = [sheet.content[0], ...sheet.content.slice(1).filter((r) => !(String(r[0]) === String(params[0]) && String(r[c]) === String(params[1])))];
        let target = -1;
        for (let i = state.chat.length - 1; i >= 0; i--) if (state.chat[i] && !state.chat[i].is_user) { target = i; break; }
        return { changes: before - sheet.content.length, errors: [], saved: true, messageIndex: target };
      }
      // WHERE 可以是一个或几个「列 = ?」用 AND 连起来
      const m = /^UPDATE (\S+) SET (.+?) WHERE (\S+ = \?(?: AND \S+ = \?)*)$/.exec(sql);
      if (!m) return { changes: 0, errors: ['unsupported sql in host-sim'] };
      const sheet = Object.values(currentTables).find((s) => s && s.name === m[1]);
      if (!sheet) return { changes: 0, errors: [`no such table: ${m[1]}`] };
      const head = sheet.content[0], sets = m[2].split(',').map((x) => x.trim().replace(/ = \?$/, '')), wheres = m[3].split(' AND ').map((x) => head.indexOf(x.replace(/ = \?$/, '')));
      if (wheres.some((w) => w < 1) || sets.some((c) => head.indexOf(c) < 1)) return { changes: 0, errors: ['no such column'] };
      let changes = 0;
      for (const row of sheet.content.slice(1)) if (wheres.every((w, k) => String(row[w]) === String(params[sets.length + k]))) { sets.forEach((c, i) => { row[head.indexOf(c)] = params[i]; }); changes++; }
      return { changes, errors: [], saved: true, messageIndex: -1 };
    },
    // Official template API (spv8.9.2 template-preset-api): getTableTemplate returns the chat template object
    // (headers + rules, no runtime rows); importTemplateFromData(tpl, {scope:'chat', dataMode:'seed'}) reconciles:
    // new sheets are introduced; existing sheets get sourceData/updateConfig/exportConfig and appended columns;
    // runtime rows are kept; template data rows land only in sheets whose runtime content is header-only.
    templateCalls: [],
    // Real-ST observation (spv8.9.2): getTableTemplate returns the chat template as it was imported, INCLUDING the
    // template's own data rows (e.g. prebuilt fact rows), not the runtime progress. Simulated as: header + the rows
    // recorded at import time (templateRows), never the live cell values.
    templateRows: {},
    getTableTemplate: () => {
      if (api.templateUnavailable) return null;
      const t = JSON.parse(JSON.stringify(currentTables));
      for (const [k, s] of Object.entries(t)) if (k.startsWith('sheet_')) { s.content = [s.content[0], ...(api.templateRows[s.name] || [])]; delete s.seedRows; }
      return t;
    },
    importTemplateFromData: async (tpl, options = {}) => {
      api.templateCalls.push({ tpl: JSON.parse(JSON.stringify(tpl)), options: { ...options } });
      if (api.importFails) return { success: false, message: api.importFails };
      const next = JSON.parse(JSON.stringify(currentTables));
      for (const [k, s] of Object.entries(tpl)) {
        if (!k.startsWith('sheet_')) { next[k] = JSON.parse(JSON.stringify(s)); continue; }
        const have = Object.entries(next).find(([, x]) => x && x.name === s.name);
        if (s.content.length > 1 && !api.templateRows[s.name]) api.templateRows[s.name] = JSON.parse(JSON.stringify(s.content.slice(1)));
        if (!have) { next[k] = JSON.parse(JSON.stringify(s)); next[k].content = next[k].content.map((r, i) => (i === 0 ? r : [i, ...r.slice(1)])); continue; }
        const cur = have[1];
        const extra = s.content[0].slice(cur.content[0].length);
        cur.content[0] = [...cur.content[0], ...extra];
        for (const row of cur.content.slice(1)) row.push(...extra.map(() => ''));
        cur.sourceData = JSON.parse(JSON.stringify(s.sourceData)); cur.updateConfig = JSON.parse(JSON.stringify(s.updateConfig)); cur.exportConfig = JSON.parse(JSON.stringify(s.exportConfig));
        if (cur.content.length === 1 && s.content.length > 1) cur.content.push(...s.content.slice(1).map((r, i) => [i + 1, ...r.slice(1)]));
      }
      // Real SQLite mode (2026-11-22 tavern): right after a chat-template import the runtime may not have the new sheets yet;
      // they show up after refreshDataAndWorldbook (unless refreshNoop) or reveal().
      if (api.hideNew) {
        api.pending = Object.fromEntries(Object.entries(next).filter(([k]) => !currentTables[k]));
        for (const k of Object.keys(api.pending)) delete next[k];
      }
      currentTables = next;
      for (const fn of tableCallbacks) fn(currentTables);
      return { success: true, scope: options.scope, dataMode: options.dataMode, runtimeReady: true };
    },
    pending: null,
    // Official plot preset API (spv8.9.2 plot-preset-api): presets are global; the binding is per chat (one chat here).
    // importPlotPresetFromData(data, {overwrite}) replaces by name or adds "name (1)"; switchPlotPreset binds this chat.
    plotPresets: {},
    plotBinding: '',
    plotImports: 0,
    getCurrentPlotPreset: () => api.plotBinding,
    getPlotPresetDetails: (n) => (api.plotPresets[n] ? JSON.parse(JSON.stringify(api.plotPresets[n])) : null),
    importPlotPresetFromData: async (data, o = {}) => {
      let name = data.name;
      if (api.plotPresets[name] && !o.overwrite) { let i = 1; while (api.plotPresets[`${data.name} (${i})`]) i++; name = `${data.name} (${i})`; }
      api.plotPresets[name] = { ...JSON.parse(JSON.stringify(data)), name }; api.plotImports++;
      if (o.switchTo) api.plotBinding = name;
      return { success: true, presetName: name };
    },
    switchPlotPreset: (n) => (api.plotPresets[n] ? ((api.plotBinding = n), true) : false),
    refreshCalls: 0,
    refreshDataAndWorldbook: async () => {
      api.refreshCalls++;
      if (!api.refreshNoop) api.reveal();
      return true;
    },
    reveal: () => {
      if (!api.pending) return;
      Object.assign(currentTables, api.pending); api.pending = null;
      for (const fn of tableCallbacks) fn(currentTables);
    },
  };
  Object.defineProperty(api, 'querySql', { enumerable: true, get: () => (api.sqlite ? () => ({ columns: [], rows: [] }) : undefined) });
  w.AutoCardUpdaterAPI = api;

  const db = {
    setTables(next) { currentTables = JSON.parse(JSON.stringify(next)); for (const fn of tableCallbacks) fn(currentTables); },
    get tables() { return currentTables; },
    tableCallbackCount: () => tableCallbacks.length,
    // Official V2 per-floor fill record (TavernDB_ACU_IsolatedData[''].storageFrame.logEntries): marks that the fill
    // committed these sheet keys on that AI floor. error: simulate a failed group.
    markFill(messageIndex, sheetKeys, { error = '', source = 'group_fill' } = {}) {
      const msg = state.chat[messageIndex];
      const iso = msg.TavernDB_ACU_IsolatedData || (msg.TavernDB_ACU_IsolatedData = { '': { storageFrame: { version: 2, logEntries: [] } } });
      iso[''].storageFrame.logEntries.push({ seq: iso[''].storageFrame.logEntries.length + 1, source, targetMessageIndex: messageIndex, filledSheetKeys: sheetKeys, changedSheetKeys: sheetKeys, groupKeys: sheetKeys, ...(error ? { error } : {}) });
    },
  };

  // code: optional script source (e.g. the v0.1.13 baseline, for rollback tests); default is the built dist.
  function load(code = fs.readFileSync(path.join(root, 'dist', 'plot-injector.js'), 'utf8')) {
    w.eval(code);
    return w.__plotInjector;
  }
  // Simulates SillyTavern assembling world info for a generation; returns the injected virtual entries.
  async function worldInfo() {
    const payload = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    await eventSource.emit(eventTypes.WORLDINFO_ENTRIES_LOADED, payload);
    return payload.chatLore;
  }
  async function addMessage(mes, isUser) {
    state.chat.push({ mes, is_user: isUser, name: isUser ? 'user' : '测试卡', send_date: `t${state.chat.length}`, swipe_id: 0, swipes: [mes] });
    if (!isUser) await eventSource.emit(eventTypes.MESSAGE_RECEIVED, state.chat.length - 1);
  }
  // Simulates the final chat-completion request being assembled (after world info + plot injection).
  async function promptReady(chat) {
    await eventSource.emit(eventTypes.CHAT_COMPLETION_PROMPT_READY, { chat, dryRun: false });
  }
  async function generate(type = 'normal') {
    await eventSource.emit(eventTypes.GENERATION_STARTED, type, {}, false);
    const lore = await worldInfo();
    await eventSource.emit(eventTypes.GENERATION_ENDED);
    return lore;
  }
  // Full "send" as the real host does it: user message → GENERATION_STARTED → world info → reply → GENERATION_ENDED.
  // Returns { lore, text } where text is the clue content that actually reached the request via world info.
  async function send(userInput, { reply = null } = {}) {
    await addMessage(userInput, true);
    await eventSource.emit(eventTypes.GENERATION_STARTED, 'normal', {}, false);
    const lore = await worldInfo();
    if (reply != null) await addMessage(reply, false);
    await eventSource.emit(eventTypes.GENERATION_ENDED);
    return { lore, text: lore.map((e) => e.content).join('\n') };
  }
  return { w, dom, state, ctx: ctxObj, eventSource, eventTypes, files, llmCalls, llm, db, load, worldInfo, addMessage, generate, send, promptReady, toasts,
    settle: () => new Promise((r) => setTimeout(r, 30)) };
}
