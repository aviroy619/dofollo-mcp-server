import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Scalekit } from "@scalekit-sdk/node";
import { registerTools } from "./tools.js";

const scalekit = new Scalekit(
  process.env.SCALEKIT_ENVIRONMENT_URL!,
  process.env.SCALEKIT_CLIENT_ID!,
  process.env.SCALEKIT_CLIENT_SECRET!,
);

const protectedResourceMetadata = {
  authorization_servers: ["https://dofollo.scalekit.dev/resources/res_130805237014331910"],
  bearer_methods_supported: ["header"],
  resource: process.env.MCP_RESOURCE!,
  resource_documentation: "https://mcp.dofollo.ai/mcp/docs",
  scopes_supported: [] as string[],
};

const wwwAuthenticateHeader =
  'Bearer realm="OAuth", resource_metadata="https://mcp.dofollo.ai/.well-known/oauth-protected-resource/mcp"';

/** Pull the OAuth bearer token from the incoming request. */
function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() || undefined;
}

/** Build a fresh MCP server bound to the configured upstream Dofollo token. */
function buildServer(token: string): McpServer {
  const server = new McpServer({ name: "dofollo-mcp-server", version: "1.0.0" });
  registerTools(server, token);
  return server;
}

function sendUnauthorized(res: Response): void {
  res.set("WWW-Authenticate", wwwAuthenticateHeader);
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get(
  ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
  (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata);
  },
);

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  if (!token) {
    sendUnauthorized(res);
    return;
  }

  try {
    await scalekit.validateToken(token, {
      audience: [process.env.MCP_RESOURCE!],
    });
  } catch {
    sendUnauthorized(res);
    return;
  }

  const server = buildServer(process.env.DOFOLLO_API_TOKEN!);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless transport: no session GET/DELETE handling.
app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({ error: "Method not allowed" });
});
app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({ error: "Method not allowed" });
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.error(`dofollo-mcp-server listening on :${port}/mcp`);
});
