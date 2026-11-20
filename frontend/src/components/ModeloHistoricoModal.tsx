import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { execSF, SF_IDS } from '../hooks/useMitraData';
import { toTitleCase } from '../lib/utils';

type ModeloVersao = { ID: number; NUMERO: number; CRIADO_EM: string; AUTOR?: string | null; QTD_LINHAS?: number };

function formatVersaoData(iso: string): string {
  if (!iso) return '';
  const d = String(iso).replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : d;
}

/**
 * Modal de histórico de versões publicadas de um modelo (somente visualização).
 * Compartilhado entre o header da tela de Modelagem e o editor de fórmulas
 * standalone. Carrega as versões ao abrir; a mais recente é marcada como atual.
 */
export default function ModeloHistoricoModal({ driverId, open, onClose, contaById }: {
  driverId: number;
  open: boolean;
  onClose: () => void;
  /** Mapa ID → conta contábil, para exibir o nome de linhas vinculadas a conta. */
  contaById?: Map<number, any>;
}) {
  const [versoes, setVersoes] = useState<ModeloVersao[] | null>(null);
  const [versaoSel, setVersaoSel] = useState<number | null>(null);
  const [versaoLinhas, setVersaoLinhas] = useState<any[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersoes(null);
    setVersaoSel(null);
    setVersaoLinhas(null);
    let cancelled = false;
    execSF(SF_IDS.listarModeloVersoes, { driverId })
      .then((vs: any) => { if (!cancelled) setVersoes((vs as ModeloVersao[]) || []); })
      .catch((e) => { console.error(e); if (!cancelled) setVersoes([]); });
    return () => { cancelled = true; };
  }, [open, driverId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const verVersao = useCallback(async (v: ModeloVersao) => {
    setVersaoSel(v.ID);
    setVersaoLinhas(null);
    try {
      const rows = await execSF(SF_IDS.getModeloVersao, { versaoId: v.ID });
      const snapRaw = rows?.[0]?.SNAPSHOT;
      const arr = snapRaw ? (typeof snapRaw === 'string' ? JSON.parse(snapRaw) : snapRaw) : [];
      const ordered = [...(Array.isArray(arr) ? arr : [])].sort((a, b) =>
        (Number(a.ORDEM) - Number(b.ORDEM)) || String(a.CODIGO || '').localeCompare(String(b.CODIGO || '')));
      setVersaoLinhas(ordered);
    } catch (e) { console.error(e); setVersaoLinhas([]); }
  }, []);

  if (!open) return null;

  const atualNumero = versoes && versoes.length > 0 ? versoes[0].NUMERO : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-3xl rounded-xl shadow-2xl flex flex-col animate-scaleIn"
        style={{ maxHeight: '80vh', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <History size={16} style={{ color: 'var(--color-primary)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Histórico do modelo</h3>
          </div>
          <button type="button" onClick={onClose} title="Fechar" className="p-1.5 rounded-md cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* Lista de versões */}
          <div className="w-56 shrink-0 overflow-y-auto py-1" style={{ borderRight: '1px solid var(--color-border)' }}>
            {versoes === null ? (
              <div className="px-4 py-6 text-[12px] text-center" style={{ color: 'var(--color-text-secondary)' }}>Carregando…</div>
            ) : versoes.length === 0 ? (
              <div className="px-4 py-6 text-[12px] text-center" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma versão publicada ainda.</div>
            ) : versoes.map((v) => (
              <button
                key={v.ID}
                type="button"
                onClick={() => verVersao(v)}
                className="w-full text-left px-4 py-2.5 cursor-pointer transition-colors"
                style={{ backgroundColor: versaoSel === v.ID ? 'var(--color-hover)' : 'transparent' }}
                onMouseEnter={(e) => { if (versaoSel !== v.ID) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { if (versaoSel !== v.ID) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>v{v.NUMERO}</span>
                  {atualNumero === v.NUMERO && (
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>atual</span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>{formatVersaoData(v.CRIADO_EM)}</div>
                {v.AUTOR && <div className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{v.AUTOR}</div>}
              </button>
            ))}
          </div>
          {/* Snapshot da versão selecionada (somente visualização) */}
          <div className="flex-1 overflow-y-auto p-4 min-w-0">
            {versaoSel === null ? (
              <div className="h-full flex items-center justify-center text-[12px] text-center px-6" style={{ color: 'var(--color-text-secondary)' }}>
                Selecione uma versão à esquerda para ver como o modelo estava.
              </div>
            ) : versaoLinhas === null ? (
              <div className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Carregando…</div>
            ) : versaoLinhas.length === 0 ? (
              <div className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Esta versão não tem linhas.</div>
            ) : (
              <table className="w-full text-[12px]" style={{ color: 'var(--color-text)' }}>
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)' }}>
                    <th className="text-left font-medium pb-2 pr-2">Cód.</th>
                    <th className="text-left font-medium pb-2 pr-2">Nome</th>
                    <th className="text-left font-medium pb-2 pr-2">Tipo</th>
                    <th className="text-left font-medium pb-2">Fórmula</th>
                  </tr>
                </thead>
                <tbody>
                  {versaoLinhas.map((l: any, i: number) => {
                    const conta = l.CONTA_ID != null ? contaById?.get(Number(l.CONTA_ID)) : null;
                    const nome = l.NOME_CUSTOM || (conta ? toTitleCase(conta.NOME) : '—');
                    const isFormula = l.TIPO === 'FORMULA';
                    return (
                      <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="py-1.5 pr-2 align-top"><code className="text-[11px]" style={{ color: 'var(--color-primary)' }}>{l.CODIGO}</code></td>
                        <td className="py-1.5 pr-2 align-top">{nome}</td>
                        <td className="py-1.5 pr-2 align-top" style={{ color: 'var(--color-text-secondary)' }}>{isFormula ? 'Fórmula' : 'Input'}</td>
                        <td className="py-1.5 align-top">
                          {isFormula && l.FORMULA
                            ? <code className="text-[11px]" style={{ color: 'var(--color-text)' }}>{l.FORMULA}</code>
                            : <span style={{ color: 'var(--color-text-secondary)' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
