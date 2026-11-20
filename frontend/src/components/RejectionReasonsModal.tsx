import { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import Modal from './ui/Modal';

interface Reason { COMENTARIO?: string; AUTOR?: string; CRIADO_EM?: string; }

function formatDate(value?: string): string {
  if (!value) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}${time ? ` ${time.slice(0, 5)}` : ''}`;
}

export default function RejectionReasonsModal({ isOpen, onClose, title, load }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  load: () => Promise<Reason[]>;
}) {
  const [items, setItems] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    load().then(setItems).catch((error) => { console.error('motivos de reprovação:', error); setItems([]); }).finally(() => setLoading(false));
    // The caller may provide an inline loader; reopening is the refresh boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      {loading ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--color-primary)' }} /></div> : items.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum motivo de reprovação registrado.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {items.map((item, index) => (
            <div key={`${item.CRIADO_EM}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="rounded-full p-1.5 shrink-0" style={{ backgroundColor: '#b91c1c1f' }}>
                  <XCircle size={14} style={{ color: '#b91c1c' }} />
                </span>
                {index < items.length - 1 && (
                  <span className="w-px flex-1 my-1" style={{ backgroundColor: 'var(--color-border)' }} />
                )}
              </div>
              <div className="pb-4 min-w-0">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Reprovado</span>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {item.AUTOR ? `por ${item.AUTOR} — ` : ''}{formatDate(item.CRIADO_EM)}
                </p>
                <p className="text-xs mt-1 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-secondary)' }}>
                  {item.COMENTARIO || 'Sem descrição.'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
