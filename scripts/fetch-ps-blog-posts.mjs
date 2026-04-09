import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, stripHtml, writeJson } from './lib/catalog-data.mjs';

const RAW_DIR = path.join(DATA_DIR, 'raw', 'ps-blog');
const API_BASE = 'https://blog.playstation.com/wp-json/wp/v2/posts';
const SEARCH_TERMS = [
  'PlayStation Plus Monthly Games',
  'PlayStation Plus Game Catalog'
];
const TAG_URLS = [
  'https://blog.playstation.com/tag/monthly-games',
  'https://blog.playstation.com/tag/playstation-plus'
];
const MAX_TAG_PAGES = 10;
const SITEMAP_INDEX_URLS = [
  'https://blog.playstation.com/sitemap_index.xml',
  'https://blog.playstation.com/post-sitemap.xml'
];
const POST_URL_PATTERNS = [
  /\/\d{4}\/\d{2}\/\d{2}\/playstation-plus-monthly-games-/i,
  /\/\d{4}\/\d{2}\/\d{2}\/playstation-plus-game-catalog-/i
];

function normalizePost(post) {
  return {
    id: post.id,
    date: post.date,
    modified: post.modified,
    slug: post.slug,
    link: post.link,
    title: post.title?.rendered || '',
    excerpt: post.excerpt?.rendered || '',
    content: post.content?.rendered || ''
  };
}

async function fetchPostsForSearch(search) {
  const posts = [];

  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(API_BASE);
    url.searchParams.set('search', search);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ps-plus-timeline/1.0; +https://blog.playstation.com/)'
      }
    });

    if (response.status === 400) break;
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;

    posts.push(...data.map(normalizePost));

    const totalPages = Number(response.headers.get('x-wp-totalpages') || page);
    if (page >= totalPages) break;
  }

  return posts;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ps-plus-timeline/1.0; +https://blog.playstation.com/)'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseTagListing(html) {
  const posts = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="(https:\/\/blog\.playstation\.com\/\d{4}\/\d{2}\/\d{2}\/[^"]+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const link = match[1];
    const title = stripHtml(match[2]);

    if (!title) continue;
    if (!/playstation plus monthly games|playstation plus game catalog/i.test(title)) continue;
    if (seen.has(link)) continue;

    seen.add(link);
    posts.push({ link, title });
  }

  return posts;
}

function isRelevantPostUrl(url) {
  return POST_URL_PATTERNS.some(pattern => pattern.test(url));
}

function parseSitemapLocs(xml) {
  const locs = [];
  const pattern = /<loc>([^<]+)<\/loc>/gi;

  for (const match of xml.matchAll(pattern)) {
    locs.push(match[1].trim());
  }

  return locs;
}

async function fetchPostsViaSitemaps() {
  const sitemapUrls = new Set();

  for (const url of SITEMAP_INDEX_URLS) {
    try {
      const xml = await fetchHtml(url);
      const locs = parseSitemapLocs(xml);

      for (const loc of locs) {
        if (/post-sitemap/i.test(loc) || isRelevantPostUrl(loc)) {
          sitemapUrls.add(loc);
        }
      }
    } catch (error) {
      continue;
    }
  }

  const articleUrls = new Set();

  for (const sitemapUrl of sitemapUrls) {
    if (isRelevantPostUrl(sitemapUrl)) {
      articleUrls.add(sitemapUrl);
      continue;
    }

    try {
      const xml = await fetchHtml(sitemapUrl);
      const locs = parseSitemapLocs(xml);
      for (const loc of locs) {
        if (isRelevantPostUrl(loc)) {
          articleUrls.add(loc);
        }
      }
    } catch (error) {
      continue;
    }
  }

  const posts = [];

  for (const link of [...articleUrls].sort()) {
    const html = await fetchHtml(link);
    posts.push({
      id: `html:${link}`,
      date: extractDate(html),
      modified: extractDate(html),
      slug: link.split('/').filter(Boolean).at(-1),
      link,
      title: extractTitle(html),
      excerpt: extractExcerpt(html),
      content: extractArticleContent(html)
    });
  }

  return posts.sort((a, b) => a.date.localeCompare(b.date));
}

function extractArticleContent(html) {
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  return articleMatch ? articleMatch[0] : html;
}

function extractTitle(html) {
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogTitle) return stripHtml(ogTitle[1]).replace(/\s+[-–]\s+PlayStation\.Blog$/i, '').trim();

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) return stripHtml(titleMatch[1]).replace(/\s+[-–]\s+PlayStation\.Blog$/i, '').trim();

  return '';
}

function extractDate(html) {
  const meta = html.match(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i);
  if (meta) return meta[1];

  const time = html.match(/<time[^>]+datetime="([^"]+)"/i);
  if (time) return time[1];

  return new Date().toISOString();
}

function extractExcerpt(html) {
  const meta = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
  return meta ? stripHtml(meta[1]) : '';
}

async function fetchPostsViaHtmlFallback() {
  const sitemapPosts = await fetchPostsViaSitemaps();
  if (sitemapPosts.length > 0) {
    return sitemapPosts;
  }

  const listingEntries = [];

  for (const url of TAG_URLS) {
    let emptyPages = 0;

    for (let page = 1; page <= MAX_TAG_PAGES; page += 1) {
      const pageUrl = page === 1 ? url : `${url}/page/${page}/`;
      const html = await fetchHtml(pageUrl);
      const entries = parseTagListing(html);

      if (entries.length === 0) {
        emptyPages += 1;
        if (emptyPages >= 2) break;
        continue;
      }

      emptyPages = 0;
      listingEntries.push(...entries);
    }
  }

  const uniqueEntries = Array.from(
    new Map(listingEntries.map(entry => [entry.link, entry])).values()
  );

  const posts = [];

  for (const entry of uniqueEntries) {
    const html = await fetchHtml(entry.link);

    posts.push({
      id: `html:${entry.link}`,
      date: extractDate(html),
      modified: extractDate(html),
      slug: entry.link.split('/').filter(Boolean).at(-1),
      link: entry.link,
      title: extractTitle(html) || entry.title,
      excerpt: extractExcerpt(html),
      content: extractArticleContent(html)
    });
  }

  return posts.sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  let posts = [];
  let fetchMode = 'wp-json';

  try {
    const collected = [];

    for (const search of SEARCH_TERMS) {
      collected.push(...await fetchPostsForSearch(search));
    }

    posts = Array.from(
      new Map(collected.map(post => [post.id, post])).values()
    ).sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    if (!/401 Unauthorized/i.test(String(error.message))) {
      throw error;
    }

    fetchMode = 'html-fallback';
    posts = await fetchPostsViaHtmlFallback();
  }

  await fs.mkdir(RAW_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(RAW_DIR, `${today}.json`);

  await writeJson(filePath, {
    fetchedAt: new Date().toISOString(),
    source: fetchMode === 'wp-json'
      ? 'https://blog.playstation.com/wp-json/wp/v2/posts'
      : 'https://blog.playstation.com/tag/monthly-games + https://blog.playstation.com/tag/playstation-plus',
    fetchMode,
    searches: SEARCH_TERMS,
    postCount: posts.length,
    posts
  });

  console.log(`Fetched ${posts.length} PlayStation Blog posts via ${fetchMode} into ${path.relative(process.cwd(), filePath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
