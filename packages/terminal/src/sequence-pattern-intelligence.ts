import type { GameSignalResult, SequenceAiConfig, SequenceAiPrediction, SequenceAiRuntime } from '@aviator/shared';

const MAX_MODEL_WINDOW=12;

export function createSequenceAiRuntime():SequenceAiRuntime{return{history:'',observations:0,transitions:{},lastPrediction:null};}

export function normalizeSequenceAiRuntime(value:Partial<SequenceAiRuntime>|null|undefined):SequenceAiRuntime{
  return{history:String(value?.history??'').replace(/[^WL]/g,'').slice(-MAX_MODEL_WINDOW),observations:Math.max(0,Number(value?.observations)||0),transitions:value?.transitions&&typeof value.transitions==='object'?value.transitions:{},lastPrediction:value?.lastPrediction??null};
}

export function observeSequenceResult(runtime:SequenceAiRuntime,result:GameSignalResult):SequenceAiRuntime{
  const symbol=result==='WIN'?'W':'L';const transitions={...runtime.transitions};const history=runtime.history;
  for(let length=1;length<=Math.min(MAX_MODEL_WINDOW,history.length);length++){
    const context=history.slice(-length);const current=transitions[context]??{wins:0,losses:0};transitions[context]={wins:current.wins+(symbol==='W'?1:0),losses:current.losses+(symbol==='L'?1:0)};
  }
  return{history:`${history}${symbol}`.slice(-MAX_MODEL_WINDOW),observations:runtime.observations+1,transitions,lastPrediction:runtime.lastPrediction};
}

export function predictSequence(runtime:SequenceAiRuntime,config:SequenceAiConfig,riskDepth=4):SequenceAiPrediction{
  const minWindow=Math.max(1,Math.min(config.minWindow,MAX_MODEL_WINDOW));const maxWindow=Math.max(minWindow,Math.min(config.maxWindow,MAX_MODEL_WINDOW));
  const candidates=sequenceCandidates(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences);
  const selected=candidates.at(-1)??null;const periodicPattern=detectPeriodicPattern(runtime.history,maxWindow);const currentLossStreak=runtime.history.match(/L+$/)?.[0].length??0;
  if(!selected)return{expected:null,shouldEnter:false,winProbability:0,confidence:0,sampleSize:0,context:runtime.history.slice(-maxWindow),contextLength:0,periodicPattern,currentLossStreak,contextAgreement:0,agreeingContexts:0,evaluatedContexts:0,fullCycleLossRisk:0,riskDepth:Math.max(1,riskDepth),riskBlocked:false,reason:`Aguardando pelo menos ${config.minOccurrences} ocorrências de um contexto conhecido.`};
  const sampleSize=selected.wins+selected.losses;const winProbability=selected.winProbability;const expected=winProbability>=50?'W':'L';const confidence=expected==='W'?winProbability:100-winProbability;
  // Em repeticoes, compara somente janelas na mesma fase do periodo. Fora
  // delas, todos os tamanhos elegiveis precisam participar do consenso.
  const consensusCandidates=periodicPattern?candidates.filter(item=>(selected.context.length-item.context.length)%periodicPattern.length===0):candidates;
  const agreeingContexts=consensusCandidates.filter(item=>item.winProbability>=50).length;const evaluatedContexts=consensusCandidates.length;const contextAgreement=evaluatedContexts?agreeingContexts/evaluatedContexts*100:0;
  const normalizedRiskDepth=Math.max(1,Math.min(20,Math.round(riskDepth)));const fullCycleLossRisk=estimateLossRunRisk(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences,normalizedRiskDepth);
  const maxCurrentLossStreak=Math.max(0,Math.min(MAX_MODEL_WINDOW,config.maxCurrentLossStreak??3));const minContextAgreement=Math.max(0,Math.min(100,config.minContextAgreement??60));const configuredCycleRisk=Math.max(0,Math.min(100,config.maxFullCycleLossRisk??0));const maxFullCycleLossRisk=configuredCycleRisk||80*0.5**normalizedRiskDepth*100;
  const streakBlocked=maxCurrentLossStreak>0&&currentLossStreak>maxCurrentLossStreak;const consensusBlocked=contextAgreement<minContextAgreement;const cycleRiskBlocked=fullCycleLossRisk>maxFullCycleLossRisk;const riskBlocked=streakBlocked||consensusBlocked||cycleRiskBlocked;
  const shouldEnter=expected==='W'&&confidence>=config.minConfidence&&!riskBlocked;const structure=periodicPattern?`Repetição ${periodicPattern}`:`Contexto ${selected.context}`;
  const reason=streakBlocked?`${structure}: entrada bloqueada pelo risco de cauda (${currentLossStreak} L consecutivos; máximo ${maxCurrentLossStreak}).`:consensusBlocked?`${structure}: entrada bloqueada por falta de consenso (${contextAgreement.toFixed(1)}% em ${evaluatedContexts} janelas; mínimo ${minContextAgreement.toFixed(1)}%).`:cycleRiskBlocked?`${structure}: risco de ${normalizedRiskDepth} LOSS consecutivos em ${fullCycleLossRisk.toFixed(2)}%, acima do limite de ${maxFullCycleLossRisk.toFixed(2)}%.`:shouldEnter?`${structure}: W estimado em ${winProbability.toFixed(2)}% após ${sampleSize} ocorrências, consenso de ${contextAgreement.toFixed(1)}% e risco do ciclo de ${fullCycleLossRisk.toFixed(2)}%.`:expected==='L'?`${structure}: o resultado mais provável é L (${confidence.toFixed(2)}%).`:`${structure}: confiança de ${confidence.toFixed(2)}%, abaixo do mínimo de ${config.minConfidence.toFixed(2)}%.`;
  return{expected,shouldEnter,winProbability,confidence,sampleSize,context:selected.context,contextLength:selected.context.length,periodicPattern,currentLossStreak,contextAgreement,agreeingContexts,evaluatedContexts,fullCycleLossRisk,riskDepth:normalizedRiskDepth,riskBlocked,reason};
}

function sequenceCandidates(runtime:SequenceAiRuntime,history:string,minWindow:number,maxWindow:number,minOccurrences:number){const candidates:Array<{context:string;wins:number;losses:number;winProbability:number}>=[];for(let length=minWindow;length<=Math.min(maxWindow,history.length);length++){const context=history.slice(-length);const counts=runtime.transitions[context];const sampleSize=(counts?.wins??0)+(counts?.losses??0);if(counts&&sampleSize>=minOccurrences)candidates.push({context,...counts,winProbability:(counts.wins+1)/(sampleSize+2)*100});}return candidates;}

function estimateLossRunRisk(runtime:SequenceAiRuntime,initialHistory:string,minWindow:number,maxWindow:number,minOccurrences:number,depth:number){let history=initialHistory;let probability=1;for(let step=0;step<depth;step++){const candidates=sequenceCandidates(runtime,history,minWindow,maxWindow,minOccurrences);const averageWinProbability=candidates.length?candidates.reduce((total,item)=>total+item.winProbability,0)/candidates.length:50;probability*=1-averageWinProbability/100;history=`${history}L`.slice(-MAX_MODEL_WINDOW);}return probability*100;}

function detectPeriodicPattern(history:string,maxWindow:number):string|null{
  const sample=history.slice(-maxWindow);for(let period=1;period<=Math.min(6,Math.floor(sample.length/2));period++){
    let matchedLength=period;for(let index=sample.length-period-1;index>=0;index--){if(sample[index]!==sample[index+period])break;matchedLength++;}
    if(matchedLength>=Math.max(4,period*2)){const start=sample.length-matchedLength;return sample.slice(start,start+period);}
  }return null;
}
