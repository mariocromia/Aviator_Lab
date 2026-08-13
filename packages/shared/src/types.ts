export type Role = 'MASTER';
export type TerminalMode = 'SIMULATION' | 'ASSISTED';
export type TerminalStatus = 'RUNNING' | 'PAUSED' | 'STOPPED';
export type DeliveryMode = 'LIVE' | 'BACKLOG';
export type GameStrategyState = 'SEARCH_TRIGGER' | 'WAIT_RESULT' | 'WAIT_RELEASE';
export type ConditionOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'BETWEEN';
export type RoundAnnotationRole = 'NORMAL' | 'TRIGGER' | 'WIN' | 'LOSS' | 'IGNORED' | 'RELEASE_TRIGGER';
export type GameSignalResult = 'WIN' | 'LOSS';
export type BetAction = 'ENTER' | 'IGNORE' | 'PAUSE';
export type BetConditionOperator = ConditionOperator | 'MATCHES';

export interface MultiplierCondition {
  operator: ConditionOperator;
  value: number | [number, number];
}

export interface GameStrategyConfig {
  trigger: MultiplierCondition[];
  win: MultiplierCondition[];
  loss: MultiplierCondition[];
  afterLoss: MultiplierCondition[];
  release: MultiplierCondition[];
  releaseConsecutiveCount?: number;
}

export interface RoundAnnotation {
  id: string;
  terminalId: string;
  roundId: string;
  strategyId: string;
  role: RoundAnnotationRole;
  stateBefore: GameStrategyState;
  stateAfter: GameStrategyState;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GameSignal {
  id: string;
  terminalId: string;
  platformId: string;
  strategyId: string;
  triggerRoundId: string;
  resultRoundId: string;
  result: GameSignalResult;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface ResultAnalyzerState {
  currentWinStreak: number;
  currentLossStreak: number;
  lastClosedWinStreak: number;
  lastClosedLossStreak: number;
  maxWinStreak: number;
  maxLossStreak: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  recentPattern: string;
  lastResult: GameSignalResult | null;
}

export interface BetCondition {
  field: keyof ResultAnalyzerState | 'bankroll';
  operator: BetConditionOperator;
  value?: number | string | [number, number];
  referenceField?: keyof ResultAnalyzerState | 'bankroll';
}

export interface BetRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: BetCondition[];
  action: BetAction;
  betPlanId?: string | null;
  onWinBetPlanId?: string | null;
  onWinPlanBehavior?: 'RUN_ONCE' | 'REPEAT_UNTIL_LOSS';
}

export interface BetStrategyConfig { rules: BetRule[]; }

export interface BetDecision {
  id: string;
  terminalId: string;
  platformId: string;
  betStrategyId: string;
  gameSignalId: string;
  ruleId: string | null;
  action: BetAction;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface BetStageEvent {
  id: string;
  cycleId: string;
  terminalId: string;
  gameSignalId: string;
  stageIndex: number;
  stageLabel: string;
  result: GameSignalResult;
  createdAt: string;
}

export interface BetExecution {
  id: string;
  cycleId: string;
  terminalId: string;
  gameSignalId: string;
  stageIndex: number;
  stageLabel: string;
  multiplier: number;
  stakeCents: number;
  returnedCents: number;
  profitLossCents: number;
  bankrollBeforeCents: number;
  bankrollAfterCents: number;
  result: GameSignalResult;
  createdAt: string;
}

export interface TerminalHistoryItem {
  signalId: string;
  terminalId: string;
  createdAt: string;
  gameResult: GameSignalResult;
  multiplier: number | null;
  decisionAction: BetAction | null;
  stage: BetStageEvent | null;
  execution: BetExecution | null;
}

export interface ScreenPosition { x: number; y: number; }
export interface ScreenBetSlot {
  enabled: boolean;
  amountCents: number;
  cashout: number;
  amount: ScreenPosition;
  cashoutField: ScreenPosition;
  action: ScreenPosition;
}
export interface ScreenProfile {
  id: string;
  terminalId: string;
  name: string;
  resolutionWidth: number;
  resolutionHeight: number;
  windowTitle: string | null;
  monitorIndex?: number | null;
  calibratedAt?: string | null;
  bet1: ScreenBetSlot;
  bet2: ScreenBetSlot;
  updatedAt: string;
}

export type TerminalScheduleMode = 'ALWAYS' | 'ALLOW_WINDOWS' | 'BLOCK_WINDOWS';
export interface TerminalScheduleWindow { id: string; days: number[]; startTime: string; endTime: string; }
export interface SchedulePlanConfig { mode: TerminalScheduleMode; timezone: string; windows: TerminalScheduleWindow[]; }
export interface TerminalSchedule { terminalId: string; schedulePlanId:string; mode: TerminalScheduleMode; timezone: string; windows: TerminalScheduleWindow[]; updatedAt: string; }

export type TerminalControlMetric='currentWinStreak'|'currentLossStreak'|'lastClosedWinStreak'|'lastClosedLossStreak'|'lastCycleWinCount'|'lastCycleLossCount'|'winRate'|'bankroll';
export interface TerminalControlRule {id:string;name:string;sortOrder:number;enabled:boolean;sourceTerminalId:string;targetTerminalId:string;metric:TerminalControlMetric;operator:'GT'|'GTE'|'LT'|'LTE'|'EQ';value:number;referenceMetric?:TerminalControlMetric|null;action:'PAUSE'|'RESUME';resumeMetric?:TerminalControlMetric|null;resumeOperator?:'GT'|'GTE'|'LT'|'LTE'|'EQ'|null;resumeValue?:number|null;resumeReferenceMetric?:TerminalControlMetric|null;createdAt:string;updatedAt:string;}

export type ScreenCoordinateKey = 'bet1.amount' | 'bet1.cashout' | 'bet1.action' | 'bet2.amount' | 'bet2.cashout' | 'bet2.action';
export interface ScreenProfileValidation {
  valid: boolean;
  issues: string[];
  currentResolution: { width: number; height: number };
}
export interface ScreenMockStep { action: 'FOCUS' | 'MOVE' | 'HIGHLIGHT' | 'TYPE' | 'CLICK_BLOCKED'; coordinateKey: ScreenCoordinateKey | null; x: number | null; y: number | null; value: string | null; }
export interface ScreenMockRun { terminalId: string; profileId: string; safe: true; steps: ScreenMockStep[]; validation: ScreenProfileValidation; createdAt: string; }
export interface ScreenCaptureResult { x: number; y: number; monitorIndex: number; resolutionWidth: number; resolutionHeight: number; }
export type ScreenAutomationAction =
  | { type: 'FOCUS'; windowTitle: string }
  | { type: 'MOVE' | 'CLICK' | 'HIGHLIGHT'; x: number; y: number }
  | { type: 'SELECT_ALL' }
  | { type: 'TYPE_TEXT'; text: string }
  | { type: 'DELAY'; milliseconds: number };
export interface AssistedPreparationResult { terminalId: string; profileId: string; preparedSlots: number; finalClickBlocked: true; startedAt: string; finishedAt: string; }

export type AmountStrategyType = 'FIXED' | 'BANKROLL_PERCENTAGE' | 'PREVIOUS_AMOUNT_MULTIPLIER' | 'CURRENT_LOSS_STREAK' | 'LAST_LOSS_STREAK' | 'MANUAL_TABLE' | 'RECOVERY_TARGET' | 'FORMULA';
export interface AmountStrategyConfig {
  type: AmountStrategyType;
  fixedCents?: number;
  percentage?: number;
  multiplier?: number;
  baseCents?: number;
  tableCents?: number[];
  recoveryTargetCents?: number;
  formula?: string;
  minCents?: number;
  maxCents?: number;
}
export type BetStageExecutionPolicy = 'NEXT_VALID_SIGNAL' | 'AFTER_N_SIGNALS' | 'AFTER_PATTERN' | 'AFTER_CONDITION';
export interface BetStageExecutionConfig {
  policy: BetStageExecutionPolicy;
  signalCount?: number;
  pattern?: string;
  condition?: BetCondition;
}
export interface BankrollLimitsConfig {
  stopWinCents?: number;
  stopLossCents?: number;
  maxDrawdownCents?: number;
  maxExposureCents?: number;
  maxBetPercentage?: number;
}
export interface BetLegConfig { slot: number; amountCents: number; cashout: number; amountStrategy?: AmountStrategyConfig; }
export interface BetPlanStageConfig { index: number; label: string; legs: BetLegConfig[]; execution?: BetStageExecutionConfig; }
export interface BetPlanConfig { stages: BetPlanStageConfig[]; bankrollLimits?: BankrollLimitsConfig; }

export interface AmountCalculationContext {
  bankrollCents: number;
  initialBankrollCents: number;
  previousAmountCents: number;
  currentLossStreak: number;
  lastLossStreak: number;
  accumulatedLossCents: number;
  stageIndex: number;
  cashout: number;
}
export interface BankrollMetrics {
  initialBalanceCents: number;
  currentBalanceCents: number;
  peakBalanceCents: number;
  profitCents: number;
  roi: number;
  drawdownCents: number;
  maxDrawdownCents: number;
  currentExposureCents: number;
  maximumExposureCents: number;
  stopReason: string | null;
}

export interface SimulationTraceItem {
  roundId: string;
  occurredAt: string;
  multiplier: number;
  annotationRole: RoundAnnotationRole;
  strategyState: GameStrategyState;
  gameResult: GameSignalResult | null;
  decisionAction: BetAction | null;
  stageLabel: string | null;
  stageResult: GameSignalResult | null;
  stageProfitLossCents: number;
  bankrollCents: number;
}

export interface BacktestRequest {
  platformId: string;
  gameStrategyId: string;
  betStrategyId: string;
  betPlanId: string;
  initialBankrollCents: number;
  limit: number;
}

export interface BacktestReport {
  totalRounds: number;
  gameSignals: number;
  gameWins: number;
  gameLosses: number;
  betEntries: number;
  ignored: number;
  winDirect: number;
  winG1: number;
  winG2: number;
  winG3: number;
  lossFinal: number;
  initialBankrollCents: number;
  finalBankrollCents: number;
  profitCents: number;
  roi: number;
  maxDrawdownCents: number;
  maximumExposureCents: number;
  winRate: number;
  averageProfitPerEntryCents: number;
  longestWinStreak: number;
  longestLossStreak: number;
  stoppedByLimit: string | null;
  bankrupt: boolean;
}

export interface BacktestRun { report: BacktestReport; trace: SimulationTraceItem[]; }

export interface AuditRecord {
  id: string;
  category: string;
  level: string;
  event: string;
  terminalId: string | null;
  platformId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface NamedConfiguration { id: string; name: string; sortOrder: number; config: unknown; }
export type ConfigurationKind = 'GAME_STRATEGY' | 'BET_STRATEGY' | 'BET_PLAN' | 'SCHEDULE_PLAN';
export interface ConfigurationDocument { id: string; kind: ConfigurationKind; name: string; sortOrder: number; config: unknown; version: number; updatedAt: string | null; }
export interface WorkspaceArchive {
  format: 'AVIATOR_STRATEGY_LAB'; version: 1 | 2; exportedAt: string;
  platforms: Platform[]; terminals: Terminal[]; screenProfiles: ScreenProfile[];
  gameStrategies: NamedConfiguration[]; betStrategies: NamedConfiguration[]; betPlans: NamedConfiguration[];
  schedulePlans?: NamedConfiguration[];
  terminalSchedules?: TerminalSchedule[];
  terminalControlRules?: TerminalControlRule[];
}
export interface RecoverySnapshot { id:string; createdAt:string; platforms:number; terminals:number; }
export interface PerformanceBenchmarkResult { terminalCount:number; roundsPerTerminal:number; totalEvaluations:number; durationMs:number; evaluationsPerSecond:number; }
export interface SystemDiagnostics { databaseIntegrity: string; platforms: number; terminals: number; rounds: number; eventLogs: number; screenProfiles: number; recoverySnapshots: number; }

export interface RoundArchiveStatus {
  databasePath: string;
  retentionPerPlatform: number;
  totalRounds: number;
  platforms: Array<{ platformId: string; platformName: string; rounds: number; newestRoundAt: string | null }>;
  syncDirectory: string | null;
  syncMode: 'PUBLISHER' | 'SUBSCRIBER' | null;
  lastPublishedAt: string | null;
  lastImportedAt: string | null;
  lastError: string | null;
  backgroundEnabled: boolean;
}

export interface UserSession {
  id: string;
  userId: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface Platform {
  id: string;
  name: string;
  slug: string;
  game: string;
  enabled: boolean;
  sourceType: 'TIPMINER';
  tipMinerRoundUuid: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  historyLimit: number;
  collectorStatus: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  createdAt: string;
  updatedAt: string;
}

export interface Terminal {
  id: string;
  name: string;
  sortOrder: number;
  platformId: string;
  gameStrategyId: string;
  betStrategyId: string;
  betStrategyWinId: string;
  betStrategyLossId: string;
  betPlanId: string;
  betPlanWinId: string;
  betPlanLossId: string;
  screenProfileId: string | null;
  mode: TerminalMode;
  enabled: boolean;
  paused: boolean;
  initialBankrollCents: number;
  currentBankrollCents: number;
  gameWins: number;
  gameLosses: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyOption { id: string; name: string; sortOrder: number; }

export interface NormalizedRound {
  id: string;
  platformId: string;
  externalId: string | null;
  multiplier: number;
  occurredAt: string;
  collectedAt: string;
  source: 'TIPMINER';
  deliveryMode: DeliveryMode;
  dedupKey: string;
  rawData?: unknown;
}

export interface CollectorSnapshot {
  platformId: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  running: boolean;
  polling: boolean;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  persistedRounds: number;
}

export interface PlatformTestResult {
  latencyMs: number;
  roundsReceived: number;
  latestMultiplier: number | null;
  latestOccurredAt: string | null;
}

export interface RoundEvent {
  id: string;
  platformId: string;
  round: NormalizedRound;
  publishedAt: string;
}

export interface TerminalRuntime {
  terminalId: string;
  gameStrategyRuntime: { state: GameStrategyState; processedRounds: number; lastMultiplier: number | null; triggerRoundId: string | null; releaseProgress: number; lastAnnotationRole?: RoundAnnotationRole | null };
  resultAnalyzerState: ResultAnalyzerState;
  betStrategyRuntime: { lastDecisionId: string | null; lastAction: BetAction | null; decisionCount: number; entryCount: number; ignoredCount: number };
  galeRuntime: { active: boolean; currentStage: number; cycleId: string | null; activeBetPlanId: string | null; onWinBetPlanId: string | null; followUp: boolean; followUpBehavior: 'RUN_ONCE' | 'REPEAT_UNTIL_LOSS'; triggerLossStreakTarget?: number | null; triggerLossProgress?:number; previousAmountCents?: number; accumulatedLossCents?: number; waitingSignals?: number; preparedLegAmountsCents?: number[]; currentCycleWinCount?:number; currentCycleLossCount?:number; lastCycleWinCount?:number; lastCycleLossCount?:number };
  bankrollState: BankrollMetrics;
  screenControllerState: { status: 'IDLE' | 'READY' | 'MOCKING' | 'PREPARING' | 'PAUSED' | 'INVALID' | 'ERROR'; paused: boolean };
  scheduleState: { allowed: boolean; reason: string | null; checkedAt: string | null };
  pauseState:{type:'NONE'|'MANUAL'|'RULE';reason:string|null;ruleId:string|null;sourceTerminalId:string|null};
  lastProcessedRoundId: string | null;
  status: TerminalStatus;
  updatedAt: string;
}

export interface RoundEventBusSnapshot {
  publishedEvents: number;
  deliveredEvents: number;
  failedDeliveries: number;
  subscribersByPlatform: Record<string, number>;
}

export interface BootstrapData {
  session: UserSession | null;
  platforms: Platform[];
  terminals: Terminal[];
  gameStrategies: StrategyOption[];
  betStrategies: StrategyOption[];
  betPlans: StrategyOption[];
  schedulePlans: StrategyOption[];
  recentRounds: NormalizedRound[];
  collectors: CollectorSnapshot[];
  terminalRuntimes: TerminalRuntime[];
  terminalHistories: Record<string, TerminalHistoryItem[]>;
  screenProfiles: ScreenProfile[];
  terminalSchedules: TerminalSchedule[];
  terminalControlRules:TerminalControlRule[];
  eventBus: RoundEventBusSnapshot;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AiSettingsView {
  model: string;
  transcriptionModel: string;
  hasApiKey: boolean;
  maskedApiKey: string | null;
}

export interface AiModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  promptPrice: string | null;
  completionPrice: string | null;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  platformId: string | null;
  terminalId: string | null;
  historyLimit: 50 | 100 | 250 | 500 | 1_000 | 2_500 | 5_000 | 10_000;
  messages: AiChatMessage[];
  prompt: string | null;
  audio: { data: string; format: 'webm' | 'wav' | 'mp3' | 'ogg' | 'm4a' } | null;
}

export interface AiChatResponse {
  content: string;
  model: string;
  transcript: string | null;
  analyzedRecords: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}
