import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { NormalizedRound, Platform, RoundArchiveStatus } from '@aviator/shared';

export const ARCHIVE_ROUND_LIMIT = 300_000;

export type ArchiveStatus = Pick<RoundArchiveStatus, 'databasePath' | 'retentionPerPlatform' | 'totalRounds' | 'platforms'>;

export class ArchiveDatabase {
  private readonly db: DatabaseSync;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archive_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_platforms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
        tipminer_round_uuid TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive_rounds (
        id TEXT PRIMARY KEY, feed_uuid TEXT NOT NULL, external_id TEXT,
        multiplier REAL NOT NULL, occurred_at TEXT NOT NULL, collected_at TEXT NOT NULL,
        source TEXT NOT NULL, delivery_mode TEXT NOT NULL, dedup_key TEXT NOT NULL,
        raw_data_json TEXT, UNIQUE(feed_uuid, dedup_key)
      );
      CREATE INDEX IF NOT EXISTS archive_rounds_feed_occurred_idx
        ON archive_rounds(feed_uuid, occurred_at DESC);
    `);
    this.db.prepare("INSERT OR REPLACE INTO archive_metadata VALUES ('format', 'AVIATOR_ROUND_ARCHIVE')").run();
    this.db.prepare("INSERT OR REPLACE INTO archive_metadata VALUES ('schema_version', '1')").run();
  }

  registerPlatforms(platforms: Platform[]) {
    const statement = this.db.prepare(`INSERT INTO archive_platforms VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,slug=excluded.slug,
      tipminer_round_uuid=excluded.tipminer_round_uuid,updated_at=excluded.updated_at`);
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const platform of platforms) statement.run(platform.id, platform.name, platform.slug, platform.tipMinerRoundUuid, now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  insertFeedRounds(platforms: Platform[], rounds: NormalizedRound[]): number {
    if (!platforms.length || !rounds.length) return 0;
    this.registerPlatforms(platforms);
    const statement = this.db.prepare(`INSERT OR IGNORE INTO archive_rounds
      (id,feed_uuid,external_id,multiplier,occurred_at,collected_at,source,delivery_mode,dedup_key,raw_data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let inserted = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const feedUuid = platforms[0].tipMinerRoundUuid;
      for (const round of rounds) {
        const result = statement.run(
          randomUUID(), feedUuid, round.externalId, round.multiplier, round.occurredAt,
          round.collectedAt, round.source, round.deliveryMode, round.dedupKey,
          round.rawData == null ? null : JSON.stringify(round.rawData)
        );
        inserted += Number(result.changes);
      }
      this.db.exec('COMMIT');
      return inserted;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  prune(limit = ARCHIVE_ROUND_LIMIT) {
    const feeds = this.db.prepare('SELECT DISTINCT tipminer_round_uuid AS feedUuid FROM archive_platforms').all() as Array<{ feedUuid: string }>;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.db.prepare(`DELETE FROM archive_rounds WHERE feed_uuid=? AND id IN (
        SELECT id FROM archive_rounds WHERE feed_uuid=? ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET ?
      )`);
      for (const feed of feeds) statement.run(feed.feedUuid, feed.feedUuid, limit);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  importFrom(snapshotPath: string): number {
    this.db.exec(`ATTACH DATABASE ${quoteSql(snapshotPath)} AS incoming`);
    try {
      const format = this.db.prepare("SELECT value FROM incoming.archive_metadata WHERE key='format'").get() as { value: string } | undefined;
      if (format?.value !== 'AVIATOR_ROUND_ARCHIVE') throw new Error('Arquivo compartilhado não é um histórico Aviator válido.');
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec(`INSERT OR IGNORE INTO archive_platforms SELECT * FROM incoming.archive_platforms`);
      const result = this.db.prepare(`INSERT OR IGNORE INTO archive_rounds SELECT * FROM incoming.archive_rounds`).run();
      this.db.exec('COMMIT');
      this.db.exec('DETACH DATABASE incoming');
      this.prune();
      return Number(result.changes);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* no active transaction */ }
      try { this.db.exec('DETACH DATABASE incoming'); } catch { /* keep original error */ }
      throw error;
    }
  }

  checkpoint() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }

  getRounds(platformId: string, limit: number, chronological = false): NormalizedRound[] {
    const platform = this.db.prepare('SELECT tipminer_round_uuid AS feedUuid FROM archive_platforms WHERE id=?').get(platformId) as { feedUuid: string } | undefined;
    if (!platform) return [];
    const rows = this.db.prepare('SELECT * FROM archive_rounds WHERE feed_uuid=? ORDER BY occurred_at DESC LIMIT ?').all(platform.feedUuid, limit) as Array<Record<string, string | number | null>>;
    const rounds = rows.map(row => ({
      id:String(row.id),platformId,externalId:row.external_id==null?null:String(row.external_id),multiplier:Number(row.multiplier),
      occurredAt:String(row.occurred_at),collectedAt:String(row.collected_at),source:'TIPMINER' as const,
      deliveryMode:String(row.delivery_mode) as NormalizedRound['deliveryMode'],dedupKey:String(row.dedup_key),
      rawData:row.raw_data_json?JSON.parse(String(row.raw_data_json)) as unknown:undefined
    }));
    return chronological ? rounds.reverse() : rounds;
  }

  status(): ArchiveStatus {
    const total = this.db.prepare('SELECT count(*) AS total FROM archive_rounds').get() as { total: number };
    const platforms = this.db.prepare(`SELECT p.id AS platformId,p.name AS platformName,count(r.id) AS rounds,max(r.occurred_at) AS newestRoundAt
      FROM archive_platforms p LEFT JOIN archive_rounds r ON r.feed_uuid=p.tipminer_round_uuid GROUP BY p.id,p.name ORDER BY p.name`).all() as ArchiveStatus['platforms'];
    return { databasePath: this.path, retentionPerPlatform: ARCHIVE_ROUND_LIMIT, totalRounds: Number(total.total), platforms: platforms.map(item => ({ ...item, rounds: Number(item.rounds) })) };
  }

  close() { this.db.close(); }
}

function quoteSql(value: string) { return `'${value.replaceAll("'", "''")}'`; }
