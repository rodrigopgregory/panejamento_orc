import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSF, jsonField, SF_IDS, execSF, avaliarWorkflow, avaliarErroMsg } from '../hooks/useMitraData';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { ArrowLeft, Send, Check, MessageSquare, CheckCircle, XCircle } from 'lucide-react';
import OrcamentoContent from '../components/OrcamentoContent';
import RejectionReasonsModal from '../components/RejectionReasonsModal';
import Modal from '../components/ui/Modal';
import { getUser } from '../lib/auth';

const STATUS_LABEL: Record<string, { label: string; variant: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }> = {
  PENDENTE: { label: 'Pendente', variant: 'warning' },
  CONFIRMADO: { label: 'Confirmado', variant: 'info' },
  SUBMETIDO: { label: 'Submetido', variant: 'warning' },
  APROVADO: { label: 'Aprovado', variant: 'success' },
  REPROVADO: { label: 'Reprovado', variant: 'danger' },
};

export default function OrcamentoPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gestorId = Number(searchParams.get('gestor')) || null;
  const crIdParam = Number(searchParams.get('cr')) || null;
  const mode = searchParams.get('mode') || (searchParams.get('from') === 'kanban' ? 'admin' : null);

  // Mount + status em 1 ida: SF 138 devolve GESTORES/CRS/CICLO_ABERTO/STATUS/MODELOS
  // como blocos JSON (eram 2 chamadas de mount + 3 no loadStatus). O ciclo aberto
  // default e resolvido dentro do SQL da SF.
  const { data: hotRows, refetch: refetchStatus } = useSF(SF_IDS.hotOrcamentoStatus, { crId: crIdParam || 0, gestorId: gestorId || 0 });
  const gestores = useMemo(() => jsonField(hotRows?.[0]?.GESTORES), [hotRows]);
  const crs = useMemo(() => jsonField(hotRows?.[0]?.CRS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [hotRows]);

  const gestor = gestores.find((g: any) => g.ID === gestorId);
  const cr = crs.find((c: any) => c.ID === crIdParam);
  const displayName = gestor?.NOME || getUser()?.NOME;

  // ── Status do CR (pra botao Submeter) ──
  const { toasts, addToast, removeToast } = useToast();
  const [statusRow, setStatusRow] = useState<{ ID: number; CICLO_ID: number; STATUS: string; DRIVERS_CONFIRMADOS: string; COMENTARIO?: string } | null>(null);
  const [totalDrivers, setTotalDrivers] = useState<number>(0);
  const [showRejectionReasons, setShowRejectionReasons] = useState(false);
  void refetchStatus; // disponivel para futuras acoes que precisem recarregar o status

  useEffect(() => {
    if (!crIdParam || !gestorId) { setStatusRow(null); setTotalDrivers(0); return; }
    const row = hotRows?.[0];
    if (!row) return;
    const statusRows = jsonField(row.STATUS);
    if (statusRows.length) {
      setStatusRow({
        ID: statusRows[0].ID,
        CICLO_ID: statusRows[0].CICLO_ID,
        STATUS: statusRows[0].STATUS || 'PENDENTE',
        DRIVERS_CONFIRMADOS: statusRows[0].DRIVERS_CONFIRMADOS || '',
        COMENTARIO: statusRows[0].COMENTARIO,
      });
    } else {
      setStatusRow(null);
    }
    const modelRows = jsonField(row.MODELOS);
    setTotalDrivers(modelRows.length ? Number(modelRows[0].TOTAL) : 0);
  }, [hotRows, crIdParam, gestorId]);

  const handleStatusChange = (_crId: number, status: string, driversConfirmados?: string) => {
    setStatusRow(prev => prev ? { ...prev, STATUS: status, DRIVERS_CONFIRMADOS: driversConfirmados ?? prev.DRIVERS_CONFIRMADOS } : prev);
  };

  const submitCR = async () => {
    if (!statusRow?.ID) return;
    try {
      const out = await avaliarWorkflow({
        tipo: 'CR',
        statusId: statusRow.ID,
        acao: 'SUBMETIDO',
        autor: getUser()?.NOME || '',
      });
      if (!out?.ok) { addToast('error', avaliarErroMsg(out)); return; }
      setStatusRow({ ...statusRow, STATUS: 'SUBMETIDO' });
      addToast('success', 'Orçamento submetido para aprovação!');
    } catch (e) { console.error(e); addToast('error', 'Erro ao submeter orçamento'); }
  };

  // ── Decisao do aprovador direto no header (sem banner dentro do conteudo) ──
  // Reprovar antes; Aprovar sempre a direita (acao principal). O remount do
  // OrcamentoContent (approvalBump) sincroniza o statusRecord interno pos-decisao.
  const canApprove = !!getUser();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [approvalBump, setApprovalBump] = useState(0);
  const decideCR = async (acao: 'APROVADO' | 'REPROVADO', comentario?: string) => {
    if (!statusRow?.ID) return;
    // OTIMISTA: o header muda na hora (a SF de transicao + e-mail levam segundos);
    // o remount do conteudo (approvalBump) espera a confirmacao do servidor.
    // Recusa/erro => reverte e avisa.
    const prev = statusRow;
    setStatusRow({ ...prev, STATUS: acao, ...(acao === 'REPROVADO' ? { COMENTARIO: comentario || '' } : {}) });
    addToast('success', acao === 'APROVADO' ? 'Orçamento aprovado!' : 'Orçamento reprovado.');
    try {
      const out = await avaliarWorkflow({ tipo: 'CR', statusId: prev.ID, acao, comentario, autor: getUser()?.NOME || '' });
      if (!out?.ok) { setStatusRow(prev); addToast('error', avaliarErroMsg(out)); return; }
      setApprovalBump(b => b + 1);
    } catch (e) { console.error(e); setStatusRow(prev); addToast('error', 'Erro ao atualizar status'); }
  };

  const currentStatus = statusRow?.STATUS || 'PENDENTE';
  const stCfg = STATUS_LABEL[currentStatus] || STATUS_LABEL.PENDENTE;
  const confirmedCount = statusRow?.DRIVERS_CONFIRMADOS
    ? statusRow.DRIVERS_CONFIRMADOS.split(',').filter(Boolean).length
    : 0;
  const allFilled = totalDrivers > 0 && confirmedCount >= totalDrivers;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header em 3 niveis: (1) voltar + titulo com o CR em texto secundario;
          (2) status do fluxo + decisao a direita; (3) as abas vivem na linha
          seguinte (dentro do OrcamentoContent, unica divisoria mantida).
          Reprovar e Aprovar sao decisoes EQUIVALENTES: mesmos solidos, mesmas
          medidas — muda so a cor/icone. Reprovar a esquerda, Aprovar a direita. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2 min-w-0">
          <button onClick={() => navigate(mode ? `/workflow?mode=${mode}` : '/workflow')} className="p-2 rounded-xl transition-colors shrink-0" style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="font-semibold truncate" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Preenchimento de Orçamento</h1>
              {gestor && <Badge variant="info">{displayName}</Badge>}
            </div>
            <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>
              {cr ? `${cr.CODIGO} - ${cr.NOME}` : 'Preencha os valores orçamentários por centro de resultado'}
            </p>
          </div>
        </div>
        {cr && statusRow && (
          <div className="flex items-center gap-2.5 shrink-0 pt-1">
            {/* SUBMETIDO consolida status + espera numa mensagem so (sem badge redundante) */}
            {currentStatus === 'SUBMETIDO'
              ? (
                <span className="text-[13px] font-medium" style={{ color: 'var(--semantic-warning, #d97706)' }}>
                  {canApprove ? 'Aguardando sua aprovação' : 'Aguardando aprovação'}
                </span>
              )
              : <Badge variant={stCfg.variant}>{stCfg.label}</Badge>}
            {currentStatus === 'REPROVADO' && (
              <button type="button" onClick={() => setShowRejectionReasons(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg cursor-pointer" style={{ color: '#b91c1c', border: '1px solid color-mix(in srgb, #ef4444 42%, var(--color-border))', backgroundColor: 'var(--color-surface)' }}>
                <MessageSquare size={14} /> Ver motivos
              </button>
            )}
            {(currentStatus === 'PENDENTE' || currentStatus === 'CONFIRMADO' || currentStatus === 'REPROVADO') && (
              <Button variant="primary" size="sm" onClick={submitCR} disabled={!allFilled}>
                <Send size={13} /> Submeter CR
              </Button>
            )}
            {currentStatus === 'SUBMETIDO' && canApprove && (
              <>
                <button
                  onClick={() => { setRejectComment(''); setRejectOpen(true); }}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
                  style={{ backgroundColor: '#ef4444', minWidth: 118 }}
                >
                  <XCircle size={15} /> Reprovar
                </button>
                <button
                  onClick={() => decideCR('APROVADO')}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
                  style={{ backgroundColor: '#10b981', minWidth: 118 }}
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
              </>
            )}
            {currentStatus === 'APROVADO' && (
              <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#10b981' }}>
                <Check size={13} /> Aprovado
              </span>
            )}
          </div>
        )}
      </div>

      {/* Shared content — remonta apos decisao do aprovador (approvalBump) para o
          statusRecord interno refletir o novo status sem F5 */}
      <OrcamentoContent key={`oc-${crIdParam}-${approvalBump}`} gestorId={gestorId} selectedCR={crIdParam} onStatusChange={handleStatusChange} />

      {/* Motivo da reprovacao — mesma semantica do modal do OrcamentoContent */}
      <Modal isOpen={rejectOpen} onClose={() => setRejectOpen(false)} title="Reprovar orçamento">
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Deixe um comentário explicando o motivo da reprovação. O gestor verá esta mensagem ao revisar o orçamento.
          </p>
          <textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Motivo da reprovação..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg border outline-none text-sm resize-none"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => { decideCR('REPROVADO', rejectComment || ''); setRejectOpen(false); }}
              style={{ backgroundColor: '#ef4444' }}
            >
              Reprovar
            </Button>
          </div>
        </div>
      </Modal>

      <RejectionReasonsModal
        isOpen={showRejectionReasons}
        onClose={() => setShowRejectionReasons(false)}
        title="Motivos da reprovação"
        load={async () => statusRow && crIdParam ? (await execSF(SF_IDS.auditoriaWorkflow, { cicloId: statusRow.CICLO_ID, tipo: 'CR', refId: crIdParam })).filter((item: any) => item.EVENTO === 'REPROVADO') : []}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
