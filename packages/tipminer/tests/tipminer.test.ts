import { describe, expect, it } from 'vitest';
import { LiveRoundClassifier, RoundDeduplicator, TipMinerClient, TipMinerRoundNormalizer } from '../src/index.js';

const platformId = '22222222-2222-4222-8222-222222222222';
const raw = (externalId: string, result: number, instant: string) => ({ uuid: crypto.randomUUID(), externalId, result, instant, type: 'LOW' });

describe('TipMiner phase 2', () => {
  it('normalizes and sorts newest-first payload chronologically', () => {
    const rounds = new TipMinerRoundNormalizer().normalizeMany([
      raw('2', 2.4, '2026-08-11T16:00:02.000Z'), raw('1', 1.2, '2026-08-11T16:00:01.000Z')
    ], platformId);
    expect(rounds.map(r => r.externalId)).toEqual(['1', '2']);
    expect(rounds[0].dedupKey).toBe('external:1');
  });

  it('deduplicates separately by platform', () => {
    const normalizer = new TipMinerRoundNormalizer(); const dedup = new RoundDeduplicator();
    const round = normalizer.normalize(raw('10', 1.5, '2026-08-11T16:00:00.000Z'), platformId);
    expect(dedup.filterUnseen([round, round])).toHaveLength(1);
    expect(dedup.filterUnseen([{ ...round, platformId: crypto.randomUUID() }])).toHaveLength(1);
  });

  it('classifies first sync and gaps as BACKLOG, then one round as LIVE', () => {
    const normalizer = new TipMinerRoundNormalizer(); const classifier = new LiveRoundClassifier();
    const rounds = [normalizer.normalize(raw('1', 1.2, '2026-08-11T16:00:00.000Z'), platformId)];
    expect(classifier.classify(platformId, rounds)[0].deliveryMode).toBe('BACKLOG');
    expect(classifier.classify(platformId, rounds)[0].deliveryMode).toBe('LIVE');
    expect(classifier.classify(platformId, [...rounds, ...rounds])[0].deliveryMode).toBe('BACKLOG');
  });

  it('keeps the HTTP client limited to transport', async () => {
    const client = new TipMinerClient(async () => new Response(JSON.stringify([{ result: 1.2 }]), { status: 200 }));
    expect(await client.getHistory({ roundUuid: crypto.randomUUID(), limit: 5, timeoutMs: 100 })).toHaveLength(1);
  });
});
