import type { GameSignalResult, ResultAnalyzerState } from '@aviator/shared';

export function createResultAnalyzerState(): ResultAnalyzerState {
  return { currentWinStreak: 0, currentLossStreak: 0, lastClosedWinStreak: 0, lastClosedLossStreak: 0, maxWinStreak: 0, maxLossStreak: 0, winCount: 0, lossCount: 0, winRate: 0, recentPattern: '', lastResult: null };
}

export class ResultAnalyzer {
  process(current: ResultAnalyzerState, result: GameSignalResult): ResultAnalyzerState {
    const state = { ...current };
    if (result === 'WIN') {
      if (state.currentLossStreak > 0) state.lastClosedLossStreak = state.currentLossStreak;
      state.currentLossStreak = 0;
      state.currentWinStreak++;
      state.maxWinStreak = Math.max(state.maxWinStreak, state.currentWinStreak);
      state.winCount++;
    } else {
      if (state.currentWinStreak > 0) state.lastClosedWinStreak = state.currentWinStreak;
      state.currentWinStreak = 0;
      state.currentLossStreak++;
      state.maxLossStreak = Math.max(state.maxLossStreak, state.currentLossStreak);
      state.lossCount++;
    }
    state.lastResult = result;
    state.recentPattern = `${state.recentPattern}${result === 'WIN' ? 'W' : 'L'}`.slice(-100);
    const total = state.winCount + state.lossCount;
    state.winRate = total === 0 ? 0 : state.winCount / total * 100;
    return state;
  }
}
