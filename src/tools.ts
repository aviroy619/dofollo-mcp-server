import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dofolloGet, dofolloPost, DofolloError } from "./services/dofollo.js";
import { CHARACTER_LIMIT } from "./constants.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
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

const writeTool = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
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
        text: "Error 403: this OAuth token is missing the rankmerabbit.write scope.",
      },
    ],
    isError: true,
  };
}

const PROPOSAL_ACTION_TYPES = ["broken_link", "h1", "alt_text"] as const;

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
  server.registerTool(
    "rankmerabbit_list_sites",
    {
      title: "List RankMeRabbit sites",
      description: `List all sites the authenticated RankMeRabbit account owns. Start here to obtain the site_id values required by every other tool.

Args: none.

Returns: an array of sites, each including at least an id and url/domain plus summary fields.`,
      inputSchema: {},
      annotations: readOnly,
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
      description: `Get the prioritized list of pages that most need SEO work for a site, ranked by RankMeRabbit's analysis-priority scoring. This is the tool to use for "which pages need work?".

Args:
  - site_id (string): a site id from rankmerabbit_list_sites

Returns: prioritized pages with priority scores and the issues driving each score.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id from rankmerabbit_list_sites"),
      },
      annotations: readOnly,
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
      annotations: readOnly,
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
      annotations: readOnly,
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
      annotations: readOnly,
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
      description: `Get the full audit detail for a single page. Provide the page url, and/or the page_id if known.

Args:
  - site_id (string): site id
  - url (string, optional): the page URL
  - page_id (string, optional): the page id (alternative to url)

Returns: detailed issues, content signals, and fix status for that page.`,
      inputSchema: {
        site_id: z.string().min(1).describe("Site id"),
        url: z.string().url().optional().describe("Page URL"),
        page_id: z.string().optional().describe("Page id (alternative to url)"),
      },
      annotations: readOnly,
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
      annotations: readOnly,
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
      annotations: writeTool,
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
    "rankmerabbit_generate_fix_proposal",
    {
      title: "Generate a fix proposal",
      description: `Validate and store a proposed fix for explicit later review. This does not publish.

Supported action_type values: broken_link, h1, alt_text.

Args:
  - site_id (string): site id
  - session_id (string): existing RankMeRabbit chat session id
  - action_type (enum): broken_link | h1 | alt_text
  - page_url (string): affected page URL
  - new_value (string): proposed replacement value
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
      annotations: writeTool,
    },
    async ({ site_id, session_id, action_type, page_url, new_value, broken_url, image_src }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: { id?: string; status?: string } }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions`,
          dofolloUserId,
          { site_id, session_id, action_type, page_url, new_value, broken_url, image_src },
        );
        return ok({ result: proposalResult(data.action?.status), proposal_id: data.action?.id, ...data });
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
      annotations: readOnly,
    },
    async ({ site_id, proposal_id }) => {
      try {
        const data = await dofolloGet<{ actions?: Array<{ id?: string; status?: string }> }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions`,
          dofolloUserId,
          { site_id },
        );
        const proposal = data.actions?.find((action) => action.id === proposal_id);
        if (!proposal) {
          throw new DofolloError(404, "fix proposal not found for this site");
        }
        return ok({ result: proposalResult(proposal.status), proposal });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "rankmerabbit_publish_selected_fix",
    {
      title: "Publish selected fix",
      description: `Publish an explicitly selected proposal. This never generates a fix.

For proposal_id, supported proposals are broken_link, h1, and alt_text chat fix actions.
Lifecycle fix_id publishing is not exposed because the existing MCP-safe selected-fix backend route with retry-safe credit handling does not exist yet.

Args:
  - site_id (string): site id
  - proposal_id (string): proposal/action id to approve and apply/queue

Returns: { result: "queued" | "published" | "failed", ... }`,
      inputSchema: {
        site_id: z.string().min(1),
        proposal_id: z.string().min(1),
      },
      annotations: publishingWriteTool,
    },
    async ({ site_id, proposal_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: { id?: string; status?: string } }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions/${encodeURIComponent(proposal_id)}/publish`,
          dofolloUserId,
          {},
          { site_id },
        );
        return ok({ result: proposalResult(data.action?.status), proposal_id, ...data });
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

Supported: proposal_id for broken_link, h1, and alt_text chat fix actions after they are applied and have a previous value. Lifecycle unpublish/revert is not exposed here because those paths do not all revert live content.

Args:
  - site_id (string): site id
  - proposal_id (string): applied proposal/action id

Returns: { result: "reverted" | "failed" | "unsupported", proposal_id, action }`,
      inputSchema: {
        site_id: z.string().min(1),
        proposal_id: z.string().min(1),
      },
      annotations: destructiveWriteTool,
    },
    async ({ site_id, proposal_id }) => {
      const denied = requireWrite(canWrite);
      if (denied) return denied;
      try {
        const data = await dofolloPost<{ action?: { id?: string; status?: string } }>(
          `/sites/${encodeURIComponent(site_id)}/fix-actions/${encodeURIComponent(proposal_id)}/revert`,
          dofolloUserId,
          {},
          { site_id },
        );
        return ok({ result: proposalResult(data.action?.status), proposal_id, ...data });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
