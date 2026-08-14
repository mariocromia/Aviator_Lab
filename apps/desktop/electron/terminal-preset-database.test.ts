import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from './database.js';

const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});

describe('Terminal presets',()=>{
  it('restores private configuration copies after the originals are modified and deleted',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'aviator-terminal-preset-'));directories.push(directory);
    process.env.AVIATOR_MASTER_EMAIL='preset-test@local.test';process.env.AVIATOR_MASTER_PASSWORD='preset-test-password';
    const database=new AppDatabase(path.join(directory,'app.db'));
    expect(database.bootstrap().terminalHistoryDisplayMax).toBe(200);
    const terminal=database.listTerminals()[0];
    terminal.historyDisplayLimit=100;terminal.operationCombinations=[{id:'llw',name:'LLW até LOSS',priority:10,enabled:true,triggerType:'PATTERN',pattern:'LLW',betStrategyId:terminal.betStrategyWinId,lossReentryType:'PATTERN',lossReentryPattern:'W',lossReentryBetStrategyId:null,betPlanId:terminal.betPlanWinId,behavior:'REPEAT_UNTIL_LOSS'}];database.updateTerminal(terminal);
    const originalGame=database.listConfigurationDocuments('GAME_STRATEGY').find(item=>item.id===terminal.gameStrategyId)!;
    const preset=database.saveTerminalPreset(terminal.id,'Snapshot protegido');
    database.saveConfiguration({id:originalGame.id,kind:'GAME_STRATEGY',name:'Alterada',sortOrder:originalGame.sortOrder,config:{trigger:[{operator:'GT',value:50}],win:[{operator:'GTE',value:90}],loss:[{operator:'LT',value:90}],afterLoss:[],release:[{operator:'GTE',value:90}]}});
    for(const existing of database.listTerminals())database.deleteTerminal(existing.id);
    database.deleteConfiguration(originalGame.id,'GAME_STRATEGY');
    const restored=database.restoreTerminalPresetConfigurations(preset.id);
    const copiedGame=database.listConfigurationDocuments('GAME_STRATEGY').find(item=>item.id===restored.draft.gameStrategyId)!;
    expect(copiedGame.id).not.toBe(originalGame.id);
    expect(copiedGame.config).toEqual(originalGame.config);
    expect(restored.draft.strategySourceTerminalId).toBeNull();
    expect(restored.draft.paused).toBe(true);
    expect(restored.draft.historyDisplayLimit).toBe(100);
    expect(restored.draft.operationCombinations).toHaveLength(1);
    expect(restored.draft.operationCombinations?.[0]).toMatchObject({id:'llw',name:'LLW até LOSS',behavior:'REPEAT_UNTIL_LOSS'});
    expect(restored.draft.operationCombinations?.[0].betStrategyId).not.toBe(terminal.betStrategyWinId);
    expect(restored.draft.operationCombinations?.[0].betPlanId).not.toBe(terminal.betPlanWinId);
    database.close();
  });
});
