import { KB_TOOLS, executeKBTool, type KBFile } from "./kb";
import { WEB_SEARCH_TOOL, executeBraveSearch } from "./web-search";

export type { KBFile };
export { getKBFiles } from "./kb";

export interface ToolContext {
  kbFiles: KBFile[];
  braveApiKey: string | null;
}

export function buildTools(kbFiles: KBFile[]) {
  return [
    ...(kbFiles.length > 0 ? [...KB_TOOLS] : []),
    WEB_SEARCH_TOOL,
  ];
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  if (toolName === "web_search") {
    if (!ctx.braveApiKey) {
      return JSON.stringify({
        error:
          "Web search is not configured. Please ask the user to add their" +
          " Brave Search API key in the OpenDock Dashboard (Settings section)" +
          " to enable this feature.",
      });
    }
    return executeBraveSearch((args.query as string) ?? "", ctx.braveApiKey);
  }

  return executeKBTool(toolName, args as Record<string, string>, ctx.kbFiles);
}
