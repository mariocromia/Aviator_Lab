import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { AuditRecord, BetCondition, BetDecision, BetExecution, BetPlanConfig, BetStageEvent, BetStrategyConfig, BootstrapData, ConfigurationDocument, ConfigurationKind, GameSignal, GameStrategyConfig, MultiplierCondition, NamedConfiguration, NormalizedRound, Platform, RecoverySnapshot, ResultAnalyzerState, RoundAnnotation, ScreenProfile, SystemDiagnostics, Terminal, TerminalControlRule, TerminalHistoryItem, TerminalRuntime, TerminalSchedule, UserSession, WorkspaceArchive } from '@aviator/shared';

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

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.seed();
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
        screen_profile_id TEXT, mode TEXT NOT NULL, enabled INTEGER NOT NULL, paused INTEGER NOT NULL,
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
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY, category TEXT NOT NULL, level TEXT NOT NULL, event TEXT NOT NULL,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recovery_snapshots (id TEXT PRIMARY KEY, archive_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS configuration_versions (id TEXT PRIMARY KEY, configuration_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(configuration_id, kind, version));
    `);
    for(const table of ['game_strategies','bet_strategies','bet_plans','schedule_plans','terminals','terminal_control_rules'])this.ensureColumn(table,'sort_order','INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('terminal_control_rules','resume_metric','TEXT');
    this.ensureColumn('terminal_control_rules','resume_operator','TEXT');
    this.ensureColumn('terminal_control_rules','resume_value','REAL');
    this.ensureColumn('terminal_control_rules','reference_metric','TEXT');
    this.ensureColumn('terminal_control_rules','resume_reference_metric','TEXT');
    this.ensureColumn('terminals','bet_strategy_win_id','TEXT');this.ensureColumn('terminals','bet_strategy_loss_id','TEXT');
    this.ensureColumn('terminals','bet_plan_win_id','TEXT');this.ensureColumn('terminals','bet_plan_loss_id','TEXT');
    this.db.exec('UPDATE terminals SET bet_strategy_win_id=bet_strategy_id WHERE bet_strategy_win_id IS NULL; UPDATE terminals SET bet_strategy_loss_id=bet_strategy_id WHERE bet_strategy_loss_id IS NULL; UPDATE terminals SET bet_plan_win_id=bet_plan_id WHERE bet_plan_win_id IS NULL; UPDATE terminals SET bet_plan_loss_id=bet_plan_id WHERE bet_plan_loss_id IS NULL');
  }

  private ensureColumn(table:string,column:string,declaration:string){const columns=this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;if(!columns.some(item=>item.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);}

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
    const terminals = this.db.prepare('SELECT * FROM terminals ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name').all().map(mapTerminal);
    const options = (table: string) => this.db.prepare(`SELECT id, name, sort_order AS sortOrder FROM ${table} ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name`).all() as { id: string; name: string; sortOrder:number }[];
    return { session: this.getSession(), platforms, terminals, gameStrategies: options('game_strategies'), betStrategies: options('bet_strategies'), betPlans: options('bet_plans'), schedulePlans: options('schedule_plans'), recentRounds: this.getRecentRounds(undefined, 40), collectors: [], terminalRuntimes: [], terminalHistories: Object.fromEntries(terminals.map(terminal => [terminal.id, this.getTerminalHistory(terminal.id, 100)])), screenProfiles: this.getScreenProfiles(), terminalSchedules: this.getTerminalSchedules(),terminalControlRules:this.listTerminalControlRules(), eventBus: { publishedEvents: 0, deliveredEvents: 0, failedDeliveries: 0, subscribersByPlatform: {} } };
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
    this.db.prepare(`INSERT INTO terminals (id,name,platform_id,game_strategy_id,bet_strategy_id,bet_strategy_win_id,bet_strategy_loss_id,bet_plan_id,bet_plan_win_id,bet_plan_loss_id,screen_profile_id,mode,enabled,paused,initial_bankroll_cents,current_bankroll_cents,game_wins,game_losses,created_at,updated_at,sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(terminal.id, terminal.name, terminal.platformId, terminal.gameStrategyId, terminal.betStrategyId,terminal.betStrategyWinId,terminal.betStrategyLossId, terminal.betPlanId,terminal.betPlanWinId,terminal.betPlanLossId, terminal.screenProfileId, terminal.mode, Number(terminal.enabled), Number(terminal.paused), terminal.initialBankrollCents, terminal.currentBankrollCents, terminal.gameWins, terminal.gameLosses, terminal.createdAt, terminal.updatedAt,terminal.sortOrder);
    this.log('TERMINAL', 'INFO', 'TERMINAL_CREATED', { terminalId: terminal.id });
  }

  listTerminals(): Terminal[] { return this.db.prepare('SELECT * FROM terminals ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name').all().map(mapTerminal); }
  saveTerminal(terminal: Terminal) { this.insertTerminal(terminal); }

  updateTerminal(terminal: Terminal) {
    this.db.prepare(`UPDATE terminals SET name = ?, sort_order = ?, platform_id = ?, game_strategy_id = ?, bet_strategy_id = ?, bet_strategy_win_id=?, bet_strategy_loss_id=?, bet_plan_id = ?,bet_plan_win_id=?,bet_plan_loss_id=?, mode = ?, updated_at = ? WHERE id = ?`)
      .run(terminal.name,terminal.sortOrder, terminal.platformId, terminal.gameStrategyId, terminal.betStrategyId,terminal.betStrategyWinId,terminal.betStrategyLossId, terminal.betPlanId,terminal.betPlanWinId,terminal.betPlanLossId, terminal.mode, terminal.updatedAt, terminal.id);
    this.log('TERMINAL', 'INFO', 'TERMINAL_UPDATED', { terminalId: terminal.id, platformId: terminal.platformId });
  }

  getTerminal(id: string): Terminal | null {
    const row = this.db.prepare('SELECT * FROM terminals WHERE id = ?').get(id);
    return row ? mapTerminal(row) : null;
  }

  setTerminalPaused(id: string, paused: boolean) {
    this.db.prepare('UPDATE terminals SET paused = ?, updated_at = ? WHERE id = ?').run(Number(paused), new Date().toISOString(), id);
    this.log('TERMINAL', 'INFO', paused ? 'TERMINAL_PAUSED' : 'TERMINAL_RESUMED', { terminalId: id });
  }

  deleteTerminal(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
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

  updateTerminalInitialBankroll(id:string,initialBankrollCents:number){const now=new Date().toISOString();this.db.prepare('UPDATE terminals SET initial_bankroll_cents=?,current_bankroll_cents=?,updated_at=? WHERE id=?').run(initialBankrollCents,initialBankrollCents,now,id);this.log('TERMINAL','INFO','TERMINAL_INITIAL_BANKROLL_UPDATED',{terminalId:id,initialBankrollCents});}

  getTerminalRuntime(id: string): TerminalRuntime | null {
    const row = this.db.prepare('SELECT runtime_json FROM terminal_runtimes WHERE terminal_id = ?').get(id) as { runtime_json: string } | undefined;
    if (!row) return null;
    const runtime = JSON.parse(row.runtime_json) as TerminalRuntime;
    runtime.gameStrategyRuntime.triggerRoundId ??= null;
    runtime.resultAnalyzerState = normalizeResultAnalyzerState(runtime.resultAnalyzerState);
    runtime.betStrategyRuntime = {
      lastDecisionId: runtime.betStrategyRuntime.lastDecisionId ?? null,
      lastAction: runtime.betStrategyRuntime.lastAction ?? null,
      decisionCount: runtime.betStrategyRuntime.decisionCount ?? 0,
      entryCount: runtime.betStrategyRuntime.entryCount ?? 0,
      ignoredCount: runtime.betStrategyRuntime.ignoredCount ?? 0
    };
    runtime.galeRuntime = {
      active: runtime.galeRuntime.active ?? false,
      currentStage: runtime.galeRuntime.currentStage ?? 0,
      cycleId: runtime.galeRuntime.cycleId ?? null,
      activeBetPlanId: runtime.galeRuntime.activeBetPlanId ?? null,
      onWinBetPlanId: runtime.galeRuntime.onWinBetPlanId ?? null,
      followUp: runtime.galeRuntime.followUp ?? false,
      followUpBehavior: runtime.galeRuntime.followUpBehavior ?? 'RUN_ONCE',
      triggerLossStreakTarget:runtime.galeRuntime.triggerLossStreakTarget??null,
      triggerLossProgress:runtime.galeRuntime.triggerLossProgress??0,
      previousAmountCents:runtime.galeRuntime.previousAmountCents??0,
      accumulatedLossCents:runtime.galeRuntime.accumulatedLossCents??0,
      waitingSignals:runtime.galeRuntime.waitingSignals??0,
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
    return Math.max(1, Math.min(20, Array.isArray(config.stages) ? config.stages.length : Number(config.stages ?? 1)));
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
    const rows = this.db.prepare(`SELECT gs.id AS signal_id, gs.terminal_id, gs.result AS game_result, gs.metadata_json AS signal_metadata, gs.created_at,
      bd.action AS decision_action, bse.id AS stage_id, bse.cycle_id, bse.stage_index, bse.stage_label, bse.result AS stage_result, bse.created_at AS stage_created_at,
      be.id AS execution_id, be.multiplier AS execution_multiplier, be.stake_cents, be.returned_cents, be.profit_loss_cents,
      be.bankroll_before_cents, be.bankroll_after_cents, be.result AS execution_result, be.created_at AS execution_created_at
      FROM game_signals gs
      LEFT JOIN bet_decisions bd ON bd.game_signal_id = gs.id AND bd.terminal_id = gs.terminal_id
      LEFT JOIN bet_stage_events bse ON bse.game_signal_id = gs.id AND bse.terminal_id = gs.terminal_id
      LEFT JOIN bet_executions be ON be.game_signal_id = gs.id AND be.terminal_id = gs.terminal_id
      WHERE gs.terminal_id = ? ORDER BY gs.created_at DESC LIMIT ?`).all(terminalId, limit) as Array<Record<string, string | number | null>>;
    return rows.reverse().map(row => {
      const metadata = JSON.parse(String(row.signal_metadata)) as { multiplier?: number };
      const stage = row.stage_id == null ? null : { id: String(row.stage_id), cycleId: String(row.cycle_id), terminalId: String(row.terminal_id), gameSignalId: String(row.signal_id), stageIndex: Number(row.stage_index), stageLabel: String(row.stage_label), result: String(row.stage_result) as BetStageEvent['result'], createdAt: String(row.stage_created_at) };
      const execution = row.execution_id == null ? null : { id: String(row.execution_id), cycleId: String(row.cycle_id), terminalId: String(row.terminal_id), gameSignalId: String(row.signal_id), stageIndex: Number(row.stage_index), stageLabel: String(row.stage_label), multiplier: Number(row.execution_multiplier), stakeCents: Number(row.stake_cents), returnedCents: Number(row.returned_cents), profitLossCents: Number(row.profit_loss_cents), bankrollBeforeCents: Number(row.bankroll_before_cents), bankrollAfterCents: Number(row.bankroll_after_cents), result: String(row.execution_result) as BetExecution['result'], createdAt: String(row.execution_created_at) };
      return { signalId: String(row.signal_id), terminalId: String(row.terminal_id), createdAt: String(row.created_at), gameResult: String(row.game_result) as TerminalHistoryItem['gameResult'], multiplier: metadata.multiplier ?? null, decisionAction: row.decision_action == null ? null : String(row.decision_action) as TerminalHistoryItem['decisionAction'], stage, execution };
    });
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

  listTerminalControlRules():TerminalControlRule[]{return(this.db.prepare('SELECT * FROM terminal_control_rules ORDER BY CASE WHEN sort_order <= 0 THEN 1 ELSE 0 END, sort_order, name').all() as Array<Record<string,string|number|null>>).map(row=>({id:String(row.id),name:String(row.name),sortOrder:Number(row.sort_order)||0,enabled:Boolean(row.enabled),sourceTerminalId:String(row.source_terminal_id),targetTerminalId:String(row.target_terminal_id),metric:String(row.metric) as TerminalControlRule['metric'],operator:String(row.operator) as TerminalControlRule['operator'],value:Number(row.value),referenceMetric:row.reference_metric?String(row.reference_metric) as TerminalControlRule['metric']:null,action:String(row.action) as TerminalControlRule['action'],resumeMetric:row.resume_metric?String(row.resume_metric) as TerminalControlRule['metric']:null,resumeOperator:row.resume_operator?String(row.resume_operator) as TerminalControlRule['operator']:null,resumeValue:row.resume_value===null?null:Number(row.resume_value),resumeReferenceMetric:row.resume_reference_metric?String(row.resume_reference_metric) as TerminalControlRule['metric']:null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)}));}

  saveTerminalControlRule(input:Omit<TerminalControlRule,'id'|'createdAt'|'updatedAt'>&{id:string|null}):TerminalControlRule{
    const existing=input.id?this.listTerminalControlRules().find(rule=>rule.id===input.id):null;const now=new Date().toISOString();const rule:TerminalControlRule={...input,id:input.id||randomUUID(),createdAt:existing?.createdAt??now,updatedAt:now};
    this.db.prepare(`INSERT INTO terminal_control_rules (id,name,enabled,source_terminal_id,target_terminal_id,metric,operator,value,action,created_at,updated_at,sort_order,resume_metric,resume_operator,resume_value,reference_metric,resume_reference_metric) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,enabled=excluded.enabled,source_terminal_id=excluded.source_terminal_id,target_terminal_id=excluded.target_terminal_id,metric=excluded.metric,operator=excluded.operator,value=excluded.value,action=excluded.action,resume_metric=excluded.resume_metric,resume_operator=excluded.resume_operator,resume_value=excluded.resume_value,reference_metric=excluded.reference_metric,resume_reference_metric=excluded.resume_reference_metric,updated_at=excluded.updated_at`).run(rule.id,rule.name,Number(rule.enabled),rule.sourceTerminalId,rule.targetTerminalId,rule.metric,rule.operator,rule.value,rule.action,rule.createdAt,rule.updatedAt,rule.sortOrder,rule.resumeMetric??null,rule.resumeOperator??null,rule.resumeValue??null,rule.referenceMetric??null,rule.resumeReferenceMetric??null);this.log('ORCHESTRATION','INFO','CONTROL_RULE_SAVED',{ruleId:rule.id,sourceTerminalId:rule.sourceTerminalId,targetTerminalId:rule.targetTerminalId,action:rule.action});return rule;
  }

  deleteTerminalControlRule(id:string){this.db.prepare('DELETE FROM terminal_control_rules WHERE id=?').run(id);this.log('ORCHESTRATION','WARN','CONTROL_RULE_DELETED',{ruleId:id});}

  getAppSetting<T>(key:string):T|null{const row=this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as {value_json:string}|undefined;if(!row)return null;try{return JSON.parse(row.value_json) as T}catch{return null}}

  setAppSetting(key:string,value:unknown){this.db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));}

  deleteAppSetting(key:string){this.db.prepare('DELETE FROM app_settings WHERE key=?').run(key);}

  saveScreenProfile(profile: ScreenProfile) {
    const config = { resolutionWidth: profile.resolutionWidth, resolutionHeight: profile.resolutionHeight, windowTitle: profile.windowTitle, monitorIndex: profile.monitorIndex ?? null, calibratedAt: profile.calibratedAt ?? null, bet1: profile.bet1, bet2: profile.bet2 };
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
      const terminalSql = `INSERT INTO terminals (id,name,platform_id,game_strategy_id,bet_strategy_id,bet_strategy_win_id,bet_strategy_loss_id,bet_plan_id,bet_plan_win_id,bet_plan_loss_id,screen_profile_id,mode,enabled,paused,initial_bankroll_cents,current_bankroll_cents,game_wins,game_losses,created_at,updated_at,sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,platform_id=excluded.platform_id,game_strategy_id=excluded.game_strategy_id,bet_strategy_id=excluded.bet_strategy_id,bet_strategy_win_id=excluded.bet_strategy_win_id,bet_strategy_loss_id=excluded.bet_strategy_loss_id,bet_plan_id=excluded.bet_plan_id,bet_plan_win_id=excluded.bet_plan_win_id,bet_plan_loss_id=excluded.bet_plan_loss_id,screen_profile_id=excluded.screen_profile_id,mode=excluded.mode,enabled=excluded.enabled,paused=excluded.paused,initial_bankroll_cents=excluded.initial_bankroll_cents,current_bankroll_cents=excluded.current_bankroll_cents,updated_at=excluded.updated_at`;
      for (const item of archive.terminals) this.db.prepare(terminalSql).run(item.id,item.name,item.platformId,item.gameStrategyId,item.betStrategyId,item.betStrategyWinId,item.betStrategyLossId,item.betPlanId,item.betPlanWinId,item.betPlanLossId,item.screenProfileId,item.mode,Number(item.enabled),Number(item.paused),item.initialBankrollCents,item.currentBankrollCents,item.gameWins,item.gameLosses,item.createdAt,item.updatedAt,item.sortOrder);
      const profileSql = `INSERT INTO screen_profiles VALUES (?, ?, ?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET name=excluded.name,config_json=excluded.config_json,updated_at=excluded.updated_at`;
      for (const item of archive.screenProfiles) { const config={resolutionWidth:item.resolutionWidth,resolutionHeight:item.resolutionHeight,windowTitle:item.windowTitle,monitorIndex:item.monitorIndex??null,calibratedAt:item.calibratedAt??null,bet1:item.bet1,bet2:item.bet2}; this.db.prepare(profileSql).run(item.id,item.terminalId,item.name,JSON.stringify(config),item.updatedAt); this.db.prepare('UPDATE terminals SET screen_profile_id=? WHERE id=?').run(item.id,item.terminalId); }
      for(const item of archive.terminalSchedules??[])this.db.prepare('INSERT INTO terminal_schedule_assignments VALUES (?, ?, ?) ON CONFLICT(terminal_id) DO UPDATE SET schedule_plan_id=excluded.schedule_plan_id,updated_at=excluded.updated_at').run(item.terminalId,item.schedulePlanId,item.updatedAt);
      for(const item of archive.terminalControlRules??[])this.db.prepare('INSERT INTO terminal_control_rules (id,name,enabled,source_terminal_id,target_terminal_id,metric,operator,value,action,created_at,updated_at,sort_order,resume_metric,resume_operator,resume_value,reference_metric,resume_reference_metric) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,enabled=excluded.enabled,source_terminal_id=excluded.source_terminal_id,target_terminal_id=excluded.target_terminal_id,metric=excluded.metric,operator=excluded.operator,value=excluded.value,action=excluded.action,resume_metric=excluded.resume_metric,resume_operator=excluded.resume_operator,resume_value=excluded.resume_value,reference_metric=excluded.reference_metric,resume_reference_metric=excluded.resume_reference_metric,updated_at=excluded.updated_at').run(item.id,item.name,Number(item.enabled),item.sourceTerminalId,item.targetTerminalId,item.metric,item.operator,item.value,item.action,item.createdAt,item.updatedAt,item.sortOrder,item.resumeMetric??null,item.resumeOperator??null,item.resumeValue??null,item.referenceMetric??null,item.resumeReferenceMetric??null);
      this.db.exec('COMMIT'); this.log('SYSTEM','INFO','WORKSPACE_IMPORTED',{platforms:archive.platforms.length,terminals:archive.terminals.length});
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
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
    this.db.prepare('INSERT INTO event_logs VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), category, level, event, JSON.stringify(metadata), new Date().toISOString());
  }
}

function mapPlatform(value: unknown): Platform {
  const r = value as Record<string, string | number>;
  return { id: String(r.id), name: String(r.name), slug: String(r.slug), game: String(r.game), enabled: Boolean(r.enabled), sourceType: 'TIPMINER', tipMinerRoundUuid: String(r.tipminer_round_uuid), pollIntervalMs: Number(r.poll_interval_ms), requestTimeoutMs: Number(r.request_timeout_ms), historyLimit: Number(r.history_limit), collectorStatus: String(r.collector_status) as Platform['collectorStatus'], createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
}

function mapTerminal(value: unknown): Terminal {
  const r = value as Record<string, string | number | null>;
  return { id: String(r.id), name: String(r.name), sortOrder:Number(r.sort_order)||0, platformId: String(r.platform_id), gameStrategyId: String(r.game_strategy_id), betStrategyId: String(r.bet_strategy_id),betStrategyWinId:String(r.bet_strategy_win_id??r.bet_strategy_id),betStrategyLossId:String(r.bet_strategy_loss_id??r.bet_strategy_id), betPlanId: String(r.bet_plan_id),betPlanWinId:String(r.bet_plan_win_id??r.bet_plan_id),betPlanLossId:String(r.bet_plan_loss_id??r.bet_plan_id), screenProfileId: r.screen_profile_id ? String(r.screen_profile_id) : null, mode: String(r.mode) as Terminal['mode'], enabled: Boolean(r.enabled), paused: Boolean(r.paused), initialBankrollCents: Number(r.initial_bankroll_cents), currentBankrollCents: Number(r.current_bankroll_cents), gameWins: Number(r.game_wins), gameLosses: Number(r.game_losses), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
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
  const stageCount = Math.max(1, Math.min(20, Number(config.stages ?? 1)));
  const legCount = Math.max(1, Math.min(10, Number(config.legs ?? 1)));
  return { stages: Array.from({ length: stageCount }, (_, stageIndex) => ({
    index: stageIndex, label: stageIndex === 0 ? 'BASE' : `GALE ${stageIndex}`,
    legs: Array.from({ length: legCount }, (_, legIndex) => ({ slot: legIndex + 1, amountCents: 100 * 2 ** stageIndex, cashout: legIndex === 0 ? 2 : 10 }))
  })) };
}

function configurationTable(kind: ConfigurationKind) { return kind === 'GAME_STRATEGY' ? 'game_strategies' : kind === 'BET_STRATEGY' ? 'bet_strategies' : kind === 'BET_PLAN' ? 'bet_plans' : 'schedule_plans'; }
