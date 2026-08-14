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
});
