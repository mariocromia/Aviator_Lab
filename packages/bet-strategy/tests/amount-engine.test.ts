import { describe, expect, it } from 'vitest';
import { bankrollStopReason, calculateBetAmount, createBankrollMetrics, evaluateFormula, updateBankrollMetrics } from '../src/amount-engine.js';

const context={bankrollCents:100_000,initialBankrollCents:100_000,previousAmountCents:2_000,currentLossStreak:3,lastLossStreak:4,accumulatedLossCents:5_000,stageIndex:1,cashout:2};
describe('AmountEngine',()=>{
  it('calcula os métodos de valor configuráveis',()=>{
    expect(calculateBetAmount({slot:1,amountCents:100,cashout:2,amountStrategy:{type:'BANKROLL_PERCENTAGE',percentage:2}},context)).toBe(2_000);
    expect(calculateBetAmount({slot:1,amountCents:100,cashout:2,amountStrategy:{type:'PREVIOUS_AMOUNT_MULTIPLIER',multiplier:2}},context)).toBe(4_000);
    expect(calculateBetAmount({slot:1,amountCents:100,cashout:2,amountStrategy:{type:'RECOVERY_TARGET',recoveryTargetCents:1_000}},context)).toBe(6_000);
  });
  it('avalia fórmula aritmética sem eval e rejeita código',()=>{
    expect(evaluateFormula('banca * 0.01 + lossAtual * 100',context)).toBe(1_300);
    expect(()=>evaluateFormula('process.exit()',context)).toThrow();
  });
  it('acompanha drawdown e aplica stops',()=>{
    const metrics=updateBankrollMetrics(createBankrollMetrics(100_000),-12_000,1_000,{stopLossCents:10_000});
    expect(metrics.maxDrawdownCents).toBe(12_000);
    expect(metrics.stopReason).toBe('Stop LOSS atingido');
    expect(bankrollStopReason(metrics,60_000,{maxBetPercentage:50})).toBe('Percentual máximo da banca excedido');
  });
});
