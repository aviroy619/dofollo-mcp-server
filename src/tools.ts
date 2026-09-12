import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dofolloGet, DofolloError } from "./services/dofollo.js";
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

/** Register every RankMeRabbit tool on the given server, bound to the caller's RankMeRabbit user id. */
export function registerTools(server: McpServer, dofolloUserId: string): void {
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
}
