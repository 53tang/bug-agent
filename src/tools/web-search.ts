import { tool } from 'ai';
import { z } from 'zod';

const TAVILY_API_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/**
 * Creates a web_search tool backed by the Tavily search API.
 * If no API key is provided the tool returns a "not configured" message
 * so the recheck can proceed without it.
 */
export function createWebSearchTool(tavilyApiKey: string | undefined) {
  return tool({
    description:
      'Search the web for factual information. Use this to verify claims about ' +
      'version compatibility, runtime support, API behavior, deprecations, ' +
      'default values, or breaking changes. Do NOT rely on your own knowledge ' +
      'for these — always search first.',
    inputSchema: z.object({
      query: z.string().describe('Search query, e.g. "does SST 2.x support nodejs22.x runtime"'),
    }),
    execute: async ({ query }: { query: string }) => {
      if (!tavilyApiKey) {
        return 'Web search is not configured (TAVILY_API_KEY not set). Cannot verify this claim.';
      }

      try {
        const res = await fetch(TAVILY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query,
            max_results: 5,
            include_answer: false,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.warn(`[recheck:web_search] Tavily error ${res.status}: ${body}`);
          return `Web search failed (${res.status}). Cannot verify this claim.`;
        }

        const data = (await res.json()) as TavilyResponse;
        const results = data.results ?? [];

        if (results.length === 0) {
          return 'No search results found for this query.';
        }

        const formatted = results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
          .join('\n\n');

        console.log(`[recheck:web_search] "${query}" → ${results.length} result(s)`);
        return formatted;
      } catch (error) {
        console.warn('[recheck:web_search] Error:', error);
        return 'Web search failed due to a network error. Cannot verify this claim.';
      }
    },
  });
}
