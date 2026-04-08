import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  decodeHtmlEntities,
  readJson,
  stripHtml,
  writeJson
} from './lib/catalog-data.mjs';

const PAGE_URL = 'https://www.playstation.com/en-us/ps-plus/games/';
const RAW_DIR = path.join(DATA_DIR, 'raw', 'ps-plus-page');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots', 'us');

function inferSection(heading) {
  const normalized = heading.toLowerCase();
  if (normalized.includes('monthly')) return 'monthly-games';
  if (normalized.includes('game catalog')) return 'game-catalog';
  if (normalized.includes('classics')) return 'classics-catalog';
  if (normalized.includes('trial')) return 'game-trials';
  return 'unknown';
}

function parseAnchorsFromChunk(chunk, section) {
  const matches = chunk.matchAll(/<a\b[^>]*href="([^"]*store\.playstation\.com[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi);
  const items = [];

  for (const match of matches) {
    const url = decodeHtmlEntities(match[1]);
    const title = stripHtml(match[2]);
    if (!title) continue;
    items.push({ section, title, url });
  }

  return items;
}

function parseSnapshotItems(html) {
  const sectionPattern = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>([\s\S]*?)(?=<h[1-6][^>]*>|$)/gi;
  const items = [];

  for (const match of html.matchAll(sectionPattern)) {
    const heading = stripHtml(match[1]);
    const section = inferSection(heading);
    if (section === 'unknown') continue;
    items.push(...parseAnchorsFromChunk(match[2], section));
  }

  const deduped = Array.from(
    new Map(items.map(item => [`${item.section}::${item.url || item.title}`, item])).values()
  );

  return deduped.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.title.localeCompare(b.title);
  });
}

async function main() {
  const response = await fetch(PAGE_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ps-plus-timeline/1.0; +https://www.playstation.com/)'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${PAGE_URL}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const today = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(RAW_DIR, `${today}.html`);
  const snapshotPath = path.join(SNAPSHOT_DIR, `${today}.json`);

  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(rawPath, html, 'utf8');

  const items = parseSnapshotItems(html);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    region: 'US',
    sourceUrl: PAGE_URL,
    itemCount: items.length,
    items
  };

  await writeJson(snapshotPath, snapshot);

  console.log(`Fetched raw page into ${path.relative(process.cwd(), rawPath)}`);
  console.log(`Wrote ${items.length} snapshot items into ${path.relative(process.cwd(), snapshotPath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
