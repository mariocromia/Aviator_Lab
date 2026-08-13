import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { NormalizedRound, Platform } from '@aviator/shared';
import { ArchiveDatabase } from './archive-database.js';
import { ArchiveSyncService } from './archive-sync-service.js';
import { BUILT_IN_PLATFORMS } from './platform-catalog.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('ArchiveDatabase', () => {
  it('ships all 16 requested platforms grouped into four feeds', () => {
    expect(BUILT_IN_PLATFORMS).toHaveLength(16);
    expect(new Set(BUILT_IN_PLATFORMS.map(item => item.tipMinerRoundUuid)).size).toBe(4);
  });

  it('stores and deduplicates the same feed independently for every platform', async () => {
    const directory = await temporaryDirectory();
    const archive = new ArchiveDatabase(path.join(directory, 'archive.db'));
    const platforms = [platform('p1000000-0000-4000-8000-000000000001', 'Alpha'), platform('p1000000-0000-4000-8000-000000000002', 'Beta')];
    const rounds = [round('one', '2026-08-13T12:00:00.000Z'), round('two', '2026-08-13T12:01:00.000Z')];

    expect(archive.insertFeedRounds(platforms, rounds)).toBe(2);
    expect(archive.insertFeedRounds(platforms, rounds)).toBe(0);
    expect(archive.status().totalRounds).toBe(2);
    expect(archive.status().platforms.map(item => item.rounds)).toEqual([2, 2]);
    archive.close();
  });

  it('publishes a verified snapshot and imports only missing rounds', async () => {
    const directory = await temporaryDirectory();
    const drive = path.join(directory, 'Drive');
    const source = new ArchiveDatabase(path.join(directory, 'source.db'));
    source.insertFeedRounds([platform('p1000000-0000-4000-8000-000000000001', 'Alpha')], [round('one', '2026-08-13T12:00:00.000Z')]);
    const publisher = new ArchiveSyncService(source);
    publisher.configure(drive, 'PUBLISHER');
    await publisher.publish();

    const target = new ArchiveDatabase(path.join(directory, 'target.db'));
    const subscriber = new ArchiveSyncService(target);
    subscriber.configure(drive, 'SUBSCRIBER');
    expect(await subscriber.importLatest()).toBe(1);
    expect(await subscriber.importLatest()).toBe(0);
    expect(target.status().totalRounds).toBe(1);
    source.close(); target.close();
  });

  it('prunes each platform independently', async () => {
    const directory = await temporaryDirectory();
    const archive = new ArchiveDatabase(path.join(directory, 'archive.db'));
    archive.insertFeedRounds([platform('p1000000-0000-4000-8000-000000000001', 'Alpha')], [
      round('one', '2026-08-13T12:00:00.000Z'), round('two', '2026-08-13T12:01:00.000Z'), round('three', '2026-08-13T12:02:00.000Z')
    ]);
    archive.prune(2);
    expect(archive.status().totalRounds).toBe(2);
    archive.close();
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aviator-archive-'));
  temporaryDirectories.push(directory);
  return directory;
}

function platform(id: string, name: string): Platform {
  return { id, name, slug:name.toLowerCase(),game:'aviator',enabled:true,sourceType:'TIPMINER',tipMinerRoundUuid:'48323e32-3590-4e2f-b6fe-09d5fbc811c9',pollIntervalMs:2000,requestTimeoutMs:5000,historyLimit:2000,collectorStatus:'ONLINE',createdAt:'2026-08-13T00:00:00.000Z',updatedAt:'2026-08-13T00:00:00.000Z' };
}

function round(key: string, occurredAt: string): NormalizedRound {
  return { id:key,platformId:'p1000000-0000-4000-8000-000000000001',externalId:key,multiplier:2,occurredAt,collectedAt:occurredAt,source:'TIPMINER',deliveryMode:'BACKLOG',dedupKey:`external:${key}` };
}
