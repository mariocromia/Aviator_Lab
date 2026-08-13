import type { CollectorSnapshot, NormalizedRound, Platform } from '@aviator/shared';
import { LiveRoundClassifier, RoundDeduplicator, TipMinerClient, TipMinerRoundNormalizer, type FetchLike } from '@aviator/tipminer';
import { AppDatabase } from './database.js';
import { ArchiveDatabase } from './archive-database.js';

type DataChangedCallback = () => void;

class PlatformCollector {
  private readonly primaryPlatformId: string;
  private running = false;
  private polling = false;
  private lastPollAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private status: CollectorSnapshot['status'] = 'OFFLINE';
  private lastRetentionAt=0;

  constructor(
    private platforms: Platform[],
    private readonly client: TipMinerClient,
    private readonly database: AppDatabase,
    private readonly archive: ArchiveDatabase,
    private readonly deduplicator: RoundDeduplicator,
    private readonly classifier: LiveRoundClassifier,
    private readonly normalizer: TipMinerRoundNormalizer,
    private readonly onDataChanged: DataChangedCallback,
    private readonly onRound: (round: NormalizedRound) => Promise<void>
  ) {
    this.primaryPlatformId = platforms[0].id;
    this.hydratePrimaryPlatform();
  }

  private get primaryPlatform(): Platform { return this.platforms.find(platform => platform.id === this.primaryPlatformId) ?? this.platforms[0]; }

  updatePlatforms(platforms: Platform[]) {
    this.platforms = platforms;
    this.hydratePrimaryPlatform();
  }

  hasPlatform(platformId: string) { return this.platforms.some(platform => platform.id === platformId); }

  private hydratePrimaryPlatform() {
    const platform = this.primaryPlatform;
    this.deduplicator.hydrate(platform.id, this.database.getRoundDedupKeys(platform.id));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.database.logEvent('COLLECTOR', 'INFO', 'COLLECTOR_STARTED', { platformId: this.primaryPlatform.id, tipMinerRoundUuid: this.primaryPlatform.tipMinerRoundUuid });
    void this.runLoop();
  }

  stop() { this.running = false; }

  async syncNow() { if (!this.polling) await this.poll(); }

  snapshots(): CollectorSnapshot[] {
    const persistedRounds = this.database.countRounds(this.primaryPlatform.id);
    return this.platforms.map(platform => ({ platformId: platform.id, status: this.status, running: this.running, polling: this.polling, lastPollAt: this.lastPollAt, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, consecutiveFailures: this.consecutiveFailures, persistedRounds }));
  }

  private async runLoop() {
    while (this.running) {
      await this.poll();
      if (this.running) await sleep(Math.min(...this.platforms.map(platform => platform.pollIntervalMs)));
    }
  }

  private async poll() {
    const platform = this.primaryPlatform;
    this.polling = true; this.lastPollAt = new Date().toISOString();
    this.database.logEvent('TIPMINER', 'DEBUG', 'POLL_STARTED', { platformId: platform.id, sharedPlatforms: this.platforms.length });
    try {
      const raw = await this.client.getHistory({ roundUuid: platform.tipMinerRoundUuid, limit: Math.max(...this.platforms.map(item => item.historyLimit)), timeoutMs: Math.max(...this.platforms.map(item => item.requestTimeoutMs)) });
      const normalized = this.normalizer.normalizeMany(raw, platform.id);
      const archived = this.archive.insertFeedRounds(this.platforms, normalized);
      const unseen = this.deduplicator.filterUnseen(normalized);
      const classified = this.classifier.classify(platform.id, unseen);
      let inserted = 0;
      for (const round of classified) {
        if (!this.database.insertRound(round)) continue;
        inserted++;
        for (const linkedPlatform of this.platforms) await this.onRound({ ...round, platformId: linkedPlatform.id });
      }
      const statusChanged = this.status !== 'ONLINE';
      this.status = 'ONLINE'; this.lastSuccessAt = new Date().toISOString(); this.lastError = null; this.consecutiveFailures = 0;
      for (const linkedPlatform of this.platforms) this.database.updateCollectorStatus(linkedPlatform.id, 'ONLINE');
      if(Date.now()-this.lastRetentionAt>3_600_000){this.database.pruneRetention(10_000,30);this.archive.prune();this.lastRetentionAt=Date.now();}
      this.database.logEvent('TIPMINER', 'INFO', 'POLL_SUCCESS', { platformId: platform.id, sharedPlatforms: this.platforms.length, received: raw.length, unseen: unseen.length, inserted, archived });
      if (inserted > 0 || statusChanged) this.onDataChanged();
    } catch (error) {
      const previousStatus = this.status;
      this.consecutiveFailures++;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.status = this.consecutiveFailures >= 3 ? 'OFFLINE' : 'DEGRADED';
      for (const linkedPlatform of this.platforms) this.database.updateCollectorStatus(linkedPlatform.id, this.status);
      this.database.logEvent('TIPMINER', 'ERROR', 'POLL_ERROR', { platformId: platform.id, sharedPlatforms: this.platforms.length, error: this.lastError, consecutiveFailures: this.consecutiveFailures });
      if (previousStatus !== this.status) this.onDataChanged();
    } finally { this.polling = false; }
  }
}

export class CollectorManager {
  private readonly collectors = new Map<string, PlatformCollector>();
  private readonly client: TipMinerClient;
  private readonly deduplicator = new RoundDeduplicator();
  private readonly classifier = new LiveRoundClassifier();
  private readonly normalizer = new TipMinerRoundNormalizer();

  constructor(fetcher: FetchLike, private readonly database: AppDatabase, private readonly archive: ArchiveDatabase, private readonly onDataChanged: DataChangedCallback, private readonly onRound: (round: NormalizedRound) => Promise<void>) {
    this.client = new TipMinerClient(fetcher);
  }

  syncPlatforms(platforms: Platform[]) {
    const platformsByFeed = new Map<string, Platform[]>();
    for (const platform of platforms) {
      const linkedPlatforms = platformsByFeed.get(platform.tipMinerRoundUuid) ?? [];
      linkedPlatforms.push(platform);
      platformsByFeed.set(platform.tipMinerRoundUuid, linkedPlatforms);
    }
    for (const [tipMinerRoundUuid, linkedPlatforms] of platformsByFeed) {
      const existing = this.collectors.get(tipMinerRoundUuid);
      if (existing) { existing.updatePlatforms(linkedPlatforms); continue; }
      const collector = new PlatformCollector(linkedPlatforms, this.client, this.database, this.archive, this.deduplicator, this.classifier, this.normalizer, this.onDataChanged, this.onRound);
      this.collectors.set(tipMinerRoundUuid, collector); collector.start();
    }
    for (const [tipMinerRoundUuid, collector] of this.collectors) {
      if (platformsByFeed.has(tipMinerRoundUuid)) continue;
      collector.stop();
      this.collectors.delete(tipMinerRoundUuid);
    }
  }

  snapshots(): CollectorSnapshot[] { return [...this.collectors.values()].flatMap(collector => collector.snapshots()); }
  async syncNow(platformId: string) { await [...this.collectors.values()].find(collector => collector.hasPlatform(platformId))?.syncNow(); }
  stopAll() { for (const collector of this.collectors.values()) collector.stop(); }
}

function sleep(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }
