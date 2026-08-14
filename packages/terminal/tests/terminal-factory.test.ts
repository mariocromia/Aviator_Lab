import { describe, expect, it } from 'vitest';
import { createTerminal, duplicateTerminal } from '../src/terminal-factory';

const now = '2026-08-11T12:00:00.000Z';

describe('terminal factory', () => {
  it('starts with an isolated bankroll and empty operational history', () => {
    const terminal = createTerminal({
      name: 'Terminal Alpha', platformId: crypto.randomUUID(),
      gameStrategyId: crypto.randomUUID(), betStrategyId: crypto.randomUUID(),
      betPlanId: crypto.randomUUID(), screenProfileId: null,
      mode: 'SIMULATION', enabled: true, paused: false, initialBankrollCents: 10_000
    }, crypto.randomUUID(), now);
    expect(terminal.currentBankrollCents).toBe(10_000);
    expect(terminal.gameWins).toBe(0);
    expect(terminal.gameLosses).toBe(0);
    expect(terminal.historyDisplayLimit).toBe(200);
    expect(terminal.analysisRoundLimit).toBe(1_000);
  });

  it('duplicates configuration but never operational state or identity', () => {
    const source = createTerminal({
      name: 'Terminal Alpha', platformId: crypto.randomUUID(),
      gameStrategyId: crypto.randomUUID(), betStrategyId: crypto.randomUUID(),
      betPlanId: crypto.randomUUID(), screenProfileId: null,
      mode: 'SIMULATION', enabled: true, paused: false, historyDisplayLimit:200,operationCombinations:[{id:'llw',name:'LLW',priority:10,enabled:true,triggerType:'PATTERN',pattern:'LLW',betStrategyId:crypto.randomUUID(),lossReentryType:'PATTERN',lossReentryPattern:'W',lossReentryBetStrategyId:null,betPlanId:crypto.randomUUID(),behavior:'REPEAT_UNTIL_LOSS'}], initialBankrollCents: 25_000
    }, crypto.randomUUID(), now);
    source.currentBankrollCents = 31_400;
    source.gameWins = 12;
    const copy = duplicateTerminal(source, crypto.randomUUID(), '2026-08-11T12:30:00.000Z');
    expect(copy.id).not.toBe(source.id);
    expect(copy.platformId).toBe(source.platformId);
    expect(copy.currentBankrollCents).toBe(25_000);
    expect(copy.gameWins).toBe(0);
    expect(copy.paused).toBe(true);
    expect(copy.historyDisplayLimit).toBe(200);
    expect(copy.analysisRoundLimit).toBe(source.analysisRoundLimit);
    expect(copy.operationCombinations).toEqual(source.operationCombinations);
    expect(copy.operationCombinations).not.toBe(source.operationCombinations);
  });
});
