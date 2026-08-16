import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Crosshair, Monitor, MousePointer2, Play, ShieldCheck, XCircle } from 'lucide-react';
import type { ScreenCoordinateKey, ScreenMockRun, ScreenPosition, ScreenProfile, Terminal } from '@aviator/shared';
import { Badge, Button, Card, Modal } from '@/components/ui';
import { useAppStore } from '@/store/app-store';

const coordinates: Array<{ key: ScreenCoordinateKey; label: string }> = [
  { key: 'bet1.amount', label: 'Bet 1 • Campo valor' },
  { key: 'bet1.cashout', label: 'Bet 1 • Campo cashout' },
  { key: 'bet1.action', label: 'Bet 1 • Botão apostar' },
  { key: 'bet2.amount', label: 'Bet 2 • Campo valor' },
  { key: 'bet2.cashout', label: 'Bet 2 • Campo cashout' },
  { key: 'bet2.action', label: 'Bet 2 • Botão apostar' }
];

export function ScreenProfilesPage() {
  const store = useAppStore();
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [mock, setMock] = useState<ScreenMockRun | null>(null);
  return <div className="p-5">
    <div className="mb-5"><h2 className="text-xl font-bold">Perfis de tela e calibração</h2><p className="mt-1 text-xs text-muted">Mapeamento visual independente por Terminal, com captura segura e controlador simulado.</p></div>
    <div className="mb-3 grid grid-cols-3 gap-3"><Summary label="Terminais" value={store.terminals.length}/><Summary label="Perfis configurados" value={store.screenProfiles.length}/><Summary label="Aguardando calibração" value={store.terminals.filter(item => !store.screenProfiles.some(profile => profile.terminalId === item.id)).length}/></div>
    <div className="grid gap-3 xl:grid-cols-2">{store.terminals.map(item => {
      const profile = store.screenProfiles.find(value => value.terminalId === item.id);
      return <Card key={item.id} className="p-4"><div className="flex items-start"><div className={`grid h-10 w-10 place-items-center rounded-lg ${profile ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}><Monitor size={19}/></div><div className="ml-3"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{item.name}</h3><Badge tone={profile ? 'success' : 'warning'}>{profile ? 'CONFIGURADO' : 'PENDENTE'}</Badge></div><div className="mt-1 font-mono text-[9px] text-muted">{profile ? `${profile.resolutionWidth}x${profile.resolutionHeight} • monitor ${profile.monitorIndex ?? 0}` : 'Nenhum perfil vinculado'}</div></div><Button onClick={() => { setTerminal(item); setMock(null); }} className="ml-auto border-line bg-elevated text-muted"><Crosshair size={13}/>{profile ? 'Recalibrar' : 'Calibrar'}</Button></div>{profile && <div className="mt-4 grid grid-cols-3 gap-2"><Info label="Bet 1" value={profile.bet1.enabled ? 'ATIVA' : 'INATIVA'}/><Info label="Bet 2" value={profile.bet2.enabled ? 'ATIVA' : 'INATIVA'}/><Info label="Calibração" value={profile.calibratedAt ? new Date(profile.calibratedAt).toLocaleDateString('pt-BR') : '—'}/></div>}</Card>;
    })}</div>
    <CalibrationModal terminal={terminal} profile={terminal ? store.screenProfiles.find(item => item.terminalId === terminal.id) ?? null : null} mock={mock} setMock={setMock} onClose={() => setTerminal(null)}/>
  </div>;
}

function CalibrationModal({ terminal, profile, mock, setMock, onClose }: { terminal: Terminal | null; profile: ScreenProfile | null; mock: ScreenMockRun | null; setMock(value: ScreenMockRun | null): void; onClose(): void }) {
  const store = useAppStore();
  const [draft, setDraft] = useState<ScreenProfile | null>(null);
  const [capturing, setCapturing] = useState<ScreenCoordinateKey | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [saving, setSaving] = useState(false);
  const [automationPaused, setAutomationPaused] = useState(true);
  const [physicalError, setPhysicalError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminal) return;
    const slot = { enabled: true, amountCents: 100, cashout: 2, amount: { x: 0, y: 0 }, cashoutField: { x: 0, y: 0 }, action: { x: 0, y: 0 } };
    setDraft(profile ? structuredClone(profile) : { id: '', terminalId: terminal.id, name: `Perfil ${terminal.name}`, resolutionWidth: 1920, resolutionHeight: 1080, windowTitle: null, monitorIndex: 0, calibratedAt: null, bet1: slot, bet2: { ...structuredClone(slot), enabled: false, cashout: 10 }, updatedAt: new Date().toISOString() });
  }, [terminal?.id, profile?.updatedAt]);
  useEffect(() => { if (terminal) void window.aviator.getScreenAutomationStatus().then(result => { if (result.ok && result.data) setAutomationPaused(result.data.paused); }); }, [terminal?.id]);

  const points = useMemo(() => draft ? coordinates.map(item => ({ ...item, point: getPoint(draft, item.key), enabled: item.key.startsWith('bet1') ? draft.bet1.enabled : draft.bet2.enabled })) : [], [draft]);
  if (!draft) return <Modal title="Calibração" open={false} onClose={onClose}><span/></Modal>;

  async function capture(key: ScreenCoordinateKey) {
    setCapturing(key); setMock(null);
    for (let value = 3; value >= 1; value--) { setCountdown(value); await new Promise(resolve => window.setTimeout(resolve, 1_000)); }
    const result = await window.aviator.captureScreenCoordinate();
    if (result.ok && result.data) setDraft(current => current ? setPoint({ ...current, resolutionWidth: result.data!.resolutionWidth, resolutionHeight: result.data!.resolutionHeight, monitorIndex: result.data!.monitorIndex }, key, { x: result.data!.x, y: result.data!.y }) : current);
    setCountdown(0); setCapturing(null);
  }

  async function save(close = true) {
    setSaving(true);
    const result = await window.aviator.saveScreenProfile({ ...draft, calibratedAt: new Date().toISOString() });
    setSaving(false);
    if (!result.ok || !result.data) { setPhysicalError(result.error ?? 'Não foi possível salvar o perfil.'); return false; }
    setDraft(result.data); await store.refresh(); if (close) onClose(); return true;
  }

  async function test() {
    const terminalId = draft!.terminalId;
    if (!await save(false)) return;
    const result = await window.aviator.runScreenMock(terminalId);
    if (result.ok && result.data) setMock(result.data);
  }

  async function setAutomation(paused: boolean) { const result = await window.aviator.setScreenAutomationPaused(paused); if (result.ok) { setAutomationPaused(paused); setPhysicalError(null); } else setPhysicalError(result.error ?? 'Não foi possível alterar a automação.'); }
  async function testPhysicalCoordinate(key: ScreenCoordinateKey) {
    setPhysicalError(null);
    if (!await save(false)) return;

    if (automationPaused) {
      const activation = await window.aviator.setScreenAutomationPaused(false);
      if (!activation.ok) { setPhysicalError(activation.error ?? 'Não foi possível ativar o modo assistido.'); return; }
      setAutomationPaused(false);
    }
    const result = await window.aviator.testScreenCoordinate(draft!.terminalId, key);
    if (!result.ok) setPhysicalError(result.error ?? 'O teste físico falhou.');
  }
  async function testRealPreparation() {
    setPhysicalError(null);
    if (!await save(false)) return;
    if (!window.confirm('O bot focará a janela e preencherá valor/cashout. Os botões de ação NÃO serão clicados. Continuar?')) return;
    const result = await window.aviator.testAssistedPreparation(draft!.terminalId);
    if (!result.ok) setPhysicalError(result.error ?? 'O preenchimento assistido falhou.');
  }

  return <Modal className="max-w-6xl" title={`Calibração segura • ${terminal?.name ?? ''}`} open={terminal !== null} onClose={onClose}>
    <div className="grid h-[min(760px,calc(100vh-9rem))] min-h-0 grid-cols-[390px_1fr] overflow-hidden">
      <section className="flex min-h-0 flex-col border-r border-line">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-md border border-brand/25 bg-brand/10 p-3 text-[10px] leading-5 text-blue-100"><ShieldCheck size={15} className="mb-1 text-blue-300"/>Ao capturar, você terá 3 segundos para posicionar o cursor no alvo. O mock não move o mouse nem confirma apostas.</div>
          <div className="grid grid-cols-2 gap-3"><Label text="Nome"><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></Label><Label text="Monitor"><input type="number" min="0" value={draft.monitorIndex ?? 0} onChange={event => setDraft({ ...draft, monitorIndex: Number(event.target.value) })}/></Label><Label text="Largura"><input type="number" value={draft.resolutionWidth} onChange={event => setDraft({ ...draft, resolutionWidth: Number(event.target.value) })}/></Label><Label text="Altura"><input type="number" value={draft.resolutionHeight} onChange={event => setDraft({ ...draft, resolutionHeight: Number(event.target.value) })}/></Label><Label text="Título da janela" wide><input value={draft.windowTitle ?? ''} onChange={event => setDraft({ ...draft, windowTitle: event.target.value || null })} placeholder="Opcional"/></Label></div>
          <div className="mt-4 flex gap-4 text-[10px]"><Toggle label="Bet 1" checked={draft.bet1.enabled} onChange={enabled => setDraft({ ...draft, bet1: { ...draft.bet1, enabled } })}/><Toggle label="Bet 2" checked={draft.bet2.enabled} onChange={enabled => setDraft({ ...draft, bet2: { ...draft.bet2, enabled } })}/></div>
          <TestValues profile={draft} onChange={setDraft}/>
          <InactivityBet profile={draft} onChange={setDraft}/>
          <div className="mt-4 space-y-2">{points.map(item => <div key={item.key} className={`rounded-md border p-3 ${item.enabled ? 'border-line bg-canvas' : 'border-line/50 opacity-45'}`}><div className="flex items-center justify-between gap-2"><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">{item.label}</div><div className="mt-1 font-mono text-[9px] text-muted">X {item.point.x} • Y {item.point.y}</div></div><Button disabled={!item.enabled || capturing !== null} onClick={() => void capture(item.key)} className="border-line bg-elevated px-2 text-muted"><MousePointer2 size={12}/>{capturing === item.key ? `${countdown}s` : 'Capturar'}</Button><Button disabled={!item.enabled || capturing !== null || saving} onClick={() => void testPhysicalCoordinate(item.key)} className="border-line bg-elevated px-2 text-warning">Testar clique</Button></div></div>)}</div>
          {physicalError && <div className="mt-3 rounded-md border border-danger/25 bg-danger/10 p-3 text-[10px] leading-5 text-red-200">{physicalError}</div>}
        </div>
        <footer className="shrink-0 border-t border-line bg-panel p-4 shadow-[0_-10px_30px_rgba(0,0,0,.25)]"><div className="mb-2 flex items-center justify-between text-[9px] text-muted"><span>Emergência: Ctrl+Shift+F12</span><button onClick={() => void setAutomation(!automationPaused)} className={`rounded-full border px-2 py-1 font-bold ${automationPaused ? 'border-warning/30 text-warning' : 'border-success/30 text-success'}`}>{automationPaused ? 'ATIVAR ASSISTIDO' : 'ASSISTIDO ATIVO'}</button></div><div className="grid grid-cols-3 gap-2"><Button onClick={() => void save()} disabled={saving || capturing !== null} className="border-line bg-elevated px-2 text-ink">{saving ? 'Salvando...' : 'Salvar'}</Button><Button onClick={() => void test()} disabled={saving || capturing !== null} className="border-line bg-elevated px-2 text-muted"><Play size={12}/>Mock</Button><Button onClick={() => void testRealPreparation()} disabled={saving || capturing !== null || automationPaused} className="bg-brand px-2 text-white">Preencher real</Button></div></footer>
      </section>
      <section className="min-h-0 overflow-y-auto p-5"><div className="mb-3 flex items-center justify-between"><div><div className="label">Prévia proporcional</div><div className="mt-1 text-xs text-muted">{draft.resolutionWidth} × {draft.resolutionHeight}</div></div>{mock && <Badge tone={mock.validation.valid ? 'success' : 'danger'}>{mock.validation.valid ? 'VÁLIDO' : 'INVÁLIDO'}</Badge>}</div><div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-[#080b10]"><div className="absolute inset-x-0 top-0 h-7 border-b border-line bg-elevated/70 px-3 py-2 font-mono text-[8px] text-muted">{draft.windowTitle ?? 'Janela Aviator simulada'}</div>{points.filter(item => item.enabled).map((item, index) => <div key={item.key} title={item.label} className={`absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 font-mono text-[9px] font-bold ${mock?.steps.some(step => step.coordinateKey === item.key) ? 'animate-pulse border-success bg-success/25 text-success' : 'border-brand bg-brand/20 text-blue-200'}`} style={{ left: `${Math.min(100, Math.max(0, item.point.x / draft.resolutionWidth * 100))}%`, top: `${Math.min(100, Math.max(0, item.point.y / draft.resolutionHeight * 100))}%` }}>{index + 1}</div>)}</div><div className="mt-4 grid grid-cols-2 gap-3"><Info label="Coordenadas ativas" value={String(points.filter(item => item.enabled).length)}/><Info label="Ações físicas" value="BLOQUEADAS"/></div>{mock && <div className={`mt-4 rounded-md border p-4 ${mock.validation.valid ? 'border-success/25 bg-success/10' : 'border-danger/25 bg-danger/10'}`}><div className="flex items-center gap-2 text-xs font-semibold">{mock.validation.valid ? <CheckCircle2 size={16} className="text-success"/> : <XCircle size={16} className="text-danger"/>}{mock.validation.valid ? 'Simulação concluída com segurança' : 'Validação bloqueou a simulação'}</div>{mock.validation.issues.map(issue => <div key={issue} className="mt-2 text-[10px] text-red-200">• {issue}</div>)}</div>}</section>
    </div>
  </Modal>;
}

function TestValues({profile,onChange}:{profile:ScreenProfile;onChange(value:ScreenProfile):void}) {
  const update=(name:'bet1'|'bet2',patch:Partial<ScreenProfile['bet1']>)=>onChange({...profile,[name]:{...profile[name],...patch}});
  return <div className="mt-4 rounded-md border border-brand/20 bg-brand/5 p-3"><div className="mb-2 text-[10px] font-bold text-blue-200">VALORES SOMENTE PARA TESTAR O PREENCHIMENTO</div><div className="grid grid-cols-2 gap-2"><Label text="Bet 1 • Valor (R$)"><input type="number" min="0.01" step="0.01" value={(profile.bet1.amountCents/100).toFixed(2)} onChange={event=>update('bet1',{amountCents:Math.round(Number(event.target.value)*100)})}/></Label><Label text="Bet 1 • Saída"><input type="number" min="1.01" step="0.01" value={profile.bet1.cashout} onChange={event=>update('bet1',{cashout:Number(event.target.value)})}/></Label><Label text="Bet 2 • Valor (R$)"><input type="number" min="0.01" step="0.01" value={(profile.bet2.amountCents/100).toFixed(2)} onChange={event=>update('bet2',{amountCents:Math.round(Number(event.target.value)*100)})}/></Label><Label text="Bet 2 • Saída"><input type="number" min="1.01" step="0.01" value={profile.bet2.cashout} onChange={event=>update('bet2',{cashout:Number(event.target.value)})}/></Label></div><p className="mt-2 text-[9px] text-muted">Nas apostas normais, valor e saída vêm dinamicamente da etapa BASE/Gale do plano.</p></div>;
}

function InactivityBet({profile,onChange}:{profile:ScreenProfile;onChange(value:ScreenProfile):void}) {
  const rule=profile.inactivityBet??{enabled:false,minutes:5,slot:2 as const,amountCents:100,cashout:1.05};
  const update=(patch:Partial<typeof rule>)=>onChange({...profile,inactivityBet:{...rule,...patch}});
  return <div className="mt-4 rounded-md border border-warning/25 bg-warning/5 p-3"><Toggle label="Anti-inatividade na Bet 2" checked={rule.enabled} onChange={enabled=>update({enabled})}/><div className="mt-3 grid grid-cols-3 gap-2"><Label text="Após minutos"><input type="number" min="1" max="1440" value={rule.minutes} onChange={event=>update({minutes:Number(event.target.value)})}/></Label><Label text="Valor Bet 2 (R$)"><input type="number" min="0.01" step="0.01" value={(rule.amountCents/100).toFixed(2)} onChange={event=>update({amountCents:Math.round(Number(event.target.value)*100)})}/></Label><Label text="Saída"><input type="number" min="1.01" step="0.01" value={rule.cashout} onChange={event=>update({cashout:Number(event.target.value)})}/></Label></div><p className="mt-2 text-[9px] text-muted">Executa uma vez após o período sem atividade no Windows e rearma quando houver novo movimento ou tecla.</p></div>;
}
function getPoint(profile: ScreenProfile, key: ScreenCoordinateKey): ScreenPosition { const slot = key.startsWith('bet1') ? profile.bet1 : profile.bet2; return key.endsWith('.amount') ? slot.amount : key.endsWith('.cashout') ? slot.cashoutField : slot.action; }
function setPoint(profile: ScreenProfile, key: ScreenCoordinateKey, point: ScreenPosition): ScreenProfile { const name = key.startsWith('bet1') ? 'bet1' : 'bet2'; const slot = { ...profile[name] }; if (key.endsWith('.amount')) slot.amount = point; else if (key.endsWith('.cashout')) slot.cashoutField = point; else slot.action = point; return { ...profile, [name]: slot }; }
function Summary({ label, value }: { label: string; value: number }) { return <Card className="p-4"><div className="label">{label}</div><div className="mt-2 font-mono text-xl font-bold">{value}</div></Card>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-line bg-canvas p-3"><div className="label">{label}</div><div className="mt-1 truncate font-mono text-[10px] font-bold">{value}</div></div>; }
function Label({ text, children, wide = false }: { text: string; children: ReactNode; wide?: boolean }) { return <label className={wide ? 'col-span-2' : ''}><span className="label">{text}</span><div className="form-field mt-1.5">{children}</div></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>{label}</label>; }
