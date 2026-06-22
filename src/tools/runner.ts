import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listFolders, runFolder } from "../engine.js";
import { toolResult, toolError } from "../utils.js";
import { READ_ONLY, EXECUTE } from "../annotations.js";

const collectionSchema = z
  .record(z.string(), z.any())
  .describe("Postman collection v2.1 JSON (the `collection` object from the Postman API / connector's getCollection).");
const environmentSchema = z
  .record(z.string(), z.any())
  .optional()
  .describe("Optional Postman environment JSON (the `environment` object from getEnvironment) supplying base URL, auth and variables.");

export function registerRunnerTools(server: McpServer): void {
  server.registerTool(
    "list_folders",
    {
      title: "List Postman Collection Folders",
      description:
        "List the folders in a Postman collection (name, id, path, request count). " +
        "Use to confirm the folder created for a Jira ticket before running it.",
      annotations: READ_ONLY,
      inputSchema: z.object({ collection: collectionSchema }),
    },
    async ({ collection }) => {
      try {
        return toolResult({ collection: (collection as any)?.info?.name, folders: listFolders(collection) });
      } catch (e: any) {
        return toolError(e?.message ?? String(e));
      }
    }
  );

  server.registerTool(
    "run_folder",
    {
      title: "Run a Postman Collection Folder",
      description:
        "Execute every request in a collection folder and return structured results. " +
        "Resolves {{variables}}, runs the collection + item pre-request scripts (so token auth works), " +
        "fires each request, and evaluates the embedded pm.test scripts. " +
        "Target the folder by folderName (typically the Jira ticket key, e.g. 'MXTS-12345') or folderId.",
      annotations: EXECUTE,
      inputSchema: z.object({
        collection: collectionSchema,
        folderName: z.string().optional().describe("Folder name to run (typically the Jira ticket key)."),
        folderId: z.string().optional().describe("Explicit folder id (use when folder names are ambiguous)."),
        environment: environmentSchema,
        timeoutRequestMs: z.number().optional().describe("Per-request timeout in ms (default 30000)."),
      }),
    },
    async ({ collection, folderName, folderId, environment, timeoutRequestMs }) => {
      if (!folderName && !folderId) return toolError("Provide folderName or folderId to run a folder.");
      try {
        const r = await runFolder({ collection, environment, folderId, folderName, timeoutMs: timeoutRequestMs });
        return toolResult({ collection: (collection as any)?.info?.name, folderId, folderName, ...r });
      } catch (e: any) {
        return toolError(e?.message ?? String(e));
      }
    }
  );

  server.registerTool(
    "run_request",
    {
      title: "Run a Single Postman Request",
      description:
        "Execute a single named request (optionally scoped to a folder) and return its structured result. " +
        "Useful for re-running one failing test case.",
      annotations: EXECUTE,
      inputSchema: z.object({
        collection: collectionSchema,
        requestName: z.string().describe("Exact request name to run."),
        folderName: z.string().optional(),
        folderId: z.string().optional(),
        environment: environmentSchema,
        timeoutRequestMs: z.number().optional(),
      }),
    },
    async ({ collection, requestName, folderName, folderId, environment, timeoutRequestMs }) => {
      try {
        const r = await runFolder({ collection, environment, folderId, folderName, requestName, timeoutMs: timeoutRequestMs });
        if (r.results.length === 0) return toolError(`Request "${requestName}" not found in scope.`);
        return toolResult({ collection: (collection as any)?.info?.name, ...r });
      } catch (e: any) {
        return toolError(e?.message ?? String(e));
      }
    }
  );
}
