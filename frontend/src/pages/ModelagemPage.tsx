import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSF, useList, jsonField, SF_IDS, createRecord, removeRecord, batchCreate, gerenciarModelo, execSF, sincronizarCardsCiclo } from '../hooks/useMitraData';
import { Card } from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import MultiSelect from '../components/ui/MultiSelect';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import {
  Search, Plus, X, Layers, Package, Lock, Settings, Maximize2,
  CheckCircle2, AlertCircle, FileText, Link2, ShieldAlert, MoreVertical,
  Sparkles, Users, Trash2, Ban, History, ChevronDown, GripVertical, ArrowUpDown, HelpCircle, Bell,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Tooltip from '../components/ui/Tooltip';
import { SkeletonListItems } from '../components/ui/Skeleton';
import FormulasModeloEditor, { canonFromSnapshot } from '../components/FormulasModeloEditor';
import ModeloHistoricoModal from '../components/ModeloHistoricoModal';
import { toTitleCase, tipoLabel } from '../lib/utils';

const PADRAO_NAMES = new Set(['BASE_ZERO', 'BASE_HISTORICO', 'PESSOAL']);

// Taxonomia por origem (coluna DRIVERS.ORIGEM): NATIVO e IA nao sao configuraveis
// (apenas disclaimer); TELA e totalmente autoravel. Fallback por nome cobre
// registros anteriores a migracao add-driver-origem.mjs.
type DriverOrigem = 'NATIVO' | 'IA' | 'TELA';
function origemOf(d: any): DriverOrigem {
  if (d?.ORIGEM === 'NATIVO' || d?.ORIGEM === 'IA' || d?.ORIGEM === 'TELA') return d.ORIGEM;
  return PADRAO_NAMES.has(d?.NOME) ? 'NATIVO' : 'TELA';
}

// Como cada driver nativo funciona — texto do disclaimer (gestor: nativo nao tem
// config, so explicacao de como funciona e quais contas/CRs estao envolvidos)
const NATIVO_COMO_FUNCIONA: Record<string, string> = {
  BASE_ZERO: 'O gestor de cada setor digita os valores mês a mês, do zero, sem base histórica. O sistema não calcula nada automaticamente para as contas deste driver.',
  BASE_HISTORICO: 'O sistema traz o realizado histórico de cada conta e projeta os meses aplicando a variação percentual definida no preenchimento.',
  PESSOAL: 'Calculado automaticamente a partir do módulo de Pessoal: colaboradores, salários, benefícios e encargos de cada setor. Os valores não são digitados no orçamento.',
};

export default function ModelagemPage({
  embedded = false,
  initialCreateMode = null,
  onCreateModeConsumed,
}: {
  embedded?: boolean;
  initialCreateMode?: 'NORMAL' | 'PACOTE' | null;
  onCreateModeConsumed?: () => void;
} = {}) {
  const navigate = useNavigate();

  // Mount em 1 ida: SF 132 devolve os 7 blocos como JSON (eram 7 chamadas sandbox).
  // DRIVER_CONFIGS conta SOMENTE linhas tipo FORMULA por driver (entrada manual nao
  // conta como "formula configurada"). Refetch individual = refetch da SF inteira.
  const { data: hotRows, loading: loadingHot, refetch: refetchHot } = useSF(SF_IDS.hotModelagemBase, {});
  const byCod = (a: any, b: any) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''));
  const drivers = useMemo(() => jsonField(hotRows?.[0]?.DRIVERS).sort((a: any, b: any) => String(a.TIPO_DRIVER ?? '').localeCompare(String(b.TIPO_DRIVER ?? '')) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [hotRows]);
  // Ordem escolhida dos modelos (DRIVERS.ORDEM via SF 198). Override local para
  // refletir o drag imediatamente, sem esperar o refetch.
  const { data: ordemRows, loading: loadingOrdem, refetch: refetchOrdem } = useSF(SF_IDS.driversOrdem, {});
  const [ordemOverride, setOrdemOverride] = useState<Map<number, number> | null>(null);
  const ordemMap = useMemo(() => {
    if (ordemOverride) return ordemOverride;
    const m = new Map<number, number>();
    (ordemRows || []).forEach((r: any) => m.set(Number(r.ID), Number(r.ORDEM)));
    return m;
  }, [ordemRows, ordemOverride]);
  const ordemOf = (d: any) => (ordemMap.has(d.ID) ? (ordemMap.get(d.ID) as number) : d.ID);
  const contas = useMemo(() => jsonField(hotRows?.[0]?.CONTAS).sort(byCod), [hotRows]);
  const crs = useMemo(() => jsonField(hotRows?.[0]?.CRS).sort(byCod), [hotRows]);
  const contaDrivers = useMemo(() => jsonField(hotRows?.[0]?.CONTA_DRIVERS), [hotRows]);
  const excecoes = useMemo(() => jsonField(hotRows?.[0]?.EXCECOES), [hotRows]);
  const driverConfigs = useMemo(() => jsonField(hotRows?.[0]?.DRIVER_CONFIGS), [hotRows]);
  const crConta = useMemo(() => jsonField(hotRows?.[0]?.CR_CONTA), [hotRows]);
  const refetchDrivers = refetchHot;
  const refetchContaDrivers = refetchHot;
  const refetchExcecoes = refetchHot;
  const refetchCrConta = refetchHot;

  const { toasts, addToast, removeToast } = useToast();

  // Seleção e UI
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  // Inline form de exceção (por conta) — declarado antes do useEffect que o reseta
  const [drawerContaId, setDrawerContaId] = useState<number | null>(null);
  const [drawerCR, setDrawerCR] = useState('');
  const [drawerAltDriver, setDrawerAltDriver] = useState('');

  // Inline ajuste de setores (por conta) — expande lista de CRs com checkboxes
  const [inlineSetoresContaId, setInlineSetoresContaId] = useState<number | null>(null);
  // Expansão read-only da linha: mostra os CRs (setores) vinculados à conta
  const [expandedContaId, setExpandedContaId] = useState<number | null>(null);

  // Histórico de versões publicadas (modelos personalizados) — modal compartilhado
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // Chip expandido no header — clique na tag mostra o resumo do que há dentro dela
  const [openChip, setOpenChip] = useState<'contas' | 'setores' | 'excecoes' | null>(null);
  const [nativeHelpOpen, setNativeHelpOpen] = useState(false);
  const nativeHelpRef = useRef<HTMLDivElement>(null);
  const chipPopRef = useRef<HTMLDivElement>(null);
  // Reset "Ver mais" e painéis contextuais ao trocar de modelo.
  useEffect(() => { setShowAllAccounts(false); setDrawerContaId(null); setInlineSetoresContaId(null); setExpandedContaId(null); setHistoricoOpen(false); setOpenChip(null); setNativeHelpOpen(false); }, [selectedId]);
  useEffect(() => {
    if (!openChip) return;
    const onDown = (e: MouseEvent) => {
      if (chipPopRef.current && !chipPopRef.current.contains(e.target as Node)) setOpenChip(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenChip(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openChip]);
  useEffect(() => {
    if (!nativeHelpOpen) return;
    const onDown = (e: MouseEvent) => {
      if (nativeHelpRef.current && !nativeHelpRef.current.contains(e.target as Node)) setNativeHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNativeHelpOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [nativeHelpOpen]);

  // Modais
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'NORMAL' | 'PACOTE' | null>(initialCreateMode);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createGestor, setCreateGestor] = useState('');
  const [busy, setBusy] = useState(false);
  // Gestores para o vínculo opcional de responsável na criação de pacote
  // (mesmo vínculo GESTOR_PACOTE que a Governança > Gestores gerencia)
  const { data: gestoresList } = useList('GESTOR');
  const gestorOptions = useMemo(
    () => (gestoresList || [])
      .slice()
      .sort((a: any, b: any) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? '')))
      .map((g: any) => ({ value: String(g.ID), label: g.NOME })),
    [gestoresList]
  );

  // Excluir / inativar modelo personalizado
  const [delOpen, setDelOpen] = useState(false);
  const [delCheck, setDelCheck] = useState<any>(null); // resultado do 'check' (ou 'tem_orcamento')
  const [delBusy, setDelBusy] = useState(false);

  // Busy state dos toggles de setor (inline por conta)
  const [setoresPickerBusy, setSetoresPickerBusy] = useState<string | null>(null);

  // Abre o modal de criação automaticamente quando vem do Mapeamento via ?novo=modelo
  // (?novo=pacote nao eh mais suportado — pacotes sao criados no RotaPicker do Por conta)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const novo = searchParams.get('novo');
    if (novo === 'modelo') {
      setCreateMode('NORMAL');
      setSearchParams((prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete('novo');
        return sp;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reage a mudancas da prop initialCreateMode (quando o pai sinaliza "abre o modal" sem remontar)
  useEffect(() => {
    if (initialCreateMode) {
      setCreateMode(initialCreateMode);
      onCreateModeConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCreateMode]);

  // Modal vincular conta
  const [linkTipos, setLinkTipos] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkSelected, setLinkSelected] = useState<Set<number>>(new Set());
  // Contas que estavam em outro modelo e o usuario confirmou mover pra este
  const [confirmedMoves, setConfirmedMoves] = useState<Set<number>>(new Set());
  // Conta aguardando confirmacao de movimentacao (mostra dialog)
  const [pendingMoveConta, setPendingMoveConta] = useState<any | null>(null);

  // Menu de ações por linha de conta
  const [openRowMenu, setOpenRowMenu] = useState<number | null>(null);

  // ============================================================
  // LOOKUPS
  // ============================================================
  const contasMap = useMemo(() => new Map<number, any>(contas.map((c: any) => [c.ID, c])), [contas]);
  const driversMap = useMemo(() => new Map<number, any>(drivers.map((d: any) => [d.ID, d])), [drivers]);
  const crsMap = useMemo(() => new Map<number, any>(crs.map((c: any) => [c.ID, c])), [crs]);
  const contaDriverByConta = useMemo(() => {
    const m = new Map<number, any>();
    contaDrivers.forEach((cd: any) => m.set(cd.CONTA_ID, cd));
    return m;
  }, [contaDrivers]);
  const formulasPorDriver = useMemo(() => {
    const m = new Map<number, number>();
    driverConfigs.forEach((dc: any) => m.set(dc.DRIVER_ID, Number(dc.QTD)));
    return m;
  }, [driverConfigs]);

  // Alterações não publicadas por driver: compara o desenho atual (LINHAS) com o
  // último snapshot publicado (SNAPSHOT), usando a mesma assinatura do editor.
  const { data: statusPubRows, loading: loadingStatusPub, refetch: refetchStatusPub } = useSF(SF_IDS.statusPublicacaoModelos, {});
  // Lista de modelos so pode afirmar "Nenhum modelo encontrado." depois que as
  // tres SFs do mount responderem — antes disso a lista esta vazia por falta de
  // resposta, nao por falta de dado.
  // Restrito a carga inicial (nenhum driver em tela ainda): nos refetch pos-acao
  // a lista ja tem conteudo — trocar por skeleton anularia, por exemplo, o
  // ordemOverride que existe justamente para refletir o drag na hora.
  const loadingModelos = (loadingHot || loadingOrdem || loadingStatusPub) && drivers.length === 0;
  const [statusPubLocal, setStatusPubLocal] = useState<Map<number, boolean>>(() => new Map());
  const handleUnpublishedChange = useCallback((driverId: number, hasUnpublished: boolean) => {
    setStatusPubLocal((current) => {
      if (current.get(driverId) === hasUnpublished) return current;
      const next = new Map(current);
      next.set(driverId, hasUnpublished);
      return next;
    });
  }, []);
  const naoPublicadoPorDriver = useMemo(() => {
    const m = new Map<number, boolean>();
    const parse = (v: any) => {
      if (v == null) return null;
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    };
    (statusPubRows || []).forEach((r: any) => {
      const linhas = parse(r.LINHAS) || [];
      const snap = parse(r.SNAPSHOT);
      const temSnapshot = Array.isArray(snap) ? snap.length > 0 : !!snap;
      // Só sinaliza quando há uma versão publicada e o desenho atual difere dela.
      if (!temSnapshot || !Array.isArray(linhas) || linhas.length === 0) {
        m.set(Number(r.DRIVER_ID), false);
        return;
      }
      try {
        m.set(Number(r.DRIVER_ID), canonFromSnapshot(linhas) !== canonFromSnapshot(snap));
      } catch {
        m.set(Number(r.DRIVER_ID), false);
      }
    });
    return m;
  }, [statusPubRows]);
  // CR_CONTA → Map<contaId, Set<crId>>
  const crsPorConta = useMemo(() => {
    const m = new Map<number, Set<number>>();
    crConta.forEach((r: any) => {
      if (!m.has(r.CONTA_ID)) m.set(r.CONTA_ID, new Set());
      m.get(r.CONTA_ID)!.add(r.CR_ID);
    });
    return m;
  }, [crConta]);
  // Exceções agrupadas por (contaId, driverId destino)
  const excecoesPorConta = useMemo(() => {
    const m = new Map<number, any[]>();
    excecoes.forEach((e: any) => {
      if (!m.has(e.CONTA_ID)) m.set(e.CONTA_ID, []);
      m.get(e.CONTA_ID)!.push(e);
    });
    return m;
  }, [excecoes]);

  // Stats por driver
  const driverStats = useMemo(() => {
    const stats = new Map<number, { contas: number; excecoes: number }>();
    drivers.forEach((d: any) => stats.set(d.ID, { contas: 0, excecoes: 0 }));
    contaDrivers.forEach((cd: any) => {
      const s = stats.get(cd.DRIVER_ID); if (s) s.contas += 1;
    });
    excecoes.forEach((e: any) => {
      const s = stats.get(e.DRIVER_ID); if (s) s.excecoes += 1;
    });
    return stats;
  }, [drivers, contaDrivers, excecoes]);

  // ============================================================
  // SEPARAÇÃO DE MODELOS
  // ============================================================
  const modelosPadrao = useMemo(
    () => drivers.filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && origemOf(d) === 'NATIVO'),
    [drivers]
  );
  const modelosIA = useMemo(
    () => drivers.filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && origemOf(d) === 'IA'),
    [drivers]
  );
  // Personalizados separados por ESCOPO: 'CR' (comportamento atual) e 'PACOTE'
  // (modelos aplicados às contas com rota pacote, com granularidade/rateio por linha)
  const modelosCustomCR = useMemo(
    () => drivers
      .filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && origemOf(d) === 'TELA' && d.ESCOPO !== 'PACOTE')
      .sort((a: any, b: any) => ordemOf(a) - ordemOf(b) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))),
    [drivers, ordemMap]
  );
  const modelosCustomPacote = useMemo(
    () => drivers
      .filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && origemOf(d) === 'TELA' && d.ESCOPO === 'PACOTE')
      .sort((a: any, b: any) => ordemOf(a) - ordemOf(b) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))),
    [drivers, ordemMap]
  );

  // Ordenacao GLOBAL dos modelos numa unica lista plana (todos os TIPO_DRIVER !=
  // 'PACOTE') — permite qualquer ordem, inclusive um personalizado antes de um
  // nativo. Persiste ORDEM=1..N via SF 199. E a ordem unica respeitada nas abas
  // do gestor (interno + link publico) e no detalhe do Kanban. O botao "Ordenar"
  // abre um modal com drag; a lista lateral so exibe (nao arrasta) na ordem salva.
  const [showOrdenarModal, setShowOrdenarModal] = useState(false);
  const [ordList, setOrdList] = useState<any[]>([]);
  const [ordDragId, setOrdDragId] = useState<number | null>(null);
  const [ordDragOverId, setOrdDragOverId] = useState<number | null>(null);
  const [savingOrdem, setSavingOrdem] = useState(false);
  const openOrdenarModal = () => {
    const list = drivers
      .filter((d: any) => d.TIPO_DRIVER !== 'PACOTE')
      .slice()
      .sort((a: any, b: any) => ordemOf(a) - ordemOf(b) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? '')));
    setOrdList(list);
    setShowOrdenarModal(true);
  };
  const reorderOrdList = (sourceId: number, targetId: number) => {
    if (sourceId === targetId) return;
    setOrdList((prev) => {
      const ids = prev.map((d: any) => d.ID);
      const from = ids.indexOf(sourceId); const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const saveOrdem = () => {
    setSavingOrdem(true);
    const ids = ordList.map((d: any) => d.ID);
    const next = new Map<number, number>(ordemMap);
    ids.forEach((id: number, i: number) => next.set(id, i + 1));
    setOrdemOverride(next); // override otimista: a lista lateral reflete na hora
    Promise.all(ids.map((id: number, i: number) => execSF(SF_IDS.setDriverOrdem, { driverId: id, ordem: i + 1 })))
      .then(() => refetchOrdem())
      .catch(() => { /* mantem override; proxima carga reconcilia */ })
      .finally(() => { setSavingOrdem(false); setShowOrdenarModal(false); addToast('success', 'Ordem dos modelos atualizada'); });
  };
  const ordemBadge = (d: any): { label: string; color: string } => {
    const org = origemOf(d);
    if (org === 'NATIVO') return { label: 'Nativo', color: '#64748b' };
    if (org === 'IA') return { label: 'IA', color: '#8b5cf6' };
    if (d.ESCOPO === 'PACOTE') return { label: 'Pacote corp.', color: '#0ea5e9' };
    return { label: 'Por setor', color: 'var(--color-primary)' };
  };
  // Driver -> Set de contas vinculadas (para busca por nome de conta no sidebar)
  const contasPorDriver = useMemo(() => {
    const m = new Map<number, { codigo: string; nome: string }[]>();
    contaDrivers.forEach((cd: any) => {
      const c = contasMap.get(cd.CONTA_ID);
      if (!c) return;
      const arr = m.get(cd.DRIVER_ID) || [];
      arr.push({ codigo: (c.CODIGO || '').toLowerCase(), nome: (c.NOME || '').toLowerCase() });
      m.set(cd.DRIVER_ID, arr);
    });
    return m;
  }, [contaDrivers, contasMap]);

  const filterList = (list: any[]) => {
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter((d: any) => {
      if (d.NOME.toLowerCase().includes(s)) return true;
      if ((d.DESCRICAO || '').toLowerCase().includes(s)) return true;
      const contas = contasPorDriver.get(d.ID) || [];
      return contas.some((c) => c.nome.includes(s) || c.codigo.includes(s));
    });
  };

  // ============================================================
  // CONTEXTO DO MODELO SELECIONADO
  // ============================================================
  const selectedDriver = selectedId != null ? driversMap.get(selectedId) : null;
  const isPacote = selectedDriver?.TIPO_DRIVER === 'PACOTE';
  const origemSelecionado: DriverOrigem = selectedDriver ? origemOf(selectedDriver) : 'TELA';
  const isIA = !isPacote && origemSelecionado === 'IA';
  // "Padrao" = nao configuravel (nativo ou criado pela IA) — so disclaimer
  const isPadrao = selectedDriver ? !isPacote && origemSelecionado !== 'TELA' : false;
  const isCustom = selectedDriver ? !isPadrao && !isPacote : false;

  // Setores envolvidos no driver selecionado (uniao dos CRs das contas vinculadas
  // + CRs de excecoes que apontam pra ele) — usado no disclaimer de nativos/IA
  const setoresEnvolvidos = useMemo(() => {
    if (!selectedDriver) return [] as any[];
    const ids = new Set<number>();
    contaDrivers.forEach((cd: any) => {
      if (cd.DRIVER_ID !== selectedDriver.ID) return;
      const set = crsPorConta.get(cd.CONTA_ID);
      if (set) set.forEach((id) => ids.add(id));
    });
    excecoes.forEach((e: any) => { if (e.DRIVER_ID === selectedDriver.ID) ids.add(e.CR_ID); });
    return Array.from(ids)
      .map((id) => crsMap.get(id))
      .filter(Boolean)
      .sort((a: any, b: any) => String(a.CODIGO).localeCompare(String(b.CODIGO)));
  }, [selectedDriver, contaDrivers, crsPorConta, excecoes, crsMap]);

  const formulasCount = selectedDriver ? formulasPorDriver.get(selectedDriver.ID) || 0 : 0;
  const formulaConfigured = isCustom ? formulasCount > 0 : true;

  const contasVinculadas = useMemo(() => {
    if (!selectedDriver) return [] as any[];
    return contaDrivers
      .filter((cd: any) => cd.DRIVER_ID === selectedDriver.ID)
      .map((cd: any) => ({ ...cd, conta: contasMap.get(cd.CONTA_ID) }))
      .filter((x: any) => x.conta)
      .sort((a: any, b: any) => a.conta.CODIGO.localeCompare(b.conta.CODIGO));
  }, [selectedDriver, contaDrivers, contasMap]);

  // Setores cobertos = setoresEnvolvidos (CRs das contas vinculadas + exceções que
  // apontam pra este modelo) — mesma lista exibida no popover do chip do header
  const setoresCobertos = setoresEnvolvidos.length;

  // Exceções APONTANDO para este modelo (este modelo é o substituto)
  const excecoesParaEsteDriver = useMemo(() => {
    if (!selectedDriver) return [] as any[];
    return excecoes
      .filter((e: any) => e.DRIVER_ID === selectedDriver.ID)
      .map((e: any) => {
        const conta = contasMap.get(e.CONTA_ID);
        const cr = crsMap.get(e.CR_ID);
        const original = contaDriverByConta.get(e.CONTA_ID);
        const originalDriver = original ? driversMap.get(original.DRIVER_ID) : null;
        return { ...e, conta, cr, originalDriver };
      })
      .filter((x: any) => x.conta && x.cr)
      .sort((a: any, b: any) => a.cr.CODIGO.localeCompare(b.cr.CODIGO));
  }, [selectedDriver, excecoes, contasMap, crsMap, contaDriverByConta, driversMap]);


  // Plano de contas filtrado para o drawer Vincular (todas exceto as ja vinculadas a este modelo)
  const tipoValues = useMemo(
    () => [...new Set(contas.map((c: any) => c.TIPO).filter(Boolean))].sort() as string[],
    [contas]
  );
  const contasParaVinculo = useMemo(() => {
    if (!selectedDriver) return [] as any[];
    let list = contas.filter((c: any) => {
      const cd = contaDriverByConta.get(c.ID);
      return !cd || cd.DRIVER_ID !== selectedDriver.ID;
    });
    if (linkTipos.length > 0) {
      const setTipos = new Set(linkTipos);
      list = list.filter((c: any) => setTipos.has(c.TIPO));
    }
    if (linkSearch.trim()) {
      const s = linkSearch.toLowerCase();
      list = list.filter((c: any) => c.CODIGO.toLowerCase().includes(s) || c.NOME.toLowerCase().includes(s));
    }
    return list;
  }, [contas, contaDriverByConta, selectedDriver, linkTipos, linkSearch]);

  // Fecha menu de linha ao clicar fora
  useEffect(() => {
    const onClick = () => setOpenRowMenu(null);
    if (openRowMenu !== null) {
      window.addEventListener('click', onClick);
      return () => window.removeEventListener('click', onClick);
    }
  }, [openRowMenu]);

  // ============================================================
  // HANDLERS
  // ============================================================
  const handleLinkSubmit = async () => {
    if (!selectedDriver) return;
    const ids = Array.from(linkSelected);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const now = new Date().toISOString().slice(0, 19);
      // 1) Para contas movidas: remover vinculo antigo primeiro
      const moves = ids.filter((id) => confirmedMoves.has(id));
      for (const contaId of moves) {
        const oldCd = contaDriverByConta.get(contaId);
        if (oldCd && oldCd.DRIVER_ID !== selectedDriver.ID) {
          await removeRecord('CONTA_DRIVER', oldCd.ID);
        }
      }
      // 2) Inserir novos vinculos (movidos + sem driver)
      const records = ids.map((id) => ({ CONTA_ID: id, DRIVER_ID: selectedDriver.ID, CRIADO_EM: now }));
      if (records.length === 1) await createRecord('CONTA_DRIVER', records[0]);
      else await batchCreate('CONTA_DRIVER', records);
      const movedTxt = moves.length > 0 ? ` (${moves.length} migrada${moves.length === 1 ? '' : 's'})` : '';
      addToast('success', `${ids.length} conta${ids.length === 1 ? '' : 's'} vinculada${ids.length === 1 ? '' : 's'}${movedTxt}`);
      refetchContaDrivers();
      setLinkModalOpen(false); setLinkTipos([]); setLinkSearch('');
      setLinkSelected(new Set()); setConfirmedMoves(new Set()); setPendingMoveConta(null);
    } catch { addToast('error', 'Erro ao vincular contas'); }
    setBusy(false);
  };

  const handleUnlinkConta = async (cdId: number) => {
    setBusy(true);
    try {
      await removeRecord('CONTA_DRIVER', cdId);
      refetchContaDrivers();
      addToast('success', 'Conta desvinculada');
    } catch { addToast('error', 'Erro ao desvincular'); }
    setBusy(false);
  };

  // Toggle CR_CONTA pra o (CR, conta) clicado no drawer Ajustar setores
  const toggleSetorConta = async (crId: number, contaId: number) => {
    const key = `${crId}-${contaId}`;
    setSetoresPickerBusy(key);
    try {
      const existing = crConta.find((r: any) => r.CR_ID === crId && r.CONTA_ID === contaId);
      if (existing) {
        await removeRecord('CR_CONTA', existing.ID);
      } else {
        await createRecord('CR_CONTA', {
          CR_ID: crId,
          CONTA_ID: contaId,
          ATIVO: true,
          CRIADO_EM: new Date().toISOString().slice(0, 19),
        });
      }
      refetchCrConta();
    } catch { addToast('error', 'Erro ao atualizar vínculo'); }
    setSetoresPickerBusy(null);
  };

  // Marca ou desmarca todos os CRs da lista (respeita o filtro passado)
  const bulkToggleSetoresConta = async (crsToToggle: any[], contaId: number, mark: boolean) => {
    setSetoresPickerBusy(`bulk-${contaId}`);
    try {
      const existingPorCR = new Map<number, any>();
      crConta.forEach((r: any) => { if (r.CONTA_ID === contaId) existingPorCR.set(r.CR_ID, r); });
      if (mark) {
        const novosRegs = crsToToggle
          .filter((cr) => !existingPorCR.has(cr.ID))
          .map((cr) => ({
            CR_ID: cr.ID,
            CONTA_ID: contaId,
            ATIVO: true,
            CRIADO_EM: new Date().toISOString().slice(0, 19),
          }));
        for (const reg of novosRegs) {
          await createRecord('CR_CONTA', reg);
        }
      } else {
        const aRemover = crsToToggle
          .map((cr) => existingPorCR.get(cr.ID))
          .filter(Boolean);
        for (const reg of aRemover) {
          await removeRecord('CR_CONTA', reg.ID);
        }
      }
      refetchCrConta();
    } catch { addToast('error', 'Erro ao atualizar vínculos em lote'); }
    setSetoresPickerBusy(null);
  };

  // Drawer: adicionar exceção contextual à conta aberta
  const handleAddExcecaoFromDrawer = async () => {
    if (!selectedDriver || !drawerContaId || !drawerCR || !drawerAltDriver) {
      addToast('error', 'Selecione setor e modelo alternativo');
      return;
    }
    const crIdNum = Number(drawerCR);
    const altDriverNum = Number(drawerAltDriver);
    if (altDriverNum === selectedDriver.ID) {
      addToast('error', 'Modelo alternativo deve ser diferente da regra geral');
      return;
    }
    const exists = excecoes.find((e: any) => e.CR_ID === crIdNum && e.CONTA_ID === drawerContaId);
    if (exists) {
      addToast('error', 'Já existe exceção para este CR/conta — remova a anterior antes');
      return;
    }
    setBusy(true);
    try {
      await createRecord('CONTA_DRIVER_EXCECAO', {
        CR_ID: crIdNum,
        CONTA_ID: drawerContaId,
        DRIVER_ID: altDriverNum,
        ATIVO: true,
        CRIADO_EM: new Date().toISOString().slice(0, 19),
      });
      addToast('success', 'Exceção adicionada');
      refetchExcecoes();
      setDrawerCR(''); setDrawerAltDriver('');
    } catch { addToast('error', 'Erro ao adicionar exceção'); }
    setBusy(false);
  };

  const handleRemoveExcecao = async (excId: number) => {
    setBusy(true);
    try {
      await removeRecord('CONTA_DRIVER_EXCECAO', excId);
      refetchExcecoes();
      addToast('success', 'Exceção removida');
    } catch { addToast('error', 'Erro ao remover exceção'); }
    setBusy(false);
  };

  function normalizeModelName(raw: string): string {
    return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  }
  const previewName = normalizeModelName(createName);

  const handleCreateModel = async () => {
    const nome = previewName;
    if (!createMode) return;
    if (!nome) { addToast('error', 'Informe um nome válido para o modelo'); return; }
    if (drivers.some((d: any) => d.NOME === nome)) { addToast('error', `Já existe um modelo chamado "${nome}"`); return; }
    setBusy(true);
    try {
      const res: any = await createRecord('DRIVERS', {
        NOME: nome, DESCRICAO: createDesc.trim() || null, COR: 'info',
        ATIVO: 'true', CRIADO_EM: new Date().toISOString().slice(0, 19), TIPO_DRIVER: 'NORMAL',
        ORIGEM: 'TELA',
        // Escopo do modelo: 'CR' (rota bottom-up) ou 'PACOTE' (o pacote em si —
        // conceito fundido: o modelo de pacote É o pacote)
        ESCOPO: createMode === 'PACOTE' ? 'PACOTE' : 'CR',
      });
      const newId = res?.id ?? res?.result?.id ?? res?.ID;
      // Pacote: vínculo opcional de responsável (GESTOR_PACOTE) já na criação —
      // o pacote aparece na Governança > Gestores e no workflow do responsável.
      const gestorSel = createMode === 'PACOTE' && createGestor
        ? (gestoresList || []).find((g: any) => String(g.ID) === createGestor) : null;
      if (typeof newId === 'number' && gestorSel) {
        try {
          await createRecord('GESTOR_PACOTE', { GESTOR_ID: gestorSel.ID, DRIVER_ID: newId });
          // Card PENDENTE nos ciclos abertos: sem ele o pacote não aparece no
          // /workflow nem no link público do responsável até a próxima versão.
          // Mesma SF usada pela tela Gestores — uma regra só para os cards.
          try { await sincronizarCardsCiclo(); }
          catch { /* card é derivável — não bloqueia a criação */ }
          addToast('success', `Pacote criado — ${gestorSel.NOME} definido como responsável`);
        } catch {
          addToast('error', 'Pacote criado, mas houve erro ao vincular o responsável. Vincule em Governança > Gestores.');
        }
      } else {
        addToast('success', createMode === 'PACOTE' ? 'Pacote criado' : 'Modelo personalizado criado');
      }
      refetchDrivers();
      if (typeof newId === 'number') setSelectedId(newId);
      setCreateMode(null); setCreateName(''); setCreateDesc(''); setCreateGestor('');
    } catch { addToast('error', 'Erro ao criar modelo'); }
    setBusy(false);
  };

  // ── Excluir / inativar modelo ──────────────────────────────
  // Regra: sem orcamento preenchido -> exclui (limpa vinculos/formulas em cascata);
  // com orcamento preenchido -> so inativa (some da lista). Nativo nunca.
  const openDeleteModel = async () => {
    if (!selectedDriver) return;
    setDelBusy(true); setDelCheck(null); setDelOpen(true);
    try {
      const info = await gerenciarModelo(selectedDriver.ID, 'check');
      if (!info?.ok) { addToast('error', 'Este modelo não pode ser excluído.'); setDelOpen(false); }
      else setDelCheck(info);
    } catch { addToast('error', 'Erro ao verificar o modelo'); setDelOpen(false); }
    setDelBusy(false);
  };

  const confirmExcluir = async () => {
    if (!selectedDriver) return;
    setDelBusy(true);
    try {
      const r = await gerenciarModelo(selectedDriver.ID, 'excluir');
      if (r?.ok && r.excluido) {
        addToast('success', 'Modelo excluído');
        setDelOpen(false); setSelectedId(null); refetchDrivers();
      } else if (r?.error === 'tem_orcamento') {
        setDelCheck(r); // passou a ter orcamento: alterna para o modo "inativar"
      } else {
        addToast('error', 'Não foi possível excluir o modelo');
      }
    } catch { addToast('error', 'Erro ao excluir o modelo'); }
    setDelBusy(false);
  };

  const confirmInativar = async () => {
    if (!selectedDriver) return;
    setDelBusy(true);
    try {
      const r = await gerenciarModelo(selectedDriver.ID, 'inativar');
      if (r?.ok && r.inativado) {
        addToast('success', 'Modelo inativado');
        setDelOpen(false); setSelectedId(null); refetchDrivers();
      } else {
        addToast('error', 'Não foi possível inativar o modelo');
      }
    } catch { addToast('error', 'Erro ao inativar o modelo'); }
    setDelBusy(false);
  };

  // ============================================================
  // SUBCOMPONENTES
  // ============================================================

  function DriverListItem({ d }: { d: any }) {
    const stats = driverStats.get(d.ID) || { contas: 0, excecoes: 0 };
    const isSelected = selectedId === d.ID;
    const isPkt = d.TIPO_DRIVER === 'PACOTE';
    const org = origemOf(d);
    const isStd = !isPkt && org !== 'TELA';
    const isCst = !isPkt && !isStd;
    const formCount = formulasPorDriver.get(d.ID) || 0;
    const formulaPendente = isCst && formCount === 0;
    const semContas = stats.contas === 0;

    const Icon = isPkt ? Package : org === 'IA' ? Sparkles : isStd ? Lock : d.ESCOPO === 'PACOTE' ? Package : Layers;

    const naoPublicado = !isStd && (statusPubLocal.get(d.ID) ?? naoPublicadoPorDriver.get(d.ID) ?? false);

    // Status resumido — pronto vira flag verde; pendências mostram ícone + motivo
    let statusLabel = 'Pronto';
    let statusTone: 'ok' | 'warn' | 'muted' = 'ok';
    if (semContas) { statusLabel = 'Sem contas'; statusTone = 'warn'; }
    else if (formulaPendente) { statusLabel = 'Fórmula pendente'; statusTone = 'warn'; }
    else if (naoPublicado) { statusLabel = 'Alterações não publicadas'; statusTone = 'warn'; }

    const isReady = statusTone === 'ok';
    const statusColor = statusTone === 'ok' ? '#16a34a' : statusTone === 'warn' ? 'var(--color-primary)' : 'var(--color-text-secondary)';

    return (
      <div
        className="relative w-full rounded-lg transition-colors flex items-stretch gap-1 pr-1 group"
        style={{
          backgroundColor: isSelected ? 'var(--color-primary-bg)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <button
          type="button"
          onClick={() => setSelectedId(d.ID)}
          className="flex-1 min-w-0 text-left pl-3.5 pr-1.5 py-2.5 cursor-pointer flex items-start gap-2.5"
          style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text)', background: 'transparent' }}
        >
          <Icon size={15} className="mt-0.5 shrink-0" style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text-secondary)' }} />
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <span className="text-sm font-medium truncate" style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text)' }}>
              {toTitleCase(d.NOME.replace(/_/g, ' '))}
            </span>
            <span className="shrink-0 inline-flex" style={{ color: statusColor }} title={isReady ? 'Pronto' : statusLabel} aria-label={isReady ? 'Pronto' : statusLabel}>
              {isReady ? (
                <CheckCircle2 size={13} style={{ color: '#16a34a' }} />
              ) : (
                <AlertCircle size={13} />
              )}
            </span>
          </div>
        </button>
        {isCst && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(`/modelos/${d.ID}/formulas`); }}
            className="shrink-0 self-center p-1.5 rounded transition-colors cursor-pointer opacity-50 group-hover:opacity-100"
            style={{ color: isSelected ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = isSelected ? 'var(--color-primary)' : 'var(--color-text-secondary)'; }}
            title="Configurar fórmulas"
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    );
  }

  // ─── Painel de IA: alertas sobre contas sem modelo / sem setor ───
  function AiInsights() {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const contasSemModelo = useMemo(
      () => contas.filter((c: any) => {
        const mapping = contaDriverByConta.get(c.ID);
        return !mapping || mapping.DRIVER_ID == null;
      }),
      [contas, contaDriverByConta],
    );
    const contasMapeadasEmAlgumCR = useMemo(() => {
      const s = new Set<number>();
      crConta.forEach((r: any) => s.add(r.CONTA_ID));
      return s;
    }, []);
    const contasSemSetor = useMemo(
      () => contas.filter((c: any) => !contasMapeadasEmAlgumCR.has(c.ID)),
      [contasMapeadasEmAlgumCR],
    );

    const total = contasSemModelo.length + contasSemSetor.length;
    const hasAlerts = total > 0;

    return (
      <div ref={wrapRef} className="relative shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer shadow-sm"
          style={{
            backgroundColor: open ? 'var(--color-hover)' : 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
          onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
          title="Insights"
        >
          <Bell size={14} style={{ color: 'var(--color-primary)' }} />
          <span className="text-[12px] font-medium">Insights</span>
          {hasAlerts && (
            <span
              className="inline-flex items-center justify-center text-[10px] font-semibold tabular-nums min-w-[16px] h-[16px] px-1 rounded-full"
              style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
            >
              {total}
            </span>
          )}
          <ChevronDown
            size={13}
            className="transition-transform"
            style={{ color: 'var(--color-text-secondary)', transform: open ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-2 z-30 rounded-xl shadow-lg overflow-hidden animate-scaleIn"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', width: 340 }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="text-[11px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>
                Insights
              </div>
              <div className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>
                {hasAlerts ? 'Pontos de atenção' : 'Tudo configurado'}
              </div>
            </div>

            {!hasAlerts ? (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 size={18} className="mx-auto mb-2" style={{ color: 'var(--color-primary)' }} />
                <div className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Nenhum alerta</div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Todas as contas estão vinculadas a um modelo e mapeadas em pelo menos um setor.
                </p>
              </div>
            ) : (
              <div className="py-1">
                {/* Contas sem modelo */}
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <Layers size={12} style={{ color: 'var(--color-text-secondary)' }} />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Contas sem modelo</span>
                    </div>
                    <span className="text-[11px] tabular-nums font-medium" style={{ color: contasSemModelo.length > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                      {contasSemModelo.length}
                    </span>
                  </div>
                  {contasSemModelo.length > 0 ? (
                    <>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                        Não serão calculadas no orçamento.
                      </p>
                      <ul className="text-[11px] mt-1.5 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {contasSemModelo.slice(0, 4).map((c: any) => (
                          <li key={c.ID} className="truncate">
                            <span className="font-mono">{c.CODIGO}</span> · {toTitleCase(c.NOME)}
                          </li>
                        ))}
                        {contasSemModelo.length > 4 && (
                          <li>+ {contasSemModelo.length - 4} outra{contasSemModelo.length - 4 === 1 ? '' : 's'}</li>
                        )}
                      </ul>
                    </>
                  ) : (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Todas têm um modelo.</p>
                  )}
                </div>

                {/* Contas sem setor */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <Users size={12} style={{ color: 'var(--color-text-secondary)' }} />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Contas sem setor</span>
                    </div>
                    <span className="text-[11px] tabular-nums font-medium" style={{ color: contasSemSetor.length > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                      {contasSemSetor.length}
                    </span>
                  </div>
                  {contasSemSetor.length > 0 ? (
                    <>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                        Não aparecem em nenhum CR.
                      </p>
                      <ul className="text-[11px] mt-1.5 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {contasSemSetor.slice(0, 4).map((c: any) => (
                          <li key={c.ID} className="truncate">
                            <span className="font-mono">{c.CODIGO}</span> · {toTitleCase(c.NOME)}
                          </li>
                        ))}
                        {contasSemSetor.length > 4 && (
                          <li>+ {contasSemSetor.length - 4} outra{contasSemSetor.length - 4 === 1 ? '' : 's'}</li>
                        )}
                      </ul>
                      <button
                        onClick={() => { setOpen(false); navigate('/regras-contabeis'); }}
                        className="mt-2 text-[11px] font-medium cursor-pointer transition-colors"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        Ir para Mapeamento →
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Todas estão em algum setor.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function StatusChip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'primary' | 'ok' | 'warn' }) {
    const stylesMap: Record<string, React.CSSProperties> = {
      default: { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)' },
      primary: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      ok: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      warn: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
    };
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap"
        style={stylesMap[tone]}
      >
        {children}
      </span>
    );
  }

  // Chip clicável do header — mesmo visual do StatusChip, mas abre o popover
  // com o resumo do que há dentro da tag (contas / setores / exceções)
  function ChipButton({ id, children, tone = 'default', tooltip }: {
    id: 'contas' | 'setores' | 'excecoes';
    children: React.ReactNode;
    tone?: 'default' | 'primary' | 'ok' | 'warn';
    tooltip: string;
  }) {
    const stylesMap: Record<string, React.CSSProperties> = {
      default: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      primary: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      ok: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      warn: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
    };
    const active = openChip === id;
    return (
      <Tooltip content={tooltip} side="bottom" disabled={active}>
        <button
          type="button"
          onClick={() => setOpenChip(active ? null : id)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap cursor-pointer transition-shadow"
          style={{
            ...stylesMap[tone],
            boxShadow: active ? 'inset 0 0 0 1px var(--color-primary)' : undefined,
          }}
          onMouseEnter={(e) => { if (!active) e.currentTarget.style.boxShadow = 'inset 0 0 0 1px var(--color-border)'; }}
          onMouseLeave={(e) => { if (!active) e.currentTarget.style.boxShadow = 'none'; }}
        >
          {children}
          <ChevronDown size={11} className="transition-transform" style={{ transform: active ? 'rotate(180deg)' : undefined }} />
        </button>
      </Tooltip>
    );
  }

  // ============================================================
  // FILTROS DA LISTA LATERAL
  // ============================================================
  const filteredPadrao = filterList(modelosPadrao);
  const filteredIA = filterList(modelosIA);
  const filteredCustomCR = filterList(modelosCustomCR);
  const filteredCustomPacote = filterList(modelosCustomPacote);

  // ============================================================
  // CONTEÚDO DAS ABAS
  // ============================================================
  function EmptyAccounts() {
    return (
      <div className="px-6 py-12 text-center">
        <div className="w-11 h-11 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
          <Link2 size={18} />
        </div>
        <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Nenhuma conta vinculada</h4>
        <p className="text-xs mt-1.5 max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
          Vincule as contas contábeis que serão calculadas por este {isPacote ? 'pacote' : 'modelo'}. Exemplo: Receita Bruta, Salários, Energia ou Software.
        </p>
        <button
          onClick={() => setLinkModalOpen(true)}
          disabled={busy}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={14} /> Vincular primeira conta
        </button>
      </div>
    );
  }

  function AccountRow({ item, isFirst }: { item: any; isFirst?: boolean }) {
    const conta = item.conta;
    const setores = crsPorConta.get(conta.ID)?.size || 0;
    const rawExcecoes = excecoesPorConta.get(conta.ID) || [];
    const excecoesDestaConta = rawExcecoes
      .map((ex: any) => ({ ...ex, cr: crsMap.get(ex.CR_ID), altDriver: driversMap.get(ex.DRIVER_ID) }))
      .filter((ex: any) => ex.cr && ex.altDriver)
      .sort((a: any, b: any) => a.cr.CODIGO.localeCompare(b.cr.CODIGO));
    const isMenuOpen = openRowMenu === item.ID;
    const isInlineExcecaoOpen = drawerContaId === conta.ID;
    const isInlineSetoresOpen = inlineSetoresContaId === conta.ID;
    const isExpanded = expandedContaId === conta.ID;
    const setoresAplicaveis = crsPorConta.get(conta.ID) || new Set();
    const contaCRs: Set<number> = (crsPorConta.get(conta.ID) || new Set()) as Set<number>;
    const crsVinculados = useMemo(
      () => Array.from(setoresAplicaveis)
        .map((id) => crsMap.get(id as number))
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.CODIGO).localeCompare(String(b.CODIGO))),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [conta.ID, crConta],
    );
    const [setoresSearch, setSetoresSearch] = useState('');
    const filteredCRs = useMemo(() => {
      const s = setoresSearch.trim().toLowerCase();
      if (!s) return crs;
      return crs.filter((cr: any) => cr.CODIGO.toLowerCase().includes(s) || cr.NOME.toLowerCase().includes(s));
    }, [setoresSearch, crs]);

    return (
      <div data-conta-row={conta.ID} className="transition-colors relative" style={{ borderTop: isFirst ? 'none' : '1px solid var(--color-border)' }}>
        <div className="px-4 py-2 hover:bg-[var(--color-hover)] grid items-center gap-3" style={{ gridTemplateColumns: '1fr 92px 104px 36px' }}>
          <button
            type="button"
            onClick={() => setExpandedContaId(isExpanded ? null : conta.ID)}
            aria-expanded={isExpanded}
            className="min-w-0 flex items-center gap-2 text-left cursor-pointer"
            style={{ background: 'transparent' }}
          >
            <ChevronDown
              size={14}
              className="shrink-0 transition-transform"
              style={{ color: 'var(--color-text-secondary)', transform: isExpanded ? 'rotate(180deg)' : 'none' }}
            />
            <div className="min-w-0 flex items-baseline gap-2">
              <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{conta.CODIGO}</span>
              <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(conta.NOME)}</span>
            </div>
          </button>

          <div className="text-right text-[13px] tabular-nums whitespace-nowrap leading-none">
            <span className="font-semibold" style={{ color: setores === 0 ? 'var(--color-primary)' : 'var(--color-text)' }}>{setores}</span>
            <span className="ml-1" style={{ color: 'var(--color-text-secondary)' }}>setor{setores === 1 ? '' : 'es'}</span>
          </div>

          <div className="text-right text-[13px] tabular-nums whitespace-nowrap leading-none">
            <span className="font-semibold" style={{ color: excecoesDestaConta.length > 0 ? '#ea580c' : 'var(--color-text-muted)' }}>{excecoesDestaConta.length}</span>
            <span className="ml-1" style={{ color: 'var(--color-text-secondary)' }}>exceç{excecoesDestaConta.length === 1 ? 'ão' : 'ões'}</span>
          </div>

          <div className="flex items-center justify-end shrink-0">
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setOpenRowMenu(isMenuOpen ? null : item.ID); }}
                className="p-1.5 rounded-md transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                aria-label="Mais ações"
              >
                <MoreVertical size={15} />
              </button>
              {isMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-20 rounded-lg shadow-md py-1 min-w-[180px] animate-scaleIn"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => {
                      setOpenRowMenu(null);
                      if (isInlineSetoresOpen) {
                        setInlineSetoresContaId(null);
                      } else {
                        setInlineSetoresContaId(conta.ID);
                        setDrawerContaId(null);
                      }
                    }}
                    className="w-full text-left text-[13px] px-3 py-2 cursor-pointer flex items-center gap-2"
                    style={{ color: 'var(--color-text)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <Users size={13} /> {isInlineSetoresOpen ? 'Fechar setores' : 'Ajustar setores'}
                  </button>
                  <Tooltip
                    side="left"
                    className="w-full"
                    disabled={!(setoresAplicaveis.size < 2 && !isInlineExcecaoOpen)}
                    content={
                      setoresAplicaveis.size === 0
                        ? 'Vincule essa conta a setores primeiro'
                        : 'Conta com apenas um setor'
                    }
                  >
                    {(() => {
                      const itemDisabled = setoresAplicaveis.size < 2 && !isInlineExcecaoOpen;
                      return (
                        <button
                          onClick={() => {
                            if (itemDisabled) return;
                            setOpenRowMenu(null);
                            if (isInlineExcecaoOpen) {
                              setDrawerContaId(null);
                            } else {
                              setDrawerContaId(conta.ID);
                              setDrawerCR(''); setDrawerAltDriver('');
                              setInlineSetoresContaId(null);
                            }
                          }}
                          aria-disabled={itemDisabled}
                          className="w-full text-left text-[13px] px-3 py-2 flex items-center gap-2"
                          style={{ color: 'var(--color-text)', opacity: itemDisabled ? 0.4 : 1, cursor: itemDisabled ? 'not-allowed' : 'pointer' }}
                          onMouseEnter={(e) => { if (!itemDisabled) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <ShieldAlert size={13} /> {isInlineExcecaoOpen ? 'Fechar exceção' : 'Adicionar exceção'}
                        </button>
                      );
                    })()}
                  </Tooltip>
                  <div style={{ borderTop: '1px solid var(--color-border)' }} className="my-1" />
                  <button
                    onClick={() => { setOpenRowMenu(null); handleUnlinkConta(item.ID); }}
                    disabled={busy}
                    className="w-full text-left text-[13px] px-3 py-2 cursor-pointer flex items-center gap-2 disabled:opacity-50"
                    style={{ color: '#dc2626' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <X size={13} /> Desvincular
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="pl-10 pr-4 pb-3">
            {crsVinculados.length === 0 ? (
              <div className="py-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                Nenhum setor vinculado a esta conta.
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--color-border)' }}>
                {crsVinculados.map((cr: any, k: number) => {
                  const ex = excecoesDestaConta.find((e: any) => e.cr.ID === cr.ID);
                  return (
                    <div key={cr.ID} className="py-1.5 flex items-center gap-2" style={{ borderTop: k === 0 ? 'none' : '1px solid var(--color-border)' }}>
                      <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{cr.CODIGO}</span>
                      <span className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(cr.NOME)}</span>
                      {ex && (
                        <span
                          className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-bg)' }}
                          title={`Exceção — este setor usa o modelo ${toTitleCase(ex.altDriver.NOME.replace(/_/g, ' '))}`}
                        >
                          <ShieldAlert size={10} />
                          Exceção
                          <span className="opacity-75">· {toTitleCase(ex.altDriver.NOME.replace(/_/g, ' '))}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {isInlineSetoresOpen && (
          <div className="px-5 pb-4 animate-fadeIn" style={{ borderTop: '1px dashed var(--color-border)' }}>
            <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
                  <Users size={12} /> Setores aplicáveis
                </div>
                <button
                  type="button"
                  onClick={() => setInlineSetoresContaId(null)}
                  className="p-1 rounded transition-colors cursor-pointer"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  title="Fechar"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="text-[12px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                Marque os setores em que esta conta vai ser orçada. As alterações são salvas na hora.
              </p>
              {crs.length > 5 && (
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-secondary)' }} />
                  <input
                    type="text"
                    placeholder="Buscar setor"
                    value={setoresSearch}
                    onChange={(e) => setSetoresSearch(e.target.value)}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border bg-transparent focus:outline-none"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
              )}
              {(() => {
                const isBulkBusy = setoresPickerBusy === `bulk-${conta.ID}`;
                const allMarkedNaTela = filteredCRs.length > 0 && filteredCRs.every((cr: any) => contaCRs.has(cr.ID));
                return filteredCRs.length > 0 && (
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                      {filteredCRs.length} setor{filteredCRs.length === 1 ? '' : 'es'} {setoresSearch.trim() ? 'filtrado' + (filteredCRs.length === 1 ? '' : 's') : ''}
                    </span>
                    <button
                      type="button"
                      disabled={isBulkBusy}
                      onClick={() => bulkToggleSetoresConta(filteredCRs, conta.ID, !allMarkedNaTela)}
                      className="text-[11px] font-medium px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--color-primary)' }}
                      onMouseEnter={(e) => { if (!isBulkBusy) e.currentTarget.style.backgroundColor = 'var(--color-primary-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {allMarkedNaTela ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  </div>
                );
              })()}
              <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                {crs.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Nenhum setor cadastrado.
                  </div>
                ) : filteredCRs.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Nenhum setor encontrado.
                  </div>
                ) : (
                  filteredCRs.map((cr: any, k: number) => {
                    const checked = contaCRs.has(cr.ID);
                    const rowBusy = setoresPickerBusy === `${cr.ID}-${conta.ID}`;
                    return (
                      <div
                        key={cr.ID}
                        onClick={() => !rowBusy && toggleSetorConta(cr.ID, conta.ID)}
                        className="px-3 py-2 flex items-center gap-2.5 cursor-pointer transition-colors"
                        style={{
                          borderTop: k === 0 ? 'none' : '1px solid var(--color-border)',
                          opacity: rowBusy ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <div
                          className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-surface)',
                            borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
                          }}
                        >
                          {checked && <CheckCircle2 size={11} style={{ color: '#fff' }} />}
                        </div>
                        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
                          <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{cr.CODIGO}</span>
                          <span className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(cr.NOME)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
        {isInlineExcecaoOpen && (
          <div className="px-5 pb-4 animate-fadeIn" style={{ borderTop: '1px dashed var(--color-border)' }}>
            <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
                  <ShieldAlert size={12} /> Exceções por setor
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerContaId(null)}
                  className="p-1 rounded transition-colors cursor-pointer"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  title="Fechar"
                >
                  <X size={13} />
                </button>
              </div>
              {excecoesDestaConta.length > 0 && (
                <div className="mb-3 space-y-1">
                  {excecoesDestaConta.map((ex: any) => (
                    <div key={ex.ID} className="flex items-center justify-between gap-2 text-[12px] px-2.5 py-1.5 rounded-md" style={{ border: '1px solid var(--color-border)' }}>
                      <div className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                        <span className="font-mono text-[11px]">{ex.cr.CODIGO}</span>
                        <span className="truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(ex.cr.NOME)}</span>
                        <span aria-hidden>{'→'}</span>
                        <span style={{ color: 'var(--color-text)' }}>{toTitleCase(ex.altDriver.NOME.replace(/_/g, ' '))}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveExcecao(ex.ID)}
                        disabled={busy}
                        className="p-1 rounded transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                        style={{ color: 'var(--color-text-secondary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; e.currentTarget.style.color = '#dc2626'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                        title="Remover exceção"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {setoresAplicaveis.size === 0 ? (
                <div className="text-[12px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  Esta conta ainda não está mapeada em nenhum setor.{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/regras-contabeis')}
                    className="underline cursor-pointer"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Ajustar mapeamento
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2.5 mb-3">
                  <div>
                    <label className="text-[11px] block mb-1 uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Setor / CR</label>
                    <Select
                      value={drawerCR}
                      onChange={setDrawerCR}
                      placeholder="Selecione o setor..."
                      options={Array.from(setoresAplicaveis).map((crId) => {
                        const cr = crsMap.get(crId as number);
                        return cr ? { value: String(cr.ID), label: `${cr.CODIGO} — ${toTitleCase(cr.NOME)}` } : null;
                      }).filter(Boolean) as { value: string; label: string }[]}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] block mb-1 uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Modelo alternativo</label>
                    <Select
                      value={drawerAltDriver}
                      onChange={setDrawerAltDriver}
                      placeholder="Selecione o modelo..."
                      options={drivers
                        .filter((d: any) => d.ID !== selectedDriver?.ID)
                        .map((d: any) => ({
                          value: String(d.ID),
                          label: toTitleCase(d.NOME.replace(/_/g, ' ')) + (d.TIPO_DRIVER === 'PACOTE' ? ' (pacote)' : origemOf(d) === 'NATIVO' ? ' (nativo)' : origemOf(d) === 'IA' ? ' (IA)' : ''),
                        }))}
                    />
                  </div>
                </div>
              )}
              {setoresAplicaveis.size > 0 && (
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerContaId(null)}
                    className="px-3 py-1.5 text-[13px] rounded-md cursor-pointer transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAddExcecaoFromDrawer}
                    disabled={busy || !drawerCR || !drawerAltDriver}
                    className="px-3 py-1.5 text-[13px] rounded-md text-white font-medium transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    <Plus size={12} /> Adicionar exceção
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function AccountsTab() {
    const PREVIEW_LIMIT = 8;
    const total = contasVinculadas.length;
    const exceedsLimit = total > PREVIEW_LIMIT;
    const visibleAccounts = (!exceedsLimit || showAllAccounts) ? contasVinculadas : contasVinculadas.slice(0, PREVIEW_LIMIT);
    const hiddenCount = total - PREVIEW_LIMIT;

    return (
      <Card className="overflow-visible">
        {total === 0 ? (
          <EmptyAccounts />
        ) : (
          <>
            <div
              className="px-4 py-2 grid items-center gap-3 text-[10px] font-semibold uppercase tracking-wider"
              style={{ gridTemplateColumns: '1fr 92px 104px 36px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}
            >
              <span className="pl-6">Conta</span>
              <span className="text-right">Setores</span>
              <span className="text-right">Exceções</span>
              <span />
            </div>
            <div>{visibleAccounts.map((item, idx) => <AccountRow key={item.ID} item={item} isFirst={idx === 0} />)}</div>
            {exceedsLimit && (
              <button
                type="button"
                onClick={() => setShowAllAccounts((v) => !v)}
                className="w-full py-3 text-[12px] font-medium cursor-pointer transition-colors"
                style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-primary)', backgroundColor: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {showAllAccounts ? 'Ver menos' : `Ver mais (+${hiddenCount})`}
              </button>
            )}
          </>
        )}
      </Card>
    );
  }


  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className={embedded ? '' : 'space-y-6 animate-fadeIn'}>
      {/* CABEÇALHO — escondido quando embarcado como aba */}
      {!embedded && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Modelagem
            </h1>
            <p className="text-sm mt-1.5 max-w-3xl" style={{ color: 'var(--color-text-secondary)' }}>
              Configure como cada conta será projetada no orçamento: escolha um modelo, vincule contas e defina exceções por setor.
            </p>
          </div>
          <AiInsights />
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        {/* COLUNA ESQUERDA - LISTA DE MODELOS — 3/12 no xl (2/12 truncava os
            nomes dos modelos; esta largura le confortavel sem roubar o detalhe) */}
        <div className="col-span-12 md:col-span-4 xl:col-span-3">
          <Card className="overflow-hidden">
            <div className="p-3 space-y-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] tracking-[0.06em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>Modelos</span>
                <button
                  type="button"
                  onClick={openOrdenarModal}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md transition-colors cursor-pointer"
                  style={{ color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-bg)' }}
                  title="Definir a ordem em que os modelos aparecem para o gestor e no Kanban"
                >
                  <ArrowUpDown size={12} /> Ordenar
                </button>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-secondary)' }} />
                <input
                  type="text"
                  placeholder="Buscar modelo ou conta..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                />
              </div>
            </div>
            <div className="max-h-[calc(100vh-210px)] overflow-auto py-2">
              {loadingModelos ? (
                <SkeletonListItems count={7} height={38} className="px-3 py-1" />
              ) : (
              <>
              {filteredPadrao.length > 0 && (
                <div className="mb-1">
                  <div className="px-3 py-1.5 text-[10px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>
                    Modelos nativos
                  </div>
                  <div className="px-1.5 space-y-0.5">
                    {filteredPadrao.map((d: any) => <DriverListItem key={d.ID} d={d} />)}
                  </div>
                </div>
              )}
              {filteredIA.length > 0 && (
                <div className="mb-1 mt-2">
                  <div className="px-3 py-1.5 text-[10px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>
                    Criados pela IA
                  </div>
                  <div className="px-1.5 space-y-0.5">
                    {filteredIA.map((d: any) => <DriverListItem key={d.ID} d={d} />)}
                  </div>
                </div>
              )}
              {(filteredCustomCR.length > 0 || !search.trim()) && (
                <div className="mb-1 mt-2">
                  <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>
                      Modelos por setor
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreateMode('NORMAL')}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                      style={{ color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-bg)' }}
                      title="Criar novo modelo por setor"
                    >
                      <Plus size={12} /> Novo
                    </button>
                  </div>
                  {filteredCustomCR.length > 0 ? (
                    <div className="px-1.5 space-y-0.5">
                      {filteredCustomCR.map((d: any) => <DriverListItem key={d.ID} d={d} />)}
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-[12px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                      Nenhum modelo por setor ainda. Crie um para definir uma fórmula própria — cada setor preenche o seu.
                    </div>
                  )}
                </div>
              )}
              {(filteredCustomPacote.length > 0 || !search.trim()) && (
                <div className="mb-1 mt-2">
                  <div className="px-3 py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)' }}>
                      Pacotes corporativos
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreateMode('PACOTE')}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                      style={{ color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-bg)' }}
                      title="Criar novo pacote corporativo"
                    >
                      <Plus size={12} /> Novo
                    </button>
                  </div>
                  {filteredCustomPacote.length > 0 ? (
                    <div className="px-1.5 space-y-0.5">
                      {filteredCustomPacote.map((d: any) => <DriverListItem key={d.ID} d={d} />)}
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-[12px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                      Nenhum pacote corporativo ainda. Nas linhas dele você define granularidade por CR ou um rateio aplicado.
                    </div>
                  )}
                </div>
              )}
              {filteredPadrao.length === 0 && filteredIA.length === 0 && filteredCustomCR.length === 0 && filteredCustomPacote.length === 0 && (
                <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Nenhum modelo encontrado.
                </div>
              )}
              </>
              )}
            </div>
          </Card>
        </div>

        {/* COLUNA DE DETALHE — modelo selecionado (fórmulas inline para personalizados) */}
        <div className="col-span-12 md:col-span-8 xl:col-span-9">
          {!selectedDriver ? (
            <Card className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 210px)' }}>
              <div className="text-center px-8 max-w-md">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                  <Layers size={22} />
                </div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  Selecione um modelo para começar
                </h3>
                <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Use a lista ao lado para ver as contas que cada modelo calcula e suas exceções por setor.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-5">
              {/* HEADER OPERACIONAL */}
              <Card className="p-5">
                {/* Linha 1: titulo (esquerda) + label do tipo (canto superior direito) */}
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-semibold min-w-0 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    {isPadrao && <Lock size={15} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />}
                    <span className="truncate">{toTitleCase(selectedDriver.NOME.replace(/_/g, ' '))}</span>
                  </h2>
                  <div ref={nativeHelpRef} className="relative flex items-center gap-3 shrink-0 pt-1">
                    <div className="flex items-center gap-1.5">
                      {isPacote ? <Package size={13} style={{ color: 'var(--color-primary)' }} /> :
                       isIA ? <Sparkles size={13} style={{ color: 'var(--color-text-secondary)' }} /> :
                       !isPadrao && <Layers size={13} style={{ color: 'var(--color-primary)' }} />}
                      <span className="text-[11px] tracking-[0.08em] font-semibold uppercase" style={{ color: isPadrao ? 'var(--color-text-secondary)' : 'var(--color-primary)' }}>
                        {isPacote ? 'Pacote' : isIA ? 'Criado pela IA' : isPadrao ? 'Nativo' : selectedDriver.ESCOPO === 'PACOTE' ? 'Personalizado · Pacote' : 'Personalizado'}
                      </span>
                    </div>
                    {isPadrao && (
                      <Tooltip content="Como este driver funciona" side="bottom" disabled={nativeHelpOpen}>
                        <button
                          type="button"
                          onClick={() => setNativeHelpOpen((value) => !value)}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg border transition-colors"
                          style={{ color: nativeHelpOpen ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderColor: nativeHelpOpen ? 'var(--color-primary)' : 'var(--color-border)', backgroundColor: nativeHelpOpen ? 'var(--color-primary-bg)' : 'var(--color-surface)' }}
                          aria-label="Ajuda sobre o driver"
                        >
                          <HelpCircle size={14} />
                        </button>
                      </Tooltip>
                    )}
                    {isCustom && (
                      <div className="flex items-center gap-1.5">
                        <Tooltip content="Histórico de versões publicadas" side="bottom">
                          <button
                            onClick={() => setHistoricoOpen(true)}
                            className="inline-flex items-center justify-center p-1.5 rounded-lg transition-colors cursor-pointer"
                            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            aria-label="Histórico de versões publicadas"
                          >
                            <History size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Excluir modelo" side="bottom">
                          <button
                            onClick={openDeleteModel}
                            className="inline-flex items-center justify-center p-1.5 rounded-lg transition-colors cursor-pointer"
                            style={{ color: '#dc2626', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.borderColor = '#dc2626'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                            aria-label="Excluir modelo"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                    {isPadrao && nativeHelpOpen && (
                      <div
                        className="absolute right-0 top-full mt-2 z-40 w-[360px] max-w-[80vw] rounded-xl p-4 text-left animate-scaleIn"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                          <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                            <HelpCircle size={14} />
                          </span>
                          Como este driver funciona
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                          {NATIVO_COMO_FUNCIONA[selectedDriver.NOME] || selectedDriver.DESCRICAO || 'A lógica de cálculo deste driver é gerenciada pelo sistema.'}
                        </p>
                        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                          {isIA ? 'A lógica é mantida automaticamente.' : 'Este é um driver nativo e não possui configuração nesta tela.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {!isPadrao && (
                  <p
                    className="text-sm mt-1.5"
                    style={{ color: 'var(--color-text-secondary)', fontStyle: selectedDriver.DESCRICAO ? 'normal' : 'italic' }}
                  >
                    {selectedDriver.DESCRICAO || 'Sem descrição adicionada.'}
                  </p>
                )}

                {/* Linha 2: chips de status — os de conteúdo são clicáveis e abrem
                    um resumo do que há dentro da tag (contas, setores, exceções) */}
                <div className="relative mt-3" ref={chipPopRef}>
                  <div className="flex items-center flex-wrap gap-1.5">
                    <ChipButton id="contas" tooltip="Ver as contas vinculadas">
                      <Link2 size={11} />
                      {contasVinculadas.length} conta{contasVinculadas.length === 1 ? '' : 's'}
                    </ChipButton>
                    <ChipButton id="setores" tooltip="Ver os setores que usam este modelo">
                      <Users size={11} />
                      {setoresCobertos} setor{setoresCobertos === 1 ? '' : 'es'}
                    </ChipButton>
                    <ChipButton id="excecoes" tone={excecoesParaEsteDriver.length > 0 ? 'primary' : 'default'} tooltip="Ver as exceções que apontam para este modelo">
                      <ShieldAlert size={11} />
                      {excecoesParaEsteDriver.length} exceç{excecoesParaEsteDriver.length === 1 ? 'ão' : 'ões'}
                    </ChipButton>
                    {isCustom && (
                      <StatusChip tone={formulaConfigured ? 'ok' : 'warn'}>
                        <FileText size={11} />
                        {formulaConfigured ? `${formulasCount} linha${formulasCount === 1 ? '' : 's'}` : 'Fórmula pendente'}
                      </StatusChip>
                    )}
                    {isPadrao && (
                      <StatusChip>
                        <Lock size={11} /> Não configurável
                      </StatusChip>
                    )}
                  </div>
                  {openChip && (
                    <div
                      className="absolute left-0 top-full mt-2 z-30 w-[360px] max-w-[90vw] rounded-lg shadow-lg animate-scaleIn overflow-hidden"
                      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                          {openChip === 'contas' ? 'Contas vinculadas'
                            : openChip === 'setores' ? 'Setores que usam este modelo'
                            : 'Exceções para este modelo'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenChip(null)}
                          className="p-1 rounded-md cursor-pointer"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          aria-label="Fechar"
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto py-1">
                        {openChip === 'contas' && (
                          contasVinculadas.length === 0 ? (
                            <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta vinculada a este modelo.</div>
                          ) : contasVinculadas.map((cv: any) => (
                            <div key={cv.conta.ID} className="px-3.5 py-1.5 text-[12px] flex items-baseline gap-2" style={{ color: 'var(--color-text)' }}>
                              <code className="text-[11px] shrink-0" style={{ color: 'var(--color-primary)' }}>{cv.conta.CODIGO}</code>
                              <span className="truncate">{toTitleCase(cv.conta.NOME)}</span>
                            </div>
                          ))
                        )}
                        {openChip === 'setores' && (
                          setoresEnvolvidos.length === 0 ? (
                            <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Nenhum setor usa este modelo no momento.</div>
                          ) : setoresEnvolvidos.map((cr: any) => (
                            <div key={cr.ID} className="px-3.5 py-1.5 text-[12px] flex items-baseline gap-2" style={{ color: 'var(--color-text)' }}>
                              <code className="text-[11px] shrink-0" style={{ color: 'var(--color-primary)' }}>{cr.CODIGO}</code>
                              <span className="truncate">{toTitleCase(cr.NOME)}</span>
                            </div>
                          ))
                        )}
                        {openChip === 'excecoes' && (
                          excecoesParaEsteDriver.length === 0 ? (
                            <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma exceção aponta para este modelo.</div>
                          ) : excecoesParaEsteDriver.map((ex: any) => (
                            <div key={ex.ID} className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-text)' }}>
                              <div className="flex items-baseline gap-2">
                                <code className="text-[11px] shrink-0" style={{ color: 'var(--color-primary)' }}>{ex.cr.CODIGO}</code>
                                <span className="truncate font-medium">{toTitleCase(ex.cr.NOME)}</span>
                              </div>
                              <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                {ex.conta.CODIGO} · {toTitleCase(ex.conta.NOME)}
                                {ex.originalDriver ? ` — no lugar de ${toTitleCase(String(ex.originalDriver.NOME).replace(/_/g, ' '))}` : ''}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Pacotes mantêm atalhos operacionais; modelos nativos e personalizados não. */}
                {!isCustom && !isPadrao && (
                  <div className="flex items-center flex-wrap gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <HeaderAction icon={Link2} label="Vincular contas" onClick={() => setLinkModalOpen(true)} />
                    <HeaderAction icon={Users} label="Mapear setores" onClick={() => navigate('/regras-contabeis?tab=cr')} />
                    <HeaderAction icon={ShieldAlert} label="Personalizar por CR" onClick={() => navigate('/regras-contabeis?tab=conta')} />
                  </div>
                )}
              </Card>

              {/* FÓRMULAS INLINE — modelos personalizados abrem o editor direto aqui */}
              {isCustom && (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)', height: 540 }}
                >
                  <FormulasModeloEditor
                    key={selectedDriver.ID}
                    driverId={selectedDriver.ID}
                    onPublished={refetchStatusPub}
                    onUnpublishedChange={(hasUnpublished) => handleUnpublishedChange(selectedDriver.ID, hasUnpublished)}
                  />
                </div>
              )}

              {/* Modelos personalizados: só header + fórmulas. A lista de contas já
                  aparece no modal/chip do header, então não repetimos o container aqui. */}
              {!isCustom && <AccountsTab />}
            </div>
          )}
        </div>
      </div>

      {/* MODAL — Ordenar modelos (ordem global unica: gestor + Kanban) */}
      <Modal isOpen={showOrdenarModal} onClose={() => setShowOrdenarModal(false)} title="Ordenar modelos" size="md">
        <div className="space-y-3">
          <p className="text-[13px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            Arraste para definir a ordem em que os modelos aparecem para o gestor (no preenchimento e no link público) e no detalhe do Kanban. O <strong style={{ color: 'var(--color-text)' }}>Resumo</strong> fica sempre primeiro e os <strong style={{ color: 'var(--color-text)' }}>Pacotes</strong> por último.
          </p>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {ordList.map((d: any, idx: number) => {
              const badge = ordemBadge(d);
              const isOver = ordDragOverId === d.ID && ordDragId !== d.ID;
              return (
                <div
                  key={d.ID}
                  className="flex items-center gap-2 px-3 py-2.5 transition-colors"
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--color-border)' : 'none',
                    backgroundColor: 'var(--color-surface)',
                    opacity: ordDragId === d.ID ? 0.4 : 1,
                    boxShadow: isOver ? 'inset 0 2px 0 var(--color-primary)' : 'none',
                  }}
                  onDragOver={(e) => { e.preventDefault(); if (ordDragOverId !== d.ID) setOrdDragOverId(d.ID); }}
                  onDrop={(e) => { e.preventDefault(); if (ordDragId != null) reorderOrdList(ordDragId, d.ID); setOrdDragId(null); setOrdDragOverId(null); }}
                >
                  <span
                    draggable
                    onDragStart={(e) => { setOrdDragId(d.ID); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setOrdDragId(null); setOrdDragOverId(null); }}
                    className="shrink-0 flex items-center cursor-grab active:cursor-grabbing"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title="Arraste para reordenar"
                  >
                    <GripVertical size={15} />
                  </span>
                  <span className="tabular-nums text-[11px] font-semibold w-5 text-center shrink-0" style={{ color: 'var(--color-text-muted)' }}>{idx + 1}</span>
                  <span className="text-sm font-medium truncate flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{toTitleCase(d.NOME.replace(/_/g, ' '))}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ backgroundColor: 'var(--color-primary-bg)', color: badge.color }}>{badge.label}</span>
                </div>
              );
            })}
            {ordList.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Nenhum modelo para ordenar.</div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setShowOrdenarModal(false)}>Cancelar</Button>
            <Button onClick={saveOrdem} disabled={savingOrdem || ordList.length === 0}>{savingOrdem ? 'Salvando...' : 'Salvar ordem'}</Button>
          </div>
        </div>
      </Modal>

      {/* DRAWER — Vincular contas */}
      {linkModalOpen && (
        <>
          <div
            className="fixed inset-0 z-40 transition-opacity animate-fadeIn"
            style={{ backgroundColor: 'transparent' }}
            onClick={() => { setLinkModalOpen(false); setLinkTipos([]); setLinkSearch(''); setLinkSelected(new Set()); setConfirmedMoves(new Set()); setPendingMoveConta(null); }}
          />
          <div
            className="chat-aware-drawer fixed top-0 right-0 h-full w-full sm:w-[440px] z-50 shadow-2xl flex flex-col animate-slideIn"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            {/* Drawer header */}
            <div className="shrink-0 px-5 py-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] tracking-[0.08em] font-semibold uppercase" style={{ color: 'var(--color-primary)' }}>
                  Vincular contas
                </div>
                <h3 className="text-base font-semibold mt-0.5 truncate" style={{ color: 'var(--color-text)' }}>
                  {selectedDriver ? toTitleCase(selectedDriver.NOME.replace(/_/g, ' ')) : ''}
                </h3>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {contasVinculadas.length} conta{contasVinculadas.length === 1 ? '' : 's'} vinculada{contasVinculadas.length === 1 ? '' : 's'} hoje
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    setLinkModalOpen(false); setLinkTipos([]); setLinkSearch(''); setLinkSelected(new Set()); setConfirmedMoves(new Set()); setPendingMoveConta(null);
                    navigate('/regras-contabeis?tab=conta');
                  }}
                  title="Abrir Mapeamento · Drivers por conta"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer"
                  style={{ color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-primary-bg)'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <Maximize2 size={12} /> Expandir
                </button>
                <button
                  onClick={() => { setLinkModalOpen(false); setLinkTipos([]); setLinkSearch(''); setLinkSelected(new Set()); setConfirmedMoves(new Set()); setPendingMoveConta(null); }}
                  className="p-1.5 rounded transition-colors cursor-pointer"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Drawer content (scrollable) */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Filtros */}
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Filtros
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-secondary)' }} />
                    <input
                      type="text"
                      placeholder="Buscar conta"
                      value={linkSearch}
                      onChange={(e) => setLinkSearch(e.target.value)}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                      className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border bg-transparent focus:outline-none"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div className="w-48 shrink-0">
                    <MultiSelect
                      values={linkTipos}
                      onChange={setLinkTipos}
                      allLabel="Todos os tipos"
                      options={tipoValues.map((t) => ({ value: t, label: tipoLabel(t) }))}
                    />
                  </div>
                </div>
              </div>

              {/* Contas disponiveis */}
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Contas disponíveis ({contasParaVinculo.length})
                </div>
                <p className="text-[12px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  Plano de contas completo. As que já estão em outro modelo aparecem marcadas — clique para mover para este.
                </p>
                {contasParaVinculo.length === 0 ? (
                  <div className="px-3 py-3 rounded-lg text-[12px]" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)' }}>
                    Nenhuma conta com os filtros atuais.
                  </div>
                ) : (
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                    {contasParaVinculo.map((conta: any, idx: number) => {
                      const checked = linkSelected.has(conta.ID);
                      const cd = contaDriverByConta.get(conta.ID);
                      const ownerDriver = cd ? driversMap.get(cd.DRIVER_ID) : null;
                      const isOther = !!ownerDriver;
                      const willMove = confirmedMoves.has(conta.ID);

                      const handleClick = () => {
                        if (isOther && !checked) {
                          setPendingMoveConta(conta);
                          return;
                        }
                        const next = new Set(linkSelected);
                        if (next.has(conta.ID)) {
                          next.delete(conta.ID);
                          if (isOther) {
                            const nextMoves = new Set(confirmedMoves);
                            nextMoves.delete(conta.ID);
                            setConfirmedMoves(nextMoves);
                          }
                        } else {
                          next.add(conta.ID);
                        }
                        setLinkSelected(next);
                      };

                      return (
                        <div
                          key={conta.ID}
                          onClick={handleClick}
                          className="px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-colors"
                          style={{
                            borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                            backgroundColor: checked ? 'var(--color-primary-bg)' : 'transparent',
                          }}
                          onMouseEnter={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                          onMouseLeave={(e) => { if (!checked) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <div
                            className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-surface)',
                              borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
                            }}
                          >
                            {checked && <CheckCircle2 size={12} style={{ color: '#fff' }} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                              {toTitleCase(conta.NOME)}
                            </div>
                            <div className="text-[11px] mt-0.5 flex items-center flex-wrap gap-x-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                              <span className="font-mono">{conta.CODIGO}</span>
                              {isOther && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span style={{ color: willMove ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    {willMove ? `migrar de ${toTitleCase(ownerDriver!.NOME.replace(/_/g, ' '))}` : `em ${toTitleCase(ownerDriver!.NOME.replace(/_/g, ' '))}`}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>

            {/* Salvar (fixo no rodape do drawer) */}
            <div className="shrink-0 px-5 pt-3 pb-5" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                  Resumo
                </div>
                <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  {linkSelected.size} selecionada{linkSelected.size === 1 ? '' : 's'}
                  {confirmedMoves.size > 0 && (
                    <span style={{ color: 'var(--color-primary)' }}> · {confirmedMoves.size} migração{confirmedMoves.size === 1 ? '' : 'es'}</span>
                  )}
                </span>
              </div>
              <button
                onClick={handleLinkSubmit}
                disabled={busy || linkSelected.size === 0}
                className="w-full px-4 py-2.5 text-sm rounded-lg text-white font-medium transition-opacity cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Plus size={14} /> Salvar
              </button>
            </div>
          </div>

          {/* MODAL CONFIRMACAO DE MIGRACAO */}
          {pendingMoveConta && (() => {
            const cd = contaDriverByConta.get(pendingMoveConta.ID);
            const owner = cd ? driversMap.get(cd.DRIVER_ID) : null;
            const ownerNome = owner ? toTitleCase(owner.NOME.replace(/_/g, ' ')) : '—';
            const targetNome = selectedDriver ? toTitleCase(selectedDriver.NOME.replace(/_/g, ' ')) : '—';
            return (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center px-4 animate-fadeIn"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                onClick={() => setPendingMoveConta(null)}
              >
                <div
                  className="rounded-xl shadow-2xl w-full max-w-md p-5 animate-scaleIn"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                      <AlertCircle size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Mover conta de modelo?</h3>
                      <p className="text-[13px] mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>{toTitleCase(pendingMoveConta.NOME)}</span>{' '}
                        está vinculada ao modelo <span className="font-medium" style={{ color: 'var(--color-text)' }}>{ownerNome}</span>.
                      </p>
                      <p className="text-[13px] mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                        Ao confirmar, ela será desvinculada de {ownerNome} e passará a usar a regra de <span className="font-medium" style={{ color: 'var(--color-primary)' }}>{targetNome}</span>.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-5">
                    <button
                      onClick={() => setPendingMoveConta(null)}
                      className="px-3.5 py-2 text-sm rounded-lg border transition-colors cursor-pointer"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      Manter como está
                    </button>
                    <button
                      onClick={() => {
                        const nextSel = new Set(linkSelected); nextSel.add(pendingMoveConta.ID);
                        const nextMov = new Set(confirmedMoves); nextMov.add(pendingMoveConta.ID);
                        setLinkSelected(nextSel); setConfirmedMoves(nextMov); setPendingMoveConta(null);
                      }}
                      className="px-3.5 py-2 text-sm rounded-lg text-white font-medium transition-opacity cursor-pointer"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      Migrar para este modelo
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/* MODAL — Criar modelo personalizado (escopo CR) ou pacote */}
      <Modal
        isOpen={createMode !== null}
        onClose={() => { setCreateMode(null); setCreateName(''); setCreateDesc(''); setCreateGestor(''); }}
        title={createMode === 'PACOTE' ? 'Novo pacote' : 'Novo modelo personalizado'}
        size="md"
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Escopo do modelo</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { mode: 'NORMAL' as const, label: 'Modelo por CR', hint: 'Cada gestor preenche no próprio CR (bottom-up)' },
                { mode: 'PACOTE' as const, label: 'Pacote', hint: 'Lançado pelo responsável — por CR ou com rateio aplicado' },
              ]).map((opt) => {
                const active = createMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => setCreateMode(opt.mode)}
                    className="px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer"
                    style={{
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                      backgroundColor: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                    }}
                  >
                    <div className="text-[13px] font-semibold" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text)' }}>{opt.label}</div>
                    <div className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {createMode === 'PACOTE'
              ? 'O pacote define as linhas lançadas pelo responsável. Em cada linha você escolhe a granularidade (por CR) ou um rateio aplicado — configurados depois, nas fórmulas. As contas entram no pacote pela coluna Driver do Mapeamento (rota Pacote).'
              : 'Agrupe contas que serão projetadas pela mesma fórmula. A fórmula é configurada depois, na ação “Configurar fórmula” do modelo.'}
          </p>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              {createMode === 'PACOTE' ? 'Nome do pacote' : 'Nome do modelo'}
            </label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Ex: Receita Variável"
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
            {createName.trim() && (
              <div className="mt-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                Identificador: <span className="font-mono" style={{ color: 'var(--color-text)' }}>{previewName || '—'}</span>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Descrição (opcional)</label>
            <textarea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder={createMode === 'PACOTE' ? 'Para que serve este pacote?' : 'Para que serve este modelo?'}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 resize-none"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          {createMode === 'PACOTE' && (
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Responsável (opcional)</label>
              <Select
                options={gestorOptions}
                value={createGestor}
                onChange={(v) => setCreateGestor(v)}
                placeholder="Definir depois em Gestores..."
              />
              <div className="mt-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                O responsável lança os valores do pacote no preenchimento. Dá para vincular ou trocar depois em Governança &gt; Gestores.
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setCreateMode(null); setCreateName(''); setCreateDesc(''); setCreateGestor(''); }}
              className="px-4 py-2 text-sm rounded-lg border transition-colors cursor-pointer"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateModel}
              disabled={busy || !previewName}
              className="px-4 py-2 text-sm rounded-lg text-white font-medium transition-opacity cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {createMode === 'PACOTE' ? 'Criar pacote' : 'Criar modelo'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal — Excluir / Inativar modelo */}
      <Modal
        isOpen={delOpen}
        onClose={() => { if (!delBusy) { setDelOpen(false); setDelCheck(null); } }}
        title={delCheck?.temOrcamento ? 'Modelo em uso' : 'Excluir modelo'}
        size="sm"
      >
        {!delCheck ? (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Verificando o modelo...
          </div>
        ) : delCheck.temOrcamento ? (
          // ── Tem orcamento preenchido: so inativar ──
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#fffbeb' }}>
              <Ban size={22} style={{ color: '#dc2626' }} />
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Este modelo já tem <strong style={{ color: 'var(--color-text)' }}>orçamento preenchido</strong> através
              dele, por isso não pode ser excluído — os valores lançados seriam perdidos. Você pode
              {' '}<strong style={{ color: 'var(--color-text)' }}>inativá-lo</strong>: ele deixa de aparecer na
              Modelagem, mas o histórico é preservado.
            </p>
            <div className="flex gap-3 w-full">
              <Button variant="secondary" className="flex-1" onClick={() => { setDelOpen(false); setDelCheck(null); }} disabled={delBusy}>
                Cancelar
              </Button>
              <Button variant="primary" className="flex-1" onClick={confirmInativar} disabled={delBusy}>
                {delBusy ? 'Inativando...' : 'Inativar modelo'}
              </Button>
            </div>
          </div>
        ) : (
          // ── Sem orcamento: pode excluir ──
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--confirm-icon-bg)' }}>
              <Trash2 size={22} className="text-red-500" />
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <p>
                Excluir o modelo <strong style={{ color: 'var(--color-text)' }}>{toTitleCase(String(delCheck.nome || '').replace(/_/g, ' '))}</strong>?
                {' '}Esta ação é permanente.
              </p>
              {(delCheck.contas > 0 || delCheck.formulas > 0 || delCheck.excecoes > 0) && (
                <p className="mt-2 text-[13px]">
                  Serão removidos junto:
                  {delCheck.contas > 0 && ` ${delCheck.contas} vínculo${delCheck.contas === 1 ? '' : 's'} de conta`}
                  {delCheck.formulas > 0 && `${delCheck.contas > 0 ? ',' : ''} ${delCheck.formulas} fórmula${delCheck.formulas === 1 ? '' : 's'}`}
                  {delCheck.excecoes > 0 && `${(delCheck.contas > 0 || delCheck.formulas > 0) ? ',' : ''} ${delCheck.excecoes} exceç${delCheck.excecoes === 1 ? 'ão' : 'ões'} por CR`}
                  {'.'}
                </p>
              )}
            </div>
            <div className="flex gap-3 w-full">
              <Button variant="secondary" className="flex-1" onClick={() => { setDelOpen(false); setDelCheck(null); }} disabled={delBusy}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" onClick={confirmExcluir} disabled={delBusy}>
                {delBusy ? 'Excluindo...' : 'Excluir'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal — Histórico de versões publicadas do modelo selecionado */}
      {selectedDriver && (
        <ModeloHistoricoModal
          driverId={selectedDriver.ID}
          open={historicoOpen}
          onClose={() => setHistoricoOpen(false)}
          contaById={contasMap}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// ============================================================
// COMPONENTES AUXILIARES (fora do componente principal, para reuso)
// ============================================================

// Botão de ação compacto no cabeçalho do modelo (vincular contas, mapear setores, etc.)
function HeaderAction({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors cursor-pointer"
      style={{ color: 'var(--color-text)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-primary-bg)'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      <Icon size={14} style={{ color: 'var(--color-primary)' }} />
      {label}
    </button>
  );
}
