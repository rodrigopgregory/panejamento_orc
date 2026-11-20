import { useEffect, useState } from 'react';
import { execSF, SF_IDS } from '../hooks/useMitraData';
import Modal from './ui/Modal';
import { Send, CheckCircle, XCircle, RotateCcw, Check, Undo2, Clock } from 'lucide-react';

// Modal de historico (trilha de auditoria) de um CR ou pacote no ciclo.
// Alimentado pela SF listarAuditoriaWorkflow — cada linha e uma transicao de
// status com autor, origem, horario e justificativa quando houver.

interface HistoricoItem {
  ID: number;
  EVENTO: string;
  STATUS_DE: string | null;
  STATUS_PARA: string | null;
  COMENTARIO: string | null;
  AUTOR: string | null;
  ORIGEM: string | null;
  CRIADO_EM: string | null;
}

const EVENTO_META: Record<string, { label: string; color: string; icon: typeof Send }> = {
  SUBMETIDO: { label: 'Submetido para aprovação', color: '#d97706', icon: Send },
  APROVADO: { label: 'Aprovado', color: '#059669', icon: CheckCircle },
  REPROVADO: { label: 'Reprovado', color: '#b91c1c', icon: XCircle },
  REABERTO: { label: 'Reaberto para avaliação', color: '#64748b', icon: RotateCcw },
  MODELO_CONFIRMADO: { label: 'Modelo confirmado', color: '#059669', icon: Check },
  CONFIRMACAO_DESFEITA: { label: 'Confirmação desfeita', color: '#64748b', icon: Undo2 },
};

// CRIADO_EM chega em UTC (as Server Functions carimbam com toISOString), entao
// recortar a string mostrava o horario de Greenwich — 3h adiantado no Brasil.
// Reidratar como UTC e ler pelos getters locais devolve o relogio de quem olha.
function fmtData(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function WorkflowHistorico({ isOpen, onClose, tipo, refId, cicloId, titulo }: {
  isOpen: boolean;
  onClose: () => void;
  tipo: 'CR' | 'PACOTE';
  refId: number | null;
  cicloId: number | null;
  titulo?: string;
}) {
  const [items, setItems] = useState<HistoricoItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !refId || !cicloId) return;
    setLoading(true);
    execSF(SF_IDS.auditoriaWorkflow, { cicloId, tipo, refId })
      .then((rows) => setItems(rows as HistoricoItem[]))
      .catch((e) => { console.error('historico workflow:', e); setItems([]); })
      .finally(() => setLoading(false));
  }, [isOpen, tipo, refId, cicloId]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={titulo || 'Histórico'} size="md">
      {loading ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>Carregando histórico...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-8">
          <Clock size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Nenhum evento registrado ainda. Submissões, aprovações e reprovações aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {items.map((it, idx) => {
            const meta = EVENTO_META[it.EVENTO] || { label: it.EVENTO, color: '#64748b', icon: Clock };
            const Icon = meta.icon;
            const isModelo = it.EVENTO === 'MODELO_CONFIRMADO' || it.EVENTO === 'CONFIRMACAO_DESFEITA';
            return (
              <div key={it.ID} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="rounded-full p-1.5 shrink-0" style={{ backgroundColor: meta.color + '1f' }}>
                    <Icon size={14} style={{ color: meta.color }} />
                  </span>
                  {idx < items.length - 1 && (
                    <span className="w-px flex-1 my-1" style={{ backgroundColor: 'var(--color-border)' }} />
                  )}
                </div>
                <div className="pb-4 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{meta.label}</span>
                    {isModelo && it.COMENTARIO && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-secondary)' }}>
                        {it.COMENTARIO}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-muted)' }}>
                      {it.ORIGEM === 'LINK' ? 'link público' : 'aplicativo'}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {it.AUTOR ? `por ${it.AUTOR} — ` : ''}{fmtData(it.CRIADO_EM)}
                  </p>
                  {!isModelo && it.COMENTARIO && (
                    <p className="text-xs mt-1 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-secondary)' }}>
                      {it.COMENTARIO}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
