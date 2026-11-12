import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PRESENT_RULES } from "./terms.js";

/* ------------------------------------------------------------------ */
/* Card model — one generic shape, rendered as a widget AND as markdown */
/* ------------------------------------------------------------------ */

export type CardAction = { label: string; prompt: string };
export type CardStat = { label: string; value: string; delta?: string; tone?: "good" | "bad" | "neutral" };
export type CardRow = {
  title: string;
  url?: string;
  meta?: string;
  badges?: string[];
  action?: CardAction;
  children?: CardRow[];
};
export type CardSection = { title: string; note?: string; rows: CardRow[]; empty?: string; more?: CardAction };
export type Card = {
  kind: string;
  title: string;
  subtitle?: string;
  stats?: CardStat[];
  sections?: CardSection[];
  actions?: CardAction[];
  note?: string;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/* ---------------------------- formatting ---------------------------- */

export function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function fmtInt(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(ratio: number, digits = 1): string {
  return (ratio * 100).toFixed(digits) + "%";
}

export function fmtPos(p: number): string {
  return p > 0 ? p.toFixed(1) : "—";
}

export function signed(n: number, digits = 0, suffix = ""): string {
  const v = digits ? n.toFixed(digits) : String(Math.round(n));
  return (n > 0 ? "+" : n < 0 ? "" : "±") + v + suffix;
}

export function tone(n: number, higherIsBetter = true): "good" | "bad" | "neutral" {
  if (!n) return "neutral";
  return (n > 0) === higherIsBetter ? "good" : "bad";
}

export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname || "/") + (u.search || "");
  } catch {
    return url;
  }
}

function mdCell(value: string | undefined): string {
  return (value || "—").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/* ----------------------------- markdown ----------------------------- */

export function cardMarkdown(card: Card): string {
  const out: string[] = [`### ${card.title}`];
  if (card.subtitle) out.push(card.subtitle);
  if (card.stats?.length) {
    out.push("", "| " + card.stats.map((s) => mdCell(s.label)).join(" | ") + " |");
    out.push("|" + card.stats.map(() => "---").join("|") + "|");
    out.push("| " + card.stats.map((s) => mdCell(s.value + (s.delta ? ` (${s.delta})` : ""))).join(" | ") + " |");
  }
  for (const section of card.sections ?? []) {
    out.push("", `**${section.title}**` + (section.note ? ` — ${section.note}` : ""));
    if (!section.rows.length) {
      out.push(section.empty || "Nothing here right now.");
      continue;
    }
    out.push("", "| Page | Details | Next |", "|---|---|---|");
    for (const row of section.rows) {
      const details = [row.meta, row.badges?.length ? row.badges.join(", ") : ""].filter(Boolean).join(" · ");
      out.push(`| ${mdCell(row.title)} | ${mdCell(details)} | ${mdCell(row.action?.label)} |`);
      for (const child of row.children ?? []) {
        out.push(`| ↳ ${mdCell(child.title)} | ${mdCell(child.meta)} | ${mdCell(child.action?.label)} |`);
      }
    }
    if (section.more) out.push("", `→ ${section.more.label}`);
  }
  if (card.actions?.length) {
    out.push("", "**Next actions:** " + card.actions.map((a) => a.label).join(" · "));
  }
  if (card.note) out.push("", card.note);
  return out.join("\n");
}

/** Build a tool result: widget data (structuredContent) + markdown fallback + presentation rules. */
export function cardResult(card: Card, data?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: cardMarkdown(card) + "\n\n" + PRESENT_RULES }],
    structuredContent: { card, ...(data ? { data } : {}) },
  };
}

/* ------------------------------ widget ------------------------------ */

const WIDGET_VERSION = "v1";
export const CARD_URI_MCP_APP = `ui://rankmerabbit/card-${WIDGET_VERSION}.html`;
export const CARD_URI_SKYBRIDGE = `ui://rankmerabbit/card-${WIDGET_VERSION}.skybridge.html`;

/** Spread into registerTool config so ChatGPT and MCP Apps hosts (Claude) render the card. */
export const cardToolMeta = {
  ui: { resourceUri: CARD_URI_MCP_APP },
  "openai/outputTemplate": CARD_URI_SKYBRIDGE,
  "openai/widgetAccessible": false,
  "openai/toolInvocation/invoking": "Loading RankMeRabbit data…",
  "openai/toolInvocation/invoked": "Done",
} as const;

const CARD_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--bg2:#f6f7f6;--fg:#111;--fg2:#5b6460;--line:#e3e6e4;--brand:#00472d;--good:#0b7a3e;--bad:#b42318;--btn:#00472d;--btnfg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1b1d1c;--bg2:#242725;--fg:#f2f4f3;--fg2:#a3aca7;--line:#333835;--brand:#6fd3a3;--good:#5fd08f;--bad:#ff8a80;--btn:#6fd3a3;--btnfg:#0e1f17}}
[data-theme=dark]{--bg:#1b1d1c;--bg2:#242725;--fg:#f2f4f3;--fg2:#a3aca7;--line:#333835;--brand:#6fd3a3;--good:#5fd08f;--bad:#ff8a80;--btn:#6fd3a3;--btnfg:#0e1f17}
[data-theme=light]{--bg:#fff;--bg2:#f6f7f6;--fg:#111;--fg2:#5b6460;--line:#e3e6e4;--brand:#00472d;--good:#0b7a3e;--bad:#b42318;--btn:#00472d;--btnfg:#fff}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:transparent}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.t{font-weight:600;font-size:15px}.sub{font-size:12px;color:var(--fg2)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:12px}
.stat{background:var(--bg2);border-radius:10px;padding:8px 10px}.sl{font-size:12px;color:var(--fg2)}.sv{font-size:19px;font-weight:600}
.sd{font-size:12px}.good{color:var(--good)}.bad{color:var(--bad)}.neutral{color:var(--fg2)}
.sec{margin-top:10px}.sh{font-size:12px;color:var(--fg2);margin:0 0 4px;display:flex;gap:6px;justify-content:space-between}
.row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.rm{flex:1;min-width:0}.rt{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd{font-size:12px;color:var(--fg2)}.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--bg2);color:var(--fg2);margin:3px 4px 0 0}
.kids{background:var(--bg2);border-radius:10px;padding:2px 10px;margin:0 0 8px}.kids .row{border-top:1px solid var(--line);padding:7px 0}.kids .row:first-child{border-top:0}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:8px;padding:5px 11px;cursor:pointer;white-space:nowrap}
button.p{background:var(--btn);color:var(--btnfg);border-color:var(--btn)}button:disabled{opacity:.55;cursor:default}
.tg{background:none;border:0;padding:2px 4px;color:var(--fg2)}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.empty{font-size:13px;color:var(--fg2);padding:8px 0;border-top:1px solid var(--line)}
.note{font-size:12px;color:var(--fg2);margin-top:10px}
</style></head><body><div id="root"></div>
<script>
(function(){
  var root=document.getElementById("root"), seq=1, pending={}, isApp=false;
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]})}
  function rpc(method,params){var id=seq++;window.parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params},"*");return new Promise(function(r){pending[id]=r})}
  function notify(method,params){window.parent.postMessage({jsonrpc:"2.0",method:method,params:params},"*")}
  function send(prompt,btn){
    if(btn){btn.disabled=true}
    if(window.openai&&window.openai.sendFollowUpMessage){window.openai.sendFollowUpMessage({prompt:prompt});return}
    rpc("ui/message",{role:"user",content:[{type:"text",text:prompt}]});
  }
  function resize(){if(isApp){notify("ui/notifications/size-changed",{width:document.body.scrollWidth,height:document.body.scrollHeight})}}
  function btn(a,primary){return a?'<button class="'+(primary?"p":"")+'" data-p="'+esc(a.prompt)+'">'+esc(a.label)+'</button>':""}
  function row(r,i,primary){
    var kids=r.children&&r.children.length, id="k"+i;
    var h='<div class="row"><div class="rm"><div class="rt" title="'+esc(r.url||r.title)+'">'+esc(r.title)+'</div>';
    if(r.meta)h+='<div class="rd">'+esc(r.meta)+'</div>';
    if(r.badges&&r.badges.length)h+='<div>'+r.badges.map(function(b){return '<span class="badge">'+esc(b)+'</span>'}).join("")+'</div>';
    h+='</div>'+btn(r.action,primary);
    if(kids)h+='<button class="tg" data-t="'+id+'" aria-label="Show details">'+(i===0?"▴":"▾")+'</button>';
    h+='</div>';
    if(kids)h+='<div class="kids" id="'+id+'"'+(i===0?"":' hidden')+'>'+r.children.map(function(c){return row(c,-1,false)}).join("")+'</div>';
    return h;
  }
  var n=0;
  function render(data){
    var c=data&&data.card; if(!c){return}
    n=0;
    var h='<div class="card"><div class="hd"><div class="t">'+esc(c.title)+'</div>'+(c.subtitle?'<div class="sub">'+esc(c.subtitle)+'</div>':"")+'</div>';
    if(c.stats&&c.stats.length){h+='<div class="stats">'+c.stats.map(function(s){return '<div class="stat"><div class="sl">'+esc(s.label)+'</div><div class="sv">'+esc(s.value)+'</div>'+(s.delta?'<div class="sd '+esc(s.tone||"neutral")+'">'+esc(s.delta)+'</div>':"")+'</div>'}).join("")+'</div>'}
    (c.sections||[]).forEach(function(s){
      h+='<div class="sec"><div class="sh"><span>'+esc(s.title)+'</span>'+(s.note?'<span>'+esc(s.note)+'</span>':"")+'</div>';
      if(!s.rows.length){h+='<div class="empty">'+esc(s.empty||"Nothing here right now.")+'</div>'}
      s.rows.forEach(function(r){h+=row(r,n++,false)});
      if(s.more)h+='<div class="acts">'+btn(s.more,false)+'</div>';
      h+='</div>';
    });
    if(c.actions&&c.actions.length)h+='<div class="acts">'+c.actions.map(function(a,i){return btn(a,i===0)}).join("")+'</div>';
    if(c.note)h+='<div class="note">'+esc(c.note)+'</div>';
    root.innerHTML=h+'</div>';
    resize();
  }
  root.addEventListener("click",function(e){
    var b=e.target.closest("button"); if(!b)return;
    if(b.dataset.t){var k=document.getElementById(b.dataset.t);k.hidden=!k.hidden;b.textContent=k.hidden?"▾":"▴";resize();return}
    if(b.dataset.p)send(b.dataset.p,b);
  });
  // ChatGPT (Apps SDK)
  function fromOpenAI(){if(window.openai){if(window.openai.theme)document.documentElement.dataset.theme=window.openai.theme;if(window.openai.toolOutput)render(window.openai.toolOutput)}}
  window.addEventListener("openai:set_globals",fromOpenAI);
  fromOpenAI();
  // MCP Apps hosts (Claude and others)
  window.addEventListener("message",function(e){
    var m=e.data; if(!m||m.jsonrpc!=="2.0")return;
    if(m.id&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];return}
    if(m.method==="ui/notifications/tool-result"){render(m.params&&m.params.structuredContent)}
    if(m.method==="ui/notifications/host-context-changed"&&m.params&&m.params.theme){document.documentElement.dataset.theme=m.params.theme}
  });
  if(!window.openai){
    isApp=true;
    rpc("ui/initialize",{protocolVersion:"2025-06-18",appInfo:{name:"rankmerabbit-card",version:"1"},appCapabilities:{}}).then(function(r){
      var ctx=r&&r.hostContext; if(ctx&&ctx.theme)document.documentElement.dataset.theme=ctx.theme;
      notify("ui/notifications/initialized",{});
    });
  }
  new ResizeObserver(resize).observe(document.body);
})();
</script></body></html>`;

/** Register the card widget for both ChatGPT (skybridge) and MCP Apps hosts. */
export function registerCardResources(server: McpServer): void {
  const csp = { connect_domains: [], resource_domains: [] };
  server.registerResource(
    "rankmerabbit-card",
    CARD_URI_MCP_APP,
    { title: "RankMeRabbit card", mimeType: "text/html;profile=mcp-app" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html;profile=mcp-app",
          text: CARD_HTML,
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    }),
  );
  server.registerResource(
    "rankmerabbit-card-chatgpt",
    CARD_URI_SKYBRIDGE,
    { title: "RankMeRabbit card", mimeType: "text/html+skybridge" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html+skybridge",
          text: CARD_HTML,
          _meta: {
            "openai/widgetPrefersBorder": false,
            "openai/widgetCSP": csp,
            "openai/widgetDescription": "RankMeRabbit SEO card. The card already shows the rows; summarise only what matters.",
          },
        },
      ],
    }),
  );
}
