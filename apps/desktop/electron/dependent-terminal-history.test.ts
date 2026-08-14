import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSignal, NormalizedRound } from '@aviator/shared';
import { AppDatabase } from './database.js';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});

describe('Histórico de Terminal dependente',()=>{
  it('mostra somente a BASE armada e apostas próprias, sem copiar toda a sequência da fonte',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'aviator-dependent-history-'));directories.push(directory);
    process.env.AVIATOR_MASTER_EMAIL='dependent-history@local.test';process.env.AVIATOR_MASTER_PASSWORD='dependent-history-password';
    const database=new AppDatabase(path.join(directory,'app.db'));
    const source=database.listTerminals()[0];
    const now=new Date().toISOString();
    const dependent={...source,id:randomUUID(),name:'Cópia operacional',strategySourceTerminalId:source.id,gameWins:0,gameLosses:0,createdAt:now,updatedAt:now};
    database.insertTerminal(dependent);

    const rounds=[round(source.platformId,1.20),round(source.platformId,1.30),round(source.platformId,1.80)];
    rounds.forEach(item=>database.insertRound(item));
    const signals=rounds.map((item,index):GameSignal=>({id:randomUUID(),terminalId:dependent.id,platformId:dependent.platformId,strategyId:dependent.gameStrategyId,triggerRoundId:item.id,resultRoundId:item.id,result:'LOSS',metadata:{multiplier:item.multiplier},createdAt:new Date(Date.now()+index).toISOString()}));
    signals.forEach(signal=>database.saveGameSignal(signal));
    database.saveBetDecision({id:randomUUID(),terminalId:dependent.id,platformId:dependent.platformId,betStrategyId:dependent.betStrategyId,gameSignalId:signals[0].id,ruleId:'trigger-l',action:'ENTER',metadata:{},createdAt:signals[0].createdAt});
    database.saveBetDecision({id:randomUUID(),terminalId:dependent.id,platformId:dependent.platformId,betStrategyId:dependent.betStrategyId,gameSignalId:signals[1].id,ruleId:null,action:'IGNORE',metadata:{},createdAt:signals[1].createdAt});
    const cycleId=randomUUID();
    database.saveBetStageEvent({id:randomUUID(),cycleId,terminalId:dependent.id,gameSignalId:signals[2].id,stageIndex:0,stageLabel:'BASE',result:'WIN',createdAt:signals[2].createdAt});
    database.saveBetExecution({id:randomUUID(),cycleId,terminalId:dependent.id,gameSignalId:signals[2].id,stageIndex:0,stageLabel:'BASE',multiplier:1.8,stakeCents:100,returnedCents:180,profitLossCents:80,bankrollBeforeCents:10_000,bankrollAfterCents:10_080,result:'WIN',createdAt:signals[2].createdAt});

    const tieRound=round(source.platformId,2);database.insertRound(tieRound);
    const tieSignal:GameSignal={id:randomUUID(),terminalId:dependent.id,platformId:dependent.platformId,strategyId:dependent.gameStrategyId,triggerRoundId:tieRound.id,resultRoundId:tieRound.id,result:'WIN',metadata:{multiplier:2},createdAt:new Date(Date.now()+4).toISOString()};
    database.saveGameSignal(tieSignal);
    database.saveBetStageEvent({id:randomUUID(),cycleId:randomUUID(),terminalId:dependent.id,gameSignalId:tieSignal.id,stageIndex:1,stageLabel:'GALE 1',result:'TIE',createdAt:tieSignal.createdAt});
    database.saveBetExecution({id:randomUUID(),cycleId:randomUUID(),terminalId:dependent.id,gameSignalId:tieSignal.id,stageIndex:1,stageLabel:'GALE 1',multiplier:2,stakeCents:200,returnedCents:200,profitLossCents:0,bankrollBeforeCents:10_080,bankrollAfterCents:10_080,result:'TIE',createdAt:tieSignal.createdAt});

    const history=database.getTerminalHistory(dependent.id,200);
    expect(history).toHaveLength(3);
    expect(history.map(item=>({result:item.gameResult,decision:item.decisionAction,bet:item.execution?.result??null}))).toEqual([
      {result:'LOSS',decision:'ENTER',bet:null},
      {result:'WIN',decision:null,bet:'WIN'},
      {result:'TIE',decision:null,bet:'TIE'}
    ]);
    expect(database.getTerminal(dependent.id)).toMatchObject({gameWins:1,gameLosses:0});
    database.close();
  });
});

function round(platformId:string,multiplier:number):NormalizedRound{return{id:randomUUID(),platformId,externalId:randomUUID(),multiplier,occurredAt:new Date().toISOString(),collectedAt:new Date().toISOString(),source:'TIPMINER',deliveryMode:'LIVE',dedupKey:randomUUID()};}
