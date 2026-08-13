import { describe, expect, it } from 'vitest';
import type { BetPlanConfig, BetStrategyConfig, GameStrategyConfig, NormalizedRound } from '@aviator/shared';
import { SimulationEngine } from '../src/index.js';

const gameStrategy: GameStrategyConfig = { trigger: [{ operator: 'GT', value: 1.35 }, { operator: 'LT', value: 99 }], win: [{ operator: 'GTE', value: 2 }], loss: [{ operator: 'BETWEEN', value: [0.01, 1.99] }], afterLoss: [{ operator: 'LT', value: 1.35 }], release: [{ operator: 'GTE', value: 2 }] };
const betStrategy: BetStrategyConfig = { rules: [{ id: 'loss-1', name: 'Loss 1', enabled: true, priority: 1, conditions: [{ field: 'currentLossStreak', operator: 'EQ', value: 1 }], action: 'ENTER' }] };
const betPlan: BetPlanConfig = { stages: [{ index: 0, label: 'BASE', legs: [{ slot: 1, amountCents: 100, cashout: 2 }] }] };
const rounds = [1.72, 1.25, 2.27, 2.5].map((multiplier, index): NormalizedRound => ({ id: crypto.randomUUID(), platformId: crypto.randomUUID(), externalId: String(index), multiplier, occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), collectedAt: new Date().toISOString(), source: 'TIPMINER', deliveryMode: 'BACKLOG', dedupKey: String(index) }));

describe('SimulationEngine', () => {
  it('reuses domain engines and settles a direct financial win deterministically', () => {
    const result = new SimulationEngine().run(input(rounds));
    expect(result.report.gameSignals).toBe(2);
    expect(result.report.betEntries).toBe(1);
    expect(result.report.winDirect).toBe(1);
    expect(result.report.finalBankrollCents).toBe(10_100);
    expect(result.report.profitCents).toBe(100);
    expect(result.trace.at(-1)?.stageLabel).toBe('BASE');
  });

  it('sorts inputs chronologically and produces the same report', () => {
    const engine = new SimulationEngine();
    const first = engine.run(input(rounds));
    const second = engine.run(input([...rounds].reverse()));
    expect(second.report).toEqual(first.report);
  });

  it('selects independent entry strategies and plans after WIN and LOSS',()=>{
    const winStrategy:BetStrategyConfig={rules:[{id:'win-1',name:'Win 1',enabled:true,priority:1,conditions:[{field:'currentWinStreak',operator:'EQ',value:1}],action:'ENTER'}]};
    const lossStrategy:BetStrategyConfig={rules:[{id:'never',name:'Nunca',enabled:true,priority:1,conditions:[{field:'currentLossStreak',operator:'GT',value:99}],action:'ENTER'}]};
    const winPlan:BetPlanConfig={stages:[{index:0,label:'WIN BASE',legs:[{slot:1,amountCents:250,cashout:2}]}]};
    const continuation=[1.72,2.5].map((multiplier,index):NormalizedRound=>({...rounds[0],id:crypto.randomUUID(),externalId:`continuation-${index}`,dedupKey:`continuation-${index}`,multiplier,occurredAt:new Date(Date.UTC(2026,0,1,0,1,index)).toISOString()}));
    const result=new SimulationEngine().run({...input([...rounds,...continuation]),betStrategyWinId:'win',betStrategyLossId:'loss',betStrategyWin:winStrategy,betStrategyLoss:lossStrategy,betPlanWin:winPlan});
    expect(result.report.betEntries).toBe(1);
    expect(result.trace.at(-1)).toMatchObject({stageLabel:'WIN BASE',stageProfitLossCents:250});
  });

  it('applies percentage progression after blocks of failed cycles',()=>{
    const always:BetStrategyConfig={rules:[{id:'always',name:'Sempre',enabled:true,priority:1,conditions:[{field:'winCount',operator:'GTE',value:1}],action:'ENTER'}]};
    const progressive:BetPlanConfig={cycleProgression:{attemptsPerStep:3,increasePercentage:50,maxAttempts:10},stages:[{index:0,label:'BASE 5X',legs:[{slot:1,amountCents:100,cashout:5}]}]};
    const cycleRounds=Array.from({length:5},(_,signal)=>[1.72,2.5].map((multiplier,step):NormalizedRound=>({...rounds[0],id:crypto.randomUUID(),externalId:`cycle-${signal}-${step}`,dedupKey:`cycle-${signal}-${step}`,multiplier,occurredAt:new Date(Date.UTC(2026,0,1,0,2,signal*2+step)).toISOString()}))).flat();
    const result=new SimulationEngine().run({...input(cycleRounds),betStrategyWin:always,betStrategyLoss:always,betPlanWin:progressive,betPlanLoss:progressive});
    expect(result.trace.filter(item=>item.stageLabel).map(item=>item.stageProfitLossCents)).toEqual([-100,-100,-100,-150]);
    expect(result.report.finalBankrollCents).toBe(9_550);
  });
});

function input(inputRounds:NormalizedRound[]){return{rounds:inputRounds,gameStrategyId:'game',gameStrategy,betStrategyWinId:'bet-win',betStrategyLossId:'bet-loss',betStrategyWin:betStrategy,betStrategyLoss:betStrategy,betPlanWin:betPlan,betPlanLoss:betPlan,initialBankrollCents:10_000};}
