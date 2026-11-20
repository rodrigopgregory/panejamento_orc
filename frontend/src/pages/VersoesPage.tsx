import { useState, useMemo } from 'react';
import { useSF, createRecord, updateRecord, querySQL, execSF } from '../hooks/useMitraData';

function jsonField(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Tooltip from '../components/ui/Tooltip';
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { formatDateBR } from '../lib/utils';
import { executeServerFunctionMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG } from '../mitra-config';
import { getUser } from '../lib/auth';
import { Plus, SquarePen, Trash2, Star, Copy, Shield, Play, Send, Loader2, Link2, RotateCcw, Check, Search, ChevronDown, ChevronRight } from 'lucide-react';

const SF_ENVIAR_EMAIL_GESTOR = 17;
const SF_GARANTIR_TOKEN = 63;
const SF_OBTER_TOKEN = 64;
// Criacao/duplicacao de versao em 1 chamada server-side (fecha abertas com
// housekeeping via SF 170 interna, cria CICLO, mapa de status, copia premissas/
// dados). Idempotente: duplo clique com mesmo NOME+ANO devolve a versao ja criada.
const SF_CRIAR_VERSAO = 191;

// Gera (ou reaproveita) o magic-link de preenchimento publico para (ciclo, gestor).
// O link carrega um token UUID nao adivinhavel — substitui o antigo ?gestor=ID,
// que era um identificador sequencial (permitia editar o orcamento de outro gestor).
async function buildMagicLink(cicloId: number, gestorId: number): Promise<string> {
  const agora = new Date().toISOString().slice(0, 19);
  await execSF(SF_GARANTIR_TOKEN, { cicloId, gestorId, agora });
  const rows = await execSF(SF_OBTER_TOKEN, { cicloId, gestorId });
  const token = rows?.[0]?.TOKEN;
  return `${window.location.origin}/preenchimento-publico?token=${token || ''}`;
}

// executeServerFunctionMitra resolve mesmo quando a execucao da SF falha no
// servidor (executionStatus FAILED) — um email so conta como enviado quando o
// servidor confirmou COMPLETED. Sem isso a tela mostrava "enviado" com a SF
// de email quebrada.
function emailOk(r: PromiseSettledResult<any>): boolean {
  return r.status === 'fulfilled' && r.value?.result?.executionStatus === 'COMPLETED';
}

function buildEmailHtml(gestorNome: string, versaoNome: string, workflowUrl: string): string {
  return '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">' +
    '<div style="background:linear-gradient(135deg,#8b5cf6,#a78bfa);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">' +
    '<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>' +
    '<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p>' +
    '</div>' +
    '<h2 style="color:#1e293b;font-size:18px">Olá, ' + gestorNome + '!</h2>' +
    '<p style="color:#64748b;font-size:14px;line-height:1.6">A versão <strong>' + versaoNome + '</strong> foi iniciada e está aguardando o preenchimento do orçamento dos seus Centros de Resultado.</p>' +
    '<div style="text-align:center;margin:32px 0">' +
    '<a href="' + workflowUrl + '" style="background:#8b5cf6;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Acessar Workflow</a>' +
    '</div>' +
    '<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p>' +
    '</div>';
}

const MESES_LABELS = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Usuario logado vem do espelho local da sessao (localStorage 'planej-user'),
// que o login ja hidrata com o e-mail vindo de INT_USER ou do proprio token —
// e o que preenche CRIADO_POR sem depender de decodificar o JWT aqui.
function getCurrentUserEmail(): string {
  return getUser()?.EMAIL || '';
}

function getCurrentUserName(): string {
  const u = getUser();
  return u?.NOME || u?.EMAIL || '';
}

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'blue' | 'neutral' | 'danger' }> = {
  PENDENTE: { label: 'Pendente', variant: 'warning' },
  INICIADA: { label: 'Iniciada', variant: 'blue' },
  FINALIZADA: { label: 'Finalizada', variant: 'success' },
  REVISAO: { label: 'Revisão', variant: 'warning' },
  FECHADO: { label: 'Fechada', variant: 'neutral' },
};

const emptyForm = {
  NOME: '',
  ANO: new Date().getFullYear(),
  ULTIMO_MES_REALIZADO: 0,
  VERSAO_CONTROLE: 'false',
  VERSAO_ORIGEM_ID: null as number | null,
};

export default function VersoesPage() {
  // 1 ida ao servidor (SF 123): versoes + gestores(com CRs) + CRs juntos. Fresco (muda com
  // create/delete) — refetch recarrega os tres de uma vez.
  // `loading` comeca em true no useSF e so cai quando a SF 123 responde — e ele que
  // segura o skeleton, evitando o "Nenhuma versao cadastrada" durante a ida a rede.
  const { data: baseRows, refetch, loading: loadingBase } = useSF(123, {}, false);
  const base = baseRows?.[0] || {};
  // So a PRIMEIRA carga vira skeleton. O useSF mantem os dados durante o refetch, e
  // refetch() roda apos toda mutacao (tornar atual, definir controle, duplicar,
  // excluir, iniciar versao). Sem esta guarda, cada acao dessas apagaria o card e a
  // lista inteira para skeleton — pior ainda em "Iniciar versao", que avisa por toast
  // que o processamento segue em segundo plano bem quando a tela se limparia.
  const loading = loadingBase && (baseRows?.length ?? 0) === 0;
  const versoes = useMemo(() => jsonField(base.VERSOES), [base.VERSOES]);
  const gestores = useMemo(() => jsonField(base.GESTORES), [base.GESTORES]);
  const crs = useMemo(() => jsonField(base.CRS), [base.CRS]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedYears, setCollapsedYears] = useState<Record<number, boolean>>({});

  // Iniciar versão modal
  const [iniciarModal, setIniciarModal] = useState<any>(null);
  const [gestoresChecked, setGestoresChecked] = useState<Record<number, boolean>>({});
  const [initiating, setInitiating] = useState(false);
  const [iniciarSearch, setIniciarSearch] = useState('');

  // Reenviar link modal
  const [reenviarModal, setReenviarModal] = useState<any>(null);
  const [reenviarChecked, setReenviarChecked] = useState<Record<number, boolean>>({});
  const [reenviando, setReenviando] = useState(false);
  const [reenviarSearch, setReenviarSearch] = useState('');

  // Duplicar versão
  const [duplicando, setDuplicando] = useState<number | null>(null);

  // Guarda anti duplo clique do "Criar Versão"/"Salvar"
  const [saving, setSaving] = useState(false);

  const { toasts, addToast, removeToast } = useToast();

  // Copiar links modal
  const [copiarLinksModal, setCopiarLinksModal] = useState<any>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copyToClipboardFallback = (text: string): boolean => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  };

  const copyGestorLink = async (cicloId: number, gestorIdNum: number) => {
    const url = await buildMagicLink(cicloId, gestorIdNum);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        addToast('success', 'Link copiado!');
        return;
      }
    } catch { /* fallback below */ }
    if (copyToClipboardFallback(url)) {
      addToast('success', 'Link copiado!');
    } else {
      // Last resort: show the URL for manual copy
      window.prompt('Copie o link abaixo:', url);
    }
  };

  const versaoAtual = versoes.find((v: any) => v.VERSAO_ATUAL === 'true');

  // Executa a SF de criacao/duplicacao (1 chamada server-side) e normaliza o output
  const criarVersaoServidor = async (input: Record<string, any>): Promise<{ ok: boolean; id?: number; dedup?: boolean; error?: string; origemPremissasNome?: string; origemFallback?: boolean }> => {
    const res: any = await executeServerFunctionMitra({
      projectId: MITRA_CONFIG.projectId,
      serverFunctionId: SF_CRIAR_VERSAO,
      input,
    });
    if (res?.result?.executionStatus === 'FAILED') throw new Error(res?.result?.error || 'Falha na operação');
    let output = res?.result?.output;
    if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* keep */ } }
    return output || { ok: false, error: 'sem_resposta' };
  };

  // A origem escolhida pode estar vazia — nesse caso o servidor busca sozinho a
  // ultima versao com premissas. O usuario nao pediu isso, entao precisa saber.
  const avisoOrigem = (out: { origemPremissasNome?: string; origemFallback?: boolean }) =>
    out.origemFallback && out.origemPremissasNome
      ? ` A origem não tinha premissas, então elas foram herdadas de "${out.origemPremissasNome}".`
      : '';

  // When creating a new version: status=PENDENTE, versao_atual=true, close previous open versions
  const handleSave = async () => {
    if (saving) return;
    if (!editId && !form.NOME.trim()) { addToast('error', 'Informe o nome da versão'); return; }
    setSaving(true);
    try {
      if (editId) {
        // Edit mode: only update allowed fields
        const payload: any = {
          NOME: form.NOME,
          ANO: form.ANO,
          ULTIMO_MES_REALIZADO: form.ULTIMO_MES_REALIZADO,
          VERSAO_CONTROLE: form.VERSAO_CONTROLE,
        };

        // Enforce unique controle per year
        if (form.VERSAO_CONTROLE === 'true') {
          versoes.find((v: any) => v.ID === editId);
          const sameYear = versoes.filter((v: any) => v.ANO === form.ANO && v.VERSAO_CONTROLE === 'true' && v.ID !== editId);
          for (const v of sameYear) {
            await updateRecord('CICLO', v.ID, { VERSAO_CONTROLE: 'false' });
          }
        }

        await updateRecord('CICLO', editId, payload);
        addToast('success', 'Versão atualizada!');
      } else {
        // Criacao em 1 chamada server-side (SF 191): fecha versoes abertas (com
        // housekeeping), cria o CICLO, monta o mapa de status e copia as premissas
        // da origem — set-based, sem os ~N round-trips que travavam o botao.
        const out = await criarVersaoServidor({
          modo: 'nova',
          nome: form.NOME.trim(),
          ano: form.ANO,
          ultimoMesRealizado: form.ULTIMO_MES_REALIZADO,
          versaoControle: form.VERSAO_CONTROLE,
          origemId: form.VERSAO_ORIGEM_ID || 0,
          criadoPor: getCurrentUserName(),
        });
        if (!out.ok) throw new Error(out.error || 'Falha ao criar versão');
        if (out.dedup) {
          addToast('success', 'Essa versão já havia sido criada — nenhuma duplicata foi gerada.');
        } else {
          addToast('success', 'Versão criada como pendente. Mapa de CRs já disponível no workflow. Use "Iniciar" para enviar aos gestores.' + avisoOrigem(out));
        }
      }
      setModalOpen(false);
      setEditId(null);
      setForm(emptyForm);
      refetch();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const handleToggleControle = async (id: number, ano: number, current: string) => {
    try {
      if (current === 'true') {
        await updateRecord('CICLO', id, { VERSAO_CONTROLE: 'false' });
        addToast('success', 'Versão de controle removida');
      } else {
        // Unique per year
        const sameYear = versoes.filter((v: any) => v.ANO === ano && v.VERSAO_CONTROLE === 'true');
        for (const v of sameYear) {
          await updateRecord('CICLO', v.ID, { VERSAO_CONTROLE: 'false' });
        }
        await updateRecord('CICLO', id, { VERSAO_CONTROLE: 'true' });
        addToast('success', 'Versão de controle definida para ' + ano);
      }
      refetch();
    } catch (e) { addToast('error', 'Erro ao alterar'); }
  };

  const handleDelete = async () => {
    if (!deleteId || deleting) return;
    // Segunda tranca, alem do botao desabilitado: o modal pode continuar montado se
    // a versao mudar de status enquanto ele esta aberto, e exclusao nao tem desfazer.
    const alvo = versoes.find((v: any) => v.ID === deleteId);
    if (alvo && alvo.STATUS !== 'PENDENTE') {
      addToast('error', 'Esta versão já foi iniciada e não pode ser excluída');
      setDeleteId(null);
      return;
    }
    setDeleting(true);
    try {
      // SF 239 (excluirCicloCascata) apaga as 21 tabelas que tem CICLO_ID, cada
      // DELETE restrito ao proprio ciclo, e so age se ele estiver PENDENTE.
      // Antes isso era feito aqui: 7 tabelas, uma a uma, centenas de round-trips —
      // e as outras 14 viravam orfas apontando para um ciclo que nao existia mais.
      await execSF(239, { cicloId: Number(deleteId) });
      // O retorno de SF SQL multi-statement nao traz o SELECT final, entao a
      // confirmacao vem de olhar o banco: se a versao sumiu, deu certo.
      const restante = await querySQL(`SELECT COUNT(*) AS N FROM CICLO WHERE ID = ${Number(deleteId)}`);
      if (Number(restante?.[0]?.N ?? 0) > 0) {
        addToast('error', 'Esta versão já foi iniciada e não pode ser excluída');
      } else {
        addToast('success', 'Versão removida');
      }
      setDeleteId(null);
      refetch();
    } catch { addToast('error', 'Erro ao remover versão'); }
    setDeleting(false);
  };

  const openNew = (origemId?: number) => {
    setEditId(null);
    const origemVersao = origemId ? versoes.find((v: any) => v.ID === origemId) : null;
    setForm({
      ...emptyForm,
      VERSAO_ORIGEM_ID: origemId || null,
      NOME: origemVersao ? `Revisão - ${origemVersao.NOME}` : '',
      ANO: origemVersao ? origemVersao.ANO : new Date().getFullYear(),
    });
    setModalOpen(true);
  };

  const openEdit = (item: any) => {
    setEditId(item.ID);
    setForm({
      NOME: item.NOME || '',
      ANO: item.ANO,
      ULTIMO_MES_REALIZADO: item.ULTIMO_MES_REALIZADO || 0,
      VERSAO_CONTROLE: item.VERSAO_CONTROLE || 'false',
      VERSAO_ORIGEM_ID: item.VERSAO_ORIGEM_ID || null,
    });
    setModalOpen(true);
  };

  // Open Iniciar modal
  const openIniciar = (versao: any) => {
    setIniciarModal(versao);
    // Pre-check all active managers
    const checked: Record<number, boolean> = {};
    gestores.forEach((g: any) => { checked[g.ID] = true; });
    setGestoresChecked(checked);
  };

  const handleIniciar = async () => {
    if (!iniciarModal) return;
    setInitiating(true);
    const cicloId = iniciarModal.ID;
    const cicloNome = iniciarModal.NOME;
    const selectedGestors = gestores.filter((g: any) => gestoresChecked[g.ID]);
    try {
      // 1. Update status to INICIADA — this is the only blocking operation
      await updateRecord('CICLO', cicloId, { STATUS: 'INICIADA' });

      // 2. Close modal immediately so user isn't blocked
      addToast('success', `Versão iniciada! Enviando emails para ${selectedGestors.length} gestor(es) em segundo plano...`);
      setIniciarModal(null);
      setInitiating(false);
      refetch();

      // 3. Create ORCAMENTO_STATUS in parallel (fire-and-forget style)
      const statusPromises: Promise<any>[] = [];
      for (const g of selectedGestors) {
        const crIds = g.CR_IDS?.split(',').map(Number) || [];
        for (const crId of crIds) {
          statusPromises.push(
            querySQL(`SELECT ID FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${cicloId} AND CR_ID = ${crId} AND GESTOR_ID = ${g.ID} LIMIT 1`)
              .then((existing: any[]) => {
                if (existing.length === 0) {
                  return createRecord('ORCAMENTO_STATUS', {
                    CICLO_ID: cicloId,
                    GESTOR_ID: g.ID,
                    CR_ID: crId,
                    STATUS: 'PENDENTE',
                    ATUALIZADO_EM: new Date().toISOString().slice(0, 19),
                  });
                }
              })
              .catch(() => { /* skip */ })
          );
        }
      }
      await Promise.allSettled(statusPromises);

      // 4. Send emails in parallel via INTEGRATION SF (no E2B, ~800ms each)
      const emailResults = await Promise.allSettled(
        selectedGestors.map(async (g: any) => {
          const workflowUrl = await buildMagicLink(cicloId, g.ID);
          return executeServerFunctionMitra({
            projectId: MITRA_CONFIG.projectId,
            serverFunctionId: SF_ENVIAR_EMAIL_GESTOR,
            input: {
              projectId: MITRA_CONFIG.projectId,
              to: g.EMAIL,
              subject: `Mitra FP&A - Nova versão orçamentária iniciada: ${cicloNome}`,
              body: buildEmailHtml(g.NOME, cicloNome, workflowUrl),
            },
          });
        })
      );
      const emailsSent = emailResults.filter(emailOk).length;

      // 5. Create PACOTE_STATUS in parallel
      try {
        const pkgGestores = await querySQL(`
          SELECT gp.GESTOR_ID, gp.DRIVER_ID
          FROM GESTOR_PACOTE gp
          JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.ESCOPO = 'PACOTE'
        `);
        await Promise.allSettled(
          pkgGestores.map((pg: any) =>
            querySQL(`SELECT ID FROM PACOTE_STATUS WHERE CICLO_ID = ${cicloId} AND DRIVER_ID = ${pg.DRIVER_ID} AND GESTOR_ID = ${pg.GESTOR_ID} LIMIT 1`)
              .then((existing: any[]) => {
                if (existing.length === 0) {
                  return createRecord('PACOTE_STATUS', {
                    CICLO_ID: cicloId,
                    DRIVER_ID: pg.DRIVER_ID,
                    GESTOR_ID: pg.GESTOR_ID,
                    STATUS: 'PENDENTE',
                    ATUALIZADO_EM: new Date().toISOString().slice(0, 19),
                  });
                }
              })
              .catch(() => { /* skip */ })
          )
        );
      } catch (e) { console.warn('Skip PACOTE_STATUS creation:', e); }

      // 6. Show final result
      if (emailsSent < selectedGestors.length) {
        addToast('error', `Emails: ${emailsSent} de ${selectedGestors.length} enviados — ${selectedGestors.length - emailsSent} falharam. Verifique o serviço de email.`);
      } else {
        addToast('success', `Emails enviados para ${emailsSent} de ${selectedGestors.length} gestor(es).`);
      }
    } catch (e) {
      addToast('error', 'Erro ao iniciar versão');
      setInitiating(false);
    }
  };

  // Reenviar link para gestores
  const openReenviar = (versao: any) => {
    setReenviarModal(versao);
    const checked: Record<number, boolean> = {};
    gestores.forEach((g: any) => { checked[g.ID] = true; });
    setReenviarChecked(checked);
  };

  const handleReenviar = async () => {
    if (!reenviarModal) return;
    const versaoNome = reenviarModal.NOME;
    const selected = gestores.filter((g: any) => reenviarChecked[g.ID]);

    // Close modal immediately
    addToast('success', `Enviando emails para ${selected.length} gestor(es) em segundo plano...`);
    setReenviarModal(null);
    setReenviando(false);

    // Send emails in parallel via INTEGRATION SF (no E2B, ~800ms each)
    const results = await Promise.allSettled(
      selected.map(async (g: any) => {
        const url = await buildMagicLink(reenviarModal.ID, g.ID);
        return executeServerFunctionMitra({
          projectId: MITRA_CONFIG.projectId,
          serverFunctionId: SF_ENVIAR_EMAIL_GESTOR,
          input: {
            projectId: MITRA_CONFIG.projectId,
            to: g.EMAIL,
            subject: `Mitra FP&A - Lembrete: ${versaoNome}`,
            body: buildEmailHtml(g.NOME, versaoNome, url),
          },
        });
      })
    );
    const sent = results.filter(emailOk).length;
    const failed = selected.length - sent;
    if (failed > 0) {
      addToast('error', `Emails: ${sent} enviados, ${failed} falharam.`);
    } else {
      addToast('success', `Emails enviados para ${sent} gestor(es)!`);
    }
  };

  // Duplicar versão com dados — 1 chamada server-side (SF 191, modo duplicar):
  // fecha abertas, cria o CICLO copia, mapa de status e todos os dados (orcamento,
  // pacotes, pessoal, headcount, premissas) via INSERT...SELECT. Idempotente
  // contra duplo clique.
  const handleDuplicar = async (versaoId: number) => {
    const versao = versoes.find((v: any) => v.ID === versaoId);
    if (!versao || duplicando !== null) return;
    setDuplicando(versaoId);
    try {
      const out = await criarVersaoServidor({
        modo: 'duplicar',
        nome: `${versao.NOME} (cópia)`,
        ano: versao.ANO,
        ultimoMesRealizado: versao.ULTIMO_MES_REALIZADO || 0,
        versaoControle: 'false',
        origemId: versaoId,
        criadoPor: getCurrentUserEmail(),
      });
      if (!out.ok) throw new Error(out.error || 'Falha ao duplicar');
      if (out.dedup) {
        addToast('success', 'Essa versão já havia sido duplicada — nenhuma duplicata foi gerada.');
      } else {
        addToast('success', 'Versão duplicada com dados copiados!' + avisoOrigem(out));
      }
      refetch();
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao duplicar versão');
    } finally {
      setDuplicando(null);
    }
  };

  // Set version as current
  const handleTornarAtual = async (versaoId: number) => {
    try {
      // Unmark all as not current
      const current = versoes.filter((v: any) => v.VERSAO_ATUAL === 'true');
      for (const v of current) {
        await updateRecord('CICLO', v.ID, { VERSAO_ATUAL: 'false' });
      }
      // Mark selected as current
      await updateRecord('CICLO', versaoId, { VERSAO_ATUAL: 'true' });
      addToast('success', 'Versão marcada como atual!');
      refetch();
    } catch (e) {
      addToast('error', 'Erro ao definir versão atual');
    }
  };

  const getStatusInfo = (status: string) => STATUS_MAP[status] || { label: status, variant: 'neutral' as const };

  const toggleYear = (ano: number) => {
    setCollapsedYears(prev => ({ ...prev, [ano]: prev[ano] === false ? true : false }));
  };

  // Group versions by year and apply search filter
  const anos = Array.from(new Set(versoes.map((v: any) => v.ANO))).sort((a: any, b: any) => b - a);
  const filteredVersoes = searchQuery.trim()
    ? versoes.filter((v: any) => v.NOME?.toLowerCase().includes(searchQuery.toLowerCase()))
    : versoes;
  const filteredAnos = searchQuery.trim()
    ? Array.from(new Set(filteredVersoes.map((v: any) => v.ANO))).sort((a: any, b: any) => b - a)
    : anos;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Versões</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Gerencie as versões do planejamento orçamentário
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openNew()}>
            <Plus size={16} className="mr-1" /> Nova Versão
          </Button>
        </div>
      </div>

      {/* Current version highlight */}
      {loading ? (
        <SkeletonCard className="p-4 flex items-center gap-3" style={{ height: 76 }}>
          <Skeleton className="w-7 h-7 shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-40" />
          </div>
        </SkeletonCard>
      ) : versaoAtual && (
        <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center border" style={{ backgroundColor: 'var(--color-icon-bg)', borderColor: 'var(--color-icon-border)' }}>
                <Star size={14} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Versão Atual: {versaoAtual.NOME}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  Ano {versaoAtual.ANO}
                  {versaoAtual.ULTIMO_MES_REALIZADO > 0 && ` | Realizado até ${MESES_LABELS[versaoAtual.ULTIMO_MES_REALIZADO]}`}
                  {versaoAtual.VERSAO_CONTROLE === 'true' && ' | Versão de Controle'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={getStatusInfo(versaoAtual.STATUS).variant}>{getStatusInfo(versaoAtual.STATUS).label}</Badge>
              {versaoAtual.STATUS === 'PENDENTE' && (
                <Button size="sm" onClick={() => openIniciar(versaoAtual)}>
                  <Play size={14} className="mr-1" /> Iniciar
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input
          className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm transition-all duration-200 border focus:outline-none focus:ring-2 focus:border-transparent"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
          placeholder="Buscar versão pelo nome..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Versions grouped by year */}
      {loading ? (
        <>
          {[0, 1].map((i) => (
            <SkeletonCard key={i} className="px-6 py-5 flex items-center gap-2" style={{ height: 68 }}>
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-24" style={{ borderRadius: '9999px' }} />
            </SkeletonCard>
          ))}
        </>
      ) : (
      <>
      {filteredAnos.length === 0 && (
        <div className="rounded-xl text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', padding: '2rem' }}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {searchQuery ? 'Nenhuma versão encontrada' : 'Nenhuma versão cadastrada'}
          </p>
        </div>
      )}
      {filteredAnos.map((ano: any) => {
        const yearVersions = filteredVersoes.filter((v: any) => v.ANO === ano);
        const isCollapsed = collapsedYears[ano] !== false;
        return (
          <div key={ano} className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            <button
              onClick={() => toggleYear(ano)}
              className="w-full flex items-center justify-between px-6 py-5 text-left transition-colors"
              style={{ borderBottom: isCollapsed ? 'none' : '1px solid var(--color-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? <ChevronRight size={16} style={{ color: 'var(--color-text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />}
                <span className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{ano}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--color-text-secondary)' }}>
                  {yearVersions.length} {yearVersions.length === 1 ? 'versão' : 'versões'}
                </span>
                {isCollapsed && (() => {
                  const controleV = yearVersions.find((v: any) => v.VERSAO_CONTROLE === 'true');
                  const execV = yearVersions.find((v: any) => v.STATUS === 'INICIADA');
                  return (
                    <>
                      {controleV && <Badge variant="info"><Shield size={10} className="mr-1" />Controle: {controleV.NOME}</Badge>}
                      {execV && <Badge variant="blue"><Play size={10} className="mr-1" />Em execução: {execV.NOME}</Badge>}
                    </>
                  );
                })()}
              </div>
            </button>
            {!isCollapsed && (
              <div className="overflow-x-auto"><table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: '140px' }} />
                  <col style={{ width: '170px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '160px' }} />
                </colgroup>
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                    <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Nome</th>
                    <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Status</th>
                    <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Último Mês Realiz.</th>
                    <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Atual</th>
                    <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Controle</th>
                    <th className="text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap" style={{ width: '1%' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {yearVersions.map((v: any) => {
                    const statusInfo = getStatusInfo(v.STATUS);
                    return (
                      <tr key={v.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="px-6 py-3 text-sm" style={{ color: 'var(--color-text)' }}>
                          <p className="font-medium" style={{ color: 'var(--color-text)' }}>{v.NOME}</p>
                          {v.CRIADO_EM && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                              {formatDateBR(v.CRIADO_EM)}{v.CRIADO_POR && ` · ${v.CRIADO_POR}`}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        </td>
                        <td className="px-3 py-3" style={{ color: 'var(--color-text-secondary)' }}>
                          {v.ULTIMO_MES_REALIZADO > 0 ? MESES_LABELS[v.ULTIMO_MES_REALIZADO] : '-'}
                        </td>
                        <td className="px-3 py-3">
                          {v.VERSAO_ATUAL === 'true' ? (
                            <Badge variant="success" dot>Sim</Badge>
                          ) : (
                            <button
                              onClick={() => handleTornarAtual(v.ID)}
                              className="flex items-center gap-1 text-xs font-medium transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                              title="Tornar esta versão a atual"
                            >
                              <RotateCcw size={11} /> Tornar
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            className="text-xs px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                            style={{ color: v.VERSAO_CONTROLE === 'true' ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                            onClick={() => handleToggleControle(v.ID, v.ANO, v.VERSAO_CONTROLE || 'false')}
                          >
                            <Shield size={12} />
                            {v.VERSAO_CONTROLE === 'true' ? 'Sim' : 'Não'}
                          </button>
                        </td>
                        <td className="px-3 py-3" style={{ width: '1%' }}>
                          <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                          {v.STATUS === 'PENDENTE' && (
                            <button className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors" style={{ color: 'var(--color-primary)' }} onClick={() => openIniciar(v)} title="Iniciar versão">
                              <Play size={16} />
                            </button>
                          )}
                          {v.STATUS === 'INICIADA' && (
                            <>
                              <button className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors" style={{ color: 'var(--color-text-secondary)' }} onClick={() => setCopiarLinksModal(v)} title="Copiar links dos gestores">
                                <Link2 size={16} />
                              </button>
                              <button className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors" style={{ color: 'var(--color-primary)' }} onClick={() => openReenviar(v)} title="Reenviar link por email">
                                <Send size={16} />
                              </button>
                            </>
                          )}
                          <button
                            className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors"
                            style={{ color: duplicando === v.ID ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
                            onClick={() => handleDuplicar(v.ID)}
                            disabled={duplicando !== null}
                            title="Duplicar versão com dados"
                          >
                            {duplicando === v.ID ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                          </button>
                          <button className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors" style={{ color: 'var(--color-text-secondary)' }} onClick={() => openEdit(v)} title="Editar">
                            <SquarePen size={16} />
                          </button>
                          {(() => {
                            // Iniciar a versao dispara os magic-links por e-mail aos gestores:
                            // a partir dai o orcamento saiu das nossas maos e virou registro de
                            // terceiros. Excluir apagaria o que outra pessoa ja recebeu e
                            // possivelmente preencheu, entao so a versao ainda PENDENTE some.
                            const iniciada = v.STATUS !== 'PENDENTE';
                            const rotuloStatus = getStatusInfo(v.STATUS).label;
                            return (
                              <Tooltip
                                side="top"
                                content={iniciada
                                  ? `Esta versão já foi iniciada (${rotuloStatus}) e os gestores já receberam o link de preenchimento — por isso ela não pode ser excluída dos registros.`
                                  : 'Excluir versão'}
                              >
                                <button
                                  className="p-1.5 rounded cursor-pointer border-0 bg-transparent transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                                  style={{ color: '#ef4444' }}
                                  onClick={() => !iniciada && setDeleteId(v.ID)}
                                  disabled={iniciada}
                                  aria-label={`Excluir versão ${v.NOME}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </Tooltip>
                            );
                          })()}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        );
      })}
      </>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar Versão' : form.VERSAO_ORIGEM_ID ? 'Nova Versão (Revisão)' : 'Nova Versão'}>
        <div className="space-y-4">
          {!editId && (
            <div className="p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' }}>
              Ao criar uma nova versão, todas as versões abertas serão automaticamente fechadas.
              A nova versão será marcada como <strong>atual</strong> e terá status <strong>Pendente</strong>.
            </div>
          )}
          {form.VERSAO_ORIGEM_ID && !editId && (
            <div className="p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--color-primary)' }}>
              Esta versão herdará as premissas (benefícios, cadastros de contas, etc.) da versão de origem.
              Novos dados poderão ser inseridos livremente.
            </div>
          )}
          <Input label="Nome" value={form.NOME} onChange={(v) => setForm({ ...form, NOME: v })} placeholder="Ex: Orçamento 2026 v2" />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Ano" type="number" value={String(form.ANO)} onChange={(v) => setForm({ ...form, ANO: parseInt(v) })} />
            <Select
              label="Último Mês Realizado"
              options={[
                { value: '0', label: 'Nenhum' },
                ...MESES_LABELS.slice(1).map((m, i) => ({ value: String(i + 1), label: m })),
              ]}
              value={String(form.ULTIMO_MES_REALIZADO)}
              onChange={(v) => setForm({ ...form, ULTIMO_MES_REALIZADO: parseInt(v) })}
            />
          </div>
          <Select
            label="Versão de Controle"
            options={[{ value: 'false', label: 'Não' }, { value: 'true', label: 'Sim' }]}
            value={form.VERSAO_CONTROLE}
            onChange={(v) => setForm({ ...form, VERSAO_CONTROLE: v })}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? (editId ? 'Salvando...' : 'Criando...') : (editId ? 'Salvar' : 'Criar Versão')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Iniciar Versão Modal - Review gestores */}
      <Modal isOpen={!!iniciarModal} onClose={() => { setIniciarModal(null); setIniciarSearch(''); }} title="">
        {(() => {
          const CR_COLORS = ['#75c95f','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
          const getCrColor = (id: number) => CR_COLORS[id % CR_COLORS.length];
          const filtered = gestores.filter((g: any) => {
            if (!iniciarSearch.trim()) return true;
            const q = iniciarSearch.toLowerCase();
            return g.NOME?.toLowerCase().includes(q) || g.EMAIL?.toLowerCase().includes(q);
          });
          const selectedCount = Object.values(gestoresChecked).filter(Boolean).length;
          const allChecked = gestores.length > 0 && gestores.every((g: any) => gestoresChecked[g.ID]);
          return (
            <div>
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-1">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <Play size={18} style={{ color: 'var(--color-text)' }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Iniciar Versão</h3>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {iniciarModal ? <>Selecione os gestores que receberão o link de <strong>{iniciarModal.NOME}</strong></> : 'Selecione os gestores'}
                  </p>
                </div>
              </div>

              {/* Search + badge */}
              <div className="flex items-center gap-2 mt-4 mb-3">
                <div className="flex-1 relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm"
                    style={{ backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--text)', outline: 'none' }}
                    placeholder="Buscar gestor ou email..."
                    value={iniciarSearch}
                    onChange={e => setIniciarSearch(e.target.value)}
                  />
                </div>
                <button
                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors"
                  style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-primary)' }}
                  onClick={() => {
                    const newChecked: Record<number, boolean> = {};
                    gestores.forEach((g: any) => { newChecked[g.ID] = !allChecked; });
                    setGestoresChecked(newChecked);
                  }}
                >
                  {allChecked ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              {/* List */}
              <div className="max-h-[380px] overflow-y-auto -mx-1 px-1">
                {gestores.length === 0 ? (
                  <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Nenhum gestor cadastrado. Cadastre gestores antes de iniciar.
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Nenhum gestor encontrado
                  </div>
                ) : filtered.map((g: any, idx: number) => {
                  const crIds = g.CR_IDS?.split(',').map(Number) || [];
                  const gestorCRs = crs.filter((c: any) => crIds.includes(c.ID));
                  const checked = gestoresChecked[g.ID] || false;
                  return (
                    <div key={g.ID}>
                      {idx > 0 && <div className="mx-2" style={{ borderBottom: '1px solid var(--color-border)', opacity: 0.5 }} />}
                      <div
                        className="flex items-start gap-3 py-3.5 px-2 rounded-lg transition-all cursor-pointer"
                        style={{ backgroundColor: 'transparent' }}
                        onClick={() => setGestoresChecked({ ...gestoresChecked, [g.ID]: !checked })}
                        onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        {/* Checkbox */}
                        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-2 transition-all duration-200"
                          style={{
                            border: checked ? 'none' : '2px solid var(--color-border)',
                            backgroundColor: checked ? '#10b981' : 'transparent',
                          }}>
                          {checked && <Check size={12} style={{ color: '#fff' }} />}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight" style={{ color: 'var(--color-text)' }}>{g.NOME}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{g.EMAIL}</p>
                          {gestorCRs.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1.5">
                              {gestorCRs.map((cr: any) => {
                                const c = getCrColor(cr.ID);
                                return (
                                  <span key={cr.ID} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${c} 7%, transparent)`, color: `color-mix(in srgb, ${c} 55%, #475569)` }}>
                                    {cr.NOME}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                  <Send size={10} /> {selectedCount} gestor{selectedCount !== 1 ? 'es' : ''} receber{selectedCount !== 1 ? 'ão' : 'á'} o link por email
                </span>
                <Button
                  size="sm"
                  onClick={handleIniciar}
                  disabled={initiating || selectedCount === 0}
                >
                  {initiating ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" /> Iniciando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Play size={13} /> Iniciar Versão
                    </span>
                  )}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Reenviar Link Modal — design padronizado com Copiar Links */}
      <Modal isOpen={!!reenviarModal} onClose={() => { setReenviarModal(null); setReenviarSearch(''); }} title="">
        {(() => {
          const CR_COLORS = ['#75c95f','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
          const getCrColor = (id: number) => CR_COLORS[id % CR_COLORS.length];
          const filtered = gestores.filter((g: any) => {
            if (!reenviarSearch.trim()) return true;
            const q = reenviarSearch.toLowerCase();
            return g.NOME?.toLowerCase().includes(q) || g.EMAIL?.toLowerCase().includes(q);
          });
          const selectedCount = Object.values(reenviarChecked).filter(Boolean).length;
          const allChecked = gestores.length > 0 && gestores.every((g: any) => reenviarChecked[g.ID]);
          return (
            <div>
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-1">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <RotateCcw size={18} style={{ color: 'var(--color-text)' }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Reenviar Links</h3>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {reenviarModal ? <>Reenviar links de <strong>{reenviarModal.NOME}</strong> por email</> : 'Reenviar links por email'}
                  </p>
                </div>
              </div>

              {/* Search + badge */}
              <div className="flex items-center gap-2 mt-4 mb-3">
                <div className="flex-1 relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm"
                    style={{ backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--text)', outline: 'none' }}
                    placeholder="Buscar gestor ou email..."
                    value={reenviarSearch}
                    onChange={e => setReenviarSearch(e.target.value)}
                  />
                </div>
                <button
                  className="text-[11px] font-medium px-2.5 py-1.5 whitespace-nowrap transition-colors hover:underline"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-primary)' }}
                  onClick={() => {
                    const newChecked: Record<number, boolean> = {};
                    gestores.forEach((g: any) => { newChecked[g.ID] = !allChecked; });
                    setReenviarChecked(newChecked);
                  }}
                >
                  {allChecked ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              {/* List */}
              <div className="max-h-[380px] overflow-y-auto -mx-1 px-1">
                {filtered.length === 0 ? (
                  <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Nenhum gestor encontrado
                  </div>
                ) : filtered.map((g: any, idx: number) => {
                  const crIds = g.CR_IDS?.split(',').map(Number) || [];
                  const gestorCRs = crs.filter((c: any) => crIds.includes(c.ID));
                  const checked = reenviarChecked[g.ID] || false;
                  return (
                    <div key={g.ID}>
                      {idx > 0 && <div className="mx-2" style={{ borderBottom: '1px solid var(--color-border)', opacity: 0.5 }} />}
                      <div
                        className="flex items-start gap-3 py-3.5 px-2 rounded-lg transition-all cursor-pointer"
                        style={{ backgroundColor: 'transparent' }}
                        onClick={() => setReenviarChecked({ ...reenviarChecked, [g.ID]: !checked })}
                        onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                      >
                        {/* Checkbox */}
                        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-2 transition-all duration-200"
                          style={{
                            border: checked ? 'none' : '2px solid var(--color-border)',
                            backgroundColor: checked ? '#10b981' : 'transparent',
                          }}>
                          {checked && <Check size={12} style={{ color: '#fff' }} />}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight" style={{ color: 'var(--color-text)' }}>{g.NOME}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{g.EMAIL}</p>
                          {gestorCRs.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1.5">
                              {gestorCRs.map((cr: any) => {
                                const c = getCrColor(cr.ID);
                                return (
                                  <span key={cr.ID} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${c} 7%, transparent)`, color: `color-mix(in srgb, ${c} 55%, #475569)` }}>
                                    {cr.NOME}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                  <Send size={10} /> {selectedCount} gestor{selectedCount !== 1 ? 'es' : ''} selecionado{selectedCount !== 1 ? 's' : ''}
                </span>
                <Button
                  size="sm"
                  onClick={handleReenviar}
                  disabled={reenviando || selectedCount === 0}
                >
                  {reenviando ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" /> Enviando...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Send size={13} /> Reenviar
                    </span>
                  )}
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Copiar Links Modal */}
      <Modal isOpen={!!copiarLinksModal} onClose={() => { setCopiarLinksModal(null); setLinkSearch(''); setCopiedId(null); }} title="">
        {(() => {
          const CR_COLORS = ['#75c95f','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
          const getCrColor = (id: number) => CR_COLORS[id % CR_COLORS.length];
          const handleCopy = (id: number) => { copyGestorLink(copiarLinksModal?.ID, id); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };
          const filtered = gestores.filter((g: any) => {
            if (!linkSearch.trim()) return true;
            const q = linkSearch.toLowerCase();
            return g.NOME?.toLowerCase().includes(q) || g.EMAIL?.toLowerCase().includes(q);
          });
          return (
            <div>
              {/* Header */}
              <div className="flex items-center gap-2.5 mb-1">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-hover)' }}>
                  <Link2 size={18} style={{ color: 'var(--color-text)' }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Links de Preenchimento</h3>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Copie o link de cada gestor para enviar diretamente</p>
                </div>
              </div>

              {/* Search */}
              <div className="mt-4 mb-3">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm"
                    style={{ backgroundColor: 'transparent', border: '1px solid var(--color-border)', color: 'var(--text)', outline: 'none' }}
                    placeholder="Buscar gestor ou email..."
                    value={linkSearch}
                    onChange={e => setLinkSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* List */}
              <div className="max-h-[380px] overflow-y-auto -mx-1 px-1">
                {filtered.map((g: any, idx: number) => {
                  const crIds = g.CR_IDS?.split(',').map(Number) || [];
                  const gestorCRs = crs.filter((c: any) => crIds.includes(c.ID));
                  const isCopied = copiedId === g.ID;
                  return (
                    <div key={g.ID}>
                      {idx > 0 && <div className="mx-2" style={{ borderBottom: '1px solid var(--color-border)', opacity: 0.5 }} />}
                      <div className="flex items-start gap-3 py-3.5 px-2 rounded-lg transition-colors"
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight" style={{ color: 'var(--color-text)' }}>{g.NOME}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{g.EMAIL}</p>
                          {gestorCRs.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1.5">
                              {gestorCRs.map((cr: any) => {
                                const c = getCrColor(cr.ID);
                                return (
                                  <span key={cr.ID} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${c} 7%, transparent)`, color: `color-mix(in srgb, ${c} 55%, #475569)` }}>
                                    {cr.NOME}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {/* Action */}
                        <div className="flex flex-col items-end shrink-0 gap-1 mt-0.5">
                          <button
                            onClick={() => handleCopy(g.ID)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                            style={{
                              border: isCopied ? '1px solid #10b981' : '1px solid var(--color-border)',
                              backgroundColor: isCopied ? 'color-mix(in srgb, #10b981 8%, transparent)' : 'transparent',
                              color: isCopied ? '#10b981' : 'var(--color-text-secondary)',
                            }}
                          >
                            {isCopied ? <><Check size={12} /> Copiado</> : <><Link2 size={12} /> Copiar link</>}
                          </button>
                          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                            Link gerado em {formatDateBR(copiarLinksModal?.CRIADO_EM) || formatDateBR(new Date().toISOString())}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Nenhum gestor encontrado
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                  <Shield size={10} /> Os links são únicos e seguros
                </span>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog isOpen={!!deleteId} onClose={() => { if (!deleting) setDeleteId(null); }} onConfirm={handleDelete} title="Excluir Versão" message={deleting ? 'Removendo dados vinculados (orçamento, pacotes, pessoal, status)... isso pode levar alguns segundos.' : 'Deseja excluir esta versão? Dados de orçamento vinculados podem ser afetados.'} confirmLabel="Excluir" loading={deleting} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
