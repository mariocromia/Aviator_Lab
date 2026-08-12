import { describe, expect, it } from 'vitest';
import type { BetStrategyConfig, GameSignal, ResultAnalyzerState } from '@aviator/shared';
import { BetStrategyEngine, PatternEngine } from '../src/index.js';

const analyzer = (overrides: Partial<ResultAnalyzerState> = {}): ResultAnalyzerState => ({ currentWinStreak: 0, currentLossStreak: 0, lastClosedWinStreak: 0, lastClosedLossStreak: 0, maxWinStreak: 0, maxLossStreak: 0, winCount: 0, lossCount: 0, winRate: 0, recentPattern: '', lastResult: null, ...overrides });
const signal: GameSignal = { id: crypto.randomUUID(), terminalId: crypto.randomUUID(), platformId: crypto.randomUUID(), strategyId: crypto.randomUUID(), triggerRoundId: crypto.randomUUID(), resultRoundId: crypto.randomUUID(), result: 'LOSS', createdAt: new Date().toISOString(), metadata: {} };
const decide = (config: BetStrategyConfig, state: ResultAnalyzerState) => new BetStrategyEngine().decide({ terminalId: signal.terminalId, betStrategyId: crypto.randomUUID(), config, signal, analyzer: state, bankrollCents: 10_000 });

describe('PatternEngine', () => {
  it('supports W, L and wildcard patterns against the recent suffix', () => {
    const engine = new PatternEngine();
    expect(engine.matches('WWLLLWL', 'LWL')).toBe(true);
    expect(engine.matches('WWLLLWL', 'L?L')).toBe(true);
    expect(engine.matches('WWLLLWL', 'WW')).toBe(false);
  });
});

describe('BetStrategyEngine', () => {
  it('matches fixed and reference-field conditions without special cases', () => {
    const fixed: BetStrategyConfig = { rules: [{ id: 'fixed', name: 'Fixed', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 3 }], action: 'ENTER' }] };
    const dynamic: BetStrategyConfig = { rules: [{ id: 'dynamic', name: 'Dynamic', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', referenceField: 'lastClosedLossStreak' }], action: 'ENTER' }] };
    expect(decide(fixed, analyzer({ currentLossStreak: 3 })).action).toBe('ENTER');
    expect(decide(dynamic, analyzer({ currentLossStreak: 2, lastClosedLossStreak: 2 })).action).toBe('ENTER');
    expect(decide(dynamic, analyzer({ currentLossStreak: 1, lastClosedLossStreak: 2 })).action).toBe('IGNORE');
  });

  it('uses priority and supports pattern conditions', () => {
    const config: BetStrategyConfig = { rules: [
      { id: 'later', name: 'Later', enabled: true, priority: 2, conditions: [{ field: 'currentLossStreak', operator: 'GTE', value: 1 }], action: 'PAUSE' },
      { id: 'pattern', name: 'Pattern', enabled: true, priority: 1, conditions: [{ field: 'recentPattern', operator: 'MATCHES', value: 'L?L' }], action: 'ENTER' }
    ] };
    const decision = decide(config, analyzer({ currentLossStreak: 2, recentPattern: 'WWLWL' }));
    expect(decision.action).toBe('ENTER');
    expect(decision.ruleId).toBe('pattern');
  });

  it('carries the main and post-win plans into the decision', () => {
    const mainPlanId = crypto.randomUUID(); const followUpPlanId = crypto.randomUUID();
    const config: BetStrategyConfig = { rules: [{ id: 'plans', name: 'Planos', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', referenceField: 'lastClosedLossStreak' }], action: 'ENTER', betPlanId: mainPlanId, onWinBetPlanId: followUpPlanId, onWinPlanBehavior: 'REPEAT_UNTIL_LOSS' }] };
    const decision = decide(config, analyzer({ currentLossStreak: 3, lastClosedLossStreak: 3 }));
    expect(decision.metadata).toMatchObject({ betPlanId: mainPlanId, onWinBetPlanId: followUpPlanId, onWinPlanBehavior: 'REPEAT_UNTIL_LOSS' });
  });
});
