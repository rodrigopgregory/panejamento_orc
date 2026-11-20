import { useState, useEffect, useCallback, useRef } from 'react';
import { execSF, sqlEscape } from '../hooks/useMitraData';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { Plus, SquarePen, Trash2, Search, Building2, BookOpen, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react';

// SFs dedicadas de cadastro (backend/add-cadastros-sfs.mjs)
const SF = {
  listarEmpresas: 41, contarEmpresas: 42, criarEmpresa: 43, atualizarEmpresa: 44, excluirEmpresa: 45,
  listarContas: 46, contarContas: 47, criarConta: 48, atualizarConta: 49, excluirConta: 50,
  listarCRs: 51, contarCRs: 52, criarCR: 53, atualizarCR: 54, excluirCR: 55,
};

const PAGE_SIZE = 50;

const TABS = [
  { key: 'empresas', label: 'Empresas', icon: Building2 },
  { key: 'contas', label: 'Contas Contábeis', icon: BookOpen },
  { key: 'centros', label: 'Centros de Resultado', icon: Briefcase },
] as const;

type TabKey = typeof TABS[number]['key'];

/* ============= HOOKS COMPARTILHADOS ============= */

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Listagem paginada server-side: busca e filtros vao no WHERE da SF,
// paginacao via LIMIT/OFFSET e total via SF de count (as duas em paralelo).
function usePagedList(listSfId: number, countSfId: number, filters: Record<string, string>) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);
  const filtersKey = JSON.stringify(filters);

  const fetchPage = useCallback(async (p: number) => {
    const version = ++versionRef.current;
    setLoading(true);
    try {
      const f = JSON.parse(filtersKey);
      const [r, c] = await Promise.all([
        // limit/offset vao como NUMERO, nunca string. No SQL dessas SFs eles caem
        // em `LIMIT {{limit}} OFFSET {{offset}}`, uma posicao sem aspas — os outros
        // params ficam entre aspas ('{{busca}}') e por isso toleram string. Mandar
        // string aqui depende de a substituicao interpolar o valor cru; onde ela
        // escapa como texto, o SQL vira LIMIT '20' e a tela inteira quebra.
        execSF(listSfId, { ...f, limit: PAGE_SIZE, offset: p * PAGE_SIZE }),
        execSF(countSfId, f),
      ]);
      if (versionRef.current !== version) return; // resposta antiga, descarta
      setRows(r);
      setTotal(Number(c[0]?.TOTAL ?? 0));
      setLoading(false);
    } catch (e) {
      console.error('Erro ao carregar cadastros:', e);
      if (versionRef.current === version) setLoading(false);
    }
  }, [listSfId, countSfId, filtersKey]);

  useEffect(() => { setPage(0); fetchPage(0); }, [fetchPage]);

  const goTo = (p: number) => { setPage(p); fetchPage(p); };
  const refetch = () => fetchPage(page);
  return { rows, total, page, loading, goTo, refetch };
}

/* ============= COMPONENTES COMPARTILHADOS ============= */

function LoadingCard() {
  return (
    <div className="rounded-xl text-center py-12" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
      <div className="animate-spin w-8 h-8 border-3 rounded-full mx-auto mb-3" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Carregando...</p>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-[200px] max-w-xs">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
      <input
        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
        placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Pagination({ page, total, onGo }: { page: number; total: number; onGo: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Mostrando {from}–{to} de {total}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onGo(page - 1)} disabled={page === 0}
            className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-default transition-all duration-200"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            title="Página anterior"
          ><ChevronLeft size={15} /></button>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{page + 1} / {pages}</span>
          <button
            onClick={() => onGo(page + 1)} disabled={page >= pages - 1}
            className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-default transition-all duration-200"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            title="Próxima página"
          ><ChevronRight size={15} /></button>
        </div>
      )}
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
      <button onClick={onEdit} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
      <button onClick={onDelete} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
    </div>
  );
}

const DELETE_ERROR_MSG = 'Não foi possível excluir — o registro está em uso em outros módulos (orçamento, mapeamento, etc.)';

/* ============= PÁGINA ============= */

export default function DadosIntegracaoPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('empresas');
  // Keep-alive: aba visitada permanece montada (escondida) — troca de aba nao refaz requisicoes
  const [visited, setVisited] = useState<Record<TabKey, boolean>>({ empresas: true, contas: false, centros: false });

  const openTab = (key: TabKey) => {
    setActiveTab(key);
    setVisited((v) => (v[key] ? v : { ...v, [key]: true }));
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Cadastros</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Empresas, contas contábeis e centros de resultado
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => openTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 relative"
              style={{
                color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={15} />
              {tab.label}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
              )}
            </button>
          );
        })}
      </div>

      {visited.empresas && <div className="space-y-6" style={{ display: activeTab === 'empresas' ? undefined : 'none' }}><EmpresasTab /></div>}
      {visited.contas && <div className="space-y-6" style={{ display: activeTab === 'contas' ? undefined : 'none' }}><ContasTab /></div>}
      {visited.centros && <div className="space-y-6" style={{ display: activeTab === 'centros' ? undefined : 'none' }}><CentrosTab /></div>}
    </div>
  );
}

/* ============= EMPRESAS TAB ============= */
function EmpresasTab() {
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const busca = useDebounced(searchInput);
  const { rows, total, page, loading, goTo, refetch } = usePagedList(SF.listarEmpresas, SF.contarEmpresas, {
    busca: sqlEscape(busca.trim()), ativo: statusFilter,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ NOME: '', CNPJ: '', ATIVO: 'true' });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const handleNew = () => { setEditId(null); setForm({ NOME: '', CNPJ: '', ATIVO: 'true' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.NOME.trim()) { addToast('error', 'Informe o nome da empresa'); return; }
    setSaving(true);
    try {
      const input = { nome: sqlEscape(form.NOME.trim()), cnpj: sqlEscape(form.CNPJ.trim()), ativo: form.ATIVO };
      if (editId) { await execSF(SF.atualizarEmpresa, { ...input, id: editId }); addToast('success', 'Atualizado!'); }
      else { await execSF(SF.criarEmpresa, { ...input, criadoEm: new Date().toISOString().slice(0, 19) }); addToast('success', 'Criado!'); }
      setModalOpen(false); setEditId(null); setForm({ NOME: '', CNPJ: '', ATIVO: 'true' }); refetch();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await execSF(SF.excluirEmpresa, { id: deleteId }); addToast('success', 'Excluído!'); refetch(); }
    catch (e) { addToast('error', DELETE_ERROR_MSG); }
    setDeleteId(null);
  };

  return (
    <>
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Buscar por nome ou CNPJ..." />
          <div className="w-48 shrink-0">
            <Select
              options={[{ value: '', label: 'Todos os status' }, { value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }]}
              value={statusFilter} onChange={(v) => setStatusFilter(v)}
            />
          </div>
        </div>
        <Button onClick={handleNew}><Plus size={16} className="mr-1" /> Nova Empresa</Button>
      </div>
      {loading ? <LoadingCard /> : (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Nome</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">CNPJ</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Ativo</th>
              <th className="text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap" style={{ width: '1%' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item: any) => (
              <tr key={item.ID} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-6 py-3 font-medium" style={{ color: 'var(--color-text)' }}>{item.NOME}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>{item.CNPJ}</td>
                <td className="px-3 py-3"><Badge variant={item.ATIVO === 'true' ? 'success' : 'neutral'}>{item.ATIVO === 'true' ? 'Sim' : 'Não'}</Badge></td>
                <td className="px-3 py-3" style={{ width: '1%' }}>
                  <RowActions
                    onEdit={() => { setEditId(item.ID); setForm({ NOME: item.NOME, CNPJ: item.CNPJ, ATIVO: item.ATIVO }); setModalOpen(true); }}
                    onDelete={() => setDeleteId(item.ID)}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma empresa encontrada</td></tr>
            )}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} onGo={goTo} />
      </div>
      )}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar Empresa' : 'Nova Empresa'}>
        <div className="space-y-4">
          <Input label="Nome" value={form.NOME} onChange={(v) => setForm({...form, NOME: v})} />
          <Input label="CNPJ" value={form.CNPJ} onChange={(v) => setForm({...form, CNPJ: v})} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Excluir" message="Deseja excluir?" confirmLabel="Excluir" />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

/* ============= CONTAS TAB ============= */
function ContasTab() {
  const [searchInput, setSearchInput] = useState('');
  const [tipoFilter, setTipoFilter] = useState('');
  const busca = useDebounced(searchInput);
  const { rows, total, page, loading, goTo, refetch } = usePagedList(SF.listarContas, SF.contarContas, {
    busca: sqlEscape(busca.trim()), tipo: tipoFilter,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ CODIGO: '', NOME: '', TIPO: '', NATUREZA: 'DEVEDORA', ATIVO: 'true' });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const handleNew = () => { setEditId(null); setForm({ CODIGO: '', NOME: '', TIPO: '', NATUREZA: 'DEVEDORA', ATIVO: 'true' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.CODIGO.trim() || !form.NOME.trim()) { addToast('error', 'Informe código e nome da conta'); return; }
    if (!form.TIPO) { addToast('error', 'Selecione o tipo da conta'); return; }
    setSaving(true);
    try {
      const input = {
        codigo: sqlEscape(form.CODIGO.trim()), nome: sqlEscape(form.NOME.trim()),
        tipo: form.TIPO, natureza: form.NATUREZA, ativo: form.ATIVO,
      };
      if (editId) { await execSF(SF.atualizarConta, { ...input, id: editId }); addToast('success', 'Atualizado!'); }
      else { await execSF(SF.criarConta, input); addToast('success', 'Criado!'); }
      setModalOpen(false); setEditId(null); setForm({ CODIGO: '', NOME: '', TIPO: '', NATUREZA: 'DEVEDORA', ATIVO: 'true' }); refetch();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await execSF(SF.excluirConta, { id: deleteId }); addToast('success', 'Excluído!'); refetch(); }
    catch (e) { addToast('error', DELETE_ERROR_MSG); }
    setDeleteId(null);
  };

  const tipoColors: Record<string, string> = {
    RECEITA: 'success', IMPOSTO: 'warning', CMV: 'danger', DESPESA_PESSOAL: 'info',
    DESPESA_OPERACIONAL: 'info', DESPESA_MARKETING: 'warning', DESPESA_ADMINISTRATIVA: 'info',
    RESULTADO_FINANCEIRO: 'info'
  };

  const tipoOptions = [
    { value: '', label: 'Todos os tipos' },
    { value: 'RECEITA', label: 'Receita' },
    { value: 'IMPOSTO', label: 'Imposto' },
    { value: 'CMV', label: 'CMV' },
    { value: 'DESPESA_PESSOAL', label: 'Despesa Pessoal' },
    { value: 'DESPESA_OPERACIONAL', label: 'Despesa Operacional' },
    { value: 'DESPESA_MARKETING', label: 'Despesa Marketing' },
    { value: 'DESPESA_ADMINISTRATIVA', label: 'Despesa Administrativa' },
    { value: 'RESULTADO_FINANCEIRO', label: 'Resultado Financeiro' },
  ];

  return (
    <>
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Buscar por código ou nome..." />
          <div className="w-48 shrink-0">
            <Select options={tipoOptions} value={tipoFilter} onChange={(v) => setTipoFilter(v)} />
          </div>
        </div>
        <Button onClick={handleNew}><Plus size={16} className="mr-1" /> Nova Conta</Button>
      </div>
      {loading ? <LoadingCard /> : (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Código</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Nome</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Tipo</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Natureza</th>
              <th className="text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap" style={{ width: '1%' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item: any) => (
              <tr key={item.ID} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-6 py-3 font-mono font-medium" style={{ color: 'var(--color-text)' }}>{item.CODIGO}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>{item.NOME}</td>
                <td className="px-3 py-3"><Badge variant={(tipoColors[item.TIPO] || 'neutral') as any}>{item.TIPO}</Badge></td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text-secondary)' }}>{item.NATUREZA}</td>
                <td className="px-3 py-3" style={{ width: '1%' }}>
                  <RowActions
                    onEdit={() => { setEditId(item.ID); setForm({ CODIGO: item.CODIGO, NOME: item.NOME, TIPO: item.TIPO, NATUREZA: item.NATUREZA, ATIVO: item.ATIVO }); setModalOpen(true); }}
                    onDelete={() => setDeleteId(item.ID)}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta encontrada</td></tr>
            )}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} onGo={goTo} />
      </div>
      )}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar Conta' : 'Nova Conta'}>
        <div className="space-y-4">
          <Input label="Código" value={form.CODIGO} onChange={(v) => setForm({...form, CODIGO: v})} placeholder="Ex: 3.1.01" />
          <Input label="Nome" value={form.NOME} onChange={(v) => setForm({...form, NOME: v})} />
          <Select label="Tipo" options={[
            {value:'RECEITA',label:'Receita'},{value:'IMPOSTO',label:'Imposto'},{value:'CMV',label:'CMV'},
            {value:'DESPESA_PESSOAL',label:'Despesa Pessoal'},{value:'DESPESA_OPERACIONAL',label:'Despesa Operacional'},
            {value:'DESPESA_MARKETING',label:'Despesa Marketing'},{value:'DESPESA_ADMINISTRATIVA',label:'Despesa Administrativa'},
            {value:'RESULTADO_FINANCEIRO',label:'Resultado Financeiro'}
          ]} value={form.TIPO} onChange={(v) => setForm({...form, TIPO: v})} />
          <Select label="Natureza" options={[{value:'DEVEDORA',label:'Devedora'},{value:'CREDORA',label:'Credora'}]} value={form.NATUREZA} onChange={(v) => setForm({...form, NATUREZA: v})} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Excluir" message="Deseja excluir?" confirmLabel="Excluir" />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

/* ============= CENTROS DE RESULTADO TAB ============= */
function CentrosTab() {
  const [searchInput, setSearchInput] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState('');
  const busca = useDebounced(searchInput);
  const { rows, total, page, loading, goTo, refetch } = usePagedList(SF.listarCRs, SF.contarCRs, {
    busca: sqlEscape(busca.trim()), empresaId: empresaFilter,
  });

  // Empresas ativas para o filtro e o formulario (carrega uma vez)
  const [empresas, setEmpresas] = useState<any[]>([]);
  useEffect(() => {
    execSF(SF.listarEmpresas, { busca: '', ativo: 'true', limit: 500, offset: 0 })
      .then(setEmpresas)
      .catch((e) => console.error('Erro ao carregar empresas:', e));
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ CODIGO: '', NOME: '', EMPRESA_ID: '', ATIVO: 'true' });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const handleNew = () => { setEditId(null); setForm({ CODIGO: '', NOME: '', EMPRESA_ID: '', ATIVO: 'true' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.CODIGO.trim() || !form.NOME.trim()) { addToast('error', 'Informe código e nome do CR'); return; }
    const empresaId = Number(form.EMPRESA_ID);
    if (!empresaId) { addToast('error', 'Selecione a empresa'); return; }
    setSaving(true);
    try {
      const input = { codigo: sqlEscape(form.CODIGO.trim()), nome: sqlEscape(form.NOME.trim()), empresaId, ativo: form.ATIVO };
      if (editId) { await execSF(SF.atualizarCR, { ...input, id: editId }); addToast('success', 'Atualizado!'); }
      else { await execSF(SF.criarCR, input); addToast('success', 'Criado!'); }
      setModalOpen(false); setEditId(null); setForm({ CODIGO: '', NOME: '', EMPRESA_ID: '', ATIVO: 'true' }); refetch();
    } catch (e) { addToast('error', 'Erro ao salvar'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await execSF(SF.excluirCR, { id: deleteId }); addToast('success', 'Excluído!'); refetch(); }
    catch (e) { addToast('error', DELETE_ERROR_MSG); }
    setDeleteId(null);
  };

  return (
    <>
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Buscar por código ou nome..." />
          <div className="w-48 shrink-0">
            <Select
              options={[{ value: '', label: 'Todas as empresas' }, ...empresas.map((e: any) => ({ value: String(e.ID), label: e.NOME }))]}
              value={empresaFilter} onChange={(v) => setEmpresaFilter(v)}
            />
          </div>
        </div>
        <Button onClick={handleNew}><Plus size={16} className="mr-1" /> Novo CR</Button>
      </div>
      {loading ? <LoadingCard /> : (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Código</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Nome</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Empresa</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Ativo</th>
              <th className="text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap" style={{ width: '1%' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item: any) => (
              <tr key={item.ID} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-6 py-3 font-mono font-medium" style={{ color: 'var(--color-text)' }}>{item.CODIGO}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>{item.NOME}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text-secondary)' }}>{item.EMPRESA_NOME || '-'}</td>
                <td className="px-3 py-3"><Badge variant={item.ATIVO === 'true' ? 'success' : 'neutral'}>{item.ATIVO === 'true' ? 'Sim' : 'Não'}</Badge></td>
                <td className="px-3 py-3" style={{ width: '1%' }}>
                  <RowActions
                    onEdit={() => { setEditId(item.ID); setForm({ CODIGO: item.CODIGO, NOME: item.NOME, EMPRESA_ID: String(item.EMPRESA_ID), ATIVO: item.ATIVO }); setModalOpen(true); }}
                    onDelete={() => setDeleteId(item.ID)}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum centro de resultado encontrado</td></tr>
            )}
          </tbody>
        </table></div>
        <Pagination page={page} total={total} onGo={goTo} />
      </div>
      )}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar CR' : 'Novo CR'}>
        <div className="space-y-4">
          <Input label="Código" value={form.CODIGO} onChange={(v) => setForm({...form, CODIGO: v})} placeholder="Ex: CR001" />
          <Input label="Nome" value={form.NOME} onChange={(v) => setForm({...form, NOME: v})} />
          <Select label="Empresa" options={[{value:'',label:'Selecione...'}, ...empresas.map((e: any) => ({value: String(e.ID), label: e.NOME}))]} value={form.EMPRESA_ID} onChange={(v) => setForm({...form, EMPRESA_ID: v})} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title="Excluir" message="Deseja excluir?" confirmLabel="Excluir" />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}
