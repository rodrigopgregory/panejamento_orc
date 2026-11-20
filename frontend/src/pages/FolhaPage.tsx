import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSF, jsonField, SF_IDS, useList, createRecord, updateRecord, removeRecord, querySQL, formatCurrency } from '../hooks/useMitraData';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import MultiSelect from '../components/ui/MultiSelect';
import DatePicker from '../components/ui/DatePicker';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { SkeletonTable } from '../components/ui/Skeleton';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { Plus, SquarePen, Trash2, Search, Users, Briefcase, CreditCard, Percent, TrendingUp, RefreshCw, Download, Upload } from 'lucide-react';
import ImportarCsvModal from '../components/ImportarCsvModal';
import CabecalhoOrdenavel from '../components/ui/CabecalhoOrdenavel';
import { NumeroEditavel, SelecaoEditavel, SeloEditavel } from '../components/ui/CelulaEditavel';
import { useOrdenacaoTabela } from '../hooks/useOrdenacaoTabela';
import { baixarTemplateCsv } from '../lib/csv';
import { escolherVersaoVigente, versaoEhFechada, rotuloVersao } from '../lib/versao-vigente';
import {
  COLUNAS_COLABORADORES, COLUNAS_CARGOS,
  COLUNAS_BENEFICIOS, COLUNAS_ENCARGOS, COLUNAS_DISSIDIO, COLUNAS_TURNOVER, TEMPLATES_FOLHA,
} from '../lib/folha-tabelas';

type TabKey = 'colaboradores' | 'cargos' | 'beneficios' | 'encargos' | 'dissidio' | 'turnover';

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'colaboradores', label: 'Colaboradores', icon: Users },
  { key: 'cargos', label: 'Cargos e Salários', icon: Briefcase },
  { key: 'beneficios', label: 'Benefícios', icon: CreditCard },
  { key: 'encargos', label: 'Encargos', icon: Percent },
  { key: 'dissidio', label: 'Dissídio', icon: TrendingUp },
  { key: 'turnover', label: 'Turnover', icon: RefreshCw },
];

const MESES_LABELS = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Opcoes das colunas categoricas. Constantes de modulo porque o seletor memoriza
// pela referencia da lista — recriar a cada render refaria a filtragem a toa.
const OPCOES_MESES = MESES_LABELS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }));
const OPCOES_SIM_NAO = [
  { value: 'true', label: 'Sim', variante: 'success' as const },
  { value: 'false', label: 'Não', variante: 'neutral' as const },
];
const OPCOES_TIPO_BENEFICIO = [
  { value: 'FIXO', label: 'Fixo (R$)' },
  { value: 'PERCENTUAL', label: 'Percentual (%)' },
];
const simNao = (v: unknown) => (v === 'true' || v === true ? 'true' : 'false');

// --- FORMS ---
const emptyColabForm = { NOME: '', CR_ID: '', EMPRESA_ID: '', CARGO: '', DATA_ADMISSAO: '', SALARIO: '', TIPO_CONTRATO: 'CLT', ATIVO: 'true' };
const emptyCargoForm = { NOME: '', SALARIO_MEDIO: '', ATIVO: 'true' };
const emptyBenForm = { NOME: '', TIPO: 'FIXO', VALOR: '0', PERCENTUAL: '0', APLICA_PJ: 'false', APLICA_CLT: 'true' };
const emptyEncForm = { NOME: '', PERCENTUAL: '0', APLICA_PJ: 'false', APLICA_CLT: 'true' };

function BotaoTemplateCsv({ template }: { template: { arquivo: string; colunas: readonly string[]; exemplos: readonly (readonly string[])[] } }) {
  return (
    <Button
      variant="secondary"
      onClick={() => baixarTemplateCsv({
        arquivo: template.arquivo,
        colunas: [...template.colunas],
        exemplos: template.exemplos.map((linha) => [...linha]),
      })}
      title="Baixa uma planilha com os cabecalhos e duas linhas de exemplo"
    >
      <Download size={16} className="mr-1" /> Template CSV
    </Button>
  );
}

function BotaoImportarCsv({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      title="Carrega varias linhas de uma vez a partir de um CSV preenchido"
    >
      <Upload size={16} className="mr-1" /> Importar CSV
    </Button>
  );
}

// Rotulo de cada aba no modal de importacao. Sao os mesmos nomes das abas, no
// plural, porque a frase do modal e "Importar <titulo>".
const TITULOS_IMPORTACAO: Record<TabKey, string> = {
  colaboradores: 'Colaboradores',
  cargos: 'Cargos',
  beneficios: 'Benefícios',
  encargos: 'Encargos',
  dissidio: 'Dissídio',
  turnover: 'Turnover',
};

// Abas cujos registros pertencem a uma versão orçamentária — o modal avisa em
// qual versão a carga vai entrar antes de o usuário confirmar.
const ABAS_POR_VERSAO = new Set<TabKey>(['beneficios', 'encargos', 'dissidio', 'turnover']);

export default function FolhaPage() {
  const [tab, setTab] = useState<TabKey>('colaboradores');
  const { toasts, addToast, removeToast } = useToast();

  // --- Shared queries — mount em 1 ida (SF 129, blocos JSON; eram 9 chamadas sandbox) ---
  // cicloId=0 = a SF resolve o ciclo aberto default no SQL (sem cascata ciclos->premissas).
  // Ordenacoes dos ORDER BY originais no cliente. Refetch individual = refetch da SF.
  // cicloId fixo em 0: a tela nao tem seletor de ciclo, entao a chave da query nunca
  // muda e a SF 129 roda UMA vez por montagem. Antes, um efeito reescolhia o ciclo no
  // cliente e mudava a chave do useSF, refazendo a SF inteira — e o pedido era
  // identico ao primeiro, porque o CASE do SQL resolve o default com
  // `WHERE STATUS != 'FECHADO' ORDER BY ANO DESC, ID DESC LIMIT 1`, o mesmo criterio
  // do sort de `ciclos` logo abaixo. Era uma ida a rede que devolvia o mesmo dado.
  const { data: hotRows, refetch: refetchHot, loading: loadingHot } = useSF(SF_IDS.hotFolhaBase, { cicloId: 0 });
  const byNome = (a: any, b: any) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''));
  const colaboradores = useMemo(() => jsonField(hotRows?.[0]?.COLABORADORES).sort(byNome), [hotRows]);
  const crs = useMemo(() => jsonField(hotRows?.[0]?.CRS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [hotRows]);
  const empresas = useMemo(() => jsonField(hotRows?.[0]?.EMPRESAS).sort(byNome), [hotRows]);
  const cargosList = useMemo(() => jsonField(hotRows?.[0]?.CARGOS).sort(byNome), [hotRows]);
  // O CSV de cargos deduplica contra esta lista. Se ela vier paginada, o cargo que
  // ficou de fora nao e reconhecido como existente e entra de novo — e nao ha UNIQUE
  // em CARGO para barrar no banco. Teto alto aqui, e o total real trava a importacao
  // abaixo caso um dia estoure.
  const { data: allCargos, total: totalCargos, refetch: refetchCargo, loading: loadingCargos } = useList('CARGO', 0, 1000);
  const cargosTruncados = !loadingCargos && totalCargos > allCargos.length;
  const ciclos = useMemo(() => jsonField(hotRows?.[0]?.CICLOS).sort((a, b) => (Number(b.ANO) - Number(a.ANO)) || (Number(b.ID) - Number(a.ID))), [hotRows]);
  const beneficios = useMemo(() => jsonField(hotRows?.[0]?.BENEFICIOS), [hotRows]);
  const encargos = useMemo(() => jsonField(hotRows?.[0]?.ENCARGOS), [hotRows]);
  const byCicloEmpresa = (a: any, b: any) => (Number(a.CICLO_ID) - Number(b.CICLO_ID)) || String(a.EMPRESA_NOME ?? '').localeCompare(String(b.EMPRESA_NOME ?? ''));
  const dissidios = useMemo(() => jsonField(hotRows?.[0]?.DISSIDIOS).sort(byCicloEmpresa), [hotRows]);
  const turnovers = useMemo(() => jsonField(hotRows?.[0]?.TURNOVERS).sort(byCicloEmpresa), [hotRows]);
  const refetchColab = refetchHot;
  const refetchBen = refetchHot;
  const refetchEnc = refetchHot;
  const refetchDiss = refetchHot;
  const refetchTurn = refetchHot;

  // Ciclo ativo para GRAVACAO (dissidio/turnover novos). Derivado da resposta, com o
  // mesmo criterio que a SF usa para resolver o default — nao precisa de state nem
  // de uma segunda ida a rede para descobrir.
  const cicloPremissaFilter = Number(escolherVersaoVigente(ciclos) ?? 0);
  // A versao marcada como atual pode estar fechada (consulta de historico). Beneficio,
  // encargo, dissidio e turnover sao versionados por ciclo — gravar com a versao
  // fechada selecionada escreveria dentro de um orcamento ja encerrado.
  const versaoFechada = versaoEhFechada(ciclos, cicloPremissaFilter);

  // So a PRIMEIRA carga vira skeleton. Depois que a SF 129 respondeu uma vez, o
  // useSF mantem os dados durante o refetch — e refetchHot roda em TODA mutacao
  // (salvar/excluir colaborador, beneficio, encargo, dissidio, turnover). Sem esta
  // guarda, cada gravacao apagaria a tabela inteira para skeleton e a devolveria,
  // perdendo a posicao de rolagem.
  const jaCarregou = (hotRows?.length ?? 0) > 0;
  const carregando = !jaCarregou && (loadingHot || loadingCargos);

  // Ordenacao por clique no cabecalho, uma por aba. As definicoes de coluna sao
  // constantes de modulo: se fossem recriadas a cada render, a memoizacao do
  // hook invalidaria e a lista seria reordenada a toa.
  const ordColab = useOrdenacaoTabela(COLUNAS_COLABORADORES);
  const ordCargos = useOrdenacaoTabela(COLUNAS_CARGOS);
  const ordBen = useOrdenacaoTabela(COLUNAS_BENEFICIOS);
  const ordEnc = useOrdenacaoTabela(COLUNAS_ENCARGOS);
  const ordDiss = useOrdenacaoTabela(COLUNAS_DISSIDIO);
  const ordTurn = useOrdenacaoTabela(COLUNAS_TURNOVER);

  // Gravacao inline. A recarga e COALESCIDA de proposito: com edicao inline a
  // tela grava a cada campo, e recarregar a SF 129 inteira por celula
  // multiplicaria as idas a rede que hoje acontecem uma vez por modal salvo.
  // Editar varios campos em sequencia resulta em UMA recarga.
  const timerRefetch = useRef<number | null>(null);
  useEffect(() => () => { if (timerRefetch.current) window.clearTimeout(timerRefetch.current); }, []);
  const agendarRefetch = useCallback((refetch: () => void) => {
    if (timerRefetch.current) window.clearTimeout(timerRefetch.current);
    timerRefetch.current = window.setTimeout(() => { timerRefetch.current = null; refetch(); }, 700);
  }, []);
  const salvarInline = useCallback(async (tabela: string, id: number, dados: Record<string, any>, refetch: () => void) => {
    // BENEFICIO e ENCARGO sao os unicos aqui que a SF ja traz filtrados pela versao
    // vigente — se ela estiver fechada, editar essas linhas mexeria no orcamento
    // encerrado. Colaborador e cargo sao cadastro global e seguem editaveis.
    if (versaoFechada && (tabela === 'BENEFICIO' || tabela === 'ENCARGO')) {
      addToast('error', 'Versão fechada: aberta apenas para consulta');
      throw new Error('versao_fechada');
    }
    try {
      await updateRecord(tabela, id, dados);
      addToast('success', 'Alteracao salva');
      agendarRefetch(refetch);
    } catch (e) {
      addToast('error', 'Erro ao salvar');
      // Falhou: recarrega ja para a tela voltar ao que esta no banco, e propaga o
      // erro — a celula escuta a rejeicao para desfazer o que mostrou na hora.
      refetch();
      throw e;
    }
  }, [addToast, agendarRefetch, versaoFechada]);

  // --- Importacao em lote (CSV) ---
  // Guarda a aba cuja importacao esta aberta; null = modal fechado.
  const [importarAba, setImportarAba] = useState<TabKey | null>(null);
  // As linhas ja existentes entram no contexto para o CSV nao duplicar o que
  // esta no banco — cada aba tem a sua propria lista.
  const existentesPorAba: Record<TabKey, Record<string, unknown>[]> = {
    colaboradores, cargos: allCargos, beneficios, encargos,
    dissidio: dissidios, turnover: turnovers,
  };
  // Rotulo da versao no modal de importacao: mesma versao que o cicloPremissaFilter
  // resolve, para o usuario nao ler um nome e gravar em outra.
  const nomeVersaoAtual = rotuloVersao(ciclos.find((c: any) => Number(c.ID) === cicloPremissaFilter)) || '';

  // As abas de ABAS_POR_VERSAO importam para dentro da versao vigente. Fechada,
  // nem abre o modal — melhor barrar antes do usuario montar o arquivo do que
  // deixar ele descobrir na hora de gravar.
  const abrirImportacaoPorVersao = (aba: TabKey) => {
    if (versaoFechada) { addToast('error', 'Versão fechada: aberta apenas para consulta'); return; }
    setImportarAba(aba);
  };

  // --- Shared modal/delete state ---
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteTable, setDeleteTable] = useState<string>('');

  // --- Tab-specific form state ---
  const [colabForm, setColabForm] = useState(emptyColabForm);
  const [cargoForm, setCargoForm] = useState(emptyCargoForm);
  const [benForm, setBenForm] = useState(emptyBenForm);
  const [encForm, setEncForm] = useState(emptyEncForm);

  // --- Premissas form state ---
  const [dissForm, setDissForm] = useState({ CICLO_ID: '', EMPRESA_ID: '', PERCENTUAL: '', MES_APLICACAO: '1' });
  const [turnForm, setTurnForm] = useState({ CICLO_ID: '', EMPRESA_ID: '', PERCENTUAL: '' });
  const [premissaModal, setPremissaModal] = useState<'dissidio' | 'turnover' | null>(null);

  // --- Filters (Colaboradores) ---
  const [filterCRs, setFilterCRs] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // --- Filters (Cargos) ---
  const [cargoSearch, setCargoSearch] = useState('');
  const [cargoStatus, setCargoStatus] = useState('');

  // --- Filters (Beneficios) ---
  const [benSearch, setBenSearch] = useState('');
  const [benTipo, setBenTipo] = useState('');

  // --- Filters (Encargos) ---
  const [encSearch, setEncSearch] = useState('');
  const [encAplica, setEncAplica] = useState('');

  // --- Filters (Dissidio) ---
  const [dissSearch, setDissSearch] = useState('');
  const [dissMeses, setDissMeses] = useState<string[]>([]);

  // --- Filters (Turnover) ---
  const [turnSearch, setTurnSearch] = useState('');

  const filteredColab = colaboradores.filter((c: any) => {
    if (filterCRs.length > 0 && !filterCRs.includes(String(c.CR_ID))) return false;
    if (search && !c.NOME.toLowerCase().includes(search.toLowerCase()) && !c.CARGO?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredCargos = allCargos.filter((c: any) => {
    if (cargoStatus && c.ATIVO !== cargoStatus) return false;
    if (cargoSearch && !c.NOME.toLowerCase().includes(cargoSearch.toLowerCase())) return false;
    return true;
  });

  // Memoizado porque a grade recebe este array como fonte de dados: um array
  // novo a cada render faria a planilha recarregar e perder a celula em edicao.
  const filteredBeneficios = useMemo(() => beneficios.filter((b: any) => {
    if (benTipo && b.TIPO !== benTipo) return false;
    if (benSearch && !b.NOME.toLowerCase().includes(benSearch.toLowerCase())) return false;
    return true;
  }), [beneficios, benTipo, benSearch]);

  const filteredEncargos = encargos.filter((e: any) => {
    if (encAplica === 'CLT' && e.APLICA_CLT !== 'true') return false;
    if (encAplica === 'PJ' && e.APLICA_PJ !== 'true') return false;
    if (encSearch && !e.NOME.toLowerCase().includes(encSearch.toLowerCase())) return false;
    return true;
  });

  const filteredDissidios = dissidios.filter((d: any) => {
    if (dissMeses.length > 0 && !dissMeses.includes(String(d.MES_APLICACAO))) return false;
    if (dissSearch && !(d.EMPRESA_NOME || '').toLowerCase().includes(dissSearch.toLowerCase())) return false;
    return true;
  });

  const filteredTurnovers = turnovers.filter((t: any) => {
    if (turnSearch && !(t.EMPRESA_NOME || '').toLowerCase().includes(turnSearch.toLowerCase())) return false;
    return true;
  });

  // ==================== HANDLERS ====================

  // Colaboradores
  const saveColab = async () => {
    try {
      const payload = { ...colabForm, CR_ID: Number(colabForm.CR_ID), EMPRESA_ID: Number(colabForm.EMPRESA_ID), SALARIO: parseFloat(colabForm.SALARIO) || 0 };
      if (editId) { await updateRecord('COLABORADOR', editId, payload); addToast('success', 'Colaborador atualizado!'); }
      else { await createRecord('COLABORADOR', payload); addToast('success', 'Colaborador criado!'); }
      setModalOpen(false); setEditId(null); setColabForm(emptyColabForm); refetchColab();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
  };

  // Cargos
  const saveCargo = async () => {
    try {
      const payload = { ...cargoForm, SALARIO_MEDIO: parseFloat(cargoForm.SALARIO_MEDIO) || 0 };
      if (editId) { await updateRecord('CARGO', editId, payload); addToast('success', 'Cargo atualizado!'); }
      else { await createRecord('CARGO', payload); addToast('success', 'Cargo criado!'); }
      setModalOpen(false); setEditId(null); setCargoForm(emptyCargoForm); refetchCargo();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
  };

  // Beneficios
  const saveBen = async () => {
    if (versaoFechada) { addToast('error', 'Versão fechada: aberta apenas para consulta'); return; }
    try {
      const d: any = { ...benForm, VALOR: Number(benForm.VALOR), PERCENTUAL: Number(benForm.PERCENTUAL) };
      if (!editId) d.CICLO_ID = cicloPremissaFilter;
      if (editId) { await updateRecord('BENEFICIO', editId, d); } else { await createRecord('BENEFICIO', d); }
      addToast('success', 'Salvo!'); setModalOpen(false); setEditId(null); setBenForm(emptyBenForm); refetchBen();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
  };

  // Encargos
  const saveEnc = async () => {
    if (versaoFechada) { addToast('error', 'Versão fechada: aberta apenas para consulta'); return; }
    try {
      const d: any = { ...encForm, PERCENTUAL: Number(encForm.PERCENTUAL) };
      if (!editId) d.CICLO_ID = cicloPremissaFilter;
      if (editId) { await updateRecord('ENCARGO', editId, d); } else { await createRecord('ENCARGO', d); }
      addToast('success', 'Salvo!'); setModalOpen(false); setEditId(null); setEncForm(emptyEncForm); refetchEnc();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
  };

  // Premissas handlers — aqui a versao vem do Select do modal, e nao da vigente,
  // entao a guarda olha a versao escolhida no formulario.
  const saveDissidio = async () => {
    if (versaoEhFechada(ciclos, Number(dissForm.CICLO_ID))) {
      addToast('error', 'Versão fechada: aberta apenas para consulta'); return;
    }
    try {
      const existing = await querySQL(`SELECT ID FROM PREMISSA_DISSIDIO WHERE CICLO_ID = ${dissForm.CICLO_ID} AND EMPRESA_ID = ${dissForm.EMPRESA_ID}`);
      const payload = { CICLO_ID: Number(dissForm.CICLO_ID), EMPRESA_ID: Number(dissForm.EMPRESA_ID), PERCENTUAL: Number(dissForm.PERCENTUAL), MES_APLICACAO: Number(dissForm.MES_APLICACAO), CRIADO_EM: new Date().toISOString().slice(0, 19) };
      if (editId) { await updateRecord('PREMISSA_DISSIDIO', editId, payload); }
      else if (existing.length > 0) { await updateRecord('PREMISSA_DISSIDIO', existing[0].ID, payload); }
      else { await createRecord('PREMISSA_DISSIDIO', payload); }
      addToast('success', 'Dissídio salvo!'); setPremissaModal(null); setEditId(null); setDissForm({ CICLO_ID: '', EMPRESA_ID: '', PERCENTUAL: '', MES_APLICACAO: '1' }); refetchDiss();
    } catch (e) { addToast('error', 'Erro ao salvar dissidio'); }
  };

  const saveTurnover = async () => {
    if (versaoEhFechada(ciclos, Number(turnForm.CICLO_ID))) {
      addToast('error', 'Versão fechada: aberta apenas para consulta'); return;
    }
    try {
      const existing = await querySQL(`SELECT ID FROM PREMISSA_TURNOVER WHERE CICLO_ID = ${turnForm.CICLO_ID} AND EMPRESA_ID = ${turnForm.EMPRESA_ID}`);
      const payload = { CICLO_ID: Number(turnForm.CICLO_ID), EMPRESA_ID: Number(turnForm.EMPRESA_ID), PERCENTUAL: Number(turnForm.PERCENTUAL), CRIADO_EM: new Date().toISOString().slice(0, 19) };
      if (editId) { await updateRecord('PREMISSA_TURNOVER', editId, payload); }
      else if (existing.length > 0) { await updateRecord('PREMISSA_TURNOVER', existing[0].ID, payload); }
      else { await createRecord('PREMISSA_TURNOVER', payload); }
      addToast('success', 'Turnover salvo!'); setPremissaModal(null); setEditId(null); setTurnForm({ CICLO_ID: '', EMPRESA_ID: '', PERCENTUAL: '' }); refetchTurn();
    } catch (e) { addToast('error', 'Erro ao salvar turnover'); }
  };

  const handleDelete = async () => {
    if (!deleteId || !deleteTable) return;
    try {
      await removeRecord(deleteTable, deleteId);
      addToast('success', 'Removido');
      setDeleteId(null); setDeleteTable('');
      if (deleteTable === 'COLABORADOR') refetchColab();
      else if (deleteTable === 'CARGO') refetchCargo();
      else if (deleteTable === 'BENEFICIO') refetchBen();
      else if (deleteTable === 'ENCARGO') refetchEnc();
      else if (deleteTable === 'PREMISSA_DISSIDIO') refetchDiss();
      else if (deleteTable === 'PREMISSA_TURNOVER') refetchTurn();
    } catch (e) { addToast('error', 'Erro ao remover'); }
  };

  const confirmDelete = (id: number, table: string) => { setDeleteId(id); setDeleteTable(table); };

  // ==================== NEW BUTTON ====================
  const handleNew = () => {
    setEditId(null);
    if (tab === 'colaboradores') { setColabForm(emptyColabForm); setModalOpen(true); }
    else if (tab === 'cargos') { setCargoForm(emptyCargoForm); setModalOpen(true); }
    else if (tab === 'beneficios') { setBenForm(emptyBenForm); setModalOpen(true); }
    else if (tab === 'encargos') { setEncForm(emptyEncForm); setModalOpen(true); }
    else if (tab === 'dissidio') { setDissForm({ CICLO_ID: ciclos[0]?.ID ? String(ciclos[0].ID) : '', EMPRESA_ID: '', PERCENTUAL: '', MES_APLICACAO: '1' }); setPremissaModal('dissidio'); }
    else if (tab === 'turnover') { setTurnForm({ CICLO_ID: ciclos[0]?.ID ? String(ciclos[0].ID) : '', EMPRESA_ID: '', PERCENTUAL: '' }); setPremissaModal('turnover'); }
  };

  const newLabel = tab === 'colaboradores' ? 'Novo Colaborador' : tab === 'cargos' ? 'Novo Cargo' : tab === 'beneficios' ? 'Novo Benefício' : tab === 'encargos' ? 'Novo Encargo' : tab === 'dissidio' ? 'Novo Dissídio' : tab === 'turnover' ? 'Novo Turnover' : '';

  const thCls = "text-left px-6 py-3 uppercase tracking-wide font-medium";
  const thClsMiddle = "text-left px-3 py-3 uppercase tracking-wide font-medium";
  const thClsAction = "text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap";

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Premissas Folha</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Colaboradores, cargos, benefícios, encargos, dissídio e turnover
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all relative"
              style={{
                color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={15} />
              {t.label}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ==================== COLABORADORES ==================== */}
      {tab === 'colaboradores' && (
        <>
          <div className="flex gap-3 flex-wrap items-center justify-between">
            <div className="flex gap-3 flex-wrap items-center flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
                <input
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                  placeholder="Buscar por nome ou cargo..."
                  value={search} onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="w-72 shrink-0">
                <MultiSelect
                  options={crs.map((c: any) => ({ value: String(c.ID), label: `${c.CODIGO} - ${c.NOME}` }))}
                  values={filterCRs}
                  onChange={setFilterCRs}
                  allLabel="Todos os CRs"
                  placeholder="Todos os CRs"
                />
              </div>
            </div>
            <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.colaboradores} />
            <BotaoImportarCsv onClick={() => setImportarAba('colaboradores')} />
            <Button onClick={handleNew}>
              <Plus size={16} className="mr-1" /> {newLabel}
            </Button></span>
          </div>
          {carregando ? <SkeletonTable columns={7} rows={8} /> : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                <CabecalhoOrdenavel campo="nome" rotulo="Nome" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={thCls} />
                <CabecalhoOrdenavel campo="cargo" rotulo="Cargo" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={thClsMiddle} />
                <CabecalhoOrdenavel campo="cr" rotulo="CR" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={thClsMiddle} />
                <CabecalhoOrdenavel campo="empresa" rotulo="Empresa" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={thClsMiddle} />
                <CabecalhoOrdenavel campo="contrato" rotulo="Contrato" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={thClsMiddle} />
                <CabecalhoOrdenavel campo="salario" rotulo="Salário" ordem={ordColab.ordem} onOrdenar={ordColab.alternarOrdem} className={`${thClsMiddle} !text-right`} alinhamento="right" />
                <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
              </tr></thead>
              <tbody>
                {ordColab.ordenar(filteredColab).map((item: any) => (
                  <tr key={item.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {/* Nome fica so leitura: e a identidade da linha, o que se
                        procura ao varrer a tabela. Campo aqui atrapalha a leitura
                        e o ganho e baixo — nome de pessoa quase nao muda. */}
                    <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{item.NOME}</td>
                    <td className="py-2 px-1">
                      <SelecaoEditavel valor={item.CARGO || ''}
                        opcoes={cargosList.map((c: any) => ({ value: c.NOME, label: c.NOME }))}
                        onSalvar={(v) => salvarInline('COLABORADOR', item.ID, { CARGO: v }, refetchColab)} />
                    </td>
                    <td className="py-2 px-1">
                      <SelecaoEditavel valor={String(item.CR_ID || '')}
                        opcoes={crs.map((c: any) => ({ value: String(c.ID), label: `${c.CODIGO} - ${c.NOME}` }))}
                        onSalvar={(v) => salvarInline('COLABORADOR', item.ID, { CR_ID: Number(v) }, refetchColab)} />
                    </td>
                    <td className="py-2 px-1">
                      <SelecaoEditavel valor={String(item.EMPRESA_ID || '')}
                        opcoes={empresas.map((e: any) => ({ value: String(e.ID), label: e.NOME }))}
                        onSalvar={(v) => salvarInline('COLABORADOR', item.ID, { EMPRESA_ID: Number(v) }, refetchColab)} />
                    </td>
                    <td className="py-2 px-1">
                      <SelecaoEditavel valor={item.TIPO_CONTRATO || 'CLT'}
                        opcoes={[{ value: 'CLT', label: 'CLT' }, { value: 'PJ', label: 'PJ' }]}
                        onSalvar={(v) => salvarInline('COLABORADOR', item.ID, { TIPO_CONTRATO: v }, refetchColab)} />
                    </td>
                    <td className="py-2 px-1">
                      <NumeroEditavel valor={Number(item.SALARIO || 0)} moeda rotulo={`Salário de ${item.NOME}`}
                        onSalvar={(v) => salvarInline('COLABORADOR', item.ID, { SALARIO: v }, refetchColab)} />
                    </td>
                    <td className="px-3 py-2" style={{ width: '1%' }}>
                      <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                        <button onClick={() => {
                          setEditId(item.ID);
                          setColabForm({ NOME: item.NOME || '', CR_ID: String(item.CR_ID || ''), EMPRESA_ID: String(item.EMPRESA_ID || ''), CARGO: item.CARGO || '', DATA_ADMISSAO: item.DATA_ADMISSAO || '', SALARIO: String(item.SALARIO || ''), TIPO_CONTRATO: item.TIPO_CONTRATO || 'CLT', ATIVO: item.ATIVO || 'true' });
                          setModalOpen(true);
                        }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                        <button onClick={() => confirmDelete(item.ID, 'COLABORADOR')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredColab.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum colaborador encontrado</td></tr>
                )}
              </tbody>
            </table></div>
          </div>
          )}
        </>
      )}

      {/* ==================== CARGOS ==================== */}
      {tab === 'cargos' && (
        <>
        <div className="flex gap-3 flex-wrap items-center justify-between">
          <div className="flex gap-3 flex-wrap items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                placeholder="Buscar por cargo..."
                value={cargoSearch} onChange={(e) => setCargoSearch(e.target.value)}
              />
            </div>
            <div className="w-48 shrink-0">
              <Select
                options={[{ value: '', label: 'Todos os status' }, { value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }]}
                value={cargoStatus} onChange={(v) => setCargoStatus(v)}
              />
            </div>
          </div>
          <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.cargos} />
            <BotaoImportarCsv onClick={() => {
              // Sem a lista inteira em maos a checagem de duplicado e cega: melhor
              // recusar a importacao do que gravar cargo repetido sem ninguem ver.
              if (cargosTruncados) {
                addToast('error', `Carregados ${allCargos.length} de ${totalCargos} cargos — a checagem de duplicados ficaria incompleta. Recarregue a pagina antes de importar.`);
                return;
              }
              setImportarAba('cargos');
            }} />
            <Button onClick={handleNew}><Plus size={16} className="mr-1" /> {newLabel}</Button></span>
        </div>
        {carregando ? <SkeletonTable columns={4} rows={8} /> : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <CabecalhoOrdenavel campo="nome" rotulo="Cargo" ordem={ordCargos.ordem} onOrdenar={ordCargos.alternarOrdem} className={thCls} />
              <CabecalhoOrdenavel campo="salario" rotulo="Salário Médio" ordem={ordCargos.ordem} onOrdenar={ordCargos.alternarOrdem} className={`${thClsMiddle} !text-right`} alinhamento="right" />
              <CabecalhoOrdenavel campo="ativo" rotulo="Ativo" ordem={ordCargos.ordem} onOrdenar={ordCargos.alternarOrdem} className={thClsMiddle} />
              <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
            </tr></thead>
            <tbody>
              {ordCargos.ordenar(filteredCargos).map((item: any) => (
                <tr key={item.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{item.NOME}</td>
                  <td className="py-2 px-1">
                    <NumeroEditavel valor={Number(item.SALARIO_MEDIO || 0)} moeda rotulo={`Salário médio de ${item.NOME}`}
                      onSalvar={(v) => salvarInline('CARGO', item.ID, { SALARIO_MEDIO: v }, refetchCargo)} />
                  </td>
                  <td className="py-2 px-1">
                    <SeloEditavel valor={simNao(item.ATIVO)} opcoes={OPCOES_SIM_NAO} rotulo={`Ativo em ${item.NOME}`}
                      onSalvar={(v) => salvarInline('CARGO', item.ID, { ATIVO: v }, refetchCargo)} />
                  </td>
                  <td className="px-3 py-2" style={{ width: '1%' }}>
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => {
                        setEditId(item.ID);
                        setCargoForm({ NOME: item.NOME, SALARIO_MEDIO: String(item.SALARIO_MEDIO || ''), ATIVO: item.ATIVO });
                        setModalOpen(true);
                      }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                      <button onClick={() => confirmDelete(item.ID, 'CARGO')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCargos.length === 0 && (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum cargo encontrado</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
        )}
        </>
      )}

      {/* ==================== BENEFICIOS ==================== */}
      {tab === 'beneficios' && (
        <>
        <div className="flex gap-3 flex-wrap items-center justify-between">
          <div className="flex gap-3 flex-wrap items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                placeholder="Buscar por benefício..."
                value={benSearch} onChange={(e) => setBenSearch(e.target.value)}
              />
            </div>
            <div className="w-48 shrink-0">
              <Select
                options={[{ value: '', label: 'Todos os tipos' }, { value: 'FIXO', label: 'Fixo' }, { value: 'PERCENTUAL', label: 'Percentual' }]}
                value={benTipo} onChange={(v) => setBenTipo(v)}
              />
            </div>
          </div>
          <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.beneficios} />
            <BotaoImportarCsv onClick={() => abrirImportacaoPorVersao('beneficios')} />
            <Button onClick={handleNew}><Plus size={16} className="mr-1" /> {newLabel}</Button></span>
        </div>
        {carregando ? <SkeletonTable columns={7} rows={8} /> : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <CabecalhoOrdenavel campo="nome" rotulo="Nome" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thCls} />
              <CabecalhoOrdenavel campo="tipo" rotulo="Tipo" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="valor" rotulo="Valor (R$)" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="percentual" rotulo="Percentual (%)" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="clt" rotulo="CLT" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="pj" rotulo="PJ" ordem={ordBen.ordem} onOrdenar={ordBen.alternarOrdem} className={thClsMiddle} />
              <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
            </tr></thead>
            <tbody>
              {ordBen.ordenar(filteredBeneficios).map((b: any) => (
                <tr key={b.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{b.NOME}</td>
                  <td className="py-2 px-1">
                    <SelecaoEditavel valor={b.TIPO === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO'} opcoes={OPCOES_TIPO_BENEFICIO}
                      onSalvar={(v) => salvarInline('BENEFICIO', b.ID, { TIPO: v }, refetchBen)} />
                  </td>
                  {/* O beneficio guarda o valor em VALOR *ou* em PERCENTUAL conforme o tipo:
                      a coluna que nao vale para a linha mostra travessao — um zero ali seria
                      lido como "custa zero". */}
                  <td className="py-2 px-1">
                    {b.TIPO === 'FIXO' ? (
                      <NumeroEditavel valor={Number(b.VALOR || 0)} moeda rotulo={`Valor de ${b.NOME}`}
                        onSalvar={(v) => salvarInline('BENEFICIO', b.ID, { VALOR: v }, refetchBen)} />
                    ) : (
                      <span className="block px-3 text-right" style={{ color: 'var(--color-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="py-2 px-1">
                    {b.TIPO === 'PERCENTUAL' ? (
                      <NumeroEditavel valor={Number(b.PERCENTUAL || 0)} sufixo="%" rotulo={`Percentual de ${b.NOME}`}
                        onSalvar={(v) => salvarInline('BENEFICIO', b.ID, { PERCENTUAL: v }, refetchBen)} />
                    ) : (
                      <span className="block px-3 text-right" style={{ color: 'var(--color-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="py-2 px-1">
                    <SeloEditavel valor={simNao(b.APLICA_CLT)} opcoes={OPCOES_SIM_NAO} rotulo={`Aplica CLT em ${b.NOME}`}
                      onSalvar={(v) => salvarInline('BENEFICIO', b.ID, { APLICA_CLT: v }, refetchBen)} />
                  </td>
                  <td className="py-2 px-1">
                    <SeloEditavel valor={simNao(b.APLICA_PJ)} opcoes={OPCOES_SIM_NAO} rotulo={`Aplica PJ em ${b.NOME}`}
                      onSalvar={(v) => salvarInline('BENEFICIO', b.ID, { APLICA_PJ: v }, refetchBen)} />
                  </td>
                  <td className="px-3 py-2" style={{ width: '1%' }}>
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => {
                        setEditId(b.ID); setBenForm({ NOME: b.NOME, TIPO: b.TIPO, VALOR: String(b.VALOR || 0), PERCENTUAL: String(b.PERCENTUAL || 0), APLICA_PJ: simNao(b.APLICA_PJ), APLICA_CLT: simNao(b.APLICA_CLT) }); setModalOpen(true);
                      }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                      <button onClick={() => confirmDelete(b.ID, 'BENEFICIO')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBeneficios.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum benefício encontrado</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
        )}
        </>
      )}

      {/* ==================== ENCARGOS ==================== */}
      {tab === 'encargos' && (
        <>
        <div className="flex gap-3 flex-wrap items-center justify-between">
          <div className="flex gap-3 flex-wrap items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                placeholder="Buscar por encargo..."
                value={encSearch} onChange={(e) => setEncSearch(e.target.value)}
              />
            </div>
            <div className="w-48 shrink-0">
              <Select
                options={[{ value: '', label: 'Aplica em (todos)' }, { value: 'CLT', label: 'Aplica CLT' }, { value: 'PJ', label: 'Aplica PJ' }]}
                value={encAplica} onChange={(v) => setEncAplica(v)}
              />
            </div>
          </div>
          <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.encargos} />
            <BotaoImportarCsv onClick={() => abrirImportacaoPorVersao('encargos')} />
            <Button onClick={handleNew}><Plus size={16} className="mr-1" /> {newLabel}</Button></span>
        </div>
        {carregando ? <SkeletonTable columns={5} rows={8} /> : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <CabecalhoOrdenavel campo="nome" rotulo="Nome" ordem={ordEnc.ordem} onOrdenar={ordEnc.alternarOrdem} className={thCls} />
              <CabecalhoOrdenavel campo="percentual" rotulo="Percentual" ordem={ordEnc.ordem} onOrdenar={ordEnc.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="clt" rotulo="CLT" ordem={ordEnc.ordem} onOrdenar={ordEnc.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="pj" rotulo="PJ" ordem={ordEnc.ordem} onOrdenar={ordEnc.alternarOrdem} className={thClsMiddle} />
              <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
            </tr></thead>
            <tbody>
              {ordEnc.ordenar(filteredEncargos).map((e: any) => (
                <tr key={e.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{e.NOME}</td>
                  <td className="py-2 px-1">
                    <NumeroEditavel valor={Number(e.PERCENTUAL || 0)} sufixo="%" alinhamento="left" rotulo={`Percentual de ${e.NOME}`}
                      onSalvar={(v) => salvarInline('ENCARGO', e.ID, { PERCENTUAL: v }, refetchEnc)} />
                  </td>
                  <td className="py-2 px-1">
                    <SeloEditavel valor={simNao(e.APLICA_CLT)} opcoes={OPCOES_SIM_NAO} rotulo={`Aplica CLT em ${e.NOME}`}
                      onSalvar={(v) => salvarInline('ENCARGO', e.ID, { APLICA_CLT: v }, refetchEnc)} />
                  </td>
                  <td className="py-2 px-1">
                    <SeloEditavel valor={simNao(e.APLICA_PJ)} opcoes={OPCOES_SIM_NAO} rotulo={`Aplica PJ em ${e.NOME}`}
                      onSalvar={(v) => salvarInline('ENCARGO', e.ID, { APLICA_PJ: v }, refetchEnc)} />
                  </td>
                  <td className="px-3 py-2" style={{ width: '1%' }}>
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => {
                        setEditId(e.ID); setEncForm({ NOME: e.NOME, PERCENTUAL: String(e.PERCENTUAL), APLICA_PJ: e.APLICA_PJ, APLICA_CLT: e.APLICA_CLT }); setModalOpen(true);
                      }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                      <button onClick={() => confirmDelete(e.ID, 'ENCARGO')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredEncargos.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum encargo encontrado</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
        )}
        </>
      )}

      {/* ==================== PREMISSAS ==================== */}
      {/* ==================== DISSÍDIO ==================== */}
      {tab === 'dissidio' && (
        <>
        <div className="flex gap-3 flex-wrap items-center justify-between">
          <div className="flex gap-3 flex-wrap items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                placeholder="Buscar por empresa..."
                value={dissSearch} onChange={(e) => setDissSearch(e.target.value)}
              />
            </div>
            <div className="w-56 shrink-0">
              <MultiSelect
                options={OPCOES_MESES}
                values={dissMeses}
                onChange={setDissMeses}
                allLabel="Todos os meses"
                placeholder="Todos os meses"
              />
            </div>
          </div>
          <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.dissidio} />
            <BotaoImportarCsv onClick={() => abrirImportacaoPorVersao('dissidio')} />
            <Button onClick={handleNew}><Plus size={16} className="mr-1" /> {newLabel}</Button></span>
        </div>
        {carregando ? <SkeletonTable columns={4} rows={8} /> : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <CabecalhoOrdenavel campo="empresa" rotulo="Empresa" ordem={ordDiss.ordem} onOrdenar={ordDiss.alternarOrdem} className={thCls} />
              <CabecalhoOrdenavel campo="percentual" rotulo="Percentual" ordem={ordDiss.ordem} onOrdenar={ordDiss.alternarOrdem} className={thClsMiddle} />
              <CabecalhoOrdenavel campo="mes" rotulo="Mês de Aplicação" ordem={ordDiss.ordem} onOrdenar={ordDiss.alternarOrdem} className={thClsMiddle} />
              <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
            </tr></thead>
            <tbody>
              {ordDiss.ordenar(filteredDissidios).map((d: any) => (
                <tr key={d.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{d.EMPRESA_NOME}</td>
                  <td className="py-2 px-1">
                    <NumeroEditavel valor={Number(d.PERCENTUAL || 0)} sufixo="%" alinhamento="left" rotulo={`Dissídio de ${d.EMPRESA_NOME}`}
                      onSalvar={(v) => salvarInline('PREMISSA_DISSIDIO', d.ID, { PERCENTUAL: v }, refetchDiss)} />
                  </td>
                  <td className="py-2 px-1">
                    <SelecaoEditavel valor={String(d.MES_APLICACAO || '')} opcoes={OPCOES_MESES}
                      onSalvar={(v) => salvarInline('PREMISSA_DISSIDIO', d.ID, { MES_APLICACAO: Number(v) }, refetchDiss)} />
                  </td>
                  <td className="px-3 py-2" style={{ width: '1%' }}>
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => {
                        setEditId(d.ID); setDissForm({ CICLO_ID: String(d.CICLO_ID), EMPRESA_ID: String(d.EMPRESA_ID), PERCENTUAL: String(d.PERCENTUAL), MES_APLICACAO: String(d.MES_APLICACAO) }); setPremissaModal('dissidio');
                      }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                      <button onClick={() => confirmDelete(d.ID, 'PREMISSA_DISSIDIO')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDissidios.length === 0 && (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum dissídio encontrado</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
        )}
        </>
      )}

      {/* ==================== TURNOVER ==================== */}
      {tab === 'turnover' && (
        <>
        <div className="flex gap-3 flex-wrap items-center justify-between">
          <div className="flex gap-3 flex-wrap items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
                placeholder="Buscar por empresa..."
                value={turnSearch} onChange={(e) => setTurnSearch(e.target.value)}
              />
            </div>
          </div>
          <span className="flex items-center gap-2"><BotaoTemplateCsv template={TEMPLATES_FOLHA.turnover} />
            <BotaoImportarCsv onClick={() => abrirImportacaoPorVersao('turnover')} />
            <Button onClick={handleNew}><Plus size={16} className="mr-1" /> {newLabel}</Button></span>
        </div>
        {carregando ? <SkeletonTable columns={3} rows={8} /> : (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <CabecalhoOrdenavel campo="empresa" rotulo="Empresa" ordem={ordTurn.ordem} onOrdenar={ordTurn.alternarOrdem} className={thCls} />
              <CabecalhoOrdenavel campo="percentual" rotulo="Turnover Anual" ordem={ordTurn.ordem} onOrdenar={ordTurn.alternarOrdem} className={thClsMiddle} />
              <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
            </tr></thead>
            <tbody>
              {ordTurn.ordenar(filteredTurnovers).map((t: any) => (
                <tr key={t.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-2 px-6 font-medium" style={{ color: 'var(--color-text)' }}>{t.EMPRESA_NOME}</td>
                  <td className="py-2 px-1">
                    <NumeroEditavel valor={Number(t.PERCENTUAL || 0)} sufixo="%" alinhamento="left" rotulo={`Turnover de ${t.EMPRESA_NOME}`}
                      onSalvar={(v) => salvarInline('PREMISSA_TURNOVER', t.ID, { PERCENTUAL: v }, refetchTurn)} />
                  </td>
                  <td className="px-3 py-2" style={{ width: '1%' }}>
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => {
                        setEditId(t.ID); setTurnForm({ CICLO_ID: String(t.CICLO_ID), EMPRESA_ID: String(t.EMPRESA_ID), PERCENTUAL: String(t.PERCENTUAL) }); setPremissaModal('turnover');
                      }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                      <button onClick={() => confirmDelete(t.ID, 'PREMISSA_TURNOVER')} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTurnovers.length === 0 && (
                <tr><td colSpan={3} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum turnover encontrado</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
        )}
        </>
      )}

      {/* ==================== MODALS ==================== */}

      {/* Colaborador Modal */}
      <Modal isOpen={modalOpen && tab === 'colaboradores'} onClose={() => setModalOpen(false)} title={editId ? 'Editar Colaborador' : 'Novo Colaborador'}>
        <div className="space-y-4">
          <Input label="Nome Completo" value={colabForm.NOME} onChange={(v) => setColabForm({ ...colabForm, NOME: v })} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Cargo" options={[{ value: '', label: 'Selecione...' }, ...cargosList.map((c: any) => ({ value: c.NOME, label: `${c.NOME} (${formatCurrency(c.SALARIO_MEDIO)})` }))]} value={colabForm.CARGO} onChange={(v) => {
              const cargo = cargosList.find((c: any) => c.NOME === v);
              setColabForm({ ...colabForm, CARGO: v, SALARIO: cargo ? String(cargo.SALARIO_MEDIO) : colabForm.SALARIO });
            }} />
            <Input label="Salário (R$)" type="number" value={colabForm.SALARIO} onChange={(v) => setColabForm({ ...colabForm, SALARIO: v })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Centro de Resultado" options={[{ value: '', label: 'Selecione...' }, ...crs.map((c: any) => ({ value: String(c.ID), label: `${c.CODIGO} - ${c.NOME}` }))]} value={colabForm.CR_ID} onChange={(v) => setColabForm({ ...colabForm, CR_ID: v })} />
            <Select label="Empresa" options={[{ value: '', label: 'Selecione...' }, ...empresas.map((e: any) => ({ value: String(e.ID), label: e.NOME }))]} value={colabForm.EMPRESA_ID} onChange={(v) => setColabForm({ ...colabForm, EMPRESA_ID: v })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Tipo de Contrato" options={[{ value: 'CLT', label: 'CLT' }, { value: 'PJ', label: 'PJ' }]} value={colabForm.TIPO_CONTRATO} onChange={(v) => setColabForm({ ...colabForm, TIPO_CONTRATO: v })} />
            <DatePicker label="Data Admissão" value={colabForm.DATA_ADMISSAO} onChange={(v) => setColabForm({ ...colabForm, DATA_ADMISSAO: v })} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveColab}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Cargo Modal */}
      <Modal isOpen={modalOpen && tab === 'cargos'} onClose={() => setModalOpen(false)} title={editId ? 'Editar Cargo' : 'Novo Cargo'}>
        <div className="space-y-4">
          <Input label="Nome do Cargo" value={cargoForm.NOME} onChange={(v) => setCargoForm({ ...cargoForm, NOME: v })} placeholder="Ex: Analista Pleno" />
          <Input label="Salário Médio (R$)" type="number" value={cargoForm.SALARIO_MEDIO} onChange={(v) => setCargoForm({ ...cargoForm, SALARIO_MEDIO: v })} placeholder="Ex: 5500.00" />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveCargo}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Beneficio Modal */}
      <Modal isOpen={modalOpen && tab === 'beneficios'} onClose={() => setModalOpen(false)} title={editId ? 'Editar Benefício' : 'Novo Benefício'}>
        <div className="space-y-4">
          <Input label="Nome" value={benForm.NOME} onChange={(v) => setBenForm({ ...benForm, NOME: v })} />
          <Select label="Tipo" options={[{ value: 'FIXO', label: 'Fixo (R$)' }, { value: 'PERCENTUAL', label: 'Percentual (%)' }]} value={benForm.TIPO} onChange={(v) => setBenForm({ ...benForm, TIPO: v })} />
          {benForm.TIPO === 'FIXO' ? (
            <Input label="Valor (R$)" type="number" value={benForm.VALOR} onChange={(v) => setBenForm({ ...benForm, VALOR: v })} />
          ) : (
            <Input label="Percentual (%)" type="number" value={benForm.PERCENTUAL} onChange={(v) => setBenForm({ ...benForm, PERCENTUAL: v })} />
          )}
          <Select label="Aplica CLT" options={[{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }]} value={benForm.APLICA_CLT} onChange={(v) => setBenForm({ ...benForm, APLICA_CLT: v })} />
          <Select label="Aplica PJ" options={[{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }]} value={benForm.APLICA_PJ} onChange={(v) => setBenForm({ ...benForm, APLICA_PJ: v })} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveBen}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Encargo Modal */}
      <Modal isOpen={modalOpen && tab === 'encargos'} onClose={() => setModalOpen(false)} title={editId ? 'Editar Encargo' : 'Novo Encargo'}>
        <div className="space-y-4">
          <Input label="Nome" value={encForm.NOME} onChange={(v) => setEncForm({ ...encForm, NOME: v })} />
          <Input label="Percentual (%)" type="number" value={encForm.PERCENTUAL} onChange={(v) => setEncForm({ ...encForm, PERCENTUAL: v })} />
          <Select label="Aplica CLT" options={[{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }]} value={encForm.APLICA_CLT} onChange={(v) => setEncForm({ ...encForm, APLICA_CLT: v })} />
          <Select label="Aplica PJ" options={[{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }]} value={encForm.APLICA_PJ} onChange={(v) => setEncForm({ ...encForm, APLICA_PJ: v })} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveEnc}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Dissidio Modal */}
      <Modal isOpen={premissaModal === 'dissidio'} onClose={() => setPremissaModal(null)} title={editId ? 'Editar Dissídio' : 'Novo Dissídio'}>
        <div className="space-y-4">
          <Select label="Ciclo" options={[{ value: '', label: 'Selecione...' }, ...ciclos.map((c: any) => ({ value: String(c.ID), label: `${rotuloVersao(c)} (${c.ANO})` }))]} value={dissForm.CICLO_ID} onChange={(v) => setDissForm({ ...dissForm, CICLO_ID: v })} />
          <Select label="Empresa" options={[{ value: '', label: 'Selecione...' }, ...empresas.map((e: any) => ({ value: String(e.ID), label: e.NOME }))]} value={dissForm.EMPRESA_ID} onChange={(v) => setDissForm({ ...dissForm, EMPRESA_ID: v })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Percentual (%)" type="number" value={dissForm.PERCENTUAL} onChange={(v) => setDissForm({ ...dissForm, PERCENTUAL: v })} placeholder="Ex: 5.5" />
            <Select label="Mês de Aplicação" options={OPCOES_MESES} value={dissForm.MES_APLICACAO} onChange={(v) => setDissForm({ ...dissForm, MES_APLICACAO: v })} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setPremissaModal(null)}>Cancelar</Button>
            <Button onClick={saveDissidio}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Turnover Modal */}
      <Modal isOpen={premissaModal === 'turnover'} onClose={() => setPremissaModal(null)} title={editId ? 'Editar Turnover' : 'Novo Turnover'}>
        <div className="space-y-4">
          <Select label="Ciclo" options={[{ value: '', label: 'Selecione...' }, ...ciclos.map((c: any) => ({ value: String(c.ID), label: `${rotuloVersao(c)} (${c.ANO})` }))]} value={turnForm.CICLO_ID} onChange={(v) => setTurnForm({ ...turnForm, CICLO_ID: v })} />
          <Select label="Empresa" options={[{ value: '', label: 'Selecione...' }, ...empresas.map((e: any) => ({ value: String(e.ID), label: e.NOME }))]} value={turnForm.EMPRESA_ID} onChange={(v) => setTurnForm({ ...turnForm, EMPRESA_ID: v })} />
          <Input label="Turnover Anual (%)" type="number" value={turnForm.PERCENTUAL} onChange={(v) => setTurnForm({ ...turnForm, PERCENTUAL: v })} placeholder="Ex: 15" />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setPremissaModal(null)}>Cancelar</Button>
            <Button onClick={saveTurnover}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {importarAba && (
        <ImportarCsvModal
          aberto
          aba={importarAba}
          titulo={TITULOS_IMPORTACAO[importarAba]}
          template={TEMPLATES_FOLHA[importarAba]}
          contexto={{
            crs, empresas, cargos: cargosList,
            cicloId: cicloPremissaFilter,
            existentes: existentesPorAba[importarAba],
          }}
          versao={ABAS_POR_VERSAO.has(importarAba) ? nomeVersaoAtual : undefined}
          onFechar={() => setImportarAba(null)}
          onImportado={(quantidade) => {
            const aba = importarAba;
            setImportarAba(null);
            addToast('success', `${quantidade} ${quantidade === 1 ? 'linha importada' : 'linhas importadas'}`);
            refetchHot();
            if (aba === 'cargos') refetchCargo();
          }}
          onErro={(gravadas) => {
            // Falha depois de blocos gravados deixa a tela desatualizada: recarrega
            // para o usuario ver exatamente o que entrou antes do erro.
            if (gravadas > 0) { refetchHot(); if (importarAba === 'cargos') refetchCargo(); }
            addToast('error', gravadas > 0
              ? `Erro ao importar. ${gravadas} ${gravadas === 1 ? 'linha ja tinha sido gravada' : 'linhas ja tinham sido gravadas'} e ${gravadas === 1 ? 'permanece' : 'permanecem'} na tabela.`
              : 'Erro ao importar — nenhuma linha foi gravada');
          }}
        />
      )}

      <ConfirmDialog isOpen={!!deleteId} onClose={() => { setDeleteId(null); setDeleteTable(''); }} onConfirm={handleDelete} title="Excluir" message="Deseja excluir este registro?" confirmLabel="Excluir" />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
