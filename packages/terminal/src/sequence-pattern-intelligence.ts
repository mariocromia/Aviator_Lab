import type { GameSignalResult, SequenceAiConfig, SequenceAiPrediction, SequenceAiRuntime } from '@aviator/shared';

const MAX_MODEL_WINDOW=16;
const MAX_RECENT_HISTORY=5_000;
export const SEQUENCE_AI_V2_MODEL_VERSION='pattern-v2.1';

type Candidate={context:string;wins:number;losses:number;sampleSize:number;winProbability:number;lowerBound:number};

export function createSequenceAiRuntime():SequenceAiRuntime{return{history:'',observations:0,transitions:{},lastPrediction:null,datasetKey:null,persistedObservations:0};}

export function normalizeSequenceAiRuntime(value:Partial<SequenceAiRuntime>|null|undefined):SequenceAiRuntime{
  const transitions:SequenceAiRuntime['transitions']={};
  if(value?.transitions&&typeof value.transitions==='object')for(const[context,counts]of Object.entries(value.transitions)){
    const normalized=context.replace(/[^WL]/g,'').slice(-MAX_MODEL_WINDOW);if(!normalized)continue;
    transitions[normalized]={wins:Math.max(0,Number(counts?.wins)||0),losses:Math.max(0,Number(counts?.losses)||0)};
  }
  return{history:String(value?.history??'').replace(/[^WL]/g,'').slice(-MAX_RECENT_HISTORY),observations:Math.max(0,Number(value?.observations)||0),transitions,lastPrediction:value?.lastPrediction??null,datasetKey:value?.datasetKey??null,persistedObservations:Math.max(0,Number(value?.persistedObservations)||0)};
}

export function observeSequenceResult(runtime:SequenceAiRuntime,result:GameSignalResult):SequenceAiRuntime{
  // O mapa pode chegar a dezenas de milhares de contextos. Copiá-lo a cada
  // rodada tornava o replay quadrático; ele é exclusivo do runtime e pode ser
  // atualizado incrementalmente com segurança.
  const symbol=result==='WIN'?'W':'L';const transitions=runtime.transitions;const history=runtime.history;
  for(let length=1;length<=Math.min(MAX_MODEL_WINDOW,history.length);length++){
    const context=history.slice(-length);const current=transitions[context]??{wins:0,losses:0};transitions[context]={wins:current.wins+(symbol==='W'?1:0),losses:current.losses+(symbol==='L'?1:0)};
  }
  return{...runtime,history:`${history}${symbol}`.slice(-MAX_RECENT_HISTORY),observations:runtime.observations+1,transitions,lastPrediction:runtime.lastPrediction};
}

export function predictSequence(runtime:SequenceAiRuntime,config:SequenceAiConfig,riskDepth=4):SequenceAiPrediction{
  return config.engineVersion==='V2'?predictSequenceV2(runtime,config,riskDepth):predictSequenceV1(runtime,config,riskDepth);
}

function predictSequenceV1(runtime:SequenceAiRuntime,config:SequenceAiConfig,riskDepth:number):SequenceAiPrediction{
  const minWindow=clampWindow(config.minWindow);const maxWindow=Math.max(minWindow,clampWindow(config.maxWindow));
  const candidates=sequenceCandidates(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences);
  const selected=candidates.at(-1)??null;const periodicPattern=detectPeriodicPattern(runtime.history,maxWindow);const currentLossStreak=lossStreak(runtime.history);
  if(!selected)return emptyPrediction(runtime,config,maxWindow,riskDepth,periodicPattern,currentLossStreak,'V1');
  const winProbability=selected.winProbability;const expected=winProbability>=50?'W':'L';const confidence=expected==='W'?winProbability:100-winProbability;
  const consensusCandidates=periodicPattern?candidates.filter(item=>(selected.context.length-item.context.length)%periodicPattern.length===0):candidates;
  const agreeingContexts=consensusCandidates.filter(item=>item.winProbability>=50).length;const evaluatedContexts=consensusCandidates.length;const contextAgreement=evaluatedContexts?agreeingContexts/evaluatedContexts*100:0;
  const normalizedRiskDepth=normalizeRiskDepth(riskDepth);const fullCycleLossRisk=estimateLossRunRisk(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences,normalizedRiskDepth,false);
  const risk=calculateRiskBlocks(config,currentLossStreak,contextAgreement,fullCycleLossRisk,normalizedRiskDepth);
  const shouldEnter=expected==='W'&&confidence>=config.minConfidence&&!risk.blocked;const structure=periodicPattern?`Repetição ${periodicPattern}`:`Contexto ${selected.context}`;
  const reason=riskReason(structure,risk,currentLossStreak,contextAgreement,evaluatedContexts,fullCycleLossRisk,normalizedRiskDepth)??(shouldEnter?`${structure}: W estimado em ${winProbability.toFixed(2)}% após ${selected.sampleSize} ocorrências.`:expected==='L'?`${structure}: o resultado mais provável é L (${confidence.toFixed(2)}%).`:`${structure}: confiança de ${confidence.toFixed(2)}%, abaixo do mínimo de ${config.minConfidence.toFixed(2)}%.`);
  return{engineVersion:'V1',expected,shouldEnter,winProbability,confidence,sampleSize:selected.sampleSize,context:selected.context,contextLength:selected.context.length,periodicPattern,currentLossStreak,contextAgreement,agreeingContexts,evaluatedContexts,fullCycleLossRisk,riskDepth:normalizedRiskDepth,riskBlocked:risk.blocked,reason};
}

/**
 * Modelo explicável de contexto variável. Ele combina todas as janelas com
 * amostra, exige limite conservador, compara histórico recente com o global e
 * prefere não apostar quando os contextos correlacionados discordam.
 */
export function predictSequenceV2(runtime:SequenceAiRuntime,config:SequenceAiConfig,riskDepth=4):SequenceAiPrediction{
  const minWindow=clampWindow(config.minWindow);const maxWindow=Math.max(minWindow,clampWindow(config.maxWindow));
  const candidates=sequenceCandidates(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences);const periodicPattern=detectPeriodicPattern(runtime.history,maxWindow);const structuralPattern=detectStructuralPattern(runtime.history,maxWindow);const currentLossStreak=lossStreak(runtime.history);const normalizedRiskDepth=normalizeRiskDepth(riskDepth);
  if(!candidates.length)return{...emptyPrediction(runtime,config,maxWindow,riskDepth,periodicPattern,currentLossStreak,'V2'),modelVersion:SEQUENCE_AI_V2_MODEL_VERSION,structuralPattern};

  const weighted=weightedProbability(candidates);const expected=weighted>=50?'W':'L';const confidence=expected==='W'?weighted:100-weighted;
  const agreeingContexts=candidates.filter(item=>item.winProbability>=50).length;const evaluatedContexts=candidates.length;const contextAgreement=agreeingContexts/evaluatedContexts*100;
  const evidence=candidates.reduce((best,item)=>item.context.length>best.context.length?item:best,candidates[0]);
  const conservativeBound=weightedLowerBound(candidates);
  const recent=recentContextStats(runtime.history,evidence.context,Math.max(50,Math.min(MAX_RECENT_HISTORY,config.recentWindow??500)));
  const recentDivergence=recent.sampleSize?Math.abs(recent.winProbability-weighted):0;const minRecent=Math.max(0,config.minRecentOccurrences??8);const maxDivergence=Math.max(0,Math.min(100,config.maxRecentDivergence??12));const regimeStable=recent.sampleSize<minRecent||recentDivergence<=maxDivergence;
  const fullCycleLossRisk=estimateLossRunRisk(runtime,runtime.history,minWindow,maxWindow,config.minOccurrences,normalizedRiskDepth,true);
  const baseRisk=calculateRiskBlocks(config,currentLossStreak,contextAgreement,fullCycleLossRisk,normalizedRiskDepth);const lowerBoundMinimum=Math.max(0,Math.min(99.9,config.minProbabilityLowerBound??50));
  const lowerBoundBlocked=conservativeBound<lowerBoundMinimum;const riskBlocked=baseRisk.blocked||!regimeStable||lowerBoundBlocked;const shouldEnter=expected==='W'&&confidence>=config.minConfidence&&!riskBlocked;
  const structure=structuralPattern??(periodicPattern?`Repetição ${periodicPattern}`:`Contexto ${evidence.context}`);
  const reason=baseRisk.blocked?riskReason(structure,baseRisk,currentLossStreak,contextAgreement,evaluatedContexts,fullCycleLossRisk,normalizedRiskDepth)!:!regimeStable?`${structure}: regime recente divergente (${recent.winProbability.toFixed(1)}% recente contra ${weighted.toFixed(1)}% global; limite ${maxDivergence.toFixed(1)} p.p.).`:lowerBoundBlocked?`${structure}: limite conservador de ${conservativeBound.toFixed(1)}% abaixo do mínimo de ${lowerBoundMinimum.toFixed(1)}%.`:shouldEnter?`${structure}: consenso de ${contextAgreement.toFixed(1)}% em ${evaluatedContexts} janelas, W global ${weighted.toFixed(1)}%, limite conservador ${conservativeBound.toFixed(1)}% e risco do ciclo ${fullCycleLossRisk.toFixed(2)}%.`:expected==='L'?`${structure}: consenso indica L; W estimado em ${weighted.toFixed(1)}%.`:`${structure}: confiança de ${confidence.toFixed(1)}% abaixo do mínimo de ${config.minConfidence.toFixed(1)}%.`;
  return{engineVersion:'V2',modelVersion:SEQUENCE_AI_V2_MODEL_VERSION,expected,shouldEnter,winProbability:weighted,confidence,sampleSize:evidence.sampleSize,context:evidence.context,contextLength:evidence.context.length,periodicPattern,structuralPattern,currentLossStreak,contextAgreement,agreeingContexts,evaluatedContexts,fullCycleLossRisk,riskDepth:normalizedRiskDepth,riskBlocked,probabilityLowerBound:conservativeBound,recentWinProbability:recent.winProbability,recentSampleSize:recent.sampleSize,recentDivergence,regimeStable,reason};
}

export function sequenceObservationContexts(history:string,maxWindow=MAX_MODEL_WINDOW){const clean=history.replace(/[^WL]/g,'');const contexts:string[]=[];for(let length=1;length<=Math.min(maxWindow,clean.length);length++)contexts.push(clean.slice(-length));return contexts;}

function sequenceCandidates(runtime:SequenceAiRuntime,history:string,minWindow:number,maxWindow:number,minOccurrences:number):Candidate[]{const candidates:Candidate[]=[];for(let length=minWindow;length<=Math.min(maxWindow,history.length);length++){const context=history.slice(-length);const counts=runtime.transitions[context];const sampleSize=(counts?.wins??0)+(counts?.losses??0);if(counts&&sampleSize>=minOccurrences){const winProbability=(counts.wins+1)/(sampleSize+2)*100;candidates.push({context,...counts,sampleSize,winProbability,lowerBound:wilsonLowerBound(counts.wins,sampleSize)});}}return candidates;}
function weightedProbability(candidates:Candidate[]){let total=0,weights=0;for(const candidate of candidates){const weight=Math.sqrt(candidate.sampleSize)*(1+candidate.context.length/16);total+=candidate.winProbability*weight;weights+=weight;}return weights?total/weights:50;}
function weightedLowerBound(candidates:Candidate[]){let total=0,weights=0;for(const candidate of candidates){const weight=Math.sqrt(candidate.sampleSize)*(1+candidate.context.length/16);total+=candidate.lowerBound*weight;weights+=weight;}return weights?total/weights:0;}
function wilsonLowerBound(wins:number,total:number){if(!total)return 0;const z=1.6448536269514722;const p=wins/total;const denominator=1+z*z/total;const centre=p+z*z/(2*total);const margin=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total));return Math.max(0,(centre-margin)/denominator*100);}
function recentContextStats(history:string,context:string,window:number){const sample=history.slice(-window);let wins=0,losses=0;for(let index=0;index+context.length<sample.length;index++){if(sample.slice(index,index+context.length)!==context)continue;if(sample[index+context.length]==='W')wins++;else losses++;}const sampleSize=wins+losses;return{wins,losses,sampleSize,winProbability:sampleSize?(wins+1)/(sampleSize+2)*100:50};}
function estimateLossRunRisk(runtime:SequenceAiRuntime,initialHistory:string,minWindow:number,maxWindow:number,minOccurrences:number,depth:number,v2:boolean){let history=initialHistory;let probability=1;for(let step=0;step<depth;step++){const candidates=sequenceCandidates(runtime,history,minWindow,maxWindow,minOccurrences);const winProbability=candidates.length?(v2?weightedProbability(candidates):candidates.reduce((total,item)=>total+item.winProbability,0)/candidates.length):50;probability*=1-winProbability/100;history=`${history}L`.slice(-MAX_RECENT_HISTORY);}return probability*100;}
function calculateRiskBlocks(config:SequenceAiConfig,currentLossStreak:number,agreement:number,cycleRisk:number,riskDepth:number){const maxLoss=Math.max(0,Math.min(MAX_MODEL_WINDOW,config.maxCurrentLossStreak??3));const minAgreement=Math.max(0,Math.min(100,config.minContextAgreement??60));const configured=Math.max(0,Math.min(100,config.maxFullCycleLossRisk??0));const maxCycleRisk=configured||80*0.5**riskDepth;const streak=currentLossStreak>maxLoss&&maxLoss>0;const consensus=agreement<minAgreement;const cycle=cycleRisk>maxCycleRisk;return{blocked:streak||consensus||cycle,streak,consensus,cycle,maxLoss,minAgreement,maxCycleRisk};}
function riskReason(structure:string,risk:ReturnType<typeof calculateRiskBlocks>,losses:number,agreement:number,contexts:number,cycleRisk:number,depth:number){return risk.streak?`${structure}: entrada bloqueada pelo risco de cauda (${losses} L consecutivos; máximo ${risk.maxLoss}).`:risk.consensus?`${structure}: entrada bloqueada por falta de consenso (${agreement.toFixed(1)}% em ${contexts} janelas; mínimo ${risk.minAgreement.toFixed(1)}%).`:risk.cycle?`${structure}: risco de ${depth} LOSS consecutivos em ${cycleRisk.toFixed(2)}%, acima do limite de ${risk.maxCycleRisk.toFixed(2)}%.`:null;}
function emptyPrediction(runtime:SequenceAiRuntime,config:SequenceAiConfig,maxWindow:number,riskDepth:number,periodicPattern:string|null,currentLossStreak:number,version:'V1'|'V2'):SequenceAiPrediction{return{engineVersion:version,expected:null,shouldEnter:false,winProbability:0,confidence:0,sampleSize:0,context:runtime.history.slice(-maxWindow),contextLength:0,periodicPattern,currentLossStreak,contextAgreement:0,agreeingContexts:0,evaluatedContexts:0,fullCycleLossRisk:0,riskDepth:normalizeRiskDepth(riskDepth),riskBlocked:false,reason:`Aguardando pelo menos ${config.minOccurrences} ocorrências de um contexto conhecido.`};}
function clampWindow(value:number){return Math.max(1,Math.min(MAX_MODEL_WINDOW,Math.round(value)));}
function normalizeRiskDepth(value:number){return Math.max(1,Math.min(51,Math.round(value)));}
function lossStreak(history:string){return history.match(/L+$/)?.[0].length??0;}
function detectPeriodicPattern(history:string,maxWindow:number):string|null{const sample=history.slice(-maxWindow);for(let period=1;period<=Math.min(6,Math.floor(sample.length/2));period++){let matchedLength=period;for(let index=sample.length-period-1;index>=0;index--){if(sample[index]!==sample[index+period])break;matchedLength++;}if(matchedLength>=Math.max(4,period*2)){const start=sample.length-matchedLength;return sample.slice(start,start+period);}}return null;}
function detectStructuralPattern(history:string,maxWindow:number):string|null{const sample=history.slice(-maxWindow);for(let size=Math.min(8,Math.floor(sample.length/2));size>=2;size--){const left=sample.slice(-size*2,-size);const right=sample.slice(-size);if(left===right)return`Repetição ${left}`;if([...left].every((symbol,index)=>symbol!==right[index]))return`Espelho binário ${left}→${right}`;}return null;}
