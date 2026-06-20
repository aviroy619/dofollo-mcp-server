import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

/** Pull the Dofollo account token from the incoming request. */
function extractToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const header = req.headers["x-dofollo-account-key"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return undefined;
}

/** Build a fresh MCP server bound to one caller's token (stateless, per request). */
function buildServer(token: string): McpServer {
  const server = new McpServer({ name: "dofollo-mcp-server", version: "1.0.0" });
  registerTools(server, token);
  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Missing Dofollo token. Configure the connector with your Dofollo MCP API key (sent as 'Authorization: Bearer <key>' or 'X-Dofollo-Account-Key').",
      },
      id: null,
    });
    return;
  }

  const server = buildServer(token);
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
