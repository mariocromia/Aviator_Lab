import { z } from 'zod';

export const loginInputSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128)
});

export const terminalModeSchema = z.enum(['SIMULATION', 'ASSISTED']);
const sequenceAiConfigSchema=z.object({engineVersion:z.enum(['V1','V2']).default('V1'),minWindow:z.number().int().min(1).max(16).default(2),maxWindow:z.number().int().min(2).max(16).default(12),minOccurrences:z.number().int().min(2).max(100_000).default(20),minConfidence:z.number().min(50).max(99.9).default(60),maxCurrentLossStreak:z.number().int().min(0).max(16).default(3),minContextAgreement:z.number().min(0).max(100).default(60),maxFullCycleLossRisk:z.number().min(0).max(100).default(0),minProbabilityLowerBound:z.number().min(0).max(99.9).default(50),recentWindow:z.number().int().min(50).max(5_000).default(500),minRecentOccurrences:z.number().int().min(0).max(10_000).default(8),maxRecentDivergence:z.number().min(0).max(100).default(12)}).refine(value=>value.minWindow<=value.maxWindow,{message:'A janela mínima deve ser menor ou igual à janela máxima.'});
const terminalOperationCombinationSchema=z.object({id:z.string().min(1).max(100),name:z.string().trim().min(2).max(100),priority:z.number().int().min(0).max(999_999),enabled:z.boolean(),triggerType:z.enum(['PATTERN','BET_STRATEGY','SEQUENCE_AI']).default('BET_STRATEGY'),pattern:z.string().trim().toUpperCase().regex(/^[WL]+$/,'Use somente W e L na sequência.').max(100).nullable().default(null),sequenceAiConfig:sequenceAiConfigSchema.nullable().default(null),betStrategyId:z.string().uuid(),lossReentryType:z.enum(['IMMEDIATE','PATTERN','BET_STRATEGY']).default('BET_STRATEGY'),lossReentryPattern:z.string().trim().toUpperCase().regex(/^[WL]+$/,'Use somente W e L na sequência.').max(100).nullable().default(null),lossReentryBetStrategyId:z.string().uuid().nullable().default(null),betPlanId:z.string().uuid(),behavior:z.enum(['RUN_ONCE','REPEAT_UNTIL_LOSS'])}).superRefine((value,context)=>{if(value.triggerType==='PATTERN'&&!value.pattern)context.addIssue({code:'custom',path:['pattern'],message:'Digite a sequência W/L desta combinação.'});if(value.triggerType==='SEQUENCE_AI'&&!value.sequenceAiConfig)context.addIssue({code:'custom',path:['sequenceAiConfig'],message:'Configure a inteligência sequencial.'});if(value.lossReentryType==='PATTERN'&&!value.lossReentryPattern)context.addIssue({code:'custom',path:['lossReentryPattern'],message:'Digite a sequência W/L para reentrada após LOSS.'});});

export const createTerminalInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(999_999).default(0),
  platformId: z.string().uuid(),
  gameStrategyId: z.string().uuid(),
  strategySourceTerminalId:z.string().uuid().nullable().default(null),
  strategySourceMode:z.enum(['GAME_SIGNALS','BET_EXECUTIONS']).default('GAME_SIGNALS'),
  betStrategyId: z.string().uuid(),
  betStrategyWinId: z.string().uuid().optional(),
  betStrategyLossId: z.string().uuid().optional(),
  betPlanId: z.string().uuid(),
  betPlanWinId: z.string().uuid().optional(),
  betPlanLossId: z.string().uuid().optional(),
  controlPlayRuleIds:z.array(z.string().uuid()).max(100).default([]),controlPauseRuleIds:z.array(z.string().uuid()).max(100).default([]),
  mode: terminalModeSchema.default('SIMULATION'),
  historyDisplayLimit: z.number().int().min(10).max(5_000).default(5_000),
  analysisRoundLimit: z.number().int().min(200).max(300_000).default(5_000),
  bankrollStartAt:z.string().datetime().nullable().default(null),
  entryBlockPatterns:z.array(z.string().trim().toUpperCase().regex(/^[WL]+$/,'Use somente W e L na sequência bloqueada.').max(100)).max(100).default([]),
  operationCombinations:z.array(terminalOperationCombinationSchema).max(100).default([]),
  initialBankrollCents: z.number().int().nonnegative().max(1_000_000_000)
});

export const terminalIdSchema = z.string().uuid();
export const saveTerminalPresetSchema=z.object({terminalId:z.string().uuid(),name:z.string().trim().min(2).max(100)});
export const terminalPresetIdSchema=z.string().uuid();
export const resetTerminalInputSchema=z.object({id:z.string().uuid(),mode:z.enum(['FINANCIAL','FULL'])});
export const updateTerminalBankrollInputSchema=z.object({id:z.string().uuid(),initialBankrollCents:z.number().int().nonnegative().max(1_000_000_000)});
export const setTerminalBankrollAnchorInputSchema=z.object({id:z.string().uuid(),initialBankrollCents:z.number().int().nonnegative().max(1_000_000_000),bankrollStartAt:z.string().datetime()});

export const updateTerminalInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(999_999).default(0),
  platformId: z.string().uuid(),
  gameStrategyId: z.string().uuid(),
  strategySourceTerminalId:z.string().uuid().nullable().default(null),
  strategySourceMode:z.enum(['GAME_SIGNALS','BET_EXECUTIONS']).default('GAME_SIGNALS'),
  betStrategyId: z.string().uuid(),
  betStrategyWinId: z.string().uuid().optional(),
  betStrategyLossId: z.string().uuid().optional(),
  betPlanId: z.string().uuid(),
  betPlanWinId: z.string().uuid().optional(),
  betPlanLossId: z.string().uuid().optional(),
  controlPlayRuleIds:z.array(z.string().uuid()).max(100).default([]),controlPauseRuleIds:z.array(z.string().uuid()).max(100).default([]),
  mode: terminalModeSchema,
  historyDisplayLimit: z.number().int().min(10).max(5_000).default(5_000),
  analysisRoundLimit: z.number().int().min(200).max(300_000).default(5_000),
  bankrollStartAt:z.string().datetime().nullable().default(null),
  entryBlockPatterns:z.array(z.string().trim().toUpperCase().regex(/^[WL]+$/,'Use somente W e L na sequência bloqueada.').max(100)).max(100).default([]),
  operationCombinations:z.array(terminalOperationCombinationSchema).max(100).default([])
});

export const createPlatformInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80),
  game: z.string().trim().min(2).max(40),
  tipMinerRoundUuid: z.string().uuid(),
  pollIntervalMs: z.number().int().min(500).max(60_000),
  requestTimeoutMs: z.number().int().min(250).max(30_000),
  historyLimit: z.number().int().min(10).max(2_000)
});
export const updatePlatformInputSchema = createPlatformInputSchema.extend({ id: z.string().uuid() });
export const setPlatformEnabledInputSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() });

export const testPlatformInputSchema = z.object({
  tipMinerRoundUuid: z.string().uuid(),
  requestTimeoutMs: z.number().int().min(250).max(30_000).default(5_000),
  historyLimit: z.number().int().min(1).max(20).default(5)
});

const screenPositionSchema = z.object({ x: z.number().int().min(0).max(20_000), y: z.number().int().min(0).max(20_000) });
const screenBetSlotSchema = z.object({
  enabled: z.boolean(), amountCents: z.number().int().nonnegative().max(100_000_000), cashout: z.number().positive().max(10_000),
  amount: screenPositionSchema, cashoutField: screenPositionSchema, action: screenPositionSchema
});
export const saveScreenProfileInputSchema = z.object({
  terminalId: z.string().uuid(), name: z.string().trim().min(2).max(80),
  resolutionWidth: z.number().int().min(640).max(20_000), resolutionHeight: z.number().int().min(480).max(20_000),
  windowTitle: z.string().trim().max(200).nullable(), monitorIndex: z.number().int().min(0).max(32).nullable().optional(), calibratedAt: z.string().datetime().nullable().optional(), bet1: screenBetSlotSchema, bet2: screenBetSlotSchema,
  inactivityBet: z.object({ enabled: z.boolean(), minutes: z.number().int().min(1).max(1_440), slot: z.literal(2), amountCents: z.number().int().positive().max(100_000_000), cashout: z.number().gt(1).max(10_000) }).optional()
});

export const screenProfileActionSchema = z.object({ terminalId: z.string().uuid() });
export const screenCoordinateTestSchema = screenProfileActionSchema.extend({ coordinateKey: z.enum(['bet1.amount', 'bet1.cashout', 'bet1.action', 'bet2.amount', 'bet2.cashout', 'bet2.action']) });

const terminalScheduleWindowSchema=z.object({id:z.string().min(1),days:z.array(z.number().int().min(0).max(6)).min(1),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)});
export const saveTerminalScheduleInputSchema=z.object({terminalId:z.string().uuid(),mode:z.enum(['ALWAYS','ALLOW_WINDOWS','BLOCK_WINDOWS']),timezone:z.string().min(1).max(80).default('America/Sao_Paulo'),windows:z.array(terminalScheduleWindowSchema).max(50)}).superRefine((value,context)=>{if(value.mode!=='ALWAYS'&&value.windows.length===0)context.addIssue({code:'custom',path:['windows'],message:'Adicione pelo menos um intervalo.'});});
export const setTerminalSchedulePlanInputSchema=z.object({terminalId:z.string().uuid(),schedulePlanId:z.string().uuid().nullable()});
const terminalControlMetricSchema=z.enum(['currentWinStreak','currentLossStreak','lastClosedWinStreak','lastClosedLossStreak','lastCycleWinCount','lastCycleLossCount','winRate','bankroll']);
const terminalControlOperatorSchema=z.enum(['GT','GTE','LT','LTE','EQ']);
export const saveTerminalControlRuleInputSchema=z.object({id:z.string().uuid().nullable(),name:z.string().trim().min(2).max(100),sortOrder:z.number().int().min(0).max(999_999).default(0),enabled:z.boolean(),metric:terminalControlMetricSchema,operator:terminalControlOperatorSchema,value:z.number().finite(),referenceMetric:terminalControlMetricSchema.nullable().default(null),action:z.enum(['PAUSE','PLAY'])});
export const terminalControlRuleIdSchema=z.string().uuid();
export const recoverySnapshotIdSchema=z.string().uuid();

export const backtestRequestSchema = z.object({
  platformId: z.string().uuid(), gameStrategyId: z.string().uuid(), betStrategyWinId: z.string().uuid(), betStrategyLossId: z.string().uuid(), betPlanWinId: z.string().uuid(), betPlanLossId: z.string().uuid(),
  initialBankrollCents: z.number().int().positive().max(1_000_000_000), limit: z.number().int().min(10).max(300_000)
});

export const auditQuerySchema = z.object({ limit: z.number().int().min(1).max(2_000).default(200), category: z.string().max(40).nullable().default(null) });
export const recentRoundsQuerySchema=z.object({platformId:z.string().uuid().nullable().default(null),limit:z.union([z.literal(50),z.literal(100),z.literal(250),z.literal(500)]).default(50)});
export const terminalHistoryQuerySchema=z.object({terminalId:z.string().uuid(),limit:z.number().int().min(1).max(10_000).default(5_000)});
export const aiSettingsInputSchema=z.object({apiKey:z.string().trim().min(10).max(500).nullable(),model:z.string().trim().min(3).max(200),transcriptionModel:z.string().trim().min(3).max(200),clearApiKey:z.boolean().default(false)});
export const aiChatRequestSchema=z.object({platformId:z.string().uuid().nullable(),terminalId:z.string().uuid().nullable(),historyLimit:z.union([z.literal(50),z.literal(100),z.literal(250),z.literal(500),z.literal(1_000),z.literal(2_500),z.literal(5_000),z.literal(10_000)]),messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().trim().min(1).max(8_000)})).max(20),prompt:z.string().trim().min(1).max(8_000).nullable(),audio:z.object({data:z.string().min(10).max(15_000_000),format:z.enum(['webm','wav','mp3','ogg','m4a'])}).nullable()}).superRefine((value,context)=>{if(!value.platformId&&!value.terminalId)context.addIssue({code:'custom',message:'Selecione uma plataforma ou Terminal.'});if(!value.prompt&&!value.audio)context.addIssue({code:'custom',message:'Informe uma mensagem de texto ou áudio.'});});

const platformArchiveSchema = createPlatformInputSchema.extend({ id: z.string().uuid(), enabled: z.boolean(), sourceType: z.literal('TIPMINER'), collectorStatus: z.enum(['ONLINE','OFFLINE','DEGRADED']), createdAt: z.string(), updatedAt: z.string() });
const terminalArchiveSchema = z.object({ id:z.string().uuid(),name:z.string(),sortOrder:z.number().int().default(0),platformId:z.string().uuid(),gameStrategyId:z.string(),strategySourceTerminalId:z.string().nullable().default(null),strategySourceMode:z.enum(['GAME_SIGNALS','BET_EXECUTIONS']).default('GAME_SIGNALS'),betStrategyId:z.string(),betStrategyWinId:z.string().optional(),betStrategyLossId:z.string().optional(),betPlanId:z.string(),betPlanWinId:z.string().optional(),betPlanLossId:z.string().optional(),controlPlayRuleIds:z.array(z.string()).default([]),controlPauseRuleIds:z.array(z.string()).default([]),screenProfileId:z.string().nullable(),mode:terminalModeSchema,enabled:z.boolean(),paused:z.boolean(),historyDisplayLimit:z.number().int().min(10).max(5_000).default(5_000),analysisRoundLimit:z.number().int().min(200).max(300_000).default(5_000),bankrollStartAt:z.string().datetime().nullable().default(null),entryBlockPatterns:z.array(z.string().trim().toUpperCase().regex(/^[WL]+$/).max(100)).max(100).default([]),operationCombinations:z.array(terminalOperationCombinationSchema).default([]),initialBankrollCents:z.number().int(),currentBankrollCents:z.number().int(),gameWins:z.number().int(),gameLosses:z.number().int(),createdAt:z.string(),updatedAt:z.string() }).transform(value=>({...value,betStrategyWinId:value.betStrategyWinId??value.betStrategyId,betStrategyLossId:value.betStrategyLossId??value.betStrategyId,betPlanWinId:value.betPlanWinId??value.betPlanId,betPlanLossId:value.betPlanLossId??value.betPlanId}));
const profileArchiveSchema = saveScreenProfileInputSchema.extend({ id:z.string(),updatedAt:z.string() });
const namedConfigurationSchema = z.object({id:z.string(),name:z.string(),sortOrder:z.number().int().default(0),config:z.unknown()});
export const workspaceArchiveSchema = z.object({ format:z.literal('AVIATOR_STRATEGY_LAB'),version:z.union([z.literal(1),z.literal(2)]),exportedAt:z.string(),platforms:z.array(platformArchiveSchema),terminals:z.array(terminalArchiveSchema),screenProfiles:z.array(profileArchiveSchema),gameStrategies:z.array(namedConfigurationSchema),betStrategies:z.array(namedConfigurationSchema),betPlans:z.array(namedConfigurationSchema),schedulePlans:z.array(namedConfigurationSchema).optional(),terminalSchedules:z.array(z.object({terminalId:z.string(),schedulePlanId:z.string(),mode:z.enum(['ALWAYS','ALLOW_WINDOWS','BLOCK_WINDOWS']),timezone:z.string(),windows:z.array(terminalScheduleWindowSchema),updatedAt:z.string()})).optional(),terminalControlRules:z.array(z.object({id:z.string(),name:z.string(),sortOrder:z.number().int().default(0),enabled:z.boolean(),metric:terminalControlMetricSchema,operator:terminalControlOperatorSchema,value:z.number(),referenceMetric:terminalControlMetricSchema.nullable().optional().default(null),action:z.enum(['PAUSE','PLAY','RESUME']).transform(value=>value==='RESUME'?'PLAY' as const:value),createdAt:z.string(),updatedAt:z.string()})).optional() });

const multiplierConditionSchema = z.object({ operator:z.enum(['GT','GTE','LT','LTE','EQ','BETWEEN']), value:z.union([z.number().positive(),z.tuple([z.number().nonnegative(),z.number().positive()])]) }).superRefine((value,context)=>{if(value.operator==='BETWEEN'&&!Array.isArray(value.value))context.addIssue({code:'custom',message:'BETWEEN exige dois valores.'});if(value.operator!=='BETWEEN'&&Array.isArray(value.value))context.addIssue({code:'custom',message:`${value.operator} exige um valor.`});});
export const gameStrategyConfigSchema = z.object({trigger:z.array(multiplierConditionSchema).min(1),win:z.array(multiplierConditionSchema).min(1),loss:z.array(multiplierConditionSchema).min(1),afterLoss:z.array(multiplierConditionSchema),release:z.array(multiplierConditionSchema).min(1),releaseConsecutiveCount:z.number().int().min(1).max(100).optional()});
const betConditionSchema=z.object({field:z.enum(['currentWinStreak','currentLossStreak','lastClosedWinStreak','lastClosedLossStreak','maxWinStreak','maxLossStreak','winCount','lossCount','winRate','recentPattern','lastResult','bankroll']),operator:z.enum(['GT','GTE','LT','LTE','EQ','BETWEEN','MATCHES']),value:z.union([z.number(),z.string(),z.tuple([z.number(),z.number()])]).optional(),referenceField:z.enum(['currentWinStreak','currentLossStreak','lastClosedWinStreak','lastClosedLossStreak','maxWinStreak','maxLossStreak','winCount','lossCount','winRate','recentPattern','lastResult','bankroll']).optional()});
export const betStrategyConfigSchema=z.object({rules:z.array(z.object({id:z.string().min(1),name:z.string().min(1),enabled:z.boolean(),priority:z.number().int(),conditions:z.array(betConditionSchema).min(1),action:z.enum(['ENTER','IGNORE','PAUSE']),betPlanId:z.string().nullable().optional(),onWinBetPlanId:z.string().nullable().optional(),onWinPlanBehavior:z.enum(['RUN_ONCE','REPEAT_UNTIL_LOSS']).optional()})).min(1)});
const amountStrategySchema=z.object({type:z.enum(['FIXED','BANKROLL_PERCENTAGE','PREVIOUS_AMOUNT_MULTIPLIER','CURRENT_LOSS_STREAK','LAST_LOSS_STREAK','MANUAL_TABLE','RECOVERY_TARGET','FORMULA']),fixedCents:z.number().int().positive().optional(),percentage:z.number().positive().max(100).optional(),multiplier:z.number().positive().max(1000).optional(),baseCents:z.number().int().positive().optional(),tableCents:z.array(z.number().int().positive()).max(100).optional(),recoveryTargetCents:z.number().int().nonnegative().optional(),formula:z.string().max(200).optional(),minCents:z.number().int().positive().optional(),maxCents:z.number().int().positive().optional()});
const executionSchema=z.object({policy:z.enum(['NEXT_VALID_SIGNAL','AFTER_N_SIGNALS','AFTER_PATTERN','AFTER_CONDITION','AFTER_ENTRY_CONFIRMATION']),signalCount:z.number().int().positive().max(1000).optional(),pattern:z.string().regex(/^[WL]+$/i).max(100).optional(),condition:betConditionSchema.optional()});
const bankrollLimitsSchema=z.object({stopWinCents:z.number().int().positive().optional(),stopLossCents:z.number().int().positive().optional(),maxDrawdownCents:z.number().int().positive().optional(),maxExposureCents:z.number().int().positive().optional(),maxBetPercentage:z.number().positive().max(100).optional()});
export const betPlanConfigSchema=z.object({stages:z.array(z.object({index:z.number().int().nonnegative(),label:z.string().min(1),execution:executionSchema.optional(),legs:z.array(z.object({slot:z.number().int().min(1).max(10),amountCents:z.number().int().positive(),cashout:z.number().gt(1),amountStrategy:amountStrategySchema.optional()})).min(1)})).min(1).max(51),bankrollLimits:bankrollLimitsSchema.optional(),continueOnTie:z.boolean().default(true),cycleProgression:z.object({attemptsPerStep:z.number().int().min(1).max(100),increasePercentage:z.number().positive().max(1000),maxAttempts:z.number().int().min(1).max(1000)}).optional()});
export const schedulePlanConfigSchema=z.object({mode:z.enum(['ALWAYS','ALLOW_WINDOWS','BLOCK_WINDOWS']),timezone:z.string().min(1).max(80),windows:z.array(terminalScheduleWindowSchema).max(50)}).superRefine((value,context)=>{if(value.mode!=='ALWAYS'&&value.windows.length===0)context.addIssue({code:'custom',path:['windows'],message:'Adicione pelo menos um intervalo.'});});
export const saveConfigurationSchema=z.object({id:z.string().uuid().nullable(),kind:z.enum(['GAME_STRATEGY','BET_STRATEGY','BET_PLAN','SCHEDULE_PLAN']),name:z.string().trim().min(2).max(100),sortOrder:z.number().int().min(0).max(999_999).default(0),config:z.unknown()}).superRefine((value,context)=>{const schema=value.kind==='GAME_STRATEGY'?gameStrategyConfigSchema:value.kind==='BET_STRATEGY'?betStrategyConfigSchema:value.kind==='BET_PLAN'?betPlanConfigSchema:schedulePlanConfigSchema;const parsed=schema.safeParse(value.config);if(!parsed.success)for(const issue of parsed.error.issues)context.addIssue({code:'custom',path:['config',...issue.path],message:issue.message});});
export const configurationActionSchema=z.object({id:z.string().uuid(),kind:z.enum(['GAME_STRATEGY','BET_STRATEGY','BET_PLAN','SCHEDULE_PLAN'])});
