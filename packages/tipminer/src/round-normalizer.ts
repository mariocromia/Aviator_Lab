import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NormalizedRound } from '@aviator/shared';

const rawRoundSchema = z.object({
  uuid: z.string().optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  result: z.coerce.number().positive().finite(),
  instant: z.string().datetime({ offset: true })
}).passthrough();

export class TipMinerRoundNormalizer {
  normalize(raw: unknown, platformId: string, collectedAt = new Date().toISOString()): NormalizedRound {
    const value = rawRoundSchema.parse(raw);
    const externalId = value.externalId == null ? null : String(value.externalId);
    const occurredAt = new Date(value.instant).toISOString();
    const fingerprint = createHash('sha256').update(`${occurredAt}|${value.result}`).digest('hex');
    return {
      id: value.uuid ?? randomUUID(), platformId, externalId,
      multiplier: value.result, occurredAt, collectedAt, source: 'TIPMINER',
      deliveryMode: 'BACKLOG', dedupKey: externalId ? `external:${externalId}` : `fingerprint:${fingerprint}`,
      rawData: raw
    };
  }

  normalizeMany(rawRounds: unknown[], platformId: string, collectedAt = new Date().toISOString()): NormalizedRound[] {
    return rawRounds.map(raw => this.normalize(raw, platformId, collectedAt)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
