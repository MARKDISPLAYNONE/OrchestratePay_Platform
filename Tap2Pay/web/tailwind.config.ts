import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        void:    '#05070F',
        navy:    { DEFAULT: '#0A1628', 800: '#080F1E', 700: '#0F1F3D', 600: '#142947' },
        electric: '#00AFFF',
        neon:    '#00D4FF',
        chrome:  { DEFAULT: '#8B9BB4', light: '#C8D4E8' },
        brand: {
          50:  '#e6f7ff',
          100: '#b3e7ff',
          200: '#80d5ff',
          300: '#4dc3ff',
          400: '#1ab1ff',
          500: '#00AFFF',
          600: '#0099e6',
          700: '#007ab8',
          800: '#005c8a',
          900: '#003d5c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'glow-sm':  '0 0 12px rgba(0,175,255,0.25)',
        'glow':     '0 0 24px rgba(0,175,255,0.35)',
        'glow-lg':  '0 0 48px rgba(0,175,255,0.3), 0 0 120px rgba(0,175,255,0.1)',
        'glass':    '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'card':     '0 4px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(0,175,255,0.08) inset',
      },
      backgroundImage: {
        'void-radial':   'radial-gradient(ellipse at 50% 0%, #0A1E38 0%, #05070F 60%)',
        'blue-radial':   'radial-gradient(circle, rgba(0,175,255,0.12) 0%, transparent 70%)',
        'chrome-linear': 'linear-gradient(135deg, #14181f 0%, #2d3440 30%, #8f98a7 55%, #313845 80%, #111418 100%)',
        'electric-gradient': 'linear-gradient(135deg, #00AFFF 0%, #0066CC 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'float':      'float 4s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'shimmer':    'shimmer 2s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(0,175,255,0.25)' },
          '50%':      { boxShadow: '0 0 32px rgba(0,175,255,0.6)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
