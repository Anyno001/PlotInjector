// PlotInjector v0.1.28
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

  // src/core/setting.js
  var HEADING = /^(?:#{1,4}\s*)?([^\s\-*#\[][^:：]{0,30})[:：]\s*$|^(?:#{1,4}\s+)(.{1,30})$|^(\[追加\])\s*$/;
  function splitBlocks(text2) {
    let lines2 = String(text2 || "").replace(/\r\n/g, `
`).split(`
`), blocks = [], current = { key: "", lines: [] }, counts = {};
    for (let line of lines2) {
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
  function injectedSetting(setting) {
    let text2 = String(setting && setting.text || "").trim(), mute2 = new Set(setting && Array.isArray(setting.mute) ? setting.mute : []);
    return mute2.size ? joinBlocks(splitBlocks(text2).filter((block) => !mute2.has(block.key))) : text2;
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
    let entries = Object.entries(value);
    if (entries.length && entries.every(([, v]) => looksLikeStage(v)))
      return [{ id: idOf2("v"), key: "剧情_导入", stages: entries.map(([key, data]) => ({ id: idOf2("s"), key, data })) }];
    if (looksLikeStage(value))
      return [{ id: idOf2("v"), key: "剧情_导入", stages: [{ id: idOf2("s"), key: "阶段一_导入", data: value }] }];
    let volumes = [];
    for (let [key, stages] of entries) {
      if (!looksLikeVolume(stages)) throw new Error(`「${key}」下没有可识别的阶段（需要 时间范围 / 主线节点 等字段）`);
      volumes.push({
        id: idOf2("v"),
        key,
        stages: Object.entries(stages).filter(([, data]) => isPlainObject(data)).map(([stageKey, data]) => ({ id: idOf2("s"), key: stageKey, data }))
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
      let kept = value.filter((_, index) => !off.has(`${meta2.prefix}${index}`));
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
    }), leftovers = old.flatMap((volume) => volume.stages.filter((stage) => !used.has(stage.id)).map((stage) => ({ key: stage.key, stage, volume }))), takeAny = queueByKey(leftovers);
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
        for (let item of row2.stages) item.from && !usedVolumes.has(item.from.id) && votes.set(item.from, (votes.get(item.from) || 0) + 1);
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
        String(stage.data && stage.data.时间范围 || "").trim() || issues.push({ kind: "no-time", volumeId: volume.id, stageId: stage.id, text: `「${label}」没有写时间范围` }), mainNodeNames(stage.data).length || issues.push({ kind: "no-main", volumeId: volume.id, stageId: stage.id, text: `「${label}」没有主线节点` }), seen.get(stage.key) > 1 && issues.push({ kind: "dup-name", volumeId: volume.id, stageId: stage.id, text: `阶段名「${label}」在「${volumeLabel(volume.key)}」中重名` });
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
  var PERSONA_RESERVED = ["muted", "manual", "auto", "names"], isObj2 = (value) => !!value && typeof value == "object" && !Array.isArray(value), strMap = (value) => Object.fromEntries(Object.entries(isObj2(value) ? value : {}).filter(([, item]) => typeof item == "string")), strList = (value) => Array.isArray(value) ? [...new Set(value.filter((item) => typeof item == "string"))] : [];
  function emptyPersonaProgress() {
    return { muted: [], manual: [], auto: {}, names: {} };
  }
  function normalizePersonaProgress(value) {
    let src = isObj2(value) ? value : {}, out = emptyPersonaProgress();
    for (let [key, item] of Object.entries(src)) !PERSONA_RESERVED.includes(key) && typeof item == "string" && (out[key] = item);
    return out.muted = strList(src.muted), out.manual = strList(src.manual), out.auto = strMap(src.auto), out.names = strMap(src.names), out;
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
    let wanted = new Set((names2 || []).map((name) => String(name).trim()).filter(Boolean)), next = progress;
    for (let node of nodes) wanted.has(node.name) && (next = setNodeChecked(next, unitId, node.id, !1, node.name));
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
    { value: "fame", label: "读声望" },
    { value: "manual", label: "手动" }
  ], MODE_KEYS = PERSONA_MODES.map((item) => item.value), PERSONA_SLOT_PREFIX = "@persona:", isObj3 = (value) => !!value && typeof value == "object" && !Array.isArray(value), text = (value) => String(value ?? ""), intOr = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Math.round(Number(value)) : fallback, num = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? void 0 : Number(value);
  function emptyPersonas() {
    return { lines: [], imported: [] };
  }
  function newStage(name = "新阶段") {
    return { id: makeId("ps"), name, cond: "", unitId: "", range: {}, text: "" };
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
      mode: "manual",
      fame: { bar: "", partner: "" },
      stages: [newStage("阶段一")],
      source: null
    };
  }
  function normalizeStage(value) {
    let src = isObj3(value) ? value : {}, range = isObj3(src.range) ? src.range : {}, min = num(range.min), max = num(range.max);
    return { id: text(src.id) || makeId("ps"), name: text(src.name).trim() || "阶段", cond: text(src.cond), unitId: text(src.unitId), range: { ...min !== void 0 ? { min } : {}, ...max !== void 0 ? { max } : {} }, text: text(src.text) };
  }
  function normalizeLine(value) {
    let src = isObj3(value) ? value : {}, fame = isObj3(src.fame) ? src.fame : {}, source = isObj3(src.source) ? src.source : null;
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
      fame: { bar: text(fame.bar).trim(), partner: text(fame.partner).trim() },
      stages: (Array.isArray(src.stages) ? src.stages : []).filter(isObj3).map(normalizeStage),
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
  function fameReading(line, fame) {
    let bar = (Array.isArray(fame) ? fame : []).find((item) => item && item.name === line.fame.bar);
    if (!bar) return null;
    if (line.fame.partner) {
      let pair = (Array.isArray(bar.pairs) ? bar.pairs : []).find((item) => item.partner === line.fame.partner);
      return pair ? Number(pair.value) : null;
    }
    return Number.isFinite(Number(bar.value)) ? Number(bar.value) : null;
  }
  var storedIndex = (line, pp) => Math.max(0, line.stages.findIndex((stage) => stage.id === pp[line.id]));
  function outlineIndex(line, env) {
    let units = env.units || [], links = env.links || NO_LINKS, position = new Map(units.map((unit, i) => [unit.id, i])), best = -1, at = 0;
    return line.stages.forEach((stage, i) => {
      if (!stage.unitId) return;
      let id = links.resolve(stage.unitId), pos = position.get(id);
      pos === void 0 || !["done", "active"].includes(env.states && env.states[id]) || pos >= best && (best = pos, at = i);
    }), at;
  }
  function fameIndex(line, env) {
    let value = fameReading(line, env.fame);
    return value === null ? -1 : line.stages.findIndex((stage) => rangeHas(stage.range, value));
  }
  function currentStage(line, progress, env = {}) {
    let pp = normalizePersonaProgress(progress && progress.personas), manualHeld = pp.manual.includes(line.id), stored = storedIndex(line, pp), pick = (index, source, lost = !1) => ({ stage: line.stages[index], index, source, lost });
    if (line.mode === "outline" && !manualHeld) return pick(outlineIndex(line, env), "outline");
    if (line.mode === "fame" && !manualHeld) {
      let index = fameIndex(line, env);
      return index >= 0 ? pick(index, "fame") : pick(stored, "manual", fameReading(line, env.fame) === null);
    }
    return pick(stored, manualHeld ? "manual" : line.mode === "check" ? "check" : "manual");
  }
  function personaEnv(project, progress, fame = []) {
    let infinite = project && project.mode === "infinite", units = infinite || !project ? [] : flattenUnits(project.outline && project.outline.volumes), links = infinite || !units.length ? NO_LINKS : outlineLinks(project.outline, units);
    return { units, links, states: units.length ? unitStates(units, progress, links) : {}, fame };
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
  function syncPersonas(project, progress, fame = []) {
    if (!hasPersonas(project) || !progress) return progress;
    let pp = normalizePersonaProgress(progress.personas), env = personaEnv(project, progress, fame), next = pp;
    for (let line of project.personas.lines) {
      if (line.mode !== "outline" && line.mode !== "fame") continue;
      let index = line.mode === "outline" ? outlineIndex(line, env) : fameIndex(line, env);
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
      ["muted", "manual", "auto", "names"].includes(key) || alive.has(key) || (delete next[key], changed = !0);
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
  function buildPersonaEntries(project, progress, { recentText, globals, fame = [] } = {}) {
    if (!hasPersonas(project)) return [];
    let personas2 = project.personas, env = personaEnv(project, progress, fame), out = [];
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
  function checkItems(project, progress, recentText, { globals = {}, fame = [] } = {}) {
    if (!hasPersonas(project) || !progress) return [];
    let pp = normalizePersonaProgress(progress.personas), env = personaEnv(project, progress, fame), out = [];
    for (let line of project.personas.lines) {
      if (!line.enabled || line.mode !== "check" || pp.muted.includes(line.id) || !lineTriggered(line, recentText, globals)) continue;
      let { stage, index } = currentStage(line, progress, env), next = line.stages[index + 1];
      next && out.push({ lineId: line.id, group: line.group, name: line.name, from: stage.name, fromId: stage.id, to: next.name, toId: next.id, cond: next.cond.trim(), wasManual: pp.manual.includes(line.id) });
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
      line && (next = releasePersona(setPersonaStage(next, line, move.item.toId), line.id));
    }
    return next;
  }
  function undoMoves(progress, project, moves) {
    let next = progress;
    for (let move of moves) {
      let line = project.personas.lines.find((item) => item.id === move.item.lineId);
      if (!line) continue;
      let pp = normalizePersonaProgress(next.personas), manual = move.item.wasManual ? [.../* @__PURE__ */ new Set([...pp.manual, line.id])] : pp.manual.filter((id) => id !== line.id);
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
      for (let node of stageNodes(unit.stage.data).filter((item) => item.kind !== "world" && !isThreadNode(item))) lines2.push(nodeLine(node, off.has(node.id) ? "已演" : "未演"));
      if (carryOver) for (let { node } of carriedNodes(units, states, progress, { links })) node.kind !== "world" && lines2.push(nodeLine(node, "未演·延续"));
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
  function buildDetailText(unit, off, settings, { pace = "normal", next = null, carried = [], threads = "" } = {}) {
    let tag = String(settings.tagName || "剧情参考").trim() || "剧情参考", data = filterStageData(unit.stage.data, [...off, ...stageNodes(unit.stage.data).filter(isThreadNode).map((node) => node.id)]), body = stringifyYaml({ [unit.stage.key]: data }).trimEnd(), vol = splitVolumeKey(unit.volume.key).short, note = paceText(settings, pace);
    if (pace === "fast" && next) {
      let range = rangeOf(next);
      note += `
下一阶段：${stagePlace(next)}${range ? `（${range}）` : ""}`;
    }
    return `<${tag} 卷="${vol}" 阶段="${unit.stage.key}">
${note}
${body}${carriedText(carried)}${threads}
</${tag}>`;
  }
  function changesText(units, states, live = null) {
    let lines2 = units.filter((unit) => states[unit.id] === "done").flatMap((unit) => changeLines(unit.stage.data).map((text2) => `- ${text2}（${stagePlace(unit)}）`)).concat(threadChangeLines(live));
    return lines2.length ? `已演完的剧情带来的变化（设定里对应的开局状态以这里为准）：
${lines2.join(`
`)}` : "";
  }
  function buildEntries(project, progress, settings, personaOpts = {}) {
    let base = buildOutlineEntries(project, progress, settings), persona = project ? buildPersonaEntries(project, progress, personaOpts) : [];
    return persona.length ? [...base, ...persona] : base;
  }
  function buildOutlineEntries(project, progress, settings) {
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
      let next = units.find((unit) => states[unit.id] === "next") || null, carried = settings.carryOver === !1 ? [] : carriedNodes(units, states, progress, { links }), threads = threadsText(live);
      for (let unit of units) {
        if (states[unit.id] !== "active") continue;
        let off = offNodes(progress, unit, links), params = pickParams(defaults.detail, progress.slots[unit.id]), own = params.enabled ? threads : "";
        entries.push({
          slotId: unit.id,
          kind: "detail",
          title: `${volumeLabel(unit.volume.key)}·${splitStageKey(unit.stage.key).short}`,
          unit,
          content: buildDetailText(unit, off, settings, { pace: progress.pace, next, carried, threads: own }),
          ...params
        }), params.enabled && (threads = "");
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
    offTrackMode: "ask",
    personaMode: "ask",
    carryOver: !0,
    handleMode: "ask",
    hookCap: 2,
    newThreadMode: "ask",
    checkEvery: 3,
    checkFloors: 3,
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
      projects: projects.map((item) => ({ id: item.id, name: String(item.name || "未命名"), group: String(item.group || ""), updatedAt: Number(item.updatedAt) || 0, bytes: item.bytes && typeof item.bytes == "object" ? item.bytes : {} })),
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
          stages: vol.stages.filter((stage) => stage && stage.data && typeof stage.data == "object").map((stage) => ({ id: stage.id || makeId("s"), key: String(stage.key || "阶段"), data: stage.data }))
        }))
      },
      defaults: normalizeDefaults(src.defaults),
      genRefs: normalizeGenRefs(src.genRefs),
      personas: normalizePersonas(src.personas),
      threads: { sideOn: !(src.threads && src.threads.sideOn === !1), worldOn: !(src.threads && src.threads.worldOn === !1) },
      mode: src.mode === "infinite" ? "infinite" : "normal",
      ...src.infinite && typeof src.infinite == "object" ? { infinite: normalizeInfinite(src.infinite) } : {}
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
  function createDataStore({ onChange: onChange8 = () => {
  }, onError = () => {
  } } = {}) {
    let index = emptyIndex(), ready = !1, projects = /* @__PURE__ */ new Map(), chats = /* @__PURE__ */ new Map(), loading = /* @__PURE__ */ new Map(), failed = /* @__PURE__ */ new Set(), writer = createWriter({
      onSaved(name, bytes) {
        if (failed.delete(name), name === INDEX_FILE) return;
        let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1], meta2 = index.projects.find((item) => item.id === id), kind = name.startsWith("pi-p-") ? "project" : "chat", knownFile = index.files.includes(name);
        meta2 && meta2.bytes[kind] !== bytes && (index = { ...index, projects: index.projects.map((item) => item === meta2 ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item) }), knownFile || (index = { ...index, files: [...index.files, name] }), (!knownFile || meta2 && meta2.bytes[kind] !== bytes) && writer.schedule(INDEX_FILE, index), onChange8("saved");
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
        return project && projects.set(id, project), project;
      })().finally(() => loading.delete(`p:${id}`));
      return loading.set(`p:${id}`, job), job;
    }
    function touch(id, patch = {}) {
      setIndex({ ...index, projects: index.projects.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item) });
    }
    function saveProject(project) {
      projects.set(project.id, project), writer.schedule(projectFile(project.id), project), touch(project.id, { name: project.name }), onChange8("project", project.id);
    }
    function updateProject(id, fn) {
      let current = projects.get(id);
      if (!current) throw new Error("项目尚未载入");
      let next = fn(current);
      return next && next !== current && saveProject(next), next;
    }
    async function createProject(name, group = "", mode = "normal") {
      let project = newProject(name, Date.now(), mode);
      projects.set(project.id, project);
      let bytes = await writeJsonFile(projectFile(project.id), project);
      return index = {
        ...index,
        projects: [...index.projects, { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } }],
        files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)]
      }, writer.schedule(INDEX_FILE, index), onChange8("index"), project;
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
      retryFailed: () => writer.flush(),
      flush: () => writer.flush()
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
    if (clocks.length && (keys.push('"clocks":[{"name":"进度钟名称","tick":推进格数,"happened":true或false}]'), rules.push(`clocks 对照剧情索引里的【世界进度钟】（${clocks.map((clock) => `${clock.name} ${clock.filled}/${clock.total}`).join("、")}）：正文里有推动这件事的进展就填正数，每次最多 2 格；玩家出手阻止、使局势缓和就填负数；没有变化就省略。只有正文已经写出这件事发生时，happened 才填 true。`)), threads.hooks && (keys.push('"hooks":["支线名"]'), rules.push("hooks 填【支线钩子】里标为「待触发」、出现条件已在正文中满足的支线名。支线已经在正文里演出时，把支线名填进 done；支线链只在当前这一步演出时填。")), threads.newThread) {
      keys.push('"newThread":{"name":"线名","summary":"一句话概括"}'), rules.push("玩家在正文里主动开了一条大纲和剧情索引里都没有的线（例如接下新的委托、追查新的线索、发展新的关系）时填 newThread，没有就填 null。");
      let ignored = Array.isArray(threads.ignored) ? threads.ignored.slice(-10) : [];
      ignored.length && rules.push(`以下线已被忽略，不要再填进 newThread：${ignored.join("、")}。`);
    }
    return clocks.length && threads.readTo > 0 && rules.push("标有「已读」的楼层上次检测已经读过，clocks 只按之后的新楼层推进；没有新楼层时省略 clocks 的推进。"), keys.length ? { keys, rules, hooks: !!threads.hooks, readTo: clocks.length && Number(threads.readTo) || 0 } : null;
  }
  var PERSONA_KEY = '"personas":[{"line":"线名","to":"下一阶段名","floor":依据所在楼号,"reason":"一句话依据"}]', PERSONA_RULE = "personas 对照【人设阶段】：只填正文里已经写出、满足该线「进入条件」的线；to 只能填该线的下一阶段名，不能跳段、不能退回；floor 填依据所在的楼号，reason 写一句依据。没有满足的就填空数组。";
  function personaLines(items) {
    return items.map((item) => `- ${item.group ? `${item.group}·` : ""}${item.name}：当前「${item.from}」；下一阶段「${item.to}」，进入条件：${item.cond || "（未写，按阶段名判断）"}`).join(`
`);
  }
  var EMPTY_NAMES = /^(?:无|没有|暂无|空|none|null|nil|n\/a|na|undefined|-|—|无新线|没有新线|没有新的线)$/i, isEmptyName = (name) => EMPTY_NAMES.test(String(name).trim().replace(/[。．.！!？?；;，,、\s]+$/, "").trim());
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
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function buildPersonaCheckMessages(items, floors) {
    let system = [
      "你是人设阶段核对员。根据最近的正文，判断下列人设线是否已经进入下一阶段。",
      "只认正文里已经写出的事件，计划、预告、角色设想不算发生。",
      `只输出一个 JSON 对象，不加说明：{${PERSONA_KEY}}`,
      PERSONA_RULE
    ].join(`
`), user = [`【人设阶段】
${personaLines(items)}`, "", "【最近正文】", ...floors.map((floor) => `【第 ${floor.index} 楼】
${floor.text}`)].join(`
`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
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
      return { name: String(item.name ?? item.名称 ?? "").trim(), tick: Number.isFinite(tick) ? Math.min(CLOCK_TICK_MAX, tick) : 0, happened: flag(item.happened ?? item.发生) };
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
    return name && !isEmptyName(name) ? { name, summary: String(item.summary ?? item.概括 ?? "").trim().slice(0, 200) } : null;
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
  function discussSystemPrompt({ guide, refs, persona = "" }) {
    let parts = [
      "你在帮用户构思一条同人 if 线：一起把世界观、人物处境、信息差和大纲方向想清楚。",
      "每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。"
    ];
    return persona.trim() && parts.push(`【说话人格】
${persona.trim()}`), refs.length && parts.push(...refs.map((ref) => `【参考·${ref.title}】
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
    let text2 = messages.map((msg) => `${msg.role === "user" ? "用户" : "AI"}：${msg.content}`).join(`

`);
    return [
      { role: "system", content: "把下面的讨论压缩成要点摘要：保留已经敲定的设定、人物关系、剧情走向和仍未决定的问题，删掉寒暄和被否掉的方案。只输出摘要。" },
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
    for (let msg of messages.filter((item) => !item.folded)) out.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
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
    "顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态、状态变化。",
    "节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。",
    "以下几个键可选，只在需要时写：支线事件可写 条件（出现条件满足后才安排）、时限（激活后的楼数，或写「本卷」）、错过（过期没接时的后果）、步骤（列表，分几步推进的支线）；世界动态可写 进度钟（总格数，常用 4、6、8，越大来得越慢）、前兆（过半时透露的风声）、后果（发生后世界的变化）。",
    "每个阶段 2 到 4 个主线节点，事件写已经发生的事实，偏转写玩家改变选择后的调整。",
    "时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。",
    "设定里的人物关系、认知和信息差是开局状态，会随剧情改变。状态变化逐条写本阶段结束时比之前变了什么，没有变化就省略。"
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
      changesBlock(flattenUnits(volumes), "已有大纲中的状态变化"),
      `只写第 ${volumeNo} 卷。${request || ""}`
    ].filter(Boolean).join(`

`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
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
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function syncSettingMessages({ guide, setting, units, fromUnitIndex = 0, reason = "" }) {
    let system = [
      guide,
      "剧情大纲已经调整。对照【剧情大纲】校对【已有世界观正文】：找出与大纲冲突的句子，以及把人物关系、认知、信息差、人物走向写成永远不变的句子，只改这些句子，改写成开局状态或留白；同一件事在几个分块里重复出现时，只留在最合适的一处；其余文字逐字保留，分块标题不变。",
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
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function fixYamlMessages(text2, error) {
    return [
      { role: "system", content: `修正下面 YAML 的格式错误，内容不变。
${OUTLINE_RULES}` },
      { role: "user", content: `【错误】${error}

${text2}` }
    ];
  }
  function extractYaml(text2, { all = !1 } = {}) {
    let raw = String(text2 || "");
    if (all) {
      let blocks = [...raw.matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map((match) => match[1].trim()).filter(Boolean);
      if (blocks.length) return blocks.join(`

`);
    }
    let fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw);
    return (fenced ? fenced[1] : raw).trim();
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
  function stageOpMessages({ setting, talk = "", refs = [], volumes, unit, next, op, request }) {
    let rule = STAGE_OPS[op];
    if (!rule) throw new Error("不支持的阶段操作");
    let system = [
      "你在调整剧情大纲中的单个阶段，格式必须与样例一致。",
      OUTLINE_RULES,
      "阶段里的字段（时间范围、AI指令、主线节点、支线事件、世界动态、状态变化，以及其他任何键）原样保留或合理改写，不要丢键。",
      `顶层键只写所属卷名「${unit.volume.key}」，卷下只放结果阶段。`,
      rule,
      `【格式样例】
${formatSample(volumes)}`
    ].join(`
`), units = flattenUnits(volumes), before = units.slice(0, units.findIndex((item) => item.id === unit.id)), user = [
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
      request ? `【额外要求】
${request}` : ""
    ].filter(Boolean).join(`

`);
    return [{ role: "system", content: system }, { role: "user", content: user }];
  }
  function volumeStageText(volume, stage) {
    return outlineToText([{ ...volume, stages: [stage] }]);
  }

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
2. 定铁则。写这个AU不可违背的几条：总受或总攻、欠债或因果归属、性格是否锁死、NSFW尺度、人称。每条一句，能约束角色行为，不解释理由。
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
- [ ] 同一件事只写在一个分块：谁知道什么写在信息差，人物的开局状态写在人物档案，铁则不再重复。
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
    let data = await postBackend("status", connection(llm), llm), list = Array.isArray(data && data.data) ? data.data : data && data.models, models = [...new Set((Array.isArray(list) ? list : []).map((item) => typeof item == "string" ? item : item && (item.id || item.name)).filter(Boolean))];
    if (!models.length) throw new Error("接口没有返回模型列表");
    return models.sort();
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
  var VIRTUAL_WORLD = "剧情注入器", LOG_MAX2 = 40, PENDING_MAX_MS = 3e4, CHECK_RETRIES = 3, RETRY_GAP_MS = 2e3, WORLD_RETRIES = 2, WORLD_WAIT_MS = 9e4, placeOf = (unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
  function createRuntime({ data, notice, emit, askReason = async () => "" }) {
    let view = hostWindow(), progress = null, progressFor = "", alignedFrom = null, alignedOutline = null, alignedPersonas = null, checking = !1, fallbackTimer = 0, generating = !1, chatStartFloors = 0, pendingCheck = !1, pendingTimer = 0, opening = !1, openGen = 0, openPromise = Promise.resolve(null), pendingTrigger = null, lastRead = null, listeners = [], stats = {}, logs = [];
    function log(text2) {
      logs.push({ at: Date.now(), text: text2 }), logs.length > LOG_MAX2 && logs.shift();
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
      if (!id) return null;
      (!progress || progressFor !== id) && (progress = readProgress(id), progressFor = id);
      let project = data.project(id);
      if (project && project.mode === "infinite" && !progress.infinite && (progress = { ...progress, infinite: emptyInfinite() }, writeProgress(progress)), project && !isInfinite(project) && (progress !== alignedFrom || project.outline !== alignedOutline)) {
        let aligned = alignProgress(progress, project.outline);
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
        let igs = view.IGS, list = igs && igs.stats && typeof igs.stats.fame == "function" ? igs.stats.fame() : [];
        return Array.isArray(list) ? list : [];
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
      next = stampActive(progress && progressFor === next.projectId ? progress : null, next), next = syncPersonas(activeProject(), next, fameNow()), progress = next, progressFor = next.projectId, writeProgress(next), scheduleFallback(), emit(reason);
    }
    function scanText() {
      let depth = Math.max(1, worldInfoScanDepth());
      return chatMessages().filter((msg) => !isNote(msg)).slice(-depth).map((msg) => String(msg.mes || "")).join(`
`);
    }
    function entries({ inject = !1 } = {}) {
      let project = activeProject(), prog = currentProgress();
      if (!project || !prog) return [];
      let persona = hasPersonas(project) ? { fame: fameNow(), ...inject ? { recentText: scanText(), globals: worldInfoMatchSettings() } : {} } : {};
      return buildEntries(project, prog, data.settings(), persona);
    }
    function virtualEntries() {
      return entries({ inject: !0 }).filter((entry) => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }
    function refreshPersonas() {
      let project = activeProject(), prog = currentProgress();
      if (!hasPersonas(project) || !prog) return;
      let next = syncPersonas(project, prog, fameNow());
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
        opening && await waitOpening();
        try {
          refreshPersonas(), payload.chatLore.push(...virtualEntries());
        } catch (error) {
          console.error("[剧情注入器] 注入失败", error);
        }
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
    async function syncSetting(projectId, { from = 0, reason = "" } = {}) {
      let project = data.project(projectId), text2 = project && project.setting.text.trim();
      if (!text2) return [];
      let list = flattenUnits(project.outline.volumes), guide = String(data.settings().guide || "").trim() || BUILTIN_GUIDE, reply2 = await requestLlm(syncSettingMessages({ guide, setting: text2, units: list, fromUnitIndex: from, reason }), resolveLlm(data.settings(), "outline")), body = parseSettingReply(reply2).body, keys = body ? changedBlockKeys(text2, body) : [];
      if (!keys.length) return [];
      let next = mergeBlocks(text2, body, keys);
      data.updateProject(projectId, (current) => ({ ...current, setting: { ...current.setting, text: next, history: pushHistory(pushHistory(current.setting.history, current.setting.text), next) } }));
      let titles = new Map(splitBlocks(text2).map((block) => [block.key, block.title]));
      return keys.map((key) => titles.get(key) || key);
    }
    async function rewriteRest(reason) {
      let project = activeProject(), prog = currentProgress(), unit = activeUnit();
      if (!project || !prog || !unit) throw new Error("当前卡没有启用的项目");
      let list = units(), from = list.findIndex((item) => item.id === unit.id), recent = recentFloors(6).map((floor) => floor.text).join(`

`), reply2 = await requestLlm(rewriteRestMessages({ setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units: list, recent, reason }), resolveLlm(data.settings(), "outline")), parsed = parseOutlineReply(reply2);
      if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
      let before = { volumes: project.outline.volumes, progress: prog, setting: project.setting.text }, volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
      data.updateProject(project.id, (current) => ({ ...current, outline: { ...current.outline, volumes, history: pushOutlineHistory(current.outline.history, current.outline.volumes, "偏离改写") } }));
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
        if (!(!msg || msg.is_user || msg.is_system))
          return { floor: i, text: String(msg.mes || "") };
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
        pending ? (log(`第 ${trig.floor} 楼不再是「${names2.depart}」，取消正在生成的世界档案`), abandonOpening()) : trig.kind === "enter" ? (log(`第 ${trig.floor} 楼不再是「${names2.depart}」，撤销开副本，删掉刚生成的档案`), setInf(undoEnter(state.inf, `第 ${trig.floor} 楼不再是「${names2.depart}」，撤销开副本`))) : (log(`第 ${trig.floor} 楼不再是「${names2.back}」，撤销关副本`), setInf(undoLeave(state.inf, `第 ${trig.floor} 楼不再是「${names2.back}」，撤销关副本`))), notice.show({ id: "inf-undo", title: "触发楼已改动", body: trig.kind === "enter" ? `这一楼不再是「${names2.depart}」，已撤销开副本并删掉刚生成的档案。` : `这一楼不再是「${names2.back}」，已重新打开那份档案。`, timeout: 1e4 });
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
      if (kind === "enter")
        openWorld({ floor: found.floor, text: found.text });
      else if (kind === "leave") {
        let trigger = makeTrigger({ kind: "leave", floor: found.floor, text: found.text, worldId: state.inf.worldId });
        setInf(withTrigger(leaveWorld(state.inf, `第 ${found.floor} 楼读到「${hubWordNames(state.infinite.config).back}」，关副本`), trigger));
      }
      emit("floor");
    }
    async function waitOpening() {
      let promise = openPromise, timer = 0, timedOut = !1, timeout = new Promise((resolve) => {
        timer = view.setTimeout(() => {
          timedOut = !0, resolve();
        }, WORLD_WAIT_MS);
      });
      log("世界档案还在生成，先等它完成"), await Promise.race([promise.catch(() => null), timeout]), view.clearTimeout(timer), timedOut && opening && (log(`等待世界档案超过 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案`), notice.show({ id: "inf-wait", title: "世界档案还没生成完", body: `已等待 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案，生成完成后从下一次回复起带上。`, timeout: 12e3 }));
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
        return setInf(withTrigger(enterWorld(now.inf, world), trig)), notice.show({ id: "inf-stop", title: `进入新世界「${world.title}」`, body: `${dice.horror}｜${dice.client}`, timeout: 12e3 }), world;
      } catch (error) {
        return gen !== openGen || (log(`开副本失败：${error.message}`), notice.show({
          id: "inf-stop",
          title: "开副本失败",
          body: error.message,
          actions: [{ label: "重试", primary: !0, run: () => openWorld() }, { label: "关闭", run: () => {
          } }]
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
      return !hasPersonas(project) || !prog || data.settings().personaMode === "off" ? [] : checkItems(project, prog, floors.map((floor) => floor.text).join(`
`), { globals: worldInfoMatchSettings(), fame: fameNow() });
    }
    function offerPersonaMoves(items, replyMoves) {
      let project = activeProject(), moves = resolveMoves(items, replyMoves);
      if (!moves.length || !project) return;
      let lines2 = moves.map(moveText), adopt = () => {
        let prog = currentProgress(), env = personaEnv(project, prog, fameNow()), still = moves.filter((move) => {
          let line = project.personas.lines.find((item) => item.id === move.item.lineId);
          return line && currentStage(line, prog, env).stage.id === move.item.fromId;
        });
        if (!still.length) {
          log("人设阶段推进作废：阶段已被改动");
          return;
        }
        setProgress(applyMoves(prog, project, still)), log(`人设阶段推进：${lines2.join("；")}`);
      };
      if (data.settings().personaMode === "auto") {
        adopt(), notice.show({ id: "persona", title: "人设阶段已推进", body: lines2.join(`
`), actions: [{ label: "撤销", run: () => setProgress(undoMoves(currentProgress(), project, moves)) }], timeout: 15e3 });
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
      let settings = data.settings(), floors = recentFloors(settings.checkFloors), items = floors.length ? personaCheckItems(floors) : [];
      if (!items.length)
        return floors.length && !manual && setProgress({ ...currentProgress(), lastCheckFloor: floorCount() }), log("跳过检测：大纲为空"), manual && hasPersonas(activeProject()) && toast("info", floors.length ? "没有需要检测的人设线。" : "还没有可检测的正文。"), null;
      checking = !0, log(`开始检测人设阶段：${items.length} 条线，读最近 ${floors.length} 楼${manual ? "（手动）" : ""}`), emit("checking");
      try {
        let messages = buildPersonaCheckMessages(items, floors), result = null;
        for (let attempt = 0; ; attempt += 1)
          try {
            result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, "check"), { timeoutMs: 12e4 }));
            break;
          } catch (error) {
            if (attempt >= CHECK_RETRIES) throw error;
            log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`), await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS));
          }
        notice.hide("checkfail");
        let next = { ...currentProgress(), lastCheckFloor: floorCount() };
        delete next.lastFailFloor, setProgress(next);
        let moves = result.personas || [];
        return log(`人设检测完成：${moves.length} 条建议`), offerPersonaMoves(items, moves), manual && !moves.length && toast("info", "人设阶段没有变化。"), result;
      } catch (error) {
        return setProgress({ ...currentProgress(), lastFailFloor: floorCount() }), log(`检测失败：${error.message}`), notice.show({ id: "checkfail", title: "进度检测失败", body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`, actions: [{ label: "重试", primary: !0, run: () => checkNow({ manual }) }, { label: "关闭", run: () => {
        } }] }), null;
      } finally {
        checking = !1, emit("checked");
      }
    }
    async function checkNow({ manual = !1 } = {}) {
      if (isInfinite(activeProject()))
        return log("无限流项目不使用检测模型"), null;
      if (checking)
        return log("跳过检测：上一次检测还没结束"), null;
      let project = activeProject(), prog = currentProgress(), settings = data.settings();
      if (!project || !prog)
        return log("跳过检测：当前卡没有启用的项目"), manual && toast("info", "当前卡没有启用的项目。"), null;
      let sw = threadSwitches(project), unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
      if (!unit) return checkPersonasOnly({ manual });
      let floors = recentFloors(settings.checkFloors);
      if (!floors.length)
        return log("跳过检测：没有可检测的正文"), manual && toast("info", "还没有可检测的正文。"), null;
      checking = !0, log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? "（手动）" : ""}`), emit("checking");
      try {
        let list = maskUnits(units(), sw), states = unitStates(list, prog), opts = { carryOver: settings.carryOver, hookCap: settings.hookCap, links: links() }, index = buildIndexText(list, states, prog, opts), threadInfo = checkThreads(liveThreads(list, states, prog, opts), {
          newThreadMode: sw.sideOn ? settings.newThreadMode : "off",
          ignored: threadState(prog).ignored,
          readTo: prog.lastCheckFloor
        }), pItems = personaCheckItems(floors), messages = buildCheckMessages(unit, index, floors, threadInfo, pItems), result = null;
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
        if (next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data).filter((node) => !isThreadNode(node)), result.done), settings.carryOver) for (let item of carriedNodes(list, states, prog, { links: opts.links })) next = uncheckByNames(next, item.unit.id, [item.node], result.done);
        let merged = applyCheck(next, liveThreads(list, unitStates(list, next), next, opts), result, { floor: floorCount() });
        next = { ...merged.progress, lastCheckFloor: floorCount() }, delete next.lastFailFloor, setProgress(next);
        for (let event of merged.events) log(threadEventText(event));
        return log(`检测完成：已演 ${result.done.length} 个节点${result.stageDone ? "，本阶段已演完" : ""}${result.offTrack ? "，偏离大纲" : ""}`), result.offTrack && settings.offTrackMode !== "off" && !next.offMuted.includes(unit.id) ? handleOffTrack(unit, result.offReason || result.reason) : result.stageDone ? proposeAdvance({ unit, reason: result.reason }) : manual && toast("info", result.reason || "本阶段尚未演完。"), result.newThread && sw.sideOn && offerThread(unit, result.newThread), offerPersonaMoves(pItems, result.personas || []), result;
      } catch (error) {
        return setProgress({ ...currentProgress(), lastFailFloor: floorCount() }), log(`检测失败：${error.message}`), notice.show({
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
      dryRun || (generating = !0);
    }
    function onGenerationEnded() {
      generating = !1, runPending();
    }
    function onMessageReceived(messageId) {
      let floors = floorCount(), project = activeProject();
      if (!project) {
        log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`), emit("floor");
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
      if (isInfinite(activeProject())) {
        refreshRead(), revalidateTrigger(), emit("floor");
        return;
      }
      clampBase() && emit("floor");
    }
    async function onChatChanged() {
      progress = null, progressFor = "", abandonOpening(), lastRead = null, pendingCheck = !1, view.clearTimeout(pendingTimer), chatStartFloors = floorCount(), notice.hide("advance"), notice.hide("offtrack"), notice.hide("thread"), notice.hide("persona");
      let id = activeId();
      if (id)
        try {
          await data.loadProject(id);
        } catch (error) {
          toast("error", `读取项目失败：${error.message}`);
        }
      log(`切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find((item) => item.id === id) || {}).name || id}」` : "本卡没有启用项目"}`), id && clampBase(), refreshRead(), scheduleFallback(), emit("chat");
    }
    async function switchProject(id, scope = "chat") {
      id && await data.loadProject(id), abandonOpening();
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
      fame: fameNow,
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
      refresh: () => {
        scheduleFallback(), emit("progress");
      }
    };
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

  // src/ui/tab-discuss.js
  var tab_discuss_exports = {};
  __export(tab_discuss_exports, {
    actions: () => actions3,
    onInput: () => onInput3,
    onSubmit: () => onSubmit,
    refreshOn: () => refreshOn3,
    render: () => render3
  });

  // src/ui/ai.js
  function ask(view, role, messages, { signal } = {}) {
    return requestLlm(messages, resolveLlm(view.data.settings(), role), { signal });
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
    let project = view.project(), units = maskUnits(flattenUnits(project.outline.volumes), threadSwitches(project));
    if (!units.length) return "";
    let progress = view.runtime.progress(), settings = view.data.settings();
    return buildIndexText(units, unitStates(units, progress), progress, { carryOver: settings.carryOver, hookCap: settings.hookCap });
  }
  function floorsText(view, count) {
    return count ? view.runtime.recentFloors(count).map((floor) => `【第 ${floor.index} 楼】
${floor.text}`).join(`

`) : "";
  }
  async function resolveRefs(view, chat, project) {
    let refs = [], r = chat.refs;
    if (r.setting && project.setting.text.trim() && refs.push({ title: "当前设定", text: project.setting.text }), r.outline && project.outline.volumes.length) {
      let text2 = outlineToText(project.outline.volumes);
      refs.push({ title: "当前大纲", text: text2.length < 12e3 ? text2 : flattenUnits(project.outline.volumes).map((unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`).join(`
`) });
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
      actions: [{ label: "取消", value: null }, {
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
      }],
      onMount(box) {
        let byId = /* @__PURE__ */ new Map();
        for (let book of books) for (let entry of book.entries) byId.set(entryRefId(book.name, entry), entry);
        let sum = () => {
          let ids = [...box.querySelectorAll("[data-ref-id]:checked")].map((input2) => input2.dataset.refId), tokens = ids.reduce((total, id) => total + estimateTokens(byId.get(id)?.content || ""), 0);
          box.querySelector("[data-ref-sum]").textContent = `已选 ${ids.length} 条，约 ${tokens} token`;
        }, applyMemo = () => {
          let n = Math.max(0, Math.round(Number(box.querySelector("[data-ref-memo]")?.value) || 0));
          for (let book of box.querySelectorAll(".pi-ref-book")) memoRows(book).sort((a, b) => rowNo2(b) - rowNo2(a)).forEach((input2, i) => {
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
      actions: [{ label: "取消", value: null }, { label: "导入选中", primary: !0, value: (root) => [...root.querySelectorAll("[data-pick]:checked")].map((input2) => input2.dataset.pick) }],
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
  }, LONG_KEYS = /* @__PURE__ */ new Set(["事件", "偏转", "内容", "触发"]), NEW_NODE = { main: { 名称: "", 地点: "", 事件: "", 偏转: "" }, side: { 名称: "", 地点: "", 事件: "", 触发: "" }, world: { 类型: "", 来源: "", 内容: "" } }, st = (view) => view.tabState("outline"), STAGE_DRAFT = { "stage-refine": "细化节点", "stage-split": "拆成两段", "stage-merge": "与下一段合并" }, fmtTime = (time2) => new Date(time2).toLocaleString(), ERR_PREFIX = /^(?:YAML 格式错误(?:（第 \d+ 行）)?|第 \d+ 行)[：:]\s*/;
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
        ${list.map((item, i) => `<div class="pi-hist"><span class="pi-grow">${item.label ? `${esc(item.label)}前` : "历史版本"}<span class="pi-meta pi-block">${esc(fmtTime(item.at))}</span></span>
            <span class="pi-meta pi-hist-n">${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm${i === at ? " is-primary" : ""}" data-act="hist-view" data-i="${i}">预览</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">恢复</button></div>`).join("")}
        ${chosen ? `<pre class="pi-pre">${esc(chosen.text)}</pre>` : ""}</div>`;
  }
  function checkHtml(project) {
    let issues = outlineIssues(project.outline.volumes);
    return issues.length ? `<div class="pi-card"><h3>大纲检查<span class="pi-meta">${issues.length} 项</span></h3>
        ${issues.map((item) => `<button type="button" class="pi-titem is-issue" data-act="issue-go" data-id="${esc(item.stageId || item.volumeId)}"><span class="pi-pname">${esc(item.text)}</span></button>`).join("")}</div>` : '<div class="pi-card"><h3>大纲检查</h3><p class="pi-hint">没有发现问题。</p></div>';
  }
  function overviewHtml(view, project) {
    let { runtime } = view, units = flattenUnits(project.outline.volumes), states = runtime.activeId() === project.id ? unitStates(units, runtime.progress()) : {};
    return units.length ? project.outline.volumes.map((volume) => `<div class="pi-card"><h3>${esc(volumeLabel(volume.key))}</h3>
        ${volume.stages.map((stage) => {
      let names2 = mainNodeNames(stage.data);
      return `<button type="button" class="pi-ov-stage${states[stage.id] === "active" ? " is-active" : ""}${states[stage.id] === "done" ? " is-done" : ""}" data-act="ov-go" data-id="${esc(stage.id)}">
            <span class="pi-ov-title">${esc(stageLabel(stage.key))}</span>
            ${names2.map((name) => `<span class="pi-meta pi-ov-node">${esc(name)}</span>`).join("")}</button>`;
    }).join("") || '<p class="pi-hint">没有阶段</p>'}</div>`).join("") : '<div class="pi-card"><p class="pi-hint">还没有卷。</p></div>';
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
    return project.outline.volumes.map((volume) => `<button type="button" class="pi-titem is-vol${volume.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeLabel(volume.key))}</span></button>
        ${volume.stages.map((stage) => `<button type="button" class="pi-titem is-stage${stage.id === sel ? " is-sel" : ""}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join("")}`).join("") || '<p class="pi-hint">还没有卷。</p>';
  }
  var PLAY_KEYS = { side: ["条件", "时限", "错过", "步骤"], world: ["进度钟", "前兆", "后果"] }, PLAY_HINTS = { 条件: "满足后才激活，如主角到过酒馆", 时限: "激活后的楼数，或写「本卷」", 错过: "过期未接时的后果", 步骤: "每行一步，按顺序推进", 进度钟: "总格数，如 4、6、8", 前兆: "过半时透露的风声", 后果: "发生后写进状态变化" }, PLAY_LONG = /* @__PURE__ */ new Set(["错过", "步骤", "前兆", "后果"]), PLAY_SHORT = /* @__PURE__ */ new Set(["进度钟", "时限"]);
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
  function nodeEditor(stage, meta2) {
    let list = Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field] : [], items = list.map((item, index) => {
      let value = item && typeof item == "object" ? item : { 内容: String(item ?? "") }, play = PLAY_KEYS[meta2.kind] || [], keys = [.../* @__PURE__ */ new Set([...NODE_KEYS[meta2.kind], ...Object.keys(value)])].filter((key) => !play.includes(key));
      return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(meta2.label)} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-icon-btn" data-act="node-menu" data-field="${esc(meta2.field)}" data-i="${index}" data-last="${index < list.length - 1 ? "" : "1"}" title="更多">${ICONS.more}</button></div>
            ${keys.map((key) => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key) ? `<textarea class="pi-ta" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? "")}</textarea>` : `<input class="pi-inp" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? "")}">`}</label>`).join("")}
            ${playEditor(meta2, value, index)}</div>`;
    }).join("");
    return `<div class="pi-card"><h3>${esc(meta2.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta2.field)}" data-kind="${meta2.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
  }
  function nodeTabs(stage, kind) {
    let count = (meta2) => Array.isArray(stage.data[meta2.field]) ? stage.data[meta2.field].length : 0;
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map((meta2) => `<button type="button" class="pi-seg-btn${meta2.kind === kind ? " is-sel" : ""}" data-act="node-kind" data-kind="${meta2.kind}">${esc(meta2.label)} ${count(meta2)}</button>`).join("")}</div>`;
  }
  function stageEditor(volume, stage, raw, kind) {
    let known = /* @__PURE__ */ new Set(["时间范围", "AI指令", CHANGE_FIELD, ...NODE_FIELDS.map((item) => item.field)]), extra = Object.keys(stage.data).filter((key) => !known.has(key)), head = `<div class="pi-card"><h3>阶段<span class="pi-spacer"></span>${raw ? "" : '<button type="button" class="pi-btn is-primary is-sm" data-act="outline-save">保存</button>'}<button type="button" class="pi-icon-btn" data-act="stage-menu" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint">所属：${esc(volumeLabel(volume.key))}</p>`;
    return raw ? `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>` : `${head}<label class="pi-field"><span>阶段名（阶段N_标题）</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}"></label>
        <label class="pi-field"><span>时间范围（用来判断何时切到下一段）</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? "")}"></label>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta" rows="2" data-stage-field="AI指令">${esc(stage.data.AI指令 ?? "")}</textarea></label>
        <label class="pi-field"><span>状态变化（每行一条，本阶段演完后接在设定后面注入）</span><textarea class="pi-ta" rows="2" data-stage-list="${CHANGE_FIELD}" placeholder="例：她察觉到 A 对她不只是兄弟情">${esc(changeLines(stage.data).join(`
`))}</textarea></label>
        ${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join("、"))}（在 YAML 原文里编辑）</p>` : ""}</div>
        ${nodeTabs(stage, kind)}${nodeEditor(stage, NODE_FIELDS.find((meta2) => meta2.kind === kind))}`;
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
    }).join(""), ready = good.length === draft.items.length && good.length > 0, partial = draft.items.length < draft.n;
    return `<div class="pi-card"><h3>AI 写的大纲<span class="pi-meta">${good.length}/${draft.n} 卷</span></h3>
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
            <button type="button" class="pi-btn is-sm" data-act="draft-drop">丢弃</button></div></div>`;
    let summary = draft.volumes.map((volume) => `<p class="pi-hint"><b>${esc(volumeLabel(volume.key))}</b>：${volume.stages.map((stage) => esc(stageLabel(stage.key))).join("、")}</p>`).join(""), single = !!STAGE_DRAFT[draft.mode], buttons = single ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-stage">替换</button>' : draft.mode === "rewrite" ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>' : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">${draft.volumes.length > 1 ? `全部追加 ${draft.volumes.length} 卷` : "存为新卷"}</button>
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
    let project = view.project(), s = st(view);
    syncDraft(view, s);
    let { volume, stage } = findSel(project, s.sel), busy = view.busy.outline, kind = NODE_FIELDS.some((meta2) => meta2.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind, editor2 = stage ? stageEditor(volume, stage, s.raw, kind) : volume ? volumeEditor(volume) : '<div class="pi-card"><p class="pi-hint">从左边选一卷或一个阶段编辑。</p></div>';
    return `<div class="pi-card"><h3>大纲<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="outline-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c3">
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
      outline: withAliases({
        ...project.outline,
        volumes: fn(project.outline.volumes),
        ...label ? { history: pushOutlineHistory(project.outline.history, project.outline.volumes, label) } : {}
      }, alias)
    }));
  }
  function updateStage(view, stageId, fn, label = "") {
    update2(view, (volumes) => volumes.map((volume) => volume.stages.some((stage) => stage.id === stageId) ? { ...volume, stages: volume.stages.map((stage) => stage.id === stageId ? fn(stage) : stage) } : volume), label);
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
    let project = view.project(), existing = new Set(project.outline.volumes.map((volume) => volume.key)), fresh = incoming.map((volume) => existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume);
    return update2(view, (volumes) => [...volumes, ...fresh], label), st(view).sel = fresh[0] && fresh[0].id, view.runtime.refresh(), fresh;
  }
  async function importTexts(view, texts) {
    let added = [], failed = [];
    for (let { name, text: text2 } of texts)
      try {
        added.push(...parseOutlineText(text2));
      } catch (error) {
        failed.push({ name, error });
      }
    added.length && addVolumes(view, added), added.length && toast("success", `已导入 ${added.length} 卷。`), view.renderBody(), failed.length && await openDialog({ title: "导入失败", html: failed.map((item) => `<p class="pi-hint"><b>${esc(item.name)}</b></p>${errHtml(item.error)}`).join(""), actions: [{ label: "关闭", value: !0, primary: !0 }] });
  }
  function setDraft(view, mode, reply2, extra = {}, { all = !1 } = {}) {
    st(view).draft = { mode, ...parseOutlineReply(reply2, void 0, { all }), projectId: view.projectId, ...extra }, view.renderBody();
  }
  function showDraft(view, reply2) {
    setDraft(view, "volume", reply2, {}, { all: !0 });
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
    reply2 && setDraft(view, "rewrite", reply2, { fromUnitId: units[from].id, reason });
  }
  function applyRest(view, draft) {
    let project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit) throw new Error("原来的阶段已不存在，改用「存为新卷」。");
    let volumes = replaceRest(project.outline.volumes, unit.stage.id, draft.volumes);
    update2(view, () => volumes, "改写后续阶段");
    let first = draft.volumes[0] && draft.volumes[0].stages[0];
    return first && view.runtime.activeId() === view.projectId && view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id)), first ? flattenUnits(volumes).findIndex((item) => item.id === first.id) : 0;
  }
  var MAX_VOLUMES = 5;
  async function writeDialog(view) {
    let picked = await openDialog({
      title: "AI 写大纲",
      html: `<label class="pi-field"><span>卷数</span><select class="pi-sel" data-wv-n>${options(Array.from({ length: MAX_VOLUMES }, (_, i) => ({ value: i + 1, label: `${i + 1} 卷` })), 1)}</select></label>
            <label class="pi-field"><span>整体要求（可空）</span><textarea class="pi-ta" rows="4" data-wv-request>${esc(st(view).request || "")}</textarea></label>`,
      actions: [{ label: "取消", value: null }, { label: "开始写作", primary: !0, value: (root) => ({ n: Number(root.querySelector("[data-wv-n]").value) || 1, request: root.querySelector("[data-wv-request]").value.trim() }) }]
    });
    return picked && (st(view).request = picked.request), picked;
  }
  function setTalkRef(view) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, genRefs: { ...normalizeGenRefs(project.genRefs), talk: !0 } }));
  }
  function volumeRequest({ project, talk, wb, extra = [], no, k, n, request }) {
    let text2 = n > 1 ? `共写 ${n} 卷，这是第 ${k} 卷。${request || ""}` : request;
    return outlineMessages({ setting: project.setting.text, talk, refs: wb, volumes: [...project.outline.volumes, ...extra], volumeNo: no, request: text2 });
  }
  function setMultiItem(view, index, parsed) {
    let draft = st(view).draft;
    !draft || draft.mode !== "multi" || (draft.items = draft.items.map((item, i) => i === index ? parsed : item), view.renderBody());
  }
  async function writeVolumes(view, n, request, onConfirmed = null) {
    let id = view.projectId;
    if ((st(view).draft && st(view).draft.projectId === id ? st(view).draft : parkedDrafts.get(id)) && !await confirmDialog({ title: "覆盖草稿", body: "草稿区还有未处理的 AI 结果，开始写作后会被新草稿替换。", okLabel: "开始写作", danger: !0 })) return;
    onConfirmed && onConfirmed();
    let project = view.project(), { talk, wb } = await genRefTexts(view, 12e3);
    if (!project.setting.text.trim() && !talk.trim() && !wb.length) throw new Error("没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。");
    let base = project.outline.volumes.length + 1;
    if (n <= 1) {
      let reply2 = await runTask(view, "outline", () => ask(view, "outline", volumeRequest({ project, talk, wb, no: base, k: 1, n: 1, request })));
      reply2 && setDraft(view, "volume", reply2);
      return;
    }
    let controller = new AbortController(), draft = { mode: "multi", items: [], n, volumeNo: base, request, projectId: project.id };
    st(view).draft = draft, st(view).multi = { k: 1, n, controller, projectId: project.id };
    try {
      await runTask(view, "outline", async () => {
        for (let k = 1; k <= n; k += 1) {
          st(view).multi.k = k, view.renderBody();
          let reply2;
          try {
            reply2 = await ask(view, "outline", volumeRequest({
              project,
              talk,
              wb,
              extra: draft.items.flatMap((item) => item.volumes || []),
              no: base + k - 1,
              k,
              n,
              request
            }), { signal: controller.signal });
          } catch (error) {
            controller.signal.aborted || toast("error", `第 ${k} 卷写作失败：${error.message}。已写好的 ${draft.items.length} 卷保留在草稿里。`);
            break;
          }
          if (controller.signal.aborted) break;
          draft.items = [...draft.items, parseOutlineReply(reply2, void 0, { all: !0 })];
        }
      });
    } finally {
      st(view).multi = null, draft.items.length || (st(view).draft === draft && (st(view).draft = null), parkedDrafts.get(project.id) === draft && parkedDrafts.delete(project.id)), view.renderBody();
    }
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
    "vol-down"(view) {
      update2(view, (volumes) => moveItem(volumes, volumes.findIndex((volume) => volume.id === st(view).sel), 1)), view.runtime.refresh(), view.renderBody();
    },
    async "vol-menu"(view) {
      let pick = await menuDialog({ title: "卷", items: [
        { label: "上移", value: "vol-up" },
        { label: "下移", value: "vol-down" },
        { label: "导出本卷", value: "vol-export" },
        { label: "删除卷", value: "vol-del", danger: !0 }
      ] });
      pick && await actions[pick](view);
    },
    "vol-export"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      volume && downloadBlob(`${volume.key}.yaml`, volumeToText(volume), "text/yaml");
    },
    async "vol-del"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      !volume || !await confirmDialog({ title: `删除「${volumeLabel(volume.key)}」`, body: `连同 ${volume.stages.length} 个阶段一起删除。`, okLabel: "删除", danger: !0 }) || (update2(view, (volumes) => volumes.filter((item) => item.id !== volume.id), "删除卷"), st(view).sel = "", view.runtime.refresh(), view.renderBody());
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
      stage && (updateVolume(view, volume.id, (item) => ({ ...item, stages: moveItem(item.stages, item.stages.findIndex((entry) => entry.id === stage.id), 1) })), view.runtime.refresh(), view.renderBody());
    },
    async "stage-menu"(view) {
      let { volume, stage } = findSel(view.project(), st(view).sel);
      if (!stage) return;
      let last = volume.stages[volume.stages.length - 1] === stage, pick = await menuDialog({ title: stageLabel(stage.key), items: [
        { label: "细化节点", value: "stage-refine" },
        { label: "拆成两段", value: "stage-split" },
        ...last ? [] : [{ label: "与下一段合并", value: "stage-merge" }],
        { label: "上移", value: "stage-up" },
        { label: "下移", value: "stage-down" },
        { label: "移到…", value: "stage-move" },
        { label: st(view).raw ? "表单编辑" : "YAML 原文", value: "raw" },
        { label: "删除阶段", value: "stage-del", danger: !0 }
      ] });
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
      !stage || !await confirmDialog({ title: `删除「${stageLabel(stage.key)}」`, okLabel: "删除", danger: !0 }) || (updateVolume(view, volume.id, (item) => ({ ...item, stages: item.stages.filter((entry) => entry.id !== stage.id) }), "删除阶段"), st(view).sel = volume.id, view.runtime.refresh(), view.renderBody());
    },
    raw(view) {
      st(view).raw = !st(view).raw, view.renderBody();
    },
    // 手动保存：把编辑框里的内容再写一遍、立即落盘，并刷新注入内容（不用等失焦）。
    async "outline-save"(view, target) {
      target.closest(".pi-body")?.querySelectorAll("[data-stage-key],[data-vol-key],[data-stage-field],[data-stage-list],[data-node-field]").forEach((box) => {
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
      updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field2]: [...Array.isArray(item.data[field2]) ? item.data[field2] : [], { ...NEW_NODE[target.dataset.kind] }] } })), view.renderBody();
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
      let index = Number(target.dataset.i), pick = await menuDialog({ title: `${target.dataset.field} ${index + 1}`, items: [
        { label: "上移", value: "node-up", disabled: index <= 0 },
        { label: "下移", value: "node-down", disabled: !!target.dataset.last },
        { label: "删除", value: "node-del", danger: !0 }
      ] });
      pick && await actions[pick](view, target);
    },
    async "node-del"(view, target) {
      let { stage } = findSel(view.project(), st(view).sel), field2 = target.dataset.field, index = Number(target.dataset.i), node = stage.data[field2][index];
      if (!await confirmDialog({ title: `删除「${node && (node.名称 || node.类型) || "节点"}」`, okLabel: "删除", danger: !0 })) return;
      let before = liveProgress(view);
      updateStage(view, stage.id, (item) => {
        let list = item.data[field2].filter((_, i) => i !== index), data = { ...item.data, [field2]: list };
        return !list.length && field2 !== "主线节点" && delete data[field2], { ...item, data };
      }), remapProgress(view, before, stage.id, field2, (i) => i === index ? null : i > index ? i - 1 : i), view.runtime.refresh(), view.renderBody();
    },
    async "outline-menu"(view) {
      let pick = await menuDialog({ title: "大纲", items: [
        { label: "导入YAML", value: "import-file" },
        { label: "粘贴", value: "import-paste" },
        { label: "从世界书", value: "import-wb" },
        { label: "导出", value: "export", disabled: !view.project().outline.volumes.length }
      ] });
      pick && await actions[pick](view);
    },
    async "import-file"(view) {
      let files = await pickFiles({ accept: ".yaml,.yml,.txt", multiple: !0 });
      files.length && await importTexts(view, await Promise.all(files.sort((a, b) => a.name.localeCompare(b.name, "zh")).map(async (file) => ({ name: file.name, text: await file.text() }))));
    },
    async "import-paste"(view) {
      let text2 = await promptDialog({ title: "粘贴剧情 YAML", multiline: !0, placeholder: `剧情_卷一_标题:
  阶段一_标题:
    时间范围: …` });
      text2 && await importTexts(view, [{ name: "粘贴内容", text: text2 }]);
    },
    async "import-wb"(view) {
      let picked = await pickWorldbookEntries("从世界书导入大纲或设定");
      if (!picked.length) return;
      let { outline, setting } = classifyEntries(picked);
      outline.length && addVolumes(view, outline.flatMap((item) => item.volumes)), setting.length && view.data.updateProject(view.projectId, (project) => {
        let text2 = [project.setting.text, ...setting.map((entry) => entry.content)].filter(Boolean).join(`

`);
        return { ...project, setting: { ...project.setting, text: text2 } };
      }), toast("success", `${outline.length} 条进大纲，${setting.length} 条进设定。`), view.runtime.refresh(), view.renderBody(), await afterImport(picked);
    },
    async export(view) {
      let project = view.project(), choice = await choiceDialog({ title: "导出大纲", choices: [{ label: "取消", value: null }, { label: "每卷一个文件", value: "each" }, { label: "合成一个文件", value: "one", primary: !0 }] });
      choice === "one" && downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), "text/yaml"), choice === "each" && project.outline.volumes.forEach((volume, i) => downloadBlob(`${String(i + 1).padStart(2, "0")}-${volume.key}.yaml`, volumeToText(volume), "text/yaml"));
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
      let draft = st(view).draft, i = Number(target.dataset.i), box = target.closest(".pi-vitem")?.querySelector("[data-draft-yaml]"), text2 = box ? box.value : draft.items[i].yaml, reply2 = await runTask(view, "outline", () => ask(view, "outline", fixYamlMessages(text2, draft.items[i].error)));
      reply2 && setMultiItem(view, i, parseOutlineReply(reply2, void 0, { all: !0 }));
    },
    async "multi-menu"(view, target) {
      let draft = st(view).draft, i = Number(target.dataset.i), item = draft && draft.items[i];
      if (!item) return;
      let busy = view.busy.outline, pick = await menuDialog({ title: `第 ${draft.volumeNo + i} 卷`, items: [
        ...item.ok ? [{ label: "YAML 原文", value: "multi-yaml" }] : [],
        { label: "重写这一卷", value: "multi-redo", disabled: busy },
        ...item.ok ? [] : [{ label: "修正格式", value: "multi-fix", disabled: busy }, { label: "重新解析", value: "multi-reparse" }]
      ] });
      pick && await actions[pick](view, target);
    },
    async "multi-yaml"(view, target) {
      let item = st(view).draft.items[Number(target.dataset.i)];
      await openDialog({ title: "YAML 原文", html: `<pre class="pi-pre">${esc(item.yaml)}</pre>`, actions: [{ label: "关闭", value: !0, primary: !0 }] });
    },
    async "multi-drop"(view) {
      await confirmDialog({ title: "丢弃草稿", body: "已写好的卷不会保存。", okLabel: "丢弃", danger: !0 }) && (st(view).draft = null, view.renderBody());
    },
    "multi-reparse"(view, target) {
      let i = Number(target.dataset.i), yaml = target.closest(".pi-vitem").querySelector("[data-draft-yaml]").value;
      setMultiItem(view, i, parseOutlineReply(`\`\`\`yaml
${yaml}
\`\`\``));
    },
    async "multi-redo"(view, target) {
      let draft = st(view).draft, i = Number(target.dataset.i), project = view.project(), { talk, wb } = await genRefTexts(view, 12e3), before = draft.items.filter((item, index) => index !== i && item.ok).flatMap((item) => item.volumes), reply2 = await runTask(view, "outline", () => ask(view, "outline", volumeRequest({
        project,
        talk,
        wb,
        extra: before,
        no: draft.volumeNo + i,
        k: i + 1,
        n: draft.n,
        request: draft.request
      })));
      reply2 && setMultiItem(view, i, parseOutlineReply(reply2, void 0, { all: !0 }));
    },
    "multi-append"(view) {
      let draft = st(view).draft;
      if (!draft || draft.items.some((item) => !item.ok)) return;
      let volumes = draft.items.flatMap((item) => item.volumes);
      addVolumes(view, volumes, "AI 追加多卷"), st(view).draft = null, view.renderBody();
    },
    async "draft-fix"(view, target) {
      let draft = st(view).draft, box = target.closest(".pi-card").querySelector("[data-draft-yaml]"), text2 = box ? box.value : draft.yaml, reply2 = await runTask(view, "outline", () => ask(view, "outline", fixYamlMessages(text2, draft.error)));
      reply2 && setDraft(view, draft.mode, reply2, { fromUnitId: draft.fromUnitId, reason: draft.reason, stageId: draft.stageId, nextId: draft.nextId });
    },
    "draft-reparse"(view, target) {
      let draft = st(view).draft, yaml = target.closest(".pi-card").querySelector("[data-draft-yaml]").value;
      setDraft(view, draft.mode, `\`\`\`yaml
${yaml}
\`\`\``, { fromUnitId: draft.fromUnitId, reason: draft.reason, stageId: draft.stageId, nextId: draft.nextId });
    },
    "draft-drop"(view) {
      st(view).draft = null, view.renderBody();
    },
    "draft-new"(view) {
      addVolumes(view, st(view).draft.volumes, "AI 新建卷"), st(view).draft = null, view.renderBody();
    },
    async "draft-replace"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要替换的卷");
      if (!await confirmDialog({ title: `替换「${volumeLabel(volume.key)}」`, body: "该卷原有阶段全部换成 AI 写的内容。", okLabel: "替换", danger: !0 })) return;
      let incoming = st(view).draft.volumes;
      update2(view, (volumes) => volumes.flatMap((item) => item.id === volume.id ? incoming : [item]), "AI 替换整卷"), st(view).draft = null, st(view).sel = incoming[0].id, view.runtime.refresh(), view.renderBody();
    },
    "draft-append"(view) {
      let { volume } = findSel(view.project(), st(view).sel);
      if (!volume) throw new Error("先在左边选中要追加到的卷");
      let stages = st(view).draft.volumes.flatMap((item) => item.stages);
      updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, ...stages] }), "AI 追加阶段"), st(view).draft = null, view.runtime.refresh(), view.renderBody();
    },
    async "draft-rest"(view) {
      if (!await confirmDialog({ title: "替换剩余阶段", body: "当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。", okLabel: "替换", danger: !0 })) return;
      let draft = st(view).draft, from = applyRest(view, draft);
      st(view).draft = null, view.renderBody();
      let titles = await runTask(view, "outline", () => view.runtime.syncSetting(view.projectId, { from, reason: draft.reason }));
      titles && titles.length && toast("success", `设定已按新大纲修改：${titles.join("、")}。可在设定页的历史版本里回退。`);
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
      let incoming = draft.volumes.flatMap((item) => item.stages);
      if (!incoming.length) throw new Error("结果里没有阶段。");
      let ids = [draft.stageId, ...draft.nextId ? [draft.nextId] : []], old = volume.stages.filter((stage) => ids.includes(stage.id)), { volumes, stages, keepId } = replaceStages(project.outline.volumes, volume.id, ids, incoming), progress = liveProgress(view);
      if (update2(view, () => volumes, STAGE_DRAFT[draft.mode], { alias: ids.filter((id) => id !== keepId).map((id) => [id, keepId]) }), progress) {
        let moved = migrateStageThreads(progress, old, stages, keepId);
        view.runtime.setProgress(ids.includes(progress.current) ? goTo(moved, flattenUnits(volumes), keepId) : moved);
      }
      st(view).draft = null, st(view).sel = keepId, view.runtime.refresh(), view.renderBody();
    }
  };
  async function stageOp(view, op) {
    let project = view.project(), unit = flattenUnits(project.outline.volumes).find((item) => item.id === st(view).sel);
    if (!unit) return;
    let next = op === "merge" ? unit.volume.stages[unit.stageIndex + 1] : null;
    if (op === "merge" && !next) throw new Error("本卷没有下一段可合并。");
    let { talk, wb } = await genRefTexts(view, 12e3), reply2 = await runTask(view, "outline", () => ask(view, "outline", stageOpMessages({
      setting: project.setting.text,
      talk,
      refs: wb,
      volumes: project.outline.volumes,
      unit,
      next,
      op
    })));
    reply2 && setDraft(view, `stage-${op}`, reply2, { stageId: unit.stage.id, nextId: next ? next.id : "" });
  }
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
        let field2 = target.dataset.stageField;
        updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field2]: target.value } }));
        return;
      }
      if (target.dataset.stageList) {
        let field2 = target.dataset.stageList, lines2 = target.value.split(`
`).map((line) => line.trim()).filter(Boolean);
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
    from && from !== node.name && view.data.updateProject(view.projectId, (project) => ({ ...project, outline: withRenames(project.outline, [{ stageId: stage.id, field: field2, from, to: node.name }]) }));
    let progress = liveProgress(view);
    if (!progress) return;
    let next = renameNode(progress, { id: stage.id }, node);
    next !== progress && view.runtime.setProgress(next);
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
  function historyHtml2(project, at) {
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
        <textarea class="pi-ta is-tall" data-setting placeholder="世界观正文。执行时作为常驻条目注入（角色定义后），取代世界书里手改的剧情设定条目。">${esc(text2)}</textarea>
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
    // 对照当前及之后的大纲找出冲突或写死的句子，结果进新稿对比，只勾选有改动的分块。
    async "sync-outline"(view) {
      let project = view.project(), units = flattenUnits(project.outline.volumes), from = view.runtime.activeId() === view.projectId ? Math.max(0, currentIndex(units, view.runtime.progress())) : 0, reply2 = await runTask(view, "setting", () => ask(view, "outline", syncSettingMessages({ guide: guideText(view), setting: project.setting.text, units, fromUnitIndex: from })));
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
      event.target.closest("input") || (st2(view).openBlock = st2(view).openBlock === target.dataset.key ? "" : target.dataset.key, view.renderBody());
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
      commit(view, mergeBlocks(view.project().setting.text, draft.body, draft.keys), { check: draft.check, ...draft.sync ? {} : { fixes: draft.fixes } }), st2(view).draft = null, view.renderBody();
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
      let text2 = view.project().setting.text, blocks = splitBlocks(text2), block = blocks.find((item) => item.key === target.dataset.key);
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
    let busy = view.busy[`discuss:${view.projectId}`], refs = chat.refs, folded = chat.messages.filter((msg) => msg.folded).length, live = chat.messages.filter((msg) => !msg.folded), lastAi = [...live].reverse().find((msg) => msg.role !== "user"), unanswered = live.length && live[live.length - 1].role === "user" ? live[live.length - 1] : null, wb = wbSummary(view, chat.refs, () => view.renderBody()), canProgress = !!progressText(view), persona = view.data.settings().persona.trim(), chips = `<div class="pi-refs"><button type="button" class="pi-chip${persona ? " is-on" : ""}" data-act="persona" title="${esc(persona || "指定 AI 讨论时的说话人格")}">人格${persona ? "" : "：未设置"}</button>
        <span class="pi-hint">附带参考：</span>
        <button type="button" class="pi-chip${refs.setting ? " is-on" : ""}" data-act="ref" data-ref="setting">设定</button>
        <button type="button" class="pi-chip${refs.outline ? " is-on" : ""}" data-act="ref" data-ref="outline">大纲</button>
        <button type="button" class="pi-chip${refs.progress && canProgress ? " is-on" : ""}" data-act="ref" data-ref="progress"${canProgress ? "" : ' disabled title="本项目不是当前聊天启用的项目"'}>剧情进度</button>
        <button type="button" class="pi-chip${refs.floors ? " is-on" : ""}" data-act="ref-floors">正文 ${refs.floors} 楼</button>
        <button type="button" class="pi-chip${wb && wb.count ? " is-on" : ""}" data-act="ref-wb">世界书 ${wb ? `${wb.count} 条` : "…"}</button></div>`, messages = live.map((msg) => {
      let isUser = msg.role === "user", tools = `<div class="pi-msg-tools">
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-edit" data-id="${esc(msg.id)}">编辑</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-del" data-id="${esc(msg.id)}">删除</button>
            ${msg === lastAi && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="regen">重新生成</button>' : ""}
            ${msg === unanswered && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="resend">重新发送</button>' : ""}
            ${isUser ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="to-setting">整理成设定</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="to-outline">据此写大纲</button>
            ${hasYamlBlock(msg.content) ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="use-yaml" data-id="${esc(msg.id)}">把 YAML 送到大纲</button>` : ""}`}</div>`;
      return `<div class="pi-msg ${isUser ? "is-user" : "is-ai"}"><div class="pi-md">${renderMarkdown(msg.content)}</div>${tools}</div>`;
    }).join(""), empty = chat.messages.length ? "" : '<div class="pi-empty">说说这条 if 线的想法：原作、角色、类型、基调，一句话也行。<br>AI 会帮你把设定想清楚。</div>';
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
        chat = { ...view.data.chat(projectId), summary, messages: view.data.chat(projectId).messages.map((msg) => ids.has(msg.id) ? { ...msg, folded: !0 } : msg) }, view.data.saveChat(projectId, chat);
      }
      let system = discussSystemPrompt({ guide: guideText(view), refs: await resolveRefs(view, chat, project), persona: view.data.settings().persona }), text2 = await ask(view, "discuss", chatRequest(system, chat.summary, chat.messages), { signal });
      if (signal.aborted) return;
      let latest2 = view.data.chat(projectId);
      view.data.saveChat(projectId, { ...latest2, messages: [...latest2.messages, { id: makeId("m"), role: "assistant", content: text2, at: Date.now() }] });
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
        choices: [{ label: "取消", value: null }, { label: "直接清空", value: "clear", danger: !0 }, { label: "导出后清空", value: "export", primary: !0 }]
      });
      choice && (choice === "export" && downloadBlob(`${view.project().name}-讨论记录-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.md`, talkMarkdown(view, chat), "text/markdown"), view.data.saveChat(view.projectId, { ...chat, summary: "", messages: [] }), st3(view).draft = "", view.renderBody());
    },
    send(view, target) {
      let box = target.closest(".pi-body").querySelector("[data-compose]"), text2 = box.value.trim();
      if (text2)
        return updateChat(view, (chat) => ({ ...chat, messages: [...chat.messages, { id: makeId("m"), role: "user", content: text2, at: Date.now() }] })), st3(view).draft = "", box.value = "", view.renderBody(), reply(view);
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
      text2 != null && (updateChat(view, (chat) => ({ ...chat, messages: chat.messages.map((item) => item.id === msg.id ? { ...item, content: text2 } : item) })), view.renderBody());
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
    // 说话人格对所有项目的讨论生效，存在插件设置里；留空用默认口吻。
    async persona(view) {
      let value = await promptDialog({ title: "说话人格", label: "讨论时 AI 以什么身份、什么风格回复，留空为默认", value: view.data.settings().persona, multiline: !0, placeholder: "例：你是一位熟悉原作的资深编辑，说话直接，敢于否定不合理的设定。" });
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
  function parseEntry(content) {
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
    let parsed = entries.map((entry) => ({ entry, key: `${entry.book}\0${entry.key}`, tree: parseEntry(entry.content) })), blocked = /* @__PURE__ */ new Set(), issues = [], report = (entry, level, text2) => {
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
      let base = { group: line.group, name: line.name, keys: line.entry.keys, constant: line.entry.constant, position: line.entry.position, depth: line.entry.depth, role: line.entry.role, order: line.entry.order, common: line.common, source: { book: line.entry.book, uid: String(line.entry.uid), varPath: line.path }, sources: line.sources };
      if (line.kind === "num")
        out.push({ ...base, mode: "fame", fame: { bar: line.name, partner: "" }, stages: numericStages([...line.stages.values()]) });
      else {
        let stages = [...line.stages.values()].map((item) => ({ ...newStage(item.value), cond: stateLine(item.text), text: item.text }));
        out.push({ ...base, mode: "check", fame: { bar: "", partner: "" }, stages });
      }
    }
    for (let { entry, text: text2 } of plainLines)
      text2 && out.push({ group: "", name: entryName(entry.title), keys: entry.keys, constant: entry.constant, position: entry.position, depth: entry.depth, role: entry.role, order: entry.order, common: "", mode: "manual", fame: { bar: "", partner: "" }, stages: [{ ...newStage("默认"), text: text2 }], source: { book: entry.book, uid: String(entry.uid), varPath: "" }, sources: [{ book: entry.book, uid: String(entry.uid), key: String(entry.key) }] });
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
  var st4 = (view) => view.tabState("persona"), modeLabel = (value) => (PERSONA_MODES.find((item) => item.value === value) || PERSONA_MODES[0]).label, SOURCE_NOTE = { manual: "手动", check: "", outline: "", fame: "" };
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
    let project = view.project(), active = view.runtime.activeId() === view.projectId, progress = active ? view.runtime.progress() : emptyProgress(view.projectId);
    return currentStage(line, progress, personaEnv(project, progress, active ? view.runtime.fame() : []));
  }
  var keyText = (line) => line.keys.join("，"), splitKeys = (value) => String(value || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean), field = (label, body) => `<label class="pi-field"><span>${label}</span>${body}</label>`, input = (attrs, value, extra = "") => `<input class="pi-inp" ${attrs} value="${esc(value)}"${extra}>`;
  function stageHtml(view, line, stage, index, current, units) {
    let attrs = (name) => `data-pl="${esc(line.id)}" data-ps="${esc(stage.id)}" data-f="${name}"`, act = (name, icon, title2, disabled = !1) => `<button type="button" class="pi-icon-btn${name === "ps-del" ? " is-danger" : ""}" data-act="${name}" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" title="${title2}"${disabled ? " disabled" : ""}>${icon}</button>`, extra = line.mode === "check" ? field("进入条件", input(attrs("cond"), stage.cond, ' placeholder="如：主角出手帮了她，她开始动摇"')) : line.mode === "outline" ? field("跟随大纲阶段", `<select class="pi-sel" ${attrs("unitId")}>${options([{ value: "", label: "不绑定（跳过）" }, ...units.map((unit) => ({ value: unit.id, label: `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}` }))], stage.unitId)}</select>`) : line.mode === "fame" ? `<div class="pi-pair">${field("声望下限", input(`${attrs("min")} type="number"`, stage.range.min ?? ""))}${field("声望上限", input(`${attrs("max")} type="number"`, stage.range.max ?? ""))}</div>` : "";
    return `<div class="pi-node pi-ps">
        <div class="pi-node-hd">${index === current ? '<span class="pi-badge is-accent">当前</span>' : ""}${input(attrs("name"), stage.name)}
            ${act("ps-up", ICONS.arrowUp, "上移", index === 0)}${act("ps-down", ICONS.arrowDown, "下移", index === line.stages.length - 1)}${act("ps-del", ICONS.trash, "删除阶段", line.stages.length <= 1)}</div>
        ${extra}
        ${field(`人设内容 ≈${estimateTokens(stage.text)}`, `<textarea class="pi-ta" rows="6" ${attrs("text")}>${esc(stage.text)}</textarea>`)}</div>`;
  }
  function lineBody(view, line, units) {
    let attrs = (name) => `data-pl="${esc(line.id)}" data-f="${name}"`, atDepth = line.position === 4, info = stageInfo(view, line), fameBody = line.mode === "fame" ? `<datalist id="pi-fame-list">${view.runtime.fame().map((bar) => `<option value="${esc(bar.name)}"></option>`).join("")}</datalist>
        <div class="pi-pair">${field("声望条名称", input(`${attrs("fameBar")} list="pi-fame-list"`, line.fame.bar))}${field("对象（可空）", input(attrs("famePartner"), line.fame.partner))}</div>
        <p class="pi-hint">读不到声望值时沿用手动选择的阶段。</p>` : "";
    return `<div class="pi-entry-bd">
        <div class="pi-pair">${field("线名", input(attrs("name"), line.name))}${field("角色（分组）", input(attrs("group"), line.group))}</div>
        <label class="pi-field"><span>切换方式</span><select class="pi-sel" ${attrs("mode")}>${options(PERSONA_MODES, line.mode)}</select></label>
        ${fameBody}
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
    let info = stageInfo(view, line), note = info.source === "manual" && line.mode !== "manual" ? "手动" : SOURCE_NOTE[info.source] || "";
    return `<div class="pi-entry${line.enabled ? "" : " is-off"}">
        <div class="pi-entry-hd" data-act="pl-open" data-line="${esc(line.id)}">${open ? ICONS.caretDown : ICONS.caret}
            <span class="pi-etitle">${esc(line.name)}</span><span class="pi-badge">${esc(modeLabel(line.mode))}</span>
            <span class="pi-meta">${esc(info.stage ? info.stage.name : "")}${note ? ` · ${note}` : ""}</span>
            <input type="checkbox" title="启用" data-pl-on="${esc(line.id)}"${line.enabled ? " checked" : ""}></div>${open ? lineBody(view, line, units) : ""}</div>`;
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
        ${importedCard(all)}`;
  }
  var LINE_PATCH = {
    name: (value) => ({ name: value.trim() || "未命名" }),
    group: (value) => ({ group: value.trim() }),
    mode: (value) => ({ mode: value }),
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
  function rangePatch(stage, which, value) {
    let range = { ...stage.range };
    return String(value).trim() === "" || !Number.isFinite(Number(value)) ? delete range[which] : range[which] = Number(value), { range };
  }
  function onChange2(view, target) {
    let d = target.dataset;
    if (d.plOn)
      return patchLine(view, d.plOn, (line) => ({ ...line, enabled: target.checked })), view.renderBody();
    if (d.pl)
      return d.ps ? patchStage(view, d.pl, d.ps, (stage) => ({ ...stage, ...d.f === "min" || d.f === "max" ? rangePatch(stage, d.f, target.value) : (STAGE_PATCH[d.f] || (() => ({})))(target.value) })) : d.f === "fameBar" || d.f === "famePartner" ? patchLine(view, d.pl, (line) => ({ ...line, fame: { ...line.fame, [d.f === "fameBar" ? "bar" : "partner"]: target.value.trim() } })) : LINE_PATCH[d.f] && patchLine(view, d.pl, (line) => ({ ...line, ...LINE_PATCH[d.f](target.value) })), view.renderBody();
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
  var nodeRow = (unitId, node, off, from = "", mark = "") => `<div class="pi-node-row${off ? " is-off" : ""}"${from ? ` title="来自${esc(from)}"` : ""}>
        <span class="pi-node-name"><span class="pi-badge pi-kind is-${esc(node.kind)}">${esc(node.label)}</span> <span class="pi-node-txt">${esc(node.name)}</span></span>${mark || `<button type="button" class="pi-meta pi-meta-btn" data-act="node-toggle" data-node="${esc(node.id)}" data-unit="${esc(unitId)}">${off ? "已演" : "未演"}</button>`}</div>`;
  function hookRow(hook) {
    let chain = hook.steps.length && (hook.status === "active" || hook.status === "queue"), mark = hook.status === "done" ? "已演" : chain ? `第 ${hook.step + 1}/${hook.steps.length} 步${hook.status === "queue" ? " · 排队" : ""}` : { wait: "待触发", active: "已激活", queue: "排队" }[hook.status], markHtml = mark ? `<button type="button" class="pi-meta pi-meta-btn${hook.status === "active" ? " is-dot" : ""}" data-act="hook-menu" data-key="${esc(hook.key)}">${esc(mark)}</button>` : "";
    return nodeRow(hook.unit.id, hook.node, hook.status === "done", hook.carried ? stageLabel(hook.unit.stage.key) : "", markHtml || "<span></span>");
  }
  function expiredRows(hooks, open) {
    if (!hooks.length) return "";
    let rows2 = open ? hooks.map((hook) => `<div class="pi-hook is-quiet"><span class="pi-node-row is-quiet"><span class="pi-node-name">${esc(hook.node.name)}</span></span>
        <button type="button" class="pi-meta pi-meta-btn" data-act="hook-menu" data-key="${esc(hook.key)}">已过期</button></div>`).join("") : "";
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
    return !nodes.length && !carried.length && !live.hooks.length && !live.clocks.length && !closed.length ? "" : `<div class="pi-tl-nodes">${nodes.map((node) => nodeRow(unit.id, node, off.has(node.id))).join("")}${own.map(hookRow).join("")}
        ${carried.length || later.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map((item) => nodeRow(item.unit.id, item.node, item.off, stageLabel(item.unit.stage.key))).join("")}${later.map(hookRow).join("")}` : ""}
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
    return groups.map((group) => `<div class="pi-tl-vol">${esc(volumeLabel(group.volume.key))}</div><div class="pi-tl">${group.units.map(item).join("")}</div>`).join("");
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
    let all = project.personas, env = personaEnv(project, progress, view.runtime.fame()), muted = new Set(progress.personas && progress.personas.muted || []), collapsed = new Set(st9.personaFold || []), line = (item) => {
      let info = currentStage(item, progress, env), note = [info.source === "manual" && item.mode !== "manual" ? "手动" : "", info.lost ? "读不到声望" : "", muted.has(item.id) ? "不提醒" : ""].filter(Boolean).join(" · "), caps = item.stages.map((stage, index) => `<button type="button" class="pi-chip${index === info.index ? " is-on" : ""}" data-act="persona-pick" data-line="${esc(item.id)}" data-stage="${esc(stage.id)}">${esc(stage.name)}</button>`).join("");
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
    let progress = runtime.progress(), entries = runtime.entries(), sw = threadSwitches(project), units = maskUnits(flattenUnits(project.outline.volumes), sw), states = unitStates(units, progress), total = entries.filter((entry) => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0), settings = data.settings(), checking = runtime.isChecking(), book = runtime.injectMode() === "virtual" ? "" : '<span class="pi-badge is-warn">专用世界书</span>', gap = settings.checkEvery - (runtime.floorCount() - checkBase(progress));
    return `<div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
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
      let pick = await menuDialog({ title: hook.carried ? `${hook.node.name}（来自${stageLabel(hook.unit.stage.key)}）` : hook.node.name, items });
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
      let entries = view.runtime.entries().filter((entry) => entry.enabled), html = entries.length ? POSITIONS.map((pos) => {
        let list = entries.filter((entry) => entry.position === pos.value).sort((a, b) => a.order - b.order);
        return list.length ? list.map((entry) => `<p class="pi-hint">${esc(positionLabel(entry))} · ${esc(entry.title)} · 顺序 ${entry.order}</p><pre class="pi-pre">${esc(entry.content)}</pre>`).join("") : "";
      }).join("") : '<p class="pi-hint">没有启用的条目。</p>';
      return openDialog({ title: "最终注入预览", html: `${html}`, actions: [{ label: "关闭", value: !0, primary: !0 }] });
    }
  };
  function onChange3(view, target) {
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
    let open = st6(view).guideOpen, status = s.guide ? "自定义版本" : "内置版本";
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? "收起" : "编辑"}</button></h3>
        <p class="pi-hint">当前使用：${status}</p>
        ${open ? `<div class="pi-row pi-acts-top"><button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? "" : " disabled"}>恢复内置版本</button></div>
        <textarea class="pi-ta is-mono is-tall" data-guide>${esc(s.guide || BUILTIN_GUIDE)}</textarea>` : ""}</div>`;
  }
  function paceRow(view, s) {
    let open = st6(view).paceOpen, changed = PACES.filter((item) => s.paceText[item.value]).map((item) => item.label), current = view.runtime.activeId() ? view.runtime.progress().pace : "", pace = PACES.some((item) => item.value === st6(view).pace) ? st6(view).pace : current || "normal", pick = PACES.map((item) => ({ value: item.value, label: `${item.label}${item.value === current ? "（当前聊天使用）" : ""}${s.paceText[item.value] ? "·已改" : ""}` }));
    return `<div class="pi-set-row"><span>推进速度说明</span>${changed.length ? `<span class="pi-badge">已修改 ${changed.join("、")}</span>` : ""}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="pace-toggle">${open ? "收起" : "编辑"}</button></div>
        ${open ? `<div class="pi-set-sub"><label class="pi-field"><span>编辑哪一档的说明</span><select class="pi-sel" data-pace-pick>${options(pick, pace)}</select></label>
        <textarea class="pi-ta" rows="3" data-pace-text="${pace}">${esc(paceText(s, pace))}</textarea>
        <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-sm" data-act="pace-reset" data-pace="${pace}"${s.paceText[pace] ? "" : " disabled"}>恢复默认</button></div></div>` : ""}`;
  }
  function render8(view) {
    let s = view.data.settings(), modes = [{ value: "ask", label: "弹出确认" }, { value: "auto", label: "自动推进（可撤销）" }, { value: "nodes", label: "仅勾选节点，不推进阶段" }], offModes = [{ value: "ask", label: "弹出提醒" }, { value: "auto", label: "自动改写后续阶段（可撤销）" }, { value: "off", label: "不检查偏离" }], personaModes = [{ value: "ask", label: "弹出确认" }, { value: "auto", label: "自动推进（可撤销）" }, { value: "off", label: "不检测" }], threadModes = [{ value: "ask", label: "弹出确认" }, { value: "auto", label: "自动收录为支线" }, { value: "off", label: "不识别" }];
    return `<div class="pi-card"><h3>注入内容</h3>
        <label class="pi-field"><span>详细条目的标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label></div>
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
        ${guideCard(view, s)}`;
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
    if (target.dataset.guide !== void 0) {
      let text2 = target.value;
      view.data.updateSettings({ guide: text2.trim() === BUILTIN_GUIDE.trim() ? "" : text2 });
      return;
    }
    target.dataset.set && target.type !== "checkbox" && target.tagName !== "SELECT" && view.data.updateSettings({ [target.dataset.set]: readValue(target) }), target.dataset.llm && target.tagName === "INPUT" && setRole(view, target.dataset.llm, { [target.dataset.k]: target.value.trim() });
  }
  function onChange5(view, target) {
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
          await confirmDialog({ title: `删除预设「${preset.name}」`, body: "已载入这个预设的用途不受影响。", okLabel: "删除", danger: !0 }) && view.data.updateSettings({ presets: presets.filter((item) => item.id !== id) });
          continue;
        }
        return setRole(view, role, { source: "custom", ...Object.fromEntries(CONN_KEYS2.map((key) => [key, preset[key]])) }), st6(view).manual = { ...st6(view).manual, [role]: !1 }, toast("success", `已为「${LLM_ROLES.find((item) => item.key === role).label}」载入预设「${preset.name}」。`), view.renderBody();
      }
    },
    "pace-toggle"(view) {
      st6(view).paceOpen = !st6(view).paceOpen, view.renderBody();
    },
    "pace-reset"(view, target) {
      view.data.updateSettings({ paceText: { ...view.data.settings().paceText, [target.dataset.pace]: "" } }), view.runtime.refresh(), view.renderBody();
    },
    "guide-toggle"(view) {
      st6(view).guideOpen = !st6(view).guideOpen, view.renderBody();
    },
    "guide-reset"(view) {
      view.data.updateSettings({ guide: "" }), view.renderBody();
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
    for (let item of index.projects)
      names2.add(projectFile(item.id)), names2.add(chatFile(item.id));
    return names2;
  }
  function fileCell(view, name, bytes) {
    let verified = st7(view).verified, missing = verified && verified[name] === !1;
    return !view.data.index().files.includes(name) && !bytes ? '<td class="pi-hint">—</td>' : `<td class="${missing ? "is-missing" : ""}">${missing ? "已丢失" : formatBytes(bytes)}
        ${missing ? "" : `<button type="button" class="pi-btn is-sm is-ghost" data-act="export-file" data-name="${esc(name)}">导出</button>`}
        <button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="delete-file" data-name="${esc(name)}">删除</button></td>`;
  }
  function filesTable(view) {
    return `<table class="pi-files"><thead><tr><th>项目</th><th>设定+大纲</th><th>讨论记录</th></tr></thead><tbody>${view.data.index().projects.map((item) => `<tr><td>${esc(item.group ? `${item.group}／` : "")}${esc(item.name)}</td>
        ${fileCell(view, projectFile(item.id), item.bytes.project)}${fileCell(view, chatFile(item.id), item.bytes.chat)}</tr>`).join("") || '<tr><td colspan="3" class="pi-hint">没有项目</td></tr>'}</tbody></table>`;
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
      let text2 = await readRawFile(target.dataset.name);
      if (text2 == null) throw new Error("文件读取失败");
      downloadBlob(target.dataset.name, text2);
    },
    async "delete-file"(view, target) {
      let name = target.dataset.name;
      if (!await confirmDialog({ title: "删除文件", list: [name], body: name.startsWith("pi-p-") ? "这是项目的设定和大纲，删除后项目无法打开。" : "", okLabel: "删除", danger: !0 })) return;
      let id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
      name.startsWith("pi-c-") ? await view.data.clearChat(id) : name.startsWith("pi-p-") && await view.data.deleteProject(id), st7(view).verified = null, view.render();
    },
    async orphans(view) {
      let names2 = Object.keys(st7(view).verified || {}).filter((name) => !referenced(view.data.index()).has(name) && st7(view).verified[name]), gone = Object.keys(st7(view).verified || {}).filter((name) => !referenced(view.data.index()).has(name) && !st7(view).verified[name]);
      if (!names2.length && gone.length)
        return view.data.forgetFiles(gone), st7(view).verified = null, view.renderBody();
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
      let index = view.data.index(), names2 = [.../* @__PURE__ */ new Set([...index.files, ...referenced(index)])], files = [];
      for (let name of names2) {
        let text2 = await readRawFile(name);
        text2 != null && files.push({ name, data: text2 });
      }
      if (!files.length) throw new Error("没有可清除的文件");
      if (downloadBlob(`剧情注入器备份-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`, buildZip(files), "application/zip"), !!await confirmDialog({ title: "重置插件", body: "备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。", list: files.map((file) => file.name), okLabel: "全部删除", danger: !0 })) {
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
  var splitKeys2 = (text2) => String(text2 || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
  function editPatch(target) {
    let field2 = target.dataset.f, value = target.value;
    if (field2 === "constant") return { constant: value === "1" };
    if (field2 === "key" || field2 === "keysecondary") return { [field2]: splitKeys2(value) };
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
    let state = info.checking ? "检测中" : info.pending ? "等待主回复生成结束" : info.generating ? "主回复生成中" : "空闲", llm = info.llm.source === "custom" ? `独立接口 ${info.llm.model || "（未选模型）"}` : "酒馆当前接口";
    return [
      ["版本", `v${info.version}`],
      ["角色卡", info.card || "—"],
      ["聊天", info.chatId || "—"],
      ["启用项目", info.name || "—"],
      ["当前楼数", String(info.floors)],
      ["上次检测楼层", info.progress ? String(info.progress.lastCheckFloor) : "—"],
      ...info.progress && info.progress.lastFailFloor ? [["上次检测失败楼层", String(info.progress.lastFailFloor)]] : [],
      ["检测间隔", `每 ${info.settings.checkEvery} 楼`],
      ["下次检测", nextText(info)],
      ["检测接口", llm],
      ["状态", state]
    ];
  }
  function plainText(info) {
    let lines2 = ["【剧情注入器诊断】", ...rows(info).map(([k, v]) => `${k}：${v}`), "", "【事件】"];
    for (let item of info.events) lines2.push(`${item.key}（${item.name || "酒馆未提供"}）：${item.bound ? `已绑定，收到 ${item.count} 次，最近 ${time(item.at)}` : "未绑定"}`);
    let list = problems(info);
    return lines2.push("", "【问题】", ...list.length ? list.map((item) => `- ${item.text}`) : ["无"]), lines2.push("", "【最近记录】", ...info.logs.length ? info.logs.map((item) => `${time(item.at)} ${item.text}`) : ["无"]), lines2.join(`
`);
  }
  function render11(view) {
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
      let project = view.project(), title2 = view.page ? PAGES[view.page].label : project ? project.name : "剧情注入器", tabs = view.page || !project ? "" : `<div class="pi-tabs">${TABS.map(tabOf).map((tab) => `<button type="button" class="pi-tab${tab.key === view.tab ? " is-sel" : ""}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`).join("")}</div>`, rename = !view.page && project ? `<button type="button" class="pi-icon-btn" data-act="rename" title="编辑项目名称">${ICONS.pencil}</button>` : "";
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
      let body = root.querySelector(".pi-body"), keepScroll = body.scrollTop, chat = body.querySelector(".pi-chat"), chatScroll = chat ? chat.scrollTop : null, chatAtEnd = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30 : !0, focused = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement : null, compose = focused && focused.matches("[data-compose],[data-setting],[data-search]") ? { sel: ["[data-compose]", "[data-setting]"].find((sel) => focused.matches(sel)) || `[data-search="${focused.dataset.search}"]`, start: focused.selectionStart, end: focused.selectionEnd } : null;
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
    function go(tab) {
      view.page = "", view.tab = tab, writeUi({ tab, page: "" }), render12();
    }
    let NEW_GROUP = "::new";
    function groupField(preset) {
      let groups = [...new Set(data.index().projects.map((item) => item.group).filter(Boolean))], list = [{ value: "", label: "不分组" }, ...groups.map((name) => ({ value: name, label: name })), { value: NEW_GROUP, label: "新建分组" }];
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
          { label: "确定", primary: !0, value: (box) => ({ name: box.querySelector("[data-f=name]").value, group: readGroupField(box), mode: box.querySelector("[data-f=infinite]").checked ? "infinite" : "normal" }) }
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
          await runtime.switchProject(id, pick), toast("success", pick === "card" ? `「${meta2.name}」已设为本卡默认，当前聊天也已换用。` : `当前聊天改用「${meta2.name}」。`), render12();
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
          { label: "保存", primary: !0, value: (box) => ({ name: box.querySelector("[data-f=name]").value.trim(), group: readGroupField(box), mode: box.querySelector("[data-f=infinite]").checked ? "infinite" : "normal" }) }
        ]
      });
      if (result) {
        if (result === "delete") {
          if (!await confirmDialog({ title: `删除「${meta2.name}」`, body: "将删除以下文件，聊天里记录的该项目进度保留。", list: [`pi-p-${id}.json`, `pi-c-${id}.json`], okLabel: "删除", danger: !0 })) return;
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
      if (act === "project") return selectProject(target.dataset.id);
      if (act === "new-project") return newProject2();
      if (act === "tab") return go(target.dataset.tab);
      if (act === "page")
        return view.page = target.dataset.page, writeUi({ page: view.page }), setDrawer(!1), render12();
      if (act === "drawer") return setDrawer(!view.drawer);
      if (act === "theme")
        return setNight(!isNight()), writeUi({ night: isNight() }), renderSide();
      if (act === "rename") return editProject(view.projectId);
      if (act === "retry-project") return selectProject(view.projectId, view.tab);
      if (act === "retry-render") return render12();
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
    function onChange8(event) {
      let target = event.target;
      if (target.dataset.psearch !== void 0) return;
      let handler = current().onChange;
      handler && Promise.resolve(handler(view, target, event)).catch((error) => toast("error", error.message || String(error)));
    }
    function onInput6(event) {
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
            <section class="pi-main"><header class="pi-top"></header><div class="pi-body"></div></section></div></div>`), root.addEventListener("click", onClick), root.addEventListener("contextmenu", onContext), root.addEventListener("pointerdown", onPointerDown), root.addEventListener("pointermove", onPointerMove), root.addEventListener("pointerup", cancelPress), root.addEventListener("pointercancel", cancelPress), root.addEventListener("scroll", cancelPress, !0), root.addEventListener("change", onChange8), root.addEventListener("input", onInput6), root.addEventListener("compositionend", (event) => {
        event.target.dataset.search && onInput6(event);
      }), root.addEventListener("focusout", (event) => current().onBlur?.(view, event.target, event)), root.addEventListener("mousedown", (event) => {
        event.target === root && (root.dataset.down = "1");
      }), root.addEventListener("mouseup", (event) => {
        event.target === root && root.dataset.down && close(), delete root.dataset.down;
      }), doc.addEventListener("keydown", onKey, !0), doc.body.appendChild(root), view.restored = !1, data.isReady() ? restore() : render12());
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
      }), container().appendChild(card), timeout && timers.set(id, view.setTimeout(() => hide(id), timeout));
    }
    function destroy() {
      for (let timer of timers.values()) view.clearTimeout(timer);
      timers.clear(), box?.remove(), box = null;
    }
    return { show, hide, destroy };
  }

  // src/index.js
  var VERSION = "0.1.28", KEY2 = "__plotInjector", BUTTON = "剧情注入";
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
