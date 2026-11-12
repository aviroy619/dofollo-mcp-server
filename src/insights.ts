import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dofolloGet, DofolloError } from "./services/dofollo.js";
import { CHARACTER_LIMIT } from "./constants.js";
import { GEM_TAGS, PRESENT_RULES, TERMS } from "./terms.js";
import {
  Card,
  CardAction,
  CardRow,
  CardStat,
  ToolResult,
  cardResult,
  cardToolMeta,
  fmtInt,
  fmtPct,
  fmtPos,
  num,
  pagePath,
  signed,
  tone,
} from "./cards.js";

/* ------------------------------------------------------------------ */
/* Read-only "insight" tools: each one joins several RankMeRabbit APIs */
/* server-side and returns one card. Data sources (all /api/mcp/v1):   */
/*   visibility/metrics, visibility/hidden-gems,                       */
/*   visibility/orphan-high-potential, visibility/pages-gaining-traffic,*/
/*   visibility/top-authority, opportunities/link-profile/*page_url,   */
/*   context/page, gsc/cannibalization|ctr-anomalies|indexing          */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;

/** Read the first present field (snake_case or camelCase). */
function f(o: unknown, ...keys: string[]): unknown {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) {
    const v = (o as Obj)[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
const fs = (o: unknown, ...k: string[]) => {
  const v = f(o, ...k);
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
};
const fn = (o: unknown, ...k: string[]) => num(f(o, ...k));
const fa = (o: unknown, ...k: string[]): Obj[] => {
  const v = f(o, ...k);
  return Array.isArray(v) ? (v as Obj[]) : [];
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const readSchemes = [{ type: "oauth2" as const, scopes: ["rankmerabbit:read"] }];

function fail(err: unknown): ToolResult {
  const message = err instanceof DofolloError ? `Error ${err.status}: ${err.message}` : `Error: ${(err as Error).message}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

async function settle<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

const site = (id: string) => `/sites/${encodeURIComponent(id)}`;

/* ------------------------------ shared ------------------------------ */

type Gem = {
  url: string;
  title: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number;
  tags: string[];
  bucket: string;
  topIssues: string[];
  fixFirst: boolean;
  why: string;
};

function toGem(o: Obj): Gem {
  return {
    url: fs(o, "url", "URL"),
    title: fs(o, "title", "Title"),
    impressions: fn(o, "impressions", "Impressions"),
    clicks: fn(o, "clicks", "Clicks"),
    ctr: fn(o, "ctr", "CTR"),
    position: fn(o, "position", "Position"),
    clicksDelta: fn(o, "clicks_delta", "clicksDelta", "ClicksDelta"),
    impressionsDelta: fn(o, "impressions_delta", "impressionsDelta", "ImpressionsDelta"),
    positionDelta: fn(o, "position_delta", "positionDelta", "PositionDelta"),
    tags: (f(o, "tags", "Tags") as string[] | undefined) ?? [],
    bucket: fs(o, "bucket", "Bucket"),
    topIssues: fa(o, "top_issues", "topIssues", "TopIssues").map((i) => fs(i, "issue_type", "issueType", "IssueType")).filter(Boolean),
    fixFirst: Boolean(f(o, "fix_first", "fixFirst", "FixFirst")),
    why: fs(o, "uplift_explanation", "upliftExplanation", "UpliftExplanation"),
  };
}

async function loadGems(siteId: string, userId: string): Promise<Gem[] | undefined> {
  const data = await settle(dofolloGet<Obj>(`${site(siteId)}/visibility/hidden-gems`, userId));
  if (!data) return undefined;
  return fa(data, "pages", "Pages").map(toGem).filter((g) => g.url);
}

function gemMeta(g: { position: number; impressions: number; clicks: number; ctr?: number }): string {
  const parts = [`Pos ${fmtPos(g.position)}`, `${fmtInt(g.impressions)} ${TERMS.impressions.toLowerCase()}`, `${fmtInt(g.clicks)} ${TERMS.clicks.toLowerCase()}`];
  if (g.ctr !== undefined && g.impressions > 0) parts.push(`${TERMS.ctr} ${fmtPct(g.ctr)}`);
  return parts.join(" · ");
}

function issueIsFixable(type: string): "title" | "h1" | "alt_text" | "broken_link" | undefined {
  const t = type.toLowerCase();
  if (t.includes("description")) return undefined; // meta description: not supported yet
  if (t.includes("title")) return "title";
  if (t.includes("h1")) return "h1";
  if (t.includes("alt")) return "alt_text";
  if (t.includes("broken")) return "broken_link";
  return undefined;
}

type LinkProfile = {
  inlinks: number;
  strength: string;
  incoming: { from: string; anchor: string; type: string }[];
  opportunities: { donor: string; donorTitle: string; anchor: string; context: string }[];
};

async function loadLinkProfile(siteId: string, url: string, userId: string): Promise<LinkProfile | undefined> {
  const data = await settle(
    dofolloGet<Obj>(`${site(siteId)}/opportunities/link-profile/${encodeURIComponent(url)}`, userId),
  );
  if (!data) return undefined;
  const page = f(data, "page") as Obj | undefined;
  const seen = new Set<string>();
  const opportunities = fa(data, "opportunities")
    .map((o) => {
      const sugg = fa(o, "anchor_suggestions", "anchorSuggestions")[0];
      return {
        donor: fs(o, "donor_url", "donorUrl", "DonorURL"),
        donorTitle: fs(o, "donor_title", "donorTitle", "donor_h1"),
        anchor:
          fs(o, "suggested_anchor", "suggestedAnchor", "anchor_text", "anchorText") ||
          fs(sugg, "anchor_text", "anchorText", "text"),
        context: fs(o, "context", "donor_section_text"),
      };
    })
    .filter((o) => o.donor && !seen.has(o.donor) && seen.add(o.donor));
  return {
    inlinks: fn(page, "contextual_inlinks"),
    strength: fs(page, "link_strength") || "Isolated",
    incoming: fa(data, "incoming_links").map((l) => ({
      from: fs(l, "from_url"),
      anchor: fs(l, "anchor_text"),
      type: fs(l, "link_type"),
    })),
    opportunities,
  };
}

function addLinkPrompt(donor: string, target: string, anchor: string): string {
  return `Add an internal link on ${donor} pointing to ${target}${anchor ? ` with the anchor text "${anchor}"` : ""}. Create the proposal and show it to me before publishing.`;
}

function linkChildren(target: string, lp: LinkProfile | undefined, max = 3): CardRow[] {
  if (!lp) return [];
  return lp.opportunities.slice(0, max).map((o) => ({
    title: `From: ${o.donorTitle || pagePath(o.donor)}`,
    url: o.donor,
    meta: o.anchor ? `Anchor: "${o.anchor}"` : "Anchor to be chosen",
    action: { label: TERMS.addLink, prompt: addLinkPrompt(o.donor, target, o.anchor) },
  }));
}

function addTopLinksPrompt(targets: string[]): string {
  return `For each of these pages, add the top suggested internal link from my strongest relevant page: ${targets.join(", ")}. Create the proposals and show them as one table before publishing.`;
}

async function loadMetrics(siteId: string, userId: string): Promise<Obj | undefined> {
  return settle(dofolloGet<Obj>(`${site(siteId)}/visibility/metrics`, userId));
}

function metricStats(m: Obj | undefined): CardStat[] {
  if (!m) return [];
  const latest = f(m, "latest", "Latest") as Obj | undefined;
  const growth = f(m, "growth", "Growth") as Obj | undefined;
  if (!latest) return [];
  const g = (k1: string, k2: string) => {
    const gm = f(growth, k1, k2) as Obj | undefined;
    return { abs: fn(gm, "absolute", "Absolute"), pct: fn(gm, "percentage", "Percentage") };
  };
  const clicksG = g("clicks_growth", "ClicksGrowth");
  const imprG = g("impressions_growth", "ImpressionsGrowth");
  const posG = g("position_improvement", "PositionImprovement");
  const kwG = g("keywords_growth", "KeywordsGrowth");
  const fixedG = g("issues_fixed", "IssuesFixed");
  const pct = (x: { abs: number; pct: number }) => (x.pct ? signed(x.pct, 0, "%") : x.abs ? signed(x.abs) : "");
  return [
    { label: TERMS.clicks, value: fmtInt(fn(latest, "total_clicks", "TotalClicks")), delta: pct(clicksG), tone: tone(clicksG.abs) },
    { label: TERMS.impressions, value: fmtInt(fn(latest, "total_impressions", "TotalImpressions")), delta: pct(imprG), tone: tone(imprG.abs) },
    {
      label: TERMS.avgPosition,
      value: fmtPos(fn(latest, "avg_position", "AvgPosition")),
      delta: posG.abs ? (posG.abs > 0 ? "↑ " : "↓ ") + Math.abs(posG.abs).toFixed(1) : "",
      tone: tone(posG.abs),
    },
    { label: TERMS.keywordsRanking, value: fmtInt(fn(latest, "keywords_ranking", "KeywordsRanking")), delta: pct(kwG), tone: tone(kwG.abs) },
    { label: TERMS.issuesFixed, value: fmtInt(Math.max(0, fixedG.abs)), delta: `${fmtInt(fn(latest, "issues_count", "IssuesCount"))} open`, tone: "neutral" },
  ];
}

const NO_GSC = "No Google data yet. Connect Google Search Console for this site in the RankMeRabbit console.";

/* ------------------------------- tools ------------------------------ */

export function registerInsightTools(server: McpServer, userId: string): void {
  const plain = { securitySchemes: readSchemes, annotations: readOnly, _meta: { securitySchemes: readSchemes } };
  const base = {
    securitySchemes: readSchemes,
    annotations: readOnly,
    _meta: { securitySchemes: readSchemes, ...cardToolMeta },
  };

  /* 1. Site status ---------------------------------------------------- */
  server.registerTool(
    "rankmerabbit_site_status",
    {
      title: TERMS.siteStatus,
      description: `One-glance status of a site: Google traffic (clicks, impressions, avg position, ranking keywords — change since the first crawl), issues fixed vs open, the top ${TERMS.hiddenGems} and ${TERMS.orphanHighPotential}.
Use for "how is my site doing?", "status", "what should I do next?". Shows a card with buttons.`,
      inputSchema: { site_id: z.string().min(1).describe("Site id from rankmerabbit_list_sites") },
      ...base,
    },
    async ({ site_id }) => {
      try {
        const [metrics, gems, orphans] = await Promise.all([
          loadMetrics(site_id, userId),
          loadGems(site_id, userId),
          settle(dofolloGet<Obj>(`${site(site_id)}/visibility/orphan-high-potential`, userId)),
        ]);
        const orphanRows = fa(orphans, "pages");
        const card: Card = {
          kind: "site_status",
          title: TERMS.siteStatus,
          subtitle: `${TERMS.last28d} · change ${TERMS.sinceFirstCrawl}`,
          stats: metricStats(metrics),
          sections: [
            {
              title: TERMS.hiddenGems,
              note: gems ? `${gems.length} found` : undefined,
              empty: gems ? "No hidden gems right now." : NO_GSC,
              rows: (gems ?? []).slice(0, 3).map((g) => ({
                title: g.title || pagePath(g.url),
                url: g.url,
                meta: gemMeta(g),
                badges: g.tags.slice(0, 2),
                action: { label: TERMS.linkSuggestions, prompt: `Show internal link opportunities for ${g.url} from my strongest pages.` },
              })),
              more: gems && gems.length > 3 ? { label: `All ${TERMS.hiddenGems.toLowerCase()}`, prompt: "Show all my hidden gems with link suggestions." } : undefined,
            },
            {
              title: TERMS.orphanHighPotential,
              note: orphans ? `${fn(orphans, "total")} found` : undefined,
              empty: "None — every page with impressions has internal links.",
              rows: orphanRows.slice(0, 3).map((o) => ({
                title: fs(o, "title") || pagePath(fs(o, "url")),
                url: fs(o, "url"),
                meta: `${fmtInt(fn(o, "impressions"))} ${TERMS.impressions.toLowerCase()} · ${fn(o, "contextual_inlinks")} ${TERMS.contextualInlinks.toLowerCase()}`,
                action: { label: TERMS.linkSuggestions, prompt: `Show internal link opportunities for ${fs(o, "url")} from my strongest pages.` },
              })),
            },
          ],
          actions: [
            { label: "Pages to fix", prompt: "Which pages on this site need work first? Show them page-wise." },
            { label: TERMS.traffic, prompt: "Show my Google traffic report." },
            { label: TERMS.hiddenGems, prompt: "Show my hidden gems with link suggestions." },
          ],
        };
        return cardResult(card);
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* 2. Traffic report ------------------------------------------------- */
  server.registerTool(
    "rankmerabbit_traffic_report",
    {
      title: TERMS.traffic,
      description: `Google traffic report: totals, ${TERMS.pagesGainingTraffic}, ${TERMS.pagesLosingGround} (Falling Demand / Slipping hidden gems, vs previous 28 days) and ${TERMS.topPagesByTraffic} (the strongest pages to link from).
Use for any traffic, clicks, impressions, ranking or "why is traffic down/up" question.`,
      inputSchema: { site_id: z.string().min(1).describe("Site id") },
      ...base,
    },
    async ({ site_id }) => {
      try {
        const [metrics, gaining, gems] = await Promise.all([
          loadMetrics(site_id, userId),
          settle(dofolloGet<Obj>(`${site(site_id)}/visibility/pages-gaining-traffic`, userId)),
          loadGems(site_id, userId),
        ]);
        const losing = (gems ?? [])
          .filter((g) => g.tags.includes(GEM_TAGS.fallingDemand) || g.tags.includes(GEM_TAGS.slipping))
          .sort((a, b) => a.clicksDelta - b.clicksDelta);
        const topPages = fa(metrics, "top_pages_traffic", "TopPagesTraffic");
        const card: Card = {
          kind: "traffic",
          title: TERMS.traffic,
          subtitle: `${TERMS.last28d} · change ${TERMS.sinceFirstCrawl}`,
          stats: metricStats(metrics).slice(0, 4),
          sections: [
            {
              title: TERMS.pagesGainingTraffic,
              empty: metrics ? "No pages gaining yet." : NO_GSC,
              rows: fa(gaining, "pages").slice(0, 5).map((p) => {
                const change = fn(p, "position_change");
                return {
                  title: pagePath(fs(p, "url")),
                  url: fs(p, "url"),
                  meta: `${gemMeta({ position: fn(p, "gsc_avg_position"), impressions: fn(p, "gsc_impressions"), clicks: fn(p, "gsc_clicks") })}${change > 0 ? ` · ↑ ${change.toFixed(1)} positions` : ""}`,
                  badges: (f(p, "issues_fixed") as string[] | undefined) ?? [],
                };
              }),
            },
            {
              title: TERMS.pagesLosingGround,
              note: TERMS.vsPrevious28d,
              empty: "No pages losing clicks.",
              rows: losing.slice(0, 5).map((g) => ({
                title: g.title || pagePath(g.url),
                url: g.url,
                meta: `${gemMeta(g)} · ${signed(g.clicksDelta)} clicks · ${signed(g.impressionsDelta)} impressions`,
                badges: g.tags.filter((t) => t === GEM_TAGS.fallingDemand || t === GEM_TAGS.slipping),
                action: { label: TERMS.openPage, prompt: `Give me the page report for ${g.url}.` },
              })),
            },
            {
              title: TERMS.topPagesByTraffic,
              note: "best pages to link from",
              rows: topPages.slice(0, 5).map((p) => ({
                title: pagePath(fs(p, "url")),
                url: fs(p, "url"),
                meta: gemMeta({ position: fn(p, "position"), impressions: fn(p, "impressions"), clicks: fn(p, "clicks") }),
              })),
            },
          ],
          actions: [
            { label: TERMS.hiddenGems, prompt: "Show my hidden gems with link suggestions." },
            { label: TERMS.orphanHighPotential, prompt: "Show orphan pages that get impressions, with link suggestions." },
            { label: "Search Console insights", prompt: "Check my site for keyword cannibalization and CTR anomalies." },
          ],
        };
        return cardResult(card);
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* 3. Hidden gems + link sources ------------------------------------- */
  server.registerTool(
    "rankmerabbit_hidden_gems",
    {
      title: TERMS.hiddenGems,
      description: `${TERMS.hiddenGems}: pages Google already shows (100+ impressions) that could win more clicks — near page 1, low CTR, rising or slipping. For each page also returns its ${TERMS.linkStrength.toLowerCase()} and the best pages to link to it from, with suggested anchor text.
Tags: ${Object.values(GEM_TAGS).join(", ")}.
Use for "promising pages", "quick wins", "pages close to page 1", "what can rank higher".`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        tag: z.enum(Object.values(GEM_TAGS) as [string, ...string[]]).optional().describe("Only gems with this tag"),
        limit: z.number().int().min(1).max(10).optional().describe("Pages to return (default 5)"),
      },
      ...base,
    },
    async ({ site_id, tag, limit }) => {
      try {
        const n = limit ?? 5;
        const gems = await loadGems(site_id, userId);
        if (!gems) return cardResult({ kind: "hidden_gems", title: TERMS.hiddenGems, sections: [{ title: TERMS.hiddenGems, rows: [], empty: NO_GSC }] });
        const list = (tag ? gems.filter((g) => g.tags.includes(tag)) : gems).slice(0, n);
        const profiles = await Promise.all(list.map((g) => loadLinkProfile(site_id, g.url, userId)));
        const rows: CardRow[] = list.map((g, i) => {
          const lp = profiles[i];
          const fixable = g.topIssues.map((t) => [t, issueIsFixable(t)] as const).find(([, k]) => k);
          const children = linkChildren(g.url, lp);
          let action: CardAction | undefined;
          if (fixable) action = { label: TERMS.fix, prompt: `Fix the ${fixable[0]} issue on ${g.url}. Show me the change before publishing.` };
          else if (children.length) action = { label: TERMS.addTopLinks, prompt: addTopLinksPrompt([g.url]) };
          return {
            title: g.title || pagePath(g.url),
            url: g.url,
            meta: gemMeta(g) + (lp ? ` · ${lp.inlinks} ${TERMS.contextualInlinks.toLowerCase()}` : ""),
            badges: [...g.tags.slice(0, 2), ...(lp ? [`${TERMS.linkStrength}: ${lp.strength}`] : []), ...(g.fixFirst ? ["Fix first"] : [])],
            action,
            children,
          };
        });
        const withLinks = list.filter((_, i) => (profiles[i]?.opportunities.length ?? 0) > 0).map((g) => g.url);
        return cardResult(
          {
            kind: "hidden_gems",
            title: TERMS.hiddenGems + (tag ? ` · ${tag}` : ""),
            subtitle: `${gems.length} pages · ${TERMS.last28d}`,
            sections: [{ title: "Pages", note: "expand for link suggestions", rows, empty: "No hidden gems match." }],
            actions: [
              ...(withLinks.length ? [{ label: `${TERMS.addTopLinks} for all ${withLinks.length}`, prompt: addTopLinksPrompt(withLinks) }] : []),
              ...(gems.length > n ? [{ label: TERMS.showMore, prompt: `Show ${Math.min(10, n + 5)} hidden gems${tag ? ` tagged ${tag}` : ""}.` }] : []),
              { label: TERMS.pagesLosingGround, prompt: `Show hidden gems tagged ${GEM_TAGS.fallingDemand}.` },
            ],
          },
          { why: Object.fromEntries(list.map((g) => [g.url, g.why])) },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* 4. Orphan pages with impressions ---------------------------------- */
  server.registerTool(
    "rankmerabbit_orphan_pages_with_impressions",
    {
      title: TERMS.orphanHighPotential,
      description: `${TERMS.orphanHighPotential}: pages Google shows (100+ impressions) that have 0–1 contextual internal links — the cheapest ranking win. Returns the best pages to link from, with anchors.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        limit: z.number().int().min(1).max(10).optional().describe("Pages to return (default 5)"),
      },
      ...base,
    },
    async ({ site_id, limit }) => {
      try {
        const data = await dofolloGet<Obj>(`${site(site_id)}/visibility/orphan-high-potential`, userId);
        const pages = fa(data, "pages").slice(0, limit ?? 5);
        const profiles = await Promise.all(pages.map((p) => loadLinkProfile(site_id, fs(p, "url"), userId)));
        const rows: CardRow[] = pages.map((p, i) => {
          const url = fs(p, "url");
          const children = linkChildren(url, profiles[i]);
          return {
            title: fs(p, "title") || pagePath(url),
            url,
            meta: `${fmtInt(fn(p, "impressions"))} ${TERMS.impressions.toLowerCase()} · ${fn(p, "contextual_inlinks")} ${TERMS.contextualInlinks.toLowerCase()}`,
            action: children.length ? { label: TERMS.addTopLinks, prompt: addTopLinksPrompt([url]) } : undefined,
            children,
          };
        });
        const targets = pages.map((p) => fs(p, "url")).filter((_, i) => (profiles[i]?.opportunities.length ?? 0) > 0);
        return cardResult({
          kind: "orphans",
          title: TERMS.orphanHighPotential,
          subtitle: `${fn(data, "total")} pages`,
          sections: [{ title: "Pages", note: "expand for link suggestions", rows, empty: "None — every page with impressions has internal links." }],
          actions: targets.length ? [{ label: `${TERMS.addTopLinks} for all ${targets.length}`, prompt: addTopLinksPrompt(targets) }] : [],
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* 5. Page report ---------------------------------------------------- */
  server.registerTool(
    "rankmerabbit_page_report",
    {
      title: TERMS.pageReport,
      description: `Everything about one page in one card: Google numbers (if it is a hidden gem), open issues with Fix buttons, ${TERMS.linkStrength.toLowerCase()}, ${TERMS.linkOpportunities.toLowerCase()} with Add link buttons, and ${TERMS.incomingLinks.toLowerCase()}.
Use whenever the user asks about one specific page, or after a fix to show what is still open on that page.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        url: z.string().url().describe("Page URL"),
      },
      ...base,
    },
    async ({ site_id, url }) => {
      try {
        const [ctx, lp, gems] = await Promise.all([
          settle(dofolloGet<Obj>(`${site(site_id)}/context/page`, userId, { url })),
          loadLinkProfile(site_id, url, userId),
          loadGems(site_id, userId),
        ]);
        if (!ctx && !lp) throw new DofolloError(404, "page not found for this site");
        const norm = (u: string) => u.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
        const gem = gems?.find((g) => norm(g.url) === norm(url));
        const page = f(ctx, "page") as Obj | undefined;
        const stats: CardStat[] = [];
        if (gem) {
          stats.push(
            { label: TERMS.clicks, value: fmtInt(gem.clicks), delta: signed(gem.clicksDelta), tone: tone(gem.clicksDelta) },
            { label: TERMS.impressions, value: fmtInt(gem.impressions), delta: signed(gem.impressionsDelta), tone: tone(gem.impressionsDelta) },
            { label: TERMS.avgPosition, value: fmtPos(gem.position), delta: gem.positionDelta ? (gem.positionDelta > 0 ? "↑ " : "↓ ") + Math.abs(gem.positionDelta).toFixed(1) : "", tone: tone(gem.positionDelta) },
          );
        }
        if (lp) stats.push({ label: TERMS.contextualInlinks, value: String(lp.inlinks), delta: lp.strength, tone: lp.inlinks >= 4 ? "good" : lp.inlinks === 0 ? "bad" : "neutral" });
        const issues = fa(ctx, "relevant_issues");
        return cardResult(
          {
            kind: "page_report",
            title: fs(page, "title") || pagePath(url),
            subtitle: pagePath(url) + (gem ? ` · ${TERMS.vsPrevious28d}` : ""),
            stats,
            sections: [
              {
                title: TERMS.openIssues,
                note: issues.length ? `${issues.length}` : undefined,
                empty: "No open issues on this page.",
                rows: issues.map((iss) => {
                  const type = fs(iss, "type");
                  const kind = issueIsFixable(type);
                  return {
                    title: type.replace(/_/g, " "),
                    meta: fs(iss, "detail"),
                    badges: [fs(iss, "severity")].filter(Boolean),
                    action: kind
                      ? { label: TERMS.fix, prompt: `Fix the ${type} issue on ${url}. Show me the change before publishing.` }
                      : { label: "Not supported yet", prompt: `How do I fix the ${type} issue on ${url} manually?` },
                  };
                }),
              },
              {
                title: TERMS.linkOpportunities,
                note: lp ? `${lp.opportunities.length}` : undefined,
                empty: "No link suggestions for this page yet.",
                rows: linkChildren(url, lp, 5),
              },
              {
                title: TERMS.incomingLinks,
                note: lp ? `${lp.incoming.length}` : undefined,
                empty: "No internal links point here.",
                rows: (lp?.incoming ?? []).slice(0, 5).map((l) => ({
                  title: pagePath(l.from),
                  url: l.from,
                  meta: [l.anchor ? `"${l.anchor}"` : "", l.type].filter(Boolean).join(" · "),
                })),
              },
            ],
            actions: lp?.opportunities.length ? [{ label: `${TERMS.addTopLinks} (${Math.min(3, lp.opportunities.length)})`, prompt: addTopLinksPrompt([url]) }] : [],
            note: gem?.why || undefined,
          },
          { url },
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  /* 6. Search Console insights (raw lists, shown as tables) ----------- */
  const GSC_INSIGHTS = { cannibalization: "cannibalization", ctr_anomalies: "ctr-anomalies", indexing: "indexing" } as const;
  server.registerTool(
    "rankmerabbit_search_console_insights",
    {
      title: "Search Console insights",
      description: `Google Search Console analysis RankMeRabbit computes:
- cannibalization: several of the site's pages competing for the same query
- ctr_anomalies: pages/queries whose CTR is far below what their position should get
- indexing: indexing status from Search Console
Present the result as a short table (page, query, numbers, what to do), most impactful first.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        type: z.enum(["cannibalization", "ctr_anomalies", "indexing"]),
        level: z.string().optional().describe("ctr_anomalies only: page or query level (passed to the API)"),
      },
      ...plain,
    },
    async ({ site_id, type, level }) => {
      try {
        const data = await dofolloGet(`${site(site_id)}/gsc/${GSC_INSIGHTS[type]}`, userId, { level });
        let text = JSON.stringify(data, null, 2);
        if (text.length > CHARACTER_LIMIT) text = text.slice(0, CHARACTER_LIMIT) + "\n…[truncated]";
        return { content: [{ type: "text", text: PRESENT_RULES + "\n\n" + text }] };
      } catch (err) {
        return fail(err);
      }
    },
  );
}
