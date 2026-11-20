// ──────────────────────────────────────────────────────────────────────
// PlaygroundPublicoPage — visualização de um estudo compartilhado por
// token (rota /estudo/:token). RESTRITA a usuários logados: o App só
// renderiza esta página com sessão ativa (anônimo cai no LoginPage) e a
// SF playground_publico exige token de sessão (publicExecution: false).
// ──────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { executeServerFunctionMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG } from '../mitra-config';
import { SF_PG, fmtDataHora } from '../lib/playground';

interface EstudoPublico { NOME: string; HTML: string; ATUALIZADO_EM: string }

export default function PlaygroundPublicoPage() {
  const [estudo, setEstudo] = useState<EstudoPublico | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    // token vem do path /estudo/<token> — a página renderiza fora do Router
    // logado (early-return no App), então lê direto da URL
    const m = window.location.pathname.match(/\/estudo\/([a-zA-Z0-9]+)/);
    const token = m?.[1] || '';
    if (!token) { setErro('Link inválido'); setCarregando(false); return; }
    // SDK já configurada com o token de sessão pelo initMitra() do boot —
    // a chamada é autenticada (a SF não é mais pública)
    (async () => {
      try {
        const res: any = await executeServerFunctionMitra({
          projectId: MITRA_CONFIG.projectId,
          serverFunctionId: SF_PG.publico,
          input: { token, _cb: Date.now() },
        });
        let output = res?.result?.output ?? res?.output;
        if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* keep */ } }
        const row = output?.rows?.[0];
        if (!row || !row.HTML) {
          setErro('Este estudo não está mais disponível — o link pode ter sido revogado.');
        } else {
          setEstudo(row as EstudoPublico);
          document.title = row.NOME + ' — Playground';
        }
      } catch {
        setErro('Não consegui carregar o estudo. Tente novamente em instantes.');
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  return (
    <div className="flex flex-col" style={{ height: '100vh', backgroundColor: '#f4f4f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* header mínimo */}
      <div className="flex items-center gap-3 px-6 py-3 border-b" style={{ backgroundColor: '#ffffff', borderColor: '#e4e4e7' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f5f3ff' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round">
            <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: '#0E1428' }}>{estudo?.NOME || 'Estudo compartilhado'}</p>
          {estudo && (
            <p className="text-[11px]" style={{ color: '#94a3b8' }}>Atualizado {fmtDataHora(estudo.ATUALIZADO_EM)} · somente leitura</p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {carregando && (
          <div className="p-6">
            <div className="pg-skeleton" style={{ height: '70vh' }} />
          </div>
        )}
        {!carregando && erro && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <div className="pg-empty-art">
              <div className="pg-empty-bar" style={{ height: 40 }} />
              <div className="pg-empty-bar" style={{ height: 60 }} />
              <div className="pg-empty-bar" style={{ height: 32 }} />
            </div>
            <p className="text-sm font-medium text-center" style={{ color: '#64748b' }}>{erro}</p>
          </div>
        )}
        {!carregando && estudo && (
          <iframe
            sandbox=""
            srcDoc={estudo.HTML}
            title={estudo.NOME}
            className="w-full h-full animate-fadeIn"
            style={{ border: 'none', backgroundColor: '#fff' }}
          />
        )}
      </div>
    </div>
  );
}
