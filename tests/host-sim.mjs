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
    chat: [], chatMetadata: {}, chatId: 'chat-1', saves: 0,
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
    saveMetadata: async () => { state.saves++; },
    getTokenCountAsync: async (t) => Math.ceil(String(t).length / 2),
    // "tavern" LLM source goes through generateRaw — count it as a model call.
    // llmReply: tests can set host.llm.reply to control what the model returns (default: an outline-check JSON).
    // llm.respond(body): optional per-request script (may throw to simulate a failure); takes precedence over llm.reply.
    generateRaw: async (args) => { const body = JSON.stringify(args); llmCalls.push({ url: 'generateRaw', body, args }); if (llm.respond) return llm.respond(body); return llm.reply ?? '{"done":[],"stageDone":false,"offTrack":false,"reason":"未演完"}'; },
  };
  w.SillyTavern = { getContext: () => ctxObj, libs: { yaml: YAML } };
  w.toastr = { info() {}, success() {}, warning() {}, error() {} };
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
      api.sqlCalls.push({ sql, params: [...params], chat: state.chatId });
      if (api.sqlFails) return { changes: 0, errors: [api.sqlFails] };
      const m = /^UPDATE (\S+) SET (.+) WHERE (\S+) = \?$/.exec(sql);
      if (!m) return { changes: 0, errors: ['unsupported sql in host-sim'] };
      const sheet = Object.values(currentTables).find((s) => s && s.name === m[1]);
      if (!sheet) return { changes: 0, errors: [`no such table: ${m[1]}`] };
      const head = sheet.content[0], sets = m[2].split(',').map((x) => x.trim().replace(/ = \?$/, '')), where = head.indexOf(m[3]);
      if (where < 1 || sets.some((c) => head.indexOf(c) < 1)) return { changes: 0, errors: ['no such column'] };
      let changes = 0;
      for (const row of sheet.content.slice(1)) if (String(row[where]) === String(params[sets.length])) { sets.forEach((c, i) => { row[head.indexOf(c)] = params[i]; }); changes++; }
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
      currentTables = next;
      for (const fn of tableCallbacks) fn(currentTables);
      return { success: true, scope: options.scope, dataMode: options.dataMode, runtimeReady: true };
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
  return { w, dom, state, ctx: ctxObj, eventSource, eventTypes, files, llmCalls, llm, db, load, worldInfo, addMessage, generate, send, promptReady,
    settle: () => new Promise((r) => setTimeout(r, 30)) };
}
