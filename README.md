# rankmerabbit-mcp-server

A remote MCP server for RankMeRabbit SEO data and supported fix workflows. It validates OAuth
tokens with Scalekit, maps the token subject to the RankMeRabbit user id, then calls the
RankMeRabbit API through `/api/mcp/v1/*` using the internal service secret. It does not expose
tokens or secrets to MCP clients and never writes directly to Mongo or to a customer's site.

## How It Fits

```text
Claude / ChatGPT
  --(MCP over HTTPS, Scalekit OAuth Bearer token)-->
this server
  --(X-Dofollo-User-Id + X-Internal-Service-Secret)-->
RankMeRabbit API /api/mcp/v1
  --> existing services, ownership checks, quotas, platform delivery
```

Public MCP URL: `https://mcp.rankmerabbit.com/mcp`

RankMeRabbit API URL: `https://api.rankmerabbit.com`

## OAuth

The protected resource metadata advertises:

- authorization server: `https://dofollo.scalekit.dev/resources/res_130805237014331910`
- resource: `MCP_RESOURCE`, normally `https://mcp.rankmerabbit.com/mcp`
- scopes: `rankmerabbit.read`, `rankmerabbit.write`

Read tools work with an authenticated token for the MCP resource. Write tools additionally require
`rankmerabbit.write` in either the JWT `scope` or `scp` claim.

## Tools

`site_id` comes from `rankmerabbit_list_sites`.

| Tool | Behavior |
| --- | --- |
| `rankmerabbit_list_sites` | Read owned sites |
| `rankmerabbit_pages_needing_work` | Read priority pages |
| `rankmerabbit_list_issues` | Read issues |
| `rankmerabbit_get_audit` | Read focused audit |
| `rankmerabbit_list_pages` | Read crawled pages |
| `rankmerabbit_get_page_detail` | Read page detail |
| `rankmerabbit_get_site_overview` | Read compact site overview context |
| `rankmerabbit_get_page_context` | Read compact page-specific SEO context |
| `rankmerabbit_gsc_performance` | Read GSC performance |
| `rankmerabbit_generate_title` | Generate RankMeRabbit AI SEO title suggestions for a crawled page. Does not publish, and generation does not consume fix credits |
| `rankmerabbit_ensure_fix_session` | Create or validate an owned chat session for fix proposals |
| `rankmerabbit_create_fix_proposal` | Store an already-determined replacement value as a proposed `broken_link`, `h1`, or `alt_text` fix. Does not generate AI content and does not publish |
| `rankmerabbit_get_fix_proposal` | Retrieve a stored proposal for review |
| `rankmerabbit_publish_selected_fix` | Publish/apply a selected stored `broken_link`, `h1`, or `alt_text` proposal. The backend handles validation, platform delivery, and retry-safe credit consumption |
| `rankmerabbit_revert_published_fix` | Use existing backend rollback behavior where supported |

Unsupported actions are not advertised as tools. Title generation is exposed, but title publishing is
not currently exposed through MCP.
## Progressive Context

The MCP should not retrieve all RankMeRabbit intelligence at once. Start with the site overview when business or site understanding is needed, then retrieve page-specific or specialized context only when the current task requires it.

Prefer stored RankMeRabbit data first. When stored data is inadequate or stale, MCP clients with web access may inspect the live website. There is intentionally no "dump full site context" tool.

## Build And Run Locally

```bash
npm install
npm run build
PORT=3000 DOFOLLO_API_BASE=https://api.rankmerabbit.com node dist/index.js
```

Quick health check:

```bash
curl -s localhost:3000/healthz
```

Inspect with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL: http://localhost:3000/mcp
# Header: Authorization: Bearer <Scalekit OAuth access token>
```

## Deploy Notes

Use the internal API address when deployed beside the API container:

```yaml
environment:
  - DOFOLLO_API_BASE=http://dofollo-api:3001
  - MCP_RESOURCE=https://mcp.rankmerabbit.com/mcp
  - PORT=3000
```

Caddy:

```text
mcp.rankmerabbit.com {
    reverse_proxy dofollo-mcp:3000
}
```

## Required Environment

See `.env.example`. Keep `SCALEKIT_CLIENT_SECRET` and `INTERNAL_SERVICE_SECRET` out of logs,
README files, commits, and client-visible responses.
