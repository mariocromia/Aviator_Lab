import { useState, type FormEvent } from 'react';
import { ArrowRight, Bot, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/store/app-store';

export function LoginPage() {
  const { login, loading, error, clearError } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); clearError(); await login(email, password); }
  return <main className="login-grid grid min-h-screen place-items-center bg-canvas p-5 text-ink">
    <div className="absolute inset-x-0 top-0 h-9 drag-region border-b border-line/60 bg-[#090c10]" />
    <section className="relative w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-panel p-8 shadow-2xl shadow-black/50">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
      <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-2xl border border-brand/25 bg-brand/10 shadow-lg shadow-brand/10"><Bot size={39} strokeWidth={1.5} className="text-blue-300"/></div>
      <div className="mb-7 text-center"><h1 className="text-[22px] font-bold tracking-tight">Aviator Strategy Lab</h1><p className="mt-1.5 text-xs text-muted">Análise quantitativa e automação local</p></div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block"><span className="label">E-mail</span><div className="input-wrap"><Mail size={15}/><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" required /></div></label>
        <label className="block"><div className="flex items-center justify-between"><span className="label">Senha</span><span className="text-[10px] text-blue-300">Acesso local MASTER</span></div><div className="input-wrap"><LockKeyhole size={15}/><input value={password} onChange={e=>setPassword(e.target.value)} type={show?'text':'password'} autoComplete="current-password" required /><button type="button" onClick={()=>setShow(!show)} className="ml-auto text-muted hover:text-ink">{show?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></label>
        {error && <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        <button disabled={loading} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand text-xs font-bold text-white shadow-lg shadow-brand/15 transition hover:bg-blue-600 disabled:opacity-60">{loading?'AUTENTICANDO...':'ENTRAR'}<ArrowRight size={15}/></button>
      </form>
      <div className="mt-7 flex items-center justify-between border-t border-line pt-4 font-mono text-[9px] text-muted"><span>v0.3.0-multiterminal</span><span className="flex items-center gap-1.5 text-success"><ShieldCheck size={12}/> SQLite local</span></div>
    </section>
  </main>;
}
