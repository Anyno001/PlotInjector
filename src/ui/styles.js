// 沿用开场白编辑器的观感：白卡片 + 浅灰底、粉色强调、深色主按钮、胶囊按钮。颜色与圆角只在根节点定义。
// 手机宽度下酒馆把 body 设为 fixed、html 带 transform，html 高度为 0；inset:0 会跟着塌成 0 高，所以按视口定尺寸。
export const CSS = `
.pi-root{--pi-accent:#E8507B;--pi-accent-soft:#FEF0F3;--pi-dark:#1E1E2E;--pi-bg:#FFFFFF;--pi-surf:#F8F9FB;--pi-line:#E8E8EE;--pi-txt:#1E1E2E;--pi-txt2:#7C7C8A;--pi-ok:#2E9E6A;--pi-ok-soft:#E9F7F0;--pi-warn:#C98A12;--pi-warn-soft:#FDF5E4;--pi-danger:#D64545;--pi-danger-soft:#FDEDED;--pi-add:#E9F7F0;--pi-del:#FDEDED;--pi-on-dark:#FFFFFF;--pi-user-bg:#1E1E2E;--pi-user-txt:#FFFFFF;--pi-user-txt2:#B4B4C0;--pi-user-hover:#34344A;--pi-r:14px;--pi-r-in:10px;--pi-shadow:0 8px 32px rgba(0,0,0,.15);--pi-font:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;--pi-mono:Consolas,"JetBrains Mono",monospace;font-family:var(--pi-font);color:var(--pi-txt);font-size:14px;line-height:1.55}
.pi-root.is-night{--pi-accent:#F0688F;--pi-accent-soft:#3A2230;--pi-dark:#E6E6EE;--pi-bg:#1F1F2A;--pi-surf:#16161F;--pi-line:#33333F;--pi-txt:#E6E6EE;--pi-txt2:#9A9AA8;--pi-ok:#4CC08A;--pi-ok-soft:#1C3329;--pi-warn:#E0A63A;--pi-warn-soft:#3A3020;--pi-danger:#EF6B6B;--pi-danger-soft:#3D2224;--pi-add:#1C3329;--pi-del:#3D2224;--pi-on-dark:#16161F;--pi-user-bg:#3A3A4C;--pi-user-txt:#E6E6EE;--pi-user-txt2:#A8A8B6;--pi-user-hover:#4A4A5E;--pi-shadow:0 8px 32px rgba(0,0,0,.5);color-scheme:dark}
.pi-root *,.pi-root *::before,.pi-root *::after{box-sizing:border-box}
.pi-root ::-webkit-scrollbar{display:none}
.pi-root [hidden]{display:none!important}
.pi-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(20,20,30,.28)}
.pi-panel{position:relative;width:880px;max-width:96vw;height:88vh;max-height:88vh;background:var(--pi-surf);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);display:grid;grid-template-columns:220px 1fr;overflow:hidden}
.pi-scrim{display:none}
.pi-side{background:var(--pi-bg);border-right:1px solid var(--pi-line);display:flex;flex-direction:column;min-height:0}
.pi-side-hd{padding:14px 14px 8px;font-weight:700;font-size:15px;color:var(--pi-dark);display:flex;align-items:center;gap:6px}
.pi-side-hd small{font-weight:400;color:var(--pi-txt2);font-size:11px}
.pi-plist{flex:1;overflow-y:auto;padding:0 8px;scrollbar-width:none}
.pi-group{margin:6px 0}
.pi-group-hd{display:flex;align-items:center;gap:4px;width:100%;padding:4px 6px;border:0;background:none;color:var(--pi-txt2);font-size:12px;cursor:pointer;font-family:inherit}
.pi-group-hd small{margin-left:auto;font-size:11px}
.pi-group.is-collapsed .pi-pitem{display:none}
.pi-plist.is-searching .pi-group.is-collapsed .pi-pitem{display:flex}
.pi-psearch{position:relative;margin:0 8px 6px}
.pi-psearch svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--pi-txt2);pointer-events:none}
.pi-psearch .pi-inp{padding-left:30px}
.pi-pitem{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:0;border-radius:var(--pi-r-in);background:none;color:var(--pi-txt);font-size:13px;text-align:left;cursor:pointer;font-family:inherit}
.pi-pitem:hover{background:var(--pi-surf)}
.pi-pitem.is-sel{background:var(--pi-accent-soft);color:var(--pi-accent);font-weight:600}
.pi-pitem .pi-dot{width:7px;height:7px;border-radius:50%;background:var(--pi-accent);flex-shrink:0}
.pi-pitem .pi-pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-side-ft{padding:8px;border-top:1px solid var(--pi-line);display:flex;flex-direction:column;gap:4px}
.pi-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.pi-top{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:10px 14px;background:var(--pi-bg);border-bottom:1px solid var(--pi-line)}
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
.pi-card{background:var(--pi-bg);border-radius:var(--pi-r);padding:12px 14px;margin-bottom:10px}
.pi-card h3{margin:0 0 8px;font-size:12px;font-weight:700;color:var(--pi-dark);display:flex;align-items:center;gap:8px}
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
.pi-equal,.pi-tools{display:grid;grid-template-columns:repeat(var(--pi-cols,3),minmax(0,150px));gap:8px;justify-content:center;align-items:stretch}
.pi-equal>.pi-btn,.pi-tools>.pi-btn{width:100%;padding:0 6px;white-space:normal;line-height:1.3}
.pi-equal.is-one,.pi-tools.is-c1{--pi-cols:1}
.pi-tools.is-c2{--pi-cols:2}
.pi-tools.is-c3{--pi-cols:3}
.pi-tools.is-c4{--pi-cols:4}
.pi-tools{margin:2px 0 10px}
.pi-tools.is-end{margin:10px 0 0}
.pi-tools>.pi-check{grid-column:1/-1;justify-content:center;padding:0}
.pi-pair{display:grid;grid-template-columns:repeat(var(--pi-cols,2),minmax(0,1fr));gap:0 10px}
.pi-pair.is-c3{--pi-cols:3}
.pi-pair.is-c4{--pi-cols:4}
.pi-pair .pi-inp,.pi-pair .pi-sel{width:100%}
.pi-presets{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.pi-preset-pick{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:4px 0;border:0;background:none;color:inherit;cursor:pointer;text-align:left;font-family:inherit}
.pi-preset:hover{border-color:var(--pi-accent)}
.pi-preset{display:flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in);min-width:0}
.pi-preset-name{font-weight:600;font-size:13px;flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-preset-model{flex:1;min-width:0;font-size:12px;color:var(--pi-txt2);font-family:var(--pi-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-sec{margin-top:8px}
.pi-wb-sec-hd{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--pi-txt2);padding:2px 0 4px;border-bottom:1px solid var(--pi-line);margin-bottom:2px}
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
.pi-wb-edit{margin:4px 0 10px 23px;padding:10px;border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in)}
.pi-wb-memo{display:inline-flex;align-items:center;gap:4px;font-weight:500;flex-shrink:0}
.pi-wb-memo{margin-left:auto;font-size:12px;color:var(--pi-txt2)}
.pi-wb-memo .pi-inp.is-num{width:52px;height:26px;padding:2px 6px;font-size:12px;text-align:center}
.pi-wb-sub-hd>input[type=checkbox],.pi-wb-sub-hd>.pi-wb-pad{width:15px;height:15px;margin:0;flex-shrink:0;accent-color:var(--pi-accent)}
.pi-fix{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:13px}
.pi-fix-text{flex:1;min-width:0}
.pi-fix-acts{display:grid;grid-template-columns:repeat(3,56px);gap:4px;flex-shrink:0}
.pi-fix-acts>.pi-btn{width:100%;padding:0}
.pi-ref-book+.pi-ref-book{margin-top:12px;padding-top:8px;border-top:1px solid var(--pi-line)}
.pi-chip:disabled{opacity:.45;cursor:not-allowed}
.pi-wb-field{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-row{display:flex;align-items:center;gap:8px;padding:3px 0;min-width:0}
.pi-wb-row input{width:15px;height:15px;margin:0;accent-color:var(--pi-accent);flex-shrink:0;cursor:pointer}
.pi-wb-title{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-wb-row.is-off .pi-wb-title{color:var(--pi-txt2)}
.pi-wb-info{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;margin:4px 0 10px}
.pi-wb-tokens{display:contents}
.pi-wb-count{font-size:12px;color:var(--pi-txt2);padding-left:4px}
label.pi-wb-row{cursor:pointer}
.pi-acts{margin-top:12px}
.pi-acts-top{margin-bottom:8px}
.pi-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;background:var(--pi-surf);border-radius:20px;margin-bottom:6px}
.pi-seg-btn{padding:5px 6px;border:0;border-radius:16px;background:none;color:var(--pi-txt2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pi-seg-btn.is-sel{background:var(--pi-bg);color:var(--pi-dark);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.pi-inp,.pi-sel{height:36px}
.pi-inp,.pi-sel,.pi-ta{width:100%;padding:7px 11px;border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in);font-size:13px;color:var(--pi-txt);background:var(--pi-bg);outline:none;font-family:inherit}
.pi-inp:focus,.pi-sel:focus,.pi-ta:focus{border-color:var(--pi-accent)}
.pi-inp.is-num{width:84px}
.pi-ta{resize:vertical;min-height:80px;line-height:1.6}
.pi-ta.is-mono{font-family:var(--pi-mono);font-size:12px;line-height:1.5}
.pi-ta.is-tall{min-height:360px}
.pi-btn{min-height:32px;padding:0 14px;border:1.5px solid var(--pi-line);border-radius:20px;background:var(--pi-bg);color:var(--pi-dark);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;font-family:inherit}
.pi-btn:hover{border-color:var(--pi-dark)}
.pi-btn:active{transform:scale(.97)}
.pi-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.pi-btn.is-primary{background:var(--pi-dark);border-color:var(--pi-dark);color:var(--pi-on-dark)}
.pi-btn.is-primary:hover{opacity:.86}
.pi-btn.is-accent{background:var(--pi-accent);border-color:var(--pi-accent);color:var(--pi-bg)}
.pi-btn.is-danger{color:var(--pi-danger);border-color:var(--pi-danger-soft)}
.pi-btn.is-danger:hover{border-color:var(--pi-danger)}
.pi-btn.is-ghost{border-color:transparent;background:none;color:var(--pi-txt2)}
.pi-btn.is-ghost:hover{color:var(--pi-dark);background:var(--pi-surf)}
.pi-btn.is-ghost.is-danger{color:var(--pi-danger)}
.pi-btn.is-sm{min-height:26px;padding:0 10px;font-size:12px}
.pi-btn.is-block{width:100%;justify-content:flex-start}
.pi-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:var(--pi-surf);color:var(--pi-txt2);white-space:nowrap}
.pi-badge.is-accent{background:var(--pi-accent-soft);color:var(--pi-accent)}
.pi-badge.is-ok{background:var(--pi-ok-soft);color:var(--pi-ok)}
.pi-badge.is-warn{background:var(--pi-warn-soft);color:var(--pi-warn)}
.pi-badge.is-danger{background:var(--pi-danger-soft);color:var(--pi-danger)}
.pi-badge.is-dark{background:var(--pi-dark);color:var(--pi-on-dark)}
.pi-check{display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:13px;cursor:pointer}
.pi-check input{width:15px;height:15px;margin-top:3px;accent-color:var(--pi-accent);flex-shrink:0;cursor:pointer}
.pi-check.is-off{color:var(--pi-txt2);text-decoration:line-through}
.pi-entry{border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in);margin-bottom:8px;background:var(--pi-bg)}
.pi-entry.is-off{opacity:.55}
.pi-entry-hd{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer}
.pi-entry-hd .pi-etitle{flex:1;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-entry-bd{padding:4px 10px 10px;border-top:1px dashed var(--pi-line)}
.pi-pre{white-space:pre-wrap;word-break:break-word;font-family:var(--pi-mono);font-size:12px;line-height:1.5;background:var(--pi-surf);border-radius:var(--pi-r-in);padding:8px 10px;max-height:320px;overflow:auto;margin:6px 0 0}
.pi-units{display:flex;flex-direction:column;gap:2px}
.pi-unit{display:grid;grid-template-columns:52px minmax(0,1fr) 84px 76px;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--pi-r-in);font-size:13px}
.pi-unit>.pi-badge{justify-self:start}
.pi-unit .pi-unit-act{justify-self:stretch}
.pi-unit .pi-unit-act .pi-btn{width:100%;padding:0 4px}
.pi-unit:hover{background:var(--pi-surf)}
.pi-unit .pi-uname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-unit.is-active{background:var(--pi-accent-soft)}
.pi-unit .pi-sel{width:100%;height:28px;padding:2px 6px;font-size:12px;text-align:center;text-align-last:center}
.pi-unmute{border:0;cursor:pointer;font-family:inherit;margin-left:4px}
.pi-card-sub{padding:2px 8px 8px 30px}
.pi-vol-hd{font-size:12px;font-weight:700;color:var(--pi-txt2);margin:8px 0 2px;padding:0 8px}
.pi-tree{display:grid;grid-template-columns:220px 1fr;gap:10px;align-items:start}
.pi-tree-list{background:var(--pi-bg);border-radius:var(--pi-r);padding:8px;max-height:calc(88vh - 140px);overflow-y:auto;scrollbar-width:none}
.pi-titem{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-radius:8px;background:none;text-align:left;font-size:13px;color:var(--pi-txt);cursor:pointer;font-family:inherit}
.pi-titem:hover{background:var(--pi-surf)}
.pi-titem.is-sel{background:var(--pi-accent-soft);color:var(--pi-accent);font-weight:600}
.pi-titem.is-vol{font-weight:700;color:var(--pi-dark)}
.pi-titem.is-stage{padding-left:18px}
.pi-titem .pi-pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-node{border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in);padding:8px 10px;margin-bottom:8px}
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
.pi-compose .pi-ta{flex:1;height:44px;min-height:44px;resize:none;padding:10px 12px;line-height:1.5}
.pi-send{width:40px;height:40px;border:0;border-radius:50%;background:var(--pi-dark);color:var(--pi-on-dark);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.pi-send:hover{opacity:.86}
.pi-send:active{transform:scale(.95)}
.pi-send:disabled{opacity:.45;cursor:not-allowed;transform:none}
.pi-refs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.pi-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1.5px solid var(--pi-line);border-radius:20px;font-size:12px;cursor:pointer;background:var(--pi-bg);color:var(--pi-txt2);font-family:inherit}
.pi-compose-side{width:40px;height:40px;border:1.5px solid var(--pi-line);border-radius:50%;background:var(--pi-bg);color:var(--pi-txt2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0}
.pi-compose-side:hover{color:var(--pi-danger);border-color:var(--pi-danger)}
.pi-block-chip{padding:0 4px 0 0;gap:0}
.pi-block-chip>button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:3px 4px 3px 10px}
.pi-block-chip>.pi-block-del{padding:3px 4px;display:inline-flex;align-items:center;opacity:.6}
.pi-block-chip>.pi-block-del svg{width:10px;height:10px}
.pi-block-chip>.pi-block-del:hover{opacity:1;color:var(--pi-danger)}
.pi-chip.is-on{border-color:var(--pi-accent);color:var(--pi-accent);background:var(--pi-accent-soft)}
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
.pi-unit{grid-template-columns:48px minmax(0,1fr) 72px 68px;gap:6px;padding:6px}
.pi-tree-list{max-height:220px}
.pi-msg{max-width:94%}
.pi-body{padding:10px}
}
`;

export const ICONS = {
    close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    gear: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
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
    pulse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.5 8.5h3l1.8-4 3 8 1.9-4h3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9 1v4h4" stroke="currentColor" stroke-width="1.2"/></svg>',
};
