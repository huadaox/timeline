import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  EVENTS_PATH,
  TITLES_PATH,
  normalizePlatformList,
  normalizeTitle,
  readJson,
  slugify,
  stripHtml,
  titleKey,
  toIsoDateFromEnglish,
  writeJson
} from './lib/catalog-data.mjs';

const RAW_DIR = path.join(DATA_DIR, 'raw', 'ps-blog');
const HEADING_BLOCKLIST = [
  /download the image/i,
  /latest news/i,
  /^playstation plus$/i,
  /last chance to download/i,
  /last chance to add/i,
  /enter to win/i,
  /starter pack/i,
  /movie credit promo/i,
  /sony pictures core/i
];

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const [key, value] = argv[index].split('=');
    args.set(key, value || 'true');
  }
  return args;
}

async function resolveInputPath(args) {
  const explicit = args.get('--input');
  if (explicit) return path.resolve(process.cwd(), explicit);

  await fs.mkdir(RAW_DIR, { recursive: true });
  const files = (await fs.readdir(RAW_DIR))
    .filter(name => name.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error('No raw blog files found in data/raw/ps-blog. Run npm run fetch:ps-blog first or pass --input=<file>.');
  }

  return path.join(RAW_DIR, files[files.length - 1]);
}

function isMonthlyPost(post) {
  return /playstation plus monthly games/i.test(post.title);
}

function isCatalogPost(post) {
  return /playstation plus game catalog/i.test(post.title);
}

function parseHeadings(html) {
  const matches = html.matchAll(/<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi);
  return Array.from(matches, match => stripHtml(match[2]));
}

function parseIntroParagraphs(html) {
  const matches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  return Array.from(matches, match => stripHtml(match[1])).filter(Boolean);
}

function parseDateFromPost(post, kind) {
  const fallbackYear = new Date(post.date).getUTCFullYear();
  const title = stripHtml(post.title);
  const paragraphs = parseIntroParagraphs(post.content);
  const haystacks = [title, ...paragraphs.slice(0, 8)];

  const patterns = kind === 'monthly'
    ? [
        /available to all PlayStation Plus members from(?:\s+\w+)?\s+([A-Za-z]+\s+\d{1,2})/i,
        /all playable\s+([A-Za-z]+\s+\d{1,2})/i,
        /available to PlayStation Plus members from\s+([A-Za-z]+\s+\d{1,2})/i
      ]
    : [
        /available to play from\s+([A-Za-z]+\s+\d{1,2})/i,
        /available to play on\s+([A-Za-z]+\s+\d{1,2})/i,
        /all games available to play from\s+([A-Za-z]+\s+\d{1,2})/i,
        /all games available to play on\s+([A-Za-z]+\s+\d{1,2})/i
      ];

  for (const text of haystacks) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const iso = toIsoDateFromEnglish(match[1], fallbackYear);
        if (iso) return iso;
      }
    }
  }

  return post.date.slice(0, 10);
}

function splitTitleAndPlatforms(heading) {
  const parts = heading.split('|').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { title: heading.trim(), platforms: [] };
  }

  const maybePlatforms = parts[parts.length - 1];
  if (!/\bPS[45]\b/i.test(maybePlatforms)) {
    return { title: heading.trim(), platforms: [] };
  }

  const title = parts.slice(0, -1).join(' | ').trim();
  const platforms = normalizePlatformList(maybePlatforms.replace(/\s+/g, ''));
  return { title, platforms };
}

function isBlockedHeading(heading) {
  return HEADING_BLOCKLIST.some(pattern => pattern.test(heading));
}

function isBlockedTitle(title) {
  return isBlockedHeading(String(title || '').trim());
}

function parseMonthlyEntries(post) {
  const headings = parseHeadings(post.content);
  const entries = [];

  for (const heading of headings) {
    if (!heading || /last chance to add/i.test(heading)) break;
    if (/playstation plus/i.test(heading)) continue;
    if (isBlockedHeading(heading)) continue;

    const { title, platforms } = splitTitleAndPlatforms(heading);
    if (!title || title.split(' ').length < 2) continue;

    entries.push({
      title,
      platforms,
      tier: 'essential',
      catalog: 'monthly-games',
      accessModel: 'claim-and-keep'
    });
  }

  return dedupeEntries(entries);
}

function parseCatalogEntries(post) {
  const headings = parseHeadings(post.content);
  const entries = [];
  let currentTier = null;
  let currentCatalog = null;

  for (const heading of headings) {
    const normalized = heading.toLowerCase();

    if (normalized.includes('game catalog')) {
      currentTier = 'extra';
      currentCatalog = 'game-catalog';
      continue;
    }

    if (normalized.includes('playstation plus premium')) {
      currentTier = 'premium';
      currentCatalog = 'classics-catalog';
      continue;
    }

    if (!currentTier) continue;
    if (isBlockedHeading(heading)) continue;

    const { title, platforms } = splitTitleAndPlatforms(heading);
    if (!title || title.split(' ').length < 2) continue;

    entries.push({
      title,
      platforms,
      tier: currentTier,
      catalog: currentCatalog,
      accessModel: 'catalog-access'
    });
  }

  return dedupeEntries(entries);
}

function dedupeEntries(entries) {
  return Array.from(
    new Map(entries.map(entry => [titleKey(normalizeTitle(entry.title), entry.platforms), entry])).values()
  );
}

function buildTitleIndexes(titles) {
  const byId = new Map();
  const byKey = new Map();
  const byNormalized = new Map();

  for (const title of titles) {
    byId.set(title.id, title);

    const normalized = title.normalizedTitle || normalizeTitle(title.displayTitle || title.title);
    const key = titleKey(normalized, title.platforms);
    byKey.set(key, title);

    const bucket = byNormalized.get(normalized) || [];
    bucket.push(title);
    byNormalized.set(normalized, bucket);
  }

  return { byId, byKey, byNormalized };
}

function findOrCreateTitle(entry, post, titles, indexes) {
  const normalized = normalizeTitle(entry.title);
  const key = titleKey(normalized, entry.platforms);
  const exact = indexes.byKey.get(key);
  if (exact) return exact;

  const candidates = indexes.byNormalized.get(normalized) || [];
  if (candidates.length === 1) return candidates[0];

  const id = `blog:${slugify(entry.title)}:${post.id}`;
  const created = {
    id,
    slug: slugify(entry.title),
    displayTitle: entry.title,
    normalizedTitle: normalized,
    canonicalUrl: null,
    cover: null,
    platforms: normalizePlatformList(entry.platforms),
    source: 'official-blog',
    sourcePostUrl: post.link
  };

  titles.push(created);
  indexes.byId.set(created.id, created);
  indexes.byKey.set(key, created);
  const bucket = indexes.byNormalized.get(normalized) || [];
  bucket.push(created);
  indexes.byNormalized.set(normalized, bucket);
  return created;
}

function eventIdentity(event) {
  return [
    event.titleId,
    event.tier,
    event.catalog || '',
    event.region || '',
    event.eventType,
    event.eventDate,
    event.sourceUrl || ''
  ].join('::');
}

function upsertEvents(existingEvents, newEvents) {
  const merged = [...existingEvents];
  const seen = new Set(existingEvents.map(eventIdentity));

  for (const event of newEvents) {
    const identity = eventIdentity(event);
    if (seen.has(identity)) continue;
    merged.push(event);
    seen.add(identity);
  }

  return merged;
}

function replaceOfficialBlogEvents(existingEvents, newEvents, sourcePostId) {
  const kept = existingEvents.filter(event => !(event.confidence === 'official-blog' && event.sourcePostId === sourcePostId));
  return upsertEvents(kept, newEvents);
}

function pruneUnusedBlogTitles(titles, events) {
  const usedIds = new Set(events.map(event => event.titleId));
  return titles.filter(title => !(title.source === 'official-blog' && !usedIds.has(title.id)));
}

function filterBlockedOfficialBlogEvents(events, titles) {
  const titleMap = new Map(titles.map(title => [title.id, title]));
  return events.filter(event => {
    if (event.confidence !== 'official-blog') return true;
    const title = titleMap.get(event.titleId);
    return !title || !isBlockedTitle(title.displayTitle || title.title);
  });
}

function parsePostEntries(post) {
  if (isMonthlyPost(post)) {
    return {
      kind: 'monthly',
      eventDate: parseDateFromPost(post, 'monthly'),
      entries: parseMonthlyEntries(post)
    };
  }

  if (isCatalogPost(post)) {
    return {
      kind: 'catalog',
      eventDate: parseDateFromPost(post, 'catalog'),
      entries: parseCatalogEntries(post)
    };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = await resolveInputPath(args);
  const dryRun = args.get('--dry-run') === 'true';

  const raw = await readJson(inputPath);
  const titlesDoc = await readJson(TITLES_PATH);
  const eventsDoc = await readJson(EVENTS_PATH);
  const titles = [...titlesDoc.titles];
  const indexes = buildTitleIndexes(titles);
  let events = [...eventsDoc.events];

  let importedEventCount = 0;
  let createdTitleCount = 0;

  for (const post of raw.posts) {
    const parsed = parsePostEntries(post);
    if (!parsed || parsed.entries.length === 0) continue;

    const newEvents = [];

    for (const entry of parsed.entries) {
      const beforeTitleCount = titles.length;
      const title = findOrCreateTitle(entry, post, titles, indexes);
      if (titles.length > beforeTitleCount) {
        createdTitleCount += 1;
      }

      newEvents.push({
        id: `blog:${post.id}:${entry.tier}:${slugify(entry.title)}:${parsed.eventDate}`,
        titleId: title.id,
        tier: entry.tier,
        catalog: entry.catalog,
        region: eventsDoc.region || 'US',
        eventType: 'added',
        eventDate: parsed.eventDate,
        accessModel: entry.accessModel,
        confidence: 'official-blog',
        sourceUrl: post.link,
        sourcePostId: post.id,
        notes: stripHtml(post.title)
      });
    }

    const merged = replaceOfficialBlogEvents(events, newEvents, post.id);
    importedEventCount += merged.length - events.length;
    events = merged;
  }

  events = filterBlockedOfficialBlogEvents(events, titles);
  const prunedTitles = pruneUnusedBlogTitles(
    titles.filter(title => !isBlockedTitle(title.displayTitle || title.title)),
    events
  );

  if (!dryRun) {
    await writeJson(TITLES_PATH, {
      ...titlesDoc,
      updatedAt: new Date().toISOString(),
      titles: prunedTitles.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle))
    });

    await writeJson(EVENTS_PATH, {
      ...eventsDoc,
      updatedAt: new Date().toISOString(),
      events
    });
  }

  console.log(`${dryRun ? 'Dry run:' : 'Imported'} ${importedEventCount} blog events from ${path.relative(process.cwd(), inputPath)}`);
  console.log(`${dryRun ? 'Would create' : 'Created'} ${createdTitleCount} title placeholders`);
  console.log(`${dryRun ? 'Would retain' : 'Retained'} ${prunedTitles.length} titles after pruning unused official-blog placeholders`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
