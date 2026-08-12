import { describe, expect, it } from 'vitest';
import type { GameStrategyConfig, NormalizedRound, TerminalRuntime } from '@aviator/shared';
import { GameStrategyEngine } from '../src/index.js';

const config: GameStrategyConfig = {
  trigger: [{ operator: 'GT', value: 1.35 }, { operator: 'LT', value: 99 }],
  win: [{ operator: 'GTE', value: 2 }],
  loss: [{ operator: 'BETWEEN', value: [0.01, 1.99] }],
  afterLoss: [{ operator: 'LT', value: 1.35 }],
  release: [{ operator: 'GTE', value: 2 }]
};

const makeRound = (multiplier: number): NormalizedRound => ({
  id: crypto.randomUUID(), platformId: crypto.randomUUID(), externalId: null, multiplier,
  occurredAt: new Date().toISOString(), collectedAt: new Date().toISOString(), source: 'TIPMINER',
  deliveryMode: 'LIVE', dedupKey: crypto.randomUUID()
});

const initialRuntime = (): TerminalRuntime['gameStrategyRuntime'] => ({ state: 'SEARCH_TRIGGER', processedRounds: 0, lastMultiplier: null, triggerRoundId: null });

describe('GameStrategyEngine', () => {
  it('executes the critical WAIT_RELEASE sequence deterministically', () => {
    const engine = new GameStrategyEngine();
    let runtime = initialRuntime();
    const roles: string[] = [];
    const states: string[] = [];
    const signals: string[] = [];

    for (const multiplier of [1.72, 1.25, 1.11, 1.46, 1.83, 2.27, 1.64]) {
      const result = engine.process({ terminalId: crypto.randomUUID(), strategyId: crypto.randomUUID(), config, runtime, round: makeRound(multiplier) });
      runtime = result.runtime; roles.push(result.annotation.role); states.push(runtime.state);
      if (result.signal) signals.push(result.signal.result);
    }

    expect(roles).toEqual(['TRIGGER', 'LOSS', 'IGNORED', 'IGNORED', 'IGNORED', 'RELEASE_TRIGGER', 'LOSS']);
    expect(states).toEqual(['WAIT_RESULT', 'WAIT_RELEASE', 'WAIT_RELEASE', 'WAIT_RELEASE', 'WAIT_RELEASE', 'WAIT_RESULT', 'SEARCH_TRIGGER']);
    expect(signals).toEqual(['LOSS', 'LOSS']);
  });

  it('emits WIN and returns directly to trigger search', () => {
    const engine = new GameStrategyEngine();
    const trigger = engine.process({ terminalId: crypto.randomUUID(), strategyId: crypto.randomUUID(), config, runtime: initialRuntime(), round: makeRound(1.72) });
    const win = engine.process({ terminalId: trigger.annotation.terminalId, strategyId: trigger.annotation.strategyId, config, runtime: trigger.runtime, round: makeRound(2) });
    expect(win.annotation.role).toBe('WIN');
    expect(win.signal?.result).toBe('WIN');
    expect(win.runtime.state).toBe('SEARCH_TRIGGER');
    expect(win.runtime.triggerRoundId).toBeNull();
  });
});
