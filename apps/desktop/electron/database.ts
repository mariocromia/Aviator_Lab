import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { AuditRecord, BetCondition, BetDecision, BetExecution, BetPlanConfig, BetStageEvent, BetStrategyConfig, BootstrapData, ConfigurationDocument, ConfigurationKind, GameSignal, GameStrategyConfig, MultiplierCondition, NamedConfiguration, NormalizedRound, Platform, RecoverySnapshot, ResultAnalyzerState, RoundAnnotation, ScreenProfile, SystemDiagnostics, Terminal, TerminalControlRule, TerminalHistoryItem, TerminalLossStreakStats, TerminalPreset, TerminalRuntime, TerminalSchedule, UserSession, WorkspaceArchive } from '@aviator/shared';
import { BUILT_IN_PLATFORMS } from './platform-catalog.js';

const IDS = {
  master: '11111111-1111-4111-8111-111111111111',
  platform: '22222222-2222-4222-8222-222222222222',
  gameStrategy: '33333333-3333-4333-8333-333333333333',
  betStrategyFixed: '44444444-4444-4444-8444-444444444444',
  betStrategyDynamic: '55555555-5555-4555-8555-555555555555',
  betPlanA: '66666666-6666-4666-8666-666666666666',
  betPlanB: '77777777-7777-4777-8777-777777777777',
  terminalA: '88888888-8888-4888-8888-888888888888',
  terminalB: '99999999-9999-4999-8999-999999999999'
};

export interface TerminalPresetSnapshot {
  terminal:Terminal;
  platform:{id:string;name:string;tipMinerRoundUuid:string};
  gameStrategy:NamedConfiguration;
  betStrategies:NamedConfiguration[];
  betPlans:NamedConfiguration[];
  schedulePlan:NamedConfiguration|null;
  controlRules:TerminalControlRule[];
  screenProfile:ScreenProfile|null;
}

export class AppDatabase {
  private readonly db: DatabaseSync;
  private readonly replayTerminalIds = new Set<string>();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.seed();
    this.ensure24HourHistoryDefault();
    this.installBuiltInPlatforms();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS platforms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, game TEXT NOT NULL,
        enabled INTEGER NOT NULL, source_type TEXT NOT NULL, tipminer_round_uuid TEXT NOT NULL,
        poll_interval_ms INTEGER NOT NULL, request_timeout_ms INTEGER NOT NULL,
        history_limit INTEGER NOT NULL, collector_status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      DROP INDEX IF EXISTS platforms_tipminer_uuid_unique;
      CREATE INDEX IF NOT EXISTS platforms_tipminer_uuid_idx ON platforms(tipminer_round_uuid);
      CREATE TABLE IF NOT EXISTS game_strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS bet_strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS bet_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS schedule_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS terminals (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, platform_id TEXT NOT NULL,
        game_strategy_id TEXT NOT NULL, bet_strategy_id TEXT NOT NULL, bet_strategy_win_id TEXT, bet_strategy_loss_id TEXT, bet_plan_id TEXT NOT NULL, bet_plan_win_id TEXT, bet_plan_loss_id TEXT,
        screen_profile_id TEXT, mode TEXT NOT NULL, enabled INTEGER NOT NULL, paused INTEGER NOT NULL, history_display_limit INTEGER NOT NULL DEFAULT 5000, analysis_round_limit INTEGER NOT NULL DEFAULT 5000, post_win_skip_signals INTEGER NOT NULL DEFAULT 0, bankroll_start_at TEXT, entry_block_patterns_json TEXT NOT NULL DEFAULT '[]', operation_combinations_json TEXT NOT NULL DEFAULT '[]',
        initial_bankroll_cents INTEGER NOT NULL, current_bankroll_cents INTEGER NOT NULL,
        game_wins INTEGER NOT NULL DEFAULT 0, game_losses INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(platform_id) REFERENCES platforms(id)
      );
      CREATE TABLE IF NOT EXISTS rounds (
        id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, external_id TEXT,
        multiplier REAL NOT NULL, occurred_at TEXT NOT NULL, collected_at TEXT NOT NULL,
        source TEXT NOT NULL, delivery_mode TEXT NOT NULL, dedup_key TEXT NOT NULL,
        raw_data_json TEXT, FOREIGN KEY(platform_id) REFERENCES platforms(id),
        UNIQUE(platform_id, dedup_key)
      );
      CREATE INDEX IF NOT EXISTS rounds_platform_occurred_idx ON rounds(platform_id, occurred_at DESC);
      CREATE TABLE IF NOT EXISTS terminal_runtimes (
        terminal_id TEXT PRIMARY KEY, runtime_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS terminal_round_receipts (
        terminal_id TEXT NOT NULL, round_id TEXT NOT NULL, platform_id TEXT NOT NULL,
        delivery_mode TEXT NOT NULL, processed_at TEXT NOT NULL,
        PRIMARY KEY(terminal_id, round_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS round_annotations (
        id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, round_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL, role TEXT NOT NULL, state_before TEXT NOT NULL,
        state_after TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(terminal_id, round_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(round_id) REFERENCES rounds(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS round_annotations_terminal_created_idx ON round_annotations(terminal_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS game_signals (
        id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, platform_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL, trigger_round_id TEXT NOT NULL, result_round_id TEXT NOT NULL,
        result TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(terminal_id, result_round_id, strategy_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(trigger_round_id) REFERENCES rounds(id) ON DELETE CASCADE,
        FOREIGN KEY(result_round_id) REFERENCES rounds(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS game_signals_terminal_created_idx ON game_signals(terminal_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS bet_decisions (
        id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, platform_id TEXT NOT NULL,
        bet_strategy_id TEXT NOT NULL, game_signal_id TEXT NOT NULL, rule_id TEXT,
        action TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(terminal_id, game_signal_id, bet_strategy_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(game_signal_id) REFERENCES game_signals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS bet_decisions_terminal_created_idx ON bet_decisions(terminal_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS bet_stage_events (
        id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
        game_signal_id TEXT NOT NULL, stage_index INTEGER NOT NULL, stage_label TEXT NOT NULL,
        result TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(terminal_id, game_signal_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(game_signal_id) REFERENCES game_signals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS bet_stage_events_terminal_created_idx ON bet_stage_events(terminal_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS bet_executions (
        id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
        game_signal_id TEXT NOT NULL, stage_index INTEGER NOT NULL, stage_label TEXT NOT NULL,
        multiplier REAL NOT NULL, stake_cents INTEGER NOT NULL, returned_cents INTEGER NOT NULL,
        profit_loss_cents INTEGER NOT NULL, bankroll_before_cents INTEGER NOT NULL,
        bankroll_after_cents INTEGER NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(terminal_id, game_signal_id),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(game_signal_id) REFERENCES game_signals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS bet_executions_terminal_created_idx ON bet_executions(terminal_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS game_signals_created_idx ON game_signals(created_at);
      CREATE INDEX IF NOT EXISTS bet_decisions_created_idx ON bet_decisions(created_at);
      CREATE INDEX IF NOT EXISTS bet_stage_events_created_idx ON bet_stage_events(created_at);
      CREATE INDEX IF NOT EXISTS bet_executions_created_idx ON bet_executions(created_at);
      CREATE INDEX IF NOT EXISTS round_annotations_created_idx ON round_annotations(created_at);
      CREATE INDEX IF NOT EXISTS terminal_round_receipts_processed_idx ON terminal_round_receipts(processed_at);
      CREATE TABLE IF NOT EXISTS screen_profiles (
        id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        config_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS terminal_schedule_assignments (
        terminal_id TEXT PRIMARY KEY, schedule_plan_id TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(schedule_plan_id) REFERENCES schedule_plans(id)
      );
      CREATE TABLE IF NOT EXISTS terminal_control_rules (
        id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL,
        source_terminal_id TEXT NOT NULL,target_terminal_id TEXT NOT NULL,
        metric TEXT NOT NULL,operator TEXT NOT NULL,value REAL NOT NULL,action TEXT NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(source_terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(target_terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS global_control_rules (
        id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL,metric TEXT NOT NULL,
        operator TEXT NOT NULL,value REAL NOT NULL,reference_metric TEXT,action TEXT NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS terminal_control_rule_assignments (
        terminal_id TEXT NOT NULL,rule_id TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL,
        PRIMARY KEY(terminal_id,rule_id,role),FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE,
        FOREIGN KEY(rule_id) REFERENCES global_control_rules(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY, category TEXT NOT NULL, level TEXT NOT NULL, event TEXT NOT NULL,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_snapshots (id TEXT PRIMARY KEY, archive_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS configuration_versions (id TEXT PRIMARY KEY, configuration_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(configuration_id, kind, version));
      CREATE TABLE IF NOT EXISTS sequence_pattern_datasets (
        dataset_key TEXT PRIMARY KEY, source_terminal_id TEXT NOT NULL, model_version TEXT NOT NULL,
        signal_definition TEXT NOT NULL, observation_count INTEGER NOT NULL DEFAULT 0,
        history TEXT NOT NULL DEFAULT '', first_observed_at TEXT, last_observed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sequence_pattern_observations (
        dataset_key TEXT NOT NULL, source_signal_id TEXT NOT NULL, result TEXT NOT NULL,
        occurred_at TEXT NOT NULL, PRIMARY KEY(dataset_key,source_signal_id),
        FOREIGN KEY(dataset_key) REFERENCES sequence_pattern_datasets(dataset_key) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sequence_pattern_stats (
        dataset_key TEXT NOT NULL, context TEXT NOT NULL, context_length INTEGER NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
        first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
        PRIMARY KEY(dataset_key,context),
        FOREIGN KEY(dataset_key) REFERENCES sequence_pattern_datasets(dataset_key) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sequence_pattern_stats_lookup_idx ON sequence_pattern_stats(dataset_key,context_length,context);
      CREATE TABLE IF NOT EXISTS sequence_ai_predictions (
        id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, combination_id TEXT NOT NULL,
        source_signal_id TEXT NOT NULL, settled_signal_id TEXT, dataset_key TEXT NOT NULL,
        model_version TEXT NOT NULL, predicted_result TEXT, decision TEXT NOT NULL,
        actual_result TEXT, prediction_json TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT,
        UNIQUE(terminal_id,combination_id,source_signal_id,model_version),
        FOREIGN KEY(terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sequence_ai_predictions_pending_idx ON sequence_ai_predictions(terminal_id,actual_result,created_at);
    `);
    for(const table of ['game_strategies','bet_strategies','bet_plans','schedule_plans','terminals','terminal_control_rules'])this.ensureColumn(table,'sort_order','INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('terminal_control_rules','resume_metric','TEXT');
    this.ensureColumn('terminal_control_rules','resume_operator','TEXT');
    this.ensureColumn('terminal_control_rules','resume_value','REAL');
    this.ensureColumn('terminal_control_rules','reference_metric','TEXT');
    this.ensureColumn('terminal_control_rules','resume_reference_metric','TEXT');
    this.ensureColumn('terminals','bet_strategy_win_id','TEXT');this.ensureColumn('terminals','bet_strategy_loss_id','TEXT');
    this.ensureColumn('terminals','bet_plan_win_id','TEXT');this.ensureColumn('terminals','bet_plan_loss_id','TEXT');
    this.ensureColumn('terminals','strategy_source_terminal_id','TEXT');
    this.ensureColumn('terminals','strategy_source_mode',`TEXT NOT NULL DEFAULT 'GAME_SIGNALS'`);
    this.ensureColumn('terminals','history_display_limit','INTEGER NOT NULL DEFAULT 200');
    this.ensureColumn('terminals','analysis_round_limit','INTEGER NOT NULL DEFAULT 5000');
    this.ensureColumn('terminals','post_win_skip_signals','INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('terminals','bankroll_start_at','TEXT');
    this.ensureColumn('terminals','entry_block_patterns_json',`TEXT NOT NULL DEFAULT '[]'`);
    this.ensureColumn('terminals','operation_combinations_json',`TEXT NOT NULL DEFAULT '[]'`);
    this.ensureColumn('sequence_pattern_datasets','history',`TEXT NOT NULL DEFAULT ''`);
    if(!this.getAppSetting<boolean>('terminal_history_default_200_migrated')){this.setAppSetting('terminal_history_display_max',200);this.setAppSetting('terminal_history_default_200_migrated',true);}
    this.db.exec('UPDATE terminals SET bet_strategy_win_id=bet_strategy_id WHERE bet_strategy_win_id IS NULL; UPDATE terminals SET bet_strategy_loss_id=bet_strategy_id WHERE bet_strategy_loss_id IS NULL; UPDATE terminals SET bet_plan_win_id=bet_plan_id WHERE bet_plan_win_id IS NULL; UPDATE terminals SET bet_plan_loss_id=bet_plan_id WHERE bet_plan_loss_id IS NULL');
    this.migrateGlobalControlRules();
  }

  close(){this.db.close();}

  private ensure24HourHistoryDefault(){
    if(this.getAppSetting<boolean>('terminal_history_24h_5000_migrated'))return;
    this.setAppSetting('terminal_history_display_max',5_000);
    this.db.exec('UPDATE terminals SET history_display_limit=5000 WHERE history_display_limit<=500');
    this.db.exec('UPDATE terminals SET analysis_round_limit=5000 WHERE analysis_round_limit<=1000');
    this.setAppSetting('terminal_history_24h_5000_migrated',true);
  }

  private migrateGlobalControlRules(){
    if(this.getAppSetting<boolean>('global_control_rules_migrated'))return;
    const rows=this.db.prepare('SELECT * FROM terminal_control_rules').all() as Array<Record<string,string|number|null>>;const now=new Date().toISOString();
    const insertRule=this.db.prepare('INSERT OR IGNORE INTO global_control_rules VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const assignRule=this.db.prepare('INSERT OR IGNORE INTO terminal_control_rule_assignments VALUES(?,?,?,?)');
    for(const row of rows){
      const action=String(row.action)==='PAUSE'?'PAUSE':'PLAY';
      insertRule.run(row.id,row.name,row.enabled,row.metric,row.operator,row.value,row.reference_metric,action,row.created_at,row.updated_at,row.sort_order);
      assignRule.run(row.target_terminal_id,row.id,action,now);
      if(action==='PAUSE'&&row.resume_metric&&row.resume_operator&&row.resume_value!==null){
        const playId=randomUUID();
        insertRule.run(playId,`${String(row.name)} • Início`,row.enabled,row.resume_metric,row.resume_operator,row.resume_value,row.resume_reference_metric,'PLAY',row.created_at,row.updated_at,Number(row.sort_order)+1);
        assignRule.run(row.target_terminal_id,playId,'PLAY',now);
      }
    }
    this.setAppSetting('global_control_rules_migrated',true);
  }

  private ensureColumn(table:string,column:string,declaration:string){const columns=this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;if(!columns.some(item=>item.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);}

  private installBuiltInPlatforms() {
    const now = new Date().toISOString();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO platforms
      (id,name,slug,game,enabled,source_type,tipminer_round_uuid,poll_interval_ms,request_timeout_ms,history_limit,collector_status,created_at,updated_at)
      VALUES (?, ?, ?, 'aviator', 1, 'TIPMINER', ?, 2000, 5000, 2000, 'OFFLINE', ?, ?)`);
    const update = this.db.prepare(`UPDATE platforms SET name=?,tipminer_round_uuid=?,updated_at=? WHERE slug=?`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const platform of BUILT_IN_PLATFORMS) {
        insert.run(platform.id, platform.name, platform.slug, platform.tipMinerRoundUuid, now, now);
        update.run(platform.name, platform.tipMinerRoundUuid, now, platform.slug);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private seed() {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const userExists = this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
      if (!userExists) {
        const masterEmail=process.env.AVIATOR_MASTER_EMAIL?.trim();
        const masterPassword=process.env.AVIATOR_MASTER_PASSWORD;
        if(!masterEmail||!masterPassword||masterPassword.length<8)throw new Error('Primeira execução: defina AVIATOR_MASTER_EMAIL e AVIATOR_MASTER_PASSWORD (mínimo de 8 caracteres).');
        const hash = bcrypt.hashSync(masterPassword, 12);
        this.db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)')
          .run(IDS.master, masterEmail, hash, 'MASTER', now);
      }
      const seedMarker=this.db.prepare("SELECT 1 FROM app_settings WHERE key='workspace_seeded'").get();
      const existingWorkspace=Number((this.db.prepare(`SELECT
        (SELECT count(*) FROM platforms)+(SELECT count(*) FROM terminals)+
        (SELECT count(*) FROM game_strategies)+(SELECT count(*) FROM bet_strategies)+
        (SELECT count(*) FROM bet_plans) AS total`).get() as {total:number}).total)>0;
      if(!seedMarker&&!existingWorkspace){
        this.db.prepare(`INSERT OR IGNORE INTO platforms VALUES (?, ?, ?, ?, 1, 'TIPMINER', ?, 2000, 1500, 200, 'OFFLINE', ?, ?)`)
        .run(IDS.platform, 'EstrelaBet', 'estrelabet', 'aviator', '48323e32-3590-4e2f-b6fe-09d5fbc811c9', now, now);
        this.db.prepare('INSERT OR IGNORE INTO game_strategies (id,name,config_json,sort_order) VALUES (?, ?, ?, ?)').run(IDS.gameStrategy, 'Aviator Base • 1.35 / 2.00', JSON.stringify({ trigger: { gt: 1.35, lt: 99 }, win: { gte: 2 }, loss: { between: [0.01, 1.99] }, afterLoss: { lt: 1.35 }, release: { gte: 2 } }),10);
        this.db.prepare('INSERT OR IGNORE INTO bet_strategies (id,name,config_json,sort_order) VALUES (?, ?, ?, ?)').run(IDS.betStrategyFixed, 'Entrada após 2 LOSS', JSON.stringify({ field: 'currentLossStreak', operator: 'EQ', value: 2, action: 'ENTER' }),10);
        this.db.prepare('INSERT OR IGNORE INTO bet_strategies (id,name,config_json,sort_order) VALUES (?, ?, ?, ?)').run(IDS.betStrategyDynamic, 'Loss streak dinâmica', JSON.stringify({ field: 'currentLossStreak', operator: 'EQ', referenceField: 'lastClosedLossStreak', action: 'ENTER' }),20);
        this.db.prepare('INSERT OR IGNORE INTO bet_plans (id,name,config_json,sort_order) VALUES (?, ?, ?, ?)').run(IDS.betPlanA, 'Plano A • 1 entrada', JSON.stringify({ stages: 1, legs: 1 }),10);
        this.db.prepare('INSERT OR IGNORE INTO bet_plans (id,name,config_json,sort_order) VALUES (?, ?, ?, ?)').run(IDS.betPlanB, 'Plano C • Entry + G1 + G2', JSON.stringify({ stages: 3, legs: 2 }),20);
        const insertTerminal = this.db.prepare(`INSERT OR IGNORE INTO terminals (id,name,platform_id,game_strategy_id,bet_strategy_id,bet_strategy_win_id,bet_strategy_loss_id,bet_plan_id,bet_plan_win_id,bet_plan_loss_id,screen_profile_id,mode,enabled,paused,initial_bankroll_cents,current_bankroll_cents,game_wins,game_losses,created_at,updated_at,sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SIMULATION', 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
        insertTerminal.run(IDS.terminalA, 'Terminal Alpha', IDS.platform, IDS.gameStrategy, IDS.betStrategyFixed,IDS.betStrategyFixed,IDS.betStrategyFixed, IDS.betPlanA,IDS.betPlanA,IDS.betPlanA, 0, 100000, 100000, 18, 7, now, now,10);
        insertTerminal.run(IDS.terminalB, 'Terminal Vector', IDS.platform, IDS.gameStrategy, IDS.betStrategyDynamic,IDS.betStrategyDynamic,IDS.betStrategyDynamic, IDS.betPlanB,IDS.betPlanB,IDS.betPlanB, 1, 50000, 50000, 11, 6, now, now,20);
      }
      if(!seedMarker)this.db.prepare("INSERT OR REPLACE INTO app_settings (key,value_json) VALUES ('workspace_seeded','true')").run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  authenticate(email: string, password: string): UserSession | null {
    const user = this.db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as { id: string; email: string; password_hash: string; role: 'MASTER' } | undefined;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;
    this.db.prepare('DELETE FROM local_sessions WHERE expires_at < ?').run(new Date().toISOString());
    const session: UserSession = { id: randomUUID(), userId: user.id, email: user.email, role: user.role, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() };
    this.db.prepare('INSERT INTO local_sessions VALUES (?, ?, ?, ?)').run(session.id, user.id, session.expiresAt, new Date().toISOString());
    this.log('AUTH', 'INFO', 'LOGIN_SUCCESS', { userId: user.id });
    return session;
  }

  getSession(): UserSession | null {
    const row = this.db.prepare(`SELECT s.id, s.user_id, s.expires_at, u.email, u.role FROM local_sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 1`).get(new Date().toISOString()) as Record<string, string> | undefined;
    return row ? { id: row.id, userId: row.user_id, email: row.email, role: row.role as 'MASTER', expiresAt: row.expires_at } : null;
  }

  logout() { this.db.prepare('DELETE FROM local_sessions').run(); }

  bootstrap(): BootstrapData {
    const platforms = this.db.prepare('SELECT * FROM platforms ORDER BY name').all().map(mapPlatform);
    const terminals = this.listTerminals();
    const options = (table: string) => this.db.prepare(`SELECT id, name, sort_order AS sortOrder FROM ${table} ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name`).all() as { id: string; name: string; sortOrder:number }[];
    const terminalHistoryDisplayMax=Math.max(10,Math.min(5_000,this.getAppSetting<number>('terminal_history_display_max')??5_000));
    return { session: this.getSession(), platforms, terminals, gameStrategies: options('game_strategies'), betStrategies: options('bet_strategies'), betPlans: options('bet_plans'), schedulePlans: options('schedule_plans'), recentRounds: this.getRecentRounds(undefined, 40), collectors: [], terminalRuntimes: [], terminalHistories: Object.fromEntries(terminals.map(terminal => [terminal.id, this.getTerminalHistory(terminal.id, terminalHistoryDisplayMax)])),terminalLossStreakStats:Object.fromEntries(terminals.map(terminal=>[terminal.id,this.getTerminalLossStreakStats(terminal.id)])),terminalUpdateStates:{},terminalHistoryDisplayMax, screenProfiles: this.getScreenProfiles(), terminalSchedules: this.getTerminalSchedules(),terminalControlRules:this.listTerminalControlRules(), eventBus: { publishedEvents: 0, deliveredEvents: 0, failedDeliveries: 0, subscribersByPlatform: {} } };
  }

  getPlatforms(): Platform[] { return this.db.prepare('SELECT * FROM platforms WHERE enabled = 1 ORDER BY name').all().map(mapPlatform); }
  getPlatform(id: string): Platform | null { const row = this.db.prepare('SELECT * FROM platforms WHERE id = ?').get(id); return row ? mapPlatform(row) : null; }

  getRoundDedupKeys(platformId: string, limit = 2_000): string[] {
    return (this.db.prepare('SELECT dedup_key FROM rounds WHERE platform_id = ? ORDER BY occurred_at DESC LIMIT ?').all(platformId, limit) as { dedup_key: string }[]).map(row => row.dedup_key);
  }

  insertRound(round: NormalizedRound): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO rounds (id, platform_id, external_id, multiplier, occurred_at, collected_at, source, delivery_mode, dedup_key, raw_data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(round.id, round.platformId, round.externalId, round.multiplier, round.occurredAt, round.collectedAt, round.source, round.deliveryMode, round.dedupKey, round.rawData == null ? null : JSON.stringify(round.rawData));
    if (result.changes > 0) this.log('ROUND', 'INFO', 'ROUND_RECEIVED', { platformId: round.platformId, roundId: round.id, deliveryMode: round.deliveryMode });
    return result.changes > 0;
  }

  insertRounds(rounds:NormalizedRound[]):number{
    if(!rounds.length)return 0;
    const statement=this.db.prepare(`INSERT OR IGNORE INTO rounds (id, platform_id, external_id, multiplier, occurred_at, collected_at, source, delivery_mode, dedup_key, raw_data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let inserted=0;this.db.exec('BEGIN IMMEDIATE');
    try{for(const round of rounds){const result=statement.run(round.id,round.platformId,round.externalId,round.multiplier,round.occurredAt,round.collectedAt,round.source,round.deliveryMode,round.dedupKey,round.rawData==null?null:JSON.stringify(round.rawData));inserted+=Number(result.changes);}this.db.exec('COMMIT');return inserted;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getRecentRounds(platformId?: string, limit = 40): NormalizedRound[] {
    const rows = platformId
      ? this.db.prepare('SELECT * FROM rounds WHERE platform_id = ? ORDER BY occurred_at DESC LIMIT ?').all(platformId, limit)
      : this.db.prepare('SELECT * FROM rounds ORDER BY occurred_at DESC LIMIT ?').all(limit);
    return rows.map(mapRound);
  }

  getRecentRoundsByFeed(platformId:string|null,limit:number):NormalizedRound[]{
    if(!platformId)return this.getRecentRounds(undefined,limit);
    const platform=this.db.prepare('SELECT tipminer_round_uuid FROM platforms WHERE id=?').get(platformId) as {tipminer_round_uuid:string}|undefined;
    if(!platform)return[];
    const rows=this.db.prepare(`SELECT r.* FROM rounds r JOIN platforms p ON p.id=r.platform_id WHERE p.tipminer_round_uuid=? ORDER BY r.occurred_at DESC LIMIT ?`).all(platform.tipminer_round_uuid,limit);
    return rows.map(mapRound).map(round=>({...round,platformId}));
  }

  pruneRetention(roundLimit=10_000,historyDays=30){
    const cutoff=new Date(Date.now()-historyDays*86_400_000).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM bet_executions WHERE created_at < ?').run(cutoff);
      this.db.prepare('DELETE FROM bet_stage_events WHERE created_at < ?').run(cutoff);
      this.db.prepare('DELETE FROM bet_decisions WHERE created_at < ?').run(cutoff);
      this.db.prepare('DELETE FROM game_signals WHERE created_at < ?').run(cutoff);
      this.db.prepare('DELETE FROM round_annotations WHERE created_at < ?').run(cutoff);
      this.db.prepare('DELETE FROM terminal_round_receipts WHERE processed_at < ?').run(cutoff);
      const platforms=this.db.prepare('SELECT id FROM platforms').all() as Array<{id:string}>;
      for(const platform of platforms)this.db.prepare(`DELETE FROM rounds WHERE platform_id=? AND id IN (SELECT id FROM rounds WHERE platform_id=? ORDER BY occurred_at DESC LIMIT -1 OFFSET ?) AND id NOT IN (SELECT trigger_round_id FROM game_signals UNION SELECT result_round_id FROM game_signals UNION SELECT round_id FROM round_annotations UNION SELECT round_id FROM terminal_round_receipts)`).run(platform.id,platform.id,roundLimit);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  countRounds(platformId: string): number {
    const row = this.db.prepare('SELECT count(*) AS total FROM rounds WHERE platform_id = ?').get(platformId) as { total: number };
    return Number(row.total);
  }

  updateCollectorStatus(platformId: string, status: Platform['collectorStatus']) {
    this.db.prepare('UPDATE platforms SET collector_status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), platformId);
  }

  logEvent(category: string, level: string, event: string, metadata: unknown) { this.log(category, level, event, metadata); }

  insertTerminal(terminal: Terminal) {
    this.db.prepare(`INSERT INTO terminals (id,name,platform_id,game_strategy_id,strategy_source_terminal_id,strategy_source_mode,bet_strategy_id,bet_strategy_win_id,bet_strategy_loss_id,bet_plan_id,bet_plan_win_id,bet_plan_loss_id,screen_profile_id,mode,enabled,paused,history_display_limit,analysis_round_limit,post_win_skip_signals,bankroll_start_at,entry_block_patterns_json,operation_combinations_json,initial_bankroll_cents,current_bankroll_cents,game_wins,game_losses,created_at,updated_at,sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(terminal.id, terminal.name, terminal.platformId, terminal.gameStrategyId,terminal.strategySourceTerminalId,terminal.strategySourceMode, terminal.betStrategyId,terminal.betStrategyWinId,terminal.betStrategyLossId, terminal.betPlanId,terminal.betPlanWinId,terminal.betPlanLossId, terminal.screenProfileId, terminal.mode, Number(terminal.enabled), Number(terminal.paused),terminal.historyDisplayLimit,terminal.analysisRoundLimit,terminal.postWinSkipSignals,terminal.bankrollStartAt,JSON.stringify(terminal.entryBlockPatterns),JSON.stringify(terminal.operationCombinations), terminal.initialBankrollCents, terminal.currentBankrollCents, terminal.gameWins, terminal.gameLosses, terminal.createdAt, terminal.updatedAt,terminal.sortOrder);
    this.setTerminalControlRuleAssignments(terminal.id,terminal.controlPlayRuleIds,terminal.controlPauseRuleIds);
    this.log('TERMINAL', 'INFO', 'TERMINAL_CREATED', { terminalId: terminal.id });
  }

  listTerminals(): Terminal[] { return this.db.prepare('SELECT * FROM terminals ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name').all().map(row=>this.withDependentOperationalStats(this.withControlRuleAssignments(mapTerminal(row)))); }
  saveTerminal(terminal: Terminal) { this.insertTerminal(terminal); }

  updateTerminal(terminal: Terminal) {
    this.db.prepare(`UPDATE terminals SET name = ?, sort_order = ?, platform_id = ?, game_strategy_id = ?,strategy_source_terminal_id=?,strategy_source_mode=?, bet_strategy_id = ?, bet_strategy_win_id=?, bet_strategy_loss_id=?, bet_plan_id = ?,bet_plan_win_id=?,bet_plan_loss_id=?, mode = ?,history_display_limit=?,analysis_round_limit=?,post_win_skip_signals=?,bankroll_start_at=?,entry_block_patterns_json=?,operation_combinations_json=?, updated_at = ? WHERE id = ?`)
      .run(terminal.name,terminal.sortOrder, terminal.platformId, terminal.gameStrategyId,terminal.strategySourceTerminalId,terminal.strategySourceMode, terminal.betStrategyId,terminal.betStrategyWinId,terminal.betStrategyLossId, terminal.betPlanId,terminal.betPlanWinId,terminal.betPlanLossId, terminal.mode,terminal.historyDisplayLimit,terminal.analysisRoundLimit,terminal.postWinSkipSignals,terminal.bankrollStartAt,JSON.stringify(terminal.entryBlockPatterns),JSON.stringify(terminal.operationCombinations), terminal.updatedAt, terminal.id);
    this.log('TERMINAL', 'INFO', 'TERMINAL_UPDATED', { terminalId: terminal.id, platformId: terminal.platformId });
    this.setTerminalControlRuleAssignments(terminal.id,terminal.controlPlayRuleIds,terminal.controlPauseRuleIds);
  }

  getTerminal(id: string): Terminal | null {
    const row = this.db.prepare('SELECT * FROM terminals WHERE id = ?').get(id);
    return row ? this.withDependentOperationalStats(this.withControlRuleAssignments(mapTerminal(row))) : null;
  }

  setTerminalPaused(id: string, paused: boolean) {
    this.db.prepare('UPDATE terminals SET paused = ?, updated_at = ? WHERE id = ?').run(Number(paused), new Date().toISOString(), id);
    this.log('TERMINAL', 'INFO', paused ? 'TERMINAL_PAUSED' : 'TERMINAL_RESUMED', { terminalId: id });
  }

  deleteTerminal(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE terminals SET strategy_source_terminal_id=NULL,updated_at=? WHERE strategy_source_terminal_id=?').run(new Date().toISOString(),id);
      this.db.prepare('DELETE FROM terminal_round_receipts WHERE terminal_id = ?').run(id);
      this.db.prepare('DELETE FROM terminal_runtimes WHERE terminal_id = ?').run(id);
      this.db.prepare('DELETE FROM terminals WHERE id = ?').run(id);
      this.db.exec('COMMIT'); this.log('TERMINAL', 'INFO', 'TERMINAL_DELETED', { terminalId: id });
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  resetTerminal(id:string,clearHistory=false){
    const terminal=this.getTerminal(id);if(!terminal)throw new Error('Terminal não encontrado.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(clearHistory){
        this.db.prepare('DELETE FROM bet_executions WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM bet_stage_events WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM bet_decisions WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM game_signals WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM round_annotations WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM terminal_round_receipts WHERE terminal_id=?').run(id);
        this.db.prepare('DELETE FROM terminal_runtimes WHERE terminal_id=?').run(id);
      }
      this.db.prepare('UPDATE terminals SET current_bankroll_cents=initial_bankroll_cents,game_wins=CASE WHEN ? THEN 0 ELSE game_wins END,game_losses=CASE WHEN ? THEN 0 ELSE game_losses END,updated_at=? WHERE id=?').run(Number(clearHistory),Number(clearHistory),new Date().toISOString(),id);
      this.db.exec('COMMIT');this.log('TERMINAL','WARN',clearHistory?'TERMINAL_FULL_RESET':'TERMINAL_FINANCIAL_RESET',{terminalId:id,initialBankrollCents:terminal.initialBankrollCents,preservedHistory:!clearHistory});
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  clearTerminalCalculatedHistory(id:string){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM bet_executions WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM bet_stage_events WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM bet_decisions WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM game_signals WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM round_annotations WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM terminal_round_receipts WHERE terminal_id=?').run(id);
      this.db.prepare('DELETE FROM terminal_runtimes WHERE terminal_id=?').run(id);
      this.db.prepare('UPDATE terminals SET game_wins=0,game_losses=0,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  beginTerminalReplay(id:string){this.replayTerminalIds.add(id);}
  endTerminalReplay(id:string){this.replayTerminalIds.delete(id);}

  updateTerminalInitialBankroll(id:string,initialBankrollCents:number){const now=new Date().toISOString();this.db.prepare('UPDATE terminals SET initial_bankroll_cents=?,current_bankroll_cents=?,updated_at=? WHERE id=?').run(initialBankrollCents,initialBankrollCents,now,id);this.log('TERMINAL','INFO','TERMINAL_INITIAL_BANKROLL_UPDATED',{terminalId:id,initialBankrollCents});}
  setTerminalBankrollAnchor(id:string,initialBankrollCents:number,bankrollStartAt:string){const now=new Date().toISOString();this.db.prepare('UPDATE terminals SET initial_bankroll_cents=?,current_bankroll_cents=?,bankroll_start_at=?,updated_at=? WHERE id=?').run(initialBankrollCents,initialBankrollCents,bankrollStartAt,now,id);this.log('TERMINAL','INFO','TERMINAL_BANKROLL_ANCHOR_UPDATED',{terminalId:id,initialBankrollCents,bankrollStartAt});}

  getTerminalRuntime(id: string): TerminalRuntime | null {
    const row = this.db.prepare('SELECT runtime_json FROM terminal_runtimes WHERE terminal_id = ?').get(id) as { runtime_json: string } | undefined;
    if (!row) return null;
    const runtime = JSON.parse(row.runtime_json) as TerminalRuntime;
    runtime.gameStrategyRuntime.triggerRoundId ??= null;
    runtime.gameStrategyRuntime.releaseProgress ??= 0;
    runtime.resultAnalyzerState = normalizeResultAnalyzerState(runtime.resultAnalyzerState);
    runtime.sequenceAiRuntime={history:String(runtime.sequenceAiRuntime?.history??'').replace(/[^WL]/g,'').slice(-5_000),observations:Math.max(0,Number(runtime.sequenceAiRuntime?.observations)||0),transitions:runtime.sequenceAiRuntime?.transitions??{},lastPrediction:runtime.sequenceAiRuntime?.lastPrediction??null,datasetKey:runtime.sequenceAiRuntime?.datasetKey??null,persistedObservations:Math.max(0,Number(runtime.sequenceAiRuntime?.persistedObservations)||0)};
    runtime.betStrategyRuntime = {
      lastDecisionId: runtime.betStrategyRuntime.lastDecisionId ?? null,
      lastAction: runtime.betStrategyRuntime.lastAction ?? null,
      decisionCount: runtime.betStrategyRuntime.decisionCount ?? 0,
      entryCount: runtime.betStrategyRuntime.entryCount ?? 0,
      ignoredCount: runtime.betStrategyRuntime.ignoredCount ?? 0,
      postWinSkipRemaining:runtime.betStrategyRuntime.postWinSkipRemaining??0
    };
    runtime.galeRuntime = {
      active: runtime.galeRuntime.active ?? false,
      currentStage: runtime.galeRuntime.currentStage ?? 0,
      cycleId: runtime.galeRuntime.cycleId ?? null,
      activeBetPlanId: runtime.galeRuntime.activeBetPlanId ?? null,
      activeCombinationId:runtime.galeRuntime.activeCombinationId??null,
      onWinBetPlanId: runtime.galeRuntime.onWinBetPlanId ?? null,
      followUp: runtime.galeRuntime.followUp ?? false,
      followUpBehavior: runtime.galeRuntime.followUpBehavior ?? 'RUN_ONCE',
      triggerLossStreakTarget:runtime.galeRuntime.triggerLossStreakTarget??null,
      triggerLossProgress:runtime.galeRuntime.triggerLossProgress??0,
      previousAmountCents:runtime.galeRuntime.previousAmountCents??0,
      accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,
      waitingSignals:runtime.galeRuntime.waitingSignals??0,
      entryConfirmed:runtime.galeRuntime.entryConfirmed??runtime.galeRuntime.currentStage===0,
      failedCycleAttempts:runtime.galeRuntime.failedCycleAttempts??0,
      preparedLegAmountsCents:runtime.galeRuntime.preparedLegAmountsCents??[],
      currentCycleWinCount:runtime.galeRuntime.currentCycleWinCount??0,
      currentCycleLossCount:runtime.galeRuntime.currentCycleLossCount??0,
      lastCycleWinCount:runtime.galeRuntime.lastCycleWinCount??0,
      lastCycleLossCount:runtime.galeRuntime.lastCycleLossCount??0
    };
    runtime.scheduleState={allowed:runtime.scheduleState?.allowed??true,reason:runtime.scheduleState?.reason??null,checkedAt:runtime.scheduleState?.checkedAt??null};
    runtime.pauseState={type:runtime.pauseState?.type??'NONE',reason:runtime.pauseState?.reason??null,ruleId:runtime.pauseState?.ruleId??null,sourceTerminalId:runtime.pauseState?.sourceTerminalId??null};
    return runtime;
  }

  saveTerminalRuntime(runtime: TerminalRuntime) {
    this.db.prepare(`INSERT INTO terminal_runtimes (terminal_id, runtime_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET runtime_json = excluded.runtime_json, updated_at = excluded.updated_at`)
      .run(runtime.terminalId, JSON.stringify(runtime), runtime.updatedAt);
  }

  recordRoundReceipt(terminalId: string, round: NormalizedRound): boolean {
    const result = this.db.prepare('INSERT OR IGNORE INTO terminal_round_receipts VALUES (?, ?, ?, ?, ?)').run(terminalId, round.id, round.platformId, round.deliveryMode, new Date().toISOString());
    if (result.changes > 0) this.log('TERMINAL', 'DEBUG', 'ROUND_ROUTED_TO_TERMINAL', { terminalId, roundId: round.id, platformId: round.platformId });
    return result.changes > 0;
  }

  getGameStrategyConfig(id: string): GameStrategyConfig | null {
    const row = this.db.prepare('SELECT config_json FROM game_strategies WHERE id = ?').get(id) as { config_json: string } | undefined;
    return row ? normalizeGameStrategyConfig(JSON.parse(row.config_json) as unknown) : null;
  }

  saveRoundAnnotation(annotation: RoundAnnotation) {
    this.db.prepare('INSERT OR IGNORE INTO round_annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(annotation.id, annotation.terminalId, annotation.roundId, annotation.strategyId, annotation.role, annotation.stateBefore, annotation.stateAfter, JSON.stringify(annotation.metadata), annotation.createdAt);
    this.log('GAME_STRATEGY', 'DEBUG', annotation.role, { terminalId: annotation.terminalId, roundId: annotation.roundId, stateBefore: annotation.stateBefore, stateAfter: annotation.stateAfter });
  }

  saveGameSignal(signal: GameSignal) {
    this.db.prepare('INSERT OR IGNORE INTO game_signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(signal.id, signal.terminalId, signal.platformId, signal.strategyId, signal.triggerRoundId, signal.resultRoundId, signal.result, JSON.stringify(signal.metadata), signal.createdAt);
    this.log('GAME_STRATEGY', 'INFO', signal.result === 'WIN' ? 'WIN_DETECTED' : 'LOSS_DETECTED', { terminalId: signal.terminalId, signalId: signal.id, triggerRoundId: signal.triggerRoundId, resultRoundId: signal.resultRoundId });
  }

  recordSequencePatternObservation(input:{datasetKey:string;sourceTerminalId:string;modelVersion:string;signalDefinition:string;sourceSignalId:string;result:'WIN'|'LOSS';contexts:string[];occurredAt:string}){
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO sequence_pattern_datasets(dataset_key,source_terminal_id,model_version,signal_definition,observation_count,history,first_observed_at,last_observed_at,updated_at) VALUES(?,?,?,?,0,'',NULL,NULL,?) ON CONFLICT(dataset_key) DO UPDATE SET updated_at=excluded.updated_at`).run(input.datasetKey,input.sourceTerminalId,input.modelVersion,input.signalDefinition,now);
    const inserted=this.db.prepare('INSERT OR IGNORE INTO sequence_pattern_observations(dataset_key,source_signal_id,result,occurred_at) VALUES(?,?,?,?)').run(input.datasetKey,input.sourceSignalId,input.result,input.occurredAt);
    if(!inserted.changes)return Number((this.db.prepare('SELECT observation_count FROM sequence_pattern_datasets WHERE dataset_key=?').get(input.datasetKey) as {observation_count:number}).observation_count);
    this.db.prepare(`UPDATE sequence_pattern_datasets SET observation_count=observation_count+1,history=substr(history||?,-5000),first_observed_at=COALESCE(first_observed_at,?),last_observed_at=?,updated_at=? WHERE dataset_key=?`).run(input.result==='WIN'?'W':'L',input.occurredAt,input.occurredAt,now,input.datasetKey);
    const upsert=this.db.prepare(`INSERT INTO sequence_pattern_stats(dataset_key,context,context_length,wins,losses,first_observed_at,last_observed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(dataset_key,context) DO UPDATE SET wins=wins+excluded.wins,losses=losses+excluded.losses,last_observed_at=excluded.last_observed_at`);
    for(const context of input.contexts)upsert.run(input.datasetKey,context,context.length,input.result==='WIN'?1:0,input.result==='LOSS'?1:0,input.occurredAt,input.occurredAt);
    return Number((this.db.prepare('SELECT observation_count FROM sequence_pattern_datasets WHERE dataset_key=?').get(input.datasetKey) as {observation_count:number}).observation_count);
  }

  replaceSequencePatternModel(input:{datasetKey:string;sourceTerminalId:string;modelVersion:string;signalDefinition:string;runtime:TerminalRuntime['sequenceAiRuntime'];observedAt:string}){
    const existing=this.db.prepare('SELECT observation_count FROM sequence_pattern_datasets WHERE dataset_key=?').get(input.datasetKey) as {observation_count:number}|undefined;
    if(existing&&Number(existing.observation_count)>input.runtime.observations)return Number(existing.observation_count);
    const now=new Date().toISOString();this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare(`INSERT INTO sequence_pattern_datasets(dataset_key,source_terminal_id,model_version,signal_definition,observation_count,history,first_observed_at,last_observed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(dataset_key) DO UPDATE SET source_terminal_id=excluded.source_terminal_id,model_version=excluded.model_version,signal_definition=excluded.signal_definition,observation_count=excluded.observation_count,history=excluded.history,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at`).run(input.datasetKey,input.sourceTerminalId,input.modelVersion,input.signalDefinition,input.runtime.observations,input.runtime.history.slice(-5000),input.observedAt,input.observedAt,now);
      this.db.prepare('DELETE FROM sequence_pattern_stats WHERE dataset_key=?').run(input.datasetKey);this.db.prepare('DELETE FROM sequence_pattern_observations WHERE dataset_key=?').run(input.datasetKey);
      const insert=this.db.prepare('INSERT INTO sequence_pattern_stats(dataset_key,context,context_length,wins,losses,first_observed_at,last_observed_at) VALUES(?,?,?,?,?,?,?)');for(const[context,counts]of Object.entries(input.runtime.transitions))insert.run(input.datasetKey,context,context.length,counts.wins,counts.losses,input.observedAt,input.observedAt);
      this.db.exec('COMMIT');return input.runtime.observations;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  getSequencePatternModel(datasetKey:string):TerminalRuntime['sequenceAiRuntime']|null{
    const dataset=this.db.prepare('SELECT observation_count,history FROM sequence_pattern_datasets WHERE dataset_key=?').get(datasetKey) as {observation_count:number;history:string}|undefined;if(!dataset)return null;
    const stats=this.db.prepare('SELECT context,wins,losses FROM sequence_pattern_stats WHERE dataset_key=?').all(datasetKey) as Array<{context:string;wins:number;losses:number}>;const transitions:TerminalRuntime['sequenceAiRuntime']['transitions']={};for(const row of stats)transitions[row.context]={wins:Number(row.wins),losses:Number(row.losses)};
    const history=String(dataset.history??'').replace(/[^WL]/g,'').slice(-5000);
    return{history,observations:Number(dataset.observation_count),transitions,lastPrediction:null,datasetKey,persistedObservations:Number(dataset.observation_count)};
  }

  saveSequencePrediction(input:{terminalId:string;combinationId:string;sourceSignalId:string;datasetKey:string;modelVersion:string;predictedResult:'W'|'L'|null;decision:'ENTER'|'IGNORE';prediction:unknown;createdAt:string}){
    this.db.prepare(`INSERT OR IGNORE INTO sequence_ai_predictions(id,terminal_id,combination_id,source_signal_id,dataset_key,model_version,predicted_result,decision,prediction_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),input.terminalId,input.combinationId,input.sourceSignalId,input.datasetKey,input.modelVersion,input.predictedResult,input.decision,JSON.stringify(input.prediction),input.createdAt);
  }

  settleSequencePredictions(terminalId:string,actualResult:'WIN'|'LOSS',settledSignalId:string,settledAt:string){
    this.db.prepare(`UPDATE sequence_ai_predictions SET actual_result=?,settled_signal_id=?,settled_at=? WHERE terminal_id=? AND actual_result IS NULL AND source_signal_id<>?`).run(actualResult==='WIN'?'W':'L',settledSignalId,settledAt,terminalId,settledSignalId);
  }

  getBetStrategyConfig(id: string): BetStrategyConfig | null {
    const row = this.db.prepare('SELECT name, config_json FROM bet_strategies WHERE id = ?').get(id) as { name: string; config_json: string } | undefined;
    return row ? normalizeBetStrategyConfig(id, row.name, JSON.parse(row.config_json) as unknown) : null;
  }

  saveBetDecision(decision: BetDecision) {
    this.db.prepare('INSERT OR IGNORE INTO bet_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(decision.id, decision.terminalId, decision.platformId, decision.betStrategyId, decision.gameSignalId, decision.ruleId, decision.action, JSON.stringify(decision.metadata), decision.createdAt);
    this.log('BET_STRATEGY', 'INFO', decision.action === 'ENTER' ? 'BET_ENTER' : decision.action === 'PAUSE' ? 'BET_PAUSE' : 'BET_IGNORE', { terminalId: decision.terminalId, decisionId: decision.id, ruleId: decision.ruleId });
  }

  getBetPlanStageCount(id: string): number {
    const row = this.db.prepare('SELECT config_json FROM bet_plans WHERE id = ?').get(id) as { config_json: string } | undefined;
    if (!row) return 1;
    const config = JSON.parse(row.config_json) as { stages?: number | unknown[] };
    return Math.max(1, Math.min(51, Array.isArray(config.stages) ? config.stages.length : Number(config.stages ?? 1)));
  }

  getBetPlanConfig(id: string): BetPlanConfig | null {
    const row = this.db.prepare('SELECT config_json FROM bet_plans WHERE id = ?').get(id) as { config_json: string } | undefined;
    return row ? normalizeBetPlanConfig(JSON.parse(row.config_json) as unknown) : null;
  }

  getBacktestRounds(platformId: string, limit: number): NormalizedRound[] {
    const rows = this.db.prepare(`SELECT r.* FROM rounds r JOIN platforms p ON p.id = r.platform_id
      WHERE p.tipminer_round_uuid = (SELECT tipminer_round_uuid FROM platforms WHERE id = ?)
      ORDER BY r.occurred_at DESC LIMIT ?`).all(platformId, limit * 2);
    const seen = new Set<string>();
    return rows.map(mapRound).filter(round => { if (seen.has(round.dedupKey)) return false; seen.add(round.dedupKey); return true; }).slice(0, limit).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  listAudit(limit: number, category: string | null): AuditRecord[] {
    const logRows = (category
      ? this.db.prepare('SELECT * FROM event_logs WHERE category = ? ORDER BY created_at DESC LIMIT ?').all(category, limit)
      : this.db.prepare('SELECT * FROM event_logs ORDER BY created_at DESC LIMIT ?').all(limit)) as Array<Record<string, string>>;
    const records: AuditRecord[] = logRows.map(row => {
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      return { id: row.id, category: row.category, level: row.level, event: row.event, terminalId: typeof metadata.terminalId === 'string' ? metadata.terminalId : null, platformId: typeof metadata.platformId === 'string' ? metadata.platformId : null, metadata, createdAt: row.created_at };
    });
    if (category == null || category === 'BET_STRATEGY') {
      const decisions = this.db.prepare('SELECT * FROM bet_decisions ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Record<string, string | null>>;
      records.push(...decisions.map(row => ({ id: String(row.id), category: 'BET_STRATEGY', level: 'AUDIT', event: `DECISION_${String(row.action)}`, terminalId: String(row.terminal_id), platformId: String(row.platform_id), metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>, createdAt: String(row.created_at) })));
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  saveBetStageEvent(event: BetStageEvent) {
    this.db.prepare('INSERT OR IGNORE INTO bet_stage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(event.id, event.cycleId, event.terminalId, event.gameSignalId, event.stageIndex, event.stageLabel, event.result, event.createdAt);
    this.log('GALE', 'INFO', event.result === 'WIN' ? 'BET_STAGE_WIN' : 'BET_STAGE_LOSS', { terminalId: event.terminalId, cycleId: event.cycleId, stage: event.stageLabel, gameSignalId: event.gameSignalId });
  }

  saveBetExecution(execution: BetExecution) {
    this.db.prepare('INSERT OR IGNORE INTO bet_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(execution.id, execution.cycleId, execution.terminalId, execution.gameSignalId, execution.stageIndex, execution.stageLabel, execution.multiplier, execution.stakeCents, execution.returnedCents, execution.profitLossCents, execution.bankrollBeforeCents, execution.bankrollAfterCents, execution.result, execution.createdAt);
    this.log('BANKROLL', 'INFO', 'BET_SETTLED', { terminalId: execution.terminalId, cycleId: execution.cycleId, stage: execution.stageLabel, stakeCents: execution.stakeCents, returnedCents: execution.returnedCents, profitLossCents: execution.profitLossCents, bankrollAfterCents: execution.bankrollAfterCents });
  }

  updateTerminalBankroll(id: string, balanceCents: number) {
    this.db.prepare('UPDATE terminals SET current_bankroll_cents = ?, updated_at = ? WHERE id = ?').run(balanceCents, new Date().toISOString(), id);
  }

  getTerminalHistory(terminalId: string, limit = 100): TerminalHistoryItem[] {
    const terminal = this.getTerminal(terminalId);
    const isDependent = terminal?.strategySourceTerminalId != null;
    const rows = this.db.prepare(`SELECT gs.id AS signal_id, gs.terminal_id, gs.result AS game_result, gs.metadata_json AS signal_metadata, gs.created_at,
      COALESCE(result_round.occurred_at, gs.created_at) AS occurred_at,
      bd.action AS decision_action, bse.id AS stage_id, bse.cycle_id, bse.stage_index, bse.stage_label, bse.result AS stage_result, bse.created_at AS stage_created_at,
      be.id AS execution_id, be.multiplier AS execution_multiplier, be.stake_cents, be.returned_cents, be.profit_loss_cents,
      be.bankroll_before_cents, be.bankroll_after_cents, be.result AS execution_result, be.created_at AS execution_created_at
      FROM game_signals gs
      LEFT JOIN rounds result_round ON result_round.id = gs.result_round_id
      LEFT JOIN bet_decisions bd ON bd.game_signal_id = gs.id AND bd.terminal_id = gs.terminal_id
      LEFT JOIN bet_stage_events bse ON bse.game_signal_id = gs.id AND bse.terminal_id = gs.terminal_id
      LEFT JOIN bet_executions be ON be.game_signal_id = gs.id AND be.terminal_id = gs.terminal_id
      WHERE gs.terminal_id = ? ${isDependent ? "AND (bd.action = 'ENTER' OR be.id IS NOT NULL)" : ''}
      ORDER BY gs.created_at DESC LIMIT ?`).all(terminalId, limit) as Array<Record<string, string | number | null>>;
    return rows.reverse().map(row => {
      const metadata = JSON.parse(String(row.signal_metadata)) as { multiplier?: number };
      const stage = row.stage_id == null ? null : { id: String(row.stage_id), cycleId: String(row.cycle_id), terminalId: String(row.terminal_id), gameSignalId: String(row.signal_id), stageIndex: Number(row.stage_index), stageLabel: String(row.stage_label), result: String(row.stage_result) as BetStageEvent['result'], createdAt: String(row.stage_created_at) };
      const execution = row.execution_id == null ? null : { id: String(row.execution_id), cycleId: String(row.cycle_id), terminalId: String(row.terminal_id), gameSignalId: String(row.signal_id), stageIndex: Number(row.stage_index), stageLabel: String(row.stage_label), multiplier: Number(row.execution_multiplier), stakeCents: Number(row.stake_cents), returnedCents: Number(row.returned_cents), profitLossCents: Number(row.profit_loss_cents), bankrollBeforeCents: Number(row.bankroll_before_cents), bankrollAfterCents: Number(row.bankroll_after_cents), result: String(row.execution_result) as BetExecution['result'], createdAt: String(row.execution_created_at) };
      // A fonte W/L serve somente para disparar a operação. Depois que a aposta
      // é liquidada, a bolinha do Terminal dependente representa o resultado da
      // própria aposta, nunca uma cópia do sinal recebido.
      const displayedResult = isDependent && row.execution_result != null ? String(row.execution_result) : String(row.game_result);
      return { signalId: String(row.signal_id), terminalId: String(row.terminal_id), createdAt: String(row.created_at), occurredAt:String(row.occurred_at), gameResult: displayedResult as TerminalHistoryItem['gameResult'], multiplier: metadata.multiplier ?? null, decisionAction: row.decision_action == null ? null : String(row.decision_action) as TerminalHistoryItem['decisionAction'], stage, execution };
    });
  }

  getTerminalLossStreakStats(terminalId:string):TerminalLossStreakStats{
    const terminal=this.getTerminal(terminalId);
    if(!terminal)return{historyMax:0,bankrollMax:0,galeLimit:0,historyExceededGales:0,bankrollExceededGales:0,historyMaxOccurrences:0,bankrollMaxOccurrences:0,lastExceededGalesAt:null,averageExceededGalesIntervalMs:null,bankrollMinCents:0,bankrollMaxCents:0};
    const galeLimit=Math.max(0,(this.getBetPlanConfig(terminal.betPlanLossId)?.stages.length??1)-1);
    const dependent=terminal.strategySourceTerminalId!==null;
    const rows=this.db.prepare(`SELECT gs.result AS game_result,COALESCE(result_round.occurred_at,gs.created_at) AS occurred_at,be.id AS execution_id,be.result AS execution_result,be.bankroll_before_cents,be.bankroll_after_cents
      FROM game_signals gs
      LEFT JOIN rounds result_round ON result_round.id=gs.result_round_id
      LEFT JOIN bet_executions be ON be.game_signal_id=gs.id AND be.terminal_id=gs.terminal_id
      WHERE gs.terminal_id=? ${dependent?'AND be.id IS NOT NULL':''}
      ORDER BY COALESCE(result_round.occurred_at,gs.created_at),gs.created_at`).all(terminalId) as Array<{game_result:string;occurred_at:string;execution_id:string|null;execution_result:string|null;bankroll_before_cents:number|null;bankroll_after_cents:number|null}>;
    const anchor=terminal.bankrollStartAt?Date.parse(terminal.bankrollStartAt):null;
    const historyStreaks:number[]=[];const bankrollStreaks:number[]=[];const exceededAt:number[]=[];
    let historyCurrent=0;let bankrollCurrent=0;let bankrollMinCents=Math.min(terminal.initialBankrollCents,terminal.currentBankrollCents);let bankrollMaxCents=Math.max(terminal.initialBankrollCents,terminal.currentBankrollCents);
    for(const row of rows){
      const result=dependent&&row.execution_id?row.execution_result:row.game_result;const occurredAt=Date.parse(row.occurred_at);
      if(result==='LOSS'){historyCurrent++;if(historyCurrent===galeLimit+1&&Number.isFinite(occurredAt))exceededAt.push(occurredAt);}else if(historyCurrent>0){historyStreaks.push(historyCurrent);historyCurrent=0;}
      if(anchor===null||occurredAt>=anchor){
        if(result==='LOSS')bankrollCurrent++;else if(bankrollCurrent>0){bankrollStreaks.push(bankrollCurrent);bankrollCurrent=0;}
        for(const balance of [row.bankroll_before_cents,row.bankroll_after_cents])if(balance!==null&&Number.isFinite(balance)){bankrollMinCents=Math.min(bankrollMinCents,balance);bankrollMaxCents=Math.max(bankrollMaxCents,balance);}
      }
    }
    if(historyCurrent>0)historyStreaks.push(historyCurrent);if(bankrollCurrent>0)bankrollStreaks.push(bankrollCurrent);
    const historyMax=Math.max(0,...historyStreaks);const bankrollMax=Math.max(0,...bankrollStreaks);
    const historyExceededGales=historyStreaks.filter(length=>length>galeLimit).length;const bankrollExceededGales=bankrollStreaks.filter(length=>length>galeLimit).length;
    const historyMaxOccurrences=historyMax===0?0:historyStreaks.filter(length=>length===historyMax).length;const bankrollMaxOccurrences=bankrollMax===0?0:bankrollStreaks.filter(length=>length===bankrollMax).length;
    const intervals=exceededAt.slice(1).map((timestamp,index)=>timestamp-exceededAt[index]);const averageExceededGalesIntervalMs=intervals.length?Math.round(intervals.reduce((total,value)=>total+value,0)/intervals.length):null;
    return{historyMax,bankrollMax,galeLimit,historyExceededGales,bankrollExceededGales,historyMaxOccurrences,bankrollMaxOccurrences,lastExceededGalesAt:exceededAt.length?new Date(exceededAt.at(-1)!).toISOString():null,averageExceededGalesIntervalMs,bankrollMinCents,bankrollMaxCents};
  }
  getScreenProfiles(): ScreenProfile[] {
    return (this.db.prepare('SELECT * FROM screen_profiles ORDER BY name').all() as Array<Record<string, string>>).map(row => ({ id: row.id, terminalId: row.terminal_id, name: row.name, ...JSON.parse(row.config_json) as Omit<ScreenProfile, 'id' | 'terminalId' | 'name' | 'updatedAt'>, updatedAt: row.updated_at }));
  }

  getTerminalSchedule(terminalId:string):TerminalSchedule|null{
    const row=this.db.prepare(`SELECT a.terminal_id,a.schedule_plan_id,p.config_json,a.updated_at FROM terminal_schedule_assignments a JOIN schedule_plans p ON p.id=a.schedule_plan_id WHERE a.terminal_id=?`).get(terminalId) as {terminal_id:string;schedule_plan_id:string;config_json:string;updated_at:string}|undefined;
    if(!row)return null;const config=JSON.parse(row.config_json) as Omit<TerminalSchedule,'terminalId'|'schedulePlanId'|'updatedAt'>;return{terminalId:row.terminal_id,schedulePlanId:row.schedule_plan_id,...config,updatedAt:row.updated_at};
  }

  getTerminalSchedules():TerminalSchedule[]{return this.listTerminals().map(terminal=>this.getTerminalSchedule(terminal.id)).filter((schedule):schedule is TerminalSchedule=>schedule!==null);}

  setTerminalSchedulePlan(terminalId:string,schedulePlanId:string|null){
    if(schedulePlanId==null)this.db.prepare('DELETE FROM terminal_schedule_assignments WHERE terminal_id=?').run(terminalId);
    else this.db.prepare(`INSERT INTO terminal_schedule_assignments VALUES(?,?,?) ON CONFLICT(terminal_id) DO UPDATE SET schedule_plan_id=excluded.schedule_plan_id,updated_at=excluded.updated_at`).run(terminalId,schedulePlanId,new Date().toISOString());
    this.log('SCHEDULE','INFO','TERMINAL_SCHEDULE_PLAN_CHANGED',{terminalId,schedulePlanId});
  }

  listTerminalControlRules():TerminalControlRule[]{return(this.db.prepare('SELECT * FROM global_control_rules ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name').all() as Array<Record<string,string|number|null>>).map(row=>({id:String(row.id),name:String(row.name),sortOrder:Number(row.sort_order)||0,enabled:Boolean(row.enabled),metric:String(row.metric) as TerminalControlRule['metric'],operator:String(row.operator) as TerminalControlRule['operator'],value:Number(row.value),referenceMetric:row.reference_metric?String(row.reference_metric) as TerminalControlRule['metric']:null,action:String(row.action) as TerminalControlRule['action'],createdAt:String(row.created_at),updatedAt:String(row.updated_at)}));}

  saveTerminalControlRule(input:Omit<TerminalControlRule,'id'|'createdAt'|'updatedAt'>&{id:string|null}):TerminalControlRule{
    const existing=input.id?this.listTerminalControlRules().find(rule=>rule.id===input.id):null;const now=new Date().toISOString();const rule:TerminalControlRule={...input,id:input.id||randomUUID(),createdAt:existing?.createdAt??now,updatedAt:now};
    this.db.prepare(`INSERT INTO global_control_rules VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,enabled=excluded.enabled,metric=excluded.metric,operator=excluded.operator,value=excluded.value,reference_metric=excluded.reference_metric,action=excluded.action,updated_at=excluded.updated_at`).run(rule.id,rule.name,Number(rule.enabled),rule.metric,rule.operator,rule.value,rule.referenceMetric??null,rule.action,rule.createdAt,rule.updatedAt,rule.sortOrder);this.log('ORCHESTRATION','INFO','CONTROL_RULE_SAVED',{ruleId:rule.id,action:rule.action});return rule;
  }

  getTerminalGameSignalByRound(terminalId:string,roundId:string):GameSignal|null{
    const row=this.db.prepare('SELECT * FROM game_signals WHERE terminal_id=? AND result_round_id=? ORDER BY created_at DESC LIMIT 1').get(terminalId,roundId) as Record<string,string>|undefined;
    return row?{id:row.id,terminalId:row.terminal_id,platformId:row.platform_id,strategyId:row.strategy_id,triggerRoundId:row.trigger_round_id,resultRoundId:row.result_round_id,result:row.result as GameSignal['result'],metadata:JSON.parse(row.metadata_json) as Record<string,unknown>,createdAt:row.created_at}:null;
  }

  getTerminalBetExecutionByRound(terminalId:string,roundId:string):BetExecution|null{
    const row=this.db.prepare(`SELECT be.* FROM bet_executions be JOIN game_signals gs ON gs.id=be.game_signal_id WHERE be.terminal_id=? AND gs.result_round_id=? ORDER BY be.created_at DESC LIMIT 1`).get(terminalId,roundId) as Record<string,string|number>|undefined;
    return row?{id:String(row.id),cycleId:String(row.cycle_id),terminalId:String(row.terminal_id),gameSignalId:String(row.game_signal_id),stageIndex:Number(row.stage_index),stageLabel:String(row.stage_label),multiplier:Number(row.multiplier),stakeCents:Number(row.stake_cents),returnedCents:Number(row.returned_cents),profitLossCents:Number(row.profit_loss_cents),bankrollBeforeCents:Number(row.bankroll_before_cents),bankrollAfterCents:Number(row.bankroll_after_cents),result:String(row.result) as BetExecution['result'],createdAt:String(row.created_at)}:null;
  }

  getTerminalEntryDecisionByRound(terminalId:string,roundId:string):BetDecision|null{
    const row=this.db.prepare(`SELECT bd.* FROM bet_decisions bd JOIN game_signals gs ON gs.id=bd.game_signal_id WHERE bd.terminal_id=? AND gs.result_round_id=? AND bd.action='ENTER' ORDER BY bd.created_at DESC LIMIT 1`).get(terminalId,roundId) as Record<string,string>|undefined;
    return row?{id:row.id,terminalId:row.terminal_id,platformId:row.platform_id,betStrategyId:row.bet_strategy_id,gameSignalId:row.game_signal_id,ruleId:row.rule_id??null,action:'ENTER',metadata:JSON.parse(row.metadata_json) as Record<string,unknown>,createdAt:row.created_at}:null;
  }

  deleteTerminalControlRule(id:string){this.db.prepare('DELETE FROM global_control_rules WHERE id=?').run(id);this.log('ORCHESTRATION','WARN','CONTROL_RULE_DELETED',{ruleId:id});}

  getTerminalControlRules(terminalId:string){const ids=this.db.prepare('SELECT rule_id FROM terminal_control_rule_assignments WHERE terminal_id=?').all(terminalId) as Array<{rule_id:string}>;const selected=new Set(ids.map(item=>item.rule_id));return this.listTerminalControlRules().filter(rule=>selected.has(rule.id));}
  setTerminalControlRuleAssignments(terminalId:string,playIds:string[],pauseIds:string[]){this.db.prepare('DELETE FROM terminal_control_rule_assignments WHERE terminal_id=?').run(terminalId);const insert=this.db.prepare('INSERT OR IGNORE INTO terminal_control_rule_assignments VALUES(?,?,?,?)');const now=new Date().toISOString();for(const id of playIds)insert.run(terminalId,id,'PLAY',now);for(const id of pauseIds)insert.run(terminalId,id,'PAUSE',now);}
  private withControlRuleAssignments(terminal:Terminal){const rows=this.db.prepare('SELECT rule_id,role FROM terminal_control_rule_assignments WHERE terminal_id=?').all(terminal.id) as Array<{rule_id:string;role:string}>;terminal.controlPlayRuleIds=rows.filter(item=>item.role==='PLAY').map(item=>item.rule_id);terminal.controlPauseRuleIds=rows.filter(item=>item.role==='PAUSE').map(item=>item.rule_id);return terminal;}
  private withDependentOperationalStats(terminal:Terminal){
    if(!terminal.strategySourceTerminalId)return terminal;
    const row=this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END),0) AS wins,
      COALESCE(SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END),0) AS losses
      FROM bet_executions WHERE terminal_id=?`).get(terminal.id) as {wins:number;losses:number};
    terminal.gameWins=Number(row.wins);terminal.gameLosses=Number(row.losses);return terminal;
  }

  getAppSetting<T>(key:string):T|null{const row=this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as {value_json:string}|undefined;if(!row)return null;try{return JSON.parse(row.value_json) as T}catch{return null}}

  setAppSetting(key:string,value:unknown){this.db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));}

  deleteAppSetting(key:string){this.db.prepare('DELETE FROM app_settings WHERE key=?').run(key);}

  saveScreenProfile(profile: ScreenProfile) {
    const config = { resolutionWidth: profile.resolutionWidth, resolutionHeight: profile.resolutionHeight, windowTitle: profile.windowTitle, monitorIndex: profile.monitorIndex ?? null, calibratedAt: profile.calibratedAt ?? null, bet1: profile.bet1, bet2: profile.bet2, inactivityBet: profile.inactivityBet };
    this.db.prepare(`INSERT INTO screen_profiles VALUES (?, ?, ?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at`)
      .run(profile.id, profile.terminalId, profile.name, JSON.stringify(config), profile.updatedAt);
    this.db.prepare('UPDATE terminals SET screen_profile_id = ?, updated_at = ? WHERE id = ?').run(profile.id, profile.updatedAt, profile.terminalId);
    this.log('SCREEN_CONTROLLER', 'INFO', 'SCREEN_PROFILE_SAVED', { terminalId: profile.terminalId, screenProfileId: profile.id });
  }

  updateTerminalGameStats(id: string, wins: number, losses: number) {
    this.db.prepare('UPDATE terminals SET game_wins = ?, game_losses = ?, updated_at = ? WHERE id = ?').run(wins, losses, new Date().toISOString(), id);
  }

  insertPlatform(platform: Platform) {
    this.db.prepare(`INSERT INTO platforms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(platform.id, platform.name, platform.slug, platform.game, Number(platform.enabled), platform.sourceType, platform.tipMinerRoundUuid, platform.pollIntervalMs, platform.requestTimeoutMs, platform.historyLimit, platform.collectorStatus, platform.createdAt, platform.updatedAt);
    this.log('PLATFORM', 'INFO', 'PLATFORM_CREATED', { platformId: platform.id });
  }

  updatePlatform(platform: Platform) {
    this.db.prepare(`UPDATE platforms SET name = ?, slug = ?, game = ?, tipminer_round_uuid = ?, poll_interval_ms = ?, request_timeout_ms = ?, history_limit = ?, updated_at = ? WHERE id = ?`)
      .run(platform.name, platform.slug, platform.game, platform.tipMinerRoundUuid, platform.pollIntervalMs, platform.requestTimeoutMs, platform.historyLimit, platform.updatedAt, platform.id);
    this.log('PLATFORM', 'INFO', 'PLATFORM_UPDATED', { platformId: platform.id, tipMinerRoundUuid: platform.tipMinerRoundUuid });
  }

  setPlatformEnabled(id: string, enabled: boolean) {
    this.db.prepare(`UPDATE platforms SET enabled = ?, collector_status = 'OFFLINE', updated_at = ? WHERE id = ?`).run(Number(enabled), new Date().toISOString(), id);
    this.log('PLATFORM', 'INFO', enabled ? 'PLATFORM_ENABLED' : 'PLATFORM_DISABLED', { platformId: id });
  }

  exportWorkspace(): WorkspaceArchive {
    const configurations = (table: string): NamedConfiguration[] => (this.db.prepare(`SELECT id, name, config_json, sort_order FROM ${table} ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name`).all() as Array<Record<string,string>>).map(row => ({ id: row.id, name: row.name, sortOrder:Number(row.sort_order)||0, config: JSON.parse(row.config_json) as unknown }));
    return { format: 'AVIATOR_STRATEGY_LAB', version: 2, exportedAt: new Date().toISOString(), platforms: this.db.prepare('SELECT * FROM platforms ORDER BY name').all().map(mapPlatform), terminals: this.listTerminals(), screenProfiles: this.getScreenProfiles(), gameStrategies: configurations('game_strategies'), betStrategies: configurations('bet_strategies'), betPlans: configurations('bet_plans'), schedulePlans:configurations('schedule_plans'), terminalSchedules:this.getTerminalSchedules(), terminalControlRules:this.listTerminalControlRules() };
  }

  importWorkspace(archive: WorkspaceArchive) {
    const backup = this.exportWorkspace(); this.db.prepare('INSERT INTO recovery_snapshots VALUES (?, ?, ?)').run(randomUUID(), JSON.stringify(backup), new Date().toISOString());
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const platformSql = `INSERT INTO platforms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,game=excluded.game,enabled=excluded.enabled,source_type=excluded.source_type,tipminer_round_uuid=excluded.tipminer_round_uuid,poll_interval_ms=excluded.poll_interval_ms,request_timeout_ms=excluded.request_timeout_ms,history_limit=excluded.history_limit,updated_at=excluded.updated_at`;
      for (const item of archive.platforms) this.db.prepare(platformSql).run(item.id,item.name,item.slug,item.game,Number(item.enabled),item.sourceType,item.tipMinerRoundUuid,item.pollIntervalMs,item.requestTimeoutMs,item.historyLimit,item.collectorStatus,item.createdAt,item.updatedAt);
      const configSql = (table:string) => this.db.prepare(`INSERT INTO ${table} (id,name,config_json,sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,config_json=excluded.config_json,sort_order=excluded.sort_order`);
      for (const [table, items] of [['game_strategies',archive.gameStrategies],['bet_strategies',archive.betStrategies],['bet_plans',archive.betPlans],['schedule_plans',archive.schedulePlans??[]]] as const) { const statement=configSql(table); for(const item of items) statement.run(item.id,item.name,JSON.stringify(item.config),item.sortOrder); }
      const terminalSql = `INSERT INTO terminals (id,name,platform_id,game_strategy_id,strategy_source_terminal_id,strategy_source_mode,bet_strategy_id,bet_strategy_win_id,bet_strategy_loss_id,bet_plan_id,bet_plan_win_id,bet_plan_loss_id,screen_profile_id,mode,enabled,paused,history_display_limit,analysis_round_limit,post_win_skip_signals,bankroll_start_at,entry_block_patterns_json,operation_combinations_json,initial_bankroll_cents,current_bankroll_cents,game_wins,game_losses,created_at,updated_at,sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,platform_id=excluded.platform_id,game_strategy_id=excluded.game_strategy_id,strategy_source_terminal_id=excluded.strategy_source_terminal_id,strategy_source_mode=excluded.strategy_source_mode,bet_strategy_id=excluded.bet_strategy_id,bet_strategy_win_id=excluded.bet_strategy_win_id,bet_strategy_loss_id=excluded.bet_strategy_loss_id,bet_plan_id=excluded.bet_plan_id,bet_plan_win_id=excluded.bet_plan_win_id,bet_plan_loss_id=excluded.bet_plan_loss_id,screen_profile_id=excluded.screen_profile_id,mode=excluded.mode,enabled=excluded.enabled,paused=excluded.paused,history_display_limit=excluded.history_display_limit,analysis_round_limit=excluded.analysis_round_limit,post_win_skip_signals=excluded.post_win_skip_signals,bankroll_start_at=excluded.bankroll_start_at,entry_block_patterns_json=excluded.entry_block_patterns_json,operation_combinations_json=excluded.operation_combinations_json,initial_bankroll_cents=excluded.initial_bankroll_cents,current_bankroll_cents=excluded.current_bankroll_cents,updated_at=excluded.updated_at`;
      for (const item of archive.terminals) this.db.prepare(terminalSql).run(item.id,item.name,item.platformId,item.gameStrategyId,item.strategySourceTerminalId,item.strategySourceMode,item.betStrategyId,item.betStrategyWinId,item.betStrategyLossId,item.betPlanId,item.betPlanWinId,item.betPlanLossId,item.screenProfileId,item.mode,Number(item.enabled),Number(item.paused),item.historyDisplayLimit??5_000,item.analysisRoundLimit??5_000,item.postWinSkipSignals??0,item.bankrollStartAt??null,JSON.stringify(item.entryBlockPatterns??[]),JSON.stringify(item.operationCombinations??[]),item.initialBankrollCents,item.currentBankrollCents,item.gameWins,item.gameLosses,item.createdAt,item.updatedAt,item.sortOrder);
      const profileSql = `INSERT INTO screen_profiles VALUES (?, ?, ?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET name=excluded.name,config_json=excluded.config_json,updated_at=excluded.updated_at`;
      for (const item of archive.screenProfiles) { const config={resolutionWidth:item.resolutionWidth,resolutionHeight:item.resolutionHeight,windowTitle:item.windowTitle,monitorIndex:item.monitorIndex??null,calibratedAt:item.calibratedAt??null,bet1:item.bet1,bet2:item.bet2,inactivityBet:item.inactivityBet}; this.db.prepare(profileSql).run(item.id,item.terminalId,item.name,JSON.stringify(config),item.updatedAt); this.db.prepare('UPDATE terminals SET screen_profile_id=? WHERE id=?').run(item.id,item.terminalId); }
      for(const item of archive.terminalSchedules??[])this.db.prepare('INSERT INTO terminal_schedule_assignments VALUES (?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET schedule_plan_id=excluded.schedule_plan_id,updated_at=excluded.updated_at').run(item.terminalId,item.schedulePlanId,item.updatedAt);
      for(const item of archive.terminalControlRules??[])this.db.prepare('INSERT INTO global_control_rules VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,metric=excluded.metric,operator=excluded.operator,value=excluded.value,reference_metric=excluded.reference_metric,action=excluded.action,updated_at=excluded.updated_at,sort_order=excluded.sort_order').run(item.id,item.name,Number(item.enabled),item.metric,item.operator,item.value,item.referenceMetric??null,item.action,item.createdAt,item.updatedAt,item.sortOrder);
      for(const item of archive.terminals)this.setTerminalControlRuleAssignments(item.id,item.controlPlayRuleIds,item.controlPauseRuleIds);
      this.db.exec('COMMIT'); this.log('SYSTEM','INFO','WORKSPACE_IMPORTED',{platforms:archive.platforms.length,terminals:archive.terminals.length});
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }

  saveTerminalPreset(terminalId:string,name:string):TerminalPreset{
    const terminal=this.getTerminal(terminalId);if(!terminal)throw new Error('Terminal não encontrado.');
    const platform=this.getPlatform(terminal.platformId);if(!platform)throw new Error('Plataforma do Terminal não encontrada.');
    const document=(kind:ConfigurationKind,id:string)=>{const item=this.listConfigurationDocuments(kind).find(candidate=>candidate.id===id);if(!item)throw new Error(`Configuração ${kind} não encontrada.`);return{id:item.id,name:item.name,sortOrder:item.sortOrder,config:structuredClone(item.config)} satisfies NamedConfiguration;};
    const unique=(ids:string[])=>[...new Set(ids)];
    const schedule=this.getTerminalSchedule(terminal.id);
    const combinationStrategyIds=terminal.operationCombinations.flatMap(item=>[item.betStrategyId,...item.lossReentryBetStrategyId?[item.lossReentryBetStrategyId]:[]]);
    const snapshot:TerminalPresetSnapshot={terminal:structuredClone(terminal),platform:{id:platform.id,name:platform.name,tipMinerRoundUuid:platform.tipMinerRoundUuid},gameStrategy:document('GAME_STRATEGY',terminal.gameStrategyId),betStrategies:unique([terminal.betStrategyWinId,terminal.betStrategyLossId,...combinationStrategyIds]).map(id=>document('BET_STRATEGY',id)),betPlans:unique([terminal.betPlanWinId,terminal.betPlanLossId,...terminal.operationCombinations.map(item=>item.betPlanId)]).map(id=>document('BET_PLAN',id)),schedulePlan:schedule?document('SCHEDULE_PLAN',schedule.schedulePlanId):null,controlRules:this.getTerminalControlRules(terminal.id).map(rule=>structuredClone(rule)),screenProfile:this.getScreenProfiles().find(profile=>profile.terminalId===terminal.id)??null};
    const now=new Date().toISOString();const id=randomUUID();
    this.db.prepare('INSERT INTO terminal_presets VALUES(?,?,?,?,?)').run(id,name,JSON.stringify(snapshot),now,now);
    this.log('TERMINAL','INFO','TERMINAL_PRESET_SAVED',{presetId:id,terminalId});
    return{id,name,sourceTerminalName:terminal.name,platformName:platform.name,createdAt:now,updatedAt:now};
  }

  listTerminalPresets():TerminalPreset[]{return(this.db.prepare('SELECT * FROM terminal_presets ORDER BY updated_at DESC').all() as Array<{id:string;name:string;snapshot_json:string;created_at:string;updated_at:string}>).map(row=>{const snapshot=JSON.parse(row.snapshot_json) as TerminalPresetSnapshot;return{id:row.id,name:row.name,sourceTerminalName:snapshot.terminal.name,platformName:snapshot.platform.name,createdAt:row.created_at,updatedAt:row.updated_at};});}
  getTerminalPresetSnapshot(id:string):TerminalPresetSnapshot|null{const row=this.db.prepare('SELECT snapshot_json FROM terminal_presets WHERE id=?').get(id) as {snapshot_json:string}|undefined;return row?JSON.parse(row.snapshot_json) as TerminalPresetSnapshot:null;}
  deleteTerminalPreset(id:string){this.db.prepare('DELETE FROM terminal_presets WHERE id=?').run(id);this.log('TERMINAL','WARN','TERMINAL_PRESET_DELETED',{presetId:id});}
  restoreTerminalPresetConfigurations(id:string){
    const row=this.db.prepare('SELECT name,snapshot_json FROM terminal_presets WHERE id=?').get(id) as {name:string;snapshot_json:string}|undefined;if(!row)throw new Error('Configuração salva não encontrada.');
    const snapshot=JSON.parse(row.snapshot_json) as TerminalPresetSnapshot;
    const platform=this.getPlatform(snapshot.platform.id)??this.getPlatforms().find(item=>item.tipMinerRoundUuid===snapshot.platform.tipMinerRoundUuid);if(!platform)throw new Error('A plataforma desta configuração não está instalada.');
    const prefix=`${snapshot.terminal.name} • ${row.name}`;
    const game=this.saveConfiguration({id:null,kind:'GAME_STRATEGY',name:`${prefix} • Jogo`,sortOrder:snapshot.gameStrategy.sortOrder,config:structuredClone(snapshot.gameStrategy.config)});
    const planIds=new Map<string,string>();
    const plans=snapshot.betPlans.map(source=>{const copy=this.saveConfiguration({id:null,kind:'BET_PLAN',name:`${prefix} • ${source.name}`,sortOrder:source.sortOrder,config:structuredClone(source.config)});planIds.set(source.id,copy.id);return copy;});
    const strategies=snapshot.betStrategies.map(source=>{const config=structuredClone(source.config) as BetStrategyConfig;for(const rule of config.rules){if(rule.betPlanId)rule.betPlanId=planIds.get(rule.betPlanId)??null;if(rule.onWinBetPlanId)rule.onWinBetPlanId=planIds.get(rule.onWinBetPlanId)??null;}return{source,copy:this.saveConfiguration({id:null,kind:'BET_STRATEGY',name:`${prefix} • ${source.name}`,sortOrder:source.sortOrder,config})};});
    const strategyId=(sourceId:string)=>strategies.find(item=>item.source.id===sourceId)?.copy.id??strategies[0]?.copy.id;
    const planId=(sourceId:string)=>planIds.get(sourceId)??plans[0]?.id;
    if(!strategyId(snapshot.terminal.betStrategyWinId)||!strategyId(snapshot.terminal.betStrategyLossId)||!planId(snapshot.terminal.betPlanWinId)||!planId(snapshot.terminal.betPlanLossId))throw new Error('O snapshot não contém todas as estratégias necessárias.');
    const controlIds=new Map<string,string>();for(const source of snapshot.controlRules){const copy=this.saveTerminalControlRule({id:null,name:`${prefix} • ${source.name}`,sortOrder:source.sortOrder,enabled:source.enabled,metric:source.metric,operator:source.operator,value:source.value,referenceMetric:source.referenceMetric,action:source.action});controlIds.set(source.id,copy.id);}
    const schedule=snapshot.schedulePlan?this.saveConfiguration({id:null,kind:'SCHEDULE_PLAN',name:`${prefix} • ${snapshot.schedulePlan.name}`,sortOrder:snapshot.schedulePlan.sortOrder,config:structuredClone(snapshot.schedulePlan.config)}):null;
    const operationCombinations=(snapshot.terminal.operationCombinations??[]).map(item=>({...item,betStrategyId:strategyId(item.betStrategyId)!,lossReentryBetStrategyId:item.lossReentryBetStrategyId?strategyId(item.lossReentryBetStrategyId)??null:null,betPlanId:planId(item.betPlanId)!})).filter(item=>Boolean(item.betStrategyId&&item.betPlanId));
  return{draft:{name:`${snapshot.terminal.name} (restaurado)`,sortOrder:snapshot.terminal.sortOrder,platformId:platform.id,gameStrategyId:game.id,strategySourceTerminalId:null,strategySourceMode:'GAME_SIGNALS' as const,betStrategyId:strategyId(snapshot.terminal.betStrategyLossId)!,betStrategyWinId:strategyId(snapshot.terminal.betStrategyWinId)!,betStrategyLossId:strategyId(snapshot.terminal.betStrategyLossId)!,betPlanId:planId(snapshot.terminal.betPlanLossId)!,betPlanWinId:planId(snapshot.terminal.betPlanWinId)!,betPlanLossId:planId(snapshot.terminal.betPlanLossId)!,entryBlockPatterns:[...(snapshot.terminal.entryBlockPatterns??[])],operationCombinations,controlPlayRuleIds:snapshot.terminal.controlPlayRuleIds.map(ruleId=>controlIds.get(ruleId)).filter((ruleId):ruleId is string=>Boolean(ruleId)),controlPauseRuleIds:snapshot.terminal.controlPauseRuleIds.map(ruleId=>controlIds.get(ruleId)).filter((ruleId):ruleId is string=>Boolean(ruleId)),screenProfileId:null,mode:snapshot.terminal.mode,enabled:true,paused:true,historyDisplayLimit:snapshot.terminal.historyDisplayLimit??5_000,analysisRoundLimit:snapshot.terminal.analysisRoundLimit??5_000,bankrollStartAt:snapshot.terminal.bankrollStartAt??null,initialBankrollCents:snapshot.terminal.initialBankrollCents},schedulePlanId:schedule?.id??null,screenProfile:snapshot.screenProfile};
  }

  listRecoverySnapshots():RecoverySnapshot[]{return(this.db.prepare('SELECT id,archive_json,created_at FROM recovery_snapshots ORDER BY created_at DESC LIMIT 20').all() as Array<{id:string;archive_json:string;created_at:string}>).map(row=>{const archive=JSON.parse(row.archive_json) as WorkspaceArchive;return{id:row.id,createdAt:row.created_at,platforms:archive.platforms.length,terminals:archive.terminals.length}});}
  restoreRecoverySnapshot(id:string){const row=this.db.prepare('SELECT archive_json FROM recovery_snapshots WHERE id=?').get(id) as {archive_json:string}|undefined;if(!row)throw new Error('Snapshot de recuperação não encontrado.');this.importWorkspace(JSON.parse(row.archive_json) as WorkspaceArchive);this.log('SYSTEM','WARN','RECOVERY_SNAPSHOT_RESTORED',{snapshotId:id});}

  getSystemDiagnostics(): SystemDiagnostics {
    const count=(table:string)=>Number((this.db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as {total:number}).total);
    const integrity=this.db.prepare('PRAGMA integrity_check').get() as {integrity_check:string};
    return { databaseIntegrity:integrity.integrity_check,platforms:count('platforms'),terminals:count('terminals'),rounds:count('rounds'),eventLogs:count('event_logs'),screenProfiles:count('screen_profiles'),recoverySnapshots:count('recovery_snapshots') };
  }

  listConfigurationDocuments(kind?: ConfigurationKind): ConfigurationDocument[] {
    const kinds: ConfigurationKind[] = kind ? [kind] : ['GAME_STRATEGY','BET_STRATEGY','BET_PLAN','SCHEDULE_PLAN']; const result: ConfigurationDocument[]=[];
    for(const itemKind of kinds){const table=configurationTable(itemKind);const rows=this.db.prepare(`SELECT c.*, COALESCE(MAX(v.version),0) AS version, MAX(v.created_at) AS version_at FROM ${table} c LEFT JOIN configuration_versions v ON v.configuration_id=c.id AND v.kind=? GROUP BY c.id ORDER BY CASE WHEN c.sort_order <= 0 THEN 1 ELSE 0 END, c.sort_order, c.name`).all(itemKind) as Array<Record<string,string|number|null>>;for(const row of rows){const raw=JSON.parse(String(row.config_json)) as unknown;const config=itemKind==='GAME_STRATEGY'?normalizeGameStrategyConfig(raw):itemKind==='BET_STRATEGY'?normalizeBetStrategyConfig(String(row.id),String(row.name),raw):itemKind==='BET_PLAN'?normalizeBetPlanConfig(raw):raw;result.push({id:String(row.id),kind:itemKind,name:String(row.name),sortOrder:Number(row.sort_order)||0,config,version:Number(row.version)||1,updatedAt:row.version_at?String(row.version_at):null});}}
    return result;
  }

  saveConfiguration(input:{id:string|null;kind:ConfigurationKind;name:string;sortOrder:number;config:unknown}): ConfigurationDocument {
    const id=input.id??randomUUID();const table=configurationTable(input.kind);const now=new Date().toISOString();const existing=this.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id);const current=this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM configuration_versions WHERE configuration_id=? AND kind=?').get(id,input.kind) as {version:number};const version=Number(current.version)+1;
    this.db.prepare(`INSERT INTO ${table} (id,name,config_json,sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,config_json=excluded.config_json,sort_order=excluded.sort_order`).run(id,input.name,JSON.stringify(input.config),input.sortOrder);this.db.prepare('INSERT INTO configuration_versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(),id,input.kind,version,input.name,JSON.stringify(input.config),now);this.log('CONFIGURATION','INFO',existing?'CONFIGURATION_UPDATED':'CONFIGURATION_CREATED',{configurationId:id,kind:input.kind,version,sortOrder:input.sortOrder});return{id,kind:input.kind,name:input.name,sortOrder:input.sortOrder,config:input.config,version,updatedAt:now};
  }

  duplicateConfiguration(id:string,kind:ConfigurationKind): ConfigurationDocument | null {const source=this.listConfigurationDocuments(kind).find(item=>item.id===id);return source?this.saveConfiguration({id:null,kind,name:`${source.name} (cópia)`,sortOrder:source.sortOrder+1,config:source.config}):null;}
  deleteConfiguration(id:string,kind:ConfigurationKind){
    const combinationUsage=(kind==='BET_STRATEGY'||kind==='BET_PLAN')?this.listTerminals().filter(terminal=>terminal.operationCombinations.some(item=>kind==='BET_STRATEGY'?item.betStrategyId===id||item.lossReentryBetStrategyId===id:item.betPlanId===id)).length:0;
    if(combinationUsage>0)throw new Error(`Não é possível excluir: esta configuração está selecionada em ${combinationUsage} combinação(ões) de Terminal. Altere os Terminais primeiro.`);
    const usageSql=kind==='SCHEDULE_PLAN'
      ?'SELECT count(*) AS total FROM terminal_schedule_assignments WHERE schedule_plan_id=?'
      :kind==='GAME_STRATEGY'
        ?'SELECT count(*) AS total FROM terminals WHERE game_strategy_id=?'
        :kind==='BET_STRATEGY'
          ?'SELECT count(*) AS total FROM terminals WHERE bet_strategy_id=? OR bet_strategy_win_id=? OR bet_strategy_loss_id=?'
          :'SELECT count(*) AS total FROM terminals WHERE bet_plan_id=? OR bet_plan_win_id=? OR bet_plan_loss_id=?';
    const parameters=kind==='BET_STRATEGY'||kind==='BET_PLAN'?[id,id,id]:[id];
    const used=this.db.prepare(usageSql).get(...parameters) as {total:number};
    if(Number(used.total)>0)throw new Error(`Não é possível excluir: esta configuração está selecionada em ${used.total} Terminal(is). Altere os Terminais primeiro.`);
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.prepare('DELETE FROM configuration_versions WHERE configuration_id=? AND kind=?').run(id,kind);this.db.prepare(`DELETE FROM ${configurationTable(kind)} WHERE id=?`).run(id);this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error}
    this.log('CONFIGURATION','WARN','CONFIGURATION_DELETED',{configurationId:id,kind});
  }

  private log(category: string, level: string, event: string, metadata: unknown) {
    const terminalId=metadata&&typeof metadata==='object'&&'terminalId' in metadata?String((metadata as {terminalId?:unknown}).terminalId??''):'';
    if(terminalId&&this.replayTerminalIds.has(terminalId))return;
    this.db.prepare('INSERT INTO event_logs VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), category, level, event, JSON.stringify(metadata), new Date().toISOString());
  }
}

function mapPlatform(value: unknown): Platform {
  const r = value as Record<string, string | number>;
  return { id: String(r.id), name: String(r.name), slug: String(r.slug), game: String(r.game), enabled: Boolean(r.enabled), sourceType: 'TIPMINER', tipMinerRoundUuid: String(r.tipminer_round_uuid), pollIntervalMs: Number(r.poll_interval_ms), requestTimeoutMs: Number(r.request_timeout_ms), historyLimit: Number(r.history_limit), collectorStatus: String(r.collector_status) as Platform['collectorStatus'], createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

function mapTerminal(value: unknown): Terminal {
  const r = value as Record<string, string | number | null>;
  let operationCombinations:Terminal['operationCombinations']=[];try{const parsed=JSON.parse(String(r.operation_combinations_json??'[]')) as Array<Partial<Terminal['operationCombinations'][number]>>;operationCombinations=parsed.map(item=>({...item,triggerType:item.triggerType??'BET_STRATEGY',pattern:item.pattern??null,sequenceAiConfig:item.sequenceAiConfig?{...item.sequenceAiConfig,engineVersion:item.sequenceAiConfig.engineVersion??'V1'}:null,lossReentryType:item.lossReentryType??'BET_STRATEGY',lossReentryPattern:item.lossReentryPattern??null,lossReentryBetStrategyId:item.lossReentryBetStrategyId??null} as Terminal['operationCombinations'][number]));}catch{operationCombinations=[];}
  let entryBlockPatterns:string[]=[];try{const parsed=JSON.parse(String(r.entry_block_patterns_json??'[]'));if(Array.isArray(parsed))entryBlockPatterns=parsed.map(String).map(item=>item.toUpperCase()).filter(item=>/^[WL]+$/.test(item));}catch{entryBlockPatterns=[];}
  return { id: String(r.id), name: String(r.name), sortOrder:Number(r.sort_order)||0, platformId: String(r.platform_id), gameStrategyId: String(r.game_strategy_id),strategySourceTerminalId:r.strategy_source_terminal_id?String(r.strategy_source_terminal_id):null,strategySourceMode:String(r.strategy_source_mode??'GAME_SIGNALS') as Terminal['strategySourceMode'], betStrategyId: String(r.bet_strategy_id),betStrategyWinId:String(r.bet_strategy_win_id??r.bet_strategy_id),betStrategyLossId:String(r.bet_strategy_loss_id??r.bet_strategy_id), betPlanId: String(r.bet_plan_id),betPlanWinId:String(r.bet_plan_win_id??r.bet_plan_id),betPlanLossId:String(r.bet_plan_loss_id??r.bet_plan_id),controlPlayRuleIds:[],controlPauseRuleIds:[], screenProfileId: r.screen_profile_id ? String(r.screen_profile_id) : null, mode: String(r.mode) as Terminal['mode'], enabled: Boolean(r.enabled), paused: Boolean(r.paused),historyDisplayLimit:Math.max(10,Math.min(5_000,Number(r.history_display_limit)||5_000)),analysisRoundLimit:Math.max(200,Math.min(300_000,Number(r.analysis_round_limit)||5_000)),postWinSkipSignals:Math.max(0,Math.min(10_000,Number(r.post_win_skip_signals)||0)),bankrollStartAt:r.bankroll_start_at?String(r.bankroll_start_at):null,entryBlockPatterns,operationCombinations, initialBankrollCents: Number(r.initial_bankroll_cents), currentBankrollCents: Number(r.current_bankroll_cents), gameWins: Number(r.game_wins), gameLosses: Number(r.game_losses), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

function mapRound(value: unknown): NormalizedRound {
  const r = value as Record<string, string | number | null>;
  return {
    id: String(r.id), platformId: String(r.platform_id), externalId: r.external_id == null ? null : String(r.external_id),
    multiplier: Number(r.multiplier), occurredAt: String(r.occurred_at), collectedAt: String(r.collected_at),
    source: 'TIPMINER', deliveryMode: String(r.delivery_mode) as NormalizedRound['deliveryMode'], dedupKey: String(r.dedup_key),
    rawData: r.raw_data_json ? JSON.parse(String(r.raw_data_json)) : undefined
  };
}

function normalizeGameStrategyConfig(value: unknown): GameStrategyConfig {
  const config = value as Record<string, unknown>;
  if (Array.isArray(config.trigger)) return config as unknown as GameStrategyConfig;
  const legacy = config as {
    trigger?: { gt?: number; lt?: number };
    win?: { gte?: number };
    loss?: { between?: [number, number] };
    afterLoss?: { lt?: number };
    release?: { gte?: number };
  };
  const conditions = (...items: Array<MultiplierCondition | null>): MultiplierCondition[] => items.filter((item): item is MultiplierCondition => item !== null);
  return {
    trigger: conditions(legacy.trigger?.gt == null ? null : { operator: 'GT', value: legacy.trigger.gt }, legacy.trigger?.lt == null ? null : { operator: 'LT', value: legacy.trigger.lt }),
    win: conditions(legacy.win?.gte == null ? null : { operator: 'GTE', value: legacy.win.gte }),
    loss: conditions(legacy.loss?.between == null ? null : { operator: 'BETWEEN', value: legacy.loss.between }),
    afterLoss: conditions(legacy.afterLoss?.lt == null ? null : { operator: 'LT', value: legacy.afterLoss.lt }),
    release: conditions(legacy.release?.gte == null ? null : { operator: 'GTE', value: legacy.release.gte })
  };
}

function normalizeResultAnalyzerState(value: Partial<ResultAnalyzerState> | undefined): ResultAnalyzerState {
  return { currentWinStreak: 0, currentLossStreak: 0, lastClosedWinStreak: 0, lastClosedLossStreak: 0, maxWinStreak: 0, maxLossStreak: 0, winCount: 0, lossCount: 0, winRate: 0, recentPattern: '', lastResult: null, ...value };
}

function normalizeBetStrategyConfig(id: string, name: string, value: unknown): BetStrategyConfig {
  const config = value as Record<string, unknown>;
  if (Array.isArray(config.rules)) return config as unknown as BetStrategyConfig;
  const legacy = config as { field?: BetCondition['field']; operator?: BetCondition['operator']; value?: number | string | [number, number]; referenceField?: BetCondition['referenceField']; action?: 'ENTER' | 'IGNORE' | 'PAUSE' };
  const condition: BetCondition = { field: legacy.field ?? 'currentLossStreak', operator: legacy.operator ?? 'EQ' };
  if (legacy.value !== undefined) condition.value = legacy.value;
  if (legacy.referenceField !== undefined) condition.referenceField = legacy.referenceField;
  return { rules: [{ id: `${id}:default`, name, enabled: true, priority: 1, conditions: [condition], action: legacy.action ?? 'IGNORE' }] };
}

function normalizeBetPlanConfig(value: unknown): BetPlanConfig {
  const config = value as { stages?: number | BetPlanConfig['stages']; legs?: number };
  if (Array.isArray(config.stages)) return value as BetPlanConfig;
  const stageCount = Math.max(1, Math.min(51, Number(config.stages ?? 1)));
  const legCount = Math.max(1, Math.min(10, Number(config.legs ?? 1)));
  return { stages: Array.from({ length: stageCount }, (_, stageIndex) => ({
    index: stageIndex, label: stageIndex === 0 ? 'BASE' : `GALE ${stageIndex}`,
    legs: Array.from({ length: legCount }, (_, legIndex) => ({ slot: legIndex + 1, amountCents: 100 * 2 ** stageIndex, cashout: legIndex === 0 ? 2 : 10 }))
  })) };
}

function configurationTable(kind: ConfigurationKind) { return kind === 'GAME_STRATEGY' ? 'game_strategies' : kind === 'BET_STRATEGY' ? 'bet_strategies' : kind === 'BET_PLAN' ? 'bet_plans' : 'schedule_plans'; }
