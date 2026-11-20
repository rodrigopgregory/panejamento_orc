import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { initMitra } from './mitra-config'
import { sincronizarTemaDaPlataforma } from './lib/tema'
import './index.css'
import App from './App.tsx'

// Tema ANTES do initMitra: o initMitra limpa o fragment da URL assim que
// consome a sessao, e o tema pode estar viajando nesse mesmo fragment.
sincronizarTemaDaPlataforma()
initMitra()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
