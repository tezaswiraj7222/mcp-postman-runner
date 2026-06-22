import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "./server.js";

// ============ CLI Colors ============

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function getPackageJson(): {
  name: string;
  version: string;
  description: string;
} {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    );
  } catch {
    return {
      name: "mcp-postman-runner",
      version: "0.0.0",
      description: "Postman folder runner MCP",
    };
  }
}

function printHelp(): void {
  const pkg = getPackageJson();
  console.log(`
${colors.bold}${colors.cyan}${pkg.name}${colors.reset} ${colors.dim}v${pkg.version}${colors.reset}
${pkg.description}

${colors.bold}${colors.blue}USAGE:${colors.reset}
  ${colors.green}npx -y mcp-postman-runner@latest${colors.reset} [OPTIONS]

${colors.bold}${colors.blue}OPTIONS:${colors.reset}
  ${colors.cyan}-h, --help${colors.reset}       Show this help message and exit
  ${colors.cyan}-v, --version${colors.reset}    Show version number and exit
  ${colors.cyan}--verbose${colors.reset}        Enable diagnostic logging to stderr

${colors.bold}${colors.blue}TOOLS:${colors.reset}
  ${colors.magenta}list_folders${colors.reset}   List folders in a Postman collection
  ${colors.magenta}run_folder${colors.reset}     Run every request in a folder; return results + assertions
  ${colors.magenta}run_request${colors.reset}    Run a single named request

${colors.bold}${colors.blue}HOW IT WORKS:${colors.reset}
  Pass a Postman collection (and optional environment) JSON. The server resolves
  {{variables}}, runs pre-request scripts (auth token via pm.sendRequest), fires each
  request, evaluates the embedded pm.test scripts, and returns structured results.
  It holds no Postman credentials — the caller passes the collection/environment in.

${colors.bold}${colors.blue}MCP CONFIGURATION:${colors.reset}
  ${colors.dim}{
    "mcpServers": {
      "postman-runner": {
        "command": "npx",
        "args": ["-y", "mcp-postman-runner@latest"]
      }
    }
  }${colors.reset}

${colors.bold}${colors.blue}DOCUMENTATION:${colors.reset}
  ${colors.underline}https://github.com/REPLACE-ORG/mcp-postman-runner#readme${colors.reset}
`);
}

function printVersion(): void {
  const pkg = getPackageJson();
  console.log(`${pkg.name} v${pkg.version}`);
}

const args = process.argv.slice(2);

if (args.includes("--verbose")) {
  (globalThis as any).VERBOSE = true;
}
if (args.includes("-h") || args.includes("--help") || args.includes("help")) {
  printHelp();
  process.exit(0);
}
if (args.includes("-v") || args.includes("--version")) {
  printVersion();
  process.exit(0);
}

// ============ Start Server ============

const server = createServer();
const transport = new StdioServerTransport();

function shutdown(): void {
  server
    .close()
    .catch(() => {})
    .finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(transport);
