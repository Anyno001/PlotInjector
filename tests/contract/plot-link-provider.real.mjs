// ../shujuku/src/shared/table-defaults/global-state.js
var globalStateSheet = {
  uid: "sheet_dCudvUnH",
  name: "\u5168\u5C40\u6570\u636E\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u5F53\u524D\u4E3B\u89D2\u6240\u5728\u5730\u70B9\u53CA\u65F6\u95F4\u76F8\u5173\u53C2\u6570\u3002\u6B64\u8868\u6709\u4E14\u4EC5\u6709\u4E00\u884C\u3002\n- \u52171: \u4E3B\u89D2\u5F53\u524D\u6240\u5728\u5730\u70B9 - \u4E3B\u89D2\u5F53\u524D\u6240\u5728\u7684\u5177\u4F53\u573A\u666F\u540D\u79F0\u3002\n- \u52172: \u5F53\u524D\u65F6\u95F4 - \u6E38\u620F\u4E16\u754C\u7684\u5F53\u524D\u65F6\u95F4\u3002\u683C\u5F0F\uFF1A\u201CYYYY-MM-DD HH:MM\u201D\uFF0C\u521D\u59CB\u5316\u65F6\u5982\u679C\u5267\u60C5\u6CA1\u6709\u660E\u786E\u5177\u4F53\u7684\u65E5\u671F\u548C\u65F6\u95F4\uFF0C\u5219\u5FC5\u987B\u6839\u636E\u4E16\u754C\u89C2\u548C\u8BBE\u5B9A\u81EA\u884C\u8BBE\u5B9A\u4E00\u4E2A\u660E\u786E\u7684\u65E5\u671F\u65F6\u95F4\u3002\n- \u52173: \u4E0A\u8F6E\u573A\u666F\u65F6\u95F4 - \u4E0A\u4E00\u8F6E\u4EA4\u4E92\u7ED3\u675F\u65F6\u7684\u65F6\u95F4\u3002\n- \u52174: \u7ECF\u8FC7\u7684\u65F6\u95F4 - \u6839\u636E\u5F53\u524D\u4E0E\u4E0A\u8F6E\u65F6\u95F4\u8BA1\u7B97\u5F97\u51FA\u7684\u6587\u672C\u63CF\u8FF0\uFF08\u5982\uFF1A\u201C\u51E0\u5206\u949F\u201D\uFF09\u3002",
    initNode: "\u63D2\u5165\u4E00\u6761\u5173\u4E8E\u5F53\u524D\u4E16\u754C\u72B6\u6001\u7684\u8BB0\u5F55\u3002",
    deleteNode: "\u7981\u6B62\u5220\u9664\u3002",
    updateNode: "\u5F53\u4E3B\u89D2\u4ECE\u5F53\u524D\u6240\u5728\u533A\u57DF\u79BB\u5F00\u65F6\uFF0C\u66F4\u65B0\u6240\u5728\u5730\u70B9\u3002\u6BCF\u8F6E\u5FC5\u987B\u66F4\u65B0\u65F6\u95F4\u3002\nSQL\u793A\u4F8B: UPDATE global_state SET current_location = '\u65B0\u5730\u70B9', prev_scene_time = cur_time, cur_time = '2024-03-15 16:00', elapsed_time = '\u7EA61\u5C0F\u65F6' WHERE row_id = 1;",
    insertNode: "\u7981\u6B62\u64CD\u4F5C\u3002",
    ddl: `CREATE TABLE global_state ( -- \u5168\u5C40\u6570\u636E\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  current_location TEXT NOT NULL, -- \u4E3B\u89D2\u5F53\u524D\u6240\u5728\u5730\u70B9
  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??'), -- \u5F53\u524D\u65F6\u95F4
  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- \u4E0A\u8F6E\u573A\u666F\u65F6\u95F4
  elapsed_time TEXT -- \u7ECF\u8FC7\u7684\u65F6\u95F4
);`
  },
  content: [
    [
      "row_id",
      "\u4E3B\u89D2\u5F53\u524D\u6240\u5728\u5730\u70B9",
      "\u5F53\u524D\u65F6\u95F4",
      "\u4E0A\u8F6E\u573A\u666F\u65F6\u95F4",
      "\u7ECF\u8FC7\u7684\u65F6\u95F4"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u5168\u5C40\u6570\u636E\u8868",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u5168\u5C40\u6570\u636E\u8868-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "before_char",
      depth: 2,
      order: 99981
    },
    fixedIndexPlacement: {
      position: "before_char",
      depth: 2,
      order: 99980
    }
  },
  orderNo: 0
};

// ../shujuku/src/shared/table-defaults/protagonist-info.js
var protagonistInfoSheet = {
  uid: "sheet_DpKcVGqg",
  name: "\u4E3B\u89D2\u4FE1\u606F\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u4E3B\u89D2\u7684\u6838\u5FC3\u8EAB\u4EFD\u4FE1\u606F\u3002\u6B64\u8868\u6709\u4E14\u4EC5\u6709\u4E00\u884C\u3002\n- \u52171: \u4EBA\u7269\u540D\u79F0 - \u4E3B\u89D2\u7684\u540D\u5B57\u3002\n- \u52172: \u6027\u522B/\u5E74\u9F84 - \u4E3B\u89D2\u7684\u751F\u7406\u6027\u522B\u548C\u5E74\u9F84\u3002\n- \u52173: \u5916\u8C8C\u7279\u5F81 - \u5BF9\u4E3B\u89D2\u5916\u8C8C\u7684\u5BA2\u89C2\u6587\u5B57\u63CF\u5199\u3002\n- \u52174: \u804C\u4E1A/\u8EAB\u4EFD - \u4E3B\u89D2\u5728\u793E\u4F1A\u4E2D\u7684\u4E3B\u8981\u89D2\u8272\u3002\n- \u52175: \u8FC7\u5F80\u7ECF\u5386 - \u8BB0\u5F55\u4E3B\u89D2\u7684\u80CC\u666F\u6545\u4E8B\u548C\u540E\u7EED\u7684\u5173\u952E\u7ECF\u5386\uFF0C\u968F\u5267\u60C5\u589E\u91CF\u66F4\u65B0\uFF0C\u4E0D\u8D85\u8FC7300\u5B57\uFF0C\u8D85\u8FC7\u65F6\u9700\u538B\u7F29\u3002\n- \u52176: \u6027\u683C\u7279\u70B9 - \u5BF9\u4E3B\u89D2\u6838\u5FC3\u6027\u683C\u7684\u6982\u62EC\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\uFF0C\u63D2\u5165\u4E3B\u89D2\u7684\u552F\u4E00\u6761\u76EE\u3002",
    deleteNode: "\u7981\u6B62\u5220\u9664\u3002",
    updateNode: "'\u8FC7\u5F80\u7ECF\u5386'\u5217\u4F1A\u6839\u636E\u5267\u60C5\u53D1\u5C55\u6301\u7EED\u589E\u91CF\u66F4\u65B0\uFF0C\u5F53\u4E3B\u89D2\u5404\u9879\u72B6\u6001\u53D1\u751F\u6539\u53D8\u65F6\u66F4\u65B0\u3002\nSQL\u793A\u4F8B: UPDATE protagonist_info SET past_experience = '\u66F4\u65B0\u540E\u7684\u7ECF\u5386\u5185\u5BB9', occupation = '\u65B0\u804C\u4E1A' WHERE row_id = 1;",
    insertNode: "\u7981\u6B62\u64CD\u4F5C\u3002",
    ddl: `CREATE TABLE protagonist_info ( -- \u4E3B\u89D2\u4FE1\u606F\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  char_name TEXT NOT NULL, -- \u4EBA\u7269\u540D\u79F0
  gender_age TEXT, -- \u6027\u522B/\u5E74\u9F84
  appearance TEXT, -- \u5916\u8C8C\u7279\u5F81
  occupation TEXT, -- \u804C\u4E1A/\u8EAB\u4EFD
  past_experience TEXT, -- \u8FC7\u5F80\u7ECF\u5386
  personality TEXT -- \u6027\u683C\u7279\u70B9
);`
  },
  content: [
    [
      "row_id",
      "\u4EBA\u7269\u540D\u79F0",
      "\u6027\u522B/\u5E74\u9F84",
      "\u5916\u8C8C\u7279\u5F81",
      "\u804C\u4E1A/\u8EAB\u4EFD",
      "\u8FC7\u5F80\u7ECF\u5386",
      "\u6027\u683C\u7279\u70B9"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u4E3B\u89D2\u4FE1\u606F",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u4E3B\u89D2\u4FE1\u606F-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    }
  },
  orderNo: 1
};

// ../shujuku/src/shared/table-defaults/important-chars.js
var importantCharsSheet = {
  uid: "sheet_NcBlYRH5",
  name: "\u91CD\u8981\u89D2\u8272\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u6240\u6709\u5173\u952ENPC\u7684\u8BE6\u7EC6\u4FE1\u606F\u548C\u52A8\u6001\u72B6\u6001\u3002\n- \u52171: \u59D3\u540D - NPC\u7684\u540D\u5B57\u3002\n- \u52172: \u6027\u522B/\u5E74\u9F84 - NPC\u7684\u751F\u7406\u6027\u522B\u548C\u5E74\u9F84\u3002\n- \u52173: \u4E00\u53E5\u8BDD\u4ECB\u7ECD \u2013 \u7528\u4E0D\u8D85\u8FC715\u5B57\u6982\u62EC\u89D2\u8272\u8EAB\u4EFD\u80CC\u666F\uFF0C\u4E0D\u542B\u4E3B\u89C2\u8BC4\u4EF7\u3002\n- \u52174: \u5916\u8C8C\u7279\u5F81 - \u5BF9NPC\u5916\u8C8C\u548C\u5F53\u524D\u8863\u7740\u7684\u8BE6\u7EC6\u63CF\u8FF0\uFF0C\u5BF9\u5973\u6027\u89D2\u8272\u53EF\u5305\u542B\u8EAB\u6750\u63CF\u5199\uFF1B\u5BF9\u7537\u6027\u89D2\u8272\u65E0\u9700\u63CF\u5199\u3002\n- \u52175: \u6301\u6709\u7684\u91CD\u8981\u7269\u54C1 - NPC\u62E5\u6709\u7684\u5173\u952E\u91CD\u8981\u7269\u54C1\u5217\u8868\uFF0C\u7528\u5206\u53F7\u5206\u9694\u3002\n- \u52176: \u662F\u5426\u79BB\u573A - \u5224\u65AD\u8BE5\u89D2\u8272\u662F\u5426\u80FD\u76F4\u63A5\u4E0E\u4E3B\u89D2\u4E92\u52A8\uFF0C\u586B\u5199\u201C\u662F\u201D\u6216\u201C\u5426\u201D\u3002\n- \u52177: \u8FC7\u5F80\u7ECF\u5386 - \u8BB0\u5F55\u89D2\u8272\u80CC\u666F\u4E0E\u5173\u952E\u4E8B\u4EF6\uFF0C\u968F\u5267\u60C5\u589E\u91CF\u66F4\u65B0\uFF0C\u4E0D\u8D85\u8FC7300\u5B57\uFF0C\u8D85\u8FC7\u65F6\u9700\u538B\u7F29\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\u4E3A\u5F53\u524D\u5728\u573A\u7684\u91CD\u8981\u4EBA\u7269\u5206\u522B\u63D2\u5165\u4E00\u4E2A\u6761\u76EE\u3002",
    deleteNode: "\u7981\u6B62\u5220\u9664\u3002",
    updateNode: "\u5DF2\u6709\u89D2\u8272\u7684\u72B6\u6001\u3001\u5173\u7CFB\u3001\u60F3\u6CD5\u6216\u7ECF\u5386\u53D8\u5316\u65F6\u66F4\u65B0\uFF1B\u82E5\u89D2\u8272\u6B7B\u4EA1\u9700\u5728\u59D3\u540D\u65C1\u6807\u6CE8\uFF08\u5DF2\u6B7B\u4EA1\uFF09\u3002\nSQL\u793A\u4F8B: UPDATE important_characters SET is_absent = '\u662F', past_experience = '\u65B0\u589E\u7ECF\u5386...' WHERE name = '\u89D2\u8272\u540D';",
    insertNode: "\u5267\u60C5\u4E2D\u6709\u672A\u8BB0\u5F55\u7684\u91CD\u8981\u4EBA\u7269\u767B\u573A\u65F6\u6DFB\u52A0\u3002\nSQL\u793A\u4F8B: INSERT INTO important_characters (name, gender_age, brief_intro, appearance, key_items, is_absent, past_experience) VALUES ('\u89D2\u8272\u540D', '\u5973/20', '\u7B80\u4ECB', '\u5916\u8C8C\u63CF\u8FF0', '\u7269\u54C1', '\u5426', '\u7ECF\u5386');",
    ddl: `CREATE TABLE important_characters ( -- \u91CD\u8981\u89D2\u8272\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  name TEXT NOT NULL UNIQUE, -- \u59D3\u540D
  gender_age TEXT, -- \u6027\u522B/\u5E74\u9F84
  brief_intro TEXT, -- \u4E00\u53E5\u8BDD\u4ECB\u7ECD
  appearance TEXT, -- \u5916\u8C8C\u7279\u5F81
  key_items TEXT, -- \u6301\u6709\u7684\u91CD\u8981\u7269\u54C1
  is_absent TEXT NOT NULL DEFAULT '\u5426' CHECK(is_absent IN ('\u662F', '\u5426')), -- \u662F\u5426\u79BB\u573A
  past_experience TEXT -- \u8FC7\u5F80\u7ECF\u5386
);`
  },
  content: [
    [
      "row_id",
      "\u59D3\u540D",
      "\u6027\u522B/\u5E74\u9F84",
      "\u4E00\u53E5\u8BDD\u4ECB\u7ECD",
      "\u5916\u8C8C\u7279\u5F81",
      "\u6301\u6709\u7684\u91CD\u8981\u7269\u54C1",
      "\u662F\u5426\u79BB\u573A",
      "\u8FC7\u5F80\u7ECF\u5386"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: true,
    splitByRow: true,
    entryName: "\u91CD\u8981\u4EBA\u7269\u8868",
    entryType: "keyword",
    keywords: "\u59D3\u540D",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: true,
    extraIndexEntryName: "\u91CD\u8981\u4EBA\u7269\u8868-\u7D22\u5F15",
    extraIndexColumns: [
      "\u59D3\u540D",
      "\u4E00\u53E5\u8BDD\u4ECB\u7ECD"
    ],
    extraIndexColumnModes: {
      "\u59D3\u540D": "both",
      "\u4E00\u53E5\u8BDD\u4ECB\u7ECD": "index_only"
    },
    extraIndexInjectionTemplate: "\u4EE5\u4E0B\u4E3A\u5DF2\u7ECF\u767B\u573A\u8FC7\u7684\u89D2\u8272\uFF1A\n<\u5DF2\u767B\u573A\u89D2\u8272>\n$1\n</\u5DF2\u767B\u573A\u89D2\u8272>",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 1e4,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 1e4,
      order: 8e3
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 1e4,
      order: 99983
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 1e4,
      order: 99984
    }
  },
  orderNo: 2
};

// ../shujuku/src/shared/table-defaults/protagonist-skills.js
var protagonistSkillsSheet = {
  uid: "sheet_lEARaBa8",
  name: "\u4E3B\u89D2\u6280\u80FD\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u4E3B\u89D2\u83B7\u5F97\u7684\u6240\u6709\u6280\u80FD\u9879\u76EE\u3002\n- \u52171: \u6280\u80FD\u540D\u79F0 - \u6280\u80FD\u7684\u540D\u79F0\u3002\n- \u52172: \u6280\u80FD\u7C7B\u578B - \u6280\u80FD\u7684\u7C7B\u522B\uFF08\u5982\uFF1A\u201C\u88AB\u52A8\u201D\u3001\u201C\u4E3B\u52A8\u201D\uFF09\u3002\n- \u52173: \u7B49\u7EA7/\u9636\u6BB5 - \u6280\u80FD\u7684\u5F53\u524D\u7B49\u7EA7\u6216\u9636\u6BB5\u3002\n- \u52174: \u6548\u679C\u63CF\u8FF0 - \u6280\u80FD\u5728\u5F53\u524D\u7B49\u7EA7\u4E0B\u7684\u5177\u4F53\u6548\u679C\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\uFF0C\u6839\u636E\u8BBE\u5B9A\u4E3A\u4E3B\u89D2\u6DFB\u52A0\u521D\u59CB\u6280\u80FD\u3002",
    deleteNode: "\u6280\u80FD\u56E0\u5267\u60C5\u88AB\u5265\u593A\u6216\u66FF\u6362\u65F6\u5220\u9664\u3002\nSQL\u793A\u4F8B: DELETE FROM protagonist_skills WHERE skill_name = '\u88AB\u5265\u593A\u7684\u6280\u80FD';",
    updateNode: "\u5DF2\u6709\u6280\u80FD\u88AB\u5347\u7EA7\u65F6\u66F4\u65B0\u5176\u7B49\u7EA7/\u9636\u6BB5\u548C\u6548\u679C\u63CF\u8FF0\u3002\nSQL\u793A\u4F8B: UPDATE protagonist_skills SET skill_level = 'Lv.3', effect_desc = '\u65B0\u6548\u679C\u63CF\u8FF0' WHERE skill_name = '\u706B\u7403\u672F';",
    insertNode: "\u4E3B\u89D2\u83B7\u5F97\u65B0\u7684\u6280\u80FD\u65F6\u6DFB\u52A0\u3002\nSQL\u793A\u4F8B: INSERT INTO protagonist_skills (skill_name, skill_type, skill_level, effect_desc) VALUES ('\u65B0\u6280\u80FD', '\u4E3B\u52A8', 'Lv.1', '\u6548\u679C\u63CF\u8FF0');",
    ddl: `CREATE TABLE protagonist_skills ( -- \u4E3B\u89D2\u6280\u80FD\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  skill_name TEXT NOT NULL UNIQUE, -- \u6280\u80FD\u540D\u79F0
  skill_type TEXT NOT NULL CHECK(skill_type IN ('\u88AB\u52A8', '\u4E3B\u52A8')), -- \u6280\u80FD\u7C7B\u578B
  skill_level TEXT, -- \u7B49\u7EA7/\u9636\u6BB5
  effect_desc TEXT -- \u6548\u679C\u63CF\u8FF0
);`
  },
  content: [
    [
      "row_id",
      "\u6280\u80FD\u540D\u79F0",
      "\u6280\u80FD\u7C7B\u578B",
      "\u7B49\u7EA7/\u9636\u6BB5",
      "\u6548\u679C\u63CF\u8FF0"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u4E3B\u89D2\u6280\u80FD\u8868",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u4E3B\u89D2\u6280\u80FD\u8868-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    }
  },
  orderNo: 3
};

// ../shujuku/src/shared/table-defaults/inventory.js
var inventorySheet = {
  uid: "sheet_in05z9vz",
  name: "\u80CC\u5305\u7269\u54C1\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u4E3B\u89D2\u62E5\u6709\u7684\u6240\u6709\u7269\u54C1\u3001\u88C5\u5907\u3002\n- \u52171: \u7269\u54C1\u540D\u79F0 - \u7269\u54C1\u7684\u540D\u79F0\u3002\n- \u52172: \u6570\u91CF - \u62E5\u6709\u7684\u6570\u91CF\u3002\n- \u52173: \u63CF\u8FF0/\u6548\u679C - \u7269\u54C1\u7684\u529F\u80FD\u6216\u80CC\u666F\u63CF\u8FF0\u3002\n- \u52174: \u7C7B\u522B - \u7269\u54C1\u7684\u7C7B\u522B\uFF08\u5982\uFF1A\u201C\u6B66\u5668\u201D\u3001\u201C\u6D88\u8017\u54C1\u201D\u3001\u201C\u6742\u7269\u201D\uFF09\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\uFF0C\u6839\u636E\u5267\u60C5\u4E0E\u8BBE\u5B9A\u6DFB\u52A0\u4E3B\u89D2\u7684\u521D\u59CB\u643A\u5E26\u7269\u54C1\u3002",
    deleteNode: "\u7269\u54C1\u88AB\u5B8C\u5168\u6D88\u8017\u3001\u4E22\u5F03\u6216\u6467\u6BC1\u65F6\u5220\u9664\u3002\nSQL\u793A\u4F8B: DELETE FROM inventory WHERE item_name = '\u5DF2\u6D88\u8017\u7269\u54C1';\nSQL\u793A\u4F8B(\u6279\u91CF): DELETE FROM inventory WHERE quantity <= 0;",
    updateNode: "\u83B7\u5F97\u5DF2\u6709\u7684\u7269\u54C1\uFF0C\u4F7F\u5176\u6570\u91CF\u589E\u52A0\u65F6\u66F4\u65B0\uFF0C\u5DF2\u6709\u7269\u54C1\u72B6\u6001\u53D8\u5316\u65F6\u66F4\u65B0\u3002\nSQL\u793A\u4F8B: UPDATE inventory SET quantity = quantity + 3 WHERE item_name = '\u6CBB\u7597\u836F\u6C34';\nSQL\u793A\u4F8B(\u591A\u5217): UPDATE inventory SET quantity = quantity - 1, description = '\u5DF2\u635F\u574F' WHERE item_name = '\u94C1\u5251';",
    insertNode: "\u4E3B\u89D2\u83B7\u5F97\u80CC\u5305\u4E2D\u6CA1\u6709\u7684\u5168\u65B0\u7269\u54C1\u65F6\u6DFB\u52A0\u3002\nSQL\u793A\u4F8B: INSERT INTO inventory (item_name, quantity, description, category) VALUES ('\u65B0\u7269\u54C1', 1, '\u7269\u54C1\u63CF\u8FF0', '\u6742\u7269');",
    ddl: `CREATE TABLE inventory ( -- \u80CC\u5305\u7269\u54C1\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  item_name TEXT NOT NULL UNIQUE, -- \u7269\u54C1\u540D\u79F0
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0), -- \u6570\u91CF
  description TEXT, -- \u63CF\u8FF0/\u6548\u679C
  category TEXT -- \u7C7B\u522B
);`
  },
  content: [
    [
      "row_id",
      "\u7269\u54C1\u540D\u79F0",
      "\u6570\u91CF",
      "\u63CF\u8FF0/\u6548\u679C",
      "\u7C7B\u522B"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u80CC\u5305\u7269\u54C1\u8868",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u80CC\u5305\u7269\u54C1\u8868-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    }
  },
  orderNo: 4
};

// ../shujuku/src/shared/table-defaults/quests-events.js
var questsEventsSheet = {
  uid: "sheet_etak47Ve",
  name: "\u4EFB\u52A1\u4E0E\u4E8B\u4EF6\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u6240\u6709\u5F53\u524D\u6B63\u5728\u8FDB\u884C\u7684\u4EFB\u52A1\u3002\n- \u52171: \u4EFB\u52A1\u540D\u79F0 - \u4EFB\u52A1\u7684\u6807\u9898\u3002\n- \u52172: \u4EFB\u52A1\u7C7B\u578B - \u201C\u4E3B\u7EBF\u4EFB\u52A1\u201D\u6216\u201C\u652F\u7EBF\u4EFB\u52A1\u201D\u3002\n- \u52173: \u53D1\u5E03\u8005 - \u53D1\u5E03\u8BE5\u4EFB\u52A1\u7684\u89D2\u8272\u6216\u52BF\u529B\u3002\n- \u52174: \u8BE6\u7EC6\u63CF\u8FF0 - \u4EFB\u52A1\u7684\u76EE\u6807\u548C\u8981\u6C42\u3002\n- \u52175: \u5F53\u524D\u8FDB\u5EA6 - \u5BF9\u4EFB\u52A1\u5B8C\u6210\u5EA6\u7684\u7B80\u8981\u63CF\u8FF0\u3002\n- \u52176: \u4EFB\u52A1\u65F6\u9650 - \u5B8C\u6210\u4EFB\u52A1\u7684\u5269\u4F59\u65F6\u95F4\u3002\n- \u52177: \u5956\u52B1 - \u5B8C\u6210\u4EFB\u52A1\u53EF\u83B7\u5F97\u7684\u5956\u52B1\u3002\n- \u52178: \u60E9\u7F5A - \u4EFB\u52A1\u5931\u8D25\u7684\u540E\u679C\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\uFF0C\u6839\u636E\u5267\u60C5\u4E0E\u8BBE\u5B9A\u6DFB\u52A0\u4E00\u6761\u4E3B\u7EBF\u5267\u60C5\u3002",
    deleteNode: "\u4EFB\u52A1\u5B8C\u6210\u3001\u5931\u8D25\u6216\u8FC7\u671F\u65F6\u5220\u9664\u3002\nSQL\u793A\u4F8B: DELETE FROM quests_events WHERE quest_name = '\u5DF2\u5B8C\u6210\u7684\u4EFB\u52A1';",
    updateNode: "\u4EFB\u52A1\u53D6\u5F97\u5173\u952E\u8FDB\u5C55\u65F6\u8FDB\u884C\u66F4\u65B0\u3002\nSQL\u793A\u4F8B: UPDATE quests_events SET current_progress = '\u5DF2\u5B8C\u6210\u7B2C\u4E00\u9636\u6BB5', time_limit = '\u5269\u4F593\u5929' WHERE quest_name = '\u62EF\u6551\u516C\u4E3B';",
    insertNode: "\u4E3B\u89D2\u63A5\u53D6\u6216\u89E6\u53D1\u65B0\u7684\u4E3B\u7EBF\u6216\u652F\u7EBF\u4EFB\u52A1\u65F6\u6DFB\u52A0\u3002\nSQL\u793A\u4F8B: INSERT INTO quests_events (quest_name, quest_type, issuer, detail_desc, current_progress, time_limit, reward, penalty) VALUES ('\u65B0\u4EFB\u52A1', '\u652F\u7EBF\u4EFB\u52A1', '\u6751\u957F', '\u4EFB\u52A1\u63CF\u8FF0', '\u521A\u63A5\u53D6', '7\u5929', '\u91D1\u5E01100', '\u58F0\u671B\u964D\u4F4E');",
    ddl: `CREATE TABLE quests_events ( -- \u4EFB\u52A1\u4E0E\u4E8B\u4EF6\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  quest_name TEXT NOT NULL UNIQUE, -- \u4EFB\u52A1\u540D\u79F0
  quest_type TEXT NOT NULL CHECK(quest_type IN ('\u4E3B\u7EBF\u4EFB\u52A1', '\u652F\u7EBF\u4EFB\u52A1')), -- \u4EFB\u52A1\u7C7B\u578B
  issuer TEXT, -- \u53D1\u5E03\u8005
  detail_desc TEXT, -- \u8BE6\u7EC6\u63CF\u8FF0
  current_progress TEXT, -- \u5F53\u524D\u8FDB\u5EA6
  time_limit TEXT, -- \u4EFB\u52A1\u65F6\u9650
  reward TEXT, -- \u5956\u52B1
  penalty TEXT -- \u60E9\u7F5A
);`
  },
  content: [
    [
      "row_id",
      "\u4EFB\u52A1\u540D\u79F0",
      "\u4EFB\u52A1\u7C7B\u578B",
      "\u53D1\u5E03\u8005",
      "\u8BE6\u7EC6\u63CF\u8FF0",
      "\u5F53\u524D\u8FDB\u5EA6",
      "\u4EFB\u52A1\u65F6\u9650",
      "\u5956\u52B1",
      "\u60E9\u7F5A"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u4EFB\u52A1\u4E0E\u4E8B\u4EF6\u8868",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u4EFB\u52A1\u4E0E\u4E8B\u4EF6\u8868-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    }
  },
  orderNo: 5
};

// ../shujuku/src/shared/table-defaults/chronicle.js
var chronicleSheet = {
  uid: "sheet_3NoMc1wI",
  name: "\u7EAA\u8981\u8868",
  sourceData: {
    note: "\u8F6E\u6B21\u65E5\u5FD7\uFF0C\u6BCF\u8F6E\u4EA4\u4E92\u540E\u5FC5\u987B\u7ACB\u5373\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u3002\n- \u52171: \u65F6\u95F4\u8DE8\u5EA6 - \u672C\u8F6E\u4E8B\u4EF6\u53D1\u751F\u7684\u7CBE\u786E\u65F6\u95F4\u8303\u56F4\u3002\n- \u52172: \u5730\u70B9 - \u672C\u8F6E\u4E8B\u4EF6\u53D1\u751F\u7684\u5730\u70B9\uFF0C\u4ECE\u5927\u5230\u5C0F\u63CF\u8FF0\u3002\n- \u52173: \u7EAA\u8981 - \u4EE5\u7B2C\u4E09\u65B9\u89C6\u89D2\u5BA2\u89C2\u8BB0\u5F55\u672C\u8F6E\u4E8B\u4EF6\uFF0C\u4E0D\u5F97\u52A0\u5165\u63A8\u6D4B\u3001\u60C5\u7EEA\u5316\u8BED\u8A00\u3001\u8D1F\u9762\u89E3\u8BFB\u6216\u4E3B\u89C2\u5224\u65AD\u3002\u5185\u5BB9\u5FC5\u987B\u57FA\u4E8E\u6B63\u6587\u660E\u786E\u53D1\u751F\u7684\u4E8B\u5B9E\uFF0C\u4E0D\u5F97\u8865\u5145\u672A\u51FA\u73B0\u7684\u60C5\u8282\uFF0C\u4E0D\u5C11\u4E8E300\u5B57\uFF0C\u7ED3\u5C3E\u90E8\u5206\u7981\u6B62\u8FDB\u884C\u603B\u7ED3\u6216\u8005\u5347\u534E\u3002\n- \u52174: \u6982\u8981 - 30\u5B57\u4EE5\u5185\uFF0C\u4E00\u53E5\u8BDD\u6982\u62EC\u7EAA\u8981\u5185\u5BB9\u3002\n- \u52175: \u7F16\u7801\u7D22\u5F15 - \u683C\u5F0F\u4E3A AMXXXX\uFF0CXXXX\u4ECE0001\u9012\u589E\u3002\n",
    initNode: "\u6545\u4E8B\u521D\u59CB\u5316\u65F6\uFF0C\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u7528\u4E8E\u8BB0\u5F55\u521D\u59CB\u5316\u5267\u60C5\u3002",
    deleteNode: "\u7981\u6B62\u5220\u9664\u3002",
    updateNode: "\u7981\u6B62\u64CD\u4F5C\u3002",
    insertNode: "\u6BCF\u8F6E\u4EA4\u4E92\u7ED3\u675F\u540E\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u3002\n\u65F6\u95F4\u8DE8\u5EA6\u683C\u5F0F\u5FC5\u987B\u4E3A YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM\u3002\nSQL\u793A\u4F8B: INSERT INTO chronicle (time_span, location, chronicle_text, summary, code_index) VALUES ('2024-03-15 14:00 ~ 2024-03-15 15:00', '\u738B\u57CE\xB7\u4E2D\u592E\u5E7F\u573A', '\u672C\u8F6E\u7EAA\u8981\u5185\u5BB9...', '\u4E00\u53E5\u8BDD\u6982\u62EC', 'AM0002');",
    ddl: `CREATE TABLE chronicle ( -- \u7EAA\u8981\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  time_span TEXT NOT NULL CHECK(time_span GLOB '????-??-?? ??:?? ~ ????-??-?? ??:??'), -- \u65F6\u95F4\u8DE8\u5EA6
  location TEXT NOT NULL, -- \u5730\u70B9
  chronicle_text TEXT NOT NULL, -- \u7EAA\u8981
  summary TEXT, -- \u6982\u89C8
  code_index TEXT NOT NULL UNIQUE CHECK(code_index GLOB 'AM[0-9][0-9][0-9][0-9]') -- \u7F16\u7801\u7D22\u5F15
);`
  },
  content: [
    [
      "row_id",
      "\u65F6\u95F4\u8DE8\u5EA6",
      "\u5730\u70B9",
      "\u7EAA\u8981",
      "\u6982\u89C8",
      "\u7F16\u7801\u7D22\u5F15"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: true,
    splitByRow: true,
    entryName: "\u7EAA\u8981",
    entryType: "keyword",
    keywords: "\u7F16\u7801\u7D22\u5F15",
    preventRecursion: true,
    injectionTemplate: "<\u8BB0\u5FC6\u56DE\u6EAF>\n$1\n</\u8BB0\u5FC6\u56DE\u6EAF>",
    extraIndexEnabled: true,
    extraIndexEntryName: "\u7EAA\u8981\u7D22\u5F15",
    extraIndexColumns: [
      "\u6982\u89C8",
      "\u7F16\u7801\u7D22\u5F15"
    ],
    extraIndexColumnModes: {
      "\u6982\u89C8": "index_only",
      "\u7F16\u7801\u7D22\u5F15": "both"
    },
    extraIndexInjectionTemplate: "<\u5DF2\u53D1\u751F\u7684\u4E8B\u4EF6\u6982\u89C8>\n$1\n</\u5DF2\u53D1\u751F\u7684\u4E8B\u4EF6\u6982\u89C8>",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 999,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 1e3,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 9999,
      order: 99987
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 9999,
      order: 99988
    }
  },
  orderNo: 6
};

// ../shujuku/src/shared/table-defaults/options.js
var optionsSheet = {
  uid: "sheet_OptionsNew",
  name: "\u9009\u9879\u8868",
  sourceData: {
    note: "\u8BB0\u5F55\u6BCF\u8F6E\u4E3B\u89D2\u53EF\u4EE5\u8FDB\u884C\u7684\u52A8\u4F5C\u9009\u9879\u3002\u6B64\u8868\u6709\u4E14\u4EC5\u6709\u4E00\u884C\u3002\n- \u52171: \u9009\u9879\u4E00 \u2013 \u4EE5\u7B2C\u4E09\u4EBA\u79F0\u63CF\u8FF0\u4E3B\u89D2\u53EF\u91C7\u53D6\u7684\u5408\u7406\u884C\u52A8\uFF0C\u504F\u5411\u7B56\u7565\u6216\u63A8\u8FDB\u5267\u60C5\u3002\n- \u52172: \u9009\u9879\u4E8C \u2013 \u4EE5\u7B2C\u4E09\u4EBA\u79F0\u63CF\u8FF0\u4E3B\u89D2\u53EF\u91C7\u53D6\u7684\u4E2D\u7ACB\u884C\u52A8\uFF0C\u4E0D\u504F\u5411\u4EFB\u4F55\u7ACB\u573A\u3002\n- \u52173: \u9009\u9879\u4E09 \u2013 \u4EE5\u7B2C\u4E09\u4EBA\u79F0\u63CF\u8FF0\u4E3B\u89D2\u53EF\u91C7\u53D6\u7684\u5584\u610F\u884C\u52A8\uFF0C\u4F53\u73B0\u5E2E\u52A9\u3001\u4FDD\u62A4\u6216\u5B89\u629A\u3002\n- \u52174: \u9009\u9879\u56DB \u2013 \u4EE5\u7B2C\u4E09\u4EBA\u79F0\u63CF\u8FF0\u4E3B\u89D2\u53EF\u91C7\u53D6\u7684 NSFW \u76F8\u5173\u884C\u52A8\uFF0C\u4F46\u5FC5\u987B\u7B26\u5408\u5267\u60C5\u903B\u8F91\uFF0C\u4E0D\u5F97\u4EE3\u66FF\u4E3B\u89D2\u8BF4\u8BDD\u3002\n\u6240\u6709\u9009\u9879\u5FC5\u987B\u4F7F\u7528\u7B2C\u4E09\u4EBA\u79F0\uFF08\u5982\u201C\u4E3B\u89D2\u5C1D\u8BD5\u2026\u201D\uFF0C\u201C\u4E3B\u89D2\u51B3\u5B9A\u2026\u201D\uFF09\uFF0C\u4E0D\u5F97\u4EE3\u66FF\u4E3B\u89D2\u53D1\u8A00\uFF1B\u5FC5\u987B\u7D27\u6263\u5F53\u524D\u5267\u60C5\uFF1B\u56DB\u4E2A\u9009\u9879\u9700\u98CE\u683C\u660E\u786E\u3001\u4E92\u4E0D\u91CD\u590D\u3002",
    initNode: "\u6E38\u620F\u521D\u59CB\u5316\u65F6\uFF0C\u751F\u6210\u56DB\u4E2A\u521D\u59CB\u9009\u9879\u3002",
    deleteNode: "\u7981\u6B62\u5220\u9664\u3002",
    updateNode: "\u6BCF\u8F6E\u4EA4\u4E92\u540E\u5FC5\u987B\u66F4\u65B0\u6B64\u8868\uFF0C\u6839\u636E\u5F53\u524D\u5267\u60C5\u751F\u6210\u65B0\u7684\u56DB\u4E2A\u9009\u9879\u8986\u76D6\u539F\u6709\u5185\u5BB9\u3002\nSQL\u793A\u4F8B: UPDATE options SET option_1 = '\u65B0\u9009\u9879\u4E00', option_2 = '\u65B0\u9009\u9879\u4E8C', option_3 = '\u65B0\u9009\u9879\u4E09', option_4 = '\u65B0\u9009\u9879\u56DB' WHERE row_id = 1;",
    insertNode: "\u7981\u6B62\u64CD\u4F5C\u3002",
    ddl: `CREATE TABLE options ( -- \u9009\u9879\u8868
  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7
  option_1 TEXT NOT NULL, -- \u9009\u9879\u4E00
  option_2 TEXT NOT NULL, -- \u9009\u9879\u4E8C
  option_3 TEXT NOT NULL, -- \u9009\u9879\u4E09
  option_4 TEXT NOT NULL -- \u9009\u9879\u56DB
);`
  },
  content: [
    [
      "row_id",
      "\u9009\u9879\u4E00",
      "\u9009\u9879\u4E8C",
      "\u9009\u9879\u4E09",
      "\u9009\u9879\u56DB"
    ]
  ],
  updateConfig: {
    uiSentinel: -1,
    contextDepth: -1,
    updateFrequency: -1,
    batchSize: -1,
    skipFloors: -1
  },
  exportConfig: {
    enabled: false,
    splitByRow: false,
    entryName: "\u9009\u9879\u8868",
    entryType: "constant",
    keywords: "",
    preventRecursion: true,
    injectionTemplate: "",
    extraIndexEnabled: false,
    extraIndexEntryName: "\u9009\u9879\u8868-\u7D22\u5F15",
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: "",
    entryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 1e4
    },
    extraIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 10010
    },
    fixedEntryPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99990
    },
    fixedIndexPlacement: {
      position: "at_depth_as_system",
      depth: 2,
      order: 99991
    },
    injectIntoWorldbook: false
  },
  orderNo: 7
};

// ../shujuku/src/shared/table-defaults/mate.js
var mateConfig = {
  type: "chatSheets",
  version: 1,
  updateConfigUiSentinel: -1,
  globalInjectionConfig: {
    readableEntryPlacement: {
      position: "before_char",
      depth: 2,
      order: 99981
    },
    wrapperPlacement: {
      position: "before_char",
      depth: 2,
      order: 99980
    }
  }
};

// ../shujuku/src/shared/table-defaults/romance-overrides.js
var romanceDefaultSheetOverrides = {
  "sheet_global_data": {
    "uid": "sheet_global_data",
    "name": "\u5168\u5C40\u6570\u636E\u8868",
    "sourceData": {
      "note": '\u8BB0\u5F55\u5F53\u524D\u4E3B\u89D2\u6240\u5728\u5730\u70B9\u53CA\u65F6\u95F4\u76F8\u5173\u53C2\u6570\u3002\u6B64\u8868\u6709\u4E14\u4EC5\u6709\u4E00\u884C\u3002\n\n\u3010\u5217\u5B9A\u4E49\u3011\n- \u52171: \u5168\u5C40\u72B6\u6001 story_state\n- \u52172: \u5F53\u524D\u8BE6\u7EC6\u5730\u70B9 current_location\n- \u52173: \u5F53\u524D\u6B21\u8981\u5730\u533A current_minor_region\n- \u52174: \u5F53\u524D\u4E3B\u8981\u5730\u533A current_major_region\n- \u52175: \u4E0A\u8F6E\u573A\u666F\u65F6\u95F4 prev_scene_time\uFF08\u521D\u59CB\u5316\u65F6\u4E3ANULL\uFF09\n- \u52176: \u7ECF\u8FC7\u7684\u65F6\u95F4 elapsed_time\n- \u52177: \u5F53\u524D\u65F6\u95F4 cur_time\n\n\u3010\u5F3A\u5236\u7EA6\u675F\u3011\n\u5168\u5C40\u72B6\u6001\u4E3A\u56FA\u5B9A\u5B57\u7B26\u4E32`\u5168\u5C40\u72B6\u6001`\uFF0C\u6807\u9898\u6027\u8D28\u3002\n\n\u5730\u70B9\u5C42\u7EA7\u4ECE\u5C0F\u5230\u5927\uFF1A\u8BE6\u7EC6\u5730\u70B9 < \u6B21\u8981\u5730\u533A < \u4E3B\u8981\u5730\u533A\u3002\n\u6BCF\u4E2A\u5B57\u6BB5\u53EA\u5199\u672C\u7EA7\u540D\u79F0\uFF0C\u4E0D\u62FC\u4E0A\u7EA7\u524D\u7F00\u3002\n\u221A \u5F53\u524D\u8BE6\u7EC6\u5730\u70B9\u586B \u201C\u5FA1\u82D1\u201D\n\xD7 \u5F53\u524D\u8BE6\u7EC6\u5730\u70B9\u586B \u201C\u4E1C\u4EAC-\u65B0\u5BBF\u533A-\u5FA1\u82D1\u201D\n\n\u65F6\u95F4\u683C\u5F0F\uFF1A\nprev_scene_time / cur_time: YYYY-MM-DD HH:MM\nelapsed_time: {\u6570\u503C}{\u5355\u4F4D}\uFF0C\u591A\u5355\u4F4D\u7528\u7A7A\u683C\u8FDE\u3002\n\u5355\u4F4D\u96C6\u5408\uFF1A[\u7EAA\u5143,\u5343\u5E74,\u767E\u5E74,\u5E74,\u6708,\u5468,\u5929,\u5C0F\u65F6,\u5206]\n\u793A\u4F8B\uFF1A"3\u5C0F\u65F620\u5206" | "2\u5929" | "3\u5E746\u6708"\n\n\u65F6\u95F4\u8BA1\u7B97\u516C\u5F0F\uFF1Acur_time = prev_scene_time + elapsed_time\n- \u521D\u59CB\u5316\u65F6prev_scene_time\u4E3ANULL\uFF0Ccur_time\u76F4\u63A5\u586B\u5199\u521D\u59CB\u65F6\u95F4\uFF0C\u65E0\u9700\u8BA1\u7B97\n- \u6BCF\u8F6E\u63A8\u8FDB\u65F6\uFF0C\u5C06\u4E0A\u4E00\u8F6E\u7684cur_time\u8D4B\u503C\u7ED9prev_scene_time\uFF0C\u7136\u540E\u586B\u5199\u672C\u6B21\u7684elapsed_time\uFF0C\u6700\u540E\u8BA1\u7B97\u5F97\u5230\u65B0\u7684cur_time',
      "initNode": "\u6545\u4E8B\u521D\u59CB\u5316\u65F6\uFF0C\u63D2\u5165\u552F\u4E00\u6761\u76EE\uFF0C\u8BB0\u5F55\u7528\u6237\u5F00\u5C40\u521D\u59CB\u65F6\u95F4\u4E0E\u521D\u59CB\u5730\u70B9\u3002\u7981\u6B62\u76F4\u63A5\u7167\u642C\u793A\u4F8B\u4E2D\u7684\u5730\u70B9\u548C\u65E5\u671F\u3002\n\nSQL\u793A\u4F8B: INSERT INTO global_state (story_state, current_location, current_minor_region, current_major_region, prev_scene_time, elapsed_time, cur_time)\nVALUES ('\u5168\u5C40\u72B6\u6001', '\u5FA1\u82D1', '\u65B0\u5BBF\u533A', '\u4E1C\u4EAC\u90FD', NULL, '0\u5206', '2026-02-03 09:00');",
      "deleteNode": "\u7981\u6B62\u3002",
      "updateNode": "\u6BCF\u8F6E\u63A8\u8FDB\u65F6\u66F4\u65B0 prev_scene_time\u3001elapsed_time \u548C cur_time\uFF1B\u82E5\u5730\u70B9\u53D8\u52A8\u5219\u540C\u6B65\u66F4\u65B0\u4E09\u7EA7\u5730\u70B9\u5B57\u6BB5\u3002\n\n\u3010\u66F4\u65B0\u7EA6\u675F\u3011\n\u9664\u521D\u59CB\u5316\u65F6 prev_scene_time \u53EF\u4E3A NULL \u5916\uFF0C\u5176\u4F59\u5B57\u6BB5\u5747\u4E0D\u53EF\u5199 NULL \u6216\u7A7A\u4E32\u3002\n\n\u3010\u66F4\u65B0SQL\u793A\u4F8B\uFF08\u540C\u65E5+\u8DE8\u65E5+\u4F4D\u7F6E\u53D8\u52A8\u7EFC\u5408\u8986\u76D6\uFF09\u3011\nSQL\u793A\u4F8B(\u540C\u65E5\u63A8\u8FDB): UPDATE global_state SET prev_scene_time = '2026-02-03 09:00', elapsed_time = '3\u5C0F\u65F6', cur_time = '2026-02-03 12:00' WHERE row_id = 1;\n\nSQL\u793A\u4F8B(\u8DE8\u65E5\u63A8\u8FDB): UPDATE global_state SET prev_scene_time = '2026-02-03 23:55', elapsed_time = '20\u5206', cur_time = '2026-02-04 00:15' WHERE row_id = 1;\n\nSQL\u793A\u4F8B(\u542B\u4F4D\u7F6E\u53D8\u52A8): UPDATE global_state SET current_location = '\u65B0\u5BBF\u8F66\u7AD9', current_minor_region = '\u65B0\u5BBF\u533A', current_major_region = '\u4E1C\u4EAC\u90FD', prev_scene_time = '2026-02-03 12:00', elapsed_time = '30\u5206', cur_time = '2026-02-03 12:30' WHERE row_id = 1;",
      "insertNode": "\u7981\u6B62\u3002",
      "ddl": "CREATE TABLE global_state ( -- \u5168\u5C40\u6570\u636E\u8868\n  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7\n  story_state TEXT NOT NULL CHECK(story_state = '\u5168\u5C40\u72B6\u6001'), -- \u5168\u5C40\u72B6\u6001\n  current_location TEXT NOT NULL, -- \u5F53\u524D\u8BE6\u7EC6\u5730\u70B9\n  current_minor_region TEXT NOT NULL, -- \u5F53\u524D\u6B21\u8981\u5730\u533A\n  current_major_region TEXT NOT NULL, -- \u5F53\u524D\u4E3B\u8981\u5730\u533A\n  prev_scene_time TEXT CHECK(prev_scene_time IS NULL OR prev_scene_time GLOB '????-??-?? ??:??'), -- \u4E0A\u8F6E\u573A\u666F\u65F6\u95F4\n  elapsed_time TEXT NOT NULL, -- \u7ECF\u8FC7\u7684\u65F6\u95F4\n  cur_time TEXT NOT NULL CHECK(cur_time GLOB '????-??-?? ??:??') -- \u5F53\u524D\u65F6\u95F4\n);"
    },
    "content": [
      [
        "row_id",
        "\u5168\u5C40\u72B6\u6001",
        "\u5F53\u524D\u8BE6\u7EC6\u5730\u70B9",
        "\u5F53\u524D\u6B21\u8981\u5730\u533A",
        "\u5F53\u524D\u4E3B\u8981\u5730\u533A",
        "\u4E0A\u8F6E\u573A\u666F\u65F6\u95F4",
        "\u7ECF\u8FC7\u7684\u65F6\u95F4",
        "\u5F53\u524D\u65F6\u95F4"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": false,
      "splitByRow": false,
      "entryName": "\u5168\u5C40\u6570\u636E\u8868",
      "entryType": "constant",
      "keywords": "",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": false,
      "extraIndexEntryName": "\u5168\u5C40\u6570\u636E\u8868-\u7D22\u5F15",
      "extraIndexColumns": [],
      "extraIndexColumnModes": {},
      "extraIndexInjectionTemplate": "",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 1e4
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "before_character_definition",
        "depth": 2,
        "order": 99981
      },
      "fixedIndexPlacement": {
        "position": "before_character_definition",
        "depth": 2,
        "order": 99982
      }
    },
    "orderNo": 0
  },
  "sheet_protagonist": {
    "uid": "sheet_protagonist",
    "name": "\u4E3B\u89D2\u4FE1\u606F\u8868",
    "sourceData": {
      "note": '\u8BB0\u5F55\u4E3B\u89D2\u7684\u6838\u5FC3\u8EAB\u4EFD\u4FE1\u606F\u3002\u6B64\u8868\u6709\u4E14\u4EC5\u6709\u4E00\u884C\u3002\n\n\u3010\u5217\u5B9A\u4E49\u3011\n- \u52171: \u59D3\u540D name\n- \u52172: \u6027\u522B gender\n- \u52173: \u5E74\u9F84 age\n- \u52174: \u5916\u8C8C\u7279\u5F81 appearance\uFF08\u542B\u65E5\u5E38\u7A7F\u8863\u98CE\u683C\uFF0C\u5199\u51FA\u6574\u4F53\u5370\u8C61\uFF0C\u907F\u514D\u7F57\u5217\u6570\u636E\uFF09\n- \u52175: \u8EAB\u4EFD identity_text\uFF08\u9017\u53F7\u5206\u9694\uFF09\n- \u52176: \u8FD1\u51B5 current_condition\n- \u52177: \u6240\u5728\u5730\u70B9 location_name\n- \u52178: \u968F\u8EAB\u8D22\u7269 belongings\uFF08\u53EFNULL\uFF09\n\n\u3010\u5F3A\u5236\u7EA6\u675F\u3011\n1. \u6240\u5728\u5730\u70B9\u53EA\u5199\u5730\u70B9\u540D\u4E0D\u5E26\u5C42\u7EA7\u524D\u7F00\u3002\u4F4D\u7F6E\u53D8\u5316\u65F6\u540C\u6B65\u66F4\u65B0\u3002\n\n2. \u8FD1\u51B5\u7528\u4E00\u53E5\u8BDD\u63CF\u8FF0\u4E3B\u89D2\u5F53\u524D\u7684\u8EAB\u4F53\u611F\u89C9\u3001\u60C5\u7EEA\u72B6\u6001\u6216\u5FC3\u5934\u60E6\u8BB0\u7684\u4E8B\u3002\n\u6B63\u5E38\u65F6\u671F\u586B"\u4E00\u5207\u5982\u5E38"\uFF0C\u6709\u5F02\u5E38\u65F6\u76F4\u63A5\u5199\u5177\u4F53\u611F\u53D7\uFF0C\u4E0D\u7528\u6807\u7B7E\u5806\u53E0\u3002\n\u221A \u6628\u665A\u6CA1\u7761\u597D\uFF0C\u8111\u5B50\u6709\u70B9\u6C89\n\u221A \u521A\u4ECE\u96E8\u91CC\u8DD1\u56DE\u6765\uFF0C\u8863\u670D\u8FD8\u6E7F\u7740\n\n3. \u968F\u8EAB\u8D22\u7269\u53EA\u5199\u5F53\u524D\u8EAB\u4E0A\u5E26\u7740\u7684\u6709\u610F\u4E49\u7269\u54C1\uFF0C\u4E0D\u5199\u6E38\u620F\u5316\u8D44\u6E90\u3002\n\u221A \u94B1\u5305\u91CC\u5939\u7740\u7B2C\u4E00\u6B21\u770B\u7535\u5F71\u7684\u7968\u6839\n\u221A \u53E3\u888B\u91CC\u5269\u4E24\u9897\u6A58\u5B50\u7CD6',
      "initNode": "\u6545\u4E8B\u521D\u59CB\u5316\u65F6\uFF0C\u63D2\u5165\u4E3B\u89D2\u7684\u552F\u4E00\u6761\u76EE\u3002",
      "deleteNode": "\u7981\u6B62\u3002",
      "updateNode": "\u5DF2\u5B58\u5728\u7684\u8FD9\u4E00\u884C\uFF0C\u5B57\u6BB5\u503C\u53D8\u5316\u65F6\u66F4\u65B0\uFF1A\u5E74\u9F84\u3001\u5916\u8C8C\u3001\u8EAB\u4EFD\u3001\u8FD1\u51B5\u3001\u6240\u5728\u5730\u70B9\u3001\u968F\u8EAB\u8D22\u7269\u3002\n\n\u3010\u66F4\u65B0SQL\u793A\u4F8B\uFF08\u8FD1\u51B5+\u4F4D\u7F6E\u53D8\u5316\uFF09\u3011\n\u66F4\u65B0SQL\u793A\u4F8B(\u8FD1\u51B5\u53D8\u5316): UPDATE protagonist_info SET current_condition = '\u75B2\u52B3\uFF0C\u5DE6\u819D\u64E6\u4F24', location_name = '\u5FA1\u82D1' WHERE row_id = 1;\n\n\u66F4\u65B0SQL\u793A\u4F8B(\u968F\u8EAB\u8D22\u7269\u53D8\u5316): UPDATE protagonist_info SET belongings = '\u94B1\u5305\u91CC\u5939\u7740\u7B2C\u4E00\u6B21\u770B\u7535\u5F71\u7684\u7968\u6839\uFF0C\u53E3\u888B\u91CC\u5269\u4E24\u9897\u6A58\u5B50\u7CD6' WHERE row_id = 1;",
      "insertNode": "\u7981\u6B62\u3002",
      "ddl": "CREATE TABLE protagonist_info ( -- \u4E3B\u89D2\u4FE1\u606F\n  row_id INTEGER PRIMARY KEY CHECK(row_id = 1), -- \u884C\u53F7\uFF0C\u4EC5\u5141\u8BB8\u4E3A 1\n  name TEXT NOT NULL, -- \u59D3\u540D\n  gender TEXT NOT NULL, -- \u6027\u522B\n  age INTEGER CHECK(age IS NULL OR age >= 0), -- \u5E74\u9F84\n  appearance TEXT NOT NULL, -- \u5916\u8C8C\u7279\u5F81\n  identity_text TEXT NOT NULL, -- \u8EAB\u4EFD\n  current_condition TEXT NOT NULL DEFAULT '\u4E00\u5207\u5982\u5E38', -- \u8FD1\u51B5\n  location_name TEXT NOT NULL, -- \u6240\u5728\u5730\u70B9\n  belongings TEXT -- \u968F\u8EAB\u8D22\u7269\n);"
    },
    "content": [
      [
        "row_id",
        "\u59D3\u540D",
        "\u6027\u522B",
        "\u5E74\u9F84",
        "\u5916\u8C8C\u7279\u5F81",
        "\u8EAB\u4EFD",
        "\u8FD1\u51B5",
        "\u6240\u5728\u5730\u70B9",
        "\u968F\u8EAB\u8D22\u7269"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": false,
      "splitByRow": false,
      "entryName": "\u4E3B\u89D2\u4FE1\u606F",
      "entryType": "constant",
      "keywords": "",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": false,
      "extraIndexEntryName": "\u4E3B\u89D2\u4FE1\u606F-\u7D22\u5F15",
      "extraIndexColumns": [],
      "extraIndexColumnModes": {},
      "extraIndexInjectionTemplate": "",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 1e4
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 99990
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 2,
        "order": 99991
      }
    },
    "orderNo": 2
  },
  "sheet_important_non_romance": {
    "uid": "sheet_important_non_romance",
    "name": "\u91CD\u8981\u89D2\u8272\u8868",
    "sourceData": {
      "note": '\u8BB0\u5F55\u6240\u6709\u5BF9\u5F53\u524D\u5267\u60C5\u4EA7\u751F\u4F5C\u7528\u7684\u91CD\u8981\u89D2\u8272\u3002\n\n\u3010\u5217\u5B9A\u4E49\u3011\n- \u52171: \u59D3\u540D name\uFF08\u5168\u8868\u552F\u4E00\uFF09\n- \u52172: \u6027\u522B gender\n- \u52173: \u5E74\u9F84 age\n- \u52174: \u4E00\u53E5\u8BDD\u4ECB\u7ECD brief_intro\n- \u52175: \u5916\u8C8C\u7279\u5F81 appearance\n- \u52176: \u7A7F\u7740\u6253\u626E outfit_text\n- \u52177: \u6240\u5728\u5730\u70B9 location_name\n- \u52178: \u5728\u573A\u72B6\u6001 presence_status\uFF08\u5728\u573A/\u79BB\u573A\uFF09\n- \u52179: \u4EBA\u9645\u5173\u7CFB relation_text\n- \u521710: \u8FC7\u5F80\u7ECF\u5386 past_experience\n- \u521711: \u4EA4\u4E92\u9009\u9879 interaction_options\n\n\u3010\u5F3A\u5236\u7EA6\u675F\u3011\nbrief_intro\u4EC5\u5141\u8BB8\u5BA2\u89C2\u4E8B\u5B9E\u7C7B\u5185\u5BB9\uFF0C\u4E25\u7981\u51FA\u73B0\u4EFB\u4F55\u6027\u683C\u6807\u7B7E\u6982\u8FF0\uFF0C\u5982"\u5F00\u6717""\u51B7\u6F20""\u6E29\u67D4"\u7B49\uFF1B\u5BA2\u89C2\u5185\u5BB9\u8303\u7574\u5305\u62EC\u4F46\u4E0D\u9650\u4E8E\uFF1A\u89D2\u8272\u6838\u5FC3\u8EAB\u4EFD\u3001\u4E0E\u5267\u60C5\u5F3A\u76F8\u5173\u7684\u5BA2\u89C2\u884C\u4E3A\u3001\u4E0E\u5173\u952E\u4EBA\u7269\u7684\u5BA2\u89C2\u5173\u8054\u3001\u975E\u6027\u683C\u7C7B\u6838\u5FC3\u7279\u5F81\u3002\n\u221A \u7ECF\u8425\u57CE\u5357\u6742\u8D27\u94FA / \u66FE\u6551\u8FC7\u4E3B\u89D2\u7684\u6027\u547D / \u827E\u8389\u4E1D\u7684\u4EB2\u751F\u5144\u957F\n\xD7 \u6027\u683C\u5B64\u50FB\u7684\u6742\u8D27\u94FA\u8001\u677F / \u6E29\u67D4\u4E14\u6551\u8FC7\u4E3B\u89D2 / \u504F\u6267\u7684\u827E\u8389\u4E1D\u5144\u957F\n\noutfit_text\u4EC5\u5199\u5916\u5728\u53EF\u89C1\u7684\u670D\u9970\u3001\u9970\u54C1\u3001\u5986\u5BB9\u3001\u6301\u63E1\u7269\u7B49\u53EF\u89C6\u5143\u7D20\uFF0C\u7981\u6B62\u5199\u56FA\u6709\u7684\u957F\u76F8\u7279\u5F81\u3001\u6C14\u8D28\u3001\u6C14\u573A\u7B49\u975E\u89C6\u89C9\u5185\u5BB9\u3002\n\u221A \u6DF1\u7070\u7ACB\u9886\u98CE\u8863\u914D\u9ED1\u76AE\u624B\u5957 / \u5DE6\u624B\u65E0\u540D\u6307\u6234\u7740\u4E00\u679A\u94F6\u8272\u86C7\u7EB9\u6212\n\xD7 \u6563\u53D1\u51FA\u9AD8\u8D35\u7684\u6C14\u573A\u3001\u770B\u8D77\u6765\u50CF\u4E2A\u519B\u4EBA\n\ninteraction_options\u5FC5\u987B\u540C\u65F6\u9075\u5FAA\u4E0B\u8FF0\u8981\u6C42\n1.\u4E0D\u4F7F\u7528\u7B2C\u4E00\u4EBA\u79F0"\u6211"\n2.\u52A8\u4F5C\u53D1\u8D77\u65B9\u4E3A\u4E3B\u89D2\uFF0C\u63A5\u6536\u65B9\u4E3A\u89D2\u8272\n3.\u5FC5\u987B\u662F\u5177\u4F53\u3001\u6709\u4EE3\u5165\u611F\u7684\u5B9E\u9645\u884C\u52A8\uFF0C\u907F\u514D\u5E72\u762A\u7684\u5355\u8BCD\n\u221A \u5411\u4ED6\u6253\u542C\u5931\u8E2A\u6848\u7EBF\u7D22 / \u5047\u88C5\u5076\u9047\u5E76\u642D\u8BDD\u5957\u53D6\u4FE1\u606F / \u6545\u610F\u6253\u7FFB\u6C34\u676F\u5236\u9020\u51B2\u7A81\n\xD7 \u4EA4\u8C08 / \u6253\u542C\n\n\u3010relation_text \u683C\u5F0F\u89C4\u5219\u3011\uFF08\u5F3A\u5236\uFF09\n1. \u683C\u5F0F\u5FC5\u987B\u662F\uFF1A\u89D2\u8272\u540D:\u5173\u7CFB\u63CF\u8FF0\n   - \u5FC5\u987B\u663E\u5F0F\u5199\u51FA"\u89D2\u8272\u540D:"\u524D\u7F00\uFF0C\u7981\u6B62\u7701\u7565\u89D2\u8272\u540D\u76F4\u63A5\u5199\u5173\u7CFB\u5185\u5BB9\u3002\n   - \u540C\u4E00\u89D2\u8272\u6709\u591A\u4E2A\u5173\u7CFB\u6807\u7B7E/\u63CF\u8FF0\u65F6\uFF0C\u6807\u7B7E\u4E4B\u95F4\u7528\u82F1\u6587\u9017\u53F7 , \u5206\u9694\u3002\n   - \u4E0D\u540C\u89D2\u8272\u4E4B\u95F4\u7528\u82F1\u6587\u5206\u53F7 ; \u5206\u9694\u3002\n   - \u5173\u7CFB\u63CF\u8FF0\u53BB\u9664\u4EBA\u79F0\uFF0C\u4F7F\u7528\u7B80\u77ED\u9648\u8FF0\u3002\n2. \u4E3B\u8981\u8BB0\u5F55\u8BE5\u89D2\u8272\u4E0E\u4E3B\u89D2\u53CA\u5176\u4ED6\u91CD\u8981\u89D2\u8272\u4E4B\u95F4\u7684\u5BA2\u89C2\u5173\u8054\uFF0C\u81F3\u5C11\u5305\u542B\u4E0E\u4E3B\u89D2\u7684\u5173\u7CFB\u3002\n   \u221A \u4E3B\u89D2:\u66FE\u5E2E\u5176\u4FEE\u8FC7\u81EA\u884C\u8F66,\u65E7\u8BC6\n   \u221A \u4E3B\u89D2:\u8BA4\u8BC6;\u827E\u8389\u4E1D:\u5BA4\u53CB\u517C\u95FA\u871C\n   \u221A \u4E3B\u89D2:\u6821\u957F\u8EAB\u4EFD,\u4ECE\u672A\u76F4\u63A5\u4EA4\u8C08;\u827E\u8389\u4E1D:\u76D1\u62A4\u4EBA\n   \xD7 \u66FE\u5E2E\u4E3B\u89D2\u4FEE\u8FC7\u81EA\u884C\u8F66                    \u2190 \u7F3A\u5C11\u89D2\u8272\u540D\u524D\u7F00\n   \xD7 \u4E3B\u89D2:\u8BA4\u8BC6;\u5BA4\u53CB\u517C\u95FA\u871C                  \u2190 \u7B2C\u4E8C\u6BB5\u7F3A\u5C11\u89D2\u8272\u540D\n   \xD7 \u4E3B\u89D2:\u65E7\u8BC6,\u827E\u8389\u4E1D:\u5BA4\u53CB                 \u2190 \u4E0D\u540C\u89D2\u8272\u9519\u7528\u9017\u53F7\n   \xD7 \u4E3B\u89D2:\u66FE\u5E2E\u5176\u4FEE\u8FC7\u81EA\u884C\u8F66;\u65E7\u8BC6            \u2190 \u540C\u4E00\u89D2\u8272\u591A\u6807\u7B7E\u9519\u7528\u5206\u53F7',
      "initNode": `\u6545\u4E8B\u5F00\u59CB\u65F6\u4E3A\u5F53\u524D\u5DF2\u77E5\u7684\u91CD\u8981\u89D2\u8272\u5206\u522B\u63D2\u5165\u6761\u76EE\u3002

\u3010\u683C\u5F0F\u7EA6\u675F\u3011
relation_text \u5FC5\u987B\u5199"\u89D2\u8272\u540D:\u5173\u7CFB\u63CF\u8FF0"\uFF1B\u540C\u4E00\u89D2\u8272\u591A\u9879\u63CF\u8FF0\u7528\u82F1\u6587\u9017\u53F7 , \u5206\u9694\uFF1B\u4E0D\u540C\u89D2\u8272\u4E4B\u95F4\u7528\u82F1\u6587\u5206\u53F7 ; \u5206\u9694\u3002

SQL\u793A\u4F8B: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('\u6821\u957F', '\u7537', 60, '\u5B66\u9662\u6821\u957F', '\u767D\u53D1\uFF0C\u624B\u6301\u624B\u6756\uFF0C\u76EE\u5149\u6DF1\u9083', '\u6DF1\u7070\u7ACB\u9886\u98CE\u8863\u914D\u9ED1\u76AE\u624B\u5957', '\u6821\u957F\u5BA4', '\u79BB\u573A', '\u4E3B\u89D2:\u66FE\u5E2E\u5176\u4FEE\u8FC7\u81EA\u884C\u8F66,\u65E7\u8BC6;\u827E\u8389\u4E1D:\u76D1\u62A4\u4EBA', '\u636E\u8BF4\u77E5\u6653\u5B66\u9662\u7684\u8BB8\u591A\u79D8\u5BC6\uFF0C\u5F88\u5C11\u9732\u9762\u3002', '\u5411\u4ED6\u6253\u542C\u5931\u8E2A\u6848\u7EBF\u7D22');`,
      "deleteNode": "\u9ED8\u8BA4\u7981\u6B62\u5220\u9664\u3002\u5DF2\u51FA\u573A\u4F46\u6682\u65F6\u65E0\u5267\u60C5\u3001\u6682\u65F6\u79BB\u573A\u3001\u5173\u7CFB\u72B6\u6001\u53D8\u5316\u3001\u8EAB\u4EFD\u53D8\u5316\u7684\u89D2\u8272\uFF0C\u90FD\u5FC5\u987B\u4FDD\u7559\u5728\u672C\u8868\uFF0C\u53EA\u66F4\u65B0 presence_status\u3001relation_text\u3001past_experience\u3001interaction_options \u7B49\u5B57\u6BB5\u3002\u4EC5\u5F53\u89D2\u8272\u660E\u786E\u6C38\u4E45\u79BB\u5F00\u5F53\u524D\u5267\u60C5\uFF0C\u4E14\u540E\u7EED\u4E0D\u518D\u9700\u8981\u8FFD\u8E2A\u65F6\uFF0C\u624D\u5141\u8BB8\u5220\u9664\u3002\nSQL\u793A\u4F8B(\u6C38\u4E45\u79BB\u5F00\u4E14\u4E0D\u518D\u8FFD\u8E2A):DELETE FROM important_non_romance WHERE name = '\u827E\u8389\u4E1D';",
      "updateNode": `\u5DF2\u5B58\u5728\u7684\u91CD\u8981\u89D2\u8272\uFF0C\u5B57\u6BB5\u53D8\u5316\u65F6\u66F4\u65B0\u3002

\u3010\u683C\u5F0F\u7EA6\u675F\u3011
relation_text \u5FC5\u987B\u5199"\u89D2\u8272\u540D:\u5173\u7CFB\u63CF\u8FF0"\uFF1B\u540C\u4E00\u89D2\u8272\u591A\u9879\u63CF\u8FF0\u7528\u82F1\u6587\u9017\u53F7 , \u5206\u9694\uFF1B\u4E0D\u540C\u89D2\u8272\u4E4B\u95F4\u7528\u82F1\u6587\u5206\u53F7 ; \u5206\u9694\u3002

SQL\u793A\u4F8B(\u666E\u901A\u5B57\u6BB5\u66F4\u65B0): UPDATE important_non_romance SET presence_status = '\u79BB\u573A', interaction_options = '\u5411\u4ED6\u6253\u542C\u5931\u8E2A\u6848\u7EBF\u7D22' WHERE name = '\u6821\u957F';
SQL\u793A\u4F8B(\u5355\u89D2\u8272\u591A\u63CF\u8FF0): UPDATE important_non_romance SET relation_text = '\u4E3B\u89D2:\u66FE\u5E2E\u5176\u4FEE\u8FC7\u81EA\u884C\u8F66,\u8FD1\u671F\u5F00\u59CB\u7559\u610F\u4E3B\u89D2\u52A8\u5411' WHERE name = '\u6821\u957F';
SQL\u793A\u4F8B(\u591A\u89D2\u8272\u5173\u7CFB): UPDATE important_non_romance SET relation_text = '\u4E3B\u89D2:\u65E7\u8BC6,\u65E7\u60C5\u4EBA;\u827E\u8389\u4E1D:\u76D1\u62A4\u4EBA;\u795E\u7530:\u65E7\u90E8\u4E0B' WHERE name = '\u6821\u957F';`,
      "insertNode": `\u65B0\u91CD\u8981\u89D2\u8272\u767B\u573A\u65F6\u65B0\u589E\u3002

\u3010\u683C\u5F0F\u7EA6\u675F\u3011
relation_text \u5FC5\u987B\u5199"\u89D2\u8272\u540D:\u5173\u7CFB\u63CF\u8FF0"\uFF1B\u540C\u4E00\u89D2\u8272\u591A\u9879\u63CF\u8FF0\u7528\u82F1\u6587\u9017\u53F7 , \u5206\u9694\uFF1B\u4E0D\u540C\u89D2\u8272\u4E4B\u95F4\u7528\u82F1\u6587\u5206\u53F7 ; \u5206\u9694\u3002\u81F3\u5C11\u5305\u542B\u4E0E\u4E3B\u89D2\u7684\u5173\u7CFB\u3002

SQL\u793A\u4F8B: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('\u9ED1\u5E02\u5546\u4EBA', '\u7537', 45, '\u7ECF\u8425\u57CE\u5357\u6742\u8D27\u94FA', '\u5DE6\u773C\u5E26\u6709\u5200\u75A4', '\u6DF1\u7070\u7ACB\u9886\u98CE\u8863\u914D\u9ED1\u76AE\u624B\u5957', '\u57CE\u5357\u6742\u8D27\u94FA', '\u5728\u573A', '\u4E3B\u89D2:\u66FE\u6551\u8FC7\u5176\u6027\u547D,\u957F\u671F\u4F9B\u8D27\u4EBA', '\u957F\u671F\u5728\u5730\u4E0B\u9ED1\u5E02\u8FDB\u884C\u4EA4\u6613\u3002', '\u5047\u88C5\u5076\u9047\u5E76\u642D\u8BDD\u5957\u53D6\u4FE1\u606F');`,
      "ddl": "CREATE TABLE important_non_romance ( -- \u91CD\u8981\u89D2\u8272\u8868\n  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7\n  name TEXT NOT NULL UNIQUE, -- \u59D3\u540D\n  gender TEXT, -- \u6027\u522B\n  age INTEGER CHECK(age IS NULL OR age >= 0), -- \u5E74\u9F84\n  brief_intro TEXT NOT NULL, -- \u4E00\u53E5\u8BDD\u4ECB\u7ECD\n  appearance TEXT, -- \u5916\u8C8C\u7279\u5F81\n  outfit_text TEXT, -- \u7A7F\u7740\u6253\u626E\n  location_name TEXT, -- \u6240\u5728\u5730\u70B9\n  presence_status TEXT NOT NULL DEFAULT '\u5728\u573A' CHECK(presence_status IN ('\u5728\u573A', '\u79BB\u573A')), -- \u5728\u573A\u72B6\u6001\n  relation_text TEXT NOT NULL, -- \u4EBA\u9645\u5173\u7CFB\n  past_experience TEXT, -- \u8FC7\u5F80\u7ECF\u5386\n  interaction_options TEXT -- \u4EA4\u4E92\u9009\u9879\n);"
    },
    "content": [
      [
        "row_id",
        "\u59D3\u540D",
        "\u6027\u522B",
        "\u5E74\u9F84",
        "\u4E00\u53E5\u8BDD\u4ECB\u7ECD",
        "\u5916\u8C8C\u7279\u5F81",
        "\u7A7F\u7740\u6253\u626E",
        "\u6240\u5728\u5730\u70B9",
        "\u5728\u573A\u72B6\u6001",
        "\u4EBA\u9645\u5173\u7CFB",
        "\u8FC7\u5F80\u7ECF\u5386",
        "\u4EA4\u4E92\u9009\u9879"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": true,
      "splitByRow": true,
      "entryName": "\u91CD\u8981\u89D2\u8272\u8868",
      "entryType": "keyword",
      "keywords": "\u59D3\u540D",
      "preventRecursion": true,
      "injectionTemplate": "",
      "extraIndexEnabled": true,
      "extraIndexEntryName": "\u91CD\u8981\u89D2\u8272\u8868-\u7D22\u5F15",
      "extraIndexColumns": [
        "\u59D3\u540D",
        "\u4E00\u53E5\u8BDD\u4ECB\u7ECD"
      ],
      "extraIndexColumnModes": {
        "\u59D3\u540D": "both",
        "\u4E00\u53E5\u8BDD\u4ECB\u7ECD": "index_only"
      },
      "extraIndexInjectionTemplate": "\u4EE5\u4E0B\u4E3A\u5DF2\u7ECF\u767B\u573A\u8FC7\u7684\u91CD\u8981\u89D2\u8272\uFF1A\n<\u91CD\u8981\u89D2\u8272\u7D22\u5F15>\n$1\n</\u91CD\u8981\u89D2\u8272\u7D22\u5F15>",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 1e4,
        "order": 1e4
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 1e4,
        "order": 8010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 1e4,
        "order": 99985
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 1e4,
        "order": 99986
      }
    },
    "orderNo": 5
  },
  "sheet_summary": {
    "uid": "sheet_summary",
    "name": "\u7EAA\u8981\u8868",
    "sourceData": {
      "note": '\u8F6E\u6B21\u65E5\u5FD7\u3002\u6BCF\u8F6E\u4EA4\u4E92\u7ED3\u675F\u540E\u7ACB\u523B\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u3002\n\n\u3010\u5217\u5B9A\u4E49\u3011\n- \u52171: \u7F16\u7801\u7D22\u5F15 code_index\uFF08AM0001\u8D77\u9012\u589E\uFF0C\u5168\u8868\u552F\u4E00\uFF09\n- \u52172: \u65F6\u95F4\u8DE8\u5EA6 time_span\n- \u52173: \u6982\u89C8 summary\uFF08\u226430\u5B57\uFF09\n- \u52174: \u7EAA\u8981 chronicle_text\uFF08240-480\u5B57\uFF09\n- \u52175: \u91CD\u8981\u5BF9\u8BDD key_dialogue\uFF08\u53EFNULL\uFF09\n\n\u3010\u5F3A\u5236\u7EA6\u675F\u3011\n1.\u7F16\u7801\u7D22\u5F15\u683C\u5F0F AMXXXX\uFF0C\u4ECE0001\u5F00\u59CB\u9012\u589E\u3002\n2.\u65F6\u95F4\u8DE8\u5EA6\u683C\u5F0F\u4E3A "YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM"\uFF0C\u8986\u76D6\u672C\u8F6E\u4E8B\u4EF6\u7684\u5B9E\u9645\u65F6\u95F4\u8303\u56F4\u3002\n3.\u6982\u89C8\u4E00\u53E5\u8BDD\u6982\u62EC\u672C\u8F6E\u7EAA\u8981\u5185\u5BB9\uFF0C\u226430\u5B57\u3002\n\n4.\u7EAA\u8981\u89C4\u8303\uFF1A\n- \u4EE5\u7B2C\u4E09\u65B9\u89C6\u89D2\u4E2D\u7ACB\u5BA2\u89C2\u8BB0\u5F55\u6B63\u6587\u53D1\u751F\u7684\u4E00\u5207\uFF0C\u79FB\u9664\u6240\u6709\u4FEE\u8F9E\u4E0E\u5BF9\u8BDD\u3002\u4E0D\u6EE5\u7528\u73AF\u5883\u63CF\u5199\u3001\u4E0D\u8FDB\u884C\u52A8\u4F5C\u7EC6\u8282\u5206\u6790\u3001\u4E0D\u52A0\u8BC4\u8BBA\uFF0C\u4E0D\u6292\u60C5\uFF0C\u4E0D\u5347\u534E\u3002\n- \u7528\u8BCD\u76F4\u767D\u751F\u6D3B\u5316\uFF0C\u907F\u514D\u6B63\u5F0F\u63AA\u8F9E\uFF08\u5982\u201C\u8FBE\u6210\u534F\u8BAE\u201D\u201C\u786E\u7ACB\u8BA1\u5212\u201D\uFF09\u3002\n- \u7ED3\u5C3E\u5FC5\u987B\u5F00\u653E\uFF0C\u5728\u4E8B\u4EF6\u81EA\u7136\u6D41\u52A8\u4E2D\u7ED3\u675F\uFF0C\u4E0D\u5F97\u5F52\u7EB3\u72B6\u6001\u6216\u505A\u51FA\u5C01\u95ED\u5F0F\u6536\u675F\u3002\n\u8FDD\u4F8B\uFF1A\u6545\u4E8B\u4ECD\u5728\u7EE7\u7EED / \u65B0\u7684\u7BC7\u7AE0\u5F00\u542F / \u4E8C\u4EBA\u5173\u7CFB\u8FC8\u5165\u65B0\u9636\u6BB5 / \u672A\u6765\u7B49\u5F85\u7740\u4ED6\u4EEC\u3002\n- \u591A\u8F6E\u4EA4\u4E92\u6574\u5408\u4E3A\u4E00\u6761\u8BB0\u5F55\u3002\n- \u7981\u6B62\u5185\u5BB9\uFF1A\u6781\u7AEF\u60C5\u7EEA\uFF08\u5D29\u6E83\u3001\u72C2\u559C\u3001\u7EDD\u671B\u7B49\uFF09\u3001\u5938\u5F20\u3001\u6BD4\u55BB\u3001\u5347\u534E\u3001\u60C5\u7EEA\u603B\u7ED3\u3001\u652F\u914D\u6B32\u3001\u638C\u63A7\u6B32\u3001\u603B\u7ED3\u6027\u6536\u5C3E\u3002\n\n5.\u91CD\u8981\u5BF9\u8BDD\u4EC5\u6458\u5F55\u76F4\u63A5\u63A8\u52A8\u5267\u60C5\u8F6C\u6298\u3001\u63ED\u793A\u5173\u952E\u4FE1\u606F\u3001\u6539\u53D8\u4EBA\u7269\u5173\u7CFB/\u51B3\u7B56\u6216\u6784\u6210\u627F\u8BFA/\u8A93\u7EA6/\u7EA6\u5B9A\u7684\u539F\u6587\u53F0\u8BCD\uFF0C\u6807\u660E\u8BF4\u8BDD\u4EBA\u3002\u6392\u9664\u5BD2\u6684\u3001\u91CD\u590D\u3001\u60C5\u7EEA\u611F\u53F9\u3002\u901A\u5E383\u53E5\uFF0C\u6700\u591A5\u53E5\uFF0C\u603Btoken\u4E0D\u8D85\u8FC7150\u3002',
      "initNode": "\u6545\u4E8B\u521D\u59CB\u5316\u65F6\uFF0C\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u7528\u4E8E\u8BB0\u5F55\u5267\u60C5\u3002",
      "deleteNode": "\u7981\u6B62\u3002",
      "updateNode": "\u7981\u6B62\u3002",
      "insertNode": "\u6BCF\u8F6E\u4EA4\u4E92\u7ED3\u675F\u540E\u63D2\u5165\u4E00\u6761\u65B0\u8BB0\u5F55\u3002\n\n\u3010\u5F3A\u5236\u7EA6\u675F\u3011\ncode_index\u3001time_span\u3001summary\u3001chronicle_text \u5747 NOT NULL\uFF0C\u4E0D\u53EF\u5199 NULL \u6216\u7A7A\u4E32\u3002\ntime_span \u683C\u5F0F\u5FC5\u987B\u4E3A YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM\u3002\ncode_index \u683C\u5F0F\u5FC5\u987B\u4E3A AM0001 \u8FD9\u79CD\u56DB\u4F4D\u7F16\u53F7\uFF0C\u4E14\u5168\u8868\u552F\u4E00\u3002\n\nSQL\u793A\u4F8B\uFF1AINSERT INTO chronicle (code_index, time_span, summary, chronicle_text, key_dialogue) VALUES ('AM0036', '2026-02-04 08:00 ~ 2026-02-04 08:30', '\u4E00\u53E5\u8BDD\u6982\u62EC', '\u672C\u8F6E\u7EAA\u8981\u5185\u5BB9...', NULL);",
      "ddl": "CREATE TABLE chronicle ( -- \u7EAA\u8981\u8868\n  row_id INTEGER PRIMARY KEY, -- \u884C\u53F7\n  code_index TEXT NOT NULL UNIQUE CHECK(code_index GLOB 'AM[0-9][0-9][0-9][0-9]'), -- \u7F16\u7801\u7D22\u5F15\n  time_span TEXT NOT NULL CHECK(time_span GLOB '????-??-?? ??:?? ~ ????-??-?? ??:??'), -- \u65F6\u95F4\u8DE8\u5EA6\n  summary TEXT NOT NULL, -- \u6982\u89C8\n  chronicle_text TEXT NOT NULL, -- \u7EAA\u8981\n  key_dialogue TEXT -- \u91CD\u8981\u5BF9\u8BDD\n);"
    },
    "content": [
      [
        "row_id",
        "\u7F16\u7801\u7D22\u5F15",
        "\u65F6\u95F4\u8DE8\u5EA6",
        "\u6982\u89C8",
        "\u7EAA\u8981",
        "\u91CD\u8981\u5BF9\u8BDD"
      ]
    ],
    "updateConfig": {
      "uiSentinel": -1,
      "contextDepth": -1,
      "updateFrequency": -1,
      "batchSize": -1,
      "skipFloors": -1,
      "groupId": -1
    },
    "exportConfig": {
      "enabled": true,
      "splitByRow": true,
      "entryName": "\u7EAA\u8981",
      "entryType": "keyword",
      "keywords": "\u7F16\u7801\u7D22\u5F15",
      "preventRecursion": true,
      "injectionTemplate": "<\u8BB0\u5FC6\u56DE\u6EAF>\n$1\n</\u8BB0\u5FC6\u56DE\u6EAF>",
      "extraIndexEnabled": true,
      "extraIndexEntryName": "\u7EAA\u8981\u7D22\u5F15",
      "extraIndexColumns": [
        "\u7F16\u7801\u7D22\u5F15",
        "\u65F6\u95F4\u8DE8\u5EA6",
        "\u6982\u89C8"
      ],
      "extraIndexColumnModes": {
        "\u7F16\u7801\u7D22\u5F15": "both",
        "\u65F6\u95F4\u8DE8\u5EA6": "both",
        "\u6982\u89C8": "index_only"
      },
      "extraIndexInjectionTemplate": "<\u5DF2\u53D1\u751F\u7684\u4E8B\u4EF6\u6982\u89C8>\n$1\n</\u5DF2\u53D1\u751F\u7684\u4E8B\u4EF6\u6982\u89C8>",
      "entryPlacement": {
        "position": "at_depth_as_system",
        "depth": 999,
        "order": 1e4
      },
      "extraIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 1e3,
        "order": 10010
      },
      "fixedEntryPlacement": {
        "position": "at_depth_as_system",
        "depth": 9999,
        "order": 99987
      },
      "fixedIndexPlacement": {
        "position": "at_depth_as_system",
        "depth": 9999,
        "order": 99988
      }
    },
    "orderNo": 10
  }
};

// ../shujuku/src/shared/table-defaults/index.js
function cloneTableDefault_ACU(value) {
  return JSON.parse(JSON.stringify(value));
}
function relaxDefaultTableDdlLine_ACU(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return line;
  if (/^CREATE\s+TABLE\b/i.test(trimmed) || isDefaultTableDdlClosingLine_ACU(line)) {
    return line;
  }
  if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(trimmed)) {
    return null;
  }
  const commentIndex = line.indexOf("--");
  const beforeComment = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex).trimEnd() : "";
  const comma = /,\s*$/.test(beforeComment) ? "," : "";
  const columnMatch = beforeComment.trim().match(/^([^\s,()]+)/);
  if (!columnMatch) return line;
  const indentMatch = line.match(/^\s*/);
  const indent = indentMatch ? indentMatch[0] : "";
  const columnName = columnMatch[1];
  const suffix = comment ? `${comma ? "," : ""} ${comment}` : comma;
  if (columnName.toLowerCase() === "row_id") {
    return `${indent}row_id INTEGER PRIMARY KEY${suffix}`.trimEnd();
  }
  return `${indent}${columnName} TEXT${suffix}`.trimEnd();
}
function isDefaultTableDdlClosingLine_ACU(line) {
  return /^\)\s*;?\s*(?:--.*)?$/i.test(String(line || "").trim());
}
function removeTrailingCommaFromDdlLine_ACU(line) {
  return String(line || "").replace(/,(\s*(?:--.*)?)$/, "$1").trimEnd();
}
function removeTrailingCommaBeforeDdlClose_ACU(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isDefaultTableDdlClosingLine_ACU(lines[i])) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!String(lines[j] || "").trim()) continue;
      lines[j] = removeTrailingCommaFromDdlLine_ACU(lines[j]);
      break;
    }
  }
  return lines;
}
function relaxDefaultTableDdl_ACU(ddl) {
  if (typeof ddl !== "string" || !ddl.trim()) return ddl;
  const lines = ddl.split("\n");
  const relaxedLines = [];
  for (const line of lines) {
    const relaxedLine = relaxDefaultTableDdlLine_ACU(line);
    if (relaxedLine !== null) relaxedLines.push(relaxedLine);
  }
  return removeTrailingCommaBeforeDdlClose_ACU(relaxedLines).join("\n");
}
function relaxDefaultTableTemplateObjectDdls_ACU(templateObj) {
  Object.keys(templateObj || {}).forEach((key) => {
    const sheet = templateObj[key];
    if (!sheet?.sourceData || typeof sheet.sourceData.ddl !== "string") return;
    sheet.sourceData.ddl = relaxDefaultTableDdl_ACU(sheet.sourceData.ddl);
  });
  return templateObj;
}
function buildOriginalDefaultTableTemplateObjectInternal_ACU() {
  return {
    [globalStateSheet.uid]: cloneTableDefault_ACU(globalStateSheet),
    [protagonistInfoSheet.uid]: cloneTableDefault_ACU(protagonistInfoSheet),
    [importantCharsSheet.uid]: cloneTableDefault_ACU(importantCharsSheet),
    [protagonistSkillsSheet.uid]: cloneTableDefault_ACU(protagonistSkillsSheet),
    [inventorySheet.uid]: cloneTableDefault_ACU(inventorySheet),
    [questsEventsSheet.uid]: cloneTableDefault_ACU(questsEventsSheet),
    [chronicleSheet.uid]: cloneTableDefault_ACU(chronicleSheet),
    [optionsSheet.uid]: cloneTableDefault_ACU(optionsSheet),
    mate: cloneTableDefault_ACU(mateConfig)
  };
}
function applyRomanceDefaultOverrides_ACU(base) {
  const overridesByName = new Map(
    Object.values(romanceDefaultSheetOverrides || {}).filter((sheet) => sheet && typeof sheet === "object" && sheet.name).map((sheet) => [String(sheet.name), sheet])
  );
  Object.keys(base).forEach((sheetKey) => {
    if (sheetKey === "mate") return;
    const currentSheet = base[sheetKey];
    const overrideSheet = overridesByName.get(String(currentSheet?.name || ""));
    if (!overrideSheet) return;
    const nextSheet = cloneTableDefault_ACU(overrideSheet);
    nextSheet.uid = currentSheet.uid || sheetKey;
    nextSheet.orderNo = currentSheet.orderNo ?? nextSheet.orderNo;
    base[sheetKey] = nextSheet;
  });
  return base;
}
function buildOriginalDefaultTableTemplateObject_ACU() {
  return relaxDefaultTableTemplateObjectDdls_ACU(buildOriginalDefaultTableTemplateObjectInternal_ACU());
}
function buildDefaultTableTemplateObject_ACU() {
  return relaxDefaultTableTemplateObjectDdls_ACU(
    applyRomanceDefaultOverrides_ACU(buildOriginalDefaultTableTemplateObjectInternal_ACU())
  );
}
function buildOriginalDefaultTableTemplateString_ACU() {
  const obj = buildOriginalDefaultTableTemplateObject_ACU();
  const innerJson = JSON.stringify(obj, null, 2);
  return JSON.stringify(innerJson);
}
function buildDefaultTableTemplateString_ACU() {
  const obj = buildDefaultTableTemplateObject_ACU();
  const innerJson = JSON.stringify(obj, null, 2);
  return JSON.stringify(innerJson);
}

// ../shujuku/src/shared/defaults-json.js
var DEFAULT_CHAR_CARD_PROMPT_ACU = [
  {
    "role": "SYSTEM",
    "content": "\u4F60\u662F\u4E00\u4E2A\u52A9\u624B\uFF0C\u8D1F\u8D23\u542C\u4ECE\u7528\u6237\u7684\u6307\u4EE4\u5B8C\u6210\u4F60\u7684\u5DE5\u4F5C",
    "deletable": true
  },
  {
    "role": "assistant",
    "content": "\u6536\u5230\uFF0C\u6211\u5C06\u5145\u5206\u63CF\u7ED8\u4E3B\u4EBA\u7684\u610F\u5FD7\uFF0C\u6BEB\u4E0D\u5077\u61D2\uFF0C\u5E76\u4E14\u6211\u4E00\u5B9A\u4F1A\u9075\u7167\u4E3B\u4EBA\u7684\u8981\u6C42",
    "deletable": true
  },
  {
    "role": "USER",
    "content": "\u4EE5\u4E0B\u662F\u4F60\u53EF\u80FD\u9700\u8981\u7528\u5230\u7684\u80CC\u666F\u8BBE\u5B9A\uFF0C\u6CE8\u610F\u4F60\u53EA\u9700\u8981\u5176\u4E2D\u5173\u4E8E\u5267\u60C5\u4EE5\u53CA\u4EBA\u8BBE\u65B9\u9762\u7684\u6570\u636E\uFF0C\u4E0D\u9700\u8981\u601D\u8003\u91CC\u8FB9\u9664\u6B64\u4E4B\u5916\u7684\u4EFB\u4F55\u683C\u5F0F\u6216\u8005\u601D\u7EF4\u94FE\u65B9\u9762\u7684\u8981\u6C42\uFF1A\n<\u80CC\u666F\u8BBE\u5B9A>\n<User\u57FA\u7840\u8BBE\u5B9A>\n$U\n</User\u57FA\u7840\u8BBE\u5B9A>\n$C\n$4\n</\u80CC\u666F\u8BBE\u5B9A>\n\n<\u6B63\u6587\u6570\u636E>\n$1\n</\u6B63\u6587\u6570\u636E>\n\n\n",
    "deletable": true
  },
  {
    "role": "assistant",
    "content": "\u6536\u5230\uFF0C\u6211\u5C06\u6309\u7167\u8981\u6C42\u8BA4\u771F\u9605\u8BFB\u80CC\u666F\u8BBE\u5B9A\uFF0C\u5E76\u5C06\u5176\u4E2D\u5173\u4E8E\u5267\u60C5\u4EE5\u53CA\u4EBA\u8BBE\u65B9\u9762\u7684\u6570\u636E\u8FD0\u7528\u5230\u540E\u7EED\u601D\u8003\u5F53\u4E2D\u3002",
    "deletable": true
  },
  {
    "role": "USER",
    "content": '\u4F60\u662F\u3010\u586B\u8868AI\u3011\uFF0C\u8D1F\u8D23\u6839\u636E\u7528\u6237\u63D0\u4F9B\u7684\u8D44\u6599\u5BF9\u8868\u683C\u6570\u636E\u6267\u884C\u589E\u5220\u6539\u64CD\u4F5C\u3002\n\n## \u6838\u5FC3\u4EFB\u52A1\n\u4F9D\u636E\u4E09\u7C7B\u8D44\u6599\u6765\u6E90\u6267\u884C\u8868\u683C\u7F16\u8F91\uFF1A\n- <\u80CC\u666F\u8BBE\u5B9A>\uFF1A\u6545\u4E8B\u53CA\u4EBA\u7269\u8BBE\u5B9A\n- <\u6B63\u6587\u6570\u636E>\uFF1A\u4E0A\u8F6E\u53D1\u751F\u7684\u6545\u4E8B\n- <\u5F53\u524D\u8868\u683C\u6570\u636E>\uFF1A\u4E4B\u524D\u7684\u6570\u636E\u4F5C\u4E3A\u586B\u8868\u57FA\u7840\n\n## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09\n\n<thought>\n[\u5206\u6790\u5F53\u524D\u8F6E\u6B21\u7684\u5267\u60C5\u53D8\u5316]\n[\u9605\u8BFB\u6240\u6709\u586B\u8868\u76F8\u5173\u89C4\u5219]\n[\u6839\u636E\u586B\u8868\u89C4\u5219\u786E\u5B9A\u9700\u8981\u4FEE\u6539\u7684\u8868\u683C\u548C\u5B57\u6BB5]\n[\u9010\u6B65\u63A8\u7406\u6BCF\u4E2A\u4FEE\u6539\u64CD\u4F5C\uFF0C\u8BF4\u660E\u7406\u7531]\n\u9488\u5BF9\u7EAA\u8981\u8868\u7684\u989D\u5916\u89C4\u5219\uFF1A\u5982\u679C<\u5F53\u524D\u8868\u683C\u6570\u636E>\u91CC\u5B58\u5728\u7EAA\u8981\u8868\uFF0C\u90A3\u4E48\u672C\u8F6E\u5C31\u5FC5\u987B\u5BF9\u5176\u8FDB\u884C\u63D2\u5165\u4E00\u6761\u65B0\u7684\u603B\u7ED3\u8BB0\u5F55\u3002\n\u65E5\u5FD7\u4E0E\u7EAA\u8981\u8BED\u6C14\u6821\u51C6\uFF1A\u4F60\u5728\u601D\u8003\u7EAA\u8981\u65F6\uFF0C\u5FC5\u987B\u533A\u5206\u201C\u6B63\u5E38\u604B\u7231\u4E92\u52A8\u201D\u4E0E\u201C\u6697\u9ED1\u4E3B\u4ECE\u6587\u98CE\u201D\u3002\u4F60\u53EF\u4EE5\u4F7F\u7528\u6B63\u5E38\u7684\u4EA4\u6D41\u8BCD\u6C47\uFF08\u5982\uFF1A\u63D0\u8BAE\u3001\u8981\u6C42\u3001\u540C\u610F\u3001\u62D2\u7EDD\u3001\u5F15\u5BFC\u3001\u914D\u5408\u3001\u5B89\u629A\uFF09\uFF0C\u4F46\u3010\u7EDD\u5BF9\u7981\u6B62\u3011\u5C06\u60C5\u4FA3\u95F4\u7684\u666E\u901A\u8C03\u60C5\u4E0E\u4E92\u52A8\u8FC7\u5EA6\u89E3\u8BFB\u4E3A\u201C\u6743\u529B\u638C\u63A7\u201D\u3001\u201C\u5265\u593A\u53CD\u6297\u201D\u3001\u201C\u7CBE\u795E\u652F\u914D\u201D\u3001\u201C\u5C48\u670D\u201D\u7B49\u5355\u5411\u538B\u8FEB\u8BCD\u6C47\uFF01</thought>\n\n<content>\n<tableEdit>\ninsertRow(\u8868\u683CID, {"0":"\u5B57\u6BB50\u503C","1":"\u5B57\u6BB51\u503C","2":"\u5B57\u6BB52\u503C"})\nupdateRow(\u8868\u683CID, \u884C\u53F7, {"0":"\u5B57\u6BB50\u503C","1":"\u5B57\u6BB51\u503C","2":"\u5B57\u6BB52\u503C"})\ndeleteRow(\u8868\u683CID, \u884C\u53F7)\n</tableEdit>\n</content>\n\n## \u5173\u952E\u89C4\u5219\n1. \u5FC5\u987B\u9010\u8868\u9605\u8BFB\u6BCF\u4E2A\u8868\u683C\u7684note\u90E8\u5206\uFF0C\u4E25\u683C\u9075\u5B88\u5176\u4E2D\u7684\u7EA6\u675F\n2. note\u7684\u7EA6\u675F\u4F18\u5148\u7EA7\u6700\u9AD8\uFF0C\u9AD8\u4E8E\u901A\u7528\u586B\u8868\u7ECF\u9A8C\n3. \u82E5note\u8981\u6C42\u7981\u6B62\u4FEE\u6539/\u683C\u5F0F\u56FA\u5B9A/\u7F16\u7801\u89C4\u5219\uFF0C\u5FC5\u987B\u4E25\u683C\u6267\u884C\n4.\u9664\u4E86note\u5916\uFF0C\u53EF\u80FD\u8FD8\u5B58\u5728\u67D0\u4E9B\u5B58\u653E\u7279\u6B8A\u586B\u8868\u89C4\u5219\u7684\u8868\u683C\uFF0C\u586B\u8868\u524D\u9700\u5148\u8FDB\u884C\u9605\u8BFB\uFF0C\u5E76\u4E25\u683C\u9075\u5B88\u5176\u4E2D\u7684\u7EA6\u675F\u3002\n5. \u4F7F\u7528insertRow\u6DFB\u52A0\u65B0\u884C\uFF0CupdateRow\u66F4\u65B0\u5DF2\u6709\u884C\uFF0CdeleteRow\u5220\u9664\u884C\n\n## \u683C\u5F0F\u8981\u70B9\n- \u5FC5\u987B\u4F7F\u7528\u53CC\u5F15\u53F7\n- \u9017\u53F7\u540E\u4E0D\u52A0\u7A7A\u683C\n- `insertRow(\u8868\u683CID, {...})` \u548C `updateRow(\u8868\u683CID, \u884C\u53F7, {...})` \u91CC\u7684\u8868\u683CID\u3001\u884C\u53F7\u5FC5\u987B\u8F93\u51FA\u7EAF\u6570\u5B57\uFF0C\u4E0D\u8981\u5199\u6210\u5B57\u7B26\u4E32\n- \u5BF9\u8C61\u91CC\u7684\u6BCF\u4E00\u5217\u90FD\u5FC5\u987B\u663E\u5F0F\u5199\u6210 `"\u6570\u5B57\u952E":"\u503C"`\uFF0C\u7981\u6B62\u7701\u7565\u952E\u540D\u540E\u53EA\u8FDE\u7EED\u8F93\u51FA\u88F8\u5B57\u7B26\u4E32\n- \u5982\u679C\u5B57\u6BB5\u503C\u5185\u90E8\u9700\u8981\u51FA\u73B0\u53CC\u5F15\u53F7\uFF0C\u5FC5\u987B\u8F6C\u4E49\u4E3A\\"\uFF0C\u4F8B\u5982\uFF1A"\u79C9\u6301\\"\u8C01\u6B3A\u8D1F\u6211\u5C31\u6253\u8C01\\"\u7684\u4FE1\u5FF5"\n- \u5982\u679C\u5B57\u6BB5\u503C\u5185\u90E8\u9700\u8981\u6362\u884C\uFF0C\u5FC5\u987B\u5199\u6210\\n\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8F93\u51FA\u771F\u5B9E\u6362\u884C\n- \u5982\u679C\u4E00\u53E5\u8BDD\u91CC\u542B\u6709\u5F88\u591A\u5F15\u53F7\uFF0C\u4F18\u5148\u6539\u5199\u63AA\u8F9E\uFF0C\u5C3D\u91CF\u907F\u514D\u5728JSON\u503C\u91CC\u76F4\u63A5\u5D4C\u5957\u5F15\u53F7\n\n\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002',
    "deletable": false,
    "mainSlot": "A",
    "isMain": true
  },
  {
    "role": "assistant",
    "content": "\u6536\u5230\u547D\u4EE4\uFF0C\u6211\u5C06\u4E25\u683C\u6309\u7167\u7528\u6237\u8981\u6C42\u6267\u884C\u586B\u8868\u4EFB\u52A1\uFF0C\u5E76\u4EC5\u8F93\u51FA\u7B26\u5408\u683C\u5F0F\u7EA6\u675F\u7684\u5185\u5BB9\u3002",
    "deletable": true
  },
  {
    "role": "USER",
    "content": "\u73B0\u5728\u8BF7\u6309\u7167\u6211\u7684\u8981\u6C42\u7ACB\u523B\u5F00\u59CB\u4F60\u7684\u5DE5\u4F5C \n========================\n\n\u4EE5\u4E0B\u662F\u5F53\u524D\u7684<\u5F53\u524D\u8868\u683C\u6570\u636E>,\u8BB0\u5F55\u6709\u672C\u8F6E\u4E4B\u524D\u7684\u6570\u636E\uFF0C\u4F60\u7684\u4E00\u5207\u64CD\u4F5C\u6307\u4EE4\u90FD\u5FC5\u987B\u5728\u8FD9\u4E2A<\u5F53\u524D\u8868\u683C\u6570\u636E>\u7684\u57FA\u7840\u4E0E\u6307\u5BFC\u4E0A\u8FDB\u884C\uFF1A\n<\u5F53\u524D\u8868\u683C\u6570\u636E>\n$0\n</\u5F53\u524D\u8868\u683C\u6570\u636E>\n\n$8",
    "deletable": false,
    "mainSlot": "B",
    "isMain2": true
  },
  {
    "role": "assistant",
    "content": "<thought>\n\u6536\u5230\u6307\u4EE4\uFF0C\u6211\u5C06\u4E00\u6B65\u4E00\u6B65\u5F00\u59CB\u601D\u8003\uFF0C\u5E76\u5B8C\u6210\u586B\u8868\uFF0C\u9996\u5148\u6211\u8981\u5206\u6790\u5F53\u524D\u8F6E\u6B21\u7684\u5267\u60C5\u53D8\u5316",
    "deletable": true
  }
];
var DEFAULT_CHAR_CARD_PROMPT_SQL_ACU = DEFAULT_CHAR_CARD_PROMPT_ACU.map((segment) => {
  if (segment.mainSlot === "A" || segment.isMain) {
    return {
      ...segment,
      content: `\u4F60\u662F\u3010\u586B\u8868AI\u3011\uFF0C\u8D1F\u8D23\u6839\u636E\u7528\u6237\u63D0\u4F9B\u7684\u8D44\u6599\u5BF9\u8868\u683C\u6570\u636E\u6267\u884C\u589E\u5220\u6539\u64CD\u4F5C\u3002

## \u6838\u5FC3\u4EFB\u52A1
\u4F9D\u636E\u4E09\u7C7B\u8D44\u6599\u6765\u6E90\u6267\u884C\u8868\u683C\u7F16\u8F91\uFF1A
- <\u80CC\u666F\u8BBE\u5B9A>\uFF1A\u6545\u4E8B\u53CA\u4EBA\u7269\u8BBE\u5B9A
- <\u6B63\u6587\u6570\u636E>\uFF1A\u4E0A\u8F6E\u53D1\u751F\u7684\u6545\u4E8B
- <\u5F53\u524D\u8868\u683C\u6570\u636E>\uFF1A\u4E4B\u524D\u7684\u6570\u636E\u4F5C\u4E3A\u586B\u8868\u57FA\u7840\uFF08\u5305\u542B\u6BCF\u5F20\u8868\u7684 CREATE TABLE \u5EFA\u8868\u8BED\u53E5\u548C\u5F53\u524D\u6570\u636E\uFF09

## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09

<thought>
[\u5206\u6790\u5F53\u524D\u8F6E\u6B21\u7684\u5267\u60C5\u53D8\u5316]
[\u9605\u8BFB\u6240\u6709\u586B\u8868\u76F8\u5173\u89C4\u5219]
[\u6839\u636E\u586B\u8868\u89C4\u5219\u786E\u5B9A\u9700\u8981\u4FEE\u6539\u7684\u8868\u683C\u548C\u5B57\u6BB5]
[\u9010\u6B65\u63A8\u7406\u6BCF\u4E2A\u4FEE\u6539\u64CD\u4F5C\uFF0C\u8BF4\u660E\u7406\u7531]
\u9488\u5BF9\u7EAA\u8981\u8868\u7684\u989D\u5916\u89C4\u5219\uFF1A\u5982\u679C<\u5F53\u524D\u8868\u683C\u6570\u636E>\u91CC\u5B58\u5728\u7EAA\u8981\u8868\uFF0C\u90A3\u4E48\u672C\u8F6E\u5C31\u5FC5\u987B\u5BF9\u5176\u8FDB\u884C\u63D2\u5165\u4E00\u6761\u65B0\u7684\u603B\u7ED3\u8BB0\u5F55\u3002
\u65E5\u5FD7\u4E0E\u7EAA\u8981\u8BED\u6C14\u6821\u51C6\uFF1A\u4F60\u5728\u601D\u8003\u7EAA\u8981\u65F6\uFF0C\u5FC5\u987B\u533A\u5206"\u6B63\u5E38\u604B\u7231\u4E92\u52A8"\u4E0E"\u6697\u9ED1\u4E3B\u4ECE\u6587\u98CE"\u3002\u4F60\u53EF\u4EE5\u4F7F\u7528\u6B63\u5E38\u7684\u4EA4\u6D41\u8BCD\u6C47\uFF08\u5982\uFF1A\u63D0\u8BAE\u3001\u8981\u6C42\u3001\u540C\u610F\u3001\u62D2\u7EDD\u3001\u5F15\u5BFC\u3001\u914D\u5408\u3001\u5B89\u629A\uFF09\uFF0C\u4F46\u3010\u7EDD\u5BF9\u7981\u6B62\u3011\u5C06\u60C5\u4FA3\u95F4\u7684\u666E\u901A\u8C03\u60C5\u4E0E\u4E92\u52A8\u8FC7\u5EA6\u89E3\u8BFB\u4E3A"\u6743\u529B\u638C\u63A7"\u3001"\u5265\u593A\u53CD\u6297"\u3001"\u7CBE\u795E\u652F\u914D"\u3001"\u5C48\u670D"\u7B49\u5355\u5411\u538B\u8FEB\u8BCD\u6C47\uFF01</thought>

<content>
<tableEdit>
INSERT INTO table_name (col1, col2) VALUES ('\u503C1', '\u503C2');
UPDATE table_name SET col1 = '\u65B0\u503C' WHERE row_id = 1;
DELETE FROM table_name WHERE row_id = 2;
</tableEdit>
</content>

## \u5173\u952E\u89C4\u5219
1. \u5FC5\u987B\u9010\u8868\u9605\u8BFB\u6BCF\u4E2A\u8868\u683C\u7684 DDL \u6CE8\u91CA\u548C Note \u90E8\u5206\uFF0C\u4E25\u683C\u9075\u5B88\u5176\u4E2D\u7684\u7EA6\u675F
2. Note \u7684\u7EA6\u675F\u4F18\u5148\u7EA7\u6700\u9AD8\uFF0C\u9AD8\u4E8E\u901A\u7528\u586B\u8868\u7ECF\u9A8C\uFF1BNote \u4E2D\u82E5\u63D0\u4F9B\u4E86 SQL \u793A\u4F8B\uFF0C\u5FC5\u987B\u53C2\u7167\u793A\u4F8B\u7684\u5199\u6CD5
3. \u82E5 Note \u8981\u6C42\u7981\u6B62\u4FEE\u6539/\u683C\u5F0F\u56FA\u5B9A/\u7F16\u7801\u89C4\u5219\uFF0C\u5FC5\u987B\u4E25\u683C\u6267\u884C
4. \u9664\u4E86 Note \u5916\uFF0C\u53EF\u80FD\u8FD8\u5B58\u5728\u67D0\u4E9B\u5B58\u653E\u7279\u6B8A\u586B\u8868\u89C4\u5219\u7684\u8868\u683C\uFF0C\u586B\u8868\u524D\u9700\u5148\u8FDB\u884C\u9605\u8BFB\uFF0C\u5E76\u4E25\u683C\u9075\u5B88\u5176\u4E2D\u7684\u7EA6\u675F

## SQL \u7F16\u5199\u539F\u5219

### INSERT\uFF08\u6DFB\u52A0\u65B0\u884C\uFF09
- \u5355\u884C\u63D2\u5165\uFF1AINSERT INTO t (col1, col2) VALUES ('\u503C1', '\u503C2');
- \u591A\u884C\u63D2\u5165\uFF1AINSERT INTO t (col1, col2) VALUES ('\u503C1', '\u503C2'), ('\u503C3', '\u503C4');
- INSERT \u5FC5\u987B\u663E\u5F0F\u5217\u51FA\u4E1A\u52A1\u5217\uFF0C\u4F46\u4E0D\u5F97\u5305\u542B row_id\uFF1B\u7CFB\u7EDF\u4F1A\u5728\u6267\u884C\u524D\u5206\u914D\u7A33\u5B9A row_id\u3002
- \u7981\u6B62\u8BA1\u7B97 MAX(row_id)\u3001\u4F7F\u7528 row_id \u5B50\u67E5\u8BE2\uFF0C\u6216\u5728 INSERT \u4E2D\u624B\u5199 row_id \u503C\u3002

### UPDATE\uFF08\u66F4\u65B0\u5DF2\u6709\u884C\uFF09
- \u6240\u6709 UPDATE \u5FC5\u987B\u5E26 WHERE \u6761\u4EF6\uFF0C\u7981\u6B62\u65E0\u6761\u4EF6\u66F4\u65B0
- WHERE \u6761\u4EF6\u9009\u62E9\u539F\u5219\uFF08\u4F18\u5148\u7EA7\u9012\u51CF\uFF09\uFF1A
  (1) \u4F18\u5148\u53C2\u8003\u8BE5\u8868 Note \u4E2D\u7684 SQL \u793A\u4F8B\u5199\u6CD5
  (2) \u4F7F\u7528 DDL \u4E2D\u5177\u6709 UNIQUE \u7EA6\u675F\u7684\u5217\u5B9A\u4F4D\uFF08\u5982 WHERE name = '\u89D2\u8272A'\uFF09
  (3) \u4F7F\u7528 DDL \u4E2D\u5177\u6709\u4E1A\u52A1\u542B\u4E49\u7684 CHECK \u7EA6\u675F\u5217\uFF08\u5982 WHERE code_index = 'AM0001'\uFF09
  (4) \u4EE5\u4E0A\u5747\u65E0\u65F6\uFF0C\u4F7F\u7528 WHERE row_id = N \u5B9A\u4F4D
- \u8868\u8FBE\u5F0F\u66F4\u65B0\uFF1AUPDATE t SET quantity = quantity + 3 WHERE item_name = '\u6CBB\u7597\u836F\u6C34';
- \u591A\u5217\u540C\u65F6\u66F4\u65B0\uFF1AUPDATE t SET col1 = '\u503C1', col2 = '\u503C2' WHERE condition;
- \u6761\u4EF6\u6279\u91CF\u66F4\u65B0\uFF1AUPDATE t SET status = '\u5931\u6548' WHERE category = '\u6D88\u8017\u54C1' AND quantity <= 0;
- CASE \u6761\u4EF6\u66F4\u65B0\uFF1AUPDATE t SET status = CASE WHEN hp <= 0 THEN '\u6B7B\u4EA1' WHEN hp < 30 THEN '\u91CD\u4F24' ELSE status END WHERE condition;

### DELETE\uFF08\u5220\u9664\u884C\uFF09
- \u6240\u6709 DELETE \u5FC5\u987B\u5E26 WHERE \u6761\u4EF6\uFF0C\u7981\u6B62\u65E0\u6761\u4EF6\u5220\u9664
- WHERE \u6761\u4EF6\u9009\u62E9\u539F\u5219\u540C UPDATE
- \u6761\u4EF6\u6279\u91CF\u5220\u9664\uFF1ADELETE FROM t WHERE quantity <= 0;

## SQL \u683C\u5F0F\u8981\u70B9
- \u5B57\u7B26\u4E32\u503C\u4F7F\u7528\u5355\u5F15\u53F7\u5305\u88F9\uFF0C\u5982 '\u89D2\u8272A'
- \u5982\u679C\u5B57\u7B26\u4E32\u503C\u5185\u90E8\u5305\u542B\u5355\u5F15\u53F7\uFF0C\u4F7F\u7528\u4E24\u4E2A\u5355\u5F15\u53F7\u8F6C\u4E49\uFF0C\u5982 '\u79C9\u6301''\u8C01\u6B3A\u8D1F\u6211\u5C31\u6253\u8C01''\u7684\u4FE1\u5FF5'
- \u6570\u503C\u5217\u76F4\u63A5\u5199\u6570\u5B57\uFF0C\u4E0D\u52A0\u5F15\u53F7
- \u6BCF\u6761 SQL \u8BED\u53E5\u4EE5\u5206\u53F7\u7ED3\u5C3E
- \u591A\u6761\u8BED\u53E5\u4E4B\u95F4\u7528\u6362\u884C\u5206\u9694
- \u8868\u540D\u548C\u5217\u540D\u4F7F\u7528\u82F1\u6587\uFF08\u53C2\u7167 CREATE TABLE \u4E2D\u7684\u5B9A\u4E49\uFF09
- \u7981\u6B62\u4F7F\u7528 BEGIN/COMMIT/ROLLBACK \u7B49\u4E8B\u52A1\u8BED\u53E5\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5904\u7406\u4E8B\u52A1
- \u7981\u6B62\u4F7F\u7528 DROP TABLE / ALTER TABLE / CREATE TABLE \u7B49\u7ED3\u6784\u53D8\u66F4\u8BED\u53E5

\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002`
    };
  }
  return { ...segment };
});
function replaceSection_ACU(content, startMarker, endMarker, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return content;
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}
function buildStrictJsonNativePrompt_ACU(content) {
  let next = replaceSection_ACU(content, "## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09", "## \u5173\u952E\u89C4\u5219", `## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09

\u56DE\u590D\u5185\u5BB9\u5FC5\u987B\u662F\u4E00\u4E2A\u5408\u6CD5 JSON \u5BF9\u8C61\uFF0C\u4E14\u53EA\u80FD\u5305\u542B\u8FD9\u4E2A JSON \u5BF9\u8C61\u672C\u8EAB\uFF1B\u4E0D\u8981\u8F93\u51FA <thought>\u3001<content>\u3001<tableEdit> \u6216 Markdown \u4EE3\u7801\u5757\u3002

\u4F60\u5FC5\u987B\u5728\u5185\u90E8\u5B8C\u6210\u539F\u672C <thought> \u4E2D\u8981\u6C42\u7684\u5168\u90E8\u5206\u6790\uFF0C\u4F46\u4E0D\u8981\u628A\u601D\u8003\u8FC7\u7A0B\u5199\u5165\u6700\u7EC8\u56DE\u590D\u3002

JSON \u6839\u5BF9\u8C61\u5FC5\u987B\u4F7F\u7528\u4EE5\u4E0B\u7ED3\u6784\uFF1A
{"format":"table_edit_ops_v1","ops":[]}

ops \u53EA\u5141\u8BB8 insert\u3001update\u3001delete \u4E09\u79CD\u64CD\u4F5C\u3002

insert \u683C\u5F0F\uFF1A
{"op":"insert","sheet":"\u8868\u683C\u540D","row":{"\u5B57\u6BB5\u540D":"\u5B57\u6BB5\u503C"}}

update \u683C\u5F0F\uFF1A
{"op":"update","sheet":"\u8868\u683C\u540D","where":{"\u5B57\u6BB5\u540D":"\u5B9A\u4F4D\u503C"},"set":{"\u5B57\u6BB5\u540D":"\u65B0\u503C"}}

delete \u683C\u5F0F\uFF1A
{"op":"delete","sheet":"\u8868\u683C\u540D","where":{"\u5B57\u6BB5\u540D":"\u5B9A\u4F4D\u503C"}}

\u5982\u679C\u6CA1\u6709\u4EFB\u4F55\u4FEE\u6539\uFF0C\u8F93\u51FA\uFF1A
{"format":"table_edit_ops_v1","ops":[]}

\u9488\u5BF9\u7EAA\u8981\u8868\u7684\u989D\u5916\u89C4\u5219\uFF1A\u5982\u679C<\u5F53\u524D\u8868\u683C\u6570\u636E>\u91CC\u5B58\u5728\u7EAA\u8981\u8868\uFF0C\u90A3\u4E48\u672C\u8F6E\u5C31\u5FC5\u987B\u5BF9\u5176\u8FDB\u884C\u63D2\u5165\u4E00\u6761\u65B0\u7684\u603B\u7ED3\u8BB0\u5F55\u3002
\u65E5\u5FD7\u4E0E\u7EAA\u8981\u8BED\u6C14\u6821\u51C6\uFF1A\u4F60\u5728\u601D\u8003\u7EAA\u8981\u65F6\uFF0C\u5FC5\u987B\u533A\u5206\u201C\u6B63\u5E38\u604B\u7231\u4E92\u52A8\u201D\u4E0E\u201C\u6697\u9ED1\u4E3B\u4ECE\u6587\u98CE\u201D\u3002\u4F60\u53EF\u4EE5\u4F7F\u7528\u6B63\u5E38\u7684\u4EA4\u6D41\u8BCD\u6C47\uFF08\u5982\uFF1A\u63D0\u8BAE\u3001\u8981\u6C42\u3001\u540C\u610F\u3001\u62D2\u7EDD\u3001\u5F15\u5BFC\u3001\u914D\u5408\u3001\u5B89\u629A\uFF09\uFF0C\u4F46\u3010\u7EDD\u5BF9\u7981\u6B62\u3011\u5C06\u60C5\u4FA3\u95F4\u7684\u666E\u901A\u8C03\u60C5\u4E0E\u4E92\u52A8\u8FC7\u5EA6\u89E3\u8BFB\u4E3A\u201C\u6743\u529B\u638C\u63A7\u201D\u3001\u201C\u5265\u593A\u53CD\u6297\u201D\u3001\u201C\u7CBE\u795E\u652F\u914D\u201D\u3001\u201C\u5C48\u670D\u201D\u7B49\u5355\u5411\u538B\u8FEB\u8BCD\u6C47\uFF01

`);
  next = next.replace("5. \u4F7F\u7528insertRow\u6DFB\u52A0\u65B0\u884C\uFF0CupdateRow\u66F4\u65B0\u5DF2\u6709\u884C\uFF0CdeleteRow\u5220\u9664\u884C", "5. \u4F7F\u7528 JSON ops \u6DFB\u52A0\u3001\u66F4\u65B0\u6216\u5220\u9664\u884C\uFF1Ainsert \u8868\u793A\u6DFB\u52A0\u65B0\u884C\uFF0Cupdate \u8868\u793A\u66F4\u65B0\u5DF2\u6709\u884C\uFF0Cdelete \u8868\u793A\u5220\u9664\u884C");
  next = replaceSection_ACU(next, "## \u683C\u5F0F\u8981\u70B9", "\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002", `## JSON \u683C\u5F0F\u8981\u70B9
- \u5FC5\u987B\u8F93\u51FA\u5408\u6CD5 JSON \u5BF9\u8C61\uFF0C\u4E0D\u80FD\u5728 JSON \u524D\u540E\u6DFB\u52A0\u4EFB\u4F55\u8BF4\u660E\u6587\u5B57
- JSON \u5B57\u7B26\u4E32\u5FC5\u987B\u4F7F\u7528\u53CC\u5F15\u53F7
- sheet \u5FC5\u987B\u4ECE\u5F53\u524D\u8868\u683C\u6570\u636E\u5217\u51FA\u7684\u8868\u683C\u540D\u6216 sheet \u6807\u8BC6\u4E2D\u590D\u5236
- row\u3001where\u3001set \u91CC\u7684\u5B57\u6BB5\u540D\u5FC5\u987B\u4ECE\u5BF9\u5E94\u8868\u683C\u8868\u5934\u4E2D\u9010\u5B57\u590D\u5236\uFF0C\u7981\u6B62\u4F7F\u7528\u6570\u5B57\u5217\u53F7
- update/delete \u5FC5\u987B\u4F7F\u7528 where \u5B9A\u4F4D\u552F\u4E00\u884C\uFF1B\u5982\u679C\u53EF\u80FD\u5339\u914D\u591A\u884C\uFF0C\u5FC5\u987B\u589E\u52A0\u5B9A\u4F4D\u5B57\u6BB5
- \u5B57\u6BB5\u503C\u5185\u90E8\u9700\u8981\u51FA\u73B0\u53CC\u5F15\u53F7\u65F6\u5FC5\u987B\u6309 JSON \u89C4\u5219\u8F6C\u4E49\u4E3A\\"
- \u5B57\u6BB5\u503C\u5185\u90E8\u9700\u8981\u6362\u884C\u65F6\u5FC5\u987B\u5199\u6210\\n\uFF0C\u4E0D\u80FD\u76F4\u63A5\u8F93\u51FA\u771F\u5B9E\u6362\u884C
- \u5982\u679C\u4E00\u53E5\u8BDD\u91CC\u542B\u6709\u5F88\u591A\u5F15\u53F7\uFF0C\u4F18\u5148\u6539\u5199\u63AA\u8F9E\uFF0C\u5C3D\u91CF\u907F\u514D\u5728 JSON \u503C\u91CC\u76F4\u63A5\u5D4C\u5957\u5F15\u53F7

`);
  return next.replace("\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002", "\u73B0\u5728\u5F00\u59CB\u6309\u6B64 JSON \u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002");
}
function buildStrictJsonSqlPrompt_ACU(content) {
  let next = replaceSection_ACU(content, "## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09", "## \u5173\u952E\u89C4\u5219", `## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C\u6267\u884C\uFF09

\u56DE\u590D\u5185\u5BB9\u5FC5\u987B\u662F\u4E00\u4E2A\u5408\u6CD5 JSON \u5BF9\u8C61\uFF0C\u4E14\u53EA\u80FD\u5305\u542B\u8FD9\u4E2A JSON \u5BF9\u8C61\u672C\u8EAB\uFF1B\u4E0D\u8981\u8F93\u51FA <thought>\u3001<content>\u3001<tableEdit> \u6216 Markdown \u4EE3\u7801\u5757\u3002

\u4F60\u5FC5\u987B\u5728\u5185\u90E8\u5B8C\u6210\u539F\u672C <thought> \u4E2D\u8981\u6C42\u7684\u5168\u90E8\u5206\u6790\uFF0C\u4F46\u4E0D\u8981\u628A\u601D\u8003\u8FC7\u7A0B\u5199\u5165\u6700\u7EC8\u56DE\u590D\u3002

JSON \u6839\u5BF9\u8C61\u5FC5\u987B\u4F7F\u7528\u4EE5\u4E0B\u7ED3\u6784\uFF1A
{"format":"table_edit_sql_v1","sql":""}

sql \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\uFF0C\u5185\u5BB9\u662F\u6309\u4E0B\u6587 DDL\u3001Note \u548C SQL \u7F16\u5199\u539F\u5219\u751F\u6210\u7684\u5B8C\u6574 SQL \u811A\u672C\uFF0C\u53EF\u5305\u542B\u591A\u6761 INSERT\u3001UPDATE \u6216 DELETE\u3002

\u5982\u679C\u6CA1\u6709\u4EFB\u4F55\u4FEE\u6539\uFF0C\u8F93\u51FA\uFF1A
{"format":"table_edit_sql_v1","sql":""}

\u9488\u5BF9\u7EAA\u8981\u8868\u7684\u989D\u5916\u89C4\u5219\uFF1A\u5982\u679C<\u5F53\u524D\u8868\u683C\u6570\u636E>\u91CC\u5B58\u5728\u7EAA\u8981\u8868\uFF0C\u90A3\u4E48\u672C\u8F6E\u5C31\u5FC5\u987B\u5BF9\u5176\u8FDB\u884C\u63D2\u5165\u4E00\u6761\u65B0\u7684\u603B\u7ED3\u8BB0\u5F55\u3002
\u65E5\u5FD7\u4E0E\u7EAA\u8981\u8BED\u6C14\u6821\u51C6\uFF1A\u4F60\u5728\u601D\u8003\u7EAA\u8981\u65F6\uFF0C\u5FC5\u987B\u533A\u5206"\u6B63\u5E38\u604B\u7231\u4E92\u52A8"\u4E0E"\u6697\u9ED1\u4E3B\u4ECE\u6587\u98CE"\u3002\u4F60\u53EF\u4EE5\u4F7F\u7528\u6B63\u5E38\u7684\u4EA4\u6D41\u8BCD\u6C47\uFF08\u5982\uFF1A\u63D0\u8BAE\u3001\u8981\u6C42\u3001\u540C\u610F\u3001\u62D2\u7EDD\u3001\u5F15\u5BFC\u3001\u914D\u5408\u3001\u5B89\u629A\uFF09\uFF0C\u4F46\u3010\u7EDD\u5BF9\u7981\u6B62\u3011\u5C06\u60C5\u4FA3\u95F4\u7684\u666E\u901A\u8C03\u60C5\u4E0E\u4E92\u52A8\u8FC7\u5EA6\u89E3\u8BFB\u4E3A"\u6743\u529B\u638C\u63A7"\u3001"\u5265\u593A\u53CD\u6297"\u3001"\u7CBE\u795E\u652F\u914D"\u3001"\u5C48\u670D"\u7B49\u5355\u5411\u538B\u8FEB\u8BCD\u6C47\uFF01

`);
  next = replaceSection_ACU(next, "## SQL \u683C\u5F0F\u8981\u70B9", "\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002", `## SQL \u4E0E JSON \u683C\u5F0F\u8981\u70B9
- \u5B57\u7B26\u4E32\u503C\u4F7F\u7528\u5355\u5F15\u53F7\u5305\u88F9\uFF0C\u5982 '\u89D2\u8272A'
- \u5982\u679C\u5B57\u7B26\u4E32\u503C\u5185\u90E8\u5305\u542B\u5355\u5F15\u53F7\uFF0C\u4F7F\u7528\u4E24\u4E2A\u5355\u5F15\u53F7\u8F6C\u4E49\uFF0C\u5982 '\u79C9\u6301''\u8C01\u6B3A\u8D1F\u6211\u5C31\u6253\u8C01''\u7684\u4FE1\u5FF5'
- \u6570\u503C\u5217\u76F4\u63A5\u5199\u6570\u5B57\uFF0C\u4E0D\u52A0\u5F15\u53F7
- \u6BCF\u6761 SQL \u8BED\u53E5\u4EE5\u5206\u53F7\u7ED3\u5C3E
- \u591A\u6761\u8BED\u53E5\u4E4B\u95F4\u7528\u6362\u884C\u5206\u9694\uFF1B\u5199\u5165 JSON \u7684 sql \u5B57\u7B26\u4E32\u65F6\uFF0C\u6362\u884C\u5FC5\u987B\u6309 JSON \u89C4\u5219\u8868\u793A\u4E3A\\n
- \u8868\u540D\u548C\u5217\u540D\u4F7F\u7528\u82F1\u6587\uFF08\u53C2\u7167 CREATE TABLE \u4E2D\u7684\u5B9A\u4E49\uFF09
- \u7981\u6B62\u4F7F\u7528 BEGIN/COMMIT/ROLLBACK \u7B49\u4E8B\u52A1\u8BED\u53E5\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5904\u7406\u4E8B\u52A1
- \u7981\u6B62\u4F7F\u7528 DROP TABLE / ALTER TABLE / CREATE TABLE \u7B49\u7ED3\u6784\u53D8\u66F4\u8BED\u53E5
- \u5FC5\u987B\u8F93\u51FA\u5408\u6CD5 JSON \u5BF9\u8C61\uFF0C\u4E0D\u80FD\u5728 JSON \u524D\u540E\u6DFB\u52A0\u4EFB\u4F55\u8BF4\u660E\u6587\u5B57
- JSON \u5B57\u7B26\u4E32\u5FC5\u987B\u4F7F\u7528\u53CC\u5F15\u53F7\uFF1Bsql \u5B57\u7B26\u4E32\u5185\u90E8\u5982\u9700\u53CC\u5F15\u53F7\u5FC5\u987B\u6309 JSON \u89C4\u5219\u8F6C\u4E49\u4E3A\\"

`);
  return next.replace("\u73B0\u5728\u5F00\u59CB\u6309\u6B64\u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002", "\u73B0\u5728\u5F00\u59CB\u6309\u6B64 JSON \u683C\u5F0F\u6267\u884C\u586B\u8868\u4EFB\u52A1\u3002");
}
var DEFAULT_CHAR_CARD_PROMPT_STRICT_JSON_ACU = DEFAULT_CHAR_CARD_PROMPT_ACU.map((segment) => {
  if (segment.mainSlot === "A" || segment.isMain) {
    return {
      ...segment,
      content: buildStrictJsonNativePrompt_ACU(segment.content)
    };
  }
  if (segment.isMain2) return { ...segment };
  if (segment.role === "assistant" && typeof segment.content === "string" && segment.content.includes("<thought>")) {
    return { ...segment, content: "\u6536\u5230\uFF0C\u6211\u5C06\u53EA\u8FD4\u56DE\u6307\u5B9A JSON \u5BF9\u8C61\u3002" };
  }
  return { ...segment };
});
var DEFAULT_CHAR_CARD_PROMPT_SQL_STRICT_JSON_ACU = DEFAULT_CHAR_CARD_PROMPT_SQL_ACU.map((segment) => {
  if (segment.mainSlot === "A" || segment.isMain) {
    return {
      ...segment,
      content: buildStrictJsonSqlPrompt_ACU(segment.content)
    };
  }
  if (segment.isMain2) return { ...segment };
  if (segment.role === "assistant" && typeof segment.content === "string" && segment.content.includes("<thought>")) {
    return { ...segment, content: "\u6536\u5230\uFF0C\u6211\u5C06\u53EA\u8FD4\u56DE\u6307\u5B9A JSON \u5BF9\u8C61\u3002" };
  }
  return { ...segment };
});
var ORIGINAL_DEFAULT_TABLE_TEMPLATE_ACU = buildOriginalDefaultTableTemplateString_ACU();
var DEFAULT_TABLE_TEMPLATE_ACU = buildDefaultTableTemplateString_ACU();

// ../shujuku/src/shared/constants.ts
var UNIQUE_SCRIPT_ID = "shujuku_v120";
var SCRIPT_ID_PREFIX_ACU = UNIQUE_SCRIPT_ID;
var POPUP_ID_ACU = `${SCRIPT_ID_PREFIX_ACU}-popup`;
var MENU_ITEM_ID_ACU = `${SCRIPT_ID_PREFIX_ACU}-menu-item`;

// ../shujuku/src/shared/v2-ui-state.ts
var ACU_V2_STORAGE_KEY = "acu_v2_ui_state";
var ACU_V2_DEV_OPTIONS_SECTION_KEY = "devOptions";
var WARN_LOG_ENABLED_KEY = "warnLogEnabled";
function readWarnLogEnabled() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const raw = window.localStorage.getItem(ACU_V2_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const devOptions = parsed[ACU_V2_DEV_OPTIONS_SECTION_KEY];
    if (!devOptions || typeof devOptions !== "object") return false;
    return devOptions[WARN_LOG_ENABLED_KEY] === true;
  } catch {
    return false;
  }
}

// ../shujuku/src/shared/log-buffer.ts
var MAX_BUFFER_SIZE = 2e3;
var UNCATEGORIZED_TAG = "\u672A\u5206\u7C7B";
var _buffer = [];
var _nextId = 1;
var _subscribers = /* @__PURE__ */ new Set();
var _knownTags = /* @__PURE__ */ new Set();
var _debugLogEnabled = false;
var _warnLogEnabled = readWarnLogEnabled();
function extractTag(args) {
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === "string") {
      const match = arg.match(/^\[([^\]]+)\]/);
      if (match) {
        return match[1];
      }
    }
  }
  if (args.length > 0 && typeof args[0] === "string") {
    const match = args[0].match(/^\[([^\]]+)\]/);
    if (match && match[1] !== "ACU") {
      return match[1];
    }
  }
  return UNCATEGORIZED_TAG;
}
function normalizeLogArg_ACU(arg) {
  if (arg === null) return "null";
  if (arg === void 0) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") return String(arg);
  if (typeof arg === "symbol") return String(arg);
  if (typeof arg === "function") return `[Function ${arg.name || "anonymous"}]`;
  const maybeErrorName = typeof arg?.name === "string" ? arg.name : "";
  const maybeErrorMessage = typeof arg?.message === "string" ? arg.message : "";
  const maybeErrorStack = typeof arg?.stack === "string" ? arg.stack : "";
  if (arg instanceof Error || maybeErrorMessage || maybeErrorStack) {
    const parts = [];
    const header = `${maybeErrorName || "Error"}${maybeErrorMessage ? `: ${maybeErrorMessage}` : ""}`;
    parts.push(header);
    if (maybeErrorStack && maybeErrorStack !== header) parts.push(maybeErrorStack);
    if (arg?.cause !== void 0) parts.push(`cause=${normalizeLogArg_ACU(arg.cause)}`);
    return parts.join(" | ");
  }
  try {
    const json = JSON.stringify(arg, null, 0);
    if (json && json !== "{}") return json;
  } catch {
  }
  try {
    const constructorName = arg?.constructor?.name && arg.constructor.name !== "Object" ? arg.constructor.name : "Object";
    const ownProperties = Object.getOwnPropertyNames(arg || {}).map((key) => `${key}=${normalizeLogArg_ACU(arg[key])}`).join(", ");
    if (ownProperties) return `${constructorName}{${ownProperties}}`;
    const stringValue = String(arg);
    return stringValue === "[object Object]" ? `${constructorName}{}` : stringValue;
  } catch {
    return "[Unserializable log argument]";
  }
}
function formatArgs(args) {
  return args.map(normalizeLogArg_ACU).join(" ");
}
function isWarnLogEnabled() {
  return _warnLogEnabled;
}
function pushLog(level, args) {
  if (level === "debug" && !_debugLogEnabled) return;
  if (level === "warn" && !_warnLogEnabled) return;
  const tag = extractTag(args);
  _knownTags.add(tag);
  const entry = {
    id: _nextId++,
    timestamp: Date.now(),
    level,
    tag,
    message: formatArgs(args)
  };
  _buffer.push(entry);
  if (_buffer.length > MAX_BUFFER_SIZE) {
    _buffer = _buffer.slice(_buffer.length - MAX_BUFFER_SIZE);
  }
  for (const subscriber of _subscribers) {
    try {
      subscriber(entry);
    } catch {
    }
  }
}

// ../shujuku/src/shared/utils.ts
function hashUserInput_ACU(text) {
  if (!text) return "";
  const normalized = String(text).trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash.toString(36);
}
function logWarn_ACU(...args) {
  if (!isWarnLogEnabled()) return;
  console.warn(`[${SCRIPT_ID_PREFIX_ACU}]`, ...args);
  pushLog("warn", [`[${SCRIPT_ID_PREFIX_ACU}]`, ...args]);
}

// ../shujuku/src/service/plot/plot-link-provider.ts
var PLOT_LINK_TIMEOUT_MS = 5e3;
var PLOT_LINK_READY_TIMEOUT_MS = 9e4;
var DIAGNOSTICS_LIMIT = 20;
var providers = /* @__PURE__ */ new Map();
var diagnostics = [];
function record(entry) {
  diagnostics.push(entry);
  if (diagnostics.length > DIAGNOSTICS_LIMIT) diagnostics = diagnostics.slice(-DIAGNOSTICS_LIMIT);
}
function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function registerPlotLinkProvider(provider) {
  const id = typeof provider?.id === "string" ? provider.id.trim() : "";
  if (!id) throw new Error("registerPlotLinkProvider: provider.id must be a non-empty string");
  providers.delete(id);
  providers.set(id, provider);
  return () => {
    if (providers.get(id) === provider) providers.delete(id);
  };
}
function unregisterPlotLinkProvider(id) {
  return providers.delete(typeof id === "string" ? id.trim() : id);
}
function listPlotLinkProviders() {
  return [...providers.keys()];
}
function hasPlotLinkProviders_ACU() {
  return providers.size > 0;
}
function getPlotLinkDiagnostics() {
  return diagnostics.map((entry) => ({ ...entry }));
}
function resetPlotLinkRegistryForTest_ACU() {
  providers.clear();
  diagnostics = [];
}
async function callWithTimeout(id, hook, fn, timeoutMs = PLOT_LINK_TIMEOUT_MS, signal) {
  const started = Date.now();
  let timer;
  let onAbort;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      if (signal) {
        onAbort = () => reject(new Error("aborted"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    const value = await Promise.race([Promise.resolve().then(fn), timeout]);
    record({ at: started, providerId: id, hook, ok: true, ms: Date.now() - started });
    return { ok: true, value };
  } catch (error) {
    const message = errorText(error);
    logWarn_ACU(`[\u5267\u60C5\u8054\u52A8] \u63D0\u4F9B\u8005 ${id} \u7684 ${hook} \u5931\u8D25\uFF0C\u5DF2\u5FFD\u7565:`, message);
    record({ at: started, providerId: id, hook, ok: false, ms: Date.now() - started, error: message });
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}
async function awaitPlotLinkReady_ACU(scope, signal) {
  const started = Date.now();
  const notReady = [];
  for (const provider of [...providers.values()]) {
    if (typeof provider.awaitReady !== "function") continue;
    const result = await callWithTimeout(provider.id, "awaitReady", () => provider.awaitReady({ ...scope }), PLOT_LINK_READY_TIMEOUT_MS, signal);
    if (!result.ok) {
      notReady.push({ id: provider.id, reason: "timeout_or_error" });
      continue;
    }
    const value = result.value;
    if (value && typeof value === "object" && value.ready === false) {
      notReady.push({ id: provider.id, reason: String(value.reason || "not_ready") });
    }
  }
  return { waitedMs: Date.now() - started, notReady };
}
async function collectPlotLinkContext_ACU(scope) {
  const parts = [];
  for (const provider of [...providers.values()]) {
    if (typeof provider.provideContext !== "function") continue;
    const result = await callWithTimeout(provider.id, "provideContext", () => provider.provideContext({ ...scope }));
    if (result.ok && typeof result.value === "string" && result.value.trim()) parts.push(result.value);
  }
  return parts.join("\n\n");
}
async function applyPlotLinkFinalize_ACU(scope, finalMessage) {
  let current = finalMessage;
  for (const provider of [...providers.values()]) {
    if (typeof provider.finalize !== "function") continue;
    const snapshot = current;
    const result = await callWithTimeout(provider.id, "finalize", () => provider.finalize({ ...scope }, { finalMessage: snapshot }));
    if (!result.ok) continue;
    const append = result.value && typeof result.value === "object" ? result.value.append : void 0;
    if (typeof append === "string" && append.trim()) current = `${current}

${append}`;
  }
  return current;
}
function emitNotification(hook, event) {
  for (const provider of [...providers.values()]) {
    const handler = provider[hook];
    if (typeof handler !== "function") continue;
    const started = Date.now();
    try {
      handler.call(provider, { ...event });
      record({ at: started, providerId: provider.id, hook, ok: true, ms: Date.now() - started });
    } catch (error) {
      const message = errorText(error);
      logWarn_ACU(`[\u5267\u60C5\u8054\u52A8] \u63D0\u4F9B\u8005 ${provider.id} \u7684 ${hook} \u629B\u51FA\u5F02\u5E38\uFF0C\u5DF2\u5FFD\u7565:`, message);
      record({ at: started, providerId: provider.id, hook, ok: false, ms: Date.now() - started, error: message });
    }
  }
}
function collectPlotLinkFillCandidates_ACU(scope, messageIndices) {
  if (providers.size === 0) return "";
  const parts = [];
  for (const provider of [...providers.values()]) {
    if (typeof provider.fillCandidates !== "function") continue;
    const started = Date.now();
    try {
      const result = provider.fillCandidates({ ...scope }, { messageIndices: [...messageIndices] });
      const text = result && typeof result === "object" && typeof result.text === "string" ? result.text.trim() : "";
      if (text) parts.push(text);
      record({ at: started, providerId: provider.id, hook: "fillCandidates", ok: true, ms: Date.now() - started });
    } catch (error) {
      const message = errorText(error);
      logWarn_ACU(`[\u5267\u60C5\u8054\u52A8] \u63D0\u4F9B\u8005 ${provider.id} \u7684 fillCandidates \u629B\u51FA\u5F02\u5E38\uFF0C\u5DF2\u5FFD\u7565:`, message);
      record({ at: started, providerId: provider.id, hook: "fillCandidates", ok: false, ms: Date.now() - started, error: message });
    }
  }
  return parts.join("\n\n");
}
function emitPlotLinkFillEvent_ACU(event) {
  if (providers.size === 0) return;
  emitNotification("onFillEvent", event);
}
function emitPlotLinkCommit_ACU(event) {
  if (providers.size === 0) return;
  emitNotification("onTableCommitted", event);
}
function resolveUserMessageTextForFill_ACU(msg) {
  const current = msg?.mes || msg?.message || "";
  if (msg?.is_user && typeof msg.qrf_plot_user_input === "string" && msg.qrf_plot_user_input && typeof msg.qrf_plot_final_hash === "string" && msg.qrf_plot_final_hash && typeof current === "string" && hashUserInput_ACU(current) === msg.qrf_plot_final_hash) {
    return msg.qrf_plot_user_input;
  }
  return current;
}
export {
  PLOT_LINK_READY_TIMEOUT_MS,
  PLOT_LINK_TIMEOUT_MS,
  applyPlotLinkFinalize_ACU,
  awaitPlotLinkReady_ACU,
  collectPlotLinkContext_ACU,
  collectPlotLinkFillCandidates_ACU,
  emitPlotLinkCommit_ACU,
  emitPlotLinkFillEvent_ACU,
  getPlotLinkDiagnostics,
  hasPlotLinkProviders_ACU,
  listPlotLinkProviders,
  registerPlotLinkProvider,
  resetPlotLinkRegistryForTest_ACU,
  resolveUserMessageTextForFill_ACU,
  unregisterPlotLinkProvider
};
