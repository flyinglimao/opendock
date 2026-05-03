export const WEB_FETCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_fetch",
    description:
      "Fetch the content of a specific URL. Use this when you have a URL and need to read " +
      "the page content — e.g. to follow up on a search result, read documentation, or " +
      "retrieve structured data from a known endpoint. Returns the page text.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch (must start with http:// or https://).",
        },
      },
      required: ["url"],
    },
  },
} as const;

const MAX_CHARS = 20_000;

export async function executeWebFetch(url: string): Promise<string> {
  if (!url?.trim()) {
    return JSON.stringify({ error: "Empty URL." });
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return JSON.stringify({ error: `Invalid URL: ${url}` });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return JSON.stringify({ error: "Only http and https URLs are supported." });
  }

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "OpenDock-Agent/1.0" },
      redirect: "follow",
    });
  } catch (err) {
    return JSON.stringify({ error: `Fetch failed: ${String(err)}` });
  }

  if (!res.ok) {
    return JSON.stringify({ error: `HTTP ${res.status} ${res.statusText}` });
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text().catch(() => "");

  // Strip HTML tags for readability when the response is HTML.
  const body = contentType.includes("text/html")
    ? text.replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
    : text;

  const truncated = body.length > MAX_CHARS;
  return JSON.stringify({
    url: parsed.toString(),
    content: truncated ? body.slice(0, MAX_CHARS) + "…[truncated]" : body,
    truncated,
  });
}
