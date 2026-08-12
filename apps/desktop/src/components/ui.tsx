import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn('inline-flex h-9 items-center justify-center gap-2 rounded-md border border-transparent px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('rounded-lg border border-line bg-panel shadow-panel', className)} {...props} />; }
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'brand' | 'neutral' }) {
  const styles = { success: 'border-success/25 bg-success/10 text-success', warning: 'border-warning/25 bg-warning/10 text-warning', danger: 'border-danger/25 bg-danger/10 text-danger', brand: 'border-brand/25 bg-brand/10 text-blue-300', neutral: 'border-line bg-elevated text-muted' };
  return <span className={cn('inline-flex w-fit self-center justify-self-start items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', styles[tone])}>{children}</span>;
}
export function Modal({ title, open, onClose, children, className }: { title: string; open: boolean; onClose(): void; children: ReactNode; className?: string }) {
  if (!open) return null;
  return createPortal(<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={(event)=>{if(event.target===event.currentTarget)onClose()}}><Card className={cn('max-h-[calc(100vh-1.5rem)] w-full max-w-xl overflow-y-auto sm:max-h-[calc(100vh-3rem)]', className)}><div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-4"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button></div>{children}</Card></div>,document.body);
}
