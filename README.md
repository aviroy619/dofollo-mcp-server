# dofollo-mcp-server

A remote MCP server that exposes **read-only** Dofollo SEO data to Claude, ChatGPT, and any
other MCP-compatible client. It is a thin pass-through: each request carries the user's Dofollo
account token, which the server forwards to the Dofollo API (`/api/mcp/v1/*`). It holds no
credentials of its own and never touches the user's website directly.

## How it fits

```
Claude / ChatGPT  --(MCP over HTTPS, Bearer token)-->  this server  --(Bearer token)-->  Dofollo API  -->  Mongo
```

The token is the account-level, read-only key created in Dofollo
(`POST /api/v1/account/mcp-token`). The server reads it from the incoming request
(`Authorization: Bearer <key>` or `X-Dofollo-Account-Key`) and passes it straight through.
Site ownership scoping is enforced by the Dofollo API, not here.

## Tools

All tools are read-only. `site_id` comes from `dofollo_list_sites`.

| Tool | Maps to |
| --- | --- |
| `dofollo_list_sites` | `GET /api/mcp/v1/sites` |
| `dofollo_pages_needing_work` | `GET /sites/:id/analysis-priority` |
| `dofollo_list_issues` | `GET /sites/:id/issues` |
| `dofollo_get_audit` | `GET /sites/:id/audit/{type}` |
| `dofollo_list_pages` | `GET /sites/:id/pages` |
| `dofollo_get_page_detail` | `GET /sites/:id/pages/detail` |
| `dofollo_gsc_performance` | `GET /sites/:id/gsc/performance` |

`dofollo_get_audit` types: `canonical`, `titles`, `broken-links`, `crawl-blocking`,
`thin-content`, `alt-text`, `orphan-pages`.

## Build and run locally

```bash
npm install
npm run build
PORT=3000 DOFOLLO_API_BASE=https://api.dofollo.ai node dist/index.js
```

Quick checks:

```bash
curl -s localhost:3000/healthz

# initialize (any non-empty Bearer clears the gate; real validation happens at Dofollo)
curl -s -X POST localhost:3000/mcp \
  -H "Authorization: Bearer dfl_live_xxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Inspect interactively with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP | URL: http://localhost:3000/mcp
# Add header Authorization: Bearer dfl_live_...  then list tools and call dofollo_list_sites
```

## Deploy on Hetzner (Docker Compose + Caddy)

Add a service to the `dofollo-core` stack:

```yaml
  dofollo-mcp:
    build: ./dofollo-mcp-server      # or image: your-registry/dofollo-mcp-server
    environment:
      - DOFOLLO_API_BASE=http://dofollo-api:8080   # internal network; avoids the public hop
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Point `DOFOLLO_API_BASE` at the api service on the internal Docker network so only the MCP
endpoint itself is public. (Match the actual service name/port of your api container.)

Caddy block for the public endpoint:

```
mcp.dofollo.ai {
    reverse_proxy dofollo-mcp:3000
}
```

Bring it up:

```bash
docker compose up -d --build dofollo-mcp
docker compose logs --tail 30 dofollo-mcp     # expect: listening on :3000/mcp
curl -s https://mcp.dofollo.ai/healthz        # expect: {"ok":true}
```

## Connect from an AI client

1. In Dofollo: create a read-only key (`POST /api/v1/account/mcp-token`), copy it.
2. In Claude or ChatGPT: Settings → Connectors → add a custom connector.
   - URL: `https://mcp.dofollo.ai/mcp`
   - Auth: send the key as `Authorization: Bearer <key>`.
3. Ask: "Using Dofollo, which pages on <site> need work?"

## Notes

- Stateless Streamable HTTP: a fresh server + transport is created per request, with the
  token bound for that request only. Nothing is cached between calls.
- Responses are the Dofollo `data` payload (the `{success,data,message}` envelope is unwrapped).
  Oversized payloads are truncated at ~25k chars with a note to paginate.
- To add the write path later (`apply_fix`), add a write-scoped tool and a non-`readOnlyHint`
  annotation, and gate it behind a write-scoped token on the Dofollo side.
