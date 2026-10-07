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
  resource_documentation: "https://mcp.rankmerabbit.com/mcp/docs",
  scopes_supported: ["rankmerabbit.read", "rankmerabbit.write"],
};

const wwwAuthenticateHeader =
  'Bearer realm="OAuth", resource_metadata="https://mcp.rankmerabbit.com/.well-known/oauth-protected-resource/mcp"';

type TokenClaims = {
  sub?: string;
  scope?: string;
  scp?: string[] | string;
} & Record<string, unknown>;

/** Pull the OAuth bearer token from the incoming request. */
function extractBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() || undefined;
}

/** Decode the payload portion of a JWT so we can fall back to `sub` if needed. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    const parsed = JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function getDofolloUserId(token: string, claims: unknown): string | undefined {
  if (!claims || typeof claims !== "object") {
    return undefined;
  }

  const subject =
    claims && typeof claims === "object" && "sub" in claims ? (claims as TokenClaims).sub : undefined;
  if (typeof subject === "string" && subject.trim()) {
    return subject.trim();
  }
  return undefined;
}

/** Build a fresh MCP server bound to the authenticated RankMeRabbit user id. */
function claimsHaveWriteScope(claims: TokenClaims | boolean): boolean {
  if (!claims || typeof claims !== "object") {
    return false;
  }
  const scope = typeof claims.scope === "string" ? claims.scope.split(/\s+/) : [];
  const scp = Array.isArray(claims.scp) ? claims.scp : typeof claims.scp === "string" ? claims.scp.split(/\s+/) : [];
  return new Set([...scope, ...scp]).has("rankmerabbit.write");
}

function buildServer(dofolloUserId: string, canWrite: boolean): McpServer {
  const server = new McpServer({ name: "rankmerabbit-mcp-server", version: "1.0.0" });
  registerTools(server, dofolloUserId, canWrite);
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

  let claims: TokenClaims | boolean;
  try {
    claims = await scalekit.validateToken<TokenClaims | boolean>(token, {
      audience: [process.env.MCP_RESOURCE!],
    });
  } catch {
    sendUnauthorized(res);
    return;
  }

  const dofolloUserId = getDofolloUserId(token, claims);
  if (!dofolloUserId) {
    sendUnauthorized(res);
    return;
  }

  const server = buildServer(dofolloUserId, claimsHaveWriteScope(claims));
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
  console.error(`rankmerabbit-mcp-server listening on :${port}/mcp`);
});
