import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dofolloGet, dofolloPost, DofolloError } from "./services/dofollo.js";
import { CHARACTER_LIMIT } from "./constants.js";
import { cardToolMeta, registerCardResources, type Card } from "./cards.js";
import { registerInsightTools } from "./insights.js";
import { TERMS } from "./terms.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/** Format a successful payload as pretty JSON text, truncating oversized responses. */
function ok(data: unknown): ToolResult {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n…[truncated — ${text.length} chars total. Use filters or pagination (limit/offset) to narrow the result.]`;
  }
  return { content: [{ type: "text", text }] };
}

/** Format an error as an actionable message for the model. */
function fail(err: unknown): ToolResult {
  const message =
    err instanceof DofolloError
      ? `Error ${err.status}: ${err.message}`
      : `Error: ${(err as Error).message}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

const AUDIT_TYPES = [
  "canonical",
  "titles",
  "broken-links",
  "crawl-blocking",
  "thin-content",
  "alt-text",
  "orphan-pages",
] as const;

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const readSecuritySchemes = [
  {
    type: "oauth2" as const,
    scopes: ["rankmerabbit:read"],
  },
] as const;

const writeSecuritySchemes = [
  {
    type: "oauth2" as const,
    scopes: ["rankmerabbit:read", "rankmerabbit:write"],
  },
] as const;

const readToolSecurity = {
  securitySchemes: readSecuritySchemes,
  _meta: {
    securitySchemes: readSecuritySchemes,
  },
} as const;

const writeToolSecurity = {
  securitySchemes: writeSecuritySchemes,
  _meta: {
    securitySchemes: writeSecuritySchemes,
  },
} as const;

/** Same as above, plus the card widget for ChatGPT / MCP Apps hosts. */
const readCardSecurity = {
  securitySchemes: readSecuritySchemes,
  _meta: { securitySchemes: readSecuritySchemes, ...cardToolMeta },
} as const;

const writeCardSecurity = {
  securitySchemes: writeSecuritySchemes,
  _meta: { securitySchemes: writeSecuritySchemes, ...cardToolMeta },
} as const;

const writeTool = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const idempotentWriteTool = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const publishingWriteTool = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const destructiveWriteTool = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function requireWrite(canWrite: boolean): ToolResult | undefined {
  if (canWrite) {
    return undefined;
  }
  return {
    content: [
      {
        type: "text",
        text: "Error 403: this OAuth token is missing the rankmerabbit:write scope.",
      },
    ],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        'Bearer resource_metadata="https://mcp.rankmerabbit.com/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="The rankmerabbit:write scope is required for this action", scope="rankmerabbit:write"',
      ],
    },
  };
}

const PROPOSAL_ACTION_TYPES = ["title", "h1", "alt_text", "broken_link"] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FixAction = Record<string, unknown> & { id?: string; status?: string };

const PRESENTATION_NOTE =
  "Show the table below to the user exactly as given. Do not mention internal fields (credits, publish flags, ids other than the proposal id).";

const FIELD_LABELS: Record<string, string> = {
  title: "SEO title",
  h1: "H1 heading",
  alt_text: "Image alt text",
  broken_link: "Broken link",
};

function pick(action: FixAction | undefined, ...keys: string[]): string {
  if (!action) return "";
  for (const key of keys) {
    const value = action[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function cell(value: string): string {
  return (value || "—").replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url;
  }
}

function statusLabel(status: string | undefined, error: string): string {
  switch (status) {
    case "proposed":
      return "📝 Proposed (not live yet)";
    case "approved":
    case "rollback_pending":
      return "⏳ Queued — the site's plugin applies it on its next sync";
    case "applied":
      return "✅ Live";
    case "rolled_back":
      return "↩️ Reverted";
    case "failed":
      return "❌ Failed" + (error ? `: ${error}` : "");
    default:
      return status || "Unknown";
  }
}

/** A compact, user-facing result: a Fix status card (widget) + markdown table + the proposal id. */
function fixTable(action: FixAction | undefined, statusOverride?: string, extra?: string): ToolResult {
  const status = statusOverride ?? action?.status;
  const type = pick(action, "action_type", "actionType");
  const change = FIELD_LABELS[type] ?? (type || "Fix");
  const pageUrl = pick(action, "page_url", "pageUrl");
  const page = pagePath(pageUrl);
  const before = type === "broken_link" ? pick(action, "broken_url", "old_value", "oldValue") : pick(action, "old_value", "oldValue");
  const after = pick(action, "new_value", "newValue");
  const error = pick(action, "error_message", "errorMessage");
  const id = pick(action, "id", "_id");
  const siteId = pick(action, "site_id", "siteId");
  const lines = [
    PRESENTATION_NOTE,
    "",
    "| Page | Change | Before | After | Status |",
    "|---|---|---|---|---|",
    `| ${cell(page)} | ${cell(change)} | ${cell(before)} | ${cell(after)} | ${cell(statusLabel(status, error))} |`,
  ];
  if (id) lines.push("", `Proposal id: ${id} (use it to check status or revert).`);
  if (extra) lines.push("", extra);

  const actions: { label: string; prompt: string }[] = [];
  if (status === "proposed" && id) actions.push({ label: "Publish", prompt: `Publish fix proposal ${id}${siteId ? ` on site ${siteId}` : ""}.` });
  if ((status === "approved" || status === "rollback_pending") && id) actions.push({ label: "Check again", prompt: `Check the status of fix proposal ${id}${siteId ? ` on site ${siteId}` : ""}.` });
  if (pageUrl) actions.push({ label: "What's still open on this page", prompt: `Give me the page report for ${pageUrl}.` });
  if (status === "applied" && id) actions.push({ label: TERMS.revert, prompt: `Revert fix proposal ${id}${siteId ? ` on site ${siteId}` : ""}.` });
  actions.push({ label: "Next page to fix", prompt: "Which page should I fix next? Show pages page-wise." });

  const card: Card = {
    kind: "fix_status",
    title: TERMS.fixStatus,
    subtitle: statusLabel(status, error),
    sections: [
      {
        title: change,
        rows: [
          { title: page, url: pageUrl, meta: `Before: ${before || "—"}` },
          { title: "After", meta: after || "—" },
        ],
      },
    ],
    actions,
    note: extra,
  };
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { card },
    isError: status === "failed",
  };
}

/** Internal-link proposal/publish result as a card + table. */
function linkTable(data: Record<string, unknown>, result: string, fixId: string | undefined, siteId: string): ToolResult {
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  const source = s("source_url");
  const target = s("target_url");
  const anchor = s("anchor_text");
  const label =
    result === "published" ? "✅ Live" : result === "queued" ? "⏳ Queued — the site's plugin applies it on its next sync" : result === "proposed" ? "📝 Proposed (not live yet)" : result === "failed" ? "❌ Failed" + (s("error") ? `: ${s("error")}` : "") : result;
  const card: Card = {
    kind: "link_status",
    title: "Internal link",
    subtitle: label,
    sections: [
      {
        title: "Link",
        rows: [
          { title: `On: ${pagePath(source) || "—"}`, url: source, meta: anchor ? `Anchor: "${anchor}"` : undefined },
          { title: `To: ${pagePath(target) || "—"}`, url: target },
        ],
      },
    ],
    actions: [
      ...(result === "proposed" && fixId ? [{ label: "Publish", prompt: `Publish internal link proposal ${fixId} on site ${siteId}.` }] : []),
      ...(target ? [{ label: "What's still open on this page", prompt: `Give me the page report for ${target}.` }] : []),
      { label: TERMS.hiddenGems, prompt: "Show my hidden gems with link suggestions." },
    ],
  };
  const text = [
    PRESENTATION_NOTE,
    "",
    "| Link on | Points to | Anchor | Status |",
    "|---|---|---|---|",
    `| ${cell(pagePath(source))} | ${cell(pagePath(target))} | ${cell(anchor)} | ${cell(label)} |`,
    ...(fixId ? ["", `Proposal id: ${fixId}`] : []),
  ].join("\n");
  return { content: [{ type: "text", text }], structuredContent: { card }, isError: result === "failed" };
}

/**
 * On plugin-managed sites a published fix stops at "approved" until the site's
 * plugin pulls and applies it. Poll the proposal briefly so ChatGPT can report
 * the real outcome instead of a bare "queued".
 */
async function waitForProposalOutcome(
  site_id: string,
  proposal_id: string,
  dofolloUserId: string,
  maxWaitMs = 45000,
  intervalMs = 5000,
): Promise<FixAction | undefined> {
  const deadline = Date.now() + maxWaitMs;
  let latest: FixAction | undefined;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      const data = await dofolloGet<{ actions?: FixAction[] }>(
        `/sites/${encodeURIComponent(site_id)}/fix-actions`,
        dofolloUserId,
        { site_id },
      );
      latest = data.actions?.find((action) => action.id === proposal_id) ?? latest;
      if (latest?.status && latest.status !== "approved") {
        return latest;
      }
    } catch {
      return latest;
    }
  }
  return latest;
}

function proposalResult(status: string | undefined): string {
  switch (status) {
    case "approved":
    case "rollback_pending":
      return "queued";
    case "applied":
      return "published";
    case "rolled_back":
      return "reverted";
    case "failed":
      return "failed";
    case "proposed":
      return "proposed";
    default:
      return status || "failed";
  }
}

/** Register every RankMeRabbit tool on the given server, bound to the caller's RankMeRabbit user id. */
export function registerTools(server: McpServer, dofolloUserId: string, canWrite = false): void {
  registerCardResources(server);
  registerInsightTools(server, dofolloUserId);

  server.registerTool(
    "rankmerabbit_list_sites",
    {
      title: "List RankMeRabbit sites",
      description: `List all sites the authenticated RankMeRabbit account owns. Start here to obtain the site_id values required by every other tool.

Args: none.

Returns: an array of sites, each including at least an id and url/domain plus summary fields.`,
      inputSchema: {},
      ...readToolSecurity,
      annotations: { ...readOnly, title: "List RankMeRabbit sites" },
    },
    async () => {
      try {
        return ok(await dofolloGet("/sites", dofolloUserId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_pages_needing_work",
    {
      title: "Pages needing work",
      description: `Get the prioritized list of pages that most need SEO work for a site, ranked by RankMeRabbit's analysis-priority scoring. This is the tool to use for "which pages need work?". Present results page-wise (one row per page with its issues), then offer rankmerabbit_page_report for the page the user picks.

Args:
  - site_id (string): a site id from rankmerabbit_list_sites

Returns: prioritized pages with priority scores and the issues driving each score.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id from rankmerabbit_list_sites"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Pages needing work" },
    },
    async ({ site_id }) => {
      try {
        return ok(
          await dofolloGet(
            `/sites/${encodeURIComponent(site_id)}/analysis-priority`,
            dofolloUserId,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_list_issues",
    {
      title: "List SEO issues",
      description: `List detected SEO issues for a site, with optional filtering and pagination.

Args:
  - site_id (string): site id
  - status (string, optional): e.g. open / fixed / ignored (passed through to the API)
  - type (string, optional): issue type filter (passed through to the API)
  - limit (number, optional): max rows to return
  - offset (number, optional): pagination offset

Returns: an array of issues with type, severity, affected URL, and status.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        status: z.string().optional().describe("Optional status filter (open/fixed/ignored)"),
        type: z.string().optional().describe("Optional issue type filter"),
        limit: z.number().int().min(1).max(500).optional().describe("Max rows to return"),
        offset: z.number().int().min(0).optional().describe("Pagination offset"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "List SEO issues" },
    },
    async ({ site_id, status, type, limit, offset }) => {
      try {
        return ok(
          await dofolloGet(`/sites/${encodeURIComponent(site_id)}/issues`, dofolloUserId, {
            status,
            type,
            limit,
            offset,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_get_audit",
    {
      title: "Get a specific audit",
      description: `Get a focused audit report for a site by category.

Args:
  - site_id (string): site id
  - type (enum): one of ${AUDIT_TYPES.join(", ")}

Returns: the audit findings for that category — affected pages and details.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        type: z.enum(AUDIT_TYPES).describe(`Audit category: ${AUDIT_TYPES.join(" | ")}`),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Get a specific audit" },
    },
    async ({ site_id, type }) => {
      try {
        return ok(
          await dofolloGet(`/sites/${encodeURIComponent(site_id)}/audit/${type}`, dofolloUserId),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_list_pages",
    {
      title: "List pages",
      description: `List crawled pages for a site, with optional pagination.

Args:
  - site_id (string): site id
  - limit (number, optional): max rows
  - offset (number, optional): pagination offset

Returns: crawled pages with URL and per-page metadata.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        limit: z.number().int().min(1).max(500).optional().describe("Max rows to return"),
        offset: z.number().int().min(0).optional().describe("Pagination offset"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "List pages" },
    },
    async ({ site_id, limit, offset }) => {
      try {
        return ok(
          await dofolloGet(`/sites/${encodeURIComponent(site_id)}/pages`, dofolloUserId, {
            limit,
            offset,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_get_page_detail",
    {
      title: "Get page detail",
      description: `Get detailed/raw RankMeRabbit page fields for a single page. Prefer rankmerabbit_get_page_context when you only need enough information to reason about one page; use this tool when detailed page fields are specifically required. Provide the page url, and/or the page_id if known.

Args:
  - site_id (string): site id
  - url (string, optional): the page URL
  - page_id (string, optional): the page id (alternative to url)

Returns: detailed issues, content signals, and fix status for that page.

Docs: https://rankmerabbit.com/docs/connect-rankmerabbit-to-chatgpt-with-mcp`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        url: z.string().url().optional().describe("Page URL"),
        page_id: z.string().optional().describe("Page id (alternative to url)"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Get page detail" },
    },
    async ({ site_id, url, page_id }) => {
      try {
        return ok(
          await dofolloGet(`/sites/${encodeURIComponent(site_id)}/pages/detail`, dofolloUserId, {
            url,
            page_id,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_get_site_overview",
    {
      title: "Get site overview",
      description: `Get a compact high-level understanding of what a RankMeRabbit website is about. Use this as lightweight background context when the current SEO task requires understanding the business/site.

This intentionally returns only limited general context such as homepage evidence, a small set of primary topics and a few important pages. It does not expose RankMeRabbit's complete site analysis.

Request more specific page, issue, link, GSC or topical context only when needed for the current task.

If RankMeRabbit's stored context is insufficient, incomplete or potentially stale and live web access is available, inspect the live website/web rather than assuming facts.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Get site overview" },
    },
    async ({ site_id }) => {
      try {
        return ok(
          await dofolloGet(
            `/sites/${encodeURIComponent(site_id)}/context/overview`,
            dofolloUserId,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_get_page_context",
    {
      title: "Get page context",
      description: `Get compact SEO context for one specific page. Use this when the current question concerns that page.

It returns a limited set of page signals, relevant pending issues, a short content excerpt, and a few related pages. It intentionally does not return the complete site dataset or full page HTML/content.

Request other RankMeRabbit data only if needed for the current task.

If stored content is insufficient or stale and live web access is available, inspect the live page rather than inventing missing information.

Docs: https://rankmerabbit.com/docs/connect-rankmerabbit-to-chatgpt-with-mcp`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        url: z.string().url().describe("Page URL"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Get page context" },
    },
    async ({ site_id, url }) => {
      try {
        return ok(
          await dofolloGet(
            `/sites/${encodeURIComponent(site_id)}/context/page`,
            dofolloUserId,
            { url },
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
  server.registerTool(
    "rankmerabbit_gsc_performance",
    {
      title: "Search Console performance",
      description: `Get Google Search Console performance for a site (clicks, impressions, average position) when GSC is connected.

Args:
  - site_id (string): site id
  - start_date (string, optional): YYYY-MM-DD
  - end_date (string, optional): YYYY-MM-DD

Returns: GSC performance metrics. If GSC is not connected for the site, the API error is surfaced.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        start_date: z.string().optional().describe("Start date, YYYY-MM-DD"),
        end_date: z.string().optional().describe("End date, YYYY-MM-DD"),
      },
      ...readToolSecurity,
      annotations: { ...readOnly, title: "Search Console performance" },
    },
    async ({ site_id, start_date, end_date }) => {
      try {
        return ok(
          await dofolloGet(
            `/sites/${encodeURIComponent(site_id)}/gsc/performance`,
            dofolloUserId,
            {
              start_date,
              end_date,
            },
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_generate_title",
    {
      title: "Generate SEO title suggestions",
      description: `Generate RankMeRabbit AI SEO title suggestions for one crawled page.

Use this when the user explicitly wants title ideas, a better SEO title, or wants RankMeRabbit to generate title suggestions for a page.

This generates suggestions only. It does NOT publish or apply any change to the website. To publish a chosen title, call rankmerabbit_create_fix_proposal with action_type "title", then rankmerabbit_publish_selected_fix.

RankMeRabbit fix credits are not consumed by generation; publishing/applying fixes is handled separately.

The page must already belong to the selected RankMeRabbit site.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        page_url: z.string().url().describe("Page URL to generate title suggestions for"),
      },
      ...writeToolSecurity,
      annotations: { ...writeTool, title: "Generate SEO title suggestions" },
    },
    async ({ site_id, page_url }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        return ok(
          await dofolloPost(
            `/sites/${encodeURIComponent(site_id)}/generate/title`,
            dofolloUserId,
            { page_url },
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_ensure_fix_session",
    {
      title: "Ensure fix session",
      description: `Create or validate an owned RankMeRabbit chat session for MCP fix proposals.

Args:
  - site_id (string): site id
  - session_id (string, optional): existing session to validate

Returns: { session_id, created }`,
      inputSchema: {
        site_id: z.string().min(1),
        session_id: z.string().optional(),
      },
      ...writeToolSecurity,
      annotations: { ...writeTool, title: "Ensure fix session" },
    },
    async ({ site_id, session_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        return ok(
          await dofolloPost(
            `/sites/${encodeURIComponent(site_id)}/fix-actions/session`,
            dofolloUserId,
            { site_id, session_id },
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_create_fix_proposal",
    {
      title: "Create a fix proposal",
      description: `Create and store a proposed website fix using a replacement value that has ALREADY been determined.

This tool does NOT generate AI content.

Use it only after:
- the desired replacement value is already known/generated
- the user wants that exact change prepared for review/publishing

Supported action types:
title      (SEO <title> tag; new_value = the full new title)
h1
alt_text
broken_link

To get AI title ideas first, call rankmerabbit_generate_title, let the user pick one, then create a "title" proposal with that exact text.

It does not publish the change.

Args:
  - site_id (string): site id
  - session_id (string): existing RankMeRabbit chat session id
  - action_type (enum): title | h1 | alt_text | broken_link
  - page_url (string): affected page URL
  - new_value (string): proposed replacement value (for title: the full new <title>, ideally 30–65 characters)
  - broken_url (string, required for broken_link): URL being replaced
  - image_src (string, required for alt_text): image URL/source

Returns: { result: "proposed" | "failed", proposal_id, action }`,
      inputSchema: {
        site_id: z.string().min(1),
        session_id: z.string().min(1),
        action_type: z.enum(PROPOSAL_ACTION_TYPES),
        page_url: z.string().min(1),
        new_value: z.string().min(1),
        broken_url: z.string().optional(),
        image_src: z.string().optional(),
      },
      ...writeCardSecurity,
      annotations: { ...writeTool, title: "Create a fix proposal" },
    },
    async ({ site_id, session_id, action_type, page_url, new_value, broken_url, image_src }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: FixAction }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions`,
          dofolloUserId,
          { site_id, session_id, action_type, page_url, new_value, broken_url, image_src },
        );
        return fixTable(
          data.action,
          undefined,
          data.action?.status === "proposed" ? "Ask the user to confirm before publishing with rankmerabbit_publish_selected_fix." : undefined,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_get_fix_proposal",
    {
      title: "Retrieve a fix proposal",
      description: `Retrieve proposed fix actions for review. Provide site_id and proposal_id; the MCP server filters the authenticated user's proposals for that site.

Args:
  - site_id (string): site id
  - proposal_id (string): proposal/action id

Returns: { result: "proposed" | "published" | "failed", proposal } or a not-found error.`,
      inputSchema: {
        site_id: z.string().min(1),
        proposal_id: z.string().min(1),
      },
      ...readCardSecurity,
      annotations: { ...readOnly, title: "Retrieve a fix proposal" },
    },
    async ({ site_id, proposal_id }) => {
      try {
        const data = await dofolloGet<{ actions?: FixAction[] }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions`,
          dofolloUserId,
          { site_id },
        );
        const proposal = data.actions?.find((action) => action.id === proposal_id);
        if (!proposal) {
          throw new DofolloError(404, "fix proposal not found for this site");
        }
        return fixTable(proposal);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_create_internal_link_proposal",
    {
      title: "Create an internal-link proposal",
      description: `Create and store an internal-link proposal using exact values already chosen by the user. Does not publish.

Use it only after the user has chosen:
- the source URL where the link should be added
- the target URL the link should point to
- the exact anchor text

Creating a proposal must not publish or apply the link.

Args:
  - site_id (string): site id
  - source_url (URL): source page where the internal link should be added
  - target_url (URL): target page the link should point to
  - anchor_text (string): exact anchor text chosen by the user
  - context (string, optional): nearby text or placement context

Returns: { result: "proposed", fix_id, source_url, target_url, anchor_text, ... }`,
      inputSchema: {
        site_id: z.string().min(1),
        source_url: z.string().url(),
        target_url: z.string().url(),
        anchor_text: z.string().min(1),
        context: z.string().optional(),
      },
      ...writeCardSecurity,
      annotations: { ...idempotentWriteTool, title: "Create an internal-link proposal" },
    },
    async ({ site_id, source_url, target_url, anchor_text, context }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ result?: string; fix_id?: string }>(
          `/sites/${encodeURIComponent(site_id)}/internal-link-fixes`,
          dofolloUserId,
          { source_url, target_url, anchor_text, context },
        );
        return linkTable(
          { source_url, target_url, anchor_text, ...data },
          data.result || "proposed",
          data.fix_id,
          site_id,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_publish_internal_link",
    {
      title: "Publish an internal-link proposal",
      description: `Publish/apply an explicitly selected stored internal-link proposal. Never generates or changes the link details.

Before invoking this tool, the assistant should show the source URL, target URL, and anchor text to the user and obtain explicit confirmation to publish.

Do not claim the link is live if the backend returns queued or approved; say it is queued for publishing. If the platform is unsupported, surface the backend error instead of pretending it published.

Args:
  - site_id (string): site id
  - fix_id (string): internal-link proposal id to publish

Returns: { result: "queued" | "published" | "failed", ... }`,
      inputSchema: {
        site_id: z.string().min(1),
        fix_id: z.string().min(1),
      },
      ...writeCardSecurity,
      annotations: { ...publishingWriteTool, title: "Publish an internal-link proposal" },
    },
    async ({ site_id, fix_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ result?: string; status?: string }>(
          `/sites/${encodeURIComponent(site_id)}/internal-link-fixes/${encodeURIComponent(fix_id)}/publish`,
          dofolloUserId,
          {},
        );
        return linkTable(data as Record<string, unknown>, data.result || proposalResult(data.status), fix_id, site_id);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_publish_selected_fix",
    {
      title: "Publish selected fix",
      description: `Publish/apply an explicitly selected stored fix proposal.

Supported proposals:
- title
- h1
- alt_text
- broken_link

Before invoking this tool, show the affected page, proposed change, and replacement value to the user and obtain explicit confirmation to publish.

Publishing uses the RankMeRabbit backend's existing validation, platform delivery and retry-safe credit consumption.

On sites connected through the WordPress plugin (and similar connectors) the fix is queued and the plugin applies it on its next sync, usually within a few minutes. This tool waits up to ~45 seconds for that. If the result is still "queued", tell the user it is queued (not failed) and offer to check again with rankmerabbit_get_fix_proposal.

This tool does not generate content.

Args:
  - site_id (string): site id
  - proposal_id (string): proposal/action id to approve and apply/queue

Returns: { result: "queued" | "published" | "failed", ... }`,
      inputSchema: {
        site_id: z.string().min(1),
        proposal_id: z.string().min(1),
      },
      ...writeCardSecurity,
      annotations: { ...publishingWriteTool, title: "Publish selected fix" },
    },
    async ({ site_id, proposal_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: FixAction }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions/${encodeURIComponent(proposal_id)}/publish`,
          dofolloUserId,
          {},
          { site_id },
        );
        let action = data.action;
        if (action?.status === "approved") {
          action = (await waitForProposalOutcome(site_id, proposal_id, dofolloUserId)) ?? action;
        }
        return fixTable(
          action,
          undefined,
          action?.status === "approved"
            ? "Not failed — it is queued. Offer to check again in a minute with rankmerabbit_get_fix_proposal."
            : undefined,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_revert_published_fix",
    {
      title: "Revert a published fix",
      description: `Revert a published MCP proposal only where the existing backend rollback workflow supports it.

Supported: proposal_id for title, h1, broken_link, and alt_text chat fix actions after they are applied and have a previous value. Lifecycle unpublish/revert is not exposed here because those paths do not all revert live content.

Args:
  - site_id (string): site id
  - proposal_id (string): applied proposal/action id

Returns: { result: "reverted" | "failed" | "unsupported", proposal_id, action }`,
      inputSchema: {
        site_id: z.string().min(1),
        proposal_id: z.string().min(1),
      },
      ...writeCardSecurity,
      annotations: { ...destructiveWriteTool, title: "Revert a published fix" },
    },
    async ({ site_id, proposal_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: FixAction }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions/${encodeURIComponent(proposal_id)}/revert`,
          dofolloUserId,
          {},
          { site_id },
        );
        return fixTable(data.action);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
