import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { registerRunnerTools } from "./tools/runner.js";

// ============ Version Resolution ============

function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ============ Server Setup ============

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-postman-runner",
    version: getVersion(),
  });

  registerRunnerTools(server);

  return server;
}
