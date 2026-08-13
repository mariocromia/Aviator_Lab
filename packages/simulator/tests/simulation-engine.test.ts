import { describe, expect, it } from 'vitest';
import type { BetPlanConfig, BetStrategyConfig, GameStrategyConfig, NormalizedRound } from '@aviator/shared';
import { SimulationEngine } from '../src/index.js';

const gameStrategy: GameStrategyConfig = { trigger: [{ operator: 'GT', value: 1.35 }, { operator: 'LT', value: 99 }], win: [{ operator: 'GTE', value: 2 }], loss: [{ operator: 'BETWEEN', value: [0.01, 1.99] }], afterLoss: [{ operator: 'LT', value: 1.35 }], release: [{ operator: 'GTE', value: 2 }] };
const betStrategy: BetStrategyConfig = { rules: [{ id: 'loss-1', name: 'Loss 1', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 1 }], action: 'ENTER' }] };
const betPlan: BetPlanConfig = { stages: [{ index: 0, label: 'BASE', legs: [{ slot: 1, amountCents: 100, cashout: 2 }] }] };
const rounds = [1.72, 1.25, 2.27, 2.5].map((multiplier, index): NormalizedRound => ({ id: crypto.randomUUID(), platformId: crypto.randomUUID(), externalId: String(index), multiplier, occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), collectedAt: new Date().toISOString(), source: 'TIPMINER', deliveryMode: 'BACKLOG', dedupKey: String(index) }));

describe('SimulationEngine', () => {
  it('reuses domain engines and settles a direct financial win deterministically', () => {
    const result = new SimulationEngine().run({ rounds, gameStrategyId: 'game', gameStrategy, betStrategyId: 'bet', betStrategy, betPlan, initialBankrollCents: 10_000 });
    expect(result.report.gameSignals).toBe(2);
    expect(result.report.betEntries).toBe(1);
    expect(result.report.winDirect).toBe(1);
    expect(result.report.finalBankrollCents).toBe(10_100);
    expect(result.report.profitCents).toBe(100);
    expect(result.trace.at(-1)?.stageLabel).toBe('BASE');
  });

  it('sorts inputs chronologically and produces the same report', () => {
    const engine = new SimulationEngine();
    const first = engine.run({ rounds, gameStrategyId: 'game', gameStrategy, betStrategyId: 'bet', betStrategy, betPlan, initialBankrollCents: 10_000 });
    const second = engine.run({ rounds: [...rounds].reverse(), gameStrategyId: 'game', gameStrategy, betStrategyId: 'bet', betStrategy, betPlan, initialBankrollCents: 10_000 });
    expect(second.report).toEqual(first.report);
  });
});
