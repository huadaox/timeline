import {
  EVENTS_PATH,
  GAMES_PATH,
  TITLES_PATH,
  buildTimelineGames,
  readJson,
  writeJson
} from './lib/catalog-data.mjs';

async function main() {
  const titlesDoc = await readJson(TITLES_PATH);
  const eventsDoc = await readJson(EVENTS_PATH);

  const games = buildTimelineGames({
    titles: titlesDoc.titles,
    events: eventsDoc.events,
    region: eventsDoc.region || titlesDoc.region || 'US'
  });

  const output = {
    region: eventsDoc.region || titlesDoc.region || 'US',
    lastUpdated: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      titles: 'data/titles.json',
      events: 'data/catalog-events.json'
    },
    games
  };

  await writeJson(GAMES_PATH, output);
  console.log(`Built ${games.length} timeline rows into data/games.json`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
