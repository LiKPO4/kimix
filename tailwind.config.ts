import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          elevated: 'var(--bg-elevated)',
          composer: 'var(--bg-composer)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          accent: 'var(--text-accent)',
        },
        accent: {
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          yellow: 'var(--accent-yellow)',
          red: 'var(--accent-red)',
          orange: 'var(--accent-orange)',
          purple: 'var(--accent-purple)',
        },
      },
      borderRadius: {
        '2xl': '16px',
        'xl': '12px',
        'lg': '8px',
      },
    },
  },
  plugins: [],
} satisfies Config
