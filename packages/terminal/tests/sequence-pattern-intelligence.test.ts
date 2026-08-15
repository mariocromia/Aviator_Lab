import { describe,expect,it } from 'vitest';
import { createSequenceAiRuntime,observeSequenceResult,predictSequence } from '../src/sequence-pattern-intelligence.js';

describe('inteligência de padrões sequenciais',()=>{
  it('reconhece a repetição LW em LWLWL e prevê W com base nas ocorrências aprendidas',()=>{
    let runtime=createSequenceAiRuntime();
    for(let index=0;index<120;index++)runtime=observeSequenceResult(runtime,index%2===0?'LOSS':'WIN');
    runtime={...runtime,history:'LWLWL'};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:12,minOccurrences:10,minConfidence:60});
    expect(prediction.periodicPattern).toBe('LW');
    expect(prediction.expected).toBe('W');
    expect(prediction.shouldEnter).toBe(true);
    expect(prediction.sampleSize).toBeGreaterThanOrEqual(10);
  });

  it('não libera entrada sem a quantidade mínima de amostras',()=>{
    let runtime=createSequenceAiRuntime();for(const result of ['LOSS','WIN','LOSS','WIN'] as const)runtime=observeSequenceResult(runtime,result);
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:12,minOccurrences:20,minConfidence:60});
    expect(prediction.expected).toBeNull();expect(prediction.shouldEnter).toBe(false);
  });

  it('não entra quando o histórico aprendido aponta para L',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WW',observations:50,transitions:{WW:{wins:2,losses:28}}};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:12,minOccurrences:10,minConfidence:60});
    expect(prediction.expected).toBe('L');expect(prediction.shouldEnter).toBe(false);
  });

  it('bloqueia um W aparente quando a cauda tem muitos L e as janelas menores discordam',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WLWWLWWWLLLL',observations:1_712,transitions:{
      LL:{wins:220,losses:235},LLL:{wins:107,losses:127},LLLL:{wins:57,losses:69},WLLLL:{wins:28,losses:29},WWLLLL:{wins:14,losses:12},WWWLLLL:{wins:8,losses:4},
    }};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:12,minOccurrences:10,minConfidence:60,maxCurrentLossStreak:3,minContextAgreement:60});
    expect(prediction).toMatchObject({expected:'W',shouldEnter:false,currentLossStreak:4,riskBlocked:true,evaluatedContexts:6,agreeingContexts:2});
    expect(prediction.contextAgreement).toBeCloseTo(33.33,1);
    expect(prediction.reason).toContain('risco de cauda');
  });

  it('pode bloquear somente pela falta de consenso entre os contextos',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WLWWLWWWLLLL',observations:1_712,transitions:{
      LL:{wins:220,losses:235},LLL:{wins:107,losses:127},LLLL:{wins:57,losses:69},WLLLL:{wins:28,losses:29},WWLLLL:{wins:14,losses:12},WWWLLLL:{wins:8,losses:4},
    }};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:12,minOccurrences:10,minConfidence:60,maxCurrentLossStreak:0,minContextAgreement:60});
    expect(prediction.shouldEnter).toBe(false);expect(prediction.reason).toContain('falta de consenso');
  });

  it('projeta o risco de perder BASE e todos os Gales antes de entrar',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WL',observations:500,transitions:{
      WL:{wins:8,losses:2},LL:{wins:5,losses:5},WLL:{wins:5,losses:5},LLL:{wins:5,losses:5},
    }};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:3,minOccurrences:10,minConfidence:60,maxCurrentLossStreak:0,minContextAgreement:0,maxFullCycleLossRisk:3},4);
    expect(prediction.expected).toBe('W');expect(prediction.fullCycleLossRisk).toBeCloseTo(3.125,3);
    expect(prediction.shouldEnter).toBe(false);expect(prediction.reason).toContain('4 LOSS consecutivos');
  });

  it('aplica 5% como limite automatico de risco para BASE mais tres Gales',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WL',observations:500,transitions:{
      WL:{wins:8,losses:2},LL:{wins:3,losses:7},
    }};
    const prediction=predictSequence(runtime,{minWindow:2,maxWindow:2,minOccurrences:10,minConfidence:60,maxCurrentLossStreak:0,minContextAgreement:0,maxFullCycleLossRisk:0},4);
    expect(prediction.expected).toBe('W');expect(prediction.fullCycleLossRisk).toBeGreaterThan(5);
    expect(prediction.shouldEnter).toBe(false);expect(prediction.riskBlocked).toBe(true);
  });

  it('a v2 combina contextos e libera somente um W com evidência conservadora',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WWLWLW',observations:2_000,transitions:{LW:{wins:90,losses:30},WLW:{wins:70,losses:20},LWLW:{wins:50,losses:10}}};
    const prediction=predictSequence(runtime,{engineVersion:'V2',minWindow:2,maxWindow:4,minOccurrences:10,minConfidence:58,minProbabilityLowerBound:50,maxCurrentLossStreak:0,minContextAgreement:60,maxFullCycleLossRisk:100,minRecentOccurrences:0,maxRecentDivergence:100},3);
    expect(prediction).toMatchObject({engineVersion:'V2',expected:'W',shouldEnter:true,riskBlocked:false,modelVersion:'pattern-v2.1'});
    expect(prediction.probabilityLowerBound).toBeGreaterThan(50);
  });

  it('a v2 bloqueia quando o período recente diverge do banco histórico',()=>{
    const runtime={...createSequenceAiRuntime(),history:`${'WLL'.repeat(30)}WL`,observations:3_000,transitions:{WL:{wins:80,losses:20}}};
    const prediction=predictSequence(runtime,{engineVersion:'V2',minWindow:2,maxWindow:2,minOccurrences:20,minConfidence:58,minProbabilityLowerBound:0,maxCurrentLossStreak:0,minContextAgreement:0,maxFullCycleLossRisk:100,recentWindow:500,minRecentOccurrences:8,maxRecentDivergence:12},3);
    expect(prediction.expected).toBe('W');expect(prediction.shouldEnter).toBe(false);expect(prediction.regimeStable).toBe(false);expect(prediction.reason).toContain('regime recente divergente');
  });

  it('a v2 rejeita porcentagem alta baseada em amostra estatisticamente frágil',()=>{
    const runtime={...createSequenceAiRuntime(),history:'WL',observations:100,transitions:{WL:{wins:7,losses:3}}};
    const prediction=predictSequence(runtime,{engineVersion:'V2',minWindow:2,maxWindow:2,minOccurrences:10,minConfidence:60,minProbabilityLowerBound:55,maxCurrentLossStreak:0,minContextAgreement:0,maxFullCycleLossRisk:100,minRecentOccurrences:0,maxRecentDivergence:100},2);
    expect(prediction.expected).toBe('W');expect(prediction.shouldEnter).toBe(false);expect(prediction.probabilityLowerBound).toBeLessThan(55);expect(prediction.reason).toContain('limite conservador');
  });
});
