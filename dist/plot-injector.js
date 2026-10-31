// PlotInjector v0.1.15
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
  function parseYaml(text) {
    return getYamlLib().parse(String(text || ""));
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

  // src/core/outline.js
  var NODE_FIELDS = [
    { field: "主线节点", kind: "main", prefix: "m", label: "主线" },
    { field: "支线事件", kind: "side", prefix: "s", label: "支线" },
    { field: "世界动态", kind: "world", prefix: "w", label: "世界动态" }
  ], STAGE_HINT_KEYS = ["时间范围", "AI指令", "主线节点", "支线事件", "世界动态"];
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
  function volumesFromValue(value, idOf = makeId) {
    if (!isPlainObject(value)) throw new Error("大纲顶层应是「卷名: 阶段」的映射");
    let entries = Object.entries(value);
    if (entries.length && entries.every(([, v]) => looksLikeStage(v)))
      return [{ id: idOf("v"), key: "剧情_导入", stages: entries.map(([key, data]) => ({ id: idOf("s"), key, data })) }];
    if (looksLikeStage(value))
      return [{ id: idOf("v"), key: "剧情_导入", stages: [{ id: idOf("s"), key: "阶段一_导入", data: value }] }];
    let volumes = [];
    for (let [key, stages] of entries) {
      if (!looksLikeVolume(stages)) throw new Error(`「${key}」下没有可识别的阶段（需要 时间范围 / 主线节点 等字段）`);
      volumes.push({
        id: idOf("v"),
        key,
        stages: Object.entries(stages).filter(([, data]) => isPlainObject(data)).map(([stageKey, data]) => ({ id: idOf("s"), key: stageKey, data }))
      });
    }
    if (!volumes.length) throw new Error("没有读到任何卷");
    return volumes;
  }
  function parseOutlineText(text, idOf = makeId) {
    let value;
    try {
      value = parseYaml(text);
    } catch (error) {
      let line = yamlErrorLine(error), wrapped = new Error(`YAML 格式错误${line ? `（第 ${line} 行）` : ""}：${String(error.message || error).split(`
`)[0]}`);
      throw wrapped.line = line, wrapped;
    }
    return volumesFromValue(value, idOf);
  }
  function volumeValue(volume) {
    let out = {};
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
    let text = String(key || ""), at = text.indexOf("_");
    return at < 0 ? { short: text, title: "" } : { short: text.slice(0, at), title: text.slice(at + 1) };
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
    for (let { field, kind, prefix, label } of NODE_FIELDS)
      (Array.isArray(data && data[field]) ? data[field] : []).forEach((item, index) => {
        let name = isPlainObject(item) ? String(item.名称 || item.类型 || item.内容 || "").trim() : String(item || "").trim();
        nodes.push({ id: `${prefix}${index}`, kind, field, label, index, name: name || `${label}${index + 1}`, item });
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
      let kept = value.filter((_, index) => !off.has(`${meta2.prefix}${index}`));
      kept.length && (out[key] = kept);
    }
    return out;
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

  // src/core/progress.js
  var SETTING_SLOT = "@setting";
  var STATES = ["done", "active", "next", "todo"], STATE_LABELS = { done: "已过", active: "进行中", next: "下一段", todo: "未到" };
  function emptyProgress(projectId) {
    return { projectId, current: null, slots: {}, lastCheckFloor: 0, muted: [], offMuted: [], pace: "normal" };
  }
  function normalizeProgress(value, projectId) {
    let base = emptyProgress(projectId);
    return !value || typeof value != "object" ? base : {
      ...base,
      ...value,
      slots: value.slots && typeof value.slots == "object" ? value.slots : {},
      muted: Array.isArray(value.muted) ? value.muted : [],
      offMuted: Array.isArray(value.offMuted) ? value.offMuted : [],
      lastCheckFloor: Number(value.lastCheckFloor) || 0,
      pace: ["slow", "normal", "fast"].includes(value.pace) ? value.pace : "normal"
    };
  }
  function currentIndex(units, progress) {
    if (!units.length) return -1;
    let found = units.findIndex((unit) => unit.id === progress.current);
    return found >= 0 ? found : 0;
  }
  function unitStates(units, progress) {
    let cur = currentIndex(units, progress), states = {};
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
  function offNodes(progress, unitId) {
    let slot = progress.slots[unitId];
    return slot && Array.isArray(slot.off) ? slot.off : [];
  }
  function setNodeChecked(progress, unitId, nodeId, checked) {
    let off = new Set(offNodes(progress, unitId));
    return checked ? off.delete(nodeId) : off.add(nodeId), patchSlot(progress, unitId, { off: [...off] });
  }
  function uncheckByNames(progress, unitId, nodes, names) {
    let wanted = new Set((names || []).map((name) => String(name).trim()).filter(Boolean)), next = progress;
    for (let node of nodes) wanted.has(node.name) && (next = setNodeChecked(next, unitId, node.id, !1));
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
  function buildIndexText(units, states, progress, { carryOver = !0 } = {}) {
    let lines = [], done = units.filter((unit) => states[unit.id] === "done"), active = units.filter((unit) => states[unit.id] === "active"), next = units.filter((unit) => states[unit.id] === "next"), later = units.filter((unit) => states[unit.id] === "todo");
    if (done.length) {
      lines.push("【已过】");
      for (let unit of done) {
        let names = stageNodes(unit.stage.data).filter((node) => node.kind === "main").map((node) => node.name);
        lines.push(`- ${stagePlace(unit)}${names.length ? `（${names.join("／")}）` : ""}`);
      }
    }
    for (let unit of active) {
      let off = new Set(offNodes(progress, unit.id)), range = rangeOf(unit);
      lines.push("【当前】", `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ""}`);
      for (let node of stageNodes(unit.stage.data).filter((item) => item.kind !== "world")) lines.push(nodeLine(node, off.has(node.id) ? "已演" : "未演"));
      if (carryOver) for (let { node } of carriedNodes(units, states, progress)) node.kind !== "world" && lines.push(nodeLine(node, "未演·延续"));
    }
    for (let unit of next) {
      let range = rangeOf(unit), instr = unit.stage.data && unit.stage.data.AI指令;
      lines.push("【下一段】", `- ${stagePlace(unit)}${range ? `｜时间范围：${range}` : ""}`), instr && lines.push(`  AI指令：${String(instr).trim()}`);
      for (let node of stageNodes(unit.stage.data).filter((item) => item.kind === "main")) lines.push(nodeLine(node, ""));
    }
    if (later.length) {
      lines.push("【之后】");
      for (let unit of later.slice(0, LATER_LIMIT)) lines.push(`- ${stagePlace(unit)}`);
      later.length > LATER_LIMIT && lines.push(`- ……另有 ${later.length - LATER_LIMIT} 段`);
    }
    return lines.join(`
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
  function carriedNodes(units, states, progress) {
    let out = [];
    for (let unit of units) {
      if (states[unit.id] !== "done") continue;
      let off = new Set(offNodes(progress, unit.id));
      for (let node of stageNodes(unit.stage.data)) node.kind !== "main" && !off.has(node.id) && out.push({ unit, node });
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
  function buildDetailText(unit, off, settings, { pace = "normal", next = null, carried = [] } = {}) {
    let tag = String(settings.tagName || "剧情参考").trim() || "剧情参考", data = filterStageData(unit.stage.data, off), body = stringifyYaml({ [unit.stage.key]: data }).trimEnd(), vol = splitVolumeKey(unit.volume.key).short, note = paceText(settings, pace);
    if (pace === "fast" && next) {
      let range = rangeOf(next);
      note += `
下一阶段：${stagePlace(next)}${range ? `（${range}）` : ""}`;
    }
    return `<${tag} 卷="${vol}" 阶段="${unit.stage.key}">
${note}
${body}${carriedText(carried)}
</${tag}>`;
  }
  function buildEntries(project, progress, settings) {
    let defaults = { ...DEFAULT_PARAMS, ...project && project.defaults }, entries = [];
    if (!project) return entries;
    let settingText = String(project.setting && project.setting.text || "").trim();
    settingText && entries.push({
      slotId: SETTING_SLOT,
      kind: "setting",
      title: "设定",
      content: settingText,
      ...pickParams(defaults.setting, progress.slots[SETTING_SLOT])
    });
    let units = flattenUnits(project.outline && project.outline.volumes);
    if (units.length) {
      let states = unitStates(units, progress), next = units.find((unit) => states[unit.id] === "next") || null, carried = settings.carryOver === !1 ? [] : carriedNodes(units, states, progress);
      for (let unit of units) {
        if (states[unit.id] !== "active") continue;
        let off = offNodes(progress, unit.id);
        entries.push({
          slotId: unit.id,
          kind: "detail",
          title: `${volumeLabel(unit.volume.key)}·${splitStageKey(unit.stage.key).short}`,
          unit,
          content: buildDetailText(unit, off, settings, { pace: progress.pace, next, carried }),
          ...pickParams(defaults.detail, progress.slots[unit.id])
        });
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
      let field = acuField(entry.title);
      field && (map.has(field) || map.set(field, []), map.get(field).push(entry));
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
  var isMemoField = (field) => MEMO_FIELD.test(field);
  function fieldChecked(rule, field) {
    return Object.prototype.hasOwnProperty.call(rule.fields, field) ? rule.fields[field] : INDEX_FIELD.test(field) && !isMemoField(field);
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
        let field = acuField(entry.title);
        if (!field) {
          entry.disabled || out.add(entryRefId(book.name, entry));
          continue;
        }
        isMemoField(field) ? memos.push(entry) : fieldChecked(rule, field) && out.add(entryRefId(book.name, entry));
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
    for (let [field, on] of Object.entries(fields)) !isMemoField(field) && on !== fieldChecked(rule, field) && (rule.fields[field] = on);
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
    offTrackMode: "ask",
    carryOver: !0,
    handleMode: "ask",
    checkEvery: 3,
    checkFloors: 3,
    guide: "",
    paceText: { slow: "", normal: "", fast: "" },
    loaderRef: "",
    llm: { discuss: { ...DEFAULT_LLM }, outline: { ...DEFAULT_LLM }, check: { ...DEFAULT_LLM } },
    presets: []
  }, HANDLE_MODES = ["ask", "auto", "nodes"], OFF_MODES = ["ask", "auto", "off"];
  function normalizeSettings(value) {
    let src = value && typeof value == "object" ? value : {}, { llm, presets } = normalizeLlm(src);
    return {
      ...DEFAULT_SETTINGS,
      ...src,
      offTrackMode: OFF_MODES.includes(src.offTrackMode) ? src.offTrackMode : DEFAULT_SETTINGS.offTrackMode,
      carryOver: src.carryOver !== !1,
      handleMode: HANDLE_MODES.includes(src.handleMode) ? src.handleMode : DEFAULT_SETTINGS.handleMode,
      checkEvery: Math.max(1, Math.min(50, Number(src.checkEvery) || DEFAULT_SETTINGS.checkEvery)),
      checkFloors: Math.max(1, Math.min(20, Number(src.checkFloors) || DEFAULT_SETTINGS.checkFloors)),
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
      projects: projects.map((item) => ({ id: item.id, name: String(item.name || "未命名"), group: String(item.group || ""), updatedAt: Number(item.updatedAt) || 0, bytes: item.bytes && typeof item.bytes == "object" ? item.bytes : {} })),
      files: Array.isArray(src.files) ? src.files.filter((name) => typeof name == "string" && name.startsWith(FILE_PREFIX)) : [],
      settings: normalizeSettings(src.settings)
    };
  }
  function newProject(name, now = Date.now()) {
    return {
      version: 1,
      id: makeId("p"),
      name: String(name || "").trim() || "新项目",
      createdAt: now,
      setting: { text: "", history: [], check: "", fixes: [] },
      outline: { volumes: [] },
      defaults: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
      genRefs: normalizeGenRefs()
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
        fixes: Array.isArray(setting.fixes) ? setting.fixes : []
      },
      outline: {
        volumes: volumes.filter((vol) => vol && Array.isArray(vol.stages)).map((vol) => ({
          id: vol.id || makeId("v"),
          key: String(vol.key || "剧情_未命名"),
          stages: vol.stages.filter((stage) => stage && stage.data && typeof stage.data == "object").map((stage) => ({ id: stage.id || makeId("s"), key: String(stage.key || "阶段"), data: stage.data }))
        }))
      },
      defaults: normalizeDefaults(src.defaults),
      genRefs: normalizeGenRefs(src.genRefs)
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
    return { version: 1, summary: "", messages: [], refs: { setting: !0, outline: !1, progress: !0, floors: 10, memo: DEFAULT_MEMO, wb: DEFAULT_WB_RULE } };
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
      messages: Array.isArray(src.messages) ? src.messages.filter((msg) => msg && typeof msg.content == "string").map((msg) => ({ id: msg.id || makeId("m"), role: msg.role === "user" ? "user" : "assistant", content: msg.content, at: Number(msg.at) || 0, folded: !!msg.folded })) : [],
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
    let st7 = hostWindow().SillyTavern;
    return st7 && typeof st7.getContext == "function" ? st7.getContext() : st7 || null;
  }
  function libs() {
    let st7 = hostWindow().SillyTavern;
    return st7 && st7.libs || {};
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
  async function countTokens(text) {
    let c = ctx();
    try {
      if (c && typeof c.getTokenCountAsync == "function") return await c.getTokenCountAsync(String(text || ""));
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
  function utf8Base64(text) {
    let bytes = new TextEncoder().encode(text), binary = "";
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
    let text = await res.text();
    try {
      return { value: JSON.parse(text), bytes: new TextEncoder().encode(text).length };
    } catch {
      throw new Error(`${name} 不是有效 JSON`);
    }
  }
  async function writeJsonFile(name, value) {
    let text = JSON.stringify(value), res = await fetchFn()("/api/files/upload", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: utf8Base64(text) })
    });
    if (!res.ok) throw new Error(`写入 ${name} 失败（HTTP ${res.status}）`);
    return new TextEncoder().encode(text).length;
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
  async function verifyFiles(names) {
    if (!names.length) return {};
    let res = await fetchFn()("/api/files/verify", {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ urls: names.map(filePath) })
    });
    if (!res.ok) throw new Error(`核对文件失败（HTTP ${res.status}）`);
    let data = await res.json(), out = {};
    for (let name of names) out[name] = !!data[filePath(name)];
    return out;
  }
  async function readRawFile(name) {
    let res = await fetchFn()(`/${filePath(name)}?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? res.text() : null;
  }
  function createWriter({ delay = 800, write = writeJsonFile, onError = () => {
  }, onSaved = () => {
  } } = {}) {
    let pending = /* @__PURE__ */ new Map(), timers = /* @__PURE__ */ new Map(), view = hostWindow();
    async function flushOne(name) {
      if (timers.delete(name), !pending.has(name)) return;
      let value = pending.get(name);
      pending.delete(name);
      try {
        let bytes = await write(name, value);
        onSaved(name, bytes);
      } catch (error) {
        pending.has(name) || pending.set(name, value), onError(name, error);
      }
    }
    return {
      schedule(name, value) {
        pending.set(name, value), timers.has(name) && view.clearTimeout(timers.get(name)), timers.set(name, view.setTimeout(() => flushOne(name), delay));
      },
      async flush() {
        for (let timer of timers.values()) view.clearTimeout(timer);
        timers.clear(), await Promise.all([...pending.keys()].map(flushOne));
      },
      cancel(name) {
        timers.has(name) && view.clearTimeout(timers.get(name)), timers.delete(name), pending.delete(name);
      },
      hasPending: () => pending.size > 0,
      failed: () => [...pending.keys()].filter((name) => !timers.has(name))
    };
  }

  // src/app/data.js
  function createDataStore({ onChange: onChange6 = () => {
  }, onError = () => {
  } } = {}) {
    let index = emptyIndex(), ready = !1, projects = /* @__PURE__ */ new Map(), chats = /* @__PURE__ */ new Map(), loading = /* @__PURE__ */ new Map(), failed = /* @__PURE__ */ new Set(), writer = createWriter({
      onSaved(name, bytes) {
        if (failed.delete(name), name === INDEX_FILE) return;
        let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1], meta2 = index.projects.find((item) => item.id === id), kind = name.startsWith("pi-p-") ? "project" : "chat", knownFile = index.files.includes(name);
        meta2 && meta2.bytes[kind] !== bytes && (index = { ...index, projects: index.projects.map((item) => item === meta2 ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item) }), knownFile || (index = { ...index, files: [...index.files, name] }), (!knownFile || meta2 && meta2.bytes[kind] !== bytes) && writer.schedule(INDEX_FILE, index), onChange6("saved");
      },
      onError(name, error) {
        failed.add(name), onError(error), onChange6("save-failed");
      }
    });
    function setIndex(next) {
      index = next, writer.schedule(INDEX_FILE, index), onChange6("index");
    }
    async function init() {
      let file = await readJsonFile(INDEX_FILE);
      index = normalizeIndex(file && file.value), index.files.includes(INDEX_FILE) || (index = { ...index, files: [INDEX_FILE, ...index.files] }), ready = !0, onChange6("index");
    }
    async function loadProject(id) {
      if (projects.has(id)) return projects.get(id);
      if (loading.has(`p:${id}`)) return loading.get(`p:${id}`);
      let job = (async () => {
        let file = await readJsonFile(projectFile(id)), project = file ? normalizeProject(file.value, id) : null;
        return project && projects.set(id, project), project;
      })().finally(() => loading.delete(`p:${id}`));
      return loading.set(`p:${id}`, job), job;
    }
    function touch(id, patch = {}) {
      setIndex({ ...index, projects: index.projects.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item) });
    }
    function saveProject(project) {
      projects.set(project.id, project), writer.schedule(projectFile(project.id), project), touch(project.id, { name: project.name }), onChange6("project", project.id);
    }
    function updateProject(id, fn) {
      let current = projects.get(id);
      if (!current) throw new Error("项目尚未载入");
      let next = fn(current);
      return next && next !== current && saveProject(next), next;
    }
    async function createProject(name, group = "") {
      let project = newProject(name);
      projects.set(project.id, project);
      let bytes = await writeJsonFile(projectFile(project.id), project);
      return index = {
        ...index,
        projects: [...index.projects, { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } }],
        files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)]
      }, writer.schedule(INDEX_FILE, index), onChange6("index"), project;
    }
    async function deleteProject(id) {
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
      chats.set(id, chat), writer.schedule(chatFile(id), chat), onChange6("chat", id);
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
    function forgetFiles(names) {
      let drop = new Set(names);
      setIndex({ ...index, files: index.files.filter((name) => !drop.has(name)) });
    }
    function resetAll() {
      for (let name of [...index.files]) writer.cancel(name);
      projects.clear(), chats.clear(), index = emptyIndex(), onChange6("index");
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
      retryFailed: () => writer.flush(),
      flush: () => writer.flush()
    };
  }

  // src/core/check.js
  function cleanFloorText(text, limit = 3e3) {
    let out = String(text || "");
    return out = out.replace(/<(think|thinking|reasoning|status|statusbar|状态栏|details)\b[^>]*>[\s\S]*?<\/\1>/gi, ""), out = out.replace(/```[\s\S]*?```/g, ""), out = out.replace(/<\s*剧情推进\s*\/?\s*>/g, ""), out = out.replace(/<[^>\n]{1,80}>/g, ""), out = out.replace(/\n{3,}/g, `

`).trim(), out.length > limit ? out.slice(-limit) : out;
  }
  function buildCheckMessages(unit, index, floors) {
    let system = [
      "你是剧情进度核对员。根据最近的正文，对照剧情索引判断进度。",
      "只认正文里已经写出的事件，计划、预告、角色设想不算发生。",
      "若剧情走了某个节点的「偏转」分支，在 reason 里写明是哪个节点、怎么偏的。",
      "另外判断剧情是否严重偏离大纲：正文的走向已经和【当前】【下一段】冲突，照原计划写下去会接不上（例如关键人物已死、关键事件已不可能发生、地点或立场彻底改变）。普通的细节出入、走了偏转分支都不算严重偏离。",
      '只输出一个 JSON 对象，不加说明：{"done":["节点名"],"stageDone":true或false,"offTrack":true或false,"offReason":"偏离说明，没有就留空","reason":"一句话"}',
      "done 只填【当前】里出现过的节点名，原样照抄；stageDone 表示当前段所有主线节点都已发生、剧情已进入下一段。"
    ].join(`
`), user = [
      `【剧情索引】
${index}`,
      "",
      "【最近正文】",
      ...floors.map((floor) => `【第 ${floor.index} 楼】
${floor.text}`)
    ].join(`
`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function parseCheckReply(text) {
    let raw = String(text || ""), start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("检测结果不是 JSON");
    let value;
    try {
      value = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error("检测结果 JSON 无法解析");
    }
    let done = Array.isArray(value.done) ? value.done.map((item) => String(item).trim()).filter(Boolean) : [], flag = (item) => item === !0 || item === "true";
    return { done, stageDone: flag(value.stageDone), offTrack: flag(value.offTrack), offReason: String(value.offReason || "").trim(), reason: String(value.reason || "").trim() };
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
        偏转: 若主角做出不同选择，后续如何调整。
    支线事件:
      - 名称: 旧友送行
        地点: 村口
        事件: 一句话事件。
        触发: 出现这种情况时发生。
    世界动态:
      - 类型: 传闻
        来源: 谁传出
        内容: 外界正在发生什么。
`, FOLD_KEEP = 16, FOLD_CHARS = 24e3;
  function discussSystemPrompt({ guide, refs }) {
    let parts = [
      "你在帮用户构思一条同人 if 线：一起把世界观、人物处境、信息差和大纲方向想清楚。",
      "每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。"
    ];
    return refs.length && parts.push(...refs.map((ref) => `【参考·${ref.title}】
${ref.text}`)), guide && parts.push(`【写作基准：同人世界观速成】
${guide}`), parts.join(`

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
    let text = messages.map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`);
    return [
      { role: "system", content: "把下面的讨论压缩成要点摘要：保留已经敲定的设定、人物关系、剧情走向和仍未决定的问题，删掉寒暄和被否掉的方案。只输出摘要。" },
      { role: "user", content: `${summary ? `【已有摘要】
${summary}

` : ""}【新的讨论】
${text}` }
    ];
  }
  function chatRequest(system, summary, messages) {
    let out = [{ role: "system", content: system }];
    summary && out.push({ role: "system", content: `【之前讨论的摘要】
${summary}` });
    for (let msg of messages.filter((item) => !item.folded)) out.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
    return out;
  }
  function transcript(summary, messages, limit = 3e4) {
    let text = messages.filter((msg) => !msg.folded).map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`), joined = `${summary ? `【摘要】
${summary}

` : ""}${text}`;
    return joined.length > limit ? joined.slice(-limit) : joined;
  }
  var refBlock = (refs) => refs && refs.length ? `【世界书参考】
${refs.map((ref) => `〔${ref.title}〕
${ref.text}`).join(`

`)}` : "";
  function settingMessages({ guide, talk, current, append, refs = [] }) {
    let system = `${guide}

按上面的规则产出，只回「世界观正文」「补定」「速查」三段。`, user = [
      current ? `【已有世界观正文】
${current}` : "",
      append ? "已有正文不改动，只把新增事实写成一段 [追加]。" : "",
      talk ? `【讨论记录】
${talk}` : "",
      refBlock(refs)
    ].filter(Boolean).join(`

`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function rewriteBlockMessages({ guide, current, blockText, fixes }) {
    return [
      { role: "system", content: `${guide}

只重写用户指定的一个分块，保留分块标题行，只输出这个分块。` },
      { role: "user", content: `【完整正文】
${current}

【要重写的分块】
${blockText}

【用户的修改】
${fixes}` }
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
    "顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态。",
    "节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。",
    "每个阶段 2 到 4 个主线节点，事件写已经发生的事实，偏转写玩家改变选择后的调整。",
    "时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。"
  ].join(`
`);
  function outlineMessages({ setting, talk, volumes, volumeNo, request, refs = [] }) {
    let known = (volumes || []).map((volume) => `${volumeLabel(volume.key)}：${volume.stages.map((stage) => stageLabel(stage.key)).join("、")}`), system = `你按用户的设定写剧情大纲，格式必须与样例一致。
${OUTLINE_RULES}

【格式样例】
${formatSample(volumes)}`, user = [
      setting ? `【设定】
${setting}` : "",
      talk ? `【讨论摘要】
${talk}` : "",
      refBlock(refs),
      known.length ? `【已有的卷】
${known.join(`
`)}` : "",
      `只写第 ${volumeNo} 卷。${request || ""}`
    ].filter(Boolean).join(`

`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function rewriteRestMessages({ setting, volumes, fromUnitIndex, units, recent, reason }) {
    let rest = units.slice(fromUnitIndex), byVolume = /* @__PURE__ */ new Map();
    for (let unit of rest)
      byVolume.has(unit.volume) || byVolume.set(unit.volume, []), byVolume.get(unit.volume).push(unit.stage);
    let restText = outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages }))), system = `剧情在执行中偏离了大纲。按已经发生的正文改写剩余阶段，保持卷名与阶段名格式。
${OUTLINE_RULES}

【格式样例】
${formatSample(volumes)}`, user = [
      setting ? `【设定】
${setting}` : "",
      `【需要改写的剩余阶段】
${restText}`,
      reason ? `【偏转说明】
${reason}` : "",
      `【最近正文】
${recent}`
    ].filter(Boolean).join(`

`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function fixYamlMessages(text, error) {
    return [
      { role: "system", content: `修正下面 YAML 的格式错误，内容不变。
${OUTLINE_RULES}` },
      { role: "user", content: `【错误】${error}

${text}` }
    ];
  }
  function extractYaml(text) {
    let raw = String(text || ""), fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw);
    return (fenced ? fenced[1] : raw).trim();
  }
  function hasYamlBlock(text) {
    return /```ya?ml\s*\n[\s\S]*?```/i.test(String(text || ""));
  }
  function parseOutlineReply(text, idOf) {
    let yaml = extractYaml(text);
    try {
      return { ok: !0, yaml, volumes: volumesFromValue(parseYaml(yaml), idOf) };
    } catch (error) {
      let line = yamlErrorLine(error);
      return { ok: !1, yaml, line, error: `${line ? `第 ${line} 行：` : ""}${String(error.message || error).split(`
`)[0]}` };
    }
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
    let text = String(value || ""), key = String(apiKey || "").trim();
    return key && (text = text.split(key).join("[已隐藏]")), text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
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
    }), text = await res.text(), data = null;
    try {
      data = JSON.parse(text);
    } catch {
    }
    if (!res.ok || data && data.error) {
      let detail = safeDetail(data && data.error && (data.error.message || data.error) || data && data.message || text, llm.apiKey);
      throw new Error(`接口请求失败${res.ok ? "" : `（HTTP ${res.status}）`}${detail ? `：${detail}` : ""}`);
    }
    if (!data) throw new Error(`接口返回的不是 JSON${text ? `：${safeDetail(text, llm.apiKey)}` : ""}`);
    return data;
  }
  function stripThinking(text) {
    let out = String(text || "");
    return out = out.replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, ""), out.trim();
  }
  async function viaTavern(messages) {
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
  async function viaCustom(messages, llm, signal) {
    if (!String(llm.model || "").trim()) throw new Error("请先选择模型");
    let body = { ...connection(llm), model: llm.model, stream: !1, messages }, temperature = Number(llm.temperature);
    llm.temperature !== "" && Number.isFinite(temperature) && (body.temperature = temperature);
    let data = await postBackend("generate", body, llm, signal);
    return String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "");
  }
  async function requestLlm(messages, llm, { timeoutMs = 18e4 } = {}) {
    let view = hostWindow(), controller = new view.AbortController(), timer, timeout = new Promise((_, reject) => {
      timer = view.setTimeout(() => {
        controller.abort(), reject(new Error("请求超时"));
      }, timeoutMs);
    });
    try {
      let job = llm.source === "custom" ? viaCustom(messages, llm, controller.signal) : viaTavern(messages), text = stripThinking(await Promise.race([job, timeout]));
      if (!text) throw new Error("模型没有返回内容");
      return text;
    } finally {
      view.clearTimeout(timer);
    }
  }
  async function fetchModels(llm) {
    let data = await postBackend("status", connection(llm), llm), list = Array.isArray(data && data.data) ? data.data : data && data.models, models = [...new Set((Array.isArray(list) ? list : []).map((item) => typeof item == "string" ? item : item && (item.id || item.name)).filter(Boolean))];
    if (!models.length) throw new Error("接口没有返回模型列表");
    return models.sort();
  }

  // src/host/worldbook.js
  function boundBookNames() {
    let c = ctx(), names = [], add = (name, source) => {
      let value = typeof name == "string" ? name.trim() : "";
      value && !names.some((item) => item.name === value) && names.push({ name: value, source });
    };
    if (!c) return names;
    add(c.chatMetadata && c.chatMetadata.world_info, "聊天");
    let card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    add(card && card.data && card.data.extensions && card.data.extensions.world, "角色");
    try {
      let h = helper(), bound = h && typeof h.getCharWorldbookNames == "function" ? h.getCharWorldbookNames("current") : null;
      bound && (add(bound.primary, "角色"), (Array.isArray(bound.additional) ? bound.additional : []).forEach((name) => add(name, "附加")));
    } catch {
    }
    return names;
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
      order: Number(entry.order ?? 100)
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
  var ENTRY_FIELDS = ["comment", "constant", "key", "keysecondary", "position", "depth", "role", "order", "content"];
  function updateEntry(name, key, patch) {
    return queued(name, async () => {
      let data = clone(await loadBook(name)), entry = data.entries[key];
      if (!entry) throw new Error("条目已不存在");
      for (let field of ENTRY_FIELDS) Object.prototype.hasOwnProperty.call(patch, field) && (entry[field] = patch[field]);
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
          for (let field of ENTRY_FIELDS) Object.prototype.hasOwnProperty.call(patch, field) && (entry[field] = patch[field]);
          Object.prototype.hasOwnProperty.call(patch, "keysecondary") && (entry.selective = patch.keysecondary.length > 0);
        }
      }
      return await saveBook(name, data), backup;
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
    let m = meta(), c = ctx();
    return !m || !c.chatId ? !1 : (m[KEY] = { ...readChatState(), projectId }, save(), !0);
  }
  function clearChatProgress() {
    let m = meta();
    if (!m || !m[KEY]) return;
    delete m[KEY];
    let c = ctx();
    if (typeof c.saveMetadata == "function") return c.saveMetadata();
  }

  // src/app/runtime.js
  var VIRTUAL_WORLD = "剧情注入器", LOG_MAX = 40, PENDING_MAX_MS = 3e4, CHECK_RETRIES = 3, RETRY_GAP_MS = 2e3, placeOf = (unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
  function createRuntime({ data, notice, emit, askReason = async () => "" }) {
    let view = hostWindow(), progress = null, progressFor = "", checking = !1, fallbackTimer = 0, generating = !1, chatStartFloors = 0, pendingCheck = !1, pendingTimer = 0, listeners = [], stats = {}, logs = [];
    function log(text) {
      logs.push({ at: Date.now(), text }), logs.length > LOG_MAX && logs.shift();
    }
    function chatBoundId() {
      let id = readChatState().projectId;
      return id && data.index().projects.some((item) => item.id === id) ? id : "";
    }
    function activeId() {
      return chatBoundId() || data.activeIdFor(cardKey());
    }
    function activeProject() {
      let id = activeId();
      return id ? data.project(id) : null;
    }
    function currentProgress() {
      let id = activeId();
      return id ? ((!progress || progressFor !== id) && (progress = readProgress(id), progressFor = id), progress) : null;
    }
    function units() {
      let project = activeProject();
      return project ? flattenUnits(project.outline.volumes) : [];
    }
    function setProgress(next, reason = "progress") {
      progress = next, progressFor = next.projectId, writeProgress(next), scheduleFallback(), emit(reason);
    }
    function entries() {
      let project = activeProject(), prog = currentProgress();
      return project && prog ? buildEntries(project, prog, data.settings()) : [];
    }
    function virtualEntries() {
      return entries().filter((entry) => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }
    function eventTypes() {
      let c = ctx();
      return c && c.eventTypes || {};
    }
    function hasEntriesEvent() {
      return !!eventTypes().WORLDINFO_ENTRIES_LOADED;
    }
    function onEntriesLoaded(payload) {
      if (!(!payload || !Array.isArray(payload.chatLore)))
        try {
          payload.chatLore.push(...virtualEntries());
        } catch (error) {
          console.error("[剧情注入器] 注入失败", error);
        }
    }
    function scheduleFallback() {
      hasEntriesEvent() || (view.clearTimeout(fallbackTimer), fallbackTimer = view.setTimeout(async () => {
        let name = `剧情注入器·${cardName() || "未命名"}`;
        try {
          let result = await writeFallbackBook(name, virtualEntries());
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
    async function rewriteRest(reason) {
      let project = activeProject(), prog = currentProgress(), unit = activeUnit();
      if (!project || !prog || !unit) throw new Error("当前卡没有启用的项目");
      let list = units(), from = list.findIndex((item) => item.id === unit.id), recent = recentFloors(6).map((floor) => floor.text).join(`

`), reply2 = await requestLlm(rewriteRestMessages({ setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units: list, recent, reason }), resolveLlm(data.settings(), "outline")), parsed = parseOutlineReply(reply2);
      if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
      let before = { volumes: project.outline.volumes, progress: prog }, volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
      data.updateProject(project.id, (current) => ({ ...current, outline: { ...current.outline, volumes } }));
      let first = parsed.volumes[0] && parsed.volumes[0].stages[0];
      return first && setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id)), before;
    }
    function undoRewrite(projectId, before) {
      data.updateProject(projectId, (current) => ({ ...current, outline: { ...current.outline, volumes: before.volumes } })), setProgress(before.progress), toast("info", "已撤销改写，恢复原来的大纲和进度。");
    }
    async function runRewrite(reason, { auto = !1 } = {}) {
      let projectId = activeId();
      notice.show({ id: "offtrack", title: "正在改写后续阶段…", body: reason });
      try {
        let before = await rewriteRest(reason);
        notice.show({
          id: "offtrack",
          title: auto ? "剧情偏离大纲，已自动改写后续阶段" : "已改写后续阶段",
          body: reason,
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
          { label: "改写后续阶段", primary: !0, run: async () => {
            let note = await askReason(reason);
            note != null && runRewrite(note.trim() || reason);
          } },
          { label: "暂不", run: () => notice.hide("offtrack") },
          { label: "本阶段不再提醒", run: () => {
            let prog = currentProgress();
            prog && !prog.offMuted.includes(unit.id) && setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
          } }
        ]
      });
    }
    function recentFloors(count) {
      let out = [], chat = chatMessages();
      for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
        let msg = chat[i];
        if (isNote(msg)) continue;
        let text = cleanFloorText(msg.mes);
        text && out.unshift({ index: i, text: `${msg.is_user ? "（用户）" : ""}${text}` });
      }
      return out;
    }
    async function checkNow({ manual = !1 } = {}) {
      if (checking)
        return log("跳过检测：上一次检测还没结束"), null;
      let project = activeProject(), prog = currentProgress(), settings = data.settings();
      if (!project || !prog)
        return log("跳过检测：当前卡没有启用的项目"), manual && toast("info", "当前卡没有启用的项目。"), null;
      let unit = activeUnit();
      if (!unit)
        return log("跳过检测：大纲为空"), null;
      let floors = recentFloors(settings.checkFloors);
      if (!floors.length)
        return log("跳过检测：没有可检测的正文"), manual && toast("info", "还没有可检测的正文。"), null;
      checking = !0, log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? "（手动）" : ""}`), emit("checking");
      try {
        let list = units(), states = unitStates(list, prog), index = buildIndexText(list, states, prog, { carryOver: settings.carryOver }), messages = buildCheckMessages(unit, index, floors), result = null;
        for (let attempt = 0; ; attempt += 1)
          try {
            result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, "check"), { timeoutMs: 12e4 }));
            break;
          } catch (error) {
            if (attempt >= CHECK_RETRIES) throw error;
            log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`), await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS));
          }
        notice.hide("checkfail");
        let next = currentProgress();
        if (next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data), result.done), settings.carryOver) for (let item of carriedNodes(list, states, prog)) next = uncheckByNames(next, item.unit.id, [item.node], result.done);
        return next = { ...next, lastCheckFloor: floorCount() }, setProgress(next), log(`检测完成：已演 ${result.done.length} 个节点${result.stageDone ? "，本阶段已演完" : ""}${result.offTrack ? "，偏离大纲" : ""}`), result.offTrack && settings.offTrackMode !== "off" && !next.offMuted.includes(unit.id) ? handleOffTrack(unit, result.offReason || result.reason) : result.stageDone ? proposeAdvance({ unit, reason: result.reason }) : manual && toast("info", result.reason || "本阶段尚未演完。"), result;
      } catch (error) {
        return setProgress({ ...currentProgress(), lastCheckFloor: floorCount() }), log(`检测失败：${error.message}`), notice.show({
          id: "checkfail",
          title: "进度检测失败",
          body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
          actions: [
            { label: "重试", primary: !0, run: () => checkNow({ manual }) },
            { label: "关闭", run: () => {
            } }
          ]
        }), null;
      } finally {
        checking = !1, emit("checked");
      }
    }
    function clampBase() {
      let prog = currentProgress();
      if (!prog) return null;
      let floors = floorCount();
      if (prog.lastCheckFloor <= floors) return prog;
      log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`);
      let next = { ...prog, lastCheckFloor: floors };
      return setProgress(next, "floor"), next;
    }
    function resetBase() {
      let prog = currentProgress();
      prog && (log(`手动重设检测起点为第 ${floorCount()} 楼`), setProgress({ ...prog, lastCheckFloor: floorCount() }, "floor"));
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
      dryRun || (generating = !0);
    }
    function onGenerationEnded() {
      generating = !1, runPending();
    }
    function onMessageReceived(messageId) {
      let floors = floorCount();
      if (!activeProject()) {
        log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`), emit("floor");
        return;
      }
      let settings = data.settings(), prog = clampBase() || currentProgress(), gap = floors - prog.lastCheckFloor;
      gap >= settings.checkEvery ? (log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`), queueCheck()) : log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`), emit("floor");
    }
    function onMessageChanged() {
      clampBase() && emit("floor");
    }
    async function onChatChanged() {
      progress = null, progressFor = "", pendingCheck = !1, view.clearTimeout(pendingTimer), chatStartFloors = floorCount(), notice.hide("advance"), notice.hide("offtrack");
      let id = activeId();
      if (id)
        try {
          await data.loadProject(id);
        } catch (error) {
          toast("error", `读取项目失败：${error.message}`);
        }
      log(`切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find((item) => item.id === id) || {}).name || id}」` : "本卡没有启用项目"}`), id && clampBase(), scheduleFallback(), emit("chat");
    }
    async function switchProject(id, scope = "chat") {
      id && await data.loadProject(id);
      let bound = bindChat(id);
      (scope === "card" || !bound || !data.activeIdFor(cardKey())) && data.setActive(id), progress = null, progressFor = "", scheduleFallback(), emit("switch");
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
      ["GENERATION_STOPPED", onGenerationEnded]
    ];
    function bind() {
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
      unbind(), view.clearTimeout(fallbackTimer), view.clearTimeout(pendingTimer);
    }
    function diagnose() {
      let types = eventTypes(), bound = new Set(listeners.map((item) => item[0]));
      return {
        hasContext: !!ctx(),
        hasEventSource: !!(ctx() && ctx().eventSource),
        events: BINDINGS.map(([key]) => ({ key, name: types[key] || "", bound: bound.has(key), count: (stats[key] || {}).count || 0, at: (stats[key] || {}).at || 0 })),
        cardKey: cardKey(),
        chatLength: chatMessages().length,
        floors: floorCount(),
        chatStartFloors,
        generating,
        pending: pendingCheck,
        checking,
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
      openNext,
      backTo,
      checkNow,
      isChecking: () => checking,
      switchProject,
      floorCount,
      recentFloors,
      rewriteRest,
      diagnose,
      note: log,
      resetBase,
      rebind: start,
      injectMode: () => hasEntriesEvent() ? "virtual" : "book",
      refresh: () => {
        scheduleFallback(), emit("progress");
      }
    };
  }

  // src/ui/styles.js
  var CSS = `
.pi-root{--pi-accent:#E8507B;--pi-accent-soft:#FEF0F3;--pi-dark:#1E1E2E;--pi-bg:#FFFFFF;--pi-surf:#F3F4F7;--pi-fill:#F5F6F8;--pi-fill2:#ECEDF1;--pi-line:#ECECF1;--pi-rule:#C9CAD3;--pi-txt:#1E1E2E;--pi-txt2:#7C7C8A;--pi-ok:#2E9E6A;--pi-ok-soft:#E9F7F0;--pi-warn:#C98A12;--pi-warn-soft:#FDF5E4;--pi-danger:#D64545;--pi-danger-soft:#FDEDED;--pi-add:#E9F7F0;--pi-del:#FDEDED;--pi-on-dark:#FFFFFF;--pi-user-bg:#1E1E2E;--pi-user-txt:#FFFFFF;--pi-user-txt2:#B4B4C0;--pi-user-hover:#34344A;--pi-r:14px;--pi-r-in:10px;--pi-shadow:0 8px 32px rgba(0,0,0,.15);--pi-font:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;--pi-mono:Consolas,"JetBrains Mono",monospace;font-family:var(--pi-font);color:var(--pi-txt);font-size:14px;line-height:1.55}
.pi-root.is-night{--pi-accent:#F0688F;--pi-accent-soft:#3A2230;--pi-dark:#E6E6EE;--pi-bg:#1F1F2A;--pi-surf:#16161F;--pi-fill:#282835;--pi-fill2:#313140;--pi-line:#2C2C38;--pi-rule:#4A4A5A;--pi-txt:#E6E6EE;--pi-txt2:#9A9AA8;--pi-ok:#4CC08A;--pi-ok-soft:#1C3329;--pi-warn:#E0A63A;--pi-warn-soft:#3A3020;--pi-danger:#EF6B6B;--pi-danger-soft:#3D2224;--pi-add:#1C3329;--pi-del:#3D2224;--pi-on-dark:#16161F;--pi-user-bg:#3A3A4C;--pi-user-txt:#E6E6EE;--pi-user-txt2:#A8A8B6;--pi-user-hover:#4A4A5E;--pi-shadow:0 8px 32px rgba(0,0,0,.5);color-scheme:dark}
.pi-root *,.pi-root *::before,.pi-root *::after{box-sizing:border-box}
.pi-root ::-webkit-scrollbar{display:none}
.pi-root [hidden]{display:none!important}
.pi-root input[type=checkbox]{accent-color:var(--pi-accent)}
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
.pi-psearch svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--pi-txt2);pointer-events:none}
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
.pi-tabs{grid-column:2;display:grid;grid-auto-flow:column;grid-auto-columns:76px;gap:4px}
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
.pi-acts-top{margin-bottom:8px}
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
.pi-md code{font-family:var(--pi-mono);font-size:12px;background:var(--pi-surf);border-radius:4px;padding:1px 4px}
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
.pi-chip.is-on{color:var(--pi-accent);background:var(--pi-accent-soft)}
.pi-diff{font-family:var(--pi-mono);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:var(--pi-surf);border-radius:var(--pi-r-in);padding:6px 0;max-height:360px;overflow:auto}
.pi-diff div{padding:0 10px}
.pi-diff .is-add{background:var(--pi-add)}
.pi-diff .is-del{background:var(--pi-del);text-decoration:line-through;color:var(--pi-txt2)}
.pi-toc{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.pi-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
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
.pi-tree,.pi-split{grid-template-columns:minmax(0,1fr)}
.pi-entry-hd{flex-wrap:wrap}
.pi-wb .pi-entry-hd{flex-wrap:nowrap}
.pi-card h3{flex-wrap:wrap}
.pi-tools.is-c4{--pi-cols:2}
.pi-tree-list{max-height:220px}
.pi-msg{max-width:94%}
.pi-body{padding:10px}
.pi-notices{justify-content:flex-start;align-items:stretch;padding:calc(10px + env(safe-area-inset-top,0px)) 10px 10px}
.pi-notice{width:auto}
.pi-dialog{align-items:flex-start;box-sizing:border-box;padding-top:calc(56px + env(safe-area-inset-top,0px))}
.pi-dialog-box{max-height:calc(100dvh - 80px)}
}
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
    file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9 1v4h4" stroke="currentColor" stroke-width="1.2"/></svg>'
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
  function openDialog({ title: title2, html = "", actions: actions9 = [{ label: "确定", value: !0, primary: !0 }], onMount } = {}) {
    let doc = hostDocument();
    return new Promise((resolve) => {
      let root = el(`<div class="pi-root pi-dialog"><div class="pi-dialog-box" role="dialog">
            ${title2 ? `<h4>${esc(title2)}</h4>` : ""}<div class="pi-dlg-body">${html}</div>
            <div class="pi-dlg-acts">${actions9.map((action, index) => `<button type="button" class="pi-btn${action.primary ? " is-primary" : ""}${action.danger ? " is-danger" : ""}" data-dlg="${index}">${esc(action.label)}</button>`).join("")}</div>
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
        let action = actions9[Number(button.dataset.dlg)], value = typeof action.value == "function" ? action.value(root) : action.value;
        value !== void 0 && finish(value);
      }), doc.addEventListener("keydown", onKey, !0), doc.body.appendChild(root), onMount && onMount(root), root.querySelector("input,textarea,select")?.focus();
    });
  }
  function confirmDialog({ title: title2, body = "", list = [], okLabel = "确定", danger = !1 }) {
    let html = `${body ? `<p class="pi-hint">${esc(body)}</p>` : ""}${list.length ? `<ul>${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}`;
    return openDialog({ title: title2, html, actions: [{ label: "取消", value: !1 }, { label: okLabel, value: !0, primary: !danger, danger }] }).then(Boolean);
  }
  function promptDialog({ title: title2, label = "", value = "", multiline = !1, placeholder = "" }) {
    let input = multiline ? `<textarea class="pi-ta is-mono is-tall" data-dlg-input placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="pi-inp" data-dlg-input value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    return openDialog({
      title: title2,
      html: `<label class="pi-field">${label ? `<span>${esc(label)}</span>` : ""}${input}</label>`,
      actions: [{ label: "取消", value: null }, { label: "确定", primary: !0, value: (root) => root.querySelector("[data-dlg-input]").value }]
    });
  }
  function menuDialog({ title: title2, items }) {
    let html = `<div class="pi-menu-list">${items.map((item) => `<button type="button" class="pi-menu-item${item.danger ? " is-danger" : ""}" data-dlg-value="${esc(item.value)}">${item.icon || ""}<span>${esc(item.label)}</span></button>`).join("")}</div>`;
    return openDialog({ title: title2, html, actions: [{ label: "取消", value: null }] });
  }
  function choiceDialog({ title: title2, body = "", choices }) {
    return openDialog({ title: title2, html: body ? `<p class="pi-hint">${esc(body)}</p>` : "", actions: choices });
  }
  function pickFiles({ accept = "", multiple = !1 } = {}) {
    let doc = hostDocument();
    return new Promise((resolve) => {
      let input = doc.createElement("input");
      input.type = "file", input.accept = accept, input.multiple = multiple, input.hidden = !0, input.addEventListener("change", () => {
        resolve([...input.files]), input.remove();
      }), input.addEventListener("cancel", () => {
        resolve([]), input.remove();
      }), doc.body.appendChild(input), input.click();
    });
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

  // src/core/guide.js
  var BUILTIN_GUIDE = `# 同人世界观速成

## 用途

用户给出原作、角色、类型、基调中的任意几项，产出一段能直接填进世界书条目 content 的正文。

## 语言基准（最高优先级）

- 使用中小学生能看懂的通用规范汉语；去掉明显北方方言腔（儿、咱、甭、咋、得嘞等）。
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
4. 定信息差。写清谁知道真相、谁不知道、各方各自不知道什么。
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
- 需要模型少回放的旧事，在该段后加括注，如\`（AI禁止时时刻刻回忆）\`。
- 硬约束前可加\`⚠️\`，只标真正会让写作跑偏的几条。
- 后补设定用一段\`[追加]\`收尾，只写新增事实，不改动前面已写内容。

## 出稿速查

- [ ] 全部内容只服务于“这个世界是什么、怎么运转、人物处在什么位置”，没有条目化表述。
- [ ] 声明与铁则必写；机制、信息差、人物处境、场景库、钩子库按题材补齐，不写无关分块。
- [ ] 铁则每条只约束一件事，不解释理由，不写“因为/所以”。
- [ ] 机制写清是什么、作用对象、触发条件、代价与后果。
- [ ] 信息差单独成段，写清谁知道、谁不知道、各方各自不知道什么。
- [ ] 场景库写清地点与用途；钩子库标明是可用素材，不写成必将发生的事件。
- [ ] 只写已发生事实与现状，没有必然走向；长线悬念写成留白。
- [ ] 性格默认未锁死；用户未指定的关系结论未被坐实。
- [ ] 人称符合设定：涉及性转或身份错位时，核心角色用“他”，其他角色口中与认知中用“她”；其余题材按用户指定。
- [ ] 没有堆砌身体零件、动作慢镜头、抽象拟物与方言腔。
- [ ] 核心角色不会出现的状态已写明，只写会改变写作走向的几条。

## 输出

只回三段，不加额外说明：

1. 世界观正文：纯文本，直接可粘贴进条目 content，按正文骨架的分块与标题写。
2. 补定：一行一条，列出替用户补齐的项，方便他改；没有补定时省略。
3. 速查：单独一行 \`速查：PASS / FAIL。\``;

  // src/ui/ai.js
  function ask(view, role, messages) {
    return requestLlm(messages, resolveLlm(view.data.settings(), role));
  }
  function guideText(view) {
    return String(view.data.settings().guide || "").trim() || BUILTIN_GUIDE;
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

  // src/core/tokens.js
  function estimateTokens(text) {
    let value = String(text || ""), cjk = (value.match(/[　-鿿가-힯＀-￯]/g) || []).length;
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
    let project = view.project(), units = flattenUnits(project.outline.volumes);
    if (!units.length) return "";
    let progress = view.runtime.progress();
    return buildIndexText(units, unitStates(units, progress), progress, { carryOver: view.data.settings().carryOver });
  }
  function floorsText(view, count) {
    return count ? view.runtime.recentFloors(count).map((floor) => `【第 ${floor.index} 楼】
${floor.text}`).join(`

`) : "";
  }
  async function resolveRefs(view, chat, project) {
    let refs = [], r = chat.refs;
    if (r.setting && project.setting.text.trim() && refs.push({ title: "当前设定", text: project.setting.text }), r.outline && project.outline.volumes.length) {
      let text = outlineToText(project.outline.volumes);
      refs.push({ title: "当前大纲", text: text.length < 12e3 ? text : flattenUnits(project.outline.volumes).map((unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`).join(`
`) });
    }
    if (r.progress) {
      let text = progressText(view);
      text && refs.push({ title: "剧情进度（已演、进行中与之后的阶段）", text });
    }
    let floors = floorsText(view, r.floors);
    return floors && refs.push({ title: `最近 ${r.floors} 楼正文`, text: floors }), [...refs, ...await wbRefTexts(r.wb, r.memo)];
  }
  async function wbRefTexts(rule, memo) {
    let books = await loadBoundBooks(), checked = checkedSet(rule, books, memo), out = [];
    for (let book of books)
      for (let entry of book.entries) checked.has(entryRefId(book.name, entry)) && entry.content.trim() && out.push({ title: entry.title, text: entry.content });
    return out;
  }
  function wbSummary(view, refs, rerender, scope = "discuss") {
    let s = view.tabState(scope), chat = { refs }, sig = JSON.stringify([view.projectId, chat.refs.wb, chat.refs.memo]);
    return s.wbSig === sig ? s.wbSum : (s.wbPending !== sig && (s.wbPending = sig, loadBoundBooks().then((books) => {
      let checked = checkedSet(chat.refs.wb, books, chat.refs.memo), count = 0, tokens = 0;
      for (let book of books) for (let entry of book.entries) checked.has(entryRefId(book.name, entry)) && (count += 1, tokens += estimateTokens(entry.content));
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
            ${fields.map(([field, list]) => {
        let memoField = isMemoField(field), lead = memoField ? '<span class="pi-wb-pad"></span>' : `<input type="checkbox" data-ref-field="${esc(field)}"${fieldChecked(rule, field) ? " checked" : ""}>`, memoBox = memoField ? `<span class="pi-wb-memo">最近<input class="pi-inp is-num" type="number" min="0" data-ref-memo value="${memo}">条</span>` : "";
        return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd">${lead}<button type="button" class="pi-wb-name" data-ref-fold>${ICONS.caret}<span class="pi-wb-field">${esc(field)}</span><small>${list.length}</small></button>${memoBox}</div>
                    <div class="pi-wb-fold" hidden>${list.map((entry) => row(entryRefId(book.name, entry), entry, checked.has(entryRefId(book.name, entry)), ` data-ref-of="${esc(field)}"${memoField ? " data-ref-memo-row" : ""}`)).join("")}</div></div>`;
      }).join("")}</div>` : "";
      return `<div class="pi-ref-book"><p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span></p>${handHtml}${acuHtml || ""}${!hand.length && !fields.length ? '<p class="pi-hint">没有条目</p>' : ""}</div>`;
    }).join("");
  }
  async function pickRefs(refs, title2 = "附带的世界书条目") {
    let chat = { refs }, books = await loadBoundBooks();
    if (!books.length) return { none: !0 };
    let memoRows = (box) => [...box.querySelectorAll("[data-ref-memo-row]")], rowNo2 = (input) => Number((/-(\d+)$/.exec(input.closest("label").querySelector(".pi-wb-title").textContent) || [])[1] ?? -1);
    return await openDialog({
      title: title2,
      html: `<div class="pi-ref-top"><span class="pi-hint" data-ref-sum></span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-ref-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-ref-every="0">全不选</button></div>
            <div class="pi-ref-list">${pickerHtml(books, chat.refs.wb, chat.refs.memo)}</div>`,
      actions: [{ label: "取消", value: null }, {
        label: "确定",
        primary: !0,
        value: (box) => {
          let fields = {};
          box.querySelectorAll("[data-ref-field]").forEach((input) => {
            fields[input.dataset.refField] = input.checked;
          });
          let memoInput = box.querySelector("[data-ref-memo]"), memo = memoInput ? Math.max(0, Math.round(Number(memoInput.value) || 0)) : chat.refs.memo, checked = new Set([...box.querySelectorAll("[data-ref-id]:checked")].map((input) => input.dataset.refId));
          return { memo, wb: ruleFromSelection(books, fields, checked, memo) };
        }
      }],
      onMount(box) {
        let byId = /* @__PURE__ */ new Map();
        for (let book of books) for (let entry of book.entries) byId.set(entryRefId(book.name, entry), entry);
        let sum = () => {
          let ids = [...box.querySelectorAll("[data-ref-id]:checked")].map((input) => input.dataset.refId), tokens = ids.reduce((total, id) => total + estimateTokens(byId.get(id)?.content || ""), 0);
          box.querySelector("[data-ref-sum]").textContent = `已选 ${ids.length} 条，约 ${tokens} token`;
        }, applyMemo = () => {
          let n = Math.max(0, Math.round(Number(box.querySelector("[data-ref-memo]")?.value) || 0));
          for (let book of box.querySelectorAll(".pi-ref-book")) memoRows(book).sort((a, b) => rowNo2(b) - rowNo2(a)).forEach((input, i) => {
            input.checked = i < n;
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
            box.querySelectorAll("[data-ref-id], [data-ref-field]").forEach((input) => {
              input.checked = on;
            });
            let memoInput = box.querySelector("[data-ref-memo]");
            memoInput && (memoInput.value = on ? String(Math.max(...[...box.querySelectorAll(".pi-ref-book")].map((book) => memoRows(book).length), 0)) : "0"), sum();
            return;
          }
          let all = event.target.closest("[data-ref-all]");
          all && ([...box.querySelectorAll("[data-ref-hand]")].filter((input) => input.dataset.refHand === all.dataset.refAll).forEach((input) => {
            input.checked = all.dataset.on === "1";
          }), sum());
        }), box.addEventListener("change", (event) => {
          let field = event.target.dataset.refField;
          field !== void 0 && [...box.querySelectorAll("[data-ref-of]")].filter((input) => input.dataset.refOf === field).forEach((input) => {
            input.checked = event.target.checked;
          }), sum();
        }), box.addEventListener("input", (event) => {
          event.target.matches("[data-ref-memo]") && (applyMemo(), sum());
        }), sum();
      }
    });
  }

  // src/ui/markdown.js
  function inline(text) {
    let codes = [], out = esc(text).replace(/`([^`]+)`/g, (_, code) => `\0${codes.push(code) - 1}\0`);
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
    let lines = String(src ?? "").replace(/\r\n?/g, `
`).split(`
`), out = [], i = 0;
    for (; i < lines.length; ) {
      let line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      if (RE.fence.test(line)) {
        let mark = line.trim().slice(0, 3), body = [];
        for (i += 1; i < lines.length && !lines[i].trim().startsWith(mark); ) body.push(lines[i++]);
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
      if (line.includes("|") && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        let head = cells(line);
        i += 2;
        let rows2 = [];
        for (; i < lines.length && lines[i].includes("|") && lines[i].trim(); ) rows2.push(cells(lines[i++]));
        out.push(`<div class="pi-md-table"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
                <tbody>${rows2.map((row2) => `<tr>${row2.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (RE.quote.test(line)) {
        let body = [];
        for (; i < lines.length && RE.quote.test(lines[i]); ) body.push(lines[i++].replace(RE.quote, ""));
        out.push(`<blockquote>${renderMarkdown(body.join(`
`))}</blockquote>`);
        continue;
      }
      let list = RE.ul.test(line) ? "ul" : RE.ol.test(line) ? "ol" : "";
      if (list) {
        let items = [];
        for (; i < lines.length && RE[list].test(lines[i]); ) {
          let [, indent, text] = RE[list].exec(lines[i++]);
          items.push(`<li${indent.length >= 2 ? ' class="is-sub"' : ""}>${inline(text)}</li>`);
        }
        out.push(`<${list}>${items.join("")}</${list}>`);
        continue;
      }
      let para = [];
      for (; i < lines.length && lines[i].trim() && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i]) && !RE.hr.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i]); ) para.push(inline(lines[i++]));
      out.push(`<p>${para.join("<br>")}</p>`);
    }
    return out.join("");
  }

  // src/ui/tab-outline.js
  var tab_outline_exports = {};
  __export(tab_outline_exports, {
    actions: () => actions,
    onBlur: () => onBlur,
    onInput: () => onInput,
    refreshOn: () => refreshOn,
    render: () => render,
    showDraft: () => showDraft,
    startRewrite: () => startRewrite
  });

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
    let html = loaded.map((book, b) => `<p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span>${book.error ? ` <span class="pi-badge is-danger">${esc(book.error)}</span>` : ""}</p>
        ${book.entries.map((entry, e) => `<label class="pi-check${entry.disabled ? " is-off" : ""}"><input type="checkbox" data-pick="${b}:${e}">
        <span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length} 字</span></span></label>`).join("")}`).join(""), picked = await openDialog({
      title: title2,
      html: `<div class="pi-ref-top"><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="0">全不选</button></div>${html}`,
      actions: [{ label: "取消", value: null }, { label: "导入选中", primary: !0, value: (root) => [...root.querySelectorAll("[data-pick]:checked")].map((input) => input.dataset.pick) }],
      onMount(box) {
        box.addEventListener("click", (event) => {
          let every = event.target.closest("[data-pick-every]");
          every && box.querySelectorAll("[data-pick]").forEach((input) => {
            input.checked = every.dataset.pickEvery === "1";
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
  async function afterImport(entries) {
    if (!entries.length) return;
    let choice = await choiceDialog({
      title: "世界书里的原条目",
      body: "原条目和注入内容会重复。关闭只改「禁用」，可随时在世界书里重新打开。",
      choices: [{ label: "保留", value: "keep" }, { label: "删除", value: "delete", danger: !0 }, { label: "关闭", value: "disable", primary: !0 }]
    });
    if (!choice || choice === "keep") return;
    let byBook = /* @__PURE__ */ new Map();
    for (let entry of entries)
      byBook.has(entry.book) || byBook.set(entry.book, []), byBook.get(entry.book).push(entry.key);
    try {
      for (let [book, keys] of byBook)
        choice === "disable" ? await setEntriesDisabled(book, keys, !0) : downloadBlob(`${book}-已删条目备份.json`, JSON.stringify(await deleteEntries(book, keys), null, 2));
      toast("success", choice === "disable" ? "已关闭原条目。" : "已删除原条目，备份已下载。");
    } catch (error) {
      toast("error", error.message);
    }
  }

  // src/ui/tab-outline.js
  var NODE_KEYS = {
    main: ["名称", "地点", "事件", "偏转"],
    side: ["名称", "地点", "事件", "触发", "偏转"],
    world: ["类型", "来源", "内容"]
  }, LONG_KEYS = /* @__PURE__ */ new Set(["事件", "偏转", "内容", "触发"]), NEW_NODE = { main: { 名称: "", 地点: "", 事件: "", 偏转: "" }, side: { 名称: "", 地点: "", 事件: "", 触发: "" }, world: { 类型: "", 来源: "", 内容: "" } }, st = (view) => view.tabState("outline");
  function findSel(project, sel) {
    for (let volume of project.outline.volumes) {
      if (volume.id === sel) return { volume };
      let stage = volume.stages.find((item) => item.id === sel);
      if (stage) return { volume, stage };
    }
    return {};
  }
  function treeHtml(project, sel) {
    return project.outline.volumes.map((volume) => `<button type="button" class="pi-titem is-vol${volume.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeLabel(volume.key))}</span></button>
        ${volume.stages.map((stage) => `<button type="button" class="pi-titem is-stage${stage.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join("")}`).join("") || '<p class="pi-hint">还没有卷。</p>';
  }
  function nodeEditor(stage, meta2) {
    let items = (Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field] : []).map((item, index) => {
      let value = item && typeof item == "object" ? item : { 内容: String(item ?? "") }, keys = [.../* @__PURE__ */ new Set([...NODE_KEYS[meta2.kind], ...Object.keys(value)])];
      return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(meta2.label)} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-btn is-sm" data-act="node-up" data-field="${esc(meta2.field)}" data-i="${index}"${index ? "" : " disabled"}>上移</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="node-del" data-field="${esc(meta2.field)}" data-i="${index}">删除</button></div>
            ${keys.map((key) => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key) ? `<textarea class="pi-ta" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? "")}</textarea>` : `<input class="pi-inp" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? "")}">`}</label>`).join("")}</div>`;
    }).join("");
    return `<div class="pi-card"><h3>${esc(meta2.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta2.field)}" data-kind="${meta2.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
  }
  function nodeTabs(stage, kind) {
    let count = (meta2) => Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field].length : 0;
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map((meta2) => `<button type="button" class="pi-seg-btn${meta2.kind === kind ? " is-sel" : ""}" data-act="node-kind" data-kind="${meta2.kind}">${esc(meta2.label)} ${count(meta2)}</button>`).join("")}</div>`;
  }
  function stageEditor(volume, stage, raw, kind) {
    let known = /* @__PURE__ */ new Set(["时间范围", "AI指令", ...NODE_FIELDS.map((item) => item.field)]), extra = Object.keys(stage.data).filter((key) => !known.has(key)), head = `<div class="pi-card"><h3>阶段</h3>
        <p class="pi-hint">所属：${esc(volumeLabel(volume.key))}</p>
        <div class="pi-tools is-c3"><button type="button" class="pi-btn is-sm" data-act="stage-up">上移</button>
        <button type="button" class="pi-btn is-sm" data-act="raw">${raw ? "表单编辑" : "YAML 原文"}</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="stage-del">删除阶段</button></div>`;
    return raw ? `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>` : `${head}<label class="pi-field"><span>阶段名（阶段N_标题）</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}"></label>
        <label class="pi-field"><span>时间范围（用来判断何时切到下一段）</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? "")}"></label>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta" rows="2" data-stage-field="AI指令">${esc(stage.data.AI指令 ?? "")}</textarea></label>
        ${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join("、"))}（在 YAML 原文里编辑）</p>` : ""}</div>
        ${nodeTabs(stage, kind)}${nodeEditor(stage, NODE_FIELDS.find((meta2) => meta2.kind === kind))}`;
  }
  function volumeEditor(volume) {
    return `<div class="pi-card"><h3>卷</h3>
        <div class="pi-tools is-c4"><button type="button" class="pi-btn is-sm" data-act="stage-add">＋新阶段</button>
        <button type="button" class="pi-btn is-sm" data-act="vol-up">上移</button>
        <button type="button" class="pi-btn is-sm" data-act="vol-export">导出本卷</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="vol-del">删除卷</button></div>
        <label class="pi-field"><span>卷名（剧情_卷X_标题）</span><input class="pi-inp" data-vol-key value="${esc(volume.key)}"></label>
        <p class="pi-hint">${volume.stages.length} 个阶段</p></div>`;
  }
  function draftHtml(view, draft) {
    if (!draft) return "";
    let title2 = draft.mode === "rewrite" ? "改写后续阶段" : "AI 写的大纲";
    if (!draft.ok)
      return `<div class="pi-card"><h3>${title2}<span class="pi-badge is-danger">格式错误</span></h3>
            <p class="pi-hint">${esc(draft.error)}</p>
            <textarea class="pi-ta is-mono is-tall" data-draft-yaml>${esc(draft.yaml)}</textarea>
            <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="draft-fix"${view.busy.outline ? " disabled" : ""}>让 AI 修正格式</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-reparse">重新解析</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
    let summary = draft.volumes.map((volume) => `<p class="pi-hint"><b>${esc(volumeLabel(volume.key))}</b>：${volume.stages.map((stage) => esc(stageLabel(stage.key))).join("、")}</p>`).join(""), buttons = draft.mode === "rewrite" ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>' : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">存为新卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-replace">替换选中卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-append">追加为新阶段</button>`;
    return `<div class="pi-card"><h3>${title2}<span class="pi-badge is-ok">已解析</span></h3>${summary}
        <details><summary class="pi-hint">YAML 原文</summary><pre class="pi-pre">${esc(draft.yaml)}</pre></details>
        <div class="pi-tools is-end ${draft.mode === "rewrite" ? "is-c2" : "is-c4"}">${buttons}<button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
  }
  function render(view) {
    let project = view.project(), s = st(view), { volume, stage } = findSel(project, s.sel), busy = view.busy.outline, kind = NODE_FIELDS.some((meta2) => meta2.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind, editor2 = stage ? stageEditor(volume, stage, s.raw, kind) : volume ? volumeEditor(volume) : '<div class="pi-card"><p class="pi-hint">从左边选一卷或一个阶段编辑。</p></div>';
    return `<div class="pi-card"><h3>大纲</h3>
        <div class="pi-tools is-c4">
            <button type="button" class="pi-btn is-sm" data-act="import-file">导入YAML</button>
            <button type="button" class="pi-btn is-sm" data-act="import-paste">粘贴</button>
            <button type="button" class="pi-btn is-sm" data-act="import-wb">从世界书</button>
            <button type="button" class="pi-btn is-sm" data-act="export"${project.outline.volumes.length ? "" : " disabled"}>导出</button></div>
        ${genRefsBar(view, "outline")}
        <div class="pi-inline"><input class="pi-inp" data-ai-request placeholder="给 AI 的额外要求（可空）" value="${esc(s.request || "")}">
            <button type="button" class="pi-btn is-primary is-sm is-wide" data-act="ai-volume"${busy ? " disabled" : ""}>${busy ? '<span class="pi-spin"></span>写作中' : `AI 写第 ${project.outline.volumes.length + 1} 卷`}</button></div>
        </div>
        ${draftHtml(view, s.draft)}
        <div class="pi-tree"><div class="pi-tree-list">${treeHtml(project, s.sel)}
            <button type="button" class="pi-btn is-sm is-ghost is-block" data-act="vol-add">＋新卷</button></div>
            <div>${editor2}</div></div>`;
  }
  function update2(view, fn) {
    return view.data.updateProject(view.projectId, (project) => ({ ...project, outline: { ...project.outline, volumes: fn(project.outline.volumes) } }));
  }
  function updateStage(view, stageId, fn) {
    update2(view, (volumes) => volumes.map((volume) => volume.stages.some((stage) => stage.id === stageId) ? { ...volume, stages: volume.stages.map((stage) => stage.id === stageId ? fn(stage) : stage) } : volume));
  }
  function updateVolume(view, volumeId, fn) {
    update2(view, (volumes) => volumes.map((volume) => volume.id === volumeId ? fn(volume) : volume));
  }
  function moveUp(list, index) {
    if (index <= 0) return list;
    let out = [...list];
    return [out[index - 1], out[index]] = [out[index], out[index - 1]], out;
  }
  function addVolumes(view, incoming) {
    let project = view.project(), existing = new Set(project.outline.volumes.map((volume) => volume.key)), fresh = incoming.map((volume) => existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume);
    return update2(view, (volumes) => [...volumes, ...fresh]), st(view).sel = fresh[0] && fresh[0].id, view.runtime.refresh(), fresh;
  }
  async function importTexts(view, texts) {
    let added = [], failed = [];
    for (let { name, text } of texts)
      try {
        added.push(...parseOutlineText(text));
      } catch (error) {
        failed.push(`${name}：${error.message}`);
      }
    added.length && addVolumes(view, added), failed.length ? toast("error", failed.join(`
`)) : added.length && toast("success", `已导入 ${added.length} 卷。`), view.renderBody();
  }
  function setDraft(view, mode, reply2, extra = {}) {
    st(view).draft = { mode, ...parseOutlineReply(reply2), ...extra }, view.renderBody();
  }
  function showDraft(view, reply2) {
    setDraft(view, "volume", reply2);
  }
  async function startRewrite(view) {
    let project = view.project(), units = flattenUnits(project.outline.volumes);
    if (!units.length) return;
    let from = Math.max(0, currentIndex(units, view.runtime.progress())), reason = await promptDialog({ title: "让 AI 改写后续阶段", label: "偏转说明（可空）：剧情哪里和大纲不一样了", multiline: !0 });
    if (reason == null) return;
    view.go("outline");
    let recent = view.runtime.recentFloors(6).map((floor) => floor.text).join(`

`), reply2 = await runTask(view, "outline", () => ask(view, "outline", rewriteRestMessages({
      setting: project.setting.text,
      volumes: project.outline.volumes,
      fromUnitIndex: from,
      units,
      recent,
      reason
    })));
    reply2 && setDraft(view, "rewrite", reply2, { fromUnitId: units[from].id });
  }
  function applyRest(view, draft) {
    let project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit) throw new Error("原来的阶段已不存在，改用「存为新卷」。");
    let volumes = replaceRest(project.outline.volumes, unit.stage.id, draft.volumes);
    update2(view, () => volumes);
    let first = draft.volumes[0] && draft.volumes[0].stages[0];
    first && view.runtime.activeId() === view.projectId && view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id));
  }
  var actions = {
    ...genActions,
    "node-kind"(view, target) {
      st(view).nodeKind = target.dataset.kind, view.renderBody();
    },
    sel(view, target) {
      st(view).sel = target.dataset.id, st(view).raw = !1, view.renderBody();
    },
    "vol-add"(view) {
      let project = view.project(), volume = { id: makeId("v"), key: `剧情_卷${project.outline.volumes.length + 1}_新卷`, stages: [{ id: makeId("s"), key: "阶段一_新阶段", data: { 时间范围: "", AI指令: "", 主线节点: [] } }] };
      update2(view, (volumes) => [...volumes, volume]), st(view).sel = volume.id, view.renderBody();
    },
    "vol-up"(view) {
      update2(view, (volumes) => moveUp(volumes, volumes.findIndex((volume) => volume.id === st(view).sel))), view.runtime.refresh(), view.renderBody();
    },
    "vol-export"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      volume && downloadBlob(`${volume.key}.yaml`, volumeToText(volume), "text/yaml");
    },
    async "vol-del"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      !volume || !await confirmDialog({ title: `删除「${volumeLabel(volume.key)}」`, body: `连同 ${volume.stages.length} 个阶段一起删除。`, okLabel: "删除", danger: !0 }) || (update2(view, (volumes) => volumes.filter((item) => item.id !== volume.id)), st(view).sel = "", view.runtime.refresh(), view.renderBody());
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
    async "stage-del"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      !stage || !await confirmDialog({ title: `删除「${stageLabel(stage.key)}」`, okLabel: "删除", danger: !0 }) || (updateVolume(view, volume.id, (item) => ({ ...item, stages: item.stages.filter((entry) => entry.id !== stage.id) })), st(view).sel = volume.id, view.runtime.refresh(), view.renderBody());
    },
    raw(view) {
      st(view).raw = !st(view).raw, view.renderBody();
    },
    "raw-apply"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), box = target.closest(".pi-card"), status = box.querySelector("[data-raw-status]");
      try {
        let parsed = parseOutlineText(box.querySelector("[data-raw]").value), next = parsed[0] && parsed[0].stages[0];
        if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error("原文里只能有一个阶段");
        updateStage(view, stage.id, (item) => ({ ...item, key: next.key, data: next.data })), view.runtime.refresh(), st(view).raw = !1, view.renderBody();
      } catch (error) {
        status.textContent = error.message, status.classList.add("is-err");
      }
    },
    "node-add"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field = target.dataset.field;
      updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: [...Array.isArray(item.data[field]) ? item.data[field] : [], { ...NEW_NODE[target.dataset.kind] }] } })), view.renderBody();
    },
    "node-up"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field = target.dataset.field;
      updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: moveUp(item.data[field], Number(target.dataset.i)) } })), view.runtime.refresh(), view.renderBody();
    },
    async "node-del"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field = target.dataset.field, index = Number(target.dataset.i), node = stage.data[field][index];
      await confirmDialog({ title: `删除「${node && (node.名称 || node.类型) || "节点"}」`, okLabel: "删除", danger: !0 }) && (updateStage(view, stage.id, (item) => {
        let list = item.data[field].filter((_, i) => i !== index), data = { ...item.data, [field]: list };
        return !list.length && field !== "主线节点" && delete data[field], { ...item, data };
      }), view.runtime.refresh(), view.renderBody());
    },
    async "import-file"(view) {
      let files = await pickFiles({ accept: ".yaml,.yml,.txt", multiple: !0 });
      files.length && await importTexts(view, await Promise.all(files.sort((a, b) => a.name.localeCompare(b.name, "zh")).map(async (file) => ({ name: file.name, text: await file.text() }))));
    },
    async "import-paste"(view) {
      let text = await promptDialog({ title: "粘贴剧情 YAML", multiline: !0, placeholder: `剧情_卷一_标题:
  阶段一_标题:
    时间范围: …` });
      text && await importTexts(view, [{ name: "粘贴内容", text }]);
    },
    async "import-wb"(view) {
      let picked = await pickWorldbookEntries("从世界书导入大纲或设定");
      if (!picked.length) return;
      let { outline, setting } = classifyEntries(picked);
      outline.length && addVolumes(view, outline.flatMap((item) => item.volumes)), setting.length && view.data.updateProject(view.projectId, (project) => {
        let text = [project.setting.text, ...setting.map((entry) => entry.content)].filter(Boolean).join(`

`);
        return { ...project, setting: { ...project.setting, text } };
      }), toast("success", `${outline.length} 条进大纲，${setting.length} 条进设定。`), view.runtime.refresh(), view.renderBody(), await afterImport(picked);
    },
    async export(view) {
      let project = view.project(), choice = await choiceDialog({ title: "导出大纲", choices: [{ label: "取消", value: null }, { label: "每卷一个文件", value: "each" }, { label: "合成一个文件", value: "one", primary: !0 }] });
      choice === "one" && downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), "text/yaml"), choice === "each" && project.outline.volumes.forEach((volume, i) => downloadBlob(`${String(i + 1).padStart(2, "0")}-${volume.key}.yaml`, volumeToText(volume), "text/yaml"));
    },
    async "ai-volume"(view) {
      let project = view.project(), { talk, wb } = await genRefTexts(view, 12e3);
      if (!project.setting.text.trim() && !talk.trim() && !wb.length) throw new Error("没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。");
      let reply2 = await runTask(view, "outline", () => ask(view, "outline", outlineMessages({
        setting: project.setting.text,
        talk,
        refs: wb,
        volumes: project.outline.volumes,
        volumeNo: project.outline.volumes.length + 1,
        request: st(view).request
      })));
      reply2 && setDraft(view, "volume", reply2);
    },
    async "draft-fix"(view, target) {
      let draft = st(view).draft, box = target.closest(".pi-card").querySelector("[data-draft-yaml]"), text = box ? box.value : draft.yaml, reply2 = await runTask(view, "outline", () => ask(view, "outline", fixYamlMessages(text, draft.error)));
      reply2 && setDraft(view, draft.mode, reply2, { fromUnitId: draft.fromUnitId });
    },
    "draft-reparse"(view, target) {
      let draft = st(view).draft, yaml = target.closest(".pi-card").querySelector("[data-draft-yaml]").value;
      setDraft(view, draft.mode, `\`\`\`yaml
${yaml}
\`\`\``, { fromUnitId: draft.fromUnitId });
    },
    "draft-drop"(view) {
      st(view).draft = null, view.renderBody();
    },
    "draft-new"(view) {
      addVolumes(view, st(view).draft.volumes), st(view).draft = null, view.renderBody();
    },
    async "draft-replace"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要替换的卷");
      if (!await confirmDialog({ title: `替换「${volumeLabel(volume.key)}」`, body: "该卷原有阶段全部换成 AI 写的内容。", okLabel: "替换", danger: !0 })) return;
      let incoming = st(view).draft.volumes;
      update2(view, (volumes) => volumes.flatMap((item) => item.id === volume.id ? incoming : [item])), st(view).draft = null, st(view).sel = incoming[0].id, view.runtime.refresh(), view.renderBody();
    },
    "draft-append"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要追加到的卷");
      let stages = st(view).draft.volumes.flatMap((item) => item.stages);
      updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, ...stages] })), st(view).draft = null, view.runtime.refresh(), view.renderBody();
    },
    async "draft-rest"(view) {
      await confirmDialog({ title: "替换剩余阶段", body: "当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。", okLabel: "替换", danger: !0 }) && (applyRest(view, st(view).draft), st(view).draft = null, view.renderBody());
    }
  };
  function renameInTree(target, id, label) {
    let item = target.closest(".pi-body")?.querySelector(`.pi-titem[data-id="${id}"] .pi-pname`);
    item && (item.textContent = label);
  }
  function onInput(view, target) {
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
        let field = target.dataset.stageField;
        updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: target.value } }));
        return;
      }
      if (target.dataset.nodeField) {
        let field = target.dataset.nodeField, index = Number(target.dataset.i), key = target.dataset.k;
        updateStage(view, stage.id, (item) => {
          let list = [...item.data[field]], prev = list[index] && typeof list[index] == "object" ? list[index] : {};
          return list[index] = { ...prev, [key]: target.value }, { ...item, data: { ...item.data, [field]: list } };
        });
      }
    }
  }
  function onBlur(view, target) {
    target.matches("[data-stage-key],[data-vol-key],[data-stage-field],[data-node-field]") && view.runtime.refresh();
  }
  var refreshOn = [];

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

  // src/core/setting.js
  var HEADING = /^(?:#{1,4}\s*)?([^\s\-*#\[][^:：]{0,30})[:：]\s*$|^(?:#{1,4}\s+)(.{1,30})$|^(\[追加\])\s*$/;
  function splitBlocks(text) {
    let lines = String(text || "").replace(/\r\n/g, `
`).split(`
`), blocks = [], current = { key: "", lines: [] }, counts = {};
    for (let line of lines) {
      let match = HEADING.exec(line);
      if (match) {
        (current.key || current.lines.some((item) => item.trim())) && blocks.push(current);
        let title2 = (match[1] || match[2] || match[3]).trim();
        counts[title2] = (counts[title2] || 0) + 1, current = { key: counts[title2] > 1 ? `${title2}#${counts[title2]}` : title2, title: title2, lines: [line] };
      } else
        current.lines.push(line);
    }
    return (current.key || current.lines.some((item) => item.trim())) && blocks.push(current), blocks.map((block) => ({ key: block.key || "开头", title: block.title || "开头", text: block.lines.join(`
`).replace(/\n+$/, "") }));
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
  var SECTION = /^\s*(?:#{1,4}\s*|\d+\s*[.、．]\s*|\*\*)*\s*(世界观正文|补定|速查)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*/;
  function stripFence(text) {
    let match = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(text);
    return (match ? match[1] : text).trim();
  }
  function parseSettingReply(text) {
    let lines = String(text || "").replace(/\r\n/g, `
`).split(`
`), sections = { 世界观正文: [], 补定: [], 速查: [] }, current = "世界观正文", sawHeading = !1;
    for (let line of lines) {
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
`)), fixes = sections.补定.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, "").trim()).filter(Boolean), verdict = /(PASS|FAIL)/i.exec([...sections.速查, ...sawHeading ? [] : lines.slice(-3)].join(" "));
    return { body, fixes, check: verdict ? verdict[1].toUpperCase() : "" };
  }
  function pushHistory(history, text, limit = 10, now = Date.now()) {
    let list = Array.isArray(history) ? history : [];
    return list.length && list[0].text === text ? list : [{ at: now, text }, ...list].slice(0, limit);
  }
  function diffLines(a, b) {
    let x = String(a || "").split(`
`), y = String(b || "").split(`
`);
    if (x.length * y.length > 4e6) return [...x.map((text) => ({ op: "-", text })), ...y.map((text) => ({ op: "+", text }))];
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

  // src/ui/tab-setting.js
  var st2 = (view) => view.tabState("setting");
  function diffHtml(a, b) {
    return `<div class="pi-diff">${diffLines(a, b).map((line) => `<div class="${line.op === "+" ? "is-add" : line.op === "-" ? "is-del" : ""}">${esc(line.text) || " "}</div>`).join("")}</div>`;
  }
  function checkBadge(check) {
    return check ? `<span class="pi-badge ${check === "PASS" ? "is-ok" : "is-danger"}">速查 ${esc(check)}</span>` : "";
  }
  function fixesHtml(fixes, where) {
    return fixes.length ? `<p class="pi-hint">补定（替你补齐的项）：</p>${fixes.map((fix, i) => `<div class="pi-fix"><span class="pi-fix-text">· ${esc(fix)}</span>
        <span class="pi-fix-acts"><button type="button" class="pi-btn is-sm" data-act="fix-ok" data-where="${where}" data-i="${i}">确认</button>
        <button type="button" class="pi-btn is-sm" data-act="fix-edit" data-where="${where}" data-i="${i}">修改</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="fix-drop" data-where="${where}" data-i="${i}">丢弃</button></span></div>`).join("")}` : "";
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
  function historyHtml(project, at) {
    let list = project.setting.history;
    if (!list.length) return '<div class="pi-card"><h3>历史版本</h3><p class="pi-hint">还没有历史版本。</p></div>';
    let fmt = (time2) => new Date(time2).toLocaleString(), chosen = list[at];
    return `<div class="pi-card"><h3>历史版本</h3>
        ${list.map((item, i) => `<div class="pi-row"><span class="pi-grow">${esc(fmt(item.at))} · ${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm" data-act="hist-diff" data-i="${i}">对比当前</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">回退到此版</button></div>`).join("")}
        ${chosen ? `<p class="pi-hint">${esc(fmt(chosen.at))} → 当前</p>${diffHtml(chosen.text, project.setting.text)}` : ""}</div>`;
  }
  function render2(view) {
    let project = view.project(), s = st2(view), text = project.setting.text, blocks = splitBlocks(text).filter((block) => block.title !== "开头"), busy = view.busy.setting;
    return `${s.draft ? draftHtml2(view, project, s.draft) : ""}
        <div class="pi-card"><h3>设定 ${checkBadge(project.setting.check)}</h3>
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-sm is-primary" data-act="from-talk"${busy ? " disabled" : ""}>${busy ? '<span class="pi-spin"></span>整理中' : "AI 整理"}</button>
            <button type="button" class="pi-btn is-sm" data-act="import-wb">从世界书导入</button>
            <button type="button" class="pi-btn is-sm${s.history ? " is-primary" : ""}" data-act="history">历史版本 ${project.setting.history.length}</button>
            <label class="pi-check"><input type="checkbox" data-append${s.append ? " checked" : ""}><span>只追加，不改动已有分块</span></label></div>
        ${genRefsBar(view, "setting")}
        ${blocks.length ? `<div class="pi-toc">${blocks.map((block) => `<span class="pi-chip pi-block-chip"><button type="button" data-act="jump" data-key="${esc(block.key)}" title="跳到这一块">${esc(block.title)}</button><button type="button" class="pi-block-del" data-act="block-del" data-key="${esc(block.key)}" title="删除整个分块">${ICONS.close}</button></span>`).join("")}</div>` : ""}
        <textarea class="pi-ta is-tall" data-setting placeholder="世界观正文。执行时作为常驻条目注入（角色定义后），取代世界书里手改的剧情设定条目。">${esc(text)}</textarea>
        <div class="pi-row"><span class="pi-hint pi-grow">≈<span data-tokens>${estimateTokens(text)}</span> token</span><span class="pi-status" data-save-status></span></div>
        ${fixesHtml(project.setting.fixes, "saved")}</div>
        ${s.history ? historyHtml(project, s.historyAt) : ""}`;
  }
  function setSetting(view, patch) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, setting: { ...project.setting, ...patch } }));
  }
  function commit(view, text, extra = {}) {
    let project = view.project(), history = pushHistory(project.setting.history, project.setting.text);
    history = pushHistory(history, text), setSetting(view, { text, history, ...extra }), view.runtime.refresh();
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
    let s = st2(view), project = view.project(), fixes = where === "draft" ? s.draft.fixes : project.setting.fixes, source = where === "draft" ? s.draft.body : project.setting.text, blocks = splitBlocks(source), pick = `<label class="pi-field"><span>${drop ? "写在哪个分块" : "改哪个分块"}</span><select class="pi-sel" data-f="block">${options(blocks.map((block2) => ({ value: block2.key, label: block2.title })), guessBlock(blocks, fixes[index]))}</select></label>`, readKey = (box) => box.querySelector("[data-f=block]").value, result = await openDialog({
      title: drop ? "丢弃补定" : "修改补定",
      html: `<p class="pi-hint">${esc(fixes[index])}</p>${blocks.length ? pick : ""}
            ${drop ? "" : '<label class="pi-field"><span>怎么改</span><textarea class="pi-ta" data-f="text"></textarea></label>'}`,
      actions: drop ? [{ label: "取消", value: null }, { label: "只从列表移除", value: { listOnly: !0 } }, { label: "让 AI 从正文删掉", primary: !0, danger: !0, value: (box) => blocks.length ? { key: readKey(box), drop: !0 } : { listOnly: !0 } }] : [{ label: "取消", value: null }, { label: "让 AI 重写该分块", primary: !0, value: (box) => ({ key: readKey(box), text: box.querySelector("[data-f=text]").value.trim() }) }]
    });
    if (!result) return;
    if (result.listOnly) return removeFix(view, where, index);
    if (!result.drop && !result.text) return;
    let block = blocks.find((item) => item.key === result.key), note = result.drop ? `${fixes[index]}
改为：删除这一条，正文里不再保留它的内容，其余不变。` : `${fixes[index]}
改为：${result.text}`, reply2 = await runTask(view, "setting", () => ask(view, "outline", rewriteBlockMessages({ guide: guideText(view), current: source, blockText: block.text, fixes: note })));
    if (!reply2) return;
    let rewritten = splitBlocks(parseSettingReply(reply2).body)[0];
    if (!rewritten) throw new Error("AI 没有返回分块内容");
    let merged = joinBlocks(blocks.map((item) => item.key === block.key ? { ...item, text: rewritten.text } : item)), rest = fixes.filter((_, i) => i !== index);
    where === "draft" ? s.draft = { ...s.draft, body: merged, fixes: rest } : commit(view, merged, { fixes: rest }), view.renderBody();
  }
  var actions2 = {
    ...genActions,
    async "from-talk"(view) {
      let project = view.project(), { talk, wb } = await genRefTexts(view);
      if (!talk.trim() && !wb.length) throw new Error("没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。");
      let append = !!(st2(view).append && project.setting.text.trim()), reply2 = await runTask(view, "setting", () => ask(view, "outline", settingMessages({ guide: guideText(view), talk, current: project.setting.text, append, refs: wb })));
      if (!reply2) return;
      let parsed = parseSettingReply(reply2);
      if (!parsed.body) throw new Error("AI 回复里没有世界观正文");
      let body = append ? `${project.setting.text.trim()}

${parsed.body}` : parsed.body;
      st2(view).draft = { ...parsed, body, keys: splitBlocks(body).map((block) => block.key) }, view.renderBody();
    },
    "draft-block"(view, target, event) {
      event.target.closest("input") || (st2(view).openBlock = st2(view).openBlock === target.dataset.key ? "" : target.dataset.key, view.renderBody());
    },
    "draft-drop"(view) {
      st2(view).draft = null, view.renderBody();
    },
    "draft-all"(view) {
      let draft = st2(view).draft;
      commit(view, draft.body, { check: draft.check, fixes: draft.fixes }), st2(view).draft = null, view.renderBody();
    },
    "draft-pick"(view) {
      let draft = st2(view).draft;
      if (!draft.keys.length) throw new Error("没有勾选分块");
      commit(view, mergeBlocks(view.project().setting.text, draft.body, draft.keys), { check: draft.check, fixes: draft.fixes }), st2(view).draft = null, view.renderBody();
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
      let project = view.project();
      commit(view, [project.setting.text, ...picked.map((entry) => entry.content)].filter((item) => item.trim()).join(`

`)), view.renderBody(), await afterImport(picked);
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
      let text = view.project().setting.text, blocks = splitBlocks(text), block = blocks.find((item) => item.key === target.dataset.key);
      block && await confirmDialog({ title: `删除分块「${block.title}」`, body: "删除前的版本保存在历史版本里，可以回退。", okLabel: "删除", danger: !0 }) && (commit(view, joinBlocks(blocks.filter((item) => item.key !== block.key))), view.renderBody());
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
    let busy = view.busy[`discuss:${view.projectId}`], refs = chat.refs, folded = chat.messages.filter((msg) => msg.folded).length, live = chat.messages.filter((msg) => !msg.folded), lastAi = [...live].reverse().find((msg) => msg.role !== "user"), wb = wbSummary(view, chat.refs, () => view.renderBody()), canProgress = !!progressText(view), chips = `<div class="pi-refs"><span class="pi-hint">附带参考：</span>
        <button type="button" class="pi-chip${refs.setting ? " is-on" : ""}" data-act="ref" data-ref="setting">设定</button>
        <button type="button" class="pi-chip${refs.outline ? " is-on" : ""}" data-act="ref" data-ref="outline">大纲</button>
        <button type="button" class="pi-chip${refs.progress && canProgress ? " is-on" : ""}" data-act="ref" data-ref="progress"${canProgress ? "" : ' disabled title="本项目不是当前聊天启用的项目"'}>剧情进度</button>
        <button type="button" class="pi-chip${refs.floors ? " is-on" : ""}" data-act="ref-floors">正文 ${refs.floors} 楼</button>
        <button type="button" class="pi-chip${wb && wb.count ? " is-on" : ""}" data-act="ref-wb">世界书 ${wb ? `${wb.count} 条` : "…"}</button></div>`, messages = live.map((msg) => {
      let isUser = msg.role === "user", tools = `<div class="pi-msg-tools">
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-edit" data-id="${esc(msg.id)}">编辑</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-del" data-id="${esc(msg.id)}">删除</button>
            ${msg === lastAi && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="regen">重新生成</button>' : ""}
            ${isUser ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="to-setting">整理成设定</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="to-outline">据此写大纲</button>
            ${hasYamlBlock(msg.content) ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="use-yaml" data-id="${esc(msg.id)}">把 YAML 送到大纲</button>` : ""}`}</div>`;
      return `<div class="pi-msg ${isUser ? "is-user" : "is-ai"}"><div class="pi-md">${renderMarkdown(msg.content)}</div>${tools}</div>`;
    }).join(""), empty = chat.messages.length ? "" : '<div class="pi-empty">说说这条 if 线的想法：原作、角色、类型、基调，一句话也行。<br>AI 会帮你把设定想清楚。</div>';
    return `${chips}<div class="pi-chat">
        ${folded ? `<button type="button" class="pi-msg-fold" data-act="summary">更早的 ${folded} 条已折成摘要 · 查看</button>` : ""}
        ${empty}${messages}${busy ? '<div class="pi-msg is-ai"><span class="pi-spin"></span></div>' : ""}</div>
        <div class="pi-compose">${chat.messages.length ? `<button type="button" class="pi-compose-side" data-act="clear-talk" title="清空讨论">${ICONS.trash}</button>` : ""}<textarea class="pi-ta" data-compose placeholder="Ctrl+Enter 发送">${esc(st3(view).draft || "")}</textarea>
        <button type="button" class="pi-send" data-act="send" title="发送（Ctrl+Enter）"${busy ? " disabled" : ""}>${ICONS.send}</button></div>`;
  }
  async function reply(view) {
    let projectId = view.projectId, key = `discuss:${projectId}`;
    if (!view.busy[key]) {
      view.setBusy(key, !0);
      try {
        let chat = await view.data.loadChat(projectId), project = await view.data.loadProject(projectId);
        if (needsFold(chat.messages)) {
          let fold = foldCandidates(chat.messages), summary = await ask(view, "discuss", foldMessages(chat.summary, fold)), ids = new Set(fold.map((msg) => msg.id));
          chat = { ...view.data.chat(projectId), summary, messages: view.data.chat(projectId).messages.map((msg) => ids.has(msg.id) ? { ...msg, folded: !0 } : msg) }, view.data.saveChat(projectId, chat);
        }
        let system = discussSystemPrompt({ guide: guideText(view), refs: await resolveRefs(view, chat, project) }), text = await ask(view, "discuss", chatRequest(system, chat.summary, chat.messages)), latest = view.data.chat(projectId);
        view.data.saveChat(projectId, { ...latest, messages: [...latest.messages, { id: makeId("m"), role: "assistant", content: text, at: Date.now() }] });
      } catch (error) {
        toast("error", `讨论请求失败：${error.message}`);
      } finally {
        view.setBusy(key, !1);
      }
    }
  }
  function updateChat(view, fn) {
    let chat = view.data.chat(view.projectId);
    view.data.saveChat(view.projectId, fn(chat));
  }
  function talkMarkdown(view, chat) {
    let lines = [`# ${view.project().name} · 讨论记录`, ""];
    chat.summary && lines.push("## 早期摘要", "", chat.summary, "");
    for (let msg of chat.messages) lines.push(`## ${msg.role === "user" ? "我" : "AI"}`, "", msg.content, "");
    return lines.join(`
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
        choices: [{ label: "取消", value: null }, { label: "直接清空", value: "clear", danger: !0 }, { label: "导出后清空", value: "export", primary: !0 }]
      });
      choice && (choice === "export" && downloadBlob(`${view.project().name}-讨论记录-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`, talkMarkdown(view, chat), "text/markdown"), view.data.saveChat(view.projectId, { ...chat, summary: "", messages: [] }), st3(view).draft = "", view.renderBody());
    },
    send(view, target) {
      let box = target.closest(".pi-body").querySelector("[data-compose]"), text = box.value.trim();
      if (text)
        return updateChat(view, (chat) => ({ ...chat, messages: [...chat.messages, { id: makeId("m"), role: "user", content: text, at: Date.now() }] })), st3(view).draft = "", box.value = "", view.renderBody(), reply(view);
    },
    regen(view) {
      return updateChat(view, (chat) => {
        let index = chat.messages.map((msg) => msg.role).lastIndexOf("assistant");
        return index < 0 ? chat : { ...chat, messages: chat.messages.filter((_, i) => i !== index) };
      }), view.renderBody(), reply(view);
    },
    async "msg-edit"(view, target) {
      let msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id), text = await promptDialog({ title: "编辑消息", value: msg.content, multiline: !0 });
      text != null && (updateChat(view, (chat) => ({ ...chat, messages: chat.messages.map((item) => item.id === msg.id ? { ...item, content: text } : item) })), view.renderBody());
    },
    async "msg-del"(view, target) {
      await confirmDialog({ title: "删除这条消息", okLabel: "删除", danger: !0 }) && (updateChat(view, (chat) => ({ ...chat, messages: chat.messages.filter((item) => item.id !== target.dataset.id) })), view.renderBody());
    },
    async summary(view) {
      let chat = view.data.chat(view.projectId), result = await openDialog({
        title: "讨论摘要",
        html: `<p class="pi-hint">更早的消息只发送这份摘要，原文仍保存在文件里。</p><textarea class="pi-ta is-tall" data-f="summary">${esc(chat.summary)}</textarea>`,
        actions: [{ label: "展开全部原文", value: "unfold" }, { label: "取消", value: null }, { label: "保存摘要", primary: !0, value: (box) => box.querySelector("[data-f=summary]").value }]
      });
      result != null && (result === "unfold" ? updateChat(view, (current) => ({ ...current, summary: "", messages: current.messages.map((msg) => ({ ...msg, folded: !1 })) })) : updateChat(view, (current) => ({ ...current, summary: result })), view.renderBody());
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
      return view.go("outline"), actions["ai-volume"](view);
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

  // src/ui/tab-run.js
  var tab_run_exports = {};
  __export(tab_run_exports, {
    actions: () => actions4,
    onChange: () => onChange2,
    render: () => render4
  });
  function entryRow(entry, expanded) {
    let atDepth = entry.position === 4, field = (name) => `data-kind="${entry.kind}" data-param="${name}"`, body = expanded ? `<div class="pi-entry-bd">
        <div class="pi-pair ${atDepth ? "is-c4" : ""}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" ${field("position")}>${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" ${field("depth")} value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" ${field("role")}>${options(ROLES, entry.role)}</select></label>` : ""}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" ${field("order")} value="${entry.order}"></label>
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
  var nodeCheck = (unitId, node, off, from = "") => `<label class="pi-check${off ? " is-off" : ""}">
        <input type="checkbox" data-node="${esc(node.id)}" data-unit="${esc(unitId)}"${off ? "" : " checked"}>
        <span><span class="pi-badge">${esc(node.label)}</span> ${esc(node.name)}${from ? ` <span class="pi-hint">来自${esc(from)}</span>` : ""}</span></label>`;
  function nodeList(unit, progress, carried) {
    let off = new Set(offNodes(progress, unit.id)), nodes = stageNodes(unit.stage.data);
    return !nodes.length && !carried.length ? "" : `<div class="pi-tl-nodes">${nodes.map((node) => nodeCheck(unit.id, node, off.has(node.id))).join("")}
        ${carried.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map((item) => nodeCheck(item.unit.id, item.node, !1, stageLabel(item.unit.stage.key))).join("")}` : ""}</div>`;
  }
  function timeline(units, states, progress, carried) {
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
            ${state === "active" ? nodeList(unit, progress, carried) : ""}</div></div>`;
    };
    return groups.map((group) => `<div class="pi-tl-vol">${esc(volumeLabel(group.volume.key))}</div><div class="pi-tl">${group.units.map(item).join("")}</div>`).join("");
  }
  function render4(view) {
    let { data, runtime } = view, project = view.project(), st7 = view.tabState("run");
    if (!cardKey()) return '<div class="pi-empty">先打开一张角色卡的聊天，再启用项目。</div>';
    let activeId = runtime.activeId();
    if (activeId !== project.id) {
      let other = data.index().projects.find((item) => item.id === activeId);
      return `<div class="pi-card"><h3>启用</h3>
            <p class="pi-hint">${other ? `当前聊天使用的是「${esc(other.name)}」` : `「${esc(cardName())}」还没有启用项目`}。</p>
            <div class="pi-tools is-c2">
                <button type="button" class="pi-btn is-primary" data-act="activate">设为当前聊天使用</button>
                <button type="button" class="pi-btn" data-act="activate-card">设为本卡默认</button></div></div>`;
    }
    let progress = runtime.progress(), entries = runtime.entries(), units = flattenUnits(project.outline.volumes), states = unitStates(units, progress), total = entries.filter((entry) => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0), settings = data.settings(), checking = runtime.isChecking(), book = runtime.injectMode() === "virtual" ? "" : '<span class="pi-badge is-warn">专用世界书</span>', gap = settings.checkEvery - (runtime.floorCount() - progress.lastCheckFloor);
    return `<div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.length ? entries.map((entry) => entryRow(entry, st7.open === entry.slotId)).join("") : '<p class="pi-hint">设定和大纲都为空，没有可注入的内容。</p>'}
        </div>
        <div class="pi-card"><h3>阶段<span class="pi-meta">${gap > 0 ? `${gap} 楼后检测` : "下一楼检测"}</span><span class="pi-spacer"></span>
            ${units.length ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="index-toggle">${st7.indexOpen ? "收起索引" : "剧情索引"}</button>` : ""}</h3>
        ${units.length ? `${st7.indexOpen ? `<pre class="pi-pre pi-index">${esc(buildIndexText(units, states, progress, { carryOver: settings.carryOver }))}</pre>` : ""}
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === progress.pace ? " is-sel" : ""}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join("")}</div></div>
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-primary is-sm" data-act="next">打开下一段</button>
            <button type="button" class="pi-btn is-sm" data-act="check"${checking ? " disabled" : ""}>${checking ? '<span class="pi-spin"></span>检测中' : "立即检测"}</button>
            <button type="button" class="pi-btn is-sm" data-act="rewrite">改写后续</button></div>
        ${timeline(units, states, progress, settings.carryOver ? carriedNodes(units, states, progress) : [])}` : '<p class="pi-hint">大纲为空。到「大纲」页导入剧情 YAML，或让 AI 写一卷。</p>'}
        </div>`;
  }
  function setSlot(view, slotId, patch) {
    let { runtime } = view;
    runtime.setProgress(patchSlot(runtime.progress(), slotId, patch));
  }
  var actions4 = {
    activate: (view) => view.runtime.switchProject(view.projectId, "chat"),
    "activate-card": (view) => view.runtime.switchProject(view.projectId, "card"),
    // 推进速度随聊天保存，改完立即换掉详细条目开头的说明。
    pace(view, target) {
      view.runtime.setProgress({ ...view.runtime.progress(), pace: target.dataset.pace }), view.renderBody();
    },
    "index-toggle"(view) {
      let st7 = view.tabState("run");
      st7.indexOpen = !st7.indexOpen, view.renderBody();
    },
    "toggle-entry"(view, target, event) {
      if (event.target.closest("input,select")) return;
      let st7 = view.tabState("run");
      st7.open = st7.open === target.dataset.slot ? "" : target.dataset.slot, view.renderBody();
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
    rewrite: (view) => startRewrite(view),
    preview(view) {
      let entries = view.runtime.entries().filter((entry) => entry.enabled), html = entries.length ? POSITIONS.map((pos) => {
        let list = entries.filter((entry) => entry.position === pos.value).sort((a, b) => a.order - b.order);
        return list.length ? list.map((entry) => `<p class="pi-hint">${esc(positionLabel(entry))} · ${esc(entry.title)} · 顺序 ${entry.order}</p><pre class="pi-pre">${esc(entry.content)}</pre>`).join("") : "";
      }).join("") : '<p class="pi-hint">没有启用的条目。</p>';
      return openDialog({ title: "最终注入预览", html: `${html}`, actions: [{ label: "关闭", value: !0, primary: !0 }] });
    }
  };
  function onChange2(view, target) {
    let { runtime } = view;
    if (target.dataset.param) {
      let value = Math.round(Number(target.value));
      if (!Number.isFinite(value)) return;
      let { kind, param } = target.dataset;
      view.data.updateProject(view.projectId, (project) => ({ ...project, defaults: { ...DEFAULT_PARAMS, ...project.defaults, [kind]: { ...DEFAULT_PARAMS[kind], ...project.defaults[kind], [param]: param === "depth" || param === "order" ? Math.max(0, value) : value } } })), runtime.refresh(), view.renderBody();
      return;
    }
    if (target.dataset.slotField === "enabled") {
      setSlot(view, target.dataset.slot, { enabled: target.checked }), view.renderBody();
      return;
    }
    target.dataset.node && runtime.setProgress(setNodeChecked(runtime.progress(), target.dataset.unit, target.dataset.node, target.checked));
  }

  // src/ui/page-settings.js
  var page_settings_exports = {};
  __export(page_settings_exports, {
    actions: () => actions5,
    onChange: () => onChange3,
    onInput: () => onInput4,
    refreshOn: () => refreshOn4,
    render: () => render5
  });
  var st4 = (view) => view.tabState("settings"), currentRole = (view) => LLM_ROLES.some((item) => item.key === st4(view).role) ? st4(view).role : LLM_ROLES[0].key;
  function modelField(view, role, llm) {
    let s = st4(view), models = s.models?.[role] || [];
    return `<div class="pi-field"><span>模型</span><div class="pi-inline">${!models.length || s.manual?.[role] ? `<input class="pi-inp" data-llm="${role}" data-k="model" value="${esc(llm.model)}" placeholder="模型名称">` : `<select class="pi-sel" data-llm="${role}" data-k="model">${llm.model && !models.includes(llm.model) ? `<option value="${esc(llm.model)}" selected>${esc(llm.model)}</option>` : ""}
            ${llm.model ? "" : '<option value="" selected disabled>选择模型</option>'}${options(models.map((model) => ({ value: model, label: model })), llm.model)}
            <option value="__manual">手动输入…</option></select>`}
        <button type="button" class="pi-btn" data-act="models" data-role="${role}">${s.loading === role ? '<span class="pi-spin"></span>' : ""}获取列表</button></div></div>`;
  }
  function llmCard(view, s) {
    let role = currentRole(view), llm = s.llm[role], custom = llm.source === "custom";
    return `<div class="pi-card"><h3>模型接口</h3>
        <div class="pi-seg">${LLM_ROLES.map((item) => `<button type="button" class="pi-seg-btn${item.key === role ? " is-sel" : ""}" data-act="llm-role" data-role="${item.key}">${esc(item.label)}</button>`).join("")}</div>
        <label class="pi-field"><span>接口来源</span><select class="pi-sel" data-llm="${role}" data-k="source">${options([{ value: "tavern", label: "酒馆当前连接" }, { value: "custom", label: "独立接口（OpenAI兼容）" }], llm.source)}</select></label>
        ${custom ? `<label class="pi-field"><span>接口地址</span><input class="pi-inp" data-llm="${role}" data-k="endpoint" value="${esc(llm.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>API密钥</span><input class="pi-inp" type="password" autocomplete="off" data-llm="${role}" data-k="apiKey" value="${esc(llm.apiKey)}"></label>
        ${modelField(view, role, llm)}
        <label class="pi-field"><span>温度</span><input class="pi-inp" data-llm="${role}" data-k="temperature" value="${esc(llm.temperature)}" placeholder="默认"></label>` : ""}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="preset-load"${s.presets.length ? "" : " disabled"}>载入预设</button>
            <button type="button" class="pi-btn is-sm" data-act="preset-save"${custom ? "" : " disabled"}>保存为预设</button></div>
        </div>`;
  }
  function pickPreset(presets) {
    let html = presets.map((preset) => `<div class="pi-preset">
            <button type="button" class="pi-preset-pick" data-dlg-value="load:${esc(preset.id)}">
                <span class="pi-preset-name">${esc(preset.name)}</span><span class="pi-preset-model">${esc(preset.model || "未选模型")}</span></button>
            <button type="button" class="pi-icon-btn is-danger" data-dlg-value="del:${esc(preset.id)}" title="删除">${ICONS.trash}</button></div>`).join("");
    return openDialog({ title: "载入接口预设", html: `<div class="pi-presets">${html}</div>`, actions: [{ label: "取消", value: null }] });
  }
  function guideCard(view, s) {
    let open = st4(view).guideOpen, status = s.guide ? "自定义版本" : "内置版本";
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? "收起" : "编辑"}</button></h3>
        <p class="pi-hint">当前使用：${status}</p>
        ${open ? `<div class="pi-row pi-acts-top"><button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? "" : " disabled"}>恢复内置版本</button></div>
        <textarea class="pi-ta is-mono is-tall" data-guide>${esc(s.guide || BUILTIN_GUIDE)}</textarea>` : ""}</div>`;
  }
  function paceRow(view, s) {
    let open = st4(view).paceOpen, changed = PACES.filter((item) => s.paceText[item.value]).map((item) => item.label), current = view.runtime.activeId() ? view.runtime.progress().pace : "", pace = PACES.some((item) => item.value === st4(view).pace) ? st4(view).pace : current || "normal", pick = PACES.map((item) => ({ value: item.value, label: `${item.label}${item.value === current ? "（当前聊天使用）" : ""}${s.paceText[item.value] ? "·已改" : ""}` }));
    return `<div class="pi-set-row"><span>推进速度说明</span>${changed.length ? `<span class="pi-badge">已修改 ${changed.join("、")}</span>` : ""}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="pace-toggle">${open ? "收起" : "编辑"}</button></div>
        ${open ? `<div class="pi-set-sub"><label class="pi-field"><span>编辑哪一档的说明</span><select class="pi-sel" data-pace-pick>${options(pick, pace)}</select></label>
        <textarea class="pi-ta" rows="3" data-pace-text="${pace}">${esc(paceText(s, pace))}</textarea>
        <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-sm" data-act="pace-reset" data-pace="${pace}"${s.paceText[pace] ? "" : " disabled"}>恢复默认</button></div></div>` : ""}`;
  }
  function render5(view) {
    let s = view.data.settings(), modes = [{ value: "ask", label: "弹出确认" }, { value: "auto", label: "自动推进（可撤销）" }, { value: "nodes", label: "仅勾选节点，不推进阶段" }], offModes = [{ value: "ask", label: "弹出提醒" }, { value: "auto", label: "自动改写后续阶段（可撤销）" }, { value: "off", label: "不检查偏离" }];
    return `<div class="pi-card"><h3>注入内容</h3>
        <label class="pi-field"><span>详细条目的标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label></div>
        <div class="pi-card"><h3>阶段推进</h3>
        <div class="pi-pair"><label class="pi-field"><span>检测间隔（楼）</span><input class="pi-inp" type="number" min="1" data-set="checkEvery" value="${s.checkEvery}"></label>
            <label class="pi-field"><span>每次读取楼数</span><input class="pi-inp" type="number" min="1" data-set="checkFloors" value="${s.checkFloors}"></label></div>
        <label class="pi-field"><span>判定阶段已演完后</span><select class="pi-sel" data-set="handleMode">${options(modes, s.handleMode)}</select></label>
        <label class="pi-field"><span>偏离大纲时</span><select class="pi-sel" data-set="offTrackMode">${options(offModes, s.offTrackMode)}</select></label>
        <label class="pi-check"><input type="checkbox" data-set="carryOver"${s.carryOver ? " checked" : ""}><span>没演的支线与世界动态延续到后面的阶段</span></label>
        ${paceRow(view, s)}</div>
        ${llmCard(view, s)}
        ${guideCard(view, s)}`;
  }
  var NUMERIC = /* @__PURE__ */ new Set(["checkEvery", "checkFloors"]);
  function readValue(target) {
    return target.type === "checkbox" ? target.checked : NUMERIC.has(target.dataset.set) ? Number(target.value) : target.value;
  }
  function setRole(view, role, patch) {
    let llm = view.data.settings().llm;
    view.data.updateSettings({ llm: { ...llm, [role]: { ...llm[role], ...patch } } });
  }
  function onInput4(view, target) {
    if (target.dataset.paceText) {
      let key = target.dataset.paceText, text = target.value.trim() === PACE_TEXT[key] ? "" : target.value;
      view.data.updateSettings({ paceText: { ...view.data.settings().paceText, [key]: text } }), view.runtime.refresh();
      return;
    }
    if (target.dataset.guide !== void 0) {
      let text = target.value;
      view.data.updateSettings({ guide: text.trim() === BUILTIN_GUIDE.trim() ? "" : text });
      return;
    }
    target.dataset.set && target.type !== "checkbox" && target.tagName !== "SELECT" && view.data.updateSettings({ [target.dataset.set]: readValue(target) }), target.dataset.llm && target.tagName === "INPUT" && setRole(view, target.dataset.llm, { [target.dataset.k]: target.value.trim() });
  }
  function onChange3(view, target) {
    if (target.dataset.pacePick !== void 0) {
      st4(view).pace = target.value, view.renderBody();
      return;
    }
    target.dataset.set && (target.type === "checkbox" || target.tagName === "SELECT") && (view.data.updateSettings({ [target.dataset.set]: readValue(target) }), view.runtime.refresh(), view.renderBody()), target.dataset.llm && target.tagName === "SELECT" && (target.value === "__manual" ? st4(view).manual = { ...st4(view).manual, [target.dataset.llm]: !0 } : setRole(view, target.dataset.llm, { [target.dataset.k]: target.value }), view.renderBody()), target.dataset.set && target.tagName !== "SELECT" && target.type !== "checkbox" && view.runtime.refresh();
  }
  var CONN_KEYS2 = ["endpoint", "apiKey", "model", "temperature"], actions5 = {
    async models(view, target) {
      let role = target.dataset.role, s = st4(view);
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
      st4(view).role = target.dataset.role, view.renderBody();
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
          await confirmDialog({ title: `删除预设「${preset.name}」`, body: "已载入这个预设的用途不受影响。", okLabel: "删除", danger: !0 }) && view.data.updateSettings({ presets: presets.filter((item) => item.id !== id) });
          continue;
        }
        return setRole(view, role, { source: "custom", ...Object.fromEntries(CONN_KEYS2.map((key) => [key, preset[key]])) }), st4(view).manual = { ...st4(view).manual, [role]: !1 }, toast("success", `已为「${LLM_ROLES.find((item) => item.key === role).label}」载入预设「${preset.name}」。`), view.renderBody();
      }
    },
    "pace-toggle"(view) {
      st4(view).paceOpen = !st4(view).paceOpen, view.renderBody();
    },
    "pace-reset"(view, target) {
      view.data.updateSettings({ paceText: { ...view.data.settings().paceText, [target.dataset.pace]: "" } }), view.runtime.refresh(), view.renderBody();
    },
    "guide-toggle"(view) {
      st4(view).guideOpen = !st4(view).guideOpen, view.renderBody();
    },
    "guide-reset"(view) {
      view.data.updateSettings({ guide: "" }), view.renderBody();
    }
  }, refreshOn4 = [];

  // src/ui/page-data.js
  var page_data_exports = {};
  __export(page_data_exports, {
    actions: () => actions6,
    onChange: () => onChange4,
    refreshOn: () => refreshOn5,
    render: () => render6
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

  // src/ui/page-data.js
  var st5 = (view) => view.tabState("data");
  function referenced(index) {
    let names = /* @__PURE__ */ new Set([INDEX_FILE]);
    for (let item of index.projects)
      names.add(projectFile(item.id)), names.add(chatFile(item.id));
    return names;
  }
  function fileCell(view, name, bytes) {
    let verified = st5(view).verified, missing = verified && verified[name] === !1;
    return !view.data.index().files.includes(name) && !bytes ? '<td class="pi-hint">—</td>' : `<td class="${missing ? "is-missing" : ""}">${missing ? "已丢失" : formatBytes(bytes)}
        ${missing ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="export-file" data-name="${esc(name)}">导出</button>`}
        <button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="delete-file" data-name="${esc(name)}">删除</button></td>`;
  }
  function filesTable(view) {
    return `<table class="pi-files"><thead><tr><th>项目</th><th>设定+大纲</th><th>讨论记录</th></tr></thead><tbody>${view.data.index().projects.map((item) => `<tr><td>${esc(item.group ? `${item.group}／` : "")}${esc(item.name)}</td>
        ${fileCell(view, projectFile(item.id), item.bytes.project)}${fileCell(view, chatFile(item.id), item.bytes.chat)}</tr>`).join("") || '<tr><td colspan="3" class="pi-hint">没有项目</td></tr>'}</tbody></table>`;
  }
  function render6(view) {
    let s = st5(view);
    !s.verified && !s.verifying && verify(view);
    let orphans = s.verified ? Object.keys(s.verified).filter((name) => !referenced(view.data.index()).has(name)) : [], settings = view.data.settings();
    return `<div class="pi-card"><h3>本地文件</h3>
        ${filesTable(view)}
        <div class="pi-equal pi-acts"><button type="button" class="pi-btn is-sm" data-act="verify">${s.verifying ? '<span class="pi-spin"></span>' : ""}重新核对</button>
            <button type="button" class="pi-btn is-sm" data-act="orphans"${orphans.length ? "" : " disabled"}>清理孤立文件${orphans.length ? `（${orphans.length}）` : ""}</button>
            <button type="button" class="pi-btn is-sm" data-act="clear-chats">清空全部讨论记录</button></div></div>
        <div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本 v${esc(view.version)}，修改后刷新酒馆页面生效。</p>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(settings.loaderRef)}" placeholder="留空跟随最新版本，可填 v0.1.0 或 main"></label></div>
        <div class="pi-card"><h3>重置插件</h3>
        <p class="pi-hint">删除所有项目、讨论记录和当前聊天的进度，执行前自动下载备份。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm is-danger" data-act="wipe">备份并删除</button></div></div>`;
  }
  function onChange4(view, target) {
    if (target.dataset.set !== "loaderRef") return;
    let ref = target.value.trim();
    if (/^\d+\.\d+\.\d+$/.test(ref) && (ref = `v${ref}`), ref && ref !== "main" && !/^v\d+\.\d+\.\d+$/.test(ref)) {
      toast("warning", "版本号格式应为 v0.1.0 这样的三段数字，或填 main；未保存。"), target.value = view.data.settings().loaderRef;
      return;
    }
    target.value = ref, view.data.updateSettings({ loaderRef: ref }), toast("success", ref ? `已指定 ${ref}，刷新酒馆页面生效。` : "已改为跟随最新版本，刷新酒馆页面生效。");
  }
  async function verify(view) {
    let s = st5(view);
    s.verifying = !0;
    try {
      let names = [.../* @__PURE__ */ new Set([...view.data.index().files, ...referenced(view.data.index())])];
      s.verified = await verifyFiles(names);
    } catch (error) {
      toast("error", error.message), s.verified = {};
    } finally {
      s.verifying = !1, view.renderBody();
    }
  }
  var actions6 = {
    verify(view) {
      return st5(view).verified = null, verify(view);
    },
    async "export-file"(view, target) {
      let text = await readRawFile(target.dataset.name);
      if (text == null) throw new Error("文件读取失败");
      downloadBlob(target.dataset.name, text);
    },
    async "delete-file"(view, target) {
      let name = target.dataset.name;
      if (!await confirmDialog({ title: "删除文件", list: [name], body: name.startsWith("pi-p-") ? "这是项目的设定和大纲，删除后项目无法打开。" : "", okLabel: "删除", danger: !0 })) return;
      let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
      name.startsWith("pi-c-") ? await view.data.clearChat(id) : name.startsWith("pi-p-") && await view.data.deleteProject(id), st5(view).verified = null, view.render();
    },
    async orphans(view) {
      let names = Object.keys(st5(view).verified || {}).filter((name) => !referenced(view.data.index()).has(name) && st5(view).verified[name]), gone = Object.keys(st5(view).verified || {}).filter((name) => !referenced(view.data.index()).has(name) && !st5(view).verified[name]);
      if (!names.length && gone.length)
        return view.data.forgetFiles(gone), st5(view).verified = null, view.renderBody();
      if (await confirmDialog({ title: "清理孤立文件", body: "这些文件不属于任何项目：", list: names, okLabel: "删除", danger: !0 })) {
        for (let name of names) await deleteFile(name);
        view.data.forgetFiles([...names, ...gone]), st5(view).verified = null, view.renderBody();
      }
    },
    async "clear-chats"(view) {
      let ids = view.data.index().projects.map((item) => item.id);
      if (await confirmDialog({ title: "清空全部讨论记录", list: ids.map(chatFile), okLabel: "清空", danger: !0 })) {
        for (let id of ids) await view.data.clearChat(id);
        st5(view).verified = null, view.renderBody();
      }
    },
    async wipe(view) {
      let index = view.data.index(), names = [.../* @__PURE__ */ new Set([...index.files, ...referenced(index)])], files = [];
      for (let name of names) {
        let text = await readRawFile(name);
        text != null && files.push({ name, data: text });
      }
      if (!files.length) throw new Error("没有可清除的文件");
      if (downloadBlob(`剧情注入器备份-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`, buildZip(files), "application/zip"), !!await confirmDialog({ title: "重置插件", body: "备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。", list: files.map((file) => file.name), okLabel: "全部删除", danger: !0 })) {
        for (let file of files) await deleteFile(file.name);
        await clearChatProgress(), view.data.resetAll(), view.projectId = "", st5(view).verified = null, view.runtime.refresh(), view.render(), toast("success", "已全部清除。");
      }
    }
  }, refreshOn5 = ["index"];

  // src/ui/page-books.js
  var page_books_exports = {};
  __export(page_books_exports, {
    actions: () => actions7,
    onChange: () => onChange5,
    refreshOn: () => refreshOn6,
    render: () => render7
  });

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
  var countIn = (text, pattern) => (String(text).match(pattern) || []).length;
  function regexPlan(entries, pattern, replace, fields) {
    let sub = (text) => String(text).replace(pattern, replace), out = [];
    for (let entry of entries) {
      let patch = {}, hits = 0;
      if (fields.content && countIn(entry.content, pattern) && (hits += countIn(entry.content, pattern), patch.content = sub(entry.content)), fields.comment && entry.comment && countIn(entry.comment, pattern) && (hits += countIn(entry.comment, pattern), patch.comment = sub(entry.comment)), fields.keys)
        for (let [from, field] of [[entry.keys, "key"], [entry.keysSecondary, "keysecondary"]]) {
          let n = from.reduce((sum, key) => sum + countIn(key, pattern), 0);
          n && (hits += n, patch[field] = from.map(sub).map((key) => key.trim()).filter(Boolean));
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

  // src/ui/page-books.js
  var st6 = (view) => view.tabState("books"), GROUPS = {
    on: (entries) => entries.filter((entry) => !acuField(entry.title) && !entry.disabled),
    off: (entries) => entries.filter((entry) => !acuField(entry.title) && entry.disabled)
  }, toggle = (entry) => `<input type="checkbox" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? "开启" : "关闭"}"${entry.disabled ? "" : " checked"}>`, title = (entry) => `<span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>`;
  function editor(entry) {
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
    </div>`;
  }
  function entryRow2(entry, open) {
    return `<div class="pi-wb-item"><div class="pi-wb-row${entry.disabled ? " is-off" : ""}">${toggle(entry)}
        <button type="button" class="pi-wb-name" data-act="wb-open" data-key="${esc(entry.key)}">${open ? ICONS.caretDown : ICONS.caret}${title(entry)}</button>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ""}
        <button type="button" class="pi-icon-btn" data-act="wb-dup" data-key="${esc(entry.key)}" title="复制条目">${ICONS.copy}</button>
        <button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button></div>
        ${open ? editor(entry) : ""}</div>`;
  }
  function pickRow(entry, picked) {
    return `<label class="pi-wb-row${entry.disabled ? " is-off" : ""}"><input type="checkbox" data-wb-pick="${esc(entry.key)}"${picked.has(entry.key) ? " checked" : ""}>
        ${title(entry)}<span class="pi-badge">顺序 ${entry.order}</span></label>`;
  }
  var bulkBtn = (attrs, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" ${attrs}${disabled ? " disabled" : ""}>${label}</button>`;
  function section(name, entries, empty, bulk, openKey, picked) {
    let rows2 = entries.map((entry) => picked ? pickRow(entry, picked) : entryRow2(entry, entry.key === openKey)).join("");
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
            ${tbtn("wb-punct", "wand", "修复标点", { disabled: none2 })}${tbtn("wb-regex", "replace", "替换", { disabled: none2 })}${moreBtn("book-more")}</div>`;
    }
    let none = !s.picked.size;
    return `<div class="pi-tbar">${tbtn("wb-move", "move", "迁移", { disabled: none })}${tbtn("wb-order", "sort", "重排", { disabled: none })}
        ${tbtn("wb-regex", "replace", "替换", { disabled: none })}${tbtn("wb-pick-delete", "trash", "删除", { danger: !0, disabled: none })}${moreBtn("pick-more")}</div>`;
  }
  function bookBody(s, entries) {
    let picked = s.picking ? s.picked : null, on = GROUPS.on(entries), off = GROUPS.off(entries), all = picked && handwritten(entries).length && handwritten(entries).every((entry) => picked.has(entry.key)), head = `${picked ? `<div class="pi-wb-info is-pick"><span class="pi-wb-count">已选 ${picked.size} 条</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-pick-all">${all ? "取消全选" : "全选"}</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-picking">完成</button></div>` : `<div class="pi-wb-info"><span class="pi-wb-tokens">${tokenText(s)}</span></div>`}${bookBar(s, entries)}`;
    return entries.length ? picked ? `${head}${section("已开启", on, "没有开启的条目", "", "", picked)}
            ${section("已关闭", off, "没有关闭的条目", "", "", picked)}` : `${head}${section("已开启", on, "没有开启的条目", bulkBtn('data-act="wb-bulk" data-group="on"', "全部关闭"), s.openKey)}
        ${section("已关闭", off, "没有关闭的条目", bulkBtn('data-act="wb-bulk" data-group="off"', "全部开启"), s.openKey)}
        ${acuSection(entries, s.openFields || /* @__PURE__ */ new Set())}` : `${head}<p class="pi-hint">没有条目</p>`;
  }
  function acuSection(entries, openFields) {
    let fields = groupByField(entries);
    if (!fields.length) return "";
    let total = fields.reduce((sum, [, list]) => sum + list.length, 0), sub = ([field, list]) => {
      let on = list.filter((entry) => !entry.disabled).length, bulk = bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="1"`, "一键开启", on === list.length) + bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="0"`, "一键关闭", !on), open = openFields.has(field);
      return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd is-fold" data-act="acu-fold" data-field="${esc(field)}">${open ? ICONS.caretDown : ICONS.caret}<span class="pi-wb-field" title="${esc(field)}">${esc(field)}</span><small>${on}/${list.length}</small><span class="pi-wb-bulk">${bulk}</span></div>
            ${open ? list.map((entry) => `<div class="pi-wb-row${entry.disabled ? " is-off" : ""}">${toggle(entry)}${title(entry)}</div>`).join("") : ""}</div>`;
    };
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${total}</small></div>${fields.map(sub).join("")}</div>`;
  }
  function listedBooks(s) {
    let books = [...boundBookNames()], add = (name, source) => {
      books.some((item) => item.name === name) || books.push({ name, source });
    }, names = allBookNames();
    for (let name of names) name.startsWith("剧情注入器·") && add(name, "专用");
    for (let name of s.extra || []) names.includes(name) && add(name, "其他");
    return books;
  }
  function render7(view) {
    let s = st6(view), list = listedBooks(s).map((book) => {
      let open = s.book === book.name, entries = open && s.entries ? s.entries : null;
      return `<div class="pi-book${open ? " is-open" : ""}"><div class="pi-book-hd" data-act="open-book" data-book="${esc(book.name)}">
            ${open ? ICONS.caretDown : ICONS.caret}<span class="pi-etitle" title="${esc(book.name)}">${esc(book.name)}</span><span class="pi-meta">${esc(book.source)}</span></div>
            ${entries ? `<div class="pi-book-bd">${bookBody(s, entries)}</div>` : ""}</div>`;
    }).join("");
    return `<div class="pi-card pi-wb"><h3>「${esc(cardName() || "未打开角色卡")}」的世界书<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="book-new">${ICONS.plus}新建</button>
            <button type="button" class="pi-icon-btn" data-act="page-more" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint is-warn">注意：这里的操作真的会修改你的世界书！</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
  }
  var splitKeys = (text) => String(text || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
  function editPatch(target) {
    let field = target.dataset.f, value = target.value;
    return field === "constant" ? { constant: value === "1" } : field === "key" || field === "keysecondary" ? { [field]: splitKeys(value) } : field === "position" || field === "role" ? { [field]: Number(value) } : field === "depth" || field === "order" ? { [field]: Math.max(0, Math.round(Number(value) || 0)) } : field === "content" || field === "comment" ? { [field]: value } : null;
  }
  async function saveEdit(view, target) {
    let key = target.dataset.wbEdit, patch = editPatch(target);
    !patch || !(st6(view).entries || []).some((item) => item.key === key) || (await updateEntry(st6(view).book, key, patch), st6(view).entries = bookEntries(await loadBook(st6(view).book)), (target.tagName === "SELECT" || target.dataset.f === "comment") && view.renderBody());
  }
  async function onChange5(view, target) {
    if (target.dataset.wbPick) {
      let picked = st6(view).picked;
      return target.checked ? picked.add(target.dataset.wbPick) : picked.delete(target.dataset.wbPick), view.renderBody();
    }
    if (target.dataset.wbEdit) return saveEdit(view, target);
    let key = target.dataset.wbToggle;
    key && (target.disabled = !0, await setEntriesDisabled(st6(view).book, [key], !target.checked), await reloadBook(view));
  }
  async function reloadBook(view) {
    let s = st6(view);
    s.entries = bookEntries(await loadBook(s.book));
    let keys = new Set(s.entries.map((entry) => entry.key));
    s.picked = new Set([...s.picked || []].filter((key) => keys.has(key))), view.renderBody(), countBook(view);
  }
  var tokenCache = /* @__PURE__ */ new Map(), TOKEN_CACHE_MAX = 3e3, TOKEN_BATCH = 8;
  async function entryTokens(text) {
    if (tokenCache.has(text)) return tokenCache.get(text);
    let count = await countTokens(text);
    return count == null ? null : (tokenCache.size >= TOKEN_CACHE_MAX && tokenCache.delete(tokenCache.keys().next().value), tokenCache.set(text, count), count);
  }
  async function countBook(view) {
    let s = st6(view), book = s.book, entries = s.entries || [], counts = [];
    for (let i = 0; i < entries.length; i += TOKEN_BATCH)
      if (counts.push(...await Promise.all(entries.slice(i, i + TOKEN_BATCH).map((entry) => entry.content ? entryTokens(entry.content) : 0))), s.book !== book || s.entries !== entries) return;
    let exact = counts.every((count) => count != null), on = 0, all = 0;
    entries.forEach((entry, index) => {
      let n = exact ? counts[index] : estimateTokens(entry.content);
      all += n, entry.disabled || (on += n);
    }), s.tokens = { on, all, exact };
    let box = hostDocument().querySelector(".pi-wb-tokens");
    box && (box.innerHTML = tokenText(s));
  }
  var handwritten = (entries) => entries.filter((entry) => !acuField(entry.title)), pickedEntries = (s) => handwritten(s.entries || []).filter((entry) => s.picked.has(entry.key)), PREVIEW_MAX = 30, previewList = (lines) => lines.length > PREVIEW_MAX ? [...lines.slice(0, PREVIEW_MAX), `另有 ${lines.length - PREVIEW_MAX} 条`] : lines;
  async function applyPatches(view, plan, { label, backup = !1 }) {
    let s = st6(view), result = await patchEntries(s.book, plan.map((item) => ({ key: item.key, patch: item.patch })));
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
    let names = allBookNames().filter((name) => name !== from), html = `<label class="pi-field"><span>目标世界书</span><select class="pi-sel" data-f="book">${options([{ value: "", label: names.length ? "选择已有世界书" : "没有其他世界书" }, ...names.map((name) => ({ value: name, label: name }))], "")}</select></label>
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
  var actions7 = {
    // 整区一次改完：「全部关闭」关已开启区，「全部开启」开已关闭区；数据库条目不在其中。
    async "wb-bulk"(view, target) {
      let group = target.dataset.group, pick = GROUPS[group];
      if (!pick) return;
      let keys = pick(st6(view).entries || []).map((entry) => entry.key);
      keys.length && (target.disabled = !0, await setEntriesDisabled(st6(view).book, keys, group === "on"), await reloadBook(view));
    },
    "wb-open"(view, target) {
      let s = st6(view);
      s.openKey = s.openKey === target.dataset.key ? "" : target.dataset.key, view.renderBody();
    },
    "acu-fold"(view, target, event) {
      if (event.target.closest("button")) return;
      let s = st6(view), open = new Set(s.openFields || []);
      open.has(target.dataset.field) ? open.delete(target.dataset.field) : open.add(target.dataset.field), s.openFields = open, view.renderBody();
    },
    // 一个字段的数据库条目整体开或关（写进世界书）。
    async "acu-field"(view, target) {
      let on = target.dataset.on === "1", keys = (st6(view).entries || []).filter((entry) => acuField(entry.title) === target.dataset.field && entry.disabled === on).map((entry) => entry.key);
      keys.length && (target.disabled = !0, await setEntriesDisabled(st6(view).book, keys, !on), await reloadBook(view));
    },
    async "open-book"(view, target, event) {
      if (event.target.closest("button,input")) return;
      let s = st6(view);
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
      let shown = new Set(listedBooks(st6(view)).map((book) => book.name)), names = allBookNames().filter((name2) => !shown.has(name2));
      if (!names.length) return toast("info", "没有其他世界书。");
      let name = await menuDialog({ title: "打开其他世界书", items: names.map((item) => ({ label: item, value: item, icon: ICONS.book })) });
      name && await openBook(view, name);
    },
    async "book-rename"(view) {
      let from = st6(view).book, to = await promptDialog({ title: "重命名世界书", label: "新名称", value: from });
      if (to == null || to.trim() === from) return;
      let result = await renameBook(from, to);
      result.failed.length ? toast("warning", `已另存为「${result.name}」，但${result.failed.join("、")}的绑定没能改过去，旧书「${from}」保留，请在酒馆里手动改绑定后删除。`) : toast("success", `已重命名为「${result.name}」。`), await openBook(view, result.name);
    },
    async "book-copy"(view) {
      let s = st6(view), to = await promptDialog({ title: "另存副本", label: "副本名称", value: `${s.book}-副本` });
      if (to == null) return;
      let name = await duplicateBook(s.book, to);
      s.extra = [.../* @__PURE__ */ new Set([...s.extra || [], name])], toast("success", `已另存为「${name}」。`), view.renderBody();
    },
    async "book-export"(view) {
      let s = st6(view);
      downloadBlob(`${s.book}.json`, JSON.stringify(await loadBook(s.book), null, 2));
    },
    async "book-delete"(view) {
      let s = st6(view), name = s.book;
      if (!await confirmDialog({ title: `删除世界书「${name}」`, body: "先下载整本备份，再删除并解除聊天、角色卡和全局的绑定，无法撤销。", list: [`${s.entries.length} 条条目`], okLabel: "删除", danger: !0 })) return;
      downloadBlob(`${name}-备份.json`, JSON.stringify(await loadBook(name), null, 2));
      let result = await removeBook(name);
      result.failed.length ? toast("warning", `已删除，但${result.failed.join("、")}的绑定没能解除，请在酒馆里检查。`) : toast("success", `已删除「${name}」。`), s.book = "", s.entries = null, s.extra = (s.extra || []).filter((item) => item !== name), view.renderBody();
    },
    async "wb-add"(view) {
      let s = st6(view), [key] = await addEntries(s.book);
      await reloadBook(view), s.openKey = key, view.renderBody();
    },
    async "wb-dup"(view, target) {
      await addEntries(st6(view).book, [target.dataset.key]), await reloadBook(view);
    },
    // 「更多」菜单：页面级、整本书级、选中条目级各一份，选中后转给对应的操作。
    async "page-more"(view, target, event) {
      let pick = await menuDialog({ title: "世界书", items: [
        { label: "导入世界书", value: "book-import", icon: ICONS.upload },
        { label: "打开其他世界书", value: "book-open", icon: ICONS.folder }
      ] });
      if (pick) return actions7[pick](view, target, event);
    },
    async "book-more"(view, target, event) {
      let pick = await menuDialog({ title: st6(view).book, items: [
        { label: "重命名", value: "book-rename", icon: ICONS.pencil },
        { label: "另存副本", value: "book-copy", icon: ICONS.copy },
        { label: "导出", value: "book-export", icon: ICONS.download },
        { label: "删除本书", value: "book-delete", icon: ICONS.trash, danger: !0 }
      ] });
      if (pick) return actions7[pick](view, target, event);
    },
    async "pick-more"(view, target, event) {
      let pick = await menuDialog({ title: `已选 ${st6(view).picked.size} 条`, items: [
        { label: "开启", value: "wb-pick-on", icon: ICONS.eye },
        { label: "关闭", value: "wb-pick-off", icon: ICONS.eyeOff }
      ] });
      if (pick) return actions7[pick](view, target, event);
    },
    "wb-pick-on": (view) => setPicked(view, !1),
    "wb-pick-off": (view) => setPicked(view, !0),
    async "wb-pick-delete"(view) {
      let s = st6(view), entries = pickedEntries(s);
      if (!await confirmDialog({ title: `从「${s.book}」删除 ${entries.length} 条`, body: "删除前会下载这些条目的备份。", list: previewList(entries.map((entry) => entry.title)), okLabel: "删除", danger: !0 })) return;
      let backup = await deleteEntries(s.book, entries.map((entry) => entry.key));
      downloadBlob(`${s.book}-已删条目备份.json`, JSON.stringify(backup, null, 2)), s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
    },
    "wb-picking"(view) {
      let s = st6(view);
      s.picking = !s.picking, s.picked = /* @__PURE__ */ new Set(), s.openKey = "", view.renderBody();
    },
    "wb-pick-all"(view) {
      let s = st6(view), list = handwritten(s.entries || []), all = list.every((entry) => s.picked.has(entry.key));
      s.picked = all ? /* @__PURE__ */ new Set() : new Set(list.map((entry) => entry.key)), view.renderBody();
    },
    // 关键词里写成「甲，乙、丙」的一整条拆成三个，去掉首尾标点与空格、重复项；/正则/ 形式的关键词不动。
    async "wb-punct"(view) {
      let s = st6(view), plan = punctPlan(handwritten(s.entries || []));
      if (!plan.length) return toast("info", "关键词没有需要修复的标点。");
      await confirmDialog({ title: `修复关键词标点（${plan.length} 条）`, body: "以下条目的关键词将改为：", list: previewList(plan.map((item) => `${item.title}：${item.before} → ${item.after}`)), okLabel: "修复" }) && await applyPatches(view, plan, { label: "修复关键词标点" });
    },
    async "wb-regex"(view) {
      let s = st6(view), usePicked = s.picking && s.picked.size, entries = usePicked ? pickedEntries(s) : handwritten(s.entries || []), input = await regexDialog(usePicked ? `已选 ${entries.length} 条` : `全部手写条目 ${entries.length} 条`);
      if (!input) return;
      if (!input.fields.content && !input.fields.comment && !input.fields.keys) throw new Error("请至少选择一个替换范围");
      let plan = regexPlan(entries, buildPattern(input.find, input), input.replace, input.fields);
      if (!plan.length) return toast("info", "没有匹配的内容。");
      let total = plan.reduce((sum, item) => sum + item.hits, 0);
      await confirmDialog({ title: `正则替换（${plan.length} 条，共 ${total} 处）`, body: "替换前会下载这些条目的备份。", list: previewList(plan.map((item) => `${item.title}：${item.hits} 处`)), okLabel: "替换", danger: !0 }) && await applyPatches(view, plan, { label: "正则替换", backup: !0 });
    },
    async "wb-order"(view) {
      let s = st6(view), input = await orderDialog(s.picked.size);
      if (!input) return;
      let plan = orderPlan(pickedEntries(s), input);
      await confirmDialog({ title: `顺序重排（${plan.length} 条）`, list: previewList(plan.map((item) => `${item.title}：${item.from} → ${item.to}`)), okLabel: "重排" }) && await applyPatches(view, plan.map((item) => ({ key: item.key, patch: { order: item.to } })), { label: "顺序重排" });
    },
    async "wb-move"(view) {
      let s = st6(view), input = await moveDialog(s.book, s.picked.size);
      if (!input) return;
      if (!input.to) throw new Error("请选择或填写目标世界书");
      let entries = pickedEntries(s), isNew = !allBookNames().includes(input.to);
      if (!await confirmDialog({
        title: `${input.move ? "移动" : "复制"}到「${input.to}」${isNew ? "（新建）" : ""}`,
        body: input.move ? "移动后从当前世界书删除，删除前会下载这些条目的备份。" : "",
        list: previewList(entries.map((entry) => entry.title)),
        okLabel: input.move ? "移动" : "复制",
        danger: input.move
      })) return;
      if (input.move) {
        let raw = await loadBook(s.book);
        downloadBlob(`${s.book}-迁移前备份.json`, JSON.stringify({ entries: Object.fromEntries(entries.map((entry) => [entry.key, raw.entries[entry.key]])) }, null, 2));
      }
      let result = await transferEntries(s.book, input.to, entries.map((entry) => entry.key), { move: input.move });
      toast("success", `已${input.move ? "移动" : "复制"} ${result.copied} 条到「${input.to}」${result.created ? "（新建）" : ""}。`), s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
    },
    async "wb-delete"(view, target) {
      let keys = [target.dataset.key], titles = st6(view).entries.filter((entry) => keys.includes(entry.key)).map((entry) => entry.title);
      if (!await confirmDialog({ title: `从「${st6(view).book}」删除条目`, body: "删除前会下载这个条目的备份。", list: titles, okLabel: "删除", danger: !0 })) return;
      let backup = await deleteEntries(st6(view).book, keys);
      downloadBlob(`${st6(view).book}-已删条目备份.json`, JSON.stringify(backup, null, 2)), await reloadBook(view);
    }
  };
  async function setPicked(view, disabled) {
    let s = st6(view);
    await setEntriesDisabled(s.book, [...s.picked], disabled), await reloadBook(view);
  }
  async function openBook(view, name) {
    let s = st6(view);
    listedBooks(s).some((book) => book.name === name) || (s.extra = [.../* @__PURE__ */ new Set([...s.extra || [], name])]), s.book = name, s.entries = null, s.openKey = "", s.tokens = null, s.picking = !1, s.picked = /* @__PURE__ */ new Set(), await reloadBook(view);
  }
  var refreshOn6 = ["chat"];

  // src/ui/page-diag.js
  var page_diag_exports = {};
  __export(page_diag_exports, {
    actions: () => actions8,
    render: () => render8
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
    GENERATION_STOPPED: "停止生成"
  }, time = (at) => at ? new Date(at).toLocaleTimeString("zh-CN", { hour12: !1 }) : "—";
  function collect(view) {
    let { data, runtime } = view, d = runtime.diagnose(), settings = data.settings(), id = runtime.activeId(), meta2 = data.index().projects.find((item) => item.id === id), progress = id ? runtime.progress() : null, llm = resolveLlm(settings, "check"), c = ctx();
    return { ...d, settings, id, name: meta2 ? meta2.name : "", progress, llm, units: id ? runtime.units().length : 0, card: cardName(), chatId: c && typeof c.getCurrentChatId == "function" && c.getCurrentChatId() || "", version: view.version };
  }
  function problems(info) {
    let out = [];
    (!info.hasContext || !info.hasEventSource) && out.push({ text: "读不到酒馆的事件接口，酒馆版本可能过旧。", fix: "" });
    let missing = info.events.filter((item) => NEED.includes(item.key) && !item.name);
    missing.length && out.push({ text: `酒馆没有提供事件：${missing.map((item) => item.key).join("、")}。`, fix: "" }), info.events.filter((item) => NEED.includes(item.key) && item.name && !item.bound).length && out.push({ text: "检测所需的事件没有绑定。", fix: "rebind" }), info.cardKey ? info.id ? info.units || out.push({ text: "启用项目的大纲为空，没有可检测的阶段。", fix: "" }) : out.push({ text: `「${info.card}」没有启用项目，自动检测不会运行。`, fix: "" }) : out.push({ text: "当前没有打开角色卡聊天。", fix: "" }), info.progress && info.progress.lastCheckFloor > info.floors && out.push({ text: `上次检测记在第 ${info.progress.lastCheckFloor} 楼，当前只有 ${info.floors} 楼。`, fix: "reset-base" }), info.llm.source === "custom" && !String(info.llm.model || "").trim() && out.push({ text: "进度检测用独立接口，但没有选择模型。", fix: "" });
    let received = info.events.find((item) => item.key === "MESSAGE_RECEIVED");
    return received && received.bound && !received.count && info.floors - info.chatStartFloors >= 2 && out.push({ text: "打开聊天后已有新回复，但没有收到「收到回复」事件。", fix: "rebind" }), out;
  }
  function nextText(info) {
    if (!info.progress) return "—";
    let gap = info.floors - info.progress.lastCheckFloor, left = info.settings.checkEvery - gap;
    return left > 0 ? `还差 ${left} 楼` : "下一条回复后检测";
  }
  function rows(info) {
    let state = info.checking ? "检测中" : info.pending ? "等待主回复生成结束" : info.generating ? "主回复生成中" : "空闲", llm = info.llm.source === "custom" ? `独立接口 ${info.llm.model || "（未选模型）"}` : "酒馆当前接口";
    return [
      ["版本", `v${info.version}`],
      ["角色卡", info.card || "—"],
      ["聊天", info.chatId || "—"],
      ["启用项目", info.name || "—"],
      ["当前楼数", String(info.floors)],
      ["上次检测楼层", info.progress ? String(info.progress.lastCheckFloor) : "—"],
      ["检测间隔", `每 ${info.settings.checkEvery} 楼`],
      ["下次检测", nextText(info)],
      ["检测接口", llm],
      ["状态", state]
    ];
  }
  function plainText(info) {
    let lines = ["【剧情注入器诊断】", ...rows(info).map(([k, v]) => `${k}：${v}`), "", "【事件】"];
    for (let item of info.events) lines.push(`${item.key}（${item.name || "酒馆未提供"}）：${item.bound ? `已绑定，收到 ${item.count} 次，最近 ${time(item.at)}` : "未绑定"}`);
    let list = problems(info);
    return lines.push("", "【问题】", ...list.length ? list.map((item) => `- ${item.text}`) : ["无"]), lines.push("", "【最近记录】", ...info.logs.length ? info.logs.map((item) => `${time(item.at)} ${item.text}`) : ["无"]), lines.join(`
`);
  }
  function render8(view) {
    let info = collect(view), list = problems(info), fixes = { rebind: "重新绑定事件", "reset-base": "从当前楼重新计数" }, problemHtml = list.length ? list.map((item) => `<div class="pi-diag-row"><span class="pi-badge is-warn">问题</span><span class="pi-diag-text">${esc(item.text)}</span>${item.fix ? `<button type="button" class="pi-btn is-sm" data-act="${item.fix}">${fixes[item.fix]}</button>` : ""}</div>`).join("") : '<p class="pi-hint">没有发现问题。</p>', events = info.events.map((item) => `<tr><td>${esc(EVENT_LABELS[item.key] || item.key)}</td>
        <td>${item.name ? item.bound ? '<span class="pi-badge is-ok">已绑定</span>' : '<span class="pi-badge is-warn">未绑定</span>' : '<span class="pi-badge is-danger">酒馆未提供</span>'}</td>
        <td>${item.count} 次</td><td>${time(item.at)}</td></tr>`).join(""), logs = info.logs.length ? info.logs.slice().reverse().map((item) => `${time(item.at)}  ${item.text}`).join(`
`) : "暂无记录";
    return `<div class="pi-card"><h3>自动检测${list.length ? `<span class="pi-badge is-warn">${list.length} 个问题</span>` : '<span class="pi-badge is-ok">正常</span>'}</h3>
        <table class="pi-files"><tbody>${rows(info).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
        <div class="pi-tools is-c4 is-end">
            <button type="button" class="pi-btn is-sm is-primary" data-act="check"${info.checking ? " disabled" : ""}>立即检测</button>
            <button type="button" class="pi-btn is-sm" data-act="reset-base"${info.progress ? "" : " disabled"}>从当前楼重新计数</button>
            <button type="button" class="pi-btn is-sm" data-act="rebind">重新绑定事件</button>
            <button type="button" class="pi-btn is-sm" data-act="copy">复制诊断</button></div></div>
        <div class="pi-card"><h3>问题</h3>${problemHtml}</div>
        <div class="pi-card"><h3>酒馆事件</h3>
        <table class="pi-files"><thead><tr><th>事件</th><th>状态</th><th>收到</th><th>最近</th></tr></thead><tbody>${events}</tbody></table></div>
        <div class="pi-card"><h3>最近记录</h3><pre class="pi-pre">${esc(logs)}</pre></div>`;
  }
  async function copyText(text) {
    let doc = hostDocument();
    try {
      return await hostWindow().navigator.clipboard.writeText(text), !0;
    } catch {
      let box = doc.createElement("textarea");
      box.value = text, box.className = "pi-copy-box", doc.body.appendChild(box), box.select();
      let ok = !!(doc.execCommand && doc.execCommand("copy"));
      return box.remove(), ok;
    }
  }
  var actions8 = {
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

  // src/ui/app.js
  var TABS = [
    { key: "discuss", label: "讨论", mod: tab_discuss_exports },
    { key: "setting", label: "设定", mod: tab_setting_exports },
    { key: "outline", label: "大纲", mod: tab_outline_exports },
    { key: "run", label: "执行", mod: tab_run_exports }
  ], PAGES = {
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
      render: render9,
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
    function current() {
      return view.page ? PAGES[view.page].mod : (TABS.find((tab) => tab.key === view.tab) || TABS[3]).mod;
    }
    function sideHtml() {
      let index = data.index(), activeId = runtime.activeId(), list = groupProjects(index.projects).map((group) => {
        let collapsed = view.collapsed.has(group.name), items = group.items.map((item) => `<button type="button" class="pi-pitem${item.id === view.projectId && !view.page ? " is-sel" : ""}" data-act="project" data-id="${esc(item.id)}" data-name="${esc(`${item.group} ${item.name}`.toLowerCase())}" title="长按或右键：设为当前、编辑">
                <span class="pi-pname">${esc(item.name)}</span>${item.id === activeId ? '<span class="pi-dot" title="当前聊天使用"></span>' : ""}</button>`).join(""), head = group.name ? `<button type="button" class="pi-group-hd" data-act="group" data-group="${esc(group.name)}">${collapsed ? ICONS.caret : ICONS.caretDown}${esc(group.name)}<small>${group.items.length}</small></button>` : "";
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
      let project = view.project(), title2 = view.page ? PAGES[view.page].label : project ? project.name : "剧情注入器", tabs = view.page || !project ? "" : `<div class="pi-tabs">${TABS.map((tab) => `<button type="button" class="pi-tab${tab.key === view.tab ? " is-sel" : ""}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`).join("")}</div>`, rename = !view.page && project ? `<button type="button" class="pi-icon-btn" data-act="rename" title="编辑项目名称">${ICONS.pencil}</button>` : "";
      return `<div class="pi-top-lead"><button type="button" class="pi-icon-btn pi-menu" data-act="drawer" title="项目列表">${ICONS.menu}</button>
                <span class="pi-top-title">${esc(title2)}</span>${rename}</div>${tabs}
            <div class="pi-top-end"><button type="button" class="pi-icon-btn${view.page === "settings" ? " is-on" : ""}" data-act="page" data-page="settings" title="设置">${ICONS.gear}</button><button type="button" class="pi-icon-btn" data-act="theme" title="${isNight() ? "日间配色" : "夜间配色"}">${isNight() ? ICONS.sun : ICONS.moon}</button>
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
        return `<div class="pi-empty">${data.index().projects.length ? "从项目列表选择一个项目。" : "一个项目就是一条 if 线：讨论 → 设定 → 大纲 → 执行。"}<br><br>
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
      let body = root.querySelector(".pi-body"), keepScroll = body.scrollTop, chat = body.querySelector(".pi-chat"), chatScroll = chat ? chat.scrollTop : null, chatAtEnd = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30 : !0, focused = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement : null, compose = focused && focused.matches("[data-compose],[data-setting]") ? { sel: focused.matches("[data-compose]") ? "[data-compose]" : "[data-setting]", start: focused.selectionStart, end: focused.selectionEnd } : null;
      body.className = `pi-body${!view.page && view.tab === "discuss" && view.project() ? " is-chat" : ""}`, body.innerHTML = safeBodyHtml(), body.scrollTop = keepScroll;
      let nextChat = body.querySelector(".pi-chat");
      if (nextChat && (nextChat.scrollTop = chatAtEnd || chatScroll == null ? nextChat.scrollHeight : chatScroll), compose) {
        let box = body.querySelector(compose.sel);
        box && (box.focus(), box.setSelectionRange(compose.start, compose.end));
      }
    }
    function render9() {
      renderSide(), renderBody();
    }
    async function selectProject(id, tab) {
      if (view.page = "", setDrawer(!1), view.projectId = id, delete view.loadError[id], writeUi({ projectId: id, page: "" }), render9(), !!id)
        try {
          let project = await data.loadProject(id);
          if (view.projectId !== id) return;
          if (!project) {
            view.loadError[id] = "项目文件丢失，可在数据管理里查看", render9();
            return;
          }
          view.tab = tab || (project.outline.volumes.length ? "run" : "discuss"), writeUi({ tab: view.tab }), render9();
        } catch (error) {
          if (view.projectId !== id) return;
          view.loadError[id] = error.message, render9();
        }
    }
    function restore() {
      let ui = readUi(), activeId = runtime.activeId(), remembered = data.index().projects.some((item) => item.id === ui.projectId) ? ui.projectId : "", id = activeId || remembered || data.index().projects[0] && data.index().projects[0].id || "";
      view.restored = !0, render9();
      let page = PAGES[ui.page] ? ui.page : "";
      id && selectProject(id, TABS.some((tab) => tab.key === ui.tab) ? ui.tab : void 0), page && (view.page = page, writeUi({ page }), render9());
    }
    function go(tab) {
      view.page = "", view.tab = tab, writeUi({ tab, page: "" }), render9();
    }
    async function newProject2() {
      setDrawer(!1);
      let name = await promptDialog({ title: "新项目", label: "项目名（一条 if 线）", placeholder: "如：龙宫温养" });
      if (name != null)
        try {
          let project = await data.createProject(name);
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
          await runtime.switchProject(id, pick), toast("success", pick === "card" ? `「${meta2.name}」已设为本卡默认，当前聊天也已换用。` : `当前聊天改用「${meta2.name}」。`), render9();
        } catch (error) {
          toast("error", `切换失败：${error.message}`);
        }
      }
    }
    async function editProject(id) {
      let meta2 = data.index().projects.find((item) => item.id === id);
      if (!meta2) return;
      let groups = [...new Set(data.index().projects.map((item) => item.group).filter(Boolean))], result = await openDialog({
        title: "编辑项目",
        html: `<label class="pi-field"><span>名称</span><input class="pi-inp" data-f="name" value="${esc(meta2.name)}"></label>
                <label class="pi-field"><span>分组（留空不分组）</span><input class="pi-inp" data-f="group" value="${esc(meta2.group)}" list="pi-groups"></label>
                <datalist id="pi-groups">${groups.map((name) => `<option value="${esc(name)}">`).join("")}</datalist>`,
        actions: [
          { label: "删除项目", danger: !0, value: "delete" },
          { label: "取消", value: null },
          { label: "保存", primary: !0, value: (box) => ({ name: box.querySelector("[data-f=name]").value.trim(), group: box.querySelector("[data-f=group]").value.trim() }) }
        ]
      });
      if (result) {
        if (result === "delete") {
          if (!await confirmDialog({ title: `删除「${meta2.name}」`, body: "将删除以下文件，聊天里记录的该项目进度保留。", list: [`pi-p-${id}.json`, `pi-c-${id}.json`], okLabel: "删除", danger: !0 })) return;
          try {
            await data.deleteProject(id), view.projectId === id && (view.projectId = ""), runtime.refresh(), render9();
          } catch (error) {
            toast("error", `删除失败：${error.message}`);
          }
          return;
        }
        data.project(id) || await data.loadProject(id), data.renameProject(id, result.name, result.group), render9();
      }
    }
    function onClick(event) {
      if (event.target.closest(".pi-pitem") && swallowAfterPress(event)) return;
      let target = event.target.closest("[data-act]");
      if (!target || !root.contains(target)) return;
      let act = target.dataset.act;
      if (act === "close") return close();
      if (act === "project") return selectProject(target.dataset.id);
      if (act === "new-project") return newProject2();
      if (act === "tab") return go(target.dataset.tab);
      if (act === "page")
        return view.page = target.dataset.page, writeUi({ page: view.page }), setDrawer(!1), render9();
      if (act === "drawer") return setDrawer(!view.drawer);
      if (act === "theme")
        return setNight(!isNight()), writeUi({ night: isNight() }), renderSide();
      if (act === "rename") return editProject(view.projectId);
      if (act === "retry-project") return selectProject(view.projectId, view.tab);
      if (act === "retry-render") return render9();
      if (act === "group") {
        let name = target.dataset.group;
        return view.collapsed.has(name) ? view.collapsed.delete(name) : view.collapsed.add(name), writeUi({ collapsed: [...view.collapsed] }), renderSide();
      }
      let handler = current().actions?.[act];
      handler && (event.preventDefault(), Promise.resolve(handler(view, target, event)).catch((error) => toast("error", error.message || String(error))));
    }
    let press = null, pressedAt = 0;
    function cancelPress() {
      press && hostWindow().clearTimeout(press.timer), press = null;
    }
    function onPointerDown(event) {
      let item = event.target.closest(".pi-pitem");
      !item || !root.contains(item) || event.button > 0 || (cancelPress(), press = { x: event.clientX, y: event.clientY, timer: hostWindow().setTimeout(() => {
        press = null, pressedAt = Date.now(), projectMenu(item.dataset.id);
      }, LONG_PRESS_MS) });
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
    function onChange6(event) {
      let target = event.target;
      if (target.dataset.psearch !== void 0) return;
      let handler = current().onChange;
      handler && Promise.resolve(handler(view, target, event)).catch((error) => toast("error", error.message || String(error)));
    }
    function onInput5(event) {
      if (event.target.dataset.psearch !== void 0)
        return view.search = event.target.value, applySearch();
      let handler = current().onInput;
      handler && handler(view, event.target, event);
    }
    function onKey(event) {
      event.key === "Escape" && root && !doc.querySelector(".pi-dialog") && (event.stopPropagation(), view.drawer ? setDrawer(!1) : close()), event.key === "Enter" && (event.ctrlKey || event.metaKey) && current().onSubmit?.(view, event.target, event);
    }
    function open() {
      ensureStyle(), !root && (view.drawer = !1, lastSide = "", lastTop = "", root = el(`<div class="pi-root pi-overlay"><div class="pi-panel"><aside class="pi-side"></aside>
            <div class="pi-scrim" data-act="drawer"></div>
            <section class="pi-main"><header class="pi-top"></header><div class="pi-body"></div></section></div></div>`), root.addEventListener("click", onClick), root.addEventListener("contextmenu", onContext), root.addEventListener("pointerdown", onPointerDown), root.addEventListener("pointermove", onPointerMove), root.addEventListener("pointerup", cancelPress), root.addEventListener("pointercancel", cancelPress), root.addEventListener("scroll", cancelPress, !0), root.addEventListener("change", onChange6), root.addEventListener("input", onInput5), root.addEventListener("focusout", (event) => current().onBlur?.(view, event.target, event)), root.addEventListener("mousedown", (event) => {
        event.target === root && (root.dataset.down = "1");
      }), root.addEventListener("mouseup", (event) => {
        event.target === root && root.dataset.down && close(), delete root.dataset.down;
      }), doc.addEventListener("keydown", onKey, !0), doc.body.appendChild(root), view.restored = !1, data.isReady() ? restore() : render9());
    }
    function close() {
      root && (current().unmount?.(view), doc.removeEventListener("keydown", onKey, !0), root.remove(), root = null, data.flush().catch(() => {
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
    function show({ id, title: title2, body = "", actions: actions9 = [], timeout = 0 }) {
      hide(id);
      let card = el(`<div class="pi-notice" data-notice="${esc(id)}"><b>${esc(title2)}</b>${body ? `<p>${esc(body)}</p>` : ""}
            <div class="pi-row">${actions9.map((action, index) => `<button type="button" class="pi-btn is-sm${action.primary ? " is-primary" : ""}" data-act="${index}">${esc(action.label)}</button>`).join("")}</div></div>`);
      card.addEventListener("click", (event) => {
        let button = event.target.closest("[data-act]");
        if (button) {
          hide(id);
          try {
            actions9[Number(button.dataset.act)].run();
          } catch (error) {
            console.error("[剧情注入器]", error);
          }
        }
      }), container().appendChild(card), timeout && timers.set(id, view.setTimeout(() => hide(id), timeout));
    }
    function destroy() {
      for (let timer of timers.values()) view.clearTimeout(timer);
      timers.clear(), box?.remove(), box = null;
    }
    return { show, hide, destroy };
  }

  // src/index.js
  var VERSION = "0.1.15", KEY2 = "__plotInjector", BUTTON = "剧情注入";
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
    app = createApp({ data, runtime, version: VERSION });
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
