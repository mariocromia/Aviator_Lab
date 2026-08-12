import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function money(cents: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100); }
export function percent(value: number) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value) + '%'; }

const classificationCollator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Valores positivos são classificados primeiro; zero representa "sem ordem". */
export function sortByClassification<T extends { name: string; sortOrder: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const leftOrder = Number.isFinite(left.sortOrder) && left.sortOrder > 0 ? left.sortOrder : Number.POSITIVE_INFINITY;
    const rightOrder = Number.isFinite(right.sortOrder) && right.sortOrder > 0 ? right.sortOrder : Number.POSITIVE_INFINITY;
    return leftOrder - rightOrder || classificationCollator.compare(left.name, right.name);
  });
}
