// 沿用开场白编辑器的观感：白卡片 + 浅灰底、粉色强调、深色主按钮、胶囊按钮。颜色与圆角只在根节点定义。
export const CSS = `
.pi-root{--pi-accent:#E8507B;--pi-accent-soft:#FEF0F3;--pi-dark:#1E1E2E;--pi-bg:#FFFFFF;--pi-surf:#F8F9FB;--pi-line:#E8E8EE;--pi-txt:#1E1E2E;--pi-txt2:#7C7C8A;--pi-ok:#2E9E6A;--pi-ok-soft:#E9F7F0;--pi-warn:#C98A12;--pi-warn-soft:#FDF5E4;--pi-danger:#D64545;--pi-danger-soft:#FDEDED;--pi-add:#E9F7F0;--pi-del:#FDEDED;--pi-r:14px;--pi-r-in:10px;--pi-shadow:0 8px 32px rgba(0,0,0,.15);--pi-font:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;--pi-mono:Consolas,"JetBrains Mono",monospace;font-family:var(--pi-font);color:var(--pi-txt);font-size:14px;line-height:1.55}
.pi-root *,.pi-root *::before,.pi-root *::after{box-sizing:border-box}
.pi-root ::-webkit-scrollbar{display:none}
.pi-root [hidden]{display:none!important}
.pi-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;background:rgba(20,20,30,.28)}
.pi-panel{width:880px;max-width:96vw;height:88vh;max-height:88vh;background:var(--pi-surf);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);display:grid;grid-template-columns:220px 1fr;overflow:hidden}
.pi-side{background:var(--pi-bg);border-right:1px solid var(--pi-line);display:flex;flex-direction:column;min-height:0}
.pi-side-hd{padding:14px 14px 8px;font-weight:700;font-size:15px;color:var(--pi-dark);display:flex;align-items:center;gap:6px}
.pi-side-hd small{font-weight:400;color:var(--pi-txt2);font-size:11px}
.pi-plist{flex:1;overflow-y:auto;padding:0 8px;scrollbar-width:none}
.pi-group{margin:6px 0}
.pi-group-hd{display:flex;align-items:center;gap:4px;width:100%;padding:4px 6px;border:0;background:none;color:var(--pi-txt2);font-size:12px;cursor:pointer;font-family:inherit}
.pi-pitem{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:0;border-radius:var(--pi-r-in);background:none;color:var(--pi-txt);font-size:13px;text-align:left;cursor:pointer;font-family:inherit}
.pi-pitem:hover{background:var(--pi-surf)}
.pi-pitem.is-sel{background:var(--pi-accent-soft);color:var(--pi-accent);font-weight:600}
.pi-pitem .pi-dot{width:7px;height:7px;border-radius:50%;background:var(--pi-accent);flex-shrink:0}
.pi-pitem .pi-pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-side-ft{padding:8px;border-top:1px solid var(--pi-line);display:flex;flex-direction:column;gap:4px}
.pi-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.pi-top{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--pi-bg);border-bottom:1px solid var(--pi-line)}
.pi-top-title{font-weight:700;color:var(--pi-dark);flex-shrink:0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-tabs{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.pi-tab{padding:6px 14px;border:0;border-radius:20px;background:none;color:var(--pi-txt2);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit}
.pi-tab:hover{color:var(--pi-dark)}
.pi-tab.is-sel{background:var(--pi-dark);color:#fff}
.pi-close{width:30px;height:30px;border:0;border-radius:50%;background:var(--pi-surf);color:var(--pi-txt2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pi-close:hover{color:var(--pi-dark)}
.pi-picker{display:none}
.pi-body{flex:1;overflow-y:auto;padding:14px;scrollbar-width:none;min-height:0}
.pi-body.is-chat{display:flex;flex-direction:column;overflow:hidden}
.pi-card{background:var(--pi-bg);border-radius:var(--pi-r);padding:12px 14px;margin-bottom:10px}
.pi-card h3{margin:0 0 8px;font-size:12px;font-weight:700;color:var(--pi-dark);display:flex;align-items:center;gap:8px}
.pi-card h3 .pi-spacer{flex:1}
.pi-hint{font-size:12px;color:var(--pi-txt2);margin:4px 0}
.pi-empty{text-align:center;color:var(--pi-txt2);padding:40px 10px;font-size:13px}
.pi-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pi-row>.pi-grow{flex:1;min-width:0}
.pi-field{display:flex;flex-direction:column;gap:3px;margin-bottom:8px;min-width:0}
.pi-field>span{font-size:12px;color:var(--pi-txt2);font-weight:500}
.pi-inp,.pi-sel,.pi-ta{width:100%;padding:7px 11px;border:1.5px solid var(--pi-line);border-radius:var(--pi-r-in);font-size:13px;color:var(--pi-txt);background:var(--pi-bg);outline:none;font-family:inherit}
.pi-inp:focus,.pi-sel:focus,.pi-ta:focus{border-color:var(--pi-accent)}
.pi-inp.is-num{width:74px}
.pi-ta{resize:vertical;min-height:80px;line-height:1.6}
.pi-ta.is-mono{font-family:var(--pi-mono);font-size:12px;line-height:1.5}
.pi-ta.is-tall{min-height:360px}
.pi-btn{min-height:32px;padding:0 14px;border:1.5px solid var(--pi-line);border-radius:20px;background:var(--pi-bg);color:var(--pi-dark);font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;font-family:inherit}
.pi-btn:hover{border-color:var(--pi-dark)}
.pi-btn:active{transform:scale(.97)}
.pi-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.pi-btn.is-primary{background:var(--pi-dark);border-color:var(--pi-dark);color:#fff}
.pi-btn.is-primary:hover{opacity:.86}
.pi-btn.is-accent{background:var(--pi-accent);border-color:var(--pi-accent);color:#fff}
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
.pi-badge.is-dark{background:var(--pi-dark);color:#fff}
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
.pi-unit{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--pi-r-in);font-size:13px}
.pi-unit:hover{background:var(--pi-surf)}
.pi-unit .pi-uname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pi-unit.is-active{background:var(--pi-accent-soft)}
.pi-unit .pi-sel{width:auto;padding:2px 6px;font-size:12px}
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
.pi-node-hd{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.pi-node-hd .pi-grow{flex:1}
.pi-chat{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px 10px;scrollbar-width:none;min-height:0}
.pi-msg{max-width:86%;padding:9px 12px;border-radius:var(--pi-r);background:var(--pi-bg);font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.pi-msg.is-user{align-self:flex-end;background:var(--pi-dark);color:#fff}
.pi-msg.is-ai{align-self:flex-start}
.pi-msg-tools{display:flex;gap:2px;margin-top:6px;flex-wrap:wrap}
.pi-msg.is-user .pi-btn.is-ghost{color:rgba(255,255,255,.7)}
.pi-msg.is-user .pi-btn.is-ghost:hover{color:#fff;background:rgba(255,255,255,.12)}
.pi-msg-fold{align-self:center;font-size:12px;color:var(--pi-txt2);background:var(--pi-bg);border-radius:20px;padding:4px 12px}
.pi-compose{display:flex;gap:8px;align-items:flex-end;padding-top:8px}
.pi-compose .pi-ta{min-height:44px;max-height:180px;resize:none}
.pi-refs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.pi-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1.5px solid var(--pi-line);border-radius:20px;font-size:12px;cursor:pointer;background:var(--pi-bg);color:var(--pi-txt2);font-family:inherit}
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
.pi-status{font-size:12px;color:var(--pi-txt2);min-height:1em}
.pi-status.is-err{color:var(--pi-danger)}
.pi-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:pi-spin .8s linear infinite}
@keyframes pi-spin{to{transform:rotate(360deg)}}
.pi-dialog{position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;background:rgba(20,20,30,.28)}
.pi-dialog-box{width:440px;max-width:92vw;max-height:80vh;overflow-y:auto;background:var(--pi-bg);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);padding:16px;scrollbar-width:none}
.pi-dialog-box h4{margin:0 0 8px;font-size:15px;color:var(--pi-dark)}
.pi-dialog-box .pi-dlg-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pi-dialog-box ul{margin:6px 0;padding-left:18px;font-size:12px;color:var(--pi-txt2);max-height:200px;overflow-y:auto}
.pi-notices{position:fixed;right:16px;bottom:16px;z-index:10040;display:flex;flex-direction:column;gap:8px;max-width:340px;width:calc(100vw - 32px)}
.pi-notice{background:var(--pi-bg);border-radius:var(--pi-r);box-shadow:var(--pi-shadow);padding:12px 14px;border-left:4px solid var(--pi-accent)}
.pi-notice b{display:block;font-size:13px;color:var(--pi-dark);margin-bottom:3px}
.pi-notice p{margin:0 0 8px;font-size:12px;color:var(--pi-txt2)}
.pi-notice .pi-row{gap:6px}
@media (max-width:720px){
.pi-overlay{align-items:stretch}
.pi-panel{grid-template-columns:minmax(0,1fr);width:100vw;max-width:100vw;height:100%;max-height:none;border-radius:0}
.pi-side{display:none}
.pi-picker{display:block;width:auto;max-width:42vw;padding:4px 8px}
.pi-top{flex-wrap:wrap}
.pi-top-title{display:none}
.pi-close{margin-left:auto}
.pi-tabs{order:3;flex-basis:100%}
.pi-tree,.pi-split{grid-template-columns:minmax(0,1fr)}
.pi-entry-hd{flex-wrap:wrap}
.pi-card h3{flex-wrap:wrap}
.pi-unit{flex-wrap:wrap}
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
    send: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l11-5-4 11-2-4.5L2 8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1h5.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2"/><path d="M9 1v4h4" stroke="currentColor" stroke-width="1.2"/></svg>',
};
