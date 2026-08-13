import { describe, expect, it } from 'vitest';
import { createResultAnalyzerState, ResultAnalyzer } from '../src/index.js';

describe('ResultAnalyzer', () => {
  it('keeps current, closed and maximum streaks isolated and deterministic', () => {
    const analyzer = new ResultAnalyzer();
    let state = createResultAnalyzerState();
    for (const result of ['WIN', 'WIN', 'LOSS', 'LOSS', 'LOSS', 'WIN', 'WIN', 'LOSS'] as const) state = analyzer.process(state, result);
    expect(state.currentLossStreak).toBe(1);
    expect(state.currentWinStreak).toBe(0);
    expect(state.lastClosedLossStreak).toBe(3);
    expect(state.lastClosedWinStreak).toBe(2);
    expect(state.maxLossStreak).toBe(3);
    expect(state.recentPattern).toBe('WWLLLWWL');
    expect(state.winRate).toBe(50);
  });
});
