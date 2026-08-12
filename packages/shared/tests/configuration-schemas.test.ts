import { describe, expect, it } from 'vitest';
import { saveConfigurationSchema } from '../src/index.js';
describe('configuration schemas',()=>{
  it('accepts a versionable game strategy',()=>{const result=saveConfigurationSchema.safeParse({id:null,kind:'GAME_STRATEGY',name:'Estratégia',config:{trigger:[{operator:'GT',value:1.35}],win:[{operator:'GTE',value:2}],loss:[{operator:'BETWEEN',value:[0.01,1.99]}],afterLoss:[],release:[{operator:'GTE',value:2}]}});expect(result.success).toBe(true);});
  it('rejects bet plans without legs',()=>{const result=saveConfigurationSchema.safeParse({id:null,kind:'BET_PLAN',name:'Plano',config:{stages:[{index:0,label:'BASE',legs:[]}]}});expect(result.success).toBe(false);});
});
