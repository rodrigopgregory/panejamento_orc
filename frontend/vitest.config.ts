import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // O sandbox de build roda em UTC, onde converter UTC->local nao muda nada e
    // os testes de fuso da auditoria passariam sem exercitar a conversao. Fixar
    // um fuso com offset real mantem essa regressao visivel.
    env: { TZ: 'America/Sao_Paulo' },
  },
});
