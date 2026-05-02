export const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for up-to-date information. Use this when you need current data, " +
      "recent news, or information that may not be in your training data. " +
      "Returns a list of search results with titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web.",
        },
      },
      required: ["query"],
    },
  },
} as const;

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
  error?: string;
}

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export async function executeBraveSearch(
  query: string,
  apiKey: string
): Promise<string> {
  if (!query?.trim()) {
    return JSON.stringify({ error: "Empty search query." });
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("count", "5");
  url.searchParams.set("result_filter", "web");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    return JSON.stringify({ error: `Brave Search API error ${res.status}: ${text}` });
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? "",
  }));

  if (results.length === 0) {
    return JSON.stringify({ results: [], message: "No results found." });
  }

  return JSON.stringify({ results });
}
