// Free, keyless web search: scrapes DuckDuckGo's no-JS HTML results page.
// No API key, no account, no cost. Good enough for a demo agent; for
// production use a proper search API (Brave/Tavily/Serper all have paid
// tiers but also free quotas if you want something sturdier).

import * as cheerio from 'cheerio';

export const webSearchToolDefs = [
  {
    name: 'web_search',
    description: 'Search the web and return the top results (title, url, snippet).',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
];

function decodeDuckDuckGoUrl(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

export async function runWebSearchTool(name, input) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sample-ai-agent/1.0)' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  $('.result__body').each((_, el) => {
    if (results.length >= 5) return;
    const link = $(el).find('.result__a').first();
    const title = link.text().trim();
    const href = link.attr('href');
    const snippet = $(el).find('.result__snippet').text().trim();
    if (title && href) results.push({ title, url: decodeDuckDuckGoUrl(href), snippet });
  });

  return JSON.stringify(results, null, 2);
}
