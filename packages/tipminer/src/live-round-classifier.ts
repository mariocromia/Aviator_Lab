import type { NormalizedRound } from '@aviator/shared';

export class LiveRoundClassifier {
  private readonly synchronizedPlatforms = new Set<string>();

  classify(platformId: string, rounds: NormalizedRound[]): NormalizedRound[] {
    const firstSync = !this.synchronizedPlatforms.has(platformId);
    this.synchronizedPlatforms.add(platformId);
    const deliveryMode = firstSync || rounds.length !== 1 ? 'BACKLOG' : 'LIVE';
    return rounds.map(round => ({ ...round, deliveryMode }));
  }
}
