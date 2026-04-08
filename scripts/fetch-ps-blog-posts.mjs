import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, writeJson } from './lib/catalog-data.mjs';

const RAW_DIR = path.join(DATA_DIR, 'raw', 'ps-blog');
const API_BASE = 'https://blog.playstation.com/wp-json/wp/v2/posts';
const SEARCH_TERMS = [
  'PlayStation Plus Monthly Games',
  'PlayStation Plus Game Catalog'
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

async function main() {
  const collected = [];

  for (const search of SEARCH_TERMS) {
    collected.push(...await fetchPostsForSearch(search));
  }

  const posts = Array.from(
    new Map(collected.map(post => [post.id, post])).values()
  ).sort((a, b) => a.date.localeCompare(b.date));

  await fs.mkdir(RAW_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(RAW_DIR, `${today}.json`);

  await writeJson(filePath, {
    fetchedAt: new Date().toISOString(),
    source: 'https://blog.playstation.com/wp-json/wp/v2/posts',
    searches: SEARCH_TERMS,
    postCount: posts.length,
    posts
  });

  console.log(`Fetched ${posts.length} PlayStation Blog posts into ${path.relative(process.cwd(), filePath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
