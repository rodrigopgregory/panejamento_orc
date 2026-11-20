import { useState, useEffect, useMemo } from 'react';
import { useSF } from '../hooks/useMitraData';

function jsonField(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}
import Select from '../components/ui/Select';
import PremissasGerais from '../components/PremissasGerais';
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { CalendarDays } from 'lucide-react';

export default function PremissasPage() {
  // 1 ida ao servidor (SF 122): ciclos + contas juntos (cacheado).
  const { data: baseRows, loading: loadingBase } = useSF(122, {}, true);
  const base = baseRows?.[0] || {};
  // Todas as versoes, mais recentes primeiro — fechadas ficam disponiveis para
  // AUDITORIA (consulta), mas a edicao e travada quando a selecionada e FECHADA
  const ciclos = useMemo(
    () => jsonField(base.CICLOS).sort((a: any, b: any) => (Number(b.ANO) - Number(a.ANO)) || (Number(b.ID) - Number(a.ID))),
    [base.CICLOS]
  );
  // Da SF 122 esta tela usa so os ciclos: as contas contabeis eram do seletor
  // de conta da tabela de aliquotas, que saiu daqui.
  const { toasts, addToast, removeToast } = useToast();

  const [selectedCiclo, setSelectedCiclo] = useState<number | null>(null);


  useEffect(() => {
    if (ciclos.length > 0 && !selectedCiclo) {
      // Fluxo: primeiro configura premissas na versao em configuracao
      // (ABERTO/PENDENTE), depois inicia — por isso ela tem prioridade;
      // sem versao em configuracao, cai na INICIADA (disparada)
      const emConfiguracao = ciclos.find((c: any) => c.STATUS === 'ABERTO' || c.STATUS === 'PENDENTE');
      const iniciada = ciclos.find((c: any) => c.STATUS === 'INICIADA');
      setSelectedCiclo(emConfiguracao?.ID || iniciada?.ID || ciclos[0].ID);
    }
  }, [ciclos, selectedCiclo]);

  // Versao fechada = consulta para auditoria; nenhuma edicao permitida
  const versaoFechada = () =>
    ciclos.find((c: any) => c.ID === selectedCiclo)?.STATUS === 'FECHADO';

  // A tabela de aliquotas por conta (PREMISSA_IMPOSTO) saiu desta tela.
  //
  // Ela alimentava um calculo que rodava por fora do modelo. Esse calculo nao
  // existe mais: a aliquota virou premissa (a tabela abaixo) e a regra do
  // imposto virou formula na linha do modelo de Receita. A tabela do banco
  // continua intacta para as versoes ja fechadas — o que saiu foi a tela.

  const cicloOptions = ciclos.map((c: any) => ({
    value: String(c.ID),
    label: c.STATUS === 'FECHADO' ? `${c.NOME} (Fechada)` : c.NOME,
  }));
  const isFechada = versaoFechada();

  // A tabela de premissas carrega os proprios dados e mostra o proprio
  // skeleton; aqui so se espera a lista de versoes (SF 122), que e quem define
  // qual versao sera aberta.
  const carregando = loadingBase;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Premissas Gerais</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Valores gravados por versão. As premissas cadastradas aqui são consumidas pelas linhas do tipo Premissa nos modelos.
        </p>
      </div>

      {/* Card de seleção de versão */}
      {carregando ? (
        <SkeletonCard className="px-5 py-4 flex items-center gap-4" style={{ height: 74 }}>
          <Skeleton className="shrink-0 w-10 h-10" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="shrink-0 h-9 w-[220px]" />
        </SkeletonCard>
      ) : (
      <div
        className="rounded-xl border px-5 py-4 flex items-center gap-4"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}
        >
          <CalendarDays size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Versão orçamentária</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {isFechada ? 'Versão fechada — consulta para auditoria, sem edição' : 'Escolha a versão que deseja editar'}
          </div>
        </div>
        {isFechada && (
          <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--color-text-secondary)' }}>
            Somente leitura
          </span>
        )}
        <div className="shrink-0 min-w-[220px]">
          <Select
            value={selectedCiclo ? String(selectedCiclo) : ''}
            options={cicloOptions}
            onChange={(v) => setSelectedCiclo(Number(v))}
            placeholder="Selecione a versão"
          />
        </div>
      </div>
      )}

      {/* Premissas livres — sem vinculo com conta contabil, consumidas pelas
          linhas de modelo do tipo Premissa */}
      {!carregando && (
        <PremissasGerais cicloId={selectedCiclo} somenteLeitura={isFechada} onToast={addToast} />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
