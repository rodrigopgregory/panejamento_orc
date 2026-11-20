import { useState } from 'react';
import { useList, createRecord, updateRecord, removeRecord } from '../hooks/useMitraData';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { Plus, SquarePen, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

export default function DREConfigPage() {
  const { data, loading, refetch } = useList('DRE_CONFIG');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ORDEM: '', NOME_LINHA: '', TIPO: 'CONTA', PREFIXO_CONTA: '', SINAL: '1', IS_SUBTOTAL: 'false' });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const sorted = [...data].sort((a: any, b: any) => Number(a.ORDEM) - Number(b.ORDEM));

  const handleSave = async () => {
    try {
      const d = { ...form, ORDEM: Number(form.ORDEM), SINAL: Number(form.SINAL), IS_SUBTOTAL: form.TIPO === 'SUBTOTAL' ? 'true' : 'false' };
      if (editId) { await updateRecord('DRE_CONFIG', editId, d); }
      else { await createRecord('DRE_CONFIG', d); }
      addToast('success', 'Salvo!'); setModalOpen(false); setEditId(null); refetch();
      setForm({ ORDEM: '', NOME_LINHA: '', TIPO: 'CONTA', PREFIXO_CONTA: '', SINAL: '1', IS_SUBTOTAL: 'false' });
    } catch (e) { addToast('error', 'Erro'); }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Configuração do DRE</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>Configure as linhas do DRE com base no prefixo das contas contábeis</p>
        </div>
        <Button onClick={() => { setEditId(null); setForm({ ORDEM: String((sorted.length + 1)), NOME_LINHA: '', TIPO: 'CONTA', PREFIXO_CONTA: '', SINAL: '1', IS_SUBTOTAL: 'false' }); setModalOpen(true); }}><Plus size={16} className="mr-1" /> Nova Linha</Button>
      </div>

      {loading ? (
        <div className="rounded-xl text-center py-12" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <div className="animate-spin w-8 h-8 border-3 rounded-full mx-auto mb-3" style={{ borderColor: 'var(--color-primary, #75c95f)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Carregando...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl text-center py-12" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <Plus size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma linha configurada no DRE</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Clique em "Nova Linha" para começar</p>
        </div>
      ) : (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              <th className="text-left px-6 py-3 uppercase tracking-wide font-medium w-16">Ordem</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Nome da Linha</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Tipo</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Prefixo</th>
              <th className="text-left px-3 py-3 uppercase tracking-wide font-medium">Sinal</th>
              <th className="text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap" style={{ width: '1%' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item: any) => (
              <tr key={item.ID} className="group transition-colors" style={{ borderTop: item.IS_SUBTOTAL === 'true' ? '1px solid var(--dash-dre-sub-border)' : '1px solid var(--color-border)', backgroundImage: item.IS_SUBTOTAL === 'true' ? 'var(--dre-sub-grad)' : undefined, fontWeight: item.IS_SUBTOTAL === 'true' ? 600 : undefined }}>
                <td className="px-6 py-3 text-center" style={{ color: 'var(--color-text)' }}>{item.ORDEM}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>{item.NOME_LINHA}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}><Badge variant={item.TIPO === 'SUBTOTAL' ? 'success' : 'info'}>{item.TIPO}</Badge></td>
                <td className="px-3 py-3 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{item.PREFIXO_CONTA || '-'}</td>
                <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>
                  {item.SINAL === 1 || item.SINAL === '1' ? (
                    <span className="text-emerald-600 flex items-center gap-1"><ArrowUp size={14} /> +</span>
                  ) : (
                    <span className="text-red-500 flex items-center gap-1"><ArrowDown size={14} /> -</span>
                  )}
                </td>
                <td className="px-3 py-3" style={{ width: '1%' }}>
                  <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                    <button onClick={() => { setEditId(item.ID); setForm({ ORDEM: String(item.ORDEM), NOME_LINHA: item.NOME_LINHA, TIPO: item.TIPO, PREFIXO_CONTA: item.PREFIXO_CONTA || '', SINAL: String(item.SINAL), IS_SUBTOTAL: item.IS_SUBTOTAL }); setModalOpen(true); }} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: 'var(--color-text-secondary)' }} title="Editar"><SquarePen size={16} /></button>
                    <button onClick={() => setDeleteId(item.ID)} className="p-1.5 rounded cursor-pointer border-0 bg-transparent" style={{ color: '#ef4444' }} title="Excluir"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Editar Linha' : 'Nova Linha'}>
        <div className="space-y-4">
          <Input label="Ordem" type="number" value={form.ORDEM} onChange={(v) => setForm({...form, ORDEM: v})} />
          <Input label="Nome da Linha" value={form.NOME_LINHA} onChange={(v) => setForm({...form, NOME_LINHA: v})} placeholder="Ex: Receita Bruta" />
          <Select label="Tipo" options={[{value:'CONTA',label:'Conta (prefixo)'},{value:'SUBTOTAL',label:'Subtotal'}]} value={form.TIPO} onChange={(v) => setForm({...form, TIPO: v})} />
          {form.TIPO === 'CONTA' && (
            <Input label="Prefixo da Conta" value={form.PREFIXO_CONTA} onChange={(v) => setForm({...form, PREFIXO_CONTA: v})} placeholder="Ex: 3.1 para todas que começam com 3.1" />
          )}
          <Select label="Sinal" options={[{value:'1',label:'Positivo (+)'},{value:'-1',label:'Negativo (-)'}]} value={form.SINAL} onChange={(v) => setForm({...form, SINAL: v})} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={async () => { if (deleteId) { await removeRecord('DRE_CONFIG', deleteId); setDeleteId(null); refetch(); } }} title="Excluir" message="Deseja excluir?" confirmLabel="Excluir" />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
