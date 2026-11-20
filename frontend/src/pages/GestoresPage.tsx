import { useState, useMemo } from 'react';
import { useList, useSF, jsonField, SF_IDS, querySQL, createRecord, updateRecord, removeRecord, sincronizarCardsCiclo } from '../hooks/useMitraData';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import MultiSelect from '../components/ui/MultiSelect';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { ToastContainer } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../hooks/useToast';
import {
  Plus, Trash2, AlertTriangle,
  Users, AlertCircle, Package, SquarePen, X, Search,
} from 'lucide-react';
import { toTitleCase } from '../lib/utils';

export default function GestoresPage() {
  const { data, loading: loadingGestores, refetch } = useList('GESTOR');
  // Mount em 1 ida: SF 130 devolve CRS/GESTOR_CRS/GESTOR_PACOTES/PACOTES como blocos JSON
  // (eram 4 chamadas sandbox). refetchLinks agora atualiza todos os vinculos de uma vez.
  const { data: hotRows, loading: loadingHot, refetch: refetchLinks } = useSF(SF_IDS.hotGestoresBase, {});
  // As duas chamadas saem em paralelo no mount: os KPIs e a lista so podem
  // afirmar "0 gestores" / "Nenhum gestor cadastrado" quando AMBAS responderem —
  // ate la a tela esta vazia por falta de resposta, nao por falta de dado.
  // Restrito a carga inicial (nenhum dos dois lados respondeu ainda): nos refetch
  // pos-CRUD os dados antigos continuam na tela, entao nao ha o que "esconder".
  const loading = (loadingGestores || loadingHot) && (data.length === 0 || (hotRows?.length ?? 0) === 0);
  const crs = useMemo(() => jsonField(hotRows?.[0]?.CRS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [hotRows]);
  const gestorCrs = useMemo(() => jsonField(hotRows?.[0]?.GESTOR_CRS), [hotRows]);
  const gestorPacotes = useMemo(() => jsonField(hotRows?.[0]?.GESTOR_PACOTES), [hotRows]);
  const allPacotes = useMemo(() => jsonField(hotRows?.[0]?.PACOTES).sort((a, b) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [hotRows]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ NOME: '', EMAIL: '', ATIVO: 'true' });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedCR, setSelectedCR] = useState('');
  const [selectedPacote, setSelectedPacote] = useState('');
  const [reassignConfirm, setReassignConfirm] = useState<{ crId: number; crLabel: string; currentGestorName: string; currentLinkId: number } | null>(null);
  const [reassignPacoteConfirm, setReassignPacoteConfirm] = useState<{ driverId: number; pacoteLabel: string; currentGestorName: string; currentLinkId: number } | null>(null);
  const [crsSemGestorOpen, setCrsSemGestorOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCRs, setFilterCRs] = useState<string[]>([]);
  const [filterPacotes, setFilterPacotes] = useState<string[]>([]);
  const { toasts, addToast, removeToast } = useToast();

  // ── KPIs ──
  const totalGestores = data.length;
  const crsComGestor = new Set(gestorCrs.map((gc: any) => gc.CR_ID));
  const crsSemGestorList = crs.filter((cr: any) => !crsComGestor.has(cr.ID));
  const crsSemGestor = crsSemGestorList.length;
  const pacotesComGestor = new Set(gestorPacotes.map((gp: any) => gp.DRIVER_ID));
  const pacotesSemResp = allPacotes.filter((p: any) => !pacotesComGestor.has(p.ID)).length;

  // ── Filtered list ──
  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      result = result.filter((g: any) => g.NOME?.toLowerCase().includes(t) || g.EMAIL?.toLowerCase().includes(t));
    }
    if (filterCRs.length > 0) {
      const crIds = new Set(filterCRs.map((id) => Number(id)));
      const gestorIds = new Set(gestorCrs.filter((gc: any) => crIds.has(gc.CR_ID)).map((gc: any) => gc.GESTOR_ID));
      result = result.filter((g: any) => gestorIds.has(g.ID));
    }
    if (filterPacotes.length > 0) {
      const driverIds = new Set(filterPacotes.map((id) => Number(id)));
      const gestorIds = new Set(gestorPacotes.filter((gp: any) => driverIds.has(gp.DRIVER_ID)).map((gp: any) => gp.GESTOR_ID));
      result = result.filter((g: any) => gestorIds.has(g.ID));
    }
    return result;
  }, [data, searchTerm, filterCRs, filterPacotes, gestorCrs, gestorPacotes]);

  // Mantém os cards do /workflow (ORCAMENTO_STATUS e PACOTE_STATUS) dos ciclos
  // abertos em sincronia com o mapeamento: sem o card, o CR/pacote vinculado no
  // meio do ciclo não aparece pro gestor nem pro aprovador (o card só nascia na
  // criação da versão). A SF cria o que falta, transfere o pendente e remove o
  // pendente sem vínculo; SUBMETIDO/APROVADO ficam como história. O vínculo em
  // si já foi gravado — se a sincronização falhar, avisa em vez de desfazer.
  const syncCards = async () => {
    try { await sincronizarCardsCiclo(); }
    catch { addToast('info', 'Vínculo salvo, mas os cards do workflow não foram atualizados. Tente salvar de novo.'); }
  };

  // ── CRUD ──
  const handleSave = async () => {
    try {
      if (editId) {
        await updateRecord('GESTOR', editId, form);
        // Desativar/reativar muda quais vínculos contam — reflete nos cards.
        await syncCards();
        addToast('success', 'Gestor atualizado');
      }
      else { await createRecord('GESTOR', form); addToast('success', 'Gestor criado'); }
      setModalOpen(false); setEditId(null); setForm({ NOME: '', EMAIL: '', ATIVO: 'true' }); refetch();
    } catch { addToast('error', 'Erro ao salvar'); }
  };

  const addCRLink = async () => {
    if (!editId || !selectedCR) return;
    const crId = Number(selectedCR);
    const existingLink = gestorCrs.find((gc: any) => gc.CR_ID === crId && gc.GESTOR_ID !== editId);
    if (existingLink) {
      const gestorOwner = data.find((g: any) => g.ID === existingLink.GESTOR_ID);
      const cr = crs.find((c: any) => c.ID === crId);
      setReassignConfirm({ crId, crLabel: cr ? `${cr.CODIGO} - ${cr.NOME}` : `CR ${crId}`, currentGestorName: gestorOwner?.NOME || 'outro gestor', currentLinkId: existingLink.ID });
      return;
    }
    try {
      await createRecord('GESTOR_CR', { GESTOR_ID: editId, CR_ID: crId });
      await syncCards();
      addToast('success', 'CR vinculado');
      setSelectedCR(''); refetchLinks();
    } catch { addToast('error', 'Erro ao vincular'); }
  };

  const confirmReassign = async () => {
    if (!reassignConfirm || !editId) return;
    try {
      await removeRecord('GESTOR_CR', reassignConfirm.currentLinkId);
      await createRecord('GESTOR_CR', { GESTOR_ID: editId, CR_ID: reassignConfirm.crId });
      await syncCards();
      addToast('success', 'CR transferido');
      setSelectedCR(''); setReassignConfirm(null); refetchLinks();
    } catch { addToast('error', 'Erro ao transferir'); setReassignConfirm(null); }
  };

  const removeCRLink = async (id: number) => {
    try {
      await removeRecord('GESTOR_CR', id);
      await syncCards();
      addToast('success', 'Vínculo removido'); refetchLinks();
    } catch { addToast('error', 'Erro'); }
  };

  const addPacoteLink = async () => {
    if (!editId || !selectedPacote) return;
    const driverId = Number(selectedPacote);
    const existingLink = gestorPacotes.find((gp: any) => gp.DRIVER_ID === driverId && gp.GESTOR_ID !== editId);
    if (existingLink) {
      const gestorOwner = data.find((g: any) => g.ID === existingLink.GESTOR_ID);
      const pacote = allPacotes.find((p: any) => p.ID === driverId);
      setReassignPacoteConfirm({
        driverId,
        pacoteLabel: toTitleCase(pacote?.NOME || `Pacote ${driverId}`),
        currentGestorName: gestorOwner?.NOME || 'outro gestor',
        currentLinkId: existingLink.ID,
      });
      return;
    }
    try {
      await createRecord('GESTOR_PACOTE', { GESTOR_ID: editId, DRIVER_ID: driverId });
      await syncCards();
      addToast('success', 'Pacote vinculado');
      setSelectedPacote(''); refetchLinks();
    } catch { addToast('error', 'Erro ao vincular'); }
  };

  const confirmReassignPacote = async () => {
    if (!reassignPacoteConfirm || !editId) return;
    try {
      await removeRecord('GESTOR_PACOTE', reassignPacoteConfirm.currentLinkId);
      await createRecord('GESTOR_PACOTE', { GESTOR_ID: editId, DRIVER_ID: reassignPacoteConfirm.driverId });
      await syncCards();
      addToast('success', 'Pacote transferido');
      setSelectedPacote(''); setReassignPacoteConfirm(null); refetchLinks();
    } catch { addToast('error', 'Erro ao transferir'); setReassignPacoteConfirm(null); }
  };

  const removePacoteLink = async (id: number) => {
    try {
      await removeRecord('GESTOR_PACOTE', id);
      await syncCards();
      addToast('success', 'Vínculo removido'); refetchLinks();
    } catch { addToast('error', 'Erro'); }
  };

  const openEdit = (item: any) => {
    setEditId(item.ID);
    setForm({ NOME: item.NOME, EMAIL: item.EMAIL || '', ATIVO: item.ATIVO || 'true' });
    setSelectedCR('');
    setSelectedPacote('');
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditId(null);
    setForm({ NOME: '', EMAIL: '', ATIVO: 'true' });
    setSelectedCR('');
    setSelectedPacote('');
    setModalOpen(true);
  };

  const currentLinks = editId ? gestorCrs.filter((gc: any) => gc.GESTOR_ID === editId) : [];
  const linkedCRIds = new Set(currentLinks.map((l: any) => l.CR_ID));
  const currentPacoteLinks = editId ? gestorPacotes.filter((gp: any) => gp.GESTOR_ID === editId) : [];
  const linkedPacoteIds = new Set(currentPacoteLinks.map((l: any) => l.DRIVER_ID));

  // ── Format helpers ──
  const getCrSummary = (gestorId: number) => {
    const links = gestorCrs.filter((gc: any) => gc.GESTOR_ID === gestorId);
    if (!links.length) return null;
    if (links.length <= 2) return links.map((l: any) => l.CR_NOME).join(', ');
    return `${links.length} CRs`;
  };

  const getPacoteSummary = (gestorId: number) => {
    const pkgs = gestorPacotes.filter((gp: any) => gp.GESTOR_ID === gestorId);
    if (!pkgs.length) return null;
    if (pkgs.length <= 2) return pkgs.map((p: any) => toTitleCase(p.DRIVER_NOME || '')).join(', ');
    return `${pkgs.length} Pacotes`;
  };

  const getCrCount = (gestorId: number) => gestorCrs.filter((gc: any) => gc.GESTOR_ID === gestorId).length;
  const getPacoteCount = (gestorId: number) => gestorPacotes.filter((gp: any) => gp.GESTOR_ID === gestorId).length;

  return (
    <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header ── */}
      <div>
        <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Gestores</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>Gerencie os gestores e seus vínculos com centros de resultado</p>
      </div>

      {/* ── KPIs ── */}
      <div className="flex items-center gap-6 px-1" style={{ minHeight: 20 }}>
        {loading ? (
          <>
            <Skeleton className="h-4" style={{ width: 96 }} />
            <Skeleton className="h-4" style={{ width: 132 }} />
            <Skeleton className="h-4" style={{ width: 176 }} />
          </>
        ) : (
        <>
        <div className="flex items-center gap-2">
          <Users size={14} style={{ color: 'var(--color-text-muted)' }} />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}><strong style={{ color: 'var(--color-text)' }}>{totalGestores}</strong> gestores</span>
        </div>
        <button
          type="button"
          onClick={() => crsSemGestor > 0 && setCrsSemGestorOpen(true)}
          disabled={crsSemGestor === 0}
          className="flex items-center gap-2 rounded-md transition-colors px-1 py-0.5 -mx-1"
          style={{ cursor: crsSemGestor > 0 ? 'pointer' : 'default' }}
          onMouseEnter={(e) => { if (crsSemGestor > 0) e.currentTarget.style.backgroundColor = 'var(--bg-muted)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          title={crsSemGestor > 0 ? 'Ver CRs sem gestor' : undefined}
        >
          <AlertCircle size={14} style={{ color: crsSemGestor > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }} />
          <span
            className="text-sm"
            style={{
              color: crsSemGestor > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
              textDecoration: crsSemGestor > 0 ? 'underline' : 'none',
              textUnderlineOffset: 3,
              textDecorationStyle: 'dotted',
            }}
          >
            <strong>{crsSemGestor}</strong> {crsSemGestor === 1 ? 'CR sem gestor' : 'CRs sem gestor'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <Package size={14} style={{ color: pacotesSemResp > 0 ? '#f59e0b' : 'var(--color-text-muted)' }} />
          <span className="text-sm" style={{ color: pacotesSemResp > 0 ? '#f59e0b' : 'var(--color-text-muted)' }}>
            <strong>{pacotesSemResp}</strong> {pacotesSemResp === 1 ? 'pacote sem responsável' : 'pacotes sem responsável'}
          </span>
        </div>
        </>
        )}
      </div>

      {/* ── Filters + botao Novo Gestor ── */}
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 text-sm"
              style={{ height: 34, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="w-48 shrink-0">
            <MultiSelect
              options={crs.map((cr: any) => ({ value: String(cr.ID), label: `${cr.CODIGO} - ${cr.NOME}` }))}
              values={filterCRs}
              onChange={setFilterCRs}
              allLabel="Todos os CRs"
              placeholder="Todos os CRs"
            />
          </div>
          {allPacotes.length > 0 && (
            <div className="w-48 shrink-0">
              <MultiSelect
                options={allPacotes.map((p: any) => ({ value: String(p.ID), label: toTitleCase(p.NOME || '') }))}
                values={filterPacotes}
                onChange={setFilterPacotes}
                allLabel="Todos os Pacotes"
                placeholder="Todos os Pacotes"
              />
            </div>
          )}
          {(searchTerm || filterCRs.length > 0 || filterPacotes.length > 0) && (
            <button
              onClick={() => { setSearchTerm(''); setFilterCRs([]); setFilterPacotes([]); }}
              className="text-xs font-medium px-2 py-1 rounded-md transition-colors"
              style={{ color: 'var(--color-primary)' }}
            >
              Limpar filtros
            </button>
          )}
        </div>
        <Button onClick={openCreate}><Plus size={15} className="mr-1.5" /> Novo Gestor</Button>
      </div>

      {/* ── List ── */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        {/* Header row */}
        <div className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: '200px 1fr 1fr 80px 64px', borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Gestor</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>CRs</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Pacotes</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-right" style={{ color: 'var(--color-text-muted)' }}>Vínculos</span>
          <span />
        </div>

        {loading ? (
          Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className="grid items-center px-4"
              style={{
                gridTemplateColumns: '200px 1fr 1fr 80px 64px',
                borderBottom: '1px solid var(--color-border)',
                minHeight: 52,
              }}
            >
              <Skeleton className="h-4" style={{ width: '72%' }} />
              <Skeleton className="h-4" style={{ width: '58%' }} />
              <Skeleton className="h-4" style={{ width: '46%' }} />
              <Skeleton className="h-4 ml-auto" style={{ width: 24 }} />
              <span />
            </div>
          ))
        ) : filteredData.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {searchTerm || filterCRs.length > 0 || filterPacotes.length > 0 ? 'Nenhum gestor encontrado para os filtros aplicados' : 'Nenhum gestor cadastrado'}
          </div>
        ) : (
          filteredData.map((item: any) => {
            const crText = getCrSummary(item.ID);
            const pkgText = getPacoteSummary(item.ID);
            const totalVinculos = getCrCount(item.ID) + getPacoteCount(item.ID);

            return (
              <div
                key={item.ID}
                className="grid items-center px-4 transition-colors"
                style={{
                  gridTemplateColumns: '200px 1fr 1fr 80px 64px',
                  borderBottom: '1px solid var(--color-border)',
                  minHeight: 52,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active, var(--bg-muted))')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {/* Nome + email */}
                <div className="py-2.5" style={{ minWidth: 0 }}>
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.NOME}</div>
                  {item.EMAIL && <div className="text-[12px] truncate" style={{ color: 'var(--color-text-muted)' }}>{item.EMAIL}</div>}
                </div>

                {/* CRs */}
                <div className="text-sm truncate" style={{ color: crText ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {crText || <span className="text-[12px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>—</span>}
                </div>

                {/* Pacotes */}
                <div className="text-sm truncate" style={{ color: pkgText ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {pkgText || <span className="text-[12px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>—</span>}
                </div>

                {/* Vínculos count */}
                <div className="text-right">
                  {totalVinculos > 0 ? (
                    <span className="text-sm tabular-nums font-medium" style={{ color: 'var(--color-text)' }}>{totalVinculos}</span>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>Sem vínculos</span>
                  )}
                </div>

                {/* Ações: editar + deletar */}
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => openEdit(item)}
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-muted)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    title="Editar"
                  >
                    <SquarePen size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteId(item.ID)}
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    title="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {filteredData.length > 0 && (
        <p className="text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
          {filteredData.length === data.length ? `${data.length} gestores` : `${filteredData.length} de ${data.length} gestores`}
        </p>
      )}

      {/* ── Edit/Create Modal ── */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar Gestor' : 'Novo Gestor'}>
        <div className="space-y-4">
          <Input label="Nome" value={form.NOME} onChange={(v) => setForm({ ...form, NOME: v })} />
          <Input label="Email" value={form.EMAIL} onChange={(v) => setForm({ ...form, EMAIL: v })} />

          {editId && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>
                CRs Vinculados
              </label>
              {currentLinks.length === 0 ? (
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Nenhum CR vinculado</p>
              ) : (
                <div className="space-y-1 mb-3">
                  {currentLinks.map((gc: any) => (
                    <div key={gc.ID} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ backgroundColor: 'var(--bg-muted)' }}>
                      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{gc.CODIGO} - {gc.CR_NOME}</span>
                      <button className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                        onClick={() => removeCRLink(gc.ID)}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Select
                  className="flex-1"
                  options={crs.filter((cr: any) => !linkedCRIds.has(cr.ID)).map((cr: any) => {
                    const otherLink = gestorCrs.find((gc: any) => gc.CR_ID === cr.ID);
                    const otherGestor = otherLink ? data.find((g: any) => g.ID === otherLink.GESTOR_ID) : null;
                    return {
                      value: String(cr.ID),
                      label: `${cr.CODIGO} - ${cr.NOME}${otherGestor ? ` (${otherGestor.NOME})` : ''}`,
                    };
                  })}
                  value={selectedCR}
                  onChange={(v) => setSelectedCR(v)}
                  placeholder="Adicionar CR..."
                />
                <Button size="sm" onClick={addCRLink} disabled={!selectedCR}>Vincular</Button>
              </div>
            </div>
          )}

          {editId && allPacotes.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>
                Pacotes Vinculados
              </label>
              {currentPacoteLinks.length === 0 ? (
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Nenhum pacote vinculado</p>
              ) : (
                <div className="space-y-1 mb-3">
                  {currentPacoteLinks.map((gp: any) => (
                    <div key={gp.ID} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ backgroundColor: 'var(--bg-muted)' }}>
                      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{toTitleCase(gp.DRIVER_NOME || '')}</span>
                      <button className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                        onClick={() => removePacoteLink(gp.ID)}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Select
                  className="flex-1"
                  options={allPacotes.filter((p: any) => !linkedPacoteIds.has(p.ID)).map((p: any) => {
                    const otherLink = gestorPacotes.find((gp: any) => gp.DRIVER_ID === p.ID);
                    const otherGestor = otherLink ? data.find((g: any) => g.ID === otherLink.GESTOR_ID) : null;
                    return {
                      value: String(p.ID),
                      label: `${toTitleCase(p.NOME || '')}${otherGestor ? ` (${otherGestor.NOME})` : ''}`,
                    };
                  })}
                  value={selectedPacote}
                  onChange={(v) => setSelectedPacote(v)}
                  placeholder="Adicionar pacote..."
                />
                <Button size="sm" onClick={addPacoteLink} disabled={!selectedPacote}>Vincular</Button>
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                Pacotes são criados no Mapeamento (aba Modelos de projeção &gt; Pacotes) e aparecem aqui automaticamente para vincular a um responsável.
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          try {
            const gcrRows = await querySQL(`SELECT ID FROM GESTOR_CR WHERE GESTOR_ID = ${deleteId}`);
            for (const r of gcrRows) await removeRecord('GESTOR_CR', r.ID);
            const gpRows = await querySQL(`SELECT ID FROM GESTOR_PACOTE WHERE GESTOR_ID = ${deleteId}`);
            for (const r of gpRows) await removeRecord('GESTOR_PACOTE', r.ID);
            const psRows = await querySQL(`SELECT ID FROM PACOTE_STATUS WHERE GESTOR_ID = ${deleteId}`);
            for (const r of psRows) await removeRecord('PACOTE_STATUS', r.ID);
            const osRows = await querySQL(`SELECT ID FROM ORCAMENTO_STATUS WHERE GESTOR_ID = ${deleteId}`);
            for (const r of osRows) await removeRecord('ORCAMENTO_STATUS', r.ID);
            await removeRecord('GESTOR', deleteId);
            setDeleteId(null);
            addToast('success', 'Gestor removido');
            refetch(); refetchLinks();
          } catch (e) {
            console.error(e);
            addToast('error', 'Erro ao remover gestor');
            setDeleteId(null);
          }
        }}
        title="Remover Gestor"
        message="Todos os vínculos com CRs, pacotes e status de orçamento serão removidos permanentemente."
        confirmLabel="Remover"
      />

      {/* ── Reassign CR Confirm ── */}
      <Modal isOpen={!!reassignConfirm} onClose={() => setReassignConfirm(null)} title="Transferir CR">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)' }}>
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-icon)' }} />
            <div className="text-sm" style={{ color: 'var(--color-warning-text)' }}>
              O CR <strong>{reassignConfirm?.crLabel}</strong> já tem como responsável <strong>{reassignConfirm?.currentGestorName}</strong>. Cada CR só pode ter um único responsável — ao continuar, <strong>{reassignConfirm?.currentGestorName}</strong> deixará de ser o responsável e este gestor passará a ser o novo responsável. Deseja confirmar?
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setReassignConfirm(null)}>Cancelar</Button>
            <Button onClick={confirmReassign}>Transferir</Button>
          </div>
        </div>
      </Modal>

      {/* ── Reassign Pacote Confirm ── */}
      <Modal isOpen={!!reassignPacoteConfirm} onClose={() => setReassignPacoteConfirm(null)} title="Transferir Pacote">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)' }}>
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-icon)' }} />
            <div className="text-sm" style={{ color: 'var(--color-warning-text)' }}>
              O pacote <strong>{reassignPacoteConfirm?.pacoteLabel}</strong> já tem como responsável <strong>{reassignPacoteConfirm?.currentGestorName}</strong>. Cada pacote só pode ter um único responsável — ao continuar, <strong>{reassignPacoteConfirm?.currentGestorName}</strong> deixará de ser o responsável e este gestor passará a ser o novo responsável. Deseja confirmar?
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setReassignPacoteConfirm(null)}>Cancelar</Button>
            <Button onClick={confirmReassignPacote}>Transferir</Button>
          </div>
        </div>
      </Modal>

      {/* ── CRs sem Gestor List ── */}
      <Modal isOpen={crsSemGestorOpen} onClose={() => setCrsSemGestorOpen(false)} title={`CRs sem gestor (${crsSemGestor})`}>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Estes CRs ainda não têm responsável atribuído. Vincule-os a um gestor pela edição do gestor.
          </p>
          {crsSemGestorList.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
              Todos os CRs já possuem gestor.
            </p>
          ) : (
            <div className="rounded-lg overflow-hidden max-h-80 overflow-y-auto" style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
              {crsSemGestorList.map((cr: any) => (
                <div
                  key={cr.ID}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                  style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  <span className="font-mono text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{cr.CODIGO}</span>
                  <span className="truncate">{cr.NOME}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
