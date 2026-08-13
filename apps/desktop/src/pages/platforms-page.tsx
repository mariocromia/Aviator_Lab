import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, CheckCircle2, Database, LoaderCircle, Pencil, Plus, Power, Radio, RefreshCw, Server, WifiOff, XCircle } from 'lucide-react';
import type { Platform, PlatformTestResult } from '@aviator/shared';
import { Badge, Button, Card, Modal } from '@/components/ui';
import { useAppStore } from '@/store/app-store';

export function PlatformsPage() {
  const store = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Platform | null>(null);
  const activeCollector = store.collectors[0];

  function openModal(platform: Platform | null = null) { store.clearError(); setEditing(platform); setModalOpen(true); }

  return <div className="p-5">
    <div className="mb-5 flex items-end justify-between">
      <div><h2 className="text-xl font-bold">Plataformas</h2><p className="mt-1 text-xs text-muted">Fontes TipMiner configuráveis por UUID e collector único.</p></div>
      <Button onClick={() => openModal()} className="bg-brand text-white"><Plus size={14}/> Nova Plataforma</Button>
    </div>
    <div className="grid gap-3 lg:grid-cols-[1.35fr_.65fr]">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1.2fr_.8fr_.9fr_.65fr_110px] border-b border-line bg-elevated/50 px-4 py-2.5 text-[9px] font-bold uppercase tracking-wider text-muted"><span>Plataforma</span><span>Fonte</span><span>Polling</span><span>Status</span><span>Ações</span></div>
        {store.platforms.map(platform => {
          const collector = store.collectors.find(item => item.platformId === platform.id);
          return <div key={platform.id} className={`grid grid-cols-[1.2fr_.8fr_.9fr_.65fr_110px] items-center border-b border-line px-4 py-4 last:border-0 ${!platform.enabled ? 'opacity-55' : ''}`}>
            <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-blue-300"><Database size={17}/></div><div><div className="text-xs font-semibold">{platform.name}</div><div className="font-mono text-[9px] text-muted">{platform.slug} • {platform.game}</div></div></div>
            <div><div className="font-mono text-[10px]">{platform.sourceType}</div><div className="text-[9px] text-muted">{store.platforms.filter(item => item.tipMinerRoundUuid === platform.tipMinerRoundUuid).length > 1 ? 'FEED COMPARTILHADO' : 'REST'}</div></div>
            <div><div className="font-mono text-[10px]">{platform.pollIntervalMs} ms</div><div className="text-[9px] text-muted">{collector?.persistedRounds ?? 0} rodadas</div></div>
            <Badge tone={collector?.status === 'ONLINE' ? 'success' : collector?.status === 'DEGRADED' ? 'warning' : 'neutral'}>{collector?.status ?? platform.collectorStatus}</Badge>
            <div className="flex gap-1"><button onClick={() => openModal(platform)} title="Editar" className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted hover:text-ink"><Pencil size={13}/></button><button onClick={() => void store.syncCollectorNow(platform.id)} disabled={!platform.enabled} title="Sincronizar agora" className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted hover:text-ink disabled:opacity-30"><RefreshCw size={14} className={collector?.polling ? 'animate-spin' : ''}/></button><button onClick={() => void store.setPlatformEnabled(platform.id, !platform.enabled)} title={platform.enabled ? 'Desativar' : 'Ativar'} className={`grid h-8 w-8 place-items-center rounded-md border border-line ${platform.enabled ? 'text-success' : 'text-muted'}`}><Power size={13}/></button></div>
          </div>;
        })}
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between"><div><div className="label">Saúde da API</div><div className="mt-1 text-sm font-semibold">TipMiner REST</div></div><div className={`grid h-9 w-9 place-items-center rounded-lg ${activeCollector?.status === 'ONLINE' ? 'bg-success/10 text-success' : 'bg-elevated text-muted'}`}>{activeCollector?.status === 'ONLINE' ? <Radio size={17}/> : <WifiOff size={17}/>}</div></div>
        <div className="mt-4 space-y-3 rounded-md border border-line bg-canvas p-3 font-mono text-[10px]"><ConsoleRow icon={Server} label="Endpoint" value="Configurado"/><ConsoleRow icon={Radio} label="Collector" value={activeCollector?.status ?? 'INICIANDO'}/><ConsoleRow icon={Activity} label="Último poll" value={activeCollector?.lastPollAt ? new Date(activeCollector.lastPollAt).toLocaleTimeString('pt-BR') : '—'}/></div>
        {activeCollector?.lastError ? <div className="mt-4 rounded-md border border-danger/20 bg-danger/10 p-3 text-[10px] leading-5 text-red-200">{activeCollector.lastError}</div> : <div className="mt-4 rounded-md border border-success/20 bg-success/10 p-3 text-[10px] leading-5 text-green-200">Polling sequencial ativo. Rodadas são deduplicadas e persistidas antes da distribuição operacional.</div>}
      </Card>
    </div>
    <PlatformModal key={editing?.id ?? 'new'} open={modalOpen} editing={editing} onClose={() => setModalOpen(false)}/>
  </div>;
}

function PlatformModal({ open, editing, onClose }: { open: boolean; editing: Platform | null; onClose(): void }) {
  const store = useAppStore();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PlatformTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [uuid, setUuid] = useState('');
  const sharedPlatform = store.platforms.find(platform => platform.tipMinerRoundUuid === uuid.trim());
  const uuidUnchanged = Boolean(editing && editing.tipMinerRoundUuid === uuid.trim());
  useEffect(() => { if (open) { setUuid(editing?.tipMinerRoundUuid ?? ''); setTestResult(null); setTestError(null); } }, [open, editing]);

  function resetAndClose() { store.clearError(); setTestResult(null); setTestError(null); setUuid(''); onClose(); }

  async function testApi() {
    store.clearError(); setTestResult(null); setTestError(null);
    if (!uuid.trim()) { setTestError('Informe o UUID TipMiner antes de testar.'); return; }
    setTesting(true);
    try {
      const result = await window.aviator.testPlatform({ tipMinerRoundUuid: uuid.trim(), requestTimeoutMs: 5_000, historyLimit: 5 });
      if (result.ok && result.data) setTestResult(result.data);
      else setTestError(result.error ?? 'A API não respondeu corretamente.');
    } catch (error) { setTestError(error instanceof Error ? error.message : 'Falha no canal IPC de teste.'); }
    finally { setTesting(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); store.clearError(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      ...(editing ? { id: editing.id } : {}),
      name: form.get('name'), slug: String(form.get('slug')).trim().toLowerCase(), game: 'aviator', tipMinerRoundUuid: uuid.trim(),
      pollIntervalMs: Number(form.get('poll')), requestTimeoutMs: Number(form.get('timeout')), historyLimit: Number(form.get('limit'))
    };
    const saved = editing ? await store.updatePlatform(payload) : await store.createPlatform(payload);
    setSaving(false); if (saved) resetAndClose();
  }

  return <Modal open={open} onClose={resetAndClose} title={editing ? 'Editar Plataforma TipMiner' : 'Nova Plataforma TipMiner'}>
    <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-5">
      <Field label="Nome"><input name="name" defaultValue={editing?.name} required placeholder="Betou"/></Field>
      <Field label="Slug"><input name="slug" defaultValue={editing?.slug} required placeholder="betou" pattern="[A-Za-z0-9-]+" autoCapitalize="none"/></Field>
      <Field label="UUID TipMiner" wide><div className="flex gap-2"><input value={uuid} onChange={event => { setUuid(event.target.value); setTestResult(null); }} required placeholder="00000000-0000-0000-0000-000000000000"/><Button type="button" onClick={() => void testApi()} disabled={testing} className="shrink-0 border-line bg-elevated text-muted hover:text-ink">{testing ? <LoaderCircle size={13} className="animate-spin"/> : <Activity size={13}/>} Testar API</Button></div></Field>
      {testResult && <div className="col-span-2 flex items-center gap-3 rounded-md border border-success/25 bg-success/10 p-3 text-[11px] text-green-200"><CheckCircle2 size={17}/><div><div className="font-semibold">{sharedPlatform ? `Feed compartilhado com ${sharedPlatform.name}` : 'API válida'} • {testResult.latencyMs} ms</div><div className="mt-0.5 text-[10px] text-green-200/70">{testResult.roundsReceived} rodadas • último {testResult.latestMultiplier?.toFixed(2) ?? '—'}x{sharedPlatform ? ' • sem criar outro collector' : ''}</div></div></div>}
      {testError && <Feedback message={testError}/>} {store.error && <Feedback message={store.error}/>} 
      <Field label="Polling (ms)"><input name="poll" type="number" defaultValue={editing?.pollIntervalMs ?? 2000} min="500" required/></Field>
      <Field label="Timeout (ms)"><input name="timeout" type="number" defaultValue={editing?.requestTimeoutMs ?? 1500} min="250" required/></Field>
      <Field label="Histórico"><input name="limit" type="number" defaultValue={editing?.historyLimit ?? 200} min="10" required/></Field><div/>
      <div className="col-span-2 flex justify-end gap-2 pt-2"><Button type="button" onClick={resetAndClose} className="border-line bg-panel text-muted">Cancelar</Button><Button disabled={saving || (!testResult && !uuidUnchanged)} className="bg-brand text-white"><Plus size={13}/>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Testar e cadastrar'}</Button></div>
    </form>
  </Modal>;
}

function Feedback({ message }: { message: string }) { return <div className="col-span-2 flex items-start gap-2 rounded-md border border-danger/25 bg-danger/10 p-3 text-[11px] text-red-200"><XCircle size={15} className="mt-0.5 shrink-0"/><span>{message}</span></div>; }
function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { return <label className={wide ? 'col-span-2' : ''}><span className="label">{label}</span><div className="form-field mt-1.5">{children}</div></label>; }
function ConsoleRow({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) { return <div className="flex items-center gap-2"><Icon size={12} className="text-muted"/><span className="text-muted">{label}</span><span className="ml-auto text-ink">{value}</span></div>; }
