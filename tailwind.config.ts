import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /* Surface */
        surface: {
          ground: 'var(--surface-ground)',
          base: 'var(--surface-base)',
          elevated: 'var(--surface-elevated)',
          hover: 'var(--surface-hover)',
          active: 'var(--surface-active)',
        },
        /* Text */
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
          placeholder: 'var(--text-placeholder)',
        },
        /* Border */
        border: {
          DEFAULT: 'var(--border-default)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        /* Accent — Primary Blue */
        accent: {
          primary: 'var(--accent-primary)',
          'primary-light': 'var(--accent-primary-light)',
          'primary-soft': 'var(--accent-primary-soft)',
          'primary-dark': 'var(--accent-primary-dark)',
          secondary: 'var(--accent-secondary)',
          'secondary-light': 'var(--accent-secondary-light)',
          success: 'var(--accent-success)',
          'success-light': 'var(--accent-success-light)',
          warning: 'var(--accent-warning)',
          'warning-light': 'var(--accent-warning-light)',
          danger: 'var(--accent-danger)',
          'danger-light': 'var(--accent-danger-light)',
          /* Legacy aliases */
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          yellow: 'var(--accent-yellow)',
          red: 'var(--accent-red)',
          orange: 'var(--accent-orange)',
          purple: 'var(--accent-purple)',
        },
        /* Legacy bg aliases (keep for backward compat) */
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          elevated: 'var(--bg-elevated)',
          composer: 'var(--bg-composer)',
        },
      },
      borderRadius: {
        '2xl': '16px',
        'xl': '12px',
        'lg': '8px',
        'md-token': 'var(--radius-md)',
        'sm-token': 'var(--radius-sm)',
        'lg-token': 'var(--radius-lg)',
      },
      boxShadow: {
        'hover-token': 'var(--shadow-hover)',
        'elevated-token': 'var(--shadow-elevated)',
        'floating-token': 'var(--shadow-floating)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
} satisfies Config
