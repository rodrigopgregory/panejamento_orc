import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    // Sobe o limite do aviso — os chunks pesados (planilha, graficos) agora sao
    // carregados sob demanda, entao um chunk grande fora do caminho critico e ok.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Isola as libs pesadas de terceiros em chunks proprios. Assim elas
        // ficam fora do bundle inicial e sao cacheadas de forma independente
        // entre navegacoes e deploys.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-handsontable': ['handsontable', '@handsontable/react-wrapper'],
          'vendor-hyperformula': ['hyperformula'],
          'vendor-recharts': ['recharts'],
        },
      },
    },
  },
})
