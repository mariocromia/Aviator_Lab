import type { NormalizedRound } from '@aviator/shared';

export class RoundDeduplicator {
  private readonly keysByPlatform = new Map<string, Set<string>>();

  hydrate(platformId: string, keys: Iterable<string>) { this.keysByPlatform.set(platformId, new Set(keys)); }

  filterUnseen(rounds: NormalizedRound[]): NormalizedRound[] {
    const unseen: NormalizedRound[] = [];
    for (const round of rounds) {
      let keys = this.keysByPlatform.get(round.platformId);
      if (!keys) { keys = new Set(); this.keysByPlatform.set(round.platformId, keys); }
      if (keys.has(round.dedupKey)) continue;
      keys.add(round.dedupKey); unseen.push(round);
    }
    return unseen;
  }
}
