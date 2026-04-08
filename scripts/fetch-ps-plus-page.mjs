import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  decodeHtmlEntities,
  stripHtml,
  writeJson
} from './lib/catalog-data.mjs';

const PAGE_URL = 'https://www.playstation.com/en-us/ps-plus/games/';
const RAW_DIR = path.join(DATA_DIR, 'raw', 'ps-plus-page');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots', 'us');
const CATEGORY_PAGES = [
  { section: 'game-catalog', url: `${PAGE_URL}?category=GAME_CATALOG` },
  { section: 'classics-catalog', url: `${PAGE_URL}?category=CLASSICS_CATALOG` },
  { section: 'monthly-games', url: `${PAGE_URL}?category=MONTHLY_GAMES` },
  { section: 'game-trials', url: `${PAGE_URL}?category=GAME_TRIALS` }
];

function normalizeStoreUrl(rawUrl) {
  const value = decodeHtmlEntities(rawUrl || '').trim();
  if (!value) return null;

  if (value.startsWith('https://store.playstation.com')) return value;
  if (value.startsWith('http://store.playstation.com')) return value.replace(/^http:/i, 'https:');
  if (value.startsWith('//store.playstation.com')) return `https:${value}`;
  if (value.startsWith('/')) return `https://store.playstation.com${value}`;
  return null;
}

function parseAnchors(html, section) {
  const matches = html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  const items = [];

  for (const match of matches) {
    const url = normalizeStoreUrl(match[1]);
    if (!url) continue;
    const title = stripHtml(match[2]);
    if (!title || title.length < 2) continue;
    items.push({ section, title, url });
  }

  return items;
}

function parseJsonBackedLinks(html, section) {
  const items = [];
  const pattern = /"url":"(https?:\\\/\\\/store\.playstation\.com[^"]+|\\\/[A-Za-z0-9_:%./?=&\-]+)","name":"([^"]+)"/gi;

  for (const match of html.matchAll(pattern)) {
    const url = normalizeStoreUrl(match[1].replace(/\\\//g, '/'));
    const title = stripHtml(decodeHtmlEntities(match[2]));
    if (!url || !title) continue;
    items.push({ section, title, url });
  }

  return items;
}

function parseSnapshotItems(html, section) {
  const items = [];
  items.push(...parseAnchors(html, section));
  items.push(...parseJsonBackedLinks(html, section));

  const deduped = Array.from(
    new Map(items.map(item => [`${item.section}::${item.url || item.title}`, item])).values()
  );

  return deduped.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.title.localeCompare(b.title);
  });
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(RAW_DIR, `${today}.json`);
  const snapshotPath = path.join(SNAPSHOT_DIR, `${today}.json`);
  const pages = [];
  const allItems = [];

  await fs.mkdir(RAW_DIR, { recursive: true });

  for (const page of CATEGORY_PAGES) {
    const response = await fetch(page.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ps-plus-timeline/1.0; +https://www.playstation.com/)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${page.url}: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    pages.push({
      section: page.section,
      url: page.url,
      htmlLength: html.length
    });

    allItems.push(...parseSnapshotItems(html, page.section));
  }

  await writeJson(rawPath, {
    fetchedAt: new Date().toISOString(),
    sourceUrl: PAGE_URL,
    pages
  });

  const items = Array.from(
    new Map(allItems.map(item => [`${item.section}::${item.url}`, item])).values()
  ).sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.title.localeCompare(b.title);
  });

  const snapshot = {
    capturedAt: new Date().toISOString(),
    region: 'US',
    sourceUrl: PAGE_URL,
    itemCount: items.length,
    items
  };

  await writeJson(snapshotPath, snapshot);

  console.log(`Fetched ${pages.length} category pages into ${path.relative(process.cwd(), rawPath)}`);
  console.log(`Wrote ${items.length} snapshot items into ${path.relative(process.cwd(), snapshotPath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
