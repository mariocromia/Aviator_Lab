import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0b0e11', panel: '#161b22', elevated: '#1c232d', line: '#2d333b',
        muted: '#8b949e', ink: '#e6edf3', brand: '#3b82f6', success: '#22c55e',
        warning: '#f59e0b', danger: '#ef4444'
      },
      fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      boxShadow: { panel: '0 12px 32px rgba(0,0,0,.22)' }
    }
  },
  plugins: [forms]
} satisfies Config;
