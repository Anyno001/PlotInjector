// PlotInjector v0.2.1
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: !0 });
  };

  // src/core/yaml.js
  var lib = null;
  function setYamlLib(value) {
    lib = value || null;
  }
  function getYamlLib() {
    if (!lib) throw new Error("YAML 解析库未就绪");
    return lib;
  }
  function parseYaml(text2) {
    return getYamlLib().parse(String(text2 || ""));
  }
  function stringifyYaml(value) {
    return getYamlLib().stringify(value, { indent: 2, lineWidth: 0, minContentWidth: 0 });
  }
  function yamlErrorLine(error) {
    let pos = error && error.linePos && error.linePos[0];
    if (pos && pos.line) return pos.line;
    let match = /line (\d+)/i.exec(String(error && error.message || ""));
    return match ? Number(match[1]) : 0;
  }

  // src/host/st.js
  function hostWindow() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) return window.parent;
    } catch {
    }
    return window;
  }
  function hostDocument() {
    return hostWindow().document;
  }
  function ctx() {
    let st9 = hostWindow().SillyTavern;
    return st9 && typeof st9.getContext == "function" ? st9.getContext() : st9 || null;
  }
  function libs() {
    let st9 = hostWindow().SillyTavern;
    return st9 && st9.libs || {};
  }
  function helper() {
    let w = hostWindow();
    return typeof TavernHelper < "u" ? TavernHelper : w.TavernHelper || null;
  }
  function requestHeaders() {
    let c = ctx();
    if (!c || typeof c.getRequestHeaders != "function") throw new Error("酒馆连接尚未就绪");
    return c.getRequestHeaders();
  }
  function toast(kind, message, title2 = "剧情注入器") {
    let t = hostWindow().toastr;
    t && typeof t[kind] == "function" ? t[kind](message, title2) : console.info(`[剧情注入器] ${message}`);
  }
  function cardKey() {
    let c = ctx();
    if (!c) return "";
    if (c.groupId) return `group:${c.groupId}`;
    let card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    return card && card.avatar ? `char:${card.avatar}` : "";
  }
  function cardName() {
    let c = ctx();
    if (!c) return "";
    if (c.groupId && Array.isArray(c.groups)) {
      let group = c.groups.find((item) => item.id === c.groupId);
      return group ? group.name : "群聊";
    }
    let card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    return card ? card.name : "";
  }
  function chatMessages() {
    let c = ctx();
    return c && Array.isArray(c.chat) ? c.chat : [];
  }
  async function countTokens(text2) {
    let c = ctx();
    try {
      if (c && typeof c.getTokenCountAsync == "function") return await c.getTokenCountAsync(String(text2 || ""));
    } catch {
    }
    return null;
  }
  function downloadBlob(name, data, type = "application/json") {
    let doc = hostDocument(), view = hostWindow(), url = view.URL.createObjectURL(new view.Blob([data], { type })), anchor = doc.createElement("a");
    anchor.href = url, anchor.download = name, doc.body.appendChild(anchor), anchor.click(), anchor.remove(), view.setTimeout(() => view.URL.revokeObjectURL(url), 2e3);
  }

  // src/host/files.js
  var fetchFn = () => hostWindow().fetch.bind(hostWindow());
  function utf8Base64(text2) {
    let bytes = new TextEncoder().encode(text2), binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return hostWindow().btoa(binary);
  }
  var filePath = (name) => `user/files/${name}`, READ_TIMEOUT_MS = 2e4;
  async function fetchWithTimeout(url, init) {
    let view = hostWindow(), controller = new view.AbortController(), timer = view.setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      return await fetchFn()(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw error && error.name === "AbortError" ? new Error("读取超时，请检查网络") : error;
    } finally {
      view.clearTimeout(timer);
    }
  }
  async function readJsonFile(name) {
    let res = await fetchWithTimeout(`/${filePath(name)}?t=${Date.now()}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取 ${name} 失败（HTTP ${res.status}）`);
    let text2 = await res.text();
    try {
      return { value: JSON.parse(text2), bytes: new TextEncoder().encode(text2).length };
    } catch {
      throw new Error(`${name} 不是有效 JSON`);
    }
  }
  async function writeJsonFile(name, value) {
    let text2 = JSON.stringify(value), res = await fetchFn()("/api/files/upload", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: utf8Base64(text2) })
    });
    if (!res.ok) throw new Error(`写入 ${name} 失败（HTTP ${res.status}）`);
    return new TextEncoder().encode(text2).length;
  }
  async function deleteFile(name) {
    let res = await fetchFn()("/api/files/delete", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath(name) })
    });
    if (res.status === 404) return !1;
    if (!res.ok) throw new Error(`删除 ${name} 失败（HTTP ${res.status}）`);
    return !0;
  }
  async function verifyFiles(names2) {
    if (!names2.length) return {};
    let res = await fetchFn()("/api/files/verify", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ urls: names2.map(filePath) })
    });
    if (!res.ok) throw new Error(`核对文件失败（HTTP ${res.status}）`);
    let data = await res.json(), out = {};
    for (let name of names2) out[name] = !!data[filePath(name)];
    return out;
  }
  async function readRawFile(name) {
    let res = await fetchFn()(`/${filePath(name)}?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? res.text() : null;
  }
  function createWriter({ delay = 800, write = writeJsonFile, onError = () => {
  }, onSaved = () => {
  } } = {}) {
    let pending = /* @__PURE__ */ new Map(), timers = /* @__PURE__ */ new Map(), running = /* @__PURE__ */ new Map(), view = hostWindow();
    function flushOne(name) {
      if (timers.has(name) && view.clearTimeout(timers.get(name)), timers.delete(name), running.has(name)) return running.get(name);
      if (!pending.has(name)) return Promise.resolve();
      let value = pending.get(name);
      pending.delete(name);
      let job = (async () => {
        try {
          let bytes = await write(name, value);
          onSaved(name, bytes);
        } catch (error) {
          return pending.has(name) || pending.set(name, value), onError(name, error), !1;
        }
        return !0;
      })().then(async (ok) => {
        running.delete(name), ok && pending.has(name) && !timers.has(name) && await flushOne(name);
      });
      return running.set(name, job), job;
    }
    return {
      schedule(name, value) {
        pending.set(name, value), timers.has(name) && view.clearTimeout(timers.get(name)), timers.set(
          name,
          view.setTimeout(() => flushOne(name), delay)
        );
      },
      // 等到所有待写和正在写的都结束（正在写的结束后，期间的新内容也会写完）。
      async flush() {
        for (let timer of timers.values()) view.clearTimeout(timer);
        timers.clear();
        for (let round = 0; round < 5 && (pending.size || running.size); round++) {
          let before = new Set(pending.keys());
          if (await Promise.all([.../* @__PURE__ */ new Set([...pending.keys(), ...running.keys()])].map(flushOne)), [...pending.keys()].every((k) => before.has(k)) && !running.size && pending.size)
            break;
        }
      },
      cancel(name) {
        timers.has(name) && view.clearTimeout(timers.get(name)), timers.delete(name), pending.delete(name);
      },
      hasPending: () => pending.size > 0 || running.size > 0,
      failed: () => [...pending.keys()].filter((name) => !timers.has(name))
    };
  }

  // src/core/clue-model.js
  var PLOT_MODES = [
    { value: "outline", label: "大纲推进" },
    { value: "clue", label: "线索推进" }
  ], CLUE_NODE_KEYS = ["id", "必需", "开放条件", "提前条件", "完成条件", "入口", "场景", "发现", "场景值", "作者备注", "相关事实"], CLUE_STAGE_KEYS = ["进入条件", "结束条件", "作者备注"], AUTHOR_TAG = /<(\/?)仅作者>/g;
  function stripAuthorBlocks(text2) {
    let src = String(text2 || ""), out = "", depth = 0, last = 0, m;
    for (AUTHOR_TAG.lastIndex = 0; m = AUTHOR_TAG.exec(src); )
      depth === 0 && (out += src.slice(last, m.index)), m[1] ? depth = Math.max(0, depth - 1) : depth++, last = AUTHOR_TAG.lastIndex;
    return depth === 0 && (out += src.slice(last)), out.replace(/\n{3,}/g, `

`).trim();
  }
  function authorSegments(text2) {
    let src = String(text2 || ""), segs = [], depth = 0, start = 0, m;
    for (AUTHOR_TAG.lastIndex = 0; m = AUTHOR_TAG.exec(src); )
      if (m[1]) {
        if (depth === 0) continue;
        depth--, depth === 0 && segs.push(src.slice(start, m.index));
      } else depth++ === 0 && (start = AUTHOR_TAG.lastIndex);
    return depth > 0 && segs.push(src.slice(start)), segs.map((x) => x.replace(AUTHOR_TAG, "").trim()).filter(Boolean);
  }
  function wrapAuthorText(text2) {
    let body = String(text2 || "").replace(AUTHOR_TAG, "").trim();
    return body ? `<仅作者>
${body}
</仅作者>` : "";
  }
  function stripAuthorDeep(value) {
    if (typeof value == "string") return hasAuthorBlocks(value) || /<\/仅作者>/.test(value) ? stripAuthorBlocks(value) : value;
    if (Array.isArray(value)) return value.map(stripAuthorDeep);
    if (isPlainObject(value)) {
      let out = {}, own = (o, k) => Object.prototype.hasOwnProperty.call(o, k), exact = new Set(Object.keys(value).filter((k) => !/<\/?仅作者>/.test(k)));
      for (let [k, v] of Object.entries(value)) {
        let key = stripAuthorDeep(k);
        !key || !(k === key) && exact.has(key) || own(out, key) || Object.defineProperty(out, key, { value: stripAuthorDeep(v), enumerable: !0, writable: !0, configurable: !0 });
      }
      return out;
    }
    return value;
  }
  function hasAuthorBlocks(text2) {
    return /<仅作者>/.test(String(text2 || ""));
  }
  function nodeUid(item) {
    return isPlainObject(item) && typeof item.id == "string" && item.id.trim() ? item.id.trim() : "";
  }
  function outlineStageData(data, offIds = null) {
    if (!isPlainObject(data)) return data;
    let out = {}, off = offIds ? new Set(offIds) : null;
    for (let [key, value] of Object.entries(data)) {
      if (CLUE_STAGE_KEYS.includes(key)) continue;
      let meta2 = NODE_FIELDS.find((item) => item.field === key);
      if (!meta2 || !Array.isArray(value)) {
        out[key] = value;
        continue;
      }
      let list = value.filter((item, index) => !off || !off.has(nodeProgressId(item, meta2.prefix, index))).map((item) => {
        if (!isPlainObject(item)) return item;
        let copy = {};
        for (let [k, v] of Object.entries(item)) CLUE_NODE_KEYS.includes(k) || (copy[k] = v);
        let keys = Object.keys(copy);
        return keys.length === 1 && keys[0] === "名称" && typeof copy.名称 == "string" && nodeUid(item) ? copy.名称 : copy;
      });
      off && !list.length || (out[key] = list);
    }
    return out;
  }
  function outlineVolumesView(volumes) {
    let clean = (key, fallback) => stripAuthorDeep(String(key || "")) || fallback;
    return (volumes || []).map((volume, vi) => ({
      ...volume,
      key: clean(volume.key, `剧情_卷${vi + 1}`),
      stages: volume.stages.map((stage, si) => ({
        ...stage,
        key: clean(stage.key, `阶段${si + 1}`),
        data: keepNodeIds(stage.data, stripAuthorDeep(outlineStageData(stage.data)))
      }))
    }));
  }
  function keepNodeIds(raw, view) {
    if (!isPlainObject(raw) || !isPlainObject(view)) return view;
    let out = { ...view };
    for (let { field: field2 } of NODE_FIELDS)
      !Array.isArray(raw[field2]) || !Array.isArray(view[field2]) || (out[field2] = view[field2].map((item, i) => {
        let id = nodeUid(raw[field2][i]);
        return id ? isPlainObject(item) ? { ...item, id } : { 名称: item, id } : item;
      }));
    return out;
  }
  function withNodeIds(volumes, idOf2 = () => makeId("n")) {
    let changed = !1, next = (volumes || []).map((volume) => {
      let volChanged = !1, stages = volume.stages.map((stage) => {
        let data = stage.data, stageChanged = !1;
        if (!isPlainObject(data)) return stage;
        let patch = {};
        for (let { field: field2 } of NODE_FIELDS) {
          if (!Array.isArray(data[field2])) continue;
          let listChanged = !1, list = data[field2].map(
            (item) => isPlainObject(item) && !nodeUid(item) ? (listChanged = !0, { ...item, id: idOf2() }) : item
          );
          listChanged && (patch[field2] = list, stageChanged = !0);
        }
        return stageChanged ? (volChanged = !0, { ...stage, data: { ...data, ...patch } }) : stage;
      });
      return volChanged ? (changed = !0, { ...volume, stages }) : volume;
    });
    return changed ? next : volumes;
  }
  function ensureOutlineIds(volumes, legacyMap, idOf2 = () => makeId("n")) {
    let map = isPlainObject(legacyMap) ? legacyMap : {}, newMap = { ...map }, changed = !1, mapChanged = !1, next = (volumes || []).map((volume) => {
      let volChanged = !1, stages = volume.stages.map((stage) => {
        let data = stage.data;
        if (!isPlainObject(data)) return stage;
        let patch = {}, stageChanged = !1, entries = {};
        for (let { field: field2, prefix } of NODE_FIELDS) {
          if (!Array.isArray(data[field2])) continue;
          let listChanged = !1, list = data[field2].map((item, index) => {
            let old = `${prefix}${index}`;
            if (isPlainObject(item) && nodeUid(item)) return entries[old] = nodeUid(item), item;
            if (item == null || isPlainObject(item) === !1 && typeof item != "string") return item;
            let id = idOf2();
            return listChanged = !0, entries[old] = id, isPlainObject(item) ? { ...item, id } : { 名称: String(item), id };
          });
          listChanged && (patch[field2] = list, stageChanged = !0);
        }
        return stageChanged && !map[stage.id] && (newMap[stage.id] = entries, mapChanged = !0), stageChanged ? (volChanged = !0, { ...stage, data: { ...data, ...patch } }) : stage;
      });
      return volChanged ? (changed = !0, { ...volume, stages }) : volume;
    });
    return { volumes: changed ? next : volumes, legacyMap: mapChanged ? newMap : map, changed: changed || mapChanged };
  }
  function clueNodes(volumes) {
    let out = [];
    for (let unit of flattenUnits(volumes))
      for (let node of stageNodes(unit.stage.data)) out.push({ ...node, uid: nodeUid(node.item), unit });
    return out;
  }
  var NODE_COND_KEYS = ["开放条件", "提前条件", "完成条件"], STAGE_COND_KEYS = ["进入条件", "结束条件"];
  function remapNodeRefs(value, map) {
    if (typeof value == "string") {
      let m = /^(\s*节点\s*[:：]\s*)(\S+)(\s*)$/.exec(value);
      return m && map.has(m[2]) ? `${m[1]}${map.get(m[2])}${m[3]}` : value;
    }
    if (Array.isArray(value)) return value.map((item) => remapNodeRefs(item, map));
    if (isPlainObject(value)) {
      let out = {};
      for (let [k, v] of Object.entries(value))
        out[k] = k === "节点" && typeof v == "string" && map.has(v.trim()) ? map.get(v.trim()) : remapNodeRefs(v, map);
      return out;
    }
    return value;
  }
  function reidConflicts(incoming, existingVolumes) {
    let taken = new Set(
      clueNodes(existingVolumes).map((node) => node.uid).filter(Boolean)
    ), own = clueNodes(incoming).map((node) => node.uid).filter(Boolean), dup = own.find((uid, i) => own.indexOf(uid) !== i);
    if (dup) throw new Error(`导入内容里节点 ID「${dup}」重复，无法确定条件引用指向哪个节点，请先修正`);
    let map = /* @__PURE__ */ new Map();
    for (let uid of own) taken.has(uid) && map.set(uid, makeId("n"));
    if (!map.size) return [incoming, []];
    let fixNode = (item) => {
      if (!isPlainObject(item)) return item;
      let out = { ...item }, uid = nodeUid(item);
      uid && map.has(uid) && (out.id = map.get(uid));
      for (let key of NODE_COND_KEYS) key in out && (out[key] = remapNodeRefs(out[key], map));
      return out;
    };
    return [
      incoming.map((volume) => ({
        ...volume,
        stages: volume.stages.map((stage) => {
          if (!isPlainObject(stage.data)) return stage;
          let data = { ...stage.data };
          for (let key of STAGE_COND_KEYS) key in data && (data[key] = remapNodeRefs(data[key], map));
          for (let { field: field2 } of NODE_FIELDS) Array.isArray(data[field2]) && (data[field2] = data[field2].map(fixNode));
          return { ...stage, data };
        })
      })),
      [...map.keys()]
    ];
  }
  var DEFAULT_CLUE = {
    mode: "outline",
    inject: "worldbook",
    autoFocusSingle: !0,
    bindings: { switch: null, facts: [], knowledge: [], scene: null, time: null },
    facts: []
  };
  function normalizeBinding(value, keys) {
    if (!isPlainObject(value)) return null;
    let out = {};
    for (let key of keys) value[key] !== void 0 && value[key] !== null && value[key] !== "" && (out[key] = value[key]);
    return Object.keys(out).length ? out : null;
  }
  var FACT_BINDING_KEYS = ["表", "编号列", "状态列", "已核实值", "说法值", "内容列", "来源列"], KNOW_BINDING_KEYS = ["表", "事实列", "角色列", "方式列", "可信度列", "已核实值", "来源列", "未知值", "有效值"], CELL_BINDING_KEYS = ["路径", "开启值", "离场值"];
  function normalizeClue(value) {
    let src = isPlainObject(value) ? value : {}, b = isPlainObject(src.bindings) ? src.bindings : {}, list = (v, keys) => (Array.isArray(v) ? v : v ? [v] : []).map((item) => normalizeBinding(item, keys)).filter((item) => item && item.表);
    return {
      mode: PLOT_MODES.some((item) => item.value === src.mode) ? src.mode : DEFAULT_CLUE.mode,
      // inject 只有临时世界书一种（旧项目里的 "link" 也归成它）；旧的 waitFill 不再输出，下次保存时自然消失。
      inject: DEFAULT_CLUE.inject,
      autoFocusSingle: src.autoFocusSingle !== !1,
      // 多线：同时进行的支线最多几条（1 或 2，默认 1）；顶端小条提示开没开（默认开）。
      sideLimit: src.sideLimit === 2 ? 2 : 1,
      lineToast: src.lineToast !== !1,
      bindings: {
        switch: normalizeBinding(b.switch, CELL_BINDING_KEYS),
        facts: list(b.facts, FACT_BINDING_KEYS),
        knowledge: list(b.knowledge, KNOW_BINDING_KEYS),
        scene: normalizeBinding(b.scene, CELL_BINDING_KEYS),
        time: normalizeTimeBinding(b.time)
      },
      facts: (Array.isArray(src.facts) ? src.facts : []).filter((item) => isPlainObject(item) && String(item.id || "").trim()).map((item) => ({ id: String(item.id).trim(), 说明: String(item.说明 || "") })),
      // 事实的标签和登记口径（采用大纲时生成、复审后存下，多线自动补行用）：{ 编号: { label, criterion, sig } }。
      // sig 是生成时依据的内容签名：大纲里这条事实的内容变了，签名对不上，就要重新生成（GPT 七题审阅 §5.1）。
      labels: normalizeLabels(src.labels)
    };
  }
  function normalizeTimeBinding(value) {
    if (!isPlainObject(value)) return null;
    let paths = (Array.isArray(value.路径) ? value.路径 : [value.路径]).map((x) => String(x ?? "").trim()).filter(Boolean);
    return paths.length ? { 路径: paths.length === 1 ? paths[0] : paths } : null;
  }
  function isClueMode(project) {
    return !!(project && project.clue && project.clue.mode === "clue");
  }
  function normalizeLabels(value) {
    let out = {};
    if (!isPlainObject(value)) return out;
    for (let [code, v] of Object.entries(value))
      isPlainObject(v) && String(v.label || "").trim() && (out[code] = { label: String(v.label).trim(), criterion: String(v.criterion || "").trim(), sig: String(v.sig || "") });
    return out;
  }

  // src/core/setting.js
  var HEADING = /^(?:#{1,4}\s*)?([^\s\-*#\[][^:：]{0,30})[:：]\s*$|^(?:#{1,4}\s+)(.{1,30})$|^(\[追加\])\s*$/;
  function splitBlocks(text2) {
    let lines2 = String(text2 || "").replace(
      /\r\n/g,
      `
`
    ).split(`
`), blocks = [], current = { key: "", lines: [] }, counts = {}, depth = 0, closed = !1, lastPublic = "开头", open = (title2, line, flag = {}) => {
      (current.key || current.lines.some((item) => item.trim())) && blocks.push(current), counts[title2] = (counts[title2] || 0) + 1, current = { key: counts[title2] > 1 ? `${title2}#${counts[title2]}` : title2, title: title2, lines: [line], ...flag };
    };
    for (let line of lines2) {
      let match = depth === 0 && !/^\s*<仅作者>/.test(line) && HEADING.exec(line);
      depth === 0 && /^\s*<仅作者>/.test(line) ? open(AUTHOR_BLOCK_TITLE, line, { author: !0 }) : match ? open(lastPublic = (match[1] || match[2] || match[3]).trim(), line) : closed && line.trim() ? open(`${lastPublic}·续`, line, { cont: !0 }) : current.lines.push(line);
      for (let m of line.matchAll(/<(\/?)仅作者>/g)) depth = m[1] ? Math.max(0, depth - 1) : depth + 1;
      closed = !!current.author && depth === 0;
    }
    return (current.key || current.lines.some((item) => item.trim())) && blocks.push(current), blocks.map((block) => ({
      key: block.key || "开头",
      title: block.title || "开头",
      text: block.lines.join(
        `
`
      ).replace(/\n+$/, ""),
      author: !!block.author,
      cont: !!block.cont
    }));
  }
  function joinBlocks(blocks) {
    return blocks.map((block) => block.text).join(`

`).trim();
  }
  function mergeBlocks(oldText, newText, keys) {
    let pick = new Set(keys), oldBlocks = splitBlocks(oldText), newBlocks = splitBlocks(newText), newMap = new Map(newBlocks.map((block) => [block.key, block])), out = oldBlocks.map((block) => pick.has(block.key) && newMap.has(block.key) ? newMap.get(block.key) : block), oldKeys = new Set(oldBlocks.map((block) => block.key));
    for (let block of newBlocks) pick.has(block.key) && !oldKeys.has(block.key) && out.push(block);
    return joinBlocks(out);
  }
  function injectedSetting(setting) {
    let text2 = String(setting && setting.text || "").trim(), mute2 = new Set(setting && Array.isArray(setting.mute) ? setting.mute : []);
    return mute2.size ? stripAuthorBlocks(joinBlocks(splitBlocks(text2).filter((block) => !mute2.has(block.key)))) : stripAuthorBlocks(text2);
  }
  function changedBlockKeys(oldText, newText) {
    let old = new Map(splitBlocks(oldText).map((block) => [block.key, block.text]));
    return splitBlocks(newText).filter((block) => old.has(block.key) && old.get(block.key) !== block.text).map((block) => block.key);
  }
  var SECTION = /^\s*(?:#{1,4}\s*|\d+\s*[.、．]\s*|\*\*)*\s*(世界观正文|补定|速查)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*/;
  function stripFence(text2) {
    let match = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(text2);
    return (match ? match[1] : text2).trim();
  }
  function parseSettingReply(text2) {
    let lines2 = String(text2 || "").replace(/\r\n/g, `
`).split(`
`), sections = { 世界观正文: [], 补定: [], 速查: [] }, current = "世界观正文", sawHeading = !1;
    for (let line of lines2) {
      let match = SECTION.exec(line);
      if (match && (match[1] !== "速查" || /PASS|FAIL/i.test(line) || line.replace(SECTION, "").trim() === "")) {
        current = match[1], sawHeading = !0;
        let rest = line.slice(match[0].length).trim();
        rest && sections[current].push(rest);
        continue;
      }
      sections[current].push(line);
    }
    let body = stripFence(sections.世界观正文.join(`
`)), fixes = sections.补定.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, "").trim()).filter(Boolean), verdict = /(PASS|FAIL)/i.exec([...sections.速查, ...sawHeading ? [] : lines2.slice(-3)].join(" "));
    return { body, fixes, check: verdict ? verdict[1].toUpperCase() : "" };
  }
  function pushHistory(history, text2, limit = 10, now = Date.now(), label = "") {
    let list = Array.isArray(history) ? history : [];
    return list.length && list[0].text === text2 ? list : [{ at: now, text: text2, ...label ? { label } : {} }, ...list].slice(0, limit);
  }
  function diffLines(a, b) {
    let x = String(a || "").split(`
`), y = String(b || "").split(`
`);
    if (x.length * y.length > 4e6) return [...x.map((text2) => ({ op: "-", text: text2 })), ...y.map((text2) => ({ op: "+", text: text2 }))];
    let n = x.length, m = y.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i2 = n - 1; i2 >= 0; i2 -= 1)
      for (let j2 = m - 1; j2 >= 0; j2 -= 1) dp[i2][j2] = x[i2] === y[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    let out = [], i = 0, j = 0;
    for (; i < n && j < m; )
      x[i] === y[j] ? (out.push({ op: "=", text: x[i] }), i += 1, j += 1) : dp[i + 1][j] >= dp[i][j + 1] ? (out.push({ op: "-", text: x[i] }), i += 1) : (out.push({ op: "+", text: y[j] }), j += 1);
    for (; i < n; ) out.push({ op: "-", text: x[i++] });
    for (; j < m; ) out.push({ op: "+", text: y[j++] });
    return out;
  }
  var AUTHOR_BLOCK_TITLE = "仅作者资料";

  // src/core/outline.js
  var NODE_FIELDS = [
    { field: "主线节点", kind: "main", prefix: "m", label: "主线" },
    { field: "支线事件", kind: "side", prefix: "s", label: "支线" },
    { field: "世界动态", kind: "world", prefix: "w", label: "世界动态" }
  ], STAGE_HINT_KEYS = ["时间范围", "AI指令", "主线节点", "支线事件", "世界动态", "状态变化"], CHANGE_FIELD = "状态变化";
  function changeLines(data) {
    let value = data && data[CHANGE_FIELD];
    return (Array.isArray(value) ? value : String(value || "").split(`
`)).map((item) => item && typeof item == "object" ? Object.values(item).join("：") : String(item || "")).map((text2) => text2.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, "").trim()).filter(Boolean);
  }
  function makeId(prefix = "u") {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  var isPlainObject = (value) => !!value && typeof value == "object" && !Array.isArray(value);
  function looksLikeStage(value) {
    return isPlainObject(value) && STAGE_HINT_KEYS.some((key) => key in value);
  }
  function looksLikeVolume(value) {
    return isPlainObject(value) && Object.values(value).some(looksLikeStage);
  }
  function volumesFromValue(value, idOf2 = makeId) {
    if (!isPlainObject(value)) throw new Error("大纲顶层应是「卷名: 阶段」的映射");
    let entries = Object.entries(value), tagged = entries.some(([, v]) => isPlainObject(v) && isPlainObject(v[VOLUME_LINE_KEY]));
    if (tagged && (value = Object.fromEntries(entries.map(([k, v]) => [k, liftVolumeStageKeys(v)])), entries = Object.entries(value)), entries.length && !tagged && entries.every(([, v]) => looksLikeStage(v)))
      return [{ id: idOf2("v"), key: "剧情_导入", stages: entries.map(([key, data]) => ({ id: idOf2("s"), key, data })) }];
    if (looksLikeStage(value)) return [{ id: idOf2("v"), key: "剧情_导入", stages: [{ id: idOf2("s"), key: "阶段一_导入", data: value }] }];
    let volumes = [];
    for (let [key, stages] of entries) {
      let { line, rest } = splitVolumeLine(stages);
      if (!looksLikeVolume(rest)) throw new Error(`「${key}」下没有可识别的阶段（需要 时间范围 / 主线节点 等字段）`);
      volumes.push({
        id: idOf2("v"),
        key,
        ...line ? { line } : {},
        stages: Object.entries(rest).filter(([, data]) => isPlainObject(data)).map(([stageKey, data]) => ({ id: idOf2("s"), key: stageKey, data: nodeMapsToLists(data) }))
      });
    }
    if (!volumes.length) throw new Error("没有读到任何卷");
    return volumes;
  }
  function parseOutlineText(text2, idOf2 = makeId) {
    let value;
    try {
      value = parseYaml(text2);
    } catch (error) {
      let line = yamlErrorLine(error), wrapped = new Error(`YAML 格式错误${line ? `（第 ${line} 行）` : ""}：${String(error.message || error).split(`
`)[0]}`);
      throw wrapped.line = line, wrapped;
    }
    return volumesFromValue(value, idOf2);
  }
  function volumeValue(volume) {
    let out = {};
    isPlainObject(volume.line) && (out[VOLUME_LINE_KEY] = volume.line);
    for (let stage of volume.stages) out[stage.key] = stage.data;
    return out;
  }
  function outlineToText(volumes) {
    let out = {};
    for (let volume of volumes) out[volume.key] = volumeValue(volume);
    return stringifyYaml(out);
  }
  function volumeToText(volume) {
    return stringifyYaml({ [volume.key]: volumeValue(volume) });
  }
  function stageToText(stage) {
    return stringifyYaml({ [stage.key]: stage.data });
  }
  var stripPrefix = (key, pattern) => String(key || "").replace(pattern, "");
  function splitVolumeKey(key) {
    let rest = stripPrefix(key, /^剧情_/), at = rest.indexOf("_");
    return at < 0 ? { short: rest, title: "" } : { short: rest.slice(0, at), title: rest.slice(at + 1) };
  }
  function volumeLabel(key) {
    let { short, title: title2 } = splitVolumeKey(key);
    return title2 ? `${short}·${title2}` : short;
  }
  function splitStageKey(key) {
    let text2 = String(key || ""), at = text2.indexOf("_");
    return at < 0 ? { short: text2, title: "" } : { short: text2.slice(0, at), title: text2.slice(at + 1) };
  }
  function stageLabel(key) {
    let { short, title: title2 } = splitStageKey(key);
    return title2 ? `${short} ${title2}` : short;
  }
  function flattenUnits(volumes) {
    let units = [];
    return (volumes || []).forEach((volume, volIndex) => {
      volume.stages.forEach((stage, stageIndex) => {
        units.push({ id: stage.id, index: units.length, volIndex, stageIndex, volume, stage });
      });
    }), units;
  }
  function stageNodes(data) {
    let nodes = [];
    for (let { field: field2, kind, prefix, label } of NODE_FIELDS)
      (Array.isArray(data && data[field2]) ? data[field2] : []).forEach((item, index) => {
        let name = isPlainObject(item) ? String(item.名称 || item.类型 || item.内容 || "").trim() : String(item || "").trim();
        nodes.push({ id: `${prefix}${index}`, kind, field: field2, label, index, name: name || `${label}${index + 1}`, item });
      });
    return nodes;
  }
  function filterStageData(data, offIds = []) {
    let off = new Set(offIds), out = {};
    for (let [key, value] of Object.entries(data || {})) {
      let meta2 = NODE_FIELDS.find((item) => item.field === key);
      if (!meta2 || !Array.isArray(value)) {
        out[key] = value;
        continue;
      }
      let kept = value.filter((_, index) => !off.has(`${meta2.prefix}${index}`)).map((item) => {
        if (!isPlainObject(item) || !("id" in item)) return item;
        let { id, ...publicItem } = item;
        return Object.keys(publicItem).length === 1 && typeof publicItem.名称 == "string" ? publicItem.名称 : publicItem;
      });
      kept.length && (out[key] = kept);
    }
    return out;
  }
  function mainNodeNames(data) {
    return stageNodes(data).filter((node) => node.kind === "main").map((node) => node.name);
  }
  function replaceRest(volumes, fromStageId, incoming) {
    let units = flattenUnits(volumes), from = units.findIndex((unit) => unit.stage.id === fromStageId);
    if (from < 0) throw new Error("原来的阶段已不存在");
    let drop = new Set(units.slice(from).map((unit) => unit.stage.id)), next = volumes.map((volume) => ({ ...volume, stages: volume.stages.filter((stage) => !drop.has(stage.id)) }));
    for (let volume of incoming) {
      let same = next.find((item) => item.key === volume.key);
      same ? next = next.map((item) => item === same ? { ...item, stages: [...item.stages, ...volume.stages] } : item) : next.push(volume);
    }
    return next.filter((volume) => volume.stages.length);
  }
  function pushOutlineHistory(history, volumes, label = "", now = Date.now()) {
    return !volumes || !volumes.length ? Array.isArray(history) ? history : [] : pushHistory(history, outlineToText(volumes), 10, now, label);
  }
  function queueByKey(list) {
    let queues2 = /* @__PURE__ */ new Map();
    for (let item of list)
      queues2.has(item.key) || queues2.set(item.key, []), queues2.get(item.key).push(item);
    return (key) => {
      let queue = queues2.get(key);
      return queue && queue.length ? queue.shift() : null;
    };
  }
  function restoreOutline(text2, current = [], idOf2 = makeId) {
    let old = current || [], takeVolume = queueByKey(old), used = /* @__PURE__ */ new Set(), parsed = parseOutlineText(text2, idOf2).map((volume) => {
      let match = takeVolume(volume.key), takeStage = queueByKey(match ? match.stages : []);
      return {
        volume,
        match,
        stages: volume.stages.map((stage) => {
          let same = takeStage(stage.key);
          return same && used.add(same.id), { stage, same };
        })
      };
    }), leftovers = old.flatMap(
      (volume) => volume.stages.filter((stage) => !used.has(stage.id)).map((stage) => ({ key: stage.key, stage, volume }))
    ), takeAny = queueByKey(leftovers);
    for (let row2 of parsed)
      for (let item of row2.stages) {
        if (item.same) continue;
        let hit = takeAny(item.stage.key);
        hit && (item.same = hit.stage, item.from = hit.volume, used.add(hit.stage.id));
      }
    let usedVolumes = new Set(parsed.filter((row2) => row2.match).map((row2) => row2.match.id)), alias = [];
    return { volumes: parsed.map((row2) => {
      let id = row2.match ? row2.match.id : row2.volume.id;
      if (!row2.match) {
        let votes = /* @__PURE__ */ new Map();
        for (let item of row2.stages)
          item.from && !usedVolumes.has(item.from.id) && votes.set(item.from, (votes.get(item.from) || 0) + 1);
        let best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
        best && (id = best[0].id, usedVolumes.add(id));
      }
      let source = row2.match || old.find((volume) => volume.id === id) || null, stages = row2.stages.map((item, index) => {
        if (item.same) return { ...item.stage, id: item.same.id };
        let spot = source && source.stages[index];
        return spot && !used.has(spot.id) && (used.add(spot.id), alias.push([spot.id, item.stage.id])), item.stage;
      });
      return { ...row2.volume, id, stages };
    }), alias };
  }
  function nearestUnitId(oldVolumes, newVolumes, currentId) {
    let before = flattenUnits(oldVolumes), after = flattenUnits(newVolumes);
    if (!after.length || after.some((unit) => unit.id === currentId)) return null;
    let at = before.findIndex((unit) => unit.id === currentId);
    return at < 0 ? null : after[Math.min(at, after.length - 1)].id;
  }
  function moveItem(list, index, delta) {
    let to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
    let out = [...list];
    return [out[index], out[to]] = [out[to], out[index]], out;
  }
  function moveStageToVolume(volumes, stageId, targetVolumeId) {
    let source = volumes.find((volume) => volume.stages.some((stage2) => stage2.id === stageId)), target = volumes.find((volume) => volume.id === targetVolumeId);
    if (!source || !target || source.id === target.id) return volumes;
    let stage = source.stages.find((item) => item.id === stageId);
    return volumes.map((volume) => volume.id === source.id ? { ...volume, stages: volume.stages.filter((item) => item.id !== stageId) } : volume.id === target.id ? { ...volume, stages: [...volume.stages, stage] } : volume);
  }
  function replaceStages(volumes, volumeId, stageIds, incoming) {
    let original = volumes.find((v) => v.id === volumeId)?.stages.filter((s) => stageIds.includes(s.id)) || [];
    incoming = preserveStageNodeIds(original, incoming);
    let drop = new Set(stageIds), placed = null, keepId = "", next = volumes.map((volume) => {
      if (volume.id !== volumeId) return volume;
      let at = volume.stages.findIndex((stage) => drop.has(stage.id));
      if (at < 0) throw new Error("原来的阶段已不存在");
      keepId = volume.stages[at].id, placed = incoming.map((stage, index) => index === 0 ? { ...stage, id: keepId } : stage);
      let stages = [];
      return volume.stages.forEach((stage, index) => {
        index === at && stages.push(...placed), drop.has(stage.id) || stages.push(stage);
      }), { ...volume, stages };
    });
    if (!placed) throw new Error("原来的阶段已不存在");
    return { volumes: next, stages: placed, keepId };
  }
  function outlineIssues(volumes) {
    let issues = [];
    for (let volume of volumes || []) {
      if (!volume.stages.length) {
        issues.push({ kind: "empty-volume", volumeId: volume.id, stageId: "", text: `「${volumeLabel(volume.key)}」没有阶段` });
        continue;
      }
      let seen = /* @__PURE__ */ new Map();
      for (let stage of volume.stages) seen.set(stage.key, (seen.get(stage.key) || 0) + 1);
      for (let stage of volume.stages) {
        let label = stageLabel(stage.key);
        String(stage.data && stage.data.时间范围 || "").trim() || issues.push({ kind: "no-time", volumeId: volume.id, stageId: stage.id, text: `「${label}」没有写时间范围` }), mainNodeNames(stage.data).length || issues.push({ kind: "no-main", volumeId: volume.id, stageId: stage.id, text: `「${label}」没有主线节点` }), seen.get(stage.key) > 1 && issues.push({
          kind: "dup-name",
          volumeId: volume.id,
          stageId: stage.id,
          text: `阶段名「${label}」在「${volumeLabel(volume.key)}」中重名`
        });
      }
    }
    return [...issues, ...threadNameIssues(volumes)];
  }
  function threadNameIssues(volumes) {
    let groups = { side: /* @__PURE__ */ new Map(), world: /* @__PURE__ */ new Map() };
    for (let unit of flattenUnits(volumes))
      for (let node of stageNodes(unit.stage.data)) {
        if (node.kind === "main" || node.kind === "world" && !(Number(node.item && node.item.进度钟) >= 2)) continue;
        let map = groups[node.kind];
        map.has(node.name) || map.set(node.name, []), map.get(node.name).push(unit);
      }
    let issues = [];
    for (let [kind, map] of Object.entries(groups)) {
      let what = kind === "side" ? "支线" : "进度钟";
      for (let [name, list] of map) {
        if (list.length < 2) continue;
        let places = [...new Set(list.map((unit) => stageLabel(unit.stage.key)))].join("、"), where = places.includes("、") ? places : `${places}的不同节点`, seen = /* @__PURE__ */ new Set();
        for (let unit of list)
          seen.has(unit.id) || (seen.add(unit.id), issues.push({ kind: "dup-thread", volumeId: unit.volume.id, stageId: unit.id, text: `${what}「${name}」在 ${where} 重名` }));
      }
    }
    return issues;
  }
  var STABLE_PREFIX = "@";
  function nodeProgressId(item, prefix, index) {
    let id = isPlainObject(item) && typeof item.id == "string" ? item.id.trim() : "";
    return id ? `${STABLE_PREFIX}${id}` : `${prefix}${index}`;
  }
  function preserveStageNodeIds(original, incoming) {
    let ids = /* @__PURE__ */ new Map(), used = /* @__PURE__ */ new Set();
    for (let stage of original)
      for (let node of stageNodes(stage.data)) {
        let key = node.field + `
` + node.name;
        node.item && node.item.id && ids.set(key, ids.has(key) ? null : node.item.id);
      }
    for (let stage of incoming) for (let node of stageNodes(stage.data)) node.item && node.item.id && used.add(node.item.id);
    return incoming.map((stage) => {
      let data = { ...stage.data };
      for (let meta2 of NODE_FIELDS)
        Array.isArray(data[meta2.field]) && (data[meta2.field] = data[meta2.field].map((item, index) => {
          if (isPlainObject(item) && item.id) return item;
          let node = stageNodes({ [meta2.field]: [item] })[0], uid = ids.get(meta2.field + `
` + node.name);
          return !uid || used.has(uid) ? item : (used.add(uid), isPlainObject(item) ? { ...item, id: uid } : { 名称: String(item), id: uid });
        }));
      return { ...stage, data };
    });
  }
  function nodeMapsToLists(data) {
    let out = data;
    for (let { field: field2 } of NODE_FIELDS) {
      let v = data[field2];
      !isPlainObject(v) || !Object.values(v).length || !Object.values(v).every(isPlainObject) || (out === data && (out = { ...data }), out[field2] = Object.entries(v).map(([k, item]) => item.id ? item : { id: k, ...item }));
    }
    return out;
  }
  var VOLUME_LINE_KEY = "线";
  function liftVolumeStageKeys(v) {
    if (!isPlainObject(v) || !isPlainObject(v[VOLUME_LINE_KEY])) return v;
    let loose2 = Object.entries(v).filter(([k, x]) => k !== VOLUME_LINE_KEY && !isPlainObject(x)), first = Object.keys(v).find((k) => k !== VOLUME_LINE_KEY && looksLikeStage(v[k]));
    if (!first) {
      let { [VOLUME_LINE_KEY]: line, ...rest } = v;
      return looksLikeStage(rest) ? { [VOLUME_LINE_KEY]: line, 阶段1_经过: rest } : v;
    }
    if (!loose2.length) return v;
    let out = {};
    for (let [k, x] of Object.entries(v))
      (k === VOLUME_LINE_KEY || isPlainObject(x)) && (out[k] = k === first ? { ...Object.fromEntries(loose2.filter(([lk]) => !(lk in x))), ...x } : x);
    return out;
  }
  function splitVolumeLine(value) {
    if (!isPlainObject(value) || !isPlainObject(value[VOLUME_LINE_KEY])) return { line: null, rest: value };
    let { [VOLUME_LINE_KEY]: line, ...rest } = value;
    return { line, rest };
  }

  // src/app/import-store.js
  var importSrcFile = (id) => `pi-i-${id}-src.json`, importJobFile = (id) => `pi-i-${id}.json`;
  function createImportStore({ read = readJsonFile, write = writeJsonFile, remove = deleteFile } = {}) {
    let jobs = /* @__PURE__ */ new Map(), queues2 = /* @__PURE__ */ new Map(), saved = /* @__PURE__ */ new Map();
    function enqueue(name, fn) {
      let prev = queues2.get(name) || Promise.resolve(), next = prev.catch(() => {
      }).then(fn);
      return queues2.set(name, next), next.finally(() => queues2.get(name) === next && queues2.delete(name));
    }
    async function create({ projectId, text: text2, mode, needs }) {
      let id = makeId("imp"), job = {
        version: 1,
        id,
        projectId,
        createdAt: Date.now(),
        mode,
        needs: String(needs || ""),
        chars: String(text2 || "").length,
        step: "split",
        parts: [],
        index: null,
        drafts: {},
        notes: {},
        adopted: [],
        rev: 0
      };
      return await write(importSrcFile(id), { text: String(text2 || "") }), jobs.set(id, job), await save3(job), job;
    }
    async function load(id) {
      if (jobs.has(id)) return jobs.get(id);
      let file = await read(importJobFile(id));
      return file && isPlainObject(file.value) ? (jobs.set(id, file.value), saved.set(id, file.value.rev || 0), file.value) : null;
    }
    async function source(id) {
      let file = await read(importSrcFile(id));
      return file && isPlainObject(file.value) ? String(file.value.text || "") : "";
    }
    function update3(id, fn) {
      let cur = jobs.get(id);
      if (!cur) throw new Error("导入任务尚未载入");
      let next = { ...fn(cur), rev: (cur.rev || 0) + 1 };
      return jobs.set(id, next), save3(next);
    }
    function save3(job) {
      return enqueue(importJobFile(job.id), async () => (await write(importJobFile(job.id), job), saved.set(job.id, job.rev), job));
    }
    async function drop(id) {
      jobs.delete(id), await enqueue(importJobFile(id), async () => {
        await remove(importJobFile(id)).catch(() => !1), await remove(importSrcFile(id)).catch(() => !1);
      });
    }
    async function flush() {
      await Promise.all([...queues2.values()].map((p) => p.catch(() => {
      })));
    }
    return { create, load, source, update: update3, drop, flush, savedRev: (id) => saved.get(id) || 0, get: (id) => jobs.get(id) || null };
  }
  function adoptKey(jobId, partNo, stageKey) {
    return `${jobId}:${partNo}:${stageKey}`;
  }

  // src/core/infinite.js
  var INFINITE_SLOT = "@infinite";
  var DEFAULT_POOLS = {
    horror: [
      { label: "中式民俗", weight: 3 },
      { label: "规则怪谈", weight: 3 },
      { label: "心理恐怖", weight: 2 },
      { label: "都市传说", weight: 2 },
      { label: "克苏鲁式不可名状", weight: 1 },
      { label: "诡异的温情", weight: 1 }
    ],
    cycle: [
      { label: "一晚", weight: 2 },
      { label: "三天", weight: 3 },
      { label: "一个月", weight: 3 },
      { label: "一年", weight: 2 },
      { label: "超过一生", weight: 1 }
    ],
    client: [
      { label: "守夜的老人", weight: 2 },
      { label: "失约的新娘", weight: 2 },
      { label: "迷路的孩子", weight: 2 },
      { label: "最后一个乘客", weight: 2 },
      { label: "看不见脸的店家", weight: 1 },
      { label: "已经死去的同行", weight: 1 }
    ],
    lust: [{ label: "无", weight: 70 }, { label: "轻", weight: 25 }, { label: "重", weight: 5 }]
  }, POOL_KEYS = ["horror", "cycle", "client", "lust"], POOL_LABELS = { horror: "恐怖类型", cycle: "重置周期", client: "委托人身份", lust: "情欲浓度" }, HUB_WORD_KEYS = ["back", "depart", "away", "hub"], DEFAULT_HUB = {
    hubName: "列车",
    blockTag: "末班车状态",
    fieldNames: ["列车", "位置", "状态", "所在", "车况"],
    words: {
      back: ["回到列车", "回列车", "返回列车", "回到车上", "回车上", "重新上车", "登上列车", "已上车", "上了车"],
      depart: ["停站", "到站", "进站", "靠站", "停靠", "下车"],
      away: ["世界里", "世界中", "在世界", "副本"],
      hub: ["车上", "列车上", "餐车", "行驶中"]
      // 第一个词是显示名，旧版本这里是「列车上」在前
    }
  }, DEFAULT_CONFIG = { horrorPrefix: "🎭 恐怖类型：" };
  function cleanList(value) {
    let out = [];
    for (let item of Array.isArray(value) ? value : []) {
      let text2 = String(item ?? "").trim();
      text2 && !out.includes(text2) && out.push(text2);
    }
    return out;
  }
  function cleanText(value, fallback) {
    return (typeof value == "string" ? value.trim() : "") || fallback;
  }
  function normalizeHub(value) {
    let src = value && typeof value == "object" ? value : {}, words = src.words && typeof src.words == "object" ? src.words : {}, fields = cleanList(src.fieldNames);
    return {
      hubName: cleanText(src.hubName, DEFAULT_HUB.hubName),
      blockTag: cleanText(src.blockTag, DEFAULT_HUB.blockTag),
      fieldNames: fields.length ? fields : [...DEFAULT_HUB.fieldNames],
      words: Object.fromEntries(HUB_WORD_KEYS.map((key) => [key, Array.isArray(words[key]) ? cleanList(words[key]) : [...DEFAULT_HUB.words[key]]]))
    };
  }
  function resolveHub(value) {
    let hub = normalizeHub(value);
    return { ...hub, words: Object.fromEntries(HUB_WORD_KEYS.map((key) => [key, hub.words[key].length ? hub.words[key] : [...DEFAULT_HUB.words[key]]])) };
  }
  function blankedWordKeys(value) {
    let hub = normalizeHub(value);
    return HUB_WORD_KEYS.filter((key) => !hub.words[key].length);
  }
  function hubWordNames(value) {
    let hub = resolveHub(value);
    return Object.fromEntries(HUB_WORD_KEYS.map((key) => [key, hub.words[key][0]]));
  }
  function phaseLabels(value) {
    return { train: `在${resolveHub(value).hubName}`, world: "在世界里" };
  }
  function normalizePool(value, fallback) {
    let out = (Array.isArray(value) ? value : fallback).filter((item) => item && String(item.label || "").trim()).map((item) => ({ label: String(item.label).trim(), weight: Math.max(0, Number(item.weight)) || 0 })).filter((item) => item.weight > 0);
    return out.length ? out : fallback.map((item) => ({ ...item }));
  }
  function poolToText(pool) {
    return pool.map((item) => `${item.label}|${item.weight}`).join(`
`);
  }
  function textToPool(text2) {
    let out = [];
    for (let raw of String(text2 || "").split(`
`)) {
      let cells2 = raw.split(/[|｜]/).map((cell) => cell.trim());
      cells2[0] && out.push({ label: cells2[0], weight: Number(cells2[1]) || 1 });
    }
    return out;
  }
  function randomFloat() {
    let g = globalThis.crypto;
    if (!g || typeof g.getRandomValues != "function") throw new Error("当前环境没有 crypto 真随机");
    let buf = new Uint32Array(1);
    return g.getRandomValues(buf), buf[0] / 4294967296;
  }
  function rollPool(pool, rng = randomFloat) {
    let total = pool.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (!(total > 0)) return pool[0];
    let hit = rng() * total;
    for (let item of pool)
      if (hit -= Math.max(0, item.weight), hit < 0) return item;
    return pool[pool.length - 1];
  }
  function rollWorldDice(infinite, rng = randomFloat) {
    return Object.fromEntries(POOL_KEYS.map((key) => [key, rollPool(infinite.pools[key], rng).label]));
  }
  function normalizeWorld(value) {
    let src = value && typeof value == "object" ? value : {}, dice = src.dice && typeof src.dice == "object" ? src.dice : {};
    return {
      id: String(src.id || makeId("w")),
      title: String(src.title || "无名之站"),
      dice: Object.fromEntries(POOL_KEYS.map((key) => [key, String(dice[key] || "")])),
      body: String(src.body || "")
    };
  }
  function normalizeInfinite(value) {
    let src = value && typeof value == "object" ? value : {}, cfg = src.config && typeof src.config == "object" ? src.config : {}, pools = src.pools && typeof src.pools == "object" ? src.pools : {};
    return {
      pools: Object.fromEntries(POOL_KEYS.map((key) => [key, normalizePool(pools[key], DEFAULT_POOLS[key])])),
      spec: String(src.spec || ""),
      config: { horrorPrefix: typeof cfg.horrorPrefix == "string" ? cfg.horrorPrefix : DEFAULT_CONFIG.horrorPrefix, ...normalizeHub(cfg) }
    };
  }
  function findWorld(worlds, id) {
    return worlds.find((world) => world.id === id) || null;
  }
  function putWorld(worlds, world) {
    return worlds.some((item) => item.id === world.id) ? worlds.map((item) => item.id === world.id ? world : item) : [...worlds, world];
  }
  function titleKey(title2) {
    return String(title2 || "").replace(/[\uFE0E\uFE0F\s]+/g, "").toLowerCase();
  }

  // src/core/infinite-flow.js
  var LOG_MAX = 12;
  function emptyInfinite() {
    return { phase: "train", worldId: "", worlds: [], log: [] };
  }
  function normalizeInfiniteProgress(value) {
    let src = value && typeof value == "object" ? value : {}, worlds = (Array.isArray(src.worlds) ? src.worlds : []).filter((item) => item && typeof item == "object").map(normalizeWorld), worldId = String(src.worldId || ""), inWorld = src.phase === "world" && !!findWorld(worlds, worldId), trig = normalizeTrigger(src.trigger, worlds);
    return {
      phase: inWorld ? "world" : "train",
      worldId: inWorld ? worldId : "",
      worlds,
      log: (Array.isArray(src.log) ? src.log : []).map(String).slice(-LOG_MAX),
      ...trig ? { trigger: trig } : {}
    };
  }
  function normalizeTrigger(value, worlds) {
    if (!value || typeof value != "object" || value.kind !== "enter" && value.kind !== "leave") return null;
    let floor = Number(value.floor);
    if (!Number.isInteger(floor) || floor < 0) return null;
    let worldId = String(value.worldId || "");
    return findWorld(worlds, worldId) ? { kind: value.kind, floor, hash: String(value.hash || ""), worldId } : null;
  }
  function withTrigger(inf, trigger) {
    let { trigger: _old, ...rest } = inf;
    return trigger ? { ...rest, trigger } : rest;
  }
  function undoEnter(inf, note = "触发楼已改动，撤销开副本") {
    let id = inf.trigger ? inf.trigger.worldId : inf.worldId, next = withTrigger({ ...inf, worlds: inf.worlds.filter((world) => world.id !== id), phase: "train", worldId: "" }, null);
    return addLog(next, note);
  }
  function undoLeave(inf, note = "触发楼已改动，撤销关副本") {
    let world = inf.trigger ? findWorld(inf.worlds, inf.trigger.worldId) : null;
    return world ? addLog(withTrigger({ ...inf, phase: "world", worldId: world.id }, null), note) : withTrigger(inf, null);
  }
  function addLog(inf, text2) {
    return { ...inf, log: [...inf.log, text2].slice(-LOG_MAX) };
  }
  function createWorld({ id, dice, parsed }) {
    return normalizeWorld({ id, title: parsed.title, dice, body: parsed.body });
  }
  function enterWorld(inf, world) {
    return addLog(withTrigger({ ...inf, phase: "world", worldId: world.id, worlds: putWorld(inf.worlds, world) }, null), `进入世界「${world.title}」`);
  }
  function reenterWorld(inf, id) {
    let world = findWorld(inf.worlds, id);
    if (!world) throw new Error("这份档案已经不在世界库里");
    return addLog(withTrigger({ ...inf, phase: "world", worldId: id }, null), `重新打开「${world.title}」`);
  }
  function leaveWorld(inf, note = "回到主空间") {
    return addLog(withTrigger({ ...inf, phase: "train", worldId: "" }, null), note);
  }
  function removeWorld(inf, id, config) {
    let kept = { ...inf, worlds: inf.worlds.filter((world) => world.id !== id) }, next = inf.trigger && inf.trigger.worldId === id ? withTrigger(kept, null) : kept;
    return next.worldId === id ? addLog({ ...next, phase: "train", worldId: "" }, `当前世界的档案被删除，回到${resolveHub(config).hubName}`) : next;
  }
  function buildInfiniteDetail(inf, config) {
    let { hubName } = resolveHub(config), labels = phaseLabels(config), world = inf.phase === "world" ? findWorld(inf.worlds, inf.worldId) : null, status = world ? `当前状态：${labels.world}「${world.title}」。` : `当前状态：${labels.train}，尚未出发。下一次出发由${hubName}安排，user 指挥不了。`, blocks = [`<${hubName}状态>
${status}
</${hubName}状态>`];
    return world && blocks.push(`<世界档案>
${world.body}

情欲浓度：${world.dice.lust}
</世界档案>`), blocks.join(`
`);
  }

  // src/core/align.js
  var RENAME_MAX = 200, ALIAS_MAX = 300, isObj = (value) => !!value && typeof value == "object" && !Array.isArray(value), FIELD_OF = Object.fromEntries(NODE_FIELDS.map((meta2) => [meta2.prefix, meta2.field])), FIELDS = new Set(NODE_FIELDS.map((meta2) => meta2.field)), prefixOf = (id) => String(id).replace(/~?\d+$/, ""), keyStage = (key) => key.slice(0, key.indexOf(":")), keyNode = (key) => key.slice(key.indexOf(":") + 1);
  function normalizeRenames(value) {
    return (Array.isArray(value) ? value : []).filter((item) => isObj(item) && typeof item.stageId == "string" && item.stageId && FIELDS.has(item.field)).map((item) => ({ stageId: item.stageId, field: item.field, from: String(item.from ?? "").trim(), to: String(item.to ?? "").trim() })).filter((item) => item.from && item.to && item.from !== item.to).slice(-RENAME_MAX);
  }
  function normalizeAlias(value) {
    if (!isObj(value)) return {};
    let entries = Object.entries(value).filter(([from, to]) => from && typeof to == "string" && to && to !== from);
    return Object.fromEntries(entries.slice(-ALIAS_MAX));
  }
  function withRenames(outline, items) {
    let add = normalizeRenames(items);
    return add.length ? { ...outline, renames: normalizeRenames([...normalizeRenames(outline.renames), ...add]) } : outline;
  }
  function withAliases(outline, pairs) {
    let list = (pairs || []).filter(([from, to]) => from && to && from !== to);
    if (!list.length) return outline;
    let alias = { ...normalizeAlias(outline.idAlias) };
    for (let [from, to] of list)
      delete alias[from], alias[to] === from && delete alias[to], alias[from] = to;
    return { ...outline, idAlias: normalizeAlias(alias) };
  }
  function outlineLinks(outline, units = null) {
    let src = isObj(outline) ? outline : {}, alias = normalizeAlias(src.idAlias), renames = normalizeRenames(src.renames), live = new Set((units || flattenUnits(src.volumes || [])).map((unit) => unit.id)), resolve = (id) => {
      if (live.has(id) || !alias[id]) return id;
      let seen = /* @__PURE__ */ new Set([id]), at = id;
      for (; alias[at] && !seen.has(alias[at]); ) {
        if (at = alias[at], live.has(at)) return at;
        seen.add(at);
      }
      return id;
    }, cache = /* @__PURE__ */ new Map();
    return { resolve, family: (stageId, field2, name) => {
      let cacheKey = `${stageId}
${field2}
${name}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      let edges = renames.filter((item) => item.field === field2 && resolve(item.stageId) === stageId), names2 = /* @__PURE__ */ new Set([name]);
      for (let grew = !0; grew; ) {
        grew = !1;
        for (let item of edges)
          names2.has(item.from) && !names2.has(item.to) && (names2.add(item.to), grew = !0), names2.has(item.to) && !names2.has(item.from) && (names2.add(item.from), grew = !0);
      }
      return cache.set(cacheKey, names2), names2;
    }, empty: !renames.length && !Object.keys(alias).length };
  }
  var NO_LINKS = { resolve: (id) => id, family: (stageId, field2, name) => /* @__PURE__ */ new Set([name]), empty: !0 };
  function placeRecords(nodes, records, stageId, links = NO_LINKS) {
    let placed = /* @__PURE__ */ new Map(), used = /* @__PURE__ */ new Set(), own = (node, rec) => rec.stageId === stageId && rec.nodeId === node.id, fits = (node, rec) => prefixOf(rec.nodeId) === prefixOf(node.id), take = (node, rec) => {
      placed.set(node.id, rec), used.add(rec);
    };
    for (let node of nodes) {
      let rec = records.find((item) => own(node, item) && item.name === node.name);
      rec && take(node, rec);
    }
    let ordered = [...records].sort((a, b) => (a.stageId === stageId ? 0 : 1) - (b.stageId === stageId ? 0 : 1));
    for (let node of nodes) {
      if (placed.has(node.id)) continue;
      let rec = ordered.find((item) => !used.has(item) && item.name && item.name === node.name && fits(node, item));
      rec && take(node, rec);
    }
    for (let node of nodes) {
      if (placed.has(node.id)) continue;
      let names2 = links.family(stageId, node.field, node.name);
      if (names2.size < 2) continue;
      let taken = new Set(nodes.filter((other) => other !== node && other.field === node.field).map((other) => other.name)), rec = ordered.find((item) => !used.has(item) && item.name && names2.has(item.name) && !taken.has(item.name) && fits(node, item));
      rec && take(node, rec);
    }
    for (let node of nodes) {
      if (placed.has(node.id)) continue;
      let rec = records.find((item) => !used.has(item) && !item.name && own(node, item));
      rec && take(node, rec);
    }
    return { placed, orphans: records.filter((item) => !used.has(item)) };
  }
  function stageRecords(map, stageId, prefixes, links) {
    let out = [];
    for (let [key, value] of Object.entries(map)) {
      if (key.indexOf(":") < 0) continue;
      let from = keyStage(key), nodeId = keyNode(key);
      !prefixes.has(prefixOf(nodeId)) || links.resolve(from) !== stageId || out.push({ key, stageId: from, nodeId, name: isObj(value) && value.name ? String(value.name) : "", value });
    }
    return out;
  }
  function placeStageMap(map, stageId, nodes, links = NO_LINKS) {
    let prefixes = new Set(nodes.map((node) => prefixOf(node.id))), { placed } = placeRecords(nodes, stageRecords(map, stageId, prefixes, links), stageId, links), out = /* @__PURE__ */ new Map();
    for (let [nodeId, rec] of placed) out.set(nodeId, { saved: isObj(rec.value) ? rec.value : {}, savedKey: rec.key });
    return out;
  }
  function realignStage(map, stageId, nodes, links = NO_LINKS) {
    let prefixes = new Set(nodes.map((node) => prefixOf(node.id)));
    if (!prefixes.size) return map;
    let records = stageRecords(map, stageId, prefixes, links);
    if (!records.length) return map;
    let { placed, orphans } = placeRecords(nodes, records, stageId, links), out = { ...map };
    for (let rec of records) delete out[rec.key];
    let nodeKeys = new Set(nodes.map((node) => `${stageId}:${node.id}`));
    for (let node of nodes) {
      let rec = placed.get(node.id);
      rec && (out[`${stageId}:${node.id}`] = { ...isObj(rec.value) ? rec.value : {}, name: node.name });
    }
    for (let rec of orphans) {
      if (!rec.name) continue;
      let ownKey = `${stageId}:${rec.nodeId}`;
      if (rec.stageId === stageId && !nodeKeys.has(ownKey) && !(ownKey in out)) {
        out[ownKey] = rec.value;
        continue;
      }
      let prefix = prefixOf(rec.nodeId), n = 0;
      for (; `${stageId}:${prefix}~${n}` in out; ) n += 1;
      out[`${stageId}:${prefix}~${n}`] = rec.value;
    }
    return out;
  }
  function offRecords(slots, stageId, links) {
    let out = [];
    for (let [slotId, slot] of Object.entries(slots || {})) {
      if (!slot || !Array.isArray(slot.off) || links.resolve(slotId) !== stageId) continue;
      let names2 = isObj(slot.offNames) ? slot.offNames : {};
      for (let nodeId of slot.off) out.push({ key: `${slotId}:${nodeId}`, stageId: slotId, nodeId: String(nodeId), name: names2[nodeId] ? String(names2[nodeId]) : "", value: !0 });
    }
    return out;
  }
  function resolveOff(slots, unit, links = NO_LINKS) {
    let own = slots && slots[unit.id];
    if (own && Array.isArray(own.off) && !isObj(own.offNames) && links.empty) return own.off;
    let nodes = stageNodes(unit.stage && unit.stage.data), records = offRecords(slots, unit.id, links);
    if (!records.length) return [];
    let { placed } = placeRecords(nodes, records, unit.id, links);
    return nodes.filter((node) => placed.has(node.id)).map((node) => node.id);
  }
  function realignOff(slots, unit, links = NO_LINKS) {
    let nodes = stageNodes(unit.stage && unit.stage.data), records = offRecords(slots, unit.id, links), { placed, orphans } = placeRecords(nodes, records, unit.id, links), off = [], offNames = {};
    for (let node of nodes)
      placed.has(node.id) && (off.push(node.id), offNames[node.id] = node.name);
    let counts = /* @__PURE__ */ new Map();
    for (let rec of orphans) {
      if (!rec.name) continue;
      let prefix = prefixOf(rec.nodeId), n = counts.get(prefix) || 0;
      counts.set(prefix, n + 1), off.push(`${prefix}~${n}`), offNames[`${prefix}~${n}`] = rec.name;
    }
    return { off, offNames };
  }
  function stable(value) {
    return Array.isArray(value) ? `[${value.map(stable).join(",")}]` : isObj(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value ?? null);
  }
  var KIND_MAP = { world: "clocks", side: "hooks" };
  function adoptAcross(map, units, kind) {
    let byName = /* @__PURE__ */ new Map();
    for (let unit of units)
      for (let node of stageNodes(unit.stage.data)) {
        if (node.kind !== kind) continue;
        let id = `${node.field}
${node.name}`;
        byName.set(id, byName.has(id) ? null : { unit, node });
      }
    let out = map;
    for (let [key, value] of Object.entries(map)) {
      if (!keyNode(key).includes("~") || !isObj(value) || !value.name) continue;
      let field2 = FIELD_OF[prefixOf(keyNode(key))], hit = byName.get(`${field2}
${value.name}`);
      if (!hit) continue;
      let target = `${hit.unit.id}:${hit.node.id}`;
      target in out || (out === map && (out = { ...map }), delete out[key], out[target] = { ...value, name: hit.node.name });
    }
    return out;
  }
  function alignProgress(progress, outline) {
    if (!progress || progress.infinite || !isObj(outline)) return progress;
    let units = flattenUnits(outline.volumes || []);
    if (!units.length) return progress;
    let links = outlineLinks(outline, units), live = new Set(units.map((unit) => unit.id)), fix = (id) => typeof id == "string" ? links.resolve(id) : id, uniq = (list) => [...new Set(list)], next = { ...progress };
    next.current = fix(progress.current), Array.isArray(progress.muted) && (next.muted = uniq(progress.muted.map(fix))), Array.isArray(progress.offMuted) && (next.offMuted = uniq(progress.offMuted.map(fix)));
    let oldSlots = isObj(progress.slots) ? progress.slots : {}, slots = {};
    for (let [id, slot] of Object.entries(oldSlots)) fix(id) === id && (slots[id] = slot);
    for (let [id, slot] of Object.entries(oldSlots)) {
      let to = fix(id);
      if (to === id) continue;
      let { off, offNames, ...rest } = isObj(slot) ? slot : {};
      slots[to] = { ...rest, ...isObj(slots[to]) ? slots[to] : {} };
    }
    for (let unit of units) {
      let orig = isObj(oldSlots[unit.id]) ? oldSlots[unit.id] : null, { off, offNames } = realignOff(oldSlots, unit, links);
      if (!off.length && !(orig && Array.isArray(orig.off) && orig.off.length)) continue;
      let { off: _off, offNames: _names, ...rest } = isObj(slots[unit.id]) ? slots[unit.id] : {};
      slots[unit.id] = off.length ? { ...rest, off, offNames } : rest;
    }
    if (next.slots = slots, isObj(progress.threads)) {
      let threads = { ...progress.threads };
      for (let [kind, field2] of Object.entries(KIND_MAP)) {
        let map = isObj(threads[field2]) ? threads[field2] : {};
        for (let unit of units) map = realignStage(map, unit.id, stageNodes(unit.stage.data).filter((node) => node.kind === kind), links);
        threads[field2] = adoptAcross(map, units, kind);
      }
      next.threads = threads;
    }
    return stable(next) === stable(progress) ? progress : next;
  }

  // src/core/persona-progress.js
  var PERSONA_RESERVED = ["muted", "manual", "auto", "names", "unlocked"], isObj2 = (value) => !!value && typeof value == "object" && !Array.isArray(value), strMap = (value) => Object.fromEntries(Object.entries(isObj2(value) ? value : {}).filter(([, item]) => typeof item == "string")), strList = (value) => Array.isArray(value) ? [...new Set(value.filter((item) => typeof item == "string"))] : [];
  function emptyPersonaProgress() {
    return { muted: [], manual: [], auto: {}, names: {}, unlocked: [] };
  }
  function normalizePersonaProgress(value) {
    let src = isObj2(value) ? value : {}, out = emptyPersonaProgress();
    for (let [key, item] of Object.entries(src)) !PERSONA_RESERVED.includes(key) && typeof item == "string" && (out[key] = item);
    return out.muted = strList(src.muted), out.manual = strList(src.manual), out.auto = strMap(src.auto), out.names = strMap(src.names), out.unlocked = strList(src.unlocked), out;
  }

  // src/core/progress.js
  var SETTING_SLOT = "@setting";
  var STATES = ["done", "active", "next", "todo"], STATE_LABELS = { done: "已过", active: "进行中", next: "下一段", todo: "未到" };
  function emptyProgress(projectId) {
    return { projectId, current: null, slots: {}, lastCheckFloor: 0, muted: [], offMuted: [], pace: "normal" };
  }
  function normalizeProgress(value, projectId) {
    let base = emptyProgress(projectId);
    if (!value || typeof value != "object") return base;
    let infinite = value.infinite && typeof value.infinite == "object" ? { infinite: normalizeInfiniteProgress(value.infinite) } : {}, out = {
      ...base,
      ...value,
      ...infinite,
      slots: value.slots && typeof value.slots == "object" ? value.slots : {},
      muted: Array.isArray(value.muted) ? value.muted : [],
      offMuted: Array.isArray(value.offMuted) ? value.offMuted : [],
      lastCheckFloor: Number(value.lastCheckFloor) || 0,
      pace: ["slow", "normal", "fast"].includes(value.pace) ? value.pace : "normal"
    };
    return value.personas && typeof value.personas == "object" && (out.personas = normalizePersonaProgress(value.personas)), Number(out.lastFailFloor) > 0 ? out.lastFailFloor = Number(out.lastFailFloor) : delete out.lastFailFloor, out;
  }
  function checkBase(progress) {
    return Math.max(Number(progress && progress.lastCheckFloor) || 0, Number(progress && progress.lastFailFloor) || 0);
  }
  function currentIndex(units, progress, links = NO_LINKS) {
    if (!units.length) return -1;
    let found = units.findIndex((unit) => unit.id === progress.current);
    if (found >= 0) return found;
    let to = progress.current ? links.resolve(progress.current) : "", aliased = to ? units.findIndex((unit) => unit.id === to) : -1;
    return aliased >= 0 ? aliased : 0;
  }
  function unitStates(units, progress, links = NO_LINKS) {
    let cur = currentIndex(units, progress, links), states = {};
    return units.forEach((unit, index) => {
      let derived = index < cur ? "done" : index === cur ? "active" : index === cur + 1 ? "next" : "todo", manual = progress.slots[unit.id] && progress.slots[unit.id].state;
      states[unit.id] = STATES.includes(manual) ? manual : derived;
    }), states;
  }
  function patchSlot(progress, slotId, patch) {
    let next = { ...progress.slots[slotId] || {}, ...patch };
    for (let key of Object.keys(next)) next[key] === void 0 && delete next[key];
    return { ...progress, slots: { ...progress.slots, [slotId]: next } };
  }
  function offNodes(progress, unit, links = NO_LINKS) {
    if (unit && typeof unit == "object") return resolveOff(progress.slots, unit, links);
    let slot = progress.slots[unit];
    return slot && Array.isArray(slot.off) ? slot.off : [];
  }
  function setNodeChecked(progress, unitId, nodeId, checked, name = "") {
    let slot = progress.slots[unitId] || {}, off = new Set(Array.isArray(slot.off) ? slot.off : []), names2 = slot.offNames && typeof slot.offNames == "object" ? { ...slot.offNames } : {};
    checked ? (off.delete(nodeId), delete names2[nodeId]) : (off.add(nodeId), name && (names2[nodeId] = name));
    let keepNames = Object.keys(names2).length || slot.offNames;
    return patchSlot(progress, unitId, { off: [...off], offNames: keepNames ? names2 : void 0 });
  }
  function uncheckByNames(progress, unitId, nodes, names2) {
    let wanted = new Set((names2 || []).map((name) => String(name).trim()).filter(Boolean)), counts = /* @__PURE__ */ new Map();
    for (let node of nodes) counts.set(node.name, (counts.get(node.name) || 0) + 1);
    let next = progress;
    for (let node of nodes)
      wanted.has(node.name) && counts.get(node.name) === 1 && (next = setNodeChecked(next, unitId, node.id, !1, node.name));
    return next;
  }
  function goTo(progress, units, unitId) {
    let slots = { ...progress.slots };
    for (let unit of units)
      if (slots[unit.id] && slots[unit.id].state) {
        let { state, ...rest } = slots[unit.id];
        slots[unit.id] = rest;
      }
    return { ...progress, current: unitId, slots };
  }
  function advance(progress, units) {
    let cur = currentIndex(units, progress);
    if (cur < 0 || cur >= units.length - 1) return null;
    let from = units[cur], to = units[cur + 1];
    return { progress: goTo(progress, units, to.id), from, to };
  }
  function isMuted(progress, unitId) {
    return progress.muted.includes(unitId);
  }
  function mute(progress, unitId) {
    return isMuted(progress, unitId) ? progress : { ...progress, muted: [...progress.muted, unitId] };
  }
  var CLUE_SLOT = "@clue";

  // src/core/wbtools.js
  var isRegexKey = (key) => /^\/.+\/[a-z]*$/i.test(key), SPLIT = /[,，、;；\n]/, TRIM = /^[\s　。，、；：！？,.;:!?]+|[\s　。，、；：！？,.;:!?]+$/g;
  function fixKeys(keys) {
    let out = [];
    for (let raw of keys) {
      let parts = isRegexKey(String(raw).trim()) ? [String(raw).trim()] : String(raw).split(SPLIT).map((part) => part.replace(TRIM, ""));
      for (let part of parts) part && !out.includes(part) && out.push(part);
    }
    return out;
  }
  function splitKeys(value) {
    let out = [];
    for (let line of String(value || "").split(/\r?\n/)) {
      let rest = line.trim();
      for (; rest; ) {
        let taken = 0;
        if (rest[0] === "/")
          for (let end = rest.length; end > 1; end--) {
            let head = rest.slice(0, end), after = rest.slice(end).trimStart();
            if (isRegexKey(head) && (!after || /^[,，、;；]/.test(after))) {
              taken = end;
              break;
            }
          }
        if (taken) {
          out.push(rest.slice(0, taken)), rest = rest.slice(taken).replace(/^\s*[,，、;；]?\s*/, "");
          continue;
        }
        let at = rest.search(SPLIT), part = (at < 0 ? rest : rest.slice(0, at)).trim();
        part && out.push(part), rest = at < 0 ? "" : rest.slice(at + 1).trim();
      }
    }
    return out;
  }
  var sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
  function punctPlan(entries) {
    let out = [];
    for (let entry of entries) {
      let key = fixKeys(entry.keys), second = fixKeys(entry.keysSecondary), patch = {};
      sameList(key, entry.keys) || (patch.key = key), sameList(second, entry.keysSecondary) || (patch.keysecondary = second), Object.keys(patch).length && out.push({ key: entry.key, title: entry.title, patch, before: [...entry.keys, ...entry.keysSecondary].join(" | "), after: [...key, ...second].join(" | ") });
    }
    return out;
  }
  function buildPattern(find, { regex = !1, ignoreCase = !1 } = {}) {
    if (!find) throw new Error("请填写要查找的内容");
    let source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return new RegExp(source, ignoreCase ? "gi" : "g");
    } catch (error) {
      throw new Error(`正则写法有误：${error.message}`);
    }
  }
  var countIn = (text2, pattern) => (String(text2).match(pattern) || []).length;
  function regexPlan(entries, pattern, replace, fields) {
    let sub = (text2) => String(text2).replace(pattern, replace), out = [];
    for (let entry of entries) {
      let patch = {}, hits = 0;
      if (fields.content && countIn(entry.content, pattern) && (hits += countIn(entry.content, pattern), patch.content = sub(entry.content)), fields.comment && entry.comment && countIn(entry.comment, pattern) && (hits += countIn(entry.comment, pattern), patch.comment = sub(entry.comment)), fields.keys)
        for (let [from, field2] of [[entry.keys, "key"], [entry.keysSecondary, "keysecondary"]]) {
          let n = from.reduce((sum, key) => sum + countIn(key, pattern), 0);
          n && (hits += n, patch[field2] = from.map(sub).map((key) => key.trim()).filter(Boolean));
        }
      hits && out.push({ key: entry.key, title: entry.title, patch, hits });
    }
    return out;
  }
  function orderPlan(entries, { start, step, by = "list" }) {
    let begin = Math.round(Number(start)), gap = Math.round(Number(step));
    if (!Number.isFinite(begin) || begin < 0) throw new Error("起始数字需为不小于 0 的整数");
    if (!Number.isFinite(gap) || gap < 1) throw new Error("间隔需为不小于 1 的整数");
    return (by === "order" ? entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.order - b.entry.order || a.index - b.index).map((item) => item.entry) : entries).map((entry, index) => ({ key: entry.key, title: entry.title, from: entry.order, to: begin + index * gap }));
  }
  var escapeRegex = (text2) => text2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function parseRegexKey(text2) {
    let match = text2.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match || /(^|[^\\])\//.test(match[1])) return null;
    try {
      return new RegExp(match[1].replace("\\/", "/"), match[2]);
    } catch {
      return null;
    }
  }
  function keyMatcher(key, { caseSensitive = null, matchWholeWords = null } = {}, globals = {}) {
    let text2 = String(key).trim(), regex = parseRegexKey(text2);
    if (regex) return (haystack) => regex.test(haystack);
    if (text2 === "") return () => !1;
    let sensitive = caseSensitive ?? !!globals.caseSensitive, whole = matchWholeWords ?? !!globals.matchWholeWords, fold = (value) => sensitive ? value : value.toLowerCase(), needle = fold(text2);
    if (whole && needle.split(/\s+/).length === 1) {
      let pattern = new RegExp(`(?:^|\\W)(${escapeRegex(needle)})(?:$|\\W)`);
      return (haystack) => pattern.test(fold(haystack));
    }
    return (haystack) => fold(haystack).includes(needle);
  }
  var matchedKeys = (keys, haystack, options2, globals) => keys.filter((key) => String(key).trim() && keyMatcher(key, options2, globals)(haystack)), matchesAny = (keys, haystack, options2 = {}, globals = {}) => matchedKeys(keys || [], String(haystack || ""), options2, globals).length > 0;
  function secondaryPass(logic, hit, total) {
    return logic === 1 ? hit < total : logic === 2 ? hit === 0 : logic === 3 ? hit === total : hit > 0;
  }
  function triggerTest(entries, text2, tokenOf2 = () => 0, globals = {}) {
    let haystack = String(text2 || ""), constant = [], keyword = [];
    for (let entry of entries) {
      if (entry.disabled) continue;
      let options2 = { caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords };
      if (entry.constant) {
        constant.push({ key: entry.key, title: entry.title, tokens: tokenOf2(entry) });
        continue;
      }
      let primary = matchedKeys(entry.keys, haystack, options2, globals);
      if (!primary.length) continue;
      let matched = primary, secondary = entry.selective === !1 ? [] : entry.keysSecondary.filter((key) => String(key).trim());
      if (secondary.length) {
        let logic = Number(entry.selectiveLogic) || 0, hit = matchedKeys(secondary, haystack, options2, globals);
        if (!secondaryPass(logic, hit.length, secondary.length)) continue;
        (logic === 0 || logic === 3) && (matched = [...primary, ...hit]);
      }
      keyword.push({ key: entry.key, title: entry.title, matched, tokens: tokenOf2(entry) });
    }
    let sum = (list) => list.reduce((total, item) => total + item.tokens, 0);
    return { constant, keyword, tokens: { constant: sum(constant), keyword: sum(keyword), total: sum(constant) + sum(keyword) } };
  }
  var isShortKey = (key) => {
    let text2 = String(key).trim();
    return !text2 || isRegexKey(text2) ? !1 : text2.length <= 1 || /^[A-Za-z]{1,2}$/.test(text2);
  };
  function healthCheck(entries, tokenOf2 = () => 0) {
    let on = entries.filter((entry) => !entry.disabled), shortKeys = [];
    for (let entry of on) {
      if (entry.constant) continue;
      let words = entry.keys.filter(isShortKey);
      words.length && shortKeys.push({ key: entry.key, title: entry.title, words });
    }
    let noKeys = on.filter((entry) => !entry.constant && !entry.keys.some((key) => String(key).trim())).map((entry) => ({ key: entry.key, title: entry.title })), byWord = /* @__PURE__ */ new Map();
    for (let entry of on)
      if (!entry.constant)
        for (let word of new Set(entry.keys.map((key) => String(key).trim()).filter(Boolean))) {
          let id = word.toLowerCase();
          byWord.has(id) || byWord.set(id, { word, entries: [] }), byWord.get(id).entries.push({ key: entry.key, title: entry.title });
        }
    let shared = [...byWord.values()].filter((item) => item.entries.length > 1), byTitle = /* @__PURE__ */ new Map();
    for (let entry of entries) {
      let id = String(entry.title).trim();
      byTitle.has(id) || byTitle.set(id, { title: id, entries: [] }), byTitle.get(id).entries.push({ key: entry.key, title: entry.title });
    }
    let dupTitles = [...byTitle.values()].filter((item) => item.entries.length > 1), constTokens = on.filter((entry) => entry.constant).reduce((sum, entry) => sum + tokenOf2(entry), 0), total = on.reduce((sum, entry) => sum + tokenOf2(entry), 0), ratio = total ? constTokens / total : 0;
    return { shortKeys, noKeys, shared, dupTitles, constant: { count: on.filter((entry) => entry.constant).length, tokens: constTokens, total, ratio, warn: ratio > 0.6 } };
  }
  function sortEntries(entries, mode, tokenOf2 = () => 0) {
    let list = entries.map((entry, index) => ({ entry, index })), by = {
      order: (a, b) => a.entry.order - b.entry.order,
      tokens: (a, b) => tokenOf2(b.entry) - tokenOf2(a.entry),
      title: (a, b) => String(a.entry.title).localeCompare(String(b.entry.title), "zh")
    }[mode];
    return by ? list.sort((a, b) => by(a, b) || a.index - b.index).map((item) => item.entry) : entries;
  }

  // src/core/personas.js
  var PERSONA_MODES = [
    { value: "check", label: "条件检测" },
    { value: "outline", label: "跟随大纲" },
    { value: "fame", label: "读声望/好感" },
    { value: "manual", label: "手动" }
  ], MODE_KEYS = PERSONA_MODES.map((item) => item.value), PERSONA_SLOT_PREFIX = "@persona:", FAVOR_DIMS = ["好感", "信任", "了解", "芥蒂", "欲望"], isObj3 = (value) => !!value && typeof value == "object" && !Array.isArray(value), text = (value) => String(value ?? ""), intOr = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Math.round(Number(value)) : fallback, num = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? void 0 : Number(value);
  function emptyPersonas() {
    return { lines: [], imported: [] };
  }
  function newStage(name = "新阶段") {
    return { id: makeId("ps"), name, cond: "", unitId: "", range: {}, extra: [], text: "" };
  }
  function newLine(name = "新人设", group = "") {
    return {
      id: makeId("pl"),
      group,
      name,
      keys: [],
      constant: !0,
      position: 0,
      depth: 4,
      role: 0,
      order: 100,
      enabled: !0,
      common: "",
      defaultStage: "",
      mode: "manual",
      fame: { source: "fame", dim: "好感", bar: "", partner: "" },
      stages: [newStage("阶段一")],
      source: null
    };
  }
  function normalizeExtra(value) {
    return (Array.isArray(value) ? value : []).filter(isObj3).map((item) => {
      let min = num(item.min), max = num(item.max);
      return { dim: FAVOR_DIMS.includes(item.dim) ? item.dim : "好感", ...min !== void 0 ? { min } : {}, ...max !== void 0 ? { max } : {} };
    });
  }
  function normalizeStage(value) {
    let src = isObj3(value) ? value : {}, range = isObj3(src.range) ? src.range : {}, min = num(range.min), max = num(range.max);
    return { id: text(src.id) || makeId("ps"), name: text(src.name).trim() || "阶段", cond: text(src.cond), unitId: text(src.unitId), extra: normalizeExtra(src.extra), range: { ...min !== void 0 ? { min } : {}, ...max !== void 0 ? { max } : {} }, text: text(src.text) };
  }
  function normalizeLine(value) {
    let src = isObj3(value) ? value : {}, stages = (Array.isArray(src.stages) ? src.stages : []).filter(isObj3).map(normalizeStage), fame = isObj3(src.fame) ? src.fame : {}, source = isObj3(src.source) ? src.source : null;
    return {
      id: text(src.id) || makeId("pl"),
      group: text(src.group).trim(),
      name: text(src.name).trim() || "未命名",
      keys: (Array.isArray(src.keys) ? src.keys : []).map((item) => text(item).trim()).filter(Boolean),
      constant: src.constant !== !1,
      position: intOr(src.position, 0),
      depth: Math.max(0, intOr(src.depth, 4)),
      role: intOr(src.role, 0),
      order: intOr(src.order, 100),
      enabled: src.enabled !== !1,
      common: text(src.common),
      mode: MODE_KEYS.includes(src.mode) ? src.mode : "check",
      fame: { source: fame.source === "favor" ? "favor" : "fame", dim: FAVOR_DIMS.includes(fame.dim) ? fame.dim : "好感", bar: text(fame.bar).trim(), partner: text(fame.partner).trim() },
      stages,
      // 默认阶段：所有条件都不符合（没推进过、没到任何大纲阶段、数值不在任何区间）时用的阶段；空表示第一阶段。
      defaultStage: stages.some((stage) => stage.id === text(src.defaultStage)) ? text(src.defaultStage) : "",
      source: source ? { book: text(source.book), uid: text(source.uid), varPath: text(source.varPath) } : null,
      // 一条线可能由几个条目的片段合并而成，恢复原条目时按它找回（比计划多存的字段）。
      sources: (Array.isArray(src.sources) ? src.sources : []).filter(isObj3).map((item) => ({ book: text(item.book), uid: text(item.uid), key: text(item.key ?? item.uid) }))
    };
  }
  function normalizePersonas(value) {
    let src = isObj3(value) ? value : {};
    return {
      lines: (Array.isArray(src.lines) ? src.lines : []).filter(isObj3).map(normalizeLine).map((line) => line.stages.length ? line : { ...line, stages: [newStage("阶段一")] }),
      imported: (Array.isArray(src.imported) ? src.imported : []).filter(isObj3).map((item) => ({ book: text(item.book), uid: text(item.uid), key: text(item.key ?? item.uid), title: text(item.title) }))
    };
  }
  var hasPersonas = (project) => !!(project && project.personas && Array.isArray(project.personas.lines) && project.personas.lines.length);
  function groupLines(lines2) {
    let groups = /* @__PURE__ */ new Map();
    for (let line of lines2) {
      let key = line.group || "";
      groups.has(key) || groups.set(key, []), groups.get(key).push(line);
    }
    return [...groups.entries()].sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : 0).map(([name, list]) => ({ name, lines: list }));
  }
  function rangeHas(range, value) {
    return Number.isFinite(value) ? (range.min === void 0 || value >= range.min) && (range.max === void 0 || value <= range.max) : !1;
  }
  function fameReading(line, fame, dimOverride = "") {
    let kind = line.fame.source === "favor" ? "favor" : "fame", name = line.fame.bar, bar = (Array.isArray(fame) ? fame : []).find((item) => item && (item.kind || "fame") === kind && (item.name === name || kind === "favor" && Array.isArray(item.aliases) && item.aliases.includes(name)));
    if (!bar) return null;
    if (kind === "favor") {
      let dim = dimOverride || line.fame.dim, value = bar.dims && dim in bar.dims ? Number(bar.dims[dim]) : dim === "好感" ? Number(bar.value) : NaN;
      return Number.isFinite(value) ? value : null;
    }
    if (line.fame.partner) {
      let pair = (Array.isArray(bar.pairs) ? bar.pairs : []).find((item) => item.partner === line.fame.partner);
      return pair ? Number(pair.value) : null;
    }
    return Number.isFinite(Number(bar.value)) ? Number(bar.value) : null;
  }
  var baseIndex = (line) => Math.max(0, line.stages.findIndex((stage) => stage.id === line.defaultStage)), storedIndex = (line, pp) => Math.max(0, line.stages.findIndex((stage) => stage.id === pp[line.id]));
  function outlineIndex(line, env) {
    let units = env.units || [], links = env.links || NO_LINKS, position = new Map(units.map((unit, i) => [unit.id, i])), best = -1, at = baseIndex(line);
    return line.stages.forEach((stage, i) => {
      if (!stage.unitId) return;
      let id = links.resolve(stage.unitId), pos = position.get(id);
      pos === void 0 || !["done", "active"].includes(env.states && env.states[id]) || pos >= best && (best = pos, at = i);
    }), at;
  }
  function rangeIndex(line, env) {
    let value = fameReading(line, env.fame);
    if (value === null) return -1;
    let hit = -1;
    return line.stages.forEach((stage, i) => {
      let extra = stage.extra || [];
      stage.range.min === void 0 && stage.range.max === void 0 && !extra.length || rangeHas(stage.range, value) && extra.every((item) => {
        let other = fameReading(line, env.fame, item.dim);
        return other !== null && rangeHas(item, other);
      }) && (hit = i);
    }), hit;
  }
  function fameIndex(line, env, pp = null) {
    let raw = rangeIndex(line, env);
    if (raw <= 0) return raw;
    let unlocked = pp ? pp.unlocked : [];
    for (let i = raw; i > 0; i--) {
      let stage = line.stages[i];
      if (!stage.cond.trim() || unlocked.includes(stage.id)) return i;
    }
    return baseIndex(line);
  }
  function currentStage(line, progress, env = {}) {
    let pp = normalizePersonaProgress(progress && progress.personas), manualHeld = pp.manual.includes(line.id), stored = storedIndex(line, pp), pick = (index, source, lost = !1, miss = !1) => ({ stage: line.stages[index], index, source, lost, miss });
    if (line.mode === "outline" && !manualHeld) return pick(outlineIndex(line, env), "outline");
    if (line.mode === "fame" && !manualHeld) {
      let index = fameIndex(line, env, pp);
      return index >= 0 ? pick(index, "fame") : fameReading(line, env.fame) === null ? pick(stored, "manual", !0) : pick(baseIndex(line), "fame", !1, !0);
    }
    return pick(stored, manualHeld ? "manual" : line.mode === "check" ? "check" : "manual");
  }
  function personaNote(line, progress, info) {
    return line.mode === "manual" ? "" : normalizePersonaProgress(progress && progress.personas).manual.includes(line.id) ? "手动" : line.mode !== "fame" ? "" : info.lost ? "读不到声望" : info.miss ? "数值不在任何区间" : "读声望中";
  }
  function personaEnv(project, progress, fame = [], stageStates = null) {
    let infinite = project && project.mode === "infinite", units = infinite || !project ? [] : flattenUnits(project.outline && project.outline.volumes), links = infinite || !units.length ? NO_LINKS : outlineLinks(project.outline, units);
    return { units, links, states: stageStates ?? (units.length ? unitStates(units, progress, links) : {}), fame };
  }
  var withPersonas = (progress, patch) => ({ ...progress, personas: { ...normalizePersonaProgress(progress && progress.personas), ...patch } }), without = (list, id) => list.filter((item) => item !== id);
  function setPersonaStage(progress, line, stageId, env = {}) {
    let pp = normalizePersonaProgress(progress && progress.personas), manual = line.mode === "manual" ? pp.manual : [.../* @__PURE__ */ new Set([...pp.manual, line.id])], stage = line.stages.find((item) => item.id === stageId);
    return withPersonas(progress, {
      [line.id]: stageId,
      manual,
      names: { ...pp.names, ...stage ? { [line.id]: stage.name } : {} }
    });
  }
  function releasePersona(progress, lineId) {
    let pp = normalizePersonaProgress(progress && progress.personas);
    return pp.manual.includes(lineId) ? withPersonas(progress, { manual: without(pp.manual, lineId) }) : progress;
  }
  function mutePersona(progress, lineId, muted = !0) {
    let pp = normalizePersonaProgress(progress && progress.personas), list = muted ? [.../* @__PURE__ */ new Set([...pp.muted, lineId])] : without(pp.muted, lineId);
    return list.length === pp.muted.length ? progress : withPersonas(progress, { muted: list });
  }
  function syncPersonas(project, progress, fame = [], stageStates = null) {
    if (!hasPersonas(project) || !progress) return progress;
    let pp = normalizePersonaProgress(progress.personas), env = personaEnv(project, progress, fame, stageStates), next = pp;
    for (let line of project.personas.lines) {
      if (line.mode !== "outline" && line.mode !== "fame") continue;
      let index = line.mode === "outline" ? outlineIndex(line, env) : fameIndex(line, env, pp);
      if (index < 0) continue;
      let stage = line.stages[index];
      if (next.auto[line.id] === stage.id) continue;
      let wasSet = next.auto[line.id] !== void 0;
      next = { ...next, auto: { ...next.auto, [line.id]: stage.id }, manual: wasSet ? without(next.manual, line.id) : next.manual };
    }
    return next === pp ? progress : { ...progress, personas: next };
  }
  function alignPersonaProgress(progress, personas2) {
    if (!progress || !progress.personas || !personas2) return progress;
    let pp = normalizePersonaProgress(progress.personas), next = { ...pp, names: { ...pp.names }, auto: { ...pp.auto } }, changed = !1, alive = new Set(personas2.lines.map((line) => line.id));
    for (let line of personas2.lines) {
      let id = pp[line.id];
      if (id === void 0) continue;
      let hit = line.stages.find((stage) => stage.id === id);
      if (hit) {
        next.names[line.id] !== hit.name && (next.names[line.id] = hit.name, changed = !0);
        continue;
      }
      let byName = line.stages.find((stage) => stage.name === pp.names[line.id]);
      byName ? next[line.id] = byName.id : (delete next[line.id], delete next.names[line.id]), changed = !0;
    }
    for (let key of Object.keys(next))
      PERSONA_RESERVED.includes(key) || alive.has(key) || (delete next[key], changed = !0);
    return changed ? { ...progress, personas: next } : progress;
  }
  function personaContent(line, stage) {
    return [line.common, stage && stage.text].map((item) => text(item).trim()).filter(Boolean).join(`
`);
  }
  function lineTriggered(line, recentText, globals = {}) {
    return line.constant ? !0 : line.keys.length > 0 && matchesAny(line.keys, recentText, {}, globals);
  }
  var personaSlotId = (line) => `${PERSONA_SLOT_PREFIX}${line.id}`;
  function buildPersonaEntries(project, progress, { recentText, globals, fame = [], stageStates = null } = {}) {
    if (!hasPersonas(project)) return [];
    let personas2 = project.personas, env = personaEnv(project, progress, fame, stageStates), out = [];
    for (let line of personas2.lines) {
      if (!line.enabled || recentText !== void 0 && !lineTriggered(line, recentText, globals)) continue;
      let { stage } = currentStage(line, progress, env), content = personaContent(line, stage);
      content && out.push({
        slotId: personaSlotId(line),
        kind: "persona",
        title: `人设·${line.group ? `${line.group}·` : ""}${line.name}`,
        lineId: line.id,
        content,
        position: line.position,
        depth: line.depth,
        role: line.role,
        order: line.order,
        enabled: !0
      });
    }
    return out;
  }
  function checkItems(project, progress, recentText, { globals = {}, fame = [], stageStates = null } = {}) {
    if (!hasPersonas(project) || !progress) return [];
    let pp = normalizePersonaProgress(progress.personas), env = personaEnv(project, progress, fame, stageStates), out = [];
    for (let line of project.personas.lines) {
      if (!line.enabled || line.mode !== "check" && line.mode !== "fame" || pp.muted.includes(line.id) || !lineTriggered(line, recentText, globals)) continue;
      let { stage, index } = currentStage(line, progress, env), next = line.stages[index + 1], unlock = !1;
      if (line.mode === "fame") {
        let raw = rangeIndex(line, env);
        if (raw < 0 || pp.manual.includes(line.id)) continue;
        next = line.stages.slice(1, raw + 1).find((item) => item.cond.trim() && !pp.unlocked.includes(item.id)), unlock = !0;
      }
      next && out.push({ lineId: line.id, group: line.group, name: line.name, from: stage.name, fromId: stage.id, to: next.name, toId: next.id, cond: next.cond.trim(), wasManual: pp.manual.includes(line.id), unlock });
    }
    return out;
  }
  var itemLabel = (item) => `${item.group ? `${item.group} · ` : ""}${item.name}`;
  function resolveMoves(items, moves) {
    let out = [];
    for (let move of Array.isArray(moves) ? moves : []) {
      let key = text(move && move.line).trim(), to = text(move && move.to).trim(), item = items.find((entry) => entry.name === key || itemLabel(entry) === key || `${entry.group}·${entry.name}` === key || `${entry.group}${entry.name}` === key);
      !item || out.some((entry) => entry.item === item) || to !== item.to && to !== item.toId || out.push({ item, floor: Number(move.floor) > 0 ? Math.round(Number(move.floor)) : 0, reason: text(move.reason).trim() });
    }
    return out;
  }
  var moveText = (move) => `${itemLabel(move.item)}：${move.item.from} → ${move.item.to}${move.floor || move.reason ? `（${move.floor ? `第 ${move.floor} 楼` : ""}${move.floor && move.reason ? "：" : ""}${move.reason}）` : ""}`;
  function applyMoves(progress, project, moves) {
    let next = progress;
    for (let move of moves) {
      let line = project.personas.lines.find((item) => item.id === move.item.lineId);
      if (line) {
        if (move.item.unlock) {
          let pp = normalizePersonaProgress(next.personas);
          next = releasePersona(withPersonas(next, { unlocked: [.../* @__PURE__ */ new Set([...pp.unlocked, move.item.toId])] }), line.id);
          continue;
        }
        next = releasePersona(setPersonaStage(next, line, move.item.toId), line.id);
      }
    }
    return next;
  }
  function undoMoves(progress, project, moves) {
    let next = progress;
    for (let move of moves) {
      let line = project.personas.lines.find((item) => item.id === move.item.lineId);
      if (!line) continue;
      let pp = normalizePersonaProgress(next.personas);
      if (move.item.unlock) {
        next = withPersonas(next, { unlocked: pp.unlocked.filter((id) => id !== move.item.toId) });
        continue;
      }
      let manual = move.item.wasManual ? [.../* @__PURE__ */ new Set([...pp.manual, line.id])] : pp.manual.filter((id) => id !== line.id);
      next = withPersonas(next, { [line.id]: move.item.fromId, manual, names: { ...pp.names, [line.id]: move.item.from } });
    }
    return next;
  }

  // src/core/threads.js
  var isObj4 = (value) => !!value && typeof value == "object" && !Array.isArray(value), str = (value) => String(value ?? "").trim(), clamp = (value, min, max) => Math.max(min, Math.min(max, value)), int = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0, CLOCK_MAX_TICK = 2, DEFAULT_HOOK_CAP = 2;
  function clockSize(item) {
    if (!isObj4(item)) return 0;
    let size = int(item.进度钟);
    return size >= 2 ? Math.min(12, size) : 0;
  }
  function hookCondition(item) {
    return isObj4(item) ? str(item.条件) : "";
  }
  function hookSteps(item) {
    if (!isObj4(item)) return [];
    let value = item.步骤;
    return (Array.isArray(value) ? value : String(value ?? "").split(`
`)).map((entry) => isObj4(entry) ? Object.values(entry).join("：") : String(entry ?? "")).map((text2) => text2.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, "").trim()).filter(Boolean);
  }
  function hookLimit(item) {
    if (!isObj4(item)) return null;
    let value = str(item.时限);
    return value ? /^\d+$/.test(value) && Number(value) > 0 ? { floors: Number(value) } : value === "本卷" ? { volume: !0 } : null : null;
  }
  function isThreadNode(node) {
    return node ? node.kind === "world" ? clockSize(node.item) > 0 : node.kind === "side" ? !!(hookCondition(node.item) || hookSteps(node.item).length || hookLimit(node.item)) : !1 : !1;
  }
  var threadKey = (unit, node) => `${unit.id}:${node.id}`;
  function threadSwitches(project) {
    let raw = project && isObj4(project.threads) ? project.threads : {};
    return { sideOn: raw.sideOn !== !1, worldOn: raw.worldOn !== !1 };
  }
  function maskUnits(units, sw) {
    if (!sw || sw.sideOn && sw.worldOn) return units;
    let drop = [...sw.sideOn ? [] : ["支线事件"], ...sw.worldOn ? [] : ["世界动态"]];
    return (units || []).map((unit) => {
      let data = { ...unit.stage.data };
      for (let field2 of drop) delete data[field2];
      return { ...unit, stage: { ...unit.stage, data } };
    });
  }
  function threadState(progress) {
    let raw = progress && isObj4(progress.threads) ? progress.threads : {};
    return {
      clocks: isObj4(raw.clocks) ? raw.clocks : {},
      hooks: isObj4(raw.hooks) ? raw.hooks : {},
      ignored: Array.isArray(raw.ignored) ? raw.ignored : []
    };
  }
  function withState(progress, patch) {
    return { ...progress, threads: { ...threadState(progress), ...patch } };
  }
  var mapOf = (node) => node.kind === "world" ? "clocks" : "hooks", unitOfKey = (key) => key.slice(0, key.indexOf(":")), nodeOfKey = (key) => key.slice(key.indexOf(":") + 1), kindNodes = (unit, field2) => stageNodes(unit.stage && unit.stage.data).filter((node) => node.kind === (field2 === "clocks" ? "world" : "side"));
  function patchLive(progress, item, patch) {
    let field2 = mapOf(item.node), state = threadState(progress)[field2], map = item.unit.stage ? realignStage(state, item.unit.id, kindNodes(item.unit, field2), item.links || NO_LINKS) : { ...state }, next = patch === null ? { name: item.node.name } : { ...item.saved, ...patch, name: item.node.name };
    for (let name of Object.keys(next)) next[name] === void 0 && delete next[name];
    return map[item.key] = next, withState(progress, { [field2]: map });
  }
  function remapNodes(progress, unitId, prefix, mapIndex) {
    let pattern = new RegExp(`^${prefix}(\\d+)$`), move = (id) => {
      let match = pattern.exec(id);
      if (!match) return id;
      let to = mapIndex(Number(match[1]));
      return to == null ? null : `${prefix}${to}`;
    }, next = progress, slot = progress.slots && progress.slots[unitId];
    if (slot && Array.isArray(slot.off)) {
      let moved = { ...slot, off: slot.off.map(move).filter(Boolean) };
      if (slot.offNames && typeof slot.offNames == "object") {
        moved.offNames = {};
        for (let [id, name] of Object.entries(slot.offNames)) {
          let to = move(id);
          to && (moved.offNames[to] = name);
        }
      }
      next = { ...next, slots: { ...next.slots, [unitId]: moved } };
    }
    if (!progress.threads) return next;
    let state = threadState(next), remap = (map) => {
      let out = {};
      for (let [key, value] of Object.entries(map)) {
        if (unitOfKey(key) !== unitId) {
          out[key] = value;
          continue;
        }
        let id = move(nodeOfKey(key));
        id && (out[`${unitId}:${id}`] = value);
      }
      return out;
    };
    return withState(next, { clocks: remap(state.clocks), hooks: remap(state.hooks) });
  }
  function renameNode(progress, unit, node) {
    let next = progress, slot = progress.slots && progress.slots[unit.id], offName = slot && slot.offNames && slot.offNames[node.id];
    if (offName && offName !== node.name && (next = { ...next, slots: { ...next.slots, [unit.id]: { ...slot, offNames: { ...slot.offNames, [node.id]: node.name } } } }), node.kind === "main") return next;
    let field2 = mapOf(node), map = threadState(next)[field2], key = threadKey(unit, node);
    return !map[key] || !map[key].name || map[key].name === node.name ? next : withState(next, { [field2]: { ...map, [key]: { ...map[key], name: node.name } } });
  }
  function renameByPosition(progress, units, links = NO_LINKS) {
    let next = progress;
    for (let unit of units || []) {
      let nodes = stageNodes(unit.stage.data);
      for (let node of nodes) {
        let siblings = nodes.filter((other) => other.field === node.field), known = (name) => siblings.some((other) => other.name === name || other !== node && links.family(unit.id, other.field, other.name).has(name)), slot = next.slots && next.slots[unit.id], offName = slot && slot.offNames && slot.offNames[node.id], saved = node.kind === "main" ? null : threadState(next)[mapOf(node)][threadKey(unit, node)];
        [offName, saved && saved.name].some((name) => name && name !== node.name && !known(name)) && (next = renameNode(next, unit, node));
      }
    }
    return next;
  }
  function migrateStageThreads(progress, oldStages, newStages, keepId) {
    let oldIds = new Set(oldStages.map((stage) => stage.id)), state = threadState(progress), pool = [];
    for (let stage of oldStages) {
      let unit = { id: stage.id, stage }, off = new Set(offNodes(progress, unit)), nodes = stageNodes(stage.data), placed = { clocks: placeStageMap(state.clocks, stage.id, nodes.filter((node) => node.kind === "world")), hooks: placeStageMap(state.hooks, stage.id, nodes.filter((node) => node.kind === "side")) };
      for (let node of nodes) {
        let field2 = mapOf(node), hit = node.kind === "main" ? null : placed[field2].get(node.id);
        pool.push({ field: node.field, name: node.name, map: field2, value: hit && Object.keys(hit.saved).length ? hit.saved : null, off: off.has(node.id), used: !1 });
      }
    }
    let strip = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !oldIds.has(unitOfKey(key)))), clocks = strip(state.clocks), hooks = strip(state.hooks), slots = { ...progress.slots }, kept = slots[keepId] ? { ...slots[keepId] } : null;
    for (let id of oldIds) delete slots[id];
    kept && (delete kept.off, delete kept.offNames, slots[keepId] = kept);
    for (let stage of newStages) {
      let off = [], offNames = {};
      for (let node of stageNodes(stage.data)) {
        let from = pool.find((item) => !item.used && item.field === node.field && item.name === node.name);
        from && (from.used = !0, from.off && (off.push(node.id), offNames[node.id] = node.name), from.value && ((from.map === "clocks" ? clocks : hooks)[`${stage.id}:${node.id}`] = { ...from.value, name: node.name }));
      }
      off.length && (slots[stage.id] = { ...slots[stage.id] || {}, off, offNames });
    }
    let next = { ...progress, slots, current: oldIds.has(progress.current) ? keepId : progress.current };
    return progress.threads || Object.keys(clocks).length || Object.keys(hooks).length ? withState(next, { clocks, hooks }) : next;
  }
  function clampThreads(progress, floors) {
    let changed = !1, fix = (map, fields) => {
      let out = {};
      for (let [key, value] of Object.entries(map)) {
        let item = value;
        for (let field2 of fields) {
          let top = field2 === "lastTickFloor" ? floors : Math.max(1, floors);
          item && Number(item[field2]) > top && (item = { ...item, [field2]: top }, changed = !0);
        }
        out[key] = item;
      }
      return out;
    }, state = threadState(progress), clocks = fix(state.clocks, ["lastTickFloor"]), hooks = fix(state.hooks, ["at", "since", "shownAt"]), slots = {};
    for (let [id, slot] of Object.entries(progress.slots || {}))
      slots[id] = slot && Number(slot.since) > floors ? { ...slot, since: floors } : slot, slots[id] !== slot && (changed = !0);
    return changed ? progress.threads ? withState({ ...progress, slots }, { clocks, hooks }) : { ...progress, slots } : progress;
  }
  function ignoreThread(progress, name) {
    let { ignored } = threadState(progress);
    return ignored.includes(name) ? progress : withState(progress, { ignored: [...ignored, name] });
  }
  function clockPhase(clock) {
    return clock.done ? "done" : clock.filled >= clock.total ? "due" : clock.total - clock.filled === 1 ? "near" : clock.filled * 2 >= clock.total ? "omen" : "hidden";
  }
  function liveThreads(units, states, progress, { carryOver = !0, hookCap = DEFAULT_HOOK_CAP, links = NO_LINKS } = {}) {
    let { clocks: savedClocks, hooks: savedHooks } = threadState(progress), active = (units || []).find((unit) => states[unit.id] === "active"), clocks = [], hooks = [];
    for (let unit of units || []) {
      let state = states[unit.id];
      if (state !== "done" && state !== "active") continue;
      let off = new Set(offNodes(progress, unit, links)), carried = state === "done", nodes = stageNodes(unit.stage.data), placed = { world: placeStageMap(savedClocks, unit.id, nodes.filter((node) => node.kind === "world"), links), side: placeStageMap(savedHooks, unit.id, nodes.filter((node) => node.kind === "side"), links) }, savedFor = (node) => placed[node.kind].get(node.id) || { saved: {}, savedKey: threadKey(unit, node) };
      for (let node of nodes) {
        if (!isThreadNode(node)) continue;
        let key = threadKey(unit, node), item = node.item;
        if (node.kind === "world") {
          let total = clockSize(item), { saved: saved2, savedKey: savedKey2 } = savedFor(node), done = !!saved2.done;
          clocks.push({ key, savedKey: savedKey2, saved: saved2, links, unit, node, carried, total, filled: done ? total : clamp(int(saved2.filled), 0, total), done, lastTick: int(saved2.lastTickFloor), omen: str(item.前兆), after: str(item.后果), event: str(item.内容 || item.事件) });
          continue;
        }
        let { saved, savedKey } = savedFor(node), steps = hookSteps(item), step = clamp(int(saved.step), 0, steps.length), pooled = !!hookCondition(item), at = pooled ? int(saved.at) : 0, since = pooled ? 0 : int(saved.since) || int(saved.at), started = pooled && at > 0 || step > 0 || !!saved.expired;
        if (carried && !carryOver && !started) continue;
        let status = off.has(node.id) ? "done" : saved.expired ? "expired" : pooled && !at ? "wait" : "active", keepVol = Number.isFinite(Number(saved.keepVol)) && saved.keepVol !== null && saved.keepVol !== "" ? int(saved.keepVol) : -1;
        hooks.push({ key, savedKey, saved, links, unit, node, carried, status, pooled, at, since, shownAt: int(saved.shownAt), steps, step, keepVol, cond: hookCondition(item), limit: hookLimit(item), miss: str(item.错过) });
      }
    }
    let cap = Math.max(1, int(hookCap) || DEFAULT_HOOK_CAP);
    return hooks.filter((hook) => hook.status === "active" && hook.pooled).sort((a, b) => (a.shownAt ? 0 : 1) - (b.shownAt ? 0 : 1) || (a.shownAt && b.shownAt ? a.shownAt - b.shownAt : a.at - b.at)).forEach((hook, index) => {
      index >= cap && (hook.status = "queue");
    }), labelDuplicates(clocks), labelDuplicates(hooks), { clocks, hooks, activeVol: active ? active.volIndex : -1, hookCap: cap };
  }
  function labelDuplicates(list) {
    let count = /* @__PURE__ */ new Map();
    for (let item of list) count.set(item.node.name, (count.get(item.node.name) || 0) + 1);
    let used = /* @__PURE__ */ new Set();
    for (let item of list) {
      let label = item.node.name;
      if (count.get(label) > 1) {
        let base = `${label}（${splitStageKey(item.unit.stage.key).short}）`;
        label = base;
        for (let n = 2; used.has(label); n += 1) label = `${base}${n}`;
      }
      used.add(label), item.label = label;
    }
  }
  var fromText = (item) => item.carried ? `（来自${splitStageKey(item.unit.stage.key).short}）` : "", indexName = (item) => item.label === item.node.name ? `${item.node.name}${fromText(item)}` : item.label;
  function stepText(hook) {
    return hook.steps.length ? `第 ${Math.min(hook.step + 1, hook.steps.length)}/${hook.steps.length} 步` : "";
  }
  function hookLine(hook) {
    let item = isObj4(hook.node.item) ? hook.node.item : {}, body = (hook.steps.length ? [item.地点, `${stepText(hook)}：${hook.steps[hook.step] || ""}`] : [item.地点, item.事件 || item.内容, item.触发 ? `触发：${item.触发}` : ""]).map(str).filter(Boolean);
    return `- 支线｜${hook.node.name}${fromText(hook)}${body.length ? `：${body.join("；")}` : ""}`;
  }
  function clockLine(clock) {
    let phase = clockPhase(clock), name = `- 世界动态｜${clock.node.name}`;
    return phase === "omen" ? `${name}：已有风声，可在正文里略微透露。${clock.omen ? `风声：${clock.omen}` : ""}` : phase === "near" ? `${name}：迫在眉睫，很快就会发生。${clock.omen ? `征兆：${clock.omen}` : ""}` : `${name}：本段必须发生。${clock.event}`;
  }
  function threadsText(live) {
    let parts = [], hooks = live.hooks.filter((hook) => hook.status === "active");
    hooks.length && parts.push(`
可在合适时机自然安排的支线（不必强行发生；支线链只写当前一步）：
${hooks.map(hookLine).join(`
`)}`);
    let clocks = live.clocks.filter((clock) => !["hidden", "done"].includes(clockPhase(clock)));
    return clocks.length && parts.push(`
正在酝酿的世界事件（还没有发生，按各条标明的程度写进正文）：
${clocks.map(clockLine).join(`
`)}`), parts.join("");
  }
  function threadIndexLines(live) {
    let lines2 = [], marks = { wait: "待触发", active: "已激活", queue: "已激活·排队", expired: "已过期" }, hooks = live.hooks.filter((hook) => hook.status !== "done");
    if (hooks.length) {
      lines2.push("【支线钩子】");
      for (let hook of hooks) {
        let chain = hook.steps.length && hook.status !== "wait" && hook.status !== "expired", mark = chain ? `${stepText(hook)}${hook.status === "queue" ? "·排队" : ""}` : marks[hook.status], item = isObj4(hook.node.item) ? hook.node.item : {}, detail = hook.status === "wait" ? `条件：${hook.cond}` : chain ? hook.steps[hook.step] : str(item.事件 || item.内容);
        lines2.push(`  - [${mark}] 支线｜${indexName(hook)}${detail ? `：${detail.replace(/\s+/g, " ").slice(0, 120)}` : ""}`);
      }
    }
    let clocks = live.clocks.filter((clock) => !clock.done);
    if (clocks.length) {
      lines2.push("【世界进度钟】");
      for (let clock of clocks) {
        let name = clock.label === clock.node.name ? `${clock.node.name} ${clock.filled}/${clock.total}${fromText(clock)}` : `${clock.label} ${clock.filled}/${clock.total}`;
        lines2.push(`  - ${name}${clock.event ? `：${clock.event.replace(/\s+/g, " ").slice(0, 120)}` : ""}`);
      }
    }
    return lines2;
  }
  function threadChangeLines(live) {
    return live ? [
      ...live.clocks.filter((clock) => clock.done && clock.after).map((clock) => `- ${clock.after}（世界动态「${clock.node.name}」）`),
      ...live.hooks.filter((hook) => hook.status === "expired" && hook.miss).map((hook) => `- ${hook.miss}（错过支线「${hook.node.name}」）`)
    ] : [];
  }
  function checkThreads(live, { newThreadMode = "ask", ignored = [], readTo = 0 } = {}) {
    let newThread = newThreadMode !== "off";
    return {
      clocks: live.clocks.filter((clock) => !clock.done).map((clock) => ({ name: clock.label || clock.node.name, filled: clock.filled, total: clock.total })),
      hooks: live.hooks.some((hook) => hook.status !== "done" && hook.status !== "expired"),
      newThread,
      ignored: newThread ? (ignored || []).map(str).filter(Boolean).slice(-10) : [],
      readTo: int(readTo)
    };
  }
  function applyCheck(progress, live, result, { floor = 0 } = {}) {
    let next = progress, events = [], writes = /* @__PURE__ */ new Map(), write = (item, patch) => writes.set(item, { ...writes.get(item) || {}, ...patch }), label = (item) => item.label || item.node.name, done = new Set((result.done || []).map(str));
    for (let tick of result.clocks || []) {
      let clock = live.clocks.find((item) => !item.done && label(item) === tick.name);
      if (!clock || writes.has(clock)) continue;
      if (tick.happened) {
        write(clock, { filled: clock.total, done: !0, lastTickFloor: floor || void 0 }), events.push({ type: "clock-done", name: clock.node.name });
        continue;
      }
      if (floor > 0 && clock.lastTick >= floor) continue;
      let step = Math.min(CLOCK_MAX_TICK, int(tick.tick));
      if (!step) continue;
      let filled = clamp(clock.filled + step, 0, clock.total);
      filled !== clock.filled && (write(clock, { filled, done: !1, lastTickFloor: floor || void 0 }), events.push({ type: filled >= clock.total ? "clock-due" : "clock-tick", name: clock.node.name, filled, total: clock.total }));
    }
    let triggered = new Set((result.hooks || []).map(str)), freed = /* @__PURE__ */ new Set();
    for (let hook of live.hooks) {
      if (hook.status === "done") continue;
      let name = label(hook), at = hook.at, step = hook.step, expired = hook.status === "expired", fresh = !1;
      hook.pooled && !at && (triggered.has(name) || done.has(name)) && (at = floor, fresh = !0, write(hook, { at }), events.push({ type: "hook-on", name: hook.node.name }));
      let since = hook.since;
      if (!hook.pooled && !since) {
        let slot = next.slots && next.slots[hook.unit.id];
        since = int(slot && slot.since) || floor, since && write(hook, { since });
      }
      if (done.has(name))
        if (hook.steps.length && step + 1 < hook.steps.length)
          step += 1, write(hook, { step, expired: void 0 }), events.push({ type: "chain-step", name: hook.node.name, step, total: hook.steps.length }), expired = !1;
        else {
          hook.steps.length && write(hook, { step: hook.steps.length }), next = setNodeChecked(next, hook.unit.id, hook.node.id, !1, hook.node.name), events.push({ type: "hook-done", name: hook.node.name }), freed.add(hook);
          continue;
        }
      if (expired || step > 0 || !hook.limit) continue;
      let start = since;
      if (hook.pooled) {
        if (fresh || hook.status !== "active") continue;
        start = hook.shownAt || hook.at;
      }
      start > 0 && (hook.limit.floors ? floor - start > hook.limit.floors : live.activeVol >= 0 && live.activeVol > Math.max(hook.unit.volIndex, hook.keepVol)) && (write(hook, { expired: !0 }), events.push({ type: "hook-expired", name: hook.node.name }), freed.add(hook));
    }
    let cap = live.hookCap || DEFAULT_HOOK_CAP, shown = live.hooks.filter((hook) => hook.pooled && hook.status === "active" && !freed.has(hook));
    for (let hook of shown) hook.shownAt || write(hook, { shownAt: floor || hook.at });
    let room = cap - shown.length, waiting = live.hooks.filter((hook) => hook.pooled && !freed.has(hook) && (hook.status === "queue" || hook.status === "wait" && writes.has(hook) && writes.get(hook).at !== void 0)).map((hook) => ({ hook, at: hook.status === "queue" ? hook.at : writes.get(hook).at })).sort((a, b) => a.at - b.at);
    for (let { hook } of waiting) {
      if (room <= 0) break;
      write(hook, { shownAt: floor || 1 }), room -= 1;
    }
    for (let [item, patch] of writes) next = patchLive(next, item, patch);
    return { progress: next, events };
  }
  function addPlayerThread(volumes, stageId, thread) {
    let node = { 名称: str(thread.name), 事件: str(thread.summary), 来源: "玩家" };
    return node.事件 || delete node.事件, volumes.map((volume) => volume.stages.some((stage) => stage.id === stageId) ? {
      ...volume,
      stages: volume.stages.map((stage) => stage.id === stageId ? { ...stage, data: { ...stage.data, 支线事件: [...Array.isArray(stage.data.支线事件) ? stage.data.支线事件 : [], node] } } : stage)
    } : volume);
  }
  function hasNodeNamed(units, name) {
    return (units || []).some((unit) => stageNodes(unit.stage.data).some((node) => node.name === name));
  }

  // src/core/inject.js
  var POSITIONS = [
    { value: 0, label: "角色定义前", short: "↑Char" },
    { value: 1, label: "角色定义后", short: "↓Char" },
    { value: 2, label: "作者注释前", short: "↑AN" },
    { value: 3, label: "作者注释后", short: "↓AN" },
    { value: 5, label: "示例消息前", short: "↑EM" },
    { value: 6, label: "示例消息后", short: "↓EM" },
    { value: 4, label: "@D 深度", short: "@D" }
  ], ROLES = [
    { value: 0, label: "系统" },
    { value: 1, label: "用户" },
    { value: 2, label: "AI" }
  ], DEFAULT_PARAMS = {
    setting: { position: 0, depth: 4, role: 0, order: 80, enabled: !0 },
    detail: { position: 0, depth: 4, role: 0, order: 100, enabled: !0 }
  }, OLD_DEFAULT_PARAMS = {
    setting: { position: 1, depth: 4, role: 0, order: 80 },
    detail: { position: 4, depth: 4, role: 0, order: 100 }
  };
  function positionLabel(entry) {
    let pos = POSITIONS.find((item) => item.value === Number(entry.position));
    if (!pos) return "?";
    if (pos.value !== 4) return pos.short;
    let role = ROLES.find((item) => item.value === Number(entry.role));
    return `@D${Number(entry.depth) || 0}${role && role.value ? `·${role.label}` : ""}`;
  }
  function pickParams(base, slot) {
    let out = { ...base };
    for (let key of ["enabled"])
      slot && slot[key] !== void 0 && slot[key] !== null && slot[key] !== "" && (out[key] = slot[key]);
    return out.position = Number(out.position), out.depth = Math.max(0, Number(out.depth) || 0), out.role = Number(out.role) || 0, out.order = Number(out.order) || 0, out.enabled = out.enabled !== !1, out;
  }
  function stagePlace(unit) {
    return `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
  }
  function rangeOf(unit) {
    let value = unit.stage.data && unit.stage.data.时间范围;
    return value ? String(value).trim() : "";
  }
  var LATER_LIMIT = 6;
  function nodeLine(node, mark) {
    let event = node.item && node.item.事件 ? `：${String(node.item.事件).replace(/\s+/g, " ").slice(0, 120)}` : "";
    return `  - ${mark ? `[${mark}] ` : ""}${node.label}｜${node.name}${event}`;
  }
  function buildIndexText(units, states, progress, { carryOver = !0, hookCap, links = NO_LINKS } = {}) {
    let lines2 = [], done = units.filter((unit) => states[unit.id] === "done"), active = units.filter((unit) => states[unit.id] === "active"), next = units.filter((unit) => states[unit.id] === "next"), later = units.filter((unit) => states[unit.id] === "todo");
    if (done.length) {
      lines2.push("【已过】");
      for (let unit of done) {
        let names2 = stageNodes(unit.stage.data).filter((node) => node.kind === "main").map((node) => node.name);
        lines2.push(`- ${stagePlace(unit)}${names2.length ? `（${names2.join("／")}）` : ""}`);
      }
    }
    for (let unit of active) {
      let off = new Set(offNodes(progress, unit, links)), range = rangeOf(unit);
      lines2.push("【当前】", `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ""}`);
      for (let node of stageNodes(unit.stage.data).filter((item) => item.kind !== "world" && !isThreadNode(item)))
        lines2.push(nodeLine(node, off.has(node.id) ? "已演" : "未演"));
      if (carryOver)
        for (let { node } of carriedNodes(units, states, progress, { links }))
          node.kind !== "world" && lines2.push(nodeLine(node, "未演·延续"));
    }
    active.length && lines2.push(...threadIndexLines(liveThreads(units, states, progress, { carryOver, hookCap, links })));
    for (let unit of next) {
      let range = rangeOf(unit), instr = unit.stage.data && unit.stage.data.AI指令;
      lines2.push("【下一段】", `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ""}`), instr && lines2.push(`  AI指令：${String(instr).trim()}`);
      for (let node of stageNodes(unit.stage.data).filter((item) => item.kind === "main")) lines2.push(nodeLine(node, ""));
    }
    if (later.length) {
      lines2.push("【之后】");
      for (let unit of later.slice(0, LATER_LIMIT)) lines2.push(`- ${stagePlace(unit)}`);
      later.length > LATER_LIMIT && lines2.push(`- ……另有 ${later.length - LATER_LIMIT} 段`);
    }
    return lines2.join(`
`);
  }
  var PACES = [
    { value: "slow", label: "慢速" },
    { value: "normal", label: "正常" },
    { value: "fast", label: "快速" }
  ], PLAN = "以下是当前正在进行、尚未演完的剧情规划，列出的事件还没有发生，不要当作已发生的事实或前情。", PACE_TEXT = {
    slow: `${PLAN}节奏放慢：以眼前正在进行的场景和人物互动为主，细写当下，每次回复最多推进一小步，不急于触发下一个节点。`,
    normal: `${PLAN}按正文进展自然推进到这些事件，不必一次写完。`,
    fast: `${PLAN}节奏加快：尽快让尚未发生的节点依次发生，次要细节一笔带过，收束本阶段并过渡到下一阶段。`
  };
  function paceText(settings, pace) {
    let key = PACE_TEXT[pace] ? pace : "normal";
    return String(settings.paceText && settings.paceText[key] || "").trim() || PACE_TEXT[key];
  }
  function carriedNodes(units, states, progress, { withOff = !1, links = NO_LINKS } = {}) {
    let out = [];
    for (let unit of units) {
      if (states[unit.id] !== "done") continue;
      let off = new Set(offNodes(progress, unit, links));
      for (let node of stageNodes(unit.stage.data))
        node.kind === "main" || isThreadNode(node) || (off.has(node.id) ? withOff && out.push({ unit, node, off: !0 }) : out.push({ unit, node, off: !1 }));
    }
    return out;
  }
  function carriedText(carried) {
    return carried.length ? `
延续自前面阶段、尚未发生的支线与世界动态（可在合适时机自然安排，不必强行发生）：
${carried.map(({ unit, node }) => {
      let item = node.item && typeof node.item == "object" ? node.item : {}, parts = [item.地点, item.事件 || item.内容, item.触发 ? `触发：${item.触发}` : ""].filter(Boolean).map((value) => String(value).trim());
      return `- ${node.label}｜${node.name}（来自${splitStageKey(unit.stage.key).short}）${parts.length ? `：${parts.join("；")}` : ""}`;
    }).join(`
`)}` : "";
  }
  function buildDetailText(unit, off, settings, { pace = "normal", next = null, carried = [], threads = "", withGuide = !0, stay = "" } = {}) {
    let tag = String(settings.tagName || "剧情参考").trim() || "剧情参考", data = filterStageData(unit.stage.data, [
      ...off,
      ...stageNodes(unit.stage.data).filter(isThreadNode).map((node) => node.id)
    ]), body = stringifyYaml({ [unit.stage.key]: data }).trimEnd(), vol = splitVolumeKey(unit.volume.key).short, note = paceText(settings, pace);
    if (pace === "fast" && next) {
      let range = rangeOf(next);
      note += `
下一阶段：${stagePlace(next)}${range ? `（${range}）` : ""}`;
    }
    let guide = withGuide ? bodyGuideText(settings) : "";
    return `<${tag} 卷="${vol}" 阶段="${unit.stage.key}">
${guide ? `${guide}

` : ""}${note}
${stay ? `${stay}
` : ""}${body}${carriedText(carried)}${threads}
</${tag}>`;
  }
  function changesText(units, states, live = null) {
    let lines2 = units.filter((unit) => states[unit.id] === "done").flatMap((unit) => changeLines(unit.stage.data).map((text2) => `- ${text2}（${stagePlace(unit)}）`)).concat(threadChangeLines(live));
    return lines2.length ? `已演完的剧情带来的变化（设定里对应的开局状态以这里为准）：
${lines2.join(`
`)}` : "";
  }
  function buildEntries(project, progress, settings, personaOpts = {}) {
    let options2 = typeof personaOpts == "function" ? { stayOf: personaOpts } : personaOpts || {}, base = buildOutlineEntries(project, progress, settings, options2.stayOf), persona = project ? buildPersonaEntries(project, progress, options2) : [];
    return persona.length ? [...base, ...persona] : base;
  }
  function buildOutlineEntries(project, progress, settings, stayOf = () => "") {
    let defaults = { ...DEFAULT_PARAMS, ...project && project.defaults }, entries = [];
    if (!project) return entries;
    let infinite = project.mode === "infinite", allUnits = infinite ? [] : flattenUnits(project.outline && project.outline.volumes), units = maskUnits(allUnits, threadSwitches(project)), links = infinite ? NO_LINKS : outlineLinks(project.outline, allUnits), states = unitStates(units, progress, links), threadOpts = { carryOver: settings.carryOver !== !1, hookCap: settings.hookCap, links }, live = infinite ? null : liveThreads(units, states, progress, threadOpts), done = infinite || units === allUnits ? live : liveThreads(allUnits, states, progress, threadOpts), settingText = [injectedSetting(project.setting), changesText(units, states, done)].filter(Boolean).join(`

`);
    if (settingText && entries.push({
      slotId: SETTING_SLOT,
      kind: "setting",
      title: "设定",
      content: settingText,
      ...pickParams(defaults.setting, progress.slots[SETTING_SLOT])
    }), infinite) {
      let inf = progress.infinite || emptyInfinite();
      return entries.push({
        slotId: INFINITE_SLOT,
        kind: "detail",
        title: "无限流状态",
        content: buildInfiniteDetail(inf, project.infinite && project.infinite.config),
        ...pickParams(defaults.detail, progress.slots[INFINITE_SLOT])
      }), entries;
    }
    if (units.length) {
      let next = units.find((unit) => states[unit.id] === "next") || null, carried = settings.carryOver === !1 ? [] : carriedNodes(units, states, progress, { links }), threads = threadsText(live), guided = !1;
      for (let unit of units) {
        if (states[unit.id] !== "active") continue;
        let off = offNodes(progress, unit, links), params = pickParams(defaults.detail, progress.slots[unit.id]), own = params.enabled ? threads : "";
        entries.push({
          slotId: unit.id,
          kind: "detail",
          title: `${volumeLabel(unit.volume.key)}·${splitStageKey(unit.stage.key).short}`,
          unit,
          content: buildDetailText(unit, off, settings, {
            pace: progress.pace,
            next,
            carried,
            threads: own,
            stay: stayOf(unit),
            withGuide: !guided && params.enabled
          }),
          ...params
        }), params.enabled && (threads = "", guided = !0);
      }
    }
    return entries;
  }
  var VIRTUAL_BASE_UID = 99e4;
  function toWorldInfoEntry(entry, index, world) {
    return {
      uid: VIRTUAL_BASE_UID + index,
      world,
      key: [],
      keysecondary: [],
      comment: `剧情注入器·${entry.title}`,
      content: entry.content,
      constant: !0,
      vectorized: !1,
      selective: !1,
      selectiveLogic: 0,
      addMemo: !0,
      order: entry.order,
      position: entry.position,
      disable: !1,
      ignoreBudget: !0,
      excludeRecursion: !0,
      preventRecursion: !1,
      matchPersonaDescription: !1,
      matchCharacterDescription: !1,
      matchCharacterPersonality: !1,
      matchCharacterDepthPrompt: !1,
      matchScenario: !1,
      matchCreatorNotes: !1,
      delayUntilRecursion: 0,
      probability: 100,
      useProbability: !1,
      depth: entry.depth,
      outletName: "",
      group: "",
      groupOverride: !1,
      groupWeight: 100,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      useGroupScoring: null,
      automationId: "",
      role: entry.role,
      sticky: null,
      cooldown: null,
      delay: null,
      triggers: []
    };
  }
  var BODY_GUIDE = [
    "<knowledge>",
    "每个角色都按自己亲历、听说或有理由推断的事情行动。角色不知道的事，不会无缘无故去暗示、试探，也不会话里有话。角色可以起疑、猜错、隐瞒自己的心事；这些反应要能从他自己的经历、性格和眼前的处境里找到理由。有人说出一个猜测时，角色按自己掌握的信息回应。即使猜测碰巧说中，旁白也不替任何人确认。",
    "</knowledge>",
    "",
    "<progression>",
    "从人物眼前正在做的事接着写，让这一步自然产生的反应和结果发生。一次交谈可以只改变两个人之间的气氛，也可以因为一句话说开，当场改变关系。事情已经有了结果，就让结果落地；下一步需要用户表态或选择时，把那一步留给用户。",
    "如果用户的选择或人物已经做出的行动改变了原定情节，就沿着实际发生的变化继续写。原先安排的一幕可以换个时机、换种方式，也可以就此错过。",
    "</progression>"
  ].join(`
`);
  function bodyGuideText(settings) {
    return settings && settings.bodyGuide === !1 ? "" : settings && String(settings.bodyGuideText || "").trim() || BODY_GUIDE;
  }

  // src/core/acu.js
  var ACU = /^TavernDB-ACU/i, CUSTOM = /^TavernDB-ACU-CustomExport-/i, TAIL = /-(?:\d+|包裹|上|下)$/, EN_FIELD = "英文字段";
  function acuField(title2) {
    let name = String(title2 || "");
    if (!ACU.test(name)) return "";
    let rest = name.replace(CUSTOM, "");
    return rest === name || !/^[一-鿿]/.test(rest) ? EN_FIELD : rest.replace(TAIL, "") || rest;
  }
  function groupByField(entries) {
    let map = /* @__PURE__ */ new Map();
    for (let entry of entries) {
      let field2 = acuField(entry.title);
      field2 && (map.has(field2) || map.set(field2, []), map.get(field2).push(entry));
    }
    return [...map].sort(([a], [b]) => +(a === EN_FIELD) - +(b === EN_FIELD));
  }

  // src/core/refs.js
  var DEFAULT_WB_RULE = { fields: {}, picks: {} }, DEFAULT_MEMO = 10, MEMO_FIELD = /^纪要表?$/, INDEX_FIELD = /纪要/;
  function entryRefId(book, entry) {
    return acuField(entry.title) ? `${book}|t:${entry.title}` : `${book}|k:${entry.key}`;
  }
  function normalizeWbRule(value) {
    let src = value && typeof value == "object" ? value : {}, fields = {}, picks = {};
    if (src.fields && typeof src.fields == "object") for (let [name, on] of Object.entries(src.fields)) name && typeof on == "boolean" && (fields[name] = on);
    if (src.picks && typeof src.picks == "object") for (let [id, on] of Object.entries(src.picks)) typeof on == "boolean" && (picks[id] = on);
    return { fields, picks };
  }
  var isMemoField = (field2) => MEMO_FIELD.test(field2);
  function fieldChecked(rule, field2) {
    return Object.prototype.hasOwnProperty.call(rule.fields, field2) ? rule.fields[field2] : INDEX_FIELD.test(field2) && !isMemoField(field2);
  }
  var rowNo = (entry) => {
    let match = /-(\d+)$/.exec(entry.title);
    return match ? Number(match[1]) : -1;
  };
  function defaultSet(rule, books, memo = DEFAULT_MEMO) {
    let out = /* @__PURE__ */ new Set();
    for (let book of books) {
      let memos = [];
      for (let entry of book.entries) {
        let field2 = acuField(entry.title);
        if (!field2) {
          entry.disabled || out.add(entryRefId(book.name, entry));
          continue;
        }
        isMemoField(field2) ? memos.push(entry) : fieldChecked(rule, field2) && out.add(entryRefId(book.name, entry));
      }
      memos.sort((a, b) => rowNo(b) - rowNo(a)).slice(0, Math.max(0, memo)).forEach((entry) => out.add(entryRefId(book.name, entry)));
    }
    return out;
  }
  function checkedSet(rule, books, memo = DEFAULT_MEMO) {
    let out = defaultSet(rule, books, memo);
    for (let [id, on] of Object.entries(rule.picks))
      on ? out.add(id) : out.delete(id);
    return out;
  }
  function ruleFromSelection(books, fields, checked, memo = DEFAULT_MEMO) {
    let rule = { fields: {}, picks: {} };
    for (let [field2, on] of Object.entries(fields)) !isMemoField(field2) && on !== fieldChecked(rule, field2) && (rule.fields[field2] = on);
    let base = defaultSet(rule, books, memo);
    for (let book of books)
      for (let entry of book.entries) {
        let id = entryRefId(book.name, entry), on = checked.has(id);
        on !== base.has(id) && (rule.picks[id] = on);
      }
    return rule;
  }
  function migrateOc(oc) {
    let rule = { fields: {}, picks: {} };
    for (let item of Array.isArray(oc) ? oc : [])
      item && item.book && acuField(item.title) && (rule.picks[`${item.book}|t:${item.title}`] = !0);
    return rule;
  }

  // src/core/store.js
  var INDEX_FILE = "pi-index.json", projectFile = (id) => `pi-p-${id}.json`, chatFile = (id) => `pi-c-${id}.json`, FILE_PREFIX = "pi-", LLM_ROLES = [
    { key: "discuss", label: "讨论" },
    { key: "outline", label: "写设定与大纲" },
    { key: "check", label: "进度检测" }
  ], DEFAULT_LLM = { source: "tavern", endpoint: "", apiKey: "", model: "", temperature: "" };
  var CONN_KEYS = ["endpoint", "apiKey", "model", "temperature"];
  function pickConn(src) {
    let out = {};
    for (let key of CONN_KEYS) out[key] = String(src && src[key] != null ? src[key] : "").trim();
    return out;
  }
  function normalizePreset(value) {
    let src = value && typeof value == "object" ? value : {};
    return { id: String(src.id || "").trim(), name: String(src.name || "").trim(), ...pickConn(src) };
  }
  function normalizeLlm(src) {
    let presets = (Array.isArray(src.presets) ? src.presets : []).map(normalizePreset).filter((item) => item.id), llm = {};
    for (let { key } of LLM_ROLES) {
      let role = src.llm && src.llm[key] && typeof src.llm[key] == "object" ? src.llm[key] : {}, linked = role.source === "preset" && presets.find((item) => item.id === role.presetId);
      linked ? llm[key] = { source: "custom", ...pickConn(linked) } : role.source === "custom" ? llm[key] = { source: "custom", ...pickConn(role) } : llm[key] = { ...DEFAULT_LLM, ...pickConn(role), source: "tavern" };
    }
    return { llm, presets };
  }
  function resolveLlm(settings, role) {
    let llm = settings.llm && settings.llm[role];
    return llm && llm.source === "custom" ? { ...llm } : { source: "tavern" };
  }
  var DEFAULT_SETTINGS = {
    tagName: "剧情参考",
    // 正文通用提示（角色知情、剧情推进，GPT §20.1）：随本轮剧情材料注入一次；没有材料时不出现。
    bodyGuide: !0,
    bodyGuideText: "",
    offTrackMode: "ask",
    personaMode: "ask",
    carryOver: !0,
    handleMode: "ask",
    hookCap: 2,
    newThreadMode: "ask",
    checkEvery: 3,
    checkFloors: 3,
    // 写作基准：generic（通用，默认）/ fanfic（同人世界观速成）/ custom（用 guide 里的自定义文本）。
    guidePreset: "generic",
    // 新手教程看过哪些页（41a_ui_tour.js）：{ revision, done: [页名] }。revision 不等于 TOUR_REVISION 时视为都没看过。
    tourState: null,
    guide: "",
    persona: "",
    paceText: { slow: "", normal: "", fast: "" },
    loaderRef: "",
    llm: { discuss: { ...DEFAULT_LLM }, outline: { ...DEFAULT_LLM }, check: { ...DEFAULT_LLM } },
    presets: []
  }, HANDLE_MODES = ["ask", "auto", "nodes"], OFF_MODES = ["ask", "auto", "off"], THREAD_MODES = ["ask", "auto", "off"], PERSONA_MODES2 = ["ask", "auto", "off"];
  function normalizeSettings(value) {
    let src = value && typeof value == "object" ? value : {}, { llm, presets } = normalizeLlm(src);
    return {
      ...DEFAULT_SETTINGS,
      ...src,
      offTrackMode: OFF_MODES.includes(src.offTrackMode) ? src.offTrackMode : DEFAULT_SETTINGS.offTrackMode,
      personaMode: PERSONA_MODES2.includes(src.personaMode) ? src.personaMode : DEFAULT_SETTINGS.personaMode,
      carryOver: src.carryOver !== !1,
      bodyGuide: src.bodyGuide !== !1,
      bodyGuideText: String(src.bodyGuideText || ""),
      // 以前改过写作基准的（只有 guide、没有 guidePreset）算作自定义。
      guidePreset: ["generic", "fanfic", "custom"].includes(src.guidePreset) ? src.guidePreset : String(src.guide || "").trim() ? "custom" : "generic",
      guide: String(src.guide || ""),
      handleMode: HANDLE_MODES.includes(src.handleMode) ? src.handleMode : DEFAULT_SETTINGS.handleMode,
      hookCap: Math.max(1, Math.min(6, Math.round(Number(src.hookCap)) || DEFAULT_SETTINGS.hookCap)),
      newThreadMode: THREAD_MODES.includes(src.newThreadMode) ? src.newThreadMode : DEFAULT_SETTINGS.newThreadMode,
      checkEvery: Math.max(1, Math.min(50, Number(src.checkEvery) || DEFAULT_SETTINGS.checkEvery)),
      checkFloors: Math.max(1, Math.min(20, Number(src.checkFloors) || DEFAULT_SETTINGS.checkFloors)),
      persona: typeof src.persona == "string" ? src.persona : "",
      paceText: Object.fromEntries(["slow", "normal", "fast"].map((key) => [key, String(src.paceText && src.paceText[key] || "")])),
      llm,
      presets
    };
  }
  function emptyIndex() {
    return { version: 1, active: {}, projects: [], files: [], settings: normalizeSettings({}) };
  }
  function normalizeIndex(value) {
    let src = value && typeof value == "object" ? value : {}, projects = Array.isArray(src.projects) ? src.projects.filter((item) => item && typeof item.id == "string") : [];
    return {
      version: 1,
      active: src.active && typeof src.active == "object" ? src.active : {},
      projects: projects.map((item) => ({
        id: item.id,
        name: String(item.name || "未命名"),
        group: String(item.group || ""),
        updatedAt: Number(item.updatedAt) || 0,
        bytes: item.bytes && typeof item.bytes == "object" ? item.bytes : {},
        ...Array.isArray(item.imports) ? { imports: item.imports.filter((x) => typeof x == "string") } : {}
      })),
      files: Array.isArray(src.files) ? src.files.filter((name) => typeof name == "string" && name.startsWith(FILE_PREFIX)) : [],
      settings: normalizeSettings(src.settings)
    };
  }
  function newProject(name, now = Date.now(), mode = "normal") {
    return {
      version: 1,
      id: makeId("p"),
      name: String(name || "").trim() || "新项目",
      createdAt: now,
      clue: normalizeClue({}),
      setting: { text: "", history: [], check: "", fixes: [], mute: [] },
      outline: { volumes: [], history: [], renames: [], idAlias: {} },
      defaults: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
      genRefs: normalizeGenRefs(),
      personas: emptyPersonas(),
      mode: mode === "infinite" ? "infinite" : "normal",
      ...mode === "infinite" ? { infinite: normalizeInfinite({}) } : {}
    };
  }
  function normalizeProject(value, id) {
    let src = value && typeof value == "object" ? value : {}, setting = src.setting && typeof src.setting == "object" ? src.setting : {}, volumes = src.outline && Array.isArray(src.outline.volumes) ? src.outline.volumes : [];
    return {
      version: 1,
      id: src.id || id,
      name: String(src.name || "未命名"),
      createdAt: Number(src.createdAt) || 0,
      setting: {
        text: String(setting.text || ""),
        history: Array.isArray(setting.history) ? setting.history : [],
        check: String(setting.check || ""),
        fixes: Array.isArray(setting.fixes) ? setting.fixes : [],
        mute: Array.isArray(setting.mute) ? setting.mute.map(String) : []
      },
      outline: {
        history: src.outline && Array.isArray(src.outline.history) ? src.outline.history.filter((item) => item && typeof item.text == "string") : [],
        // 跨聊天对照表（见 core/align.js）：节点改名最多 200 条，阶段 id 别名最多 300 条。
        renames: normalizeRenames(src.outline && src.outline.renames),
        idAlias: normalizeAlias(src.outline && src.outline.idAlias),
        volumes: volumes.filter((vol) => vol && Array.isArray(vol.stages)).map((vol) => ({
          id: vol.id || makeId("v"),
          key: String(vol.key || "剧情_未命名"),
          ...vol.line && typeof vol.line == "object" && !Array.isArray(vol.line) ? { line: vol.line } : {},
          stages: vol.stages.filter((stage) => stage && stage.data && typeof stage.data == "object").map((stage) => ({ id: stage.id || makeId("s"), key: String(stage.key || "阶段"), data: stage.data }))
        }))
      },
      defaults: normalizeDefaults(src.defaults),
      clue: normalizeClue(src.clue),
      ...src.outlineIdMap && typeof src.outlineIdMap == "object" ? { outlineIdMap: src.outlineIdMap } : {},
      imports: Array.isArray(src.imports) ? src.imports.filter((x) => typeof x == "string") : [],
      importAdopted: Array.isArray(src.importAdopted) ? src.importAdopted.filter((x) => typeof x == "string") : [],
      genRefs: normalizeGenRefs(src.genRefs),
      personas: normalizePersonas(src.personas),
      threads: { sideOn: !(src.threads && src.threads.sideOn === !1), worldOn: !(src.threads && src.threads.worldOn === !1) },
      mode: src.mode === "infinite" ? "infinite" : "normal",
      ...src.infinite && typeof src.infinite == "object" ? { infinite: normalizeInfinite(src.infinite) } : {},
      // 批量导入支线采用后的对应（GPT 代码审阅 R4）：{ "任务id:原编号": 卷id }。之后再采用同一任务的线，引用照这个改到实际的新编号。
      ...src.importLineMap && typeof src.importLineMap == "object" && !Array.isArray(src.importLineMap) ? { importLineMap: Object.fromEntries(Object.entries(src.importLineMap).filter(([, v]) => typeof v == "string")) } : {}
    };
  }
  function normalizeGenRefs(value) {
    let src = value && typeof value == "object" ? value : {}, memo = Number(src.memo);
    return {
      talk: src.talk !== !1,
      memo: Number.isFinite(memo) ? Math.max(0, Math.min(100, Math.round(memo))) : DEFAULT_MEMO,
      wb: src.wb ? normalizeWbRule(src.wb) : { ...DEFAULT_WB_RULE, fields: {}, picks: {} }
    };
  }
  function normalizeDefaults(value) {
    let out = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    for (let kind of Object.keys(out)) {
      let saved = value && value[kind];
      if (!saved || typeof saved != "object") continue;
      let old = OLD_DEFAULT_PARAMS[kind], untouched = Object.keys(old).every((key) => Number(saved[key]) === old[key]);
      out[kind] = untouched ? { ...out[kind], enabled: saved.enabled !== !1 } : { ...out[kind], ...saved };
    }
    return out;
  }
  function emptyChat() {
    return {
      version: 1,
      summary: "",
      messages: [],
      refs: { setting: !0, outline: !1, progress: !0, floors: 10, memo: DEFAULT_MEMO, wb: DEFAULT_WB_RULE }
    };
  }
  function normalizeRefs(value) {
    let src = value && typeof value == "object" ? value : {}, floors = Number(src.floors), memo = Number(src.memo);
    return {
      setting: src.setting !== !1,
      outline: !!src.outline,
      progress: src.progress !== !1,
      floors: Number.isFinite(floors) ? Math.max(0, Math.min(50, Math.round(floors))) : 10,
      memo: Number.isFinite(memo) ? Math.max(0, Math.min(100, Math.round(memo))) : DEFAULT_MEMO,
      wb: src.wb ? normalizeWbRule(src.wb) : migrateOc(src.oc)
    };
  }
  function normalizeChat(value) {
    let src = value && typeof value == "object" ? value : {};
    return {
      version: 1,
      summary: String(src.summary || ""),
      messages: Array.isArray(src.messages) ? src.messages.filter((msg) => msg && typeof msg.content == "string").map((msg) => ({
        id: msg.id || makeId("m"),
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
        at: Number(msg.at) || 0,
        folded: !!msg.folded
      })) : [],
      refs: normalizeRefs(src.refs)
    };
  }
  function groupProjects(projects) {
    let groups = /* @__PURE__ */ new Map();
    for (let project of [...projects].sort((a, b) => b.updatedAt - a.updatedAt)) {
      let key = project.group || "";
      groups.has(key) || groups.set(key, []), groups.get(key).push(project);
    }
    return [...groups.entries()].sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "zh")).map(([name, items]) => ({ name, items }));
  }
  function formatBytes(bytes) {
    let n = Number(bytes) || 0;
    return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  // src/app/data.js
  function createDataStore({ onChange: onChange8 = () => {
  }, onError = () => {
  } } = {}) {
    let index = emptyIndex(), ready = !1, projects = /* @__PURE__ */ new Map(), chats = /* @__PURE__ */ new Map(), loading = /* @__PURE__ */ new Map(), failed = /* @__PURE__ */ new Set(), writer = createWriter({
      onSaved(name, bytes) {
        if (failed.delete(name), name === INDEX_FILE) return;
        let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1], meta2 = index.projects.find((item) => item.id === id), kind = name.startsWith("pi-p-") ? "project" : "chat", knownFile = index.files.includes(name);
        meta2 && meta2.bytes[kind] !== bytes && (index = {
          ...index,
          projects: index.projects.map(
            (item) => item === meta2 ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item
          )
        }), knownFile || (index = { ...index, files: [...index.files, name] }), (!knownFile || meta2 && meta2.bytes[kind] !== bytes) && writer.schedule(INDEX_FILE, index), onChange8("saved");
      },
      onError(name, error) {
        failed.add(name), onError(error), onChange8("save-failed");
      }
    });
    function setIndex(next) {
      index = next, writer.schedule(INDEX_FILE, index), onChange8("index");
    }
    async function init() {
      let file = await readJsonFile(INDEX_FILE);
      index = normalizeIndex(file && file.value), index.files.includes(INDEX_FILE) || (index = { ...index, files: [INDEX_FILE, ...index.files] }), ready = !0, onChange8("index");
    }
    async function loadProject(id) {
      if (projects.has(id)) return projects.get(id);
      if (loading.has(`p:${id}`)) return loading.get(`p:${id}`);
      let job = (async () => {
        let file = await readJsonFile(projectFile(id)), project = file ? normalizeProject(file.value, id) : null;
        return project && (projects.set(id, project), syncImportIndex(project)), project;
      })().finally(() => loading.delete(`p:${id}`));
      return loading.set(`p:${id}`, job), job;
    }
    function syncImportIndex(project) {
      let ids = Array.isArray(project.imports) ? project.imports : [], meta2 = index.projects.find((item) => item.id === project.id);
      if (!meta2 || !ids.length) return;
      let names2 = ids.flatMap((x) => [importSrcFile(x), importJobFile(x)]), missingIds = ids.filter((x) => !(meta2.imports || []).includes(x)), missingFiles = names2.filter((n) => !index.files.includes(n));
      (missingIds.length || missingFiles.length) && setIndex({
        ...index,
        files: [...index.files, ...missingFiles],
        projects: index.projects.map(
          (item) => item === meta2 ? { ...item, imports: [...item.imports || [], ...missingIds] } : item
        )
      });
    }
    function touch(id, patch = {}) {
      setIndex({
        ...index,
        projects: index.projects.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)
      });
    }
    function saveProject(project) {
      projects.set(project.id, project), writer.schedule(projectFile(project.id), project), touch(project.id, { name: project.name }), onChange8("project", project.id);
    }
    function updateProject(id, fn) {
      let current = projects.get(id);
      if (!current) throw new Error("项目尚未载入");
      let value = fn(current), next = value && value !== current ? normalizeProject(value, id) : value;
      return next && next !== current && saveProject(next), next;
    }
    async function createProject(name, group = "", mode = "normal") {
      let project = newProject(name, Date.now(), mode);
      projects.set(project.id, project);
      let bytes = await writeJsonFile(projectFile(project.id), project);
      return index = {
        ...index,
        projects: [
          ...index.projects,
          { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } }
        ],
        files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)]
      }, writer.schedule(INDEX_FILE, index), onChange8("index"), project;
    }
    let imports = createImportStore(), rawCreate = imports.create, rawDrop = imports.drop;
    imports.create = async (opts) => {
      let job = await rawCreate(opts), names2 = [importSrcFile(job.id), importJobFile(job.id)];
      return setIndex({
        ...index,
        files: [...index.files, ...names2.filter((n) => !index.files.includes(n))],
        projects: index.projects.map(
          (item) => item.id === job.projectId ? { ...item, imports: [...item.imports || [], job.id] } : item
        )
      }), job;
    }, imports.drop = async (id) => {
      await rawDrop(id);
      let names2 = /* @__PURE__ */ new Set([importSrcFile(id), importJobFile(id)]);
      setIndex({
        ...index,
        files: index.files.filter((n) => !names2.has(n)),
        projects: index.projects.map(
          (item) => item.imports && item.imports.includes(id) ? { ...item, imports: item.imports.filter((x) => x !== id) } : item
        )
      });
    };
    async function deleteProject(id) {
      let p = projects.get(id) || await loadProject(id).catch(() => null);
      for (let jobId of p && Array.isArray(p.imports) ? p.imports : []) await imports.drop(jobId).catch(() => {
      });
      writer.cancel(projectFile(id)), writer.cancel(chatFile(id)), await deleteFile(projectFile(id)), await deleteFile(chatFile(id)), projects.delete(id), chats.delete(id);
      let active = { ...index.active };
      for (let key of Object.keys(active)) active[key] === id && delete active[key];
      setIndex({
        ...index,
        active,
        projects: index.projects.filter((item) => item.id !== id),
        files: index.files.filter((name) => name !== projectFile(id) && name !== chatFile(id))
      });
    }
    async function loadChat(id) {
      if (chats.has(id)) return chats.get(id);
      let file = await readJsonFile(chatFile(id)), chat = normalizeChat(file && file.value);
      return chats.set(id, chat), chat;
    }
    function saveChat(id, chat) {
      chats.set(id, chat), writer.schedule(chatFile(id), chat), onChange8("chat", id);
    }
    async function clearChat(id) {
      writer.cancel(chatFile(id)), await deleteFile(chatFile(id)), chats.set(id, emptyChat());
      let meta2 = index.projects.find((item) => item.id === id);
      setIndex({
        ...index,
        files: index.files.filter((name) => name !== chatFile(id)),
        projects: index.projects.map((item) => item === meta2 ? { ...item, bytes: { ...item.bytes, chat: 0 } } : item)
      });
    }
    function activeIdFor(key = cardKey()) {
      let id = key ? index.active[key] : "";
      return id && index.projects.some((item) => item.id === id) ? id : "";
    }
    function setActive(id, key = cardKey()) {
      if (!key) throw new Error("请先打开一张角色卡");
      let active = { ...index.active };
      id ? active[key] = id : delete active[key], setIndex({ ...index, active }), id && touch(id);
    }
    function updateSettings(patch) {
      setIndex({ ...index, settings: normalizeSettings({ ...index.settings, ...patch }) });
    }
    function forgetFiles(names2) {
      let drop = new Set(names2);
      setIndex({ ...index, files: index.files.filter((name) => !drop.has(name)) });
    }
    function resetAll() {
      for (let name of [...index.files]) writer.cancel(name);
      projects.clear(), chats.clear(), index = emptyIndex(), onChange8("index");
    }
    return {
      init,
      isReady: () => ready,
      index: () => index,
      settings: () => index.settings,
      project: (id) => projects.get(id) || null,
      loadProject,
      saveProject,
      updateProject,
      createProject,
      deleteProject,
      renameProject: (id, name, group) => {
        let project = projects.get(id);
        project && name && project.name !== name && saveProject({ ...project, name }), touch(id, { ...name ? { name } : {}, ...group !== void 0 ? { group } : {} });
      },
      loadChat,
      chat: (id) => chats.get(id) || null,
      saveChat,
      clearChat,
      activeIdFor,
      setActive,
      updateSettings,
      forgetFiles,
      resetAll,
      failedFiles: () => [...failed],
      retryFailed: async () => {
        await writer.flush(), await imports.flush();
      },
      flush: async () => {
        await writer.flush(), await imports.flush();
      },
      imports
    };
  }

  // src/core/clue-progress.js
  var CLUE_OP_KINDS = ["open", "done", "skip", "fact", "focus", "pause", "line"];
  function anchorOf(chat, index) {
    let list = Array.isArray(chat) ? chat : [], i = Number.isInteger(index) && index >= 0 && index < list.length ? index : list.length - 1, msg = list[i];
    return i < 0 || !msg ? { i: -1, swipe: 0, stamp: "" } : { i, swipe: Number(msg.swipe_id) || 0, stamp: String(msg.send_date ?? "") };
  }
  function anchorValid(at, chat) {
    if (!at || at.i < 0) return !0;
    let msg = Array.isArray(chat) ? chat[at.i] : null;
    return !!msg && (Number(msg.swipe_id) || 0) === at.swipe && String(msg.send_date ?? "") === at.stamp;
  }
  function normalizeClueOps(value) {
    let src = isPlainObject(value) ? value : {};
    return {
      // ops 是重建人工状态的依据，不截断；只做无损压缩（见 compactClueOps）。
      ops: (Array.isArray(src.ops) ? src.ops : []).filter(
        (op) => isPlainObject(op) && CLUE_OP_KINDS.includes(op.kind) && typeof op.target == "string"
      ),
      log: Array.isArray(src.log) ? src.log.slice(-60) : []
    };
  }
  function effectiveClueProgress(clueOps, chat) {
    let out = { focus: "", paused: !1, sidePaused: !1, overrides: {}, factOverrides: {}, lines: {}, log: [] }, valid = (clueOps.ops || []).filter((op) => anchorValid(op.at, chat));
    for (let [seq, op] of valid.entries()) {
      if (op.kind === "line") {
        let cur2 = { ...out.lines[op.target] || {} };
        op.value === "start" ? (cur2.started = !0, cur2.evidence = String(op.text || ""), cur2.how = String(op.note || ""), cur2.startAt = op.at ? op.at.i : -1, delete cur2.state) : op.value === "deny" ? (cur2.denied = [...cur2.denied || [], String(op.text || "")], cur2.started && cur2.evidence === String(op.text || "") && (delete cur2.started, delete cur2.evidence, delete cur2.how, delete cur2.startAt)) : op.value === "skip" ? (cur2.skipAt = seq, cur2.skipFloor = op.at ? op.at.i : -1) : op.value === "resume" ? delete cur2.state : op.value ? cur2.state = op.value : (delete cur2.state, delete cur2.started, delete cur2.evidence, delete cur2.how, delete cur2.startAt), Object.keys(cur2).length ? out.lines[op.target] = cur2 : delete out.lines[op.target];
        continue;
      }
      if (op.kind === "pause") {
        op.target === "side" ? out.sidePaused = !!op.value : out.paused = !!op.value;
        continue;
      }
      if (op.kind === "focus") {
        out.focus = op.value ? op.target : "", out.focusSceneAt = op.value && op.sceneAt !== void 0 ? String(op.sceneAt) : void 0, out.focusAt = op.value ? op.at : null;
        continue;
      }
      if (op.kind === "fact") {
        op.value ? out.factOverrides[op.target] = { status: op.value, text: String(op.text || "") } : delete out.factOverrides[op.target];
        continue;
      }
      let cur = { ...out.overrides[op.target] || {} };
      op.kind === "skip" ? op.value ? cur.skip = !0 : delete cur.skip : op.value ? cur[op.kind] = op.value : delete cur[op.kind], Object.keys(cur).length ? out.overrides[op.target] = cur : delete out.overrides[op.target];
    }
    return out;
  }
  function addClueOp(clueOps, chat, op, now = Date.now()) {
    let entry = {
      id: makeId("o"),
      kind: op.kind,
      target: String(op.target),
      value: op.value ?? "",
      text: op.text ? String(op.text) : void 0,
      note: op.note ? String(op.note) : void 0,
      sceneAt: op.sceneAt !== void 0 ? String(op.sceneAt) : void 0,
      at: anchorOf(chat, op.atIndex),
      time: now
    };
    for (let key of Object.keys(entry)) entry[key] === void 0 && delete entry[key];
    return { ...clueOps, ops: compactClueOps([...clueOps.ops || [], entry]) };
  }
  function opSlot(op) {
    return op.kind === "focus" ? op.kind : op.kind === "pause" ? `pause:${op.target === "side" ? "side" : "main"}` : op.kind === "line" ? `line:${op.target}:${["start", "deny", "skip"].includes(op.value) ? op.value : "state"}` : `${op.kind}:${op.target}`;
  }
  function sameAnchor(a, b) {
    return !!a && !!b && a.i === b.i && a.swipe === b.swipe && a.stamp === b.stamp;
  }
  function compactClueOps(ops) {
    let out = [];
    for (let op of ops) {
      let slot = opSlot(op);
      out = out.filter((prev) => !(opSlot(prev) === slot && sameAnchor(prev.at, op.at))), out.push(op);
    }
    return out;
  }
  function diffClueStatus(prev, next) {
    let changes = [];
    for (let [uid, status] of Object.entries(next))
      prev && prev[uid] !== void 0 && prev[uid] !== status && changes.push({ uid, from: prev[uid], to: status });
    return changes;
  }
  var STAY_KEEP = 60;
  function stayEntry(chat, index, info) {
    let msg = chat[index];
    return msg && !msg.is_user ? {
      i: index,
      swipe: Number(msg.swipe_id) || 0,
      stamp: String(msg.send_date ?? ""),
      key: String(info.key || ""),
      score: Number(info.score) || 0,
      paused: !!info.paused,
      ...info.scene !== void 0 ? { scene: String(info.scene) } : {}
    } : null;
  }
  function focusTakenOver(clueProg, stays, chat, cellNow) {
    if (!clueProg.focus || clueProg.focusSceneAt === void 0) return !1;
    let at = clueProg.focusAt ? clueProg.focusAt.i : -1, was = clueProg.focusSceneAt;
    return cellNow !== void 0 && cellNow !== was ? !0 : validStays(stays, chat).some((x) => x && x.i > at && x.scene !== void 0 && x.scene !== was);
  }
  function addStay(list, entry) {
    return entry ? [...(Array.isArray(list) ? list : []).filter((x) => x.i !== entry.i || x.swipe !== entry.swipe), entry].sort((a, b) => a.i - b.i).slice(-STAY_KEEP) : Array.isArray(list) ? list : [];
  }
  function validStays(list, chat) {
    let by = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : []) {
      let msg = chat[x.i];
      msg && !msg.is_user && (Number(msg.swipe_id) || 0) === x.swipe && String(msg.send_date ?? "") === x.stamp && by.set(x.i, x);
    }
    let out = [];
    for (let i = chat.length - 1; i >= 0; i--) {
      let msg = chat[i];
      if (!(!msg || msg.is_user)) {
        if (!by.has(i)) {
          out.push(null);
          continue;
        }
        out.push(by.get(i));
      }
    }
    return out;
  }
  function stayState(list, chat, { key, score = 0, paused = !1 }) {
    let rows2 = validStays(list, chat), out = { rounds: 1, since: -1, idle: 0, resumed: null };
    if (paused) return out;
    let p = 0;
    for (let x of rows2) {
      if (!x || !x.paused) break;
      p++;
    }
    if (p && (out.resumed = { rounds: p }), !key) return out;
    let later = score, progressed = !1;
    out.idle = 1;
    for (let x of rows2.slice(p)) {
      if (!x || x.key !== key || x.paused) break;
      out.rounds++, out.since = x.i, progressed || (x.score < later ? progressed = !0 : out.idle++), later = x.score;
    }
    return rows2[p] && rows2[p].key === key && rows2[p].score < score && (out.idle = 0), out;
  }
  function stayBand(n) {
    return n >= 7 ? 2 : n >= 4 ? 1 : 0;
  }
  var STAY_WORDS = {
    long: ["", "有一阵了", "写了很久"],
    idle: ["最近一直有新的", "最近几轮没有新的", "很久没有新的"],
    paused: ["停了一会儿", "停了一阵", "停了很久"]
  };
  function stayText(st9, kind) {
    if (!st9) return "";
    let lines2 = [], ask2 = [], long = stayBand(st9.rounds), from = st9.since >= 0 ? `从第 ${st9.since} 楼开始，` : "";
    if (st9.resumed) {
      let b = stayBand(st9.resumed.rounds);
      lines2.push(`- 刚恢复：${STAY_WORDS.paused[b]}（暂停了 ${st9.resumed.rounds} 条回复）`), ask2.push(
        `结合前文，以及本次提供的过去记忆（如果有）接着写。暂停期间发生的事照常算；${kind === "clue" ? "这一场" : "剧情"}按现在的情况自然接上，不用急着补回来。`
      );
    }
    if (long)
      if (lines2.push(`- 写了多久：${STAY_WORDS.long[long]}（${from}这是这一${kind === "clue" ? "场" : "段"}的第 ${st9.rounds} 条回复）`), kind === "clue") {
        let ib = st9.idle >= 7 ? 2 : st9.idle >= 4 ? 1 : 0;
        lines2.push(
          `- 发现：${STAY_WORDS.idle[ib]}（${ib ? `连续 ${st9.idle} 条回复没有新增或核实的发现` : "最近几条回复里有新增或核实的发现"}）`
        ), ask2.push(
          st9.resumed ? "" : "结合前文接着写。",
          `如果环境和人物前面已经交代过，就不必从头再写；说过的话、发生过的事，不要再写一遍。${ib ? "如果用户最近在聊别的、做别的，就跟着用户写，不必每轮把话题引回下面的发现；人物可以带着这件事做别的。等用户提起或采取相应的行动，再接着写。" : ""}`
        );
      } else ask2.push(st9.resumed ? "" : "结合前文接着写。", "如果场景和人物前面已经交代过，就不必再铺陈；已经写过的事件，不要再写一遍。");
    return lines2.length ? [`【这一${kind === "clue" ? "场" : "段"}到现在】`, ...lines2, ask2.filter(Boolean).join("")].join(`
`) : "";
  }

  // src/core/clue-tables.js
  function cloneTables(raw) {
    if (!raw || typeof raw != "object") return {};
    try {
      return JSON.parse(JSON.stringify(raw));
    } catch {
      return {};
    }
  }
  function sheetList(tables) {
    return Object.entries(tables || {}).filter(([key, sheet]) => key.startsWith("sheet_") && sheet && Array.isArray(sheet.content)).map(([key, sheet]) => ({
      key,
      name: String(sheet.name || key),
      content: sheet.content,
      seedRows: sheet.seedRows,
      note: String(sheet.sourceData && sheet.sourceData.note || ""),
      freq: sheet.updateConfig ? sheet.updateConfig.updateFrequency : void 0
    }));
  }
  function findSheet(tables, name) {
    let hits = sheetList(tables).filter((sheet) => sheet.name === name || sheet.key === name);
    return hits.length === 1 ? { sheet: hits[0] } : hits.length ? { error: `表「${name}」重名 ${hits.length} 张` } : { error: `缺少表「${name}」` };
  }
  function sheetRows(sheet) {
    let head = Array.isArray(sheet.content[0]) ? sheet.content[0] : [], own = sheet.content.slice(1).filter(Array.isArray), seeds = Array.isArray(sheet.seedRows) ? sheet.seedRows.filter(Array.isArray) : [], rows2 = own.length ? own : seeds;
    return {
      head,
      col: (name) => head.findIndex((cell, index) => index > 0 && String(cell ?? "").trim() === name),
      rows: rows2
    };
  }
  function cellText(value) {
    return value == null ? "" : String(value).trim();
  }
  function valueSet(value) {
    return new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(cellText).filter(Boolean));
  }
  function sameValue(cell, wanted) {
    let a = cellText(cell), b = cellText(wanted);
    if (a === b) return !0;
    let na = Number(a), nb = Number(b);
    return a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }
  function readCell(tables, path) {
    let parts = String(path || "").split("/").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) return { state: "unknown", reason: `路径「${path}」应为 表/行标识/列` };
    let [table, rowKey, column] = parts, found = findSheet(tables, table);
    if (found.error) return { state: "unknown", reason: found.error };
    let { col, rows: rows2 } = sheetRows(found.sheet), c = col(column), hits = c < 0 ? [] : findRow(rows2, rowKey);
    if (!hits.length && col(rowKey) >= 0 && findRow(rows2, column).length && (c = col(rowKey), hits = findRow(rows2, column)), c < 0)
      return { state: "unknown", reason: `表「${table}」缺少列「${column}」` };
    if (!hits.length) return { state: "unknown", reason: `表「${table}」没有行「${rowKey}」` };
    if (hits.length > 1) return { state: "unknown", reason: `表「${table}」行「${rowKey}」重复` };
    let value = hits[0][c];
    return cellText(value) === "" ? { state: "unknown", reason: `「${path}」尚未填写` } : { state: "ok", value };
  }
  function readFacts(tables, bindings) {
    let facts = /* @__PURE__ */ new Map(), problems2 = [];
    for (let binding of bindings || []) {
      let found = findSheet(tables, binding.表);
      if (found.error) {
        problems2.push(found.error);
        continue;
      }
      let { col, rows: rows2 } = sheetRows(found.sheet), idCol = col(binding.编号列 || ""), stateCol = binding.状态列 ? col(binding.状态列) : -1, textCol = binding.内容列 ? col(binding.内容列) : -1, srcCol = binding.来源列 ? col(binding.来源列) : -1;
      if (idCol < 0) {
        problems2.push(`表「${binding.表}」缺少编号列「${binding.编号列 || "（未设置）"}」`);
        continue;
      }
      if (binding.状态列 && stateCol < 0) {
        problems2.push(`表「${binding.表}」缺少状态列「${binding.状态列}」`);
        continue;
      }
      let noVerifiedValue = stateCol >= 0 && (binding.已核实值 === void 0 || cellText(binding.已核实值) === "");
      noVerifiedValue && problems2.push(`表「${binding.表}」配置了状态列但没有设置「已核实值」，事实一律按待确认处理`);
      let claimValues = valueSet(binding.说法值);
      for (let row2 of rows2) {
        let id = cellText(row2[idCol]);
        if (!id) continue;
        let raw = stateCol >= 0 ? row2[stateCol] : "", status = stateCol < 0 ? "confirmed" : cellText(raw) === "" || noVerifiedValue ? "pending" : sameValue(raw, binding.已核实值) ? "confirmed" : "unconfirmed", prev = facts.get(id);
        prev && prev.status === "confirmed" || facts.set(id, {
          id,
          status,
          claimed: status === "unconfirmed" && claimValues.has(cellText(raw)),
          raw: cellText(raw),
          text: textCol >= 0 ? cellText(row2[textCol]) : "",
          source: srcCol >= 0 ? cellText(row2[srcCol]) : "",
          table: binding.表
        });
      }
    }
    return { facts, problems: problems2 };
  }
  function readKnowledge(tables, bindings) {
    let rows2 = [], problems2 = [], present = /* @__PURE__ */ new Set();
    for (let binding of bindings || []) {
      let found = findSheet(tables, binding.表);
      if (found.error) {
        problems2.push(found.error);
        continue;
      }
      let { col, rows: data } = sheetRows(found.sheet), factCol = col(binding.事实列 || ""), actorCol = col(binding.角色列 || ""), wayCol = binding.方式列 ? col(binding.方式列) : -1, credCol = binding.可信度列 ? col(binding.可信度列) : -1, srcCol = binding.来源列 ? col(binding.来源列) : -1;
      if (factCol < 0 || actorCol < 0) {
        problems2.push(
          `表「${binding.表}」缺少${factCol < 0 ? `事实列「${binding.事实列 || "（未设置）"}」` : `角色列「${binding.角色列 || "（未设置）"}」`}`
        );
        continue;
      }
      if (binding.方式列 && wayCol < 0) {
        problems2.push(`表「${binding.表}」缺少方式列「${binding.方式列}」，这张知情表暂不读取（否则预建的「未知」行会被当成知情记录）`);
        continue;
      }
      let credMissing = binding.可信度列 && credCol < 0, noVerifiedValue = credCol >= 0 && (binding.已核实值 === void 0 || cellText(binding.已核实值) === "");
      credMissing && problems2.push(`表「${binding.表}」缺少可信度列「${binding.可信度列}」，「核实」条件一律为未知`), noVerifiedValue && problems2.push(`表「${binding.表}」配置了可信度列但没有设置「已核实值」，「核实」条件一律为未知`);
      let unknownWays = new Set((Array.isArray(binding.未知值) ? binding.未知值 : [binding.未知值 ?? "未知"]).map(cellText).concat([""])), validWays = valueSet(binding.有效值), badWays = /* @__PURE__ */ new Set();
      for (let row2 of data) {
        let fact = cellText(row2[factCol]), actor = cellText(row2[actorCol]);
        if (fact && actor && present.add(`${fact}@${actor}`), !(wayCol >= 0 && unknownWays.has(cellText(row2[wayCol])))) {
          if (wayCol >= 0 && validWays.size && !validWays.has(cellText(row2[wayCol]))) {
            badWays.add(cellText(row2[wayCol]));
            continue;
          }
          !fact || !actor || rows2.push({
            fact,
            actor,
            way: wayCol >= 0 ? cellText(row2[wayCol]) : "",
            credibility: credCol >= 0 ? cellText(row2[credCol]) : "",
            verified: credCol < 0 || noVerifiedValue || cellText(row2[credCol]) === "" ? null : sameValue(row2[credCol], binding.已核实值),
            source: srcCol >= 0 ? cellText(row2[srcCol]) : "",
            table: binding.表
          });
        }
      }
      badWays.size && problems2.push(
        `表「${binding.表}」的方式列出现了不认识的值：${[...badWays].map((w) => `「${w}」`).join("、")}，这些行不算知情记录`
      );
    }
    return { rows: rows2, problems: problems2, present };
  }
  var RECALL_TAGS = ["recall", "match", "记忆", "召回"];
  function plotPresetConflicts(preset) {
    if (!isPlainObject(preset)) return [];
    let tasks = Array.isArray(preset.plotTasks) && preset.plotTasks.length ? preset.plotTasks : [
      {
        name: preset.name || "默认任务",
        enabled: !0,
        extractTags: preset.extractTags,
        extractInjectTags: preset.extractInjectTags
      }
    ], out = [];
    for (let t of tasks) {
      if (!t || t.enabled === !1) continue;
      let other = `${t.extractTags || ""},${t.extractInjectTags || ""}`.split(/[,，\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).filter((x) => !RECALL_TAGS.includes(x));
      other.length && out.push({ task: String(t.name || t.id || "未命名任务"), tags: other });
    }
    return out;
  }
  function findRow(rows2, rowKey) {
    let first = rows2.filter((row2) => cellText(row2[1]) === rowKey);
    return first.length ? first : rows2.filter((row2) => row2.slice(1).some((cell) => cellText(cell) === rowKey));
  }
  var ENTRY_OPEN = "(（[【「『", ENTRY_CLOSE = ")）]】」』", ENTRY_SEP = `;；|｜
`, ENTRY_COMMA = ",，、", ENTRY_HEAD = /^\s*[^\s:：=,，、;；|｜()（）]{1,12}\s*[:：=]/, SELF_KEYS = ["主角", "user", "<user>", "{{user}}", "玩家"];
  function entryOf(key, value) {
    let k = String(key).trim(), m = /^(?:与|和|对|跟)\s*(.+?)\s*的(?:关系|好感度?|态度|印象|看法)$/.exec(k);
    return k = m ? m[1] : k.replace(/\s*的(?:关系|好感度?|态度|印象|看法)$/, ""), k && k.length <= 24 ? {
      key: k.trim(),
      value: String(value).trim().replace(/^[−－]/, "-")
    } : null;
  }
  function parseEntry(e) {
    let depth = 0, at = -1, m;
    for (let i = 0; i < e.length; i++) {
      let ch = e[i];
      if (ENTRY_OPEN.includes(ch)) depth++;
      else if (ENTRY_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && ":：=".includes(ch)) {
        at = i;
        break;
      }
    }
    return at > 0 ? entryOf(e.slice(0, at), e.slice(at + 1).replace(/^[\s:：=]+/, "")) : (m = /^([^（(]{1,24}?)\s*[（(]([\s\S]*)[)）]$/.exec(e)) ? entryOf(m[1], m[2]) : (m = /^(\D{1,12}?)\s*([+\-−－]\s*\d+(?:\.\d+)?)$/.exec(e)) ? entryOf(m[1], m[2].replace(/\s+/g, "")) : (m = /^(\S{1,12})\s+(\S[\s\S]*)$/.exec(e)) || (m = /^(\D{1,12}?)(\d+(?:\.\d+)?)$/.exec(e)) ? entryOf(m[1], m[2]) : null;
  }
  function cellEntries(text2) {
    let s = cellText(text2), parts = [], cur = "", depth = 0, flush = () => {
      cur.trim() && parts.push(cur.trim()), cur = "";
    };
    for (let i = 0; i < s.length; i++) {
      let ch = s[i];
      if (ENTRY_OPEN.includes(ch) ? depth++ : ENTRY_CLOSE.includes(ch) && (depth = Math.max(0, depth - 1)), depth === 0 && ENTRY_SEP.includes(ch)) {
        flush();
        continue;
      }
      if (depth === 0 && ENTRY_COMMA.includes(ch) && ENTRY_HEAD.test(cur) && ENTRY_HEAD.test(s.slice(i + 1))) {
        flush();
        continue;
      }
      cur += ch;
    }
    if (flush(), parts.length === 1 && /[,，、]/.test(parts[0])) {
      let bits = parts[0].split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
      bits.length > 1 && bits.every((b) => /^\D{1,12}?\s*[+\-−－]?\s*\d+(?:\.\d+)?$/.test(b)) && (parts = bits);
    }
    let out = [];
    for (let p of parts) {
      let e = parseEntry(p);
      e ? out.push(e) : out.length && (out[out.length - 1] = { ...out[out.length - 1], value: `${out[out.length - 1].value},${p}` });
    }
    return out;
  }
  function pickEntry(text2, key) {
    let k = String(key ?? "").trim(), list = cellEntries(text2), keys = SELF_KEYS.includes(k) ? SELF_KEYS : [k];
    if (!k) return { state: "unknown", reason: "没写要取哪一项" };
    if (!list.length) return { state: "unknown", reason: "这一格不是按「名字:内容」分条写的" };
    let hits = list.filter((e) => keys.includes(e.key)), vals = [...new Set(hits.map((e) => e.value))];
    return hits.length ? vals.length > 1 ? { state: "unknown", reason: `这一格里「${k}」出现了 ${hits.length} 次、写法不同，分不清取哪个` } : vals[0] === "" ? { state: "unknown", reason: `「${k}」这一项是空的` } : { state: "ok", value: vals[0] } : { state: "unknown", reason: `这一格里还没有「${k}」这一项` };
  }
  var TIER_EDGE = /[\s:：,，。.;；|｜(（\-—~～/／]/;
  function tierIndex(value, tiers) {
    let list = (tiers || []).map((t) => cellText(t)), v0 = cellText(value), find = (v) => {
      let hits = list.map((t, i) => ({ t, i })).filter(({ t }) => t && (v === t || v.startsWith(t) && TIER_EDGE.test(v[t.length])));
      if (!hits.length) return -1;
      let top = Math.max(...hits.map((h) => h.t.length)), best = hits.filter((h) => h.t.length === top);
      return best.length === 1 ? best[0].i : -1;
    }, at = find(v0);
    return at >= 0 ? at : find(v0.replace(/^\d+\s*[.、:：)）]?\s*/, ""));
  }
  function tierCompare(op, cell, wanted, tiers) {
    let a = tierIndex(cell, tiers), b = (tiers || []).map((t) => cellText(t)).indexOf(cellText(wanted));
    return a < 0 || b < 0 ? null : op === "==" ? a === b : op === "!=" ? a !== b : op === ">=" ? a >= b : op === "<=" ? a <= b : op === ">" ? a > b : a < b;
  }
  var TIER_UP_WORDS = /从低到高|由低到高|从弱到强|由弱到强|从浅到深|由浅入深|升序|[<＜→]|->/, TIER_DOWN_WORDS = /从高到低|由高到低|从强到弱|由强到弱|从深到浅|降序|[>＞]/;
  function tierOrderInNote(note, tiers) {
    let list = (tiers || []).map((t) => cellText(t)).filter(Boolean), lines2 = String(note || "").split(/\r?\n/);
    if (list.length < 2) return !1;
    let inLine = (line, seq) => {
      let at = 0;
      for (let t of seq) {
        let i = line.indexOf(t, at);
        if (i < 0) return !1;
        at = i + t.length;
      }
      return !0;
    }, stated = (k, words) => {
      if (words.test(lines2[k])) return !0;
      for (let j = k + 1; j < lines2.length && /^[\s·•\-*]/.test(lines2[j]) && !/^\s*-\s*列\d/.test(lines2[j]); j++)
        if (words.test(lines2[j])) return !0;
      return !1;
    }, down = [...list].reverse();
    if (lines2.some((l, k) => inLine(l, list) && stated(k, TIER_UP_WORDS) && !TIER_DOWN_WORDS.test(l)) || lines2.some((l, k) => inLine(l, down) && stated(k, TIER_DOWN_WORDS) && !TIER_UP_WORDS.test(l)))
      return !0;
    let nums = list.map((t) => {
      let re = new RegExp(`^\\s*[-·•*]?\\s*(\\d+)\\s*[.、:：)）]?\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![^\\s:：（(，,。])`), hit = lines2.map((l) => re.exec(l)).find(Boolean);
      return hit ? Number(hit[1]) : NaN;
    });
    return nums.every(Number.isFinite) && nums.every((n, i) => !i || n > nums[i - 1]);
  }
  function countRows(tables, table, column, op, value, applyOp2) {
    let found = findSheet(tables, table);
    if (found.error) return { state: "unknown", reason: found.error };
    let { col, rows: rows2 } = sheetRows(found.sheet), c = col(column);
    if (c < 0) return { state: "unknown", reason: `表「${table}」缺少列「${column}」` };
    let n = 0, unsure = 0;
    for (let row2 of rows2) {
      if (cellText(row2[c]) === "") continue;
      let ok = applyOp2(op, row2[c], value);
      ok === null ? unsure++ : ok && n++;
    }
    return { state: "ok", count: n, unsure };
  }

  // src/core/clue-project.js
  function clueText(value) {
    return Array.isArray(value) ? value.map((v) => clueText(v)).filter(Boolean).join("、") : stripAuthorBlocks(value == null ? "" : String(value)).trim();
  }
  function discoveryList(item) {
    return (Array.isArray(item.发现) ? item.发现 : item.发现 ? [item.发现] : []).map(
      (d) => isPlainObject(d) ? { fact: String(d.事实 || d.id || "").trim(), text: clueText(d.内容), record: clueText(d.记录) } : { fact: "", text: clueText(d), record: "" }
    ).filter((d) => d.text);
  }
  function nodeFactRefs(node) {
    let refs = /* @__PURE__ */ new Set(), unitEnter = node.unit && node.unit.clue ? node.unit.clue.enter : null;
    for (let cond of [unitEnter, node.open, node.done]) for (let f of conditionRefs(cond).facts) refs.add(f);
    let extra = isPlainObject(node.item) && node.item.相关事实;
    for (let f of Array.isArray(extra) ? extra : extra ? [extra] : []) refs.add(String(f).trim());
    return [...refs].filter(Boolean);
  }
  var CLUE_STATUS_TEXT = { locked: "未开放", available: "可进行", active: "进行中", done: "已完成" };
  function clueProgressText(state, snapshot, clueProg, { problems: problems2 = [] } = {}) {
    let lines2 = ["【线索进度（作者视角，含未开放节点的名称；只用于讨论和写大纲，不会给正文）】"], stages = [];
    for (let [, s] of state.stageStates) {
      let label = stageLabel(s.unit.stage.key), status = s.done ? "已结束" : s.entered.v === "true" ? "进行中" : "未进入";
      stages.push(
        `${label}（${status}${status === "未进入" && s.entered.reasons.length ? `：${s.entered.reasons.join("；")}` : status === "进行中" && s.requiredLeft.length ? `，还差 ${s.requiredLeft.map((n) => n.uid || n.name).join("、")}` : ""}）`
      );
    }
    stages.length && lines2.push(`阶段：${stages.join(" → ")}`);
    let nodes = state.nodeStates.filter((s) => s.node.uid);
    nodes.length && lines2.push(
      "节点：",
      ...nodes.map((s) => {
        let why = s.status === "locked" ? (s.open && s.open.reasons || []).slice(0, 2).join("；") : "";
        return `- [${CLUE_STATUS_TEXT[s.status] || s.status}${s.skipped ? "·已跳过" : ""}] ${s.node.uid} ${s.node.name}${state.focus.uid === s.node.uid ? " ← 当前焦点" : ""}${why ? `（${why}）` : ""}`;
      })
    );
    let holders = (id) => [...new Set((snapshot.knowledge || []).filter((r) => r.fact === id).map((r) => `${r.actor}${r.way ? `·${r.way}` : ""}`))].join(
      "、"
    ), confirmed = [], claims = [];
    for (let [id, fact] of snapshot.facts || []) {
      let eff = effectiveFact(id, snapshot, clueProg), who = holders(id);
      eff.confirmed ? confirmed.push(`- ${id}：${clueText(eff.text) || "（表里没写内容）"}${who ? `｜知道：${who}` : ""}`) : fact.claimed && claims.push(`- ${id}：${clueText(fact.text) || "（表里没写内容）"}${who ? `｜听到：${who}` : ""}`);
    }
    for (let [id, over] of Object.entries(clueProg && clueProg.factOverrides || {}))
      over.status === "confirmed" && !(snapshot.facts && snapshot.facts.has(id)) && confirmed.push(`- ${id}：（人工确认）${clueText(over.text)}`);
    return lines2.push(confirmed.length ? "已确认的事实：" : "已确认的事实：暂无", ...confirmed), claims.length && lines2.push("已经出现、尚未核实的说法：", ...claims), problems2.length && lines2.push("表格问题：", ...problems2.slice(0, 5).map((p) => `- ${p}`)), lines2.join(`
`);
  }
  function clueIndexText(volumes) {
    let compiled = compileClue(volumes || []), lines2 = [];
    for (let l of compiled.lines || []) lines2.push(`- 线 ${l.id}（${l.kind === "main" ? "主线" : "支线"}）「${l.name}」`);
    for (let node of compiled.nodes) {
      if (!node.uid) continue;
      let item = isPlainObject(node.item) ? node.item : {}, gives = discoveryList(item).map((d) => d.fact).filter(Boolean), needs = [...new Set([node.open, node.done].flatMap((c) => [...conditionRefs(c).facts]))];
      lines2.push(
        `- ${node.uid}「${node.name}」${clueText(item.入口) ? ` 入口：${clueText(item.入口)}` : ""}${gives.length ? ` · 产出 ${gives.join("、")}` : ""}${needs.length ? ` · 用到 ${needs.join("、")}` : ""}`
      );
    }
    return lines2.join(`
`);
  }
  function chatFactSets(c) {
    if (!c) return { known: [], claimed: [] };
    let known = [], claimed = [], ids = /* @__PURE__ */ new Set([
      ...(c.snap.facts || /* @__PURE__ */ new Map()).keys(),
      ...Object.keys(c.prog && c.prog.factOverrides || {})
    ]);
    for (let id of ids) {
      let f = c.snap.facts && c.snap.facts.get(id), eff = effectiveFact(id, c.snap, c.prog), over = c.prog && c.prog.factOverrides && c.prog.factOverrides[id];
      eff.confirmed ? known.push(id) : f && f.claimed && !(over && over.status === "revoked") && claimed.push(id);
    }
    return { known, claimed };
  }
  function prebuildPlan(volumes, { actors = ["user"] } = {}) {
    let compiled = compileClue(volumes || []), facts = /* @__PURE__ */ new Map(), knows = /* @__PURE__ */ new Set(), scenes = [];
    for (let node of compiled.nodes) {
      let item = isPlainObject(node.item) ? node.item : {};
      node.uid && clueText(item.入口) && scenes.push({ uid: node.uid, entry: clueText(item.入口), place: clueText(item.地点) });
      for (let d of discoveryList(item)) {
        if (!d.fact || facts.has(d.fact)) continue;
        let criterion = d.record, overlap = criterion && answerOverlap(criterion, d.text);
        facts.set(d.fact, {
          code: d.fact,
          label: "",
          criterion: overlap ? "" : criterion,
          draftCriterion: criterion,
          risky: !!overlap,
          overlap: overlap || "",
          node: node.uid || node.name
        });
      }
    }
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let n of compiled.nodes) for (let c of [n.open, n.early, n.done]) conditionRefs(c, refs);
    for (let l of compiled.lines || []) conditionRefs(l.open, refs);
    for (let k of refs.knows) knows.add(k);
    let cellKnows = (cond) => {
      if (cond) {
        if (cond.kind === "group") return cond.items.forEach(cellKnows);
        if (cond.kind === "cell") {
          let m = /^[^/]+\/([^/@]+)@([^/]+)\//.exec(cond.path);
          m && knows.add(`${m[1].trim()}@${m[2].trim()}`);
        }
      }
    };
    for (let unit of compiled.units) unit.clue && (cellKnows(unit.clue.enter), cellKnows(unit.clue.end));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(cellKnows);
    for (let l of compiled.lines || []) cellKnows(l.open);
    for (let [f, ids] of lineTriggerFacts(compiled))
      facts.has(f) || facts.set(f, {
        code: f,
        label: "",
        criterion: "",
        draftCriterion: "",
        risky: !1,
        overlap: "",
        node: `线 ${ids.join("、")}`,
        opening: ids[0],
        trigger: !0
      });
    for (let id of refs.facts)
      facts.has(id) || facts.set(id, { code: id, label: "", criterion: "", draftCriterion: "", risky: !1, overlap: "", node: "", orphan: !0 });
    for (let a of actors) for (let id of facts.keys()) knows.add(`${id}@${a}`);
    return {
      facts: [...facts.values()],
      knows: [...knows].map((k) => {
        let i = k.lastIndexOf("@");
        return { key: k, fact: k.slice(0, i), actor: k.slice(i + 1) };
      }),
      scenes
    };
  }
  function answerOverlap(record, answer) {
    let a = String(answer || "").replace(/[\s，。、；：！？“”「」（）,.;:!?()"']/g, ""), r = String(record || "");
    for (let len = Math.min(8, a.length); len >= 4; len--)
      for (let i = 0; i + len <= a.length; i++) {
        let piece = a.slice(i, i + len);
        if (r.includes(piece)) return piece;
      }
    return "";
  }
  function prebuildDiff(plan, snapshot, bindings) {
    let fb = (bindings.facts || [])[0], kb = (bindings.knowledge || [])[0], haveFacts = snapshot.facts || /* @__PURE__ */ new Map(), haveKnows = snapshot.knowPresent || /* @__PURE__ */ new Set(), planFacts = new Set(plan.facts.map((f) => f.code));
    return {
      factTable: fb ? fb.表 : "",
      knowTable: kb ? kb.表 : "",
      newFacts: plan.facts.filter((f) => !haveFacts.has(f.code)),
      newKnows: plan.knows.filter((k) => !haveKnows.has(k.key)),
      // 表里有、大纲里已经没有的编号（改写后失效）：只报告，不删除
      stale: [...haveFacts.keys()].filter((id) => !planFacts.has(id)),
      kept: plan.facts.filter((f) => haveFacts.has(f.code)).map((f) => f.code)
    };
  }
  function checkClueDraft(draftVolumes, existingVolumes, { keepIds = [], isObtained = () => !1, obtainedFacts = [], claimedFacts = [], applied = null, tables = null } = {}) {
    let out = [], draft = compileClue(draftVolumes || []), existing = compileClue(existingVolumes || []), keep = new Set(keepIds), existingIds = new Set(existing.nodes.map((n) => n.uid).filter((id) => id && !keep.has(id)));
    out.push(...draft.errors.filter((e) => !/引用了不存在的节点|引用了不存在的线/.test(e)));
    let dup = draft.nodes.filter((n) => n.uid && existingIds.has(n.uid)).map((n) => n.uid);
    dup.length && out.push(`这些 id 和已有节点重复，保存时会自动换成新 id：${dup.join("、")}`);
    let oldGives = /* @__PURE__ */ new Map();
    for (let n of existing.nodes)
      if (!(n.uid && keep.has(n.uid)))
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
          d.fact && !oldGives.has(d.fact) && oldGives.set(d.fact, { node: n.uid || n.name, text: d.text });
    for (let n of draft.nodes)
      for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) {
        let old = d.fact && oldGives.get(d.fact);
        if (!old) continue;
        let got = isObtained(d.fact);
        out.push(
          `事实编号 ${d.fact} 已经由 ${old.node} 使用（「${old.text}」）${got ? "，本聊天里已经取得" : ""}；新草稿的 ${n.uid || n.name} 又把它作为发现（「${d.text}」）。${got ? "保存后这个新节点会当即算完成。" : ""}如果是同一件事的另一条取得途径可以保留；如果是另一件事，请改用新编号。`
        );
      }
    let produced = /* @__PURE__ */ new Set();
    for (let n of [...existing.nodes, ...draft.nodes])
      for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && produced.add(d.fact);
    let allIds = new Set([...existing.nodes, ...draft.nodes].map((n) => n.uid).filter(Boolean)), used = /* @__PURE__ */ new Set(), badNodes = /* @__PURE__ */ new Set();
    for (let unit of draft.units)
      unit.clue && [unit.clue.enter, unit.clue.end].forEach((c) => {
        let r = conditionRefs(c);
        r.facts.forEach((f) => used.add(f)), r.nodes.forEach((id) => allIds.has(id) || badNodes.add(id));
      });
    for (let n of draft.nodes)
      [n.open, n.early, n.done].forEach((c) => {
        let r = conditionRefs(c);
        r.facts.forEach((f) => used.add(f)), r.nodes.forEach((id) => allIds.has(id) || badNodes.add(id));
      });
    for (let l of [...existing.lines || [], ...draft.lines || []]) {
      for (let f of conditionRefs(l.open).facts) produced.add(f);
      l.legacyFact && produced.add(l.legacyFact);
    }
    for (let l of draft.lines || []) {
      let own = new Set(
        draft.nodes.filter((n) => n.unit.line === l).flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact)).filter(Boolean)
      ), other = new Set(
        [...existing.nodes, ...draft.nodes].filter((n) => n.unit.line !== l).flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact)).filter(Boolean)
      ), self = [...conditionRefs(l.open).facts].filter((f) => own.has(f) && !other.has(f));
      self.length && out.push(
        `线 ${l.id} 要等的${self.join("、")}只能在这条线自己的节点里拿到，但线没开始时这些节点都打不开，这条线会一直开不了。开启条件里的事实不用写成节点的发现，正文里发生了填表就会记下`
      );
    }
    let orphan = [...used].filter((f) => !produced.has(f));
    if (orphan.length && out.push(`条件用到了没有任何节点产出的事实：${orphan.join("、")}（玩家永远拿不到，需要补节点或改条件）`), badNodes.size && out.push(`条件引用了不存在的节点：${[...badNodes].join("、")}`), tables)
      for (let r of tableCondReport(draftVolumes, tables))
        r.level !== "ok" && out.push(
          `${r.where}：${r.raw}——${r.notes.join("；")}${r.level === "bad" ? "。这个条件会一直是未知，用到它的线或节点开不了；可以换成等一件事发生，或者改成手动开始" : ""}`
        );
    let oldLines = new Set((existing.lines || []).map((l) => l.id)), dupLines = (draft.lines || []).filter((l) => oldLines.has(l.id)).map((l) => l.id);
    dupLines.length && out.push(`这些线的编号和已有的线重复：${dupLines.join("、")}`);
    let allLines = new Set([...existing.lines || [], ...draft.lines || []].map((l) => l.id)), badLines = /* @__PURE__ */ new Set();
    for (let l of draft.lines || []) for (let id of conditionRefs(l.open).lines) allLines.has(id) || badLines.add(id);
    badLines.size && out.push(`开启条件引用了不存在的线：${[...badLines].join("、")}`);
    let noDone = draft.nodes.filter((n) => n.kind === "main" && !n.done).map((n) => n.uid || n.name);
    noDone.length && out.push(`这些主线节点没有完成条件，只能人工标记完成：${noDone.join("、")}`);
    let noFind = draft.nodes.filter((n) => n.kind === "main" && !discoveryList(isPlainObject(n.item) ? n.item : {}).length).map((n) => n.uid || n.name);
    if (noFind.length && out.push(`这些主线节点没有「发现」：${noFind.join("、")}`), !applied) return out;
    let reach = clueReachability(applied, { knownFacts: obtainedFacts, claimedFacts }), list = (xs) => xs.slice(0, 6).map((x) => `${x.stage}${x.node ? `·${x.node}` : ""}（${x.why}）`).join("；");
    reach.verdict === "blocked" && out.push(`按大纲自身推演，有走不通的地方：${list([...reach.stuckStages, ...reach.stuckNodes])}`), reach.verdict === "unknown" && out.push(`有些地方要看时间、知情或表格里的值才能走通，这里判断不了：${list([...reach.stuckStages, ...reach.stuckNodes])}`);
    for (let r of clueAlternativeRoutes(applied, { knownFacts: obtainedFacts, claimedFacts }))
      r.ok || out.push(`替代途径走不通：${r.stage}·${r.node} 单独走完时，${r.why}`);
    return out;
  }
  function historyGuard(oldVolumes, nextVolumes, snapshot, clueProg, config, { scope = null } = {}) {
    let full = (vols) => computeClueState(compileClue(vols), snapshot, clueProg, config), stateOf = (st22) => new Map(st22.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s])), fullBefore = full(oldVolumes), fullAfter = full(nextVolumes), before = stateOf(fullBefore), after = stateOf(fullAfter), diffs = [], notes = [], keepDone = /* @__PURE__ */ new Map(), reinsert = /* @__PURE__ */ new Map(), home = /* @__PURE__ */ new Map(), stageKey = (u) => `${u.volume.key}|${u.stage.key}`, stageMap = (st22) => new Map([...st22.stageStates.values()].map((x) => [stageKey(x.unit), x])), sBefore = stageMap(fullBefore), sAfter = stageMap(fullAfter);
    for (let [key, a] of sBefore) {
      let b = sAfter.get(key);
      if (!b) continue;
      let name = stageLabel(a.unit.stage.key);
      a.done && !b.done ? notes.push(
        `阶段「${name}」原来已经结束，改写后会变回「${b.entered.v === "true" ? "进行中" : "未进入"}」，后面阶段的入口可能会被锁住`
      ) : a.entered.v === "true" && b.entered.v !== "true" && notes.push(`阶段「${name}」原来已经进入，改写后会变成「未进入」，这个阶段里的入口会消失`);
    }
    let lostEntries = [...before].filter(([uid, s]) => (s.status === "available" || s.status === "active") && after.has(uid) && after.get(uid).status === "locked").map(([uid, s]) => `${uid}「${s.node.name}」`);
    lostEntries.length && notes.push(`改写后这些原来可以去做的事会重新锁上：${lostEntries.join("、")}`);
    for (let unit of flattenUnits(oldVolumes))
      for (let n of stageNodes(unit.stage.data))
        nodeUid(n.item) && home.set(nodeUid(n.item), { volKey: unit.volume.key, stageKey: unit.stage.key, field: n.field });
    for (let [uid, s] of before) {
      if (scope && !scope.has(uid)) continue;
      let t = after.get(uid), label = `${uid}「${s.node.name}」`, item = isPlainObject(s.node.item) ? s.node.item : {};
      s.status === "done" && !t ? (diffs.push(`${label}已完成，改写结果里没有这个节点；应用时会放回原位`), reinsert.set(uid, s.node.item)) : s.status === "done" && t.status !== "done" && (diffs.push(`${label}已完成，改写后会变回「${NODE_STATUS_LABELS[t.status]}」；应用时会保留它原来的完成条件`), keepDone.set(uid, item.完成条件));
      let got = discoveryList(item).filter(
        (d) => d.fact && (effectiveFact(d.fact, snapshot, clueProg).confirmed || snapshot.facts && snapshot.facts.get(d.fact) && snapshot.facts.get(d.fact).claimed)
      );
      if (got.length) {
        let ids = new Set(t ? discoveryList(isPlainObject(t.node.item) ? t.node.item : {}).map((d) => d.fact) : []), lost = got.filter((d) => !ids.has(d.fact)).map((d) => d.fact);
        if (lost.length) {
          let movedTo = (fact) => [...after].find(([, x]) => discoveryList(isPlainObject(x.node.item) ? x.node.item : {}).some((d) => d.fact === fact));
          notes.push(
            `${label}${t ? "里" : "（改写后被删除）中"}已经获得或已经说出的发现 ${lost.map((f) => {
              let m = movedTo(f);
              return m ? `${f}（挪到了 ${m[0]}）` : f;
            }).join("、")} 在原位置不见了；表格里的记录还在，但正文可能把它当成没发生过`
          );
        }
      }
    }
    for (let [uid, t] of after) {
      if (scope && !scope.has(uid) && before.has(uid)) continue;
      let s = before.get(uid), was = s ? s.status : "（新节点）";
      t.status === "done" && was !== "done" && notes.push(`这次改写会让 ${uid}「${t.node.name}」直接变成已完成（原来：${s ? NODE_STATUS_LABELS[was] : was}），调查会被跳过`);
    }
    return { diffs, notes, keepDone, reinsert, home };
  }
  function restoreHistory(draftVolumes, guard) {
    if (!guard.keepDone.size && !guard.reinsert.size) return draftVolumes;
    let out = (draftVolumes || []).map((v) => ({
      ...v,
      stages: v.stages.map((st22) => {
        if (!isPlainObject(st22.data)) return st22;
        let data = { ...st22.data };
        for (let { field: field2 } of NODE_FIELDS)
          Array.isArray(data[field2]) && (data[field2] = data[field2].map((it) => {
            let uid = nodeUid(it);
            return uid && guard.keepDone.has(uid) ? { ...it, 完成条件: guard.keepDone.get(uid) } : it;
          }));
        return { ...st22, data };
      })
    }));
    for (let [uid, item] of guard.reinsert) {
      let h = guard.home.get(uid) || { volKey: "", stageKey: "", field: "主线节点" }, vol = out.find((v) => v.key === h.volKey), target = vol && vol.stages.find((st22) => st22.key === h.stageKey) || vol && vol.stages[vol.stages.length - 1] || out[0] && out[0].stages[0];
      target && (target.data = { ...target.data, [h.field]: [item, ...Array.isArray(target.data[h.field]) ? target.data[h.field] : []] });
    }
    return out;
  }
  function buildClueProjection(state, snapshot, clueProg, settings, { pace = "normal", stay = "", plan = null, notReady = null } = {}) {
    let tag = String(settings.tagName || "剧情参考").trim() || "剧情参考", focus = state.nodeStates.find((s) => s.node.uid && s.node.uid === state.focus.uid), lines2 = [], used = {
      focus: focus ? focus.node.uid : "",
      facts: [],
      discoveries: [],
      leads: [],
      candidates: [],
      scenes: [],
      offer: "",
      recognize: plan ? plan.recognize.map((r) => ({ uid: r.uid, line: r.line, entry: r.entry, place: r.place })) : []
    };
    if (focus) {
      let node = focus.node, item = isPlainObject(node.item) ? node.item : {}, stageData = isPlainObject(node.unit.stage.data) ? node.unit.stage.data : {}, instr = clueText(stageData.AI指令), place = clueText(item.地点), scene = clueText(item.场景), finds = discoveryList(item);
      used.scenes.push({ uid: node.uid, entry: clueText(item.入口), place, focus: !0 }), lines2.push(
        "以下是本轮可演的场景材料。列出的发现尚未发生，只有正文中实际完成相应调查、交谈或行动时才能揭示；中途离开、失败或转去做别的事，就不要揭示，也不要当作已知。"
      ), stay && lines2.push(stay), instr && lines2.push(`本段要求：${instr}`), place && lines2.push(`地点：${place}`), scene && lines2.push(`场景（初次到达时的样子；人物态度和环境后来的变化以前文为准，不要重置）：${scene}`);
      let isClaimed = (d) => {
        if (!d.fact) return !1;
        let f = snapshot.facts && snapshot.facts.get(d.fact), over = clueProg && clueProg.factOverrides && clueProg.factOverrides[d.fact];
        return !!(f && f.claimed) && !(over && over.status === "revoked");
      }, got = finds.filter((d) => d.fact && effectiveFact(d.fact, snapshot, clueProg).confirmed), voiced = finds.filter((d) => !got.includes(d) && isClaimed(d)), held = finds.filter((d) => !got.includes(d) && !voiced.includes(d) && d.fact && notReady && notReady.has(d.fact)), pending = finds.filter((d) => !got.includes(d) && !voiced.includes(d) && !held.includes(d)), gotFacts = new Set([...got, ...voiced].map((d) => d.fact));
      held.length && (used.held = held.map((d) => d.fact)), held.length && !pending.length && lines2.push("这一场的具体发现还在准备，这一轮先写到人物和环境，不要写出调查结果。"), pending.length && (lines2.push(got.length ? "本场景还可能获得的发现（尚未发生）：" : "本场景可能获得的发现（尚未发生）："), pending.forEach((d) => {
        lines2.push(`- ${d.text}`), used.discoveries.push(d.fact || d.text.slice(0, 20)), d.fact && used.candidates.push({ fact: d.fact, record: d.record });
      }));
      let holdersOf = (id) => [
        ...new Set(
          (snapshot.knowledge || []).filter((row2) => row2.fact === id && clueText(row2.actor)).map((row2) => `${clueText(row2.actor)}${row2.verified === !0 ? "" : `（${clueText(row2.credibility) || "未核实"}）`}`)
        )
      ], whoText = (id) => {
        let h = holdersOf(id);
        return snapshot.knowPresent || (snapshot.knowledge || []).length ? h.length ? `｜知道的人：${h.join("、")}` : "｜知情范围未记录" : "";
      }, recordedOr = (id, text2) => text2 || `（${id} 已经${snapshot.facts && snapshot.facts.get(id) && snapshot.facts.get(id).claimed ? "有人说出" : "确认"}，但表格没有记录具体内容；沿用正文里已经写出的部分，不要补充）`;
      got.length && lines2.push(
        "本场景已经获得的发现（不要重复揭示）：",
        ...got.map((d) => `- ${recordedOr(d.fact, clueText(effectiveFact(d.fact, snapshot, clueProg).text))}${whoText(d.fact)}`)
      ), voiced.length && (lines2.push(
        "本场景已经有人说出、但尚未核实的内容（只是说法；沿用原话、说话人和听到的人，不要当成事实，也不要重复首次揭示）：",
        ...voiced.map((d) => {
          let f = snapshot.facts.get(d.fact), src = clueText(f.source);
          return `- ${recordedOr(d.fact, clueText(f.text))}${src ? `｜来源：${src}` : ""}${whoText(d.fact)}`;
        })
      ), voiced.forEach((d) => {
        used.facts.push(d.fact), used.candidates.push({ fact: d.fact, record: d.record });
      }));
      let known = [], claims = [];
      for (let id of nodeFactRefs(node)) {
        if (gotFacts.has(id) || finds.some((d) => d.fact === id && !got.includes(d))) continue;
        let eff = effectiveFact(id, snapshot, clueProg), fact = snapshot.facts && snapshot.facts.get(id);
        if (eff.confirmed) {
          let text2 = clueText(eff.text);
          known.push(`- ${text2 || `（${id} 已经确认，但表格没有记录具体内容）`}${whoText(id)}`), used.facts.push(id);
          continue;
        }
        let override = clueProg && clueProg.factOverrides && clueProg.factOverrides[id];
        if (fact && fact.claimed && !(override && override.status === "revoked")) {
          let text2 = clueText(fact.text);
          text2 && (claims.push(`- ${text2}${whoText(id)}`), used.facts.push(id));
        }
      }
      known.length && lines2.push("与本场景相关、已经确认的事实（只有列出的人知道；其他角色要经过告知、展示或亲眼所见才会知道）：", ...known), claims.length && lines2.push("与本场景相关、已经出现过但尚未核实的说法（只是说法，不要当成事实；只有列出的人听到过）：", ...claims);
    }
    let leadOf = (s) => ({
      uid: s.node.uid,
      text: clueText(isPlainObject(s.node.item) ? s.node.item.入口 : ""),
      place: clueText(isPlainObject(s.node.item) ? s.node.item.地点 : "")
    });
    if (plan) {
      let listed = (uid) => !plan.known || plan.known.has(uid), sameLine = focus ? state.nodeStates.filter(
        (s) => s.status === "available" && s !== focus && !s.disabled && s.node.uid && s.node.unit.line === focus.node.unit.line && listed(s.node.uid)
      ).map(leadOf).filter((l) => l.text) : [];
      sameLine.length && (lines2.push("同一段剧情里另外可以去做的事（由用户选择，不要强行引导）：", ...sameLine.map((l) => `- ${l.text}`)), used.leads = sameLine.map((l) => l.uid), sameLine.forEach((l) => used.scenes.push({ uid: l.uid, entry: l.text, place: l.place, focus: !1 })));
      let offer = !focus && plan.offer, items = offer ? offer.items.filter((x) => x.entry) : [];
      items.length && (lines2.push(
        `可用的后续方向：${items.map((x) => x.entry).join("；")}。${offer.hint ? `（由头：${offer.hint}）` : ""}`,
        "只有本轮行动自然涉及它时才接入；否则继续眼前的事，不必提及。尚未进入时不要补写调查结果。",
        ...offer.kind === "side" ? ["如果前文已经发生过类似的事，就接着前文写，不要重演。"] : []
      ), used.offer = offer.line, used.leads = items.map((x) => x.uid));
      let sidePaused = !!(clueProg && clueProg.sidePaused), live = (state.lineStates || []).some((s) => s.state === "进行中" && (s.line.kind === "main" || !sidePaused));
      (focus || lines2.length || plan.recognize.length || live) && (lines2.push(CLUE_OFF_MATERIAL_RULE), used.guard = !0);
      for (let r of plan.recognize)
        used.scenes.some((x) => x.uid === r.uid) || used.scenes.push({ uid: r.uid, entry: r.entry, place: r.place, focus: !1 });
    } else {
      let leads = state.nodeStates.filter((s) => s.status === "available" && s !== focus && !s.disabled && s.node.uid).map(leadOf).filter((l) => l.text);
      leads.length && (lines2.push(
        focus ? "另外可以去做的事（由用户选择，不要强行引导）：" : "目前可以去做的事（由用户选择，不要强行引导）：",
        ...leads.map((l) => `- ${l.text}`),
        "如果用户这一轮去做了上面的某件事，写到他到达、开始就可以；具体查到什么、对方说出什么，留到之后再写，不要自己编造结果。"
      ), used.leads = leads.map((l) => l.uid), leads.forEach((l) => used.scenes.push({ uid: l.uid, entry: l.text, place: l.place, focus: !1 })));
    }
    if (!lines2.length) return { content: "", used };
    let note = pace === "slow" ? "节奏放慢，细写当下。" : pace === "fast" ? "节奏加快，次要细节一笔带过。" : "", guide = bodyGuideText(settings);
    return {
      content: `<${tag}>
${guide ? `${guide}

` : ""}${note ? `${note}
` : ""}${lines2.join(`
`)}
</${tag}>`,
      used
    };
  }
  function claimSnapshot(allFacts, have, claimed) {
    return new Map(
      [...allFacts].map((id) => [
        id,
        have.has(id) ? { id, status: "confirmed", text: "", raw: "已核实" } : claimed.has(id) ? { id, status: "unconfirmed", claimed: !0, text: "", raw: "存疑" } : { id, status: "unconfirmed", text: "", raw: "未获得" }
      ])
    );
  }
  function clueReachability(volumes, { knownFacts = [], claimedFacts = [] } = {}) {
    let compiled = compileClue(volumes || []), have = new Set(knownFacts), claimed = new Set(claimedFacts), external = /* @__PURE__ */ new Set(), cfg = normalizeClue({ mode: "clue", autoFocusSingle: !1 }), gives = new Map(
      compiled.nodes.map((n) => [
        n,
        discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact).filter(Boolean)
      ])
    ), knowActors = /* @__PURE__ */ new Map(), assumptions = /* @__PURE__ */ new Set(), extAtoms = (cond) => {
      if (cond) {
        if (cond.kind === "group") return cond.items.forEach(extAtoms);
        if (cond.kind === "know")
          return knowActors.set(cond.fact, (knowActors.get(cond.fact) || /* @__PURE__ */ new Set()).add(cond.actor)), assumptions.add(`${cond.actor} 得知 ${cond.fact}`);
        ["time", "cell", "count"].includes(cond.kind) && external.add(
          cond.kind === "time" ? `时间 ${cond.op} ${cond.value}` : cond.kind === "count" ? `表格 ${cond.table} 的计数` : `表格 ${cond.path}`
        );
      }
    };
    for (let u of compiled.units) u.clue && (extAtoms(u.clue.enter), extAtoms(u.clue.end));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(extAtoms);
    for (let l of compiled.lines || []) extAtoms(l.open);
    for (let [f, ids] of lineTriggerFacts(compiled)) have.add(f), assumptions.add(`正文里发生线 ${ids.join("、")} 要等的事（${f}）`);
    let allFacts = /* @__PURE__ */ new Set([...have, ...claimed]);
    for (let u of compiled.units)
      u.clue && [u.clue.enter, u.clue.end].forEach((c) => conditionRefs(c).facts.forEach((f) => allFacts.add(f)));
    for (let n of compiled.nodes)
      [n.open, n.early, n.done].forEach((c) => conditionRefs(c).facts.forEach((f) => allFacts.add(f))), gives.get(n).forEach((f) => allFacts.add(f));
    let state = null, lineProg = { lines: {} };
    for (let round = 0; round < 64; round++) {
      let facts = claimSnapshot(allFacts, have, claimed), knowledge = [...knowActors].flatMap(
        ([fact, actors]) => have.has(fact) ? [...actors].map((actor) => ({ fact, actor, way: "亲见", verified: !0 })) : []
      );
      state = computeClueState(compiled, { facts, knowledge, tables: {}, problems: [] }, { ...emptyClueProgress(), ...lineProg }, cfg);
      let before0 = Object.keys(lineProg.lines).length;
      for (let s of state.lineStates || [])
        (s.state === "可开启" || s.state === "未触发" && s.cond.v === TRI.u) && (lineProg.lines[s.line.id] = { started: !0 });
      if (Object.keys(lineProg.lines).length !== before0) continue;
      let before = have.size;
      for (let s of state.nodeStates)
        (s.status === "available" || s.status === "active" || s.status === "done") && gives.get(s.node).forEach((f) => have.add(f));
      if (have.size === before) break;
    }
    let stuckStages = [], stuckNodes = [], depends = !1;
    for (let u of compiled.units) {
      let s = state.stageStates.get(u.id);
      if (s.done) continue;
      let why = s.entered.v !== TRI.t ? `进不去：${s.entered.reasons.join("；")}` : s.requiredLeft.length ? `必需节点做不完：${s.requiredLeft.map((n) => n.uid || n.name).join("、")}` : `结束条件不满足：${s.end.reasons.join("；")}`;
      (s.entered.v === TRI.u || s.end.v === TRI.u) && (depends = !0), stuckStages.push({
        stage: stageLabel(u.stage.key),
        why,
        line: u.line ? u.line.id : "",
        unknown: s.entered.v === TRI.u || s.end.v === TRI.u
      });
    }
    for (let ns of state.nodeStates) {
      if (ns.status === "done" || !ns.node.required) continue;
      let reason = ns.status === "locked" ? `一直打不开：${ns.open.reasons.join("；")}` : ns.done.v === TRI.u ? `完成条件判断不了：${ns.done.reasons.join("；")}` : `打开了也完不成：${ns.done.reasons.join("；")}`;
      (ns.open.v === TRI.u || ns.done.v === TRI.u || !ns.node.done) && (depends = !0), stuckNodes.push({
        node: ns.node.uid || ns.node.name,
        stage: stageLabel(ns.node.unit.stage.key),
        why: reason,
        line: ns.node.unit.line ? ns.node.unit.line.id : "",
        unknown: ns.open.v === TRI.u || ns.done.v === TRI.u || !ns.node.done
      });
    }
    return {
      verdict: !stuckStages.length && !stuckNodes.length ? "ok" : depends ? "unknown" : "blocked",
      stuckStages,
      stuckNodes,
      external: [...external],
      assumptions: [...assumptions],
      obtainable: [...have],
      claimed: [...claimed]
    };
  }
  function clueAlternativeRoutes(volumes, { knownFacts = [], claimedFacts = [] } = {}) {
    let compiled = compileClue(volumes || []), out = [], cfg = normalizeClue({ mode: "clue", autoFocusSingle: !1 }), units = compiled.units, claimed = new Set(claimedFacts), gives = (n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact).filter(Boolean), reach = null, obtainable = () => reach || (reach = new Set(clueReachability(volumes, { knownFacts, claimedFacts }).obtainable)), all = /* @__PURE__ */ new Set([...knownFacts, ...claimed]), knowActors = /* @__PURE__ */ new Map(), knowAtoms = (cond) => {
      if (cond) {
        if (cond.kind === "group") return cond.items.forEach(knowAtoms);
        cond.kind === "know" && knowActors.set(cond.fact, (knowActors.get(cond.fact) || /* @__PURE__ */ new Set()).add(cond.actor));
      }
    };
    for (let u of units)
      u.clue && [u.clue.enter, u.clue.end].forEach((c) => (conditionRefs(c).facts.forEach((f) => all.add(f)), knowAtoms(c)));
    for (let n of compiled.nodes)
      [n.open, n.early, n.done].forEach((c) => (conditionRefs(c).facts.forEach((f) => all.add(f)), knowAtoms(c))), gives(n).forEach((f) => all.add(f));
    let snapshot = (have) => ({
      facts: claimSnapshot(all, have, claimed),
      knowledge: [...knowActors].flatMap(
        ([fact, actors]) => have.has(fact) ? [...actors].map((actor) => ({ fact, actor, way: "亲见", verified: !0 })) : []
      ),
      tables: {},
      problems: []
    });
    for (let [ui, u] of units.entries()) {
      let own = compiled.nodes.filter((n) => n.unit === u), alts = own.filter((n) => n.kind === "main" && !n.required);
      if (alts.length < 2) continue;
      let altFacts = new Set(alts.flatMap(gives)), altIds = new Set(alts.map((n) => n.uid).filter(Boolean)), starts = alts.filter((n) => {
        let refs = conditionRefs(n.open);
        return ![...refs.facts].some((f) => altFacts.has(f) && !gives(n).includes(f)) && ![...refs.nodes].some((id) => altIds.has(id) && id !== n.uid);
      });
      if (starts.length < 2) continue;
      let base = new Set(knownFacts), got = obtainable(), required = own.filter((n) => n.required);
      for (let n of compiled.nodes) units.indexOf(n.unit) < ui && gives(n).forEach((f) => got.has(f) && base.add(f));
      if (!(units.length && computeClueState(compiled, snapshot(base), emptyClueProgress(), cfg).stageStates.get(u.id).entered.v !== TRI.t))
        for (let start of starts) {
          let allowed = /* @__PURE__ */ new Set([start, ...alts.filter((n) => !starts.includes(n)), ...required]), have = new Set(base), used = [start], state = null;
          for (let round = 0; round < 32; round++) {
            state = computeClueState(compiled, snapshot(have), emptyClueProgress(), cfg);
            let before = have.size;
            for (let ns2 of state.nodeStates)
              allowed.has(ns2.node) && ns2.status !== "locked" && (ns2.node.required || used.includes(ns2.node) || used.push(ns2.node), gives(ns2.node).forEach((f) => have.add(f)));
            if (have.size === before) break;
          }
          let s = state.stageStates.get(u.id), next = units[ui + 1], ns = next && state.stageStates.get(next.id), tri = (x) => x && x.v, endV = s.done ? TRI.t : s.entered.v !== TRI.t ? tri(s.entered) : s.requiredLeft.length ? TRI.f : tri(s.end), nextV = next ? tri(ns.entered) : TRI.t, verdict = endV === TRI.t && nextV === TRI.t ? "ok" : endV === TRI.f || endV === TRI.t && nextV === TRI.f ? "blocked" : "unknown", why = verdict === "ok" ? "" : endV !== TRI.t ? `本阶段结束${verdict === "unknown" ? "要看运行时的情况" : "不了"}：${(s.entered.v !== TRI.t ? s.entered.reasons : s.end.reasons).join("；") || s.requiredLeft.map((n) => n.uid).join("、")}` : `下一阶段${verdict === "unknown" ? "能否进入要看运行时的情况" : "进不去"}：${ns.entered.reasons.join("；")}`;
          out.push({
            stage: stageLabel(u.stage.key),
            node: used.map((n) => n.uid || n.name).join(" → "),
            ok: verdict !== "blocked",
            verdict,
            why
          });
        }
    }
    return out;
  }
  function tableCondChecks(cond, tables, where = "", out = []) {
    if (!cond) return out;
    if (cond.kind === "group") return cond.items.forEach((c) => tableCondChecks(c, tables, where, out)), out;
    if (cond.kind === "count") {
      let f = findSheet(tables, cond.table), bad = f.error ? `这张卡没有「${cond.table}」这张表` : sheetRows(f.sheet).col(cond.column) < 0 ? `「${cond.table}」没有「${cond.column}」这一列` : "";
      out.push({ where, raw: cond.raw, now: "", level: bad ? "bad" : "ok", notes: bad ? [bad] : [], stuck: !!bad });
    } else if (cond.kind === "cell") {
      let r = cellCondCheck(cond, tables);
      out.push({ where, ...r, stuck: r.level === "bad" || !!cond.sample && !sampleAgrees(cond) });
    }
    return out;
  }
  function tableCondReport(volumes, tables) {
    let compiled = compileClue(volumes || []), out = [], visit = (cond, where) => tableCondChecks(cond, tables, where, out);
    for (let l of compiled.lines || []) visit(l.open, `线 ${l.id}「${l.name}」的开启条件`);
    for (let u of compiled.units) u.clue && [u.clue.enter, u.clue.end].forEach((c) => visit(c, stageLabel(u.stage.key)));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach((c) => visit(c, `${stageLabel(n.unit.stage.key)}·${n.name}`));
    return out;
  }
  function cellCondCheck(cond, tables) {
    let parts = String(cond.path).split("/").map((x) => x.trim()), notes = [], tierPending = null, res = (level, now2 = "") => ({ raw: cond.raw, now: now2, level, notes, ...tierPending ? { tierPending } : {} });
    if (parts.length !== 3 || parts.some((x) => !x)) return notes.push(`路径「${cond.path}」应写成 表/行/列`), res("bad");
    let [table, rowKey, column] = parts, f = findSheet(tables, table);
    if (f.error) return notes.push(`这张卡没有「${table}」这张表`), res("bad");
    let { col, rows: rows2 } = sheetRows(f.sheet), c = col(column), sheet = f.sheet;
    if (c < 0 && col(rowKey) >= 0 && (c = col(rowKey), rowKey = column), c < 0)
      return notes.push(`「${table}」没有「${column}」这一列`), res("bad");
    let note = sheet.note || "", others = rows2.filter((r) => cellText(r[1]) !== rowKey && !r.slice(1).some((x) => cellText(x) === rowKey)).map((r) => cellText(r[c])).filter(Boolean), hits = findRow(rows2, rowKey), cell = hits.length === 1 ? cellText(hits[0][c]) : "";
    sheet.freq === 0 && notes.push(`「${table}」设置成不自动更新（更新频率 0），条件可能一直不变`), hits.length > 1 && notes.push(`「${table}」里「${rowKey}」有 ${hits.length} 行，读的时候分不清，会一直是未知`), hits.length || notes.push(
      others.length ? `表里还没有「${rowKey}」这一行；同一列别的行已经有值（如「${others[0].slice(0, 30)}」），${rowKey}出现在表里以后才开始判断` : rows2.length ? `表里还没有「${rowKey}」这一行，同一列也都还没填，等表里有数据再看` : `「${table}」还没有数据，等表里有数据再核对`
    );
    let value = cell;
    if (cond.pick) {
      let pool = [cell, ...others].filter(Boolean), readable = pool.filter((x) => cellEntries(x).length);
      if (pool.length && !readable.length && notes.push(`「${column}」这一列现在的内容不是按「名字:内容」分条写的，取不出「${cond.pick}」这一项`), cell) {
        let got = pickEntry(cell, cond.pick);
        value = got.state === "ok" ? got.value : "", got.state !== "ok" && !/还没有/.test(got.reason) && notes.push(got.reason);
      }
    }
    if (cond.sample) {
      let s = cond.sample, real = [cell, ...others].some((x) => x && (x === s.text || x.includes(s.text))) || note.includes(s.text), proven = !!(cond.pick && cell && pickEntry(cell, cond.pick).state === "ok");
      real || proven || notes.push(`样例的原文「${s.text.slice(0, 30)}」不是表里或说明里的真实内容，证明不了插件读得懂这一列`), sampleAgrees(cond) || notes.push(
        `样例核对没通过：插件从「${s.text.slice(0, 30)}」里取「${s.key}」得到的是「${(s.key ? pickEntry(s.text, s.key).value : s.text) || "（取不出）"}」，AI 说是「${s.want}」。运行时这个条件按「读不出来」处理，不会放宽；可以改成手动开始`
      );
    }
    if (cond.tiers) {
      cond.tierOk || tierOrderInNote(note, cond.tiers) || ["==", "!="].includes(cond.op) || (tierPending = cond.tiers, notes.push(`档位顺序「${cond.tiers.join(" < ")}」是 AI 推断的，表格说明里没有明写先后（待确认）。确认之前这个条件是未知`));
      let seen = (t) => note.includes(t) || [cell, ...others].some((x) => x.includes(t)), miss = cond.tiers.filter((t) => !seen(t));
      miss.length && notes.push(`档位里的${miss.map((t) => `「${t}」`).join("、")}在表格说明和现有数据里都没出现，填表不一定会写`), value && tierIndex(value, cond.tiers) < 0 && notes.push(`现在的值「${value}」不是档位里的任何一档，这个条件会是未知`);
    } else if ([">=", "<=", ">", "<"].includes(cond.op) && !Number.isFinite(Number(cond.value)))
      notes.push(`「${cond.value}」不是数字，比大小要写档位（从低到高的列表）`);
    else if ((cond.op === "==" || /包含/.test(cond.op)) && cond.value && !Number.isFinite(Number(cond.value))) {
      let pool = [cell, ...others];
      if (!note.includes(cond.value) && !pool.some((x) => x.includes(cond.value))) {
        let long = pool.length && pool.every((x) => x.length > 12);
        notes.push(
          long && cond.op === "==" ? `「${column}」每次填的是一句话，「== ${cond.value}」几乎不会成立，可以改用「包含 关键词」，或者改成等某件事发生` : `「${cond.value}」在表格说明和现有数据里都没出现，填表不一定会写出这个词`
        );
      }
    }
    let now = hits.length ? cond.pick ? value ? `${cond.pick}：${value}` : cell ? `（没有「${cond.pick}」这一项）` : "（空）" : cell || "（空）" : "";
    return res(notes.length ? "warn" : "ok", now);
  }
  function focusScore(state, snapshot, clueProg) {
    let focus = state.nodeStates.find((s) => s.node.uid && s.node.uid === state.focus.uid);
    if (!focus) return 0;
    let n = 0;
    for (let d of discoveryList(isPlainObject(focus.node.item) ? focus.node.item : {})) {
      if (!d.fact) continue;
      let f = snapshot.facts && snapshot.facts.get(d.fact), over = clueProg && clueProg.factOverrides && clueProg.factOverrides[d.fact];
      effectiveFact(d.fact, snapshot, clueProg).confirmed ? n += 2 : f && f.claimed && !(over && over.status === "revoked") && (n += 1);
    }
    return n;
  }
  var CLUE_OFF_MATERIAL_RULE = "用户转去调查另一件事，而本轮材料没有提供那件事的具体发现时，写到到达、接触和开始调查为止：可以写环境、人物和对方的反应；东西上写着什么、翻开或打开后看到什么、对方说出的关键信息，都不要自己编，待后续材料提供后再写。本轮已经提供的发现、前文已经明确的内容以及普通日常行动，可以按实际行动继续，不必机械等到下一轮。";

  // src/core/clue-rules.js
  var COND_MAX_DEPTH = 2;
  var ATOM_KEYS = ["事实", "知情", "核实", "节点", "表", "时间", "线"], TRI = { t: "true", f: "false", u: "unknown" };
  function atomString(key, value) {
    let v = String(value ?? "").trim();
    return key === "时间" ? `时间 ${v}` : `${key}: ${v}`;
  }
  function parseAtom(text2) {
    let raw = String(text2 || "").trim(), m;
    if ((m = /^<if\s+cell\s*=\s*["“]([^"”]+)["”]\s*>?/i.exec(raw)) && (raw = `表: ${m[1].trim()}`), raw = normalizeOps(raw), m = /^事实\s*[:：]\s*(\S+)$/.exec(raw))
      return { kind: "fact", fact: m[1], raw };
    if (m = /^核实\s*[:：]\s*([^@\s]+)$/.exec(raw)) return { kind: "fact", fact: m[1], verified: !0, raw };
    if (m = /^(知情|核实)\s*[:：]\s*([^@\s]+)\s*@\s*(.+)$/.exec(raw))
      return { kind: "know", fact: m[2], actor: m[3].trim(), verified: m[1] === "核实", raw };
    if (m = /^节点\s*[:：]\s*(\S+)$/.exec(raw)) return { kind: "node", node: m[1], raw };
    if (m = /^表\s*[:：]\s*(.+?)\s*(==|!=|>=|<=|>|<|不包含|包含)\s*(.*)$/.exec(raw))
      return { kind: "cell", path: m[1].trim(), op: m[2], value: m[3].trim(), raw };
    if (m = /^时间\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(raw)) return { kind: "time", op: m[1], value: m[2].trim(), raw };
    if (m = /^线\s*[:：]\s*(\S+?)\s*(==|!=)\s*(\S+)$/.exec(raw)) {
      let state = m[3].trim();
      return LINE_STATES.includes(state) || LINE_STATE_ALIAS[state] ? { kind: "line", line: m[1], op: m[2], state, raw } : {
        kind: "bad",
        raw,
        error: `线的状态「${state}」不认识，可以写：${[...LINE_STATES, ...Object.keys(LINE_STATE_ALIAS)].join("、")}`
      };
    }
    return { kind: "bad", raw, error: `无法识别的条件「${raw}」` };
  }
  function parseCondition(value, errors = [], depth = 0) {
    if (value == null || value === "" || Array.isArray(value) && !value.length || isPlainObject(value) && !Object.keys(value).length)
      return null;
    if (typeof value == "string") {
      let atom = parseAtom(value);
      return atom.kind === "bad" && errors.push(atom.error), atom;
    }
    let mode = "all", items;
    if (isPlainObject(value) && Object.keys(value).length === 1 && value.计数 !== void 0) return parseCountAtom(value.计数, errors);
    if (isPlainObject(value) && value.表 !== void 0 && Object.keys(value).length > 1 && Object.keys(value).every((k) => CELL_EXTRA_KEYS.includes(k)))
      return parseCellExtra(value, errors);
    if (isPlainObject(value)) {
      let keys = Object.keys(value), atoms = keys.filter((key) => ATOM_KEYS.includes(key));
      if (atoms.length && atoms.length === keys.length) {
        let list = atoms.map((key) => atomString(key, value[key]));
        if (list.length === 1) return parseCondition(list[0], errors, depth);
        value = list;
      }
    }
    if (Array.isArray(value)) items = value;
    else if (isPlainObject(value) && Array.isArray(value.全部) && Object.keys(value).length === 1) items = value.全部;
    else if (isPlainObject(value) && Array.isArray(value.任一) && Object.keys(value).length === 1) mode = "any", items = value.任一;
    else return errors.push(`无法识别的条件结构：${JSON.stringify(value).slice(0, 60)}`), { kind: "bad", raw: "", error: "结构错误" };
    return depth >= COND_MAX_DEPTH ? (errors.push("条件嵌套超过两层"), { kind: "bad", raw: "", error: "嵌套过深" }) : { kind: "group", mode, items: items.map((item) => parseCondition(item, errors, depth + 1)).filter(Boolean) };
  }
  function digitsOf(text2) {
    return (String(text2).match(/\d+/g) || []).map(Number);
  }
  function compareValues(a, b) {
    let na = Number(cellText(a)), nb = Number(cellText(b));
    if (cellText(a) !== "" && cellText(b) !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    let da = digitsOf(a), db = digitsOf(b);
    if (!da.length || !db.length) return null;
    for (let i = 0; i < Math.max(da.length, db.length); i += 1) {
      let x = da[i] ?? 0, y = db[i] ?? 0;
      if (x !== y) return x - y;
    }
    return 0;
  }
  function applyOp(op, cell, wanted) {
    if (op === "==") return sameValue(cell, wanted);
    if (op === "!=") return !sameValue(cell, wanted);
    let diff = compareValues(cell, wanted);
    return diff === null ? null : op === ">=" ? diff >= 0 : op === "<=" ? diff <= 0 : op === ">" ? diff > 0 : diff < 0;
  }
  function effectiveFact(id, snapshot, clueProg) {
    let over = clueProg && clueProg.factOverrides && clueProg.factOverrides[id], fact = snapshot && snapshot.facts && snapshot.facts.get(id);
    return over && over.status === "revoked" ? { v: TRI.f, confirmed: !1, text: "", why: `${id} 已人工撤销` } : over && over.status === "confirmed" ? { v: TRI.t, confirmed: !0, text: fact && fact.text || over.text || "", why: `${id} 已人工确认` } : fact ? fact.status === "confirmed" ? { v: TRI.t, confirmed: !0, text: fact.text, why: `${id} 已确认` } : fact.status === "pending" ? { v: TRI.u, confirmed: !1, text: "", why: `${id} 待确认` } : { v: TRI.f, confirmed: !1, text: "", why: `${id} 未核实（${fact.raw || "空"}）` } : { v: TRI.u, confirmed: !1, text: "", why: `${id} 尚无记录` };
  }
  function evalAtom(atom, env) {
    switch (atom.kind) {
      case "fact": {
        let eff = effectiveFact(atom.fact, { facts: env.facts }, { factOverrides: env.factOverrides });
        if (atom.verified || eff.v !== TRI.f) return { v: eff.v, why: eff.why };
        let fact = env.facts && env.facts.get(atom.fact), over = env.factOverrides && env.factOverrides[atom.fact];
        return fact && fact.claimed && !(over && over.status === "revoked") ? { v: TRI.t, why: `${atom.fact} 已在正文出现（${fact.raw || "说法"}）` } : { v: eff.v, why: eff.why };
      }
      case "know": {
        let over = env.factOverrides && env.factOverrides[atom.fact];
        if (over && over.status === "revoked") return { v: TRI.f, why: `${atom.fact} 已人工撤销` };
        let rows2 = env.knowledge.filter((row2) => row2.fact === atom.fact && row2.actor === atom.actor);
        return rows2.length ? atom.verified ? rows2.some((row2) => row2.verified === !0) ? { v: TRI.t, why: `${atom.actor} 已核实 ${atom.fact}` } : rows2.some((row2) => row2.verified === null) ? { v: TRI.u, why: `无法判断 ${atom.actor} 是否核实 ${atom.fact}（可信度未绑定或未填写）` } : { v: TRI.f, why: `${atom.actor} 对 ${atom.fact} 仅为${rows2[0].credibility || "未核实"}` } : { v: TRI.t, why: `${atom.actor} 知道 ${atom.fact}${rows2[0].way ? `（${rows2[0].way}）` : ""}` } : { v: TRI.u, why: `${atom.actor} 没有 ${atom.fact} 的知情记录` };
      }
      case "line": {
        let st9 = env.lineState ? env.lineState(atom.line) : void 0;
        if (st9 === void 0) return { v: TRI.u, why: `没有编号为 ${atom.line} 的线` };
        if (st9 === null)
          return atom.state === "开过" && env.lineStarted && env.lineStarted(atom.line) ? { v: atom.op === "==" ? TRI.t : TRI.f, why: `线 ${atom.line} 已经开始过` } : { v: TRI.u, why: `线 ${atom.line} 的状态还算不出来（开启条件未知，或线之间循环引用）` };
        let hit = (LINE_STATE_ALIAS[atom.state] || [atom.state]).includes(st9);
        return { v: (atom.op === "==" ? hit : !hit) ? TRI.t : TRI.f, why: `线 ${atom.line} 现在是「${st9}」` };
      }
      case "count": {
        let r = countRows(env.tables, atom.table, atom.column, atom.op, atom.value, applyOp);
        if (r.state !== "ok") return { v: TRI.u, why: r.reason };
        let test = (n) => atom.cmp === "至少" ? n >= atom.n : atom.cmp === "至多" ? n <= atom.n : n === atom.n, lo = test(r.count), hi = test(r.count + r.unsure), label = `${atom.table} 里 ${atom.column} ${atom.op} ${atom.value} 的有 ${r.count} 行${r.unsure ? `，另有 ${r.unsure} 行的值无法比较` : ""}`;
        return atom.cmp === "等于" && (lo = hi = atom.n >= r.count && atom.n <= r.count + r.unsure && (!r.unsure || null)), lo === hi && lo !== null ? lo ? { v: TRI.t, why: label } : { v: TRI.f, why: `${label}（要${atom.cmp} ${atom.n} 行）` } : { v: TRI.u, why: label };
      }
      case "node": {
        let done = env.nodeDone(atom.node);
        return done === void 0 ? { v: TRI.u, why: `节点 ${atom.node} 不存在` } : done ? { v: TRI.t, why: `节点 ${atom.node} 已完成` } : { v: TRI.f, why: `节点 ${atom.node} 未完成` };
      }
      case "cell":
      case "time": {
        let paths = atom.kind === "time" ? [].concat(env.timePath || []).filter(Boolean) : [atom.path];
        if (!paths.length) return { v: TRI.u, why: "未绑定故事时间" };
        let cell = null, misses = [];
        for (let path of paths) {
          let got = readCell(env.tables, path);
          if (got.state === "ok") {
            cell = got;
            break;
          }
          misses.push(got.reason);
        }
        if (!cell) return { v: TRI.u, why: misses.join("；") };
        let label = atom.kind === "time" ? "时间" : atom.path, value = cell.value;
        if (atom.sample && !sampleAgrees(atom))
          return { v: TRI.u, why: `${label}：这种写法插件暂时读不出来（样例核对没通过），可以改成手动开始` };
        if (atom.pick) {
          let got = pickEntry(value, atom.pick);
          if (got.state !== "ok") return { v: TRI.u, why: `${label}：${got.reason}` };
          value = got.value, label = `${label}里「${atom.pick}」那一项`;
        }
        if (atom.tiers && !["==", "!="].includes(atom.op) && !tierOrderKnown(atom, env.tables))
          return { v: TRI.u, why: `${label}：档位顺序「${atom.tiers.join(" < ")}」还没确认，确认前不比大小` };
        let ok = atom.op === "包含" || atom.op === "不包含" ? cellText(value).includes(atom.value) === (atom.op === "包含") : atom.tiers ? tierCompare(atom.op, value, atom.value, atom.tiers) : applyOp(atom.op, value, atom.value);
        return ok === null ? {
          v: TRI.u,
          why: atom.tiers ? `${label}「${cellText(value)}」不是档位 ${atom.tiers.join("/")} 里的任何一档` : `${label}「${cellText(value)}」无法与「${atom.value}」比较`
        } : { v: ok ? TRI.t : TRI.f, why: `${label} = ${cellText(value)}` };
      }
      default:
        return { v: TRI.u, why: atom.error || "条件错误" };
    }
  }
  function evalCondition(cond, env) {
    if (!cond) return { v: TRI.t, reasons: [] };
    if (cond.kind !== "group") {
      let r = evalAtom(cond, env);
      return { v: r.v, reasons: [r.why] };
    }
    let results = cond.items.map((item) => evalCondition(item, env));
    if (cond.mode === "all") {
      let bad = results.filter((r) => r.v !== TRI.t);
      return bad.length ? { v: bad.some((r) => r.v === TRI.f) ? TRI.f : TRI.u, reasons: bad.flatMap((r) => r.reasons) } : { v: TRI.t, reasons: results.flatMap((r) => r.reasons) };
    }
    let hit = results.find((r) => r.v === TRI.t);
    return hit ? { v: TRI.t, reasons: hit.reasons } : {
      v: results.some((r) => r.v === TRI.u) ? TRI.u : TRI.f,
      reasons: [`以下任一满足即可：${results.flatMap((r) => r.reasons).join("；")}`]
    };
  }
  function conditionRefs(cond, out = {
    facts: /* @__PURE__ */ new Set(),
    nodes: /* @__PURE__ */ new Set(),
    knows: /* @__PURE__ */ new Set(),
    lines: /* @__PURE__ */ new Set()
  }) {
    return out.knows || (out.knows = /* @__PURE__ */ new Set()), out.lines || (out.lines = /* @__PURE__ */ new Set()), cond ? cond.kind === "group" ? (cond.items.forEach((item) => conditionRefs(item, out)), out) : ((cond.kind === "fact" || cond.kind === "know") && out.facts.add(cond.fact), cond.kind === "know" && out.knows.add(`${cond.fact}@${cond.actor}`), cond.kind === "node" && out.nodes.add(cond.node), cond.kind === "line" && out.lines.add(cond.line), out) : out;
  }
  function prebuiltGaps(compiled, snapshot, { checkKnowledge = !0 } = {}) {
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let node of compiled.nodes) for (let cond of [node.open, node.early, node.done]) conditionRefs(cond, refs);
    for (let l of compiled.lines || []) conditionRefs(l.open, refs), l.legacyFact && refs.facts.add(l.legacyFact);
    let out = [], missingFacts = [...refs.facts].filter((id) => !(snapshot.facts && snapshot.facts.has(id))), present = snapshot.knowPresent;
    if (missingFacts.length && out.push(`事实表里没有这些编号的行：${missingFacts.join("、")}（条件会一直是「未知」）`), checkKnowledge && present) {
      let missingKnows = [...refs.knows].filter((k) => !present.has(k));
      missingKnows.length && out.push(`知情表里还没有这些「事实@角色」的行：${missingKnows.join("、")}`);
    }
    return out;
  }
  function tableConsistencyHints(snapshot) {
    let hints = [], holders = /* @__PURE__ */ new Map();
    for (let row2 of snapshot.knowledge || []) holders.set(row2.fact, [...holders.get(row2.fact) || [], row2.actor]);
    for (let [id, fact] of snapshot.facts || []) {
      let who = holders.get(id) || [];
      (fact.status === "confirmed" || fact.claimed) && !who.length && snapshot.knowPresent && [...snapshot.knowPresent].some((k) => k.startsWith(`${id}@`)) && hints.push(
        `${id} 在事实表里已记为「${fact.raw || "已确认"}」，但知情表里还没有任何人知道它；如果正文里有人亲见或听到，检查知情表是否漏填`
      ), fact.status === "unconfirmed" && !fact.claimed && who.length && hints.push(`知情表记录了 ${who.join("、")} 知道 ${id}，但事实表仍是「${fact.raw}」；检查事实表是否漏填`);
    }
    return hints;
  }
  var AWAY_PREFIX = "@away:";
  var NODE_STATUS_LABELS = { locked: "未开放", available: "可进行", active: "进行中", done: "已完成" };
  function emptyClueProgress() {
    return { focus: "", overrides: {}, factOverrides: {}, log: [] };
  }
  function isRequired(node) {
    let flag = isPlainObject(node.item) ? node.item.必需 : void 0;
    return flag == null || flag === "" ? node.kind === "main" : flag === !0 || flag === "是" || flag === "true";
  }
  function compileClue(volumes) {
    let errors = [], units = flattenUnits(volumes), nodes = [], ids = /* @__PURE__ */ new Set();
    for (let unit of units) {
      let data = isPlainObject(unit.stage.data) ? unit.stage.data : {}, where = stageLabel(unit.stage.key), errs = [], enter = parseCondition(data.进入条件, errs), end = parseCondition(data.结束条件, errs);
      errs.forEach((e) => errors.push(`${where}：${e}`)), unit.clue = { enter, end, hasEnter: data.进入条件 != null && data.进入条件 !== "" };
      for (let node of stageNodes(data)) {
        let item = isPlainObject(node.item) ? node.item : {}, uid = nodeUid(item), nerrs = [], c = {
          ...node,
          uid,
          unit,
          required: isRequired(node),
          open: parseCondition(item.开放条件, nerrs),
          early: parseCondition(item.提前条件, nerrs),
          done: parseCondition(item.完成条件, nerrs)
        };
        nerrs.forEach((e) => errors.push(`${where}·${node.name}：${e}`)), uid ? ids.has(uid) ? errors.push(`节点 ID「${uid}」重复`) : ids.add(uid) : node.kind === "main" && errors.push(`${where}·${node.name}：缺少稳定 ID`), nodes.push(c);
      }
    }
    for (let node of nodes)
      for (let ref of conditionRefs(node.open).nodes)
        ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
      for (let cond of [node.early, node.done])
        for (let ref of conditionRefs(cond).nodes)
          ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
      node.uid && conditionRefs(node.done).nodes.has(node.uid) && errors.push(
        `${stageLabel(node.unit.stage.key)}·${node.name}：完成条件引用了节点自己（${node.uid}），永远不会完成；应写成它自己产出的事实`
      );
    for (let unit of units)
      for (let [label, cond] of [
        ["进入条件", unit.clue.enter],
        ["结束条件", unit.clue.end]
      ])
        for (let ref of conditionRefs(cond).nodes)
          ids.has(ref) || errors.push(`${stageLabel(unit.stage.key)}·${label}：引用了不存在的节点「${ref}」`);
    let lines2 = compileLines(units, errors), lineIds = new Set(lines2.map((l) => l.id)), refCheck = (cond, where) => {
      for (let ref of conditionRefs(cond).lines) lineIds.has(ref) || errors.push(`${where}：引用了不存在的线「${ref}」`);
    };
    for (let l of lines2) refCheck(l.open, `线 ${l.id} 的开启条件`);
    for (let node of nodes)
      [node.open, node.early, node.done].forEach((c) => refCheck(c, `${stageLabel(node.unit.stage.key)}·${node.name}`));
    for (let unit of units) [unit.clue.enter, unit.clue.end].forEach((c) => refCheck(c, stageLabel(unit.stage.key)));
    return { units, nodes, errors, lines: lines2 };
  }
  function computeClueState(compiled, snapshot, clueProg, config = DEFAULT_CLUE) {
    let { units, nodes } = compiled, lines2 = compiled.lines || [], byUid = new Map(nodes.filter((n) => n.uid).map((n) => [n.uid, n])), overrides = clueProg.overrides || {}, doneMemo = /* @__PURE__ */ new Map(), visiting = /* @__PURE__ */ new Set(), cycles = [], lineMemo = /* @__PURE__ */ new Map(), lineVisiting = /* @__PURE__ */ new Set(), byLine = new Map(lines2.map((l) => [l.id, l])), env = {
      facts: snapshot.facts || /* @__PURE__ */ new Map(),
      knowledge: snapshot.knowledge || [],
      tables: snapshot.tables || {},
      timePath: config.bindings && config.bindings.time && config.bindings.time.路径,
      factOverrides: clueProg.factOverrides || {},
      nodeDone: (uid) => {
        let node = byUid.get(uid);
        return node ? nodeDone(node).v === TRI.t : void 0;
      },
      // 给条件求值用的线状态：开启条件是未知（含循环）而落到「未触发」的，不当成确定的「未触发」交出去，返回 null（GPT 代码审阅 R4）。
      lineState: (id) => {
        let l = byLine.get(id);
        if (!l) return;
        let s = lineStateOf(l);
        return s && !s.pending ? s.state : null;
      },
      lineStarted: (id) => {
        let l = byLine.get(id);
        return !!l && lineEvidence(l);
      }
    };
    function nodeDone(node) {
      if (node.uid && doneMemo.has(node.uid)) return doneMemo.get(node.uid);
      let over = node.uid && overrides[node.uid] || {}, result;
      return over.done === "force" ? result = { v: TRI.t, reasons: ["人工标记完成"], manual: !0 } : over.done === "undo" ? result = { v: TRI.f, reasons: ["人工撤销完成"], manual: !0 } : node.done ? node.uid && visiting.has(node.uid) ? (cycles.push(node.uid), result = { v: TRI.u, reasons: [`节点 ${node.uid} 条件循环引用`] }) : (node.uid && visiting.add(node.uid), result = evalCondition(node.done, env), node.uid && visiting.delete(node.uid)) : result = { v: TRI.f, reasons: ["没有完成条件，需人工标记"] }, node.uid && doneMemo.set(node.uid, result), result;
    }
    let stageStates = /* @__PURE__ */ new Map();
    function stageChain(list, firstEntered) {
      let prevDone = !0;
      for (let [k, unit] of list.entries()) {
        let own = nodes.filter((n) => n.unit === unit), required = own.filter((n) => n.required), gate = k === 0 && firstEntered ? firstEntered() : null, entered = gate && gate.v !== TRI.t ? gate : unit.clue.hasEnter ? evalCondition(unit.clue.enter, env) : prevDone ? { v: TRI.t, reasons: [k === 0 && gate ? gate.reasons[0] : "上一阶段已结束"] } : { v: TRI.f, reasons: ["上一阶段尚未结束"] }, requiredLeft = required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t), end = evalCondition(unit.clue.end, env), done = entered.v === TRI.t && !requiredLeft.length && end.v === TRI.t;
        gate && gate.v !== TRI.t && (entered = gate), stageStates.set(unit.id, { unit, entered, end, requiredLeft, done: entered.v === TRI.t && done }), prevDone = entered.v === TRI.t && done;
      }
    }
    function legacySeen(l) {
      return !!l.legacyFact && evalAtom({ kind: "fact", fact: l.legacyFact }, env).v === TRI.t;
    }
    function lineEvidence(l) {
      return !!((clueProg.lines || {})[l.id] || {}).started || legacySeen(l);
    }
    function windowOf(l) {
      let w = l.window;
      if (!w) return { v: TRI.t, reasons: [] };
      if (w.bad) return { v: TRI.u, reasons: [`开启时段写得不对：${w.bad}`] };
      let main = byLine.get(w.main), ms = main ? lineStateOf(main) : null;
      if (!ms) return { v: TRI.u, reasons: [`主线 ${w.main} 的状态还算不出来`] };
      if (ms.state === "完成" || ms.state === "放弃")
        return { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main} ${ms.state === "完成" ? "已经完成" : "已经放弃"}）`] };
      if (!ms.started) return { v: TRI.f, reasons: [`要等主线 ${w.main} 开始`] };
      let from = w.from ? stageStates.get(w.from) : null, to = w.to ? stageStates.get(w.to) : null;
      return from && from.entered.v !== TRI.t ? { v: from.entered.v === TRI.u ? TRI.u : TRI.f, reasons: [`要等 ${w.main} 进入「${w.fromLabel}」`] } : to && to.done ? { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main} 的「${w.toLabel}」已经结束）`] } : { v: TRI.t, reasons: [`在 ${w.main} 的开启时段内`] };
    }
    function mainBusy(l) {
      let at = lines2.indexOf(l);
      for (let [k, o] of lines2.entries()) {
        if (o === l || o.kind !== "main" || o.mode !== "auto" && !lineEvidence(o) || !lineEvidence(o) && k > at) continue;
        let s = lineStateOf(o);
        if (!s) return `主线 ${o.id} 的状态还算不出来`;
        if (s.state === "进行中" || s.state === "暂停")
          return `主线 ${o.id} ${s.state === "暂停" ? "暂停中，还占着主线的位置" : "还在进行"}`;
      }
      return "";
    }
    function lineStateOf(l) {
      if (lineMemo.has(l.id)) return lineMemo.get(l.id);
      if (lineVisiting.has(l.id)) return cycles.push(`线 ${l.id}`), null;
      lineVisiting.add(l.id);
      let man = (clueProg.lines || {})[l.id] || {}, legacy = !man.started && legacySeen(l), evidence = !!man.started || legacy, settled = man.state && (evidence || man.state !== "pause"), cond = settled ? { v: TRI.t, reasons: [] } : evalCondition(l.open, env), win = settled || evidence ? { v: TRI.t, reasons: [] } : windowOf(l), eligible = cond.v === TRI.t && win.v === TRI.t, started = evidence, why = man.started ? man.how || "已开始" : legacy ? `开场事实 ${l.legacyFact} 已出现` : "", waitMain = "";
      !evidence && !man.state && eligible && l.kind === "main" && l.mode === "auto" && ((waitMain = mainBusy(l)) || (started = !0, why = "开启条件已满足"));
      let state = man.state === "abandon" ? "放弃" : man.state === "done" ? "完成" : man.state === "pause" ? "暂停" : started ? "进行中" : eligible ? "可开启" : "未触发", result = {
        line: l,
        state,
        started,
        eligible,
        cond,
        window: win,
        missed: !started && !man.state && !!win.missed,
        why,
        waitMain,
        manual: man,
        entries: [],
        pending: !man.state && !started && (cond.v === TRI.u || win.v === TRI.u)
      };
      if (state === "进行中") {
        stageChain(l.units, () => ({ v: TRI.t, reasons: [`线 ${l.id} 进行中（${why}）`] }));
        let last = stageStates.get(l.units[l.units.length - 1].id);
        last && last.done && (result.state = "完成", result.why = "最后一个阶段已结束");
      }
      return lineVisiting.delete(l.id), lineMemo.set(l.id, result), result;
    }
    let free = units.filter((u) => !u.line);
    stageChain(free, null);
    let lineStates = lines2.map(
      (l) => lineStateOf(l) || {
        line: l,
        state: "未触发",
        started: !1,
        eligible: !1,
        cond: { v: TRI.u, reasons: ["线之间循环引用"] },
        window: { v: TRI.u, reasons: [] },
        missed: !1,
        why: "",
        waitMain: "",
        manual: {},
        entries: [],
        pending: !0
      }
    );
    for (let s of lineStates) {
      if (s.state === "进行中" || s.state === "完成" && s.started) {
        stageStates.has(s.line.units[0].id) || stageChain(s.line.units, () => ({ v: TRI.t, reasons: [`线 ${s.line.id} ${s.state}`] }));
        continue;
      }
      let gate = {
        v: s.state === "可开启" ? TRI.f : s.pending ? TRI.u : TRI.f,
        reasons: [`线 ${s.line.id} ${s.missed ? "已错过" : s.state}${s.state === "可开启" ? "，还没开始" : ""}`]
      };
      for (let unit of s.line.units) {
        let own = nodes.filter((n) => n.unit === unit), required = own.filter((n) => n.required);
        stageStates.set(unit.id, {
          unit,
          entered: gate,
          end: evalCondition(unit.clue.end, env),
          requiredLeft: required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t),
          done: !1
        });
      }
    }
    for (let s of lineStates) {
      if (s.started || s.state !== "可开启") continue;
      let first = s.line.units[0];
      !first || first.clue.hasEnter && evalCondition(first.clue.enter, env).v !== TRI.t || (s.entries = nodes.filter(
        (n) => n.unit === first && n.uid && (overrides[n.uid] || {}).open !== "block" && nodeDone(n).v !== TRI.t && (!n.open || evalCondition(n.open, env).v === TRI.t)
      ).map((n) => n.uid));
    }
    let lineOf = new Map(lineStates.map((s) => [s.line, s])), nodeStates = nodes.map((node) => {
      let over = node.uid && overrides[node.uid] || {}, stage = stageStates.get(node.unit.id), done = nodeDone(node), open, ls = node.unit.line && lineOf.get(node.unit.line);
      if (ls && ls.state !== "进行中") open = { v: TRI.f, reasons: [`所在的线 ${ls.line.id} ${ls.missed ? "已错过" : ls.state}`] };
      else if (ls && ls.line.kind === "side" && clueProg.sidePaused) open = { v: TRI.f, reasons: ["支线已全部暂停"] };
      else if (over.open === "force") open = { v: TRI.t, reasons: ["人工开放"], manual: !0 };
      else if (over.open === "block") open = { v: TRI.f, reasons: ["已手动停用"], manual: !0 };
      else {
        let normal = stage.entered.v !== TRI.t ? { v: stage.entered.v, reasons: [`阶段未进入：${stage.entered.reasons.join("；")}`] } : evalCondition(node.open, env), early = node.early ? evalCondition(node.early, env) : null;
        open = normal.v === TRI.t ? normal : early && early.v === TRI.t ? { v: TRI.t, reasons: ["提前条件满足", ...early.reasons] } : normal;
      }
      let status = done.v === TRI.t ? "done" : open.v === TRI.t ? "available" : "locked";
      return { node, status, open, done, skipped: !!over.skip, disabled: over.open === "block", manualOpen: over.open === "force" };
    }), focus = pickFocus(nodeStates, clueProg, lines2.length ? { ...config, autoFocusSingle: !1 } : config, snapshot, stageStates);
    for (let state of nodeStates)
      state.node.uid && state.node.uid === focus.uid && state.status === "available" && (state.status = "active");
    let current = units.find((unit) => {
      let s = stageStates.get(unit.id);
      return s.entered.v === TRI.t && !s.done;
    }) || null;
    return { nodeStates, stageStates, focus, current, lineStates, cycles: [...new Set(cycles)], problems: snapshot.problems || [] };
  }
  function pickFocus(nodeStates, clueProg, config, snapshot, stageStates) {
    let usable = (uid) => nodeStates.find((s) => s.node.uid === uid && s.status === "available" && !s.disabled), manual = clueProg.focus || "", awayFrom = manual.startsWith(AWAY_PREFIX) ? manual.slice(AWAY_PREFIX.length) : "", sceneBinding = config.bindings && config.bindings.scene, scenePath = sceneBinding && sceneBinding.路径, cell = scenePath ? readCell(snapshot.tables || {}, scenePath) : null, cellValue = cell && cell.state === "ok" ? cellText(cell.value) : "", tableMovedOn = !!manual && clueProg.focusSceneAt !== void 0 && (!!clueProg.focusTaken || cell && cell.state === "ok" && cellValue !== clueProg.focusSceneAt);
    if (manual && !awayFrom && !tableMovedOn && usable(manual)) return { uid: manual, source: "manual" };
    let tableAway = !1;
    if (scenePath) {
      if (cell.state === "ok" && (cellValue !== awayFrom || tableMovedOn) && usable(cellValue))
        return { uid: cellValue, source: "table" };
      tableAway = cell.state === "ok" && sceneIsNone(cell.value, sceneBinding);
    }
    if (config.autoFocusSingle !== !1 && !tableAway) {
      let stageDone = (s) => !!(stageStates && s.node.unit && (stageStates.get(s.node.unit.id) || {}).done), mains = nodeStates.filter(
        (s) => s.status === "available" && s.node.kind === "main" && s.node.uid && !s.disabled && !stageDone(s)
      );
      if (mains.length === 1 && mains[0].node.uid !== awayFrom) return { uid: mains[0].node.uid, source: "auto" };
      if (mains.length === 1) return { uid: "", source: "away" };
    }
    return tableAway || awayFrom && !tableMovedOn ? { uid: "", source: "away" } : manual && !awayFrom && nodeStates.some((s) => s.node.uid === manual && s.status === "done") ? { uid: "", source: "manualDone" } : { uid: "", source: clueProg.focus ? "stale" : "none" };
  }
  var LINE_STATES = ["未触发", "可开启", "进行中", "暂停", "完成", "放弃"], LINE_STATE_ALIAS = { 开过: ["进行中", "暂停", "完成", "放弃"], 开着: ["进行中", "暂停"] };
  function normalizeOps(text2) {
    return String(text2 || "").replace(/＞＝|≥/g, ">=").replace(/＜＝|≤|≦/g, "<=").replace(/！＝|≠/g, "!=").replace(/＝＝/g, "==").replace(/＞/g, ">").replace(/＜/g, "<").replace(/＝/g, "==").replace(/(^|[^=!<>])=(?!=)/g, "$1==");
  }
  function parseCountAtom(value, errors) {
    let raw = JSON.stringify(value);
    if (!isPlainObject(value))
      return errors.push(`计数条件应写成 {表: 表名, 条件: 列 >= 值, 至少: N}：${raw.slice(0, 60)}`), { kind: "bad", raw, error: "计数格式错误" };
    let table = String(value.表 || "").trim(), m = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(normalizeOps(value.条件)), cmp = ["至少", "至多", "等于"].find((k) => value[k] !== void 0 && value[k] !== ""), n = cmp ? Number(value[cmp]) : NaN;
    return !table || !m || !cmp || !Number.isFinite(n) ? (errors.push(`计数条件缺少表名、条件（列 运算 值）或数量（至少 / 至多 / 等于）：${raw.slice(0, 60)}`), { kind: "bad", raw, error: "计数格式错误" }) : {
      kind: "count",
      table,
      column: m[1].trim(),
      op: m[2],
      value: m[3].trim(),
      cmp,
      n,
      raw: `计数: ${table} 中 ${m[1].trim()} ${m[2]} ${m[3].trim()} 的行数${cmp}${n}`
    };
  }
  var CELL_EXTRA_KEYS = ["表", "取", "档位", "样例", "顺序"];
  function parseCellExtra(value, errors) {
    let atom = parseAtom(`表: ${String(value.表 ?? "").trim()}`), raw = JSON.stringify(value).slice(0, 80);
    if (atom.kind !== "cell") return errors.push(atom.error), atom;
    if (value.取 !== void 0) {
      let key = String(value.取 ?? "").trim();
      if (!key) return errors.push(`「取」没写名字：${raw}`), { kind: "bad", raw, error: "取值格式错误" };
      atom.pick = key;
    }
    if (value.档位 !== void 0) {
      let tiers = Array.isArray(value.档位) ? value.档位.map((t) => String(t ?? "").trim()).filter(Boolean) : [];
      if (tiers.length < 2 || new Set(tiers).size !== tiers.length)
        return errors.push(`档位要写成至少两项、不重复的列表，从低到高：${raw}`), { kind: "bad", raw, error: "档位格式错误" };
      if (/包含/.test(atom.op)) return errors.push(`「包含」不用写档位：${raw}`), { kind: "bad", raw, error: "档位格式错误" };
      if (!tiers.includes(atom.value))
        return errors.push(`条件里的「${atom.value}」不在档位 ${tiers.join("/")} 里：${raw}`), { kind: "bad", raw, error: "档位格式错误" };
      atom.tiers = tiers, atom.tierOk = String(value.顺序 ?? "").trim() === "已确认";
    }
    if (value.样例 !== void 0) {
      let s = joinFlowSplit(value.样例, ["原文", "取", "得"]);
      if (!isPlainObject(s) || s.原文 == null || s.得 == null)
        return errors.push(`样例要写成 {原文: …, 取: …, 得: …}：${raw}`), { kind: "bad", raw, error: "样例格式错误" };
      atom.sample = { text: String(s.原文), key: String(s.取 ?? atom.pick ?? "").trim(), want: String(s.得).trim() };
    }
    return atom.raw = `${atom.raw}${atom.pick ? `（取「${atom.pick}」）` : ""}${atom.tiers ? `（档位 ${atom.tiers.join("<")}）` : ""}`, atom;
  }
  function joinFlowSplit(obj, keys) {
    if (!isPlainObject(obj)) return obj;
    let out = {}, cur = "";
    for (let [k, v] of Object.entries(obj))
      if (keys.includes(k)) out[k] = v, cur = k;
      else if (v == null && cur) out[cur] = `${out[cur] ?? ""},${k}`;
      else return obj;
    return out;
  }
  function sampleAgrees(atom) {
    if (!atom.sample) return null;
    let s = atom.sample;
    if (!s.key) return cellText(s.text) === s.want;
    let got = pickEntry(s.text, s.key);
    return got.state === "ok" && (got.value === s.want || got.value.split(/[,，、]/).map((x) => x.trim()).includes(s.want));
  }
  function tierOrderKnown(atom, tables) {
    if (atom.tierOk) return !0;
    let f = findSheet(
      tables || {},
      String(atom.path || "").split("/")[0].trim()
    );
    return !f.error && tierOrderInNote(f.sheet.note, atom.tiers);
  }
  function confirmTierOrder(volumes, tiers) {
    let want = (tiers || []).join(""), changed = !1, walk = (v) => {
      if (Array.isArray(v)) {
        let out2 = v.map(walk);
        return out2.some((x, i) => x !== v[i]) ? out2 : v;
      }
      if (!isPlainObject(v)) return v;
      let out = null;
      for (let [k, x] of Object.entries(v)) {
        let y = walk(x);
        y !== x && ((out = out || { ...v })[k] = y);
      }
      let cur = out || v;
      return cur.表 !== void 0 && Array.isArray(cur.档位) && cur.档位.map((t) => String(t ?? "").trim()).join("") === want && String(cur.顺序 ?? "").trim() !== "已确认" ? (changed = !0, { ...cur, 顺序: "已确认" }) : cur;
    }, next = (volumes || []).map((vol) => {
      let line = walk(vol.line), stages = walk(vol.stages);
      return line === vol.line && stages === vol.stages ? vol : { ...vol, ...vol.line !== void 0 ? { line } : {}, stages };
    });
    return changed ? next : volumes;
  }
  var LINE_MODES = { 条件满足即开始: "auto", 走进去才开始: "enter", 人工: "manual", 等开场: "enter" };
  function withLineIds(volumes) {
    let list = volumes || [];
    if (!list.some((v) => isPlainObject(v.line))) return list;
    let used = new Set(list.map((v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "").filter(Boolean)), n = 1, changed = !1, next = list.map((v) => {
      if (isPlainObject(v.line)) return v;
      for (; used.has(`M${n}`); ) n++;
      return used.add(`M${n}`), changed = !0, { ...v, line: { 编号: `M${n}`, 类型: "主线" } };
    });
    return changed ? next : list;
  }
  function resolveLineWindow(raw, lines2, errs) {
    if (raw == null || raw === "") return null;
    if (!isPlainObject(raw)) return errs.push("开启时段应写成 {主线: M1, 从: 阶段2, 到: 阶段3}"), { bad: "开启时段写法不对" };
    let mainId = String(raw.主线 || "").trim(), main = lines2.find((l) => l.id === mainId);
    if (!main) return errs.push(`开启时段引用了不存在的主线「${mainId}」`), { bad: `找不到主线 ${mainId}` };
    if (main.kind !== "main") return errs.push(`开启时段里的「${mainId}」不是主线`), { bad: `${mainId} 不是主线` };
    let find = (ref) => {
      let r = String(ref ?? "").trim();
      if (!r) return { unit: null };
      let hits = main.units.filter((u) => {
        let { short, title: title2 } = splitStageKey(u.stage.key);
        return [u.stage.key, short, title2, stageLabel(u.stage.key)].map((x) => String(x || "").trim()).includes(r);
      });
      return hits.length === 1 ? { unit: hits[0] } : {
        error: hits.length ? `开启时段里的「${r}」在 ${mainId} 里有好几个同名阶段` : `开启时段里的阶段「${r}」在 ${mainId} 里找不到`
      };
    }, from = find(raw.从), to = find(raw.到), bad = from.error || to.error;
    return bad ? (errs.push(bad), { bad }) : {
      main: mainId,
      from: from.unit ? from.unit.id : "",
      to: to.unit ? to.unit.id : "",
      fromLabel: from.unit ? stageLabel(from.unit.stage.key) : "",
      toLabel: to.unit ? stageLabel(to.unit.stage.key) : ""
    };
  }
  function compileLines(units, errors) {
    let vols = [...new Set(units.map((u) => u.volume))];
    if (!vols.some((v) => isPlainObject(v.line))) return [];
    let named = withLineIds(vols), lines2 = [], seen = /* @__PURE__ */ new Set(), pend = [];
    for (let [k, volume] of vols.entries()) {
      let own = units.filter((u) => u.volume === volume), raw = named[k].line, where = `卷「${volumeLabel(volume.key)}」的线`, id = String(raw.编号 || "").trim(), errs = [];
      if (!id) {
        errors.push(`${where}：缺少编号`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`${where}：编号「${id}」和别的线重复`);
        continue;
      }
      seen.add(id);
      let kind = String(raw.类型 || "").trim() === "主线" ? "main" : "side", open = parseCondition(raw.开启条件, errs), legacyFact = String(raw.开场事实 || "").trim(), modeText = String(raw.开启方式 || "").trim();
      modeText && !LINE_MODES[modeText] && errs.push(`开启方式「${modeText}」不认识，可以写：条件满足即开始、走进去才开始、人工`);
      let mode = LINE_MODES[modeText] === "manual" ? "manual" : kind === "main" ? "auto" : "enter", line = {
        id,
        kind,
        name: volumeLabel(volume.key),
        brief: clueText(raw.简介),
        entryHint: clueText(raw.入口提示),
        open,
        legacyFact,
        mode,
        volume,
        units: own,
        synthetic: !isPlainObject(volume.line),
        window: null,
        origCond: clueText(raw.原开启条件)
      };
      lines2.push(line), pend.push([line, raw.开启时段, errs, where]);
    }
    for (let [l, w, errs, where] of pend)
      l.window = resolveLineWindow(w, lines2, errs), errs.forEach((e) => errors.push(`${where}：${e}`));
    for (let l of lines2) for (let u of l.units) u.line = l;
    return lines2;
  }
  function lineToManual(volumes, id) {
    let at = (volumes || []).findIndex((v) => isPlainObject(v.line) && String(v.line.编号 || "").trim() === id);
    if (at < 0) return volumes;
    let line = { ...volumes[at].line }, cond = line.开启条件, text2 = cond == null || cond === "" ? "" : typeof cond == "string" ? cond : JSON.stringify(cond).replace(/"/g, "");
    if (LINE_MODES[String(line.开启方式 || "").trim()] === "manual" && !text2) return volumes;
    delete line.开启条件, line.开启方式 = "人工", text2 && (line.原开启条件 = line.原开启条件 ? `${line.原开启条件}；${text2}` : text2);
    let next = volumes.slice();
    return next[at] = { ...volumes[at], line }, next;
  }
  function lineTriggerFacts(compiled) {
    let produced = /* @__PURE__ */ new Set(), out = /* @__PURE__ */ new Map();
    for (let n of compiled.nodes || []) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && produced.add(d.fact);
    for (let l of compiled.lines || [])
      for (let f of [...conditionRefs(l.open).facts, ...l.legacyFact ? [l.legacyFact] : []])
        produced.has(f) || out.set(f, [...out.get(f) || [], l.id]);
    return out;
  }
  function sceneIsNone(value, binding) {
    let v = cellText(value);
    return !!v && (v === "无" || v === "离场" || !!binding && binding.离场值 != null && v === cellText(binding.离场值));
  }

  // src/core/lines.js
  var LINE_SKIP_AFTER = 3;
  function sideSlots(lineStates, limit = 1) {
    let used = (lineStates || []).filter((s) => s.line.kind === "side" && s.state === "进行中");
    return { used: used.map((s) => s.line.id), limit, full: used.length >= limit };
  }
  function lineAwayInfo(rows2, lineId, uidLine, placeOf2) {
    let away = 0;
    for (let x of rows2 || []) {
      if (!x) return null;
      let uid = x.scene || "";
      if (uid && uidLine.get(uid) === lineId) return away ? { rounds: away, place: placeOf2.get(uid) || "" } : null;
      away++;
    }
    return null;
  }
  function sideQueue(lineStates, clueProg) {
    let lines2 = clueProg && clueProg.lines || {}, list = (lineStates || []).filter(
      (s) => s.line.kind === "side" && s.line.mode !== "manual" && s.state === "可开启" && s.entries.length
    ), order = (s) => {
      let at = lines2[s.line.id] && lines2[s.line.id].skipAt;
      return at === void 0 ? -1 : at;
    };
    return list.map((s, k) => ({ s, k, at: order(s) })).sort((a, b) => a.at - b.at || a.k - b.k).map((x) => x.s);
  }
  function offerCount(offers, lineId, sinceFloor = -1) {
    return new Set((offers || []).filter((x) => x && x.line === lineId && x.i > sinceFloor).map((x) => x.i)).size;
  }
  function lineEntryPlan(state, clueProg, { limit = 1, offers = [], round = 0, firstOffer = /* @__PURE__ */ new Set(), known = null } = {}) {
    let lineStates = state.lineStates || [], byUid = new Map(state.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s.node])), item = (uid) => {
      let n = byUid.get(uid), it = n && isPlainObject(n.item) ? n.item : {};
      return { uid, entry: clueText(it.入口), place: clueText(it.地点) };
    }, paused = !!(clueProg && clueProg.paused), sidePaused = !!(clueProg && clueProg.sidePaused), slots = sideSlots(lineStates, limit), unsynced = /* @__PURE__ */ new Set(), ok = (uid) => !known || known.has(uid) || (unsynced.add(uid), !1), mainNow = paused ? null : lineStates.find((s) => s.line.kind === "main" && s.state === "进行中") || null, mainUids = mainNow ? state.nodeStates.filter((s) => s.node.uid && s.status === "available" && !s.disabled && s.node.unit.line === mainNow.line).map((s) => s.node.uid) : [], queue = sidePaused ? [] : sideQueue(lineStates, clueProg), catalog = paused ? [] : queue.flatMap((s) => s.entries.map((uid) => ({ ...item(uid), line: s.line.id }))), recognize = catalog.filter((r) => ok(r.uid)), due = "", head = slots.full ? null : queue[0] || null;
    if (head) {
      let lines2 = clueProg && clueProg.lines || {}, since = lines2[head.line.id] && lines2[head.line.id].skipFloor !== void 0 ? lines2[head.line.id].skipFloor : -1;
      offerCount(offers, head.line.id, since) >= LINE_SKIP_AFTER && queue.length > 1 && (due = head.line.id);
    }
    let pick = [], mainItems = mainUids.filter(ok).map(item), headItems = head ? head.entries.filter(ok).map(item) : [];
    paused || (mainItems.length && pick.push({ s: mainNow, items: mainItems, hint: "" }), headItems.length && pick.push({ s: head, items: headItems, hint: head.line.entryHint }));
    let fresh = pick.find((x) => x.s.line.kind === "main" && !firstOffer.has(x.s.line.id)), chosen = fresh || pick[pick.length ? round % pick.length : 0] || null, offer = chosen ? { line: chosen.s.line.id, kind: chosen.s.line.kind, hint: chosen.hint, items: chosen.items } : null;
    return {
      recognize,
      catalog,
      offer,
      due,
      waiting: slots.full && !sidePaused ? sideQueue(lineStates, clueProg).map((s) => s.line.id) : [],
      slots,
      unsynced: [...unsynced],
      known
    };
  }
  function mainSlotTaken(lineStates, id) {
    let other = (lineStates || []).find((s) => s.line.kind === "main" && s.line.id !== id && (s.state === "进行中" || s.state === "暂停"));
    return other ? `主线 ${other.line.id} ${other.state === "暂停" ? "暂停中，还占着主线的位置" : "还在进行"}` : "";
  }
  function catalogKnown(tables, scenePath) {
    let [table, row2] = String(scenePath || "").split("/").map((x) => x.trim()), found = table ? findSheet(tables || {}, table) : { error: "x" };
    if (found.error) return null;
    let { col, rows: rows2 } = sheetRows(found.sheet), ci = col(LINE_CATALOG_COL), hits = ci < 0 ? [] : findRow(rows2, row2);
    return hits.length !== 1 ? null : new Set(
      cellText(hits[0][ci]).split(/\n|。/).map((x) => x.split(/[:：]/)[0].trim()).filter(Boolean)
    );
  }
  var ACU_SETTINGS_NS = "shujuku_v120__userscript_settings_v1", ACU_GLOBAL_META = "shujuku_v120_globalMeta_v1";
  function acuIsolationKey(extensionSettings) {
    try {
      let ns = extensionSettings && extensionSettings.__userscripts && extensionSettings.__userscripts[ACU_SETTINGS_NS], raw = ns && ns[ACU_GLOBAL_META];
      if (raw == null) return null;
      let meta2 = typeof raw == "string" ? JSON.parse(raw) : raw;
      return isPlainObject(meta2) ? meta2.activeIsolationCode == null ? "" : typeof meta2.activeIsolationCode == "string" ? meta2.activeIsolationCode.trim() : null : null;
    } catch {
      return null;
    }
  }
  function enterEvidence({ allowed = [], cell = "", floor = -1, swipe = 0, evidenceOk = !1, denied = {} }) {
    let v = cellText(cell), hit = v && allowed.find((x) => x.uid === v);
    if (!hit || !evidenceOk || floor < 0) return null;
    let key = `${hit.line}@${floor}:${swipe}`;
    return (denied[hit.line] || []).includes(key) ? null : { line: hit.line, uid: hit.uid, key };
  }
  var FILL_SOURCES = ["group_fill", "auto_fill", "manual_fill"];
  function isolatedTag(msg, isoKey = null) {
    let raw = msg && msg.TavernDB_ACU_IsolatedData;
    if (typeof raw == "string")
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    if (!isPlainObject(raw)) return { sure: !0, tag: null };
    if (isoKey != null) return { sure: !0, tag: isPlainObject(raw[isoKey]) ? raw[isoKey] : null };
    let keys = Object.keys(raw).filter((k) => isPlainObject(raw[k]));
    return keys.length ? keys.length === 1 && keys[0] === "" ? { sure: !0, tag: raw[""] } : { sure: !1, tag: null } : { sure: !0, tag: null };
  }
  function frameEvents(msg, isoKey = null) {
    let { sure, tag } = isolatedTag(msg, isoKey);
    if (!sure) return null;
    let frame = tag && isPlainObject(tag.storageFrame) ? tag.storageFrame : null;
    return frame ? [
      ...isPlainObject(frame.checkpoint) && isPlainObject(frame.checkpoint.event) ? [{ ...frame.checkpoint.event, source: "checkpoint" }] : [],
      ...Array.isArray(frame.logEntries) ? frame.logEntries : []
    ].filter(isPlainObject).map((e) => ({
      source: String(e.source || ""),
      filled: Array.isArray(e.filledSheetKeys) ? e.filledSheetKeys : [],
      error: e.error ? String(e.error) : ""
    })) : [];
  }
  function fillEvidence(msg, sheetKey, isoKey = null) {
    if (!msg || msg.is_user) return { ok: !1, reason: "不是 AI 回复" };
    if (!sheetKey) return { ok: !1, reason: "不知道线索控制表在数据库里的编号" };
    let events = frameEvents(msg, isoKey);
    return events === null ? { ok: !1, reason: "读不到数据库现在用的隔离标识，这一楼又有好几份记录，认不准是哪一份" } : events.length ? events.filter((e) => (FILL_SOURCES.includes(e.source) || e.source === "checkpoint") && e.filled.includes(sheetKey) && !e.error).length ? { ok: !0, reason: "" } : { ok: !1, reason: "这一楼的填表没有处理线索控制表" } : { ok: !1, reason: "这一楼还没有填表记录" };
  }
  function appendTargetFloor(chat, isoKey = null) {
    let list = Array.isArray(chat) ? chat : [], last = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      let msg = list[i];
      if (!msg || msg.is_user) continue;
      last < 0 && (last = i);
      let { sure, tag } = isolatedTag(msg, isoKey);
      if (!sure) return -1;
      if (tag && (isPlainObject(tag.storageFrame) || isPlainObject(tag.independentData) && Object.keys(tag.independentData).some((k) => k.startsWith("sheet_"))))
        return i;
    }
    return last;
  }
  var LINE_CATALOG_COL = "场景目录";
  function sceneCatalogCell(state, plan, clueProg) {
    if (clueProg && clueProg.paused) return "（剧情暂停中，当前场景写「无」）";
    let lineOf = new Map((state.lineStates || []).map((s) => [s.line, s])), seen = /* @__PURE__ */ new Set(), rows2 = [], push = (uid, entry, place) => {
      !uid || seen.has(uid) || (seen.add(uid), rows2.push(`${uid}：${[entry || "（没写入口）", place && `地点：${place}`].filter(Boolean).join("；")}`));
    };
    for (let s of state.nodeStates) {
      if (!s.node.uid || s.disabled || !(s.status === "available" || s.status === "active")) continue;
      let it = isPlainObject(s.node.item) ? s.node.item : {};
      push(s.node.uid, clueText(it.入口), clueText(it.地点));
    }
    for (let r of plan.catalog || plan.recognize || []) push(r.uid, r.entry, r.place);
    return rows2.length ? rows2.join(`。
`) : "（暂时没有可以去做的剧情，当前场景写「无」）";
  }

  // src/core/clue-audit.js
  var AUDIT_MIN = 8, AUDIT_SAMPLE = 16, AUDIT_MAX_PER_SOURCE = 6;
  function normText(text2) {
    return String(text2 || "").replace(/\s+/g, "");
  }
  function fingerprints(text2) {
    let flat = normText(text2);
    if (flat.length < AUDIT_MIN) return [];
    if (flat.length <= AUDIT_SAMPLE + 4) return [flat];
    let parts = String(text2 || "").split(/[。！？!?；;\r\n]+/).map(normText).filter((s) => s.length >= AUDIT_MIN), out = [];
    for (let s of parts) {
      if (out.length >= AUDIT_MAX_PER_SOURCE) break;
      out.push(s.slice(0, AUDIT_SAMPLE));
    }
    return out.length ? out : [flat.slice(0, AUDIT_SAMPLE)];
  }
  function authorBlocks(text2) {
    return authorSegments(text2);
  }
  function fieldText(value) {
    return value == null ? "" : typeof value == "string" ? value : JSON.stringify(value);
  }
  function restrictedSources(project, state, isRevealed = () => !1) {
    let out = [], focusUid = state && state.focus ? state.focus.uid : "", add = (label, text2, scope) => {
      let prints = fingerprints(text2);
      prints.length && out.push({ label, prints, scope });
    };
    for (let block of authorBlocks(project.setting && project.setting.text)) add("设定·<仅作者>", block, "author");
    let keyBlocks = (obj, where) => {
      if (Array.isArray(obj)) return obj.forEach((x) => keyBlocks(x, where));
      if (isPlainObject(obj))
        for (let [k, v] of Object.entries(obj)) {
          for (let block of authorBlocks(k)) add(`${where}·字段名·<仅作者>`, block, "author");
          keyBlocks(v, where);
        }
    }, seenVol = /* @__PURE__ */ new Set();
    for (let unit of flattenUnits(project.outline && project.outline.volumes)) {
      let data = isPlainObject(unit.stage.data) ? unit.stage.data : {}, where = stageLabel(unit.stage.key);
      seenVol.has(unit.volume) || (seenVol.add(unit.volume), authorBlocks(unit.volume.key).forEach((b) => add("卷名·<仅作者>", b, "author")));
      for (let block of authorBlocks(unit.stage.key)) add(`${where}·阶段名·<仅作者>`, block, "author");
      keyBlocks(data, where), add(`${where}·作者备注`, data.作者备注, "author");
      for (let [key, value] of Object.entries(data))
        if (!NODE_FIELDS.some((f) => f.field === key))
          for (let block of authorBlocks(fieldText(value))) add(`${where}·${key}·<仅作者>`, block, "author");
      for (let node of stageNodes(data)) {
        let item = isPlainObject(node.item) ? node.item : {}, uid = nodeUid(item), place = `${where}·${node.name}`, isFocus = !!uid && uid === focusUid;
        add(`${place}·作者备注`, item.作者备注, "author");
        for (let key of Object.keys(item))
          for (let block of authorBlocks(fieldText(item[key]))) add(`${place}·${key}·<仅作者>`, block, "author");
        if (!isFocus) {
          add(`${place}·场景`, stripAuthorBlocks(item.场景), "unrevealed");
          for (let d of discoveryList(item)) d.fact && isRevealed(d.fact) || add(`${place}·发现`, d.text, "unrevealed");
        }
      }
    }
    return out;
  }
  function restrictedNames(project) {
    let out = [];
    for (let unit of flattenUnits(project.outline && project.outline.volumes))
      for (let node of stageNodes(unit.stage.data)) {
        let name = normText(node.name);
        name.length >= 4 && out.push({ label: `${stageLabel(unit.stage.key)}·${node.name}·名称`, print: name });
      }
    return out;
  }
  function countOccurrences(hay, needle) {
    if (!needle) return 0;
    let n = 0, at = 0;
    for (; (at = hay.indexOf(needle, at)) >= 0; ) n += 1, at += needle.length;
    return n;
  }
  function auditRequest(requestText, project, state, projection, { history = [], isRevealed } = {}) {
    let hay = normText(requestText), leaks = [], strip = (text2, piece) => piece && piece.length >= AUDIT_MIN ? text2.split(piece).join("") : text2, projFlat = normText(projection || ""), scan = strip(hay, projFlat), scanNoHistory = scan;
    for (let text2 of history) scanNoHistory = strip(scanNoHistory, normText(text2));
    for (let src of restrictedSources(project, state, isRevealed)) {
      let where = src.scope === "author" ? scan : scanNoHistory, hit = src.prints.find((p) => where.includes(p));
      hit && leaks.push({ source: src.label, sample: hit, level: "leak" });
    }
    for (let n of restrictedNames(project))
      scanNoHistory.includes(n.print) && leaks.push({ source: n.label, sample: n.print, level: "hint" });
    let projectionCount = projFlat ? countOccurrences(hay, projFlat) : 0;
    return { leaks, projectionCount, duplicated: projectionCount > 1, chars: hay.length };
  }
  function auditOutlineRequest(requestText, project, states, projection, { history = [] } = {}) {
    let hay = normText(requestText), leaks = [], strip = (text2, piece) => piece && piece.length >= AUDIT_MIN ? text2.split(piece).join("") : text2, pieces = (Array.isArray(projection) ? projection : [projection]).map(normText).filter((p) => p.length >= AUDIT_MIN).sort((a, b) => b.length - a.length), scan = hay;
    for (let p of pieces) {
      let at = scan.indexOf(p);
      at >= 0 && (scan = scan.slice(0, at) + `
` + scan.slice(at + p.length));
    }
    let scanNoHistory = scan;
    for (let text2 of history) scanNoHistory = strip(scanNoHistory, normText(text2));
    for (let src of restrictedSources(project, null).filter((s) => s.scope === "author")) {
      let hit = src.prints.find((p) => scan.includes(p));
      hit && leaks.push({ source: src.label, sample: hit, level: "leak" });
    }
    for (let unit of flattenUnits(project.outline && project.outline.volumes)) {
      let state = states && states[unit.id];
      if (state !== "next" && state !== "todo") continue;
      let where = stageLabel(unit.stage.key), view = outlineStageData(isPlainObject(unit.stage.data) ? unit.stage.data : {}), seen = /* @__PURE__ */ new Set(), add = (label, text2) => {
        for (let p of fingerprints(stripAuthorBlocks(fieldText(text2))))
          if (!seen.has(p) && scanNoHistory.includes(p))
            return seen.add(p), leaks.push({ source: `还没到的${where}·${label}`, sample: p, level: "leak" });
      };
      add("AI指令", view.AI指令);
      for (let node of stageNodes(view)) {
        let item = isPlainObject(node.item) ? node.item : { 名称: node.item }, keys = ["事件", "偏转", "触发", "内容"];
        for (let k of keys) item[k] && add(`${node.name || "节点"}·${k}`, item[k]);
        keys.some((k) => item[k]) || normText(stripAuthorBlocks(node.name)).length < 12 || add("节点", node.name);
      }
    }
    let projectionCount = pieces.length ? Math.min(...pieces.map((p) => countOccurrences(hay, p))) : 0;
    return { leaks, projectionCount, duplicated: projectionCount > 1, chars: hay.length };
  }
  function requestToText(payload) {
    return payload == null ? "" : typeof payload == "string" ? payload : Array.isArray(payload) ? payload.map(
      (m) => typeof m == "string" ? m : m && typeof m.content == "string" ? m.content : Array.isArray(m && m.content) ? m.content.map((p) => p && p.text || "").join(`
`) : ""
    ).join(`
`) : isPlainObject(payload) ? requestToText(payload.chat || payload.messages || payload.prompt || payload.finalPrompt || "") : "";
  }

  // src/app/clue-runtime.js
  var CLUE_LOG_MAX = 40, ROUND_TTL_MS = 18e4, CANDIDATE_KEEP = 40;
  function acuApi() {
    return hostWindow().AutoCardUpdaterAPI || window.AutoCardUpdaterAPI || null;
  }
  function createClueRuntime({ data, getProject, getProgress, setProgress, emit, log, ticket = () => null, ticketValid = () => !0 }) {
    let lastTableUpdate = 0, lastAudit = null, lastInjected = null, dirty = !0, cache = null, lastStatus = null, tableCallback = null, events = [], round = null;
    function note(text2) {
      events.push({ at: Date.now(), text: text2 }), events.length > CLUE_LOG_MAX && events.shift(), log(`[线索] ${text2}`);
    }
    function project() {
      let p = getProject();
      return isClueMode(p) ? p : null;
    }
    function clueOps() {
      let prog = getProgress();
      return normalizeClueOps(prog && prog.clue);
    }
    function ensureIds(p) {
      let fix = (vols) => withLineIds(withNodeIds(vols));
      return fix(p.outline.volumes) === p.outline.volumes ? p : (data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: fix(cur.outline.volumes) } })), note("已给缺少编号的节点、剧情线补上稳定编号"), data.project(p.id) || p);
    }
    function snapshot(p) {
      let api = acuApi();
      if (!api || typeof api.exportTableAsJson != "function")
        return {
          facts: /* @__PURE__ */ new Map(),
          knowledge: [],
          tables: {},
          problems: ["没有检测到数据库插件（shujuku），所有线索都按未知算。请确认数据库插件已安装并开启"],
          api: !1
        };
      let tables = cloneTables(api.exportTableAsJson()), f = readFacts(tables, p.clue.bindings.facts), k = readKnowledge(tables, p.clue.bindings.knowledge), problems2 = [...f.problems, ...k.problems], knowPresent = (p.clue.bindings.knowledge || []).length ? k.present : null;
      p.clue.bindings.facts.length || problems2.push("还没有绑定事实表");
      let sw = p.clue.bindings.switch, enabled = !0;
      if (sw && sw.路径) {
        let cell = readCell(tables, sw.路径);
        cell.state !== "ok" ? (problems2.push(`主线开关：${cell.reason}`), enabled = !1) : enabled = sameValue(cell.value, sw.开启值 ?? 1);
      }
      return { facts: f.facts, knowledge: k.rows, knowPresent, tables, problems: problems2, enabled, api: !0 };
    }
    function compute() {
      let p = project();
      if (!p) return null;
      if (!dirty && cache && cache.projectId === p.id && cache.outline === p.outline && cache.clue === p.clue) return cache;
      p = ensureIds(p);
      let compiled = compileClue(p.outline.volumes), snap2 = snapshot(p), prog = effectiveClueProgress(clueOps(), chatMessages()), scenePath = p.clue.bindings.scene && p.clue.bindings.scene.路径, sceneCell = scenePath ? readCell(snap2.tables || {}, scenePath) : null;
      prog.focusTaken = focusTakenOver(
        prog,
        (getProgress() || {}).stays,
        chatMessages(),
        sceneCell && sceneCell.state === "ok" ? cellText(sceneCell.value) : void 0
      );
      let state = computeClueState(compiled, snap2, prog, p.clue);
      snap2.api && (p.clue.bindings.facts || []).length && snap2.problems.push(...prebuiltGaps(compiled, snap2));
      let unoffered = snap2.api ? unofferedFacts(compiled, snap2, prog) : [], hints = snap2.api ? tableConsistencyHints(snap2) : [], status = Object.fromEntries(state.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s.status]));
      if (lastStatus && lastStatus.projectId === p.id)
        for (let change of diffClueStatus(lastStatus.map, status)) {
          let s = state.nodeStates.find((x) => x.node.uid === change.uid);
          note(`${s ? s.node.name : change.uid}：${NODE_STATUS_LABELS[change.from]} → ${NODE_STATUS_LABELS[change.to]}`);
        }
      let multi = compiled.lines.length > 0, known = multi && snap2.api && scenePath ? catalogKnown(snap2.tables, scenePath) : null, plan = multi ? lineEntryPlan(state, prog, {
        limit: p.clue.sideLimit || 1,
        offers: lineOffers(),
        round: aiFloors(),
        firstOffer: firstOffered(),
        known
      }) : null, notReady = multi && snap2.api && (p.clue.bindings.facts || []).length ? factsNotReady(p, snap2) : /* @__PURE__ */ new Set(), away = multi ? linesAway(compiled, state, sceneCell && sceneCell.state === "ok" ? cellText(sceneCell.value) : "") : {};
      return lastStatus = { projectId: p.id, map: status }, cache = {
        projectId: p.id,
        outline: p.outline,
        clue: p.clue,
        compiled,
        snap: snap2,
        prog,
        state,
        plan,
        notReady,
        hints,
        unoffered,
        away,
        at: Date.now()
      }, dirty = !1, cache;
    }
    function linesAway(compiled, state, sceneNowValue) {
      let uidLine = /* @__PURE__ */ new Map(), placeOf2 = /* @__PURE__ */ new Map(), out = {};
      for (let n of compiled.nodes)
        n.uid && n.unit.line && (uidLine.set(n.uid, n.unit.line.id), placeOf2.set(n.uid, clueText(isPlainObject(n.item) ? n.item.地点 : "")));
      let prog = getProgress(), rows2 = [{ scene: sceneNowValue || "" }, ...validStays(prog && prog.stays, chatMessages())];
      for (let s of state.lineStates || []) {
        if (s.state !== "进行中") continue;
        let a = lineAwayInfo(rows2, s.line.id, uidLine, placeOf2);
        a && (out[s.line.id] = a);
      }
      return out;
    }
    function factsNotReady(p, snap2) {
      let diff = prebuildDiff(prebuildPlan(p.outline.volumes), snap2, p.clue.bindings), knows = (p.clue.bindings.knowledge || []).length && snap2.knowPresent ? diff.newKnows : [];
      return /* @__PURE__ */ new Set([...diff.newFacts.map((f) => f.code), ...knows.map((k) => k.fact)]);
    }
    function isoKey() {
      let c = ctx(), bridge = hostWindow().__ACU_USERSCRIPT_BRIDGE__, a = acuIsolationKey(c && c.extensionSettings);
      return a !== null ? a : acuIsolationKey(bridge && bridge.extension_settings);
    }
    var LINE_FLOOR_KEEP = 400;
    function lineFloors() {
      let prog = getProgress(), chat = chatMessages();
      return (prog && Array.isArray(prog.lineFloors) ? prog.lineFloors : []).filter(
        (x) => chat[x.i] && !chat[x.i].is_user && (Number(chat[x.i].swipe_id) || 0) === x.swipe && String(chat[x.i].send_date ?? "") === x.stamp
      );
    }
    function lineOffers() {
      return lineFloors().filter((x) => x.offer).map((x) => ({ i: x.i, line: x.offer }));
    }
    function firstOffered() {
      return new Set(
        lineFloors().map((x) => x.offer).filter(Boolean)
      );
    }
    function aiFloors() {
      return chatMessages().filter((m) => m && !m.is_user).length;
    }
    function bindLineFloor(index, used) {
      let msg = chatMessages()[index], prog = getProgress();
      if (!msg || msg.is_user || !prog || !used) return;
      let list = (Array.isArray(prog.lineFloors) ? prog.lineFloors : []).filter(
        (x) => !(x.i === index && x.swipe === (Number(msg.swipe_id) || 0))
      );
      list.push({
        i: index,
        swipe: Number(msg.swipe_id) || 0,
        stamp: String(msg.send_date ?? ""),
        recognize: (used.recognize || []).map((r) => ({ uid: r.uid, line: r.line })),
        offer: used.offer || ""
      }), setProgress({ ...prog, lineFloors: list.sort((a, b) => a.i - b.i).slice(-LINE_FLOOR_KEEP) }, "line-floor");
    }
    var SYNC_DELAY_MS = 1500;
    let syncTimer = 0, syncing = !1, syncAgain = !1, lastToast = { key: "", at: 0 }, lineBar = null, catalogMissing = !1, labelsWarned = !1;
    function scheduleSync() {
      let w = hostWindow();
      w.clearTimeout(syncTimer), syncTimer = w.setTimeout(() => {
        syncLines().catch((e) => note(`多线同步出错：${e.message}`));
      }, SYNC_DELAY_MS);
    }
    function sceneSheetKey(p, tables) {
      let path = p.clue.bindings.scene && p.clue.bindings.scene.路径, name = path ? String(path).split("/")[0].trim() : "", f = name ? findSheet(tables || {}, name) : { error: "x" };
      return f.error ? "" : f.sheet.key;
    }
    async function syncLines() {
      if (syncing) return void (syncAgain = !0);
      let p = project();
      if (p) {
        syncing = !0;
        try {
          dirty = !0;
          let c = compute();
          if (!c || !c.snap.api) return;
          let t0 = ticket(), chat = chatMessages(), changed = !1, lastAi = -1;
          if (!c.plan) return void await writeCatalog(p, c, t0);
          for (let i = chat.length - 1; i >= 0; i--)
            if (chat[i] && !chat[i].is_user) {
              lastAi = i;
              break;
            }
          let rec = lastAi >= 0 ? lineFloors().find((x) => x.i === lastAi) : null, path = p.clue.bindings.scene && p.clue.bindings.scene.路径, cell = path ? readCell(c.snap.tables || {}, path) : null, value = cell && cell.state === "ok" ? cellText(cell.value) : "", iso = isoKey(), proof = lastAi >= 0 ? fillEvidence(chat[lastAi], sceneSheetKey(p, c.snap.tables), iso) : { ok: !1, reason: "" }, autoStart = c.state.lineStates.filter(
            (s) => s.line.mode === "auto" && s.state === "进行中" && !s.manual.started && s.why === "开启条件已满足"
          );
          if (autoStart.length && lastAi >= 0 && (addOps(
            autoStart.map((s) => ({
              kind: "line",
              target: s.line.id,
              value: "start",
              text: `auto@${lastAi}`,
              note: "开启条件满足，自动开始",
              atIndex: lastAi
            }))
          ), changed = !0), rec && value && rec.recognize.some((r) => r.uid === value)) {
            let denied = Object.fromEntries(Object.entries(c.prog.lines || {}).map(([k, v]) => [k, v.denied || []])), ev = enterEvidence({
              allowed: rec.recognize,
              cell: value,
              floor: lastAi,
              swipe: Number(chat[lastAi].swipe_id) || 0,
              evidenceOk: proof.ok,
              denied
            }), ls = ev && c.state.lineStates.find((s) => s.line.id === ev.line);
            if (proof.ok || note(`当前场景是入口 ${value}，但${proof.reason}，先不算进入（可以在执行页点「进入」）`), ev && ls && !ls.started && !ls.manual.state) {
              let slots = sideSlots(c.state.lineStates, p.clue.sideLimit || 1), busy = ls.line.kind === "main" ? mainSlotTaken(c.state.lineStates, ls.line.id) : "";
              if (busy) note(`没有开始 ${ev.line}：${busy}`);
              else if (ls.line.kind === "side" && c.prog.sidePaused) note(`支线已全部暂停：没有开始 ${ev.line}`);
              else if (ls.line.kind === "side" && slots.full) {
                let off = slots.used.length === 1 ? c.state.lineStates.find((x) => x.line.id === slots.used[0]) : null;
                lineToast(
                  `full:${ev.key}`,
                  "支线已满",
                  ls.line.name,
                  "切换",
                  () => switchSide(ev.line, ev.key, lastAi, "", ev.uid)
                );
              } else
                addOps([{ kind: "line", target: ev.line, value: "start", text: ev.key, note: "走进了入口", atIndex: lastAi }]), changed = !0, note(`线 ${ev.line} 开始：第 ${lastAi} 楼走进了入口 ${ev.uid}`), lineToast(
                  `start:${ev.key}`,
                  ls.line.kind === "side" ? "支线开始" : "主线开始",
                  ls.line.name,
                  "取消",
                  () => denyStart(ev.line, ev.key)
                );
            }
          }
          let dueEntry = c.plan.due && rec && rec.recognize.some((r) => r.line === c.plan.due && r.uid === value);
          if (!changed && c.plan.due && lastAi >= 0 && proof.ok && !dueEntry && (addOps([
            {
              kind: "line",
              target: c.plan.due,
              value: "skip",
              note: "提示了 3 次没有进入，先让后面的上来",
              atIndex: lastAi
            }
          ]), changed = !0, note(`支线 ${c.plan.due} 提示了 3 次没有进入，排到后面`)), !ticketValid(t0))
            return;
          changed && (dirty = !0);
          let now = compute();
          now && (await writeCatalog(p, now, t0), await fillRows(p, now, t0));
        } finally {
          syncing = !1, syncAgain && (syncAgain = !1, scheduleSync());
        }
      }
    }
    function addOps(list) {
      let prog = getProgress();
      if (!prog) return;
      let ops = clueOps(), chat = chatMessages();
      for (let op of list) ops = addClueOp(ops, chat, op);
      setProgress({ ...prog, clue: ops }, "clue-op"), invalidate(), list.forEach((op) => note(`操作：${opLabel(op)}`));
    }
    function denyStart(id, key) {
      addOps([{ kind: "line", target: id, value: "deny", text: key, note: "玩家点了取消开启" }]), scheduleSync();
    }
    function switchSide(id, key, floor, pauseId = "", uid = "") {
      let c = (dirty = !0, compute()), p = project();
      if (!c || !p) return;
      let s = c.state.lineStates.find((x) => x.line.id === id), used = sideSlots(c.state.lineStates, p.clue.sideLimit || 1).used;
      if (!s || s.started || s.manual.state && s.manual.state !== "pause" || !s.eligible)
        return toast("info", "这条支线的状态已经变了，没有切换。");
      if (c.prog.sidePaused) return toast("info", "支线已全部暂停，没有切换。先点「继续全部支线」。");
      let off = pauseId || (used.length === 1 ? used[0] : "");
      if (used.length >= (p.clue.sideLimit || 1) && !used.includes(off))
        return toast("info", `现在有 ${used.length} 条支线在进行，请到执行页「剧情线」里先暂停其中一条，再点这条的「进入」。`);
      let ops = [];
      used.includes(off) && used.length >= (p.clue.sideLimit || 1) && ops.push({ kind: "line", target: off, value: "pause", note: `切换到 ${id}` }), s.manual.state === "pause" && ops.push({ kind: "line", target: id, value: "resume" }), ops.push({
        kind: "line",
        target: id,
        value: "start",
        text: key || "manual",
        note: ops.length ? `从 ${off} 切换过来` : "人工进入",
        ...Number.isInteger(floor) ? { atIndex: floor } : {}
      }), (!key || key === "manual") && uid && ops.push({ kind: "focus", target: uid, value: !0, sceneAt: sceneNow() });
      let offName = ops.length > 1 && (c.state.lineStates.find((x) => x.line.id === off) || { line: { name: off } }).line.name;
      addOps(ops), scheduleSync(), offName && toast("success", `已换成「${s.line.name}」，「${offName}」先暂停。`);
    }
    function enterLine(id, pauseId = "", uid = "") {
      let c = (dirty = !0, compute()), p = project();
      if (!c || !p) return;
      let s = c.state.lineStates.find((x) => x.line.id === id);
      if (!s || s.started) return;
      if (!s.eligible) throw new Error("这条线的开启条件还没满足；想早点开，可以修改它的开启条件");
      let busy = s.line.kind === "main" ? mainSlotTaken(c.state.lineStates, id) : "";
      if (busy) throw new Error(`主线位置被占着：${busy}`);
      if (s.line.kind === "side" && c.prog.sidePaused) throw new Error("支线已全部暂停，先点「继续全部支线」");
      let entry = uid && s.entries.includes(uid) ? uid : s.entries.length === 1 ? s.entries[0] : "";
      if (s.line.kind === "side" && sideSlots(c.state.lineStates, p.clue.sideLimit || 1).full)
        return switchSide(id, "manual", void 0, pauseId, entry);
      addOps([
        { kind: "line", target: id, value: "start", text: "manual", note: "人工进入" },
        ...entry ? [{ kind: "focus", target: entry, value: !0, sceneAt: sceneNow() }] : []
      ]), scheduleSync();
    }
    function lineToast(key, tag, text2, action, run) {
      let p = project();
      if (!p || p.clue.lineToast === !1 || lastToast.key === key) return;
      let t0 = ticket(), guarded = () => ticketValid(t0) && project() ? run() : toast("info", "已经切换了聊天或项目，这条提示作废了。");
      lastToast = { key, at: Date.now() }, lineBar && lineBar({ key, tag, text: text2, action, run: guarded });
    }
    async function writeCatalog(p, c, t0) {
      let api = acuApi(), col = LINE_CATALOG_COL, path = p.clue.bindings.scene && p.clue.bindings.scene.路径;
      if (!api || typeof api.updateCell != "function" || !path) return;
      let [table, row2] = String(path).split("/").map((x) => x.trim()), want = sceneCatalogCell(c.state, c.plan || { recognize: [] }, c.prog), found = findSheet(c.snap.tables || {}, table);
      if (found.error) return;
      let { col: colOf, rows: rows2 } = sheetRows(found.sheet), ci = colOf(col), hits = findRow(rows2, row2);
      if (ci < 0) return catalogMissing || (catalogMissing = !0, note(`线索控制表还没有「${col}」这一列：点一次「生成线索模板」补上`));
      if (hits.length !== 1 || cellText(hits[0][ci]) === want || !ticketValid(t0)) return;
      let index = found.sheet.content.indexOf(hits[0]);
      if (index < 1) return;
      let ok = await Promise.resolve(
        api.updateCell({ tableName: table, rowIndex: index, colIdentifier: col, value: want, skipNotify: !0 })
      ).catch(() => !1), back = readCell(cloneTables(api.exportTableAsJson()), `${table}/${row2}/${col}`);
      ok && back.state === "ok" && cellText(back.value) === want ? note("场景目录已更新") : note("场景目录没写上，下次再试；没写进去的入口先不提示"), invalidate("clue-catalog");
    }
    async function fillRows(p, c, t0) {
      let api = acuApi(), fb = (p.clue.bindings.facts || [])[0], kb = (p.clue.bindings.knowledge || [])[0];
      if (!api || typeof api.insertRow != "function" || !fb) return;
      let labels = isPlainObject(p.clue.labels) ? p.clue.labels : {}, plan = prebuildPlan(p.outline.volumes), started = new Map(c.state.lineStates.filter((s) => s.started).map((s) => [s.line.id, s])), target = appendTargetFloor(chatMessages(), isoKey()), factLines = /* @__PURE__ */ new Map(), triggers = new Set(plan.facts.filter((f) => f.trigger).map((f) => f.code));
      for (let n of c.compiled.nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
          d.fact && factLines.set(d.fact, (factLines.get(d.fact) || /* @__PURE__ */ new Set()).add(n.unit.line ? n.unit.line.id : ""));
      let lineReady = (lid) => {
        if (!lid) return !0;
        let s = started.get(lid);
        return !!s && (s.manual.startAt === void 0 || s.manual.startAt < 0 || target >= s.manual.startAt);
      }, wantFact = (code) => triggers.has(code) || !factLines.has(code) || [...factLines.get(code)].some(lineReady), diff = prebuildDiff(
        { ...plan, facts: plan.facts.filter((f) => wantFact(f.code)), knows: plan.knows.filter((k) => wantFact(k.fact)) },
        c.snap,
        p.clue.bindings
      ), labelOf = (code) => labels[code] || {}, ready = diff.newFacts.filter((f) => labelOf(f.code).label), waiting = diff.newFacts.length - ready.length;
      if (waiting && !labelsWarned && (labelsWarned = !0, note(`有 ${waiting} 条事实还没有标签，先不补行（采用大纲时会自动生成；也可以用「按大纲补表格行」）`)), !ready.length && !diff.newKnows.length)
        return;
      let factOk = new Set(c.snap.facts ? c.snap.facts.keys() : []), done = [];
      for (let f of ready) {
        if (!ticketValid(t0)) return;
        let l = labelOf(f.code), row2 = { [fb.编号列]: f.code, 标签: l.label, 登记口径: l.criterion || "" };
        fb.状态列 && (row2[fb.状态列] = "未获得"), await Promise.resolve(api.insertRow({ tableName: fb.表, data: row2, skipNotify: !0 })).catch(() => -1) >= 0 && (factOk.add(f.code), done.push(f.code));
      }
      if (kb)
        for (let k of diff.newKnows) {
          if (!factOk.has(k.fact) || !ticketValid(t0)) continue;
          let row2 = { 键: k.key, [kb.事实列]: k.fact, [kb.角色列]: k.actor };
          kb.方式列 && (row2[kb.方式列] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || "未知"), kb.可信度列 && (row2[kb.可信度列] = "未核实"), await Promise.resolve(api.insertRow({ tableName: kb.表, data: row2, skipNotify: !0 })).catch(() => -1) >= 0 && done.push(k.key);
        }
      done.length && (note(`自动补了 ${done.length} 行：${done.slice(0, 6).join("、")}${done.length > 6 ? "……" : ""}`), invalidate("clue-rows"));
    }
    function lineAct(id, value, uid = "", s0 = null) {
      if (s0 && !scopeValid(s0)) throw new Error("已经切换了聊天、项目或推进方式，这次操作没有执行，请重新点一次");
      if (value === "enter") return enterLine(id, "", uid);
      if (value === "deny") {
        let c = compute(), s = c && c.state.lineStates.find((x) => x.line.id === id);
        return s && s.manual.evidence ? denyStart(id, s.manual.evidence) : act({ kind: "line", target: id, value: "" });
      }
      if (value === "resume") {
        let c = (dirty = !0, compute()), p = project(), s = c && c.state.lineStates.find((x) => x.line.id === id);
        if (s && s.line.kind === "side" && s.started && sideSlots(c.state.lineStates, p.clue.sideLimit || 1).full)
          throw new Error("同时进行的支线已经满了：先暂停正在进行的那条，再继续这条");
      }
      act({ kind: "line", target: id, value: value || "" }), scheduleSync();
    }
    function toManual(id) {
      let p = project();
      return p ? lineToManual(p.outline.volumes, id) === p.outline.volumes ? !1 : (data.updateProject(p.id, (cur) => ({
        ...cur,
        outline: { ...cur.outline, volumes: lineToManual(cur.outline.volumes, id) }
      })), invalidate("line-manual"), !0) : !1;
    }
    function confirmTiers(tiers) {
      let p = project();
      return p ? confirmTierOrder(p.outline.volumes, tiers) === p.outline.volumes ? !1 : (data.updateProject(p.id, (cur) => ({
        ...cur,
        outline: { ...cur.outline, volumes: confirmTierOrder(cur.outline.volumes, tiers) }
      })), invalidate("line-tiers"), !0) : !1;
    }
    function moveLine(id, dir) {
      let p = project();
      if (!p) return;
      let vols = p.outline.volumes, idOf2 = (v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "", sideOf = (v) => isPlainObject(v.line) && String(v.line.类型 || "").trim() !== "主线", at = vols.findIndex((v) => idOf2(v) === id);
      if (at < 0 || !sideOf(vols[at])) return;
      let to = at + dir;
      for (; to >= 0 && to < vols.length && !sideOf(vols[to]); ) to += dir;
      if (to < 0 || to >= vols.length) return;
      let next = vols.slice();
      [next[at], next[to]] = [next[to], next[at]], data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: next } })), invalidate("line-order");
    }
    function unofferedFacts(compiled, snap2, prog) {
      let pr = getProgress(), offered = /* @__PURE__ */ new Set();
      for (let x of pr && Array.isArray(pr.clueCandidates) ? pr.clueCandidates : [])
        for (let c of x.candidates || []) offered.add(c.fact);
      for (let id of pr && Array.isArray(pr.clueOffered) ? pr.clueOffered : []) offered.add(id);
      for (let c of pendingCandidates && pendingCandidates.candidates || []) offered.add(c.fact);
      let tracked = /* @__PURE__ */ new Set();
      for (let n of compiled.nodes) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && tracked.add(d.fact);
      let out = [], overs = prog.factOverrides || {};
      for (let [id, over] of Object.entries(overs)) {
        if (!tracked.has(id) || !over || over.status !== "revoked") continue;
        let f = snap2.facts && snap2.facts.get(id);
        out.push({ id, raw: f ? f.raw : "", text: over.text || f && f.text || "", revoked: !0 });
      }
      for (let [id, f] of snap2.facts || [])
        !tracked.has(id) || offered.has(id) || overs[id] || (f.status === "confirmed" || f.claimed) && out.push({ id, raw: f.raw, text: f.text || "", revoked: !1 });
      return out;
    }
    function opScope() {
      return { ticket: ticket(), iso: isoKey() };
    }
    function scopeValid(s0) {
      return !!s0 && ticketValid(s0.ticket) && isoKey() === s0.iso;
    }
    async function voidFact(id, s0 = opScope()) {
      let p = project(), c = compute();
      if (!p || !c || !scopeValid(s0))
        return { done: !1, table: "none", why: "已经切换了聊天、项目、推进方式或数据隔离，这次作废没有执行，请重新点一次" };
      let f = c.snap.facts && c.snap.facts.get(id);
      act({ kind: "fact", target: id, value: "revoked", text: f ? f.text : "", note: "玩家作废：正文可能自己编的" });
      let r = await voidTables(p, id, s0.ticket, s0.iso).catch((e) => ({ table: "none", why: e && e.message || String(e) }));
      return invalidate("clue-void"), note(r.table === "ok" ? `作废 ${id}：表格已改回未获得` : `作废 ${id}：${r.why || "表格没改"}`), { done: !0, ...r };
    }
    var SQL_WORD = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*$/;
    async function voidTables(p, id, t0, iso0) {
      let api = acuApi(), fb = (p.clue.bindings.facts || [])[0], kb = (p.clue.bindings.knowledge || [])[0];
      if (!api || !fb || !fb.状态列) return { table: "none", why: "没有绑定事实表的状态列，表格没改" };
      if (typeof api.executeSqlMutation != "function" || typeof api.querySql != "function")
        return {
          table: "none",
          why: "数据库不是 SQLite 存储模式（或还没就绪），插件没法安全改表；需要的话请到数据库里把这条改回「未获得」"
        };
      let unknown = Array.isArray(kb && kb.未知值) ? kb.未知值[0] : kb && kb.未知值 || "未知", jobs = [
        {
          what: "事实表",
          sql: [fb.表, fb.状态列, fb.编号列],
          text: `UPDATE ${fb.表} SET ${fb.状态列} = ? WHERE ${fb.编号列} = ?`,
          params: ["未获得", id]
        }
      ];
      kb && kb.方式列 && kb.事实列 && jobs.push({
        what: "知情表",
        sql: [kb.表, kb.方式列, kb.事实列, ...kb.可信度列 ? [kb.可信度列] : []],
        text: `UPDATE ${kb.表} SET ${kb.方式列} = ?${kb.可信度列 ? `, ${kb.可信度列} = ?` : ""} WHERE ${kb.事实列} = ?`,
        params: [unknown, ...kb.可信度列 ? ["未核实"] : [], id]
      });
      let bad = jobs.flatMap((j) => j.sql).find((name) => !SQL_WORD.test(String(name || "")));
      if (bad !== void 0) return { table: "none", why: `表名或列名「${bad}」带特殊字符，插件没法安全改表` };
      let failed = [], tried = 0;
      for (let j of jobs) {
        if (!ticketValid(t0) || isoKey() !== iso0)
          return {
            table: tried ? "partial" : "none",
            why: tried ? "改表途中切换了聊天、项目或数据隔离，没有全部完成" : "切换了聊天、项目或数据隔离，表格没改"
          };
        tried++;
        let res = await Promise.resolve(api.executeSqlMutation(j.text, j.params)).catch((e) => ({
          errors: [e && e.message || String(e)]
        }));
        res && Array.isArray(res.errors) && res.errors.length && failed.push(`${j.what}：${res.errors[0]}`);
      }
      if (!ticketValid(t0) || isoKey() !== iso0) return { table: "partial", why: "改表途中切换了聊天、项目或数据隔离，没法确认表格结果" };
      let tables = cloneTables(api.exportTableAsJson()), fr = readFacts(tables, [fb]), kr = kb && kb.方式列 ? readKnowledge(tables, [kb]) : null, fact = fr.facts.get(id), knows = kr ? kr.rows.filter((row2) => row2.fact === id) : [], factOk = !fr.problems.length && (!fact || fact.status === "unconfirmed" && !fact.claimed), knowOk = !kr || !kr.problems.length && !knows.length;
      if (factOk && knowOk && !failed.length) return { table: "ok", why: "" };
      let why = [
        failed.join("；"),
        fr.problems.length ? `事实表读不到：${fr.problems[0]}` : !factOk && "事实表这条还不是「未获得」",
        kr && kr.problems.length ? `知情表读不到：${kr.problems[0]}` : !knowOk && `知情表还有 ${knows.map((k) => k.actor).join("、")} 记着知道`
      ].filter(Boolean).join("；");
      return { table: factOk && knowOk || factOk || knowOk ? "partial" : "none", why: why || "没法确认表格结果" };
    }
    function restoreFact(id) {
      act({ kind: "fact", target: id, value: "", note: "玩家解除作废：按表格判断" });
      let c = compute();
      return c ? effectiveFact(id, c.snap, c.prog) : null;
    }
    function invalidate(reason = "") {
      dirty = !0, reason && emit(reason);
    }
    function beginRound(source) {
      return round = { ticket: ticket(), at: Date.now(), source }, round;
    }
    function ensureRound(source) {
      return round && Date.now() - round.at <= ROUND_TTL_MS ? !1 : (beginRound(source), !0);
    }
    function roundState() {
      return round ? Date.now() - round.at > ROUND_TTL_MS ? (round = null, { ok: !0 }) : ticketValid(round.ticket) ? { ok: !0 } : { ok: !1, reason: "本轮开始后切换了聊天、项目或推进方式" } : { ok: !0 };
    }
    function endRound() {
      round = null;
    }
    function projection() {
      let c = compute();
      if (!c) return { content: "", reason: "不是线索模式" };
      if (!c.snap.api) return { content: "", reason: c.snap.problems[0] };
      if (c.prog.paused) return { content: "", reason: "主线已暂停（日常游玩）" };
      if (!c.snap.enabled) return { content: "", reason: "主线开关未开启" };
      let r = roundState();
      if (!r.ok) return { content: "", reason: r.reason };
      let prog = getProgress(), info = stayInfo(c), out = buildClueProjection(c.state, c.snap, c.prog, data.settings(), {
        pace: prog && prog.pace,
        stay: stayText(stayState(prog && prog.stays, chatMessages(), info), "clue"),
        plan: c.plan,
        notReady: c.notReady
      });
      return {
        ...out,
        reason: out.content ? "" : "当前没有可演的线索场景",
        lineOnly: !out.content && !!(out.used && out.used.recognize && out.used.recognize.length)
      };
    }
    function stayInfo(cc) {
      let c = cc || compute();
      if (!c) return null;
      let paused = !!c.prog.paused || c.snap.enabled === !1, p = project(), path = p && p.clue.bindings.scene && p.clue.bindings.scene.路径, cell = path ? readCell(c.snap.tables || {}, path) : null;
      return {
        key: paused ? "" : c.state.focus.uid || "",
        score: focusScore(c.state, c.snap, c.prog),
        paused,
        scene: cell && cell.state === "ok" ? cellText(cell.value) : ""
      };
    }
    function record(via, out) {
      lastInjected = {
        at: Date.now(),
        via,
        chars: (out.content || "").length,
        focus: out.used && out.used.focus || "",
        facts: out.used ? out.used.facts.slice() : [],
        leads: out.used ? out.used.leads.slice() : [],
        reason: out.reason || "",
        content: out.content || ""
      };
      let lineOnly = !out.content && out.lineOnly;
      pendingCandidates = out.used && (out.content || lineOnly) && ((out.used.candidates || []).length || (out.used.scenes || []).length || out.used.recognize && out.used.recognize.length) ? makePending(lineOnly ? { ...out.used, candidates: [], scenes: [] } : out.used) : null;
    }
    function discardPendingCandidates() {
      pendingCandidates && note("生成已中止，这一次给正文的线索记录作废"), pendingCandidates = null;
    }
    let pendingCandidates = null;
    function makePending(used) {
      return {
        at: Date.now(),
        focus: used.focus,
        candidates: (used.candidates || []).map((c) => ({ fact: c.fact, record: c.record || "" })),
        scenes: (used.scenes || []).map((s) => ({ uid: s.uid, entry: s.entry || "", place: s.place || "", focus: !!s.focus })),
        lines: used.recognize ? { recognize: used.recognize, offer: used.offer || "" } : null,
        ticket: round ? round.ticket : ticket()
      };
    }
    function bindCandidatesToMessage(index) {
      let pc = pendingCandidates;
      if (pendingCandidates = null, !pc || Date.now() - pc.at > ROUND_TTL_MS || !ticketValid(pc.ticket)) return;
      pc.lines && bindLineFloor(index, pc.lines);
      let msg = chatMessages()[index];
      if (!msg || msg.is_user) return;
      let prog = getProgress();
      if (!prog) return;
      let list = (Array.isArray(prog.clueCandidates) ? prog.clueCandidates : []).filter(
        (x) => !(x.i === index && x.swipe === (Number(msg.swipe_id) || 0))
      ), offered = new Set(Array.isArray(prog.clueOffered) ? prog.clueOffered : []);
      for (let c of pc.candidates || []) offered.add(c.fact);
      list.push({
        i: index,
        swipe: Number(msg.swipe_id) || 0,
        stamp: String(msg.send_date ?? ""),
        focus: pc.focus,
        candidates: pc.candidates,
        scenes: pc.scenes
      }), setProgress({ ...prog, clueCandidates: list.slice(-CANDIDATE_KEEP), clueOffered: [...offered] }, "clue-candidates");
    }
    function auditFinalRequest(payload) {
      let c = compute();
      if (!c) return null;
      let p = project(), text2 = requestToText(payload);
      if (!text2) return null;
      let fresh = lastInjected && Date.now() - lastInjected.at < ROUND_TTL_MS, out = fresh ? lastInjected.content : "", history = chatMessages().filter((m) => m && !m.is_user && !m.is_system).map((m) => String(m.mes || "")), isRevealed = (id) => effectiveFact(id, c.snap, c.prog).confirmed, injectedFocus = fresh && out && lastInjected.focus || "", auditState = { ...c.state, focus: { ...c.state.focus, uid: injectedFocus } }, result = auditRequest(text2, p, auditState, out, { history, isRevealed }), leaks = result.leaks.filter((l) => l.level === "leak");
      return lastAudit = { ...result, at: Date.now(), via: lastInjected ? lastInjected.via : "" }, leaks.length && (note(
        `最终请求核验：发现 ${leaks.length} 处不该出现的剧情（${leaks.slice(0, 3).map((l) => l.source).join("、")}${leaks.length > 3 ? "……" : ""}）`
      ), toast("warning", `本轮请求里混进了还不该出现的剧情（${leaks[0].source}），不是剧情注入器带进去的，请到诊断页查看。`)), result.duplicated && (note(`最终请求核验：本轮线索内容出现了 ${result.projectionCount} 次（重复注入）`), toast("warning", "本轮线索内容在正文请求里出现了不止一次，请检查是否同时启用了别的注入路径。")), emit("clue-audit"), result;
    }
    function register() {
      let api = acuApi();
      api && typeof api.registerTableUpdateCallback == "function" && !tableCallback && (tableCallback = () => {
        lastTableUpdate = Date.now(), invalidate("clue-table"), project() && scheduleSync();
      }, api.registerTableUpdateCallback(tableCallback), project() && scheduleSync());
    }
    function unregisterAll() {
      let api = acuApi();
      try {
        tableCallback && api && api.unregisterTableUpdateCallback && api.unregisterTableUpdateCallback(tableCallback);
      } catch {
      }
      tableCallback = null;
    }
    function act(op) {
      let p = project(), prog = getProgress();
      if (!p || !prog) throw new Error("当前项目不是线索模式");
      let ops = addClueOp(clueOps(), chatMessages(), op);
      setProgress({ ...prog, clue: ops }, "clue-op"), invalidate(), note(`人工操作：${opLabel(op)}`);
    }
    function opLabel(op) {
      if (op.kind === "pause")
        return op.target === "side" ? op.value ? "暂停全部支线" : "继续全部支线" : op.value ? "暂停剧情" : "继续剧情";
      if (op.kind === "line")
        return `${{ start: "开启", pause: "暂停", resume: "继续", done: "标记完成", abandon: "放弃", deny: "取消开启", skip: "跳过", "": "还原手动操作" }[String(op.value || "")] || op.value}线 ${op.target}${op.note ? `（${op.note}）` : ""}`;
      let names2 = {
        open: { force: "手动开放", block: "暂时停用", "": "开放改回按条件判断" },
        done: { force: "手动完成", undo: "算作没完成", "": "完成改回按表格判断" },
        skip: { true: "跳过", "": "取消跳过" },
        focus: { true: "设为本轮场景", "": "取消我选的场景" },
        fact: { confirmed: "确认线索", revoked: "作废线索", "": "线索改回按表格判断" }
      }, label = names2[op.kind] && names2[op.kind][String(op.value ?? "")] || op.kind;
      return op.kind === "focus" && op.value && op.target.startsWith(AWAY_PREFIX) ? `主角离开 ${op.target.slice(AWAY_PREFIX.length)}` : `${label} ${op.target}${op.note ? `（${op.note}）` : ""}`;
    }
    function sceneNow() {
      let p = project(), path = p && p.clue.bindings.scene && p.clue.bindings.scene.路径, c = compute();
      if (!path || !c) return "";
      let cell = readCell(c.snap.tables || {}, path);
      return cell.state === "ok" ? cellText(cell.value) : "";
    }
    function leaveScene(uid) {
      uid && act({ kind: "focus", target: `${AWAY_PREFIX}${uid}`, value: !0, sceneAt: sceneNow() });
    }
    function setPaused(paused, target = "main") {
      act({ kind: "pause", target: target === "side" ? "side" : "main", value: paused ? !0 : "" }), scheduleSync();
    }
    function setFocus(uid) {
      let c = compute(), s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
      if (uid && (!s || s.status === "locked" || s.status === "done" || s.disabled))
        throw new Error("这个节点当前不可进行；需要先满足开放条件，或用「人工开放」");
      act(
        uid ? { kind: "focus", target: uid, value: !0, sceneAt: sceneNow() } : { kind: "focus", target: c && c.prog.focus || "", value: "" }
      );
    }
    function plotConflicts() {
      let api = acuApi();
      try {
        let name = api && typeof api.getCurrentPlotPreset == "function" ? api.getCurrentPlotPreset() : "";
        return !name || typeof api.getPlotPresetDetails != "function" ? { preset: name || "", items: [] } : { preset: name, items: plotPresetConflicts(api.getPlotPresetDetails(name)) };
      } catch {
        return { preset: "", items: [] };
      }
    }
    function diagnose() {
      let c = compute(), api = acuApi();
      return {
        mode: project() ? "clue" : "outline",
        api: !!api,
        lastTableUpdate,
        tableAgeMs: lastTableUpdate ? Date.now() - lastTableUpdate : null,
        lastInjected,
        lastAudit,
        problems: c ? [...c.snap.problems, ...c.state.problems.filter((x) => !c.snap.problems.includes(x)), ...c.compiled.errors] : [],
        enabled: c ? c.snap.enabled : null,
        paused: c ? !!c.prog.paused : null,
        plot: plotConflicts(),
        focus: c ? c.state.focus : null,
        events: events.slice()
      };
    }
    return {
      compute,
      invalidate,
      projection,
      act,
      opScope,
      voidFact,
      restoreFact,
      setFocus,
      setPaused,
      lineAct,
      opLabel,
      lineToManual: toManual,
      confirmTiers,
      moveLine,
      syncLines,
      scheduleSync,
      setLineBar: (fn) => {
        lineBar = fn;
      },
      hideLineBar: () => {
        lastToast = { key: "", at: 0 }, lineBar && lineBar(null);
      },
      stayInfo: () => stayInfo(),
      register,
      stop: unregisterAll,
      diagnose,
      auditFinalRequest,
      record,
      ensureRound,
      endRound,
      bindCandidatesToMessage,
      discardPendingCandidates,
      leaveScene,
      lastInjected: () => lastInjected,
      onChatChanged() {
        hostWindow().clearTimeout(syncTimer), catalogMissing = !1, labelsWarned = !1, lastToast = { key: "", at: 0 }, lineBar && lineBar(null), lastStatus = null, lastTableUpdate = 0, pendingCandidates = null, round = null, invalidate();
      }
    };
  }

  // src/core/check.js
  function cleanFloorText(text2, limit = 3e3) {
    let out = String(text2 || "");
    return out = out.replace(/<(think|thinking|reasoning|status|statusbar|状态栏|details)\b[^>]*>[\s\S]*?<\/\1>/gi, ""), out = out.replace(/```[\s\S]*?```/g, ""), out = out.replace(/<\s*剧情推进\s*\/?\s*>/g, ""), out = out.replace(/<[^>\n]{1,80}>/g, ""), out = out.replace(/\n{3,}/g, `

`).trim(), out.length > limit ? out.slice(-limit) : out;
  }
  function threadRules(threads) {
    if (!threads) return null;
    let clocks = Array.isArray(threads.clocks) ? threads.clocks : [], keys = [], rules = [];
    if (clocks.length && (keys.push('"clocks":[{"name":"进度钟名称","tick":推进格数,"happened":true或false}]'), rules.push(
      `clocks 对照剧情索引里的【世界进度钟】（${clocks.map((clock) => `${clock.name} ${clock.filled}/${clock.total}`).join("、")}）：正文里有推动这件事的进展就填正数，每次最多 2 格；玩家出手阻止、使局势缓和就填负数；没有变化就省略。只有正文已经写出这件事发生时，happened 才填 true。`
    )), threads.hooks && (keys.push('"hooks":["支线名"]'), rules.push(
      "hooks 填【支线钩子】里标为「待触发」、出现条件已在正文中满足的支线名。支线已经在正文里演出时，把支线名填进 done；支线链只在当前这一步演出时填。"
    )), threads.newThread) {
      keys.push('"newThread":{"name":"线名","summary":"一句话概括"}'), rules.push(
        "玩家在正文里主动开了一条大纲和剧情索引里都没有的线（例如接下新的委托、追查新的线索、发展新的关系）时填 newThread，没有就填 null。"
      );
      let ignored = Array.isArray(threads.ignored) ? threads.ignored.slice(-10) : [];
      ignored.length && rules.push(`以下线已被忽略，不要再填进 newThread：${ignored.join("、")}。`);
    }
    return clocks.length && threads.readTo > 0 && rules.push("标有「已读」的楼层上次检测已经读过，clocks 只按之后的新楼层推进；没有新楼层时省略 clocks 的推进。"), keys.length ? { keys, rules, hooks: !!threads.hooks, readTo: clocks.length && Number(threads.readTo) || 0 } : null;
  }
  var PERSONA_KEY = '"personas":[{"line":"线名","to":"下一阶段名","floor":依据所在楼号,"reason":"一句话依据"}]', PERSONA_RULE = "personas 对照【人设阶段】：只填正文里已经写出、满足该线「进入条件」的线；to 只能填该线的下一阶段名，不能跳段、不能退回；floor 填依据所在的楼号，reason 写一句依据。没有满足的就填空数组。";
  function personaLines(items) {
    return items.map(
      (item) => `- ${item.group ? `${item.group}·` : ""}${item.name}：当前「${item.from}」；下一阶段「${item.to}」，进入条件：${item.cond || "（未写，按阶段名判断）"}`
    ).join(`
`);
  }
  var EMPTY_NAMES = /^(?:无|没有|暂无|空|none|null|nil|n\/a|na|undefined|-|—|无新线|没有新线|没有新的线)$/i, isEmptyName = (name) => EMPTY_NAMES.test(
    String(name).trim().replace(/[。．.！!？?；;，,、\s]+$/, "").trim()
  );
  function buildCheckMessages(unit, index, floors, threads = null, personas2 = null) {
    let extra = threadRules(threads), pItems = Array.isArray(personas2) ? personas2 : [], format = '{"done":["节点名"],"stageDone":true或false,"offTrack":true或false,"offReason":"偏离说明，没有就留空","reason":"一句话"}', system = [
      "你是剧情进度核对员。根据最近的正文，对照剧情索引判断进度。",
      "只认正文里已经写出的事件，计划、预告、角色设想不算发生。",
      "若剧情走了某个节点的「偏转」分支，在 reason 里写明是哪个节点、怎么偏的。",
      "另外判断剧情是否严重偏离大纲：正文的走向已经和【当前】【下一段】冲突，照原计划写下去会接不上（例如关键人物已死、关键事件已不可能发生、地点或立场彻底改变）。普通的细节出入、走了偏转分支都不算严重偏离。",
      `只输出一个 JSON 对象，不加说明：${extra || pItems.length ? `${format.slice(0, -1)}${[...extra ? extra.keys : [], ...pItems.length ? [PERSONA_KEY] : []].map((key) => `,${key}`).join("")}}` : format}`,
      `done 只填${extra && extra.hooks ? "【当前】或【支线钩子】" : "【当前】"}里出现过的节点名，原样照抄；stageDone 表示当前段所有主线节点都已发生、剧情已进入下一段。`,
      ...extra ? extra.rules : [],
      ...pItems.length ? [PERSONA_RULE] : []
    ].join(`
`), readTo = extra ? extra.readTo : 0, user = [
      `【剧情索引】
${index}`,
      ...pItems.length ? ["", `【人设阶段】
${personaLines(pItems)}`] : [],
      "",
      "【最近正文】",
      ...floors.map((floor) => `【第 ${floor.index} 楼${readTo > 0 && floor.index < readTo ? "·已读" : ""}】
${floor.text}`)
    ].join(`
`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function buildPersonaCheckMessages(items, floors) {
    let system = [
      "你是人设阶段核对员。根据最近的正文，判断下列人设线是否已经进入下一阶段。",
      "只认正文里已经写出的事件，计划、预告、角色设想不算发生。",
      `只输出一个 JSON 对象，不加说明：{${PERSONA_KEY}}`,
      PERSONA_RULE
    ].join(`
`), user = [
      `【人设阶段】
${personaLines(items)}`,
      "",
      "【最近正文】",
      ...floors.map((floor) => `【第 ${floor.index} 楼】
${floor.text}`)
    ].join(`
`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function parseCheckReply(text2) {
    let raw = String(text2 || ""), start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("检测结果不是 JSON");
    let value;
    try {
      value = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error("检测结果 JSON 无法解析");
    }
    let done = Array.isArray(value.done) ? value.done.map((item) => String(item).trim()).filter(Boolean) : [], flag = (item) => item === !0 || item === "true";
    return {
      done,
      stageDone: flag(value.stageDone),
      offTrack: flag(value.offTrack),
      offReason: String(value.offReason || "").trim(),
      reason: String(value.reason || "").trim(),
      clocks: parseClocks(value.clocks, flag),
      hooks: names(value.hooks),
      newThread: parseThread(value.newThread),
      ...Array.isArray(value.personas) ? { personas: parsePersonaMoves(value.personas) } : {}
    };
  }
  var CLOCK_TICK_MAX = 2, names = (list) => Array.isArray(list) ? list.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  function parseClocks(raw, flag) {
    return (Array.isArray(raw) ? raw : raw && typeof raw == "object" ? Object.entries(raw).map(([name, item]) => item && typeof item == "object" ? { name, ...item } : { name, tick: item }) : []).filter((item) => item && typeof item == "object").map((item) => {
      let tick = Math.round(Number(item.tick ?? item.advance ?? item.推进));
      return {
        name: String(item.name ?? item.名称 ?? "").trim(),
        tick: Number.isFinite(tick) ? Math.min(CLOCK_TICK_MAX, tick) : 0,
        happened: flag(item.happened ?? item.发生)
      };
    }).filter((item) => item.name);
  }
  function parsePersonaMoves(raw) {
    return (Array.isArray(raw) ? raw : []).filter((item) => item && typeof item == "object").map((item) => ({
      line: String(item.line ?? item.线 ?? "").trim(),
      to: String(item.to ?? item.到 ?? "").trim(),
      floor: Math.round(Number(item.floor ?? item.楼)) || 0,
      reason: String(item.reason ?? item.依据 ?? "").trim()
    })).filter((item) => item.line && item.to);
  }
  function parseThread(raw) {
    if (!raw) return null;
    let item = typeof raw == "string" ? { name: raw } : raw;
    if (typeof item != "object") return null;
    let name = String(item.name ?? item.名称 ?? "").trim().slice(0, 40);
    return name && !isEmptyName(name) ? {
      name,
      summary: String(item.summary ?? item.概括 ?? "").trim().slice(0, 200)
    } : null;
  }
  function buildClueCheckMessages(material, floors, personas2 = []) {
    let system = [
      "你是剧情核对员。根据最近的正文，判断下面这个场景里列出的发现是否已经在正文中实际发生。",
      "只认正文里已经写出的事件：到了地点不等于找到证据，答应提供不等于已经拿到，计划和猜测都不算。",
      `只输出一个 JSON 对象，不加说明：{"done":["已发生的发现原文"],"stageDone":true或false,"offTrack":false,"offReason":"","reason":"一句话说明依据"${personas2.length ? `,${PERSONA_KEY}` : ""}}`,
      "done 只能照抄下面【可能的发现】里的条目；stageDone 表示这个场景已经结束。",
      ...personas2.length ? [PERSONA_RULE] : []
    ].join(`
`), user = ["【场景】", material, ...personas2.length ? [`【人设阶段】
${personaLines(personas2)}`] : [], "", "【最近正文】", ...floors.map((floor) => `【第 ${floor.index} 楼】
${floor.text}`)].join(`
`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }

  // src/host/llm.js
  function apiBase(endpoint) {
    let base = String(endpoint || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("请先填写接口地址");
    let parsed;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error("接口地址无效");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("接口地址需以 http:// 或 https:// 开头");
    let root = base.replace(/\/(?:chat\/completions|models)$/i, "");
    return /\/v\d+$/i.test(root) ? root : `${root}/v1`;
  }
  function safeDetail(value, apiKey) {
    let text2 = String(value || ""), key = String(apiKey || "").trim();
    return key && (text2 = text2.split(key).join("[已隐藏]")), text2.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  }
  function connection(llm) {
    let key = String(llm.apiKey || "").trim();
    return {
      chat_completion_source: "custom",
      custom_url: apiBase(llm.endpoint),
      custom_include_headers: JSON.stringify({ Authorization: key ? `Bearer ${key}` : "" })
    };
  }
  async function postBackend(route, body, llm, signal) {
    let res = await hostWindow().fetch(`/api/backends/chat-completions/${route}`, {
      method: "POST",
      cache: "no-cache",
      signal,
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }), text2 = await res.text(), data = null;
    try {
      data = JSON.parse(text2);
    } catch {
    }
    if (!res.ok || data && data.error) {
      let detail = safeDetail(data && data.error && (data.error.message || data.error) || data && data.message || text2, llm.apiKey);
      throw new Error(`接口请求失败${res.ok ? "" : `（HTTP ${res.status}）`}${detail ? `：${detail}` : ""}`);
    }
    if (!data) throw new Error(`接口返回的不是 JSON${text2 ? `：${safeDetail(text2, llm.apiKey)}` : ""}`);
    return data;
  }
  function stripThinking(text2) {
    let out = String(text2 || "");
    return out = out.replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, ""), out.trim();
  }
  async function viaTavern(messages) {
    let mark = `[剧情注入器后台任务 ${Math.random().toString(36).slice(2, 10)}，与正文无关]`, i = messages.findIndex((m) => m && m.role === "system"), tagged = i >= 0 ? messages.map((m, k) => k === i ? { ...m, content: `${m.content}

${mark}` } : m) : [{ role: "system", content: mark }, ...messages];
    backgroundMarks.add(mark);
    try {
      return await viaTavernRaw(tagged);
    } finally {
      backgroundMarks.delete(mark);
    }
  }
  async function viaCustom(messages, llm, signal) {
    if (!String(llm.model || "").trim()) throw new Error("请先选择模型");
    let body = { ...connection(llm), model: llm.model, stream: !1, messages }, temperature = Number(llm.temperature);
    llm.temperature !== "" && Number.isFinite(temperature) && (body.temperature = temperature);
    let data = await postBackend("generate", body, llm, signal);
    return String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "");
  }
  async function requestLlm(messages, llm, { timeoutMs = 18e4, signal } = {}) {
    let view = hostWindow(), controller = new view.AbortController(), timer, onAbort = null, timeout = new Promise((_, reject) => {
      timer = view.setTimeout(() => {
        controller.abort(), reject(new Error("请求超时"));
      }, timeoutMs);
    }), stopped = new Promise((_, reject) => {
      signal && (onAbort = () => {
        controller.abort();
        let error = new Error("已停止");
        error.name = "AbortError", reject(error);
      }, signal.aborted ? onAbort() : signal.addEventListener("abort", onAbort, { once: !0 }));
    });
    try {
      let job = llm.source === "custom" ? viaCustom(messages, llm, controller.signal) : viaTavern(messages);
      job.catch(() => {
      });
      let text2 = stripThinking(await Promise.race([job, timeout, stopped]));
      if (!text2) throw new Error("模型没有返回内容");
      return text2;
    } finally {
      view.clearTimeout(timer), signal && onAbort && signal.removeEventListener("abort", onAbort);
    }
  }
  async function fetchModels(llm) {
    let data = await postBackend("status", connection(llm), llm), list = Array.isArray(data && data.data) ? data.data : data && data.models, models = [
      ...new Set(
        (Array.isArray(list) ? list : []).map((item) => typeof item == "string" ? item : item && (item.id || item.name)).filter(Boolean)
      )
    ];
    if (!models.length) throw new Error("接口没有返回模型列表");
    return models.sort();
  }
  var backgroundMarks = /* @__PURE__ */ new Set();
  function isBackgroundRequest(text2) {
    if (!backgroundMarks.size) return !1;
    let s = String(text2 || "");
    for (let mark of backgroundMarks) if (s.includes(mark)) return !0;
    return !1;
  }
  async function viaTavernRaw(messages) {
    let h = helper();
    if (h && typeof h.generateRaw == "function")
      return String(await h.generateRaw({ should_stream: !1, should_silence: !0, ordered_prompts: messages }) || "");
    let c = ctx();
    if (c && typeof c.generateRaw == "function") {
      let system = messages.filter((msg) => msg.role === "system").map((msg) => msg.content).join(`

`), rest = messages.filter((msg) => msg.role !== "system").map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`);
      return String(await c.generateRaw({ systemPrompt: system, prompt: rest }) || "");
    }
    throw new Error("当前酒馆不支持后台生成，请改用独立接口");
  }

  // src/core/clue-template.js
  var CLUE_TPL_MARK_BEGIN = "【线索主线附加规则·剧情注入器】", CLUE_TPL_MARK_END = "【附加规则结束】", CLUE_TPL_PLACE = (depth, order, position = "at_depth_as_system") => ({ position, depth, order });
  function clueTplExport(name, extra = {}) {
    return {
      enabled: !1,
      splitByRow: !1,
      entryName: name,
      entryType: "constant",
      keywords: "",
      preventRecursion: !0,
      injectionTemplate: "",
      extraIndexEnabled: !1,
      extraIndexEntryName: `${name}-索引`,
      extraIndexColumns: [],
      extraIndexColumnModes: {},
      extraIndexInjectionTemplate: "",
      entryPlacement: CLUE_TPL_PLACE(2, 1e4),
      extraIndexPlacement: CLUE_TPL_PLACE(2, 10010),
      fixedEntryPlacement: CLUE_TPL_PLACE(2, 99990),
      fixedIndexPlacement: CLUE_TPL_PLACE(2, 99991),
      ...extra
    };
  }
  var CLUE_TPL_REALTIME = { uiSentinel: -1, contextDepth: -1, updateFrequency: 1, batchSize: -1, skipFloors: 0, groupId: 0 }, CLUE_TPL_EVIDENCE = [
    "【依据规则】只按 AI 回复（正文）里实际发生的事填写。用户消息里出现的计划、提议、打算、「准备去做」「预计会发现」都不算发生。",
    "    反例：用户消息写「去后屋找账本，会找到被撕掉的那页」，正文写主角翻了几本旧账、什么也没找到就离开了 → 不记录任何发现，状态保持原值。",
    "    拿不准正文有没有写出某项结果、某个角色有没有得知时，保持原值：宁可晚一批登记，不要提前登记。"
  ].join(`
`);
  function clueControlSheet() {
    return {
      uid: "sheet_ClueCtrl01",
      name: "线索控制表",
      sourceData: {
        note: [
          "主角眼下正在做哪一段剧情的事。此表有且仅有一行，「标识」固定为「主线」（代表全局的当前剧情活动）。",
          "- 标识：固定写「主线」，不要修改。",
          "- 场景目录：由剧情注入器维护，填表时不要修改。列的是现在可以去做的剧情的编号、要做的事和地点；只用于对号，不表示那件事已经发生。",
          "- 当前场景：以本批最后一楼结束时，主角实际在做的事为准。叙述跟着主角走，这一列记的不是主角在不在场，而是他在不在做某一段剧情的事。只能写「场景目录」里的编号，或者写「无」。",
          "    · 主角开始做「场景目录」里某一件事：照抄那一件的编号。开始做的那一楼就写，不用等事情有结果。",
          "    · 别人只是提起、主角没有去做，不算；路过不算。",
          "      看的是主角在为什么而忙，不是具体动作，也不是站在哪：为了同一个目的换个做法、换个地方继续（边走边接着谈、到隔壁房间找能打开那把锁的钥匙、去别处取查这件事要用的东西），都还是这一段，仍写原来的编号。地点只用来帮助对号（列了几个地点时任何一处都算）。",
          "    · 这件事已经结束、搁置，或者主角转去做别的事了：写「无」，人还在原地、对面还是同一个人也一样（和同一个人聊起了不相干的事，也算转去做别的）。",
          "      例：在值夜棚问完话，改成和老韩吃饭闲聊 → 写「无」。离开仓库去车站，路上经过邮局没进去 → 写「无」（旧的那件事已经不做了，邮局也没开始）。",
          "    · 只是说要走、约好、打算，实际还没动：保持原值。",
          "    · 看到、记下、指给别人看、路过、远远听见，都不算开始做新的那件事。",
          "    · 同一楼里做了几件事：以最后实际在做的那件事为准。以本批正文为准，全局表里还没更新的地点不能否定正文里已经发生的转场。",
          "    · 不得自造编号；「场景目录」里没有的场景不要写。",
          CLUE_TPL_EVIDENCE
        ].join(`
`),
        initNode: "已有「主线」行就沿用，不要再插入。只有表里没有任何行时才插入一行：标识=主线，当前场景留空。",
        deleteNode: "禁止删除。",
        updateNode: `只更新「当前场景」，不改「场景目录」。例：主角走进裁缝铺开始问话 → 当前场景改为场景目录里裁缝铺对应的编号；主角说「先回家睡觉」并离开 → 当前场景改为「无」。
SQL示例: UPDATE clue_control SET cur_scene = '<场景编号>' WHERE tag = '主线';`,
        insertNode: "禁止插入（只有一行）。",
        ddl: `CREATE TABLE clue_control ( -- 线索控制表
  row_id INTEGER PRIMARY KEY, -- 行号
  tag TEXT NOT NULL UNIQUE, -- 标识
  cur_scene TEXT, -- 当前场景
  scene_catalog TEXT -- 场景目录
);`
      },
      content: [["row_id", "标识", "当前场景", "场景目录"]],
      updateConfig: { ...CLUE_TPL_REALTIME },
      exportConfig: clueTplExport("线索控制表", { injectIntoWorldbook: !1 }),
      orderNo: 0
    };
  }
  function clueFactSheet() {
    return {
      uid: "sheet_ClueFact01",
      name: "关键事实表",
      sourceData: {
        note: [
          "剧情需要追踪的关键发现。每行一条，由卡作者预先建好；填表时只改「状态」「内容」「依据」，不新增、不删除，不改「编号」「标签」「登记口径」。",
          "- 编号：事实编号，不要修改。",
          "- 标签：中性的简短名称，不要修改，也不要据此推断答案。",
          "- 登记口径：正文里出现什么才算取得这一项（不含答案）。不要修改。",
          "- 状态：只能是 未获得 / 已核实 / 存疑。",
          "    · 已核实：正文里主角实际取得了这项结果，而且有可靠依据（亲眼看到实物、读到原件、得到明确验证）。",
          "    · 存疑：正文里确实出现了这项内容，但来源只是某人的说法、传闻或推测，还没有可靠依据。「内容」要写明是谁说的。拿不准正文有没有写出这项内容时不要记为存疑，保持原值。",
          "    · 未获得：其余情况。到达地点、尝试调查、对方答应提供、中途离开，都仍是未获得。",
          "- 内容：一句话写出正文里实际出现的内容，只写正文写出来的部分，不补充正文没有的细节。例：只承认拿了钱、没说原因，就只写拿了钱。",
          "- 依据：写明正文哪一楼、哪个情节。",
          "怎么找编号：",
          "    · 首次获得：按各行的「登记口径」判断正文写出的结果对应哪个编号、是否已经取得。附有【线索编号对照】时也可以参考。口径和对照都只用于对号，不代表已经发生。",
          "    · 维护已有记录：已经是已核实或存疑的行，正文出现新证据推翻或证实它时，可以按这一行已有的「内容」匹配并更新。无法确定是哪一行时保持原值。",
          "    · 已有记录又出现佐证（不推翻、也不改变状态）：「内容」保持不变；只有带来新信息时，才在「依据」原文后面追加「；后续：<楼层 新情节>」。没有新信息、或同一楼的情节已经追加过，就不改。不要用新情节覆盖第一次取得时的内容和依据。",
          "      例：之前已核实「第一次签收的回执」，这一楼主角在另一份收据上看到同样的签名 → 内容不变，依据追加「；后续：第<N>楼 另一份收据上的签名相同」。",
          "    · 正文没写出对应结果时，不要改任何行。",
          CLUE_TPL_EVIDENCE
        ].join(`
`),
        initNode: "保留模板里预先建好的行，不要清空、不要新增。",
        deleteNode: "禁止删除。",
        updateNode: `只有正文明确写出结果时，才把对应编号的状态改为已核实或存疑，并填写内容和依据。已核实的事实后来被正文推翻时改为存疑，在依据里写明新证据和楼层；存疑的说法后来得到可靠证实时改为已核实。
SQL示例(首次登记说法): UPDATE clue_facts SET status = '存疑', content = '<谁>说<正文里的原意>', evidence = '第<N>楼 <情节>' WHERE code = '<编号>';
SQL示例(纯佐证，只追加依据): UPDATE clue_facts SET evidence = evidence || '；后续：第<N>楼 <新情节>' WHERE code = '<编号>';
SQL示例(原说法被推翻或证实): UPDATE clue_facts SET status = '<已核实或存疑>', evidence = evidence || '；第<N>楼 <新证据>' WHERE code = '<编号>';`,
        insertNode: "禁止插入。只修改已有行。",
        ddl: `CREATE TABLE clue_facts ( -- 关键事实表
  row_id INTEGER PRIMARY KEY, -- 行号
  code TEXT NOT NULL UNIQUE, -- 编号
  label TEXT NOT NULL, -- 标签
  criterion TEXT, -- 登记口径
  status TEXT NOT NULL DEFAULT '未获得' CHECK(status IN ('未获得', '已核实', '存疑')), -- 状态
  content TEXT, -- 内容
  evidence TEXT -- 依据
);`
      },
      content: [["row_id", "编号", "标签", "登记口径", "状态", "内容", "依据"]],
      updateConfig: { ...CLUE_TPL_REALTIME },
      // 不导出到正文世界书：已获得的事实由剧情注入器按知情范围投影。
      exportConfig: clueTplExport("关键事实表", { injectIntoWorldbook: !1 }),
      orderNo: 1
    };
  }
  function clueKnowSheet() {
    return {
      uid: "sheet_ClueKnow01",
      name: "知情表",
      sourceData: {
        note: [
          "关键角色是否知道某条关键事实。每行是「一条事实 × 一个角色」，由卡作者预先建好；填表时只改「获知方式」「可信度」「依据」，不新增、不删除行。",
          "- 键 / 事实 / 角色：不要修改。主角按模板已有写法（如 user）。",
          "- 获知方式：只能是 未知 / 亲见 / 被告知 / 听说 / 推测。逐个角色判断：",
          "    · 亲见：这个角色自己看清了实物或原件内容。",
          "    · 被告知：有人明确把这件事告诉了这个角色本人，或者展示给他看。",
          "    · 听说：这个角色听到了转述、传闻。",
          "    · 推测：这个角色自己提出了猜想或怀疑，手里还没有证据。",
          "      这个角色亲眼看了实物或原件、再据此得出的判断（如读了单据后判断证词对不上），记为「亲见」，不是推测。推测不配「已核实」。",
          "    · 未知：其余情况。【在场不等于知道】：只是在场、没听清、别人私下得知时他在附近，都保持原值，除非正文写出他看到或听到了内容。",
          "- 可信度：只能是 已核实 / 未核实。跟着这个角色手里的证据走：亲见通常是已核实；被告知、听说、推测通常是未核实，除非正文写出他确认了真假。",
          "- 依据：写明正文哪一楼、哪个情节。",
          "【先看事实表】某条事实在关键事实表里仍是「未获得」、本次也没有把它登记成已核实或存疑时，它的知情行全部保持原值。",
          "    知情的对象是关键事实表里那一行的「登记口径」所说的结果，不是标签字面上的东西。",
          "    例：口径是「在抽屉里找到那封信并读到内容」，正文只写主角看见了上锁的抽屉、没打开 → 事实表保持未获得，知情行也保持未知。",
          "获知方式只升级、不降级：已经是亲见的，不因旁人又提起改成听说。出现反证时，可以更新可信度和依据，但保留原来是怎么得知的。",
          "已有记录的「依据」不要覆盖：再次见到或听到时，在原文后面追加「；后续：<新情节>」。",
          CLUE_TPL_EVIDENCE
        ].join(`
`),
        initNode: "保留模板里预先建好的行，不要清空、不要新增。",
        deleteNode: "禁止删除。",
        updateNode: `只有正文明确写出某个角色看到、被告知、听到、猜到某条事实时，才更新对应行。例：老人当面对主角说看见了人 → 主角那一行改为「被告知 / 未核实」；老板娘当时不在场 → 她那一行保持原值。
SQL示例: UPDATE clue_knowledge SET way = '被告知', credibility = '未核实', evidence = '第<N>楼 <情节>' WHERE key = '<事实编号>@<角色>';`,
        insertNode: "禁止插入。只修改已有行。",
        ddl: `CREATE TABLE clue_knowledge ( -- 知情表
  row_id INTEGER PRIMARY KEY, -- 行号
  key TEXT NOT NULL UNIQUE, -- 键
  fact TEXT NOT NULL, -- 事实
  actor TEXT NOT NULL, -- 角色
  way TEXT NOT NULL DEFAULT '未知' CHECK(way IN ('未知', '亲见', '被告知', '听说', '推测')), -- 获知方式
  credibility TEXT NOT NULL DEFAULT '未核实' CHECK(credibility IN ('已核实', '未核实')), -- 可信度
  evidence TEXT -- 依据
);`
      },
      content: [["row_id", "键", "事实", "角色", "获知方式", "可信度", "依据"]],
      updateConfig: { ...CLUE_TPL_REALTIME },
      exportConfig: clueTplExport("知情表", { injectIntoWorldbook: !1 }),
      orderNo: 2
    };
  }
  var CLUE_SCENE_CATALOG_HEAD = `
【场景编号对照】（只用于对号`;
  function clueSheets({ factRows = [], knowRows = [], controlRow = null, scenes = [], placeTables = [] } = {}) {
    let ctrl = clueControlSheet(), facts = clueFactSheet(), know = clueKnowSheet();
    placeTables.length && (ctrl.sourceData.note += `
地点名称以${placeTables.map((n) => `《${n}》`).join("、")}里的为准。`), controlRow && ctrl.content.push([null, ...controlRow, "", ""].slice(0, 4));
    for (let r of factRows) facts.content.push([null, r.code, r.label, r.criterion || "", "未获得", "", ""]);
    for (let r of knowRows) know.content.push([null, `${r.fact}@${r.actor}`, r.fact, r.actor, "未知", "未核实", ""]);
    return [ctrl, facts, know];
  }
  var CLUE_TPL_DEFAULTS = {
    全局数据表: ["全局状态", "当前详细地点", "当前次要地区", "当前主要地区", "上轮场景时间", "经过的时间", "当前时间"],
    重要角色表: ["姓名", "性别", "年龄", "一句话介绍", "外貌特征", "穿着打扮", "所在地点", "在场状态", "人际关系", "过往经历", "交互选项"],
    任务与事件表: ["任务名称", "任务类型", "发布者", "详细描述", "当前进度", "任务时限", "奖励", "惩罚"],
    选项表: ["选项一", "选项二", "选项三", "选项四"]
  }, CLUE_TPL_CHAR_COLS = [
    { sql: "plot_identity", label: "剧情身份" },
    { sql: "current_intent", label: "当前动向" }
  ], CLUE_TPL_RULES = {
    重要角色表: [
      "- 建行：本批正文中实际登场，或有人明确提到、且对当前事件有作用的人，才建行。沿用当时可辨认的称呼；姓名还没揭示就用正文里的称呼，以后确认是同一人时更新原行，不另建一行。",
      "- 背景设定里写了、但正文还没有展示的身份、关系、秘密和未来安排，不写进任何一列。关系和经历只补正文已经展示的部分。",
      "- 剧情身份：写成「谁在第几楼如何称呼或自述」，如「第3楼自称本地商人」。之后被核实或推翻时，在后面追加证据和楼层，不删原来的说法。",
      "- 当前动向：分清「说打算去」「已出发」「已到达」。正文没有交代新的动向就保持原值；离开场景后在做什么，正文写了才记。",
      "- 一句话介绍只写公开特征；交互选项只写主角目前有依据尝试的行动。"
    ].join(`
`),
    任务与事件表: [
      "- 从本批正文找主角已经接下的委托、已触发的差事，或主角明确立下的目标；当面交谈、书信和已经发生的行动都可以作依据。本批没有，就不新增。",
      "- 设定里写了、但正文还没有出现的目标、真相和幕后人物，不写进任何一列。主线剧情由剧情注入器按进度提供，不要预写主线任务。",
      "- 详细描述记已知的要求及其来源；当前进度只写实际完成的步骤。期限、奖励、后果只有正文明确时才填。完成、失败、过期沿用本表原有规则。"
    ].join(`
`),
    选项表: [
      "- 四个选项写主角基于此刻所见、所闻或已有记忆，下一步可以尝试的行动。保留本表原有的第三人称和四类选项的要求。",
      "- 允许提问、闲聊、暂时离开和继续日常。写「去档案室查有没有签收记录」这样的尝试，结果留给正文；即使知道某个地点，也不能预写那里一定有某项证据。",
      "- 不要提出主角在正文里还没听说过的地点、人物或真相。生成选项不会更新任务、事实或人物知情。"
    ].join(`
`)
  }, CLUE_TPL_REPLACE = {
    重要角色表: {
      initNode: {
        from: "故事开始时为当前已知的重要角色分别插入条目。",
        // 数据库默认（spv8.9.2）的整段 initNode：只有和它完全相同时才替换开头那句。
        whole: `故事开始时为当前已知的重要角色分别插入条目。

【格式约束】
relation_text 必须写"角色名:关系描述"；同一角色多项描述用英文逗号 , 分隔；不同角色之间用英文分号 ; 分隔。

SQL示例: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('校长', '男', 60, '学院校长', '白发，手持手杖，目光深邃', '深灰立领风衣配黑皮手套', '校长室', '离场', '主角:曾帮其修过自行车,旧识;艾莉丝:监护人', '据说知晓学院的许多秘密，很少露面。', '向他打听失踪案线索');`,
        to: "故事开始时，只为开场正文里实际登场、或被明确提到且对当前事件有作用的重要角色插入条目；只写正文已经展示的内容。"
      }
    },
    任务与事件表: {
      initNode: {
        from: "游戏初始化时，根据剧情与设定添加一条主线剧情。",
        to: "游戏初始化时，只记录开场正文里主角已经接下的委托或明确立下的目标；没有就不添加。不要根据设定预写主线任务。"
      }
    }
  };
  function clueTplHeader(sheet) {
    return (Array.isArray(sheet && sheet.content) && Array.isArray(sheet.content[0]) ? sheet.content[0] : []).slice(1).map((x) => String(x ?? "").trim());
  }
  function clueTplMismatch(tpl, live) {
    let sheets = (o) => Object.entries(o || {}).filter(([k, v]) => k.startsWith("sheet_") && isPlainObject(v) && v.name).map(([, v]) => v), t = sheets(tpl), l = sheets(live), out = [];
    if (!l.length) return out;
    let tn = t.map((s) => String(s.name).trim()), ln = l.map((s) => String(s.name).trim()), dup = (xs) => [...new Set(xs.filter((n, i) => xs.indexOf(n) !== i))];
    dup(tn).length && out.push(`模板里有重名的表：${dup(tn).join("、")}`), dup(ln).length && out.push(`当前聊天有重名的表：${dup(ln).join("、")}`);
    let onlyT = tn.filter((n) => !ln.includes(n)), onlyL = ln.filter((n) => !tn.includes(n));
    onlyT.length && out.push(`模板里有、当前聊天没有：${onlyT.join("、")}（可能读到的是全局模板）`), onlyL.length && out.push(`当前聊天有、模板里没有：${onlyL.join("、")}（导入后这些表会被数据库隐藏）`);
    for (let s of l) {
      let m = t.find((x) => String(x.name).trim() === String(s.name).trim());
      if (!m) continue;
      let lh = clueTplHeader(s), th = clueTplHeader(m), lost = lh.filter((c) => c && !th.includes(c));
      lost.length && out.push(`「${s.name}」当前聊天里的列「${lost.join("、")}」模板里没有`);
    }
    return out;
  }
  function stripRuleBlock(text2) {
    let s = String(text2 || ""), i = s.indexOf(CLUE_TPL_MARK_BEGIN);
    if (i < 0) return s;
    let j = s.indexOf(CLUE_TPL_MARK_END, i);
    return (s.slice(0, i) + (j < 0 ? "" : s.slice(j + CLUE_TPL_MARK_END.length))).replace(/\n{3,}/g, `

`).replace(/\s+$/, "");
  }
  function withRuleBlock(text2, rules) {
    let base = stripRuleBlock(text2);
    return `${base}${base ? `

` : ""}${CLUE_TPL_MARK_BEGIN}
${rules}
${CLUE_TPL_MARK_END}`;
  }
  function ddlAddColumns(ddl, cols) {
    let src = String(ddl || "");
    if (!src.trim()) return { ok: !1, ddl: src };
    let close = src.lastIndexOf(")");
    if (close < 0) return { ok: !1, ddl: src };
    let body = src.slice(0, close).replace(/\s+$/, ""), tail = src.slice(close), defs = body.slice(body.indexOf("(") + 1).replace(/--[^\n]*/g, "");
    if (/(?:^|,)\s*(?:(?:CONSTRAINT|UNIQUE|CHECK|FOREIGN\s+KEY)\b|PRIMARY\s+KEY\s*\()/im.test(defs))
      return { ok: !1, ddl: src, why: "表定义里有表级约束" };
    let lines2 = body.split(`
`), last = lines2.length - 1;
    for (; last >= 0 && !lines2[last].trim(); ) last--;
    let m = /^(.*?)(\s*--.*)?$/.exec(lines2[last]);
    lines2[last] = `${m[1].replace(/,\s*$/, "")},${m[2] || ""}`;
    let added = cols.map((c, i) => `  ${c.sql} TEXT${i < cols.length - 1 ? "," : ""} -- ${c.label}`);
    return { ok: !0, ddl: `${lines2.slice(0, last + 1).join(`
`)}
${added.join(`
`)}
${tail}` };
  }
  function sheetEntries(tpl) {
    return Object.entries(tpl || {}).filter(([k, v]) => k.startsWith("sheet_") && isPlainObject(v));
  }
  function synthesizeClueTemplate(base, { clue = {} } = {}) {
    let tpl = JSON.parse(JSON.stringify(isPlainObject(base) ? base : {})), changes = [], problems2 = [], created = [], blocked = [];
    isPlainObject(tpl.mate) || (tpl.mate = { type: "chatSheets", version: 1 });
    let byName = /* @__PURE__ */ new Map(), dups = /* @__PURE__ */ new Set();
    for (let [key, sheet] of sheetEntries(tpl)) {
      let name = String(sheet.name || "").trim();
      byName.has(name) ? dups.add(name) : byName.set(name, { key, sheet });
    }
    for (let name of dups) byName.delete(name), problems2.push(`有两张以上的表都叫「${name}」，没有改动它们`);
    let maxOrder = Math.max(
      -1,
      ...sheetEntries(tpl).map(([, s]) => Number(s.orderNo)).filter(Number.isFinite)
    ), placeTables = sheetEntries(tpl).map(([, s]) => s).filter((s) => /地点/.test(String(s.name || "")) && /(^|,)(地点名称|名称)(,|$)/.test(clueTplHeader(s).join(","))).map((s) => String(s.name)), fresh = clueSheets({ ...clue, placeTables });
    for (let sheet of fresh) {
      if (dups.has(sheet.name)) {
        blocked.push(sheet.name);
        continue;
      }
      let have = byName.get(sheet.name);
      if (!have) {
        let key = sheet.uid;
        for (let n = 2; tpl[key]; n++) key = `${sheet.uid}_${n}`;
        sheet.uid = key, sheet.orderNo = ++maxOrder, tpl[key] = sheet, created.push(sheet.name);
        let rows2 = sheet.content.length - 1;
        changes.push(`新增「${sheet.name}」${rows2 ? `，带 ${rows2} 行预建数据` : ""}`);
        continue;
      }
      let wantHead = clueTplHeader(sheet), head = clueTplHeader(have.sheet), missing = wantHead.filter((c) => !head.includes(c));
      if (sheet.name === "线索控制表" && missing.length === 1 && missing[0] === LINE_CATALOG_COL && head.includes("标识") && head.includes("当前场景")) {
        let oldDdl = String(have.sheet.sourceData && have.sheet.sourceData.ddl || ""), ddl = oldDdl.trim() ? ddlAddColumns(oldDdl, [{ sql: "scene_catalog", label: LINE_CATALOG_COL }]) : { ok: !0, ddl: "" };
        if (!ddl.ok) {
          problems2.push(
            `「线索控制表」的 DDL ${ddl.why || "无法解析"}，没有加「${LINE_CATALOG_COL}」列；多线的场景目录写不进去，需要的话请在数据库里手动加`
          );
          continue;
        }
        ddl.ddl && (have.sheet.sourceData = { ...have.sheet.sourceData, ddl: ddl.ddl }), have.sheet.content[0].push(LINE_CATALOG_COL);
        for (let row2 of have.sheet.content.slice(1)) Array.isArray(row2) && row2.push("");
        Array.isArray(have.sheet.seedRows) && have.sheet.seedRows.forEach((row2) => Array.isArray(row2) && row2.push("")), changes.push(`「线索控制表」新增列：${LINE_CATALOG_COL}（由插件写入现在可去做的剧情；原有列和行不动）`), missing.length = 0;
      }
      if (missing.length) {
        problems2.push(`已有的「${sheet.name}」缺少列：${missing.join("、")}。没有改动这张表，请检查是否是别的用途的同名表`);
        continue;
      }
      if (sheet.name === "线索控制表") {
        let note = String(have.sheet.sourceData && have.sheet.sourceData.note || ""), i = note.lastIndexOf(CLUE_SCENE_CATALOG_HEAD), base0 = i < 0 ? note : note.slice(0, i).replace(/\s+$/, ""), fresh0 = clueControlSheet().sourceData, oldStart = base0.indexOf("主角眼下正在做哪一段剧情的事。"), oldEnd = base0.indexOf(CLUE_TPL_EVIDENCE), next = oldStart >= 0 && oldEnd > oldStart ? base0.slice(0, oldStart) + fresh0.note + base0.slice(oldEnd + CLUE_TPL_EVIDENCE.length) : base0;
        next !== note && (have.sheet.sourceData = { ...have.sheet.sourceData, note: next, updateNode: fresh0.updateNode }, changes.push(
          i >= 0 ? "「线索控制表」说明：去掉旧的场景编号对照（改由「场景目录」列提供），更新填表规则" : "「线索控制表」说明：更新填表规则（只写当前场景、不改场景目录）"
        ));
      }
      sameRealtime(have.sheet.updateConfig) || (have.sheet.updateConfig = { ...have.sheet.updateConfig || {}, ...CLUE_TPL_REALTIME }, changes.push(`「${sheet.name}」改为每楼更新（与全局数据表同组）`));
    }
    let g = byName.get("全局数据表");
    return g ? clueTplHeader(g.sheet).includes("当前时间") ? sameRealtime(g.sheet.updateConfig) || (g.sheet.updateConfig = { ...g.sheet.updateConfig || {}, ...CLUE_TPL_REALTIME }, changes.push("「全局数据表」改为每楼更新（与线索表同组）")) : problems2.push("「全局数据表」没有「当前时间」列：时间条件会是未知，请在表格绑定里指定时间格") : problems2.push("当前模板里没有「全局数据表」：大纲里的时间条件会是未知。可以在表格绑定里把 time 指向别的时间格"), patchDefault("重要角色表", (sheet) => {
      let head = sheet.content[0], have = clueTplHeader(sheet), add = CLUE_TPL_CHAR_COLS.filter((c) => !have.includes(c.label));
      if (add.length) {
        let ddl = ddlAddColumns(sheet.sourceData && sheet.sourceData.ddl, add);
        if (!ddl.ok)
          return problems2.push(
            `「重要角色表」的 DDL ${ddl.why || "无法解析"}，没有加列（剧情身份、当前动向）；需要的话请在数据库里手动加`
          );
        sheet.sourceData = { ...sheet.sourceData, ddl: ddl.ddl }, head.push(...add.map((c) => c.label));
        for (let row2 of sheet.content.slice(1)) Array.isArray(row2) && row2.push(...add.map(() => ""));
        Array.isArray(sheet.seedRows) && sheet.seedRows.forEach((row2) => Array.isArray(row2) && row2.push(...add.map(() => ""))), changes.push(`「重要角色表」新增列：${add.map((c) => c.label).join("、")}（原有列不动）`);
      }
    }), patchDefault("任务与事件表"), patchDefault("选项表"), {
      template: tpl,
      changes,
      problems: problems2,
      created,
      // 线索三表有重名（R10）：不新建、不自动绑定，调用方应停止。
      blocked,
      binding: {
        facts: [
          {
            表: "关键事实表",
            编号列: "编号",
            状态列: "状态",
            已核实值: "已核实",
            说法值: "存疑",
            内容列: "内容",
            来源列: "依据"
          }
        ],
        knowledge: [
          {
            表: "知情表",
            事实列: "事实",
            角色列: "角色",
            方式列: "获知方式",
            可信度列: "可信度",
            已核实值: "已核实",
            来源列: "依据",
            有效值: ["亲见", "被告知", "听说", "推测"]
          }
        ],
        scene: { 路径: "线索控制表/主线/当前场景", 离场值: "无" },
        time: { 路径: ["全局数据表/全局状态/当前时间", "线索控制表/主线/当前时间"] }
      }
    };
    function sameRealtime(cfg) {
      return !!cfg && cfg.updateFrequency === 1 && cfg.skipFloors === 0 && cfg.groupId === 0;
    }
    function patchDefault(name, extra) {
      let hit = byName.get(name);
      if (!hit) return;
      let sheet = hit.sheet, head = clueTplHeader(sheet), want = CLUE_TPL_DEFAULTS[name];
      if (!want.every((c) => head.includes(c)))
        return problems2.push(
          `「${name}」的列和数据库默认不一致（缺 ${want.filter((c) => !head.includes(c)).join("、")}），没有改它的规则；需要的话请手动加上防剧透要求`
        );
      sheet.sourceData = { ...sheet.sourceData || {} }, extra && extra(sheet);
      for (let [field2, rep] of Object.entries(CLUE_TPL_REPLACE[name] || {})) {
        let cur = String(sheet.sourceData[field2] || "");
        if (cur.includes(rep.to)) continue;
        let official = rep.whole || rep.from, norm2 = (t) => t.replace(
          /\r\n?/g,
          `
`
        ).trim();
        norm2(cur) === norm2(official) ? (sheet.sourceData[field2] = cur.replace(rep.from, rep.to), changes.push(`「${name}」的${field2 === "initNode" ? "初始化" : "新增"}规则：「${rep.from}」改为「${rep.to}」`)) : problems2.push(
          `「${name}」的${field2 === "initNode" ? "初始化" : "新增"}规则和数据库默认不同，没有替换；请确认它不会按设定预写内容`
        );
      }
      let note = String(sheet.sourceData.note || ""), next = withRuleBlock(note, CLUE_TPL_RULES[name]);
      next !== note && (sheet.sourceData.note = next, changes.push(`「${name}」说明末尾${note.includes(CLUE_TPL_MARK_BEGIN) ? "更新" : "追加"}一段线索主线附加规则（原规则不动）`));
    }
  }

  // src/core/prompts.js
  var SAMPLE_STAGE = `剧情_卷一_示例:
  阶段一_开端:
    时间范围: 故事开始至主角离开故乡
    AI指令: 推进主角得知变故并决定出发的事件。
    主线节点:
      - 名称: 主角得知变故
        地点: 故乡
        事件: 用一到三句话写清谁做了什么、结果如何。
      - 名称: 决定是否出发
        地点: 家中
        事件: 一到三句话。
        偏转: 主角选择留下时，后续如何调整（只有选择确实改变后续时才写这一项）。
    支线事件:
      - 名称: 旧友送行
        地点: 村口
        事件: 一句话事件。
        触发: 出现这种情况时发生。
      - 名称: 酒馆密谈
        事件: 一位陌生人约主角深夜密谈。
        条件: 主角到过镇上的酒馆
        时限: 20
        错过: 陌生人离开了小镇，线索中断。
    世界动态:
      - 类型: 传闻
        来源: 谁传出
        内容: 外界正在发生什么。
      - 类型: 山匪逼近
        内容: 山匪袭击村庄。
        进度钟: 6
        前兆: 邻村有人被抢，夜里山上能看到火光。
        后果: 村庄被洗劫，村民对官府失去信任。
    状态变化:
      - 本阶段结束时谁知道了什么、谁对谁的看法或关系变了。
`, FOLD_KEEP = 16, FOLD_CHARS = 24e3;
  function discussSystemPrompt({ guide, refs, edit = null, persona = "" }) {
    let g = typeof guide == "string" ? { text: guide, title: "写作基准" } : guide || {}, parts = [
      g.opener || "你在帮用户构思一个故事的设定和剧情：一起把世界观、人物处境、信息差和大纲方向想清楚。",
      "每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。"
    ];
    return persona.trim() && parts.push(`【说话人格】
${persona.trim()}`), edit && parts.push(outlineEditPrompt(edit)), refs.length && parts.push(
      ...refs.map(
        (ref) => `【参考·${ref.title}】
${ref.text}`
      )
    ), g.text && parts.push(`【${g.title || "写作基准"}】
${g.text}`), parts.join(`

`);
  }
  function needsFold(messages) {
    let live = messages.filter((msg) => !msg.folded), chars = live.reduce((sum, msg) => sum + String(msg.content || "").length, 0);
    return live.length > FOLD_KEEP + 4 || chars > FOLD_CHARS;
  }
  function foldCandidates(messages) {
    let live = messages.filter((msg) => !msg.folded);
    return live.slice(0, Math.max(0, live.length - FOLD_KEEP));
  }
  function foldMessages(summary, messages) {
    let text2 = messages.map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`);
    return [
      {
        role: "system",
        content: "把下面的讨论压缩成要点摘要：保留已经敲定的设定、人物关系、剧情走向和仍未决定的问题，删掉寒暄和被否掉的方案。只输出摘要。"
      },
      { role: "user", content: `${summary ? `【已有摘要】
${summary}

` : ""}【新的讨论】
${text2}` }
    ];
  }
  function chatRequest(system, summary, messages) {
    let out = [{ role: "system", content: system }];
    summary && out.push({ role: "system", content: `【之前讨论的摘要】
${summary}` });
    for (let msg of messages.filter((item) => !item.folded))
      out.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
    return out;
  }
  function transcript(summary, messages, limit = 3e4) {
    let text2 = messages.filter((msg) => !msg.folded).map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`), joined = `${summary ? `【摘要】
${summary}

` : ""}${text2}`;
    return joined.length > limit ? joined.slice(-limit) : joined;
  }
  var refBlock = (refs) => refs && refs.length ? `【世界书参考】
${refs.map((ref) => `〔${ref.title}〕
${ref.text}`).join(`

`)}` : "";
  function settingMessages({ guide, talk, current, append, refs = [] }) {
    let system = `${guide}

${SETTING_SECRET_RULE}

按上面的规则产出，只回「世界观正文」「补定」「速查」三段。`, user = [
      current ? `【已有世界观正文】
${current}` : "",
      append ? "已有正文不改动，只把新增事实写成一段 [追加]。" : "",
      talk ? `【讨论记录】
${talk}` : "",
      refBlock(refs)
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function rewriteBlockMessages({ guide, current, blockText, fixes }) {
    return [
      {
        role: "system",
        content: `${guide}

${SETTING_SECRET_RULE}

只重写用户指定的一个分块，保留分块标题行，只输出这个分块。`
      },
      {
        role: "user",
        content: `【完整正文】
${current}

【要重写的分块】
${blockText}

【用户的修改】
${fixes}`
      }
    ];
  }
  function formatSample(volumes) {
    for (let volume of volumes || []) {
      let stage = volume.stages[0];
      if (stage) return `${volume.key}:
${stageToText(stage).replace(/^/gm, "  ").trimEnd()}
`;
    }
    return SAMPLE_STAGE;
  }
  var OUTLINE_RULES = [
    "只输出一个 ```yaml 代码块，不加说明。",
    "顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态、状态变化。",
    "节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。",
    "支线事件可选条件、时限、错过和步骤；世界动态可选进度钟、前兆和后果。只有适用时填写。",
    "每个阶段 2 到 4 个主线节点，事件写已经发生的事实。",
    "偏转默认不写：只有用户的选择确实会改变后续时，才给那个节点写偏转，多数节点没有这一项。写的时候说明原计划里哪一步仍然成立、哪一步可以略过；已有其他途径达成同一目的时，沿那条途径继续；缺少必要条件时，允许这件事暂时悬着。",
    "事件只写这一阶段玩家能看到、经历到的事；幕后答案、真相写进 <仅作者>…</仅作者>，不要直接写进事件。",
    "时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。",
    "状态变化逐条写本阶段结束时人物关系、认知和信息差比开局变了什么，没有变化就省略。"
  ].join(`
`);
  function changesBlock(units, title2) {
    let lines2 = units.flatMap((unit) => changeLines(unit.stage.data).map((text2) => `- ${stageLabel(unit.stage.key)}：${text2}`));
    return lines2.length ? `【${title2}】
${lines2.join(`
`)}` : "";
  }
  function restText(units, from) {
    let byVolume = /* @__PURE__ */ new Map();
    for (let unit of units.slice(from))
      byVolume.has(unit.volume) || byVolume.set(unit.volume, []), byVolume.get(unit.volume).push(unit.stage);
    return outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages })));
  }
  function outlineMessages({
    setting,
    talk,
    volumes,
    volumeNo,
    request,
    mode = "outline",
    refs = [],
    clueIndex = "",
    progress = "",
    recent = "",
    tableCatalog = ""
  }) {
    let clue = mode === "clue", known = knownVolumesText(volumes), system = clue ? `你按用户的设定写线索推进模式的剧情大纲，格式必须与样例一致。
${CLUE_OUTLINE_RULES_WITH_LINES}

【格式样例】
${CLUE_SAMPLE_STAGE}` : `你按用户的设定写剧情大纲，格式必须与样例一致。
${OUTLINE_RULES}

【格式样例】
${formatSample(volumes)}`, user = [
      setting ? `【设定】
${setting}` : "",
      talk ? `【讨论摘要】
${talk}` : "",
      clue ? refsBlock(refs) : refs.length ? `【世界书参考】
` + refsBlock(refs) : "",
      ...clue ? [] : [changesBlock(flattenUnits(volumes), "已有大纲中的状态变化")],
      known.length ? `【已有的卷】
${known.join(`
`)}` : "",
      clue && clueIndex ? `【已有节点与事实编号（新节点的 id 和事实编号不要与这些重复；可以引用其中已有的事实）】
${clueIndex}` : "",
      clue ? tableCatalog : "",
      progress,
      recent ? `【最近正文】
${recent}` : "",
      // 线索模式：请求放在一大段表格目录后面时，模型偶尔会忽略请求、接着写已有的主线（2026-11-14 DeepSeek 30 次里 2 次）。写明这一卷就是这个要求。
      clue && request ? `只写第 ${volumeNo} 卷（一条线），这一卷的内容就是下面这个要求（不要续写、重写、改动已有的卷，编号不要和已有的线重复）：
${request}` : `只写第 ${volumeNo} 卷。${request || ""}`
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function rewriteRestMessages({ setting, volumes, fromUnitIndex, units, recent, reason }) {
    let system = `剧情在执行中偏离了大纲。按已经发生的正文改写剩余阶段，保持卷名与阶段名格式。
${OUTLINE_RULES}

【格式样例】
${formatSample(volumes)}`, user = [
      setting ? `【设定】
${setting}` : "",
      changesBlock(units.slice(0, fromUnitIndex), "已演完阶段的状态变化"),
      `【需要改写的剩余阶段】
${restText(units, fromUnitIndex)}`,
      reason ? `【偏转说明】
${reason}` : "",
      `【最近正文】
${recent}`
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function syncSettingMessages({ guide, setting, units, fromUnitIndex = 0, reason = "" }) {
    let system = [
      guide,
      "剧情大纲已经调整。对照【剧情大纲】校对【已有世界观正文】：找出与大纲冲突的句子，以及把人物关系、认知、信息差、人物走向写成永远不变的句子，只改这些句子，改写成开局状态或留白；同一件事在几个分块里重复出现时，只留在最合适的一处；其余文字逐字保留，分块标题不变。",
      "原有 <仅作者> 区块必须保持仅作者属性，标签完整保留。不能把其中的真相、未来发展、作者备注写到公开分块里。",
      "只回「世界观正文」「速查」两段。世界观正文输出改好后的完整全文；没有需要改的句子时原样输出。"
    ].join(`

`), user = [
      `【已有世界观正文】
${setting}`,
      changesBlock(units.slice(0, fromUnitIndex), "已演完阶段的状态变化"),
      `【剧情大纲】
${restText(units, fromUnitIndex)}`,
      reason ? `【调整原因】
${reason}` : ""
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function fixYamlMessages(text2, error, mode = "outline") {
    return [
      {
        role: "system",
        content: `修正下面 YAML 的格式错误，内容不变。
${mode === "clue" ? CLUE_OUTLINE_RULES : OUTLINE_RULES}`
      },
      {
        role: "user",
        content: `【错误】${error}

${text2}`
      }
    ];
  }
  function extractYaml(text2, { all = !1 } = {}) {
    if (all) {
      let blocks2 = [...String(text2 || "").matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map((m) => extractYaml(m[1]));
      if (blocks2.length)
        return blocks2.join(`

`);
    }
    let raw = String(text2 || ""), fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw), blocks = [...raw.matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map((m) => m[1].replace(/^﻿/, "").trim()).filter(Boolean);
    if (blocks.length > 1)
      try {
        let keys = [];
        if (blocks.every((b) => {
          let v = parseYaml(b);
          return isPlainObject(v) && (keys.push(...Object.keys(v)), !0);
        }) && new Set(keys).size === keys.length)
          return blocks.join(`
`);
      } catch {
      }
    let body = (fenced ? fenced[1] : raw).replace(/^﻿/, "").replace(/^([ \t]*(?:- )?)[​-‍⁠﻿]+/gm, "$1").trim();
    try {
      return parseYaml(body), body;
    } catch {
    }
    return fixOffByOneKeys(fixFullWidthKeys(body));
  }
  function hasYamlBlock(text2) {
    return /```ya?ml\s*\n[\s\S]*?```/i.test(String(text2 || ""));
  }
  function parseOutlineReply(text2, idOf2, { all = !1 } = {}) {
    let yaml = extractYaml(text2, { all });
    try {
      return { ok: !0, yaml, volumes: volumesFromValue(parseYaml(yaml), idOf2) };
    } catch (error) {
      let line = yamlErrorLine(error);
      return { ok: !1, yaml, line, error: `${line ? `第 ${line} 行：` : ""}${String(error.message || error).split(`
`)[0]}` };
    }
  }
  var STAGE_OPS = {
    refine: "细化节点：保持阶段名不变，把现有节点写得更具体（事件写清谁做了什么、结果如何，偏转写清分支），必要时补充缺少的节点，不改变阶段的整体走向与时间范围。只输出这一个阶段。",
    split: "拆成两段：把这个阶段按剧情先后拆成两个阶段，阶段名沿用「阶段N_标题」格式，两段的时间范围首尾相接且不重叠，节点、支线事件、世界动态按发生时间分到两段，状态变化归入对应的段。输出两个阶段。",
    merge: "与下一段合并：把「当前阶段」和「下一阶段」合成一个阶段，阶段名取能概括两段的标题，时间范围覆盖两段，节点、支线事件、世界动态按时间顺序合并并去掉重复，状态变化全部保留。输出一个阶段。"
  };
  function stageOpMessages({ setting, talk = "", refs = [], volumes, unit, next, op, request, mode = "outline", progress = "" }) {
    let rule = STAGE_OPS[op];
    if (!rule) throw new Error("不支持的阶段操作");
    let system = [
      "你在调整剧情大纲中的单个阶段，格式必须与样例一致。",
      mode === "clue" ? CLUE_OUTLINE_RULES : OUTLINE_RULES,
      ...mode === "clue" ? [
        "保留已有节点的 id、发现里的事实编号和完成条件。已完成节点、已确认事实是已经发生的历史，不能改写或删掉。拆分阶段时，同一个节点只放在其中一个阶段。"
      ] : [],
      "阶段里的字段（时间范围、AI指令、主线节点、支线事件、世界动态、状态变化，以及其他任何键）原样保留或合理改写，不要丢键。",
      `顶层键只写所属卷名「${unit.volume.key}」，卷下只放结果阶段。`,
      rule,
      `【格式样例】
${formatSample(volumes)}`
    ].join(`
`), units = flattenUnits(volumes), before = units.slice(
      0,
      units.findIndex((item) => item.id === unit.id)
    ), user = [
      setting ? `【设定】
${setting}` : "",
      talk ? `【讨论摘要】
${talk}` : "",
      refBlock(refs),
      changesBlock(before, "此前阶段的状态变化"),
      `【当前阶段】
${volumeStageText(unit.volume, unit.stage)}`,
      next ? `【下一阶段】
${volumeStageText(unit.volume, next)}` : "",
      progress,
      request ? `【额外要求】
${request}` : ""
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  function volumeStageText(volume, stage) {
    return outlineToText([{ ...volume, stages: [stage] }]);
  }
  function outlineEditPrompt({ map, clue }) {
    return [
      "【改大纲】用户这一轮想改动大纲。先用一两句话回应、指出可能的问题（比如和已有节点冲突、放的位置不合理）；然后在回复末尾给出一个改动提案，格式严格如下：",
      "```大纲改动",
      "改动:",
      "  - 动作: 插入            # 只能是 插入 或 排序",
      "    阶段: <阶段编号>      # 照抄下面大纲地图里的阶段编号，如 s3",
      "    类别: 主线            # 主线 / 支线 / 世界动态",
      "    位置: {之前: <节点编号>}   # 或 {之后: <节点编号>}，或写「开头」「末尾」",
      "    节点:",
      clue ? `      名称: …
      入口: …
      地点: …
      场景: …
      发现: [{事实: <新编号>, 内容: …, 记录: …}]
      完成条件: {事实: <新编号>}` : `      名称: …
      地点: …
      事件: …`,
      "    理由: 一句话",
      "  - 动作: 排序",
      "    阶段: <阶段编号>",
      "    类别: 主线",
      "    顺序: [<节点编号>, <节点编号>, …]   # 必须列出这个阶段这一类的全部现有节点",
      "```",
      "规则：",
      "- 阶段、节点只用下面地图里的编号引用，不要用名称。新节点不要写 id，插件会分配。",
      "- 这一版只能在同一个阶段里插入和排序。用户要修改、删除或跨阶段移动时，说明这一版做不了、建议他在大纲页手动改，这一轮**不给提案**；不要自己换成别的插入来凑。",
      "- 你还需要用户回答问题、确认方向时，这一轮也**不给提案**，等他确认后下一轮再给。提案里只放用户已经明确要的改动。",
      clue ? "- 线索模式：新节点要有入口、发现、完成条件；事实编号不要和已有的重复；秘密写在作者备注里，用 <仅作者>…</仅作者> 包住。" : "- 秘密、幕后真相写进 <仅作者>…</仅作者>，不要直接写进事件。",
      "- 用户只是在讨论、还没决定时，不要给提案，正常讨论即可。",
      "【大纲地图】",
      map
    ].join(`
`);
  }
  var SETTING_SECRET_RULE = [
    "【保密规则，优先于上面的基准】这份设定每一轮都会交给正文模型。",
    "用户明确说过暂时不揭示的内容（幕后真相、真实身份、谁是真凶、结局安排），完整写进一段 <仅作者>…</仅作者>，放在世界观正文的最后，插件不会把它交给正文。这一段必须写，不能因为要保密就省略：作者以后写大纲还要用。",
    "<仅作者> 以外的所有分块（声明、铁则、信息差、人物、核心矛盾、说明……）都不能出现秘密里的人名和关系：不写「真相只有某某知道」「某某是经手人」这类句子。",
    "要写知情差时，写成「有人知道货的真实去向，主角和沈砚都不知道」，不点出是谁。"
  ].join(`
`), CLUE_SAMPLE_STAGE = `剧情_卷一_示例:
  阶段一_报案:
    AI指令: 节奏平缓，以日常对话为主。
    主线节点:
      - id: n01_report
        名称: 接受报案
        入口: 去杂货店看看出了什么事
        地点: 杂货店
        场景: 老板娘神色慌张，柜台后的钱箱被撬开了。
        发现:
          - 事实: F01
            内容: 钱箱的锁是从里面被撬开的。
            记录: 主角亲自查看钱箱并看出撬痕方向时，记 F01 为已核实。
        完成条件: {事实: F01}
        作者备注: <仅作者>真正的小偷是老板娘的侄子。</仅作者>
  阶段二_调查:
    AI指令: 允许玩家自由选择先查哪条线。
    # 账本是必需节点；另外证词和后门手印任有一样，本阶段才结束（证人拒绝作证时，凭手印也能继续）。
    结束条件: {任一: [{事实: F03}, {事实: F05}]}
    主线节点:
      - id: n02_ledger
        名称: 查账本
        入口: 翻一翻店里的账本
        地点: 杂货店后屋
        场景: 后屋堆着几年的账本，最近一本有被撕掉的页。
        发现:
          - 事实: F02
            内容: 被撕掉的那页记着一笔给侄子的赊账。
            记录: 主角实际读到这页内容时，记 F02 为已核实。
        完成条件: {事实: F02}
      # 下面两个节点是「对质」的两条替代途径：任走一条就能继续，所以都不是必需节点。
      - id: n03_witness
        名称: 问邻居
        入口: 去问问隔壁裁缝铺的邻居
        地点: 裁缝铺
        场景: 裁缝铺的老人耳背，但记性很好。
        必需: false
        发现:
          # F03 追踪的是「老人对主角说了这件事」这个发言本身，主角亲耳听见即可确认；说的内容是否属实是另一回事。
          - 事实: F03
            内容: 老人说案发当晚看见有个年轻人从后门出来。
            记录: 老人当面对主角讲出案发当晚看到的情况时，记 F03 为已核实（核实的是他说过这话，不是内容属实）。
        完成条件: {事实: F03}
      - id: n05_backdoor
        名称: 查后门
        入口: 去看看杂货店的后门
        地点: 杂货店后门
        场景: 后门对着一条窄巷，门闩有些松动。
        必需: false
        发现:
          - 事实: F05
            内容: 门闩上有新鲜的黑色机油手印。
            记录: 主角亲自查看门闩并看到手印时，记 F05 为已核实。
        完成条件: {事实: F05}
  阶段三_对质:
    主线节点:
      - id: n04_confront
        名称: 找侄子
        入口: 去找老板娘的侄子谈谈
        地点: 镇口修车铺
        场景: 侄子在修车铺打零工，看到主角时手里的扳手掉在了地上。
        发现:
          - 事实: F04
            内容: 他承认拿了钱。
            记录: 正文写出他亲口承认拿钱时，记 F04 为已核实；内容只写他实际说出的部分。
        完成条件: {事实: F04}
        相关事实: [F02, F03, F05]
`, CLUE_OUTLINE_RULES = [
    "只输出一个 ```yaml 代码块，不加说明。",
    "顶层键是卷名「剧情_卷X_标题」，卷下是阶段「阶段N_标题」。阶段字段：AI指令、主线节点、支线事件，可选 进入条件、结束条件。不写时间范围。",
    "线索模式按「拿到什么才能往下走」组织剧情，不按时间排事件。每个节点是一处可以调查、交谈或行动的场景，可以持续多楼，允许失败、离开、再回来。不要为走路、寒暄这类动作单独建节点。",
    "节点字段：id、名称、入口、地点、场景、发现、完成条件，可选 开放条件、提前条件、相关事实、必需、作者备注。",
    "· id：英文字母开头的稳定编号（如 n05_archive），全大纲唯一。已有节点的 id 不要改。",
    "· 名称、作者备注只给作者看；入口是节点开放后告诉正文「可以去做这件事」的一句话，不能含答案。",
    "· 地点写具体的地方（如「码头仓库值夜棚」），不写「附近」「街上」。一段剧情要用到几个地方时都列出来：地点: [码头仓库, 值夜棚]。",
    "· 场景写进入时看到的情况，不写调查结果。",
    "· 发现：列表，每项是 {事实, 内容, 记录}。事实是事实编号（如 F05）；内容是查到时可以揭示的结果；记录是给填表模型的判断标准，写清「正文出现什么才算拿到」，不要复述答案。",
    "· 一个事实编号只记一件能单独揭示的事；能分开知道的两件事拆成两个编号。",
    "· 先明确这个编号追踪哪件事。「老人确实对主角说了这句话」可以由主角亲耳听见来确认；「老人所说的事情是真的」仍需独立证据，要用另一个编号。门槛要求「取得证词」时，用追踪发言的那个编号，不要用「知情」（「知情」连主角自己的推测也算）。",
    "· 只是传闻、推测或未经证实的说法，记录里写「记为存疑」；只有可靠实物、明确验证或亲耳听到的发言本身，才记为已核实。",
    "条件写法（YAML 对象，最多两层组合）：{事实: F01}（正文里已经出现：已核实，或证词、传闻已经说出口记为存疑都算）、{核实: F01}（必须已核实，说法不算）、{知情: F01@角色}（该角色有任何知情记录，含传闻和自己的推测）、{核实: F01@角色}、{节点: n01}（节点已完成）、{全部: [...]}、{任一: [...]}。主角写作 user。",
    "· 门槛只要求「听到了这番话」「拿到了这份证词」时用 {事实}；要求「这件事被证实」时才用 {核实}。证词、传闻类的发现在填表时记为存疑，如果用 {核实} 去等它，节点永远完不成。",
    "· 完成条件必须写，并且只依赖本节点自己的发现，或正文中可以确定的知情。",
    "· 开放条件 / 进入条件依赖之前节点的发现。同一阶段的多个节点尽量互不依赖，让玩家可以自选顺序。",
    "· 关键结论最好有两条获得途径（用「任一」），避免某个角色不配合就永远卡住。替代途径上的节点写「必需: false」，各条途径产出的事实都写进下一步条件的「任一」里。能不能走通由插件按条件检查。",
    "· 只引用大纲里确实有节点产出的事实编号。",
    "真相、幕后安排等不能提前给正文的内容，写在作者备注里，用 <仅作者>…</仅作者> 包住。",
    "每个阶段 1 到 4 个主线节点。支线事件可选，写法与主线节点相同，默认不阻塞阶段。"
  ].join(`
`);
  function knownVolumesText(volumes) {
    return (volumes || []).map((volume) => `${volumeLabel(volume.key)}：${volume.stages.map((stage) => stageLabel(stage.key)).join("、")}`);
  }
  function refsBlock(refs) {
    return (refs || []).filter((ref) => ref && String(ref.text || "").trim()).map(
      (ref) => `【参考·${ref.title}】
${ref.text}`
    ).join(`

`);
  }
  function clueRewriteMessages({ setting, volumes, fromUnitIndex, units, recent, reason, progress = "", refs = [], talk = "" }) {
    let rest = units.slice(fromUnitIndex), byVolume = /* @__PURE__ */ new Map();
    for (let unit of rest) byVolume.has(unit.volume) || byVolume.set(unit.volume, []), byVolume.get(unit.volume).push(unit.stage);
    let restText2 = outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages }))), system = `剧情在执行中偏离了大纲。按已经发生的正文和线索进度，改写线索推进模式的剩余阶段，保持卷名与阶段名格式。
${CLUE_OUTLINE_RULES}
改写时另外遵守：
· 已完成节点、已确认事实是已经发生的历史，不能改写、不能删除，后面的条件可以继续引用它们。
· 尚未完成的节点保留原来的 id；内容可以调整。新增节点用新的 id。
· 和已发生剧情冲突的地方，在相关节点的作者备注里用 <仅作者> 写出「原计划 → 调整」，不要默默改掉。

【格式样例】
${CLUE_SAMPLE_STAGE}`, user = [
      setting ? `【设定】
${setting}` : "",
      talk ? `【讨论摘要】
${talk}` : "",
      refsBlock(refs),
      progress,
      `【需要改写的剩余阶段】
${restText2}`,
      reason ? `【偏转说明】
${reason}` : "",
      recent ? `【最近正文】
${recent}` : ""
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
  }
  var YAML_BLOCK_HEAD = /^ *(?:- )?[^\s#][^:：]*[:：]\s*[|>][-+0-9]*\s*$/;
  function yamlBlockLines(lines2) {
    let inBlock = /* @__PURE__ */ new Set(), head = -1, body = -1;
    return lines2.forEach((line, i) => {
      let ind = /^( *)/.exec(line)[1].length;
      if (head >= 0 && (!line.trim() || (body < 0 && ind > head && (body = ind), body >= 0 && ind >= body)))
        return inBlock.add(i);
      head = YAML_BLOCK_HEAD.test(line) ? ind : -1, body = -1;
    }), inBlock;
  }
  function fixOffByOneKeys(yaml) {
    let lines2 = yaml.split(`
`), inBlock = yamlBlockLines(lines2);
    for (let i = 1; i < lines2.length; i++) {
      if (inBlock.has(i)) continue;
      let m = /^( +)([^\s#-][^:]*):(\s.*)?$/.exec(lines2[i]);
      if (!m || m[1].length % 2 === 0) continue;
      let n = m[1].length, prev = lines2.slice(0, i).map((l, k) => inBlock.has(k) ? "" : l).reverse().find((l) => /^( *)[^\s#-][^:]*:/.test(l) && /^( *)/.exec(l)[1].length <= n + 1);
      if (!prev) continue;
      let p = /^( *)/.exec(prev)[1].length, opensMap = /:\s*$/.test(prev);
      p === n + 1 ? lines2[i] = " " + lines2[i] : p === n - 1 && !opensMap && (lines2[i] = lines2[i].slice(1));
    }
    return lines2.join(`
`);
  }
  function fixFullWidthKeys(yaml) {
    let lines2 = yaml.split(`
`), inBlock = yamlBlockLines(lines2);
    return lines2.map((line, i) => inBlock.has(i) ? line : line.replace(/^( *(?:- )?)([^\s:：#-][^\s:：]*)：(?=\s|$)/, "$1$2:")).join(`
`);
  }
  var CLUE_LINE_RULES = [
    "一卷可以是一条独立的剧情线（主线或支线）：在卷的第一个键写「线」，其余键照旧是阶段。多条线可以同时进行，各自推进。",
    "· 线的字段：编号（M1、S07 这样，全大纲唯一）、类型（主线 / 支线）、简介（公开的一句话，正文看得到，不含答案）、开启条件、开启时段（可选）、入口提示（一句话，线可以开始时给正文一个由头，不含答案）。",
    "· 线怎么开始：主线的开启条件满足就开始（同一时间只有一条主线，按顺序）；支线的开启条件满足后，正文会在空闲时提一句入口，玩家走进第一个阶段的场景才开始。所以支线第一个阶段要有一个不需要别的条件就能开始的节点，它的入口写成玩家能主动去做的事。",
    "· 开启时段：支线只在某条主线的某几个阶段里能开时写，{主线: M1, 从: 阶段2, 到: 阶段3}（阶段写短名）。过了还没开始就不再出现。不限就不写。它是线的一个单独字段「开启时段:」，和「开启条件:」并列，不要写进开启条件里。",
    "· 开启方式（可选，一般不写）：要求没法用条件写准时（表里没有能代表它的列，如「和大家一起出过任务」「单独来往过」），写「开启方式: 人工」，开启条件不写，把原来的要求写成一句话放在「原开启条件」里；玩家自己点「进入」开始。能用条件写准的不要写人工。",
    "· 开启条件用上面的条件写法，另外可以用：{线: S07 == 完成}（另一条线的状态：未触发 / 可开启 / 进行中 / 暂停 / 完成 / 放弃，或「开过」「开着」）、{表: 表名/行/列 >= 2}（读数据库表格的一格，和数据库剧情推进的写法一样）、{计数: {表: 表名, 条件: 列 >= 2, 至少: 3}}（满足条件的行数）。",
    "· 「某条线做完以后再开」写 {线: 编号 == 完成}，不要写成那条线里某个节点的条件（那条线以后可能还会加阶段）。",
    "· 开启条件保持要求的原意：表里有对应的列，用表格条件；要求本身就是正文里会发生的一件事（「收到报社的信」），写 {事实: 新编号}；两样都写不准（例：要求「声望到 50」，表里没有声望），不要换成别的门槛（别的列、自己想的一件事），按上面写「开启方式: 人工」并保留原要求。",
    "· 读表格的条件：表名、列名必须是【当前数据库的表格】里列出的；要读的那个人暂时没有行可以照写（有了行才开始判断），但不能拿别人的行代替。",
    "· 开启条件里的事实可以不由任何节点产出：插件会把它作为一条线索加进表格，正文里发生了就由填表记下。但不能由这条线自己的节点产出（线没开始，它的节点都打不开，会互相等）。"
  ], CLUE_OUTLINE_RULES_WITH_LINES = `${CLUE_OUTLINE_RULES}
${CLUE_LINE_RULES.join(`
`)}
· 上面说的「只引用有节点产出的事实编号」，线的开启条件例外：它里面的事实可以不需要节点产出。
· 【当前数据库的表格】里已经有某个地方时（地点表、全局表的当前地点、角色表的所在地点），节点的地点用表里已有的叫法。`, CATALOG_NOTE_HINT = /只能|格式|阶段|档|等级|顺序|分隔|→|升|降|之一|[^\s/]\s*\/\s*[^\s/]/, CLUE_OWN_SHEETS = ["线索控制表", "关键事实表", "知情表"];
  function catalogNote(note, head, cap = 900) {
    let text2 = String(note || "").replace(new RegExp(`${CLUE_TPL_MARK_BEGIN}[\\s\\S]*?${CLUE_TPL_MARK_END}`, "g"), ""), out = [], used = 0;
    for (let line of text2.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (/^[×✗❌]/.test(line) || !(head.some((h) => h.length > 1 && line.includes(h)) || CATALOG_NOTE_HINT.test(line) || /^\d+\s*\S/.test(line)))
        continue;
      let l = line.length > 160 ? `${line.slice(0, 160)}…` : line;
      if (used + l.length > cap) {
        out.push("……");
        break;
      }
      out.push(l), used += l.length;
    }
    return out;
  }
  function tableCatalogText(tables) {
    let list = sheetList(tables || {}).map((s) => {
      let all = /地点/.test(s.name), limit = all ? 200 : 8, head = (Array.isArray(s.content[0]) ? s.content[0] : []).slice(1).map((c) => String(c ?? "").trim()).filter(Boolean), data = sheetRows(s), rows2 = data.rows.map((r) => String(r[1] ?? "").trim()).filter(Boolean).slice(0, limit), line = `- ${s.name}：列 ${head.join("、") || "（无）"}${rows2.length ? `；现有行 ${rows2.join("、")}${data.rows.length > limit ? "……" : ""}` : ""}`;
      if (all || CLUE_OWN_SHEETS.includes(s.name)) return line;
      let samples = head.map((h) => {
        let c = data.col(h), vals = c < 0 ? [] : [...new Set(data.rows.map((r) => String(r[c] ?? "").trim()).filter(Boolean))].slice(0, 2);
        return vals.length ? `  · ${h}：${vals.map((v) => `「${v.length > 40 ? `${v.slice(0, 40)}…` : v}」`).join(" ")}` : "";
      }).filter(Boolean), note = catalogNote(s.note, head);
      return [
        line,
        ...samples.length ? ["  现有的值：", ...samples] : [],
        ...note.length ? ["  表格说明（摘录）：", ...note.map((x) => `    ${x}`)] : []
      ].join(`
`);
    });
    return list.length ? `【当前数据库的表格（读表格的条件只能用这些表名、列名和现有的行）】
${list.join(`
`)}
写 {表: …} 或 {计数: …} 之前先核对：要求里说的那个数值（关系、声望、金钱……），上面的表里真的有这一列吗？没有就不要用表格条件，也不要拿意思不同的列（比如用关系阶段代替声望）凑数，也不要自己换成等某件事——写「开启方式: 人工」，原要求放进「原开启条件」。
这个人暂时没有行时，可以照同一列别的行的写法写（有了行才开始判断）；不能拿别人的行代替。
文字列照表格说明里规定的词写（说明里写了「只能填 …」就只用那几个词），不要自己造词。
一格里写了好几个人（如「主角:认识;艾莉丝:室友」）时，必须加「取: 名字」只读那个人的那一项，并给一个样例，例：{表: 重要角色表/巴基/人际关系 包含 朋友, 取: 彼得, 样例: {原文: 主角:认识;艾莉丝:室友, 取: 艾莉丝, 得: 室友}}。不要写成「包含 彼得:朋友」（那样「彼得:队友,朋友」就对不上）。样例原文必须从上面「现有的值」或表格说明里照抄一格，不能自己编；「得」写这个人冒号后面的全部内容。原文和得都用英文双引号括起来（里面有逗号）。
要比「到某一档以上」时写：{表: 表/行/列 >= 友好, 档位: [敌视, 陌生, 友好, 亲密, 相恋]}，档位一律从低到高写全（说明里是从高到低列的，要反过来）。说明里没写先后时也这样写，按常理从低到高排：插件会请玩家确认一次顺序。不要因为没写先后就改成 == 某一档，也不要换成等别的事。
说明里规定的格式是「数字 + 阶段名」（如「2 熟悉」）时，也用档位写法，档位写阶段名。
要数好几个人时：表里有能数的列，就用 {计数: …}，例：「至少三个人关系到 2 以上」、关系表有「阶段」列 → {计数: {表: 关系表, 条件: 阶段 >= 2, 至少: 3}}，这种不要写成人工。表里没有能代表它的列（如「和几个人单独来往过」，表里没有记单独来往的列），不要硬凑，开启条件不写，写「开启方式: 人工」，把原来的要求写进「原开启条件」（一句话）。` : "";
  }

  // src/core/guide.js
  var FANFIC_GUIDE = `# 同人世界观速成

## 用途

用户给出原作、角色、类型、基调中的任意几项，产出一段世界观正文。插件会在开玩后每一轮把它交给正文模型。要复制到酒馆世界书时，只复制公开部分，删去整段 <仅作者>…</仅作者>（世界书不会去掉它）。

## 语言基准（最高优先级）

- 使用客观、清楚的现代书面语，直白易懂；去掉明显北方方言腔（儿、咱、甭、咋、得嘞等）和旧小说、话本的腔调（只见、却说、看官、端的、怎生等）。
- 直接写事实、规则和结果：不把一步动作拆成慢镜头，不堆眉梢、嘴角、指尖这类身体零件，不写“不是X而是Y”式澄清，不把情绪和话拟物化。
- 正文只写这个世界的既有事实与行动边界。不写“由AI把握、关系自然生成”这类生成器指令，不写“见XX条目”式交叉引用，不写作者说明。
- 人称按设定定：性转、身份错位或性别认知有出入的题材，核心角色第一人称与旁白用“他”，其他角色口中与认知中用“她”；其余题材按用户指定。用户另有要求时一律按用户。

## 适用

只产出正文，不产出条目字段、条目标题、uid、触发方式或打包信息。

输入可以只有一句话，也可以是完整设定。默认交付一段完整的世界观正文；人物、地点、机制需要单独成篇时，另出一段独立正文，不在同一段里堆索引。

不写小说正文、不写场面描写、不写角色对白，不替用户写人设。

## 输入

从用户原话里取这几项，缺的按“补定”处理：

- 原作与角色：基于哪部作品、哪几个人物、谁是核心。
- 类型与基调：斜杠或顿号连写，如“现代都市AU / 性转 / 因果报应 / 荒诞喜剧”。
- 时代与舞台：现代、古代、架空；故事主要发生在哪。
- 特殊机制：这个AU自带的设定，如第二性别系统、种族、行业分层、契约或规则。
- 尺度：是否涉及成人内容，允许写到什么程度。
- 篇幅：只要声明加铁则，还是要人物档案、场景库与钩子库。

## 执行步骤

1. 定声明。一句话交代基于什么作品与人物、什么类型、什么时代、什么基调，缺项按“补定”填。
2. 定铁则。写这个AU不可违背的几条：总受或总攻、知情圈、欠债或因果归属、性格是否锁死、NSFW尺度、人称。每条一句，能约束角色行为，不解释理由。
3. 定机制。每个特殊机制写四件事：是什么、作用对象、触发或运行条件、代价与后果。沿用到能直接推进剧情就停，不发明第二套系统。
4. 定信息差。写清谁知道真相、谁不知道、各方各自不知道什么。暂时不能揭示的真相本身，写进正文末尾的 <仅作者>…</仅作者>；信息差只写「谁知道这件事、谁不知道」，不写出真相的内容。
5. 定人物处境。写身份、社会位置、开局状态、与核心角色的旧账。性格默认不写死。
6. 定场景与钩子。场景写地点、用途与限制；钩子只写可观察信号与开放倾向，标明是可用素材。
7. 定边界。写核心角色不会出现的状态与不许写成的内容；只写会改变写作走向的几条。
8. 组装正文，过一遍出稿速查。

## 正文骨架

默认按下面顺序写；篇幅小时可只保留声明、铁则、机制、说明。全篇只写已发生的事实与现状，不写日后必然走向，长线悬念写成留白。

\`\`\`
世界观声明:
基于: [原作与角色]
类型: [类型与基调]
时代: [时代与舞台]
基调: [关键词，顿号连写]

铁则:
- [最硬的一条，如谁总受]
- [知情圈范围]
- [欠债或因果归属]
- [性格是否锁死]
- [NSFW尺度]
- [人称规则]

[机制名]设定:
- [机制是什么]
- [作用对象]
- [触发或运行条件]
- [代价与后果]

人物档案:
[角色名]——[身份与在权力或关系网中的位置]
- [开局状态]
- [与核心角色的旧账]
- [行为边界]

信息差结构:
- [谁知道真相]
- [谁不知道]
- [各方各自不知道什么]

核心矛盾:
- [身体或处境矛盾]
- [心理矛盾]

场景库:
- [地点或场景：定位、在这里能发生什么、有什么限制]

钩子库:
- [可用素材，不是必须发生的事。只写可观察信号与开放倾向]

NSFW指引（涉及成人内容时）:
- 基调：[写到什么程度]
- 可用方向：[哪几类场景]
- 不允许的内容：[明确不写的几项]

不会出现的状态:
- [核心角色明确不会做的事，如不会主动示弱、不会突然接受现状]

说明:
- [未发生当作大纲，已发生当作起点与既定事实]
- [留白与长线悬念]
\`\`\`

用户要单独成篇时，按同样写法另起一段正文。

- 信息差条目多时用表格：表头列角色，单元格写各自知道与不知道什么，行写事实项。
- 需要模型少回放的旧事，在该段后加一句中性的说明，如\`（已经过去，正文不必反复提起）\`。不写「AI禁止……」这类命令：设定会原样交给正文模型，命令式的提醒反而让它反复想起这件事。
- 暂时不能揭示的真相（幕后真相、真实身份、结局安排）写进正文末尾的一段 <仅作者>…</仅作者>，插件不会把它交给正文模型，作者以后写大纲还要用。
- 硬约束前可加\`⚠️\`，只标真正会让写作跑偏的几条。
- 后补设定用一段\`[追加]\`收尾，只写新增事实，不改动前面已写内容。

## 出稿速查

- [ ] 全部内容只服务于“这个世界是什么、怎么运转、人物处在什么位置”，没有条目化表述。
- [ ] 声明与铁则必写；机制、信息差、人物处境、场景库、钩子库按题材补齐，不写无关分块。
- [ ] 铁则每条只约束一件事，不解释理由，不写“因为/所以”。
- [ ] 机制写清是什么、作用对象、触发条件、代价与后果。
- [ ] 信息差单独成段，写清谁知道、谁不知道、各方各自不知道什么；暂时不能揭示的真相写在 <仅作者> 里，其他分块没有写出它。
- [ ] 场景库写清地点与用途；钩子库标明是可用素材，不写成必将发生的事件。
- [ ] 只写已发生事实与现状，没有必然走向；长线悬念写成留白。
- [ ] 性格默认未锁死；用户未指定的关系结论未被坐实。
- [ ] 人称符合设定：涉及性转或身份错位时，核心角色用“他”，其他角色口中与认知中用“她”；其余题材按用户指定。
- [ ] 没有堆砌身体零件、动作慢镜头、抽象拟物、方言腔和旧小说腔。
- [ ] 核心角色不会出现的状态已写明，只写会改变写作走向的几条。

## 输出

只回三段，不加额外说明：

1. 世界观正文：纯文本，按正文骨架的分块与标题写，每个分块标题单独一行、以冒号结尾。
2. 补定：一行一条，列出替用户补齐的项，方便他改；没有补定时省略。
3. 速查：单独一行 \`速查：PASS / FAIL。\``, GENERIC_GUIDE = `# 写作基准（通用）

## 你在帮用户做什么

用户在用剧情注入器为一张角色卡准备剧情。东西分三处放：
- 设定：这个世界现在是什么样、人物处在什么位置、什么规则不能破。开玩后每一轮都作为常驻资料交给正文模型。卡本身有世界书时，设定可以是空的。
- 大纲：剧情按阶段怎么走。开玩后只注入当前阶段的内容。
- 线索模式下，主角查到了什么、谁知道了什么，记在数据库的表格里，由插件按条件开放下一步。
所以设定只写现状和规则；会随剧情变化的东西（接下来发生什么、谁什么时候知道真相）交给大纲和表格。整理出来的设定是纯文本。要复制到酒馆世界书时，只复制公开部分，删去整段 <仅作者>…</仅作者>（世界书不会去掉它）。

## 语言（最高优先级）

- 用客观、清楚的现代书面语，像说明文那样写：直接写事实、规则和结果。
- 不用口语腔：不用「咱、俺、甭、咋、啥、得嘞、可不是嘛」，不加儿化音，不用「呢、呀、嘛、哩」这类语气词收尾。
- 不用古白话腔：不用「只见、却说、看官、端的、怎生、恁地、那厢」这类旧小说、话本的套语，不模仿章回体。古代背景也写成现代书面语，只在专名和器物上用当时的叫法（官职、地名、衣物等）。
- 不写慢镜头，不堆眉梢、嘴角、指尖这类身体细节，不写「不是 X 而是 Y」式的澄清，不给情绪打比方。
- 不写给 AI 的指令（「由 AI 把握」「关系自然发展」），不写「见某某条目」的交叉引用，不写作者说明。
- 人称、称呼按用户要求。题材涉及性转、身份错位时，写明旁白和各个角色分别怎么称呼核心角色。

## 讨论时怎么配合

- 先回应用户的想法，再指出缺口或前后矛盾，最后给两三个可选方向，标明各自会带来什么。不替用户拍板，不写小说正文。
- 只把用户已经确认的内容当作定论；还在商量的，说清楚是建议。
- 谈到剧情时，按大纲能直接用的样子说：分几个阶段，每个阶段主角要做成哪几件事、在什么地方。
- 用线索推进时，再说清三件事：主角靠什么行动拿到什么信息；哪些信息只是某人的说法、哪些是实物或亲眼所见；拿到之后能去哪里、有没有别的路可以绕过去。
- 用户提到的秘密、幕后真相，讨论时可以直说，同时提醒它在大纲里要放进 <仅作者>。
- 和用户说话用平常的说法，不用插件内部的叫法（不说「事实表」「知情表」「节点」「阶段键」），说「主角查到了什么」「谁知道这件事」「这一步」。
- 讨论页打开「改大纲」时，插件会附上改动提案的格式和规则，照那份规则给提案；没打开时只讨论，不输出大纲格式。
- 参考资料（设定、大纲、正文、世界书、剧情进度）里已经写明的内容，以参考资料为准；和用户这一轮说的冲突时，指出来问用户。
- 用户要你整理成设定时，按下面「输出」的格式写；平时讨论用正常对话。

## 秘密分两层

- **作者知道、角色和正文都不该知道的**（幕后真相、真实身份、结局安排）：用 <仅作者>…</仅作者> 包住。插件不会把它交给正文模型，但讨论和写大纲时你能看到。
- **一部分角色知道、另一部分不知道的**：写进「信息差」。这是正文要演出来的，正文模型需要知道谁知道什么。
- 主角不知道的事，不要写成「主角隐约感到……」去暗示。
- 秘密本身只能出现在 <仅作者> 里。信息差、铁则、人物里写到「某人不知道这件事」时，只写他不知道什么方面（「不知道货的真正去向」），不把秘密的内容写出来（不写「不知道是某某偷的」）。
- 用户讲过的秘密不能丢：整理设定时，把它完整写进一段 <仅作者>…</仅作者>（放在设定末尾即可），作者以后写大纲还要用。

## 输入

从用户的话里取这几项；缺的按「补定」处理，用户另有说法就以用户为准：

- 题材来源：原创，还是基于某部作品（哪部、哪几个人物、谁是核心）。
- 类型与基调：如「民国 / 悬疑 / 慢节奏」「现代 / 日常 / 轻喜剧」。
- 时代与舞台：故事主要发生在哪。
- 主角：通常是 {{user}}，写清楚主角在这个世界里的身份和处境；用户没说的不替他设定性格。
- 特殊规则：这个世界独有的机制（超能力、契约、行业规矩、第二性别、跑团规则等）。
- 尺度：是否涉及成人内容，写到什么程度。
- 篇幅：只要几条要点，还是要人物、地点、机制都展开。

## 设定的分块

只有「声明」必写，其他分块按题材需要取用；小设定写三四块就够，不要为了齐全硬写。每块一个标题，单独一行，以冒号结尾。

\`\`\`
声明:
题材: [原创 / 基于某作品的哪几个人物]
类型: [类型与基调]
舞台: [时代与地点]
主角: [{{user}} 在这个世界里的身份和处境]

铁则:
- [这个世界不能破的规则，每条一句，只约束一件事，不解释理由]

[机制名]:
- 是什么、作用在谁身上、怎么触发、代价是什么。写到能推动剧情为止，不另造第二套体系。

人物:
[名字]：[身份，在关系网里的位置]
- 现在的处境
- 和主角的关系、旧账
- 处事方式和底线（会怎么做、绝不会做什么；不写「他其实很温柔」这类结论）

信息差:
- 每个关键角色知道什么、不知道什么、误会了什么。条目多时用表格：行是事实，列是角色。

地点:
- [地点]：在这里能做什么、有什么限制、谁常在这里。

可用素材:
- 可以随时用进正文的小事、传闻、可观察的迹象。标明是素材，不是必然发生的事。

尺度（涉及成人内容时）:
- 写到什么程度、可以写哪几类、明确不写的内容。

少提的旧事:
- 已经过去、正文不必反复回忆的事，一句话写清是什么，并注明「已经过去，正文不必反复提起」。

[追加]
- 后补的设定写在这里，只写新增事实，不改前面的内容。
\`\`\`

- 全篇只写已经发生的事和现在的状态，不写「将来一定会」。长线悬念写成留白，或者放进 <仅作者>。
- 核心角色明显不会做的事（比如「不会主动示弱」），写在「人物」里他的「处事方式和底线」下面，不另开分块。
- 只有真正会让写作跑偏的硬约束，才在句首加「⚠」。

## 出稿速查

- [ ] 写的都是「这个世界现在是什么样」，没有剧情走向、没有给 AI 的指令。
- [ ] 声明写了；其他分块只写了题材需要的。
- [ ] 铁则每条只约束一件事，不解释理由。
- [ ] 机制写清了是什么、对谁、怎么触发、代价。
- [ ] 用户讲过的秘密都写进了 <仅作者>，一条没丢；信息差、铁则、人物里没有写出秘密的内容；角色之间的知情差写进了信息差。
- [ ] 人物写的是处境和处事方式，没有替用户定下的性格结论和关系结论。
- [ ] 现代书面语，没有口语腔、古白话腔，没有堆身体细节、慢镜头和比喻。

## 输出

整理设定时只回三段，不加别的说明：

1. 世界观正文：纯文本，按上面的分块和标题写，可以直接作为设定使用。
2. 补定：一行一条，列出你替用户补上的内容，方便他改；没有补定就省略这一段。
3. 速查：单独一行，写「速查：PASS」或「速查：FAIL」。

讨论时不用这个格式，正常对话即可。`, GUIDE_PRESETS = [
    {
      value: "generic",
      label: "通用",
      title: "写作基准（通用）",
      text: GENERIC_GUIDE,
      opener: "你在帮用户构思一个故事的设定和剧情：一起把世界观、人物处境、信息差和大纲方向想清楚。"
    },
    {
      value: "fanfic",
      label: "同人世界观速成",
      title: "写作基准：同人世界观速成",
      text: FANFIC_GUIDE,
      opener: "你在帮用户构思一条同人 if 线：一起把世界观、人物处境、信息差和大纲方向想清楚。"
    },
    {
      value: "custom",
      label: "自定义",
      title: "写作基准（自定义）",
      text: "",
      opener: "你在帮用户构思一个故事的设定和剧情：一起把世界观、人物处境、信息差和大纲方向想清楚。"
    }
  ];
  function resolveGuide(settings) {
    let s = settings || {}, key = GUIDE_PRESETS.some((x) => x.value === s.guidePreset) ? s.guidePreset : "generic", p = GUIDE_PRESETS.find((x) => x.value === key), custom = String(s.guide || "").trim();
    return key === "custom" && !custom && (p = GUIDE_PRESETS[0]), { preset: p.value, title: p.title, text: key === "custom" && custom ? custom : p.text, opener: p.opener };
  }
  var BUILTIN_GUIDE = GENERIC_GUIDE;

  // src/core/infinite-state.js
  var POLLUTION_LINE = /^[ \t　]*污染[^\n]*$/gm, NEGATION = /(?:未|没|不|尚未|还没|还未)$/;
  function escapeRegExp(text2) {
    return String(text2).replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  }
  function patterns(hub) {
    let tag = escapeRegExp(hub.blockTag), fields = hub.fieldNames.map(escapeRegExp).join("|");
    return {
      open: new RegExp(`[<＜]\\s*${tag}[^>＞]*[>＞]`, "g"),
      close: new RegExp(`[<＜]\\s*\\/\\s*${tag}\\s*[>＞]`),
      line: new RegExp(`^[ \\t　]*(?:${fields})[^:：\\n]{0,6}[:：](.*)$`, "m")
    };
  }
  function hasWord(value, word) {
    let at = value.indexOf(word);
    for (; at >= 0; ) {
      if (!NEGATION.test(value.slice(Math.max(0, at - 2), at))) return !0;
      at = value.indexOf(word, at + 1);
    }
    return !1;
  }
  function classifyTrainValue(value, config) {
    let hub = resolveHub(config), text2 = String(value || ""), hits = [];
    for (let key of ["back", "depart", "away", "hub"]) {
      let hit = !1;
      for (let word of hub.words[key])
        hasWord(text2, word) && (hit = !0), text2 = text2.split(word).join("　");
      hit && hits.push(hub.words[key][0]);
    }
    return hits.length && hits.length < 3 ? hits[0] : "";
  }
  function parseTrainState(text2, config) {
    let hub = resolveHub(config), re = patterns(hub), src = String(text2 || ""), opens = [...src.matchAll(re.open)];
    if (!opens.length) return "";
    let last = opens[opens.length - 1], body = src.slice(last.index + last[0].length), close = re.close.exec(body);
    close && (body = body.slice(0, close.index));
    let line = re.line.exec(body);
    return classifyTrainValue(line ? line[1] : body.replace(POLLUTION_LINE, ""), config);
  }
  function enterStates(config) {
    let names2 = hubWordNames(config);
    return [names2.depart, names2.away];
  }
  function leaveStates(config) {
    let names2 = hubWordNames(config);
    return [names2.back, names2.hub];
  }
  function hashText(text2) {
    let h = 2166136261, s = String(text2 || "");
    for (let i = 0; i < s.length; i += 1)
      h ^= s.charCodeAt(i), h = Math.imul(h, 16777619) >>> 0;
    return h.toString(16).padStart(8, "0");
  }
  function decideTrigger(phase, state, config) {
    return phase === "train" && enterStates(config).includes(state) ? "enter" : phase === "world" && leaveStates(config).includes(state) ? "leave" : "";
  }
  function makeTrigger({ kind, floor, text: text2, worldId = "" }) {
    return { kind, floor: Number(floor), hash: hashText(text2), worldId: String(worldId || "") };
  }
  function judgeTrigger(trigger, text2, config) {
    return trigger ? text2 == null || !(trigger.kind === "enter" ? enterStates(config) : leaveStates(config)).includes(parseTrainState(text2, config)) ? "undo" : hashText(text2) === trigger.hash ? "same" : "keep" : "none";
  }
  function describeRead(read, config) {
    return read && read.state ? `上次读到：第 ${read.floor} 楼 ${resolveHub(config).hubName}：${read.state}` : "最新一楼没有状态块";
  }

  // src/core/infinite-world.js
  var DEFAULT_WORLD_SPEC = [
    "你是无限流恐怖故事的世界设计师。主空间把门开向某个世界，你要为这一站写一份世界档案。",
    "整份档案会完整注入正文，之后整个副本期间原样不动，由正文 AI 照着主持。",
    "骰子结果已经由脚本掷定，不可更改，档案必须以它们为准。",
    "原则：少写禁令，多写因果；违反因果不判死，只让事态变坏；线索写成实物并钉在具体地点上，到了才呈现。",
    "按下面的小节依次写，每节用小标题：",
    "外观：这个世界看起来、听起来、闻起来是什么样。",
    "委托：委托人是谁，要送的餐是什么。",
    "卡住的事：这个世界里一直解决不了的事。",
    "因果：这个世界的运转方式，一两条固定因果。",
    "线索：地点→实物→能证明什么，每条一行。",
    "离开这个世界的出口：样子、位置、出现条件、消失时机。",
    "周期证据：能推出重置周期的证据。",
    "居民认知：居民知道什么、不知道什么。",
    "真相：事件的来龙去脉。"
  ].join(`
`), WORLD_FORMAT = [
    "严格按下面的格式输出，两段标题各占一行，不要加其他说明：",
    "【标题】世界名（不超过十个字）",
    "【档案】",
    "（档案正文，按上面的小节依次写）"
  ].join(`
`);
  function worldSpecText(infinite) {
    return String(infinite && infinite.spec || "").trim() || DEFAULT_WORLD_SPEC;
  }
  function diceLines(dice) {
    return [
      `恐怖类型：${dice.horror}`,
      `重置周期：${dice.cycle}`,
      `委托人身份：${dice.client}`,
      `情欲浓度：${dice.lust}（系统会把这一项附在档案末尾，档案正文里不用重复写；为「无」时不要安排情色内容）`
    ];
  }
  function horrorTitle(prefix, horror) {
    return `${String(prefix || "")}${horror}`;
  }
  function buildWorldMessages({ spec, dice, setting = "", titles = [], hint = "", horrorGuide = "" }) {
    let system = `${spec}

${WORLD_FORMAT}`, user = [
      "【骰子结果（不可更改）】",
      ...diceLines(dice),
      titles.length ? `【已有世界（不要重复）】${titles.join("、")}` : "",
      setting ? `【主空间常驻规则】
${setting}` : "",
      horrorGuide ? `【本世界恐怖类型写法】
${horrorGuide}` : "",
      hint ? `【上次输出的问题】${hint}
请按格式重写。` : ""
    ].filter(Boolean).join(`
`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  var MARK = /^[\s#*>\-]*[【\[]\s*(标题|档案)\s*[】\]][:：]?\s*(.*)$/;
  function parseWorldReply(text2) {
    let parts = { 标题: [], 档案: [] }, key = "";
    for (let line of String(text2 || "").replace(/\r/g, "").split(`
`)) {
      let hit = MARK.exec(line);
      hit ? (key = hit[1], hit[2].trim() && parts[key].push(hit[2].trim())) : key && parts[key].push(line);
    }
    let body = parts.档案.join(`
`).trim();
    if (!body) throw new Error("缺少【档案】部分");
    return { title: parts.标题.join(" ").trim().slice(0, 30) || "无名之站", body };
  }

  // src/host/worldbook.js
  function boundBookNames() {
    let c = ctx(), names2 = [], add = (name, source) => {
      let value = typeof name == "string" ? name.trim() : "";
      value && !names2.some((item) => item.name === value) && names2.push({ name: value, source });
    };
    if (!c) return names2;
    add(c.chatMetadata && c.chatMetadata.world_info, "聊天");
    let card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    add(card && card.data && card.data.extensions && card.data.extensions.world, "角色");
    try {
      let h = helper(), bound = h && typeof h.getCharWorldbookNames == "function" ? h.getCharWorldbookNames("current") : null;
      bound && (add(bound.primary, "角色"), (Array.isArray(bound.additional) ? bound.additional : []).forEach((name) => add(name, "附加")));
    } catch {
    }
    return names2;
  }
  function globalBookNames() {
    try {
      let h = helper(), list = h && typeof h.getGlobalWorldbookNames == "function" ? h.getGlobalWorldbookNames() : null;
      if (Array.isArray(list)) return list.filter((name) => typeof name == "string" && name.trim());
    } catch {
    }
    let select = hostDocument().querySelector("#world_info");
    return select ? [...select.selectedOptions].map((option) => option.textContent.trim()).filter(Boolean) : [];
  }
  function worldInfoMatchSettings() {
    let pick = (src) => src && typeof src.world_info_case_sensitive == "boolean" && typeof src.world_info_match_whole_words == "boolean" ? { caseSensitive: src.world_info_case_sensitive, matchWholeWords: src.world_info_match_whole_words, known: !0 } : null;
    try {
      let c = ctx(), found = c && typeof c.getWorldInfoSettings == "function" ? pick(c.getWorldInfoSettings()) : null;
      if (found) return found;
    } catch {
    }
    try {
      let found = pick(hostWindow());
      if (found) return found;
    } catch {
    }
    let doc = hostDocument(), box = (id) => doc && doc.querySelector(`#${id}`), caseBox = box("world_info_case_sensitive"), wholeBox = box("world_info_match_whole_words");
    return caseBox && wholeBox ? { caseSensitive: !!caseBox.checked, matchWholeWords: !!wholeBox.checked, known: !0 } : { caseSensitive: !1, matchWholeWords: !1, known: !1 };
  }
  function worldInfoScanDepth() {
    let valid = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && value !== "" && value !== null ? Math.round(Number(value)) : null;
    try {
      let c = ctx(), found2 = c && typeof c.getWorldInfoSettings == "function" ? valid(c.getWorldInfoSettings().world_info_depth) : null;
      if (found2 !== null) return found2;
    } catch {
    }
    try {
      let found2 = valid(hostWindow().world_info_depth);
      if (found2 !== null) return found2;
    } catch {
    }
    let box = hostDocument().querySelector("#world_info_depth"), found = box ? valid(box.value) : null;
    return found !== null ? found : 2;
  }
  function allBookNames() {
    let c = ctx();
    return c && typeof c.getWorldInfoNames == "function" ? c.getWorldInfoNames() : [];
  }
  async function loadBook(name) {
    let c = ctx();
    if (!c || typeof c.loadWorldInfo != "function") throw new Error("当前酒馆不支持读取世界书");
    let data = await c.loadWorldInfo(name);
    if (!data || !data.entries) throw new Error(`世界书「${name}」读取失败`);
    return data;
  }
  function bookEntries(data) {
    return Object.entries(data.entries).map(([key, entry]) => ({
      uid: String(entry.uid ?? key),
      key,
      title: String(entry.comment || "").trim() || [].concat(entry.key || []).slice(0, 3).join("、") || `条目 ${entry.uid ?? key}`,
      comment: String(entry.comment || ""),
      content: String(entry.content || ""),
      disabled: !!entry.disable,
      constant: !!entry.constant,
      keys: [].concat(entry.key || []).map(String),
      keysSecondary: [].concat(entry.keysecondary || []).map(String),
      position: Number(entry.position) || 0,
      depth: Number(entry.depth ?? 4),
      role: Number(entry.role) || 0,
      order: Number(entry.order ?? 100),
      selective: entry.selective !== !1,
      selectiveLogic: Number(entry.selectiveLogic) || 0,
      caseSensitive: typeof entry.caseSensitive == "boolean" ? entry.caseSensitive : null,
      matchWholeWords: typeof entry.matchWholeWords == "boolean" ? entry.matchWholeWords : null,
      // 酒馆里 probability 为 null 或缺省时按 100；useProbability 关闭时概率不生效，显示为 100。
      useProbability: entry.useProbability !== !1,
      probability: entry.useProbability === !1 || entry.probability === null || entry.probability === void 0 || entry.probability === "" || !Number.isFinite(Number(entry.probability)) ? 100 : Math.min(100, Math.max(0, Number(entry.probability))),
      excludeRecursion: !!entry.excludeRecursion,
      preventRecursion: !!entry.preventRecursion,
      group: String(entry.group || ""),
      groupWeight: Number(entry.groupWeight ?? 100),
      sticky: Number(entry.sticky) || 0,
      cooldown: Number(entry.cooldown) || 0,
      delay: Number(entry.delay) || 0
    }));
  }
  async function saveBook(name, data) {
    let c = ctx();
    if (!c || typeof c.saveWorldInfo != "function") throw new Error("当前酒馆不支持保存世界书");
    await c.saveWorldInfo(name, data, !0), typeof c.reloadWorldInfoEditor == "function" && c.reloadWorldInfoEditor(name);
  }
  var queues = /* @__PURE__ */ new Map();
  function queued(name, job) {
    let run = (queues.get(name) || Promise.resolve()).catch(() => {
    }).then(job);
    return queues.set(name, run), run;
  }
  var clone = (value) => hostWindow().structuredClone ? hostWindow().structuredClone(value) : JSON.parse(JSON.stringify(value));
  function setEntriesDisabled(name, keys, disabled) {
    return queued(name, async () => {
      let data = clone(await loadBook(name));
      for (let key of keys) data.entries[key] && (data.entries[key].disable = disabled);
      await saveBook(name, data);
    });
  }
  var ENTRY_FIELDS = ["comment", "constant", "key", "keysecondary", "position", "depth", "role", "order", "content", "probability", "useProbability", "excludeRecursion", "preventRecursion", "group", "groupWeight", "sticky", "cooldown", "delay"];
  function updateEntry(name, key, patch) {
    return queued(name, async () => {
      let data = clone(await loadBook(name)), entry = data.entries[key];
      if (!entry) throw new Error("条目已不存在");
      for (let field2 of ENTRY_FIELDS) Object.prototype.hasOwnProperty.call(patch, field2) && (entry[field2] = patch[field2]);
      Object.prototype.hasOwnProperty.call(patch, "keysecondary") && (entry.selective = patch.keysecondary.length > 0), await saveBook(name, data);
    });
  }
  function patchEntries(name, patches) {
    return queued(name, async () => {
      let data = clone(await loadBook(name)), backup = { entries: {} };
      for (let { key, patch } of patches) {
        let entry = data.entries[key];
        if (entry) {
          backup.entries[key] = clone(entry);
          for (let field2 of ENTRY_FIELDS) Object.prototype.hasOwnProperty.call(patch, field2) && (entry[field2] = patch[field2]);
          Object.prototype.hasOwnProperty.call(patch, "keysecondary") && (entry.selective = patch.keysecondary.length > 0);
        }
      }
      return await saveBook(name, data), backup;
    });
  }
  function snapshotEntries(name) {
    return queued(name, async () => clone((await loadBook(name)).entries));
  }
  function restoreEntries(name, entries) {
    return queued(name, async () => {
      let data = clone(await loadBook(name));
      data.entries = clone(entries), await saveBook(name, data);
    });
  }
  async function transferEntries(from, to, keys, { move = !1 } = {}) {
    if (!to || to === from) throw new Error("目标世界书不能和当前世界书相同");
    let source = await queued(from, () => loadBook(from)), exists = allBookNames().includes(to), copied = 0;
    await queued(to, async () => {
      let data = exists ? clone(await loadBook(to)) : { entries: {} }, uid = Object.values(data.entries).reduce((max, entry) => Math.max(max, Number(entry.uid) || 0), -1);
      for (let key of keys) {
        let entry = source.entries[key];
        entry && (uid += 1, data.entries[uid] = { ...clone(entry), uid, displayIndex: uid }, copied += 1);
      }
      await saveBook(to, data);
    });
    let c = ctx();
    return !exists && c && typeof c.updateWorldInfoList == "function" && await c.updateWorldInfoList(), move && copied && await deleteEntries(from, keys), { copied, created: !exists };
  }
  function deleteEntries(name, keys) {
    return queued(name, () => deleteNow(name, keys));
  }
  async function deleteNow(name, keys) {
    let source = await loadBook(name), backup = { entries: {} }, data = clone(source);
    for (let key of keys)
      data.entries[key] && (backup.entries[key] = data.entries[key], delete data.entries[key]);
    return await saveBook(name, data), backup;
  }
  async function deleteBook(name) {
    let res = await hostWindow().fetch("/api/worldinfo/delete", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(`删除世界书失败（HTTP ${res.status}）`);
    let c = ctx();
    c && typeof c.updateWorldInfoList == "function" && await c.updateWorldInfoList();
  }
  var BLANK_ENTRY = {
    key: [],
    keysecondary: [],
    comment: "新条目",
    content: "",
    constant: !1,
    selective: !0,
    selectiveLogic: 0,
    addMemo: !0,
    order: 100,
    position: 1,
    disable: !1,
    excludeRecursion: !1,
    preventRecursion: !1,
    probability: 100,
    useProbability: !0,
    depth: 4,
    group: "",
    groupOverride: !1,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: "",
    role: null
  }, nextUid = (data) => Object.values(data.entries).reduce((max, entry) => Math.max(max, Number(entry.uid) || 0), -1) + 1;
  function addEntries(name, sources = []) {
    return queued(name, async () => {
      let data = clone(await loadBook(name)), list = sources.length ? sources.map((key) => data.entries[key]).filter(Boolean) : [BLANK_ENTRY], keys = [];
      for (let entry of list) {
        let uid = nextUid(data);
        data.entries[uid] = { ...clone(entry), uid, displayIndex: uid, ...sources.length ? { comment: `${entry.comment || ""}（副本）` } : {} }, keys.push(String(uid));
      }
      return await saveBook(name, data), keys;
    });
  }
  async function createBook(name, data = { entries: {} }) {
    let value = String(name || "").trim();
    if (!value) throw new Error("请填写世界书名称");
    if (allBookNames().includes(value)) throw new Error(`已有名为「${value}」的世界书`);
    await saveBook(value, data);
    let c = ctx();
    return c && typeof c.updateWorldInfoList == "function" && await c.updateWorldInfoList(), value;
  }
  async function rebind(from, to) {
    let c = ctx(), h = helper(), failed = [], meta2 = c && c.chatMetadata;
    meta2 && meta2.world_info === from && (to ? meta2.world_info = to : delete meta2.world_info, typeof c.saveMetadata == "function" && await c.saveMetadata());
    try {
      let bound = h && typeof h.getCharWorldbookNames == "function" ? h.getCharWorldbookNames("current") : null, additional = bound && Array.isArray(bound.additional) ? bound.additional : [];
      if (bound && (bound.primary === from || additional.includes(from))) {
        if (typeof h.rebindCharWorldbooks != "function") throw new Error("no rebind");
        await h.rebindCharWorldbooks("current", {
          primary: bound.primary === from ? to || null : bound.primary,
          additional: additional.map((item) => item === from ? to : item).filter(Boolean)
        });
      }
    } catch {
      failed.push("角色卡");
    }
    try {
      let global = h && typeof h.getGlobalWorldbookNames == "function" ? h.getGlobalWorldbookNames() : null;
      Array.isArray(global) && global.includes(from) && typeof h.rebindGlobalWorldbooks == "function" && await h.rebindGlobalWorldbooks(global.map((item) => item === from ? to : item).filter(Boolean));
    } catch {
      failed.push("全局");
    }
    return failed;
  }
  async function renameBook(from, to) {
    let name = String(to || "").trim();
    if (!name || name === from) throw new Error("请填写新的名称");
    let data = await queued(from, () => loadBook(from));
    await createBook(name, clone(data));
    let failed = await rebind(from, name);
    return failed.length || await deleteBook(from), { name, failed };
  }
  async function duplicateBook(from, to) {
    return createBook(to, clone(await queued(from, () => loadBook(from))));
  }
  async function removeBook(name) {
    let failed = await rebind(name, "");
    return await deleteBook(name), { failed };
  }
  async function writeFallbackBook(name, wiEntries) {
    let c = ctx(), data = { entries: {} };
    wiEntries.forEach((entry, index) => {
      let { world, ...rest } = entry;
      data.entries[index] = { ...rest, uid: index, displayIndex: index };
    }), await saveBook(name, data), typeof c.updateWorldInfoList == "function" && await c.updateWorldInfoList();
    let meta2 = c.chatMetadata;
    return meta2 && !meta2.world_info ? (meta2.world_info = name, typeof c.saveMetadata == "function" && await c.saveMetadata(), { bound: !0 }) : { bound: meta2 && meta2.world_info === name, conflict: meta2 && meta2.world_info && meta2.world_info !== name ? meta2.world_info : "" };
  }
  async function readEntryContent(title2, same) {
    for (let { name } of boundBookNames())
      try {
        let hit = bookEntries(await loadBook(name)).find((entry) => same(entry.comment, title2));
        if (hit && hit.content.trim()) return hit.content.trim();
      } catch {
      }
    return "";
  }

  // src/app/progress-store.js
  var KEY = "plotInjector";
  function meta() {
    let c = ctx();
    return c && c.chatMetadata ? c.chatMetadata : null;
  }
  function readChatState() {
    let m = meta(), raw = m && m[KEY];
    return !raw || typeof raw != "object" ? { projectId: "", byProject: {} } : raw.byProject && typeof raw.byProject == "object" ? { projectId: String(raw.projectId || ""), byProject: raw.byProject } : raw.projectId ? { projectId: raw.projectId, byProject: { [raw.projectId]: raw } } : { projectId: "", byProject: {} };
  }
  function readProgress(projectId) {
    let state = readChatState();
    return normalizeProgress(state.byProject[projectId], projectId) || emptyProgress(projectId);
  }
  function save() {
    let c = ctx();
    typeof c.saveMetadataDebounced == "function" ? c.saveMetadataDebounced() : typeof c.saveMetadata == "function" && c.saveMetadata();
  }
  function writeProgress(progress) {
    let m = meta();
    if (!m) return !1;
    let state = readChatState();
    return m[KEY] = { projectId: progress.projectId, byProject: { ...state.byProject, [progress.projectId]: progress } }, save(), !0;
  }
  function bindChat(projectId) {
    let m = meta(), c = ctx(), chatId = c && (typeof c.getCurrentChatId == "function" ? c.getCurrentChatId() : c.chatId);
    return !m || chatId === void 0 || chatId === null || chatId === "" ? !1 : (m[KEY] = { ...readChatState(), projectId }, save(), !0);
  }
  function clearChatProgress() {
    let m = meta();
    if (!m || !m[KEY]) return;
    delete m[KEY];
    let c = ctx();
    if (typeof c.saveMetadata == "function") return c.saveMetadata();
  }

  // src/app/runtime.js
  var VIRTUAL_WORLD = "剧情注入器", LOG_MAX2 = 40, PENDING_MAX_MS = 3e4, CHECK_RETRIES = 3, RETRY_GAP_MS = 2e3, WORLD_RETRIES = 2, WORLD_WAIT_MS = 9e4, placeOf = (unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
  function createRuntime({ data, notice, emit, askReason = async () => "" }) {
    let view = hostWindow(), progress = null, progressFor = "", alignedFrom = null, alignedOutline = null, alignedPersonas = null, checking = !1, fallbackTimer = 0, generating = !1, chatStartFloors = 0, pendingCheck = !1, pendingTimer = 0, opening = !1, openGen = 0, openPromise = Promise.resolve(null), pendingTrigger = null, lastRead = null, listeners = [], stats = {}, logs = [];
    function log(text2) {
      logs.push({ at: Date.now(), text: text2 }), logs.length > LOG_MAX2 && logs.shift();
    }
    let clue = createClueRuntime({
      data,
      getProject: () => activeProject(),
      getProgress: () => currentProgress(),
      setProgress: (next, reason) => setProgress(next, reason),
      emit: (reason) => emit(reason),
      log,
      ticket: () => ticket(),
      ticketValid: (t) => ticketValid(t)
    });
    function clueMode() {
      return !isInfinite(activeProject()) && isClueMode(activeProject());
    }
    let epoch = 0;
    function bumpEpoch() {
      epoch += 1;
    }
    function ticket() {
      let c = ctx();
      return {
        epoch,
        chat: c && typeof c.getCurrentChatId == "function" ? String(c.getCurrentChatId() || "") : "",
        project: activeId(),
        mode: clueMode() ? "clue" : "outline"
      };
    }
    function ticketValid(t) {
      let now = ticket();
      return !!t && t.epoch === now.epoch && t.chat === now.chat && t.project === now.project && t.mode === now.mode;
    }
    function chatBoundId() {
      let id = readChatState().projectId;
      return id && data.index().projects.some((item) => item.id === id) ? id : "";
    }
    function activeId() {
      return chatBoundId() || data.activeIdFor(cardKey());
    }
    function activeProject() {
      let id = activeId(), project = id ? data.project(id) : null;
      if (!project || project.mode === "infinite") return project;
      let ids = ensureOutlineIds(project.outline.volumes, project.outlineIdMap);
      return ids.changed ? (data.updateProject(id, (cur) => ({
        ...cur,
        outline: { ...cur.outline, volumes: ids.volumes },
        outlineIdMap: ids.legacyMap
      })), data.project(id)) : project;
    }
    function currentProgress() {
      let id = activeId();
      if (!id) return null;
      (!progress || progressFor !== id) && (progress = readProgress(id), progressFor = id);
      let project = activeProject();
      if (project && project.mode === "infinite" && !progress.infinite && (progress = { ...progress, infinite: emptyInfinite() }, writeProgress(progress)), project && !isInfinite(project) && (progress !== alignedFrom || project.outline !== alignedOutline)) {
        let migrated = migrateStableProgress(progress, project.outline.volumes, project.outlineIdMap, project.outline.idAlias), aligned = stampNodeIds(alignProgress(migrated, project.outline), project.outline.volumes);
        aligned !== progress && (progress = aligned, writeProgress(progress), log("按大纲对照表归位了本聊天的进度")), alignedFrom = progress, alignedOutline = project.outline;
      }
      if (project && project.personas !== alignedPersonas) {
        let aligned = alignPersonaProgress(progress, project.personas);
        aligned !== progress && (progress = aligned, writeProgress(progress), log("按人设对回了本聊天的人设进度")), alignedPersonas = project.personas;
      }
      return progress;
    }
    function fameNow() {
      try {
        let igs = view.IGS, list = igs && igs.stats && typeof igs.stats.fame == "function" ? igs.stats.fame() : [], favor = igs && igs.stats && typeof igs.stats.favor == "function" ? igs.stats.favor() : [];
        return [...Array.isArray(list) ? list : [], ...Array.isArray(favor) ? favor.map((row2) => ({ ...row2, kind: "favor" })) : []];
      } catch {
        return [];
      }
    }
    function links() {
      let project = activeProject();
      return project ? outlineLinks(project.outline) : void 0;
    }
    let isInfinite = (project) => !!(project && project.mode === "infinite");
    function units() {
      let project = activeProject();
      return project ? flattenUnits(project.outline.volumes) : [];
    }
    function stampActive(prev, next) {
      if (!next || next.infinite) return next;
      let list = units();
      if (!list.length) return next;
      let activeOf = (prog) => {
        let states = unitStates(list, prog), found = list.find((unit) => states[unit.id] === "active");
        return found ? found.id : "";
      }, now = activeOf(next);
      if (!now) return next;
      let changed = !prev || prev.projectId !== next.projectId || activeOf(prev) !== now, slot = next.slots[now] || {};
      return !changed && slot.since || !prev && slot.since ? next : patchSlot(next, now, { since: floorCount() });
    }
    function setProgress(next, reason = "progress") {
      let project = activeProject();
      project && project.mode !== "infinite" && (next = stampNodeIds(next, project.outline.volumes)), next = isClueMode(project) ? next : syncPersonas(project, next, fameNow()), next = stampActive(progress && progressFor === next.projectId ? progress : null, next), progress = next, progressFor = next.projectId, writeProgress(next), scheduleFallback(), emit(reason);
    }
    function personaStates() {
      if (!clueMode()) return null;
      let computed = clue.compute();
      return computed ? Object.fromEntries(
        [...computed.state.stageStates].map(([id, state]) => [
          id,
          state.done ? "done" : state.entered.v === "true" ? "active" : "todo"
        ])
      ) : {};
    }
    function entries({ inject = !1 } = {}) {
      let project = activeProject(), prog = currentProgress(), persona = hasPersonas(project) ? {
        fame: fameNow(),
        stageStates: personaStates(),
        ...inject ? { recentText: scanText(), globals: worldInfoMatchSettings() } : {}
      } : {};
      return !project || !prog ? [] : isClueMode(project) ? [...buildClueEntries(project, prog), ...buildPersonaEntries(project, prog, persona)] : buildEntries(
        {
          ...project,
          setting: { ...project.setting, text: stripAuthorBlocks(project.setting.text) },
          outline: { ...project.outline, volumes: outlineVolumesView(project.outline.volumes) }
        },
        prog,
        data.settings(),
        { ...persona, stayOf: (unit) => stayText(stayState(prog.stays, chatMessages(), outlineStay(prog, unit)), "outline") }
      );
    }
    function outlineStay(prog, unit) {
      let list = flattenUnits((activeProject() || { outline: { volumes: [] } }).outline.volumes), states = unitStates(list, prog), active = list.filter((u) => states[u.id] === "active"), only = active.length === 1 ? active[0] : null, enabled = (u) => pickParams({ ...DEFAULT_PARAMS, ...activeProject().defaults }.detail, prog.slots[u.id]).enabled;
      return unit ? { key: unit.id, paused: !enabled(unit) } : { key: only ? only.id : "", paused: !!only && !enabled(only) };
    }
    function recordStay(messageId) {
      let prog = currentProgress(), project = activeProject();
      if (!prog || !project) return;
      let info = isClueMode(project) ? clue.stayInfo() : outlineStay(prog, null);
      if (!info) return;
      let next = addStay(prog.stays, stayEntry(chatMessages(), Number(messageId), info));
      next !== prog.stays && setProgress({ ...prog, stays: next }, "stay");
    }
    function buildClueEntries(project, prog) {
      let defaults = { ...DEFAULT_PARAMS, ...project.defaults }, out = [], settingText = injectedSetting(project.setting);
      settingText && out.push({
        slotId: SETTING_SLOT,
        kind: "setting",
        title: "设定",
        content: settingText,
        ...pickParams(defaults.setting, prog.slots[SETTING_SLOT])
      });
      let proj = clue.projection();
      return out.push({
        slotId: CLUE_SLOT,
        kind: "detail",
        title: "线索场景",
        content: proj.content,
        reason: proj.reason,
        used: proj.used,
        lineOnly: !!proj.lineOnly,
        ...pickParams(defaults.detail, prog.slots[CLUE_SLOT])
      }), out;
    }
    function virtualEntries({ recordClue = !1 } = {}) {
      let list = entries({ inject: !0 }), clueEntry = list.find((entry) => entry.slotId === CLUE_SLOT);
      return recordClue && clueEntry && clue.record(
        "worldbook",
        clueEntry.enabled ? { content: clueEntry.content, used: clueEntry.used, reason: clueEntry.reason, lineOnly: clueEntry.lineOnly } : { content: "", reason: "线索条目已被关闭" }
      ), list.filter((entry) => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }
    function scanText() {
      let depth = Math.max(1, worldInfoScanDepth());
      return chatMessages().filter((msg) => !isNote(msg)).slice(-depth).map((msg) => String(msg.mes || "")).join(`
`);
    }
    function refreshPersonas() {
      let project = activeProject(), prog = currentProgress();
      if (!hasPersonas(project) || !prog) return;
      let next = syncPersonas(project, prog, fameNow(), personaStates());
      next !== prog && setProgress(next);
    }
    function onStatsChanged() {
      hasPersonas(activeProject()) && (refreshPersonas(), scheduleFallback(), emit("progress"));
    }
    function eventTypes() {
      let c = ctx();
      return c && c.eventTypes || {};
    }
    function hasEntriesEvent() {
      return !!eventTypes().WORLDINFO_ENTRIES_LOADED;
    }
    async function onEntriesLoaded(payload) {
      if (!(!payload || !Array.isArray(payload.chatLore))) {
        opening && await waitOpening(), refreshPersonas();
        try {
          payload.chatLore.push(...virtualEntries({ recordClue: !0 }));
        } catch (error) {
          console.error("[剧情注入器] 注入失败", error);
        }
      }
    }
    function scheduleFallback() {
      hasEntriesEvent() || (view.clearTimeout(fallbackTimer), fallbackTimer = view.setTimeout(async () => {
        let name = `剧情注入器·${cardName() || "未命名"}`;
        try {
          let result = await writeFallbackBook(name, clueMode() ? [] : virtualEntries());
          result.conflict && toast("warning", `聊天已绑定世界书「${result.conflict}」，剧情注入器的条目写在「${name}」，需要手动启用。`);
        } catch (error) {
          toast("error", `写入专用世界书失败：${error.message}`);
        }
      }, 1e3));
    }
    let isNote = (msg) => !msg || msg.is_system && msg.extra && msg.extra.type;
    function floorCount() {
      return chatMessages().length;
    }
    function activeUnit() {
      let list = units(), prog = currentProgress();
      if (!list.length || !prog) return null;
      let states = unitStates(list, prog);
      return list.find((unit) => states[unit.id] === "active") || list[currentIndex(list, prog)];
    }
    function openNext({ silent = !1 } = {}) {
      let prog = currentProgress(), step = prog && advance(prog, units());
      return step ? (setProgress(step.progress), notice.hide("advance"), step) : (silent || toast("info", "已经是最后一段。"), null);
    }
    function backTo(unitId) {
      let prog = currentProgress();
      prog && setProgress(goTo(prog, units(), unitId));
    }
    function proposeAdvance({ unit, reason = "" }) {
      let settings = data.settings(), prog = currentProgress();
      if (!prog || isMuted(prog, unit.id) || settings.handleMode === "nodes") return;
      let step = advance(prog, units());
      if (step) {
        if (settings.handleMode === "auto") {
          setProgress(step.progress), notice.show({
            id: "advance",
            title: `已切到 ${placeOf(step.to)}`,
            body: reason || "检测判断本阶段已演完。",
            actions: [{ label: "撤销", run: () => backTo(unit.id) }],
            timeout: 12e3
          });
          return;
        }
        notice.show({
          id: "advance",
          title: `${placeOf(unit)} 已演完`,
          body: reason || "检测判断本阶段已演完。",
          actions: [
            { label: "打开下一段", primary: !0, run: () => openNext() },
            { label: "暂不", run: () => notice.hide("advance") },
            { label: "本阶段不再提醒", run: () => setProgress(mute(currentProgress(), unit.id)) }
          ]
        });
      }
    }
    async function syncSetting(projectId, { from = 0, reason = "" } = {}) {
      let project = data.project(projectId), text2 = project && project.setting.text.trim();
      if (!text2) return [];
      let list = flattenUnits(project.outline.volumes), guide = String(data.settings().guide || "").trim() || BUILTIN_GUIDE, reply2 = await requestLlm(
        syncSettingMessages({ guide, setting: text2, units: list, fromUnitIndex: from, reason }),
        resolveLlm(data.settings(), "outline")
      ), body = parseSettingReply(reply2).body, keys = body ? changedBlockKeys(text2, body) : [];
      if (!keys.length) return [];
      let next = mergeBlocks(text2, body, keys);
      data.updateProject(projectId, (current) => ({
        ...current,
        setting: {
          ...current.setting,
          text: next,
          history: pushHistory(pushHistory(current.setting.history, current.setting.text), next)
        }
      }));
      let titles = new Map(splitBlocks(text2).map((block) => [block.key, block.title]));
      return keys.map((key) => titles.get(key) || key);
    }
    async function rewriteRest(reason) {
      let project = activeProject(), prog = currentProgress(), unit = activeUnit();
      if (!project || !prog || !unit) throw new Error("当前卡没有启用的项目");
      let t = ticket(), list = units(), from = list.findIndex((item) => item.id === unit.id), recent = recentFloors(6).map((floor) => floor.text).join(`

`), reply2 = await requestLlm(
        rewriteRestMessages({
          setting: project.setting.text,
          volumes: project.outline.volumes,
          fromUnitIndex: from,
          units: list,
          recent,
          reason
        }),
        resolveLlm(data.settings(), "outline")
      ), parsed = parseOutlineReply(reply2);
      if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
      if (!ticketValid(t)) throw new Error("改写期间聊天、项目或推进方式已切换，结果未应用");
      let before = { volumes: project.outline.volumes, progress: prog, setting: project.setting.text }, volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
      data.updateProject(project.id, (current) => ({
        ...current,
        outline: {
          ...current.outline,
          volumes,
          history: pushOutlineHistory(current.outline.history, current.outline.volumes, "偏离改写")
        }
      }));
      let first = parsed.volumes[0] && parsed.volumes[0].stages[0];
      return first && setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id)), before;
    }
    function undoRewrite(projectId, before) {
      data.updateProject(projectId, (current) => ({
        ...current,
        outline: { ...current.outline, volumes: before.volumes },
        setting: { ...current.setting, text: before.setting, history: pushHistory(current.setting.history, before.setting) }
      })), setProgress(before.progress), toast("info", "已撤销改写，恢复原来的大纲、设定和进度。");
    }
    async function runRewrite(reason, { auto = !1 } = {}) {
      let projectId = activeId();
      notice.show({ id: "offtrack", title: "正在改写后续阶段…", body: reason });
      try {
        let before = await rewriteRest(reason), synced = "";
        try {
          notice.show({ id: "offtrack", title: "正在按新大纲校对设定…", body: reason });
          let titles = await syncSetting(projectId, { from: currentIndex(units(), currentProgress()), reason });
          synced = titles.length ? `
设定已同步修改：${titles.join("、")}。` : "";
        } catch (error) {
          synced = `
设定校对失败：${error.message}`;
        }
        notice.show({
          id: "offtrack",
          title: auto ? "剧情偏离大纲，已自动改写后续阶段" : "已改写后续阶段",
          body: `${reason}${synced}`,
          actions: [{ label: "撤销", run: () => undoRewrite(projectId, before) }],
          timeout: 2e4
        });
      } catch (error) {
        notice.hide("offtrack"), toast("error", `改写失败：${error.message}`);
      }
    }
    function handleOffTrack(unit, reason) {
      if (notice.hide("advance"), data.settings().offTrackMode === "auto") {
        runRewrite(reason, { auto: !0 });
        return;
      }
      notice.show({
        id: "offtrack",
        title: `${placeOf(unit)} 偏离大纲`,
        body: `${reason || "正文走向与后续阶段冲突。"}后续阶段可能接不上，建议改写。`,
        actions: [
          {
            label: "改写后续阶段",
            primary: !0,
            run: async () => {
              let note = await askReason(reason);
              note != null && runRewrite(note.trim() || reason);
            }
          },
          { label: "暂不", run: () => notice.hide("offtrack") },
          {
            label: "本阶段不再提醒",
            run: () => {
              let prog = currentProgress();
              prog && !prog.offMuted.includes(unit.id) && setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
            }
          }
        ]
      });
    }
    function threadEventText(event) {
      return {
        "clock-tick": `进度钟「${event.name}」推进到 ${event.filled}/${event.total}`,
        "clock-due": `进度钟「${event.name}」已满格，本段必须发生`,
        "clock-done": `世界动态「${event.name}」已发生`,
        "hook-on": `支线「${event.name}」条件满足，已激活`,
        "chain-step": `支线链「${event.name}」进入第 ${event.step + 1}/${event.total} 步`,
        "hook-done": `支线「${event.name}」已演完`,
        "hook-expired": `支线「${event.name}」超过时限，已过期`
      }[event.type] || event.type;
    }
    function adoptThread(projectId, stageId, thread) {
      data.updateProject(projectId, (current) => ({
        ...current,
        outline: {
          ...current.outline,
          volumes: addPlayerThread(current.outline.volumes, stageId, thread),
          history: pushOutlineHistory(current.outline.history, current.outline.volumes, "收录支线")
        }
      })), log(`收录玩家自开的线「${thread.name}」为支线`), scheduleFallback(), emit("progress");
    }
    function offerThread(unit, thread) {
      let settings = data.settings(), project = activeProject(), prog = currentProgress();
      if (!(settings.newThreadMode === "off" || !project || !prog || !threadSwitches(project).sideOn) && !(threadState(prog).ignored.includes(thread.name) || hasNodeNamed(units(), thread.name))) {
        if (settings.newThreadMode === "auto") {
          adoptThread(project.id, unit.stage.id, thread), notice.show({ id: "thread", title: `已收录支线「${thread.name}」`, body: thread.summary, timeout: 1e4 });
          return;
        }
        notice.show({
          id: "thread",
          title: `正文开了一条新线「${thread.name}」`,
          body: thread.summary || "大纲里没有这条线。",
          actions: [
            { label: "收录为支线", primary: !0, run: () => adoptThread(project.id, unit.stage.id, thread) },
            { label: "忽略", run: () => setProgress(ignoreThread(currentProgress(), thread.name)) }
          ]
        });
      }
    }
    function recentFloors(count) {
      let out = [], chat = chatMessages();
      for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
        let msg = chat[i];
        if (isNote(msg)) continue;
        let text2 = cleanFloorText(msg.mes);
        text2 && out.unshift({ index: i, text: `${msg.is_user ? "（用户）" : ""}${text2}` });
      }
      return out;
    }
    function infState() {
      let project = activeProject(), prog = currentProgress();
      return !isInfinite(project) || !prog || !prog.infinite ? null : { project, prog, infinite: normalizeInfinite(project.infinite), inf: prog.infinite };
    }
    function setInf(inf, reason = "progress") {
      setProgress({ ...currentProgress(), infinite: inf }, reason);
    }
    function latestAiFloor() {
      let chat = chatMessages();
      for (let i = chat.length - 1; i >= 0; i -= 1) {
        let msg = chat[i];
        if (!(!msg || msg.is_user || msg.is_system)) return { floor: i, text: String(msg.mes || "") };
      }
      return null;
    }
    function hubConfig() {
      let project = activeProject();
      return project && project.infinite ? normalizeInfinite(project.infinite).config : void 0;
    }
    function refreshRead() {
      let found = latestAiFloor();
      return lastRead = found ? { floor: found.floor, state: parseTrainState(found.text, hubConfig()) } : null, found;
    }
    function abandonOpening() {
      opening && (openGen += 1, opening = !1, pendingTrigger = null, emit("opened"));
    }
    function revalidateTrigger() {
      let state = infState();
      if (!state) return;
      let pending = opening && pendingTrigger ? pendingTrigger : null, trig = pending || state.inf.trigger;
      if (!trig) return;
      let msg = chatMessages()[trig.floor], text2 = msg && !msg.is_user && !msg.is_system ? String(msg.mes || "") : null;
      if (text2 !== null && !text2.trim()) return;
      let cfg = state.infinite.config, names2 = hubWordNames(cfg), word = trig.kind === "enter" ? names2.depart : names2.back, verdict = judgeTrigger(trig, text2, cfg);
      if (!(verdict === "none" || verdict === "same")) {
        if (verdict === "keep") {
          let next = { ...trig, hash: hashText(text2) };
          pending ? pendingTrigger = next : setInf(withTrigger(state.inf, next)), log(`第 ${trig.floor} 楼文字变了，仍是「${word}」，不重复处理`);
          return;
        }
        pending ? (log(`第 ${trig.floor} 楼不再是「${names2.depart}」，取消正在生成的世界档案`), abandonOpening()) : trig.kind === "enter" ? (log(`第 ${trig.floor} 楼不再是「${names2.depart}」，撤销开副本，删掉刚生成的档案`), setInf(undoEnter(state.inf, `第 ${trig.floor} 楼不再是「${names2.depart}」，撤销开副本`))) : (log(`第 ${trig.floor} 楼不再是「${names2.back}」，撤销关副本`), setInf(undoLeave(state.inf, `第 ${trig.floor} 楼不再是「${names2.back}」，撤销关副本`))), notice.show({
          id: "inf-undo",
          title: "触发楼已改动",
          body: trig.kind === "enter" ? `这一楼不再是「${names2.depart}」，已撤销开副本并删掉刚生成的档案。` : `这一楼不再是「${names2.back}」，已重新打开那份档案。`,
          timeout: 1e4
        });
      }
    }
    function onInfiniteReceived() {
      let found = refreshRead();
      revalidateTrigger();
      let state = infState();
      if (!state || !found) {
        found || log("收到回复：没有 AI 楼层可读"), emit("floor");
        return;
      }
      let train = lastRead.state;
      log(`读状态块：第 ${found.floor} 楼 ${train ? `${resolveHub(state.infinite.config).hubName}：${train}` : "没有状态块"}`);
      let kind = decideTrigger(state.inf.phase, train, state.infinite.config);
      if (kind === "enter") openWorld({ floor: found.floor, text: found.text });
      else if (kind === "leave") {
        let trigger = makeTrigger({ kind: "leave", floor: found.floor, text: found.text, worldId: state.inf.worldId });
        setInf(
          withTrigger(
            leaveWorld(state.inf, `第 ${found.floor} 楼读到「${hubWordNames(state.infinite.config).back}」，关副本`),
            trigger
          )
        );
      }
      emit("floor");
    }
    async function waitOpening() {
      let promise = openPromise, timer = 0, timedOut = !1, timeout = new Promise((resolve) => {
        timer = view.setTimeout(() => {
          timedOut = !0, resolve();
        }, WORLD_WAIT_MS);
      });
      log("世界档案还在生成，先等它完成"), await Promise.race([promise.catch(() => null), timeout]), view.clearTimeout(timer), timedOut && opening && (log(`等待世界档案超过 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案`), notice.show({
        id: "inf-wait",
        title: "世界档案还没生成完",
        body: `已等待 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案，生成完成后从下一次回复起带上。`,
        timeout: 12e3
      }));
    }
    function openWorld(trigger = null) {
      if (opening) return openPromise;
      let state = infState();
      if (!state) return Promise.resolve(null);
      if (state.inf.phase !== "train")
        return toast("info", `只有在${resolveHub(state.infinite.config).hubName}时才能进入新世界。`), Promise.resolve(null);
      opening = !0, openGen += 1;
      let gen = openGen;
      return pendingTrigger = trigger ? { kind: "enter", floor: trigger.floor, hash: hashText(trigger.text), worldId: "" } : null, openPromise = runOpen(state, gen).finally(() => {
        gen === openGen && (opening = !1, pendingTrigger = null, emit("opened"));
      }), openPromise;
    }
    async function runOpen(state, gen) {
      let projectId = state.project.id;
      emit("opening");
      try {
        let dice = rollWorldDice(state.infinite, randomFloat);
        log(`开副本掷骰：${dice.horror}｜${dice.cycle}｜${dice.client}｜情欲${dice.lust}`);
        let spec = worldSpecText(state.infinite), titles = state.inf.worlds.map((world2) => world2.title), guideTitle = horrorTitle(state.infinite.config.horrorPrefix, dice.horror), horrorGuide = "";
        try {
          horrorGuide = await readEntryContent(guideTitle, (a, b) => titleKey(a) === titleKey(b));
        } catch (error) {
          log(`读取恐怖类型写法失败：${error.message}`);
        }
        horrorGuide || log(`卡里没找到「${guideTitle}」，造世界时不带恐怖类型写法`);
        let parsed = null, hint = "";
        for (let attempt = 0; ; attempt += 1)
          try {
            let messages = buildWorldMessages({ spec, dice, setting: state.project.setting.text, titles, hint, horrorGuide });
            parsed = parseWorldReply(await requestLlm(messages, resolveLlm(data.settings(), "outline"), { timeoutMs: 18e4 }));
            break;
          } catch (error) {
            if (attempt >= WORLD_RETRIES) throw error;
            hint = error.message, log(`造世界失败：${error.message}，第 ${attempt + 1} 次重试`);
          }
        let now = infState();
        if (gen !== openGen || !now || now.project.id !== projectId || now.inf.phase !== "train")
          return log("造世界结果作废：开副本期间状态已变"), null;
        let world = createWorld({ id: makeId("w"), dice, parsed }), trig = pendingTrigger ? { ...pendingTrigger, worldId: world.id } : null;
        return setInf(withTrigger(enterWorld(now.inf, world), trig)), notice.show({
          id: "inf-stop",
          title: `进入新世界「${world.title}」`,
          body: `${dice.horror}｜${dice.client}`,
          timeout: 12e3
        }), world;
      } catch (error) {
        return gen !== openGen || (log(`开副本失败：${error.message}`), notice.show({
          id: "inf-stop",
          title: "开副本失败",
          body: error.message,
          actions: [
            { label: "重试", primary: !0, run: () => openWorld() },
            { label: "关闭", run: () => {
            } }
          ]
        })), null;
      }
    }
    function returnToTrain() {
      let state = infState();
      !state || state.inf.phase !== "world" || setInf(leaveWorld(state.inf, `手动回到${resolveHub(state.infinite.config).hubName}`));
    }
    function reopenWorld(worldId) {
      let state = infState();
      if (state) {
        if (state.inf.phase !== "train") {
          toast("info", `先回到${resolveHub(state.infinite.config).hubName}，再重新打开档案。`);
          return;
        }
        setInf(reenterWorld(state.inf, worldId));
      }
    }
    function deleteWorld(worldId) {
      let state = infState();
      state && setInf(removeWorld(state.inf, worldId, state.infinite.config));
    }
    function personaCheckItems(floors) {
      let project = activeProject(), prog = currentProgress();
      return !hasPersonas(project) || !prog || data.settings().personaMode === "off" ? [] : checkItems(
        project,
        prog,
        floors.map((floor) => floor.text).join(`
`),
        {
          globals: worldInfoMatchSettings(),
          fame: fameNow(),
          stageStates: personaStates()
        }
      );
    }
    function offerPersonaMoves(items, replyMoves) {
      let scope = ticket(), project = activeProject(), moves = resolveMoves(items, replyMoves);
      if (!moves.length || !project) return;
      let lines2 = moves.map(moveText), adopt = () => {
        if (!ticketValid(scope)) return;
        let prog = currentProgress(), env = personaEnv(activeProject(), prog, fameNow(), personaStates()), still = moves.filter((move) => {
          let line = activeProject().personas.lines.find((item) => item.id === move.item.lineId);
          return line && currentStage(line, prog, env).stage.id === move.item.fromId;
        });
        if (!still.length) {
          log("人设阶段推进作废：阶段已被改动");
          return;
        }
        setProgress(applyMoves(prog, activeProject(), still)), log(`人设阶段推进：${lines2.join("；")}`);
      };
      if (data.settings().personaMode === "auto") {
        adopt(), notice.show({
          id: "persona",
          title: "人设阶段已推进",
          body: lines2.join(`
`),
          actions: [
            {
              label: "撤销",
              run: () => ticketValid(scope) && setProgress(undoMoves(currentProgress(), activeProject(), moves))
            }
          ],
          timeout: 15e3
        });
        return;
      }
      notice.show({
        id: "persona",
        title: "人设阶段有变化",
        body: lines2.join(`
`),
        actions: [
          { label: "采用", primary: !0, run: adopt },
          { label: "暂不", run: () => notice.hide("persona") }
        ]
      });
    }
    async function checkPersonasOnly({ manual = !1 } = {}) {
      let scope = ticket(), settings = data.settings(), floors = recentFloors(settings.checkFloors), items = floors.length ? personaCheckItems(floors) : [];
      if (!items.length)
        return floors.length && !manual && setProgress({ ...currentProgress(), lastCheckFloor: floorCount() }), log("跳过检测：大纲为空"), manual && hasPersonas(activeProject()) && toast("info", floors.length ? "没有需要检测的人设线。" : "还没有可检测的正文。"), null;
      checking = !0, log(`开始检测人设阶段：${items.length} 条线，读最近 ${floors.length} 楼${manual ? "（手动）" : ""}`), emit("checking");
      try {
        let messages = buildPersonaCheckMessages(items, floors), result = null;
        for (let attempt = 0; ; attempt += 1)
          try {
            if (!ticketValid(scope)) return null;
            result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, "check"), { timeoutMs: 12e4 }));
            break;
          } catch (error) {
            if (!ticketValid(scope) || attempt >= CHECK_RETRIES) throw error;
            log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`), await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS));
          }
        if (!ticketValid(scope)) return null;
        notice.hide("checkfail");
        let next = { ...currentProgress(), lastCheckFloor: floorCount() };
        delete next.lastFailFloor, setProgress(next);
        let moves = result.personas || [];
        return log(`人设检测完成：${moves.length} 条建议`), offerPersonaMoves(items, moves), manual && !moves.length && toast("info", "人设阶段没有变化。"), result;
      } catch (error) {
        return ticketValid(scope) && (setProgress({ ...currentProgress(), lastFailFloor: floorCount() }), log(`检测失败：${error.message}`), notice.show({
          id: "checkfail",
          title: "进度检测失败",
          body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
          actions: [
            { label: "重试", primary: !0, run: () => checkNow({ manual }) },
            { label: "关闭", run: () => {
            } }
          ]
        })), null;
      } finally {
        checking = !1, emit("checked");
      }
    }
    async function checkNow({ manual = !1 } = {}) {
      if (isInfinite(activeProject())) return log("无限流项目不使用检测模型"), null;
      if (checking) return log("跳过检测：上一次检测还没结束"), null;
      let project = activeProject(), prog = currentProgress(), settings = data.settings();
      if (!project || !prog) return log("跳过检测：当前卡没有启用的项目"), manual && toast("info", "当前卡没有启用的项目。"), null;
      let sw = threadSwitches(project), unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
      if (!unit) return checkPersonasOnly({ manual });
      let floors = recentFloors(settings.checkFloors);
      if (!floors.length) return log("跳过检测：没有可检测的正文"), manual && toast("info", "还没有可检测的正文。"), null;
      checking = !0, log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? "（手动）" : ""}`), emit("checking");
      let t = ticket();
      try {
        if (clueMode()) return await clueCheck(floors);
        let list = maskUnits(flattenUnits(outlineVolumesView(project.outline.volumes)), sw), states = unitStates(list, prog), opts = { carryOver: settings.carryOver, hookCap: settings.hookCap, links: links() }, index = buildIndexText(list, states, prog, opts), threadInfo = checkThreads(liveThreads(list, states, prog, opts), {
          newThreadMode: sw.sideOn ? settings.newThreadMode : "off",
          ignored: threadState(prog).ignored,
          readTo: prog.lastCheckFloor
        }), pItems = personaCheckItems(floors), messages = buildCheckMessages(unit, index, floors, threadInfo, pItems), result = null;
        for (let attempt = 0; ; attempt += 1)
          try {
            if (!ticketValid(t)) return null;
            result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, "check"), { timeoutMs: 12e4 }));
            break;
          } catch (error) {
            if (!ticketValid(t) || attempt >= CHECK_RETRIES) throw error;
            log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`), await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS));
          }
        if (!ticketValid(t)) return log("检测返回时聊天、项目或推进方式已切换，结果丢弃"), null;
        notice.hide("checkfail");
        let next = currentProgress();
        if (next = uncheckByNames(
          next,
          unit.id,
          stageNodes(unit.stage.data).filter((node) => !isThreadNode(node)),
          result.done
        ), settings.carryOver)
          for (let item of carriedNodes(list, states, prog, { links: opts.links }))
            next = uncheckByNames(next, item.unit.id, [item.node], result.done);
        let merged = applyCheck(next, liveThreads(list, unitStates(list, next), next, opts), result, { floor: floorCount() });
        next = { ...merged.progress, lastCheckFloor: floorCount() }, delete next.lastFailFloor, setProgress(next);
        for (let event of merged.events) log(threadEventText(event));
        return log(
          `检测完成：已演 ${result.done.length} 个节点${result.stageDone ? "，本阶段已演完" : ""}${result.offTrack ? "，偏离大纲" : ""}`
        ), result.offTrack && settings.offTrackMode !== "off" && !next.offMuted.includes(unit.id) ? handleOffTrack(unit, result.offReason || result.reason) : result.stageDone ? proposeAdvance({ unit, reason: result.reason }) : manual && toast("info", result.reason || "本阶段尚未演完。"), result.newThread && sw.sideOn && offerThread(unit, result.newThread), offerPersonaMoves(pItems, result.personas || []), result;
      } catch (error) {
        return ticketValid(t) ? (setProgress({ ...currentProgress(), lastFailFloor: floorCount() }), log(`检测失败：${error.message}`), notice.show({
          id: "checkfail",
          title: "进度检测失败",
          body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
          actions: [
            { label: "重试", primary: !0, run: () => checkNow({ manual }) },
            { label: "关闭", run: () => {
            } }
          ]
        }), null) : (log("检测失败且请求期间已切换，保留当前进度"), null);
      } finally {
        checking = !1, emit("checked");
      }
    }
    async function clueCheck(floors) {
      let c = clue.compute(), focus = c && c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid);
      if (!focus)
        return hasPersonas(activeProject()) ? checkPersonasOnly({ manual: !0 }) : (toast("info", "线索模式下需要先有焦点场景才能检测。"), null);
      let item = isPlainObject(focus.node.item) ? focus.node.item : {}, finds = discoveryList(item), material = [
        clueText(item.入口) && `入口：${clueText(item.入口)}`,
        clueText(item.地点) && `地点：${clueText(item.地点)}`,
        clueText(item.场景) && `场景：${clueText(item.场景)}`,
        finds.length ? `【可能的发现】
${finds.map((d) => `- ${d.text}`).join(`
`)}` : `【可能的发现】
（未列出，只判断场景是否结束）`
      ].filter(Boolean).join(`
`), t = ticket(), pItems = personaCheckItems(floors), reply2 = await requestLlm(buildClueCheckMessages(material, floors, pItems), resolveLlm(data.settings(), "check"), {
        timeoutMs: 12e4
      }), result = parseCheckReply(reply2);
      return ticketValid(t) ? (offerPersonaMoves(pItems, result.personas || []), log(`线索检测建议：${result.done.length ? "场景可能已演完" : "场景未演完"}`), notice.show({
        id: "clue-check",
        title: "检测建议（不会自动改状态）",
        body: `${result.reason || ""}${result.done.length ? " 如确认已完成，请到执行页手动标记，或等待填表记录事实。" : ""}`,
        timeout: 2e4
      }), result) : (log("线索检测返回时项目、模式或聊天已切换，结果丢弃"), null);
    }
    function clampBase() {
      let prog = currentProgress();
      if (!prog) return null;
      let floors = floorCount(), threads = clampThreads(prog, floors), failOver = Number(prog.lastFailFloor) > floors;
      if (prog.lastCheckFloor <= floors && !failOver && threads === prog) return prog;
      prog.lastCheckFloor > floors && log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`), failOver && log(`上次检测失败时的楼层 ${prog.lastFailFloor} 大于当前楼数 ${floors}，已改为 ${floors}`), threads !== prog && log(`支线与进度钟记下的楼数大于当前楼数 ${floors}，已改为 ${floors}`);
      let next = { ...threads, lastCheckFloor: Math.min(prog.lastCheckFloor, floors) };
      return failOver && (next.lastFailFloor = floors), setProgress(next, "floor"), next;
    }
    function resetBase() {
      let prog = currentProgress();
      if (!prog) return;
      log(`手动重设检测起点为第 ${floorCount()} 楼`);
      let next = { ...prog, lastCheckFloor: floorCount() };
      delete next.lastFailFloor, setProgress(next, "floor");
    }
    function runPending() {
      view.clearTimeout(pendingTimer), pendingCheck && (pendingCheck = !1, checkNow());
    }
    function queueCheck() {
      if (!generating) {
        view.setTimeout(() => checkNow(), 0);
        return;
      }
      pendingCheck || (pendingCheck = !0, log("主回复仍在生成，生成结束后检测"), view.clearTimeout(pendingTimer), pendingTimer = view.setTimeout(() => {
        pendingCheck && (log("等待生成结束超时，直接检测"), generating = !1, runPending());
      }, PENDING_MAX_MS));
    }
    function onGenerationStarted(type, options2, dryRun) {
      dryRun || (generating = !0, clueMode() && (clue.register(), clue.invalidate(), clue.ensureRound(String(type || "generate"))));
    }
    function onGenerationEnded() {
      generating = !1, clue.endRound(), runPending();
    }
    function onGenerationStopped() {
      clue.discardPendingCandidates(), onGenerationEnded();
    }
    function onMessageReceived(messageId) {
      let floors = floorCount(), project = activeProject();
      if (!project) {
        log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`), emit("floor");
        return;
      }
      if (recordStay(messageId), clueMode()) {
        clue.bindCandidatesToMessage(Number(messageId)), clue.invalidate(), log(`收到第 ${messageId} 楼：线索模式不做自动检测，等待填表结果`), emit("floor");
        return;
      }
      if (isInfinite(project)) {
        onInfiniteReceived();
        return;
      }
      let settings = data.settings(), prog = clampBase() || currentProgress(), gap = floors - checkBase(prog);
      gap >= settings.checkEvery ? (log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`), queueCheck()) : log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`), emit("floor");
    }
    function onMessageChanged() {
      if (clue.invalidate(), isInfinite(activeProject())) {
        refreshRead(), revalidateTrigger(), emit("floor");
        return;
      }
      clampBase() && emit("floor");
    }
    async function onChatChanged() {
      bumpEpoch(), clue.onChatChanged(), clue.register(), alignedPersonas = null, progress = null, progressFor = "", abandonOpening(), lastRead = null, pendingCheck = !1, view.clearTimeout(pendingTimer), chatStartFloors = floorCount(), notice.hide("advance"), notice.hide("offtrack"), notice.hide("thread"), notice.hide("persona");
      let id = activeId();
      if (id)
        try {
          await data.loadProject(id);
        } catch (error) {
          toast("error", `读取项目失败：${error.message}`);
        }
      log(
        `切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find((item) => item.id === id) || {}).name || id}」` : "本卡没有启用项目"}`
      ), id && clampBase(), refreshRead(), scheduleFallback(), emit("chat");
    }
    async function switchProject(id, scope = "chat") {
      bumpEpoch(), clue.invalidate(), alignedPersonas = null, notice.hide("persona"), id && await data.loadProject(id), abandonOpening();
      let bound = bindChat(id);
      (scope === "card" || !bound || !data.activeIdFor(cardKey())) && data.setActive(id), progress = null, progressFor = "", clue.hideLineBar(), clue.invalidate(), clueMode() && clue.scheduleSync(), scheduleFallback(), emit("switch");
    }
    let lastOutlineAudit = null;
    function auditOutline(payload) {
      let project = activeProject(), prog = currentProgress();
      if (!project || !prog) return null;
      let text2 = requestToText(payload);
      if (!text2) return null;
      let list = flattenUnits(project.outline.volumes), states = isInfinite(project) ? Object.fromEntries(list.map((u) => [u.id, "done"])) : unitStates(list, prog), projection = entries().filter((e) => e.enabled && e.content).map((e) => e.content), history = chatMessages().filter((m) => m && !m.is_user && !m.is_system).map((m) => String(m.mes || "")), result = auditOutlineRequest(text2, project, states, projection, { history }), leaks = result.leaks;
      return lastOutlineAudit = { ...result, at: Date.now() }, leaks.length && (log(
        `最终请求核验：发现 ${leaks.length} 处不该出现的剧情（${leaks.slice(0, 3).map((l) => l.source).join("、")}${leaks.length > 3 ? "……" : ""}）`
      ), toast(
        "warning",
        `本轮正文请求里出现了还不该出现的剧情内容（${leaks[0].source}，匹配到「${leaks[0].sample}」）。可能是世界书、预设或别的插件带进来的，请到诊断页查看。`
      )), result.duplicated && (log(`最终请求核验：本轮剧情内容出现了 ${result.projectionCount} 次（重复注入）`), toast("warning", "本轮剧情内容在正文请求里出现了不止一次，请检查是否同时启用了别的注入路径。")), emit("clue-audit"), lastOutlineAudit;
    }
    function onPromptReady(payload) {
      if (!(payload && payload.dryRun))
        try {
          if (isBackgroundRequest(requestToText(payload))) return log("插件自己的后台请求（讨论、整理、导入、检测），不做正文核验");
          clueMode() ? clue.auditFinalRequest(payload) : auditOutline(payload);
        } catch (error) {
          log(`最终请求核验出错：${error.message}`);
        }
    }
    let BINDINGS = [
      ["WORLDINFO_ENTRIES_LOADED", onEntriesLoaded],
      ["CHAT_CHANGED", onChatChanged],
      ["MESSAGE_RECEIVED", onMessageReceived],
      ["MESSAGE_UPDATED", onMessageChanged],
      ["MESSAGE_DELETED", onMessageChanged],
      ["MESSAGE_SWIPED", onMessageChanged],
      ["GENERATION_STARTED", onGenerationStarted],
      ["GENERATION_ENDED", onGenerationEnded],
      ["GENERATION_STOPPED", onGenerationStopped],
      ["CHAT_COMPLETION_PROMPT_READY", onPromptReady],
      ["GENERATE_AFTER_COMBINE_PROMPTS", onPromptReady]
    ];
    function bind() {
      try {
        for (let win of /* @__PURE__ */ new Set([view, window])) win.addEventListener("igs:stats-changed", onStatsChanged);
      } catch {
      }
      let c = ctx(), types = eventTypes();
      if (!(!c || !c.eventSource))
        for (let [key, handler] of BINDINGS) {
          let name = types[key];
          if (!name) continue;
          let wrapped = (...args) => {
            let stat = stats[key] || (stats[key] = { count: 0, at: 0 });
            return stat.count += 1, stat.at = Date.now(), handler(...args);
          };
          c.eventSource.on(name, wrapped), listeners.push([key, name, wrapped]);
        }
    }
    function unbind() {
      try {
        for (let win of /* @__PURE__ */ new Set([view, window])) win.removeEventListener("igs:stats-changed", onStatsChanged);
      } catch {
      }
      let c = ctx();
      for (let [, name, handler] of listeners.splice(0))
        try {
          c.eventSource.removeListener(name, handler);
        } catch {
        }
    }
    function start() {
      unbind(), bind(), log(`已绑定 ${listeners.length} 个酒馆事件`), onChatChanged();
    }
    function stop() {
      clue.stop(), unbind(), view.clearTimeout(fallbackTimer), view.clearTimeout(pendingTimer);
    }
    function diagnose() {
      let types = eventTypes(), bound = new Set(listeners.map((item) => item[0]));
      return {
        hasContext: !!ctx(),
        hasEventSource: !!(ctx() && ctx().eventSource),
        events: BINDINGS.map(([key]) => ({
          key,
          name: types[key] || "",
          bound: bound.has(key),
          count: (stats[key] || {}).count || 0,
          at: (stats[key] || {}).at || 0
        })),
        cardKey: cardKey(),
        chatLength: chatMessages().length,
        floors: floorCount(),
        chatStartFloors,
        generating,
        pending: pendingCheck,
        checking,
        lastOutlineAudit,
        logs: logs.slice()
      };
    }
    return {
      start,
      stop,
      activeId,
      activeProject,
      progress: () => currentProgress() || emptyProgress(""),
      setProgress,
      units,
      entries,
      fame: fameNow,
      personaStates,
      openNext,
      backTo,
      checkNow,
      isChecking: () => checking,
      switchProject,
      floorCount,
      recentFloors,
      rewriteRest,
      syncSetting,
      diagnose,
      isInfinite: () => isInfinite(activeProject()),
      infState,
      openWorld,
      isOpening: () => opening,
      lastRead: () => lastRead,
      returnToTrain,
      reopenWorld,
      deleteWorld,
      note: log,
      resetBase,
      rebind: start,
      injectMode: () => hasEntriesEvent() ? "virtual" : "book",
      clue,
      isClueMode: clueMode,
      bumpEpoch,
      ticket,
      ticketValid,
      refresh: () => {
        scheduleFallback(), emit("progress");
      }
    };
  }
  function migrateStableProgress(progress, volumes, legacyMap = {}) {
    let changed = !1, dropped = 0, units = flattenUnits(volumes), byUid = /* @__PURE__ */ new Map();
    for (let unit of units)
      for (let node of stageNodes(unit.stage.data)) node.item && node.item.id && byUid.set(node.item.id, { node, stageId: unit.id });
    let slots = Object.fromEntries(
      Object.entries(progress.slots || {}).map(([id, slot]) => [
        id,
        Array.isArray(slot.off) ? { ...slot, off: [], offNames: { ...slot.offNames } } : slot
      ])
    );
    for (let [stageId, slot] of Object.entries(progress.slots || {}))
      if (Array.isArray(slot.off))
        for (let key of slot.off) {
          let uid = String(key).startsWith("@") ? String(key).slice(1) : slot.offIds?.[key] || (slot.offNames ? null : legacyMap[stageId]?.[key]);
          if (uid) {
            changed = !0;
            let hit = byUid.get(uid);
            if (hit) {
              let target = slots[hit.stageId] || { off: [], offNames: {} };
              slots[hit.stageId] = target, target.off ??= [], target.offNames ??= {}, target.off.push(hit.node.id), target.offNames[hit.node.id] = hit.node.name;
            }
          } else !slot.offNames && !slot.offIds && units.some((u) => u.id === stageId && stageNodes(u.stage.data).some((n) => n.item?.id)) && /^[msw]\d+$/.test(key) ? (dropped++, changed = !0) : slots[stageId].off.push(key);
        }
    if (!changed) return progress;
    for (let slot of Object.values(slots)) Array.isArray(slot.off) && (slot.off = [...new Set(slot.off)]);
    return { ...progress, slots, ...dropped ? { droppedLegacy: (progress.droppedLegacy || 0) + dropped } : {} };
  }
  function stampNodeIds(progress, volumes) {
    let changed = !1, byStage = new Map(
      flattenUnits(volumes).map((u) => [u.id, new Map(stageNodes(u.stage.data).map((n) => [n.id, n.item && n.item.id]))])
    ), slots = Object.fromEntries(
      Object.entries(progress.slots || {}).map(([stageId, slot]) => {
        if (!Array.isArray(slot.off)) return [stageId, slot];
        let ids = byStage.get(stageId), offIds = {};
        for (let key of slot.off) ids && ids.get(key) && (offIds[key] = ids.get(key));
        return JSON.stringify(offIds) === JSON.stringify(slot.offIds || {}) ? [stageId, slot] : (changed = !0, [stageId, { ...slot, offIds }]);
      })
    );
    return changed ? { ...progress, slots } : progress;
  }

  // src/ui/styles.js
  var CSS = `
.pi-root{--pi-accent:#E8507B;--pi-accent-soft:#FEF0F3;--pi-dark:#1E1E2E;--pi-bg:#FFFFFF;--pi-surf:#F3F4F7;--pi-fill:#F5F6F8;--pi-fill2:#ECEDF1;--pi-line:#ECECF1;--pi-rule:#C9CAD3;--pi-txt:#1E1E2E;--pi-txt2:#7C7C8A;--pi-ok:#2E9E6A;--pi-ok-soft:#E9F7F0;--pi-warn:#C98A12;--pi-warn-soft:#FDF5E4;--pi-danger:#D64545;--pi-danger-soft:#FDEDED;--pi-add:#E9F7F0;--pi-del:#FDEDED;--pi-on-dark:#FFFFFF;--pi-knob:#FFFFFF;--pi-user-bg:#1E1E2E;--pi-user-txt:#FFFFFF;--pi-user-txt2:#B4B4C0;--pi-user-hover:#34344A;--pi-r:14px;--pi-r-in:10px;--pi-shadow:0 8px 32px rgba(0,0,0,.15);--pi-font:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;--pi-mono:Consolas,"JetBrains Mono",monospace;font-family:var(--pi-font);color:var(--pi-txt);font-size:14px;line-height:1.55}
.pi-root.is-night{--pi-accent:#F0688F;--pi-accent-soft:#3A2230;--pi-dark:#E6E6EE;--pi-bg:#1F1F2A;--pi-surf:#16161F;--pi-fill:#282835;--pi-fill2:#313140;--pi-line:#2C2C38;--pi-rule:#4A4A5A;--pi-txt:#E6E6EE;--pi-txt2:#9A9AA8;--pi-ok:#4CC08A;--pi-ok-soft:#1C3329;--pi-warn:#E0A63A;--pi-warn-soft:#3A3020;--pi-danger:#EF6B6B;--pi-danger-soft:#3D2224;--pi-add:#1C3329;--pi-del:#3D2224;--pi-on-dark:#16161F;--pi-knob:#F4F4F8;--pi-user-bg:#3A3A4C;--pi-user-txt:#E6E6EE;--pi-user-txt2:#A8A8B6;--pi-user-hover:#4A4A5E;--pi-shadow:0 8px 32px rgba(0,0,0,.5);color-scheme:dark}
.pi-root *,.pi-root *::before,.pi-root *::after{box-sizing:border-box;text-shadow:none}
.pi-root ::-webkit-scrollbar{display:none}
.pi-root [hidden]{display:none!important}
.pi-root input[type=checkbox]{-webkit-appearance:none;appearance:none;display:inline-grid;place-content:center;width:16px;height:16px;margin:0;padding:0;border:0;outline:0;border-radius:4px;background:var(--pi-fill2);box-shadow:inset 0 0 0 1.5px var(--pi-rule);filter:none;transform:none;overflow:hidden;flex-shrink:0;cursor:pointer}
.pi-root input[type=checkbox]::before{content:"";width:10px;height:10px;transform:scale(0);transition:transform .12s;background:var(--pi-knob);box-shadow:none;clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)}
.pi-root input[type=checkbox]:checked{background:var(--pi-accent);box-shadow:none}
.pi-root input[type=checkbox]:checked::before{transform:scale(1)}
.pi-root input[type=checkbox]:disabled{opacity:.45;cursor:not-allowed}
.pi-root input[type=checkbox]:focus-visible{box-shadow:0 0 0 2px var(--pi-accent-soft),inset 0 0 0 1.5px var(--pi-accent)}
.pi-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(20,20,30,.28)}
.pi-panel{position:relative;width:880px;max-width:96vw;height:88vh;max-height:88vh;background:var(--pi-surf);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);display:grid;grid-template-columns:220px 1fr;overflow:hidden}
.pi-scrim{display:none}
.pi-side{background:var(--pi-bg);display:flex;flex-direction:column;min-height:0}
.pi-side-hd{padding:14px 14px 8px;font-weight:700;font-size:15px;color:var(--pi-dark);display:flex;align-items:center;gap:6px}
.pi-side-hd small{font-weight:400;color:var(--pi-txt2);font-size:11px}
.pi-side-hd .pi-spacer{flex:1}
.pi-icon-btn.is-on{color:var(--pi-accent);background:var(--pi-accent-soft)}
.pi-plist{flex:1;overflow-y:auto;padding:0 8px;scrollbar-width:none}
.pi-group{margin:6px 0}
.pi-group-hd{display:flex;align-items:center;gap:4px;width:100%;padding:4px 6px;border:0;background:none;color:var(--pi-txt2);font-size:12px;cursor:pointer;font-family:inherit}
.pi-group-hd small{margin-left:auto;font-size:11px}
.pi-group.is-collapsed .pi-pitem{display:none}
.pi-plist.is-searching .pi-group.is-collapsed .pi-pitem{display:flex}
.pi-psearch{position:relative;margin:0 8px 6px}
.pi-psearch.is-wb{margin:0 0 8px}
.pi-psearch.is-wb .pi-inp{padding-right:36px}
.pi-psearch .pi-search-x{position:absolute;right:4px;top:50%;transform:translateY(-50%)}
.pi-psearch>svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--pi-txt2);pointer-events:none}
.pi-psearch .pi-inp{padding-left:30px}
.pi-pitem{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:0;border-radius:var(--pi-r-in);background:none;color:var(--pi-txt);font-size:13px;text-align:left;cursor:pointer;font-family:inherit;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.pi-pitem:hover{background:var(--pi-surf)}
.pi-pitem.is-sel{background:var(--pi-accent-soft);color:var(--pi-accent);font-weight:600}
.pi-pitem .pi-dot{width:7px;height:7px;border-radius:50%;background:var(--pi-accent);flex-shrink:0}
.pi-pitem .pi-pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-side-ft{padding:8px;display:flex;flex-direction:column;gap:4px}
.pi-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.pi-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:10px 14px;background:var(--pi-bg)}
.pi-top-lead{grid-column:1;display:flex;align-items:center;gap:4px;min-width:0}
.pi-top-title{font-weight:700;color:var(--pi-dark);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-top-end{grid-column:3;justify-self:end;display:flex;align-items:center;gap:6px}
.pi-icon-btn{width:28px;height:28px;border:0;border-radius:8px;background:none;color:var(--pi-txt2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.pi-icon-btn:hover{color:var(--pi-dark);background:var(--pi-surf)}
.pi-icon-btn.is-danger:hover{color:var(--pi-danger);background:var(--pi-danger-soft)}
.pi-menu{display:none}
.pi-tabs{grid-column:2;display:grid;grid-auto-flow:column;grid-auto-columns:64px;gap:4px}
.pi-tab{text-align:center;padding:6px 0;border:0;border-radius:20px;background:none;color:var(--pi-txt2);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit}
.pi-tab:hover{color:var(--pi-dark)}
.pi-tab.is-sel{background:var(--pi-dark);color:var(--pi-on-dark)}
.pi-close{width:30px;height:30px;border:0;border-radius:50%;background:var(--pi-surf);color:var(--pi-txt2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pi-close:hover{color:var(--pi-dark)}
.pi-body{flex:1;overflow-y:auto;padding:14px;scrollbar-width:none;min-height:0}
.pi-body.is-chat{display:flex;flex-direction:column;overflow:hidden}
.pi-card{background:var(--pi-bg);border-radius:var(--pi-r);padding:14px 16px;margin-bottom:10px}
.pi-card h3{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--pi-dark);display:flex;align-items:center;gap:8px;min-height:26px}
.pi-card h3 .pi-meta{font-size:12px;font-weight:400;color:var(--pi-txt2)}
.pi-card h3 .pi-spacer{flex:1}
.pi-hint{font-size:12px;color:var(--pi-txt2);margin:4px 0}
.pi-hint.is-warn{color:var(--pi-warn);font-weight:600}
.pi-empty{text-align:center;color:var(--pi-txt2);padding:40px 10px;font-size:13px}
.pi-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pi-row>.pi-grow{flex:1;min-width:0}
.pi-field{display:flex;flex-direction:column;gap:3px;margin-bottom:8px;min-width:0}
.pi-field>span{font-size:12px;color:var(--pi-txt2);font-weight:500}
.pi-row.is-top{align-items:flex-start}
.pi-inline{display:flex;gap:8px;align-items:stretch}
.pi-inline>.pi-inp,.pi-inline>.pi-sel{flex:1;min-width:0}
.pi-inline>.pi-btn{min-height:0;flex-shrink:0;width:96px}
.pi-inline>.pi-grow{flex:1;min-width:0;display:flex}
.pi-inline>.pi-grow>.pi-inp,.pi-inline>.pi-grow>.pi-sel{flex:1;min-width:0}
.pi-equal,.pi-tools{display:grid;grid-template-columns:repeat(var(--pi-cols,3),minmax(0,1fr));gap:8px;align-items:stretch}
.pi-equal>.pi-btn,.pi-tools>.pi-btn{width:100%;padding:0 6px;white-space:normal;line-height:1.3}
.pi-equal.is-one,.pi-tools.is-c1{--pi-cols:1}
.pi-tools.is-c2{--pi-cols:2}
.pi-tools.is-c3{--pi-cols:3}
.pi-tools.is-c4{--pi-cols:4}
.pi-tools{margin:2px 0 10px}
.pi-tools.is-end{margin:10px 0 0}
.pi-tools>.pi-check{grid-column:1/-1;padding:0}
.pi-pair{display:grid;grid-template-columns:repeat(var(--pi-cols,2),minmax(0,1fr));gap:0 10px}
.pi-pair.is-c3{--pi-cols:3}
.pi-pair.is-c4{--pi-cols:4}
.pi-pair .pi-inp,.pi-pair .pi-sel{width:100%}
.pi-extra{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 28px;gap:0 8px;align-items:end}
.pi-extra .pi-inp,.pi-extra .pi-sel{width:100%}
.pi-extra .pi-field{margin-bottom:8px}
.pi-extra .pi-icon-btn{margin-bottom:8px;align-self:end;height:36px}
.pi-presets{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.pi-preset-pick{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:4px 0;border:0;background:none;color:inherit;cursor:pointer;text-align:left;font-family:inherit}
.pi-preset:hover{background:var(--pi-fill2)}
.pi-preset{display:flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;background:var(--pi-fill);border-radius:var(--pi-r-in);min-width:0}
.pi-preset-name{font-weight:600;font-size:13px;flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-preset-model{flex:1;min-width:0;font-size:12px;color:var(--pi-txt2);font-family:var(--pi-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-sec{margin-top:8px}
.pi-wb-sec-hd{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--pi-txt2);padding:4px 0;margin-bottom:2px}
.pi-wb-sec-hd small{font-weight:400}
.pi-wb-bulk{margin-left:auto;display:flex;gap:4px}
.pi-wb-bulk>.pi-btn{min-width:96px}
.pi-wb-sub{margin:4px 0 0 4px;padding-left:10px;border-left:2px solid var(--pi-line)}
.pi-wb-sub-hd{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--pi-txt2);padding:4px 0 2px}
.pi-wb-sub-hd small{font-weight:400}
.pi-wb-sub-hd.is-fold{cursor:pointer}
.pi-wb-item{min-width:0}
.pi-wb-name{flex:1;min-width:0;display:flex;align-items:center;gap:4px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
.pi-wb-name .pi-wb-title{flex:1}
.pi-wb-edit{margin:4px 0 10px 23px;padding:12px;background:var(--pi-fill);border-radius:var(--pi-r-in)}
.pi-wb-memo{display:inline-flex;align-items:center;gap:4px;font-weight:500;flex-shrink:0}
.pi-wb-memo{margin-left:auto;font-size:12px;color:var(--pi-txt2)}
.pi-wb-memo .pi-inp.is-num{width:52px;height:26px;padding:2px 6px;font-size:12px;text-align:center}
.pi-wb-sub-hd>input[type=checkbox],.pi-wb-sub-hd>.pi-wb-pad{width:15px;height:15px;margin:0;flex-shrink:0;accent-color:var(--pi-accent)}
.pi-fix{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:13px}
.pi-fix-text{flex:1;min-width:0}
.pi-fix-acts{display:grid;grid-template-columns:repeat(3,56px);gap:4px;flex-shrink:0}
.pi-fix-acts>.pi-btn{width:100%;padding:0}
.pi-ref-book+.pi-ref-book{margin-top:12px;padding-top:8px;border-top:1px solid var(--pi-line)}
.pi-ref-top{display:flex;align-items:center;gap:4px;margin:0 0 6px}
.pi-ref-top .pi-spacer{flex:1}
.pi-chip:disabled{opacity:.45;cursor:not-allowed}
.pi-wb-field{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-row{display:flex;align-items:center;gap:8px;padding:3px 0;min-width:0}
.pi-wb-row input{width:15px;height:15px;margin:0;accent-color:var(--pi-accent);flex-shrink:0;cursor:pointer}
.pi-switch{position:relative;flex-shrink:0;width:38px;height:22px;padding:0;border:0;border-radius:11px;background:var(--pi-fill2);cursor:pointer;transition:background .15s}
.pi-switch::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--pi-rule);transition:left .15s}
.pi-switch.is-on{background:var(--pi-accent)}
.pi-switch.is-on::after{left:19px;background:var(--pi-knob)}
.pi-switch:disabled{opacity:.6;cursor:wait}
.pi-wb-title{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-row.is-off .pi-wb-title{color:var(--pi-txt2)}
.pi-set-row{display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:8px;border-top:1px solid var(--pi-line);font-size:12px;color:var(--pi-txt2);font-weight:500}
.pi-set-row .pi-spacer{flex:1}
.pi-set-sub{margin-top:6px}
.pi-book{border-radius:var(--pi-r-in);margin:0 -6px}
.pi-book+.pi-book{margin-top:2px}
.pi-book-hd{display:flex;align-items:center;gap:8px;padding:9px 8px;border-radius:var(--pi-r-in);cursor:pointer}
.pi-book-hd:hover{background:var(--pi-fill)}
.pi-book-hd .pi-etitle{flex:1;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-book.is-open>.pi-book-hd{background:var(--pi-fill)}
.pi-book-bd{padding:6px 8px 10px}
.pi-meta{font-size:12px;color:var(--pi-txt2);white-space:nowrap}
.pi-tbar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.pi-tbtn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px 0 9px;border:0;border-radius:16px;background:var(--pi-fill);color:var(--pi-dark);font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.pi-tbtn svg{width:14px;height:14px;flex-shrink:0;color:var(--pi-txt2)}
.pi-tbtn:hover:not(:disabled){background:var(--pi-fill2)}
.pi-tbtn.is-danger,.pi-tbtn.is-danger svg{color:var(--pi-danger)}
.pi-tbtn.is-more{padding:0 9px;margin-left:auto}
.pi-tbtn:disabled{opacity:.4;cursor:not-allowed}
.pi-wb-info{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 0 8px}
.pi-wb-info.is-pick{gap:2px}
.pi-wb-info .pi-spacer{flex:1}
.pi-wb-tokens{display:contents}
.pi-wb-count{font-size:12px;font-weight:600;color:var(--pi-dark)}
.pi-menu-list{display:flex;flex-direction:column;gap:2px;max-height:360px;overflow-y:auto;margin:0 -6px}
.pi-menu-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 10px;border:0;border-radius:var(--pi-r-in);background:none;color:var(--pi-dark);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.pi-menu-item:hover{background:var(--pi-fill)}
.pi-menu-item svg{width:16px;height:16px;color:var(--pi-txt2);flex-shrink:0}
.pi-menu-item.is-danger,.pi-menu-item.is-danger svg{color:var(--pi-danger)}
.pi-menu-item>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
label.pi-wb-row{cursor:pointer}
.pi-acts{margin-top:12px}
.pi-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;background:var(--pi-surf);border-radius:20px;margin-bottom:6px}
.pi-seg-btn{padding:5px 6px;border:0;border-radius:16px;background:none;color:var(--pi-txt2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi-seg-btn.is-sel{background:var(--pi-bg);color:var(--pi-dark);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.pi-inp,.pi-sel{height:36px}
.pi-inp,.pi-sel,.pi-ta{width:100%;padding:7px 11px;border:1.5px solid transparent;border-radius:var(--pi-r-in);font-size:13px;color:var(--pi-txt);background:var(--pi-fill);outline:none;font-family:inherit}
.pi-inp:focus,.pi-sel:focus,.pi-ta:focus{border-color:var(--pi-accent);background:var(--pi-bg)}
.pi-inp.is-num{width:84px}
.pi-ta{resize:vertical;min-height:80px;line-height:1.6}
.pi-ta.is-mono{font-family:var(--pi-mono);font-size:12px;line-height:1.5}
.pi-ta.is-tall{min-height:360px}
.pi-btn{min-height:32px;padding:0 14px;border:0;border-radius:20px;background:var(--pi-fill);color:var(--pi-dark);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;font-family:inherit}
.pi-btn:hover{background:var(--pi-fill2)}
.pi-btn:active{transform:scale(.97)}
.pi-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.pi-btn.is-primary{background:var(--pi-dark);color:var(--pi-on-dark)}
.pi-btn.is-primary:hover{opacity:.86}
.pi-btn.is-danger{color:var(--pi-danger);background:var(--pi-danger-soft)}
.pi-btn.is-danger:hover{background:var(--pi-danger-soft);opacity:.8}
.pi-btn.is-ghost{background:none;color:var(--pi-txt2)}
.pi-btn.is-ghost:hover{color:var(--pi-dark);background:var(--pi-fill)}
.pi-btn.is-ghost.is-danger{color:var(--pi-danger)}
.pi-btn.is-sm{min-height:26px;padding:0 10px;font-size:12px}
.pi-btn.is-block{width:100%;justify-content:flex-start}
.pi-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:var(--pi-fill);color:var(--pi-txt2);white-space:nowrap}
.pi-badge.is-accent{background:var(--pi-accent-soft);color:var(--pi-accent)}
.pi-badge.is-ok{background:var(--pi-ok-soft);color:var(--pi-ok)}
.pi-badge.is-warn{background:var(--pi-warn-soft);color:var(--pi-warn)}
.pi-badge.is-danger{background:var(--pi-danger-soft);color:var(--pi-danger)}
.pi-badge.is-dark{background:var(--pi-dark);color:var(--pi-on-dark)}
.pi-check{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:13px;cursor:pointer}
.pi-check input{width:15px;height:15px;margin-top:3px;accent-color:var(--pi-accent);flex-shrink:0;cursor:pointer}
.pi-wbkind{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:6px 0;border-bottom:1px solid var(--pi-line)}
.pi-wbkind>span{flex:1 1 100%;font-size:13px}
.pi-wbkind .pi-check{padding:0}
.pi-prebuild-row{padding:8px 0;border-bottom:1px solid var(--pi-line)}
.pi-prebuild-row.is-warn{background:var(--pi-warn-soft);margin:0 -8px;padding:8px;border-radius:var(--pi-r-in)}
.pi-fr-warn:empty{display:none}
/* 线索标签弹窗：开头一段白话说明、每条线索先说清是什么（雾港实测：第一次看到弹窗不知道在填什么）。 */
.pi-fr-intro{background:var(--pi-surf);border-radius:var(--pi-r-in);padding:10px 12px;margin:0 0 10px;font-size:12.5px;line-height:1.65;color:var(--pi-txt)}
.pi-fr-intro p{margin:0 0 6px}
.pi-fr-intro p:last-child{margin-bottom:0}
.pi-fr-intro .is-example{color:var(--pi-txt2)}
.pi-fr-title{margin:14px 0 6px;font-size:13px;font-weight:600;color:var(--pi-dark)}
.pi-fr-more{margin:0 0 10px}
.pi-fr-more summary{cursor:pointer}
/* 折叠的箭头（用户 2026-11-08：浏览器自带的小三角不好看）：所有 <summary> 换成「»」，展开时转 90°。 */
.pi-root summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none}
.pi-root summary::-webkit-details-marker{display:none}
.pi-root summary::marker{content:""}
.pi-root summary::before{content:"»";flex:none;display:inline-block;width:12px;text-align:center;font-size:14px;line-height:1;color:var(--pi-txt2);transition:transform .15s ease}
.pi-root details[open]>summary::before{transform:rotate(90deg)}
.pi-root summary:hover::before{color:var(--pi-accent)}
@media (prefers-reduced-motion:reduce){.pi-root summary::before{transition:none}}
/* 标黄的说明：前面一个黄色圆圈问号（代替「·」）。 */
.pi-warn-line{display:flex;align-items:flex-start;gap:6px;margin:4px 0;font-size:12px;font-weight:600;color:var(--pi-warn);line-height:1.5}
.pi-note-line{margin:4px 0;font-size:12px;color:var(--pi-txt2);line-height:1.5}
.pi-line-row{padding:8px 0;border-top:1px solid var(--pi-line)}
.pi-line-row:first-of-type{border-top:0}
.pi-line-row .pi-row{flex-wrap:wrap;gap:6px}
.pi-line-opts{flex-wrap:wrap;gap:6px 16px;margin:4px 0 6px}
.pi-line-opts .pi-check{align-items:center;gap:6px}
.pi-line-opts .pi-check>span{white-space:nowrap}
.pi-line-opts .pi-sel{width:auto;min-width:0}
.pi-note-line::before{content:"备注：";font-weight:600}
.pi-warn-line::before{content:"?";flex:none;width:15px;height:15px;margin-top:1px;border:1.5px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;line-height:1;box-sizing:border-box}
.pi-fr-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.pi-fr-hd .pi-meta{font-size:11px;color:var(--pi-txt2);font-family:var(--pi-mono)}
.pi-fr-answer{margin:0 0 6px;padding:6px 10px;border-left:3px solid var(--pi-rule);font-size:12px;color:var(--pi-txt);background:var(--pi-fill);border-radius:0 6px 6px 0}
.pi-fr-answer .pi-meta{color:var(--pi-txt2);font-size:11px}
.pi-check.is-off{color:var(--pi-txt2);text-decoration:line-through}
.pi-entry{border-radius:var(--pi-r-in);margin-bottom:6px;background:var(--pi-fill)}
:is(.pi-entry,.pi-node,.pi-wb-edit) :is(.pi-inp,.pi-sel,.pi-ta,.pi-pre,.pi-badge,.pi-btn:not(.is-primary):not(.is-ghost):not(.is-danger)){background:var(--pi-bg)}
:is(.pi-entry,.pi-node,.pi-wb-edit) .pi-btn:not(.is-primary):not(.is-ghost):not(.is-danger):hover{background:var(--pi-fill2)}
.pi-entry.is-off{opacity:.55}
.pi-entry-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer}
.pi-entry-hd .pi-meta{font-size:12px;color:var(--pi-txt2);white-space:nowrap}
.pi-entry-hd .pi-pos{font-size:11px;font-weight:600;color:var(--pi-txt2);background:var(--pi-bg);border-radius:6px;padding:1px 6px;white-space:nowrap}
.pi-entry-hd .pi-etitle{flex:1;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-entry-bd{padding:2px 12px 12px}
.pi-pre{white-space:pre-wrap;word-break:break-word;font-family:var(--pi-mono);font-size:12px;line-height:1.5;background:var(--pi-surf);border-radius:var(--pi-r-in);padding:8px 10px;max-height:320px;overflow:auto;margin:6px 0 0}
.pi-tl-vol{font-size:12px;font-weight:600;color:var(--pi-txt2);margin:12px 0 4px}
.pi-tl-vol:first-child{margin-top:4px}
.pi-tl{position:relative}
.pi-tl-item{position:relative;padding:0 0 4px 26px}
.pi-tl-item::before{content:"";position:absolute;left:8px;top:22px;bottom:-4px;border-left:2px dashed var(--pi-rule)}
.pi-tl-item:last-child::before{display:none}
.pi-tl-item.is-done::before{border-left-style:solid;border-left-color:var(--pi-txt2)}
.pi-tl-dot{position:absolute;left:1px;top:9px;width:16px;height:16px;border-radius:50%;border:3px solid var(--pi-rule);background:var(--pi-bg)}
.pi-tl-item.is-done .pi-tl-dot{border-color:var(--pi-txt2);background:var(--pi-txt2)}
.pi-tl-item.is-next .pi-tl-dot{border-color:var(--pi-dark)}
.pi-tl-item.is-active .pi-tl-dot{border-color:var(--pi-accent);box-shadow:0 0 0 4px var(--pi-accent-soft)}
.pi-tl-box{border-radius:var(--pi-r-in);padding:0 4px 0 10px}
.pi-tl-item.is-active .pi-tl-box{background:var(--pi-fill);padding-bottom:8px}
.pi-tl-hd{display:flex;align-items:center;gap:8px;min-height:34px}
.pi-tl-name{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-tl-item.is-done .pi-tl-name{color:var(--pi-txt2)}
.pi-tl-item.is-active .pi-tl-name{font-weight:600}
.pi-tl-state{font-size:12px;color:var(--pi-txt2);white-space:nowrap}
.pi-tl-item.is-active .pi-tl-state{color:var(--pi-accent);font-weight:600}
.pi-tl-nodes{padding:0 4px 0 2px}
.pi-tl-nodes .pi-badge{background:var(--pi-bg)}
.pi-tl-nodes .pi-hint{margin:6px 0 2px}
.pi-tree{display:grid;grid-template-columns:220px 1fr;gap:10px;align-items:start}
.pi-tree-list{background:var(--pi-bg);border-radius:var(--pi-r);padding:8px;max-height:calc(88vh - 140px);overflow-y:auto;scrollbar-width:none}
.pi-titem{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-radius:8px;background:none;text-align:left;font-size:13px;color:var(--pi-txt);cursor:pointer;font-family:inherit}
.pi-titem:hover{background:var(--pi-surf)}
.pi-titem.is-sel{background:var(--pi-accent-soft);color:var(--pi-accent);font-weight:600}
.pi-titem.is-vol{font-weight:700;color:var(--pi-dark)}
.pi-titem.is-stage{padding-left:18px}
.pi-titem .pi-pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-node{background:var(--pi-fill);border-radius:var(--pi-r-in);padding:10px 12px;margin-bottom:8px}
.pi-pace{display:flex;align-items:center;gap:10px;margin:0 0 10px}
.pi-pace-label{font-size:12px;color:var(--pi-txt2);font-weight:500;flex-shrink:0}
.pi-pace .pi-seg{flex:1;margin:0}
.pi-node-seg{margin:0 0 10px}
.pi-node-hd{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.pi-node-hd .pi-grow{flex:1}
.pi-node-hd>.pi-btn{min-width:60px}
.pi-chat{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;scrollbar-width:none;min-height:0}
.pi-msg{max-width:86%;padding:9px 12px;border-radius:var(--pi-r);background:var(--pi-bg);font-size:13px;line-height:1.65;word-break:break-word}
.pi-md>:first-child{margin-top:0}
.pi-md>:last-child{margin-bottom:0}
.pi-md p{margin:0 0 8px}
.pi-md-h{font-weight:700;margin:12px 0 6px;line-height:1.4}
.pi-md-h.is-h1{font-size:16px}
.pi-md-h.is-h2{font-size:15px}
.pi-md-h.is-h3,.pi-md-h.is-h4{font-size:14px}
.pi-md ul,.pi-md ol{margin:0 0 8px;padding-left:20px}
.pi-md li.is-sub{margin-left:16px}
.pi-md blockquote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:3px solid var(--pi-line);color:var(--pi-txt2)}
.pi-md hr{border:0;border-top:1px solid var(--pi-line);margin:10px 0}
.pi-md code{font-family:var(--pi-mono);font-size:12px;line-height:inherit;color:var(--pi-txt);background:var(--pi-fill2);border:0;border-radius:4px;padding:1px 4px}
.pi-md .pi-pre{margin:0 0 8px}
.pi-md-table{overflow-x:auto;margin:0 0 8px}
.pi-md table{border-collapse:collapse;font-size:12px}
.pi-md th,.pi-md td{border:1px solid var(--pi-line);padding:4px 8px;text-align:left}
.pi-md th{background:var(--pi-surf)}
.pi-msg.is-user .pi-md code,.pi-msg.is-user .pi-md th,.pi-msg.is-user .pi-md .pi-pre{background:var(--pi-user-hover);color:var(--pi-user-txt)}
.pi-msg.is-user .pi-md blockquote{color:var(--pi-user-txt2);border-color:var(--pi-user-hover)}
.pi-msg.is-user .pi-md th,.pi-msg.is-user .pi-md td{border-color:var(--pi-user-hover)}
.pi-msg.is-user{align-self:flex-end;background:var(--pi-user-bg);color:var(--pi-user-txt)}
.pi-msg.is-ai{align-self:flex-start}
.pi-msg-tools{display:flex;gap:2px;margin-top:6px;flex-wrap:wrap}
.pi-msg.is-user .pi-btn.is-ghost{color:var(--pi-user-txt2)}
.pi-msg.is-user .pi-btn.is-ghost:hover{color:var(--pi-user-txt);background:var(--pi-user-hover)}
.pi-msg-fold{align-self:center;font-size:12px;color:var(--pi-txt2);background:var(--pi-bg);border-radius:20px;padding:4px 12px}
.pi-compose{display:flex;gap:8px;align-items:center;padding-top:8px}
.pi-compose .pi-ta{flex:1;height:44px;min-height:44px;resize:none;padding:10px 12px;line-height:1.5;background:var(--pi-bg)}
.pi-send{width:40px;height:40px;border:0;border-radius:50%;background:var(--pi-dark);color:var(--pi-on-dark);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.pi-send:hover{opacity:.86}
.pi-send:active{transform:scale(.95)}
.pi-send:disabled{opacity:.45;cursor:not-allowed;transform:none}
.pi-refs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.pi-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border:0;border-radius:20px;font-size:12px;cursor:pointer;background:var(--pi-bg);color:var(--pi-txt2);font-family:inherit}
.pi-card .pi-chip{background:var(--pi-fill)}
.pi-compose-side{width:40px;height:40px;border:0;border-radius:50%;background:var(--pi-bg);color:var(--pi-txt2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.pi-compose-side:hover{color:var(--pi-danger);background:var(--pi-danger-soft)}
.pi-block-chip{padding:0 4px 0 0;gap:0}
.pi-block-chip>button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:3px 4px 3px 10px}
.pi-block-chip>.pi-block-del{padding:3px 4px;display:inline-flex;align-items:center;opacity:.6}
.pi-block-chip>.pi-block-del svg{width:10px;height:10px}
.pi-block-chip>.pi-block-del:hover{opacity:1;color:var(--pi-danger)}
.pi-block-chip>.pi-block-eye{padding:3px 2px;display:inline-flex;align-items:center;opacity:.6}
.pi-block-chip>.pi-block-eye svg{width:12px;height:12px}
.pi-block-chip>.pi-block-eye:hover{opacity:1}
.pi-block-chip.is-mute{color:var(--pi-rule)}
.pi-block-chip.is-mute>button:first-child{text-decoration:line-through}
.pi-chip.is-on{color:var(--pi-accent);background:var(--pi-accent-soft)}
.pi-diff{font-family:var(--pi-mono);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:var(--pi-surf);border-radius:var(--pi-r-in);padding:6px 0;max-height:360px;overflow:auto}
.pi-diff div{padding:0 10px}
.pi-diff .is-add{background:var(--pi-add)}
.pi-diff .is-del{background:var(--pi-del);text-decoration:line-through;color:var(--pi-txt2)}
.pi-toc{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.pi-files{width:100%;border-collapse:collapse;font-size:12px}
.pi-files td,.pi-files th{padding:6px 4px;border-bottom:1px solid var(--pi-line);text-align:left}
.pi-files th{color:var(--pi-txt2);font-weight:600}
.pi-files .is-missing{color:var(--pi-danger)}
.pi-diag-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--pi-line);font-size:12px}
.pi-diag-row:last-child{border-bottom:0}
.pi-diag-text{flex:1;min-width:0}
.pi-copy-box{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0}
.pi-status{font-size:12px;color:var(--pi-txt2);min-height:1em}
.pi-status.is-err{color:var(--pi-danger)}
.pi-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:pi-spin .8s linear infinite}
@keyframes pi-spin{to{transform:rotate(360deg)}}
.pi-dialog{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:10060;display:flex;align-items:center;justify-content:center;background:rgba(20,20,30,.28)}
.pi-dialog-box{width:440px;max-width:92vw;max-height:80vh;overflow-y:auto;background:var(--pi-bg);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);padding:16px;scrollbar-width:none}
.pi-dialog-box h4{margin:0 0 8px;font-size:15px;color:var(--pi-dark)}
.pi-dialog-box .pi-dlg-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pi-dialog-box .pi-dlg-acts>.pi-btn{min-width:88px}
.pi-dialog-box ul{margin:6px 0;padding-left:18px;font-size:12px;color:var(--pi-txt2);max-height:200px;overflow-y:auto}
.pi-notices{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:10040;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;gap:8px;padding:16px;box-sizing:border-box;pointer-events:none}
.pi-unoffered-tip{display:block;font-size:11px;color:var(--pi-txt2);margin-top:2px}
.pi-topbar{position:fixed;left:50%;transform:translateX(-50%);z-index:10050;width:min(400px,calc(100vw - 16px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)));box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;background:var(--pi-bg);color:var(--pi-txt);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);font-size:13px;margin-top:6px}
.pi-topbar-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--pi-accent)}
.pi-topbar-body{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}
.pi-topbar-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--pi-dark)}
.pi-topbar-tag{font-size:11px;color:var(--pi-txt2)}
.pi-topbar-acts{flex:none;display:flex;gap:6px}
.pi-topbar-acts .pi-btn{min-width:52px}
.pi-topbar-act.is-armed{color:var(--pi-danger);background:var(--pi-danger-soft)}
@media (max-width:600px){.pi-topbar{font-size:14px}.pi-topbar-acts .pi-btn.is-sm{min-height:32px;font-size:13px}}
.pi-line-acts{flex-wrap:wrap;gap:6px;margin-top:4px}
.pi-lr-nav{gap:6px;margin:6px 0;align-items:center}
.pi-lr-item{border-top:1px solid var(--pi-line);padding:8px 0;display:flex;flex-direction:column;gap:6px}
.pi-lr-item.is-dropped>*:not(.pi-row){opacity:.55}
.pi-lr-item .pi-row{flex-wrap:wrap;gap:6px}
.pi-lr-item .pi-row>b{min-width:0;overflow-wrap:anywhere}
.pi-lr-win{flex-wrap:wrap;gap:6px;align-items:center}
.pi-lr-last{opacity:.7}
@media (max-width:600px){.pi-lr-nav .pi-btn{min-height:40px;padding:0 14px;font-size:14px}.pi-lr-item .pi-inp,.pi-lr-item .pi-ta,.pi-lr-item .pi-sel{font-size:16px}}
.pi-notice{pointer-events:auto;width:340px;max-width:100%;background:var(--pi-bg);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);padding:12px 14px;border-left:4px solid var(--pi-accent)}
.pi-notice b{display:block;font-size:13px;color:var(--pi-dark);margin-bottom:3px}
.pi-notice p{margin:0 0 8px;font-size:12px;color:var(--pi-txt2)}
.pi-notice .pi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:6px}
.pi-notice .pi-row>.pi-btn{width:100%;padding:0 6px}
@media (max-width:720px){
.pi-overlay{align-items:stretch}
.pi-panel{grid-template-columns:minmax(0,1fr);width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:none;border-radius:0}
.pi-side{position:absolute;top:0;left:0;bottom:0;width:min(280px,82vw);z-index:2;transform:translateX(-100%);transition:transform .2s ease;box-shadow:var(--pi-shadow)}
.pi-panel.is-drawer .pi-side{transform:none}
.pi-panel.is-drawer .pi-scrim{display:block;position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;background:rgba(20,20,30,.28)}
.pi-menu{display:inline-flex}
.pi-top{grid-template-columns:minmax(0,1fr) auto;row-gap:8px}
.pi-top-end{grid-column:2}
.pi-tabs{grid-column:1/-1;grid-row:2;grid-auto-columns:1fr}
.pi-tree{grid-template-columns:minmax(0,1fr)}
.pi-entry-hd{flex-wrap:wrap}
.pi-wb .pi-entry-hd{flex-wrap:nowrap}
.pi-card h3{flex-wrap:wrap}
.pi-tools.is-c4{--pi-cols:2}
.pi-tools.pi-outline-tools{--pi-cols:3}
.pi-tree-list{max-height:220px}
.pi-msg{max-width:94%}
.pi-body{padding:10px}
.pi-notices{justify-content:flex-start;align-items:stretch;padding:calc(10px + env(safe-area-inset-top,0px)) 10px 10px}
.pi-notice{width:auto}
.pi-dialog{align-items:flex-start;box-sizing:border-box;padding-top:calc(56px + env(safe-area-inset-top,0px))}
.pi-dialog-box{max-height:calc(100dvh - 80px)}
}
/* wb-tools v0.1.23 */
.pi-wb-sort{display:flex;align-items:center;gap:8px;margin:0 0 8px}
.pi-wb-sort .pi-sel{width:auto;min-width:0}
.pi-wb-adv{display:flex;align-items:center;gap:6px;width:100%;padding:6px 0;border:0;background:none;color:var(--pi-txt2);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.pi-wb-adv-bd{display:flex;flex-direction:column;gap:8px}
.pi-wb-hit{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--pi-r-in);background:var(--pi-fill);margin:4px 0}
.pi-wb-hit .pi-wb-title{flex:1;min-width:0}
.pi-wb-hit>.pi-sel{flex:0 0 auto;width:auto;background:var(--pi-bg)}
.pi-wb-hit .pi-wb-title>small{color:var(--pi-txt2);font-size:12px}
.pi-wb-hit .pi-meta{max-width:60%;overflow:hidden;text-overflow:ellipsis}
.pi-dlg-body .pi-menu-item .pi-meta{max-width:50%;overflow:hidden;text-overflow:ellipsis}
/* /wb-tools v0.1.23 */
/* outline v0.1.23 */
.pi-ov-stage{display:flex;flex-direction:column;gap:2px;width:100%;margin:0 0 6px;padding:8px 10px;border:0;border-radius:var(--pi-r-in);background:var(--pi-fill);color:var(--pi-txt);text-align:left;font-family:inherit;font-size:13px;cursor:pointer}
.pi-ov-stage:hover{background:var(--pi-fill2)}
.pi-ov-stage.is-active{background:var(--pi-accent-soft);color:var(--pi-accent)}
.pi-ov-stage.is-done{color:var(--pi-txt2)}
.pi-ov-title{font-weight:600}
.pi-ov-node{white-space:normal}
.pi-ov-stage.is-active .pi-meta{color:var(--pi-accent)}
.pi-block{display:block}
.pi-hist{display:flex;align-items:center;gap:8px;padding:6px 0}
.pi-hist>.pi-grow{flex:1;min-width:0;overflow-wrap:anywhere}
.pi-hist-n{flex-shrink:0;white-space:nowrap}
.pi-titem.is-issue{align-items:flex-start}
.pi-titem.is-issue .pi-pname{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.5}
.pi-vitem{padding:8px 10px;margin:0 0 6px;border-radius:var(--pi-r-in);background:var(--pi-fill)}
.pi-vitem .pi-ta{background:var(--pi-bg)}
.pi-vrow{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--pi-dark)}
.pi-vrow>.pi-grow{flex:1;min-width:0;overflow-wrap:anywhere}
.pi-vitem .pi-hint{margin:6px 0 0}
.pi-err{margin:2px 0 6px}
.pi-err>summary{font-size:12px;color:var(--pi-txt2);cursor:pointer}
.pi-err .pi-meta{margin-top:2px;overflow-wrap:anywhere}
.pi-node .pi-play>summary{font-size:12px;font-weight:500;color:var(--pi-txt2)}
.pi-menu-item:disabled{opacity:.4;cursor:default;pointer-events:none}
/* /outline v0.1.23 */
/* threads v0.1.23 */
.pi-hook{display:flex;align-items:center;gap:6px}
.pi-node-row{display:flex;align-items:center;gap:8px;min-height:32px;font-size:13px}
.pi-node-name{flex:1;min-width:0}
.pi-node-row.is-off,.pi-node-row.is-off .pi-badge,.pi-node-row.is-quiet{color:var(--pi-txt2)}
.pi-tl-nodes .pi-kind.is-main{background:var(--pi-dark);color:var(--pi-on-dark)}
.pi-tl-nodes .pi-kind.is-side{background:var(--pi-bg);color:var(--pi-txt)}
.pi-tl-nodes .pi-kind.is-world{background:transparent;color:var(--pi-txt2);padding-left:0;padding-right:0}
.pi-tl-nodes .pi-node-row.is-off .pi-kind{background:var(--pi-fill2);color:var(--pi-txt2)}
.pi-node-row.is-off .pi-node-txt{text-decoration:line-through}
.pi-hook>.pi-node-row{flex:1;min-width:0}
.pi-meta-btn{min-height:32px;min-width:40px;padding:0 2px;border:0;background:none;font:inherit;font-size:12px;cursor:pointer;color:var(--pi-txt2);text-align:right}
.pi-meta-btn.is-dot{display:inline-flex;align-items:center;gap:5px}
.pi-meta-btn.is-dot::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--pi-accent)}
.pi-check.is-quiet{color:var(--pi-txt2)}
.pi-pace-cell{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 10px;border-radius:20px;background:var(--pi-surf);font-size:12px;font-weight:600;color:var(--pi-txt2)}
.pi-pace .pi-pair{flex:1;gap:6px}
.pi-pace-label{min-width:56px}
.pi-clock{width:100%;border:0;background:none;color:var(--pi-txt);font:inherit;font-size:13px;font-weight:400;text-align:left;align-items:center}
.pi-clock-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-clock-dots{display:inline-flex;gap:3px}
.pi-clock-dots i{width:6px;height:6px;border-radius:50%;background:var(--pi-rule)}
.pi-clock-dots i.is-on{background:var(--pi-dark)}
.pi-play{margin-top:4px}
.pi-play>summary{font-size:12px;font-weight:600;color:var(--pi-txt2);cursor:pointer;padding:4px 0}
/* /threads v0.1.23 */

.pi-tools.is-c5{--pi-cols:5}
/* 酒馆主题会全局改 textarea / select / input：半透明黑底、自己的边框、下拉箭头、占位字颜色，不少美化主题还带 !important
   （实测「双色盒子-深色毛玻璃」：背景和边框都是 !important）。插件里的输入框要跟插件的明暗配色走，所以这几项也用 !important 重设，只作用于插件自己的输入框。 */
.pi-root :is(textarea.pi-ta,input.pi-inp,select.pi-sel){background-color:var(--pi-fill)!important;background-image:none;color:var(--pi-txt)!important;border:1.5px solid var(--pi-line)!important;border-radius:var(--pi-r-in)!important;box-shadow:none!important;margin:0!important;max-height:none;font-family:var(--pi-font);font-size:13px;-webkit-text-fill-color:currentColor;backdrop-filter:none!important}
.pi-root :is(textarea.pi-ta,input.pi-inp,select.pi-sel):hover{border-color:var(--pi-rule)!important}
.pi-root textarea.pi-ta.is-mono{font-family:var(--pi-mono);font-size:12px}
.pi-root .pi-wb-memo input.pi-inp.is-num{font-size:12px}
.pi-root :is(.pi-entry,.pi-node,.pi-wb-edit,.pi-compose) :is(textarea.pi-ta,input.pi-inp,select.pi-sel){background-color:var(--pi-bg)!important}
.pi-root :is(textarea.pi-ta,input.pi-inp)[readonly]{background-color:var(--pi-surf)!important}
.pi-root :is(textarea.pi-ta,input.pi-inp,select.pi-sel):focus{border-color:var(--pi-accent)!important;background-color:var(--pi-bg)!important;outline:none}
.pi-root select.pi-sel{-webkit-appearance:none;appearance:none;padding-right:30px;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237C7C8A' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:10px 6px!important}
.pi-root select.pi-sel option{background-color:var(--pi-bg)!important;color:var(--pi-txt)!important}
.pi-root :is(textarea.pi-ta,input.pi-inp)::placeholder{color:var(--pi-txt2)!important;opacity:.75;-webkit-text-fill-color:var(--pi-txt2)}
.pi-root :is(textarea.pi-ta,input.pi-inp):focus::placeholder{color:transparent!important;-webkit-text-fill-color:transparent}
.pi-imp-stage{border-top:1px solid var(--pi-line);padding:8px 0}
.pi-wbkind{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:6px 0;border-bottom:1px solid var(--pi-line)}
.pi-wbkind>span{flex:1 1 100%;font-size:13px}
.pi-wbkind .pi-check{padding:0}
.pi-prebuild-row{padding:8px 0;border-bottom:1px solid var(--pi-line)}
.pi-prebuild-row.is-warn{background:var(--pi-warn-soft);margin:0 -8px;padding:8px;border-radius:var(--pi-r-in)}
.pi-fr-warn:empty{display:none}
/* 线索标签弹窗：开头一段白话说明、每条线索先说清是什么（雾港实测：第一次看到弹窗不知道在填什么）。 */
.pi-fr-intro{background:var(--pi-surf);border-radius:var(--pi-r-in);padding:10px 12px;margin:0 0 10px;font-size:12.5px;line-height:1.65;color:var(--pi-txt)}
.pi-fr-intro p{margin:0 0 6px}
.pi-fr-intro p:last-child{margin-bottom:0}
.pi-fr-intro .is-example{color:var(--pi-txt2)}
.pi-fr-title{margin:14px 0 6px;font-size:13px;font-weight:600;color:var(--pi-dark)}
.pi-fr-more{margin:0 0 10px}
.pi-fr-more summary{cursor:pointer}
/* 折叠的箭头（用户 2026-11-08：浏览器自带的小三角不好看）：所有 <summary> 换成「»」，展开时转 90°。 */
.pi-root summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none}
.pi-root summary::-webkit-details-marker{display:none}
.pi-root summary::marker{content:""}
.pi-root summary::before{content:"»";flex:none;display:inline-block;width:12px;text-align:center;font-size:14px;line-height:1;color:var(--pi-txt2);transition:transform .15s ease}
.pi-root details[open]>summary::before{transform:rotate(90deg)}
.pi-root summary:hover::before{color:var(--pi-accent)}
@media (prefers-reduced-motion:reduce){.pi-root summary::before{transition:none}}
/* 标黄的说明：前面一个黄色圆圈问号（代替「·」）。 */
.pi-warn-line{display:flex;align-items:flex-start;gap:6px;margin:4px 0;font-size:12px;font-weight:600;color:var(--pi-warn);line-height:1.5}
.pi-warn-line::before{content:"?";flex:none;width:15px;height:15px;margin-top:1px;border:1.5px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;line-height:1;box-sizing:border-box}
.pi-fr-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.pi-fr-hd .pi-meta{font-size:11px;color:var(--pi-txt2);font-family:var(--pi-mono)}
.pi-fr-answer{margin:0 0 6px;padding:6px 10px;border-left:3px solid var(--pi-rule);font-size:12px;color:var(--pi-txt);background:var(--pi-fill);border-radius:0 6px 6px 0}
.pi-fr-answer .pi-meta{color:var(--pi-txt2);font-size:11px}
/* 展开后整段显示，由面板主体滚动（导入审阅页实测：限高 320px 且滚动条隐藏，看起来像内容被截断）。 */
.pi-pre.is-full{max-height:none;overflow:visible}
/* 仍然限高的代码框：显示细滚动条，让人看得出里面还能滚。 */
.pi-root .pi-pre:not(.is-full){scrollbar-width:thin}
.pi-root .pi-pre:not(.is-full)::-webkit-scrollbar{display:block;width:6px;height:6px}
.pi-root .pi-pre:not(.is-full)::-webkit-scrollbar-thumb{background:var(--pi-rule);border-radius:3px}
.pi-clue-fields{margin-top:6px}
.pi-clue-fields>summary{cursor:pointer}
.pi-clue-stage{margin:8px 0 12px;padding:0 0 0 10px;border-left:3px solid var(--pi-rule)}
.pi-clue-stage.is-active{border-left-color:var(--pi-accent)}
.pi-clue-stage.is-done{border-left-color:var(--pi-txt2);opacity:.8}
.pi-clue-node{background:var(--pi-fill);border-radius:var(--pi-r-in);padding:4px 8px;margin:4px 0}
.pi-clue-node.is-focus{box-shadow:inset 0 0 0 2px var(--pi-accent)}
.pi-clue-hd{display:flex;align-items:center;gap:8px;min-height:30px;cursor:pointer}
.pi-clue-name{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-clue-why{margin:2px 0 4px;padding-left:20px;font-size:12px;color:var(--pi-txt2)}
.pi-hint.is-off{opacity:.5;text-decoration:line-through}
/* 新手教程（41a_ui_tour.js）：遮罩挖一个洞亮出目标，旁边一个气泡。层级在面板（10050）之上、弹窗（10060）之下。 */
.pi-tour{position:fixed;inset:0;z-index:10055;isolation:isolate}
.pi-tour-mask{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto}
.pi-tour-mask path{fill:rgba(10,10,18,.72)}
.pi-tour-hole{position:fixed;border:2px solid var(--pi-accent);border-radius:10px;box-shadow:0 0 0 4px var(--pi-accent-soft);pointer-events:none;transition:left .18s,top .18s,width .18s,height .18s}
.pi-tour-pop{position:fixed;width:min(320px,calc(100vw - 24px));background:var(--pi-bg);color:var(--pi-txt);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.pi-tour-hd{display:flex;align-items:center;gap:8px}
.pi-tour-icon{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--pi-accent);color:var(--pi-accent);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1}
.pi-tour-title{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--pi-dark)}
.pi-tour-x{flex:none;width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--pi-txt2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.pi-tour-x:hover{color:var(--pi-dark);background:var(--pi-surf)}
.pi-tour-body{margin:0;font-size:13px;line-height:1.65;color:var(--pi-txt)}
.pi-tour-ft{display:flex;align-items:center;gap:8px}
.pi-tour-count{font-size:12px;color:var(--pi-txt2);font-variant-numeric:tabular-nums}
.pi-tour-btn{font-size:14px;font-weight:700}
@media (prefers-reduced-motion:reduce){.pi-tour-hole{transition:none}}
/* 复选框（用户 2026-11-08）：酒馆主题会改 input[type=checkbox] 的底色、阴影边框和 ::before 勾选色，插件里的复选框跟着变。
   换成插件自己画的：圆角方框，勾选时填插件强调色、白色对勾（内嵌 SVG，小尺寸也清楚）；亮暗两种模式都跟随插件配色。只作用于插件面板。 */
.pi-root:not(#pi-x) input[type=checkbox]{-webkit-appearance:none!important;appearance:none!important;width:16px!important;height:16px!important;min-width:16px;margin:2px 0 0!important;padding:0!important;border:1.5px solid var(--pi-rule)!important;border-radius:4px!important;background:var(--pi-bg)!important;box-shadow:none!important;filter:none!important;transform:none!important;display:inline-grid!important;place-content:center;cursor:pointer;flex-shrink:0;vertical-align:middle;transition:background-color .12s,border-color .12s}
.pi-root:not(#pi-x) input[type=checkbox]::before{content:none!important;display:none!important}
.pi-root:not(#pi-x) input[type=checkbox]:checked{background:var(--pi-accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.4l3 3 6-6.4' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px 12px no-repeat!important;border-color:var(--pi-accent)!important}
.pi-root:not(#pi-x) input[type=checkbox]:hover:not(:disabled){border-color:var(--pi-accent)!important}
.pi-root:not(#pi-x) input[type=checkbox]:focus-visible{outline:2px solid var(--pi-accent)!important;outline-offset:2px}
.pi-root:not(#pi-x) input[type=checkbox]:disabled{opacity:.45;cursor:not-allowed}
@media (prefers-reduced-motion:reduce){.pi-root:not(#pi-x) input[type=checkbox]{transition:none}}
/* 插件面板保持自己的字体（用户 2026-11-08 选定）：酒馆主题会对所有元素强制 font-family / font-weight（如「双色盒子」主题的宋体加粗 !important）。
   这里先把插件里的元素统一恢复成插件字体、正常粗细、无文字阴影（酒馆的 --shadowWidth），再按插件原有的层级把加粗、等宽字体补回来。只作用于插件面板。由 tools/ui-preview/font-block.mjs 生成。 */
.pi-root:not(#pi-x),.pi-root:not(#pi-x) *:not(svg):not(svg *){font-family:var(--pi-font)!important;font-weight:400!important;text-shadow:none!important}
:is(.pi-root:not(#pi-x) .pi-side-hd small,.pi-root:not(#pi-x) .pi-card h3 .pi-meta,.pi-root:not(#pi-x) .pi-wb-sec-hd small,.pi-root:not(#pi-x) .pi-wb-sub-hd small){font-weight:400!important}
:is(.pi-root:not(#pi-x) .pi-field>span,.pi-root:not(#pi-x) .pi-wb-memo,.pi-root:not(#pi-x) .pi-set-row,.pi-root:not(#pi-x) .pi-pace-label){font-weight:500!important}
:is(.pi-root:not(#pi-x) .pi-pitem.is-sel,.pi-root:not(#pi-x) .pi-tab,.pi-root:not(#pi-x) .pi-card h3,.pi-root:not(#pi-x) .pi-hint.is-warn,.pi-root:not(#pi-x) .pi-preset-name,.pi-root:not(#pi-x) .pi-wb-sub-hd,.pi-root:not(#pi-x) .pi-book-hd .pi-etitle,.pi-root:not(#pi-x) .pi-tbtn,.pi-root:not(#pi-x) .pi-wb-count,.pi-root:not(#pi-x) .pi-seg-btn,.pi-root:not(#pi-x) .pi-btn,.pi-root:not(#pi-x) .pi-badge,.pi-root:not(#pi-x) .pi-fr-title,.pi-root:not(#pi-x) /* 标黄的说明：前面一个黄色圆圈问号（代替「·」）。 */
.pi-warn-line,.pi-root:not(#pi-x) .pi-entry-hd .pi-pos,.pi-root:not(#pi-x) .pi-entry-hd .pi-etitle,.pi-root:not(#pi-x) .pi-tl-vol,.pi-root:not(#pi-x) .pi-tl-item.is-active .pi-tl-name,.pi-root:not(#pi-x) .pi-tl-item.is-active .pi-tl-state,.pi-root:not(#pi-x) .pi-titem.is-sel,.pi-root:not(#pi-x) .pi-files th,.pi-root:not(#pi-x) .pi-tour-title){font-weight:600!important}
:is(.pi-root:not(#pi-x) .pi-side-hd,.pi-root:not(#pi-x) .pi-top-title,.pi-root:not(#pi-x) .pi-wb-sec-hd,.pi-root:not(#pi-x) .pi-titem.is-vol,.pi-root:not(#pi-x) .pi-md-h,.pi-root:not(#pi-x) .pi-tour-btn){font-weight:700!important}
:is(.pi-root:not(#pi-x) .pi-warn-line::before,.pi-root:not(#pi-x) .pi-tour-icon){font-weight:800!important}
.pi-root:not(#pi-x) :is(b,strong,h1,h2,h3,h4){font-weight:600!important}
:is(.pi-root:not(#pi-x) .pi-preset-model,.pi-root:not(#pi-x) textarea.pi-ta.is-mono,.pi-root:not(#pi-x) .pi-ta.is-mono,.pi-root:not(#pi-x) .pi-fr-hd .pi-meta,.pi-root:not(#pi-x) .pi-pre,.pi-root:not(#pi-x) .pi-md code,.pi-root:not(#pi-x) .pi-diff){font-family:var(--pi-mono)!important}
/* 插件面板保持自己的字体结束 */
/* persona v0.1.27 */
.pi-pl-row{padding:6px 0 2px}
.pi-pl-hd{display:flex;align-items:center;gap:8px;min-height:30px}
.pi-pl-name{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-pl-row.is-lost .pi-pl-name{color:var(--pi-txt2)}
.pi-pl-row .pi-refs{margin-bottom:2px}
.pi-ps .pi-node-hd .pi-inp{flex:1;min-width:0}
.pi-ps{background:var(--pi-fill)}
.pi-icon-btn:disabled{opacity:.35;cursor:not-allowed}
/* /persona v0.1.27 */
`, ICONS = {
    close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    gear: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.9 1.8h2.2l.4 1.7 1.2.5 1.5-.9 1.6 1.6-.9 1.5.5 1.2 1.7.4v2.2l-1.7.4-.5 1.2.9 1.5-1.6 1.6-1.5-.9-1.2.5-.4 1.7H6.9l-.4-1.7-1.2-.5-1.5.9-1.6-1.6.9-1.5-.5-1.2-1.7-.4V6.9l1.7-.4.5-1.2-.9-1.5 1.6-1.6 1.5.9 1.2-.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.3"/></svg>',
    box: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5L8 2l6 2.5v7L8 14l-6-2.5v-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 4.5L8 7l6-2.5M8 7v7" stroke="currentColor" stroke-width="1.3"/></svg>',
    caret: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    caretDown: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    send: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    menu: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    pencil: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10.5 2.5l3 3-8 8h-3v-3l8-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 4l3 3" stroke="currentColor" stroke-width="1.3"/></svg>',
    search: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7.5a2 2 0 012 2v9H5a2 2 0 01-2-2v-9z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 11.5a2 2 0 012-2h7.5M6 5.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    moon: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.8A5.8 5.8 0 016.2 2.5a5.8 5.8 0 107.3 7.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    sun: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    // 世界书工具栏：统一 16 格、1.4 线宽、圆角端点。
    copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5.5V3.8A1.3 1.3 0 009.2 2.5H3.8a1.3 1.3 0 00-1.3 1.3v5.4a1.3 1.3 0 001.3 1.3h1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7.5M4.8 7L8 10.2 11.2 7M2.5 12.5v1h11v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    upload: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 10.5V3M4.8 6.2L8 3l3.2 3.2M2.5 12.5v1h11v-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4.3c0-.7.6-1.3 1.3-1.3h2.9l1.5 1.6h5c.7 0 1.3.6 1.3 1.3v6.8c0 .7-.6 1.3-1.3 1.3H3.3c-.7 0-1.3-.6-1.3-1.3V4.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    bookPlus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7.5a2 2 0 012 2v4M3 2.5v9a2 2 0 002 2h4M3 11.5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 10.5v4M10.5 12.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    entryPlus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9.5 13.5H4a1.5 1.5 0 01-1.5-1.5V4A1.5 1.5 0 014 2.5h8A1.5 1.5 0 0113.5 4v5.5M5.5 6h5M5.5 9h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12.5 11v4M10.5 13h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    chat: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 2.5h9A1.5 1.5 0 0114 4v6a1.5 1.5 0 01-1.5 1.5H7l-3 2.5v-2.5h-.5A1.5 1.5 0 012 10V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    card: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="1.5" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="6.5" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 11.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    checks: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="9.5" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M9 4.5h4.5M9 11.5h4.5M3.6 11.5l.9.9 1.4-1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    checkAll: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 8.2l1.9 1.9 3.6-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    wand: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13l7.5-7.5M9 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12 1.8v2M11 2.8h2M13.8 6.2v1.4M13.1 6.9h1.4M5.5 2v1.4M4.8 2.7h1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    replace: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 5.5h9l-2.2-2.2M13.5 10.5h-9l2.2 2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    move: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4.3c0-.7.6-1.3 1.3-1.3h2.9l1.5 1.6h5c.7 0 1.3.6 1.3 1.3v6.8c0 .7-.6 1.3-1.3 1.3H3.3c-.7 0-1.3-.6-1.3-1.3V4.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 9h5M8.8 7.2L10.6 9 8.8 10.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sort: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4.5 2.5v11M2.5 11.5l2 2 2-2M9 4h4.5M9 8h3.5M9 12h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg>',
    eyeOff: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.2 3.8A6.6 6.6 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11.6 11.6 0 01-1.7 2.2M10.4 11.9A6.3 6.3 0 018 12.5C4 12.5 1.5 8 1.5 8a11.4 11.4 0 012.6-3M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
    pulse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.5 8.5h3l1.8-4 3 8 1.9-4h3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9 1v4h4" stroke="currentColor" stroke-width="1.2"/></svg>',
    arrowUp: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowDown: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5.5 3L2.5 6l3 3M2.5 6h6.2a4.3 4.3 0 010 8.5H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // src/ui/dom.js
  var STYLE_ID = "pi-style";
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function ensureStyle() {
    let doc = hostDocument();
    if (doc.getElementById(STYLE_ID)) return;
    let style = doc.createElement("style");
    style.id = STYLE_ID, style.textContent = CSS, doc.head.appendChild(style);
  }
  function removeStyle() {
    hostDocument().getElementById(STYLE_ID)?.remove();
  }
  var night = !1;
  function setNight(value) {
    night = !!value;
    for (let node of hostDocument().querySelectorAll(".pi-root")) node.classList.toggle("is-night", night);
  }
  var isNight = () => night;
  function el(html) {
    let box = hostDocument().createElement("div");
    box.innerHTML = html.trim();
    let node = box.firstElementChild;
    return node && node.classList.contains("pi-root") && node.classList.toggle("is-night", night), node;
  }
  function options(list, value) {
    return list.map((item) => `<option value="${esc(item.value)}"${String(item.value) === String(value) ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  }
  function openDialog({ title: title2, html = "", actions: actions12 = [{ label: "确定", value: !0, primary: !0 }], onMount } = {}) {
    let doc = hostDocument();
    return new Promise((resolve) => {
      let root = el(`<div class="pi-root pi-dialog"><div class="pi-dialog-box" role="dialog">
            ${title2 ? `<h4>${esc(title2)}</h4>` : ""}<div class="pi-dlg-body">${html}</div>
            <div class="pi-dlg-acts">${actions12.map((action, index) => `<button type="button" class="pi-btn${action.primary ? " is-primary" : ""}${action.danger ? " is-danger" : ""}" data-dlg="${index}">${esc(action.label)}</button>`).join("")}</div>
        </div></div>`), finish = (value) => {
        doc.removeEventListener("keydown", onKey, !0), root.remove(), resolve(value);
      }, onKey = (event) => {
        event.key === "Escape" && (event.stopPropagation(), finish(null));
      };
      root.addEventListener("click", (event) => {
        if (event.target === root) return finish(null);
        let pick = event.target.closest("[data-dlg-value]");
        if (pick) return finish(pick.dataset.dlgValue);
        let button = event.target.closest("[data-dlg]");
        if (!button) return;
        let action = actions12[Number(button.dataset.dlg)], value = typeof action.value == "function" ? action.value(root) : action.value;
        value !== void 0 && finish(value);
      }), doc.addEventListener("keydown", onKey, !0), doc.body.appendChild(root), onMount && onMount(root), root.querySelector("input,textarea,select")?.focus();
    });
  }
  function confirmDialog({ title: title2, body = "", list = [], okLabel = "确定", danger = !1 }) {
    let html = `${body ? `<p class="pi-hint">${esc(body)}</p>` : ""}${list.length ? `<ul>${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}`;
    return openDialog({ title: title2, html, actions: [{ label: "取消", value: !1 }, { label: okLabel, value: !0, primary: !danger, danger }] }).then(Boolean);
  }
  function promptDialog({ title: title2, label = "", value = "", multiline = !1, placeholder = "" }) {
    let input2 = multiline ? `<textarea class="pi-ta is-mono is-tall" data-dlg-input placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="pi-inp" data-dlg-input value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    return openDialog({
      title: title2,
      html: `<label class="pi-field">${label ? `<span>${esc(label)}</span>` : ""}${input2}</label>`,
      actions: [{ label: "取消", value: null }, { label: "确定", primary: !0, value: (root) => root.querySelector("[data-dlg-input]").value }]
    });
  }
  function menuDialog({ title: title2, items }) {
    let html = `<div class="pi-menu-list">${items.map((item) => `<button type="button" class="pi-menu-item${item.danger ? " is-danger" : ""}" data-dlg-value="${esc(item.value)}"${item.disabled ? " disabled" : ""}>${item.icon || ""}<span>${esc(item.label)}</span></button>`).join("")}</div>`;
    return openDialog({ title: title2, html, actions: [{ label: "取消", value: null }] });
  }
  function choiceDialog({ title: title2, body = "", choices }) {
    return openDialog({ title: title2, html: body ? `<p class="pi-hint">${esc(body)}</p>` : "", actions: choices });
  }
  function pickFiles({ accept = "", multiple = !1 } = {}) {
    let doc = hostDocument();
    return new Promise((resolve) => {
      let input2 = doc.createElement("input");
      input2.type = "file", input2.accept = accept, input2.multiple = multiple, input2.hidden = !0, input2.addEventListener("change", () => {
        resolve([...input2.files]), input2.remove();
      }), input2.addEventListener("cancel", () => {
        resolve([]), input2.remove();
      }), doc.body.appendChild(input2), input2.click();
    });
  }

  // src/ui/tour.js
  var TOUR_REVISION = 2, TOUR_STEPS = {
    core: [
      {
        title: "欢迎使用剧情注入器",
        body: "剧情注入器帮你把一段剧情按步骤交给正文模型：照大纲一段段推进，或者按主角查到了什么一步步开放。花一分钟认识一下各部分。"
      },
      {
        target: ".pi-side-hd [data-act=new-project]",
        title: "新建项目",
        body: "一个项目就是一段剧情，比如一条主线或一条 if 线。新建后会自动设为当前角色卡的项目。",
        side: "right"
      },
      {
        target: [".pi-plist .pi-pitem", ".pi-plist"],
        title: "项目列表",
        body: "你的项目都在这里，点一下打开。带小圆点的是当前角色卡正在用的那个。右键可以改名、分组或删除。",
        side: "right"
      },
      {
        target: ".pi-tabs",
        title: "四个页签",
        body: "一般的顺序：在「讨论」里和 AI 把剧情想清楚，写成「大纲」，到「执行」页开始注入。「设定」页可选，给没有世界观的卡用。线索推进还能同时跑主线和几条支线，到「大纲」「执行」页点问号看说明。",
        side: "bottom"
      },
      {
        target: ".pi-side-ft",
        title: "工具",
        body: "世界书管理用来整理当前卡的世界书；数据管理用来备份和清理插件文件；插件没反应时，先去诊断页看看。",
        side: "right"
      },
      {
        target: ".pi-top-end [data-page=settings]",
        title: "设置",
        body: "模型接口、写作基准、注入方式都在这里。第一次用请先配好「模型接口」：讨论和写大纲都要用到 AI。",
        side: "bottom"
      },
      {
        target: ".pi-top-end [data-act=tour]",
        title: "随时重播",
        body: "每个页面都有自己的说明。到了陌生的页面，点这个问号就会播放这一页的教程。",
        side: "bottom"
      }
    ],
    discuss: [
      {
        target: ".pi-refs",
        title: "附带参考",
        body: "发给 AI 时一起附上的资料：设定、大纲、剧情进度、最近几楼正文、世界书条目。粉色是开着的，点一下切换。附得越多，AI 越了解情况，也越费 token。",
        side: "bottom"
      },
      {
        target: "[data-act=edit-mode]",
        title: "改大纲",
        body: "打开后，你说想怎么改大纲，AI 会在回复末尾附上一份改动提案，回复下面出现「审阅并应用」，勾选后插进大纲。目前只能加节点、调整同一阶段里的顺序。只是聊天时关掉就行。",
        side: "bottom"
      },
      {
        target: ".pi-compose",
        title: "和 AI 讨论",
        body: "说说你想写的剧情或设定，一句话也行。AI 回复下面有「整理成设定」「据此写大纲」，想清楚了就点它们。Ctrl+Enter 发送。",
        side: "top"
      }
    ],
    setting: [
      {
        target: "[data-setting]",
        title: "这一页做什么",
        body: "给还没有世界观的卡用，比如没有世界书的 OC 卡。这里写的设定，开玩后每一轮都会交给正文模型。卡本身有世界书的话，留空就行。",
        side: "top"
      },
      {
        target: "[data-act=from-talk]",
        title: "从讨论整理",
        body: "AI 把讨论记录整理成一块块的设定，先给你看草稿，你勾选采用哪几块。勾上「只追加」就不会改动已有的内容。",
        side: "bottom"
      },
      {
        target: "[data-act=import-wb]",
        title: "从世界书导入",
        body: "把现有世界书里的条目搬过来当设定。注意：世界书里那一条要自己关掉，否则正文会收到两份。",
        side: "bottom"
      },
      { target: "[data-act=history]", title: "历史版本", body: "每次改动前的版本都留着，可以对比，也可以回退。", side: "bottom" }
    ],
    outline: [
      {
        target: "[data-act=import-open-panel]",
        title: "导入长文",
        body: "已经有剧情方案或小说？贴进来，AI 逐段整理成大纲草稿，你按阶段审阅后再采用。中途关掉也能接着做。",
        side: "bottom"
      },
      {
        target: ["[data-act=import-file]", "[data-act=import-paste]"],
        title: "其他导入方式",
        body: "手上已经有插件导出的大纲文件时，用「导入文件」「粘贴」或「从世界书」。",
        side: "bottom"
      },
      {
        target: ["[data-act=ai-volume]", "[data-ai-request]"],
        title: "AI 写一卷",
        body: "在旁边的输入框里写要求，AI 会参考讨论和设定写一卷新大纲，先给你看草稿，确认后才写进大纲。线索推进时可以直接说「加一条巴基的支线，等关系到熟悉再开」，AI 会写成一条单独的线。",
        side: "bottom"
      },
      {
        target: "[data-act=lines-open]",
        title: "剧情线",
        body: "主线和支线一页一条地看：改简介、入口、开启时段；想改开启条件或剧情，就写一句意见让 AI 改，改之前会先给你看改了什么。",
        side: "bottom"
      },
      {
        target: [".pi-tree-list", ".pi-tree"],
        title: "大纲结构",
        body: "卷 → 阶段 → 节点。点一个阶段，在右边编辑它的内容。线索推进的阶段多一块「线索字段」，写开放条件、发现和完成条件。",
        side: "right"
      }
    ],
    run: [
      {
        target: "[data-act=activate]",
        title: "启用项目",
        body: "一张角色卡同一时间只用一个项目，点这里在当前卡上启用它。启用后，这一页才会显示注入和推进的内容。",
        side: "bottom"
      },
      {
        target: ".pi-seg:has([data-act=clue-mode])",
        title: "推进方式",
        body: "大纲推进由 AI 判断这一阶段演完没有，演完就推到下一阶段。线索推进按主角实际查到了什么来开放下一步，适合调查、解谜类剧情。两种的进度分开保存，可以随时切换。",
        side: "bottom"
      },
      // 大纲推进
      {
        target: ".pi-entry-hd",
        title: "注入条目",
        body: "每一轮交给正文的内容：设定和当前阶段。可以单独关掉某一条，或者调整注入的位置。点「预览」能看到这一轮实际发出去了什么。",
        side: "bottom"
      },
      { target: ".pi-pace", title: "推进速度", body: "告诉正文这一段该细写还是一笔带过。", side: "bottom" },
      {
        target: "[data-act=check]",
        title: "检测与改写",
        body: "插件每隔几楼会让 AI 检查进度，也可以手动「立即检测」。剧情偏离大纲太多时，用「改写后续」让 AI 按现在的走向重写之后的阶段，已经演完的部分不动。",
        side: "bottom"
      },
      { target: ".pi-tl-vol", title: "阶段时间线", body: "每个阶段的状态。点阶段右边的「⋯」可以手动设为当前、标为已完成。", side: "top" },
      // 线索推进
      {
        target: "[data-act=clue-gen-template]",
        title: "生成线索模板",
        body: "线索推进靠数据库里的三张表记录主角查到了什么。第一次在一个聊天里用时，先点这里加上这三张表，原有的表和数据都不动。",
        side: "bottom"
      },
      {
        target: "[data-act=clue-prebuild]",
        title: "按大纲补表格行",
        body: "大纲里新加了线索以后，用它把缺的部分补进表格，已有的不动。多条线时插件会在线开始后自动补，一般用不着手动点。",
        side: "bottom"
      },
      {
        target: "[data-act=clue-pause]",
        title: "暂停剧情",
        body: "想先玩一段日常时暂停，不再注入线索内容，进度保留。只有一条主线时，主线走完这里会出现「开始下一段主线」。",
        side: "bottom"
      },
      {
        target: ".pi-line-row",
        title: "剧情线",
        body: "每条主线、支线现在的状态和在等什么。条件满足后，正文会找机会提一句入口；主角走进去就自动开始，屏幕顶端会出现提示：看过点「确认」，插件认错了点「取消」（要点两次，防误触）；支线满了时那个按钮叫「切换」。没认出来时点这里的「进入」。",
        side: "top"
      },
      {
        target: "[data-clue-sidelimit]",
        title: "同时几条支线",
        body: "默认一次只进行一条支线，其余排队。可以改成两条。「暂停全部支线」让所有支线先停下，主线照常；单条的「暂停」用来腾出名额、换别的支线。",
        side: "top"
      },
      {
        target: "[data-act=clue-refresh]",
        title: "本轮场景",
        body: "这一轮主角在做哪件事、可能拿到什么。点「预览」看实际发给正文的内容；表格刚改过时点「重新读表」。主角已经走开了而插件没认出来，点「已离开」。",
        side: "bottom"
      },
      {
        target: ".pi-unoffered",
        title: "正文可能自己编了",
        body: "表格记成拿到了，但插件没有提供过这条发现的记录，多半是正文自己编的，请按实际剧情决定。点「保留」就当发生了；点「作废」就当没发生，相关表格改回未获得。之后重新查到了，要点「解除作废」才会恢复按表格判断。",
        side: "top"
      },
      {
        target: [".pi-clue-hd", ".pi-clue-stage"],
        title: "节点",
        body: "每件事当前的状态，点一下看条件。点右边的「⋯」可以手动开放、标记完成，或者确认、作废一条线索，填表记错时用。剧情偏离太多时，用上面的「改写后续」让 AI 重写还没演的部分。",
        side: "top"
      }
    ],
    settings: [
      {
        target: "[data-act=llm-role]",
        title: "模型接口",
        body: "讨论、写设定与大纲、进度检测三种用途分开配置。可以直接用酒馆当前的连接，也可以单独填一个接口，比如让便宜的模型做进度检测。",
        side: "bottom"
      },
      {
        target: "[data-guide-preset]",
        title: "写作基准",
        body: "讨论和整理设定时，AI 照这份基准来写。默认是通用版；写同人选「同人世界观速成」；也可以选「自定义」自己改。",
        side: "top"
      },
      {
        target: "[data-set=bodyGuide]",
        title: "正文通用提示",
        body: "每一轮附在剧情材料前面的两段通用说明，比如「角色只知道自己亲历或听说的事」。一般保持开启。",
        side: "bottom"
      },
      {
        target: "[data-set=checkEvery]",
        title: "阶段推进",
        body: "大纲推进时，每隔几楼让 AI 检查一次进度，以及演完、偏离时要不要先问你。",
        side: "bottom"
      },
      { target: "[data-act=tour-reset]", title: "重新播放教程", body: "想从头再看一遍各页说明时点这里。", side: "top" }
    ],
    books: [{ title: "世界书管理", body: "整理当前角色卡用到的世界书：开关条目、改关键词、批量替换、复制和删除。改动前会先下载备份。" }],
    data: [
      {
        title: "数据管理",
        body: "插件的项目、讨论记录、导入任务都存在酒馆的文件里。这里可以核对文件、导出、清理不属于任何项目的文件；「备份并删除」会先下载全部备份再重置插件。"
      }
    ],
    diag: [
      {
        title: "诊断",
        body: "插件没反应、注入内容不对时，先到这里看：自动检测会列出发现的问题，下面有酒馆事件和最近的记录。线索推进时还会显示数据库是否连上、上次注入了什么，以及每次请求的核验结果。反馈问题时点「复制诊断」。"
      }
    ]
  };
  function tourScopeOf(view) {
    return view.page ? view.page : view.project() ? view.tab : "core";
  }
  function tourState(data) {
    let s = data.settings().tourState;
    return s && typeof s == "object" && s.revision === TOUR_REVISION ? { revision: TOUR_REVISION, done: Array.isArray(s.done) ? s.done : [] } : { revision: TOUR_REVISION, done: [] };
  }
  function markTourDone(data, scope) {
    let s = tourState(data);
    s.done.includes(scope) || data.updateSettings({ tourState: { ...s, done: [...s.done, scope] } });
  }
  function createTour({ getRoot, data }) {
    let doc = hostDocument(), win = hostWindow(), layer = null, scope = "", steps = [], idx = 0, raf = 0, nextFrame = (fn) => typeof win.requestAnimationFrame == "function" ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 16), cancelFrame = (id) => typeof win.cancelAnimationFrame == "function" ? win.cancelAnimationFrame(id) : win.clearTimeout(id), visible = (node) => {
      if (!node || !node.isConnected) return !1;
      let r = node.getBoundingClientRect(), cs = win.getComputedStyle(node);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    }, findTarget = (step2) => {
      if (!step2 || !step2.target) return null;
      let root = getRoot();
      if (!root) return null;
      for (let sel of [].concat(step2.target)) {
        let hit;
        try {
          hit = [...root.querySelectorAll(sel)].find(visible);
        } catch {
          hit = null;
        }
        if (hit) return hit;
      }
      return null;
    }, available = () => steps.map((s, i) => ({ s, i })).filter(({ s }) => !s.target || findTarget(s));
    function layout() {
      if (raf = 0, !layer) return;
      let step2 = steps[idx], target = findTarget(step2), vw = win.innerWidth, vh = win.innerHeight, pop = layer.querySelector(".pi-tour-pop"), hole = layer.querySelector(".pi-tour-hole"), mask = layer.querySelector(".pi-tour-mask path"), full = `M0 0H${vw}V${vh}H0Z`;
      if (!target) {
        mask.setAttribute("d", full), hole.hidden = !0;
        let pr2 = pop.getBoundingClientRect();
        return pop.style.left = `${Math.max(12, (vw - pr2.width) / 2)}px`, pop.style.top = `${Math.max(12, (vh - pr2.height) / 2)}px`;
      }
      let r = target.getBoundingClientRect(), pad = 6, x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
      mask.setAttribute("d", `${full}M${x} ${y}H${x + w}V${y + h}H${x}Z`), hole.hidden = !1, Object.assign(hole.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      let pr = pop.getBoundingClientRect(), gap = 14, edge = 12, fits = (p) => p.left >= edge && p.top >= edge && p.left + pr.width <= vw - edge && p.top + pr.height <= vh - edge, at = {
        top: { left: r.left + r.width / 2 - pr.width / 2, top: y - gap - pr.height },
        bottom: { left: r.left + r.width / 2 - pr.width / 2, top: y + h + gap },
        left: { left: x - gap - pr.width, top: r.top + r.height / 2 - pr.height / 2 },
        right: { left: x + w + gap, top: r.top + r.height / 2 - pr.height / 2 }
      }, pick = [step2.side || "bottom", "bottom", "top", "right", "left"].map((k) => at[k]).find(fits) || at[step2.side || "bottom"];
      pop.style.left = `${Math.min(Math.max(edge, pick.left), vw - pr.width - edge)}px`, pop.style.top = `${Math.min(Math.max(edge, pick.top), vh - pr.height - edge)}px`;
    }
    let relayout = () => raf || (raf = nextFrame(layout));
    function show(i) {
      let list = available();
      if (!list.length) return stop(!0);
      let k = list.findIndex((x) => x.i === i);
      k < 0 && (k = Math.max(
        0,
        list.findIndex((x) => x.i > i)
      ), list[k] || (k = list.length - 1)), idx = list[k].i;
      let step2 = steps[idx], target = findTarget(step2), pop = layer.querySelector(".pi-tour-pop"), last = k === list.length - 1;
      pop.querySelector(".pi-tour-title").textContent = step2.title, pop.querySelector(".pi-tour-body").textContent = step2.body, pop.querySelector(".pi-tour-count").textContent = `${k + 1} / ${list.length}`, pop.querySelector("[data-tour=prev]").disabled = k === 0, pop.querySelector("[data-tour=next]").textContent = last ? "完成" : "下一步", target && target.scrollIntoView && target.scrollIntoView({ block: "nearest", inline: "nearest" }), layout(), nextFrame(() => nextFrame(layout)), pop.querySelector("[data-tour=next]").focus({ preventScroll: !0 });
    }
    function step(dir) {
      let list = available(), k = list.findIndex((x) => x.i === idx);
      if (dir > 0 && k >= list.length - 1) return stop(!0);
      let next = list[Math.min(list.length - 1, Math.max(0, k + dir))];
      next && show(next.i);
    }
    let onKey = (event) => {
      layer && (doc.querySelector(".pi-dialog") || event.key === "Enter" && event.target && event.target.closest && event.target.closest(".pi-tour [data-tour]") || (event.key === "Escape" ? (event.stopPropagation(), event.preventDefault(), stop(!0)) : event.key === "ArrowRight" || event.key === "Enter" ? (event.stopPropagation(), event.preventDefault(), step(1)) : event.key === "ArrowLeft" && (event.stopPropagation(), event.preventDefault(), step(-1))));
    };
    function start(name, { auto = !1 } = {}) {
      return stop(!1), !TOUR_STEPS[name] || auto && tourState(data).done.includes(name) || (scope = name, steps = TOUR_STEPS[name], !available().length) ? !1 : (layer = el(`<div class="pi-root pi-tour" role="presentation">
          <svg class="pi-tour-mask" aria-hidden="true"><path fill-rule="evenodd"></path></svg>
          <div class="pi-tour-hole" aria-hidden="true"></div>
          <div class="pi-tour-pop" role="dialog" aria-modal="true" aria-labelledby="pi-tour-title">
            <div class="pi-tour-hd"><span class="pi-tour-icon" aria-hidden="true">?</span><b class="pi-tour-title" id="pi-tour-title"></b><button type="button" class="pi-tour-x" data-tour="close" title="关闭教程" aria-label="关闭教程">${ICONS.close}</button></div>
            <p class="pi-tour-body"></p>
            <div class="pi-tour-ft"><span class="pi-tour-count"></span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-tour="prev">上一步</button><button type="button" class="pi-btn is-sm is-primary" data-tour="next">下一步</button></div>
          </div></div>`), layer.addEventListener("click", (event) => {
        let b = event.target.closest("[data-tour]");
        b && (b.dataset.tour === "next" ? step(1) : b.dataset.tour === "prev" ? step(-1) : stop(!0));
      }), doc.body.appendChild(layer), doc.addEventListener("keydown", onKey, !0), win.addEventListener("resize", relayout), win.addEventListener("scroll", relayout, !0), show(available()[0].i), !0);
    }
    function stop(done) {
      layer && (done && markTourDone(data, scope), doc.removeEventListener("keydown", onKey, !0), win.removeEventListener("resize", relayout), win.removeEventListener("scroll", relayout, !0), raf && cancelFrame(raf), raf = 0, layer.remove(), layer = null);
    }
    return { start, stop, isOpen: () => !!layer, relayout, scope: () => layer ? scope : "" };
  }

  // src/ui/tab-discuss.js
  var tab_discuss_exports = {};
  __export(tab_discuss_exports, {
    actions: () => actions3,
    onInput: () => onInput3,
    onSubmit: () => onSubmit,
    refreshOn: () => refreshOn3,
    render: () => render3
  });

  // src/core/outline-proposal.js
  var PROPOSAL_FENCE = /```\s*大纲改动\s*\n([\s\S]*?)```/, PROPOSAL_KINDS = { 主线: "主线节点", 支线: "支线事件", 世界动态: "世界动态" };
  function hasOutlineProposal(text2) {
    return PROPOSAL_FENCE.test(String(text2 || ""));
  }
  function parseOutlineProposal(text2) {
    let m = PROPOSAL_FENCE.exec(String(text2 || ""));
    if (!m) return { items: [], error: "回复里没有「大纲改动」代码块" };
    let data;
    try {
      data = parseYaml(m[1]);
    } catch (error) {
      return { items: [], error: `「大纲改动」不是合法的 YAML：${error.message}` };
    }
    let list = Array.isArray(data) ? data : isPlainObject(data) && Array.isArray(data.改动) ? data.改动 : null;
    return list ? {
      items: list.map((raw, i) => {
        let it = isPlainObject(raw) ? raw : {}, action = String(it.动作 || "").trim(), field2 = PROPOSAL_KINDS[String(it.类别 || "主线").trim()] || "", pos = it.位置, out = {
          i,
          action,
          stageId: String(it.阶段 || "").trim(),
          field: field2,
          kind: String(it.类别 || "主线").trim(),
          reason: clueText(it.理由)
        };
        if (!field2) return { ...out, error: `类别「${it.类别}」不认识，只能是 主线 / 支线 / 世界动态` };
        if (!out.stageId) return { ...out, error: "没有写目标阶段的编号" };
        if (action === "插入") {
          if (!isPlainObject(it.节点) && typeof it.节点 != "string") return { ...out, error: "插入缺少「节点」内容" };
          let where = "end", anchor = "";
          return isPlainObject(pos) ? pos.之前 ? (where = "before", anchor = String(pos.之前).trim()) : pos.之后 && (where = "after", anchor = String(pos.之后).trim()) : String(pos || "").trim() === "开头" && (where = "start"), { ...out, where, anchor, node: it.节点 };
        }
        return action === "排序" ? Array.isArray(it.顺序) ? { ...out, order: it.顺序.map((x) => String(x).trim()) } : { ...out, error: "排序缺少「顺序」列表" } : { ...out, error: `动作「${action || "（空）"}」这一版还不支持，只能插入或同阶段排序` };
      })
    } : { items: [], error: "「大纲改动」里应该是一个「改动」列表" };
  }
  function proposalNodeRef(item) {
    return isPlainObject(item) && typeof item.id == "string" ? item.id.trim() : "";
  }
  function applyOutlineProposal(volumes, items, { picked = null, idOf: idOf2 = () => makeId("n"), isClue = !1 } = {}) {
    let use = items.filter((it) => !it.error && (!picked || picked.includes(it.i))), errors = [], changes = [], added = [], next = JSON.parse(JSON.stringify(volumes || [])), stageOf = (id) => {
      for (let v of next) for (let s of v.stages) if (s.id === id) return { volume: v, stage: s };
      return null;
    };
    for (let it of use) {
      let hit = stageOf(it.stageId);
      if (!hit) {
        errors.push(`第 ${it.i + 1} 项：找不到阶段「${it.stageId}」（可能已被删除或移动）`);
        continue;
      }
      let data = isPlainObject(hit.stage.data) ? hit.stage.data : hit.stage.data = {}, list = Array.isArray(data[it.field]) ? data[it.field] : data[it.field] = [], place = `${stageLabel(hit.stage.key)}·${it.kind}`;
      if (it.action === "插入") {
        let node = isPlainObject(it.node) ? { ...it.node } : { 名称: String(it.node) };
        delete node.id;
        let id = idOf2();
        node.id = id, added.push(id);
        let at = list.length;
        if (it.where === "start") at = 0;
        else if (it.where !== "end") {
          let k = list.findIndex((x) => proposalNodeRef(x) === it.anchor);
          if (k < 0) {
            errors.push(`第 ${it.i + 1} 项：在${place}里找不到节点「${it.anchor}」`);
            continue;
          }
          at = it.where === "before" ? k : k + 1;
        }
        list.splice(at, 0, node);
        let name = clueText(node.名称) || clueText(node.内容) || id;
        changes.push({
          i: it.i,
          text: `在${place}${it.where === "end" ? "末尾" : it.where === "start" ? "开头" : `「${it.anchor}」${it.where === "before" ? "之前" : "之后"}`}插入「${name}」`
        });
        continue;
      }
      let have = list.map(proposalNodeRef), missing = have.filter((x) => !it.order.includes(x)), extra = it.order.filter((x) => !have.includes(x));
      if (have.some((x) => !x)) {
        errors.push(`第 ${it.i + 1} 项：${place}里有还没有编号的节点，先打开一次执行页让插件补上编号再排序`);
        continue;
      }
      if (missing.length || extra.length || it.order.length !== have.length) {
        errors.push(
          `第 ${it.i + 1} 项：排序必须列出${place}现有的全部节点、不多不少${missing.length ? `（缺 ${missing.join("、")}）` : ""}${extra.length ? `（多了 ${extra.join("、")}，跨阶段移动这一版不支持）` : ""}`
        );
        continue;
      }
      data[it.field] = it.order.map((id) => list[have.indexOf(id)]), changes.push({ i: it.i, text: `${place}重新排序：${it.order.join(" → ")}` });
    }
    if (isClue && !errors.length) {
      let c = compileClue(next);
      errors.push(...c.errors.filter((e) => /引用了不存在的节点|条件/.test(e)));
    }
    return { ok: !errors.length && changes.length > 0, volumes: errors.length ? volumes : next, changes, errors, added };
  }
  function outlineMapText(volumes, { focusStageId = "" } = {}) {
    let view = outlineVolumesView(volumes), lines2 = [];
    for (let v of view) {
      lines2.push(`卷「${volumeLabel(v.key)}」`);
      for (let s of v.stages) {
        lines2.push(`  阶段 ${s.id}「${stageLabel(s.key)}」`);
        for (let { field: field2, label } of NODE_FIELDS) {
          let list = Array.isArray(s.data && s.data[field2]) ? s.data[field2] : [];
          list.length && lines2.push(
            `    ${label}：${list.map((x) => `${proposalNodeRef(x) || "（无编号）"}「${isPlainObject(x) ? clueText(x.名称 || x.内容) : clueText(x)}」`).join("、")}`
          );
        }
        if (s.id === focusStageId) {
          let shown = {};
          for (let [k, val] of Object.entries(s.data || {}))
            shown[k] = Array.isArray(val) ? val.map((x) => isPlainObject(x) ? (({ id, ...rest }) => rest)(x) : x) : val;
          lines2.push(
            "    【这个阶段的完整内容】",
            ...stringifyYaml(shown).trimEnd().split(`
`).map((l) => `    ${l}`)
          );
        }
      }
    }
    return lines2.join(`
`);
  }
  function outlineStamp(volumes) {
    let s = JSON.stringify(volumes || []), h = 0;
    for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
  }

  // src/ui/ai.js
  function ask(view, role, messages, { signal } = {}) {
    return requestLlm(messages, resolveLlm(view.data.settings(), role), { signal });
  }
  function guideText(view) {
    return guideInfo(view).text;
  }
  async function talkText(view, limit = 3e4) {
    let chat = await view.data.loadChat(view.projectId);
    return transcript(chat.summary, chat.messages, limit);
  }
  async function runTask(view, key, job) {
    if (view.busy[key]) return null;
    let projectId = view.projectId;
    view.setBusy(key, !0);
    try {
      let result = await job();
      return view.projectId === projectId ? result : null;
    } finally {
      view.setBusy(key, !1);
    }
  }
  function guideInfo(view) {
    return resolveGuide(view.data.settings());
  }

  // src/core/tokens.js
  function estimateTokens(text2) {
    let value = String(text2 || ""), cjk = (value.match(/[　-鿿가-힯＀-￯]/g) || []).length;
    return Math.ceil(cjk + (value.length - cjk) / 4);
  }

  // src/ui/discuss-refs.js
  async function loadBoundBooks() {
    let out = [];
    for (let book of boundBookNames())
      try {
        out.push({ name: book.name, source: book.source, entries: bookEntries(await loadBook(book.name)) });
      } catch {
        out.push({ name: book.name, source: book.source, entries: [], error: !0 });
      }
    return out;
  }
  function progressText(view) {
    if (view.runtime.activeId() !== view.projectId) return "";
    let project = view.project();
    if (isClueMode(project)) {
      let c = view.runtime.clue.compute();
      return c ? clueProgressText(c.state, c.snap, c.prog, { problems: c.snap.problems }) : "";
    }
    let units = maskUnits(flattenUnits(project.outline.volumes), threadSwitches(project));
    if (!units.length) return "";
    let progress = view.runtime.progress(), settings = view.data.settings();
    return buildIndexText(units, unitStates(units, progress), progress, { carryOver: settings.carryOver, hookCap: settings.hookCap });
  }
  function floorsText(view, count) {
    return count ? view.runtime.recentFloors(count).map((floor) => `【第 ${floor.index} 楼】
${floor.text}`).join(`

`) : "";
  }
  async function resolveRefs(view, chat, project, { skip = [] } = {}) {
    let refs = [], r = { ...chat.refs };
    for (let key of skip) r[key] = key === "floors" ? 0 : !1;
    if (r.setting && project.setting.text.trim() && refs.push({ title: "当前设定", text: project.setting.text }), r.outline && project.outline.volumes.length) {
      let text2 = outlineToText(project.outline.volumes);
      refs.push({
        title: "当前大纲",
        text: text2.length < 12e3 ? text2 : flattenUnits(project.outline.volumes).map((unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`).join(`
`)
      });
    }
    if (r.progress) {
      let text2 = progressText(view);
      text2 && refs.push({ title: "剧情进度（已演、进行中与之后的阶段）", text: text2 });
    }
    let floors = floorsText(view, r.floors);
    return floors && refs.push({ title: `最近 ${r.floors} 楼正文`, text: floors }), [...refs, ...await wbRefTexts(r.wb, r.memo)];
  }
  async function wbRefTexts(rule, memo) {
    let books = await loadBoundBooks(), checked = checkedSet(rule, books, memo), out = [];
    for (let book of books)
      for (let entry of book.entries)
        checked.has(entryRefId(book.name, entry)) && entry.content.trim() && out.push({ title: entry.title, text: entry.content });
    return out;
  }
  function wbSummary(view, refs, rerender, scope = "discuss") {
    let s = view.tabState(scope), chat = { refs }, sig = JSON.stringify([view.projectId, chat.refs.wb, chat.refs.memo]);
    return s.wbSig === sig ? s.wbSum : (s.wbPending !== sig && (s.wbPending = sig, loadBoundBooks().then((books) => {
      let checked = checkedSet(chat.refs.wb, books, chat.refs.memo), count = 0, tokens = 0;
      for (let book of books)
        for (let entry of book.entries)
          checked.has(entryRefId(book.name, entry)) && (count += 1, tokens += estimateTokens(entry.content));
      s.wbSig = sig, s.wbSum = { count, tokens, books: books.length }, rerender();
    }).catch(() => {
    })), s.wbSum || null);
  }
  var row = (id, entry, on, extra = "") => `<label class="pi-wb-row${entry.disabled ? " is-off" : ""}"><input type="checkbox" data-ref-id="${esc(id)}"${extra}${on ? " checked" : ""}>
    <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>${entry.disabled ? '<span class="pi-badge">世界书已关闭</span>' : ""}</label>`;
  function pickerHtml(books, rule, memo) {
    let checked = checkedSet(rule, books, memo);
    return books.map((book) => {
      let hand = book.entries.filter((entry) => !acuField(entry.title)), fields = groupByField(book.entries), handHtml = hand.length ? `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">世界书条目<small>${hand.length}</small><span class="pi-wb-bulk">
                <button type="button" class="pi-btn is-sm is-ghost" data-ref-all="${esc(book.name)}" data-on="1">全选</button>
                <button type="button" class="pi-btn is-sm is-ghost" data-ref-all="${esc(book.name)}" data-on="0">全不选</button></span></div>
            ${hand.map((entry) => row(entryRefId(book.name, entry), entry, checked.has(entryRefId(book.name, entry)), ` data-ref-hand="${esc(book.name)}"`)).join("")}</div>` : "", acuHtml = fields.length ? `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${fields.reduce((sum, [, list]) => sum + list.length, 0)}</small></div>
            ${fields.map(([field2, list]) => {
        let memoField = isMemoField(field2), lead = memoField ? '<span class="pi-wb-pad"></span>' : `<input type="checkbox" data-ref-field="${esc(field2)}"${fieldChecked(rule, field2) ? " checked" : ""}>`, memoBox = memoField ? `<span class="pi-wb-memo">最近<input class="pi-inp is-num" type="number" min="0" data-ref-memo value="${memo}">条</span>` : "";
        return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd">${lead}<button type="button" class="pi-wb-name" data-ref-fold>${ICONS.caret}<span class="pi-wb-field">${esc(field2)}</span><small>${list.length}</small></button>${memoBox}</div>
                    <div class="pi-wb-fold" hidden>${list.map((entry) => row(entryRefId(book.name, entry), entry, checked.has(entryRefId(book.name, entry)), ` data-ref-of="${esc(field2)}"${memoField ? " data-ref-memo-row" : ""}`)).join("")}</div></div>`;
      }).join("")}</div>` : "";
      return `<div class="pi-ref-book"><p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span></p>${handHtml}${acuHtml || ""}${!hand.length && !fields.length ? '<p class="pi-hint">没有条目</p>' : ""}</div>`;
    }).join("");
  }
  async function pickRefs(refs, title2 = "附带的世界书条目") {
    let chat = { refs }, books = await loadBoundBooks();
    if (!books.length) return { none: !0 };
    let memoRows = (box) => [...box.querySelectorAll("[data-ref-memo-row]")], rowNo2 = (input2) => Number((/-(\d+)$/.exec(input2.closest("label").querySelector(".pi-wb-title").textContent) || [])[1] ?? -1);
    return await openDialog({
      title: title2,
      html: `<div class="pi-ref-top"><span class="pi-hint" data-ref-sum></span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-ref-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-ref-every="0">全不选</button></div>
            <div class="pi-ref-list">${pickerHtml(books, chat.refs.wb, chat.refs.memo)}</div>`,
      actions: [
        { label: "取消", value: null },
        {
          label: "确定",
          primary: !0,
          value: (box) => {
            let fields = {};
            box.querySelectorAll("[data-ref-field]").forEach((input2) => {
              fields[input2.dataset.refField] = input2.checked;
            });
            let memoInput = box.querySelector("[data-ref-memo]"), memo = memoInput ? Math.max(0, Math.round(Number(memoInput.value) || 0)) : chat.refs.memo, checked = new Set([...box.querySelectorAll("[data-ref-id]:checked")].map((input2) => input2.dataset.refId));
            return { memo, wb: ruleFromSelection(books, fields, checked, memo) };
          }
        }
      ],
      onMount(box) {
        let byId = /* @__PURE__ */ new Map();
        for (let book of books) for (let entry of book.entries) byId.set(entryRefId(book.name, entry), entry);
        let sum = () => {
          let ids = [...box.querySelectorAll("[data-ref-id]:checked")].map((input2) => input2.dataset.refId), tokens = ids.reduce((total, id) => total + estimateTokens(byId.get(id)?.content || ""), 0);
          box.querySelector("[data-ref-sum]").textContent = `已选 ${ids.length} 条，约 ${tokens} token`;
        }, applyMemo = () => {
          let n = Math.max(0, Math.round(Number(box.querySelector("[data-ref-memo]")?.value) || 0));
          for (let book of box.querySelectorAll(".pi-ref-book"))
            memoRows(book).sort((a, b) => rowNo2(b) - rowNo2(a)).forEach((input2, i) => {
              input2.checked = i < n;
            });
        };
        box.addEventListener("click", (event) => {
          let fold = event.target.closest("[data-ref-fold]");
          if (fold) {
            let body = fold.closest(".pi-wb-sub").querySelector(".pi-wb-fold");
            body.hidden = !body.hidden, fold.querySelector("svg").outerHTML = body.hidden ? ICONS.caret : ICONS.caretDown;
            return;
          }
          let every = event.target.closest("[data-ref-every]");
          if (every) {
            let on = every.dataset.refEvery === "1";
            box.querySelectorAll("[data-ref-id], [data-ref-field]").forEach((input2) => {
              input2.checked = on;
            });
            let memoInput = box.querySelector("[data-ref-memo]");
            memoInput && (memoInput.value = on ? String(Math.max(...[...box.querySelectorAll(".pi-ref-book")].map((book) => memoRows(book).length), 0)) : "0"), sum();
            return;
          }
          let all = event.target.closest("[data-ref-all]");
          all && ([...box.querySelectorAll("[data-ref-hand]")].filter((input2) => input2.dataset.refHand === all.dataset.refAll).forEach((input2) => {
            input2.checked = all.dataset.on === "1";
          }), sum());
        }), box.addEventListener("change", (event) => {
          let field2 = event.target.dataset.refField;
          field2 !== void 0 && [...box.querySelectorAll("[data-ref-of]")].filter((input2) => input2.dataset.refOf === field2).forEach((input2) => {
            input2.checked = event.target.checked;
          }), sum();
        }), box.addEventListener("input", (event) => {
          event.target.matches("[data-ref-memo]") && (applyMemo(), sum());
        }), sum();
      }
    });
  }
  function fitRefs(refs, limit = 24e3) {
    let left = limit, used = [], report = [];
    for (let ref of refs) {
      let text2 = String(ref.text || "");
      if (left <= 200) {
        report.push({ title: ref.title, chars: text2.length, kept: 0 });
        continue;
      }
      let kept = text2.length > left ? `${text2.slice(0, left)}
……（以下 ${text2.length - left} 字因长度限制未附带）` : text2;
      used.push({ title: ref.title, text: kept }), report.push({ title: ref.title, chars: text2.length, kept: Math.min(text2.length, left) }), left -= Math.min(text2.length, left);
    }
    return { refs: used, report };
  }

  // src/ui/markdown.js
  function inline(text2) {
    let codes = [], out = esc(text2).replace(/`([^`]+)`/g, (_, code) => `\0${codes.push(code) - 1}\0`);
    return out = out.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`).replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>").replace(/~~(.+?)~~/g, "<del>$1</del>"), out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }
  var RE = {
    fence: /^\s*(```|~~~)/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s*>\s?/,
    ul: /^(\s*)[-*+]\s+(.*)$/,
    ol: /^(\s*)\d+[.)]\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
  }, cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));
  function renderMarkdown(src) {
    let lines2 = String(src ?? "").replace(/\r\n?/g, `
`).split(`
`), out = [], i = 0;
    for (; i < lines2.length; ) {
      let line = lines2[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      if (RE.fence.test(line)) {
        let mark = line.trim().slice(0, 3), body = [];
        for (i += 1; i < lines2.length && !lines2[i].trim().startsWith(mark); ) body.push(lines2[i++]);
        i += 1, out.push(`<pre class="pi-pre">${esc(body.join(`
`))}</pre>`);
        continue;
      }
      let heading = RE.heading.exec(line);
      if (heading) {
        out.push(`<div class="pi-md-h is-h${Math.min(heading[1].length, 4)}">${inline(heading[2])}</div>`), i += 1;
        continue;
      }
      if (RE.hr.test(line)) {
        out.push("<hr>"), i += 1;
        continue;
      }
      if (line.includes("|") && i + 1 < lines2.length && RE.tableSep.test(lines2[i + 1])) {
        let head = cells(line);
        i += 2;
        let rows2 = [];
        for (; i < lines2.length && lines2[i].includes("|") && lines2[i].trim(); ) rows2.push(cells(lines2[i++]));
        out.push(`<div class="pi-md-table"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
                <tbody>${rows2.map((row2) => `<tr>${row2.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (RE.quote.test(line)) {
        let body = [];
        for (; i < lines2.length && RE.quote.test(lines2[i]); ) body.push(lines2[i++].replace(RE.quote, ""));
        out.push(`<blockquote>${renderMarkdown(body.join(`
`))}</blockquote>`);
        continue;
      }
      let list = RE.ul.test(line) ? "ul" : RE.ol.test(line) ? "ol" : "";
      if (list) {
        let items = [];
        for (; i < lines2.length && RE[list].test(lines2[i]); ) {
          let [, indent, text2] = RE[list].exec(lines2[i++]);
          items.push(`<li${indent.length >= 2 ? ' class="is-sub"' : ""}>${inline(text2)}</li>`);
        }
        out.push(`<${list}>${items.join("")}</${list}>`);
        continue;
      }
      let para = [];
      for (; i < lines2.length && lines2[i].trim() && !RE.fence.test(lines2[i]) && !RE.heading.test(lines2[i]) && !RE.hr.test(lines2[i]) && !RE.quote.test(lines2[i]) && !RE.ul.test(lines2[i]) && !RE.ol.test(lines2[i]); ) para.push(inline(lines2[i++]));
      out.push(`<p>${para.join("<br>")}</p>`);
    }
    return out.join("");
  }

  // src/ui/tab-outline.js
  var tab_outline_exports = {};
  __export(tab_outline_exports, {
    CLUE_PLACEHOLDER: () => CLUE_PLACEHOLDER,
    CLUE_TEXT_KEYS: () => CLUE_TEXT_KEYS,
    CLUE_YAML_KEYS: () => CLUE_YAML_KEYS,
    actions: () => actions,
    afterAdopt: () => afterAdopt,
    applyYamlField: () => applyYamlField,
    clueNodeFields: () => clueNodeFields,
    currentTables: () => currentTables,
    generationMaterial: () => generationMaterial,
    getDraft: () => getDraft,
    onBlur: () => onBlur,
    onInput: () => onInput,
    putDraft: () => putDraft,
    refreshOn: () => refreshOn,
    render: () => render,
    rewriteGuardNow: () => rewriteGuardNow,
    showDraft: () => showDraft,
    st: () => st,
    staleTaskNotice: () => staleTaskNotice,
    startRewrite: () => startRewrite,
    taskContext: () => taskContext,
    taskStillValid: () => taskStillValid
  });

  // src/core/long-import.js
  var CHAPTER_HEAD = /^(?:#{1,4}\s+.+|第[0-9一二三四五六七八九十百零〇两]+[章回节幕部卷].*|Chapter\s+\d+.*|[一二三四五六七八九十]+、.+)$/i;
  function splitLongText(text2, { target = 8e3, overlap = 300 } = {}) {
    let src = String(text2 || "").replace(/\r\n?/g, `
`), lines2 = src.split(`
`), heads = [];
    for (let i = 0, pos = 0; i < lines2.length; pos += lines2[i].length + 1, i++)
      CHAPTER_HEAD.test(lines2[i].trim()) && heads.push({ pos, title: lines2[i].trim().replace(/^#+\s*/, "") });
    let parts = [];
    (!heads.length || heads[0].pos > 0) && parts.push({ title: heads.length ? "开头" : "全文", start: 0, end: heads.length ? heads[0].pos : src.length }), heads.forEach((h, k) => parts.push({ title: h.title, start: h.pos, end: k + 1 < heads.length ? heads[k + 1].pos : src.length })), parts = parts.filter((p) => src.slice(p.start, p.end).trim());
    let out = [];
    for (let p of parts) {
      if (p.end - p.start <= target * 1.4) {
        out.push(p);
        continue;
      }
      let at = p.start, n = 1;
      for (; at < p.end; ) {
        let cut = Math.min(p.end, at + target), para = src.lastIndexOf(`

`, cut);
        cut < p.end && para > at + target * 0.5 && (cut = para), out.push({ title: `${p.title}（${n++}）`, start: at, end: cut }), at = cut;
      }
    }
    let merged = [];
    for (let p of out) {
      let last = merged[merged.length - 1];
      last && last.end - last.start + (p.end - p.start) <= target ? (last.end = p.end, last.last = p.title) : merged.push({ ...p, first: p.title, last: p.title });
    }
    return merged.forEach((p) => p.title = p.first === p.last ? p.first : `${p.first} … ${p.last}`), merged.map((p, i) => ({
      i,
      title: p.title,
      start: p.start,
      end: p.end,
      text: src.slice(Math.max(0, p.start - (i ? overlap : 0)), p.end),
      lead: i ? Math.min(overlap, p.start) : 0
    }));
  }
  var IMPORT_INDEX_FORMAT = [
    "```yaml",
    "梗概: 这一段讲了什么（两三句）",
    "人物:",
    "  - {名称: 常用称呼, 别名: [只属于这个人的其他称呼], 同一人: 前面索引里已有的名称（只有原文明说是同一个人时才写）, 公开身份: 别人眼里他是谁, 真实身份: 只有作者知道的（没有就省略）, 名字保密: 揭示之前正文不能出现这个名字时写 true（只是身份或所做的事保密、名字本身公开的，不写）, 首次登场: 本段 / 之前}",
    "  # 「维修工」「老板」这类很多人都能叫的泛称不要写进别名；同一个人的化名、绰号才写。",
    "地点:",
    "  - {名称: …, 说明: 一句话}",
    "事实:   # 剧情里需要被「查到 / 听到 / 看到」的关键信息",
    "  - {编号: F_拼音或英文短词, 内容: 一句话, 性质: 真相 / 证词 / 实物 / 传闻 / 推测, 谁说的: 证词和传闻写来源, 玩家怎么能知道: 本段里通过什么行动取得（没写就留空）}",
    "门槛:   # 原文写的「要先拿到什么，才能做下一步」",
    "  - {需要: [事实编号…], 才能: 下一步做什么}",
    "并行:   # 原文明确说可以先后不限的几条线",
    "  - [线A的简称, 线B的简称]",
    "作者资料: 原文里只给作者看的部分（幕后真相、人物动机、写作说明、结局分支）的要点",
    "```"
  ].join(`
`);
  function importIndexMessages({ part, total, prev = "", needs = "" }) {
    return [
      {
        role: "system",
        content: [
          "你在帮作者把一份长剧情材料整理成可以游玩的大纲。这一步只读材料、整理作者索引，不写大纲。",
          "材料可能是小说正文，也可能是写给作者的剧情方案。方案里的「真相」「人物表」「分支说明」「人物弧线」属于作者资料；「调查如何继续」这类段落是推进条件，不是新事件。",
          "区分三件事：原书里的真相（作者知道）；角色说的话（证词、传闻，不一定是真的）；玩家通过什么行动才能知道。",
          "只写材料里有的，不要补写。拿不准的写在「作者资料」里并注明「待确认」。",
          "「事实」只收**玩家在游戏里通过某个行动能拿到的具体信息或实物**：看到的东西、听到的话、读到的记录、确认的地点。一段材料通常只有几条。",
          "材料里的写作规则、提醒和限制（如「不能一次检查就解决全部问题」「只说合作不产生成果」「彼得会逐渐愿意让别人分担」「结局可以不完全成功」）**不是事实**，写进「作者资料」。",
          `输出格式（只输出这一个代码块）：
${IMPORT_INDEX_FORMAT}`
        ].join(`
`)
      },
      {
        role: "user",
        content: [
          needs && `【作者的要求】
${needs}`,
          prev && `【前面几段已经整理出的索引（编号沿用，不要重复建）】
${prev}`,
          `【第 ${part.i + 1} / ${total} 段：${part.title}】
${part.text}`
        ].filter(Boolean).join(`

`)
      }
    ];
  }
  function mergeImportIndex(list) {
    let out = { 梗概: [], 人物: [], 地点: [], 事实: [], 门槛: [], 并行: [], 作者资料: [], 待确认: [] }, people = /* @__PURE__ */ new Map(), byName = /* @__PURE__ */ new Map(), aliasOwner = /* @__PURE__ */ new Map(), places = /* @__PURE__ */ new Set(), facts = /* @__PURE__ */ new Map();
    for (let [k, idx] of (list || []).entries()) {
      if (!isPlainObject(idx)) continue;
      let joinText = (v) => Array.isArray(v) ? v.map((x) => clueText(typeof x == "string" ? x : JSON.stringify(x))).filter(Boolean).join(`
`) : clueText(v);
      idx.梗概 && out.梗概.push(`第${k + 1}段：${joinText(idx.梗概)}`);
      for (let p of Array.isArray(idx.人物) ? idx.人物 : []) {
        if (!isPlainObject(p) || !p.名称) continue;
        let name = String(p.名称), aliases = (Array.isArray(p.别名) ? p.别名 : []).map(String), same = [].concat(p.同一人 || []).map(String), hit = people.get(name) || [...same, ...aliases].map((n) => byName.get(n)).find(Boolean);
        if (hit) {
          for (let [f, v] of Object.entries(p))
            f === "名称" || f === "同一人" || (hit[f] == null || hit[f] === "" ? hit[f] = v : f === "别名" && (hit.别名 = [.../* @__PURE__ */ new Set([...hit.别名 || [], ...v || []])]));
          hit.名称 !== name && (hit.别名 = [.../* @__PURE__ */ new Set([...hit.别名 || [], name])]), people.set(name, hit);
        } else {
          let entry = { ...p };
          delete entry.同一人, out.人物.push(entry), people.set(name, entry), byName.set(name, entry);
        }
        for (let a of aliases) {
          let owner = aliasOwner.get(a), me = people.get(name);
          owner && owner !== me ? out.待确认.push(`「${owner.名称}」和「${me.名称}」都被称作「${a}」，按两个人分开记录；如果其实是同一个人，请合并`) : aliasOwner.set(a, me);
        }
      }
      for (let l of Array.isArray(idx.地点) ? idx.地点 : [])
        isPlainObject(l) && l.名称 && !places.has(l.名称) && (places.add(l.名称), out.地点.push(l));
      for (let f of Array.isArray(idx.事实) ? idx.事实 : []) {
        if (!isPlainObject(f) || !f.编号) continue;
        let hit = facts.get(f.编号);
        hit ? Object.entries(f).forEach(([kk, v]) => (hit[kk] == null || hit[kk] === "") && (hit[kk] = v)) : (facts.set(f.编号, { ...f, 段: k + 1 }), out.事实.push(facts.get(f.编号)));
      }
      out.门槛.push(...Array.isArray(idx.门槛) ? idx.门槛 : []), out.并行.push(...Array.isArray(idx.并行) ? idx.并行 : []), idx.作者资料 && out.作者资料.push(`第${k + 1}段：
${joinText(idx.作者资料)}`);
    }
    return out.secretFlag = !0, out;
  }
  var IMPORT_AUTHOR_KEYS = ["原文出处", "来源", "待确认", "补写"];
  function importDraftMessages({ part, index, prevTail = "", mode = "clue", needs = "", actors = "", done = "" }) {
    let clue = mode === "clue", rules = clue ? CLUE_OUTLINE_RULES : OUTLINE_RULES, onlyClue = (x) => clue ? x : "";
    return [
      {
        role: "system",
        content: [
          "你在把一段剧情材料转写成可以游玩的大纲。只写这一段材料对应的部分；前面几段已经写过的，不要重复。",
          "本段材料里**每一个**玩家要经历的剧情段落（包括开头的日常入口）都要写进大纲，按材料里的先后顺序，不能跳过。材料开头的真相、人物表、写作说明属于作者资料，读完后接着写后面的剧情段落，不要因此跳过本段里的前几个阶段。",
          "同一个调查如果从上一段延续到这一段，接着写在同一个节点里（沿用上一段的节点 id），不要另建。",
          "【已经写出的阶段和节点】列出的阶段：本段材料是在继续其中某个阶段时，用**完全相同的阶段名**写，只写新增或需要补充的节点（插件会按阶段名和节点 id 合并）；不要为同一段剧情另起一个名字不同的阶段。已经写完的阶段不要重复输出。",
          "人物称呼、事实编号一律用【作者索引】里的；索引里没有、确实需要新建的，用新编号并在该节点的「待确认」里说明。",
          "每个节点额外写三个只给作者看的字段（插件会把它们移出正式大纲）：",
          "  原文出处: 材料里对应的原句或小标题（一句话）",
          "  待确认: 拿不准的地方（没有就省略）",
          "  补写: true（只有这个节点不是材料里的、是你为了可玩性加的才写）",
          clue ? "信息放在哪里（GPT §20.3）：" : "信息放在哪里：节点的名称、地点、事件、偏转都会交给正文，只写玩家此时能经历到的事；幕后真相、真名、还没到揭示时机的答案只写在 <仅作者>…</仅作者> 里。世界动态的「来源」写故事里是谁传出的消息，不写原文出处。",
          onlyClue(
            "  · 入口、地点、场景：只写玩家此时就能看到、知道的东西。入口在节点开放时就会给正文，场景在玩家到场时给正文，都不能含调查结果。"
          ),
          onlyClue(
            "  · 发现的「内容」：这个节点经过调查当场就能揭示的结果。玩家到场时它会作为「可能的发现」交给正文（标明尚未发生），所以只写本节点当场可以揭示的，不写之后才该知道的。"
          ),
          onlyClue("  · 更远的真相、幕后人物的真名、还没到揭示时机的答案：只写在作者备注的 <仅作者>…</仅作者> 里。"),
          onlyClue("  · 名称、记录、节点和事实编号也会给作者以外的环节看到，同样不要含幕后真名和答案。"),
          onlyClue(
            "  · 原文写了「怎么取得、当时能看见什么、后来能推到哪里、有没有替代途径」的，按这个分层放：例如照片能看见维修标签（场景或发现），内部结构要实物检验才知道（另一条发现，条件是拿到实物）。"
          ),
          onlyClue(
            "取得条件和替代路线以原文为准：原文明确写了的才整理成开放条件、「任一」和「必需: false」；原文没写取得条件的节点，开放条件留空；原文没写替代路线就只写一条，不要为了「多一条路」自己编。下面通用规则里「最好有两条获得途径」是从零写大纲时的建议，导入时不适用。节点能不能开放、几条路是否都走得通，由插件按条件检查，你不用推演。"
          ),
          onlyClue(
            "材料里说「几条线先后不限、任一条完成即可继续」的（比如标题写成「第五阶段 a / 第五阶段 b」），把这几条线的节点放进**同一个阶段**（阶段名写成「阶段5_两条线」这样），各自写「必需: false」，阶段的结束条件用「任一」列出各条线的关键事实。**不要**写成「阶段5a」「阶段5b」两个阶段：阶段是先后进行的，后一个要等前一个结束才开放，两条线就都变成必须的了。"
          ),
          onlyClue(
            "发现只记**玩家通过行动能拿到的具体信息或实物**（看到的东西、听到的话、读到的记录）。材料里的写作规则和提醒（如「看见发号施令的人不等于知道名字」「只说合作不产生成果」）不是发现，写进 AI指令 或作者备注；能放进条件的写进条件。"
          ),
          onlyClue(
            "完成条件、开放条件优先用 {事实: 编号}（证词、传闻说出口记为存疑也算满足）；材料明确要求「被证实」时才用 {核实: 编号}；只有材料明确要求「某个角色知道」时才用 {知情 / 核实: 编号@角色}。"
          ),
          onlyClue(
            "阶段的进入条件只能用**前面阶段**产出的事实；本阶段节点才产出的事实不能写进本阶段的进入条件（否则这个阶段永远进不去）。"
          ),
          onlyClue(
            "材料写了「没有 X 也可以做 Y」「不经过 X 也能到 Y」「Y 不依赖 X」的，Y 的开放条件和它所在阶段的进入条件都**不能**要求 X；前一阶段的结束条件也要允许不走 X（用「任一」把另一条路写进去，或把 X 所在节点写成「必需: false」）。"
          ),
          onlyClue(
            "最稳妥的写法：把 X 和 Y 放进**同一个阶段**，X 写「必需: false」，Y 不写开放条件（雾港实测：模型把「可以跳过老韩直接查账房」写成了先后两个阶段，第二阶段要等第一阶段的事实，结果跳过的路走不通）。只有 X 和 Y 之间确实隔着时间或地点的大转场，才分成两个阶段，这时后一阶段的进入条件要留出不走 X 的路。"
          ),
          onlyClue(
            "节点的完成条件写成它自己产出的事实（如 {事实: F_mateo_absent}），**不能**写成 {节点: 自己的 id}：「自己完成了才算完成」永远不会成立。"
          ),
          "要求正文「不要提某人的名字 / 某个真相」时，AI指令和入口里**不能写出那个名字或真相本身**（写出来就已经告诉正文了）。改成「幕后的人此时没有名字，只称『发号施令的人』」这样的写法；具体名字只放在作者备注的 <仅作者> 里，或者等揭示它的那个发现的「内容」里。",
          actors && `角色对应：${actors}`,
          needs && `作者的要求：${needs}`,
          rules
        ].filter(Boolean).join(`
`)
      },
      {
        role: "user",
        content: [
          `【作者索引】
${index}`,
          done && `【已经写出的阶段和节点】
${done}`,
          prevTail && `【上一段转写的结尾（衔接用）】
${prevTail}`,
          `【本段材料：${part.title}】
${part.text}`
        ].filter(Boolean).join(`

`)
      }
    ];
  }
  var IMPORT_STAGE_KEYS = [...STAGE_HINT_KEYS, ...CLUE_STAGE_KEYS], IMPORT_NODE_KEYS = ["名称", "地点", "事件", "偏转", "触发", "类型", "来源", "内容", ...CLUE_NODE_KEYS];
  function splitImportAuthorFields(volumes, part = null) {
    let notes = {};
    return { volumes: (volumes || []).map((v) => ({
      ...v,
      stages: v.stages.map((s) => {
        if (!isPlainObject(s.data)) return s;
        let data = Object.fromEntries(Object.entries(s.data).filter(([k]) => IMPORT_STAGE_KEYS.includes(k)));
        for (let { field: field2, kind } of NODE_FIELDS)
          Array.isArray(data[field2]) && (data[field2] = data[field2].map((n) => {
            if (!isPlainObject(n)) return n;
            let keep = {}, note = {}, authorKey = (k) => IMPORT_AUTHOR_KEYS.includes(k) && !(kind === "world" && k === "来源");
            for (let [k, v2] of Object.entries(n))
              authorKey(k) ? note[k] = v2 : IMPORT_NODE_KEYS.includes(k) && (keep[k] = v2);
            return nodeUid(n) && (Object.keys(note).length || part) && (notes[nodeUid(n)] = {
              ...part ? { 段: part.i + 1, 段标题: part.title, 起: part.start, 止: part.end } : {},
              ...note
            }), keep;
          }));
        return { ...s, data };
      })
    })), notes };
  }
  function importSecretNames(index) {
    let people = index && Array.isArray(index.人物) ? index.人物 : [];
    if (people.length && !(index && index.secretFlag) && !people.some((p) => isPlainObject(p) && "名字保密" in p)) return null;
    let pick = people.filter((p) => isPlainObject(p) && (p.名字保密 === !0 || p.名字保密 === "true" || p.名字保密 === "是"));
    return [
      ...new Set(
        pick.flatMap((p) => [p.名称, ...Array.isArray(p.别名) ? p.别名 : []]).map((n) => String(n || "").trim()).filter((n) => n.length >= 2)
      )
    ];
  }
  function importVisibleText(volumes, mode = "clue") {
    let out = [], stage = "", put = (layer, where, value, field2 = "") => {
      let t = clueText(typeof value == "string" ? value : value == null ? "" : JSON.stringify(value));
      t && out.push({ layer, where, text: t, stage, field: field2 });
    };
    for (let vol of volumes || [])
      for (let st9 of vol.stages || []) {
        let where = stageLabel(st9.key), data = isPlainObject(st9.data) ? st9.data : {};
        if (stage = st9.key, put("body", where, stripAuthorDeep(String(st9.key || "")), "阶段名"), mode !== "clue") {
          for (let [k, v] of Object.entries(outlineStageData(data))) put("body", where, v, k);
          continue;
        }
        put("body", where, data.AI指令, "AI指令"), put("body", where, data.时间范围, "时间范围");
        for (let { field: field2 } of NODE_FIELDS)
          for (let n of Array.isArray(data[field2]) ? data[field2] : []) {
            if (!isPlainObject(n)) {
              put("author", where, n);
              continue;
            }
            let at = `${where}·${clueText(n.名称) || nodeUid(n) || "?"}`, id = nodeUid(n) || clueText(n.名称) || "?";
            put("body", at, n.入口, `${id}.入口`), put("body", at, n.地点, `${id}.地点`), put("body", at, n.场景, `${id}.场景`), put("fill", at, nodeUid(n), `${id}.id`);
            for (let d of Array.isArray(n.发现) ? n.发现 : n.发现 ? [n.发现] : [])
              isPlainObject(d) ? (put("reveal", at, d.内容, `${id}.发现[${d.事实 || "?"}].内容`), put("fill", at, d.记录, `${id}.发现[${d.事实 || "?"}].记录`), put("fill", at, d.事实, `${id}.发现[${d.事实 || "?"}].事实`)) : put("reveal", at, d, `${id}.发现`);
          }
      }
    return out;
  }
  function importIndexMissing(idx) {
    let miss = [];
    return isPlainObject(idx) || miss.push("整个索引"), isPlainObject(idx) && !(Array.isArray(idx.事实) && idx.事实.some((f) => isPlainObject(f) && f.编号)) && miss.push("事实"), miss;
  }
  function importIndexRetryMessages(base, reply2, missing) {
    return [
      ...base,
      { role: "assistant", content: String(reply2 || "") },
      {
        role: "user",
        content: `上面的索引缺少「${missing.join("、")}」。材料里玩家能通过行动查到、听到、看到的关键信息都要列进「事实」（每条一个编号）。请补上，输出完整的索引（同样只输出这一个代码块）。`
      }
    ];
  }
  var IMPORT_LAYER_TEXT = {
    body: "正文每楼都可能看到的字段（阶段名、AI指令、入口、地点、场景）",
    fill: "填表模型看到的字段（编号、记录）",
    reveal: "到场就交给正文的「可能的发现」"
  };
  function checkImportDraft(volumes, { index = null, secrets = null, mode = "clue" } = {}) {
    let out = [], clue = mode === "clue", compiled = clue ? compileClue(volumes || []) : { errors: [] };
    out.push(...compiled.errors.map((t) => ({ level: "error", text: t })));
    let names2 = secrets || importSecretNames(index), hits = /* @__PURE__ */ new Map();
    names2 || (names2 = [], out.push({
      level: "warn",
      text: "这次导入的作者索引没有标出哪些名字需要保密（旧版本整理的），没有做名字保密检查。请自己看一下阶段名、AI指令、入口、场景里有没有不该出现的名字"
    }));
    for (let x of importVisibleText(volumes, mode))
      if (x.layer !== "author")
        for (let s of names2)
          s && s.length >= 2 && x.text.includes(s) && hits.set(`${x.layer}|${s}`, [...hits.get(`${x.layer}|${s}`) || [], x.where]);
    for (let [k, w] of hits) {
      let [layer, s] = k.split("|"), list = [...new Set(w)].join("、");
      layer === "reveal" ? out.push({
        level: "warn",
        text: `保密的名字「${s}」写在「可能的发现」里（${list}）：玩家到场时正文就会拿到它（标明尚未发生）。确认这是这个节点当场就能揭示的；不是的话移到作者备注的 <仅作者> 里`
      }) : out.push({
        level: "error",
        text: `保密的名字「${s}」出现在${IMPORT_LAYER_TEXT[layer]}里（${list}）；只能写在揭示它的那个发现的「内容」或作者备注的 <仅作者> 里`
      });
    }
    let left = /* @__PURE__ */ new Set();
    for (let vol of volumes || [])
      for (let st9 of vol.stages || [])
        for (let { field: field2, kind } of NODE_FIELDS)
          if (kind !== "world")
            for (let n of Array.isArray(st9.data && st9.data[field2]) ? st9.data[field2] : [])
              isPlainObject(n) && IMPORT_AUTHOR_KEYS.forEach((k) => k in n && left.add(k));
    for (let k of left) out.push({ level: "error", text: `正式大纲里还留着只给作者看的字段「${k}」` });
    if (!clue) return out;
    let units = flattenUnits(volumes || []);
    for (let k = 1; k < units.length; k++) {
      let a = /^阶段\s*(\d+)\s*([a-zA-Z])/.exec(units[k - 1].stage.key), b = /^阶段\s*(\d+)\s*([a-zA-Z])/.exec(units[k].stage.key);
      a && b && a[1] === b[1] && out.push({
        level: "error",
        text: `「${stageLabel(units[k - 1].stage.key)}」和「${stageLabel(units[k].stage.key)}」看起来是并行的几条线，却写成了先后两个阶段：后一个要等前一个结束才开放，两条线都变成了必须走的。应合成一个阶段，各条线的节点写「必需: false」，结束条件用「任一」`
      });
    }
    return out.push(...importReachIssues(volumes || [])), out;
  }
  function importReachIssues(applied, { only = null, knownFacts = [], claimedFacts = [] } = {}) {
    let out = [], mine = (x) => !only || only.has(x.stage);
    for (let r of clueAlternativeRoutes(applied, { knownFacts, claimedFacts }))
      mine(r) && (r.verdict === "blocked" ? out.push({
        level: "error",
        text: `替代途径走不通：${r.stage}·${r.node} 单独走完时，${r.why}。常见原因：这条线产出的事实不在阶段结束条件 / 下一阶段进入条件的「任一」里`
      }) : r.verdict === "unknown" && out.push({ level: "warn", text: `替代途径要到运行时才能确认：${r.stage}·${r.node} 单独走完时，${r.why}` }));
    let reach = clueReachability(applied, { knownFacts, claimedFacts }), stuck = [...reach.stuckStages, ...reach.stuckNodes].filter(mine);
    return stuck.length && reach.verdict === "blocked" && out.push({
      level: "error",
      text: `按大纲推演走不通：${stuck.slice(0, 6).map((x) => `${x.stage}${x.node ? `·${x.node}` : ""}（${x.why}）`).join("；")}`
    }), stuck.length && reach.verdict === "unknown" && out.push({
      level: "warn",
      text: `有些地方取决于时间、知情或表格的值：${stuck.slice(0, 4).map((x) => `${x.stage}${x.node ? `·${x.node}` : ""}`).join("、")}`
    }), out;
  }
  function importDoneText(volumes) {
    return flattenUnits(volumes || []).map(
      (u) => `${u.stage.key}：${stageNodes(u.stage.data).map((n) => `${nodeUid(n.item) || "?"} ${n.name}`).join("、") || "（无节点）"}`
    ).join(`
`);
  }
  function mergeImportParts(vols) {
    let stages = [], conflicts = [], asList = (x) => Array.isArray(x) ? x : isPlainObject(x) ? [x] : [], same = (a, b) => JSON.stringify(a) === JSON.stringify(b), empty = (v) => v == null || v === "" || Array.isArray(v) && !v.length, mergeFields = (into, from, skip, where) => {
      for (let [k, v] of Object.entries(from))
        skip.includes(k) || empty(v) || (empty(into[k]) ? into[k] = v : same(into[k], v) || conflicts.push({ ...where, field: k, kept: into[k], other: v }));
    }, mergeNode = (a, b, where) => {
      let finds = asList(a.发现);
      for (let d of asList(b.发现)) {
        let f = isPlainObject(d) ? d.事实 : "", k = f ? finds.findIndex((x) => isPlainObject(x) && x.事实 === f) : finds.findIndex((x) => same(x, d));
        k < 0 ? finds.push(d) : isPlainObject(d) && isPlainObject(finds[k]) && mergeFields(finds[k], d, ["事实"], { ...where, field: `发现 ${f}` });
      }
      return finds.length && (a.发现 = finds), mergeFields(a, b, ["id", "发现"], where), a;
    };
    for (let v of vols || [])
      for (let st0 of v.stages || []) {
        let st9 = JSON.parse(JSON.stringify(st0)), hit = stages.find((x) => x.key === st9.key);
        if (!hit) {
          stages.push(st9);
          continue;
        }
        let where = { stage: stageLabel(st9.key) }, nodeKeys = NODE_FIELDS.map((f) => f.field);
        isPlainObject(st9.data) && isPlainObject(hit.data) && mergeFields(hit.data, st9.data, nodeKeys, where);
        for (let { field: field2 } of NODE_FIELDS)
          for (let n of asList(st9.data && st9.data[field2])) {
            let list = Array.isArray(hit.data[field2]) ? hit.data[field2] : hit.data[field2] = asList(hit.data[field2]), k = list.findIndex((x) => isPlainObject(x) && isPlainObject(n) && x.id && x.id === n.id);
            k >= 0 ? mergeNode(list[k], n, { ...where, node: n.id }) : list.push(n);
          }
      }
    let lineIds = [...new Set((vols || []).map((v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "").filter(Boolean))];
    lineIds.length > 1 && conflicts.push({ stage: "（整份草稿）", field: "线", kept: lineIds[0], other: lineIds.slice(1).join("、"), lines: lineIds });
    let first = vols && vols.length ? vols[0] : null, keepLine = (vols || []).map((v) => v.line).find((l) => isPlainObject(l)), out = first ? [{ ...first, ...keepLine ? { line: keepLine } : {}, stages }] : [];
    return Object.defineProperty(out, "conflicts", { value: conflicts, enumerable: !1 });
  }
  function importConflictText(c) {
    if (c.lines)
      return `草稿里写了好几条剧情线（${c.lines.join("、")}），长文导入暂时只能合成一条：保留了「${c.lines[0]}」，其余几条的阶段并进了这一条，它们的线编号和开启条件没有保留。要分开成几条线，采用后在大纲页让 AI 另写新卷`;
    let s = (v) => (typeof v == "string" ? v : JSON.stringify(v)).slice(0, 80);
    return `${c.stage}${c.node ? `·${c.node}` : ""} 的「${c.field}」两段写得不一样：保留了前一段的「${s(c.kept)}」，后一段是「${s(c.other)}」。需要的话在采用后手动改`;
  }
  var IMPORT_NEEDS_EXAMPLE = "这是我写的剧情方案，开头的真相和人物表只给我自己看，不要放进剧情。调查部分想细一点玩，打斗和赶路带过就行。中间有两条调查线不分先后，走哪条都能继续。原作的反转保留，其他细节可以为了好玩改动。", IMPORT_LINE_INDEX = [
    "支线:   # 这份文档里的每一条支线，按文档顺序。编号从 S01 起，整份文档统一（后面几段沿用前面已经编好的编号）",
    "  - {编号: S01, 名称: 支线的短标题, 主要人物: [..], 开启条件原文: 文档里写的开启时机或前提（没写就省略）, 关系: 和其他支线的关系原文（如「默认在 8 之后」，没写就省略）, 文档里的序号: 文档自己的编号（如「8」）, 本段有经过: 本段材料里有这条支线的具体经过写 true；只在总览表、目录里提到写 false}"
  ].join(`
`);
  function importLineIndexMessages(base) {
    return [
      {
        role: "system",
        content: `${base[0].content.replace(
          /```yaml\n/,
          `\`\`\`yaml
${IMPORT_LINE_INDEX}
`
        )}
这份文档是好几条分别成卷的支线，不要合并成一条连续的剧情。先在「支线」里列出本段出现的每一条支线（一条支线被切成两段时，后一段沿用前一段的编号，不要另建）。
每条支线有没有开启前提，逐条照原文抄进「开启条件原文」「关系」：「分别成卷」不等于「没有前提」，原文写了「默认在 8 之后」就照抄；原文明说「独立」也照抄「独立」；原文没写就省略。`
      },
      base[1]
    ];
  }
  function mergeLineIdentity(list) {
    let here = (l) => !(l.本段有经过 === !1 || l.本段有经过 === "false" || l.本段有经过 === "否"), out = [], byId = /* @__PURE__ */ new Map(), byNo = /* @__PURE__ */ new Map(), notes = [];
    for (let [k, idx] of (list || []).entries())
      for (let l of isPlainObject(idx) && Array.isArray(idx.支线) ? idx.支线 : []) {
        if (!isPlainObject(l) || !l.编号) continue;
        let id = String(l.编号).trim(), hit = byId.get(id), no = String(l.文档里的序号 ?? "").trim();
        if (hit) {
          for (let [kk, v] of Object.entries(l)) (hit[kk] == null || hit[kk] === "") && (hit[kk] = v);
          here(l) && !hit.parts.includes(k) && hit.parts.push(k);
          continue;
        }
        let entry = { ...l, 编号: id, parts: here(l) ? [k] : [] };
        out.push(entry), byId.set(id, entry), no && byNo.has(no) && byNo.get(no) !== id ? notes.push(`文档里第 ${no} 条支线被编了两个编号（${byNo.get(no)}、${id}），请确认是不是同一条`) : no && byNo.set(no, id);
      }
    for (let l of out)
      l.parts.length || (l.parts = (list || []).map(
        (idx, k) => isPlainObject(idx) && Array.isArray(idx.支线) && idx.支线.some((x) => isPlainObject(x) && String(x.编号 || "").trim() === l.编号) ? k : -1
      ).filter((k) => k >= 0));
    return { lines: out, notes };
  }
  function importLineTable(lines2) {
    return (lines2 || []).map(
      (l) => `- ${l.编号}「${clueText(l.名称)}」${l.文档里的序号 ? `（文档第 ${l.文档里的序号} 条）` : ""}${l.主要人物 ? ` 人物：${[].concat(l.主要人物).join("、")}` : ""}${l.开启条件原文 ? ` 开启：${clueText(l.开启条件原文)}` : ""}${l.关系 ? ` 关系：${clueText(l.关系)}` : ""}`
    ).join(`
`);
  }
  var IMPORT_LINES_PER_CALL = 3;
  function importLineBatches(lines2, partNo) {
    let mine = (lines2 || []).filter((l) => !Array.isArray(l.parts) || l.parts.includes(partNo)).map((l) => l.编号), out = [];
    for (let i = 0; i < mine.length; i += IMPORT_LINES_PER_CALL) out.push(mine.slice(i, i + IMPORT_LINES_PER_CALL));
    return out;
  }
  function importLineDraftMessages({
    part,
    index,
    lines: lines2,
    only = [],
    mainLines = "",
    tableCatalog = "",
    prevTail = "",
    needs = "",
    done = ""
  }) {
    let base = importDraftMessages({ part, index, prevTail, mode: "clue", needs, done }), sys = `${base[0].content}
${CLUE_LINE_RULES.join(`
`)}
· 上面说的「只引用有节点产出的事实编号」，线的开启条件例外：它里面的事实可以不需要节点产出。
这份材料是好几条分别成卷的支线：
· 本段里的**每一条**支线写成单独的一卷，卷的第一个键写「线」，类型写「支线」，编号**必须**用【线身份表】里的编号；卷名写「剧情_编号_标题」。不要把两条支线写进同一卷，也不要写主线。
· 一条支线从上一段延续过来时，用同一个编号、同一个卷名，只写新增的阶段或节点。
· 每条支线的事实编号、节点 id 带上这条支线的编号（如 F_s03_poster、s03_cinema），免得不同支线撞号。
· 开启条件和开启时段只照【线身份表】里这条线自己的「开启」「关系」写，每条分开判断，不要照抄同一次写的别的线。三种情况：
  - 写的是「独立」或什么都没写：不写开启条件，也不写开启时段。邀请、碰面这类由头写成第一个节点的入口，不要编成「收到邀请」的事实条件。
  - 写的是「默认在 8 之后」：只写 {线: 文档第 8 条对应的编号 == 完成}，不要再加别的事实或门槛。写的是主线某一步之后：写开启时段或 {线: 主线编号 == …}。
  - 写的是表格和事件都表达不准的经历（「至少与三名队员有单独往来后」）：写「开启方式: 人工」，原话放进「原开启条件」。
· 篇幅默认每条 1～2 个阶段、每个阶段 1～3 个节点，作者备注只写要点；原文里必要的结果和依赖不要为了篇幅删掉。${only.length ? `
· 这一次**只写** ${only.join("、")} 这几条（本段里别的支线另外再写），每一条都要写。` : ""}`, mine = (lines2 || []).filter((l) => only.includes(l.编号)), said = (l) => [clueText(l.开启条件原文), clueText(l.关系)].filter(Boolean).join("；"), gate = mine.length ? `【这一次要写的线：文档对开启的说法】
${mine.map((l) => `- ${l.编号}：${said(l) || "（文档没写）"}`).join(`
`)}
照这里写开启条件：说法是「独立」或没写的，不写开启条件、不写开启时段，也不要加主线的条件；写了「在 N 之后」的，只等文档第 N 条对应的那条线；别的说法照原意写，写不准就人工。` : "", user = [
      `【线身份表（整份文档统一的支线编号，只能用这些）】
${importLineTable(lines2)}`,
      mainLines && `【项目里已有的主线（只有文档明确提到主线时才引用）】
${mainLines}`,
      tableCatalog,
      base[1].content,
      gate
    ].filter(Boolean).join(`

`);
    return [
      { role: "system", content: sys },
      { role: "user", content: user }
    ];
  }
  function importLineIssues(drafts, existing, { index = null, known = [], claimed = [] } = {}) {
    let out = {}, idOf2 = (v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "", add = (id, x) => (out[id] = out[id] || []).push(x);
    for (let v of drafts || []) {
      let id = idOf2(v);
      if (id)
        for (let x of checkImportDraft([v], { index, mode: "clue" }))
          /没有做名字保密检查/.test(x.text) || x.text.startsWith("按大纲推演") || x.text.startsWith("替代途径") || x.text.startsWith("有些地方取决于") || compileClue([v]).errors.includes(x.text) || add(id, x);
    }
    let oldGives = /* @__PURE__ */ new Map();
    for (let n of compileClue(existing || []).nodes)
      for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
        d.fact && !oldGives.has(d.fact) && oldGives.set(d.fact, { node: n.name, text: d.text });
    for (let v of drafts || [])
      for (let n of compileClue([v]).nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) {
          let old = d.fact && oldGives.get(d.fact);
          if (!old || clueText(old.text) === clueText(d.text)) continue;
          let got = known.includes(d.fact);
          add(idOf2(v), {
            level: got ? "error" : "warn",
            text: `线索编号 ${d.fact} 项目里已经有了（「${old.node}」：${old.text}），这条线的「${n.name}」又用它表示「${d.text}」。${got ? "这个聊天里它已经拿到了，采用后这条线会被当成已经查到。" : ""}如果是同一件事的另一条查法可以保留；不是同一件事的话，写意见让 AI 换一个编号`
          });
        }
    let all = [...existing || [], ...drafts || []], mine = new Set((drafts || []).map(idOf2)), reach = clueReachability(all, { knownFacts: known, claimedFacts: claimed });
    for (let id of mine) {
      let stuck = [...reach.stuckStages, ...reach.stuckNodes].filter((x) => x.line === id);
      if (!stuck.length) continue;
      let hard = stuck.filter((x) => !x.unknown), soft = stuck.filter((x) => x.unknown), say = (list) => list.slice(0, 4).map((x) => `${x.stage}${x.node ? `·${x.node}` : ""}（${x.why}）`).join("；");
      hard = hard.filter((x) => !/线 [A-Za-z]+\d+ (未触发|可开启)/.test(x.why)), hard.length && add(id, {
        level: "error",
        text: `这条线走不通：${say(hard)}。常见原因是阶段的进入条件要等本阶段自己才能查到的线索，写意见让 AI 改`
      }), !hard.length && soft.length && add(id, { level: "info", text: `有些地方要到玩的时候才知道能不能走通（取决于时间或表格）：${say(soft)}` });
    }
    return out;
  }
  function lineIdsMissing(volumes, only) {
    let got = new Set((volumes || []).map((v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : ""));
    return (only || []).filter((id) => !got.has(id));
  }
  function mergeImportByLine(vols) {
    let groups = /* @__PURE__ */ new Map(), order = [], conflicts = [];
    for (let v of vols || []) {
      let id = isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "", key = id || `?${v.key}`;
      groups.has(key) || (groups.set(key, []), order.push(key)), groups.get(key).push(v);
    }
    let out = [];
    for (let key of order) {
      let list = groups.get(key), merged = mergeImportParts(list), line = {};
      for (let v of list)
        if (isPlainObject(v.line))
          for (let [k, val] of Object.entries(v.line))
            line[k] == null || line[k] === "" ? line[k] = val : JSON.stringify(line[k]) !== JSON.stringify(val) && conflicts.push({ stage: `线 ${key}`, field: k, kept: line[k], other: val });
      conflicts.push(...merged.conflicts.filter((c) => !c.lines)), key.startsWith("?") && conflicts.push({ stage: volumeLabel(list[0].key), field: "线", kept: "（没写）", other: "", noLine: !0 }), merged[0] && out.push({ ...merged[0], ...Object.keys(line).length ? { line } : {} });
    }
    return Object.defineProperty(out, "conflicts", { value: conflicts, enumerable: !1 });
  }
  function reidLines(drafts, existingVolumes, avoid = [], prior = {}) {
    let taken = new Set(
      (existingVolumes || []).map((v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "").filter(Boolean)
    ), map = {}, refd = new Set(avoid);
    for (let l of compileClue(drafts || []).lines || []) for (let id of conditionRefs(l.open).lines) refd.add(id);
    let next = (id) => {
      let m = /^([A-Za-z]+)(\d+)$/.exec(id), p = m ? m[1] : "S", n = m ? Number(m[2]) : 1, w = m ? m[2].length : 2;
      for (; taken.has(`${p}${String(n).padStart(w, "0")}`) || refd.has(`${p}${String(n).padStart(w, "0")}`); ) n++;
      return `${p}${String(n).padStart(w, "0")}`;
    }, own = (drafts || []).map((v) => isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "").filter(Boolean), clash = new Set(own.filter((id) => taken.has(id)));
    for (let id of own) clash.has(id) || taken.add(id);
    for (let id of own) clash.has(id) && !map[id] && (map[id] = next(id), taken.add(map[id]));
    let report = { ...map };
    for (let [from, to] of Object.entries(prior || {})) !own.includes(from) && from !== to && (map[from] = to);
    if (!Object.keys(map).length) return [drafts, report];
    let fix = (value) => typeof value == "string" ? value.replace(/(线\s*[:：]\s*)([A-Za-z]+\d+)/g, (all, head, id) => map[id] ? `${head}${map[id]}` : all) : Array.isArray(value) ? value.map(fix) : isPlainObject(value) ? Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === "线" && typeof v == "string" ? v.replace(/^\s*([A-Za-z]+\d+)/, (all, id) => map[id] || all) : fix(v)
      ])
    ) : value;
    return [
      drafts.map((v) => {
        let line = isPlainObject(v.line) ? fix({ ...v.line }) : v.line, id = line && String(v.line.编号 || "").trim();
        line && map[id] && (line.编号 = map[id]);
        let key = map[id] ? v.key.replace(id, map[id]) : v.key;
        return { ...v, key, ...line ? { line } : {}, stages: v.stages.map((s) => ({ ...s, data: fix(s.data) })) };
      }),
      report
    ];
  }
  var LINE_FREE_WORDS = /独立|无前提|没有前提|不需要前提|随时/;
  function inventedOpenIssue(vol, ident, mains = []) {
    let line = isPlainObject(vol.line) ? vol.line : {}, id = String(line.编号 || "").trim(), me = (ident || []).find((l) => l.编号 === id), cond = line.开启条件, win = isPlainObject(line.开启时段) && String(line.开启时段.主线 || "").trim() ? line.开启时段 : null, hasCond = !(cond == null || cond === "" || isPlainObject(cond) && !Object.keys(cond).length);
    if (!me || !hasCond && !win) return null;
    let rel = clueText(me.关系), raw = clueText(me.开启条件原文), text2 = `${rel} ${raw}`.trim(), said = text2 || "没写开启前提", esc22 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), mentions = (rid) => {
      let t = (ident || []).find((l) => l.编号 === rid), m = (mains || []).find((l) => l.id === rid), no = t ? String(t.文档里的序号 ?? "").trim() : "";
      return [rid, no, t && clueText(t.名称), m && m.name].filter(Boolean).some(
        (w) => w === no ? new RegExp(`(^|[^0-9])${esc22(w)}(?![0-9])`).test(text2) && !new RegExp(`与\\s*${esc22(w)}\\s*独立`).test(text2) : text2.includes(w)
      );
    }, otherIds = (ident || []).filter((l) => l.编号 !== id), refsAny = otherIds.some((l) => mentions(l.编号)) || (mains || []).some((m) => mentions(m.id)), free = !!text2 && LINE_FREE_WORDS.test(text2) && !refsAny, stance = free ? "free" : text2 ? "stated" : "silent", atoms = [], errs = [], parsed = hasCond ? parseCondition(cond, errs) : null, walk = (c) => c && (c.kind === "group" ? c.items.forEach(walk) : atoms.push(c));
    walk(parsed);
    let lineAtoms = atoms.filter((a) => a.kind === "line"), unbacked = lineAtoms.filter((a) => !mentions(a.line)).map((a) => a.line), others = atoms.filter((a) => a.kind !== "line"), problems2 = [];
    return unbacked.length && problems2.push(`要等 ${unbacked.join("、")}，但文档没提到${unbacked.length > 1 ? "它们" : "它"}`), stance === "free" && others.length && problems2.push(`多了 ${others.map((a) => a.raw || a.kind).join("、")}`), stance !== "free" && lineAtoms.length > unbacked.length && others.length && problems2.push(`除了等线，还多了 ${others.map((a) => a.raw || a.kind).join("、")}，请核对原文有没有这一项`), stance === "free" && win && problems2.push(`加了开启时段（${String(win.主线).trim()}）`), stance === "stated" && !lineAtoms.length && others.length && problems2.push(`是 ${others.map((a) => a.raw || a.kind).join("、")}，请核对原文是不是这个意思`), problems2.length ? {
      text: `${stance === "free" ? `文档里这条是独立的（${said}）` : stance === "stated" ? `文档写的是：${said}` : "文档没写这条的开启前提"}；AI 写的开启条件${problems2.join("；")}`,
      level: stance === "free" || unbacked.length ? "error" : "warn",
      canDrop: stance === "free"
    } : stance === "silent" && hasCond && !lineAtoms.length ? { text: "文档没写这条的开启前提，AI 写了开启条件，请核对原文", level: "warn", canDrop: !1 } : null;
  }
  function droppedLineRefs(kept, dropped, existingVolumes = []) {
    let gone = new Set(dropped), out = [], comp = compileClue([...existingVolumes, ...kept]);
    for (let l of comp.lines || [])
      for (let id of conditionRefs(l.open).lines)
        gone.has(id) && out.push(
          `线 ${l.id}「${l.name}」的开启条件要等 ${id}，但 ${id} 不要了：${l.id} 会一直开不了，可以写意见让 AI 改条件，或者一起不要`
        );
    for (let l of comp.lines || []) l.window && gone.has(l.window.main) && out.push(`线 ${l.id} 的开启时段引用了 ${l.window.main}`);
    return out;
  }
  function lineReviseMessages({ targets, context = "", tableCatalog = "", mainLines = "" }) {
    let fence = "```";
    return [
      {
        role: "system",
        content: [
          `下面几条剧情线（每条是一卷）各带一句作者意见。按意见修改这几条，输出修改后的这几卷（一个 ${fence}yaml 代码块，顶层键是卷名，卷的第一个键是「线」）。`,
          "· 只改列出的这几条，每条都要输出；线的编号不能改；没提到的部分原样保留。",
          "· 别的线只是给你参考，不要输出、不要改。",
          "· 改开启条件时按下面线的写法。意见说「主线到某个阶段以后 / 期间才能开」的，在线下面写单独的字段「开启时段: {主线: M1, 从: 阶段短名}」（要关的话加 到），旧的开启条件去掉（没有别的要求就整个不写）；不要写进开启条件，也不要为它另编一个事实。",
          "· 改剧情内容时，还是同一件事的节点必须沿用原来的 id（哪怕改了名称、入口），新加的事才用新 id。",
          CLUE_OUTLINE_RULES_WITH_LINES
        ].join(`
`)
      },
      {
        role: "user",
        content: [
          mainLines && `【项目里已有的主线】
${mainLines}`,
          context && `【其他线（只读）】
${context}`,
          tableCatalog,
          ...targets.map(
            (t) => `【要改的线 ${t.id}】
意见：${t.comment}
${fence}yaml
${t.yaml}
${fence}`
          )
        ].filter(Boolean).join(`

`)
      }
    ];
  }
  function pickRevised(volumes, ids) {
    let got = {};
    for (let v of volumes || []) {
      let id = isPlainObject(v.line) ? String(v.line.编号 || "").trim() : "";
      id && ids.includes(id) && !got[id] && (got[id] = v);
    }
    return { got, missing: ids.filter((id) => !got[id]) };
  }
  function lineChangeText(before, after) {
    let out = [], show = (v) => v == null || v === "" ? "（无）" : (typeof v == "string" ? v : JSON.stringify(v).replace(/"/g, "")).slice(0, 60), a = isPlainObject(before.line) ? before.line : {}, b = isPlainObject(after.line) ? after.line : {};
    for (let [k, label] of [
      ["类型", "类型"],
      ["简介", "简介"],
      ["开启条件", "开启"],
      ["开启方式", "开启方式"],
      ["开启时段", "时段"],
      ["入口提示", "入口"]
    ])
      JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null) && out.push(`${label}：${show(a[k])} → ${show(b[k])}`);
    let count = (v) => `${v.stages.length} 个阶段 · ${v.stages.reduce((n, s) => n + stageNodes(s.data).length, 0)} 个场景`;
    return count(before) !== count(after) ? out.push(`内容：${count(before)} → ${count(after)}`) : JSON.stringify(before.stages.map((s) => s.data)) !== JSON.stringify(after.stages.map((s) => s.data)) && out.push("内容有改动"), out;
  }
  function mainLinesText(volumes) {
    return (compileClue(volumes || []).lines || []).filter((l) => l.kind === "main").map(
      (l) => `- ${l.id}「${l.name}」阶段：${l.units.map((u) => splitStageKey(u.stage.key).short || stageLabel(u.stage.key)).join("、")}`
    ).join(`
`);
  }

  // src/ui/long-import.js
  var IMPORT_PART_CHARS = 8e3, sti = (view) => {
    let all = view.tabState("import"), id = view.projectId || "";
    return all[id] || (all[id] = {}), all[id];
  };
  function importJobIds(project) {
    return project && Array.isArray(project.imports) ? project.imports : [];
  }
  function importJobOf(view, jobId) {
    let job = jobId ? view.data.imports.get(jobId) : null;
    return job && job.projectId === view.projectId && importJobIds(view.project()).includes(jobId) ? job : null;
  }
  function projectAdopted(project) {
    return new Set(project && Array.isArray(project.importAdopted) ? project.importAdopted : []);
  }
  async function runImportJob(view, jobId) {
    let store = view.data.imports, job = await store.load(jobId), text2 = await store.source(jobId), task = { projectId: view.projectId };
    if (!job) throw new Error("找不到这个导入任务");
    if (job.projectId !== task.projectId) throw new Error("这个导入任务不属于当前项目");
    let still = () => view.projectId === task.projectId && store.get(jobId), parts = job.parts && job.parts.length ? job.parts : splitLongText(text2, { target: IMPORT_PART_CHARS }).map(({ text: _t, ...p }) => p);
    job.parts && job.parts.length || await store.update(jobId, (j) => ({ ...j, parts, step: "index" }));
    let partText = (p) => text2.slice(Math.max(0, p.start - p.lead), p.end), ok = (x) => isPlainObject(x) && !x.error, local = [...store.get(jobId).localIndex || []];
    for (let p of parts) {
      if (!still()) return;
      if (ok(local[p.i])) continue;
      let lines2 = job.mode === "lines", prevIdx = local.filter(ok).length ? {
        ...mergeImportIndex(local.filter(ok)),
        ...lines2 ? { 支线: mergeLineIdentity(local.filter(ok)).lines.map(({ parts: _p, ...l }) => l) } : {}
      } : null, prev = prevIdx ? stringifyYaml(prevIdx) : "", base = importIndexMessages({ part: { ...p, text: partText(p) }, total: parts.length, prev, needs: job.needs }), msgs = lines2 ? importLineIndexMessages(base) : base, reply2 = await ask(view, "outline", msgs), parsed = null, read = (t) => {
        let v = parseYaml(extractYaml(t));
        if (!isPlainObject(v)) throw new Error("没有读到索引内容");
        return v;
      };
      try {
        parsed = read(reply2);
      } catch {
        try {
          parsed = read(await ask(view, "outline", fixYamlMessages(extractYaml(reply2), "格式错误", "outline")));
        } catch (error) {
          parsed = { error: `第 ${p.i + 1} 段的索引读不出来：${error.message}` };
        }
      }
      let miss = ok(parsed) ? importIndexMissing(parsed) : [];
      if (miss.length)
        try {
          let again = read(await ask(view, "outline", importIndexRetryMessages(msgs, reply2, miss)));
          importIndexMissing(again).length < miss.length && (parsed = again);
        } catch {
        }
      local[p.i] = parsed, await store.update(jobId, (j) => ({ ...j, localIndex: local, step: "index" })), view.renderBody();
    }
    let index = mergeImportIndex(local.filter(ok));
    if (await store.update(jobId, (j) => ({ ...j, index, step: "draft" })), job.mode === "lines")
      return runLineDrafts(
        view,
        jobId,
        parts,
        partText,
        local.map((x) => ok(x) ? x : {}),
        index,
        still
      );
    for (let p of parts) {
      if (!still()) return;
      let cur = store.get(jobId);
      if (cur.drafts[p.i] && !cur.drafts[p.i].error) continue;
      let good = Object.values(cur.drafts).filter((d) => !d.error), done = importDoneText(mergeImportParts(good.flatMap((d) => d.volumes || []))), prevTail = p.i && cur.drafts[p.i - 1] && !cur.drafts[p.i - 1].error ? String(cur.drafts[p.i - 1].yaml || "").split(
        `
`
      ).slice(-25).join(`
`) : "", reply2 = await ask(
        view,
        "outline",
        importDraftMessages({
          part: { ...p, text: partText(p) },
          index: stringifyYaml(index),
          prevTail,
          mode: cur.mode,
          needs: cur.needs,
          done
        })
      ), r = parseOutlineReply(reply2);
      r.ok && r.volumes.length || (r = parseOutlineReply(await ask(view, "outline", fixYamlMessages(r.yaml, r.error || "没有读到任何阶段", cur.mode))));
      let entry = r.ok && r.volumes.length ? { yaml: r.yaml, volumes: r.volumes, notes: splitImportAuthorFields(r.volumes, p).notes } : { error: r.error || "没有读到任何阶段", yaml: r.yaml };
      await store.update(jobId, (j) => ({ ...j, drafts: { ...j.drafts, [p.i]: entry } })), view.renderBody();
    }
    let fin = store.get(jobId), failed = importFailedParts(fin);
    await store.update(jobId, (j) => ({ ...j, step: failed.length ? "draft" : "review" })), view.renderBody();
  }
  function importFailedParts(job) {
    let parts = job.parts || [], local = job.localIndex || [], drafts = job.drafts || {};
    return parts.map((p) => {
      let bad = drafts[p.i] && (drafts[p.i].list || []).find((x) => x && x.error), why = local[p.i] && local[p.i].error ? local[p.i].error : drafts[p.i] && drafts[p.i].error ? `第 ${p.i + 1} 段转写失败：${drafts[p.i].error}` : bad ? `第 ${p.i + 1} 段的 ${bad.only.join("、")} 转写失败：${bad.error}` : drafts[p.i] ? "" : `第 ${p.i + 1} 段还没整理`;
      return why ? { i: p.i, title: p.title, why } : null;
    }).filter(Boolean);
  }
  function importCandidate(job) {
    let good = Object.keys(job.drafts || {}).sort((a, b) => a - b).map((k) => job.drafts[k]).filter((d) => d && !d.error), merged = mergeImportParts(good.flatMap((d) => d.volumes || [])), vols = splitImportAuthorFields(merged).volumes, notes = Object.assign({}, ...good.map((d) => d.notes || {})), localOk = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error), index = localOk.length ? mergeImportIndex(localOk) : job.index, issues = checkImportDraft(vols, { index, mode: job.mode === "clue" ? "clue" : "outline" });
    return issues.push(...(merged.conflicts || []).map((c) => ({ level: "warn", text: importConflictText(c) }))), { volumes: vols, notes, issues, index };
  }
  function importAdoptIssues(view, vol, take, index) {
    let project = view.project(), clue = isClueMode(project), issues = [], basis = "", names2 = new Set(take.map((st9) => stageLabel(st9.key))), added = [{ ...vol, stages: take }], applied = [...project.outline.volumes, ...added];
    if (issues.push(...checkImportDraft(added, { index, mode: clue ? "clue" : "outline" }).filter((x) => !/按大纲推演|替代途径/.test(x.text))), !clue) return { issues, basis };
    let c = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, { known, claimed } = chatFactSets(c);
    return basis = c ? `按当前聊天的进度判断（已确认 ${known.length} 个事实${claimed.length ? `，另有 ${claimed.length} 个已出现的说法` : ""}）。` : "这个项目没有在当前聊天启用，按大纲本身判断（不计任何聊天的进度）。", issues.push(...importReachIssues(applied, { only: names2, knownFacts: known, claimedFacts: claimed })), issues.push(
      ...checkClueDraft(added, project.outline.volumes, { isObtained: (id) => known.includes(id) }).filter((x) => /^事实编号 /.test(x)).map((text2) => ({ level: "warn", text: text2 }))
    ), { issues, basis };
  }
  function renderImport(view) {
    let s = sti(view), project = view.project(), ids = importJobIds(project), busy = view.busy[`import:${view.projectId}`];
    if (s.jobId && !importJobOf(view, s.jobId) && view.data.imports.get(s.jobId) && (s.jobId = ""), !s.jobId) {
      let missing = ids.filter((id) => !view.data.imports.get(id) && !(s.unreadable || []).includes(id));
      if (missing.length && !s.loadingList)
        return s.loadingList = !0, Promise.all(missing.map((id) => view.data.imports.load(id).catch(() => null))).then((got) => {
          s.unreadable = [.../* @__PURE__ */ new Set([...s.unreadable || [], ...missing.filter((_, k) => !got[k])])];
        }).finally(() => (s.loadingList = !1, view.renderBody())), '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入记录…</div>';
      let list = ids.map((id) => view.data.imports.get(id)).filter(Boolean), lost = (s.unreadable || []).filter((id) => ids.includes(id));
      return `<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-close">返回大纲</button></h3>
        <label class="pi-field"><span>原文（粘贴，或选择 txt / md 文件）</span><textarea class="pi-ta is-tall" data-imp-text></textarea></label>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="import-pick-file">选择文件…</button></div>
        <label class="pi-field"><span>要求</span><textarea class="pi-ta" rows="4" data-imp-needs placeholder="${esc(IMPORT_NEEDS_EXAMPLE)}"></textarea></label>
        <label class="pi-field"><span>整理成</span><select class="pi-sel" data-imp-mode>${options([{ value: "clue", label: "线索推进的大纲" }, { value: "outline", label: "按阶段推进的大纲" }, ...isClueMode(project) ? [{ value: "lines", label: "好几条支线（每条单独一条线）" }] : []], isClueMode(project) ? "clue" : "outline")}</select></label>
        ${isClueMode(project) ? '<p class="pi-hint">文档是好几条支线（比如「## 1 叶莲娜：……」「## 2 ……」）时选「好几条支线」：每条支线单独成一条线，整理完一页一条审阅，可以写意见、不要哪条，再一起采用。主线建议先导入，支线的开启时段要引用主线的阶段。</p>' : ""}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-start">开始整理</button></div></div>
        ${list.length || lost.length ? `<div class="pi-card"><h3>之前的导入</h3>${list.map((j) => `<div class="pi-set-row"><span>${esc(new Date(j.createdAt).toLocaleString("zh-CN", { hour12: !1 }))} · ${j.chars} 字 · ${j.step === "review" ? "可以审阅" : "未完成"}</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="import-open" data-id="${esc(j.id)}">打开</button><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(j.id)}">删除</button></div>`).join("")}${lost.map((id) => `<div class="pi-set-row"><span class="is-warn">读不到这条导入记录的文件</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(id)}">移除</button></div>`).join("")}</div>` : ""}`;
    }
    let job = importJobOf(view, s.jobId);
    if (!job)
      return s.loadingJob || (s.loadingJob = !0, view.data.imports.load(s.jobId).catch(() => null).then((j) => {
        j && j.projectId === view.projectId || (s.jobId = "", toast("warning", "读不到这个导入任务。"));
      }).finally(() => (s.loadingJob = !1, view.renderBody()))), '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入任务…</div>';
    let parts = job.parts || [], indexed = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error).length, drafted = Object.values(job.drafts || {}).filter((d) => !d.error).length, total = parts.length, failed = importFailedParts(job).filter((f) => !/还没整理/.test(f.why)), progress = `<p class="pi-hint">共 ${total || "?"} 段 · 已读 ${indexed} 段 · 已整理 ${drafted} 段${job.step === "review" ? " · 已完成" : ""}</p>${failed.map((f) => `<p class="pi-hint is-warn">· ${esc(f.why)}</p>`).join("")}`;
    if (job.step !== "review")
      return `<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-run"${busy ? " disabled" : ""}>${busy ? '<span class="pi-spin"></span>整理中' : failed.length ? "重试失败的段" : drafted || indexed ? "继续" : "开始"}</button></div></div>`;
    if (job.mode === "lines")
      return `<div class="pi-card"><h3>导入的支线<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        <p class="pi-hint">整理好了 ${job.lineReview ? job.lineReview.order.length : 0} 条支线。</p>${job.lineReview && job.lineReview.conflicts && job.lineReview.conflicts.length ? job.lineReview.conflicts.slice(0, 8).map((t) => `<p class="pi-hint">· ${esc(t)}</p>`).join("") : ""}
        ${(job.lineIdent && job.lineIdent.notes || []).map((t) => `<p class="pi-hint is-warn">· ${esc(t)}</p>`).join("")}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-lines-review">一条一条审阅</button></div></div>`;
    let cand = importCandidate(job), adopted = projectAdopted(project), stages = cand.volumes[0] ? cand.volumes[0].stages : [], errs = cand.issues.filter((x) => x.level === "error"), warns = cand.issues.filter((x) => x.level !== "error"), pending = cand.index && cand.index.待确认 || [];
    return `<div class="pi-card"><h3>审阅导入结果<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        ${errs.length ? `<p class="pi-hint is-warn"><b>需要处理（${errs.length}）</b></p>${errs.map((x) => `<p class="pi-hint is-warn">· ${esc(x.text)}</p>`).join("")}` : '<p class="pi-hint">整份草稿的检查：没有发现必须处理的问题。采用时会按项目现有大纲和勾选的阶段再查一次。</p>'}
        ${warns.map((x) => `<p class="pi-hint">· ${esc(x.text)}</p>`).join("")}
        ${pending.length ? `<p class="pi-hint"><b>请确认</b></p>${pending.map((x) => `<p class="pi-hint">· ${esc(x)}</p>`).join("")}` : ""}
        ${stages.map((st9) => {
      let key = adoptKey(job.id, 0, st9.key), nodes = stageNodes(st9.data), done = adopted.has(key);
      return `<div class="pi-imp-stage"><div class="pi-set-row"><b>${esc(stageLabel(st9.key))}</b><span class="pi-hint">　${nodes.length} 个节点</span><span class="pi-spacer"></span>${done ? '<span class="pi-badge is-ok">已采用</span>' : `<label class="pi-check"><input type="checkbox" data-imp-pick="${esc(st9.key)}" checked><span>采用</span></label>`}</div>
            ${nodes.map((n) => {
        let note = cand.notes[nodeUid(n.item)] || {};
        return `<p class="pi-hint">· ${esc(n.name)}${note.段 ? `<span class="pi-meta">　第 ${note.段} 段</span>` : ""}${note.待确认 ? `<br><span class="is-warn">待确认：${esc(note.待确认)}</span>` : ""}</p>`;
      }).join("")}
            <details><summary class="pi-hint">YAML</summary><pre class="pi-pre is-full">${esc(stringifyYaml({ [st9.key]: st9.data }))}</pre></details></div>`;
    }).join("")}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-adopt">把勾选的阶段追加为新卷</button></div>
        ${cand.index ? `<details><summary class="pi-hint">作者索引（只给作者看）</summary><pre class="pi-pre is-full">${esc(stringifyYaml(Object.fromEntries(Object.entries(cand.index).filter(([k]) => k !== "secretFlag"))))}</pre></details>` : ""}</div>`;
  }
  var importActions = {
    "import-open-panel"(view) {
      st(view).importing = view.projectId, sti(view).jobId = "", view.renderBody();
    },
    async "import-lines-review"(view) {
      let jobId = sti(view).jobId, job = importJobOf(view, jobId);
      job && (job.lineReview || await view.data.imports.update(jobId, (j) => ({ ...j, lineReview: lineReviewFromJob(j) })), openLineReview(view, "import", jobId));
    },
    "import-close"(view) {
      st(view).importing = "", view.renderBody();
    },
    "import-back"(view) {
      sti(view).jobId = "", view.renderBody();
    },
    async "import-pick-file"(view, target) {
      let files = await pickFiles({ accept: ".txt,.md,.markdown,text/plain", multiple: !1 });
      if (!files || !files.length) return;
      let box = target.closest(".pi-card").querySelector("[data-imp-text]");
      box && (box.value = await files[0].text());
    },
    async "import-start"(view, target) {
      let card = target.closest(".pi-card"), text2 = card.querySelector("[data-imp-text]").value, needs = card.querySelector("[data-imp-needs]").value.trim(), mode = card.querySelector("[data-imp-mode]").value, projectId = view.projectId;
      if (!text2.trim()) return toast("warning", "先粘贴原文，或选择一个文件。");
      let job = await view.data.imports.create({ projectId, text: text2, mode, needs });
      if (view.data.updateProject(projectId, (p) => ({ ...p, imports: [...importJobIds(p), job.id] })), view.projectId !== projectId)
        return toast("info", "导入任务已建好，记在原来的项目里。");
      sti(view).jobId = job.id, view.renderBody(), importActions["import-run"](view);
    },
    async "import-open"(view, target) {
      let id = target.dataset.id, projectId = view.projectId, job = await view.data.imports.load(id).catch(() => null);
      if (view.projectId === projectId) {
        if (!job || job.projectId !== projectId || !importJobIds(view.project()).includes(id))
          return toast("warning", "这个导入任务不属于当前项目。");
        sti(view).jobId = id, view.renderBody();
      }
    },
    async "import-drop"(view, target) {
      if (!await confirmDialog({
        title: "删除导入任务",
        body: "删除这次导入的原文和整理结果。已经采用进大纲的内容不受影响。",
        okLabel: "删除",
        danger: !0
      }))
        return;
      let id = target.dataset.id, projectId = view.projectId;
      importJobIds(view.project()).includes(id) && (await view.data.imports.drop(id), view.data.updateProject(projectId, (p) => ({ ...p, imports: importJobIds(p).filter((x) => x !== id) })), view.renderBody());
    },
    async "import-run"(view) {
      let jobId = sti(view).jobId;
      !jobId || !importJobOf(view, jobId) || (await runTask(view, `import:${view.projectId}`, () => runImportJob(view, jobId)).catch(
        (error) => toast("error", `整理中断：${error.message}。已完成的部分已保存，点「继续」接着做。`)
      ), view.renderBody());
    },
    // 采用：勾选的阶段合成一卷追加到大纲（R3）。
    //   1. 先按项目现有大纲 + 勾选阶段重算检查（R4），有问题先确认；
    //   2. 大纲和「已采用」标识在同一次项目写入里完成（标识以项目为准）；写入前校验失败（如节点编号重复）就什么都不写，可以重试；
    //   3. 之后把标识同步进任务文件（只是显示用；失败了也不影响，项目里的记录才算数）。
    // 每一步异步等待之后都核对：还是同一个项目、任务属于它（R2）。
    async "import-adopt"(view, target) {
      let store = view.data.imports, jobId = sti(view).jobId, projectId = view.projectId, job = importJobOf(view, jobId);
      if (!job) return toast("warning", "这个导入任务不属于当前项目。");
      let same = () => view.projectId === projectId && importJobOf(view, jobId), picked = new Set(
        [...target.closest(".pi-card").querySelectorAll("[data-imp-pick]")].filter((x) => x.checked).map((x) => x.dataset.impPick)
      ), adopted = projectAdopted(view.project()), cand = importCandidate(job), vol = cand.volumes[0], take = vol ? vol.stages.filter((st22) => picked.has(st22.key) && !adopted.has(adoptKey(job.id, 0, st22.key))) : [];
      if (!take.length) return toast("info", "没有新勾选的阶段（已采用的不会重复写入）。");
      let { issues, basis } = importAdoptIssues(view, vol, take, cand.index), errs = issues.filter((x) => x.level === "error"), warns = issues.filter((x) => x.level !== "error");
      if ((errs.length || warns.length) && !await confirmDialog({
        title: errs.length ? "勾选的阶段有问题" : "请确认",
        body: `${basis}追加 ${take.length} 个阶段后检查到：`,
        list: [...errs, ...warns].map((x) => x.text).slice(0, 10),
        okLabel: "仍然追加",
        danger: !!errs.length
      }))
        return;
      if (!same()) return toast("warning", "确认期间切换了项目，没有追加。");
      let keys = take.map((st22) => adoptKey(job.id, 0, st22.key)), project = view.project();
      if (keys.some((k) => projectAdopted(project).has(k))) return toast("info", "这些阶段刚刚已经采用过了。"), view.renderBody();
      let incoming = [{ ...vol, id: makeId("v"), stages: take.map((st22) => ({ ...st22, id: makeId("s") })) }], fresh;
      try {
        let [reid, renamed] = reidConflicts(incoming, project.outline.volumes), existing = new Set(project.outline.volumes.map((v) => v.key));
        fresh = reid.map((v) => existing.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v), renamed.length && toast(
          "warning",
          `有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID：${renamed.slice(0, 5).join("、")}${renamed.length > 5 ? "……" : ""}。`
        );
      } catch (error) {
        return toast("error", `没有追加：${error.message}`);
      }
      view.data.updateProject(projectId, (p) => ({
        ...p,
        outline: { ...p.outline, volumes: [...p.outline.volumes, ...fresh] },
        importAdopted: [...projectAdopted(p), ...keys]
      })), st(view).sel = fresh[0] && fresh[0].id, view.runtime.refresh && view.runtime.refresh(), toast("success", `已追加 ${take.length} 个阶段。`), view.renderBody(), afterAdopt(view), await store.update(jobId, (j) => ({ ...j, adopted: [.../* @__PURE__ */ new Set([...j.adopted || [], ...keys])] })).catch(() => {
      });
    }
  };
  async function runLineDrafts(view, jobId, parts, partText, local, index, still) {
    let store = view.data.imports, ident = mergeLineIdentity(local), tables = currentTables(), catalog = tables ? tableCatalogText(tables) : "", mains = mainLinesText(view.project().outline.volumes);
    await store.update(jobId, (j) => ({ ...j, lineIdent: ident }));
    for (let p of parts) {
      let groups = importLineBatches(ident.lines, p.i);
      for (let [g, only] of (groups.length ? groups : []).entries()) {
        if (!still()) return;
        let cur = store.get(jobId), slot = cur.drafts[p.i] && cur.drafts[p.i].list || [];
        if (slot[g] && !slot[g].error) continue;
        let done = importDoneText(
          mergeImportByLine(
            Object.values(cur.drafts).flatMap((d) => (d.list || []).filter((x) => !x.error).flatMap((x) => x.volumes || []))
          )
        ), draft = (ids) => ask(
          view,
          "outline",
          importLineDraftMessages({
            part: { ...p, text: partText(p) },
            index: stringifyYaml(index),
            lines: ident.lines,
            only: ids,
            mainLines: mains,
            tableCatalog: catalog,
            needs: cur.needs,
            done
          })
        ), r = parseOutlineReply(await draft(only));
        r.ok && r.volumes.length || (r = parseOutlineReply(await ask(view, "outline", fixYamlMessages(r.yaml, r.error || "没有读到任何卷", "clue"))));
        let lost = r.ok ? lineIdsMissing(r.volumes, only) : [];
        if (lost.length && still()) {
          let r2 = parseOutlineReply(await draft(lost));
          r2.ok && (r = {
            ...r,
            yaml: `${r.yaml}
${r2.yaml}`,
            volumes: [...r.volumes, ...r2.volumes]
          }), lost = lineIdsMissing(r.volumes, only);
        }
        let entry = r.ok && r.volumes.length && !lost.length ? { only, yaml: r.yaml, volumes: r.volumes, notes: splitImportAuthorFields(r.volumes, p).notes } : { only, error: lost.length ? `AI 没写 ${lost.join("、")}` : r.error || "没有读到任何卷", yaml: r.yaml };
        await store.update(jobId, (j) => {
          let list = [...j.drafts[p.i] && j.drafts[p.i].list || []];
          return list[g] = entry, { ...j, drafts: { ...j.drafts, [p.i]: { list } } };
        }), view.renderBody();
      }
      groups.length || store.get(jobId).drafts[p.i] || await store.update(jobId, (j) => ({ ...j, drafts: { ...j.drafts, [p.i]: { list: [] } } }));
    }
    let fin = store.get(jobId);
    if (importFailedParts(fin).length) return void await store.update(jobId, (j) => ({ ...j, step: "draft" }));
    let review = fin.lineReview || lineReviewFromJob(fin);
    await store.update(jobId, (j) => ({ ...j, step: "review", lineReview: review })), view.projectId === fin.projectId && openLineReview(view, "import", jobId);
  }

  // src/ui/line-review.js
  var rsOf = (view) => {
    let all = view.tabState("lineReview"), id = view.projectId || "";
    return all[id] || (all[id] = {}), all[id];
  };
  function reviewItems(view) {
    let rs = rsOf(view), project = view.project();
    if (rs.src === "import") {
      let job = importJobOf(view, rs.jobId), lr = job && job.lineReview;
      return lr ? lr.order.map((id) => ({ id, ...lr.items[id] })) : [];
    }
    let saved = rs.items || (rs.items = {});
    return project.outline.volumes.filter((v) => isPlainObject(v.line)).map((v) => {
      let id = String(v.line.编号 || "").trim();
      return { id, vol: v, ...saved[id] || {} };
    });
  }
  function reviewCheck(view, items) {
    let project = view.project(), rs = rsOf(view), tables = currentTables(), kept = items.filter((x) => !x.dropped), base = rs.src === "import" ? project.outline.volumes : project.outline.volumes.filter((v) => !isPlainObject(v.line) || !kept.some((x) => x.vol.id === v.id)), all = [...base, ...kept.map((x) => x.vol)], comp = compileClue(all), dropped = items.filter((x) => x.dropped).map((x) => x.id), depends = droppedLineRefs(
      kept.map((x) => x.vol),
      dropped,
      base
    ), draftIssues = checkClueDraft(
      kept.map((x) => x.vol),
      base
    ).filter((t) => /^线 [A-Za-z]+\d+ 要等的/.test(t)), job0 = rs.src === "import" ? importJobOf(view, rs.jobId) : null, more = {};
    if (job0) {
      let c = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, { known, claimed } = chatFactSets(c), localOk = (job0.localIndex || []).filter((y) => isPlainObject(y) && !y.error), adoptedIds = new Set(kept.filter((y) => adoptedLineOf(project, rs.jobId, y.id)).map((y) => y.id));
      more = importLineIssues(
        kept.filter((y) => !adoptedIds.has(y.id)).map((y) => y.vol),
        base,
        { index: localOk.length ? mergeImportIndex(localOk) : job0.index, known, claimed }
      );
    }
    let out = {};
    for (let x of items) {
      let issues = [], line = comp.lines.find((l) => l.id === x.id), mine = (t) => t.includes(`线 ${x.id}`) || t.includes(`卷「${volumeLabel(x.vol.key)}」`) || x.vol.stages.some((s) => t.includes(stageLabel(s.key)));
      if (x.dropped) out[x.id] = { issues: [], conds: [], line };
      else {
        comp.errors.filter(mine).forEach((t) => issues.push({ level: "error", text: t })), depends.filter((t) => t.startsWith(`线 ${x.id}`)).forEach((t) => issues.push({ level: "error", text: t })), draftIssues.filter((t) => t.startsWith(`线 ${x.id} `)).forEach((t) => issues.push({ level: "error", text: t, fix: "drop-open" }));
        let conds = tables && line ? tableCondChecks(line.open, tables, "开启条件") : [];
        conds.filter((c) => c.level !== "ok").forEach(
          (c) => issues.push({
            level: c.stuck ? "error" : "warn",
            text: `${c.raw}：${c.notes.join("；")}`,
            ...c.tierPending ? { fix: "tiers", tiers: c.tierPending } : {}
          })
        ), line && line.mode === "manual" && line.origCond && issues.push({ level: "info", text: `人工开启。原来的要求：${line.origCond}` });
        let empty = x.vol.stages.filter((s) => !stageNodes(s.data).length).map((s) => stageLabel(s.key));
        empty.length && issues.push({
          level: "error",
          text: `这些阶段没有读到任何场景（节点）：${empty.join("、")}。可能是 AI 把场景写在了不认识的字段下，写意见让 AI 重写这一条`
        });
        let job = rs.src === "import" ? importJobOf(view, rs.jobId) : null, inv = job && job.lineIdent ? inventedOpenIssue(
          x.vol,
          job.lineIdent.lines,
          comp.lines.filter((l) => l.kind === "main")
        ) : null;
        inv && issues.push({ level: inv.level, text: inv.text, ...inv.canDrop ? { fix: "drop-open" } : {} }), (more[x.id] || []).forEach((i) => issues.push(i)), out[x.id] = { issues, conds, line };
      }
    }
    return out;
  }
  var OP_WORD = { "==": "是", "!=": "不是", ">=": "≥", "<=": "≤", ">": ">", "<": "<", 包含: "里有", 不包含: "里没有" };
  function condWords(c, names2 = {}) {
    if (!c) return "";
    let fact = (id) => names2.facts && names2.facts[id] ? `「${names2.facts[id]}」` : id, node = (id) => names2.nodes && names2.nodes[id] ? `「${names2.nodes[id]}」` : id, line = (id) => names2.lines && names2.lines[id] ? `「${names2.lines[id]}」` : `线 ${id}`;
    if (c.kind === "group")
      return c.items.map((x) => condWords(x, names2)).filter(Boolean).join(c.mode === "any" ? "，或者" : "，并且");
    if (c.kind === "cell") {
      let [t, row2, col] = String(c.path).split("/").map((x) => x.trim());
      return `（${t}）${row2}的${col}${c.pick ? `里「${c.pick}」那一项` : ""} ${OP_WORD[c.op] || c.op} ${c.value}${c.tiers ? `（${c.tiers.join(" < ")}）` : ""}`;
    }
    return c.kind === "line" ? `${line(c.line)} ${c.state === "开过" ? c.op === "==" ? "开始过" : "还没开始过" : c.state === "开着" ? c.op === "==" ? "正在进行" : "不在进行中" : `${c.op === "==" ? "是" : "不是"}「${c.state}」`}` : c.kind === "fact" ? `正文里发生了${fact(c.fact)}` : c.kind === "count" ? `${c.table}里 ${c.column} ${OP_WORD[c.op] || c.op} ${c.value} 的${c.cmp}${c.n}行` : c.kind === "know" ? `${c.actor === "user" ? "主角" : c.actor}知道${fact(c.fact)}` : c.kind === "node" ? `场景${node(c.node)}完成` : c.raw || "";
  }
  function condText(line, names2) {
    return line ? line.mode === "manual" ? "手动开始（想玩时点「进入」）" : line.open ? condWords(line.open, names2) : "随时可以开始" : "（读不出来）";
  }
  function condNames(volumes) {
    let comp = compileClue(volumes || []), facts = {}, nodes = {}, lines2 = {};
    for (let n of comp.nodes) {
      n.uid && (nodes[n.uid] = n.name);
      for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
        d.fact && !facts[d.fact] && d.text && (facts[d.fact] = d.text.length > 24 ? `${d.text.slice(0, 24)}…` : d.text);
    }
    for (let l of comp.lines || []) lines2[l.id] = l.name;
    return { facts, nodes, lines: lines2 };
  }
  function renderLineReview(view) {
    let rs = rsOf(view), project = view.project(), items = reviewItems(view), busy = view.busy[`line-review:${view.projectId}`];
    if (!items.length)
      return '<div class="pi-card"><h3>剧情线<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3><p class="pi-hint">还没有剧情线。</p></div>';
    let checks = reviewCheck(view, items), flag = (x2) => x2.dropped ? "✕" : checks[x2.id].issues.some((i) => i.level !== "info") ? "⚠" : x2.comment ? "✎" : x2.changed && x2.changed.length ? "✓" : "", problem = items.filter((x2) => flag(x2) === "⚠"), list = rs.only ? problem : items;
    list.length || (rs.only = !1, list = items);
    let at = Math.max(
      0,
      Math.min(
        list.length - 1,
        list.findIndex((x2) => x2.id === rs.at)
      )
    ), x = list[at < 0 ? 0 : at], c = checks[x.id], v = x.vol, l = isPlainObject(v.line) ? v.line : {};
    rs.at = x.id;
    let mainOpts = mainLinesText(project.outline.volumes) ? compileClue(project.outline.volumes).lines.filter((m) => m.kind === "main") : [], win = isPlainObject(l.开启时段) ? l.开启时段 : {}, curMain = mainOpts.find((m) => m.id === String(win.主线 || "").trim()), stageOpts = (m) => [
      { value: "", label: "不限" },
      ...m ? m.units.map((u) => ({
        value: splitStageKey(u.stage.key).short || stageLabel(u.stage.key),
        label: stageLabel(u.stage.key)
      })) : []
    ], nodes = v.stages.reduce((n, s) => n + stageNodes(s.data).length, 0), pending = items.filter((y) => y.comment && !y.dropped), isImport = rs.src === "import", went = isImport ? adoptedLineOf(project, rs.jobId, x.id) || (projectAdopted(project).has(adoptKey(rs.jobId, "line", x.id)) ? { id: "", name: "" } : null) : null;
    if (went)
      return `<div class="pi-card pi-lr"><h3>导入的支线 · ${items.length} 条<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3>
        <div class="pi-row pi-lr-nav"><button type="button" class="pi-btn" data-act="lr-go" data-dir="-1"${at <= 0 ? " disabled" : ""}>‹ 上一条</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn is-ghost" data-act="lr-list">${at + 1} / ${list.length} ▾</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn" data-act="lr-go" data-dir="1"${at >= list.length - 1 ? " disabled" : ""}>下一条 ›</button></div>
        <div class="pi-lr-item"><div class="pi-row"><b>${esc(volumeLabel(v.key).startsWith(x.id) ? volumeLabel(v.key) : `${x.id} ${volumeLabel(v.key)}`)}</b></div>
          <p class="pi-hint">${went.id ? `已采用为 <b>${esc(went.id)}</b>「${esc(went.name)}」` : "已采用（项目里那一卷已经删掉或改过编号）"}。这里是导入时的草稿，改了不会进大纲；要改请到大纲页「剧情线…」。</p>
          <div class="pi-tools is-end"><button type="button" class="pi-btn is-sm" data-act="lines-open">到「剧情线…」去改</button></div></div>
        <div class="pi-tools is-c2"><span></span><button type="button" class="pi-btn is-primary" data-act="lr-adopt"${busy ? " disabled" : ""}>采用其余的</button></div></div>`;
    let field2 = (k, label, ph = "") => `<label class="pi-field"><span>${label}</span><input class="pi-inp" data-lr-field="${k}" value="${esc(clueText(l[k]))}" placeholder="${esc(ph)}"></label>`, now = c.conds.map(
      (q) => `<p class="pi-hint${q.level === "ok" ? "" : " is-warn"}">现在：${esc(q.now || "（读不到）")}${q.level === "ok" ? " · ✓ 表格里有" : ""}</p>`
    ).join("");
    return `<div class="pi-card pi-lr"><h3>${isImport ? `导入的支线 · ${items.length} 条` : "剧情线"}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3>
        ${problem.length ? `<p class="pi-hint is-warn">⚠ ${problem.length} 条需要看一下 <button type="button" class="pi-btn is-sm is-ghost" data-act="lr-only">${rs.only ? "看全部" : `只看这 ${problem.length} 条`}</button></p>` : ""}
        ${isImport ? '<p class="pi-hint">没问题的可以直接点「采用」；想改哪条就在那条下面写意见，写完一起发送。</p>' : ""}
        <div class="pi-row pi-lr-nav"><button type="button" class="pi-btn" data-act="lr-go" data-dir="-1"${at <= 0 ? " disabled" : ""}>‹ 上一条</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn is-ghost" data-act="lr-list">${at + 1} / ${list.length} ▾</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn" data-act="lr-go" data-dir="1"${at >= list.length - 1 ? " disabled" : ""}>下一条 ›</button></div>
        <div class="pi-lr-item${x.dropped ? " is-dropped" : ""}">
          <div class="pi-row"><b>${esc(volumeLabel(v.key).startsWith(x.id) ? volumeLabel(v.key) : `${x.id} ${volumeLabel(v.key)}`)}</b><span class="pi-spacer"></span>
            <select class="pi-sel is-sm" data-lr-field="类型">${options(
      [
        { value: "支线", label: "支线" },
        { value: "主线", label: "主线" }
      ],
      String(l.类型 || "支线").trim() === "主线" ? "主线" : "支线"
    )}</select></div>
          ${x.dropped ? '<p class="pi-hint is-warn">这条不要了，采用时不会加进大纲。</p>' : ""}
          ${field2("简介", "简介", "一句话，正文看得到，不含答案")}${field2("入口提示", "入口", "线可以开始时给正文的由头")}
          <div class="pi-field"><span>开启</span><p class="pi-hint">${esc(condText(c.line, condNames([...project.outline.volumes, ...items.map((y) => y.vol)])))}</p>${now}</div>
          ${mainOpts.length && String(l.类型 || "").trim() !== "主线" ? `<div class="pi-field"><span>时段</span><div class="pi-row pi-lr-win"><select class="pi-sel is-sm" data-lr-win="主线">${options([{ value: "", label: "不限" }, ...mainOpts.map((m) => ({ value: m.id, label: `${m.id} ${m.name}` }))], curMain ? curMain.id : "")}</select>
            ${curMain ? `从 <select class="pi-sel is-sm" data-lr-win="从">${options(stageOpts(curMain), String(win.从 || ""))}</select> 到 <select class="pi-sel is-sm" data-lr-win="到">${options(stageOpts(curMain), String(win.到 || ""))}</select>` : ""}</div></div>` : ""}
          <details><summary class="pi-hint">内容：${v.stages.length} 个阶段 · ${nodes} 个场景（展开）</summary>${v.stages.map(
      (s) => `<p class="pi-hint"><b>${esc(stageLabel(s.key))}</b>：${stageNodes(s.data).map((n) => esc(n.name)).join("、") || "（无）"}</p>`
    ).join("")}<pre class="pi-pre is-full">${esc(volumeToText(v))}</pre></details>
          ${c.issues.map((i) => `<p class="pi-hint${i.level === "info" ? "" : " is-warn"}">${i.level === "info" ? "" : "⚠ "}${esc(i.text)}${i.fix === "drop-open" ? ' <button type="button" class="pi-btn is-sm" data-act="lr-drop-open" title="删掉整条开启条件和开启时段（不是只删多出来的那一项）">去掉开启条件和时段</button>' : ""}${i.fix === "tiers" ? ` <button type="button" class="pi-btn is-sm" data-act="lr-tiers" data-tiers="${esc(JSON.stringify(i.tiers))}">顺序对，确认</button>` : ""}</p>`).join("")}
          ${x.changed && x.changed.length ? `<p class="pi-hint">✓ 已改过：${esc(x.changed.join("；"))}</p>` : ""}
          <label class="pi-field"><span>意见</span><textarea class="pi-ta" rows="2" data-lr-comment placeholder="例：改成巴基主动来找主角；开启改成主线一结束以后">${esc(x.comment || "")}</textarea></label>
          <div class="pi-row"><span class="pi-hint" data-lr-saved>${x.comment ? "已保存 ✓" : ""}</span>${x.lastComment ? `<span class="pi-hint pi-lr-last">上次的意见：${esc(x.lastComment)}</span>` : ""}<span class="pi-spacer"></span>
            ${isImport ? `<button type="button" class="pi-btn is-sm is-ghost${x.dropped ? "" : " is-danger"}" data-act="lr-drop">${x.dropped ? "还是要这条" : "不要这条"}</button>` : ""}</div>
        </div>
        <div class="pi-tools is-c2"><button type="button" class="pi-btn" data-act="lr-revise"${pending.length && !busy ? "" : " disabled"}>${busy ? '<span class="pi-spin"></span>修改中' : `按意见修改（${pending.length} 条）`}</button>
          ${isImport ? `<button type="button" class="pi-btn is-primary" data-act="lr-adopt"${busy ? " disabled" : ""}>采用</button>` : '<button type="button" class="pi-btn is-ghost" data-act="lr-close">完成</button>'}</div></div>`;
  }
  async function lrUpdate(view, id, fn, to = null) {
    let rs = to || rsOf(view);
    if (rs.src === "import") {
      let job = importJobOf(view, rs.jobId);
      if (!job || !job.lineReview || !job.lineReview.items[id] || adoptedLineOf(view.project(), rs.jobId, id)) return;
      await view.data.imports.update(rs.jobId, (j) => ({
        ...j,
        lineReview: { ...j.lineReview, items: { ...j.lineReview.items, [id]: fn(j.lineReview.items[id]) } }
      }));
      return;
    }
    let p = view.project(), vol = p.outline.volumes.find((v) => isPlainObject(v.line) && String(v.line.编号 || "").trim() === id), cur = { vol, ...(rs.items || {})[id] || {} }, next = fn(cur);
    rs.items = { ...rs.items || {}, [id]: { comment: next.comment, lastComment: next.lastComment, changed: next.changed } }, next.vol !== vol && view.data.updateProject(p.id, (q) => ({
      ...q,
      outline: { ...q.outline, volumes: q.outline.volumes.map((v) => v.id === vol.id ? { ...next.vol, id: v.id } : v) }
    })), next.vol !== vol && view.runtime.refresh && view.runtime.refresh();
  }
  function setLineField(vol, key, value) {
    let line = { ...vol.line };
    return value === "" || value == null ? delete line[key] : line[key] = value, { ...vol, line };
  }
  async function lrOnChange(view, target) {
    let id = rsOf(view).at;
    if (target.dataset.lrField !== void 0) {
      let k = target.dataset.lrField, val = target.value.trim();
      return await lrUpdate(view, id, (x) => clueText(x.vol.line[k]) === val ? x : { ...x, vol: setLineField(x.vol, k, val) }), k === "类型" && view.renderBody(), !0;
    }
    if (target.dataset.lrWin !== void 0) {
      let card = target.closest(".pi-lr"), get = (k) => card.querySelector(`[data-lr-win="${k}"]`)?.value || "", main = get("主线"), win = main ? {
        主线: main,
        ...get("从") && target.dataset.lrWin !== "主线" ? { 从: get("从") } : {},
        ...get("到") && target.dataset.lrWin !== "主线" ? { 到: get("到") } : {}
      } : "";
      return await lrUpdate(view, id, (x) => ({ ...x, vol: setLineField(x.vol, "开启时段", win) })), view.renderBody(), !0;
    }
    if (target.dataset.lrComment !== void 0) {
      let text2 = target.value.trim();
      await lrUpdate(view, id, (x) => ({ ...x, comment: text2 }));
      let s = target.closest(".pi-lr-item")?.querySelector("[data-lr-saved]");
      s && (s.textContent = text2 ? "已保存 ✓" : "");
      let n = reviewItems(view).filter((y) => y.comment && !y.dropped).length, b = target.closest(".pi-lr")?.querySelector('[data-act="lr-revise"]');
      return b && !view.busy[`line-review:${view.projectId}`] && (b.textContent = `按意见修改（${n} 条）`, b.disabled = !n), !0;
    }
    return !1;
  }
  function lineReviewFromJob(job) {
    let good = Object.keys(job.drafts || {}).sort((a, b) => a - b).flatMap(
      (k) => (job.drafts[k] && !job.drafts[k].error ? job.drafts[k].list || [job.drafts[k]] : []).flatMap((d) => d.volumes || [])
    ), merged = mergeImportByLine(good), vols = splitImportAuthorFields(merged).volumes.filter((v) => isPlainObject(v.line)), items = {}, order = [];
    for (let v of vols) {
      let id = String(v.line.编号 || "").trim();
      !id || items[id] || (items[id] = { vol: v, comment: "", lastComment: "", changed: [], dropped: !1 }, order.push(id));
    }
    return {
      items,
      order,
      conflicts: merged.conflicts.map(importConflictText),
      loose: merged.filter((v) => !isPlainObject(v.line)).length
    };
  }
  function openLineReview(view, src, jobId = "") {
    let rs = rsOf(view);
    rs.src = src, rs.jobId = jobId, rs.at = "", rs.only = !1, src === "project" && (rs.items = {}), st(view).lineReview = view.projectId, view.renderBody();
  }
  async function reviseByComments(view) {
    let rs = rsOf(view), items = reviewItems(view), todo = items.filter((x) => x.comment && !x.dropped);
    if (!todo.length) return;
    let to = { src: rs.src, jobId: rs.jobId }, sent = Object.fromEntries(todo.map((x) => [x.id, x.comment])), projectId = view.projectId, project = view.project(), tables = currentTables(), context = items.filter((x) => !todo.includes(x) && !x.dropped).map((x) => `- ${x.id}「${volumeLabel(x.vol.key)}」${clueText(x.vol.line.简介)}`).join(`
`), snap2 = Object.fromEntries(todo.map((x) => [x.id, JSON.stringify(x.vol)])), msgs = lineReviseMessages({
      targets: todo.map((x) => ({ id: x.id, yaml: volumeToText(x.vol), comment: x.comment })),
      context,
      tableCatalog: tables ? tableCatalogText(tables) : "",
      mainLines: mainLinesText(project.outline.volumes)
    }), r = parseOutlineReply(await ask(view, "outline", msgs));
    if (r.ok || (r = parseOutlineReply(await ask(view, "outline", fixYamlMessages(r.yaml, r.error || "格式错误", "clue")))), view.projectId !== projectId)
      return;
    if (!r.ok) throw new Error(`AI 的回复读不出来（${r.error}），意见都还在，可以再试一次`);
    let nowItems = rs.src === to.src && rs.jobId === to.jobId ? reviewItems(view) : (() => {
      let saved = { src: rs.src, jobId: rs.jobId };
      rs.src = to.src, rs.jobId = to.jobId;
      try {
        return reviewItems(view);
      } finally {
        rs.src = saved.src, rs.jobId = saved.jobId;
      }
    })(), gone = nowItems.filter((x) => x.dropped && sent[x.id] !== void 0).map((x) => x.id), { got, missing } = pickRevised(
      splitImportAuthorFields(r.volumes).volumes,
      todo.map((x) => x.id)
    ), skipped = [];
    for (let id of gone) delete got[id];
    let now = Object.fromEntries(nowItems.map((x) => [x.id, x])), after = (x, id) => ({ lastComment: sent[id], comment: (x.comment || "") === sent[id] ? "" : x.comment });
    if (to.src === "project") {
      let next = project.outline.volumes;
      for (let [id, vol] of Object.entries(got)) {
        let cur = now[id];
        if (!cur || JSON.stringify(cur.vol) !== snap2[id]) {
          skipped.push(id);
          continue;
        }
        next = next.map(
          (v) => v.id === cur.vol.id ? { ...vol, id: v.id, stages: vol.stages.map((s, i) => ({ ...s, id: (v.stages[i] || {}).id || s.id })) } : v
        );
      }
      let c = view.runtime.activeId() === projectId ? view.runtime.clue.compute() : null, guard = c ? historyGuard(project.outline.volumes, next, c.snap, c.prog, project.clue) : null, warn = guard ? [...guard.diffs, ...guard.notes] : [], changes = Object.keys(got).filter((id) => !skipped.includes(id)).map((id) => `${id}：${lineChangeText(now[id].vol, got[id]).join("；") || "没有变化"}`);
      if (!changes.length) return toast("info", "没有可以采用的修改。");
      if (!await confirmDialog({
        title: "按意见修改",
        body: `改动如下${warn.length ? "；按这个聊天的进度检查到：" : "。"}`,
        list: [...changes, ...warn],
        okLabel: "采用修改",
        danger: !!guard && guard.diffs.length > 0
      }))
        return;
      if (view.projectId !== projectId || JSON.stringify(view.project().outline.volumes) !== JSON.stringify(project.outline.volumes))
        return toast("warning", "确认期间大纲又变了，没有采用，请再试一次。");
      view.data.updateProject(projectId, (p) => ({ ...p, outline: { ...p.outline, volumes: next } })), view.runtime.refresh && view.runtime.refresh();
      let mem = rs.src === "project" ? rs.items || (rs.items = {}) : {};
      for (let id of Object.keys(got))
        skipped.includes(id) || (mem[id] = { ...mem[id], ...after(mem[id] || {}, id), changed: lineChangeText(now[id].vol, got[id]) });
      afterAdopt(view);
    } else
      for (let [id, vol] of Object.entries(got)) {
        let cur = now[id];
        if (!cur || JSON.stringify(cur.vol) !== snap2[id]) {
          skipped.push(id);
          continue;
        }
        await lrUpdate(
          view,
          id,
          (x) => ({ ...x, vol: { ...vol, id: x.vol.id }, ...after(x, id), changed: lineChangeText(x.vol, vol) }),
          to
        );
      }
    let ok = Object.keys(got).length - skipped.length, fresh = Object.keys(got).filter(
      (id) => !skipped.includes(id) && now[id] && (now[id].comment || "") !== sent[id] && now[id].comment
    );
    toast(
      missing.length || skipped.length || gone.length ? "warning" : "success",
      `改好 ${ok} 条${missing.length ? `；${missing.join("、")} 没改成，意见留着` : ""}${skipped.length ? `；${skipped.join("、")} 在修改期间被你改过，没有覆盖` : ""}${gone.length ? `；${gone.join("、")} 在修改期间标了不要，结果没用` : ""}${fresh.length ? `；${fresh.join("、")} 等待期间写的新意见还没发送` : ""}。`
    );
  }
  function adoptedLineOf(project, jobId, id) {
    let volId = project && project.importLineMap && project.importLineMap[`${jobId}:${id}`], vol = volId && project.outline.volumes.find((v) => v.id === volId);
    return vol && isPlainObject(vol.line) ? { id: String(vol.line.编号 || "").trim(), name: volumeLabel(vol.key), volId } : null;
  }
  async function adoptLineReview(view) {
    let rs = rsOf(view), projectId = view.projectId, jobId = rs.jobId, job = importJobOf(view, jobId);
    if (!job || !job.lineReview) return;
    let items = reviewItems(view), pending = items.filter((x) => x.comment && !x.dropped);
    if (pending.length) {
      let pick = await choiceDialog({
        title: "还有意见没让 AI 改",
        body: `${pending.length} 条线写了意见，还没让 AI 改。直接采用的话，这些线按现在的样子加进大纲，意见不生效。`,
        choices: [
          { label: "取消", value: null },
          { label: "不改，直接采用", value: "adopt" },
          { label: "先让 AI 按意见改", value: "send", primary: !0 }
        ]
      });
      if (pick === "send") return lrActions["lr-revise"](view);
      if (pick !== "adopt") return;
    }
    let project = view.project(), adopted = projectAdopted(project), take = items.filter((x) => !x.dropped && !adopted.has(adoptKey(jobId, "line", x.id)) && !adoptedLineOf(project, jobId, x.id));
    if (!take.length) return toast("info", "没有要采用的支线（已采用的不会重复写入）。");
    let checks = reviewCheck(view, items), errs = take.flatMap((x) => checks[x.id].issues.filter((i) => i.level === "error").map((i) => `${x.id}：${i.text}`));
    if (errs.length && !await confirmDialog({
      title: `${errs.length} 处问题`,
      body: "有问题的线可能一直开始不了。采用后也可以在大纲页「剧情线…」或执行页里再改：",
      list: errs.slice(0, 10),
      okLabel: "仍然采用",
      danger: !0
    }))
      return;
    if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast("warning", "确认期间切换了项目，没有采用。");
    project = view.project();
    let fresh, lineMap = {};
    try {
      let prior = Object.fromEntries(
        items.map((x) => [x.id, adoptedLineOf(project, jobId, x.id)]).filter(([, l]) => l).map(([id, l]) => [id, l.id])
      ), [byLine, map] = reidLines(
        take.map((x) => x.vol),
        project.outline.volumes,
        items.map((x) => x.id),
        prior
      ), [reid, renamed] = reidConflicts(
        byLine.map((v) => ({ ...v, id: makeId("v"), stages: v.stages.map((s) => ({ ...s, id: makeId("s") })) })),
        project.outline.volumes
      ), keys2 = new Set(project.outline.volumes.map((v) => v.key));
      fresh = reid.map((v) => keys2.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v), lineMap = Object.fromEntries(take.map((x, i) => [`${jobId}:${x.id}`, fresh[i].id])), Object.keys(map).length && toast(
        "warning",
        `有 ${Object.keys(map).length} 条支线的编号和已有的线重复，已换成：${Object.entries(map).map(([a, b]) => `${a}→${b}`).join("、")}（本批内部的引用一起改了）。`
      ), renamed.length && toast("warning", `有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID。`);
    } catch (error) {
      return toast("error", `没有采用：${error.message}`);
    }
    let keys = take.map((x) => adoptKey(jobId, "line", x.id));
    view.data.updateProject(projectId, (p) => ({
      ...p,
      outline: { ...p.outline, volumes: [...p.outline.volumes, ...fresh] },
      importAdopted: [...projectAdopted(p), ...keys],
      importLineMap: { ...p.importLineMap || {}, ...lineMap }
    })), view.runtime.refresh && view.runtime.refresh(), toast("success", `已采用 ${take.length} 条支线。`), st(view).lineReview = "", st(view).importing = "", view.renderBody(), afterAdopt(view);
  }
  var lrActions = {
    "lr-close"(view) {
      st(view).lineReview = "", view.renderBody();
    },
    "lr-go"(view, target) {
      let rs = rsOf(view), items = reviewItems(view), checks = reviewCheck(view, items), list = rs.only ? items.filter((x) => checks[x.id].issues.some((i) => i.level !== "info") && !x.dropped) : items, at = list.findIndex((x) => x.id === rs.at);
      rs.at = (list[Math.max(0, Math.min(list.length - 1, at + Number(target.dataset.dir)))] || {}).id || rs.at, view.renderBody();
    },
    "lr-only"(view) {
      let rs = rsOf(view);
      rs.only = !rs.only, view.renderBody();
    },
    async "lr-list"(view) {
      let items = reviewItems(view), checks = reviewCheck(view, items), mark = (x) => x.dropped ? "✕ " : checks[x.id].issues.some((i) => i.level !== "info") ? "⚠ " : x.comment ? "✎ " : x.changed && x.changed.length ? "✓ " : "", sorted = [...items].sort((a, b) => (mark(b) === "⚠ ") - (mark(a) === "⚠ ")), id = await menuDialog({
        title: "跳到",
        items: sorted.map((x) => ({
          value: x.id,
          label: `${mark(x)}${volumeLabel(x.vol.key).startsWith(x.id) ? volumeLabel(x.vol.key) : `${x.id} ${volumeLabel(x.vol.key)}`}`
        }))
      });
      id && (rsOf(view).at = id, rsOf(view).only = !1, view.renderBody());
    },
    async "lr-tiers"(view, target) {
      let id = rsOf(view).at, tiers = JSON.parse(target.dataset.tiers || "[]");
      await lrUpdate(view, id, (x) => {
        let [vol] = confirmTierOrder([x.vol], tiers);
        return vol === x.vol ? x : { ...x, vol, changed: [...x.changed || [], `确认了档位顺序 ${tiers.join(" < ")}`] };
      }), view.renderBody();
    },
    async "lr-drop-open"(view) {
      let id = rsOf(view).at;
      await lrUpdate(view, id, (x) => ({
        ...x,
        vol: setLineField(setLineField(x.vol, "开启条件", ""), "开启时段", ""),
        changed: [...x.changed || [], "去掉了开启条件和时段"]
      })), view.renderBody();
    },
    async "lr-drop"(view) {
      let id = rsOf(view).at;
      await lrUpdate(view, id, (x) => ({ ...x, dropped: !x.dropped })), view.renderBody();
    },
    async "lr-revise"(view) {
      let box = hostDocument().querySelector(".pi-lr [data-lr-comment]");
      box && await lrOnChange(view, box), await runTask(view, `line-review:${view.projectId}`, () => reviseByComments(view)).catch(
        (error) => toast("error", error.message)
      ), view.renderBody();
    },
    async "lr-adopt"(view) {
      let box = hostDocument().querySelector(".pi-lr [data-lr-comment]");
      box && await lrOnChange(view, box), await adoptLineReview(view);
    },
    "lines-open"(view) {
      let rs = rsOf(view), went = rs.src === "import" ? adoptedLineOf(view.project(), rs.jobId, rs.at) : null;
      openLineReview(view, "project"), went && (rsOf(view).at = went.id, view.renderBody());
    }
  };

  // src/core/fact-labels.js
  function factLabelContext(volumes, codes = null) {
    let compiled = compileClue(volumes || []), want = codes ? new Set(codes) : null, out = /* @__PURE__ */ new Map();
    for (let node of compiled.nodes) {
      let item = isPlainObject(node.item) ? node.item : {};
      for (let d of discoveryList(item)) {
        if (!d.fact || want && !want.has(d.fact)) continue;
        let route = {
          stage: stageLabel(node.unit.stage.key),
          nodeName: clueText(item.名称) || node.name || "",
          entry: clueText(item.入口),
          place: clueText(item.地点),
          scene: clueText(item.场景),
          answer: d.text,
          record: d.record
        };
        if (out.has(d.fact)) {
          out.get(d.fact).routes.push(route);
          continue;
        }
        out.set(d.fact, { code: d.fact, node: node.uid || "", ...route, routes: [], usedBy: [] });
      }
    }
    let note = (cond, where) => {
      if (cond) {
        if (cond.kind === "group") return cond.items.forEach((x) => note(x, where));
        cond.kind !== "fact" && cond.kind !== "know" || want && !want.has(cond.fact) || (out.has(cond.fact) || out.set(cond.fact, {
          code: cond.fact,
          node: "",
          nodeName: "",
          entry: "",
          place: "",
          scene: "",
          answer: "",
          record: "",
          stage: "",
          routes: [],
          usedBy: [],
          orphan: !0
        }), out.get(cond.fact).usedBy.push(
          `${where}（${cond.kind === "know" ? `${cond.verified ? "核实" : "知情"}@${cond.actor}` : cond.verified ? "核实" : "事实"}）`
        ));
      }
    }, byId = new Map((compiled.lines || []).map((l) => [l.id, l]));
    for (let [f, ids] of lineTriggerFacts(compiled)) {
      if (want && !want.has(f) || out.has(f)) continue;
      let l = byId.get(ids[0]);
      out.set(f, {
        code: f,
        node: "",
        nodeName: `线 ${ids.join("、")}「${l.name}」开启前要发生的事`,
        entry: l.entryHint,
        place: "",
        scene: l.brief,
        answer: "",
        record: "",
        stage: "",
        routes: [],
        usedBy: [`线 ${ids.join("、")} 的开启条件（正文里发生这件事时登记）`],
        opening: l.id
      });
    }
    for (let u of compiled.units)
      u.clue && (note(u.clue.enter, `${stageLabel(u.stage.key)}的进入条件`), note(u.clue.end, `${stageLabel(u.stage.key)}的结束条件`));
    for (let l of compiled.lines || []) note(l.open, `线 ${l.id} 的开启条件`);
    for (let n of compiled.nodes)
      [
        [n.open, "开放条件"],
        [n.done, "完成条件"],
        [n.early, "提前条件"]
      ].forEach(([c, k]) => note(c, `${n.uid || n.name}的${k}`));
    return [...codes || out.keys()].map(
      (code) => out.get(code) || {
        code,
        node: "",
        nodeName: "",
        entry: "",
        place: "",
        scene: "",
        answer: "",
        record: "",
        stage: "",
        routes: [],
        usedBy: [],
        orphan: !0
      }
    );
  }
  function factLabelMessages(items, { secrets = [] } = {}) {
    let fence = "```", block = items.map(
      (x) => [
        `- 编号: ${x.code}`,
        x.stage && `  所在阶段: ${x.stage}`,
        x.nodeName && `  所在节点: ${x.nodeName}`,
        x.entry && `  入口（正文看得到）: ${x.entry}`,
        x.place && `  地点: ${x.place}`,
        x.scene && `  场景（正文看得到）: ${x.scene}`,
        x.answer && `  发现内容（答案，不能写进标签和口径）: ${x.answer}`,
        x.record && `  作者写的登记标准（可能含答案，只作参考）: ${x.record}`,
        ...(x.routes || []).map(
          (r, k) => [
            `  另一种取得方式 ${k + 1}: ${[r.stage, r.nodeName].filter(Boolean).join(" · ")}`,
            r.entry && `    入口: ${r.entry}`,
            r.scene && `    场景: ${r.scene}`,
            r.answer && `    这条路查到的（答案）: ${r.answer}`,
            r.record && `    作者写的登记标准: ${r.record}`
          ].filter(Boolean).join(`
`)
        ),
        x.usedBy.length && `  被这些条件用到: ${x.usedBy.join("；")}`,
        x.orphan && "  注意：大纲里没有节点产出这个事实"
      ].filter(Boolean).join(`
`)
    ).join(`
`);
    return [
      {
        role: "system",
        content: [
          "你在帮作者给剧情里的关键事实写两样东西。它们会写进数据库表格，填表模型每一楼都看得到，所以都不能透露答案。",
          "1. 标签：两到八个字的中性名字，只说「这是关于什么的」，不说「查到了什么」。例：「看守的证词」「抽屉里的单据」。不写人物真名、身份、动机、结论。",
          "2. 登记口径：一两句话，写清「正文里出现什么，才算主角拿到了这一条」。要卡在刚好那一步：",
          "   · 写取得的动作和看到的程度（当面听到、亲手打开读到、看清是什么），不写看到的内容本身。",
          "   · 写清什么不算：只是到了地方、看到上了锁、对方推托没开口、远远看见还没看清、主角自己猜的，都不算。",
          "   · 证词、传闻、某人的说法：写「对方当面说出时登记，记为存疑」。实物、痕迹、原件、亲眼验证：写「亲眼看清 / 读到时登记」，不写存疑——实物本身看不出是谁的、说明不了什么，也照样是亲眼看到的，不是存疑。",
          "   · 判断、结论类的（如「证词被推翻」）：口径写「读到某样东西之后，正文里明确说出这个判断时登记」，不要把判断的具体内容写进去（不写推翻了谁、跟什么无关）。",
          "   · 一条事实有「另一种取得方式」的：口径要把每种方式都包括进去（如「读到物流单上的地址，或证人当面说出地址时登记」），不要只写一种，否则走另一条路的玩家永远登记不上。一种是说法、一种是实物时，可以写「先记为存疑，拿到实物后改为已核实」。",
          "   · 被条件用作「核实」的，口径要写到被证实的那一步；只用作「事实」的，写到正文里出现即可。",
          "   · 作者登记标准里只说形式、位置、不说内容的细节要保留（如「背面那行铅笔字」「信封上的邮戳」「抽屉最底层的单据」），口径才卡得准是哪一步；不要写成「亲眼看清时」这种看到什么都算的说法。",
          "   · 口径不能和大纲的取得方式冲突：大纲里是某人当面说出的，不要要求拆开、读到原件；东西在场景里本来就没打开的，不要把「没打开」写成不算。",
          "   · 例：「主角打开账房的抽屉、读到里面单据的内容时登记；只看到锁着的抽屉不算」。",
          secrets.length ? `这些名字在揭示之前不能出现在标签和口径里：${secrets.join("、")}。` : "",
          "作者给的材料不一定严丝合缝：节点信息可能缺，发现可能写得含糊，几条事实可能说的是同一件事，或者看不出靠什么行动取得。",
          "遇到这些情况不要硬编：照样尽量写一个保守的版本（宁可登记得晚，不要登记得早），并在 unsure 里用一句话说明哪里拿不准、建议作者补什么。没有问题就不写 unsure。",
          `只输出一个 ${fence}yaml 代码块，格式：`,
          `${fence}yaml`,
          "- 编号: F_xxx",
          "  标签: …",
          "  口径: …",
          "  unsure: …   # 可省略",
          fence,
          "每个编号都要输出，顺序和输入一致，编号原样照抄。"
        ].filter(Boolean).join(`
`)
      },
      {
        role: "user",
        content: `【事实】
${block}`
      }
    ];
  }
  function parseFactLabels(text2, codes) {
    let list = parseYaml(extractYaml(text2)), map = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : isPlainObject(list) && Array.isArray(list.事实) ? list.事实 : []) {
      if (!isPlainObject(x)) continue;
      let code = String(x.编号 || x.code || "").trim();
      code && codes.includes(code) && !map.has(code) && map.set(code, {
        label: clueText(x.标签 || x.label || ""),
        criterion: clueText(x.口径 || x.登记口径 || x.criterion || ""),
        unsure: clueText(x.unsure || x.拿不准 || "")
      });
    }
    return { items: map, missing: codes.filter((c) => !map.has(c)) };
  }
  function answerMinusPublic(answer, publicText) {
    let a = String(answer || ""), pub = String(publicText || ""), mark = new Array(a.length).fill(!1);
    if (!pub) return a;
    for (let len = Math.min(12, a.length); len >= 4; len--)
      for (let i = 0; i + len <= a.length; i++) pub.includes(a.slice(i, i + len)) && mark.fill(!0, i, i + len);
    return [...a].map((ch, i) => mark[i] ? "|" : ch).join("");
  }
  function factLabelCheck({ label = "", criterion = "", unsure = "" }, ctx2 = {}, { secrets = [] } = {}) {
    let routes = [ctx2, ...ctx2.routes || []].filter((r) => r && r.answer), answers = routes.map(
      (r) => answerMinusPublic(
        r.answer,
        [r.entry, r.place, r.scene].filter(Boolean).join(`
`)
      )
    ), warns = [], suspects = [], notes = [], hit = (t) => answers.map((a) => answerOverlap(t, a)).find(Boolean) || "";
    !label && warns.push("还没有标签"), !criterion && warns.push("还没有登记口径"), label && hit(label) && suspects.push({ where: "标签", piece: hit(label) }), criterion && hit(criterion) && suspects.push({ where: "口径", piece: hit(criterion) });
    for (let s of secrets) s && s.length >= 2 && `${label} ${criterion}`.includes(s) && warns.push(`出现了保密的名字「${s}」`);
    return label && label.length > 12 && warns.push("标签有点长，最好十个字以内"), criterion && !/不算|不计|不登记|不记|不能算|不能登记|没.{0,4}[开说读看到]|未.{0,2}[读看开]/.test(criterion) && warns.push("口径没写清楚什么情况不算（容易登记得太早）"), unsure && notes.push(unsure), ctx2.orphan && warns.push("大纲里没有节点产出这个事实"), { warns, suspects, notes };
  }
  function factLabelReviewMessages(items) {
    let fence = "```", block = items.map(
      (x) => [
        `- 编号: ${x.code}`,
        x.entry && `  入口（正文本来就看得到）: ${x.entry}`,
        x.scene && `  场景（正文本来就看得到）: ${x.scene}`,
        `  答案（填表模型不该提前知道）: ${x.answer}`,
        x.record && `  作者写的登记标准（可能含答案，不能照抄；用来判断口径哪些门槛必须保留）: ${x.record}`,
        `  标签: ${x.label}`,
        `  口径: ${x.criterion}`,
        x.pieces && x.pieces.length && `  和答案字面重合的片段: ${x.pieces.join("、")}`
      ].filter(Boolean).join(`
`)
    ).join(`
`);
    return [
      {
        role: "system",
        content: [
          "你在检查剧情线索的「标签」和「登记口径」有没有剧透。它们每一楼都会发给填表模型，填表模型在主角查到之前，不该从这两样里知道答案。",
          "按这三步判断：",
          "1. 把答案拆成具体的信息点：谁、什么东西、什么状态、什么结论、什么关系、数字、地点。「A 和 B 有关系」本身就是一个信息点，哪怕没说是什么关系。",
          "2. 去掉入口、场景里本来就写明的信息点（正文看得到，不算秘密）。",
          "3. 剩下的信息点里，有没有任何一个出现在标签或口径里（原话、换个说法、或者说得更笼统但缩小了范围，都算）？有 → 透露了；没有 → 没透露。",
          "   「缩小了范围」：答案是「二少爷端的汤」，口径写「府上一位少爷端的」，虽然没点名，但把嫌疑从所有人缩到少爷们，算透露。只说「谁端的」不缩小范围。",
          "例：答案「柜台后的地板有一块是新换的，下面传出敲击声」，入口只说去当铺。信息点「新换的地板」「下面有敲击声」都不在入口里；口径写「发现新换的地板、听到敲击声时登记」→ 透露。标签写「当铺地窖」也透露（敲击声暗示下面有地窖）。",
          "例：答案「脚夫说林掌柜以前在永昌号上当过账房」，入口只说去茶馆。口径写「有人说出林掌柜和永昌号的旧关系时登记」→ 透露：把林掌柜和永昌号连在一起，就是答案的核心。改成「有人当面说起某位熟人的旧事时登记」。",
          "例：答案「原件推翻了老韩证词的指向——帆布包和这批货无关」。口径写「读到原件、正文里明确说出这个判断时登记」→ 没透露：「这个判断」是泛指，没说判断的内容。口径写「确认帆布包和货无关时登记」→ 透露。",
          "下面这些不是信息点，出现了也不算透露：",
          "· 取得的动作和场合：「当面问」「同一次问话里」「打开抽屉」「读到原件」「走到后门」；",
          "· 登记的门槛：「看清」「明确说出」「只看到锁着的抽屉不算」「没松口不算」；",
          "· 泛指的话题：「痕迹」「单据」「说法」「证词」「判断」「情形」「来历」「内容」——只说是关于什么，不说是什么；",
          "· 东西的形式和位置：「背面那行铅笔字」「信封上的字」「抽屉最底层」——只说字在哪里、是什么样子，不说写的是什么、指向谁；",
          "  但如果位置、形态本身就是要查出来的答案，它就是信息点：答案是「账本藏在抽屉底板下的夹层里」，口径写「发现抽屉底板下的夹层时登记」→ 透露，改成「发现抽屉里隐藏的地方时登记」；答案是「门上那片暗色其实是血迹」，口径写「认出那是血迹时」→ 透露，改成「辨认出门上那片痕迹是什么时」；",
          "· 入口、场景里本来就写着的东西：场景写了「手里捏着一封没拆的信」，「信」「没拆」就不是秘密。",
          "答案本身就是「看不清」「辨不出是谁的」这种否定的结果时（比如「鞋印模糊，看不出是谁的」），口径用它作为登记门槛不算透露：它没有给出指向任何人或事的新信息。",
          "透露了的，给一个改好的版本：只去掉答案内容，其余照原样保留——",
          "· 不改取得方式：原来是当面说出的，不要改成读到原件；有两条取得途径的（「读到单据，或证人说出」），两条都要留着；",
          "· 不删登记门槛：照片上有好几处字时，「背面那行铅笔字」就是区分「拿到」和「没拿到」的门槛，不能改成「看清上面的字」这种看到什么字都算的说法。作者登记标准里写到的位置、形式，只要不是答案本身，都要留；",
          "没透露的不用改。",
          `只输出一个 ${fence}yaml 代码块：`,
          `${fence}yaml`,
          "- 编号: F_xxx",
          "  透露: 否",
          "- 编号: F_yyy",
          "  透露: 是",
          "  透露了什么: 一句话",
          "  改成标签: …   # 标签没问题就省略",
          "  改成口径: …   # 口径没问题就省略",
          fence,
          "每个编号都要输出，编号原样照抄。"
        ].join(`
`)
      },
      {
        role: "user",
        content: `【要检查的】
${block}`
      }
    ];
  }
  function parseFactLabelReview(text2, codes) {
    let list;
    try {
      list = parseYaml(extractYaml(text2));
    } catch {
      list = null;
    }
    let map = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : []) {
      if (!isPlainObject(x)) continue;
      let code = String(x.编号 || "").trim(), v = String(x.透露 ?? "").trim();
      !code || !codes.includes(code) || map.has(code) || map.set(code, {
        leak: /^(是|yes|true)$/i.test(v) ? !0 : /^(否|no|false)$/i.test(v) ? !1 : null,
        what: clueText(x.透露了什么 || ""),
        label: clueText(x.改成标签 || ""),
        criterion: clueText(x.改成口径 || "")
      });
    }
    return map;
  }
  function factLabelSig(x) {
    let s = [
      x.answer,
      x.record,
      x.entry,
      x.scene,
      ...(x.routes || []).map((r) => `${r.answer}|${r.record}|${r.entry}`),
      ...(x.usedBy || []).slice().sort()
    ].map((p) => String(p || "")).join(""), h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
    return `${s.length}:${h.toString(36)}`;
  }
  function labelsToPrepare(volumes, stored = {}) {
    let plan = prebuildPlan(volumes), ctx2 = new Map(
      factLabelContext(
        volumes,
        plan.facts.map((f) => f.code)
      ).map((x) => [x.code, x])
    );
    return plan.facts.map((f) => {
      let c = ctx2.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }, sig = factLabelSig(c), have = stored[f.code];
      return have && have.label && have.sig === sig ? null : { code: f.code, sig, ctx: c };
    }).filter(Boolean);
  }

  // src/ui/clue-run.js
  var CLUE_STATUS_BADGE = { locked: "", available: "is-accent", active: "is-ok", done: "is-dark" }, FOCUS_SOURCE = {
    manual: "你选的",
    table: "按填表",
    auto: "只有这一件可做",
    stale: "你选的场景已经不能进行",
    manualDone: "你选的场景已完成，只给入口",
    none: "还没确定",
    away: "主角眼下没在任何一段剧情里，只给入口"
  };
  function modeCard(project) {
    let mode = project.clue ? project.clue.mode : "outline";
    return `<div class="pi-card"><h3>推进方式</h3>
        <div class="pi-seg">${PLOT_MODES.map((item) => `<button type="button" class="pi-seg-btn${item.value === mode ? " is-sel" : ""}" data-act="clue-mode" data-mode="${item.value}">${esc(item.label)}</button>`).join("")}</div>
        <p class="pi-hint">${mode === "clue" ? "按主角实际查到的线索一步步开放剧情；进度跟着数据库填表更新。" : "按阶段顺序推进，每隔几楼让 AI 检查这一阶段演完没有。"}</p></div>`;
  }
  function bindingText(list) {
    return stringifyYaml(list).trim();
  }
  function bindingCard(project, st72, tables = null) {
    let c = project.clue, b = c.bindings, open = st72.bindOpen, summary = [
      b.facts.length ? "事实表" : "",
      b.knowledge.length ? "知情表" : "",
      b.switch ? "主线开关" : "",
      b.scene ? "当前场景" : "",
      b.time ? "故事时间" : ""
    ].filter(Boolean).join(" · ") || "还没有绑定", path = b.scene && b.scene.路径, hasCatalog = !!(tables && path && catalogKnown(tables, path));
    return `<div class="pi-card"><h3>表格绑定<span class="pi-meta">${esc(summary)}</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-bind-toggle">${open ? "收起" : "编辑"}</button></h3>
        ${open ? `<p class="pi-hint">告诉插件去数据库的哪张表、哪一列读线索。用「生成线索模板」建的表，点「填入示例」再「应用」就行；自己的表照着示例改表名和列名。</p>
        <textarea class="pi-ta is-mono is-tall" data-clue-bindings>${esc(bindingText(b))}</textarea>
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="clue-bind-example">填入示例</button>
        <button type="button" class="pi-btn is-primary is-sm" data-act="clue-bind-apply">应用</button></div><p class="pi-status" data-clue-bind-status></p>` : ""}
        <div class="pi-tools"><button type="button" class="pi-btn is-sm is-primary is-wide" data-act="clue-gen-template" title="在当前聊天的表格上加入三张线索表（带上大纲要用的行），并调整默认表的规则；先预览，确认后才导入">生成线索模板…</button></div>
        <div class="pi-tools is-c${hasCatalog ? 1 : 2}"><button type="button" class="pi-btn is-sm" data-act="clue-prebuild" title="大纲里加了新线索以后，把缺的行补进关键事实表、知情表；已有的行不动">按大纲补表格行…</button>
        ${hasCatalog ? "" : '<button type="button" class="pi-btn is-sm" data-act="clue-catalog" title="旧聊天的线索表没有「场景目录」列、又不想重新生成模板时用：复制一段对照文字，手动贴进表格说明">手动贴场景目录…</button>'}</div></div>`;
  }
  var BINDING_EXAMPLE = `facts:
  - {表: 关键事实表, 编号列: 编号, 状态列: 状态, 已核实值: 已核实, 说法值: 存疑, 内容列: 内容, 来源列: 依据}
knowledge:
  - {表: 知情表, 事实列: 事实, 角色列: 角色, 方式列: 获知方式, 可信度列: 可信度, 已核实值: 已核实, 来源列: 依据, 有效值: [亲见, 被告知, 听说, 推测]}
scene: {路径: 线索控制表/主线/当前场景, 离场值: 无}
time: {路径: [全局数据表/全局状态/当前时间, 线索控制表/主线/当前时间]}
`;
  function reasonList(result) {
    return result && result.reasons && result.reasons.length ? result.reasons.slice(0, 4).map((r) => `<li>${esc(r)}</li>`).join("") : "";
  }
  function nodeRow(s, focusUid, open) {
    let badge = CLUE_STATUS_BADGE[s.status], flags = [
      s.node.required ? "" : "可选",
      s.skipped ? "已跳过" : "",
      s.disabled ? "暂时停用" : "",
      s.manualOpen ? "手动开放" : "",
      s.done.manual ? "手动完成" : ""
    ].filter(Boolean).join(" · "), why = s.status === "locked" ? reasonList(s.open) : s.status !== "done" ? reasonList(s.done) : "";
    return `<div class="pi-clue-node${s.node.uid === focusUid ? " is-focus" : ""}">
        <div class="pi-clue-hd" data-act="clue-node-open" data-uid="${esc(s.node.uid)}">
            <span class="pi-badge ${badge}">${esc(NODE_STATUS_LABELS[s.status])}</span>
            <span class="pi-clue-name">${esc(s.node.name)}</span>
            ${flags ? `<span class="pi-meta">${esc(flags)}</span>` : ""}
            ${s.node.uid ? `<button type="button" class="pi-icon-btn" data-act="clue-node-menu" data-uid="${esc(s.node.uid)}" title="手动调整" aria-label="手动调整">${ICONS.more}</button>` : ""}</div>
        ${open || why ? `<ul class="pi-clue-why">${open ? reasonList(s.open) + reasonList(s.done) : why}</ul>` : ""}</div>`;
  }
  function stageBlock(unit, stage, nodes, focusUid, st72) {
    let state = stage.done ? "已结束" : stage.entered.v === "true" ? "进行中" : "未进入", left = stage.requiredLeft.length && stage.entered.v === "true" ? `还差必需节点：${stage.requiredLeft.map((n) => n.name).join("、")}` : "", endWhy = stage.entered.v === "true" && !stage.done && !stage.requiredLeft.length && stage.end.v !== "true" ? `结束条件：${stage.end.reasons.join("；")}` : "", enterWhy = stage.entered.v !== "true" ? stage.entered.reasons.join("；") : "";
    return `<div class="pi-clue-stage is-${stage.done ? "done" : stage.entered.v === "true" ? "active" : "todo"}">
        <div class="pi-tl-hd"><span class="pi-tl-name">${esc(stageLabel(unit.stage.key))}</span><span class="pi-tl-state">${esc(state)}</span></div>
        ${[left, endWhy, enterWhy].filter(Boolean).map((t) => `<p class="pi-hint">${esc(t)}</p>`).join("")}
        ${nodes.map((s) => nodeRow(s, focusUid, st72.nodeOpen === s.node.uid)).join("")}</div>`;
  }
  function mainlineCard(c) {
    let units = c.compiled.units, multi = (c.state.lineStates || []).length > 0, done = units.length > 0 && units.every((u) => (c.state.stageStates.get(u.id) || {}).done), leads = c.state.nodeStates.filter((s) => s.status === "available" && !s.disabled).length, title2 = multi ? "剧情" : "主线";
    return c.prog.paused ? `<div class="pi-card"><h3>${title2}<span class="pi-badge is-warn">已暂停</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-pause" data-value="">继续剧情</button></h3>
        <p class="pi-hint">日常游玩中：不注入线索，只保留设定；进度都保留，继续后接着推。</p></div>` : done && !multi ? `<div class="pi-card"><h3>主线<span class="pi-badge is-ok">已全部完成</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1">暂停剧情</button>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-next">开始下一段主线…</button></h3>
        <p class="pi-hint">${leads ? `还有 ${leads} 个没走过的可选节点会作为「可以去做的事」提供给正文；不想要就暂停剧情。` : "已经没有可去做的线索事项。"}想接着玩，点「开始下一段主线」写新的一卷。</p></div>` : `<div class="pi-card"><h3>${title2}<span class="pi-badge is-ok">进行中</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1" title="去玩日常：所有线索内容都不注入，进度保留">暂停剧情</button></h3></div>`;
  }
  function renderClueRun(view, project, st72) {
    let { runtime } = view, clue = runtime.clue, c = clue.compute(), d = clue.diagnose();
    if (!c) return modeCard(project);
    let problems2 = [...c.snap.problems, ...c.compiled.errors, ...c.state.cycles.map((u) => `节点 ${u} 条件循环引用`)], focus = c.state.focus, focusNode = c.state.nodeStates.find((s) => s.node.uid === focus.uid), entries = runtime.entries(), clueEntry = entries.find((e) => e.slotId === CLUE_SLOT), enabled = c.snap.enabled === !1 ? '<span class="pi-badge is-warn">主线关闭</span>' : "", paused = c.prog.paused ? '<span class="pi-badge is-warn">已暂停</span>' : "", groups = [];
    for (let unit of c.compiled.units)
      groups.push(
        stageBlock(
          unit,
          c.state.stageStates.get(unit.id),
          c.state.nodeStates.filter((s) => s.node.unit === unit),
          focus.uid,
          st72
        )
      );
    let last = clue.lastInjected();
    return `${modeCard(project)}${bindingCard(project, st72, c.snap.api ? c.snap.tables : null)}
        ${problems2.length ? `<div class="pi-card"><h3>需要处理<span class="pi-badge is-warn">${problems2.length}</span></h3>${problems2.map((p) => `<p class="pi-hint is-warn">${esc(p)}</p>`).join("")}</div>` : ""}
        ${mainlineCard(c)}${lineCard(c, project)}${(c.state.lineStates || []).length ? labelsPendingHtml(project, c) : ""}
        <div class="pi-card"><h3>本轮场景${enabled}${paused}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-refresh">重新读表</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        <p class="pi-hint">${hereText(c)}本轮场景：${focusNode ? `<b>${esc(focusNode.node.name)}</b>（${esc(FOCUS_SOURCE[focus.source])}）` : esc(FOCUS_SOURCE[focus.source])}${focusNode ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-leave" data-uid="${esc(focusNode.node.uid)}" title="主角已经离开这件事：不再注入它的场景和发现，只给入口">已离开</button>` : ""}${c.prog.focus ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-unfocus" title="回到按填表判断本轮场景">${c.prog.focus.startsWith(AWAY_PREFIX) ? "其实没离开" : "取消我选的场景"}</button>` : ""}</p>
        ${stayNotice(view, c)}
        ${unofferedHtml(c)}
        ${(c.hints || []).map((h) => `<p class="pi-hint is-warn">两表核对：${esc(h)}</p>`).join("")}
        ${c.notReady && c.notReady.size && focusNode && discoveryList(isPlainObject(focusNode.node.item) ? focusNode.node.item : {}).some((d2) => d2.fact && c.notReady.has(d2.fact)) ? `<p class="pi-hint is-warn">这一场有线索还在准备，这一轮先不给正文：${esc(
      discoveryList(focusNode.node.item).filter((d2) => d2.fact && c.notReady.has(d2.fact)).map((d2) => d2.fact).join("、")
    )}。下一次填表后会自动补；一直补不上可以用「按大纲补表格行」。</p>` : ""}
        ${!c.prog.paused && d.plot && d.plot.items.length ? `<p class="pi-hint is-warn">数据库剧情推进预设「${esc(d.plot.preset)}」里启用了召回以外的任务：${esc(d.plot.items.map((x) => `「${x.task}」（输出 ${x.tags.join("、")}）`).join("、"))}。它们会替角色安排行动，可能和线索剧情抢方向。建议在数据库里先关掉，只留召回（插件不会替你改）。</p>` : ""}
        <p class="pi-hint">这一轮要注入${clueEntry && clueEntry.content ? `约 ${estimateTokens(clueEntry.content)} token` : `的内容为空${clueEntry && clueEntry.reason ? `（${esc(clueEntry.reason)}）` : ""}`}${last ? `；上次实际注入 ${new Date(last.at).toLocaleTimeString("zh-CN", { hour12: !1 })}，${last.chars} 字` : ""}。</p>
        <p class="pi-hint">按数据库最近一次填好的表格计算${d.lastTableUpdate ? `（表格 ${new Date(d.lastTableUpdate).toLocaleTimeString("zh-CN", { hour12: !1 })} 更新）` : ""}。上一轮还没填完就发送，新线索会晚一轮生效。</p>
        </div>
        <div class="pi-card"><h3>节点<span class="pi-meta">点节点看条件，「⋯」手动调整</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="rewrite" title="按已发生的剧情和线索进度，让 AI 改写未结束的阶段；结果先进草稿，不会直接覆盖">改写后续</button></h3>
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === runtime.progress().pace ? " is-sel" : ""}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join("")}</div></div>
        ${groups.join("") || '<p class="pi-hint">大纲为空。</p>'}</div>
        ${clueLogCard(runtime)}`;
  }
  function clueLogCard(runtime) {
    let prog = runtime.progress(), ops = normalizeClueOps(prog.clue).ops.slice(-12).reverse(), chat = chatMessages();
    return ops.length ? `<div class="pi-card"><h3>手动操作记录</h3>${ops.map((op) => `<p class="pi-hint${anchorValid(op.at, chat) ? "" : " is-off"}">${new Date(op.time).toLocaleString("zh-CN", { hour12: !1 })} · ${esc(runtime.clue.opLabel(op))}${anchorValid(op.at, chat) ? "" : " · 所在楼层已回退，未生效"}</p>`).join("")}</div>` : "";
  }
  function factRowsHtml(facts, prefix, volumes) {
    let ctx2 = new Map(
      factLabelContext(
        volumes,
        facts.map((f) => f.code)
      ).map((x) => [x.code, x])
    ), row2 = (f, i) => {
      let c = ctx2.get(f.code) || {}, where = [c.stage, c.nodeName].filter(Boolean).join(" · ");
      return `<div class="pi-prebuild-row" data-fr-row="${i}">
          <div class="pi-fr-hd"><b>${esc(where || f.code)}</b><span class="pi-meta">${esc(f.code)}</span>${f.orphan || c.orphan ? '<span class="pi-badge is-warn">大纲里没有节点产出它</span>' : ""}</div>
          ${c.answer ? `<p class="pi-fr-answer">这条线索查到的是：${esc(c.answer)}<span class="pi-meta">（只给你看，不会写进表格）</span></p>` : ""}
          <label class="pi-field"><span>标签：给它起个不透露答案的名字</span><input class="pi-inp" data-${prefix}-label="${i}" value=""></label>
          <label class="pi-field"><span>正文写到哪一步，才算主角拿到了它</span><textarea class="pi-ta" rows="2" data-${prefix}-crit="${i}"></textarea></label>
          <div class="pi-fr-warn" data-fr-warn="${i}"></div></div>`;
    };
    return `<div class="pi-fr" data-fr="${prefix}">
          <div class="pi-fr-intro"><p><b>这一步在做什么</b></p>
          <p>每轮正文写完后，数据库的填表模型会对照这里的说明，判断主角有没有拿到某条线索；拿到了，后面的剧情才会开放。</p>
          <p>所以每条线索要两样东西：一个<b>标签</b>，让填表模型认出是哪一条；一句<b>「写到哪一步才算拿到」</b>。这句写得太宽，主角还没真正查到就会被算作拿到，剧情会提前推进。</p>
          <p>这两样每一轮都会发给填表模型，所以<b>不能写出答案</b>：写「打开抽屉、读到单据时」，不写单据上写了什么。</p>
          <p class="is-example">例　标签：抽屉里的单据　｜　写到哪一步：主角打开抽屉、读到单据内容时算拿到；只看到锁着的抽屉不算</p></div>
          <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-fr-auto>自动填写</button></div>
          <p class="pi-hint" data-fr-status>建议先点「自动填写」，由 AI 按大纲写好，你只需要检查标黄的地方。也可以自己填。</p>
          ${facts.map(row2).join("")}</div>`;
  }
  function mountFactRows(view, root, facts, prefix, volumes) {
    let box = root.querySelector(`[data-fr="${prefix}"]`);
    if (!box) return;
    let project = view.project(), ids = project && Array.isArray(project.imports) ? project.imports : [], secrets = [], secretsNote = "", ctx2 = new Map(
      factLabelContext(
        volumes,
        facts.map((f) => f.code)
      ).map((x) => [x.code, x])
    ), unsure = /* @__PURE__ */ new Map(), field2 = (i, k) => box.querySelector(`[data-${prefix}-${k}="${i}"]`), status = box.querySelector("[data-fr-status]"), secretsReady = Promise.all(
      ids.map(
        (id) => view.data.imports.get(id) ? Promise.resolve(view.data.imports.get(id)) : view.data.imports.load(id).catch(() => null)
      )
    ).then((jobs) => {
      let missing = jobs.filter((j) => !j).length;
      secrets = [...new Set(jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []))], secretsNote = missing ? `有 ${missing} 份导入记录读不到，这次没有核对其中的保密名字。` : "", secretsNote && (status.textContent = `${status.textContent} ${secretsNote}`), facts.forEach((_, i) => (field2(i, "label").value.trim() || field2(i, "crit").value.trim()) && check(i));
    }), reviewed = /* @__PURE__ */ new Map(), check = (i) => {
      let f = facts[i], value = { label: field2(i, "label").value.trim(), criterion: field2(i, "crit").value.trim() }, r = factLabelCheck({ ...value, unsure: unsure.get(f.code) || "" }, ctx2.get(f.code) || {}, { secrets }), out = box.querySelector(`[data-fr-warn="${i}"]`), rv = reviewed.get(f.code), same = rv && rv.label === value.label && rv.criterion === value.criterion, warns = [...r.warns], notes = [...r.notes];
      if (same && rv.leak) warns.push(`会透露答案：${rv.what || "标签或口径里写出了查到的内容"}`);
      else if (!same) for (let s of r.suspects) warns.push(`${s.where}里有答案的片段「${s.piece}」`);
      return same && rv.fixed && notes.push(`已自动改写，原来的写法会透露答案（${rv.what || "写出了查到的内容"}）`), out.innerHTML = [
        ...warns.map((x) => `<p class="pi-warn-line">${esc(x)}</p>`),
        ...notes.map((x) => `<p class="pi-note-line">${esc(x)}</p>`)
      ].join(""), box.querySelector(`[data-fr-row="${i}"]`).classList.toggle("is-warn", warns.length > 0), warns.length;
    };
    box.addEventListener("input", (event) => {
      let m = event.target.closest("[data-fr-row]");
      m && (unsure.delete(facts[Number(m.dataset.frRow)].code), check(Number(m.dataset.frRow)));
    });
    async function reviewRows(rows2) {
      let todo = rows2.filter(({ i }) => field2(i, "label").value.trim() || field2(i, "crit").value.trim());
      if (!todo.length) return 0;
      let items = todo.map(({ f, i }) => {
        let c = ctx2.get(f.code) || {}, label = field2(i, "label").value.trim(), criterion = field2(i, "crit").value.trim();
        return {
          code: f.code,
          label,
          criterion,
          answer: [c.answer, ...(c.routes || []).map((r) => r.answer)].filter(Boolean).join("；或者："),
          entry: c.entry,
          scene: c.scene,
          record: [c.record, ...(c.routes || []).map((r) => r.record)].filter(Boolean).join("；或者："),
          pieces: factLabelCheck({ label, criterion }, c, { secrets }).suspects.map((s) => s.piece)
        };
      }), map = parseFactLabelReview(
        await ask(view, "outline", factLabelReviewMessages(items)),
        items.map((x) => x.code)
      ), fixed = 0;
      for (let [k, { f, i }] of todo.entries()) {
        let v = map.get(f.code), sent = items[k];
        !v || v.leak === null || field2(i, "label").value.trim() !== sent.label || field2(i, "crit").value.trim() !== sent.criterion || (v.leak && (v.label || v.criterion) ? (v.label && (field2(i, "label").value = v.label), v.criterion && (field2(i, "crit").value = v.criterion), fixed++, reviewed.set(f.code, {
          label: field2(i, "label").value.trim(),
          criterion: field2(i, "crit").value.trim(),
          leak: !1,
          fixed: !0,
          what: v.what
        })) : reviewed.set(f.code, { label: sent.label, criterion: sent.criterion, leak: v.leak, what: v.what }));
      }
      return fixed;
    }
    box.querySelector("[data-fr-auto]").addEventListener("click", async (event) => {
      let btn = event.currentTarget, todo = facts.map((f, i) => ({ f, i })).filter(({ i }) => !field2(i, "label").value.trim() || !field2(i, "crit").value.trim());
      if (!todo.length) return status.textContent = "都已经填好了。要重新生成，先清空对应的框。";
      btn.disabled = !0, status.innerHTML = '<span class="pi-spin"></span> 正在生成…';
      try {
        await secretsReady;
        let items = todo.map(({ f }) => ctx2.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }), reply2 = await ask(view, "outline", factLabelMessages(items, { secrets })), r = parseFactLabels(
          reply2,
          items.map((x) => x.code)
        );
        for (let { f, i } of todo) {
          let got = r.items.get(f.code);
          got && (field2(i, "label").value.trim() || (field2(i, "label").value = got.label), field2(i, "crit").value.trim() || (field2(i, "crit").value = got.criterion), got.unsure && unsure.set(f.code, got.unsure));
        }
        status.innerHTML = '<span class="pi-spin"></span> 正在检查有没有透露答案…';
        let fixed = 0, reviewFailed = "";
        try {
          fixed = await reviewRows(todo);
        } catch (error) {
          reviewFailed = `检查没完成（${error.message}），下面按字面比对标出了可能透露答案的地方。`;
        }
        let warned = facts.reduce((n, _, i) => n + (check(i) ? 1 : 0), 0);
        status.textContent = `${secretsNote}${reviewFailed}已填好 ${todo.length - r.missing.length} 条${r.missing.length ? `，${r.missing.length} 条没生成（${r.missing.join("、")}），可以再点一次或自己填` : ""}。${fixed ? `${fixed} 条原来的写法会透露答案，已经自动改好。` : ""}${warned ? `${warned} 条标黄：黄字说明了原因，照着改一下框里的字就行，改完黄色会消失。觉得没问题也可以不改，标黄不会挡住导入。` : "没有发现问题，可以直接确认。"}`;
      } catch (error) {
        status.textContent = `生成失败：${error.message}。可以再试一次，或者自己填。`;
      } finally {
        btn.disabled = !1;
      }
    });
  }
  function prebuildScope(view) {
    let c = ctx(), chatId = c && typeof c.getCurrentChatId == "function" ? String(c.getCurrentChatId() ?? "") : "";
    return {
      chatId,
      chatLabel: chatId,
      projectId: view.projectId,
      active: view.runtime.activeId(),
      mode: isClueMode(view.project()) ? "clue" : "outline"
    };
  }
  function prebuildTargetPrint(tables, bindings) {
    let out = {};
    for (let [b, keyCol, extraCol] of [
      [(bindings.facts || [])[0], "编号列", "标签"],
      [(bindings.knowledge || [])[0], "", "键"]
    ]) {
      if (!b) continue;
      let found = findSheet(tables || {}, b.表);
      if (found.error) {
        out[b.表] = null;
        continue;
      }
      let { head, rows: rows2, col } = sheetRows(found.sheet), ki = col(keyCol ? b[keyCol] : extraCol), xi = col(extraCol);
      out[b.表] = {
        key: String(found.sheet.key || ""),
        head: head.slice(1).map((x) => cellText(x)).join(","),
        rows: new Map(rows2.map((r) => [cellText(r[ki]), cellText(r[xi])]))
      };
    }
    return out;
  }
  function prebuildTargetSame(before, after) {
    for (let [name, a] of Object.entries(before)) {
      let b = after[name];
      if (!a || !b) {
        if (a !== b) return !1;
        continue;
      }
      if (a.key !== b.key || a.head !== b.head) return !1;
      for (let [code, label] of a.rows) if (!b.rows.has(code) || b.rows.get(code) !== label) return !1;
    }
    return !0;
  }
  function prebuildScopeValid(view, s) {
    let now = prebuildScope(view);
    return now.chatId === s.chatId && now.projectId === s.projectId && now.active === s.active && now.mode === s.mode;
  }
  function prebuildColumnProblems(tables, bindings, diff) {
    let out = [], head = (name) => {
      let f = findSheet(tables, name);
      return f.sheet ? sheetRows(f.sheet).head.map((h) => String(h ?? "").trim()) : null;
    }, fb = (bindings.facts || [])[0], kb = (bindings.knowledge || [])[0];
    if (fb && diff.newFacts.length) {
      let h = head(fb.表);
      h ? ["标签", "登记口径", fb.编号列, fb.状态列].filter(Boolean).forEach((c2) => h.includes(c2) || out.push(`「${fb.表}」缺少列「${c2}」`)) : out.push(`没有表「${fb.表}」`);
    }
    if (kb && diff.newKnows.length) {
      let h = head(kb.表);
      h ? ["键", kb.事实列, kb.角色列, kb.方式列, kb.可信度列].filter(Boolean).forEach((c2) => h.includes(c2) || out.push(`「${kb.表}」缺少列「${c2}」`)) : out.push(`没有表「${kb.表}」`);
    }
    return out;
  }
  var clueActions = {
    async "clue-mode"(view, target) {
      let mode = target.dataset.mode, project = view.project();
      !project || project.clue && project.clue.mode === mode || mode === "clue" && !await confirmDialog({
        title: "切换到线索推进",
        body: "线索推进按主角实际查到了什么来推进：数据库填表时记下拿到的线索，插件据此开放下一步。不再用 AI 判断「这一阶段演完了没有」，也不再一次把整个阶段交给正文。",
        list: [
          "大纲推进的进度会保留，切回来就恢复。",
          "大纲要写「发现」和「完成条件」，节点才会自动完成；没写的只能在执行页手动标记。",
          "切换后，点下面「表格绑定」里的「生成线索模板」，给这个聊天加上记录线索的表格。"
        ],
        okLabel: "切换"
      }) || (view.runtime.bumpEpoch(), view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, mode }) })), view.runtime.clue.hideLineBar(), view.runtime.clue.invalidate(), mode === "clue" && view.runtime.clue.scheduleSync(), view.runtime.refresh(), view.renderBody());
    },
    "clue-bind-toggle"(view) {
      let st72 = view.tabState("run");
      st72.bindOpen = !st72.bindOpen, view.renderBody();
    },
    "clue-bind-example"(view, target) {
      let box = target.closest(".pi-card").querySelector("[data-clue-bindings]");
      box && (box.value = BINDING_EXAMPLE);
    },
    "clue-bind-apply"(view, target) {
      let card = target.closest(".pi-card"), status = card.querySelector("[data-clue-bind-status]");
      try {
        let value = parseYaml(card.querySelector("[data-clue-bindings]").value) || {};
        if (!isPlainObject(value)) throw new Error("应是 switch / facts / knowledge / scene / time 的映射");
        view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, bindings: value }) })), view.runtime.clue.invalidate(), view.tabState("run").bindOpen = !1, view.renderBody();
      } catch (error) {
        status.textContent = error.message, status.classList.add("is-err");
      }
    },
    // 重新读表：也安排一次同步（写场景目录、补缺的行），作为「还在准备」的手动重试（GPT 实测前审阅 R5）。
    "clue-refresh"(view) {
      view.runtime.clue.invalidate(), view.runtime.clue.scheduleSync(), view.renderBody();
    },
    "clue-node-open"(view, target, event) {
      if (event.target.closest("button")) return;
      let st72 = view.tabState("run");
      st72.nodeOpen = st72.nodeOpen === target.dataset.uid ? "" : target.dataset.uid, view.renderBody();
    },
    async "clue-line"(view, target) {
      let v = target.dataset.value, s0 = view.runtime.clue.opScope();
      if (v === "abandon" || v === "done") {
        let ls = view.runtime.clue.compute()?.state.lineStates.find((s2) => s2.line.id === target.dataset.id), name = ls ? ls.line.name : target.dataset.id;
        if (!await confirmDialog({
          title: v === "abandon" ? `放弃「${name}」？` : `把「${name}」标记完成？`,
          body: v === "abandon" ? "这条线不再注入、不再提示。想回来，点这条线上的「还原」。" : "不再等表格判断，直接算这条线完成。想回来，点这条线上的「还原」。",
          okLabel: v === "abandon" ? "放弃" : "标记完成",
          danger: v === "abandon"
        }))
          return;
      }
      let uid = "", c = target.dataset.value === "enter" ? view.runtime.clue.compute() : null, s = c && c.state.lineStates.find((x) => x.line.id === target.dataset.id);
      if (s && s.entries.length > 1) {
        let name = (u) => {
          let n = c.state.nodeStates.find((x) => x.node.uid === u);
          return n ? `${n.node.name}${clueText(isPlainObject(n.node.item) ? n.node.item.入口 : "") ? `：${clueText(n.node.item.入口)}` : ""}` : u;
        };
        if (uid = await menuDialog({ title: "走进的是哪一件事", items: s.entries.map((u) => ({ value: u, label: name(u) })) }), !uid)
          return;
      }
      view.runtime.clue.lineAct(target.dataset.id, target.dataset.value, uid, s0), view.renderBody();
    },
    "clue-pause"(view, target) {
      let on = !!target.dataset.value;
      view.runtime.clue.setPaused(on), toast("success", on ? "剧情已暂停：之后的回复不再注入线索内容。" : "剧情已继续。"), view.renderBody();
    },
    async "clue-line-manual"(view, target) {
      let id = target.dataset.id, name = (view.runtime.clue.compute()?.state.lineStates.find((s) => s.line.id === id) || { line: { name: id } }).line.name;
      await confirmDialog({
        title: `「${name}」改成手动开始`,
        body: "不再自动判断开启条件，原来的要求留着给你看。之后想玩这条线时，在这里点「进入」。改的是大纲，所有聊天都一样。",
        okLabel: "改成手动开始"
      }) && (view.runtime.clue.lineToManual(id) ? toast("success", `「${name}」已改成手动开始。`) : toast("info", "这条线已经是人工开启了。"), view.renderBody());
    },
    "clue-tiers"(view, target) {
      let tiers = JSON.parse(target.dataset.tiers || "[]");
      view.runtime.clue.confirmTiers(tiers) ? toast("success", `档位顺序已确认：${tiers.join(" < ")}`) : toast("info", "没有要确认的条件。"), view.renderBody();
    },
    async "clue-labels"(view) {
      await prepareLabels(view);
    },
    "clue-pause-side"(view, target) {
      let on = !!target.dataset.value;
      view.runtime.clue.setPaused(on, "side"), toast("success", on ? "支线已全部暂停：主线照常。" : "支线已继续。"), view.renderBody();
    },
    "clue-line-move"(view, target) {
      view.runtime.clue.moveLine(target.dataset.id, Number(target.dataset.dir)), view.renderBody();
    },
    // 开始下一段主线：去大纲页写新一卷；写好后回到这里补预建行、更新场景编号对照。
    async "clue-next"(view) {
      await confirmDialog({
        title: "开始下一段主线",
        body: "下一段主线写成新的一卷，放在现有大纲后面。当前一卷全部结束后，新卷第一阶段会自动开始。",
        list: [
          "1. 到大纲页用「AI 写第 N 卷」或自己写新一卷（会附上已用过的编号，避免撞号）",
          "2. 回到执行页，在「表格绑定」里点「按大纲补表格行…」，给新事实建行",
          "3. 旧聊天先点一次「生成线索模板」，让新一卷的场景能被认出来",
          "写新卷期间想先玩日常，可以先暂停剧情"
        ],
        okLabel: "去写新一卷"
      }) && view.switchTab && view.switchTab("outline");
    },
    "clue-unfocus"(view) {
      view.runtime.clue.setFocus(""), view.renderBody();
    },
    // 按大纲补表格行：预览 → 作者逐条确认标签和登记口径 → 通过官方 insertRow 只插入缺的行（已有行不动，不覆盖已演进度）。
    // W1：点击时记下聊天 / 项目 / 模式，确认后按当前表重新算缺哪些行，每插入一行前核对一次，变了就停下并说明已写入哪些。
    // 登记口径不直接拿「记录」预填（GPT §14.2-3，记录常含答案）：作者自己写，或点「自动填写」由模型参考记录写出不含答案的版本，插件再检查。
    async "clue-prebuild"(view) {
      let c = view.runtime.clue.compute(), project = view.project(), api = acuApi();
      if (!c || !c.snap.api || !api || typeof api.insertRow != "function")
        return toast("warning", "没有检测到数据库插件，无法补表格行。");
      let scope = prebuildScope(view), plan = prebuildPlan(project.outline.volumes), diff = prebuildDiff(plan, c.snap, project.clue.bindings), targetPrint = prebuildTargetPrint(c.snap.tables, project.clue.bindings);
      if (!diff.factTable) return toast("warning", "还没有绑定事实表。");
      let colErr = prebuildColumnProblems(c.snap.tables, project.clue.bindings, diff);
      if (colErr.length) return toast("error", `表格结构和配套模板不一致，没有写入：${colErr.join("；")}`);
      if (!diff.newFacts.length && !diff.newKnows.length)
        return toast(
          "info",
          `表格行已经齐全（已有 ${diff.kept.length} 个事实）。${diff.stale.length ? `表里有大纲已不再使用的编号：${diff.stale.join("、")}，不会自动删除。` : ""}`
        );
      let html = `<div class="pi-fr-intro"><p>大纲里新增了线索，但<b>当前聊天</b>的线索表里还没有它们。这一步把缺的补上，已有的行一律不动，不影响已经玩到的进度。</p></div>
          ${diff.stale.length ? `<p class="pi-hint is-warn">表里有大纲已不再使用的编号：${esc(diff.stale.join("、"))}（不会删除）</p>` : ""}
          <details class="pi-fr-more"><summary class="pi-hint">写入细节</summary>
          <p class="pi-hint">目标聊天：${esc(scope.chatLabel || "当前聊天")}</p>
          ${diff.newKnows.length && diff.knowTable ? `<p class="pi-hint">「${esc(diff.knowTable)}」新增 ${diff.newKnows.length} 行：${esc(diff.newKnows.map((k) => k.key).join("、"))}</p>` : ""}
          ${diff.kept.length ? `<p class="pi-hint">已有、不改动：${esc(diff.kept.join("、"))}</p>` : ""}
          <p class="pi-hint">确认时会再核对一次，表格在这期间变了就不写入。补完以后如果对线索表重新「手动填表」，补的行可能被清掉，请检查一次。</p></details>
          ${diff.newFacts.length ? `<h4 class="pi-fr-title">要补的线索：${diff.newFacts.length} 条</h4>${factRowsHtml(diff.newFacts, "pb", project.outline.volumes)}` : ""}`, picked = await openDialog({
        title: "按大纲补表格行",
        html,
        onMount: (root) => mountFactRows(view, root, diff.newFacts, "pb", project.outline.volumes),
        actions: [
          { label: "取消", value: null },
          {
            label: "写入",
            primary: !0,
            value: (root) => diff.newFacts.map((f, i) => ({
              ...f,
              label: root.querySelector(`[data-pb-label="${i}"]`).value.trim(),
              criterion: root.querySelector(`[data-pb-crit="${i}"]`).value.trim()
            }))
          }
        ]
      });
      if (!picked) return;
      let empty = picked.filter((f) => !f.label);
      if (empty.length) return toast("warning", `请给这些事实填上中性标签：${empty.map((f) => f.code).join("、")}`);
      if (keepLabels(view, picked), !prebuildScopeValid(view, scope))
        return toast("warning", "确认期间切换了聊天、项目或推进方式，没有写入。请回到原聊天重新操作。");
      let now = view.runtime.clue.compute(), fresh = prebuildDiff(plan, now.snap, project.clue.bindings), labels = new Map(picked.map((f) => [f.code, f])), previewKnows = new Set(diff.newKnows.map((k) => k.key)), vanished = diff.kept.filter((code) => !(now.snap.facts && now.snap.facts.has(code)));
      if (vanished.length)
        return toast("warning", `确认期间表格变了（预览时已有的 ${vanished.join("、")} 现在不见了），没有写入。请重新点一次。`);
      if (!prebuildTargetSame(targetPrint, prebuildTargetPrint(now.snap.tables, project.clue.bindings)))
        return toast("warning", "确认期间表格变了（可能刚填过表），没有写入。请重新打开「按大纲补表格行」，按现在的表格再确认一次。");
      let want = fresh.newFacts.map((f) => f.code).filter((code) => labels.has(code)), knowsToWrite = fresh.newKnows.filter((k) => previewKnows.has(k.key)), fb = project.clue.bindings.facts[0], kb = project.clue.bindings.knowledge[0], done = [], failed = [], factOk = new Set(now.snap.facts ? now.snap.facts.keys() : []), stopped = "";
      for (let code of want) {
        if (!prebuildScopeValid(view, scope)) {
          stopped = "写入过程中切换了聊天";
          break;
        }
        let f = labels.get(code), data = { [fb.编号列]: code, 标签: f.label, 登记口径: f.criterion };
        fb.状态列 && (data[fb.状态列] = "未获得"), await api.insertRow({ tableName: fb.表, data, skipNotify: !0 }).catch(() => -1) >= 0 ? (done.push(code), factOk.add(code)) : failed.push(code);
      }
      if (kb && !stopped)
        for (let k of knowsToWrite) {
          if (!factOk.has(k.fact)) continue;
          if (!prebuildScopeValid(view, scope)) {
            stopped = "写入过程中切换了聊天";
            break;
          }
          let data = { 键: k.key, [kb.事实列]: k.fact, [kb.角色列]: k.actor };
          kb.方式列 && (data[kb.方式列] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || "未知"), kb.可信度列 && (data[kb.可信度列] = "未核实"), await api.insertRow({ tableName: kb.表, data, skipNotify: !0 }).catch(() => -1) >= 0 ? done.push(k.key) : failed.push(k.key);
        }
      view.runtime.clue.invalidate(), view.renderBody();
      let msg = `已写入 ${done.length} 行${done.length ? `（${done.slice(0, 8).join("、")}${done.length > 8 ? "……" : ""}）` : ""}`;
      stopped ? toast("warning", `${msg}。${stopped}，后面的行没有写；回到原聊天再点一次，会只补剩下的。`) : failed.length ? toast(
        "error",
        `${msg}；${failed.length} 行失败：${failed.slice(0, 6).join("、")}。当前聊天至少要有一楼 AI 回复，数据库才能保存表格；失败事实的知情行也没有写。`
      ) : toast("success", `${msg}。`);
    },
    // 场景编号对照：只有编号、入口、地点（和正文看到的入口同级）；作者粘贴进线索控制表的说明（官方填表只展开目标表，放在控制表自己的说明里才看得到）。
    // 生成线索模板（GPT §17.2）：读当前聊天的真实模板 → 和运行表交叉核对 → 合成 → 预览 → 明确用 seed 导入当前聊天
    // → 重新读表核对 → 成功才写绑定。已有线索表时不在模板里追加行（官方 seed 不会落进非空表），新事实用「按大纲补表格行」。
    async "clue-gen-template"(view) {
      let api = acuApi(), project = view.project(), c = view.runtime.clue.compute();
      if (!api || typeof api.getTableTemplate != "function" || typeof api.importTemplateFromData != "function")
        return toast("warning", "没有检测到数据库的模板接口（需要官方 SP·数据库 8.9 以上），无法生成。");
      if (!cardKey()) return toast("warning", "请先打开要使用的聊天。");
      let scope = prebuildScope(view), base = null;
      try {
        base = api.getTableTemplate({ scope: "chat" });
      } catch {
      }
      if (!isPlainObject(base) || !Object.keys(base).some((k) => k.startsWith("sheet_")))
        return toast("warning", "读不到当前聊天的表格模板，没有生成。请先在数据库里确认这个聊天有表格。");
      let live = c && c.snap.tables || {}, tplNames = Object.values(base).filter((x) => x && x.name).map((x) => x.name), mismatch = clueTplMismatch(base, live);
      if (mismatch.length)
        return openDialog({
          title: "没有生成线索模板",
          html: `<p class="pi-hint">读到的模板和当前聊天正在用的表格对不上。直接导入可能新增或隐藏表格，所以没有生成：</p><ul>${mismatch.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="pi-hint">可以先在数据库里把这个聊天的模板和表格对齐（比如重新读表、确认用的是这个聊天的模板），再来生成。</p>`,
          actions: [{ label: "关闭", value: !0, primary: !0 }]
        });
      let plan = prebuildPlan(project.outline.volumes), hasFacts = tplNames.includes("关键事实表"), preview = synthesizeClueTemplate(base, { clue: { scenes: plan.scenes } });
      if (preview.blocked.length)
        return toast(
          "warning",
          `模板里有不止一张「${preview.blocked.join("」「")}」，无法确定该用哪一张。没有生成；请先在数据库里删掉或改名多余的表。`
        );
      let html = `<div class="pi-fr-intro"><p>给<b>当前这个聊天</b>的数据库加上线索推进要用的三张表，用来记录主角查到了什么、谁知道了什么、现在在哪个场景。</p>
          <p>原有的表和数据都会保留，不会删除任何东西，也不影响别的聊天。</p></div>
          ${preview.problems.length ? `<p class="pi-hint is-warn"><b>需要你注意：</b></p><ul>${preview.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          <details class="pi-fr-more"><summary class="pi-hint">具体会改哪些地方（${preview.changes.length} 处）</summary><p class="pi-hint">目标聊天：${esc(scope.chatLabel || "当前聊天")}</p><ul>${preview.changes.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>没有需要改动的地方</li>"}</ul></details>
          ${hasFacts ? '<p class="pi-hint">这个聊天已经有关键事实表，不在模板里追加行。新线索请在导入后用「按大纲补表格行」。</p>' : plan.facts.length ? `<h4 class="pi-fr-title">这份大纲里有 ${plan.facts.length} 条要追踪的线索</h4>${factRowsHtml(plan.facts, "gt", project.outline.volumes)}` : '<p class="pi-hint">大纲里还没有线索编号，线索表先建成空表。</p>'}`, picked = await openDialog({
        title: "生成线索模板",
        html,
        onMount: (root) => hasFacts || mountFactRows(view, root, plan.facts, "gt", project.outline.volumes),
        actions: [
          { label: "取消", value: null },
          {
            label: "导入到当前聊天",
            primary: !0,
            value: (root) => plan.facts.map((f, i) => {
              let l = root.querySelector(`[data-gt-label="${i}"]`), k = root.querySelector(`[data-gt-crit="${i}"]`);
              return { code: f.code, label: l ? l.value.trim() : "", criterion: k ? k.value.trim() : "" };
            })
          }
        ]
      });
      if (!picked) return;
      if (!hasFacts) {
        let empty = picked.filter((f) => !f.label);
        if (empty.length) return toast("warning", `请给这些事实填上中性标签：${empty.map((f) => f.code).join("、")}`);
      }
      if (!prebuildScopeValid(view, scope))
        return toast("warning", "确认期间切换了聊天、项目或推进方式，没有导入。请回到原聊天重新操作。");
      let again = null;
      try {
        again = api.getTableTemplate({ scope: "chat" });
      } catch {
      }
      if (JSON.stringify(again) !== JSON.stringify(base))
        return toast("warning", "确认期间这个聊天的表格模板变了，没有导入。请重新点「生成线索模板」。");
      view.runtime.clue.invalidate();
      let liveNow = view.runtime.clue.compute(), again2 = clueTplMismatch(base, liveNow && liveNow.snap.tables || {});
      if (again2.length) return toast("warning", `确认期间当前聊天的表格变了，没有导入：${again2[0]}。请重新点「生成线索模板」。`);
      let catalogNow = liveNow ? sceneCatalogCell(liveNow.state, liveNow.plan || { recognize: [] }, liveNow.prog) : "", gen = synthesizeClueTemplate(base, {
        clue: hasFacts ? { scenes: plan.scenes } : { controlRow: ["主线", "", catalogNow], factRows: picked, knowRows: plan.knows, scenes: plan.scenes }
      }), res = null;
      try {
        res = await api.importTemplateFromData(gen.template, { scope: "chat", dataMode: "seed" });
      } catch (error) {
        res = { success: !1, message: error && error.message || String(error) };
      }
      if (!res || !res.success)
        return toast("error", `导入失败，表格和绑定都没有改动：${res && (res.message || res.error) || "数据库没有返回结果"}`);
      if (!prebuildScopeValid(view, scope))
        return toast(
          "warning",
          "模板已经导入，但导入期间切换了聊天，没有写插件绑定。请回到原聊天，在「表格绑定」里点「填入示例 → 应用」。"
        );
      view.data.updateProject(view.projectId, (p) => ({
        ...p,
        clue: normalizeClue({ ...p.clue, bindings: { ...p.clue.bindings, ...gen.binding, switch: null } })
      })), hasFacts || keepLabels(view, picked), view.runtime.clue.invalidate();
      let after = view.runtime.clue.compute(), names2 = new Set(
        Object.values(after && after.snap.tables || {}).filter((x) => x && x.name).map((x) => x.name)
      ), lost = ["线索控制表", "关键事实表", "知情表"].filter((n) => !names2.has(n)), afterTables = after && after.snap.tables || {}, gone = res.runtimeReady === !1 ? [] : Object.values(liveNow && liveNow.snap.tables || {}).filter((s) => s && s.name).flatMap((s) => {
        let now = Object.values(afterTables).find((x) => x && x.name === s.name);
        if (!now) return [`表「${s.name}」`];
        let have = clueTplHeader(now);
        return clueTplHeader(s).filter((h) => h && !have.includes(h)).map((h) => `「${s.name}」的列「${h}」`);
      });
      if (view.renderBody(), gone.length)
        return toast(
          "error",
          `模板已经导入，但原来的这些表格内容现在读不到了：${gone.slice(0, 6).join("、")}。请到数据库的模板 / 数据管理里检查（可能被隐藏了），不要重复导入。`
        );
      res.runtimeReady === !1 ? toast("warning", "模板已经保存，但数据库提示表格还没就绪。请先点「重新读表」，不要重复导入。") : lost.length ? toast(
        "warning",
        `模板已经导入，但现在读表还看不到：${lost.join("、")}。请点「重新读表」，或等一楼自动填表后再看；不要重复导入。`
      ) : toast(
        "success",
        `已导入。${gen.changes.length} 处改动${gen.problems.length ? `，${gen.problems.length} 处需要注意（见预览）` : ""}。插件绑定已更新。`
      );
    },
    async "clue-catalog"(view) {
      let plan = prebuildPlan(view.project().outline.volumes), text2 = plan.scenes.length ? [
        "【场景编号对照】（只用于对号；不表示已经开放或已经发生）",
        ...plan.scenes.map((s) => `- ${s.uid}：${[s.entry, s.place && `地点：${s.place}`].filter(Boolean).join("；")}`)
      ].join(`
`) : "";
      if (!text2) return toast("info", "大纲里没有带入口的节点。");
      await openDialog({
        title: "场景编号对照",
        html: `<p class="pi-hint">复制下面的文字，粘贴到数据库「线索控制表」说明（note）的末尾。只包含入口和地点，不含发现。长主线建议只放当前几个阶段的节点。</p><textarea class="pi-ta is-mono is-tall" readonly>${esc(text2)}</textarea>`,
        actions: [{ label: "关闭", value: !0, primary: !0 }]
      });
    },
    "clue-fact-keep"(view, target) {
      view.runtime.clue.act({ kind: "fact", target: target.dataset.id, value: "confirmed", note: "玩家保留" }), view.renderBody();
    },
    // 手机上没有悬停说明：第一次作废先确认一句（之后同一次打开不再问）。
    // 票据在点按钮时就取：确认框开着时切了聊天、项目或模式，确认后什么都不做（GPT 实测返修审阅 R1）。
    async "clue-fact-void"(view, target) {
      let s0 = view.runtime.clue.opScope(), id = target.dataset.id;
      if (!voidAsked && !await confirmDialog({
        title: "当作没发生？",
        body: "插件按没拿到算，相关表格改回未获得；之后可以重新查。已经写出的正文不会删除。",
        okLabel: "作废"
      }))
        return;
      voidAsked = !0;
      let r = await view.runtime.clue.voidFact(id, s0);
      view.renderBody(), !r || !r.done ? toast("info", r && r.why || "这次作废没有执行") : r.table === "ok" ? toast("success", "已作废，表格也改回了未获得。") : toast(
        "warning",
        `已作废，插件按没拿到算；但${r.table === "partial" ? "表格只改了一部分" : "表格没改"}：${r.why || "原因不明"}`
      );
    },
    "clue-fact-restore"(view, target) {
      let eff = view.runtime.clue.restoreFact(target.dataset.id);
      view.renderBody(), toast(
        "info",
        eff && eff.confirmed ? "已解除作废：表格里记的是已获得，按已获得算。" : "已解除作废：表格里现在没记它，按没拿到算。作废时清掉的记录不会改回去。"
      );
    },
    "clue-leave"(view, target) {
      view.runtime.clue.leaveScene(target.dataset.uid), toast("info", "已记下主角离开了这件事：不再注入它的场景，只给入口。"), view.renderBody();
    },
    async "clue-node-menu"(view, target) {
      let clue = view.runtime.clue, c = clue.compute(), uid = target.dataset.uid, s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
      if (!s) return;
      let over = c.prog.overrides[uid] || {}, items = [
        ...s.status === "available" && c.state.focus.uid !== uid ? [{ label: "设为本轮场景", value: "focus" }] : [],
        ...c.state.focus.uid === uid ? [{ label: "主角已离开（只给入口）", value: "leave" }] : [],
        ...s.status === "locked" && !s.manualOpen ? [{ label: "手动开放（不算拿到线索）", value: "open:force" }] : [],
        ...over.open ? [{ label: over.open === "force" ? "取消手动开放" : "取消停用", value: "open:" }] : [{ label: "暂时停用这个节点", value: "open:block" }],
        ...s.status !== "done" ? [{ label: "手动标记完成", value: "done:force" }] : over.done !== "force" ? [{ label: "算作没完成（不管表格）", value: "done:undo" }] : [],
        ...over.done ? [{ label: "完成与否改回按表格判断", value: "done:" }] : [],
        ...s.node.required ? [{ label: over.skip ? "取消跳过" : "跳过（不挡这一阶段，也不算完成）", value: over.skip ? "skip:" : "skip:true" }] : [],
        { label: "手动确认或作废一条线索…", value: "fact" }
      ], pick = await menuDialog({ title: s.node.name, items });
      if (!pick) return;
      if (pick === "focus") return clue.setFocus(uid), view.renderBody();
      if (pick === "leave") return clue.leaveScene(uid), view.renderBody();
      if (pick === "fact") return factDialog(view, s);
      let [kind, value] = pick.split(":"), note = kind === "open" && value === "force" || kind === "done" && value === "force" ? await promptDialog({ title: "记录原因（可空）", label: "为什么手动处理" }) : "";
      note !== null && (clue.act({ kind, target: uid, value: value === "true" ? !0 : value, note }), view.renderBody());
    }
  };
  async function factDialog(view, s) {
    let refs = nodeFactRefs(s.node), id = await promptDialog({
      title: "线索编号",
      label: refs.length ? `这个节点用到的线索：${refs.join("、")}` : "填线索编号（大纲「发现」里的「事实」）",
      value: refs[0] || ""
    });
    if (!id || !id.trim()) return;
    let pick = await menuDialog({
      title: `线索 ${id.trim()}`,
      items: [
        { label: "手动确认拿到了（表格没记上时用）", value: "confirmed" },
        { label: "当作没拿到（只改插件判断，不改表格）", value: "revoked" },
        { label: "改回按表格判断", value: "" }
      ]
    });
    if (pick === null) return;
    let note = await promptDialog({ title: "记录原因", label: "依据 / 来源（建议填写）" });
    note !== null && (view.runtime.clue.act({ kind: "fact", target: id.trim(), value: pick, note }), view.renderBody());
  }
  function clueOnChange(view, target) {
    return target.dataset.clueSidelimit !== void 0 ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, sideLimit: Number(target.value) }) })), view.runtime.clue.invalidate("line-limit"), view.runtime.clue.scheduleSync(), view.renderBody(), !0) : target.dataset.clueLinetoast !== void 0 ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, lineToast: target.checked }) })), view.renderBody(), !0) : !1;
  }
  var LINE_BADGE = { 未触发: "", 可开启: "is-warn", 进行中: "is-ok", 暂停: "is-warn", 完成: "is-ok", 放弃: "" };
  function readableReason(text2, c, labels) {
    let names2 = /* @__PURE__ */ new Map();
    for (let n of c.compiled.nodes) {
      n.uid && names2.set(n.uid, `「${n.name}」`);
      for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
        d.fact && !names2.has(d.fact) && names2.set(
          d.fact,
          `「${labels[d.fact] && labels[d.fact].label || (d.text.length > 20 ? `${d.text.slice(0, 20)}…` : d.text)}」`
        );
    }
    for (let l of c.compiled.lines || []) names2.set(l.id, `「${l.name}」`);
    for (let [code, v] of Object.entries(labels)) names2.has(code) || names2.set(code, `「${v.label}」`);
    return String(text2).replace(/尚无记录/g, "还没发生").replace(/\b(?:线 |节点 )?([A-Za-z][\w-]*)\b/g, (all, id) => names2.has(id) ? names2.get(id) : all);
  }
  function lineWaitText(s, c, labels = {}) {
    let l = s.line, plan = c.plan;
    if (s.missed) return s.window.reasons.join("；");
    if (s.state === "未触发")
      return `等：${[...s.cond.v === "true" ? [] : s.cond.reasons, ...s.window && s.window.v !== "true" ? s.window.reasons : []].map((r) => readableReason(r, c, labels)).join("；") || "开启条件"}`;
    if (s.state === "可开启")
      return l.kind === "main" ? s.waitMain ? `条件已满足；${s.waitMain}，轮到它时自动开始` : "条件已满足" : plan && plan.unsynced && s.entries.length && s.entries.every((u) => plan.unsynced.includes(u)) ? "条件已满足；还在准备，下一轮开始提示" : l.mode === "manual" ? "条件已满足：这条线不主动提示，想玩就点「进入」" : c.prog.sidePaused ? "条件已满足；支线已全部暂停" : plan && plan.slots.full ? "条件已满足；同时进行的支线已经满了，正文暂时不提它。主角自己走进去时，顶端会出现「切换」" : plan && plan.offer && plan.offer.line === l.id ? "条件已满足；正文会在空闲时提一句入口，玩家走进去就开始" : s.entries.length ? "条件已满足；排在后面，轮到它时正文才会提示（玩家自己走进去也会开始）" : "条件已满足，但第一个阶段还没有能开始的场景";
    if (s.state !== "进行中") return "";
    let away = c.away && c.away[l.id];
    return away && c.state.focus.uid && c.state.nodeStates.some((n) => n.node.uid === c.state.focus.uid && n.node.unit.line && n.node.unit.line.id === l.id) && (away = null), away ? `已离开 ${away.rounds} 轮${away.place ? ` · 上次在${away.place}` : ""}` : s.why;
  }
  function lineCard(c, project) {
    let list = c.state.lineStates || [];
    if (!list.length) return "";
    let sides = list.filter((s) => s.line.kind === "side"), limit = c.plan ? c.plan.slots.limit : 1, used = c.plan ? c.plan.slots.used.length : 0, row2 = (s) => {
      let l = s.line, wait = lineWaitText(s, c, isPlainObject(project.clue.labels) ? project.clue.labels : {}), btn = (v, label, cls = "", tip = "") => `<button type="button" class="pi-btn is-sm${cls}" data-act="clue-line" data-id="${esc(l.id)}" data-value="${v}"${tip ? ` title="${esc(tip)}"` : ""}>${label}</button>`, canEnter = !s.started && !s.manual.state && s.eligible && !s.waitMain && !(l.kind === "main" && mainSlotTaken(list, l.id)), inQueue = l.kind === "side" && l.mode !== "manual" && s.state === "可开启" && s.entries.length && c.plan && !c.plan.slots.full && !c.prog.sidePaused, acts = canEnter ? `${btn("enter", "进入", " is-primary", l.mode === "manual" ? "想玩这条线了：现在开始" : "主角已经开始做这件事了（填表没认出来时用），或者你现在就想开始")}${inQueue ? btn("skip", "跳过", "", "先让后面的支线上来；这条排到最后，过一阵还会轮回来") : ""}${btn("pause", "暂停", "", "这条先不想玩：不提示，要手动继续")}` : s.state === "进行中" ? `${btn("pause", "暂停")}${btn("done", "标记完成")}${btn("abandon", "放弃")}` : s.state === "暂停" ? `${btn("resume", "继续", " is-primary")}${btn("abandon", "放弃")}` : "", undo = s.manual.evidence && s.manual.evidence !== "manual" && !s.manual.evidence.startsWith("auto@") && s.state === "进行中" ? btn("deny", "取消开启", " is-ghost", "插件认错了：这条线回到可开启，同一次依据不再自动开启") : s.manual.started || s.manual.state ? btn("", "还原", " is-ghost", "把你在这条线上点过的进入 / 暂停 / 完成 / 放弃还原，回到按条件自动判断") : "", checks = !s.started && !s.manual.state && l.mode !== "manual" ? tableCondChecks(l.open, c.snap.tables || {}) : [], stuck = checks.filter((x) => x.stuck), fix = stuck.length ? `<p class="pi-hint is-warn">开启条件读不出来：${esc(stuck.flatMap((x) => x.notes).join("；"))}。这样它会一直开不了。 <button type="button" class="pi-btn is-sm" data-act="clue-line-manual" data-id="${esc(l.id)}" title="开启条件挪到「原开启条件」里留着看，不再自动判断；执行页出现「进入」按钮，玩家想玩时点它">改成手动开始</button></p>` : "", orig = l.origCond ? `<p class="pi-hint">原来的开启要求（自己判断什么时候点「进入」）：${esc(l.origCond)}</p>` : "", tierBtns = checks.filter((x) => x.tierPending).map(
        (x) => `<p class="pi-hint is-warn">档位顺序是 AI 推断的：${esc(x.tierPending.join(" < "))}。确认前这个条件一直是未知。 <button type="button" class="pi-btn is-sm" data-act="clue-tiers" data-tiers="${esc(JSON.stringify(x.tierPending))}" title="大纲里用同样档位的条件都算确认">从低到高没错</button> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-manual" data-id="${esc(l.id)}">改成手动开始</button></p>`
      ).join(""), k = sides.indexOf(s), arrows = l.kind === "side" && sides.length > 1 ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="-1" title="往前排"${k <= 0 ? " disabled" : ""}>↑</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="1" title="往后排"${k >= sides.length - 1 ? " disabled" : ""}>↓</button>` : "";
      return `<div class="pi-line-row"><div class="pi-row"><b>${esc(l.name)}</b><span class="pi-meta">${esc(l.id)} · ${l.kind === "main" ? "主线" : "支线"}</span><span class="pi-badge ${s.missed ? "" : LINE_BADGE[s.state] || ""}">${esc(s.missed ? "已错过" : s.state)}</span>${l.kind === "side" && c.prog.sidePaused && s.state === "进行中" ? '<span class="pi-meta">全部支线已暂停</span>' : ""}<span class="pi-spacer"></span>${arrows}</div>
          <div class="pi-row pi-line-acts">${acts}${undo}</div>
          ${l.brief ? `<p class="pi-hint">${esc(l.brief)}</p>` : ""}${wait ? `<p class="pi-hint">${esc(wait)}</p>` : ""}${orig}${fix}${tierBtns}</div>`;
    }, sideBtn = sides.length ? `<button type="button" class="pi-btn is-sm${c.prog.sidePaused ? " is-primary" : ""}" data-act="clue-pause-side" data-value="${c.prog.sidePaused ? "" : "1"}" title="${c.prog.sidePaused ? "支线恢复注入和提示；原来进行中的支线接着演" : "所有支线都不注入、不提示新的；主线照常，进度和名额都保留"}">${c.prog.sidePaused ? "继续全部支线" : "暂停全部支线"}</button>` : "";
    return `<div class="pi-card"><h3>剧情线<span class="pi-meta">${list.filter((s) => s.state === "进行中").length} 条进行中${sides.length ? ` · 支线 ${used} 条（最多 ${limit} 条）` : ""}</span><span class="pi-spacer"></span>${sideBtn}</h3>
        <p class="pi-hint">条件满足后，正文会找机会提一句入口，主角走进去才算开始。你点的「进入」「跳过」「暂停」记在当前这一楼，删楼或重新生成会一起撤回。</p>
        ${sides.length ? `<div class="pi-row pi-line-opts"><label class="pi-check"><span>同时进行的支线</span><select class="pi-sel is-sm" data-clue-sidelimit>${options(
      [
        { value: "1", label: "最多 1 条" },
        { value: "2", label: "最多 2 条" }
      ],
      String(limit)
    )}</select></label>
          <label class="pi-check"><input type="checkbox" data-clue-linetoast${project.clue.lineToast !== !1 ? " checked" : ""}><span>剧情线自动开始时在顶端提示</span></label></div>` : ""}
        ${list.map(row2).join("")}</div>`;
  }
  function hereText(c) {
    let cell = readCell(c.snap.tables || {}, "全局数据表/全局状态/当前详细地点"), here = cell.state === "ok" ? cellText(cell.value) : "", focus = c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid), place = focus ? clueText(isPlainObject(focus.node.item) ? focus.node.item.地点 : "") : "";
    return here || place ? `主角当前位置：${esc(here || "（表格没记）")}${focus ? ` · 这一场的地点：${esc(place || "（大纲没写）")}` : ""}<br>` : "";
  }
  function stayNotice(view, c) {
    let info = view.runtime.clue.stayInfo(), st9 = info && info.key ? stayState(view.runtime.progress().stays, chatMessages(), info) : null;
    return st9 && st9.idle >= 7 ? `<p class="pi-hint is-warn">这一场很久没有新的发现了（连续 ${st9.idle} 条回复）。想换个地方，可以让主角离开，或者点「离开这个调查」；想先玩日常，可以暂停剧情。也可能只是填表漏记了，可以对照正文看看。</p>` : "";
  }
  function keepLabels(view, picked) {
    let p = view.project();
    if (!p) return;
    let ctx2 = new Map(
      factLabelContext(
        p.outline.volumes,
        picked.map((f) => f.code)
      ).map((x) => [x.code, x])
    ), add = {};
    for (let f of picked)
      f.label && (add[f.code] = { label: f.label, criterion: f.criterion || "", sig: factLabelSig(ctx2.get(f.code) || { usedBy: [] }) });
    Object.keys(add).length && view.data.updateProject(p.id, (cur) => ({
      ...cur,
      clue: normalizeClue({ ...cur.clue, labels: { ...cur.clue.labels || {}, ...add } })
    }));
  }
  var labelJob = null, voidAsked = !1;
  async function prepareLabels(view, { quiet = !1 } = {}) {
    let project = view.project();
    if (!project || !isClueMode(project) || labelJob) return labelJob || { done: 0, missing: [] };
    let pid = project.id, todo = labelsToPrepare(project.outline.volumes, project.clue.labels);
    return todo.length ? (labelJob = (async () => {
      try {
        let ids = Array.isArray(project.imports) ? project.imports : [], jobs = await Promise.all(
          ids.map(
            (id) => view.data.imports.get(id) ? Promise.resolve(view.data.imports.get(id)) : view.data.imports.load(id).catch(() => null)
          )
        ), secrets = [...new Set(jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []))], items = todo.map((x) => x.ctx), r = parseFactLabels(
          await ask(view, "outline", factLabelMessages(items, { secrets })),
          todo.map((x) => x.code)
        ), got = /* @__PURE__ */ new Map();
        for (let x of todo) {
          let v = r.items.get(x.code);
          v && v.label && got.set(x.code, { label: v.label, criterion: v.criterion, sig: x.sig });
        }
        try {
          let rv = [...got].map(([code, v]) => {
            let c = todo.find((x) => x.code === code).ctx;
            return {
              code,
              label: v.label,
              criterion: v.criterion,
              answer: [c.answer, ...(c.routes || []).map((q) => q.answer)].filter(Boolean).join("；或者："),
              entry: c.entry,
              scene: c.scene,
              record: [c.record, ...(c.routes || []).map((q) => q.record)].filter(Boolean).join("；或者："),
              pieces: factLabelCheck({ label: v.label, criterion: v.criterion }, c, { secrets }).suspects.map(
                (s) => s.piece
              )
            };
          }), map = rv.length ? parseFactLabelReview(
            await ask(view, "outline", factLabelReviewMessages(rv)),
            rv.map((x) => x.code)
          ) : /* @__PURE__ */ new Map();
          for (let [code, v] of map)
            v && v.leak && got.has(code) && got.set(code, {
              ...got.get(code),
              label: v.label || got.get(code).label,
              criterion: v.criterion || got.get(code).criterion
            });
        } catch {
        }
        view.data.project(pid) && view.data.updateProject(pid, (p) => ({
          ...p,
          clue: normalizeClue({ ...p.clue, labels: { ...p.clue.labels || {}, ...Object.fromEntries(got) } })
        }));
        let missing = todo.filter((x) => !got.has(x.code)).map((x) => x.code);
        return quiet || (missing.length ? toast(
          "warning",
          `线索标签准备好了 ${got.size} 条，${missing.length} 条没生成（${missing.slice(0, 5).join("、")}）。可以到执行页重试。`
        ) : toast("success", `已为 ${got.size} 条线索准备好标签。`)), view.runtime.clue.scheduleSync(), { done: got.size, missing };
      } catch (error) {
        return quiet || toast("warning", `线索标签没准备好：${error.message}。大纲已经采用；可以到执行页重试。`), { done: 0, missing: todo.map((x) => x.code), error: error.message };
      } finally {
        labelJob = null, view.renderBody && view.renderBody();
      }
    })(), labelJob) : { done: 0, missing: [] };
  }
  function labelsPendingHtml(project, c) {
    let have = c && c.snap.facts || /* @__PURE__ */ new Map(), todo = labelsToPrepare(project.outline.volumes, project.clue.labels).filter((x) => !have.has(x.code));
    return todo.length ? `<p class="pi-hint is-warn">有 ${todo.length} 条线索的标签还没准备好（${esc(
      todo.slice(0, 5).map((x) => x.code).join("、")
    )}${todo.length > 5 ? "……" : ""}），这些线开始后暂时补不了行。<button type="button" class="pi-btn is-sm" data-act="clue-labels">${labelJob ? "正在准备…" : "现在准备"}</button></p>` : "";
  }
  function unofferedHtml(c) {
    return (c.unoffered || []).map((x) => {
      let text2 = clueText(x.text) || `${x.id}（表里没写内容）`, short = text2.length > 40 ? `${text2.slice(0, 40)}…` : text2;
      return x.revoked ? `<p class="pi-hint pi-unoffered">已作废（按没拿到算）：<span title="${esc(text2)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-restore" data-id="${esc(x.id)}" title="解除作废，重新按表格判断；不会还原被清掉的记录">解除作废</button></p>` : `<p class="pi-hint is-warn pi-unoffered">⚠ 正文可能自己编了：<span title="${esc(text2)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-keep" data-id="${esc(x.id)}" title="就当发生了，剧情照常走">保留</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-void" data-id="${esc(x.id)}" title="当作没发生，之后可以重新查">作废</button><span class="pi-unoffered-tip">保留＝就当发生了；作废＝当作没发生</span></p>`;
    }).join("");
  }

  // src/ui/wb-import.js
  async function pickWorldbookEntries(title2 = "从世界书导入") {
    let books = boundBookNames();
    if (!books.length)
      return toast("info", "当前卡没有关联的世界书。"), [];
    let loaded = [];
    for (let book of books)
      try {
        loaded.push({ ...book, entries: bookEntries(await loadBook(book.name)) });
      } catch (error) {
        loaded.push({ ...book, entries: [], error: error.message });
      }
    let html = loaded.map(
      (book, b) => `<p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span>${book.error ? ` <span class="pi-badge is-danger">${esc(book.error)}</span>` : ""}</p>
        ${book.entries.map(
        (entry, e) => `<label class="pi-check${entry.disabled ? " is-off" : ""}"><input type="checkbox" data-pick="${b}:${e}">
        <span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length} 字</span></span></label>`
      ).join("")}`
    ).join(""), picked = await openDialog({
      title: title2,
      html: `<div class="pi-ref-top"><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="0">全不选</button></div>${html}`,
      actions: [
        { label: "取消", value: null },
        {
          label: "导入选中",
          primary: !0,
          value: (root) => [...root.querySelectorAll("[data-pick]:checked")].map((input2) => input2.dataset.pick)
        }
      ],
      onMount(box) {
        box.addEventListener("click", (event) => {
          let every = event.target.closest("[data-pick-every]");
          every && box.querySelectorAll("[data-pick]").forEach((input2) => {
            input2.checked = every.dataset.pickEvery === "1";
          });
        });
      }
    });
    return !picked || !picked.length ? [] : picked.map((code) => {
      let [b, e] = code.split(":").map(Number);
      return { book: loaded[b].name, ...loaded[b].entries[e] };
    });
  }
  function classifyEntries(entries) {
    let outline = [], setting = [];
    for (let entry of entries)
      try {
        outline.push({ entry, volumes: parseOutlineText(entry.content) });
      } catch {
        setting.push(entry);
      }
    return { outline, setting };
  }
  async function afterImport(entries, { authorCount = 0 } = {}) {
    if (!entries.length) return;
    let choice = await choiceDialog({
      title: "世界书里的原条目",
      body: `原条目和注入内容会重复。关闭只改「禁用」，可随时在世界书里重新打开。${authorCount ? `其中 ${authorCount} 条导入为仅作者资料：原条目如果保持开启，世界书仍会把它注入正文，建议关闭。` : ""}`,
      choices: [
        { label: "保留", value: "keep" },
        { label: "删除", value: "delete", danger: !0 },
        { label: "关闭", value: "disable", primary: !0 }
      ]
    });
    if (!choice || choice === "keep") return;
    let byBook = /* @__PURE__ */ new Map();
    for (let entry of entries) byBook.has(entry.book) || byBook.set(entry.book, []), byBook.get(entry.book).push(entry.key);
    try {
      for (let [book, keys] of byBook)
        choice === "disable" ? await setEntriesDisabled(book, keys, !0) : downloadBlob(`${book}-已删条目备份.json`, JSON.stringify(await deleteEntries(book, keys), null, 2));
      toast("success", choice === "disable" ? "已关闭原条目。" : "已删除原条目，备份已下载。");
    } catch (error) {
      toast("error", error.message);
    }
  }
  async function chooseSettingKinds(entries) {
    if (!entries.length) return [];
    let html = `<p class="pi-hint">这些条目不是大纲格式，会放进「设定」。<b>公开设定</b>每轮都会注入正文；<b>仅作者资料</b>用 &lt;仅作者&gt; 包住，不注入，只在讨论和让 AI 写大纲时使用。剧情走向、真相、未来安排请选仅作者。</p>
        ${entries.map(
      (entry, i) => `<div class="pi-wbkind"><span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length} 字</span></span>
        <label class="pi-check"><input type="radio" name="wbk${i}" value="author" data-kind="${i}" checked><span>仅作者</span></label>
        <label class="pi-check"><input type="radio" name="wbk${i}" value="public" data-kind="${i}"><span>公开设定</span></label></div>`
    ).join("")}`;
    return await openDialog({
      title: "设定条目的用途",
      html,
      actions: [
        { label: "取消", value: null },
        {
          label: "导入",
          primary: !0,
          value: (root) => entries.map((_, i) => {
            let on = root.querySelector(`[data-kind="${i}"]:checked`);
            return on ? on.value : "author";
          })
        }
      ]
    }) || null;
  }
  function wrapAuthor(text2) {
    return wrapAuthorText(text2);
  }
  async function settingPiecesFromEntries(entries) {
    let kinds = await chooseSettingKinds(entries);
    return kinds === null ? null : {
      pieces: entries.map((entry, i) => kinds[i] === "author" ? wrapAuthor(entry.content) : String(entry.content || "").trim()).filter(Boolean),
      authorCount: kinds.filter((k) => k === "author").length
    };
  }

  // src/ui/gen-refs.js
  var refsOf = (project) => normalizeGenRefs(project.genRefs);
  function genRefsBar(view, scope) {
    let project = view.project(), refs = refsOf(project), chat = view.data.chat(view.projectId);
    chat || view.data.loadChat(view.projectId).then(() => view.renderBody()).catch(() => {
    });
    let talks = chat ? chat.messages.length + (chat.summary ? 1 : 0) : 0, wb = wbSummary(view, refs, () => view.renderBody(), `gen-${scope}`);
    return `<div class="pi-refs"><span class="pi-hint">参考：</span>
        <button type="button" class="pi-chip${refs.talk && talks ? " is-on" : ""}" data-act="gen-talk"${talks ? "" : ' disabled title="讨论页还没有记录"'}>讨论记录</button>
        <button type="button" class="pi-chip${wb && wb.count ? " is-on" : ""}" data-act="gen-wb">世界书 ${wb ? `${wb.count} 条` : "…"}</button></div>`;
  }
  async function genRefTexts(view, limit) {
    let refs = refsOf(view.project());
    return { talk: refs.talk ? await talkText(view, limit) : "", wb: await wbRefTexts(refs.wb, refs.memo) };
  }
  function update(view, patch) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, genRefs: { ...refsOf(project), ...patch } }));
  }
  var genActions = {
    "gen-talk"(view) {
      update(view, { talk: !refsOf(view.project()).talk }), view.renderBody();
    },
    async "gen-wb"(view) {
      let result = await pickRefs(refsOf(view.project()), "AI 写作参考的世界书条目");
      if (result) {
        if (result.none) return toast("info", "当前卡没有关联的世界书。");
        update(view, { wb: result.wb, memo: result.memo }), view.renderBody();
      }
    }
  };

  // src/ui/tab-outline.js
  var NODE_KEYS = {
    main: ["名称", "地点", "事件", "偏转"],
    side: ["名称", "地点", "事件", "触发", "偏转"],
    world: ["类型", "来源", "内容"]
  }, LONG_KEYS = /* @__PURE__ */ new Set(["事件", "偏转", "内容", "触发"]), NEW_NODE = {
    main: { 名称: "", 地点: "", 事件: "", 偏转: "" },
    side: { 名称: "", 地点: "", 事件: "", 触发: "" },
    world: { 类型: "", 来源: "", 内容: "" }
  }, st = (view) => view.tabState("outline"), STAGE_DRAFT = { "stage-refine": "细化节点", "stage-split": "拆成两段", "stage-merge": "与下一段合并" }, fmtTime = (time2) => new Date(time2).toLocaleString(), ERR_PREFIX = /^(?:YAML 格式错误(?:（第 \d+ 行）)?|第 \d+ 行)[：:]\s*/;
  function errParts(error, line) {
    let text2 = String(error && error.message || error || ""), no = line || error && error.line || Number((/第 (\d+) 行/.exec(text2) || [])[1]) || 0, detail = text2.replace(ERR_PREFIX, "").trim(), yaml = !!no || /^YAML 格式错误/.test(text2) && !/[一-鿿]/.test(detail);
    return { no, detail, yaml };
  }
  function errHtml(error, line, tag = "p") {
    let { no, detail, yaml } = errParts(error, line);
    return yaml ? `<${tag} class="pi-hint">${no ? `第 ${no} 行格式有误` : "格式有误"}</${tag}>${detail ? `<details class="pi-err"><summary>错误详情</summary><div class="pi-meta">${esc(detail)}</div></details>` : ""}` : `<${tag} class="pi-hint">${esc(detail)}</${tag}>`;
  }
  function historyHtml(project, at) {
    let list = project.outline.history;
    if (!list.length) return '<div class="pi-card"><h3>历史版本</h3><p class="pi-hint">还没有历史版本。</p></div>';
    let chosen = list[at];
    return `<div class="pi-card"><h3>历史版本</h3>
        ${list.map(
      (item, i) => `<div class="pi-hist"><span class="pi-grow">${item.label ? `${esc(item.label)}前` : "历史版本"}<span class="pi-meta pi-block">${esc(fmtTime(item.at))}</span></span>
            <span class="pi-meta pi-hist-n">${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm${i === at ? " is-primary" : ""}" data-act="hist-view" data-i="${i}">预览</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">恢复</button></div>`
    ).join("")}
        ${chosen ? `<pre class="pi-pre">${esc(chosen.text)}</pre>` : ""}</div>`;
  }
  function checkHtml(project) {
    let issues = outlineIssues(project.outline.volumes);
    return issues.length ? `<div class="pi-card"><h3>大纲检查<span class="pi-meta">${issues.length} 项</span></h3>
        ${issues.map((item) => `<button type="button" class="pi-titem is-issue" data-act="issue-go" data-id="${esc(item.stageId || item.volumeId)}"><span class="pi-pname">${esc(item.text)}</span></button>`).join("")}</div>` : '<div class="pi-card"><h3>大纲检查</h3><p class="pi-hint">没有发现问题。</p></div>';
  }
  function overviewHtml(view, project) {
    let { runtime } = view, units = flattenUnits(project.outline.volumes), states = runtime.activeId() === project.id ? unitStates(units, runtime.progress()) : {};
    return units.length ? project.outline.volumes.map(
      (volume) => `<div class="pi-card"><h3>${esc(volumeLabel(volume.key))}</h3>
        ${volume.stages.map((stage) => {
        let names2 = mainNodeNames(stage.data);
        return `<button type="button" class="pi-ov-stage${states[stage.id] === "active" ? " is-active" : ""}${states[stage.id] === "done" ? " is-done" : ""}" data-act="ov-go" data-id="${esc(stage.id)}">
            <span class="pi-ov-title">${esc(stageLabel(stage.key))}</span>
            ${names2.map((name) => `<span class="pi-meta pi-ov-node">${esc(name)}</span>`).join("")}</button>`;
      }).join("") || '<p class="pi-hint">没有阶段</p>'}</div>`
    ).join("") : '<div class="pi-card"><p class="pi-hint">还没有卷。</p></div>';
  }
  function findSel(project, sel) {
    for (let volume of project.outline.volumes) {
      if (volume.id === sel) return { volume };
      let stage = volume.stages.find((item) => item.id === sel);
      if (stage) return { volume, stage };
    }
    return {};
  }
  function treeHtml(project, sel) {
    return project.outline.volumes.map(
      (volume) => `<button type="button" class="pi-titem is-vol${volume.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeLabel(volume.key))}</span></button>
        ${volume.stages.map((stage) => `<button type="button" class="pi-titem is-stage${stage.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join("")}`
    ).join("") || '<p class="pi-hint">还没有卷。</p>';
  }
  var PLAY_KEYS = { side: ["条件", "时限", "错过", "步骤"], world: ["进度钟", "前兆", "后果"] }, PLAY_HINTS = {
    条件: "满足后才激活，如主角到过酒馆",
    时限: "激活后的楼数，或写「本卷」",
    错过: "过期未接时的后果",
    步骤: "每行一步，按顺序推进",
    进度钟: "总格数，如 4、6、8",
    前兆: "过半时透露的风声",
    后果: "发生后写进状态变化"
  }, PLAY_LONG = /* @__PURE__ */ new Set(["错过", "步骤", "前兆", "后果"]), PLAY_SHORT = /* @__PURE__ */ new Set(["进度钟", "时限"]);
  function playEditor(meta2, value, index) {
    let keys = PLAY_KEYS[meta2.kind];
    if (!keys) return "";
    let shown = (key) => key === "步骤" ? hookSteps(value).join(`
`) : String(value[key] ?? ""), attrs = (key) => `data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" data-play placeholder="${esc(PLAY_HINTS[key])}"`;
    return `<details class="pi-play"${keys.some((key) => shown(key).trim()) ? " open" : ""}><summary>玩法</summary>
        ${keys.map((key) => {
      let field2 = `<label class="pi-field"><span>${esc(key)}</span>${PLAY_LONG.has(key) ? `<textarea class="pi-ta" rows="2" ${attrs(key)}>${esc(shown(key))}</textarea>` : `<input class="pi-inp" ${key === "进度钟" ? 'type="number" min="2" max="12" ' : ""}${attrs(key)} value="${esc(shown(key))}">`}</label>`;
      return PLAY_SHORT.has(key) ? `<div class="pi-pair">${field2}</div>` : field2;
    }).join("")}</details>`;
  }
  function playValue(key, raw) {
    let text2 = String(raw ?? "").trim();
    if (key === "步骤") {
      let lines2 = text2.split(`
`).map((line) => line.trim()).filter(Boolean);
      return lines2.length ? lines2 : void 0;
    }
    if (text2)
      return key === "进度钟" || key === "时限" && /^\d+$/.test(text2) ? Number(text2) : text2;
  }
  function nodeEditor(stage, meta2, clueOn = !1) {
    let list = Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field] : [], items = list.map((item, index) => {
      let value = item && typeof item == "object" ? item : { 内容: String(item ?? "") }, play = PLAY_KEYS[meta2.kind] || [], keys = [.../* @__PURE__ */ new Set([...NODE_KEYS[meta2.kind], ...Object.keys(value)])].filter(
        (key) => !play.includes(key) && key !== "id" && !CLUE_TEXT_KEYS.includes(key) && !CLUE_YAML_KEYS.includes(key)
      );
      return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(meta2.label)} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-icon-btn" data-act="node-menu" data-field="${esc(meta2.field)}" data-i="${index}" data-last="${index < list.length - 1 ? "" : "1"}" title="更多">${ICONS.more}</button></div>
            ${keys.map((key) => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key) ? `<textarea class="pi-ta" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? "")}</textarea>` : `<input class="pi-inp" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? "")}">`}</label>`).join("")}
            ${playEditor(meta2, value, index)}${clueOn ? clueNodeFields(meta2, index, value) : ""}</div>`;
    }).join("");
    return `<div class="pi-card"><h3>${esc(meta2.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta2.field)}" data-kind="${meta2.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
  }
  function nodeTabs(stage, kind) {
    let count = (meta2) => Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field].length : 0;
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map((meta2) => `<button type="button" class="pi-seg-btn${meta2.kind === kind ? " is-sel" : ""}" data-act="node-kind" data-kind="${meta2.kind}">${esc(meta2.label)} ${count(meta2)}</button>`).join("")}</div>`;
  }
  function stageEditor(volume, stage, raw, kind, clueOn = !1) {
    let known = /* @__PURE__ */ new Set([
      "时间范围",
      "AI指令",
      CHANGE_FIELD,
      ...NODE_FIELDS.map((item) => item.field),
      ...CLUE_STAGE_KEYS
    ]), extra = Object.keys(stage.data).filter((key) => !known.has(key)), head = `<div class="pi-card"><h3>阶段<span class="pi-spacer"></span>${raw ? "" : '<button type="button" class="pi-btn is-primary is-sm" data-act="outline-save">保存</button>'}<button type="button" class="pi-icon-btn" data-act="stage-menu" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint">所属：${esc(volumeLabel(volume.key))}</p>`;
    return raw ? `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>` : `${head}<label class="pi-field"><span>阶段名（阶段N_标题）</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}"></label>
        <label class="pi-field"><span>时间范围（用来判断何时切到下一段）</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? "")}"></label>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta" rows="2" data-stage-field="AI指令">${esc(stage.data.AI指令 ?? "")}</textarea></label>
        <label class="pi-field"><span>状态变化（每行一条，本阶段演完后接在设定后面注入）</span><textarea class="pi-ta" rows="2" data-stage-list="${CHANGE_FIELD}" placeholder="例：她察觉到 A 对她不只是兄弟情">${esc(
      changeLines(stage.data).join(`
`)
    )}</textarea></label>
        ${clueOn ? ["进入条件", "结束条件"].map((key) => `<label class="pi-field"><span>${key}</span><textarea class="pi-ta is-mono" data-stage-yaml="${key}">${esc(stage.data[key] == null ? "" : typeof stage.data[key] == "string" ? stage.data[key] : stringifyYaml(stage.data[key]).trim())}</textarea></label>`).join("") + '<p class="pi-status" data-stage-yaml-status></p>' : ""}
${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join("、"))}（在 YAML 原文里编辑）</p>` : ""}</div>
        ${nodeTabs(stage, kind)}${nodeEditor(
      stage,
      NODE_FIELDS.find((meta2) => meta2.kind === kind),
      clueOn
    )}`;
  }
  function volumeEditor(volume) {
    return `<div class="pi-card"><h3>卷<span class="pi-spacer"></span><button type="button" class="pi-btn is-primary is-sm" data-act="outline-save">保存</button><button type="button" class="pi-icon-btn" data-act="vol-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="stage-add">＋新阶段</button></div>
        <label class="pi-field"><span>卷名（剧情_卷X_标题）</span><input class="pi-inp" data-vol-key value="${esc(volume.key)}"></label>
        <p class="pi-hint">${volume.stages.length} 个阶段</p></div>`;
  }
  function multiHtml(view, draft) {
    let busy = view.busy.outline, good = draft.items.filter((item) => item.ok), rows2 = draft.items.map((item, i) => {
      let head = `<div class="pi-vrow"><span class="pi-grow">第 ${draft.volumeNo + i} 卷${item.ok && item.volumes[0] ? ` <b>${esc(volumeLabel(item.volumes[0].key))}</b>` : ""}</span>
            <span class="pi-meta">${item.ok ? "已解析" : "格式错误"}</span>
            <button type="button" class="pi-icon-btn" data-act="multi-menu" data-i="${i}" title="更多">${ICONS.more}</button></div>`;
      return item.ok ? `<div class="pi-vitem">${head}</div>` : `<div class="pi-vitem">${head}${errHtml(item.error, item.line)}
            <textarea class="pi-ta is-mono" rows="${Math.min(14, Math.max(6, String(item.yaml).split(`
`).length + 1))}" data-draft-yaml>${esc(item.yaml)}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-fix" data-i="${i}"${busy ? " disabled" : ""}>让 AI 修正格式</button></div></div>`;
    }).join(""), ready = good.length === draft.items.length && good.length > 0, partial = draft.items.length < draft.n, clueIssues = [];
    if (isClueMode(view.project())) {
      let current = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, { known, claimed } = chatFactSets(current);
      clueIssues = checkClueDraft(
        good.flatMap((item) => item.volumes),
        view.project().outline.volumes,
        { isObtained: (id) => known.includes(id), obtainedFacts: known, claimedFacts: claimed }
      );
    }
    return `<div class="pi-card"><h3>AI 写的大纲<span class="pi-meta">${good.length}/${draft.n} 卷</span></h3>
        ${draft.scope ? '<p class="pi-hint">' + esc(draft.scope) + "</p>" : ""}
        ${isClueMode(view.project()) ? "<details><summary>线索结构检查（" + clueIssues.length + "）</summary>" + clueIssues.map((issue) => '<p class="pi-hint is-warn">' + esc(issue) + "</p>").join("") + "</details>" : ""}
        ${rows2}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-append"${ready && !busy ? "" : " disabled"}>${partial ? `追加已写完的 ${good.length} 卷` : "追加"}</button>
        <button type="button" class="pi-btn is-sm" data-act="multi-drop"${busy ? " disabled" : ""}>丢弃</button></div></div>`;
  }
  function draftHtml(view, draft) {
    if (!draft) return "";
    if (draft.mode === "multi") return multiHtml(view, draft);
    let title2 = STAGE_DRAFT[draft.mode] || (draft.mode === "rewrite" ? "改写后续阶段" : "AI 写的大纲");
    if (!draft.ok)
      return `<div class="pi-card"><h3>${title2}<span class="pi-badge is-danger">格式错误</span></h3>
            ${errHtml(draft.error, draft.line)}
            <textarea class="pi-ta is-mono is-tall" data-draft-yaml>${esc(draft.yaml)}</textarea>
            <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="draft-fix"${view.busy.outline ? " disabled" : ""}>让 AI 修正格式</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-reparse">重新解析</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
    let issues = draft.issues || [], conds = draft.tableConds || [], summary = draft.volumes.map(
      (volume) => `<p class="pi-hint"><b>${esc(volumeLabel(volume.key))}</b>：${volume.stages.map((stage) => esc(stageLabel(stage.key))).join("、")}</p>`
    ).join("") + (draft.scope ? `<p class="pi-hint">${esc(draft.scope)}</p>` : "") + (conds.length ? `<p class="pi-hint">读表格的条件：</p>${conds.map((x) => `<p class="pi-hint${x.level === "ok" ? "" : " is-warn"}">· ${esc(x.where)}：${esc(x.raw)}　现在：${esc(x.now || "（读不到）")}${x.level === "ok" ? " ✓" : ""}</p>`).join("")}` : "") + (issues.length ? `<p class="pi-hint is-warn">线索结构检查（${issues.length}）：</p>${issues.map((i) => `<p class="pi-hint is-warn">· ${esc(i)}</p>`).join("")}` : draft.clue ? '<p class="pi-hint">线索结构检查：没有发现问题。</p>' : ""), single = !!STAGE_DRAFT[draft.mode], buttons = single ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-stage">替换</button>' : draft.mode === "rewrite" ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>' : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">${draft.volumes.length > 1 ? `全部追加 ${draft.volumes.length} 卷` : "存为新卷"}</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-replace">替换选中卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-append">追加为新阶段</button>`;
    return `<div class="pi-card"><h3>${title2}<span class="pi-badge is-ok">已解析</span></h3>${summary}
        <details><summary class="pi-hint">YAML 原文</summary><pre class="pi-pre">${esc(draft.yaml)}</pre></details>
        <div class="pi-tools is-end ${draft.mode === "rewrite" || single ? "is-c2" : "is-c4"}">${buttons}<button type="button" class="pi-btn is-sm" data-act="draft-drop">丢弃</button></div></div>`;
  }
  var parkedDrafts = /* @__PURE__ */ new Map();
  function syncDraft(view, s) {
    s.draft && s.draft.projectId && s.draft.projectId !== view.projectId && (parkedDrafts.set(s.draft.projectId, s.draft), s.draft = null), !s.draft && parkedDrafts.has(view.projectId) && (s.draft = parkedDrafts.get(view.projectId), parkedDrafts.delete(view.projectId));
  }
  function render(view) {
    if (st(view).lineReview && st(view).lineReview === view.projectId) return renderLineReview(view);
    if (st(view).importing === view.projectId) return renderImport(view);
    let project = view.project(), s = st(view);
    syncDraft(view, s);
    let { volume, stage } = findSel(project, s.sel), busy = view.busy.outline, kind = NODE_FIELDS.some((meta2) => meta2.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind, editor2 = stage ? stageEditor(volume, stage, s.raw, kind, isClueMode(project)) : volume ? volumeEditor(volume) : '<div class="pi-card"><p class="pi-hint">从左边选一卷或一个阶段编辑。</p></div>';
    return `<div class="pi-card"><h3>大纲${isClueMode(project) && project.outline.volumes.some((v) => isPlainObject(v.line)) ? '<button type="button" class="pi-btn is-sm" data-act="lines-open">剧情线…</button>' : ""}<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="outline-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c4"><button type="button" class="pi-btn is-sm" data-act="import-open-panel">导入长文…</button>
            <button type="button" class="pi-btn is-sm${s.check ? " is-primary" : ""}" data-act="check-toggle">检查</button>
            <button type="button" class="pi-btn is-sm${s.overview ? " is-primary" : ""}" data-act="overview-toggle">总览</button>
            <button type="button" class="pi-btn is-sm${s.history ? " is-primary" : ""}" data-act="history">历史 ${project.outline.history.length}</button></div>
        ${genRefsBar(view, "outline")}
        <div class="pi-tools is-c1">${s.multi && s.multi.projectId === view.projectId ? `<button type="button" class="pi-btn is-primary is-sm" data-act="multi-stop"><span class="pi-spin"></span>写作中 ${s.multi.k}/${s.multi.n}，点击停止</button>` : `<button type="button" class="pi-btn is-primary is-sm" data-act="ai-volume"${busy ? " disabled" : ""}>${busy ? '<span class="pi-spin"></span>写作中' : `AI 写第 ${project.outline.volumes.length + 1} 卷`}</button>`}</div>
        </div>
        ${draftHtml(view, s.draft)}
        ${s.check ? checkHtml(project) : ""}
        ${s.history ? historyHtml(project, s.historyAt) : ""}
        ${s.overview ? overviewHtml(view, project) : `<div class="pi-tree"><div class="pi-tree-list">${treeHtml(project, s.sel)}
            <button type="button" class="pi-btn is-sm is-ghost is-block" data-act="vol-add">＋新卷</button></div>
            <div>${editor2}</div></div>`}`;
  }
  function liveProgress(view) {
    return view.runtime.activeId() === view.projectId ? view.runtime.progress() : null;
  }
  function remapProgress(view, progress, stageId, field2, mapIndex) {
    let meta2 = NODE_FIELDS.find((item) => item.field === field2);
    if (!meta2 || !progress) return;
    let next = remapNodes(progress, stageId, meta2.prefix, mapIndex);
    next !== progress && view.runtime.setProgress(next);
  }
  var swapIndex = (a, b) => (i) => i === a ? b : i === b ? a : i;
  function update2(view, fn, label = "", { alias = [] } = {}) {
    return view.data.updateProject(view.projectId, (project) => ({
      ...project,
      outline: withAliases(
        {
          ...project.outline,
          volumes: fn(project.outline.volumes),
          ...label ? { history: pushOutlineHistory(project.outline.history, project.outline.volumes, label) } : {}
        },
        alias
      )
    }));
  }
  function updateStage(view, stageId, fn, label = "") {
    update2(
      view,
      (volumes) => volumes.map(
        (volume) => volume.stages.some((stage) => stage.id === stageId) ? { ...volume, stages: volume.stages.map((stage) => stage.id === stageId ? fn(stage) : stage) } : volume
      ),
      label
    );
  }
  function updateVolume(view, volumeId, fn, label = "") {
    update2(view, (volumes) => volumes.map((volume) => volume.id === volumeId ? fn(volume) : volume), label);
  }
  function moveUp(list, index) {
    if (index <= 0) return list;
    let out = [...list];
    return [out[index - 1], out[index]] = [out[index], out[index - 1]], out;
  }
  function addVolumes(view, incoming, label = "导入") {
    let project = view.project(), existing = new Set(project.outline.volumes.map((volume) => volume.key)), [reid, renamed] = reidConflicts(incoming, project.outline.volumes), fresh = reid.map(
      (volume) => existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume
    );
    return renamed.length && toast(
      "warning",
      `导入内容有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID：${renamed.slice(0, 5).join("、")}${renamed.length > 5 ? "……" : ""}。引用这些 ID 的条件需要检查。`
    ), update2(view, (volumes) => [...volumes, ...fresh], label), st(view).sel = fresh[0] && fresh[0].id, view.runtime.refresh(), fresh;
  }
  async function importTexts(view, texts) {
    let added = [], failed = [];
    for (let { name, text: text2 } of texts)
      try {
        added.push(...parseOutlineText(text2));
      } catch (error) {
        failed.push({ name, error });
      }
    added.length && addVolumes(view, added), added.length && toast("success", `已导入 ${added.length} 卷。`), view.renderBody(), failed.length && await openDialog({
      title: "导入失败",
      html: failed.map((item) => `<p class="pi-hint"><b>${esc(item.name)}</b></p>${errHtml(item.error)}`).join(""),
      actions: [{ label: "关闭", value: !0, primary: !0 }]
    });
  }
  function setDraft(view, mode, reply2, extra = {}, { all = !1 } = {}) {
    let task = extra.task || taskContext(view);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    let project = view.project(), draft = { mode, ...parseOutlineReply(reply2, void 0, { all }), projectId: view.projectId, ...extra, task };
    if (draft.ok && isClueMode(project)) {
      let units = flattenUnits(project.outline.volumes), replaced = [], applied = [...project.outline.volumes, ...draft.volumes];
      if (mode === "rewrite" && draft.fromUnitId) {
        let from = units.findIndex((u) => u.id === draft.fromUnitId);
        from >= 0 && (replaced = units.slice(from), applied = replaceRest(project.outline.volumes, draft.fromUnitId, draft.volumes));
      } else if (STAGE_DRAFT[mode]) {
        let ids = new Set([draft.stageId, draft.nextId].filter(Boolean));
        replaced = units.filter((u) => ids.has(u.id)), replaced.length && (applied = replaceStages(
          project.outline.volumes,
          replaced[0].volume.id,
          [...ids],
          draft.volumes.flatMap((v) => v.stages)
        ).volumes);
      }
      let replacedIds = new Set(replaced.map((u) => u.id)), base = project.outline.volumes.map((v) => ({ ...v, stages: v.stages.filter((s) => !replacedIds.has(s.id)) })), keepIds = compileClue(replaced.map((u) => ({ ...u.volume, stages: [u.stage] }))).nodes.map((n) => n.uid).filter(Boolean), current = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, { known: obtained, claimed } = chatFactSets(current), tables = currentTables();
      if (draft.clue = !0, draft.issues = checkClueDraft(draft.volumes, base, {
        keepIds,
        isObtained: (id) => obtained.includes(id),
        obtainedFacts: obtained,
        claimedFacts: claimed,
        applied,
        tables
      }), draft.tableConds = tables ? tableCondReport(draft.volumes, tables) : [], current && replaced.length) {
        let guard = historyGuard(project.outline.volumes, applied, current.snap, current.prog, project.clue, {
          scope: new Set(keepIds)
        });
        draft.issues.unshift(...guard.diffs, ...guard.notes);
      }
    }
    putDraft(view, task.projectId, draft), view.renderBody();
  }
  function showDraft(view, reply2) {
    setDraft(view, "volume", reply2, {}, { all: !0 });
  }
  async function startRewrite(view) {
    let project = view.project(), units = flattenUnits(project.outline.volumes);
    if (!units.length) return;
    let clueCur = isClueMode(project) && view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, clueFrom = clueCur ? units.findIndex(
      (u) => clueCur.state.current ? u.id === clueCur.state.current.id : !clueCur.state.stageStates.get(u.id).done
    ) : -1;
    if (isClueMode(project) && clueCur && clueFrom < 0)
      return toast("info", "所有阶段都已结束，没有剩余阶段可以改写。要继续剧情，请用大纲页的「AI 写第 N 卷」另起新卷。"), void 0;
    let task = taskContext(view), from = isClueMode(project) ? Math.max(0, clueFrom) : Math.max(0, currentIndex(units, view.runtime.progress())), reason = await promptDialog({ title: "让 AI 改写后续阶段", label: "偏转说明（可空）：剧情哪里和大纲不一样了", multiline: !0 });
    if (reason == null) return;
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    view.go("outline");
    let material = isClueMode(project) ? await generationMaterial(view, { task: "rewrite" }) : null, recent = material ? material.recent : view.runtime.recentFloors(6).map((floor) => floor.text).join(`

`);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    let reply2 = await runTask(
      view,
      "outline",
      () => ask(
        view,
        "outline",
        material ? clueRewriteMessages({
          setting: project.setting.text,
          volumes: project.outline.volumes,
          fromUnitIndex: from,
          units,
          recent,
          reason,
          progress: material.progress,
          refs: material.refs,
          talk: material.talk
        }) : rewriteRestMessages({
          setting: project.setting.text,
          volumes: project.outline.volumes,
          fromUnitIndex: from,
          units,
          recent,
          reason
        })
      )
    );
    reply2 && setDraft(view, "rewrite", reply2, { fromUnitId: units[from].id, scope: material ? material.scope : "", task });
  }
  function applyRest(view, draft, guard = rewriteGuardNow(view, draft)) {
    let project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit) throw new Error("原来的阶段已不存在，改用「存为新卷」。");
    let incoming = draft.volumes;
    guard && (guard.keepDone.size || guard.reinsert.size) && (incoming = restoreHistory(incoming, guard), toast(
      "info",
      `已保留已经完成的节点：${[...guard.keepDone.keys(), ...guard.reinsert.keys()].join("、")}（完成条件不变，节点里的其他改动照常应用）`
    ));
    let volumes = replaceRest(project.outline.volumes, unit.stage.id, incoming);
    if (update2(view, () => volumes, "改写后续阶段"), isClueMode(project)) return view.runtime.clue.invalidate(), void 0;
    let first = draft.volumes[0] && draft.volumes[0].stages[0], from = first ? flattenUnits(volumes).findIndex((item) => item.id === first.id) : 0;
    return first && view.runtime.activeId() === view.projectId && view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id)), from;
  }
  var MAX_VOLUMES = 5;
  async function writeDialog(view) {
    let picked = await openDialog({
      title: "AI 写大纲",
      html: `<label class="pi-field"><span>卷数</span><select class="pi-sel" data-wv-n>${options(
        Array.from({ length: MAX_VOLUMES }, (_, i) => ({ value: i + 1, label: `${i + 1} 卷` })),
        1
      )}</select></label>
            <label class="pi-field"><span>整体要求（可空）</span><textarea class="pi-ta" rows="4" data-wv-request>${esc(st(view).request || "")}</textarea></label>`,
      actions: [
        { label: "取消", value: null },
        {
          label: "开始写作",
          primary: !0,
          value: (root) => ({
            n: Number(root.querySelector("[data-wv-n]").value) || 1,
            request: root.querySelector("[data-wv-request]").value.trim()
          })
        }
      ]
    });
    return picked && (st(view).request = picked.request), picked;
  }
  function setTalkRef(view) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, genRefs: { ...normalizeGenRefs(project.genRefs), talk: !0 } }));
  }
  function volumeRequest({ project, talk, wb, material, extra = [], no, k, n, request, tableCatalog }) {
    let volumes = [...project.outline.volumes, ...extra];
    return outlineMessages({
      setting: project.setting.text,
      talk,
      refs: wb,
      volumes,
      volumeNo: no,
      request: n > 1 ? "共写 " + n + " 卷，这是第 " + k + " 卷。" + (request || "") : request,
      mode: isClueMode(project) ? "clue" : "outline",
      clueIndex: isClueMode(project) ? clueIndexText(volumes) : "",
      progress: material?.progress || "",
      recent: material?.recent || "",
      tableCatalog: tableCatalog ?? (isClueMode(project) ? tableCatalogText(currentTables()) : "")
    });
  }
  function setMultiItem(view, index, parsed) {
    let draft = st(view).draft;
    !draft || draft.mode !== "multi" || (draft.items = draft.items.map((item, i) => i === index ? parsed : item), view.renderBody());
  }
  async function writeVolumes(view, n, request, onConfirmed = null) {
    let task = taskContext(view), id = view.projectId;
    if ((st(view).draft && st(view).draft.projectId === id ? st(view).draft : parkedDrafts.get(id)) && !await confirmDialog({
      title: "覆盖草稿",
      body: "草稿区还有未处理的 AI 结果，开始写作后会被新草稿替换。",
      okLabel: "开始写作",
      danger: !0
    }))
      return;
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    onConfirmed && onConfirmed();
    let project = view.project(), material = await generationMaterial(view);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    let { talk, refs: wb } = material;
    if (!project.setting.text.trim() && !talk.trim() && !wb.length)
      throw new Error("没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。");
    let base = project.outline.volumes.length + 1;
    if (n <= 1) {
      let reply2 = await runTask(
        view,
        "outline",
        () => ask(view, "outline", volumeRequest({ project, talk, wb, material, no: base, k: 1, n: 1, request }))
      );
      reply2 && setDraft(view, "volume", reply2, { task, scope: material.scope });
      return;
    }
    let controller = new AbortController(), draft = {
      mode: "multi",
      items: [],
      n,
      volumeNo: base,
      request,
      projectId: project.id,
      task,
      scope: material.scope,
      clue: isClueMode(project)
    };
    st(view).draft = draft, st(view).multi = { k: 1, n, controller, projectId: project.id };
    try {
      await runTask(view, "outline", async () => {
        for (let k = 1; k <= n; k += 1) {
          if (isClueMode(project) && !taskStillValid(view, task)) {
            staleTaskNotice(view, task);
            break;
          }
          st(view).multi.k = k, view.renderBody();
          let reply2;
          try {
            reply2 = await ask(
              view,
              "outline",
              volumeRequest({
                project,
                talk,
                wb,
                material,
                extra: draft.items.flatMap((item) => item.volumes || []),
                no: base + k - 1,
                k,
                n,
                request
              }),
              { signal: controller.signal }
            );
          } catch (error) {
            controller.signal.aborted || toast("error", `第 ${k} 卷写作失败：${error.message}。已写好的 ${draft.items.length} 卷保留在草稿里。`);
            break;
          }
          if (controller.signal.aborted) break;
          if (isClueMode(project) && !taskStillValid(view, task)) {
            staleTaskNotice(view, task);
            break;
          }
          draft.items = [...draft.items, parseOutlineReply(reply2, void 0, { all: !0 })];
        }
      });
    } finally {
      st(view).multi = null, draft.items.length || (st(view).draft === draft && (st(view).draft = null), parkedDrafts.get(project.id) === draft && parkedDrafts.delete(project.id)), view.renderBody();
    }
  }
  var actions = {
    ...genActions,
    ...importActions,
    ...lrActions,
    "node-kind"(view, target) {
      st(view).nodeKind = target.dataset.kind, view.renderBody();
    },
    sel(view, target) {
      st(view).sel = target.dataset.id, st(view).raw = !1, view.renderBody();
    },
    "vol-add"(view) {
      let project = view.project(), volume = {
        id: makeId("v"),
        key: `剧情_卷${project.outline.volumes.length + 1}_新卷`,
        stages: [{ id: makeId("s"), key: "阶段一_新阶段", data: { 时间范围: "", AI指令: "", 主线节点: [] } }]
      };
      update2(view, (volumes) => [...volumes, volume]), st(view).sel = volume.id, view.renderBody();
    },
    "vol-up"(view) {
      update2(
        view,
        (volumes) => moveUp(
          volumes,
          volumes.findIndex((volume) => volume.id === st(view).sel)
        )
      ), view.runtime.refresh(), view.renderBody();
    },
    "vol-down"(view) {
      update2(
        view,
        (volumes) => moveItem(
          volumes,
          volumes.findIndex((volume) => volume.id === st(view).sel),
          1
        )
      ), view.runtime.refresh(), view.renderBody();
    },
    async "vol-menu"(view) {
      let pick = await menuDialog({
        title: "卷",
        items: [
          { label: "上移", value: "vol-up" },
          { label: "下移", value: "vol-down" },
          { label: "导出本卷", value: "vol-export" },
          { label: "删除卷", value: "vol-del", danger: !0 }
        ]
      });
      pick && await actions[pick](view);
    },
    "vol-export"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      volume && downloadBlob(`${volume.key}.yaml`, volumeToText(volume), "text/yaml");
    },
    async "vol-del"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      !volume || !await confirmDialog({
        title: `删除「${volumeLabel(volume.key)}」`,
        body: `连同 ${volume.stages.length} 个阶段一起删除，不能撤销。想留一份的话先点「导出」。`,
        okLabel: "删除",
        danger: !0
      }) || (update2(view, (volumes) => volumes.filter((item) => item.id !== volume.id), "删除卷"), st(view).sel = "", view.runtime.refresh(), view.renderBody());
    },
    "stage-add"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) return;
      let stage = { id: makeId("s"), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: "", AI指令: "", 主线节点: [] } };
      updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, stage] })), st(view).sel = stage.id, view.renderBody();
    },
    "stage-up"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      stage && (updateVolume(view, volume.id, (item) => ({ ...item, stages: moveUp(item.stages, item.stages.indexOf(stage)) })), view.runtime.refresh(), view.renderBody());
    },
    "stage-down"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      stage && (updateVolume(view, volume.id, (item) => ({
        ...item,
        stages: moveItem(
          item.stages,
          item.stages.findIndex((entry) => entry.id === stage.id),
          1
        )
      })), view.runtime.refresh(), view.renderBody());
    },
    async "stage-menu"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      if (!stage) return;
      let last = volume.stages[volume.stages.length - 1] === stage, pick = await menuDialog({
        title: stageLabel(stage.key),
        items: [
          { label: "细化节点", value: "stage-refine" },
          { label: "拆成两段", value: "stage-split" },
          ...last ? [] : [{ label: "与下一段合并", value: "stage-merge" }],
          { label: "上移", value: "stage-up" },
          { label: "下移", value: "stage-down" },
          { label: "移到…", value: "stage-move" },
          { label: st(view).raw ? "表单编辑" : "YAML 原文", value: "raw" },
          { label: "删除阶段", value: "stage-del", danger: !0 }
        ]
      });
      pick && (STAGE_DRAFT[pick] ? await stageOp(view, pick.slice(6)) : await actions[pick](view));
    },
    async "stage-move"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel), others = view.project().outline.volumes.filter((item) => item.id !== volume.id);
      if (!stage || !others.length) return toast("info", "没有其他卷可移动。");
      let to = await menuDialog({ title: "移到…", items: others.map((item) => ({ label: volumeLabel(item.key), value: item.id })) });
      to && (update2(view, (volumes) => moveStageToVolume(volumes, stage.id, to)), view.runtime.refresh(), view.renderBody());
    },
    async "stage-del"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      !stage || !await confirmDialog({
        title: `删除「${stageLabel(stage.key)}」`,
        body: `连同里面的 ${stageNodes(stage.data).length} 个场景一起删除，删除前会保存到大纲历史。`,
        okLabel: "删除",
        danger: !0
      }) || (updateVolume(
        view,
        volume.id,
        (item) => ({ ...item, stages: item.stages.filter((entry) => entry.id !== stage.id) }),
        "删除阶段"
      ), st(view).sel = volume.id, view.runtime.refresh(), view.renderBody());
    },
    raw(view) {
      st(view).raw = !st(view).raw, view.renderBody();
    },
    // 手动保存：把编辑框里的内容再写一遍、立即落盘，并刷新注入内容（不用等失焦）。
    async "outline-save"(view, target) {
      target.closest(".pi-body")?.querySelectorAll(
        "[data-stage-key],[data-vol-key],[data-stage-field],[data-stage-list],[data-node-field],[data-stage-yaml],[data-node-yaml]"
      ).forEach((box) => {
        onInput(view, box), onBlur(view, box);
      }), view.runtime.refresh();
      try {
        await view.data.flush(), toast("success", "大纲已保存，注入内容已刷新。");
      } catch (error) {
        toast("error", `保存失败：${error.message}`);
      }
    },
    "raw-apply"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), box = target.closest(".pi-card"), status = box.querySelector("[data-raw-status]");
      try {
        let parsed = parseOutlineText(box.querySelector("[data-raw]").value), next = parsed[0] && parsed[0].stages[0];
        if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error("原文里只能有一个阶段");
        updateStage(view, stage.id, (item) => ({ ...item, key: next.key, data: next.data }), "YAML 原文应用"), view.runtime.refresh(), st(view).raw = !1, view.renderBody();
      } catch (error) {
        status.innerHTML = errHtml(error, 0, "span"), status.classList.add("is-err");
      }
    },
    "node-add"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field2 = target.dataset.field;
      updateStage(view, stage.id, (item) => ({
        ...item,
        data: {
          ...item.data,
          [field2]: [...Array.isArray(item.data[field2]) ? item.data[field2] : [], { ...NEW_NODE[target.dataset.kind] }]
        }
      })), view.renderBody();
    },
    "node-up"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field2 = target.dataset.field, index = Number(target.dataset.i);
      if (index <= 0) return;
      let before = liveProgress(view);
      updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field2]: moveUp(item.data[field2], index) } })), remapProgress(view, before, stage.id, field2, swapIndex(index - 1, index)), view.runtime.refresh(), view.renderBody();
    },
    "node-down"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field2 = target.dataset.field, index = Number(target.dataset.i);
      if (index >= (stage.data[field2] || []).length - 1) return;
      let before = liveProgress(view);
      updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field2]: moveItem(item.data[field2], index, 1) } })), remapProgress(view, before, stage.id, field2, swapIndex(index, index + 1)), view.runtime.refresh(), view.renderBody();
    },
    async "node-menu"(view, target) {
      let index = Number(target.dataset.i), pick = await menuDialog({
        title: `${target.dataset.field} ${index + 1}`,
        items: [
          { label: "上移", value: "node-up", disabled: index <= 0 },
          { label: "下移", value: "node-down", disabled: !!target.dataset.last },
          { label: "删除", value: "node-del", danger: !0 }
        ]
      });
      pick && await actions[pick](view, target);
    },
    async "node-del"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field2 = target.dataset.field, index = Number(target.dataset.i), node = stage.data[field2][index];
      if (!await confirmDialog({
        title: `删除「${node && (node.名称 || node.类型) || "节点"}」`,
        body: "删除场景后会重新对齐进度。",
        okLabel: "删除",
        danger: !0
      }))
        return;
      let before = liveProgress(view);
      updateStage(view, stage.id, (item) => {
        let list = item.data[field2].filter((_, i) => i !== index), data = { ...item.data, [field2]: list };
        return !list.length && field2 !== "主线节点" && delete data[field2], { ...item, data };
      }), remapProgress(view, before, stage.id, field2, (i) => i === index ? null : i > index ? i - 1 : i), view.runtime.refresh(), view.renderBody();
    },
    async "outline-menu"(view) {
      let pick = await menuDialog({
        title: "大纲",
        items: [
          { label: "导入YAML", value: "import-file" },
          { label: "粘贴", value: "import-paste" },
          { label: "从世界书", value: "import-wb" },
          { label: "导出", value: "export", disabled: !view.project().outline.volumes.length }
        ]
      });
      pick && await actions[pick](view);
    },
    async "import-file"(view) {
      let files = await pickFiles({ accept: ".yaml,.yml,.txt", multiple: !0 });
      files.length && await importTexts(
        view,
        await Promise.all(
          files.sort((a, b) => a.name.localeCompare(b.name, "zh")).map(async (file) => ({ name: file.name, text: await file.text() }))
        )
      );
    },
    async "import-paste"(view) {
      let text2 = await promptDialog({
        title: "粘贴剧情 YAML",
        multiline: !0,
        placeholder: `剧情_卷一_标题:
  阶段一_标题:
    时间范围: …`
      });
      text2 && await importTexts(view, [{ name: "粘贴内容", text: text2 }]);
    },
    async "import-wb"(view) {
      let picked = await pickWorldbookEntries("从世界书导入大纲或设定");
      if (!picked.length) return;
      let projectId = view.projectId, { outline, setting } = classifyEntries(picked), chosen = await settingPiecesFromEntries(setting);
      if (chosen === null || view.projectId !== projectId) return;
      let authorCount = chosen.authorCount;
      outline.length && addVolumes(
        view,
        outline.flatMap((item) => item.volumes)
      ), chosen.pieces.length && view.data.updateProject(projectId, (project) => {
        let text2 = [project.setting.text, ...chosen.pieces].filter(Boolean).join(`

`);
        return { ...project, setting: { ...project.setting, text: text2 } };
      }), toast(
        "success",
        `${outline.length} 条进大纲，${setting.length - authorCount} 条进公开设定，${authorCount} 条作为仅作者资料（不注入）。`
      ), view.runtime.refresh(), view.renderBody(), await afterImport(picked, { authorCount });
    },
    async export(view) {
      let project = view.project(), choice = await choiceDialog({
        title: "导出大纲",
        choices: [
          { label: "取消", value: null },
          { label: "每卷一个文件", value: "each" },
          { label: "合成一个文件", value: "one", primary: !0 }
        ]
      });
      choice === "one" && downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), "text/yaml"), choice === "each" && project.outline.volumes.forEach(
        (volume, i) => downloadBlob(`${String(i + 1).padStart(2, "0")}-${volume.key}.yaml`, volumeToText(volume), "text/yaml")
      );
    },
    async "ai-volume"(view, target, { withTalk = !1 } = {}) {
      if (view.busy.outline) return;
      let picked = await writeDialog(view);
      picked && await writeVolumes(view, picked.n, picked.request, withTalk ? () => setTalkRef(view) : null);
    },
    "multi-stop"(view) {
      let multi = st(view).multi;
      multi && multi.controller.abort();
    },
    async "multi-fix"(view, target) {
      let draft = st(view).draft, i = Number(target.dataset.i), box = target.closest(".pi-vitem")?.querySelector("[data-draft-yaml]"), text2 = box ? box.value : draft.items[i].yaml, reply2 = await runTask(
        view,
        "outline",
        () => ask(view, "outline", fixYamlMessages(text2, draft.items[i].error, isClueMode(view.project()) ? "clue" : "outline"))
      );
      reply2 && setMultiItem(view, i, parseOutlineReply(reply2, void 0, { all: !0 }));
    },
    async "multi-menu"(view, target) {
      let draft = st(view).draft, i = Number(target.dataset.i), item = draft && draft.items[i];
      if (!item) return;
      let busy = view.busy.outline, pick = await menuDialog({
        title: `第 ${draft.volumeNo + i} 卷`,
        items: [
          ...item.ok ? [{ label: "YAML 原文", value: "multi-yaml" }] : [],
          { label: "重写这一卷", value: "multi-redo", disabled: busy },
          ...item.ok ? [] : [
            { label: "修正格式", value: "multi-fix", disabled: busy },
            { label: "重新解析", value: "multi-reparse" }
          ]
        ]
      });
      pick && await actions[pick](view, target);
    },
    async "multi-yaml"(view, target) {
      let item = st(view).draft.items[Number(target.dataset.i)];
      await openDialog({
        title: "YAML 原文",
        html: `<pre class="pi-pre">${esc(item.yaml)}</pre>`,
        actions: [{ label: "关闭", value: !0, primary: !0 }]
      });
    },
    async "multi-drop"(view) {
      await confirmDialog({ title: "丢弃草稿", body: "已写好的卷不会保存。", okLabel: "丢弃", danger: !0 }) && (st(view).draft = null, view.renderBody());
    },
    "multi-reparse"(view, target) {
      let i = Number(target.dataset.i), yaml = target.closest(".pi-vitem").querySelector("[data-draft-yaml]").value;
      setMultiItem(
        view,
        i,
        parseOutlineReply(`\`\`\`yaml
${yaml}
\`\`\``)
      );
    },
    async "multi-redo"(view, target) {
      let draft = st(view).draft, i = Number(target.dataset.i), project = view.project(), material = await generationMaterial(view), { talk, refs: wb } = material, before = draft.items.filter((item, index) => index !== i && item.ok).flatMap((item) => item.volumes), reply2 = await runTask(
        view,
        "outline",
        () => ask(
          view,
          "outline",
          volumeRequest({
            project,
            talk,
            wb,
            material,
            extra: before,
            no: draft.volumeNo + i,
            k: i + 1,
            n: draft.n,
            request: draft.request,
            tableCatalog: isClueMode(project) ? tableCatalogText(currentTables()) : ""
          })
        )
      );
      reply2 && setMultiItem(view, i, parseOutlineReply(reply2, void 0, { all: !0 }));
    },
    "multi-append"(view) {
      let draft = st(view).draft;
      if (!draft || draft.items.some((item) => !item.ok)) return;
      if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
      let volumes = draft.items.flatMap((item) => item.volumes);
      addVolumes(view, volumes, "AI 追加多卷"), st(view).draft = null, view.renderBody();
    },
    // 修格式 / 重新解析沿用草稿原来的身份（15.2-1）：先核对、修正请求返回后再核对，不会把草稿改绑到当前聊天。
    async "draft-fix"(view, target) {
      let draft = st(view).draft;
      if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
      let box = target.closest(".pi-card").querySelector("[data-draft-yaml]"), text2 = box ? box.value : draft.yaml, reply2 = await runTask(
        view,
        "outline",
        () => ask(view, "outline", fixYamlMessages(text2, draft.error, isClueMode(view.project()) ? "clue" : "outline"))
      );
      reply2 && setDraft(view, draft.mode, reply2, {
        fromUnitId: draft.fromUnitId,
        reason: draft.reason,
        stageId: draft.stageId,
        nextId: draft.nextId,
        task: draft.task,
        scope: draft.scope
      });
    },
    "draft-reparse"(view, target) {
      let draft = st(view).draft;
      if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
      let yaml = target.closest(".pi-card").querySelector("[data-draft-yaml]").value;
      setDraft(
        view,
        draft.mode,
        `\`\`\`yaml
${yaml}
\`\`\``,
        {
          fromUnitId: draft.fromUnitId,
          reason: draft.reason,
          stageId: draft.stageId,
          nextId: draft.nextId,
          task: draft.task,
          scope: draft.scope
        }
      );
    },
    "draft-drop"(view) {
      putDraft(view, view.projectId, null), view.renderBody();
    },
    "draft-new"(view) {
      addVolumes(view, st(view).draft.volumes, "AI 新建卷"), putDraft(view, view.projectId, null), view.renderBody(), afterAdopt(view);
    },
    async "draft-replace"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要替换的卷");
      if (!await confirmDialog({
        title: `替换「${volumeLabel(volume.key)}」`,
        body: "该卷原有阶段全部换成 AI 写的内容。",
        okLabel: "替换",
        danger: !0
      }))
        return;
      let incoming = st(view).draft.volumes;
      update2(view, (volumes) => volumes.flatMap((item) => item.id === volume.id ? incoming : [item]), "AI 替换整卷"), st(view).draft = null, st(view).sel = incoming[0].id, view.runtime.refresh(), view.renderBody(), afterAdopt(view);
    },
    "draft-append"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要追加到的卷");
      let stages = st(view).draft.volumes.flatMap((item) => item.stages);
      updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, ...stages] }), "AI 追加阶段"), st(view).draft = null, view.runtime.refresh(), view.renderBody(), afterAdopt(view);
    },
    async "draft-rest"(view) {
      let draft = getDraft(view);
      if (draft && draft.task && !taskStillValid(view, draft.task))
        return toast(
          "warning",
          "这份改写草稿是在另一个聊天里生成的。历史保护要按那个聊天的进度计算，请回到原聊天应用，或丢弃后在这里重新生成。"
        );
      let guard = rewriteGuardNow(view, draft), items = guard ? [...guard.diffs, ...guard.notes] : [];
      if (!await confirmDialog({
        title: "替换剩余阶段",
        body: items.length ? "当前阶段和之后的阶段会换成改写后的内容，之前已经演完的阶段不动。按这个聊天现在的进度检查，这次替换会造成下面这些影响，确认可以接受再替换：" : "当前阶段和之后的阶段会换成改写后的内容，之前已经演完的阶段不动。按这个聊天现在的进度检查，没有发现会让已经发生的事情倒退。",
        list: items,
        okLabel: "替换",
        danger: !0
      }))
        return;
      if (draft && draft.task && !taskStillValid(view, draft.task)) return toast("warning", "确认期间切换了聊天，没有应用。");
      let after = rewriteGuardNow(view, draft), seen = new Set(items), added = after ? [...after.diffs, ...after.notes].filter((x) => !seen.has(x)) : [];
      if (added.length && !await confirmDialog({
        title: "进度在确认期间变了",
        body: "刚才的确认框打开期间，表格又更新了。按现在的进度，这次改写还会造成：",
        list: added,
        okLabel: "仍然替换",
        danger: !0
      }))
        return;
      if (draft && draft.task && !taskStillValid(view, draft.task)) return toast("warning", "确认期间切换了聊天，没有应用。");
      let from = applyRest(view, draft, rewriteGuardNow(view, draft));
      isClueMode(view.project()) || await runTask(view, "outline", () => view.runtime.syncSetting(view.projectId, { from, reason: draft.reason })), putDraft(view, view.projectId, null), afterAdopt(view), view.renderBody();
    },
    // outline v0.1.23：历史版本、检查、总览、单阶段草稿。
    history(view) {
      st(view).history = !st(view).history, st(view).historyAt = void 0, view.renderBody();
    },
    "hist-view"(view, target) {
      st(view).historyAt = Number(target.dataset.i), view.renderBody();
    },
    async "hist-restore"(view, target) {
      let item = view.project().outline.history[Number(target.dataset.i)];
      if (!item || !await confirmDialog({ title: "恢复大纲", body: "当前大纲会先存进历史版本，再换成这一版。" })) return;
      let before = view.project().outline.volumes, progress = liveProgress(view), { volumes, alias } = restoreOutline(item.text, before);
      if (update2(view, () => volumes, "恢复历史版本", { alias }), progress) {
        let units = flattenUnits(volumes), links = outlineLinks(view.project().outline, units), next = renameByPosition(progress, units, links), cur = flattenUnits(before)[currentIndex(flattenUnits(before), progress)]?.id, resolved = cur ? links.resolve(cur) : "", to = resolved && units.some((unit) => unit.id === resolved) ? resolved === cur ? null : resolved : nearestUnitId(before, volumes, cur);
        to && (next = goTo(next, units, to)), next !== progress && view.runtime.setProgress(next);
      }
      st(view).sel = "", view.runtime.refresh(), view.renderBody();
    },
    "check-toggle"(view) {
      st(view).check = !st(view).check, view.renderBody();
    },
    "overview-toggle"(view) {
      st(view).overview = !st(view).overview, view.renderBody();
    },
    "issue-go"(view, target) {
      st(view).sel = target.dataset.id, st(view).raw = !1, st(view).overview = !1, view.renderBody();
    },
    "ov-go"(view, target) {
      st(view).sel = target.dataset.id, st(view).raw = !1, st(view).overview = !1, view.renderBody();
    },
    async "draft-stage"(view) {
      let draft = st(view).draft, project = view.project(), volume = project.outline.volumes.find((item) => item.stages.some((stage) => stage.id === draft.stageId));
      if (!volume) throw new Error("原来的阶段已不存在，改用「丢弃」。");
      if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
      let incoming = draft.volumes.flatMap((item) => item.stages);
      if (!incoming.length) throw new Error("结果里没有阶段。");
      let ids = [draft.stageId, ...draft.nextId ? [draft.nextId] : []], old = volume.stages.filter((stage) => ids.includes(stage.id));
      if (isClueMode(project) && view.runtime.activeId() === view.projectId) {
        let current = view.runtime.clue.compute(), preview = replaceStages(project.outline.volumes, volume.id, ids, incoming), guard = historyGuard(project.outline.volumes, preview.volumes, current.snap, current.prog, project.clue, {
          scope: new Set(compileClue([{ ...volume, stages: old }]).nodes.map((n) => n.uid))
        });
        incoming = restoreHistory([{ ...volume, stages: incoming }], guard).flatMap((v) => v.stages);
      }
      let { volumes, stages, keepId } = replaceStages(project.outline.volumes, volume.id, ids, incoming), progress = liveProgress(view);
      if (update2(view, () => volumes, STAGE_DRAFT[draft.mode], { alias: ids.filter((id) => id !== keepId).map((id) => [id, keepId]) }), progress) {
        let moved = migrateStageThreads(progress, old, stages, keepId);
        view.runtime.setProgress(ids.includes(progress.current) ? goTo(moved, flattenUnits(volumes), keepId) : moved);
      }
      st(view).draft = null, st(view).sel = keepId, view.runtime.refresh(), view.renderBody();
    }
  };
  async function stageOp(view, op) {
    let task = taskContext(view), project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === st(view).sel);
    if (!unit) return;
    let next = op === "merge" ? unit.volume.stages[unit.stageIndex + 1] : null;
    if (op === "merge" && !next) throw new Error("本卷没有下一段可合并。");
    let material = await generationMaterial(view, { task: "rewrite" });
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    let { talk, refs: wb } = material, reply2 = await runTask(
      view,
      "outline",
      () => ask(
        view,
        "outline",
        stageOpMessages({
          setting: project.setting.text,
          talk,
          refs: wb,
          volumes: project.outline.volumes,
          unit,
          next,
          op,
          mode: isClueMode(project) ? "clue" : "outline",
          progress: material.progress
        })
      )
    );
    reply2 && setDraft(view, `stage-${op}`, reply2, { stageId: unit.stage.id, nextId: next ? next.id : "", task, scope: material.scope });
  }
  function renameInTree(target, id, label) {
    let item = target.closest(".pi-body")?.querySelector(`.pi-titem[data-id="${id}"] .pi-pname`);
    item && (item.textContent = label);
  }
  function onInput(view, target) {
    if (target.matches("[data-lr-win]") || target.matches("select[data-lr-field]")) return void lrOnChange(view, target);
    let { stage, volume } = findSel(view.project(), st(view).sel);
    if (target.dataset.aiRequest !== void 0) {
      st(view).request = target.value;
      return;
    }
    if (target.dataset.volKey !== void 0 && volume) {
      let key = target.value.trim();
      key && !view.project().outline.volumes.some((item) => item.key === key && item.id !== volume.id) && (updateVolume(view, volume.id, (item) => ({ ...item, key })), renameInTree(target, volume.id, volumeLabel(key)));
      return;
    }
    if (stage) {
      if (target.dataset.stageKey !== void 0) {
        let key = target.value.trim();
        key && !volume.stages.some((item) => item.key === key && item.id !== stage.id) && (updateStage(view, stage.id, (item) => ({ ...item, key })), renameInTree(target, stage.id, stageLabel(key)));
        return;
      }
      if (target.dataset.stageField) {
        let field2 = target.dataset.stageField;
        updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field2]: target.value } }));
        return;
      }
      if (target.dataset.stageList) {
        let field2 = target.dataset.stageList, lines2 = target.value.split(
          `
`
        ).map((line) => line.trim()).filter(Boolean);
        updateStage(view, stage.id, (item) => {
          let data = { ...item.data, [field2]: lines2 };
          return lines2.length || delete data[field2], { ...item, data };
        });
        return;
      }
      if (target.dataset.nodeField) {
        let field2 = target.dataset.nodeField, index = Number(target.dataset.i), key = target.dataset.k, pending = nameKey(stage.id, field2, index);
        if (["名称", "类型", "内容"].includes(key) && !pendingNames.has(pending)) {
          let node = nodeAt(stage, field2, index);
          node && pendingNames.set(pending, node.name);
        }
        updateStage(view, stage.id, (item) => {
          let list = [...item.data[field2]], prev = list[index] && typeof list[index] == "object" ? list[index] : {};
          if (list[index] = { ...prev, [key]: target.value }, target.dataset.play !== void 0) {
            let value = playValue(key, target.value);
            value === void 0 ? delete list[index][key] : list[index][key] = value;
          }
          return { ...item, data: { ...item.data, [field2]: list } };
        });
      }
    }
  }
  function onBlur(view, target) {
    if (target.matches("[data-lr-field],[data-lr-comment]")) return lrOnChange(view, target);
    if (target.dataset.nodeYaml !== void 0 || target.dataset.stageYaml !== void 0) return applyYamlField(view, target);
    target.dataset.nodeField && ["名称", "类型", "内容"].includes(target.dataset.k) && syncNodeName(view, target.dataset.nodeField, Number(target.dataset.i)), target.matches("[data-stage-key],[data-vol-key],[data-stage-field],[data-stage-list],[data-node-field]") && view.runtime.refresh();
  }
  var pendingNames = /* @__PURE__ */ new Map(), nameKey = (stageId, field2, index) => [stageId, field2, index].join("|");
  function nodeAt(stage, field2, index) {
    return stage ? stageNodes(stage.data).find((item) => item.field === field2 && item.index === index) : null;
  }
  function syncNodeName(view, field2, index) {
    let { stage } = findSel(view.project(), st(view).sel);
    if (!stage) return;
    let key = nameKey(stage.id, field2, index), from = pendingNames.get(key);
    pendingNames.delete(key);
    let node = nodeAt(stage, field2, index);
    if (!node) return;
    from && from !== node.name && view.data.updateProject(view.projectId, (project) => ({
      ...project,
      outline: withRenames(project.outline, [{ stageId: stage.id, field: field2, from, to: node.name }])
    }));
    let progress = liveProgress(view);
    if (!progress) return;
    let next = renameNode(progress, { id: stage.id }, node);
    next !== progress && view.runtime.setProgress(next);
  }
  var refreshOn = [];
  function getDraft(view) {
    return syncDraft(view, st(view)), st(view).draft || null;
  }
  function putDraft(view, projectId, draft) {
    projectId === view.projectId ? st(view).draft = draft ? { ...draft, projectId } : null : draft ? parkedDrafts.set(projectId, { ...draft, projectId }) : parkedDrafts.delete(projectId);
  }
  var CLUE_TEXT_KEYS = ["入口", "场景", "作者备注"], CLUE_YAML_KEYS = ["必需", "开放条件", "提前条件", "完成条件", "发现", "相关事实"];
  function clueNodeFields(meta2, index, value) {
    let yamlOf = (v) => v == null || v === "" ? "" : typeof v == "string" ? v : stringifyYaml(v).trim();
    return `<details class="pi-clue-fields"${CLUE_YAML_KEYS.some((k) => value[k] !== void 0) ? " open" : ""}><summary class="pi-hint">线索字段 · ID ${esc(value.id || "（保存后自动补）")}</summary>
        ${CLUE_TEXT_KEYS.map((key) => `<label class="pi-field"><span>${esc(key)}${key === "作者备注" ? "（不注入）" : key === "入口" ? "（开放后告诉正文可以去做）" : "（成为焦点时注入）"}</span><textarea class="pi-ta" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? "")}</textarea></label>`).join("")}
        ${CLUE_YAML_KEYS.map((key) => `<label class="pi-field"><span>${esc(key)}</span><textarea class="pi-ta is-mono" rows="${key === "发现" ? 3 : 2}" data-node-yaml="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" placeholder="${esc(CLUE_PLACEHOLDER[key] || "")}">${esc(yamlOf(value[key]))}</textarea></label>`).join("")}
        <p class="pi-status" data-node-yaml-status="${index}"></p></details>`;
  }
  var CLUE_PLACEHOLDER = {
    必需: "主线默认必需；可选写 false",
    开放条件: `全部:
  - 事实: F00`,
    提前条件: `任一:
  - 事实: F紧急`,
    完成条件: "事实: FA",
    发现: `- 事实: FA
  内容: 本场景可能获得的发现`,
    相关事实: "[F00]"
  };
  function taskContext(view) {
    let project = view.project(), c = ctx();
    return {
      projectId: view.projectId,
      mode: project && isClueMode(project) ? "clue" : "outline",
      chatId: c && typeof c.getCurrentChatId == "function" ? String(c.getCurrentChatId() ?? "") : "",
      active: view.runtime.activeId() === view.projectId
    };
  }
  function taskStillValid(view, t) {
    if (!t) return !0;
    let now = taskContext(view);
    return now.projectId === t.projectId && now.mode === t.mode && (!t.active || now.active && now.chatId === t.chatId);
  }
  function staleTaskNotice(view, t) {
    toast(
      "warning",
      view.projectId !== t.projectId ? "生成期间切换了项目，结果已丢弃，没有写进当前项目。" : "生成期间切换了推进方式或聊天，结果已丢弃。"
    );
  }
  async function generationMaterial(view, { talkLimit = 12e3, task = "volume" } = {}) {
    let project = view.project(), chat = await view.data.loadChat(view.projectId), full = transcript(chat.summary, chat.messages, 1 / 0), talk = transcript(chat.summary, chat.messages, talkLimit), clue = isClueMode(project), r = chat.refs || {}, writing = await genRefTexts(view, talkLimit);
    talk = writing.talk;
    let refs = await resolveRefs(view, chat, project, { skip: ["setting", "outline", "progress", "floors"] }), extra = [];
    r.outline && project.outline.volumes.length && task === "volume" && extra.push({ title: "当前大纲", text: outlineToText(project.outline.volumes) });
    let progress = "";
    if (r.progress) {
      let c = clue && view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null;
      progress = c ? clueProgressText(c.state, c.snap, c.prog, { problems: c.snap.problems }) : clue ? "" : progressText(view);
    }
    let floorsN = Math.max(0, Number(r.floors) || 0), recent = floorsN ? view.runtime.recentFloors(floorsN).map(
      (f) => `【第 ${f.index} 楼】
${f.text}`
    ).join(`

`) : "", combined = [...extra, ...refs, ...writing.wb].filter(
      (ref, index, list) => list.findIndex((other) => other.title === ref.title && other.text === ref.text) === index
    ), fitted = fitRefs(combined), parts = [];
    talk ? parts.push(`讨论记录（${full.length} 字${full.length > talk.length ? `，只附了最近 ${talk.length} 字` : ""}）`) : parts.push("讨论记录：没有");
    for (let rep of fitted.report)
      parts.push(
        rep.kept === rep.chars ? `${rep.title}（${rep.chars} 字）` : rep.kept ? `${rep.title}（${rep.chars} 字，只附了前 ${rep.kept} 字）` : `${rep.title}（${rep.chars} 字，超出预算未附带）`
      );
    return r.progress && parts.push(
      progress ? clue ? "线索进度（当前聊天）" : "剧情进度" : clue ? "线索进度：本项目不是当前聊天启用的项目，没有附带" : "剧情进度：没有"
    ), task === "rewrite" && parts.push(
      recent ? `最近 ${floorsN} 楼正文` : floorsN ? `最近正文：勾选了 ${floorsN} 楼，但本聊天还没有可附的正文` : "最近正文：讨论区勾选的楼数为 0，没有附带"
    ), task === "rewrite" && r.outline && parts.push("当前大纲：改写只附「需要改写的剩余阶段」，前面已经演过的阶段没有附带"), task === "volume" && floorsN && parts.push(recent ? `最近 ${floorsN} 楼正文` : `最近正文：勾选了 ${floorsN} 楼，但本聊天还没有可附的正文`), task === "volume" && clue && parts.push("已有节点与事实编号索引（固定附带）"), { project, talk, refs: fitted.refs, progress, recent, clue, scope: `本次附带的材料：${parts.join("、")}` };
  }
  function rewriteGuardNow(view, draft) {
    let project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit || !isClueMode(project) || view.runtime.activeId() !== view.projectId) return null;
    let c = view.runtime.clue.compute(), units = flattenUnits(project.outline.volumes), from = units.findIndex((u) => u.id === draft.fromUnitId), restIds = new Set(
      compileClue(units.slice(from).map((u) => ({ ...u.volume, stages: [u.stage] }))).nodes.map((n) => n.uid).filter(Boolean)
    );
    return c ? historyGuard(
      project.outline.volumes,
      replaceRest(project.outline.volumes, unit.stage.id, draft.volumes),
      c.snap,
      c.prog,
      project.clue,
      { scope: restIds }
    ) : null;
  }
  function applyYamlField(view, target) {
    let { stage } = findSel(view.project(), st(view).sel);
    if (!stage) return;
    let text2 = target.value.trim(), key = target.dataset.k || target.dataset.stageYaml, status = target.closest(".pi-card").querySelector(
      target.dataset.stageYaml !== void 0 ? "[data-stage-yaml-status]" : `[data-node-yaml-status="${target.dataset.i}"]`
    ), value;
    try {
      value = text2 === "" ? void 0 : parseYaml(text2);
      let errs = [];
      if (["开放条件", "提前条件", "完成条件", "进入条件", "结束条件"].includes(key) && parseCondition(value, errs), errs.length) throw new Error(errs.join("；"));
      status && (status.textContent = "", status.classList.remove("is-err"));
    } catch (error) {
      status && (status.textContent = `${key}：${error.message}`, status.classList.add("is-err"));
      return;
    }
    let set = (obj) => {
      let out = { ...obj };
      return value === void 0 ? delete out[key] : out[key] = value, out;
    };
    target.dataset.stageYaml !== void 0 ? updateStage(view, stage.id, (item) => ({ ...item, data: set(item.data) })) : updateStage(view, stage.id, (item) => {
      let field2 = target.dataset.nodeYaml, list = [...item.data[field2]], index = Number(target.dataset.i);
      return list[index] = set(isPlainObject(list[index]) ? list[index] : {}), { ...item, data: { ...item.data, [field2]: list } };
    }), view.runtime.clue.invalidate(), view.runtime.refresh();
  }
  function currentTables() {
    let api = acuApi();
    try {
      return api && typeof api.exportTableAsJson == "function" ? cloneTables(api.exportTableAsJson()) : null;
    } catch {
      return null;
    }
  }
  function afterAdopt(view) {
    let p = view.project();
    p && isClueMode(p) && compileClue(p.outline.volumes).lines.length && prepareLabels(view);
  }

  // src/ui/tab-setting.js
  var tab_setting_exports = {};
  __export(tab_setting_exports, {
    actions: () => actions2,
    onBlur: () => onBlur2,
    onChange: () => onChange,
    onInput: () => onInput2,
    onStatus: () => onStatus,
    refreshOn: () => refreshOn2,
    render: () => render2
  });
  var st2 = (view) => {
    let s = view.tabState("setting"), id = view.projectId || "";
    return s.byProject || (s.byProject = {}), s.byProject[id] || (s.byProject[id] = {});
  };
  function diffHtml(a, b) {
    return `<div class="pi-diff">${diffLines(a, b).map((line) => `<div class="${line.op === "+" ? "is-add" : line.op === "-" ? "is-del" : ""}">${esc(line.text) || " "}</div>`).join("")}</div>`;
  }
  function checkBadge(check) {
    return check ? `<span class="pi-badge ${check === "PASS" ? "is-ok" : "is-danger"}">速查 ${esc(check)}</span>` : "";
  }
  function fixesHtml(fixes, where) {
    return fixes.length ? `<p class="pi-hint">补定（替你补齐的项）：</p>${fixes.map(
      (fix, i) => `<div class="pi-fix"><span class="pi-fix-text">· ${esc(fix)}</span>
        <span class="pi-fix-acts"><button type="button" class="pi-btn is-sm" data-act="fix-ok" data-where="${where}" data-i="${i}">确认</button>
        <button type="button" class="pi-btn is-sm" data-act="fix-edit" data-where="${where}" data-i="${i}">修改</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="fix-drop" data-where="${where}" data-i="${i}">丢弃</button></span></div>`
    ).join("")}` : "";
  }
  function draftHtml2(view, project, draft) {
    let oldBlocks = new Map(splitBlocks(project.setting.text).map((block) => [block.key, block])), rows2 = splitBlocks(draft.body).map((block) => {
      let old = oldBlocks.get(block.key), status = old ? old.text === block.text ? '<span class="pi-badge">未变</span>' : '<span class="pi-badge is-warn">改动</span>' : '<span class="pi-badge is-ok">新增</span>', open = st2(view).openBlock === block.key;
      return `<div class="pi-entry"><div class="pi-entry-hd" data-act="draft-block" data-key="${esc(block.key)}">
            <input type="checkbox" data-pick-block="${esc(block.key)}"${draft.keys.includes(block.key) ? " checked" : ""}>
            <span class="pi-etitle">${esc(block.title)}</span>${status}</div>
            ${open ? `<div class="pi-entry-bd">${diffHtml(old ? old.text : "", block.text)}</div>` : ""}</div>`;
    }).join("");
    return `<div class="pi-card"><h3>新稿对比 ${checkBadge(draft.check)}</h3>
        <p class="pi-hint">勾选的分块替换旧稿，新分块追加到末尾。</p>${rows2}
        ${fixesHtml(draft.fixes, "draft")}
        <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-sm is-primary" data-act="draft-all">全部采用</button>
        <button type="button" class="pi-btn is-sm" data-act="draft-pick">采用勾选的分块</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
  }
  function historyHtml2(project, at) {
    let list = project.setting.history;
    if (!list.length) return '<div class="pi-card"><h3>历史版本</h3><p class="pi-hint">还没有历史版本。</p></div>';
    let fmt = (time2) => new Date(time2).toLocaleString(), chosen = list[at];
    return `<div class="pi-card"><h3>历史版本</h3>
        ${list.map(
      (item, i) => `<div class="pi-row"><span class="pi-grow">${esc(fmt(item.at))} · ${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm" data-act="hist-diff" data-i="${i}">对比当前</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">回退到此版</button></div>`
    ).join("")}
        ${chosen ? `<p class="pi-hint">${esc(fmt(chosen.at))} → 当前</p>${diffHtml(chosen.text, project.setting.text)}` : ""}</div>`;
  }
  function render2(view) {
    let project = view.project(), s = st2(view), text2 = project.setting.text, blocks = splitBlocks(text2).filter((block) => block.title !== "开头"), mute2 = new Set(project.setting.mute), muted = blocks.some((block) => mute2.has(block.key)), busy = view.busy.setting, hasOutline = project.outline.volumes.some((volume) => volume.stages.length), chip = (block) => `<span class="pi-chip pi-block-chip${mute2.has(block.key) ? " is-mute" : ""}"><button type="button" data-act="jump" data-key="${esc(block.key)}" title="跳到这一块">${esc(block.title)}</button><button type="button" class="pi-block-eye" data-act="block-mute" data-key="${esc(block.key)}" title="${mute2.has(block.key) ? "已设为不注入，点击恢复注入" : "注入正文，点击设为不注入"}">${mute2.has(block.key) ? ICONS.eyeOff : ICONS.eye}</button><button type="button" class="pi-block-del" data-act="block-del" data-key="${esc(block.key)}" title="删除整个分块">${ICONS.close}</button></span>`;
    return `${s.draft ? draftHtml2(view, project, s.draft) : ""}
        <div class="pi-card"><h3>设定 ${checkBadge(project.setting.check)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-primary is-sm" data-act="setting-save">保存</button></h3>
        <div class="pi-tools is-c4">
            <button type="button" class="pi-btn is-sm is-primary" data-act="from-talk"${busy ? " disabled" : ""}>${busy ? '<span class="pi-spin"></span>整理中' : "AI 整理"}</button>
            <button type="button" class="pi-btn is-sm" data-act="sync-outline"${busy || !hasOutline || !text2.trim() ? " disabled" : ""}>按大纲校对</button>
            <button type="button" class="pi-btn is-sm" data-act="import-wb">从世界书导入</button>
            <button type="button" class="pi-btn is-sm${s.history ? " is-primary" : ""}" data-act="history">历史版本 ${project.setting.history.length}</button>
            <label class="pi-check"><input type="checkbox" data-append${s.append ? " checked" : ""}><span>只追加，不改动已有分块</span></label></div>
        ${genRefsBar(view, "setting")}
        ${blocks.length ? `<div class="pi-toc">${blocks.map(chip).join("")}</div>` : ""}
        <textarea class="pi-ta is-tall" data-setting placeholder="世界观正文。执行时作为常驻条目注入（角色定义后），作者资料可用 &lt;仅作者&gt; 包裹。">${esc(text2)}</textarea>
        <div class="pi-row"><span class="pi-hint pi-grow">≈<span data-tokens>${estimateTokens(text2)}</span> token${muted ? `，注入 ≈${estimateTokens(injectedSetting(project.setting))}` : ""}</span><span class="pi-status" data-save-status></span></div>
        ${fixesHtml(project.setting.fixes, "saved")}</div>
        ${s.history ? historyHtml2(project, s.historyAt) : ""}`;
  }
  function setSetting(view, patch) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, setting: { ...project.setting, ...patch } }));
  }
  function commit(view, text2, extra = {}) {
    let project = view.project(), history = pushHistory(project.setting.history, project.setting.text);
    history = pushHistory(history, text2), setSetting(view, { text: text2, history, ...extra }), view.runtime.refresh();
  }
  function guessBlock(blocks, fix) {
    let chars = new Set(String(fix).replace(/\s/g, "")), best = blocks[0], score = -1;
    for (let block of blocks) {
      let hit = [...new Set(block.text.replace(/\s/g, ""))].filter((ch) => chars.has(ch)).length;
      hit > score && (best = block, score = hit);
    }
    return best && best.key;
  }
  function removeFix(view, where, index) {
    let s = st2(view);
    where === "draft" ? s.draft.fixes = s.draft.fixes.filter((_, i) => i !== index) : setSetting(view, { fixes: view.project().setting.fixes.filter((_, i) => i !== index) }), view.renderBody();
  }
  async function editFix(view, where, index, drop = !1) {
    let s = st2(view), project = view.project(), fixes = where === "draft" ? s.draft.fixes : project.setting.fixes, source = where === "draft" ? s.draft.body : project.setting.text, blocks = splitBlocks(source), pick = `<label class="pi-field"><span>${drop ? "写在哪个分块" : "改哪个分块"}</span><select class="pi-sel" data-f="block">${options(
      blocks.map((block2) => ({ value: block2.key, label: block2.title })),
      guessBlock(blocks, fixes[index])
    )}</select></label>`, readKey = (box) => box.querySelector("[data-f=block]").value, result = await openDialog({
      title: drop ? "丢弃补定" : "修改补定",
      html: `<p class="pi-hint">${esc(fixes[index])}</p>${blocks.length ? pick : ""}
            ${drop ? "" : '<label class="pi-field"><span>怎么改</span><textarea class="pi-ta" data-f="text"></textarea></label>'}`,
      actions: drop ? [
        { label: "取消", value: null },
        { label: "只从列表移除", value: { listOnly: !0 } },
        {
          label: "让 AI 从正文删掉",
          primary: !0,
          danger: !0,
          value: (box) => blocks.length ? { key: readKey(box), drop: !0 } : { listOnly: !0 }
        }
      ] : [
        { label: "取消", value: null },
        {
          label: "让 AI 重写该分块",
          primary: !0,
          value: (box) => ({ key: readKey(box), text: box.querySelector("[data-f=text]").value.trim() })
        }
      ]
    });
    if (!result) return;
    if (result.listOnly) return removeFix(view, where, index);
    if (!result.drop && !result.text) return;
    let block = blocks.find((item) => item.key === result.key), note = result.drop ? `${fixes[index]}
改为：删除这一条，正文里不再保留它的内容，其余不变。` : `${fixes[index]}
改为：${result.text}`, reply2 = await runTask(
      view,
      "setting",
      () => ask(view, "outline", rewriteBlockMessages({ guide: guideText(view), current: source, blockText: block.text, fixes: note }))
    );
    if (!reply2) return;
    let body = parseSettingReply(reply2).body, parts = splitBlocks(body), rewritten;
    if (block.author) rewritten = { text: body.trim() ? wrapAuthorText(body) : "" };
    else {
      let tail = parts.slice(1).findIndex((b) => !b.author && !b.cont);
      rewritten = parts[0] && { text: joinBlocks(parts.slice(0, tail < 0 ? parts.length : tail + 1)) };
    }
    if (!rewritten) throw new Error("AI 没有返回分块内容");
    let merged = joinBlocks(
      blocks.map((item) => item.key === block.key ? { ...item, text: rewritten.text } : item).filter((item) => item.text.trim())
    ), rest = fixes.filter((_, i) => i !== index);
    if (where === "draft") {
      let was = new Set(s.draft.keys), keptText = new Set(blocks.filter((b) => was.has(b.key)).map((b) => b.text)), fresh = new Set(splitBlocks(rewritten.text).map((b) => b.text)), keys = splitBlocks(merged).filter((b) => keptText.has(b.text) || was.has(block.key) && fresh.has(b.text)).map((b) => b.key);
      s.draft = { ...s.draft, body: merged, fixes: rest, keys };
    } else commit(view, merged, { fixes: rest });
    view.renderBody();
  }
  var actions2 = {
    ...genActions,
    async "from-talk"(view) {
      let projectId = view.projectId, project = view.project(), { talk, wb } = await genRefTexts(view);
      if (view.projectId !== projectId) return;
      if (!talk.trim() && !wb.length) throw new Error("没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。");
      let append = !!(st2(view).append && project.setting.text.trim()), reply2 = await runTask(
        view,
        "setting",
        () => ask(view, "outline", settingMessages({ guide: guideText(view), talk, current: project.setting.text, append, refs: wb }))
      );
      if (!reply2) return;
      let parsed = parseSettingReply(reply2);
      if (!parsed.body) throw new Error("AI 回复里没有世界观正文");
      let body = append ? `${project.setting.text.trim()}

${parsed.body}` : parsed.body;
      st2(view).draft = { ...parsed, body, keys: splitBlocks(body).map((block) => block.key) }, view.renderBody();
    },
    // 对照当前及之后的大纲找出冲突或写死的句子，结果进新稿对比，只勾选有改动的分块。
    async "sync-outline"(view) {
      let project = view.project(), units = flattenUnits(project.outline.volumes), from = view.runtime.activeId() === view.projectId ? Math.max(0, currentIndex(units, view.runtime.progress())) : 0, reply2 = await runTask(
        view,
        "setting",
        () => ask(
          view,
          "outline",
          syncSettingMessages({ guide: guideText(view), setting: project.setting.text, units, fromUnitIndex: from })
        )
      );
      if (!reply2) return;
      let parsed = parseSettingReply(reply2), keys = parsed.body ? changedBlockKeys(project.setting.text, parsed.body) : [];
      if (!keys.length) {
        toast("info", "设定与大纲没有冲突，不需要修改。");
        return;
      }
      st2(view).draft = { body: mergeBlocks(project.setting.text, parsed.body, keys), check: parsed.check, fixes: [], keys, sync: !0 }, view.renderBody();
    },
    // 手动保存：把编辑框内容再写一遍、记进历史、立即落盘，并刷新注入内容（不用等失焦）。
    async "setting-save"(view, target) {
      let box = target.closest(".pi-card")?.querySelector("[data-setting]");
      box && (onInput2(view, box), onBlur2(view, box)), view.runtime.refresh();
      try {
        await view.data.flush(), toast("success", "设定已保存，注入内容已刷新。");
      } catch (error) {
        toast("error", `保存失败：${error.message}`);
      }
    },
    "block-mute"(view, target) {
      let key = target.dataset.key, mute2 = new Set(view.project().setting.mute);
      mute2.has(key) ? mute2.delete(key) : mute2.add(key), setSetting(view, { mute: [...mute2] }), view.runtime.refresh(), view.renderBody();
    },
    "draft-block"(view, target, event) {
      event.target.closest("input,label") || (st2(view).openBlock = st2(view).openBlock === target.dataset.key ? "" : target.dataset.key, view.renderBody());
    },
    "draft-drop"(view) {
      st2(view).draft = null, view.renderBody();
    },
    "draft-all"(view) {
      let draft = st2(view).draft;
      commit(view, draft.body, { check: draft.check, ...draft.sync ? {} : { fixes: draft.fixes } }), st2(view).draft = null, view.renderBody();
    },
    "draft-pick"(view) {
      let draft = st2(view).draft;
      if (!draft.keys.length) throw new Error("没有勾选分块");
      commit(view, mergeBlocks(view.project().setting.text, draft.body, draft.keys), {
        check: draft.check,
        ...draft.sync ? {} : { fixes: draft.fixes }
      }), st2(view).draft = null, view.renderBody();
    },
    "fix-ok"(view, target) {
      let index = Number(target.dataset.i);
      target.dataset.where === "draft" ? st2(view).draft.fixes = st2(view).draft.fixes.filter((_, i) => i !== index) : setSetting(view, { fixes: view.project().setting.fixes.filter((_, i) => i !== index) }), view.renderBody();
    },
    "fix-edit": (view, target) => editFix(view, target.dataset.where, Number(target.dataset.i)),
    "fix-drop": (view, target) => editFix(view, target.dataset.where, Number(target.dataset.i), !0),
    async "import-wb"(view) {
      let picked = await pickWorldbookEntries("从世界书导入设定");
      if (!picked.length) return;
      let projectId = view.projectId, chosen = await settingPiecesFromEntries(picked);
      if (!chosen || view.projectId !== projectId) return;
      let project = view.project();
      commit(
        view,
        [project.setting.text, ...chosen.pieces].filter((item) => item.trim()).join(`

`)
      ), toast("success", `${picked.length - chosen.authorCount} 条进公开设定，${chosen.authorCount} 条作为仅作者资料（不注入）。`), view.renderBody(), await afterImport(picked, { authorCount: chosen.authorCount });
    },
    history(view) {
      st2(view).history = !st2(view).history, st2(view).historyAt = void 0, view.renderBody();
    },
    "hist-diff"(view, target) {
      st2(view).historyAt = Number(target.dataset.i), view.renderBody();
    },
    async "hist-restore"(view, target) {
      let item = view.project().setting.history[Number(target.dataset.i)];
      !item || !await confirmDialog({ title: "回退设定", body: "当前正文会先存进历史，再换成这一版。" }) || (commit(view, item.text), view.renderBody());
    },
    // 删掉整个分块（标题和内容一起），删前的版本留在历史版本里，可回退。
    async "block-del"(view, target) {
      let text2 = view.project().setting.text, blocks = splitBlocks(text2), block = blocks.find((item) => item.key === target.dataset.key);
      block && await confirmDialog({
        title: `删除分块「${block.title}」`,
        body: "删除前的版本保存在历史版本里，可以回退。",
        okLabel: "删除",
        danger: !0
      }) && (commit(view, joinBlocks(blocks.filter((item) => item.key !== block.key))), view.renderBody());
    },
    jump(view, target) {
      let box = target.closest(".pi-card").querySelector("[data-setting]"), block = splitBlocks(box.value).find((item) => item.key === target.dataset.key);
      if (!block) return;
      let at = box.value.indexOf(block.text);
      box.focus(), box.setSelectionRange(at, at);
      let line = box.value.slice(0, at).split(`
`).length - 1;
      box.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(box).lineHeight || "20") - 8);
    }
  };
  function onInput2(view, target) {
    if (target.dataset.setting !== void 0) {
      setSetting(view, { text: target.value });
      let tokens = target.closest(".pi-card").querySelector("[data-tokens]");
      tokens && (tokens.textContent = String(estimateTokens(target.value)));
    }
  }
  function onChange(view, target) {
    if (target.dataset.append !== void 0 && (st2(view).append = target.checked), target.dataset.pickBlock !== void 0) {
      let draft = st2(view).draft, keys = new Set(draft.keys);
      target.checked ? keys.add(target.dataset.pickBlock) : keys.delete(target.dataset.pickBlock), draft.keys = [...keys];
    }
  }
  function onBlur2(view, target) {
    if (target.dataset.setting === void 0) return;
    let project = view.project();
    project.setting.history[0] && project.setting.history[0].text === project.setting.text || (setSetting(view, { history: pushHistory(project.setting.history, project.setting.text) }), view.runtime.refresh());
  }
  function onStatus(view, root) {
    let status = root.querySelector("[data-save-status]");
    if (!status) return;
    let failed = view.data.failedFiles().length;
    status.textContent = failed ? "保存失败，内容仍在内存里" : "已保存", status.classList.toggle("is-err", !!failed);
  }
  var refreshOn2 = [];

  // src/ui/tab-discuss.js
  var st3 = (view) => view.tabState("discuss");
  function render3(view) {
    let chat = view.data.chat(view.projectId);
    if (!chat)
      return view.data.loadChat(view.projectId).then(() => view.renderBody()).catch((error) => toast("error", `读取讨论记录失败：${error.message}`)), '<div class="pi-empty"><span class="pi-spin"></span> 正在读取讨论记录…</div>';
    let busy = view.busy[`discuss:${view.projectId}`], refs = chat.refs, folded = chat.messages.filter((msg) => msg.folded).length, live = chat.messages.filter((msg) => !msg.folded), lastAi = [...live].reverse().find((msg) => msg.role !== "user"), unanswered = live.length && live[live.length - 1].role === "user" ? live[live.length - 1] : null, wb = wbSummary(view, chat.refs, () => view.renderBody()), canProgress = !!progressText(view), persona = view.data.settings().persona.trim(), chips = `<div class="pi-refs"><button type="button" class="pi-chip${persona ? " is-on" : ""}" data-act="persona" title="${esc(persona || "指定 AI 讨论时的说话人格")}">人格${persona ? "" : "：未设置"}</button>
        <span class="pi-hint">附带参考：</span>
        <button type="button" class="pi-chip${refs.setting ? " is-on" : ""}" data-act="ref" data-ref="setting">设定</button>
        <button type="button" class="pi-chip${refs.outline ? " is-on" : ""}" data-act="ref" data-ref="outline">大纲</button>
        <button type="button" class="pi-chip${refs.progress && canProgress ? " is-on" : ""}" data-act="ref" data-ref="progress"${canProgress ? "" : ' disabled title="本项目不是当前聊天启用的项目"'}>剧情进度</button>
        <button type="button" class="pi-chip${refs.floors ? " is-on" : ""}" data-act="ref-floors">正文 ${refs.floors} 楼</button>
        <button type="button" class="pi-chip${wb && wb.count ? " is-on" : ""}" data-act="ref-wb">世界书 ${wb ? `${wb.count} 条` : "…"}</button>
        <button type="button" class="pi-chip${st3(view).edit ? " is-on" : ""}" data-act="edit-mode" title="开启后，你说想怎么改大纲，AI 会在回复末尾附上一份改动提案；回复下面出现「审阅并应用」按钮，勾选后插进大纲。目前只支持加新节点和同一阶段里调整顺序。只是聊天时关掉就行。">改大纲</button></div>
        ${st3(view).edit ? '<p class="pi-hint pi-edit-tip">「改大纲」已开启：说出你想怎么改，AI 会附上可以勾选插入大纲的提案。目前只能加新节点、调整同一阶段里的顺序；修改、删除请到大纲页手动改。</p>' : ""}`, messages = live.map((msg) => {
      let isUser = msg.role === "user", tools = `<div class="pi-msg-tools">
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-edit" data-id="${esc(msg.id)}">编辑</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-del" data-id="${esc(msg.id)}">删除</button>
            ${msg === lastAi && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="regen">重新生成</button>' : ""}
            ${msg === unanswered && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="resend">重新发送</button>' : ""}
            ${isUser ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="to-setting">整理成设定</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="to-outline">据此写大纲</button>
            ${hasOutlineProposal(msg.content) ? `<button type="button" class="pi-btn is-sm is-primary" data-act="proposal-apply" data-id="${esc(msg.id)}">审阅并应用…</button>` : hasYamlBlock(msg.content) ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="use-yaml" data-id="${esc(msg.id)}">把 YAML 送到大纲</button>` : ""}`}</div>`;
      return `<div class="pi-msg ${isUser ? "is-user" : "is-ai"}"><div class="pi-md">${renderMarkdown(msg.content)}</div>${tools}</div>`;
    }).join(""), empty = chat.messages.length ? "" : '<div class="pi-empty">说说你想写的剧情或设定，一句话也行。<br>AI 会帮你把世界观、人物和剧情走向想清楚；想好了，可以在 AI 的回复下面点「据此写大纲」。</div>';
    return `${chips}<div class="pi-chat">
        ${folded ? `<button type="button" class="pi-msg-fold" data-act="summary">更早的 ${folded} 条已折成摘要 · 查看</button>` : ""}
        ${empty}${messages}${busy ? '<div class="pi-msg is-ai"><span class="pi-spin"></span></div>' : ""}</div>
        <div class="pi-compose">${chat.messages.length ? `<button type="button" class="pi-compose-side" data-act="clear-talk" title="清空讨论">${ICONS.trash}</button>` : ""}<textarea class="pi-ta" data-compose placeholder="Ctrl+Enter 发送">${esc(st3(view).draft || "")}</textarea>
        ${busy ? `<button type="button" class="pi-send" data-act="stop" title="停止回复">${ICONS.close}</button>` : `<button type="button" class="pi-send" data-act="send" title="发送（Ctrl+Enter）">${ICONS.send}</button>`}</div>`;
  }
  var controllers = /* @__PURE__ */ new Map();
  async function reply(view) {
    let projectId = view.projectId, key = `discuss:${projectId}`;
    if (view.busy[key]) return;
    let controller = new AbortController();
    controllers.set(projectId, controller);
    let { signal } = controller;
    view.setBusy(key, !0);
    try {
      let chat = await view.data.loadChat(projectId), project = await view.data.loadProject(projectId);
      if (needsFold(chat.messages)) {
        let fold = foldCandidates(chat.messages), summary = await ask(view, "discuss", foldMessages(chat.summary, fold), { signal }), ids = new Set(fold.map((msg) => msg.id));
        chat = {
          ...view.data.chat(projectId),
          summary,
          messages: view.data.chat(projectId).messages.map((msg) => ids.has(msg.id) ? { ...msg, folded: !0 } : msg)
        }, view.data.saveChat(projectId, chat);
      }
      let edit = st3(view).edit ? { clue: isClueMode(project), map: outlineMapText(project.outline.volumes, { focusStageId: st3(view).editStage || "" }) } : null, system = discussSystemPrompt({
        edit,
        guide: guideInfo(view),
        refs: await resolveRefs(view, chat, project),
        persona: view.data.settings().persona
      }), text2 = await ask(view, "discuss", chatRequest(system, chat.summary, chat.messages), { signal });
      if (signal.aborted) return;
      let latest2 = view.data.chat(projectId);
      view.data.saveChat(projectId, {
        ...latest2,
        messages: [
          ...latest2.messages,
          {
            id: makeId("m"),
            role: "assistant",
            content: text2,
            at: Date.now(),
            ...hasOutlineProposal(text2) ? { outlineAt: outlineStamp(project.outline.volumes) } : {}
          }
        ]
      });
    } catch (error) {
      signal.aborted || toast("error", `讨论请求失败：${error.message}`);
    } finally {
      controllers.get(projectId) === controller && controllers.delete(projectId), view.setBusy(key, !1);
    }
  }
  function updateChat(view, fn) {
    let chat = view.data.chat(view.projectId);
    view.data.saveChat(view.projectId, fn(chat));
  }
  function talkMarkdown(view, chat) {
    let lines2 = [`# ${view.project().name} · 讨论记录`, ""];
    chat.summary && lines2.push("## 早期摘要", "", chat.summary, "");
    for (let msg of chat.messages) lines2.push(`## ${msg.role === "user" ? "我" : "AI"}`, "", msg.content, "");
    return lines2.join(`
`);
  }
  var actions3 = {
    // 清空本项目的讨论，设定、大纲和附带参考都保留；可先导出一份。
    async "clear-talk"(view) {
      let chat = view.data.chat(view.projectId);
      if (!chat || !chat.messages.length) return;
      let choice = await choiceDialog({
        title: "清空讨论",
        body: `删除这个项目的全部 ${chat.messages.length} 条讨论消息和摘要。设定、大纲和附带参考不受影响。`,
        choices: [
          { label: "取消", value: null },
          { label: "直接清空", value: "clear", danger: !0 },
          { label: "导出后清空", value: "export", primary: !0 }
        ]
      });
      choice && (choice === "export" && downloadBlob(
        `${view.project().name}-讨论记录-${/* @__PURE__ */ (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`,
        talkMarkdown(view, chat),
        "text/markdown"
      ), view.data.saveChat(view.projectId, { ...chat, summary: "", messages: [] }), st3(view).draft = "", view.renderBody());
    },
    send(view, target) {
      let box = target.closest(".pi-body").querySelector("[data-compose]"), text2 = box.value.trim();
      if (text2)
        return updateChat(view, (chat) => ({
          ...chat,
          messages: [...chat.messages, { id: makeId("m"), role: "user", content: text2, at: Date.now() }]
        })), st3(view).draft = "", box.value = "", view.renderBody(), reply(view);
    },
    stop(view) {
      controllers.get(view.projectId)?.abort();
    },
    // 最后一条用户消息没有回复时，不重复添加，直接再请求一次。
    resend(view) {
      return reply(view);
    },
    regen(view) {
      return updateChat(view, (chat) => {
        let index = chat.messages.map((msg) => msg.role).lastIndexOf("assistant");
        return index < 0 ? chat : { ...chat, messages: chat.messages.filter((_, i) => i !== index) };
      }), view.renderBody(), reply(view);
    },
    async "msg-edit"(view, target) {
      let msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id), text2 = await promptDialog({ title: "编辑消息", value: msg.content, multiline: !0 });
      text2 != null && (updateChat(view, (chat) => ({
        ...chat,
        messages: chat.messages.map((item) => item.id === msg.id ? { ...item, content: text2 } : item)
      })), view.renderBody());
    },
    async "msg-del"(view, target) {
      await confirmDialog({ title: "删除这条消息", okLabel: "删除", danger: !0 }) && (updateChat(view, (chat) => ({ ...chat, messages: chat.messages.filter((item) => item.id !== target.dataset.id) })), view.renderBody());
    },
    async summary(view) {
      let chat = view.data.chat(view.projectId), result = await openDialog({
        title: "讨论摘要",
        html: `<p class="pi-hint">更早的消息只发送这份摘要，原文仍保存在文件里。</p><textarea class="pi-ta is-tall" data-f="summary">${esc(chat.summary)}</textarea>`,
        actions: [
          { label: "展开全部原文", value: "unfold" },
          { label: "取消", value: null },
          { label: "保存摘要", primary: !0, value: (box) => box.querySelector("[data-f=summary]").value }
        ]
      });
      result != null && (result === "unfold" ? updateChat(view, (current) => ({
        ...current,
        summary: "",
        messages: current.messages.map((msg) => ({ ...msg, folded: !1 }))
      })) : updateChat(view, (current) => ({ ...current, summary: result })), view.renderBody());
    },
    // 说话人格对所有项目的讨论生效，存在插件设置里；留空用默认口吻。
    async persona(view) {
      let value = await promptDialog({
        title: "说话人格",
        label: "讨论时 AI 以什么身份、什么风格回复，留空为默认",
        value: view.data.settings().persona,
        multiline: !0,
        placeholder: "例：你是一位熟悉原作的资深编辑，说话直接，敢于否定不合理的设定。"
      });
      value != null && (view.data.updateSettings({ persona: value.trim() }), view.renderBody());
    },
    ref(view, target) {
      let key = target.dataset.ref;
      updateChat(view, (chat) => ({ ...chat, refs: { ...chat.refs, [key]: !chat.refs[key] } })), view.renderBody();
    },
    async "ref-floors"(view) {
      let chat = view.data.chat(view.projectId), value = await promptDialog({ title: "附带最近正文", label: "楼数（0 为不附带，最多 50）", value: String(chat.refs.floors) });
      if (value == null) return;
      let floors = Math.max(0, Math.min(50, Math.round(Number(value) || 0)));
      updateChat(view, (current) => ({ ...current, refs: { ...current.refs, floors } })), view.renderBody();
    },
    async "ref-wb"(view) {
      let result = await pickRefs(view.data.chat(view.projectId).refs);
      if (result) {
        if (result.none) return toast("info", "当前卡没有关联的世界书。");
        updateChat(view, (current) => ({ ...current, refs: { ...current.refs, memo: result.memo, wb: result.wb } })), view.renderBody();
      }
    },
    "to-setting"(view) {
      return view.go("setting"), actions2["from-talk"](view);
    },
    "to-outline"(view) {
      return view.go("outline"), actions["ai-volume"](view, null, { withTalk: !0 });
    },
    "edit-mode"(view) {
      st3(view).edit = !st3(view).edit, view.renderBody();
    },
    // 审阅讨论里的改动提案：逐项列出（定位失败的直接标出），勾选后合成候选大纲、检查，一次写入。
    async "proposal-apply"(view, target) {
      let msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id), project = view.project();
      if (!msg || !project) return;
      let parsed = parseOutlineProposal(msg.content);
      if (parsed.error) return toast("error", parsed.error);
      let clue = isClueMode(project), changedSince = msg.outlineAt && msg.outlineAt !== outlineStamp(project.outline.volumes), all = ((picked2) => applyOutlineProposal(project.outline.volumes, parsed.items, {
        picked: picked2,
        isClue: clue,
        idOf: /* @__PURE__ */ (() => {
          let n = 0;
          return () => `preview${++n}`;
        })()
      }))(null), html = `${changedSince ? '<p class="pi-hint is-warn">这份提案生成之后，大纲又被改过。下面按现在的大纲重新定位；位置不对的会标出来。</p>' : ""}
          <p class="pi-hint">下面是 AI 根据你的话提出的大纲改动，每一行是一处。勾选你同意的，点「应用勾选的改动」写进大纲；不同意的取消勾选就行。</p>
          <p class="pi-hint">这份大纲所有用它的聊天都会用到。已经演过的部分不会被改掉，每个聊天的进度照旧。</p>
          ${parsed.items.map((it) => {
        let ch = all.changes.find((c) => c.i === it.i), err = it.error || all.errors.find((e) => e.startsWith(`第 ${it.i + 1} 项`));
        return `<label class="pi-check"><input type="checkbox" data-pp="${it.i}"${err ? " disabled" : " checked"}><span>${esc(ch ? ch.text : `${it.action}（${it.stageId}）`)}${it.reason ? `<span class="pi-hint">　${esc(it.reason)}</span>` : ""}${err ? `<br><span class="pi-hint is-warn">${esc(err.replace(/^第 \d+ 项：/, ""))}</span>` : ""}</span></label>`;
      }).join("")}`, picked = await openDialog({
        title: "审阅大纲改动",
        html,
        actions: [
          { label: "取消", value: null },
          {
            label: "应用勾选的改动",
            primary: !0,
            value: (root) => [...root.querySelectorAll("[data-pp]")].filter((x) => x.checked).map((x) => Number(x.dataset.pp))
          }
        ]
      });
      if (!picked || !picked.length) return;
      let now = view.project(), result = applyOutlineProposal(now.outline.volumes, parsed.items, { picked, isClue: clue });
      if (!result.ok) return toast("error", `没有写入：${result.errors.join("；") || "没有可应用的改动"}`);
      let issues = [];
      if (clue) {
        let c = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null, { known, claimed } = chatFactSets(c), addedSet = new Set(result.added || []), newOnly = result.volumes.map((v) => ({
          ...v,
          stages: v.stages.map((s) => ({
            ...s,
            data: Object.fromEntries(
              Object.entries(s.data || {}).map(([k, x]) => [
                k,
                NODE_FIELDS.some((f) => f.field === k) && Array.isArray(x) ? x.filter((n) => addedSet.has(nodeUid(n))) : NODE_FIELDS.some((f) => f.field === k) ? [] : x
              ])
            )
          }))
        }));
        issues = [
          ...addedSet.size ? checkClueDraft(newOnly, now.outline.volumes, { isObtained: (id) => known.includes(id) }).filter(
            (x) => /^事实编号 /.test(x)
          ) : [],
          ...checkClueDraft([], [], { applied: result.volumes, obtainedFacts: known, claimedFacts: claimed }).filter(
            (x) => /走不通|判断不了/.test(x)
          )
        ];
      }
      issues.length && !await confirmDialog({
        title: "改动后的大纲有问题",
        body: "按改动后的大纲推演，发现：",
        list: issues,
        okLabel: "仍然应用",
        danger: !0
      }) || (view.data.updateProject(
        view.projectId,
        (p) => p.outline.volumes === now.outline.volumes ? { ...p, outline: { ...p.outline, volumes: result.volumes } } : p
      ) === now ? toast("warning", "写入时大纲又变了，没有应用。请重新打开审阅。") : (view.runtime.refresh && view.runtime.refresh(), toast("success", `已应用 ${result.changes.length} 处改动。`), view.renderBody()));
    },
    "use-yaml"(view, target) {
      let msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id);
      view.go("outline"), showDraft(view, msg.content);
    }
  };
  function onInput3(view, target) {
    target.dataset.compose !== void 0 && (st3(view).draft = target.value);
  }
  function onSubmit(view, target) {
    target.dataset.compose !== void 0 && actions3.send(view, target);
  }
  var refreshOn3 = [];

  // src/ui/tab-persona.js
  var tab_persona_exports = {};
  __export(tab_persona_exports, {
    actions: () => actions4,
    onChange: () => onChange2,
    render: () => render4,
    stageInfo: () => stageInfo
  });

  // src/core/persona-file.js
  var PERSONA_FILE_KIND = "plot-injector-personas";
  function buildPersonaFile(personas2, { project = "", version = "" } = {}) {
    let { lines: lines2 } = normalizePersonas(personas2), clean = lines2.map((line) => ({ ...line, source: null, sources: [] }));
    return { kind: PERSONA_FILE_KIND, version: 1, app: version, project, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), lines: clean };
  }
  function parsePersonaFile(text2, { keepOutline = !1 } = {}) {
    let data;
    try {
      data = JSON.parse(text2);
    } catch {
      throw new Error("文件不是有效的 JSON");
    }
    if (!data || data.kind !== PERSONA_FILE_KIND || !Array.isArray(data.lines)) throw new Error("这不是剧情注入器导出的人设文件");
    let { lines: lines2 } = normalizePersonas({ lines: data.lines });
    if (!lines2.length) throw new Error("文件里没有人设线");
    return { project: String(data.project || ""), lines: lines2.map((line) => reidLine(line, keepOutline)) };
  }
  function reidLine(line, keepOutline) {
    let ids = /* @__PURE__ */ new Map(), stages = line.stages.map((stage) => {
      let id = makeId("ps");
      return ids.set(stage.id, id), { ...stage, id, ...keepOutline ? {} : { unitId: "" } };
    });
    return { ...line, id: makeId("pl"), stages, defaultStage: ids.get(line.defaultStage) || "", source: null, sources: [] };
  }
  function mergePersonaLines(existing, incoming, mode = "both") {
    let out = [...existing], key = (line) => `${line.group}\0${line.name}`, added = 0, replaced = 0, skipped = 0;
    for (let line of incoming) {
      let at = out.findIndex((item) => key(item) === key(line));
      if (at < 0) {
        out.push(line), added++;
        continue;
      }
      if (mode === "skip") {
        skipped++;
        continue;
      }
      if (mode === "replace") {
        out[at] = { ...line, id: out[at].id }, replaced++;
        continue;
      }
      out.push({ ...line, name: `${line.name}（导入）` }), added++;
    }
    return { lines: out, added, replaced, skipped };
  }

  // src/core/persona-import.js
  var TAG = /<if\s+(cell|cond)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>|<\/if\s*>/gi, TERM = /^(?:cell:)?\s*(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$/, hasIf = (content) => /<if\s/i.test(String(content || ""));
  function isNumber(value) {
    return value !== "" && Number.isFinite(Number(value));
  }
  function parseCond(raw) {
    let text2 = String(raw || "").trim();
    if (!text2) return { error: "条件为空" };
    let hasAnd = text2.includes("&"), parts = text2.split(hasAnd ? "&" : /[,，]/).map((item) => item.trim()).filter(Boolean), terms = [];
    for (let part of parts) {
      let match = TERM.exec(part);
      if (!match) return { error: `无法解析条件「${part}」` };
      if (!["==", "<=", ">="].includes(match[2])) return { error: `不支持的比较符「${match[2]}」` };
      terms.push({ path: match[1].trim(), op: match[2], value: match[3].trim() });
    }
    return terms.length ? { vars: new Set(terms.map((term) => term.path)), terms, or: !hasAnd && terms.length > 1 } : { error: "条件为空" };
  }
  function isInline(siblings) {
    let last = siblings[siblings.length - 1];
    return last ? last.type === "if" ? last.inline : last.text.slice(last.text.lastIndexOf(`
`) + 1).trim() !== "" : !1;
  }
  function parseEntry2(content) {
    let source = String(content || ""), root = { children: [] }, stack = [root], issues = [], last = 0, open = 0, push = (node) => stack[stack.length - 1].children.push(node), pushText = (text2) => {
      text2 && push({ type: "text", text: text2 });
    };
    for (let match of source.matchAll(TAG)) {
      if (pushText(source.slice(last, match.index)), last = match.index + match[0].length, match[0][1] === "/") {
        stack.length === 1 ? issues.push({ level: "error", text: "多出一个 </if>，没有对应的开头" }) : stack.pop();
        continue;
      }
      open += 1;
      let cond = match[2] ?? match[3] ?? "", node = { type: "if", cond, raw: match[0], parsed: parseCond(cond), children: [], depth: stack.length - 1, inline: isInline(stack[stack.length - 1].children) };
      push(node), stack.push(node);
    }
    pushText(source.slice(last)), stack.length > 1 && issues.push({ level: "error", text: `有 ${stack.length - 1} 个 <if> 没有写 </if>` });
    let found = (source.match(/<if\b/gi) || []).length;
    return found !== open && issues.push({ level: "error", text: `有 ${found - open} 个 <if> 标签写法无法识别（只支持 cell= 与 cond=）` }), { nodes: root.children, issues };
  }
  function* walkIfs(nodes) {
    for (let node of nodes)
      node.type === "if" && (yield node, yield* walkIfs(node.children));
  }
  var SUFFIX = /(?:状态|数值|信息|追踪|角色)?表$/;
  function pathNames(path) {
    let parts = String(path).split("/").map((item) => item.trim()), column = parts[parts.length - 1] || path;
    if (parts.length < 3) return { group: parts.length === 2 ? parts[0] : "", name: column };
    let table = parts[0].replace(SUFFIX, ""), row2 = parts[1];
    return { group: table && row2.includes(table) ? table : row2, name: column };
  }
  var entryName = (title2) => (String(title2 || "").replace(/<!--[\s\S]*?-->/g, "").split(`
`).map((line) => line.trim()).find(Boolean) || "").replace(/^[^\p{L}\p{N}[]+/u, "").replace(/^\[[^\]]*\]\s*/, "") || "未命名", loose = (value) => String(value).replace(/[\s　，。、；;：:！!？?·・.]/g, "").toLowerCase();
  function scanVars(parsedEntries) {
    let vars = /* @__PURE__ */ new Map(), lostRefs = /* @__PURE__ */ new Map();
    for (let { key, tree } of parsedEntries)
      for (let node of walkIfs(tree.nodes)) {
        if (!node.parsed.vars) continue;
        if (node.parsed.vars.size !== 1) {
          for (let path2 of node.parsed.vars) (lostRefs.get(path2) || lostRefs.set(path2, /* @__PURE__ */ new Set()).get(path2)).add(key);
          continue;
        }
        let [path] = node.parsed.vars;
        vars.has(path) || vars.set(path, { path, ops: /* @__PURE__ */ new Set(), values: [], nested: !1, inline: !1, entries: /* @__PURE__ */ new Set() });
        let info = vars.get(path);
        info.entries.add(key), node.depth > 0 && (info.nested = !0), node.inline && (info.inline = !0);
        for (let term of node.parsed.terms)
          info.ops.add(term.op), term.op === "==" && !info.values.includes(term.value) && info.values.push(term.value);
      }
    for (let [path, keys] of lostRefs) vars.has(path) && (vars.get(path).lost = keys);
    return vars;
  }
  function classifyVar(info, override = "") {
    return info.ops.has("<=") || info.ops.has(">=") ? "num" : info.nested || override === "fixed" ? "fixed" : override === "line" ? "enum" : info.inline ? "fixed" : "enum";
  }
  var trimBlock = (text2) => String(text2).replace(/^[ \t]*\n/, "").replace(/\s+$/, ""), stripComments = (text2) => String(text2).replace(/<!--[\s\S]*?-->/g, "");
  function renderNodes(nodes, ctx2) {
    let out = "";
    for (let node of nodes) {
      if (node.type === "text") {
        out += node.text;
        continue;
      }
      let one = node.parsed.vars && node.parsed.vars.size === 1 ? [...node.parsed.vars][0] : "", fixed = one && ctx2.kinds.get(one) === "fixed", body = () => node.inline ? renderNodes(node.children, ctx2) : trimBlock(renderNodes(node.children, ctx2));
      if (fixed && node.parsed.terms.every((term) => term.op === "==")) {
        let picked = ctx2.picks.get(one);
        (node.parsed.or ? node.parsed.terms.some((term) => term.value === picked) : node.parsed.terms.every((term) => term.value === picked)) && (out += body());
      } else
        ctx2.issue("error", `嵌套了无法拆分的 if「${node.cond.replace(/cell:/g, "")}」`), out += renderNodes(node.children, ctx2);
    }
    return out;
  }
  function rangeOfTerms(terms) {
    let range = {};
    for (let term of terms) {
      let value = Number(term.value);
      if (!Number.isFinite(value)) return null;
      term.op === ">=" ? range.min = range.min === void 0 ? value : Math.max(range.min, value) : term.op === "<=" ? range.max = range.max === void 0 ? value : Math.min(range.max, value) : (range.min = value, range.max = value);
    }
    return range;
  }
  var rangeKey = (range) => `${range.min ?? ""}~${range.max ?? ""}`, rangeName = (range) => range.min === void 0 ? `≤${range.max}` : range.max === void 0 ? `≥${range.min}` : range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`, stateLine = (text2) => {
    let match = /^[ \t]*状态[：:][ \t]*(.+)$/m.exec(String(text2));
    return match ? match[1].trim() : "";
  }, join = (a, b) => [a, b].filter((item) => String(item).trim()).join(`
`);
  function numericStages(entries) {
    let sorted = [...entries].sort((a, b) => (a.range.min ?? -1 / 0) - (b.range.min ?? -1 / 0)), out = [];
    for (let item of sorted) {
      let prev = out[out.length - 1], from = prev && prev.range.max !== void 0 ? prev.range.max + 1 : void 0;
      prev && from !== void 0 && item.range.min !== void 0 && item.range.min > from && out.push({ ...newStage("空档"), name: rangeName({ min: from, max: item.range.min - 1 }), range: { min: from, max: item.range.min - 1 }, text: "" }), out.push({ ...newStage(rangeName(item.range)), range: item.range, text: item.text, cond: "" });
    }
    return out;
  }
  function buildPlan(entries, { overrides = {}, picks = {} } = {}) {
    let parsed = entries.map((entry) => ({ entry, key: `${entry.book}\0${entry.key}`, tree: parseEntry2(entry.content) })), blocked = /* @__PURE__ */ new Set(), issues = [], report = (entry, level, text2) => {
      issues.push({ book: entry.book, key: entry.key, title: entry.title, level, text: text2 }), level === "error" && blocked.add(`${entry.book}\0${entry.key}`);
    };
    for (let item of parsed) for (let issue of item.tree.issues) report(item.entry, issue.level, issue.text);
    let info = scanVars(parsed), kinds = new Map([...info.values()].map((item) => [item.path, classifyVar(item, overrides[item.path])]));
    for (let item of info.values()) {
      let seen = /* @__PURE__ */ new Map();
      for (let value of item.values) {
        let norm2 = loose(value);
        seen.has(norm2) && seen.get(norm2) !== value ? report(entries.find((entry) => item.entries.has(`${entry.book}\0${entry.key}`)) || entries[0], "warn", `变量「${pathNames(item.path).name}」的值写法不一致：「${seen.get(norm2)}」与「${value}」`) : seen.set(norm2, value);
      }
      if (kinds.get(item.path) === "num" && item.values.some((value) => !isNumber(value)))
        for (let entry of entries) item.entries.has(`${entry.book}\0${entry.key}`) && report(entry, "error", `变量「${pathNames(item.path).name}」同时用了数值与文字比较`);
    }
    let pickMap = /* @__PURE__ */ new Map();
    for (let item of info.values())
      kinds.get(item.path) === "fixed" && pickMap.set(item.path, item.values.includes(picks[item.path]) ? picks[item.path] : item.values[0]);
    let lines2 = /* @__PURE__ */ new Map(), lineFor = (path, kind, entry) => {
      if (!lines2.has(path)) {
        let names2 = pathNames(path);
        lines2.set(path, { kind, path, group: names2.group, name: names2.name, entry, common: "", stages: /* @__PURE__ */ new Map(), sources: [] });
      }
      let line = lines2.get(path);
      return line.sources.some((source) => source.book === entry.book && source.uid === entry.uid) || line.sources.push({ book: entry.book, uid: String(entry.uid), key: String(entry.key) }), line;
    }, plainLines = [];
    for (let { entry, key, tree } of parsed) {
      if (blocked.has(key)) continue;
      let entryIssues = [], ctx2 = { kinds, picks: pickMap, issue: (level, text2) => entryIssues.push({ level, text: text2 }) }, outside = [], staged = [];
      for (let node of tree.nodes) {
        let one = node.type === "if" && node.parsed.vars && node.parsed.vars.size === 1 ? [...node.parsed.vars][0] : "";
        if (node.type === "if" && !node.parsed.vars) {
          entryIssues.push({ level: "error", text: `${node.parsed.error}：${node.cond}` });
          continue;
        }
        if (node.type === "if" && node.parsed.vars.size !== 1) {
          entryIssues.push({ level: "error", text: `多个变量组合的条件暂不支持：${node.cond.replace(/cell:/g, "")}` });
          continue;
        }
        node.type === "if" && kinds.get(one) !== "fixed" ? staged.push({ node, path: one, kind: kinds.get(one) }) : outside.push({ at: staged.length, text: node.type === "text" ? node.text : renderNodes([node], ctx2) });
      }
      let tidy = (text2) => stripComments(text2);
      for (let part of staged) part.body = trimBlock(tidy(renderNodes(part.node.children, ctx2)));
      for (let problem of entryIssues) report(entry, problem.level, problem.text);
      if (entryIssues.some((problem) => problem.level === "error")) continue;
      let piece = (at) => outside.filter((item) => item.at === at).map((item) => item.text).join("");
      if (!staged.length) {
        let body = tidy(outside.map((item) => item.text).join("")).trim();
        plainLines.push({ entry, text: body });
        continue;
      }
      let prefix = tidy(piece(0)), suffix = tidy(piece(staged.length)), between = staged.slice(1).map((_, i) => tidy(piece(i + 1))).join(""), tag = /^\s*<([^\s>/]+)>\s*$/.exec(prefix), wrap = !!tag && suffix.trim() === `</${tag[1]}>` && !between.trim(), common = wrap ? "" : [prefix, between, suffix].map((item) => item.trim()).filter(Boolean).join(`
`), first = !0;
      for (let part of staged) {
        let line = lineFor(part.path, part.kind === "num" ? "num" : "enum", entry);
        first && common && (line.common = join(line.common, common), first = !1);
        let body = part.body, text2 = wrap ? `${prefix.trim()}
${body}
${suffix.trim()}` : body;
        if (part.kind === "num") {
          let range = rangeOfTerms(part.node.parsed.terms);
          if (!range) {
            report(entry, "error", `数值条件无法解析：${part.node.cond}`);
            continue;
          }
          let id = rangeKey(range), old = line.stages.get(id);
          line.stages.set(id, { range, text: join(old ? old.text : "", text2) });
        } else
          for (let term of part.node.parsed.terms) {
            if (term.op !== "==") {
              report(entry, "error", `文字变量「${line.name}」用了 ${term.op}`);
              continue;
            }
            let old = line.stages.get(term.value);
            line.stages.set(term.value, { value: term.value, text: join(old ? old.text : "", text2) });
          }
      }
    }
    let out = [];
    for (let line of lines2.values()) {
      if (!line.sources.some((source) => !blocked.has(`${source.book}\0${source.key}`))) continue;
      let base = { group: line.group, name: line.name, keys: line.entry.keys, constant: line.entry.constant, position: line.entry.position, depth: line.entry.depth, role: line.entry.role, order: line.entry.order, common: line.common, defaultStage: "", source: { book: line.entry.book, uid: String(line.entry.uid), varPath: line.path }, sources: line.sources };
      if (line.kind === "num")
        out.push({ ...base, mode: "fame", fame: { source: "fame", dim: "好感", bar: line.name, partner: "" }, stages: numericStages([...line.stages.values()]) });
      else {
        let stages = [...line.stages.values()].map((item) => ({ ...newStage(item.value), cond: stateLine(item.text), text: item.text }));
        out.push({ ...base, mode: "check", fame: { source: "fame", dim: "好感", bar: "", partner: "" }, stages });
      }
    }
    for (let { entry, text: text2 } of plainLines)
      text2 && out.push({ group: "", name: entryName(entry.title), keys: entry.keys, constant: entry.constant, position: entry.position, depth: entry.depth, role: entry.role, order: entry.order, common: "", defaultStage: "", mode: "manual", fame: { source: "fame", dim: "好感", bar: "", partner: "" }, stages: [{ ...newStage("默认"), text: text2 }], source: { book: entry.book, uid: String(entry.uid), varPath: "" }, sources: [{ book: entry.book, uid: String(entry.uid), key: String(entry.key) }] });
    let varList = [...info.values()].map((item) => ({ path: item.path, name: pathNames(item.path).name, group: pathNames(item.path).group, kind: kinds.get(item.path), values: item.values, pick: pickMap.get(item.path), entries: item.entries.size, canFix: !(item.ops.has("<=") || item.ops.has(">=")), canLine: !item.nested }));
    return { lines: out, issues, blocked, vars: varList };
  }
  var lineKeyOf = (source) => `${source.book}\0${source.key ?? source.uid}`;
  function applyPlan(personas2, plan, entries) {
    let ok = entries.filter((entry) => !plan.blocked.has(`${entry.book}\0${entry.key}`)), lines2 = plan.lines.map((line) => ({ id: makeId("pl"), enabled: !0, ...line })), imported = [...personas2.imported.filter((item) => !ok.some((entry) => entry.book === item.book && String(entry.key) === String(item.key))), ...ok.map((entry) => ({ book: entry.book, uid: String(entry.uid), key: String(entry.key), title: entry.title }))];
    return { ...personas2, lines: [...personas2.lines, ...lines2], imported };
  }
  function releaseImported(personas2, item, { removeLines = !1 } = {}) {
    let imported = personas2.imported.filter((entry) => !(entry.book === item.book && String(entry.key) === String(item.key)));
    if (!removeLines) return { ...personas2, imported };
    let gone = lineKeyOf(item), lines2 = personas2.lines.flatMap((line) => {
      let sources = Array.isArray(line.sources) && line.sources.length ? line.sources : line.source ? [{ book: line.source.book, uid: line.source.uid, key: line.source.uid }] : [];
      if (!sources.some((source) => lineKeyOf(source) === gone)) return [line];
      let rest = sources.filter((source) => lineKeyOf(source) !== gone);
      return rest.length ? [{ ...line, sources: rest }] : [];
    });
    return { ...personas2, imported, lines: lines2 };
  }

  // src/ui/persona-import.js
  async function loadCandidates() {
    let names2 = [.../* @__PURE__ */ new Set([...boundBookNames().map((item) => item.name), ...globalBookNames()])], books = [];
    for (let name of names2)
      try {
        let entries = bookEntries(await loadBook(name)).filter((entry) => !entry.disabled && !acuField(entry.title) && hasIf(entry.content)).map((entry) => ({ ...entry, book: name }));
        entries.length && books.push({ name, entries });
      } catch {
      }
    return books;
  }
  var idOf = (entry) => `${entry.book}\0${entry.key}`;
  function listHtml(books, picked) {
    return books.length ? books.map((book) => {
      let all = book.entries.every((entry) => picked.has(idOf(entry)));
      return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${esc(book.name)}<small>${book.entries.length}</small>
            <span class="pi-wb-bulk"><button type="button" class="pi-btn is-sm is-ghost" data-pi-all="${esc(book.name)}">${all ? "取消全选" : "全选"}</button></span></div>
            ${book.entries.map((entry) => `<label class="pi-wb-row"><input type="checkbox" data-pi-pick="${esc(entry.key)}" data-pi-book="${esc(entry.book)}"${picked.has(idOf(entry)) ? " checked" : ""}>
                <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span><span class="pi-meta">≈${estimateTokens(entry.content)}</span></label>`).join("")}</div>`;
    }).join("") : '<p class="pi-hint">当前启用的世界书里没有含 if 条件的手写条目。</p>';
  }
  function varChoices(item) {
    let fix = item.values.map((value) => ({ value: `fix:${value}`, label: `写死为 ${value}` })), line = item.canLine ? [{ value: "line", label: "拆成阶段" }] : [];
    return item.kind === "fixed" ? [...fix, ...line] : [...line, ...fix];
  }
  function previewHtml(plan) {
    let issues = plan.issues.map((issue) => `<p class="pi-hint is-warn">${esc(issue.title)}：${esc(issue.text)}</p>`).join(""), lines2 = plan.lines.map((line) => `<div class="pi-wb-hit"><span class="pi-wb-title">${esc(line.group ? `${line.group} · ` : "")}${esc(line.name)}</span>
        <span class="pi-meta">${line.mode === "fame" ? "读声望" : line.mode === "check" ? "条件检测" : "手动"} · ${line.stages.length} 阶段</span></div>`).join(""), vars = plan.vars.filter((item) => item.kind !== "num").map((item) => `<div class="pi-wb-hit"><span class="pi-wb-title" title="${esc(item.path)}">${esc(item.name)}</span>
        <select class="pi-sel" data-pi-kind="${esc(item.path)}">${options(varChoices(item), item.kind === "fixed" ? `fix:${item.pick}` : "line")}</select></div>`).join("");
    return `${issues}
        <div class="pi-wb-sec-hd">人设线<small>${plan.lines.length}</small></div>${lines2 || '<p class="pi-hint">没有可转入的内容。</p>'}
        ${vars ? `<div class="pi-wb-sec-hd">变量识别（可改判）</div>${vars}` : ""}`;
  }
  async function openImport(view) {
    if (!view.project())
      return toast("info", "先选择一个项目。"), !1;
    let books = [];
    try {
      books = await loadCandidates();
    } catch (error) {
      return toast("error", `读取世界书失败：${error.message}`), !1;
    }
    let all = books.flatMap((book) => book.entries), picked = /* @__PURE__ */ new Set(), overrides = {}, picks = {}, step = "list", chosen = () => all.filter((entry) => picked.has(idOf(entry))), plan = () => buildPlan(chosen(), { overrides, picks }), draw = (box) => {
      let body = box.querySelector("[data-f=body]");
      body.innerHTML = step === "list" ? listHtml(books, picked) : previewHtml(plan()), box.querySelector("[data-f=count]").textContent = step === "list" ? `已选 ${picked.size} 条` : "预览";
      for (let btn of box.querySelectorAll("[data-dlg]"))
        (btn.textContent === "返回选择" || btn.textContent === "转入") && (btn.hidden = step === "list"), btn.textContent === "预览" && (btn.hidden = step !== "list");
    }, result = await openDialog({
      title: "从世界书转入人设",
      html: '<p class="pi-hint is-warn" data-f="count"></p><div data-f="body"></div>',
      onMount: (box) => {
        draw(box), box.addEventListener("change", (event) => {
          let t = event.target;
          if (t.dataset.piPick) {
            let id = `${t.dataset.piBook}\0${t.dataset.piPick}`;
            t.checked ? picked.add(id) : picked.delete(id), draw(box);
          }
          if (t.dataset.piKind) {
            let path = t.dataset.piKind, fix = t.value.startsWith("fix:");
            overrides = { ...overrides, [path]: fix ? "fixed" : "line" }, fix && (picks = { ...picks, [path]: t.value.slice(4) }), draw(box);
          }
        }), box.addEventListener("click", (event) => {
          let t = event.target.closest("[data-pi-all]");
          if (!t) return;
          let book = books.find((item) => item.name === t.dataset.piAll), every = book.entries.every((entry) => picked.has(idOf(entry)));
          for (let entry of book.entries) every ? picked.delete(idOf(entry)) : picked.add(idOf(entry));
          draw(box);
        });
      },
      actions: [
        { label: "取消", value: null },
        { label: "返回选择", value: (box) => {
          step = "list", draw(box);
        } },
        { label: "预览", primary: !0, value: (box) => {
          picked.size ? (step = "preview", draw(box)) : toast("info", "先勾选要转入的条目。");
        } },
        { label: "转入", primary: !0, value: () => ({ entries: chosen(), plan: plan() }) }
      ]
    });
    return result ? commit2(view, result) : !1;
  }
  async function commit2(view, { entries, plan }) {
    let ok = entries.filter((entry) => !plan.blocked.has(idOf(entry)));
    if (!ok.length)
      return toast("warning", "勾选的条目都有错误，没有转入。"), !1;
    view.data.updateProject(view.projectId, (project) => ({ ...project, personas: applyPlan(normalizePersonas(project.personas), plan, entries) }));
    let byBook = /* @__PURE__ */ new Map();
    for (let entry of ok) byBook.set(entry.book, [...byBook.get(entry.book) || [], entry.key]);
    for (let [book, keys] of byBook) await setEntriesDisabled(book, keys, !0);
    return view.runtime.refresh(), toast("success", `已转入 ${plan.lines.length} 条人设线，关闭了 ${ok.length} 个原条目。`), !0;
  }
  async function restoreImported(view, item) {
    let choice = await openDialog({
      title: `恢复「${item.title || item.key}」`,
      html: '<p class="pi-hint">重新开启这个原条目。</p>',
      actions: [{ label: "取消", value: null }, { label: "恢复并删除对应人设线", value: "drop" }, { label: "只恢复", primary: !0, value: "keep" }]
    });
    if (!choice) return !1;
    try {
      await setEntriesDisabled(item.book, [item.key], !1);
    } catch (error) {
      return toast("error", `恢复失败：${error.message}`), !1;
    }
    return view.data.updateProject(view.projectId, (project) => ({ ...project, personas: releaseImported(normalizePersonas(project.personas), item, { removeLines: choice === "drop" }) })), view.runtime.refresh(), !0;
  }

  // src/ui/tab-persona.js
  var st4 = (view) => view.tabState("persona"), modeLabel = (value) => (PERSONA_MODES.find((item) => item.value === value) || PERSONA_MODES[0]).label;
  function personas(view) {
    return view.project().personas;
  }
  function patchPersonas(view, fn) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, personas: fn(project.personas) })), view.runtime.refresh();
  }
  function patchLine(view, lineId, fn) {
    patchPersonas(view, (all) => ({ ...all, lines: all.lines.map((line) => line.id === lineId ? fn(line) : line) }));
  }
  function patchStage(view, lineId, stageId, fn) {
    patchLine(view, lineId, (line) => ({ ...line, stages: line.stages.map((stage) => stage.id === stageId ? fn(stage) : stage) }));
  }
  function stageInfo(view, line) {
    let project = view.project(), active = view.runtime.activeId() === view.projectId, progress = active ? view.runtime.progress() : emptyProgress(view.projectId), info = currentStage(line, progress, personaEnv(project, progress, active ? view.runtime.fame() : [], active ? view.runtime.personaStates() : null));
    return { ...info, active, note: active ? personaNote(line, progress, info) : "" };
  }
  var keyText = (line) => line.keys.join("，"), field = (label, body) => `<label class="pi-field"><span>${label}</span>${body}</label>`, input = (attrs, value, extra = "") => `<input class="pi-inp" ${attrs} value="${esc(value)}"${extra}>`;
  function extraHtml(attrs, line, stage) {
    return line.fame.source !== "favor" ? "" : `${(stage.extra || []).map((item, i) => `<div class="pi-extra">${field("同时要求", `<select class="pi-sel" ${attrs("extraDim")} data-i="${i}">${options(FAVOR_DIMS.map((value) => ({ value, label: value })), item.dim)}</select>`)}${field(`${item.dim}下限`, input(`${attrs("extraMin")} data-i="${i}" type="number"`, item.min ?? ""))}${field(`${item.dim}上限`, input(`${attrs("extraMax")} data-i="${i}" type="number"`, item.max ?? ""))}<button type="button" class="pi-icon-btn is-danger" data-act="extra-del" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" data-i="${i}" title="删除这条">${ICONS.trash}</button></div>`).join("")}<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="extra-add" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}">${ICONS.plus}同时满足另一项数值</button></div>`;
  }
  function stageHtml(view, line, stage, index, current, units) {
    let attrs = (name) => `data-pl="${esc(line.id)}" data-ps="${esc(stage.id)}" data-f="${name}"`, act = (name, icon, title2, disabled = !1) => `<button type="button" class="pi-icon-btn${name === "ps-del" ? " is-danger" : ""}" data-act="${name}" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" title="${title2}"${disabled ? " disabled" : ""}>${icon}</button>`, extra = line.mode === "check" ? field("进入条件", input(attrs("cond"), stage.cond, ' placeholder="如：主角出手帮了她，她开始动摇"')) : line.mode === "outline" ? field("跟随大纲阶段", `<select class="pi-sel" ${attrs("unitId")}>${options([{ value: "", label: "不绑定（跳过）" }, ...units.map((unit) => ({ value: unit.id, label: `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}` }))], stage.unitId)}</select>`) : line.mode === "fame" ? `<div class="pi-pair">${field(line.fame.source === "favor" ? `${line.fame.dim}下限` : "声望下限", input(`${attrs("min")} type="number"`, stage.range.min ?? ""))}${field(line.fame.source === "favor" ? `${line.fame.dim}上限` : "声望上限", input(`${attrs("max")} type="number"`, stage.range.max ?? ""))}</div>${extraHtml(attrs, line, stage)}${field("进入条件（可空，写了要检测确认后才进）", input(attrs("cond"), stage.cond, ' placeholder="如：已经发生过表白"'))}` : "";
    return `<div class="pi-node pi-ps">
        <div class="pi-node-hd">${index === current ? '<span class="pi-badge is-accent">当前</span>' : ""}${input(attrs("name"), stage.name)}
            ${act("ps-up", ICONS.arrowUp, "上移", index === 0)}${act("ps-down", ICONS.arrowDown, "下移", index === line.stages.length - 1)}${act("ps-del", ICONS.trash, "删除阶段", line.stages.length <= 1)}</div>
        ${extra}
        ${field(`人设内容 ≈${estimateTokens(stage.text)}`, `<textarea class="pi-ta" rows="6" ${attrs("text")}>${esc(stage.text)}</textarea>`)}</div>`;
  }
  function partnerField(attrs, line, bar) {
    if (!bar || !Array.isArray(bar.pairs)) return "";
    let names2 = bar.pairs.map((pair) => pair.partner);
    if (line.fame.partner && !names2.includes(line.fame.partner) && names2.push(line.fame.partner), !names2.length) return "";
    let list = [{ value: "", label: "整体（取数值最高的一对）" }, ...names2.map((name) => ({ value: name, label: name }))];
    return field("搭档", `<select class="pi-sel" ${attrs("famePartner")}>${options(list, line.fame.partner)}</select>`);
  }
  function fameHint(view, line, info, bar) {
    if (!info.active) return "当前聊天没有使用本项目，这里不读声望。";
    if (info.lost) return `没有读到这条${line.fame.source === "favor" ? "角色数据" : "声望"}，请检查名称是否和 IGS 里的一致。读不到时沿用手动选的阶段。`;
    let value = fameReading(line, view.runtime.fame()), base = value === null ? "" : `当前读到的数值：${value}。`;
    if (info.miss) return `${base}这个数值不在任何阶段的区间内，现在显示「${info.stage.name}」。请给每个阶段填上下限。`;
    let noPairs = line.fame.source !== "favor" && bar && Array.isArray(bar.pairs) && !bar.pairs.length ? "这条声望还没有搭档记录，现在按整体读。" : "";
    return `${base}${noPairs}`.trim();
  }
  function lineBody(view, line, units) {
    let attrs = (name) => `data-pl="${esc(line.id)}" data-f="${name}"`, atDepth = line.position === 4, info = stageInfo(view, line), isFavor = line.fame.source === "favor", fameBar = isFavor ? null : view.runtime.fame().find((bar) => (bar.kind || "fame") === "fame" && bar.name === line.fame.bar), hint = line.mode === "fame" ? fameHint(view, line, info, fameBar) : "", fameBody = line.mode === "fame" ? `<datalist id="pi-fame-list">${view.runtime.fame().filter((bar) => (bar.kind || "fame") === (isFavor ? "favor" : "fame")).flatMap((bar) => [bar.name, ...isFavor && Array.isArray(bar.aliases) ? bar.aliases : []]).map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
        <label class="pi-field"><span>数据来源</span><select class="pi-sel" ${attrs("fameSource")}>${options([{ value: "fame", label: "声望" }, { value: "favor", label: "角色对主角的关系数值" }], line.fame.source)}</select></label>
        ${isFavor ? `<label class="pi-field"><span>读哪一项</span><select class="pi-sel" ${attrs("fameDim")}>${options(FAVOR_DIMS.map((value) => ({ value, label: value })), line.fame.dim)}</select></label>` : ""}
        ${field(isFavor ? "角色名" : "声望条名称", input(`${attrs("fameBar")} list="pi-fame-list"`, line.fame.bar))}
        ${isFavor ? "" : partnerField(attrs, line, fameBar)}
        ${hint ? `<p class="pi-hint">${esc(hint)}</p>` : ""}
        ${isFavor ? "" : `<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="ps-spread" data-line="${esc(line.id)}">按阶段数平均分配区间</button></div>`}` : "", defaultStage = line.mode === "fame" || line.mode === "outline" ? `<label class="pi-field"><span>${line.mode === "fame" ? "数值不在任何阶段区间时显示" : "还没到任何绑定的大纲阶段时显示"}</span><select class="pi-sel" ${attrs("defaultStage")}>${options(line.stages.map((stage) => ({ value: stage.id, label: stage.name })), line.defaultStage || line.stages[0].id)}</select></label>` : "";
    return `<div class="pi-entry-bd">
        <div class="pi-pair">${field("线名", input(attrs("name"), line.name))}${field("角色（分组）", input(attrs("group"), line.group))}</div>
        <label class="pi-field"><span>切换方式</span><select class="pi-sel" ${attrs("mode")}>${options(PERSONA_MODES, line.mode)}</select></label>
        ${fameBody}
        ${defaultStage}
        <div class="pi-pair">${field("触发方式", `<select class="pi-sel" ${attrs("constant")}>${options([{ value: "1", label: "常驻" }, { value: "0", label: "关键词触发" }], line.constant ? "1" : "0")}</select>`)}
            ${line.constant ? "" : field("关键词（逗号分隔）", input(attrs("keys"), keyText(line)))}</div>
        <div class="pi-pair ${atDepth ? "is-c4" : ""}">
            ${field("位置", `<select class="pi-sel" ${attrs("position")}>${options(POSITIONS, line.position)}</select>`)}
            ${atDepth ? `${field("深度", input(`${attrs("depth")} type="number" min="0"`, line.depth))}${field("角色", `<select class="pi-sel" ${attrs("role")}>${options(ROLES, line.role)}</select>`)}` : ""}
            ${field("顺序", input(`${attrs("order")} type="number"`, line.order))}</div>
        ${field(`公共文字（在阶段内容之前）≈${estimateTokens(line.common)}`, `<textarea class="pi-ta" rows="4" ${attrs("common")}>${esc(line.common)}</textarea>`)}
        <div class="pi-wb-sec-hd">阶段<small>${line.stages.length}</small></div>
        ${line.stages.map((stage, index) => stageHtml(view, line, stage, index, info.index, units)).join("")}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="ps-add" data-line="${esc(line.id)}">${ICONS.plus}添加阶段</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="pl-del" data-line="${esc(line.id)}">删除这条线</button></div></div>`;
  }
  function lineRow(view, line, open, units) {
    let info = stageInfo(view, line), note = info.note;
    return `<div class="pi-entry${line.enabled ? "" : " is-off"}">
        <div class="pi-entry-hd" data-act="pl-open" data-line="${esc(line.id)}">${open ? ICONS.caretDown : ICONS.caret}
            <span class="pi-etitle">${esc(line.name)}</span><span class="pi-badge">${esc(modeLabel(line.mode))}</span>
            <span class="pi-meta">${esc(info.stage ? info.stage.name : "")}${note ? ` · ${note}` : ""}</span>
            <input type="checkbox" title="启用" data-pl-on="${esc(line.id)}"${line.enabled ? " checked" : ""}></div>${open ? lineBody(view, line, units) : ""}</div>`;
  }
  function fileCard(all) {
    return `<div class="pi-card"><h3>导出与导入</h3>
        <div class="pi-tools is-c2"><button type="button" class="pi-btn is-sm" data-act="pf-export"${all.lines.length ? "" : " disabled"}>导出人设</button>
            <button type="button" class="pi-btn is-sm" data-act="pf-import">导入人设</button></div></div>`;
  }
  function importedCard(all) {
    let rows2 = all.imported.map((item, index) => `<div class="pi-wb-row"><span class="pi-wb-title" title="${esc(item.book)}">${esc(item.title || item.key)}<small> ${esc(item.book)}</small></span>
        <button type="button" class="pi-btn is-sm" data-act="imp-restore" data-i="${index}">恢复</button></div>`).join("");
    return `<div class="pi-card"><h3>世界书转入<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="imp-open">转入人设</button></h3>
        ${rows2 || '<p class="pi-hint">还没有从世界书转入过条目。</p>'}${rows2 ? '<p class="pi-hint">转入时关闭了原条目，点恢复可重新开启。</p>' : ""}</div>`;
  }
  function render4(view) {
    let project = view.project(), all = personas(view), s = st4(view), units = flattenUnits(project.outline.volumes), collapsed = new Set(s.collapsed || []), groups = groupLines(all.lines).map((group) => {
      let key = group.name || "::none", shut = collapsed.has(key), head = `<button type="button" class="pi-group-hd" data-act="pg-fold" data-group="${esc(key)}">${shut ? ICONS.caret : ICONS.caretDown}${esc(group.name || "未分组")}<small>${group.lines.length}</small></button>`;
      return `<div class="pi-group${shut ? " is-collapsed" : ""}">${head}${shut ? "" : group.lines.map((line) => lineRow(view, line, s.open === line.id, units)).join("")}</div>`;
    }).join("");
    return `<div class="pi-card"><h3>人设<span class="pi-meta">${all.lines.length} 条线</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-primary" data-act="pl-add">${ICONS.plus}新建人设线</button></h3>
        ${groups || '<p class="pi-hint">还没有人设线。新建一条，或从世界书转入。</p>'}</div>
        ${importedCard(all)}
        ${fileCard(all)}`;
  }
  var LINE_PATCH = {
    name: (value) => ({ name: value.trim() || "未命名" }),
    group: (value) => ({ group: value.trim() }),
    mode: (value) => ({ mode: value }),
    defaultStage: (value) => ({ defaultStage: value }),
    constant: (value) => ({ constant: value === "1" }),
    keys: (value) => ({ keys: splitKeys(value) }),
    position: (value) => ({ position: Number(value) }),
    role: (value) => ({ role: Number(value) }),
    depth: (value) => ({ depth: Math.max(0, Math.round(Number(value) || 0)) }),
    order: (value) => ({ order: Math.round(Number(value) || 0) }),
    common: (value) => ({ common: value })
  }, STAGE_PATCH = {
    name: (value) => ({ name: value.trim() || "阶段" }),
    cond: (value) => ({ cond: value }),
    unitId: (value) => ({ unitId: value }),
    text: (value) => ({ text: value })
  };
  function rangePatchOf(item, which, value) {
    let next = { ...item };
    return String(value).trim() === "" || !Number.isFinite(Number(value)) ? delete next[which] : next[which] = Number(value), next;
  }
  function rangePatch(stage, which, value) {
    let range = { ...stage.range };
    return String(value).trim() === "" || !Number.isFinite(Number(value)) ? delete range[which] : range[which] = Number(value), { range };
  }
  function onChange2(view, target) {
    let d = target.dataset;
    if (d.plOn)
      return patchLine(view, d.plOn, (line) => ({ ...line, enabled: target.checked })), view.renderBody();
    if (d.pl) {
      if (d.ps && (d.f === "extraDim" || d.f === "extraMin" || d.f === "extraMax")) {
        let at = Number(d.i);
        patchStage(view, d.pl, d.ps, (stage) => ({ ...stage, extra: (stage.extra || []).map((item, i) => i !== at ? item : d.f === "extraDim" ? { ...item, dim: target.value } : rangePatchOf(item, d.f === "extraMin" ? "min" : "max", target.value)) }));
      } else if (d.ps)
        patchStage(view, d.pl, d.ps, (stage) => ({ ...stage, ...d.f === "min" || d.f === "max" ? rangePatch(stage, d.f, target.value) : (STAGE_PATCH[d.f] || (() => ({})))(target.value) }));
      else if (d.f === "fameBar" || d.f === "famePartner" || d.f === "fameSource" || d.f === "fameDim") {
        let key = { fameBar: "bar", famePartner: "partner", fameSource: "source", fameDim: "dim" }[d.f];
        patchLine(view, d.pl, (line) => ({ ...line, fame: { ...line.fame, [key]: target.value.trim(), ...d.f === "fameSource" ? { bar: "", partner: "" } : {} } }));
      } else LINE_PATCH[d.f] && patchLine(view, d.pl, (line) => ({ ...line, ...LINE_PATCH[d.f](target.value) }));
      return view.renderBody();
    }
  }
  function moveStage(view, lineId, stageId, step) {
    patchLine(view, lineId, (line) => {
      let from = line.stages.findIndex((stage) => stage.id === stageId), to = from + step;
      if (from < 0 || to < 0 || to >= line.stages.length) return line;
      let stages = [...line.stages];
      return [stages[from], stages[to]] = [stages[to], stages[from]], { ...line, stages };
    }), view.renderBody();
  }
  var actions4 = {
    "pl-open"(view, target, event) {
      if (event.target.closest("input")) return;
      let s = st4(view);
      s.open = s.open === target.dataset.line ? "" : target.dataset.line, view.renderBody();
    },
    "pg-fold"(view, target) {
      let s = st4(view), set = new Set(s.collapsed || []);
      set.has(target.dataset.group) ? set.delete(target.dataset.group) : set.add(target.dataset.group), s.collapsed = [...set], view.renderBody();
    },
    "pf-export"(view) {
      let project = view.project();
      downloadBlob(`人设-${project.name}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, JSON.stringify(buildPersonaFile(personas(view), { project: project.name, version: view.version }), null, 2)), toast("success", `已导出 ${personas(view).lines.length} 条人设线。`);
    },
    async "pf-import"(view) {
      let [file] = await pickFiles({ accept: ".json,application/json" });
      if (!file) return;
      let parsed = parsePersonaFile(await file.text()), same = parsed.lines.filter((line) => personas(view).lines.some((item) => item.group === line.group && item.name === line.name)).length, mode = "both";
      if (same) {
        if (mode = await choiceDialog({ title: `导入 ${parsed.lines.length} 条人设线`, body: `其中 ${same} 条与现有人设线同组同名，怎么处理？`, choices: [
          { label: "都保留（新的加「（导入）」）", value: "both", primary: !0 },
          { label: "替换同名", value: "replace" },
          { label: "跳过同名", value: "skip" },
          { label: "取消", value: null }
        ] }), !mode) return;
      } else if (!await confirmDialog({ title: "导入人设", body: `将加入 ${parsed.lines.length} 条人设线。跟随大纲的阶段绑定不会带入，需要重新选。`, okLabel: "导入" })) return;
      let merged = mergePersonaLines(personas(view).lines, parsed.lines, mode);
      patchPersonas(view, (all) => ({ ...all, lines: merged.lines })), view.renderBody(), toast("success", `导入完成：新增 ${merged.added}，替换 ${merged.replaced}，跳过 ${merged.skipped}。`);
    },
    "pl-add"(view) {
      let line = newLine("新人设线", "");
      patchPersonas(view, (all) => ({ ...all, lines: [...all.lines, line] }));
      let s = st4(view);
      s.open = line.id, s.collapsed = (s.collapsed || []).filter((key) => key !== "::none"), view.renderBody();
    },
    async "pl-del"(view, target) {
      let line = personas(view).lines.find((item) => item.id === target.dataset.line);
      !line || !await confirmDialog({ title: `删除「${line.name}」`, body: "这条人设线连同全部阶段一并删除。", okLabel: "删除", danger: !0 }) || (patchPersonas(view, (all) => ({ ...all, lines: all.lines.filter((item) => item.id !== line.id) })), view.renderBody());
    },
    "ps-add"(view, target) {
      patchLine(view, target.dataset.line, (line) => ({ ...line, stages: [...line.stages, newStage(`阶段${line.stages.length + 1}`)] })), view.renderBody();
    },
    "ps-del"(view, target) {
      patchLine(view, target.dataset.line, (line) => ({ ...line, stages: line.stages.length > 1 ? line.stages.filter((stage) => stage.id !== target.dataset.stage) : line.stages })), view.renderBody();
    },
    "extra-add"(view, target) {
      patchStage(view, target.dataset.line, target.dataset.stage, (stage) => ({ ...stage, extra: [...stage.extra || [], { dim: "信任" }] })), view.renderBody();
    },
    "extra-del"(view, target) {
      patchStage(view, target.dataset.line, target.dataset.stage, (stage) => ({ ...stage, extra: (stage.extra || []).filter((_, i) => i !== Number(target.dataset.i)) })), view.renderBody();
    },
    async "ps-spread"(view, target) {
      let line = personas(view).lines.find((item) => item.id === target.dataset.line);
      if (!line || line.stages.some((stage) => stage.range.min !== void 0 || stage.range.max !== void 0) && !await confirmDialog({ title: "平均分配区间", body: "会覆盖各阶段已填的声望下限和上限。", okLabel: "覆盖" })) return;
      let count = line.stages.length, edge = (i) => Math.round(i * 100 / count);
      patchLine(view, line.id, (item) => ({ ...item, stages: item.stages.map((stage, i) => ({ ...stage, range: { min: i === 0 ? 0 : edge(i) + 1, max: i === count - 1 ? 100 : edge(i + 1) } })) })), view.renderBody();
    },
    "ps-up": (view, target) => moveStage(view, target.dataset.line, target.dataset.stage, -1),
    "ps-down": (view, target) => moveStage(view, target.dataset.line, target.dataset.stage, 1),
    async "imp-open"(view) {
      await openImport(view) && view.renderBody();
    },
    async "imp-restore"(view, target) {
      let item = personas(view).imported[Number(target.dataset.i)];
      item && await restoreImported(view, item) && view.renderBody();
    }
  };

  // src/ui/tab-run.js
  var tab_run_exports = {};
  __export(tab_run_exports, {
    actions: () => actions5,
    activateCard: () => activateCard,
    entryRow: () => entryRow,
    onChange: () => onChange3,
    render: () => render5
  });
  function toggleNode(view, unitId, nodeId, checked) {
    let unit = view.runtime.units().find((item) => item.id === unitId), node = unit && stageNodes(unit.stage.data).find((item) => item.id === nodeId), next = setNodeChecked(view.runtime.progress(), unitId, nodeId, checked, node ? node.name : ""), hook = checked && viewLive(view).hooks.find((item) => item.key === `${unitId}:${nodeId}`);
    hook && hook.steps.length && hook.step >= hook.steps.length && (next = patchLive(next, hook, { step: hook.steps.length - 1 })), view.runtime.setProgress(next);
  }
  function entryRow(entry, expanded) {
    let atDepth = entry.position === 4, field2 = (name) => `data-kind="${entry.kind}" data-param="${name}"`, body = expanded ? `<div class="pi-entry-bd">
        <div class="pi-pair ${atDepth ? "is-c4" : ""}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" ${field2("position")}>${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" ${field2("depth")} value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" ${field2("role")}>${options(ROLES, entry.role)}</select></label>` : ""}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" ${field2("order")} value="${entry.order}"></label>
        </div>
        <pre class="pi-pre">${esc(entry.content)}</pre></div>` : "";
    return `<div class="pi-entry${entry.enabled ? "" : " is-off"}">
        <div class="pi-entry-hd" data-act="toggle-entry" data-slot="${esc(entry.slotId)}">
            <span class="pi-pos">${esc(positionLabel(entry))}</span>
            <span class="pi-etitle">${esc(entry.title)}</span>
            <span class="pi-meta">≈${estimateTokens(entry.content)}</span>
            <input type="checkbox" title="启用" data-slot="${esc(entry.slotId)}" data-slot-field="enabled"${entry.enabled ? " checked" : ""}>
        </div>${body}</div>`;
  }
  var nodeRow2 = (unitId, node, off, from = "", mark = "") => `<div class="pi-node-row${off ? " is-off" : ""}"${from ? ` title="来自${esc(from)}"` : ""}>
        <span class="pi-node-name"><span class="pi-badge pi-kind is-${esc(node.kind)}">${esc(node.label)}</span> <span class="pi-node-txt">${esc(node.name)}</span></span>${mark || `<button type="button" class="pi-meta pi-meta-btn" data-act="node-toggle" data-node="${esc(node.id)}" data-unit="${esc(unitId)}">${off ? "已演" : "未演"}</button>`}</div>`;
  function hookRow(hook) {
    let chain = hook.steps.length && (hook.status === "active" || hook.status === "queue"), mark = hook.status === "done" ? "已演" : chain ? `第 ${hook.step + 1}/${hook.steps.length} 步${hook.status === "queue" ? " · 排队" : ""}` : { wait: "待触发", active: "已激活", queue: "排队" }[hook.status], markHtml = mark ? `<button type="button" class="pi-meta pi-meta-btn${hook.status === "active" ? " is-dot" : ""}" data-act="hook-menu" data-key="${esc(hook.key)}">${esc(mark)}</button>` : "";
    return nodeRow2(
      hook.unit.id,
      hook.node,
      hook.status === "done",
      hook.carried ? stageLabel(hook.unit.stage.key) : "",
      markHtml || "<span></span>"
    );
  }
  function expiredRows(hooks, open) {
    if (!hooks.length) return "";
    let rows2 = open ? hooks.map(
      (hook) => `<div class="pi-hook is-quiet"><span class="pi-node-row is-quiet"><span class="pi-node-name">${esc(hook.node.name)}</span></span>
        <button type="button" class="pi-meta pi-meta-btn" data-act="hook-menu" data-key="${esc(hook.key)}">已过期</button></div>`
    ).join("") : "";
    return `<p class="pi-hint"><button type="button" class="pi-meta pi-meta-btn" data-act="expired-toggle">已过期 ${hooks.length} 条</button></p>${rows2}`;
  }
  function worldRow(live) {
    if (!live.clocks.length) return "";
    let row2 = (clock) => {
      let phase = clockPhase(clock), dots = Array.from({ length: clock.total }, (_, i) => `<i${i < clock.filled ? ' class="is-on"' : ""}></i>`).join(""), mark = phase === "done" ? "已发生" : phase === "due" ? "已满" : `${clock.filled}/${clock.total}`;
      return `<button type="button" class="pi-check pi-clock${phase === "done" ? " is-quiet" : ""}" data-act="clock-menu" data-key="${esc(clock.key)}" title="${esc(clock.event)}">
            <span class="pi-clock-name">${esc(clock.node.name)}</span><span class="pi-clock-dots">${dots}</span><span class="pi-meta">${mark}</span></button>`;
    };
    return `<p class="pi-hint">世界</p>${live.clocks.map(row2).join("")}`;
  }
  var switchCell = (key, label, on) => `<div class="pi-pace-cell"><span>${esc(label)}</span><button type="button" class="pi-switch${on ? " is-on" : ""}" role="switch" aria-checked="${on}" data-act="thread-switch" data-key="${key}" title="${on ? "已开启" : "已关闭"}"></button></div>`;
  function switchRow(sw) {
    return `<div class="pi-pace"><span class="pi-pace-label">启用</span><div class="pi-pair">${switchCell("sideOn", "支线", sw.sideOn)}${switchCell("worldOn", "世界动态", sw.worldOn)}</div></div>`;
  }
  function nodeList(unit, progress, carried, live, sw, expiredOpen) {
    let off = new Set(offNodes(progress, unit)), nodes = stageNodes(unit.stage.data).filter((node) => !isThreadNode(node)), alive = (hook) => hook.status !== "expired", own = live.hooks.filter((hook) => !hook.carried && alive(hook)), later = live.hooks.filter((hook) => hook.carried && alive(hook)), expired = live.hooks.filter((hook) => !alive(hook)), closed = [...sw.sideOn ? [] : ["支线"], ...sw.worldOn ? [] : ["世界动态"]];
    return !nodes.length && !carried.length && !live.hooks.length && !live.clocks.length && !closed.length ? "" : `<div class="pi-tl-nodes">${nodes.map((node) => nodeRow2(unit.id, node, off.has(node.id))).join("")}${own.map(hookRow).join("")}
        ${carried.length || later.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map((item) => nodeRow2(item.unit.id, item.node, item.off, stageLabel(item.unit.stage.key))).join("")}${later.map(hookRow).join("")}` : ""}
        ${expiredRows(expired, expiredOpen)}${worldRow(live)}${closed.map((label) => `<p class="pi-hint">${label}已关闭</p>`).join("")}</div>`;
  }
  function timeline(units, states, progress, carried, live, sw, expiredOpen) {
    let groups = [];
    for (let unit of units) {
      let last = groups[groups.length - 1];
      last && last.volume === unit.volume ? last.units.push(unit) : groups.push({ volume: unit.volume, units: [unit] });
    }
    let item = (unit) => {
      let state = states[unit.id], manual = progress.slots[unit.id] && progress.slots[unit.id].state, muted = progress.muted.includes(unit.id), range = unit.stage.data && unit.stage.data.时间范围, notes = [state === "done" || state === "todo" ? "" : STATE_LABELS[state], manual ? "手动" : "", muted ? "不提醒" : ""].filter(Boolean).join(" · ");
      return `<div class="pi-tl-item is-${state}"><span class="pi-tl-dot"></span><div class="pi-tl-box">
            <div class="pi-tl-hd"><span class="pi-tl-name" title="${esc(range || "")}">${esc(stageLabel(unit.stage.key))}</span>
                ${notes ? `<span class="pi-tl-state">${esc(notes)}</span>` : ""}
                <button type="button" class="pi-icon-btn" data-act="unit-menu" data-unit="${esc(unit.id)}" title="更多">${ICONS.more}</button></div>
            ${state === "active" ? nodeList(unit, progress, carried, live, sw, expiredOpen) : ""}</div></div>`;
    };
    return groups.map(
      (group) => `<div class="pi-tl-vol">${esc(volumeLabel(group.volume.key))}</div><div class="pi-tl">${group.units.map(item).join("")}</div>`
    ).join("");
  }
  function activateCard(view, project) {
    let { data, runtime } = view;
    if (!cardKey()) return '<div class="pi-empty">先打开一张角色卡的聊天，再启用项目。</div>';
    let activeId = runtime.activeId();
    if (activeId === project.id) return "";
    let other = data.index().projects.find((item) => item.id === activeId);
    return `<div class="pi-card"><h3>启用</h3>
            <p class="pi-hint">${other ? `当前聊天使用的是「${esc(other.name)}」` : `「${esc(cardName())}」还没有启用项目`}。</p>
            <div class="pi-tools is-c2">
                <button type="button" class="pi-btn is-primary" data-act="activate">设为当前聊天使用</button>
                <button type="button" class="pi-btn" data-act="activate-card">设为本卡默认</button></div></div>`;
  }
  function personaCard(view, project, progress, st9) {
    if (!hasPersonas(project)) return "";
    let all = project.personas, env = personaEnv(project, progress, view.runtime.fame(), view.runtime.personaStates()), muted = new Set(progress.personas && progress.personas.muted || []), collapsed = new Set(st9.personaFold || []), line = (item) => {
      let info = currentStage(item, progress, env), note = [personaNote(item, progress, info), muted.has(item.id) ? "不提醒" : ""].filter(Boolean).join(" · "), caps = item.stages.map(
        (stage, index) => `<button type="button" class="pi-chip${index === info.index ? " is-on" : ""}" data-act="persona-pick" data-line="${esc(item.id)}" data-stage="${esc(stage.id)}">${esc(stage.name)}</button>`
      ).join("");
      return `<div class="pi-pl-row${info.lost ? " is-lost" : ""}"><div class="pi-pl-hd"><span class="pi-pl-name">${esc(item.name)}</span>${note ? `<span class="pi-tl-state">${esc(note)}</span>` : ""}
            <button type="button" class="pi-icon-btn" data-act="persona-menu" data-line="${esc(item.id)}" title="更多">${ICONS.more}</button></div><div class="pi-refs">${caps}</div></div>`;
    };
    return `<div class="pi-card"><h3>人设阶段</h3>${groupLines(all.lines.filter((item) => item.enabled)).map((group) => {
      let key = group.name || "::none", shut = collapsed.has(key);
      return `<div class="pi-group${shut ? " is-collapsed" : ""}"><button type="button" class="pi-group-hd" data-act="persona-fold" data-group="${esc(key)}">${shut ? ICONS.caret : ICONS.caretDown}${esc(group.name || "未分组")}<small>${group.lines.length}</small></button>${shut ? "" : group.lines.map(line).join("")}</div>`;
    }).join("") || '<p class="pi-hint">没有启用的人设线。</p>'}</div>`;
  }
  function render5(view) {
    let { data, runtime } = view, project = view.project(), st9 = view.tabState("run"), notActive = activateCard(view, project);
    if (notActive) return notActive;
    if (isClueMode(project)) return renderClueRun(view, project, st9);
    let progress = runtime.progress(), entries = runtime.entries(), sw = threadSwitches(project), units = maskUnits(flattenUnits(project.outline.volumes), sw), states = unitStates(units, progress), total = entries.filter((entry) => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0), settings = data.settings(), checking = runtime.isChecking(), book = runtime.injectMode() === "virtual" ? "" : '<span class="pi-badge is-warn">专用世界书</span>', gap = settings.checkEvery - (runtime.floorCount() - checkBase(progress));
    return `${modeCard(project)}<div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.filter((entry) => entry.kind !== "persona").length ? entries.filter((entry) => entry.kind !== "persona").map((entry) => entryRow(entry, st9.open === entry.slotId)).join("") : '<p class="pi-hint">设定和大纲都为空，没有可注入的内容。</p>'}
        </div>
        ${personaCard(view, project, progress, st9)}
        <div class="pi-card"><h3>阶段<span class="pi-meta">${gap > 0 ? `${gap} 楼后检测` : "下一楼检测"}</span><span class="pi-spacer"></span>
            ${units.length ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="index-toggle">${st9.indexOpen ? "收起索引" : "剧情索引"}</button>` : ""}</h3>
        ${units.length ? `${st9.indexOpen ? `<pre class="pi-pre pi-index">${esc(buildIndexText(units, states, progress, { carryOver: settings.carryOver, hookCap: settings.hookCap }))}</pre>` : ""}
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === progress.pace ? " is-sel" : ""}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join("")}</div></div>
        ${switchRow(sw)}
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-primary is-sm" data-act="next">打开下一段</button>
            <button type="button" class="pi-btn is-sm" data-act="check"${checking ? " disabled" : ""}>${checking ? '<span class="pi-spin"></span>检测中' : "立即检测"}</button>
            <button type="button" class="pi-btn is-sm" data-act="rewrite">改写后续</button></div>
        ${timeline(units, states, progress, settings.carryOver ? carriedNodes(units, states, progress, { withOff: !0 }) : [], liveOf(units, states, progress, settings), sw, st9.expiredOpen)}` : '<p class="pi-hint">大纲为空。到「大纲」页导入剧情 YAML，或让 AI 写一卷。</p>'}
        </div>`;
  }
  function liveOf(units, states, progress, settings) {
    return liveThreads(units, states, progress, { carryOver: settings.carryOver, hookCap: settings.hookCap });
  }
  function viewLive(view) {
    let { runtime } = view, units = maskUnits(runtime.units(), threadSwitches(view.project())), progress = runtime.progress();
    return liveOf(units, unitStates(units, progress), progress, view.data.settings());
  }
  function setSlot(view, slotId, patch) {
    let { runtime } = view;
    runtime.setProgress(patchSlot(runtime.progress(), slotId, patch));
  }
  var actions5 = {
    ...clueActions,
    activate: (view) => view.runtime.switchProject(view.projectId, "chat"),
    "activate-card": (view) => view.runtime.switchProject(view.projectId, "card"),
    // 推进速度随聊天保存，改完立即换掉详细条目开头的说明。
    pace(view, target) {
      view.runtime.setProgress({ ...view.runtime.progress(), pace: target.dataset.pace }), view.renderBody();
    },
    "index-toggle"(view) {
      let st9 = view.tabState("run");
      st9.indexOpen = !st9.indexOpen, view.renderBody();
    },
    "expired-toggle"(view) {
      let st9 = view.tabState("run");
      st9.expiredOpen = !st9.expiredOpen, view.renderBody();
    },
    "toggle-entry"(view, target, event) {
      if (event.target.closest("input,select")) return;
      let st9 = view.tabState("run");
      st9.open = st9.open === target.dataset.slot ? "" : target.dataset.slot, view.renderBody();
    },
    "persona-fold"(view, target) {
      let st9 = view.tabState("run"), set = new Set(st9.personaFold || []);
      set.has(target.dataset.group) ? set.delete(target.dataset.group) : set.add(target.dataset.group), st9.personaFold = [...set], view.renderBody();
    },
    "persona-pick"(view, target) {
      let line = view.project().personas.lines.find((item) => item.id === target.dataset.line);
      line && view.runtime.setProgress(setPersonaStage(view.runtime.progress(), line, target.dataset.stage));
    },
    async "persona-menu"(view, target) {
      let line = view.project().personas.lines.find((item) => item.id === target.dataset.line);
      if (!line) return;
      let progress = view.runtime.progress(), pp = progress.personas || {}, muted = (pp.muted || []).includes(line.id), manual = (pp.manual || []).includes(line.id), items = [
        ...line.mode !== "manual" && manual ? [{ label: "恢复自动判断", value: "release" }] : [],
        muted ? { label: "恢复提醒", value: "unmute" } : { label: "不再提醒", value: "mute" }
      ], pick = await menuDialog({ title: line.name, items });
      pick && view.runtime.setProgress(pick === "release" ? releasePersona(progress, line.id) : mutePersona(progress, line.id, pick === "mute"));
    },
    next: (view) => view.runtime.openNext(),
    check: (view) => view.runtime.checkNow({ manual: !0 }),
    // 行尾「⋯」：设为当前、手动改状态、恢复提醒。
    async "unit-menu"(view, target) {
      let { runtime } = view, id = target.dataset.unit, unit = runtime.units().find((item) => item.id === id);
      if (!unit) return;
      let progress = runtime.progress(), state = unitStates(runtime.units(), progress)[id], manual = progress.slots[id] && progress.slots[id].state, items = [
        ...state === "active" ? [] : [{ label: "设为当前", value: "goto" }],
        ...Object.entries(STATE_LABELS).filter(([value]) => value !== manual).map(([value, label]) => ({ label: `标为${label}`, value: `state:${value}` })),
        ...manual ? [{ label: "恢复自动判断", value: "state:" }] : [],
        ...progress.muted.includes(id) ? [{ label: "恢复提醒", value: "unmute" }] : []
      ], pick = await menuDialog({ title: stageLabel(unit.stage.key), items });
      if (pick) {
        if (pick === "goto") return runtime.setProgress(goTo(progress, runtime.units(), id));
        if (pick === "unmute") return runtime.setProgress({ ...progress, muted: progress.muted.filter((item) => item !== id) });
        setSlot(view, id, { state: pick.slice(6) || void 0 });
      }
    },
    // 进度钟「⋯」：手动推进、倒退、标记已发生、重置。
    async "clock-menu"(view, target) {
      let clock = viewLive(view).clocks.find((item) => item.key === target.dataset.key);
      if (!clock) return;
      let items = clock.done ? [{ label: "重置", value: "reset" }] : [
        ...clock.filled < clock.total ? [{ label: "推进一格", value: "up" }] : [],
        ...clock.filled > 0 ? [{ label: "倒退一格", value: "down" }] : [],
        { label: "标记已发生", value: "done" },
        { label: "重置", value: "reset" }
      ], pick = await menuDialog({ title: `${clock.node.name} ${clock.filled}/${clock.total}`, items });
      if (!pick) return;
      let progress = view.runtime.progress(), patch = pick === "reset" ? null : pick === "done" ? { filled: clock.total, done: !0 } : { filled: Math.max(0, Math.min(clock.total, clock.filled + (pick === "up" ? 1 : -1))) };
      view.runtime.setProgress(patchLive(progress, clock, patch));
    },
    // 支线钩子「⋯」：手动激活或退回待触发、支线链换步、恢复过期、标为过期。
    async "hook-menu"(view, target) {
      let hook = viewLive(view).hooks.find((item) => item.key === target.dataset.key);
      if (!hook) return;
      let open = hook.status === "active" || hook.status === "queue", items = [
        ...hook.status === "wait" ? [{ label: "标为已激活", value: "on" }] : [],
        ...open && hook.pooled ? [{ label: "退回待触发", value: "off" }] : [],
        ...open && hook.step + 1 < hook.steps.length ? [{ label: "进入下一步", value: "next" }] : [],
        ...open && hook.step > 0 ? [{ label: "回到上一步", value: "prev" }] : [],
        ...hook.status === "expired" ? [{ label: "恢复", value: "restore" }] : [],
        ...open && hook.limit ? [{ label: "标为过期", value: "expire" }] : [],
        { label: hook.status === "done" ? "恢复未演" : "标记已演", value: hook.status === "done" ? "unplay" : "played" }
      ];
      if (!items.length) return;
      let pick = await menuDialog({
        title: hook.carried ? `${hook.node.name}（来自${stageLabel(hook.unit.stage.key)}）` : hook.node.name,
        items
      });
      if (!pick) return;
      if (pick === "played" || pick === "unplay") return toggleNode(view, hook.unit.id, hook.node.id, pick === "unplay");
      let floor = Math.max(1, view.runtime.floorCount()), restore = hook.pooled ? { at: floor, shownAt: void 0 } : { since: floor }, patch = {
        on: { at: floor },
        off: { at: void 0, shownAt: void 0 },
        next: { step: hook.step + 1 },
        prev: { step: hook.step - 1 },
        restore: { expired: void 0, ...restore, keepVol: hook.limit && hook.limit.volume ? viewLive(view).activeVol : void 0 },
        expire: { expired: !0 }
      }[pick];
      view.runtime.setProgress(patchLive(view.runtime.progress(), hook, patch));
    },
    "node-toggle"(view, target) {
      let { unit, node } = target.dataset, found = view.runtime.units().find((item) => item.id === unit);
      toggleNode(view, unit, node, !!found && offNodes(view.runtime.progress(), found).includes(node));
    },
    "thread-switch"(view, target) {
      let key = target.dataset.key;
      view.data.updateProject(view.projectId, (project) => {
        let sw = threadSwitches(project);
        return { ...project, threads: { ...sw, [key]: !sw[key] } };
      }), view.runtime.refresh(), view.renderBody();
    },
    rewrite: (view) => startRewrite(view),
    preview(view) {
      let entries = view.runtime.entries().filter((entry) => entry.enabled && entry.content), html = entries.length ? POSITIONS.map((pos) => {
        let list = entries.filter((entry) => entry.position === pos.value).sort((a, b) => a.order - b.order);
        return list.length ? list.map(
          (entry) => `<p class="pi-hint">${esc(positionLabel(entry))} · ${esc(entry.title)} · 顺序 ${entry.order}</p><pre class="pi-pre">${esc(entry.content)}</pre>`
        ).join("") : "";
      }).join("") : '<p class="pi-hint">没有启用的条目。</p>';
      return openDialog({ title: "最终注入预览", html: `${html}`, actions: [{ label: "关闭", value: !0, primary: !0 }] });
    }
  };
  function onChange3(view, target) {
    if (clueOnChange(view, target)) return;
    let { runtime } = view;
    if (target.dataset.param) {
      let value = Math.round(Number(target.value));
      if (!Number.isFinite(value)) return;
      let { kind, param } = target.dataset;
      view.data.updateProject(view.projectId, (project) => ({
        ...project,
        defaults: {
          ...DEFAULT_PARAMS,
          ...project.defaults,
          [kind]: {
            ...DEFAULT_PARAMS[kind],
            ...project.defaults[kind],
            [param]: param === "depth" || param === "order" ? Math.max(0, value) : value
          }
        }
      })), runtime.refresh(), view.renderBody();
      return;
    }
    if (target.dataset.slotField === "enabled") {
      setSlot(view, target.dataset.slot, { enabled: target.checked }), view.renderBody();
      return;
    }
  }

  // src/ui/tab-worlds.js
  var tab_worlds_exports = {};
  __export(tab_worlds_exports, {
    actions: () => actions6,
    onChange: () => onChange4,
    refreshOn: () => refreshOn4,
    render: () => render6
  });
  var st5 = (view) => view.tabState("worlds"), infOf = (view) => normalizeInfinite(view.project().infinite);
  function save2(view, fn) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, infinite: fn(normalizeInfinite(project.infinite)) })), view.runtime.refresh();
  }
  var lines = (text2) => String(text2 || "").split(`
`).map((line) => line.trim()).filter(Boolean);
  function wordTitle(key, hubName) {
    return { back: `返回${hubName}`, depart: "出发", away: "在副本里", hub: `在${hubName}` }[key];
  }
  function hubCard(infinite) {
    let cfg = infinite.config, hubName = resolveHub(cfg).hubName;
    return `<div class="pi-card"><h3>主空间<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="hub-reset">恢复默认</button></h3>
        <p class="pi-hint">正文末尾状态块的写法。每组词一行一个，靠前的优先匹配，第一个词用作显示名；清空某组则按默认词读取。</p>
        <label class="pi-field"><span>主空间名称</span><input class="pi-inp" data-hub="hubName" value="${esc(cfg.hubName)}"></label>
        <label class="pi-field"><span>状态块标签</span><input class="pi-inp" data-hub="blockTag" value="${esc(cfg.blockTag)}"></label>
        <label class="pi-field"><span>栏名（一行一个）</span><textarea class="pi-ta is-mono" data-hub="fieldNames">${esc(cfg.fieldNames.join(`
`))}</textarea></label>
        ${HUB_WORD_KEYS.map((key) => `<label class="pi-field"><span>${esc(wordTitle(key, hubName))}</span><textarea class="pi-ta is-mono" data-hub-words="${key}">${esc(cfg.words[key].join(`
`))}</textarea></label>`).join("")}</div>`;
  }
  function worldRow2(world, open, currentId) {
    let badges = world.id === currentId ? '<span class="pi-badge is-ok">当前</span>' : "", body = open ? `<div class="pi-entry-bd">
        <p class="pi-hint">${esc(world.dice.horror)}｜周期 ${esc(world.dice.cycle)}｜${esc(world.dice.client)}｜情欲${esc(world.dice.lust)}</p>
        <pre class="pi-pre">${esc(world.body)}</pre>
        <div class="pi-tools is-c2">
            <button type="button" class="pi-btn is-sm" data-act="world-reopen" data-id="${esc(world.id)}"${currentId ? " disabled" : ""}>重新打开</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="world-del" data-id="${esc(world.id)}">删除</button></div></div>` : "";
    return `<div class="pi-entry">
        <div class="pi-entry-hd" data-act="world-open" data-id="${esc(world.id)}">
            <span class="pi-etitle">${esc(world.title)}</span>${badges}</div>${body}</div>`;
  }
  function libraryCard(view, s) {
    if (view.runtime.activeId() !== view.projectId)
      return '<div class="pi-card"><h3>世界库</h3><p class="pi-hint">世界库随聊天保存。把这个项目设为当前聊天使用后，才能看到这条聊天里的世界。</p></div>';
    let inf = view.runtime.progress().infinite, worlds = inf ? inf.worlds : [], currentId = inf && inf.phase === "world" ? inf.worldId : "";
    return `<div class="pi-card"><h3>世界库<span class="pi-meta">${worlds.length} 份</span></h3>
        ${worlds.length ? [...worlds].reverse().map((world) => worldRow2(world, s.open === world.id, currentId)).join("") : '<p class="pi-hint">这条聊天里还没有世界。到「执行」页点「进入新世界」，或等检测到下车时自动写出档案。</p>'}</div>`;
  }
  function render6(view) {
    let infinite = infOf(view), s = st5(view);
    return `${libraryCard(view, s)}
        <div class="pi-card"><h3>骰池</h3>
        <p class="pi-hint">每行「名称|权重」。情欲浓度写进档案末尾，由代码决定。</p>
        ${POOL_KEYS.map((key) => `<label class="pi-field"><span>${POOL_LABELS[key]}</span><textarea class="pi-ta is-mono" data-pool="${key}">${esc(poolToText(infinite.pools[key]))}</textarea></label>`).join("")}</div>
        ${hubCard(infinite)}
        <div class="pi-card"><h3>造世界规范<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="spec-reset">恢复默认</button></h3>
        <textarea class="pi-ta is-mono is-tall" data-spec>${esc(worldSpecText(infinite))}</textarea></div>
        <div class="pi-card"><h3>恐怖类型写法</h3>
        <p class="pi-hint">开副本时按「前缀 + 恐怖类型」到角色卡世界书里找同标题的条目（关闭的也能读到），正文放进造世界提示，不进正文注入。</p>
        <label class="pi-field"><span>条目标题前缀</span><input class="pi-inp" data-prefix value="${esc(infinite.config.horrorPrefix)}"></label></div>`;
  }
  var actions6 = {
    "world-open"(view, target) {
      let s = st5(view);
      s.open = s.open === target.dataset.id ? "" : target.dataset.id, view.renderBody();
    },
    "world-reopen"(view, target) {
      view.runtime.reopenWorld(target.dataset.id), view.renderBody();
    },
    async "world-del"(view, target) {
      let id = target.dataset.id, world = findWorld(view.runtime.progress().infinite?.worlds || [], id);
      !world || !await confirmDialog({ title: `删除「${world.title}」`, body: "档案删除后不能恢复。", okLabel: "删除", danger: !0 }) || (view.runtime.deleteWorld(id), view.renderBody());
    },
    "hub-reset"(view) {
      save2(view, (infinite) => ({ ...infinite, config: { ...infinite.config, hubName: DEFAULT_HUB.hubName, blockTag: DEFAULT_HUB.blockTag, fieldNames: [...DEFAULT_HUB.fieldNames], words: Object.fromEntries(HUB_WORD_KEYS.map((key) => [key, [...DEFAULT_HUB.words[key]]])) } })), view.renderBody();
    },
    "spec-reset"(view) {
      save2(view, (infinite) => ({ ...infinite, spec: "" })), view.renderBody();
    }
  };
  function onChange4(view, target) {
    if (target.dataset.pool) {
      let key = target.dataset.pool, rows2 = textToPool(target.value);
      save2(view, (infinite) => ({ ...infinite, pools: { ...infinite.pools, [key]: rows2 } })), view.renderBody();
      return;
    }
    if (target.dataset.hub) {
      let key = target.dataset.hub, value = key === "fieldNames" ? lines(target.value) : target.value.trim();
      save2(view, (infinite) => ({ ...infinite, config: { ...infinite.config, [key]: value } })), view.renderBody();
      return;
    }
    if (target.dataset.hubWords) {
      let key = target.dataset.hubWords, rows2 = lines(target.value);
      save2(view, (infinite) => ({ ...infinite, config: { ...infinite.config, words: { ...infinite.config.words, [key]: rows2 } } })), view.renderBody();
      return;
    }
    if (target.dataset.spec !== void 0) {
      let text2 = target.value.trim() === DEFAULT_WORLD_SPEC.trim() ? "" : target.value;
      save2(view, (infinite) => ({ ...infinite, spec: text2 }));
      return;
    }
    target.dataset.prefix !== void 0 && save2(view, (infinite) => ({ ...infinite, config: { ...infinite.config, horrorPrefix: target.value } }));
  }
  var refreshOn4 = ["progress", "project", "chat", "switch", "opened"];

  // src/ui/tab-infinite-run.js
  var tab_infinite_run_exports = {};
  __export(tab_infinite_run_exports, {
    actions: () => actions7,
    onChange: () => onChange3,
    render: () => render7
  });
  var WORD_TITLES = { back: "返回", depart: "出发", away: "在副本里", hub: "在主空间" };
  function render7(view) {
    let { runtime } = view, project = view.project(), st9 = view.tabState("run"), notActive = activateCard(view, project);
    if (notActive) return notActive;
    let state = runtime.infState();
    if (!state) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取进度…</div>';
    let { inf, infinite } = state, cfg = infinite.config, hubName = resolveHub(cfg).hubName, labels = phaseLabels(cfg), blanked = blankedWordKeys(cfg), world = inf.phase === "world" ? findWorld(inf.worlds, inf.worldId) : null, entries = runtime.entries(), total = entries.filter((entry) => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0), opening = runtime.isOpening(), book = runtime.injectMode() === "virtual" ? "" : '<span class="pi-badge is-warn">专用世界书</span>', meta2 = describeRead(runtime.lastRead(), cfg);
    return `<div class="pi-card"><h3>当前状态<span class="pi-meta">${esc(meta2)}</span></h3>
        <div class="pi-row"><span class="pi-badge is-accent">${esc(labels[inf.phase])}</span>${world ? `<span class="pi-badge">${esc(world.title)}</span>` : ""}
            <span class="pi-badge">世界库 ${inf.worlds.length} 份</span></div>
        <div class="pi-tools is-c2">
            <button type="button" class="pi-btn is-primary is-sm" data-act="inf-enter"${inf.phase !== "train" || opening ? " disabled" : ""}>${opening ? '<span class="pi-spin"></span>造世界' : "进入新世界"}</button>
            <button type="button" class="pi-btn is-sm" data-act="inf-return"${inf.phase !== "world" ? " disabled" : ""}>回到${esc(hubName)}</button></div>
        ${blanked.length ? `<p class="pi-hint">${esc(blanked.map((key) => WORD_TITLES[key]).join("、"))}的词被清空，现按默认词读取。</p>` : ""}</div>
        <div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.length ? entries.map((entry) => entryRow(entry, st9.open === entry.slotId)).join("") : '<p class="pi-hint">设定和世界库都为空，没有可注入的内容。</p>'}</div>
        ${inf.log.length ? `<div class="pi-card"><h3>近期记录</h3><pre class="pi-pre">${esc(inf.log.slice().reverse().join(`
`))}</pre></div>` : ""}`;
  }
  var actions7 = {
    ...actions5,
    "inf-enter": (view) => view.runtime.openWorld(),
    async "inf-return"(view) {
      let hubName = resolveHub(view.runtime.infState()?.infinite.config).hubName;
      await confirmDialog({ title: `回到${hubName}`, body: "撤掉当前世界档案的注入，档案留在世界库里。", okLabel: `回到${hubName}` }) && (view.runtime.returnToTrain(), view.renderBody());
    }
  };

  // src/ui/page-settings.js
  var page_settings_exports = {};
  __export(page_settings_exports, {
    actions: () => actions8,
    onChange: () => onChange5,
    onInput: () => onInput4,
    refreshOn: () => refreshOn5,
    render: () => render8
  });
  var st6 = (view) => view.tabState("settings"), currentRole = (view) => LLM_ROLES.some((item) => item.key === st6(view).role) ? st6(view).role : LLM_ROLES[0].key;
  function modelField(view, role, llm) {
    let s = st6(view), models = s.models?.[role] || [];
    return `<div class="pi-field"><span>模型</span><div class="pi-inline">${!models.length || s.manual?.[role] ? `<input class="pi-inp" data-llm="${role}" data-k="model" value="${esc(llm.model)}" placeholder="模型名称">` : `<select class="pi-sel" data-llm="${role}" data-k="model">${llm.model && !models.includes(llm.model) ? `<option value="${esc(llm.model)}" selected>${esc(llm.model)}</option>` : ""}
            ${llm.model ? "" : '<option value="" selected disabled>选择模型</option>'}${options(
      models.map((model) => ({ value: model, label: model })),
      llm.model
    )}
            <option value="__manual">手动输入…</option></select>`}
        <button type="button" class="pi-btn" data-act="models" data-role="${role}">${s.loading === role ? '<span class="pi-spin"></span>' : ""}获取列表</button></div></div>`;
  }
  function llmCard(view, s) {
    let role = currentRole(view), llm = s.llm[role], custom = llm.source === "custom";
    return `<div class="pi-card"><h3>模型接口</h3>
        <div class="pi-seg">${LLM_ROLES.map(
      (item) => `<button type="button" class="pi-seg-btn${item.key === role ? " is-sel" : ""}" data-act="llm-role" data-role="${item.key}">${esc(item.label)}</button>`
    ).join("")}</div>
        <label class="pi-field"><span>接口来源</span><select class="pi-sel" data-llm="${role}" data-k="source">${options(
      [
        { value: "tavern", label: "酒馆当前连接" },
        { value: "custom", label: "独立接口（OpenAI兼容）" }
      ],
      llm.source
    )}</select></label>
        ${custom ? `<label class="pi-field"><span>接口地址</span><input class="pi-inp" data-llm="${role}" data-k="endpoint" value="${esc(llm.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>API密钥</span><input class="pi-inp" type="password" autocomplete="off" data-llm="${role}" data-k="apiKey" value="${esc(llm.apiKey)}"></label>
        ${modelField(view, role, llm)}
        <label class="pi-field"><span>温度</span><input class="pi-inp" data-llm="${role}" data-k="temperature" value="${esc(llm.temperature)}" placeholder="默认"></label>` : ""}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="preset-load"${s.presets.length ? "" : " disabled"}>载入预设</button>
            <button type="button" class="pi-btn is-sm" data-act="preset-save"${custom ? "" : " disabled"}>保存为预设</button></div>
        </div>`;
  }
  function pickPreset(presets) {
    let html = presets.map(
      (preset) => `<div class="pi-preset">
            <button type="button" class="pi-preset-pick" data-dlg-value="load:${esc(preset.id)}">
                <span class="pi-preset-name">${esc(preset.name)}</span><span class="pi-preset-model">${esc(preset.model || "未选模型")}</span></button>
            <button type="button" class="pi-icon-btn is-danger" data-dlg-value="del:${esc(preset.id)}" title="删除">${ICONS.trash}</button></div>`
    ).join("");
    return openDialog({ title: "载入接口预设", html: `<div class="pi-presets">${html}</div>`, actions: [{ label: "取消", value: null }] });
  }
  function guideCard(view, s) {
    let open = st6(view).guideOpen, g = resolveGuide(s), preset = GUIDE_PRESETS.find((x) => x.value === s.guidePreset) || GUIDE_PRESETS[0], custom = s.guidePreset === "custom";
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? "收起" : "查看"}</button></h3>
        <p class="pi-hint">在讨论页聊设定和剧情、在设定页整理设定时，AI 按这份基准来写。正文模型看不到它。</p>
        <label class="pi-field"><span>使用哪一份</span><select class="pi-sel" data-guide-preset>${options(
      GUIDE_PRESETS.map((x) => ({ value: x.value, label: x.value === "generic" ? "通用（默认）" : x.label })),
      preset.value
    )}</select></label>
        ${custom && !String(s.guide || "").trim() ? '<p class="pi-hint is-warn">自定义的内容还是空的，现在实际用的是通用版。</p>' : ""}
        ${open ? custom ? `<textarea class="pi-ta is-mono is-tall" data-guide>${esc(s.guide || "")}</textarea>` : `<p class="pi-hint">内置版本不能直接改。想改的话，选「自定义」，会以这一份为底稿。</p><pre class="pi-pre">${esc(g.text)}</pre>` : ""}</div>`;
  }
  function paceRow(view, s) {
    let open = st6(view).paceOpen, changed = PACES.filter((item) => s.paceText[item.value]).map((item) => item.label), current = view.runtime.activeId() ? view.runtime.progress().pace : "", pace = PACES.some((item) => item.value === st6(view).pace) ? st6(view).pace : current || "normal", pick = PACES.map((item) => ({
      value: item.value,
      label: `${item.label}${item.value === current ? "（当前聊天使用）" : ""}${s.paceText[item.value] ? "·已改" : ""}`
    }));
    return `<div class="pi-set-row"><span>推进速度说明</span>${changed.length ? `<span class="pi-badge">已修改 ${changed.join("、")}</span>` : ""}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="pace-toggle">${open ? "收起" : "编辑"}</button></div>
        ${open ? `<div class="pi-set-sub"><label class="pi-field"><span>编辑哪一档的说明</span><select class="pi-sel" data-pace-pick>${options(pick, pace)}</select></label>
        <textarea class="pi-ta" rows="3" data-pace-text="${pace}">${esc(paceText(s, pace))}</textarea>
        <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-sm" data-act="pace-reset" data-pace="${pace}"${s.paceText[pace] ? "" : " disabled"}>恢复默认</button></div></div>` : ""}`;
  }
  function render8(view) {
    let s = view.data.settings(), modes = [
      { value: "ask", label: "弹出确认" },
      { value: "auto", label: "自动推进（可撤销）" },
      { value: "nodes", label: "仅勾选节点，不推进阶段" }
    ], offModes = [
      { value: "ask", label: "弹出提醒" },
      { value: "auto", label: "自动改写后续阶段（可撤销）" },
      { value: "off", label: "不检查偏离" }
    ], personaModes = [
      { value: "ask", label: "弹出确认" },
      { value: "auto", label: "自动推进（可撤销）" },
      { value: "off", label: "不检测" }
    ], threadModes = [
      { value: "ask", label: "弹出确认" },
      { value: "auto", label: "自动收录为支线" },
      { value: "off", label: "不识别" }
    ];
    return `<div class="pi-card"><h3>注入内容</h3>
        <label class="pi-field"><span>详细条目的标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label>
        <div class="pi-set-row"><label class="pi-check"><input type="checkbox" data-set="bodyGuide"${s.bodyGuide ? " checked" : ""}><span>正文通用提示</span></label>${s.bodyGuideText ? '<span class="pi-badge">已修改</span>' : ""}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="body-guide-toggle">${st6(view).bodyGuideOpen ? "收起" : "编辑"}</button></div>
        ${st6(view).bodyGuideOpen ? `<div class="pi-set-sub"><textarea class="pi-ta is-tall" data-body-guide>${esc(bodyGuideText({ ...s, bodyGuide: !0 }))}</textarea>
        <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-sm" data-act="body-guide-reset"${s.bodyGuideText ? "" : " disabled"}>恢复默认</button></div></div>` : ""}</div>
        <div class="pi-card"><h3>阶段推进</h3>
        <div class="pi-pair"><label class="pi-field"><span>检测间隔（楼）</span><input class="pi-inp" type="number" min="1" data-set="checkEvery" value="${s.checkEvery}"></label>
            <label class="pi-field"><span>每次读取楼数</span><input class="pi-inp" type="number" min="1" data-set="checkFloors" value="${s.checkFloors}"></label></div>
        <label class="pi-field"><span>判定阶段已演完后</span><select class="pi-sel" data-set="handleMode">${options(modes, s.handleMode)}</select></label>
        <label class="pi-field"><span>偏离大纲时</span><select class="pi-sel" data-set="offTrackMode">${options(offModes, s.offTrackMode)}</select></label>
        <label class="pi-field"><span>人设阶段变化时</span><select class="pi-sel" data-set="personaMode">${options(personaModes, s.personaMode)}</select></label>
        <label class="pi-check"><input type="checkbox" data-set="carryOver"${s.carryOver ? " checked" : ""}><span>没演的支线与世界动态延续到后面的阶段</span></label>
        <div class="pi-pair"><label class="pi-field"><span>同时注入的激活支线</span><input class="pi-inp" type="number" min="1" max="6" data-set="hookCap" value="${s.hookCap}"></label>
            <label class="pi-field"><span>正文出现大纲外的新线时</span><select class="pi-sel" data-set="newThreadMode">${options(threadModes, s.newThreadMode)}</select></label></div>
        ${paceRow(view, s)}</div>
        ${llmCard(view, s)}
        ${guideCard(view, s)}
        <div class="pi-card"><h3>新手教程</h3>
        <p class="pi-hint">每个页面右上角的「?」可以播放这一页的教程。想从头再看一遍时，点下面的按钮：先播放总览，之后第一次打开插件时也会再播一次。</p>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="tour-reset">重新播放全部教程</button></div></div>`;
  }
  var NUMERIC = /* @__PURE__ */ new Set(["checkEvery", "checkFloors", "hookCap"]);
  function readValue(target) {
    return target.type === "checkbox" ? target.checked : NUMERIC.has(target.dataset.set) ? Number(target.value) : target.value;
  }
  function setRole(view, role, patch) {
    let llm = view.data.settings().llm;
    view.data.updateSettings({ llm: { ...llm, [role]: { ...llm[role], ...patch } } });
  }
  function onInput4(view, target) {
    if (target.dataset.paceText) {
      let key = target.dataset.paceText, text2 = target.value.trim() === PACE_TEXT[key] ? "" : target.value;
      view.data.updateSettings({ paceText: { ...view.data.settings().paceText, [key]: text2 } }), view.runtime.refresh();
      return;
    }
    if (target.dataset.bodyGuide !== void 0) {
      let text2 = target.value;
      view.data.updateSettings({ bodyGuideText: text2.trim() === BODY_GUIDE.trim() ? "" : text2 }), view.runtime.refresh();
      return;
    }
    if (target.dataset.guide !== void 0) {
      view.data.updateSettings({ guide: target.value });
      return;
    }
    target.dataset.set && target.type !== "checkbox" && target.tagName !== "SELECT" && view.data.updateSettings({ [target.dataset.set]: readValue(target) }), target.dataset.llm && target.tagName === "INPUT" && setRole(view, target.dataset.llm, { [target.dataset.k]: target.value.trim() });
  }
  function onChange5(view, target) {
    if (target.dataset.guidePreset !== void 0) {
      let s = view.data.settings(), next = target.value, patch = { guidePreset: next };
      next === "custom" && !String(s.guide || "").trim() && (patch.guide = resolveGuide(s).text), view.data.updateSettings(patch), next === "custom" && (st6(view).guideOpen = !0), view.renderBody();
      return;
    }
    if (target.dataset.pacePick !== void 0) {
      st6(view).pace = target.value, view.renderBody();
      return;
    }
    target.dataset.set && (target.type === "checkbox" || target.tagName === "SELECT") && (view.data.updateSettings({ [target.dataset.set]: readValue(target) }), view.runtime.refresh(), view.renderBody()), target.dataset.llm && target.tagName === "SELECT" && (target.value === "__manual" ? st6(view).manual = { ...st6(view).manual, [target.dataset.llm]: !0 } : setRole(view, target.dataset.llm, { [target.dataset.k]: target.value }), view.renderBody()), target.dataset.set && target.tagName !== "SELECT" && target.type !== "checkbox" && view.runtime.refresh();
  }
  var CONN_KEYS2 = ["endpoint", "apiKey", "model", "temperature"], actions8 = {
    async models(view, target) {
      let role = target.dataset.role, s = st6(view);
      if (!s.loading) {
        s.loading = role, view.renderBody();
        try {
          let models = await fetchModels(view.data.settings().llm[role]);
          s.models = { ...s.models, [role]: models }, s.manual = { ...s.manual, [role]: !1 }, toast("success", `获取到${models.length}个模型，可在下拉框中选择。`);
        } finally {
          s.loading = "", view.renderBody();
        }
      }
    },
    "llm-role"(view, target) {
      st6(view).role = target.dataset.role, view.renderBody();
    },
    // 同名预设直接覆盖，不同名新建一份。
    async "preset-save"(view) {
      let s = view.data.settings(), llm = s.llm[currentRole(view)];
      if (!llm.endpoint) throw new Error("请先填写接口地址");
      let name = await promptDialog({ title: "保存为预设", label: "预设名称", value: llm.model, placeholder: "如：DeepSeek" });
      if (name == null || !name.trim()) return;
      let conn = Object.fromEntries(CONN_KEYS2.map((key) => [key, llm[key]])), same = s.presets.find((item) => item.name === name.trim()), presets = same ? s.presets.map((item) => item === same ? { ...item, ...conn } : item) : [...s.presets, { id: makeId("api"), name: name.trim(), ...conn }];
      view.data.updateSettings({ presets }), toast("success", same ? `已更新预设「${name.trim()}」。` : `已保存预设「${name.trim()}」。`), view.renderBody();
    },
    async "preset-load"(view) {
      let role = currentRole(view);
      for (; ; ) {
        let presets = view.data.settings().presets;
        if (!presets.length) return view.renderBody();
        let result = await pickPreset(presets);
        if (!result) return;
        let [act, id] = [result.slice(0, result.indexOf(":")), result.slice(result.indexOf(":") + 1)], preset = presets.find((item) => item.id === id);
        if (!preset) return;
        if (act === "del") {
          await confirmDialog({
            title: `删除预设「${preset.name}」`,
            body: "已载入这个预设的用途不受影响。",
            okLabel: "删除",
            danger: !0
          }) && view.data.updateSettings({ presets: presets.filter((item) => item.id !== id) });
          continue;
        }
        return setRole(view, role, { source: "custom", ...Object.fromEntries(CONN_KEYS2.map((key) => [key, preset[key]])) }), st6(view).manual = { ...st6(view).manual, [role]: !1 }, toast("success", `已为「${LLM_ROLES.find((item) => item.key === role).label}」载入预设「${preset.name}」。`), view.renderBody();
      }
    },
    "body-guide-toggle"(view) {
      st6(view).bodyGuideOpen = !st6(view).bodyGuideOpen, view.renderBody();
    },
    "body-guide-reset"(view) {
      view.data.updateSettings({ bodyGuideText: "" }), view.runtime.refresh(), view.renderBody();
    },
    "pace-toggle"(view) {
      st6(view).paceOpen = !st6(view).paceOpen, view.renderBody();
    },
    "pace-reset"(view, target) {
      view.data.updateSettings({ paceText: { ...view.data.settings().paceText, [target.dataset.pace]: "" } }), view.runtime.refresh(), view.renderBody();
    },
    "guide-toggle"(view) {
      st6(view).guideOpen = !st6(view).guideOpen, view.renderBody();
    }
  }, refreshOn5 = [];

  // src/ui/page-data.js
  var page_data_exports = {};
  __export(page_data_exports, {
    actions: () => actions9,
    onChange: () => onChange6,
    refreshOn: () => refreshOn6,
    render: () => render9
  });

  // src/core/zip.js
  var CRC_TABLE = (() => {
    let table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 4294967295;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
    return (crc ^ 4294967295) >>> 0;
  }
  function buildZip(files) {
    let encoder = new TextEncoder(), locals = [], centrals = [], offset = 0;
    for (let file of files) {
      let name = encoder.encode(file.name), data = typeof file.data == "string" ? encoder.encode(file.data) : file.data, crc = crc32(data), local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 67324752, !0), lv.setUint16(4, 20, !0), lv.setUint16(6, 2048, !0), lv.setUint32(14, crc, !0), lv.setUint32(18, data.length, !0), lv.setUint32(22, data.length, !0), lv.setUint16(26, name.length, !0), local.set(name, 30);
      let central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 33639248, !0), cv.setUint16(4, 20, !0), cv.setUint16(6, 20, !0), cv.setUint16(8, 2048, !0), cv.setUint32(16, crc, !0), cv.setUint32(20, data.length, !0), cv.setUint32(24, data.length, !0), cv.setUint16(28, name.length, !0), cv.setUint32(42, offset, !0), central.set(name, 46), locals.push(local, data), centrals.push(central), offset += local.length + data.length;
    }
    let centralSize = centrals.reduce((sum, item) => sum + item.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 101010256, !0), ev.setUint16(8, files.length, !0), ev.setUint16(10, files.length, !0), ev.setUint32(12, centralSize, !0), ev.setUint32(16, offset, !0);
    let parts = [...locals, ...centrals, end], out = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0)), at = 0;
    for (let part of parts)
      out.set(part, at), at += part.length;
    return out;
  }

  // src/host/update.js
  var REPOSITORY = "Anyno001/PlotInjector", VERSION_RE = /^v?\d+\.\d+\.\d+$/;
  function compareVersions(a, b) {
    let pa = String(a).replace(/^v/, "").split(".").map(Number), pb = String(b).replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  }
  async function getJson(url, ms) {
    let controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms);
    try {
      let res = await hostWindow().fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      throw controller.signal.aborted ? new Error(`连接超时（${ms / 1e3} 秒）`) : error;
    } finally {
      clearTimeout(timer);
    }
  }
  var highest = (names2) => names2.filter((name) => VERSION_RE.test(name || "")).map((name) => name.replace(/^v/, "")).sort(compareVersions).pop() || "", SOURCES = [
    async () => highest((await getJson(`https://api.github.com/repos/${REPOSITORY}/tags?per_page=100`, 6e3)).map((item) => item && item.name)),
    async () => highest((await getJson(`https://data.jsdelivr.com/v1/packages/gh/${REPOSITORY}`, 8e3)).versions.map((item) => typeof item == "string" ? item : item && item.version))
  ];
  async function fetchLatestVersion() {
    let last = null;
    for (let source of SOURCES)
      try {
        let version = await source();
        if (version) return version;
      } catch (error) {
        last = error;
      }
    throw last || new Error("没有找到发布版本");
  }

  // src/ui/page-data.js
  var st7 = (view) => view.tabState("data"), latest = { state: "", version: "", error: "" }, viaLoader = () => !!window.__plotInjectorLoader;
  async function checkLatest(view) {
    latest.state = "checking", view.renderBody();
    try {
      latest.version = await fetchLatestVersion(), latest.state = "done";
    } catch (error) {
      latest.error = error.message, latest.state = "error";
    }
    view.renderBody();
  }
  function versionCard(view, settings) {
    latest.state || checkLatest(view);
    let newer = latest.state === "done" && compareVersions(latest.version, view.version) > 0, status = {
      checking: '<span class="pi-spin"></span>正在检测最新版本…',
      done: newer ? `最新版本 v${esc(latest.version)}，可以更新。` : "已是最新版本。",
      error: `检测失败：${esc(latest.error)}`
    }[latest.state] || "", pinned = settings.loaderRef, note = "";
    newer && !viaLoader() ? note = "当前是单文件版，需重新导入新版 JSON 才能更新。" : newer && pinned && (note = `已指定 ${esc(pinned)}，清空指定版本后才会更新。`);
    let updateBtn = newer && viaLoader() ? `<button type="button" class="pi-btn is-sm is-primary" data-act="update-now">更新到 v${esc(latest.version)}</button>` : "";
    return `<div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本 v${esc(view.version)}。${status}</p>
        ${note ? `<p class="pi-hint is-warn">${note}</p>` : ""}
        <div class="pi-tools ${updateBtn ? "is-c2" : "is-c1"} pi-acts"><button type="button" class="pi-btn is-sm" data-act="check-update"${latest.state === "checking" ? " disabled" : ""}>检查更新</button>${updateBtn}</div>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(settings.loaderRef)}" placeholder="留空跟随最新版本，可填 v0.1.0 或 main"></label></div>`;
  }
  function referenced(index) {
    let names2 = /* @__PURE__ */ new Set([INDEX_FILE]);
    for (let item of index.projects) {
      names2.add(projectFile(item.id)), names2.add(chatFile(item.id));
      for (let id of item.imports || []) names2.add(importSrcFile(id)), names2.add(importJobFile(id));
    }
    return names2;
  }
  function fileCell(view, name, bytes) {
    let verified = st7(view).verified, missing = verified && verified[name] === !1;
    return !view.data.index().files.includes(name) && !bytes ? '<td class="pi-hint">—</td>' : `<td class="${missing ? "is-missing" : ""}">${missing ? "已丢失" : formatBytes(bytes)}
        ${missing ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="export-file" data-name="${esc(name)}">导出</button>`}
        <button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="delete-file" data-name="${esc(name)}">删除</button></td>`;
  }
  function filesTable(view) {
    return `<table class="pi-files"><thead><tr><th>项目</th><th>设定+大纲</th><th>讨论记录</th></tr></thead><tbody>${view.data.index().projects.map(
      (item) => `<tr><td>${esc(item.group ? `${item.group}／` : "")}${esc(item.name)}</td>
        ${fileCell(view, projectFile(item.id), item.bytes.project)}${fileCell(view, chatFile(item.id), item.bytes.chat)}</tr>`
    ).join("") || '<tr><td colspan="3" class="pi-hint">没有项目</td></tr>'}</tbody></table>`;
  }
  function render9(view) {
    let s = st7(view);
    !s.verified && !s.verifying && verify(view);
    let orphans = s.verified ? Object.keys(s.verified).filter((name) => !referenced(view.data.index()).has(name)) : [], settings = view.data.settings();
    return `<div class="pi-card"><h3>本地文件</h3>
        ${filesTable(view)}
        <div class="pi-equal pi-acts"><button type="button" class="pi-btn is-sm" data-act="verify">${s.verifying ? '<span class="pi-spin"></span>' : ""}重新核对</button>
            <button type="button" class="pi-btn is-sm" data-act="orphans"${orphans.length ? "" : " disabled"}>清理孤立文件${orphans.length ? `（${orphans.length}）` : ""}</button>
            <button type="button" class="pi-btn is-sm" data-act="clear-chats">清空全部讨论记录</button></div></div>
        <div class="pi-card"><h3>人设备份</h3>
        <p class="pi-hint">只导出各项目的人设线，不含大纲、设定和讨论。导入在项目的「人设」页。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm" data-act="export-personas">导出全部项目的人设</button></div></div>
        ${versionCard(view, settings)}
        <div class="pi-card"><h3>重置插件</h3>
        <p class="pi-hint">删除所有项目、讨论记录和当前聊天的进度，执行前自动下载备份。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm is-danger" data-act="wipe">备份并删除</button></div></div>`;
  }
  function onChange6(view, target) {
    if (target.dataset.set !== "loaderRef") return;
    let ref = target.value.trim();
    if (/^\d+\.\d+\.\d+$/.test(ref) && (ref = `v${ref}`), ref && ref !== "main" && !/^v\d+\.\d+\.\d+$/.test(ref)) {
      toast("warning", "版本号格式应为 v0.1.0 这样的三段数字，或填 main；未保存。"), target.value = view.data.settings().loaderRef;
      return;
    }
    target.value = ref, view.data.updateSettings({ loaderRef: ref }), toast("success", ref ? `已指定 ${ref}，刷新酒馆页面生效。` : "已改为跟随最新版本，刷新酒馆页面生效。");
  }
  async function verify(view) {
    let s = st7(view);
    s.verifying = !0;
    try {
      let names2 = [.../* @__PURE__ */ new Set([...view.data.index().files, ...referenced(view.data.index())])];
      s.verified = await verifyFiles(names2);
    } catch (error) {
      toast("error", error.message), s.verified = {};
    } finally {
      s.verifying = !1, view.renderBody();
    }
  }
  var actions9 = {
    "check-update"(view) {
      return checkLatest(view);
    },
    // 加载器把最新版本号缓存 30 分钟；清掉缓存再刷新，才会马上取到新版。
    async "update-now"(view) {
      let pinned = view.data.settings().loaderRef, body = pinned ? `将清空指定版本（${pinned}），改为跟随最新版本，然后刷新酒馆页面。` : "将刷新酒馆页面，载入最新版本。";
      await confirmDialog({ title: `更新到 v${latest.version}`, body, okLabel: "更新并刷新" }) && (pinned && (view.data.updateSettings({ loaderRef: "" }), await view.data.flush()), writeUi({ loader: null }), hostWindow().location.reload());
    },
    verify(view) {
      return st7(view).verified = null, verify(view);
    },
    async "export-file"(view, target) {
      await view.data.flush().catch(() => {
      });
      let text2 = await readRawFile(target.dataset.name);
      if (text2 == null) throw new Error("文件读取失败");
      downloadBlob(target.dataset.name, text2);
    },
    async "export-personas"(view) {
      let files = [];
      for (let item of view.data.index().projects) {
        let project = view.data.project(item.id) || await view.data.loadProject(item.id);
        !project || !project.personas || !project.personas.lines.length || files.push({
          name: `人设-${item.group ? `${item.group}-` : ""}${item.name}.json`,
          data: JSON.stringify(buildPersonaFile(project.personas, { project: item.name, version: view.version }), null, 2)
        });
      }
      if (!files.length) throw new Error("没有可导出的人设（项目里还没有人设线，或项目尚未载入）");
      files.length === 1 ? downloadBlob(files[0].name, files[0].data) : downloadBlob(
        `剧情注入器人设-${/* @__PURE__ */ (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`,
        buildZip(files),
        "application/zip"
      ), toast("success", `已导出 ${files.length} 个项目的人设。`);
    },
    async "delete-file"(view, target) {
      let name = target.dataset.name;
      if (!await confirmDialog({
        title: "删除文件",
        list: [name],
        body: name.startsWith("pi-p-") ? "这是项目的设定和大纲，删除后项目无法打开。" : "",
        okLabel: "删除",
        danger: !0
      }))
        return;
      let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
      name.startsWith("pi-c-") ? await view.data.clearChat(id) : name.startsWith("pi-p-") && await view.data.deleteProject(id), st7(view).verified = null, view.render();
    },
    async orphans(view) {
      let names2 = Object.keys(st7(view).verified || {}).filter(
        (name) => !referenced(view.data.index()).has(name) && st7(view).verified[name]
      ), gone = Object.keys(st7(view).verified || {}).filter(
        (name) => !referenced(view.data.index()).has(name) && !st7(view).verified[name]
      );
      if (!names2.length && gone.length) return view.data.forgetFiles(gone), st7(view).verified = null, view.renderBody();
      if (await confirmDialog({ title: "清理孤立文件", body: "这些文件不属于任何项目：", list: names2, okLabel: "删除", danger: !0 })) {
        for (let name of names2) await deleteFile(name);
        view.data.forgetFiles([...names2, ...gone]), st7(view).verified = null, view.renderBody();
      }
    },
    async "clear-chats"(view) {
      let ids = view.data.index().projects.map((item) => item.id);
      if (await confirmDialog({ title: "清空全部讨论记录", list: ids.map(chatFile), okLabel: "清空", danger: !0 })) {
        for (let id of ids) await view.data.clearChat(id);
        st7(view).verified = null, view.renderBody();
      }
    },
    async wipe(view) {
      await view.data.flush().catch(() => {
      });
      let index = view.data.index(), names2 = [.../* @__PURE__ */ new Set([...index.files, ...referenced(index)])], files = [];
      for (let name of names2) {
        let text2 = await readRawFile(name);
        text2 != null && files.push({ name, data: text2 });
      }
      if (!files.length) throw new Error("没有可清除的文件");
      if (downloadBlob(
        `剧情注入器备份-${/* @__PURE__ */ (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`,
        buildZip(files),
        "application/zip"
      ), !!await confirmDialog({
        title: "重置插件",
        body: "备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。",
        list: files.map((file) => file.name),
        okLabel: "全部删除",
        danger: !0
      })) {
        for (let file of files) await deleteFile(file.name);
        await clearChatProgress(), view.data.resetAll(), view.projectId = "", st7(view).verified = null, view.runtime.refresh(), view.render(), toast("success", "已全部清除。");
      }
    }
  }, refreshOn6 = ["index"];

  // src/ui/page-books.js
  var page_books_exports = {};
  __export(page_books_exports, {
    actions: () => actions10,
    onChange: () => onChange7,
    onInput: () => onInput5,
    refreshOn: () => refreshOn7,
    render: () => render10
  });
  var st8 = (view) => view.tabState("books"), GROUPS = {
    on: (entries) => entries.filter((entry) => !acuField(entry.title) && !entry.disabled),
    off: (entries) => entries.filter((entry) => !acuField(entry.title) && entry.disabled)
  }, toggle = (entry) => `<button type="button" class="pi-switch${entry.disabled ? "" : " is-on"}" role="switch" aria-checked="${entry.disabled ? "false" : "true"}" data-act="wb-toggle" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? "已关闭，点击开启" : "已开启，点击关闭"}"></button>`, norm = (text2) => String(text2 || "").trim().toLowerCase(), entryHit = (entry, q) => !q || [entry.title, entry.content, ...entry.keys, ...entry.keysSecondary].some((text2) => String(text2).toLowerCase().includes(q)), searchBox = (key, value, placeholder) => `<div class="pi-psearch is-wb">${ICONS.search}<input class="pi-inp" data-search="${key}" placeholder="${placeholder}" value="${esc(value || "")}">
    <button type="button" class="pi-icon-btn pi-search-x" data-act="search-close" title="关闭搜索">${ICONS.close}</button></div>`, title = (entry) => `<span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>`, num2 = (value) => value || "";
  function advanced(entry, key, open) {
    let field2 = (f, label, value, attrs = 'type="number" min="0"') => `<label class="pi-field"><span>${label}</span><input class="pi-inp" ${attrs} data-wb-edit="${key}" data-f="${f}" value="${esc(value)}"></label>`, check = (f, label, on) => `<label class="pi-check"><input type="checkbox" data-wb-edit="${key}" data-f="${f}"${on ? " checked" : ""}><span>${label}</span></label>`;
    return `<button type="button" class="pi-wb-adv" data-act="wb-adv" data-key="${key}">${open ? ICONS.caretDown : ICONS.caret}<span>高级</span></button>
        ${open ? `<div class="pi-wb-adv-bd"><div class="pi-pair">${field2("probability", "概率（0-100）", entry.probability, 'type="number" min="0" max="100"')}${field2("groupWeight", "组权重", entry.groupWeight)}</div>
        ${field2("group", "分组", entry.group, 'type="text"')}
        <div class="pi-pair is-c3">${field2("sticky", "粘性", num2(entry.sticky))}${field2("cooldown", "冷却", num2(entry.cooldown))}${field2("delay", "延迟", num2(entry.delay))}</div>
        <div class="pi-pair">${check("excludeRecursion", "不可被递归触发", entry.excludeRecursion)}${check("preventRecursion", "阻止进一步递归", entry.preventRecursion)}</div></div>` : ""}`;
  }
  function editor(entry, adv) {
    let atDepth = entry.position === 4, key = esc(entry.key);
    return `<div class="pi-wb-edit">
        <label class="pi-field"><span>标题</span><input class="pi-inp" data-wb-edit="${key}" data-f="comment" value="${esc(entry.comment)}"></label>
        <div class="pi-pair ${atDepth ? "is-c4" : ""}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" data-wb-edit="${key}" data-f="position">${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" data-wb-edit="${key}" data-f="depth" value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" data-wb-edit="${key}" data-f="role">${options(ROLES, entry.role)}</select></label>` : ""}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" data-wb-edit="${key}" data-f="order" value="${entry.order}"></label>
        </div>
        <label class="pi-field"><span>触发方式</span><select class="pi-sel" data-wb-edit="${key}" data-f="constant">${options([{ value: "1", label: "常驻" }, { value: "0", label: "关键词触发" }], entry.constant ? "1" : "0")}</select></label>
        ${entry.constant ? "" : `<label class="pi-field"><span>主要关键词（逗号分隔）</span><input class="pi-inp" data-wb-edit="${key}" data-f="key" value="${esc(entry.keys.join("，"))}"></label>
        <label class="pi-field"><span>次要关键词（可空）</span><input class="pi-inp" data-wb-edit="${key}" data-f="keysecondary" value="${esc(entry.keysSecondary.join("，"))}"></label>`}
        <label class="pi-field"><span>内容</span><textarea class="pi-ta" rows="6" data-wb-edit="${key}" data-f="content">${esc(entry.content)}</textarea></label>
        ${advanced(entry, key, adv)}
    </div>`;
  }
  function entryRow2(entry, open, adv) {
    return `<div class="pi-wb-item"><div class="pi-wb-row${entry.disabled ? " is-off" : ""}">${toggle(entry)}
        <button type="button" class="pi-wb-name" data-act="wb-open" data-key="${esc(entry.key)}">${open ? ICONS.caretDown : ICONS.caret}${title(entry)}</button>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ""}
        <button type="button" class="pi-icon-btn" data-act="wb-dup" data-key="${esc(entry.key)}" title="复制条目">${ICONS.copy}</button>
        <button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button></div>
        ${open ? editor(entry, adv) : ""}</div>`;
  }
  function pickRow(entry, picked) {
    return `<label class="pi-wb-row${entry.disabled ? " is-off" : ""}"><input type="checkbox" data-wb-pick="${esc(entry.key)}"${picked.has(entry.key) ? " checked" : ""}>
        ${title(entry)}<span class="pi-badge">顺序 ${entry.order}</span></label>`;
  }
  var bulkBtn = (attrs, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" ${attrs}${disabled ? " disabled" : ""}>${label}</button>`;
  function section(name, entries, empty, bulk, openKey, picked, advOpen) {
    let rows2 = entries.map((entry) => picked ? pickRow(entry, picked) : entryRow2(entry, entry.key === openKey, !!(advOpen && advOpen.has(entry.key)))).join("");
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${name}<small>${entries.length}</small>${entries.length ? `<span class="pi-wb-bulk">${bulk}</span>` : ""}</div>
        ${rows2 || `<p class="pi-hint">${empty}</p>`}</div>`;
  }
  function tokenText(s) {
    if (!s.tokens) return '<span class="pi-meta">统计中…</span>';
    let mark = s.tokens.exact ? "" : "≈";
    return `<span class="pi-meta">开启 ${mark}${s.tokens.on} · 全部 ${mark}${s.tokens.all} token</span>`;
  }
  var tbtn = (act, icon, label, { danger = !1, disabled = !1 } = {}) => `<button type="button" class="pi-tbtn${danger ? " is-danger" : ""}" data-act="${act}"${disabled ? " disabled" : ""}>${ICONS[icon]}<span>${label}</span></button>`, moreBtn = (act) => `<button type="button" class="pi-tbtn is-more" data-act="${act}" title="更多">${ICONS.more}</button>`;
  function bookBar(s, entries) {
    if (!s.picking) {
      let none2 = !handwritten(entries).length;
      return `<div class="pi-tbar">${tbtn("wb-add", "entryPlus", "新建条目")}${tbtn("wb-picking", "checks", "批量", { disabled: none2 })}
            ${tbtn("wb-regex", "replace", "替换", { disabled: none2 })}${tbtn("wb-search", "search", "搜索", { disabled: !entries.length })}${tbtn("wb-undo", "undo", "撤销", { disabled: !undoStack(s.book).length })}${moreBtn("book-more")}</div>`;
    }
    let none = !s.picked.size;
    return `<div class="pi-tbar">${tbtn("wb-move", "move", "迁移", { disabled: none })}${tbtn("wb-order", "sort", "重排", { disabled: none })}
        ${tbtn("wb-regex", "replace", "替换", { disabled: none })}${tbtn("wb-pick-delete", "trash", "删除", { danger: !0, disabled: none })}${moreBtn("pick-more")}</div>`;
  }
  var SORTS = [{ value: "", label: "原顺序" }, { value: "order", label: "顺序值" }, { value: "tokens", label: "token 从大到小" }, { value: "title", label: "标题" }], tokenOf = (s) => (entry) => s.tokenMap && s.tokenMap.has(entry.key) ? s.tokenMap.get(entry.key) : estimateTokens(entry.content), sortList = (s, list) => sortEntries(list, s.sort, tokenOf(s)), UNDO_MAX = 10, undoStacks = /* @__PURE__ */ new Map(), undoStack = (name) => undoStacks.get(name) || [];
  async function snap(view, label, merge = "") {
    let name = st8(view).book;
    if (merge && undoStack(name).at(-1)?.merge === merge) return;
    let entries = await snapshotEntries(name), stack = undoStack(name);
    if (merge && stack.at(-1)?.merge === merge) return;
    undoStacks.set(name, [...stack, { label, entries, merge }].slice(-UNDO_MAX));
    let btn = hostDocument().querySelector('.pi-root [data-act="wb-undo"]');
    btn && (btn.disabled = !1);
  }
  var shownEntries = (s) => (s.entries || []).filter((entry) => entryHit(entry, norm(s.query)));
  function bookBody(s, allEntries) {
    let picked = s.picking ? s.picked : null, q = norm(s.query), entries = shownEntries(s), on = sortList(s, GROUPS.on(entries)), off = sortList(s, GROUPS.off(entries)), all = picked && handwritten(entries).length && handwritten(entries).every((entry) => picked.has(entry.key)), info = picked ? `<div class="pi-wb-info is-pick"><span class="pi-wb-count">已选 ${picked.size} 条</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-pick-all">${all ? "取消全选" : "全选"}</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-picking">完成</button></div>` : `<div class="pi-wb-info"><span class="pi-wb-tokens">${tokenText(s)}</span></div>`, sorter = `<div class="pi-wb-sort"><span class="pi-meta">排序</span><select class="pi-sel" data-wb-sort>${options(SORTS, s.sort || "")}</select></div>`, head = `${info}${bookBar(s, allEntries)}${s.search === "entry" && allEntries.length ? searchBox("entry", s.query, "搜索条目标题、关键词、内容") : ""}${allEntries.length ? sorter : ""}`;
    return allEntries.length ? entries.length ? picked ? `${head}${section("已开启", on, "没有开启的条目", "", "", picked)}
            ${section("已关闭", off, "没有关闭的条目", "", "", picked)}` : `${head}${section("已开启", on, "没有开启的条目", bulkBtn('data-act="wb-bulk" data-group="on"', "全部关闭"), s.openKey, null, s.advOpen)}
        ${section("已关闭", off, "没有关闭的条目", bulkBtn('data-act="wb-bulk" data-group="off"', "全部开启"), s.openKey, null, s.advOpen)}
        ${acuSection(entries, s.openFields || /* @__PURE__ */ new Set(), !!q)}` : `${head}<p class="pi-hint">没有匹配的条目</p>` : `${head}<p class="pi-hint">没有条目</p>`;
  }
  function acuSection(entries, openFields, expandAll = !1) {
    let fields = groupByField(entries);
    if (!fields.length) return "";
    let total = fields.reduce((sum, [, list]) => sum + list.length, 0), sub = ([field2, list]) => {
      let on = list.filter((entry) => !entry.disabled).length, bulk = bulkBtn(`data-act="acu-field" data-field="${esc(field2)}" data-on="1"`, "一键开启", on === list.length) + bulkBtn(`data-act="acu-field" data-field="${esc(field2)}" data-on="0"`, "一键关闭", !on), open = expandAll || openFields.has(field2);
      return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd is-fold" data-act="acu-fold" data-field="${esc(field2)}">${open ? ICONS.caretDown : ICONS.caret}<span class="pi-wb-field" title="${esc(field2)}">${esc(field2)}</span><small>${on}/${list.length}</small><span class="pi-wb-bulk">${bulk}</span></div>
            ${open ? list.map((entry) => `<div class="pi-wb-row${entry.disabled ? " is-off" : ""}">${toggle(entry)}${title(entry)}</div>`).join("") : ""}</div>`;
    };
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${total}</small></div>${fields.map(sub).join("")}</div>`;
  }
  function listedBooks(s) {
    let books = [...boundBookNames()], add = (name, source) => {
      books.some((item) => item.name === name) || books.push({ name, source });
    }, names2 = allBookNames();
    for (let name of globalBookNames()) names2.includes(name) && add(name, "全局");
    for (let name of names2) name.startsWith("剧情注入器·") && add(name, "专用");
    for (let name of s.extra || []) names2.includes(name) && add(name, "其他");
    return books;
  }
  function shownBooks(s) {
    let q = norm(s.bookQuery), listed = listedBooks(s);
    if (!q) return listed;
    let hit = (name) => name.toLowerCase().includes(q), others = allBookNames().filter((name) => hit(name) && !listed.some((book) => book.name === name)).map((name) => ({ name, source: "其他" }));
    return [...listed.filter((book) => hit(book.name)), ...others];
  }
  function render10(view) {
    let s = st8(view), list = shownBooks(s).map((book) => {
      let open = s.book === book.name, entries = open && s.entries ? s.entries : null;
      return `<div class="pi-book${open ? " is-open" : ""}"><div class="pi-book-hd" data-act="open-book" data-book="${esc(book.name)}">
            ${open ? ICONS.caretDown : ICONS.caret}<span class="pi-etitle" title="${esc(book.name)}">${esc(book.name)}</span><span class="pi-meta">${esc(book.source)}</span></div>
            ${entries ? `<div class="pi-book-bd">${bookBody(s, entries)}</div>` : ""}</div>`;
    }).join("");
    return `<div class="pi-card pi-wb"><h3>世界书<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="book-new">${ICONS.plus}新建</button>
            <button type="button" class="pi-icon-btn" data-act="page-more" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint is-warn">注意：这里的操作真的会修改你的世界书！</p>
        ${s.search === "book" ? searchBox("book", s.bookQuery, "搜索所有世界书") : ""}
        ${list || `<p class="pi-hint">${norm(s.bookQuery) ? "没有匹配的世界书" : "没有关联或全局启用的世界书，可从「更多」搜索或打开其他世界书。"}</p>`}</div>`;
  }
  function editPatch(target) {
    let field2 = target.dataset.f, value = target.value;
    if (field2 === "constant") return { constant: value === "1" };
    if (field2 === "key" || field2 === "keysecondary") return { [field2]: splitKeys(value) };
    if (field2 === "position" || field2 === "role") return { [field2]: Number(value) };
    if (field2 === "depth" || field2 === "order") return { [field2]: Math.max(0, Math.round(Number(value) || 0)) };
    if (field2 === "content" || field2 === "comment" || field2 === "group") return { [field2]: value };
    if (field2 === "probability") {
      let n = String(value).trim() === "" ? 100 : Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
      return { probability: n, useProbability: n < 100 };
    }
    return field2 === "groupWeight" ? { groupWeight: String(value).trim() === "" ? 100 : Math.max(0, Math.round(Number(value) || 0)) } : field2 === "sticky" || field2 === "cooldown" || field2 === "delay" ? { [field2]: value === "" ? null : Math.max(0, Math.round(Number(value) || 0)) } : field2 === "excludeRecursion" || field2 === "preventRecursion" ? { [field2]: !!target.checked } : null;
  }
  async function saveEdit(view, target) {
    let key = target.dataset.wbEdit, patch = editPatch(target);
    !patch || !(st8(view).entries || []).some((item) => item.key === key) || (await snap(view, "编辑条目", `${key}:${target.dataset.f}`), await updateEntry(st8(view).book, key, patch), st8(view).entries = bookEntries(await loadBook(st8(view).book)), (target.tagName === "SELECT" || target.dataset.f === "comment") && view.renderBody());
  }
  function onInput5(view, target, event) {
    !target.dataset.search || event.isComposing || (st8(view)[target.dataset.search === "book" ? "bookQuery" : "query"] = target.value, view.renderBody());
  }
  async function onChange7(view, target) {
    if (target.dataset.wbSort !== void 0)
      return st8(view).sort = target.value, view.renderBody();
    if (target.dataset.wbPick) {
      let picked = st8(view).picked;
      return target.checked ? picked.add(target.dataset.wbPick) : picked.delete(target.dataset.wbPick), view.renderBody();
    }
    if (target.dataset.wbEdit) return saveEdit(view, target);
  }
  async function reloadBook(view) {
    let s = st8(view);
    s.entries = bookEntries(await loadBook(s.book));
    let keys = new Set(s.entries.map((entry) => entry.key));
    s.picked = new Set([...s.picked || []].filter((key) => keys.has(key))), view.renderBody(), countBook(view);
  }
  var tokenCache = /* @__PURE__ */ new Map(), TOKEN_CACHE_MAX = 3e3, TOKEN_BATCH = 8;
  async function entryTokens(text2) {
    if (tokenCache.has(text2)) return tokenCache.get(text2);
    let count = await countTokens(text2);
    return count == null ? null : (tokenCache.size >= TOKEN_CACHE_MAX && tokenCache.delete(tokenCache.keys().next().value), tokenCache.set(text2, count), count);
  }
  async function countBook(view) {
    let s = st8(view), book = s.book, entries = s.entries || [], counts = [];
    for (let i = 0; i < entries.length; i += TOKEN_BATCH)
      if (counts.push(...await Promise.all(entries.slice(i, i + TOKEN_BATCH).map((entry) => entry.content ? entryTokens(entry.content) : 0))), s.book !== book || s.entries !== entries) return;
    let exact = counts.every((count) => count != null), on = 0, all = 0;
    entries.forEach((entry, index) => {
      let n = exact ? counts[index] : estimateTokens(entry.content);
      all += n, entry.disabled || (on += n);
    }), s.tokens = { on, all, exact }, s.tokenMap = new Map(entries.map((entry, index) => [entry.key, exact ? counts[index] : estimateTokens(entry.content)])), s.sort === "tokens" && view.renderBody();
    let box = hostDocument().querySelector(".pi-wb-tokens");
    box && (box.innerHTML = tokenText(s));
  }
  var handwritten = (entries) => entries.filter((entry) => !acuField(entry.title)), pickedEntries = (s) => handwritten(s.entries || []).filter((entry) => s.picked.has(entry.key)), PREVIEW_MAX = 30, previewList = (lines2) => lines2.length > PREVIEW_MAX ? [...lines2.slice(0, PREVIEW_MAX), `另有 ${lines2.length - PREVIEW_MAX} 条`] : lines2;
  async function applyPatches(view, plan, { label, backup = !1 }) {
    let s = st8(view);
    await snap(view, label);
    let result = await patchEntries(s.book, plan.map((item) => ({ key: item.key, patch: item.patch })));
    backup && downloadBlob(`${s.book}-${label}前备份.json`, JSON.stringify(result, null, 2)), toast("success", `${label}：已修改 ${plan.length} 条。`), await reloadBook(view);
  }
  async function regexDialog(scope) {
    let check = (f, label, on = !1) => `<label class="pi-check"><input type="checkbox" data-f="${f}"${on ? " checked" : ""}><span>${label}</span></label>`, html = `<label class="pi-field"><span>查找</span><input class="pi-inp is-mono" data-f="find" placeholder="如：旧名字 或 \\d+"></label>
        <label class="pi-field"><span>替换为</span><input class="pi-inp is-mono" data-f="replace" placeholder="留空即删除；正则可用 $1"></label>
        <div class="pi-field"><span>查找方式</span><div class="pi-pair is-c3">${check("regex", "正则表达式", !0)}${check("ignoreCase", "忽略大小写")}</div></div>
        <div class="pi-field"><span>替换范围</span><div class="pi-pair is-c3">${check("content", "内容", !0)}${check("comment", "标题")}${check("keys", "关键词")}</div></div>`;
    return openDialog({
      title: `正则替换（${scope}）`,
      html,
      actions: [{ label: "取消", value: null }, { label: "预览", primary: !0, value: (box) => {
        let read = (f) => box.querySelector(`[data-f="${f}"]`);
        return { find: read("find").value, replace: read("replace").value, regex: read("regex").checked, ignoreCase: read("ignoreCase").checked, fields: { content: read("content").checked, comment: read("comment").checked, keys: read("keys").checked } };
      } }]
    });
  }
  function moveDialog(from, count) {
    let names2 = allBookNames().filter((name) => name !== from), html = `<label class="pi-field"><span>目标世界书</span><select class="pi-sel" data-f="book">${options([{ value: "", label: names2.length ? "选择已有世界书" : "没有其他世界书" }, ...names2.map((name) => ({ value: name, label: name }))], "")}</select></label>
        <label class="pi-field"><span>或新建世界书</span><input class="pi-inp" data-f="name" placeholder="填写名字即新建，优先于上一项"></label>
        <label class="pi-field"><span>方式</span><select class="pi-sel" data-f="mode">${options([{ value: "copy", label: "复制（原世界书保留）" }, { value: "move", label: "移动（从原世界书删除）" }], "copy")}</select></label>`;
    return openDialog({
      title: `迁移到其他世界书（已选 ${count} 条）`,
      html,
      actions: [{ label: "取消", value: null }, { label: "下一步", primary: !0, value: (box) => ({ to: box.querySelector('[data-f="name"]').value.trim() || box.querySelector('[data-f="book"]').value, move: box.querySelector('[data-f="mode"]').value === "move" }) }]
    });
  }
  function orderDialog(count) {
    let html = `<div class="pi-pair"><label class="pi-field"><span>起始数字</span><input class="pi-inp" type="number" min="0" data-f="start" value="100"></label>
            <label class="pi-field"><span>间隔</span><input class="pi-inp" type="number" min="1" data-f="step" value="1"></label></div>
        <label class="pi-field"><span>排列依据</span><select class="pi-sel" data-f="by">${options([{ value: "list", label: "按列表中的先后" }, { value: "order", label: "按原有顺序值（保持相对先后）" }], "list")}</select></label>`;
    return openDialog({
      title: `顺序重排（已选 ${count} 条）`,
      html,
      actions: [{ label: "取消", value: null }, { label: "预览", primary: !0, value: (box) => ({ start: box.querySelector('[data-f="start"]').value, step: box.querySelector('[data-f="step"]').value, by: box.querySelector('[data-f="by"]').value }) }]
    });
  }
  var actions10 = {
    // 整区一次改完：「全部关闭」关已开启区，「全部开启」开已关闭区；数据库条目不在其中。
    async "wb-bulk"(view, target) {
      let group = target.dataset.group, pick = GROUPS[group];
      if (!pick) return;
      let keys = pick(shownEntries(st8(view))).map((entry) => entry.key);
      keys.length && (target.disabled = !0, await snap(view, "整区开关"), await setEntriesDisabled(st8(view).book, keys, group === "on"), await reloadBook(view));
    },
    async "wb-toggle"(view, target) {
      let key = target.dataset.wbToggle, entry = (st8(view).entries || []).find((item) => item.key === key);
      entry && (target.disabled = !0, await snap(view, "开关条目"), await setEntriesDisabled(st8(view).book, [key], !entry.disabled), await reloadBook(view));
    },
    "wb-open"(view, target) {
      let s = st8(view);
      s.openKey = s.openKey === target.dataset.key ? "" : target.dataset.key, view.renderBody();
    },
    "acu-fold"(view, target, event) {
      if (event.target.closest("button")) return;
      let s = st8(view), open = new Set(s.openFields || []);
      open.has(target.dataset.field) ? open.delete(target.dataset.field) : open.add(target.dataset.field), s.openFields = open, view.renderBody();
    },
    // 一个字段的数据库条目整体开或关（写进世界书）。
    async "acu-field"(view, target) {
      let on = target.dataset.on === "1", keys = shownEntries(st8(view)).filter((entry) => acuField(entry.title) === target.dataset.field && entry.disabled === on).map((entry) => entry.key);
      keys.length && (target.disabled = !0, await snap(view, "数据库字段开关"), await setEntriesDisabled(st8(view).book, keys, !on), await reloadBook(view));
    },
    async "open-book"(view, target, event) {
      if (event.target.closest("button,input")) return;
      let s = st8(view);
      if (s.book === target.dataset.book)
        return s.book = "", s.entries = null, view.renderBody();
      await openBook(view, target.dataset.book);
    },
    async "book-new"(view) {
      let name = await promptDialog({ title: "新建世界书", label: "名称" });
      name != null && (await openBook(view, await createBook(name)), toast("success", `已新建「${name.trim()}」。`));
    },
    // 导入酒馆导出的世界书 json（{ entries: {...} }），名字默认取文件名，重名时另起名字。
    async "book-import"(view) {
      let [file] = await pickFiles({ accept: ".json,application/json" });
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("文件不是有效的 JSON");
      }
      if (!data || typeof data.entries != "object" || Array.isArray(data.entries)) throw new Error("文件里没有世界书条目（entries）");
      let name = file.name.replace(/\.json$/i, "");
      allBookNames().includes(name) && (name = await promptDialog({ title: "导入世界书", label: `已有「${name}」，请换一个名字`, value: `${name}-导入` }), name == null) || (await openBook(view, await createBook(name, data)), toast("success", `已导入「${name.trim()}」，${Object.keys(data.entries).length} 条。`));
    },
    async "book-open"(view) {
      let shown = new Set(listedBooks(st8(view)).map((book) => book.name)), names2 = allBookNames().filter((name2) => !shown.has(name2));
      if (!names2.length) return toast("info", "没有其他世界书。");
      let name = await menuDialog({ title: "打开其他世界书", items: names2.map((item) => ({ label: item, value: item, icon: ICONS.book })) });
      name && await openBook(view, name);
    },
    async "book-rename"(view) {
      let from = st8(view).book, to = await promptDialog({ title: "重命名世界书", label: "新名称", value: from });
      if (to == null || to.trim() === from) return;
      let result = await renameBook(from, to);
      undoStacks.delete(from), result.failed.length ? toast("warning", `已另存为「${result.name}」，但${result.failed.join("、")}的绑定没能改过去，旧书「${from}」保留，请在酒馆里手动改绑定后删除。`) : toast("success", `已重命名为「${result.name}」。`), await openBook(view, result.name);
    },
    async "book-copy"(view) {
      let s = st8(view), to = await promptDialog({ title: "另存副本", label: "副本名称", value: `${s.book}-副本` });
      if (to == null) return;
      let name = await duplicateBook(s.book, to);
      s.extra = [.../* @__PURE__ */ new Set([...s.extra || [], name])], toast("success", `已另存为「${name}」。`), view.renderBody();
    },
    async "book-export"(view) {
      let s = st8(view);
      downloadBlob(`${s.book}.json`, JSON.stringify(await loadBook(s.book), null, 2));
    },
    async "book-delete"(view) {
      let s = st8(view), name = s.book;
      if (!await confirmDialog({ title: `删除世界书「${name}」`, body: "先下载整本备份，再删除并解除聊天、角色卡和全局的绑定，无法撤销。", list: [`${s.entries.length} 条条目`], okLabel: "删除", danger: !0 })) return;
      downloadBlob(`${name}-备份.json`, JSON.stringify(await loadBook(name), null, 2));
      let result = await removeBook(name);
      undoStacks.delete(name), result.failed.length ? toast("warning", `已删除，但${result.failed.join("、")}的绑定没能解除，请在酒馆里检查。`) : toast("success", `已删除「${name}」。`), s.book = "", s.entries = null, s.extra = (s.extra || []).filter((item) => item !== name), view.renderBody();
    },
    "book-search"(view) {
      openSearch(view, "book");
    },
    "wb-search"(view) {
      if (st8(view).search === "entry") return actions10["search-close"](view);
      openSearch(view, "entry");
    },
    "search-close"(view) {
      let s = st8(view);
      s.search = "", s.query = "", s.bookQuery = "", view.renderBody();
    },
    async "wb-add"(view) {
      let s = st8(view);
      await snap(view, "新建条目");
      let [key] = await addEntries(s.book);
      await reloadBook(view), s.openKey = key, view.renderBody();
    },
    async "wb-dup"(view, target) {
      await snap(view, "复制条目"), await addEntries(st8(view).book, [target.dataset.key]), await reloadBook(view);
    },
    // 「更多」菜单：页面级、整本书级、选中条目级各一份，选中后转给对应的操作。
    async "page-more"(view, target, event) {
      let pick = await menuDialog({ title: "世界书", items: [
        { label: "导入世界书", value: "book-import", icon: ICONS.upload },
        { label: "搜索世界书", value: "book-search", icon: ICONS.search },
        { label: "打开其他世界书", value: "book-open", icon: ICONS.folder }
      ] });
      if (pick) return actions10[pick](view, target, event);
    },
    async "book-more"(view, target, event) {
      let pick = await menuDialog({ title: st8(view).book, items: [
        { label: "触发测试", value: "wb-trigger", icon: ICONS.search },
        { label: "体检", value: "wb-health", icon: ICONS.pulse },
        { label: "重命名", value: "book-rename", icon: ICONS.pencil },
        { label: "另存副本", value: "book-copy", icon: ICONS.copy },
        { label: "导出", value: "book-export", icon: ICONS.download },
        { label: "删除本书", value: "book-delete", icon: ICONS.trash, danger: !0 }
      ] });
      if (pick) return actions10[pick](view, target, event);
    },
    async "pick-more"(view, target, event) {
      let pick = await menuDialog({ title: `已选 ${st8(view).picked.size} 条`, items: [
        { label: "开启", value: "wb-pick-on", icon: ICONS.eye },
        { label: "关闭", value: "wb-pick-off", icon: ICONS.eyeOff }
      ] });
      if (pick) return actions10[pick](view, target, event);
    },
    "wb-pick-on": (view) => setPicked(view, !1),
    "wb-pick-off": (view) => setPicked(view, !0),
    async "wb-pick-delete"(view) {
      let s = st8(view), entries = pickedEntries(s);
      if (!await confirmDialog({ title: `从「${s.book}」删除 ${entries.length} 条`, body: "删除前会下载这些条目的备份。", list: previewList(entries.map((entry) => entry.title)), okLabel: "删除", danger: !0 })) return;
      await snap(view, "批量删除");
      let backup = await deleteEntries(s.book, entries.map((entry) => entry.key));
      downloadBlob(`${s.book}-已删条目备份.json`, JSON.stringify(backup, null, 2)), s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
    },
    "wb-picking"(view) {
      let s = st8(view);
      s.picking = !s.picking, s.picked = /* @__PURE__ */ new Set(), s.openKey = "", view.renderBody();
    },
    "wb-pick-all"(view) {
      let s = st8(view), list = handwritten(shownEntries(s)), all = list.every((entry) => s.picked.has(entry.key)), picked = new Set(s.picked);
      for (let entry of list) all ? picked.delete(entry.key) : picked.add(entry.key);
      s.picked = picked, view.renderBody();
    },
    // 关键词里写成「甲，乙、丙」的一整条拆成三个，去掉首尾标点与空格、重复项；/正则/ 形式的关键词不动。
    async "wb-punct"(view) {
      let s = st8(view), plan = punctPlan(handwritten(s.entries || []));
      if (!plan.length) return toast("info", "关键词没有需要修复的标点。");
      await confirmDialog({ title: `修复关键词标点（${plan.length} 条）`, body: "以下条目的关键词将改为：", list: previewList(plan.map((item) => `${item.title}：${item.before} → ${item.after}`)), okLabel: "修复" }) && await applyPatches(view, plan, { label: "修复关键词标点" });
    },
    async "wb-regex"(view) {
      let s = st8(view), usePicked = s.picking && s.picked.size, entries = usePicked ? pickedEntries(s) : handwritten(s.entries || []), input2 = await regexDialog(usePicked ? `已选 ${entries.length} 条` : `全部手写条目 ${entries.length} 条`);
      if (!input2) return;
      if (!input2.fields.content && !input2.fields.comment && !input2.fields.keys) throw new Error("请至少选择一个替换范围");
      let plan = regexPlan(entries, buildPattern(input2.find, input2), input2.replace, input2.fields);
      if (!plan.length) return toast("info", "没有匹配的内容。");
      let total = plan.reduce((sum, item) => sum + item.hits, 0);
      await confirmDialog({ title: `正则替换（${plan.length} 条，共 ${total} 处）`, body: "替换前会下载这些条目的备份。", list: previewList(plan.map((item) => `${item.title}：${item.hits} 处`)), okLabel: "替换", danger: !0 }) && await applyPatches(view, plan, { label: "正则替换", backup: !0 });
    },
    async "wb-order"(view) {
      let s = st8(view), input2 = await orderDialog(s.picked.size);
      if (!input2) return;
      let plan = orderPlan(pickedEntries(s), input2);
      await confirmDialog({ title: `顺序重排（${plan.length} 条）`, list: previewList(plan.map((item) => `${item.title}：${item.from} → ${item.to}`)), okLabel: "重排" }) && await applyPatches(view, plan.map((item) => ({ key: item.key, patch: { order: item.to } })), { label: "顺序重排" });
    },
    async "wb-move"(view) {
      let s = st8(view), input2 = await moveDialog(s.book, s.picked.size);
      if (!input2) return;
      if (!input2.to) throw new Error("请选择或填写目标世界书");
      let entries = pickedEntries(s), isNew = !allBookNames().includes(input2.to);
      if (!await confirmDialog({
        title: `${input2.move ? "移动" : "复制"}到「${input2.to}」${isNew ? "（新建）" : ""}`,
        body: input2.move ? "移动后从当前世界书删除，删除前会下载这些条目的备份。" : "",
        list: previewList(entries.map((entry) => entry.title)),
        okLabel: input2.move ? "移动" : "复制",
        danger: input2.move
      })) return;
      if (input2.move) {
        let raw = await loadBook(s.book);
        downloadBlob(`${s.book}-迁移前备份.json`, JSON.stringify({ entries: Object.fromEntries(entries.map((entry) => [entry.key, raw.entries[entry.key]])) }, null, 2));
      }
      input2.move && await snap(view, "迁移（移动）");
      let result = await transferEntries(s.book, input2.to, entries.map((entry) => entry.key), { move: input2.move });
      toast("success", `已${input2.move ? "移动" : "复制"} ${result.copied} 条到「${input2.to}」${result.created ? "（新建）" : ""}。`), s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
    },
    "wb-adv"(view, target) {
      let s = st8(view), open = new Set(s.advOpen || []);
      open.has(target.dataset.key) ? open.delete(target.dataset.key) : open.add(target.dataset.key), s.advOpen = open, view.renderBody();
    },
    async "wb-undo"(view) {
      let s = st8(view), stack = undoStack(s.book), last = stack.at(-1);
      last && await confirmDialog({ title: `撤销：${last.label}`, body: "整本世界书将写回该操作之前的状态。本书在这之后的其他改动也会一并撤回。", okLabel: "撤销", danger: !0 }) && (await restoreEntries(s.book, last.entries), undoStacks.set(s.book, stack.slice(0, -1)), toast("success", `已撤销：${last.label}`), await reloadBook(view));
    },
    // 触发测试：文本框可贴文字，也可取最近 N 楼；按酒馆规则模拟当前书的触发（不含递归、概率、分组）。
    async "wb-trigger"(view) {
      let s = st8(view), entries = handwritten(s.entries || []), tk = tokenOf(s), row2 = (item, extra) => `<div class="pi-wb-hit"><span class="pi-wb-title" title="${esc(item.title)}">${esc(item.title)}</span><span class="pi-meta">${extra}${item.tokens} token</span></div>`, group = (name, list, extra) => list.length ? `<div class="pi-wb-sec-hd">${name}<small>${list.length}</small></div>${list.map((item) => row2(item, extra(item))).join("")}` : "", run = (box) => {
        let text2 = box.querySelector('[data-f="text"]').value, globals = worldInfoMatchSettings(), result = triggerTest(entries, text2, tk, globals), body = group("常驻", result.constant, () => "") + group("关键词命中", result.keyword, (item) => `${esc(item.matched.join("、"))} · `);
        box.querySelector('[data-f="result"]').innerHTML = `${body || '<p class="pi-hint">没有命中的条目</p>'}
                <p class="pi-meta">合计 ${result.tokens.total} token（常驻 ${result.tokens.constant}，关键词 ${result.tokens.keyword}）</p>
                <p class="pi-meta">未计算递归、概率、分组与扫描深度</p>${globals.known ? "" : '<p class="pi-meta">未读到酒馆全局匹配设置，按不区分大小写、不全词匹配计算</p>'}`;
      };
      await openDialog({
        title: "触发测试",
        html: `<label class="pi-field"><span>测试文字</span><textarea class="pi-ta" rows="5" data-f="text"></textarea></label>
                <div class="pi-pair"><label class="pi-field"><span>最近楼层数</span><input class="pi-inp" type="number" min="1" data-f="count" value="5"></label>
                <div class="pi-field"><span>&nbsp;</span><button type="button" class="pi-btn" data-f="fetch">取最近 N 楼</button></div></div>
                <div data-f="result"></div>`,
        actions: [{ label: "关闭", value: null }, { label: "测试", primary: !0, value: (box) => {
          run(box);
        } }],
        onMount: (box) => box.querySelector('[data-f="fetch"]').addEventListener("click", () => {
          let n = Math.max(1, Math.round(Number(box.querySelector('[data-f="count"]').value) || 5)), floors = chatMessages().filter((msg) => msg && !(msg.is_system && msg.extra && msg.extra.type) && String(msg.mes || "").trim()).slice(-n);
          box.querySelector('[data-f="text"]').value = floors.map((msg) => String(msg.mes)).join(`

`), run(box);
        })
      });
    },
    // 体检：只看手写条目；问题按类列出，点条目跳转并展开。
    async "wb-health"(view, target, event) {
      let s = st8(view), entries = handwritten(s.entries || []), report = healthCheck(entries, tokenOf(s)), punct = punctPlan(entries), item = (key, name, detail = "") => `<button type="button" class="pi-menu-item" data-dlg-value="${esc(key)}"><span>${esc(name)}</span>${detail ? `<span class="pi-meta">${esc(detail)}</span>` : ""}</button>`, sec = (name, list, build) => list.length ? `<div class="pi-wb-sec-hd">${name}<small>${list.length}</small></div><div class="pi-menu-list">${list.map(build).join("")}</div>` : "", c = report.constant, html = `${sec("过短的关键词", report.shortKeys, (x) => item(x.key, x.title, x.words.join("、")))}
            ${sec("没有主要关键词的开启条目", report.noKeys, (x) => item(x.key, x.title))}
            ${sec("多个条目共用的关键词", report.shared, (x) => item(x.entries[0].key, x.word, x.entries.map((e) => e.title).join("、")))}
            ${sec("标题重复", report.dupTitles, (x) => item(x.entries[0].key, x.title, `${x.entries.length} 条`))}
            ${punct.length ? `<div class="pi-wb-sec-hd">关键词标点<small>${punct.length}</small></div><div class="pi-menu-list">${item("::punct", "修复关键词标点", `${punct.length} 条`)}</div>` : ""}
            <div class="pi-wb-sec-hd">常驻条目</div>
            <p class="${c.warn ? "pi-hint is-warn" : "pi-meta"}">${c.count} 条，${c.tokens} token，占开启条目 ${Math.round(c.ratio * 100)}%${c.warn ? "，占比偏高" : ""}</p>`, pick = await openDialog({ title: "体检", html, actions: [{ label: "关闭", value: null }] });
      if (pick) {
        if (pick === "::punct") return actions10["wb-punct"](view, target, event);
        s.picking = !1, s.query = "", s.search === "entry" && (s.search = ""), s.openKey = pick, view.renderBody(), [...hostDocument().querySelectorAll(".pi-root .pi-wb-name")].find((node) => node.dataset.key === pick)?.scrollIntoView({ block: "center" });
      }
    },
    async "wb-delete"(view, target) {
      let keys = [target.dataset.key], titles = st8(view).entries.filter((entry) => keys.includes(entry.key)).map((entry) => entry.title);
      if (!await confirmDialog({ title: `从「${st8(view).book}」删除条目`, body: "删除前会下载这个条目的备份。", list: titles, okLabel: "删除", danger: !0 })) return;
      await snap(view, "删除条目");
      let backup = await deleteEntries(st8(view).book, keys);
      downloadBlob(`${st8(view).book}-已删条目备份.json`, JSON.stringify(backup, null, 2)), await reloadBook(view);
    }
  };
  async function setPicked(view, disabled) {
    let s = st8(view);
    await snap(view, disabled ? "批量关闭" : "批量开启"), await setEntriesDisabled(s.book, [...s.picked], disabled), await reloadBook(view);
  }
  function openSearch(view, key) {
    let s = st8(view);
    s.search = key, key === "book" ? s.query = "" : s.bookQuery = "", view.renderBody(), hostDocument().querySelector(`.pi-root [data-search="${key}"]`)?.focus();
  }
  async function openBook(view, name) {
    let s = st8(view);
    listedBooks(s).some((book) => book.name === name) || (s.extra = [.../* @__PURE__ */ new Set([...s.extra || [], name])]), s.book = name, s.entries = null, s.openKey = "", s.query = "", s.search === "entry" && (s.search = ""), s.tokens = null, s.tokenMap = null, s.picking = !1, s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
  }
  var refreshOn7 = ["chat"];

  // src/ui/page-diag.js
  var page_diag_exports = {};
  __export(page_diag_exports, {
    actions: () => actions11,
    auditHtml: () => auditHtml,
    clueDiagCard: () => clueDiagCard,
    render: () => render11
  });
  var NEED = ["CHAT_CHANGED", "MESSAGE_RECEIVED"], EVENT_LABELS = {
    WORLDINFO_ENTRIES_LOADED: "条目加载（注入）",
    CHAT_CHANGED: "切换聊天",
    MESSAGE_RECEIVED: "收到回复（触发检测）",
    MESSAGE_UPDATED: "编辑楼层",
    MESSAGE_DELETED: "删除楼层",
    MESSAGE_SWIPED: "切换回复",
    GENERATION_STARTED: "开始生成",
    GENERATION_ENDED: "生成结束",
    GENERATION_STOPPED: "停止生成",
    CHAT_COMPLETION_PROMPT_READY: "请求就绪（线索核验）",
    GENERATE_AFTER_COMBINE_PROMPTS: "文本请求就绪（线索核验）"
  }, time = (at) => at ? new Date(at).toLocaleTimeString("zh-CN", { hour12: !1 }) : "—";
  function collect(view) {
    let { data, runtime } = view, d = runtime.diagnose(), settings = data.settings(), id = runtime.activeId(), meta2 = data.index().projects.find((item) => item.id === id), progress = id ? runtime.progress() : null, llm = resolveLlm(settings, "check"), c = ctx();
    return {
      ...d,
      mode: runtime.clue.diagnose().mode,
      settings,
      id,
      name: meta2 ? meta2.name : "",
      progress,
      llm,
      units: id ? runtime.units().length : 0,
      card: cardName(),
      chatId: c && typeof c.getCurrentChatId == "function" && c.getCurrentChatId() || "",
      version: view.version
    };
  }
  function problems(info) {
    let out = [];
    (!info.hasContext || !info.hasEventSource) && out.push({ text: "读不到酒馆的事件接口，酒馆版本可能过旧。", fix: "" });
    let missing = info.events.filter((item) => NEED.includes(item.key) && !item.name);
    missing.length && out.push({ text: `酒馆没有提供事件：${missing.map((item) => item.key).join("、")}。`, fix: "" }), info.events.filter((item) => NEED.includes(item.key) && item.name && !item.bound).length && out.push({ text: "检测所需的事件没有绑定。", fix: "rebind" }), info.cardKey ? info.id ? info.units || out.push({ text: "启用项目的大纲为空，没有可检测的阶段。", fix: "" }) : out.push({ text: `「${info.card}」没有启用项目，自动检测不会运行。`, fix: "" }) : out.push({ text: "当前没有打开角色卡聊天。", fix: "" }), info.progress && Number(info.progress.lastFailFloor) > info.floors && out.push({ text: `上次检测失败记在第 ${info.progress.lastFailFloor} 楼，当前只有 ${info.floors} 楼。`, fix: "reset-base" }), info.progress && info.progress.lastCheckFloor > info.floors && out.push({ text: `上次检测记在第 ${info.progress.lastCheckFloor} 楼，当前只有 ${info.floors} 楼。`, fix: "reset-base" }), info.llm.source === "custom" && !String(info.llm.model || "").trim() && out.push({ text: "进度检测用独立接口，但没有选择模型。", fix: "" });
    let received = info.events.find((item) => item.key === "MESSAGE_RECEIVED");
    return received && received.bound && !received.count && info.floors - info.chatStartFloors >= 2 && out.push({ text: "打开聊天后已有新回复，但没有收到「收到回复」事件。", fix: "rebind" }), out;
  }
  function nextText(info) {
    if (!info.progress) return "—";
    let gap = info.floors - Math.max(info.progress.lastCheckFloor, Number(info.progress.lastFailFloor) || 0), left = info.settings.checkEvery - gap;
    return left > 0 ? `还差 ${left} 楼` : "下一条回复后检测";
  }
  function rows(info) {
    let clueOn = info.mode === "clue", state = info.checking ? "检测中" : info.pending ? "等待主回复生成结束" : info.generating ? "主回复生成中" : "空闲", llm = info.llm.source === "custom" ? `独立接口 ${info.llm.model || "（未选模型）"}` : "酒馆当前接口";
    return [
      ["版本", `v${info.version}`],
      ["角色卡", info.card || "—"],
      ["聊天", info.chatId || "—"],
      ["启用项目", info.name || "—"],
      ["当前楼数", String(info.floors)],
      ...clueOn ? [] : [
        ["上次检测楼层", info.progress ? String(info.progress.lastCheckFloor) : "—"],
        ...info.progress && info.progress.lastFailFloor ? [["上次检测失败楼层", String(info.progress.lastFailFloor)]] : [],
        ["检测间隔", `每 ${info.settings.checkEvery} 楼`],
        ["下次检测", nextText(info)]
      ],
      ["检测接口", llm],
      ["状态", state]
    ];
  }
  function plainText(info) {
    let lines2 = ["【剧情注入器诊断】", ...rows(info).map(([k, v]) => `${k}：${v}`), "", "【事件】"];
    for (let item of info.events)
      lines2.push(
        `${item.key}（${item.name || "酒馆未提供"}）：${item.bound ? `已绑定，收到 ${item.count} 次，最近 ${time(item.at)}` : "未绑定"}`
      );
    let list = problems(info);
    return lines2.push("", "【问题】", ...list.length ? list.map((item) => `- ${item.text}`) : ["无"]), lines2.push("", "【最近记录】", ...info.logs.length ? info.logs.map((item) => `${time(item.at)} ${item.text}`) : ["无"]), lines2.join(`
`);
  }
  function render11(view) {
    let info = collect(view), list = problems(info), fixes = { rebind: "重新绑定事件", "reset-base": "从当前楼重新计数" }, problemHtml = list.length ? list.map(
      (item) => `<div class="pi-diag-row"><span class="pi-badge is-warn">问题</span><span class="pi-diag-text">${esc(item.text)}</span>${item.fix ? `<button type="button" class="pi-btn is-sm" data-act="${item.fix}">${fixes[item.fix]}</button>` : ""}</div>`
    ).join("") : '<p class="pi-hint">没有发现问题。</p>', events = info.events.map(
      (item) => `<tr><td>${esc(EVENT_LABELS[item.key] || item.key)}</td>
        <td>${item.name ? item.bound ? '<span class="pi-badge is-ok">已绑定</span>' : '<span class="pi-badge is-warn">未绑定</span>' : '<span class="pi-badge is-danger">酒馆未提供</span>'}</td>
        <td>${item.count} 次</td><td>${time(item.at)}</td></tr>`
    ).join(""), logs = info.logs.length ? info.logs.slice().reverse().map((item) => `${time(item.at)}  ${item.text}`).join(`
`) : "暂无记录";
    return `<div class="pi-card"><h3>自动检测${list.length ? `<span class="pi-badge is-warn">${list.length} 个问题</span>` : '<span class="pi-badge is-ok">正常</span>'}</h3>
        <table class="pi-files"><tbody>${rows(info).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
        <div class="pi-tools is-c4 is-end">
            <button type="button" class="pi-btn is-sm is-primary" data-act="check"${info.checking ? " disabled" : ""} title="${info.mode === "clue" ? "让 AI 看看本轮场景演完没有，只给建议，不改进度" : "现在就让 AI 检查这一阶段演到哪了"}">立即检测</button>
            ${info.mode === "clue" ? "" : `<button type="button" class="pi-btn is-sm" data-act="reset-base"${info.progress ? "" : " disabled"} title="下次检测从当前楼开始数">从当前楼重新计数</button>`}
            <button type="button" class="pi-btn is-sm" data-act="rebind" title="插件收不到酒馆消息时用：重新挂上监听">重新绑定事件</button>
            <button type="button" class="pi-btn is-sm" data-act="copy">复制诊断</button></div></div>
        <div class="pi-card"><h3>问题</h3>${problemHtml}</div>
        ${clueDiagCard(view)}
        ${view.runtime.clue.diagnose().mode === "clue" ? "" : `<div class="pi-card"><h3>最终请求核验</h3><p class="pi-hint">每次发送前检查请求里有没有混进不该出现的剧情（标了「仅作者」的内容、还没到的阶段）。只检查，不修改。</p>${auditHtml(info.lastOutlineAudit, "剧情内容")}</div>`}
        <div class="pi-card"><h3>酒馆事件</h3>
        <table class="pi-files"><thead><tr><th>事件</th><th>状态</th><th>收到</th><th>最近</th></tr></thead><tbody>${events}</tbody></table></div>
        <div class="pi-card"><h3>最近记录</h3><pre class="pi-pre">${esc(logs)}</pre></div>`;
  }
  async function copyText(text2) {
    let doc = hostDocument();
    try {
      return await hostWindow().navigator.clipboard.writeText(text2), !0;
    } catch {
      let box = doc.createElement("textarea");
      box.value = text2, box.className = "pi-copy-box", doc.body.appendChild(box), box.select();
      let ok = !!(doc.execCommand && doc.execCommand("copy"));
      return box.remove(), ok;
    }
  }
  var actions11 = {
    async check(view) {
      await view.runtime.checkNow({ manual: !0 }), view.renderBody();
    },
    "reset-base"(view) {
      view.runtime.resetBase(), toast("success", "已从当前楼重新计数。"), view.renderBody();
    },
    rebind(view) {
      view.runtime.rebind(), toast("success", "已重新绑定酒馆事件。"), view.renderBody();
    },
    async copy(view) {
      let ok = await copyText(plainText(collect(view)));
      toast(ok ? "success" : "warning", ok ? "已复制诊断" : "复制失败，请手动选择文字复制");
    }
  };
  function clueDiagCard(view) {
    let d = view.runtime.clue.diagnose();
    if (d.mode !== "clue") return "";
    let yes = (v) => v ? '<span class="pi-badge is-ok">是</span>' : '<span class="pi-badge is-warn">否</span>', last = d.lastInjected;
    return `<div class="pi-card"><h3>线索</h3><table class="pi-files"><tbody>${[
      ["数据库插件", yes(d.api)],
      ["计算依据", "数据库最近一次填好的表格"],
      ["主线开关", d.enabled === null ? "—" : yes(d.enabled)],
      ["最近表格更新", d.lastTableUpdate ? `${time(d.lastTableUpdate)}（${Math.round(d.tableAgeMs / 1e3)} 秒前）` : "本次打开后还没有"]
    ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>
        ${d.problems.length ? d.problems.map((p) => `<p class="pi-hint is-warn">${esc(p)}</p>`).join("") : ""}
        ${auditHtml(d.lastAudit)}
        ${last ? `<p class="pi-hint">上次实际注入（${time(last.at)}）${last.facts.length ? `，涉及事实 ${esc(last.facts.join("、"))}` : ""}：</p><pre class="pi-pre">${esc(last.content || `（空：${last.reason}）`)}</pre>` : '<p class="pi-hint">本次打开后还没有注入记录。</p>'}
        ${d.events.length ? `<pre class="pi-pre">${esc(
      d.events.slice().reverse().map((e) => `${time(e.at)}  ${e.text}`).join(`
`)
    )}</pre>` : ""}</div>`;
  }
  function auditHtml(a, what = "线索内容") {
    if (!a) return '<p class="pi-hint">最终请求核验：本次打开后还没有正文请求。</p>';
    let head = `最终请求核验（${time(a.at)}，请求约 ${a.chars} 字）：`;
    return !a.leaks.length && !a.duplicated ? `<p class="pi-hint">${head}<span class="pi-badge is-ok">未发现不该出现的剧情</span>${a.projectionCount === 1 ? ` · ${what}出现 1 次` : ""}</p>` : `<p class="pi-hint is-warn">${head}${a.duplicated ? `${what}出现 ${a.projectionCount} 次（重复注入）。` : ""}${a.leaks.length ? `发现 ${a.leaks.length} 处不该出现的剧情：` : ""}</p>${a.leaks.length ? `<ul class="pi-clue-why">${a.leaks.slice(0, 12).map((l) => `<li>${esc(l.source)}：「${esc(l.sample)}…」</li>`).join(
      ""
    )}</ul><p class="pi-hint">这些内容不是剧情注入器的注入带进去的。常见来源：大纲或设定被复制进了其它世界书、其它插件的注入、数据库表格里写了未来剧情。</p>` : ""}`;
  }

  // src/ui/app.js
  var TABS = [
    { key: "discuss", label: "讨论", mod: tab_discuss_exports },
    { key: "setting", label: "设定", mod: tab_setting_exports },
    { key: "persona", label: "人设", mod: tab_persona_exports },
    { key: "outline", label: "大纲", mod: tab_outline_exports },
    { key: "run", label: "执行", mod: tab_run_exports }
  ], INFINITE_TABS = { outline: { label: "世界库", mod: tab_worlds_exports }, run: { mod: tab_infinite_run_exports } }, PAGES = {
    books: { label: "世界书管理", icon: "book", mod: page_books_exports },
    data: { label: "数据管理", icon: "box", mod: page_data_exports },
    diag: { label: "诊断", icon: "pulse", mod: page_diag_exports },
    settings: { label: "设置", icon: "gear", mod: page_settings_exports }
  }, UI_KEY = "pi-ui", SEARCH_FROM = 6, LONG_PRESS_MS = 500;
  function readUi() {
    try {
      return JSON.parse(hostWindow().localStorage.getItem(UI_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }
  function writeUi(patch) {
    try {
      hostWindow().localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));
    } catch {
    }
  }
  function createApp({ data, runtime, version }) {
    let doc = hostDocument(), root = null, busyTimer = 0;
    setNight(readUi().night);
    let view = {
      data,
      runtime,
      version,
      projectId: "",
      tab: "run",
      page: "",
      drawer: !1,
      search: "",
      collapsed: new Set(readUi().collapsed || []),
      state: {},
      busy: {},
      loadError: {},
      restored: !1,
      render: render12,
      renderBody,
      renderSide,
      project: () => view.projectId ? data.project(view.projectId) : null,
      setBusy(key, value) {
        view.busy = { ...view.busy, [key]: value }, hostWindow().clearTimeout(busyTimer), busyTimer = hostWindow().setTimeout(renderBody, 0);
      },
      selectProject,
      go
    };
    function tabState(key) {
      return view.state[key] || (view.state[key] = {}), view.state[key];
    }
    view.tabState = tabState;
    let isInfinite = () => !!(view.project() && view.project().mode === "infinite"), tabOf = (tab) => ({ ...tab, ...isInfinite() ? INFINITE_TABS[tab.key] : null });
    function current() {
      return view.page ? PAGES[view.page].mod : tabOf(TABS.find((tab) => tab.key === view.tab) || TABS.find((tab) => tab.key === "run")).mod;
    }
    function sideHtml() {
      let index = data.index(), activeId = runtime.activeId(), list = groupProjects(index.projects).map((group) => {
        let collapsed = view.collapsed.has(group.name), items = group.items.map(
          (item) => `<button type="button" class="pi-pitem${item.id === view.projectId && !view.page ? " is-sel" : ""}" data-act="project" data-id="${esc(item.id)}" data-name="${esc(`${item.group} ${item.name}`.toLowerCase())}" title="长按或右键：设为当前、编辑">
                <span class="pi-pname">${esc(item.name)}</span>${item.id === activeId ? '<span class="pi-dot" title="当前聊天使用"></span>' : ""}</button>`
        ).join(""), head = group.name ? `<button type="button" class="pi-group-hd" data-act="group" data-group="${esc(group.name)}">${collapsed ? ICONS.caret : ICONS.caretDown}${esc(group.name)}<small>${group.items.length}</small></button>` : "";
        return `<div class="pi-group${collapsed ? " is-collapsed" : ""}">${head}${items}</div>`;
      }).join(""), page = (key) => `<button type="button" class="pi-btn is-ghost is-block${view.page === key ? " is-sel" : ""}" data-act="page" data-page="${key}">${ICONS[PAGES[key].icon]}${PAGES[key].label}</button>`;
      return `<div class="pi-side-hd">剧情注入器 <small>v${esc(version)}</small><span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="new-project" title="新项目">${ICONS.plus}</button></div>
            ${index.projects.length > SEARCH_FROM ? `<div class="pi-psearch">${ICONS.search}<input class="pi-inp" data-psearch placeholder="搜索项目" value="${esc(view.search)}"></div>` : ""}
            <div class="pi-plist">${list || '<p class="pi-hint">还没有项目</p>'}</div>
            <div class="pi-side-ft">
                ${page("books")}${page("data")}${page("diag")}
            </div>`;
    }
    function applySearch() {
      let listBox = root && root.querySelector(".pi-plist");
      if (!listBox) return;
      let q = view.search.trim().toLowerCase();
      listBox.classList.toggle("is-searching", !!q);
      for (let group of listBox.querySelectorAll(".pi-group")) {
        let shown = 0;
        for (let item of group.querySelectorAll(".pi-pitem")) {
          let hit = !q || item.dataset.name.includes(q);
          item.hidden = !hit, hit && (shown += 1);
        }
        group.hidden = !!q && !shown;
      }
    }
    function topHtml() {
      let project = view.project(), title2 = view.page ? PAGES[view.page].label : project ? project.name : "剧情注入器", tabs = view.page || !project ? "" : `<div class="pi-tabs">${TABS.map(tabOf).map(
        (tab) => `<button type="button" class="pi-tab${tab.key === view.tab ? " is-sel" : ""}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`
      ).join("")}</div>`, rename = !view.page && project ? `<button type="button" class="pi-icon-btn" data-act="rename" title="编辑项目名称">${ICONS.pencil}</button>` : "";
      return `<div class="pi-top-lead"><button type="button" class="pi-icon-btn pi-menu" data-act="drawer" title="项目列表">${ICONS.menu}</button>
                <span class="pi-top-title">${esc(title2)}</span>${rename}</div>${tabs}
            <div class="pi-top-end"><button type="button" class="pi-icon-btn" data-act="tour" title="当前页帮助">?</button><button type="button" class="pi-icon-btn${view.page === "settings" ? " is-on" : ""}" data-act="page" data-page="settings" title="设置">${ICONS.gear}</button><button type="button" class="pi-icon-btn" data-act="theme" title="${isNight() ? "日间配色" : "夜间配色"}">${isNight() ? ICONS.sun : ICONS.moon}</button>
            <button type="button" class="pi-close" data-act="close" title="关闭">${ICONS.close}</button></div>`;
    }
    function setDrawer(open2) {
      view.drawer = open2, root?.querySelector(".pi-panel").classList.toggle("is-drawer", open2);
    }
    function bodyHtml() {
      if (!data.isReady()) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取酒馆本地数据…</div>';
      if (view.page) return current().render(view);
      let project = view.project();
      if (!view.projectId)
        return `<div class="pi-empty">${data.index().projects.length ? "从项目列表选择一个项目。" : "一个项目就是一段剧情（一条主线或一条 if 线）：在讨论页想清楚，写成大纲，到执行页开始注入。设定页可选，给没有世界观的卡用。"}<br><br>
                <button type="button" class="pi-btn is-primary" data-act="new-project">${ICONS.plus}新项目</button></div>`;
      if (!project) {
        let failed = view.loadError[view.projectId];
        return failed ? `<div class="pi-empty">读取项目失败：${esc(failed)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-project">重试</button></div>` : '<div class="pi-empty"><span class="pi-spin"></span> 正在读取项目…</div>';
      }
      return current().render(view);
    }
    function safeBodyHtml() {
      try {
        return bodyHtml();
      } catch (error) {
        return console.error("[剧情注入器] 页面渲染失败", error), runtime.note(`页面渲染失败（${view.page || view.tab}）：${error.message}`), `<div class="pi-empty">这一页显示出错：${esc(error.message)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-render">重试</button></div>`;
      }
    }
    let lastSide = "", lastTop = "";
    function renderSide() {
      if (!root) return;
      let side = sideHtml(), top = topHtml();
      side !== lastSide && (root.querySelector(".pi-side").innerHTML = side, lastSide = side, applySearch()), top !== lastTop && (root.querySelector(".pi-top").innerHTML = top, lastTop = top);
    }
    function renderBody() {
      if (!root) return;
      let body = root.querySelector(".pi-body"), keepScroll = body.scrollTop, chat = body.querySelector(".pi-chat"), chatScroll = chat ? chat.scrollTop : null, chatAtEnd = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30 : !0, focused = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement : null, compose = focused && focused.matches("[data-compose],[data-setting],[data-search]") ? {
        sel: ["[data-compose]", "[data-setting]"].find((sel) => focused.matches(sel)) || `[data-search="${focused.dataset.search}"]`,
        start: focused.selectionStart,
        end: focused.selectionEnd
      } : null;
      body.className = `pi-body${!view.page && view.tab === "discuss" && view.project() ? " is-chat" : ""}`, body.innerHTML = safeBodyHtml(), body.scrollTop = keepScroll;
      let nextChat = body.querySelector(".pi-chat");
      if (nextChat && (nextChat.scrollTop = chatAtEnd || chatScroll == null ? nextChat.scrollHeight : chatScroll), compose) {
        let box = body.querySelector(compose.sel);
        box && (box.focus(), box.setSelectionRange(compose.start, compose.end));
      }
    }
    function render12() {
      renderSide(), renderBody();
    }
    let tour = createTour({ getRoot: () => root, data });
    view.tour = tour;
    function startTour(scope, opts) {
      tour.start(scope, opts) || opts && opts.auto || toast("info", "这一页现在没有可以讲解的内容。");
    }
    function maybeAutoTour() {
      let tries = 0, tick = () => {
        if (!(!root || tour.isOpen() || tourState(data).done.includes("core"))) {
          if (!data.isReady() || doc.querySelector(".pi-dialog")) return ++tries < 30 && hostWindow().setTimeout(tick, 200);
          tour.start("core", { auto: !0 }) || ++tries < 30 && hostWindow().setTimeout(tick, 200);
        }
      };
      hostWindow().setTimeout(tick, 300);
    }
    async function selectProject(id, tab) {
      if (view.page = "", setDrawer(!1), view.projectId = id, delete view.loadError[id], writeUi({ projectId: id, page: "" }), render12(), !!id)
        try {
          let project = await data.loadProject(id);
          if (view.projectId !== id) return;
          if (!project) {
            view.loadError[id] = "项目文件丢失，可在数据管理里查看", render12();
            return;
          }
          view.tab = tab || (project.outline.volumes.length ? "run" : "discuss"), writeUi({ tab: view.tab }), render12();
        } catch (error) {
          if (view.projectId !== id) return;
          view.loadError[id] = error.message, render12();
        }
    }
    function restore() {
      let ui = readUi(), activeId = runtime.activeId(), remembered = data.index().projects.some((item) => item.id === ui.projectId) ? ui.projectId : "", id = activeId || remembered || data.index().projects[0] && data.index().projects[0].id || "";
      view.restored = !0, render12();
      let page = PAGES[ui.page] ? ui.page : "";
      id && selectProject(id, TABS.some((tab) => tab.key === ui.tab) ? ui.tab : void 0), page && (view.page = page, writeUi({ page }), render12());
    }
    view.switchTab = go;
    function go(tab) {
      view.page = "", view.tab = tab, writeUi({ tab, page: "" }), render12();
    }
    let NEW_GROUP = "::new";
    function groupField(preset) {
      let groups = [
        ...new Set(
          data.index().projects.map((item) => item.group).filter(Boolean)
        )
      ], list = [
        { value: "", label: "不分组" },
        ...groups.map((name) => ({ value: name, label: name })),
        { value: NEW_GROUP, label: "新建分组" }
      ];
      return `<label class="pi-field"><span>分组</span><select class="pi-sel" data-f="group">${options(list, preset)}</select></label>
                <label class="pi-field" data-f="new-group-row" hidden><span>新分组名</span><input class="pi-inp" data-f="new-group" placeholder="如：龙宫篇"></label>`;
    }
    function mountGroupField(box) {
      let select = box.querySelector("[data-f=group]"), row2 = box.querySelector("[data-f=new-group-row]");
      select.addEventListener("change", () => {
        row2.hidden = select.value !== NEW_GROUP, row2.hidden || box.querySelector("[data-f=new-group]").focus();
      });
    }
    function readGroupField(box) {
      let picked = box.querySelector("[data-f=group]").value;
      return picked === NEW_GROUP ? box.querySelector("[data-f=new-group]").value.trim() : picked;
    }
    async function newProject2() {
      setDrawer(!1);
      let current2 = data.index().projects.find((item) => item.id === view.projectId), result = await openDialog({
        title: "新项目",
        html: `<label class="pi-field"><span>项目名（一条 if 线）</span><input class="pi-inp" data-f="name" placeholder="如：龙宫温养"></label>
                ${groupField(current2 && current2.group ? current2.group : "")}
                <label class="pi-check"><input type="checkbox" data-f="infinite"><span>无限流模式（主空间出发、世界库、污染）</span></label>`,
        onMount: mountGroupField,
        actions: [
          { label: "取消", value: null },
          {
            label: "确定",
            primary: !0,
            value: (box) => ({
              name: box.querySelector("[data-f=name]").value,
              group: readGroupField(box),
              mode: box.querySelector("[data-f=infinite]").checked ? "infinite" : "normal"
            })
          }
        ]
      });
      if (!result) return;
      let name = result.name;
      try {
        let project = await data.createProject(name, result.group, result.mode);
        !runtime.activeId() && cardKey() && await runtime.switchProject(project.id), await selectProject(project.id, "discuss");
      } catch (error) {
        toast("error", `新建失败：${error.message}`);
      }
    }
    async function projectMenu(id) {
      let meta2 = data.index().projects.find((item) => item.id === id);
      if (!meta2) return;
      let items = [];
      cardKey() && (runtime.activeId() !== id && items.push({ label: "设为当前聊天使用", value: "chat", icon: ICONS.chat }), data.activeIdFor(cardKey()) !== id && items.push({ label: "设为本卡默认（新聊天也用）", value: "card", icon: ICONS.card })), items.push({ label: "编辑名称、分组", value: "edit", icon: ICONS.pencil });
      let pick = await menuDialog({ title: meta2.name, items });
      if (pick) {
        if (pick === "edit") return editProject(id);
        try {
          await runtime.switchProject(id, pick), toast(
            "success",
            pick === "card" ? `「${meta2.name}」已设为本卡默认，当前聊天也已换用。` : `当前聊天改用「${meta2.name}」。`
          ), render12();
        } catch (error) {
          toast("error", `切换失败：${error.message}`);
        }
      }
    }
    async function editProject(id) {
      let meta2 = data.index().projects.find((item) => item.id === id);
      if (!meta2) return;
      data.project(id) || await data.loadProject(id);
      let mode = data.project(id) ? data.project(id).mode : "normal", result = await openDialog({
        title: "编辑项目",
        html: `<label class="pi-field"><span>名称</span><input class="pi-inp" data-f="name" value="${esc(meta2.name)}"></label>
                ${groupField(meta2.group || "")}
                <label class="pi-check"><input type="checkbox" data-f="infinite"${mode === "infinite" ? " checked" : ""}><span>无限流模式</span></label>`,
        onMount: mountGroupField,
        actions: [
          { label: "删除项目", danger: !0, value: "delete" },
          { label: "取消", value: null },
          {
            label: "保存",
            primary: !0,
            value: (box) => ({
              name: box.querySelector("[data-f=name]").value.trim(),
              group: readGroupField(box),
              mode: box.querySelector("[data-f=infinite]").checked ? "infinite" : "normal"
            })
          }
        ]
      });
      if (result) {
        if (result === "delete") {
          if (!await confirmDialog({
            title: `删除「${meta2.name}」`,
            body: "将删除以下文件，聊天里记录的该项目进度保留。",
            list: [`pi-p-${id}.json`, `pi-c-${id}.json`],
            okLabel: "删除",
            danger: !0
          }))
            return;
          try {
            await data.deleteProject(id), view.projectId === id && (view.projectId = ""), runtime.refresh(), render12();
          } catch (error) {
            toast("error", `删除失败：${error.message}`);
          }
          return;
        }
        data.project(id) || await data.loadProject(id), data.renameProject(id, result.name, result.group), result.mode !== mode && data.updateProject(id, (project) => ({ ...project, mode: result.mode, infinite: normalizeInfinite(project.infinite) })), runtime.refresh(), render12();
      }
    }
    function onClick(event) {
      if (event.target.closest(".pi-pitem") && swallowAfterPress(event)) return;
      let target = event.target.closest("[data-act]");
      if (!target || !root.contains(target)) return;
      let act = target.dataset.act;
      if (act === "close") return close();
      if (act === "tour") return startTour(tourScopeOf(view));
      if (act === "tour-reset") return data.updateSettings({ tourState: { revision: TOUR_REVISION, done: [] } }), startTour("core");
      if (act === "project") return selectProject(target.dataset.id);
      if (act === "new-project") return newProject2();
      if (act === "tab") return go(target.dataset.tab);
      if (act === "page") return view.page = target.dataset.page, writeUi({ page: view.page }), setDrawer(!1), render12();
      if (act === "drawer") return setDrawer(!view.drawer);
      if (act === "theme") return setNight(!isNight()), writeUi({ night: isNight() }), renderSide();
      if (act === "rename") return editProject(view.projectId);
      if (act === "retry-project") return selectProject(view.projectId, view.tab);
      if (act === "retry-render") return render12();
      if (act === "group") {
        let name = target.dataset.group;
        return view.collapsed.has(name) ? view.collapsed.delete(name) : view.collapsed.add(name), writeUi({ collapsed: [...view.collapsed] }), renderSide();
      }
      let handler = current().actions?.[act], native = event.target.closest && event.target.closest("input,select,textarea,label");
      handler && (native && native !== target && target.contains(native) || event.preventDefault(), Promise.resolve(handler(view, target, event)).catch((error) => toast("error", error.message || String(error))));
    }
    let press = null, pressedAt = 0;
    function cancelPress() {
      press && hostWindow().clearTimeout(press.timer), press = null;
    }
    function onPointerDown(event) {
      let item = event.target.closest(".pi-pitem");
      !item || !root.contains(item) || event.button > 0 || (cancelPress(), press = {
        x: event.clientX,
        y: event.clientY,
        timer: hostWindow().setTimeout(() => {
          press = null, pressedAt = Date.now(), projectMenu(item.dataset.id);
        }, LONG_PRESS_MS)
      });
    }
    function onPointerMove(event) {
      press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10 && cancelPress();
    }
    function swallowAfterPress(event) {
      return Date.now() - pressedAt > 800 ? !1 : (event.preventDefault(), event.stopPropagation(), !0);
    }
    function onContext(event) {
      let item = event.target.closest(".pi-pitem");
      !item || !root.contains(item) || (event.preventDefault(), cancelPress(), !swallowAfterPress(event) && projectMenu(item.dataset.id));
    }
    function onChange8(event) {
      let target = event.target;
      if (target.dataset.psearch !== void 0) return;
      let handler = current().onChange;
      handler && Promise.resolve(handler(view, target, event)).catch((error) => toast("error", error.message || String(error)));
    }
    function onInput6(event) {
      if (event.target.dataset.psearch !== void 0) return view.search = event.target.value, applySearch();
      let handler = current().onInput;
      handler && handler(view, event.target, event);
    }
    function onKey(event) {
      tour.isOpen() || (event.key === "Escape" && root && !doc.querySelector(".pi-dialog") && (event.stopPropagation(), view.drawer ? setDrawer(!1) : close()), event.key === "Enter" && (event.ctrlKey || event.metaKey) && current().onSubmit?.(view, event.target, event));
    }
    function open() {
      ensureStyle(), !root && (view.drawer = !1, lastSide = "", lastTop = "", root = el(`<div class="pi-root pi-overlay"><div class="pi-panel"><aside class="pi-side"></aside>
            <div class="pi-scrim" data-act="drawer"></div>
            <section class="pi-main"><header class="pi-top"></header><div class="pi-body"></div></section></div></div>`), root.addEventListener("click", onClick), root.addEventListener("contextmenu", onContext), root.addEventListener("pointerdown", onPointerDown), root.addEventListener("pointermove", onPointerMove), root.addEventListener("pointerup", cancelPress), root.addEventListener("pointercancel", cancelPress), root.addEventListener("scroll", cancelPress, !0), root.addEventListener("change", onChange8), root.addEventListener("input", onInput6), root.addEventListener("compositionend", (event) => {
        event.target.dataset.search && onInput6(event);
      }), root.addEventListener("focusout", (event) => current().onBlur?.(view, event.target, event)), root.addEventListener("mousedown", (event) => {
        event.target === root && (root.dataset.down = "1");
      }), root.addEventListener("mouseup", (event) => {
        event.target === root && root.dataset.down && close(), delete root.dataset.down;
      }), doc.addEventListener("keydown", onKey, !0), doc.body.appendChild(root), view.restored = !1, data.isReady() ? restore() : render12(), maybeAutoTour());
    }
    function close() {
      tour.stop(!1), root && (current().unmount?.(view), doc.removeEventListener("keydown", onKey, !0), root.remove(), root = null, data.flush().catch(() => {
      }));
    }
    function refresh(reason) {
      if (!root) return;
      if (!view.restored && data.isReady()) return restore();
      (reason === "index" || reason === "switch" || reason === "chat") && renderSide();
      let focused = doc.activeElement, typing = focused && root.contains(focused) && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(focused.type));
      if (reason === "saved" || reason === "save-failed") return current().onStatus?.(view, root);
      let only = current().refreshOn;
      only && !only.includes(reason) || typing || renderBody();
    }
    return { open, close, refresh, isOpen: () => !!root, view, cardName };
  }

  // src/ui/notice.js
  function createNotices() {
    let doc = hostDocument(), view = hostWindow(), box = null, timers = /* @__PURE__ */ new Map();
    function container() {
      return (!box || !box.isConnected) && (box = el('<div class="pi-root pi-notices"></div>'), doc.body.appendChild(box)), box;
    }
    function hide(id) {
      view.clearTimeout(timers.get(id)), timers.delete(id), box?.querySelector(`[data-notice="${id}"]`)?.remove();
    }
    function show({ id, title: title2, body = "", actions: actions12 = [], timeout = 0 }) {
      hide(id);
      let card = el(`<div class="pi-notice" data-notice="${esc(id)}"><b>${esc(title2)}</b>${body ? `<p>${esc(body)}</p>` : ""}
            <div class="pi-row">${actions12.map((action, index) => `<button type="button" class="pi-btn is-sm${action.primary ? " is-primary" : ""}" data-act="${index}">${esc(action.label)}</button>`).join("")}</div></div>`);
      card.addEventListener("click", (event) => {
        let button = event.target.closest("[data-act]");
        if (button) {
          hide(id);
          try {
            actions12[Number(button.dataset.act)].run();
          } catch (error) {
            console.error("[剧情注入器]", error);
          }
        }
      }), container().appendChild(card), timeout && timers.set(
        id,
        view.setTimeout(() => hide(id), timeout)
      );
    }
    let bar = null;
    function hideBar() {
      bar?.remove(), bar = null;
    }
    function topBar({ tag = "", text: text2, action = "", run = null }) {
      hideBar();
      let top = doc.querySelector("#top-bar, #top-settings-holder"), offset = top ? Math.max(0, Math.round(top.getBoundingClientRect().bottom)) : 0;
      bar = el(
        `<div class="pi-root pi-topbar" role="status" style="top:calc(${offset}px + env(safe-area-inset-top, 0px))"><span class="pi-topbar-dot"></span><div class="pi-topbar-body"><span class="pi-topbar-text" title="${esc(text2)}">${esc(text2)}</span>${tag ? `<span class="pi-topbar-tag">${esc(tag)}</span>` : ""}</div><div class="pi-topbar-acts">${action ? `<button type="button" class="pi-btn is-sm pi-topbar-act">${esc(action)}</button>` : ""}<button type="button" class="pi-btn is-sm is-primary pi-topbar-ok">确认</button></div></div>`
      ), doc.body.appendChild(bar);
      let armed = 0, btn = bar.querySelector(".pi-topbar-act"), y0 = null, self = bar;
      bar.querySelector(".pi-topbar-ok").addEventListener("click", () => bar === self && hideBar()), btn && btn.addEventListener("click", () => {
        if (!armed) {
          btn.textContent = "再点", btn.classList.add("is-armed"), armed = view.setTimeout(() => {
            armed = 0, btn.textContent = action, btn.classList.remove("is-armed");
          }, 3e3);
          return;
        }
        view.clearTimeout(armed), hideBar();
        try {
          run && run();
        } catch (error) {
          console.error("[剧情注入器]", error);
        }
      }), bar.addEventListener(
        "touchstart",
        (e) => {
          y0 = e.touches[0].clientY;
        },
        { passive: !0 }
      ), bar.addEventListener(
        "touchmove",
        (e) => {
          y0 !== null && y0 - e.touches[0].clientY > 24 && bar === self && hideBar();
        },
        { passive: !0 }
      );
    }
    function destroy() {
      for (let timer of timers.values()) view.clearTimeout(timer);
      timers.clear(), box?.remove(), box = null, hideBar();
    }
    return { show, hide, destroy, topBar, hideBar };
  }

  // src/index.js
  var VERSION = "0.2.1", KEY2 = "__plotInjector", BUTTON = "剧情注入";
  function boot() {
    let host = hostWindow();
    if (host[KEY2] && typeof host[KEY2].destroy == "function")
      try {
        host[KEY2].destroy();
      } catch (error) {
        console.warn("[剧情注入器] 旧实例销毁失败", error);
      }
    host.__plotInjectorBootError = "";
    let yaml = libs().yaml;
    if (!yaml) {
      host.__plotInjectorBootError = "当前酒馆没有提供 YAML 解析库（SillyTavern.libs.yaml），需要更新酒馆。", toast("error", host.__plotInjectorBootError);
      return;
    }
    setYamlLib(yaml), ensureStyle();
    let app = null, notice = createNotices(), data = createDataStore({
      onChange: (reason) => app && app.refresh(reason),
      onError: (error) => toast("error", `保存失败，内容仍在内存里：${error.message}`)
    }), askReason = (reason) => promptDialog({ title: "改写后续阶段", label: "偏离说明（可修改或留空）", value: reason, multiline: !0 }), emit = (reason) => {
      try {
        app && app.refresh(reason);
      } catch (error) {
        console.error("[剧情注入器] 界面刷新失败", error);
      }
    }, runtime = createRuntime({ data, notice, emit, askReason });
    runtime.clue.setLineBar((x) => x ? notice.topBar(x) : notice.hideBar()), app = createApp({ data, runtime, version: VERSION });
    let started = !1, ready = data.init().then(() => {
      runtime.start(), started = !0, emit("index");
    }).catch((error) => {
      toast("error", `读取本地数据失败：${error.message}`);
    }), subscription = null;
    !(window.__plotInjectorLoader && window.__plotInjectorLoader.bound) && typeof eventOn == "function" && typeof getButtonEvent == "function" && (typeof appendInexistentScriptButtons == "function" && appendInexistentScriptButtons([{ name: BUTTON, visible: !0 }]), subscription = eventOn(getButtonEvent(BUTTON), () => app.open()));
    let instance = {
      version: VERSION,
      open: () => app.open(),
      ready,
      data,
      runtime,
      __view: app.view,
      async destroy() {
        host[KEY2] === instance && delete host[KEY2];
        try {
          subscription && typeof subscription.stop == "function" && subscription.stop();
        } catch {
        }
        app.close(), started && runtime.stop(), notice.destroy(), removeStyle(), await data.flush().catch(() => {
        });
      }
    };
    host[KEY2] = instance, window.addEventListener("pagehide", () => instance.destroy(), { once: !0 }), console.info(`[剧情注入器] v${VERSION} 已加载`);
  }
  try {
    boot();
  } catch (error) {
    console.error("[剧情注入器] 启动失败", error);
    try {
      hostWindow().__plotInjectorBootError = `启动失败：${error && error.message}`;
    } catch {
    }
    toast("error", `启动失败：${error.message}`);
  }
})();
