import {
  DATA_DIR,
  EVENTS_PATH,
  GAMES_PATH,
  TITLES_PATH,
  normalizePlatformList,
  normalizeTitle,
  parseProductIdFromUrl,
  readJson,
  slugify,
  writeJson
} from './lib/catalog-data.mjs';

function inferCatalog(game) {
  if (game.tier === 'essential') return 'monthly-games';
  if (game.tier === 'premium') return 'classics-catalog';
  return 'game-catalog';
}

function buildTitleId(game) {
  return parseProductIdFromUrl(game.psStoreUrl) || `legacy:${game.id}`;
}

async function main() {
  const legacy = await readJson(GAMES_PATH);
  const titles = [];
  const events = [];

  for (const game of legacy.games) {
    const titleId = buildTitleId(game);
    const platforms = normalizePlatformList(game.platform);
    const catalog = inferCatalog(game);

    titles.push({
      id: titleId,
      slug: slugify(game.title),
      displayTitle: game.title,
      normalizedTitle: normalizeTitle(game.title),
      canonicalUrl: game.psStoreUrl || null,
      cover: game.cover || null,
      platforms,
      legacyGameId: game.id
    });

    events.push({
      id: `${game.id}:added:${game.addedDate}`,
      titleId,
      tier: game.tier,
      catalog,
      region: legacy.region,
      eventType: 'added',
      eventDate: game.addedDate,
      accessModel: game.isEssentialClaim ? 'claim-and-keep' : 'catalog-access',
      confidence: 'manual',
      sourceUrl: null,
      notes: 'Migrated from legacy flat games.json'
    });

    if (game.removedDate) {
      events.push({
        id: `${game.id}:removed:${game.removedDate}`,
        titleId,
        tier: game.tier,
        catalog,
        region: legacy.region,
        eventType: 'removed',
        eventDate: game.removedDate,
        accessModel: game.isEssentialClaim ? 'claim-and-keep' : 'catalog-access',
        confidence: 'manual',
        sourceUrl: null,
        notes: 'Migrated from legacy flat games.json'
      });
    }
  }

  const uniqueTitles = Array.from(
    new Map(titles.map(title => [title.id, title])).values()
  ).sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  const titlesDoc = {
    version: 1,
    region: legacy.region,
    migratedFrom: 'data/games.json',
    migratedAt: new Date().toISOString(),
    titles: uniqueTitles
  };

  const eventsDoc = {
    version: 1,
    region: legacy.region,
    migratedFrom: 'data/games.json',
    migratedAt: new Date().toISOString(),
    events
  };

  await writeJson(TITLES_PATH, titlesDoc);
  await writeJson(EVENTS_PATH, eventsDoc);

  console.log(`Migrated ${legacy.games.length} legacy game rows into ${uniqueTitles.length} titles and ${events.length} events.`);
  console.log(`Wrote ${TITLES_PATH.replace(`${DATA_DIR}/`, 'data/')}`);
  console.log(`Wrote ${EVENTS_PATH.replace(`${DATA_DIR}/`, 'data/')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
