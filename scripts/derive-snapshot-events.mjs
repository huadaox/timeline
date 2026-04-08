import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  normalizeTitle,
  parseProductIdFromUrl,
  readJson,
  writeJson
} from './lib/catalog-data.mjs';

const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots', 'us');
const OUTPUT_PATH = path.join(DATA_DIR, 'generated', 'snapshot-event-candidates.json');

function getIdentity(item) {
  return (
    parseProductIdFromUrl(item.url) ||
    item.url ||
    `${item.section || 'unknown'}::${normalizeTitle(item.title)}`
  );
}

function toItemMap(snapshot) {
  return new Map(snapshot.items.map(item => [getIdentity(item), item]));
}

async function listSnapshotFiles() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const files = await fs.readdir(SNAPSHOT_DIR);
  return files
    .filter(name => name.endsWith('.json'))
    .sort();
}

async function main() {
  const files = await listSnapshotFiles();

  if (files.length < 2) {
    throw new Error('Need at least two snapshot files in data/snapshots/us to infer additions/removals.');
  }

  const results = [];

  for (let index = 1; index < files.length; index += 1) {
    const previous = await readJson(path.join(SNAPSHOT_DIR, files[index - 1]));
    const current = await readJson(path.join(SNAPSHOT_DIR, files[index]));
    const previousItems = toItemMap(previous);
    const currentItems = toItemMap(current);

    for (const [identity, item] of currentItems.entries()) {
      if (!previousItems.has(identity)) {
        results.push({
          eventType: 'added',
          eventDate: current.capturedAt.slice(0, 10),
          confidence: 'snapshot-diff',
          identity,
          section: item.section || 'unknown',
          title: item.title,
          url: item.url || null,
          sourceSnapshots: [files[index - 1], files[index]]
        });
      }
    }

    for (const [identity, item] of previousItems.entries()) {
      if (!currentItems.has(identity)) {
        results.push({
          eventType: 'removed',
          eventDate: current.capturedAt.slice(0, 10),
          confidence: 'snapshot-diff',
          identity,
          section: item.section || 'unknown',
          title: item.title,
          url: item.url || null,
          sourceSnapshots: [files[index - 1], files[index]]
        });
      }
    }
  }

  await writeJson(OUTPUT_PATH, {
    generatedAt: new Date().toISOString(),
    region: 'US',
    sourceDir: 'data/snapshots/us',
    candidates: results
  });

  console.log(`Wrote ${results.length} snapshot-based event candidates to data/generated/snapshot-event-candidates.json`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
