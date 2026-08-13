import path from 'node:path';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { RoundArchiveStatus } from '@aviator/shared';
import { ArchiveDatabase } from './archive-database.js';

interface ArchiveManifest {
  format: 'AVIATOR_ROUND_ARCHIVE_MANIFEST';
  version: 1;
  publishedAt: string;
  snapshot: string;
  sha256: string;
  totalRounds: number;
  retentionPerPlatform: number;
}

export class ArchiveSyncService {
  private syncDirectory: string | null = null;
  private syncMode: RoundArchiveStatus['syncMode'] = null;
  private lastPublishedAt: string | null = null;
  private lastImportedAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly archive: ArchiveDatabase) {}

  configure(directory: string | null, mode: RoundArchiveStatus['syncMode']) { this.syncDirectory = directory; this.syncMode = directory ? mode : null; this.lastError = null; }

  async publish(): Promise<string> {
    if (!this.syncDirectory) throw new Error('Selecione uma pasta sincronizada do Google Drive.');
    const directory = path.join(this.syncDirectory, 'AviatorData');
    const snapshots = path.join(directory, 'snapshots');
    await mkdir(snapshots, { recursive: true });
    this.archive.checkpoint();
    const snapshotName = 'aviator-round-archive.db';
    const destination = path.join(snapshots, snapshotName);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(this.archive.path, temporary);
      await rm(destination, { force: true });
      await rename(temporary, destination);
      const bytes = await readFile(destination);
      const status = this.archive.status();
      const manifest: ArchiveManifest = {
        format: 'AVIATOR_ROUND_ARCHIVE_MANIFEST', version: 1, publishedAt: new Date().toISOString(),
        snapshot: `snapshots/${snapshotName}`, sha256: createHash('sha256').update(bytes).digest('hex'),
        totalRounds: status.totalRounds, retentionPerPlatform: status.retentionPerPlatform
      };
      const manifestPath = path.join(directory, 'manifest.json');
      const manifestTemporary = `${manifestPath}.${randomUUID()}.tmp`;
      await writeFile(manifestTemporary, JSON.stringify(manifest, null, 2), 'utf8');
      await rm(manifestPath, { force: true });
      await rename(manifestTemporary, manifestPath);
      this.lastPublishedAt = manifest.publishedAt; this.lastError = null;
      return destination;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async importLatest(): Promise<number> {
    if (!this.syncDirectory) throw new Error('Selecione uma pasta sincronizada do Google Drive.');
    try {
      const directory = path.join(this.syncDirectory, 'AviatorData');
      const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as ArchiveManifest;
      if (manifest.format !== 'AVIATOR_ROUND_ARCHIVE_MANIFEST' || manifest.version !== 1) throw new Error('Manifesto compartilhado inválido.');
      const snapshot = path.resolve(directory, manifest.snapshot);
      if (!snapshot.startsWith(path.resolve(directory) + path.sep)) throw new Error('Caminho de snapshot inválido.');
      const bytes = await readFile(snapshot);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== manifest.sha256) throw new Error('O snapshot ainda está sincronizando ou foi alterado. Tente novamente.');
      const inserted = this.archive.importFrom(snapshot);
      this.lastImportedAt = new Date().toISOString(); this.lastError = null;
      return inserted;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  status(): Omit<RoundArchiveStatus, 'backgroundEnabled'> { return { ...this.archive.status(), syncDirectory: this.syncDirectory, syncMode: this.syncMode, lastPublishedAt: this.lastPublishedAt, lastImportedAt: this.lastImportedAt, lastError: this.lastError }; }
}
