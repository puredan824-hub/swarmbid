import type { BidInput, TaskInput } from '../board/types.js';
import { yocto } from '../board/board.js';
import { RESEARCHER_ACCOUNT } from '../chain/accounts.js';
import { setTimeout as delay } from 'node:timers/promises';

export interface ResearchNotes { points: string[]; sources: string[] }
export interface ResearchTask extends TaskInput {
  research?: { platforms: string[]; pointsPerPlatform?: number };
}
export interface ResearcherPricing {
  baseYocto?: string;
  perPointYocto?: string;
  minimumCounterYocto?: string;
}

export function quoteResearcher(task: ResearchTask, pricing: ResearcherPricing = {}): BidInput {
  const points = (task.research?.platforms.length ?? 5) * (task.research?.pointsPerPlatform ?? 2);
  if (!Number.isSafeInteger(points) || points < 1) throw new Error('Invalid research point count');
  return { workerAccount: RESEARCHER_ACCOUNT,
    priceYocto: (yocto(pricing.baseYocto ?? '200000000000000000000000') +
      BigInt(points) * yocto(pricing.perPointYocto ?? '5000000000000000000000')).toString(),
    etaMinutes: 5, reason: `Research package priced for ${points} evidence points` };
}

export function acceptsResearcherCounter(price: string, pricing: ResearcherPricing = {}): boolean {
  return yocto(price) >= yocto(pricing.minimumCounterYocto ?? '240000000000000000000000');
}

function plain(html: string): string {
  return html.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"').replace(/&#39;|&apos;/gu, "'")
    .replace(/&#x([a-f\d]+);/giu, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/gu, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/gu, ' ').trim();
}

function agentContext(value: string): boolean {
  // Case matters for AI: geographic names such as Ai-Todor are unrelated.
  return /agent|artificial intelligence|blockchain|autonomous/iu.test(value) || /\bAI\b/u.test(value);
}

async function retrieve(url: string): Promise<string> {
  // A retry is a second real request, never substituted evidence.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000),
        headers: new URL(url).hostname.endsWith('wikipedia.org') ?
          { 'User-Agent': 'SwarmBid/1.0 (public research briefing)' } : {} });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch {
      if (attempt === 1) throw new Error(`Research retrieval failed: ${new URL(url).hostname}`);
      await delay(1000);
    }
  }
  throw new Error('Research retrieval failed');
}

export async function research(task: ResearchTask): Promise<ResearchNotes> {
  const platforms = task.research?.platforms ?? task.spec.keywords;
  if (!platforms.length) throw new Error('Research requires named platforms or keywords');
  const notes: ResearchNotes = { points: [], sources: [] };
  const failures: string[] = [];
  // Query both required public providers for every platform. Preserve attribution,
  // and fail rather than invent platform descriptions when neither yields evidence.
  for (const platform of platforms) {
    let found = 0;
    const wiki = new URL('https://en.wikipedia.org/w/api.php');
    wiki.search = new URLSearchParams({ action: 'query', list: 'search',
      srsearch: `"${platform}"`, srlimit: '3', format: 'json', utf8: '1' }).toString();
    try {
      const data = JSON.parse(await retrieve(wiki.href)) as {
        query?: { search?: { title: string; snippet: string; pageid: number }[] } };
      for (const item of data.query?.search ?? []) {
        const snippet = plain(item.snippet);
        if (!snippet || !agentContext(`${item.title} ${snippet}`)) continue;
        const source = `https://en.wikipedia.org/?curid=${item.pageid}`;
        notes.points.push(`${platform}: Wikipedia search context (${item.title}): ${snippet}. Source: ${source}`);
        notes.sources.push(source);
        found++;
      }
    } catch { failures.push(`${platform}: Wikipedia unavailable`); }
    for (const query of [`${platform} agent jobs platform`, `"${platform}" agent marketplace`]) {
      const duck = 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q: query });
      try {
        const html = await retrieve(duck);
        const links = [...html.matchAll(/<a\b(?=[^>]*class=["'][^"']*result__a\b[^"']*["'])([^>]*)>([\s\S]*?)<\/a>/gu)];
        let duckPoints = 0;
        for (let index = 0; index < links.length && duckPoints < 4; index++) {
          const link = links[index];
          const block = html.slice(link.index! + link[0].length, links[index + 1]?.index ?? html.length);
          const match = block.match(/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/u);
          const snippet = plain(match?.[1] ?? '');
          const title = plain(link[2]);
          const normalized = (value: string) => value.toLowerCase().replace(/[^a-z\d]/gu, '');
          if (!snippet || !agentContext(`${title} ${snippet}`) || !normalized(`${title} ${snippet}`).includes(normalized(platform))) continue;
          const href = plain(link[1].match(/href=["']([^"']+)["']/u)?.[1] ?? '');
          if (!href) continue;
          const destination = new URL(href, duck);
          const source = destination.searchParams.get('uddg') ?? destination.href;
          if (!/^https?:\/\//u.test(source)) continue;
          notes.points.push(`${platform}: DuckDuckGo search excerpt (${title}): ${snippet}. Source: ${source}`);
          notes.sources.push(source);
          found++;
          duckPoints++;
        }
        if (duckPoints) { notes.sources.push(duck); break; }
        else failures.push(`${platform}: DuckDuckGo returned no result snippets (possibly a challenge)`);
      } catch { failures.push(`${platform}: DuckDuckGo unavailable`); }
    }
    if (!found) throw new Error(`No retrieved evidence for ${platform}; ${failures.join('; ')}`);
    await delay(750);
  }
  notes.sources = [...new Set(notes.sources)];
  return notes;
}
