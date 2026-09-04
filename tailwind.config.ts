import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        tactical: {
          dark: "#050B14",
          surface: "#0A1322",
          panel: "#0D1B2E",
          border: "#1E385B",
          radar: "#00FF88",
          cyber: "#00E5FF",
          amber: "#FFB800",
          alert: "#FF2A55",
          muted: "#4A6B8F",
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      animation: {
        'radar-sweep': 'sweep 4s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        sweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', filter: 'drop-shadow(0 0 8px rgba(0,255,136,0.6))' },
          '50%': { opacity: '0.4', filter: 'drop-shadow(0 0 2px rgba(0,255,136,0.2))' },
        }
      }
    },
  },
  plugins: [],
};
export default config;
