import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT_DIR = path.resolve(new URL('../..', import.meta.url).pathname);
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const TITLES_PATH = path.join(DATA_DIR, 'titles.json');
export const EVENTS_PATH = path.join(DATA_DIR, 'catalog-events.json');
export const GAMES_PATH = path.join(DATA_DIR, 'games.json');

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function normalizeTitle(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(ps4|ps5)\b/gi, ' ')
    .replace(/\bstandard edition\b/gi, ' ')
    .replace(/\bdigital deluxe edition\b/gi, ' ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[:\-–|/()[\],.!?'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

export function normalizePlatformList(platformValue) {
  if (Array.isArray(platformValue)) {
    return [...new Set(platformValue.filter(Boolean).map(String))];
  }

  return [...new Set(
    String(platformValue || '')
      .split(/[\/,]/)
      .map(part => part.trim())
      .filter(Boolean)
  )];
}

export function formatPlatformList(platforms) {
  return normalizePlatformList(platforms).join('/');
}

export function parseProductIdFromUrl(url) {
  const match = String(url || '').match(/\/product\/([A-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

export function titleKey(normalizedTitle, platforms = []) {
  return `${normalizedTitle}::${normalizePlatformList(platforms).sort().join(',')}`;
}

export function eventSort(a, b) {
  if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  if (a.eventType === b.eventType) return (a.id || '').localeCompare(b.id || '');
  return a.eventType === 'added' ? -1 : 1;
}

export function groupEvents(events) {
  const groups = new Map();

  for (const event of events) {
    const key = [
      event.titleId,
      event.tier,
      event.catalog || '',
      event.region || ''
    ].join('::');
    const bucket = groups.get(key) || [];
    bucket.push(event);
    groups.set(key, bucket);
  }

  return groups;
}

export function buildTimelineGames({ titles, events, region }) {
  const titlesById = new Map(titles.map(title => [title.id, title]));
  const groups = groupEvents(events);
  const games = [];

  for (const groupEventsList of groups.values()) {
    const sorted = [...groupEventsList].sort(eventSort);
    const openCycles = [];

    for (const event of sorted) {
      if (event.eventType === 'added') {
        openCycles.push({ added: event, removed: null });
        continue;
      }

      if (event.eventType === 'removed') {
        const candidate = openCycles.find(cycle => !cycle.removed);
        if (candidate) {
          candidate.removed = event;
        } else {
          openCycles.push({ added: null, removed: event });
        }
      }
    }

    for (const cycle of openCycles) {
      if (!cycle.added) continue;

      const title = titlesById.get(cycle.added.titleId);
      if (!title) continue;

      const addedDate = cycle.added.eventDate;
      const removedDate = cycle.removed?.eventDate || null;
      const tier = cycle.added.tier;
      const titleSlug = title.slug || slugify(title.displayTitle || title.title || title.id);

      games.push({
        id: `${titleSlug}-${tier}-${addedDate}`,
        title: title.displayTitle || title.title,
        cover: title.cover || null,
        psStoreUrl: title.canonicalUrl || title.psStoreUrl || null,
        tier,
        platform: formatPlatformList(title.platforms),
        addedDate,
        removedDate,
        isEssentialClaim: cycle.added.accessModel === 'claim-and-keep' || tier === 'essential',
        titleId: title.id,
        catalog: cycle.added.catalog || null,
        region: cycle.added.region || region,
        addedSource: cycle.added.sourceUrl || null,
        removedSource: cycle.removed?.sourceUrl || null,
        addedConfidence: cycle.added.confidence || null,
        removedConfidence: cycle.removed?.confidence || null
      });
    }
  }

  games.sort((a, b) => {
    if (a.addedDate !== b.addedDate) return a.addedDate.localeCompare(b.addedDate);
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    return a.title.localeCompare(b.title);
  });

  return games;
}

export function decodeHtmlEntities(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function stripHtml(input) {
  return decodeHtmlEntities(String(input || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function toIsoDateFromEnglish(input, fallbackYear) {
  const value = String(input || '').replace(/,/g, '').trim();
  const match = value.match(/([A-Za-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?/);
  if (!match) return null;

  const month = monthNumber(match[1]);
  if (!month) return null;

  const year = Number(match[3] || fallbackYear);
  const day = Number(match[2]);

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthNumber(monthName) {
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  return months[String(monthName || '').toLowerCase()] || null;
}
