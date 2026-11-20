// Premissas gerais LIVRES — nome proprio, sem conta contabil.
//
// A premissa e um valor nomeado da versao: "Inflacao", "Cambio", "Meta de
// crescimento". Ela existe para ser consumida pelas formulas dos modelos, via
// linha do tipo Premissa.
//
// O valor e mensal porque premissa de orcamento raramente e constante o ano
// inteiro (dissidio entra em maio, cambio se projeta curva). Quem quiser um
// numero unico preenche janeiro e usa "repetir para o ano".
//
// A tabela segue o padrao de Premissas Folha: barra de acoes ACIMA do cartao
// (busca a esquerda, botao a direita), SkeletonTable no carregamento, cabecalho
// ordenavel, edicao inline discreta (CelulaEditavel) e linha de vazio dentro do
// proprio corpo da tabela. Nada de caixa de input visivel em repouso — em
// repouso isto e uma tabela, nao um formulario.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { execSF, createRecord, updateRecord, SF_IDS } from '../hooks/useMitraData';
import { useOrdenacaoTabela } from '../hooks/useOrdenacaoTabela';
import CabecalhoOrdenavel from './ui/CabecalhoOrdenavel';
import { NumeroEditavel, TextoEditavel } from './ui/CelulaEditavel';
import { SkeletonTable } from './ui/Skeleton';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import { Plus, Trash2, ArrowRight, Search } from 'lucide-react';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// So o nome ordena: ordenar por um mes especifico entre doze colunas nao e uma
// pergunta que alguem faz de uma tabela de premissas.
const COLUNAS_PREMISSAS = [
  { key: 'nome', dirInicial: 'asc' as const, valor: (l: Record<string, unknown>) => String(l.NOME ?? '') },
];

function jsonField(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}

export default function PremissasGerais({
  cicloId, somenteLeitura, onToast,
}: {
  cicloId: number | null;
  somenteLeitura: boolean;
  onToast: (tipo: 'success' | 'error', msg: string) => void;
}) {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [valores, setValores] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState<any>(null);
  const [busca, setBusca] = useState('');

  const ord = useOrdenacaoTabela(COLUNAS_PREMISSAS);

  const carregar = useCallback(async () => {
    // Sem versao nao ha o que buscar — mas o skeleton PRECISA sair mesmo assim.
    // Saindo aqui sem baixar a bandeira, a tabela ficava carregando para sempre
    // num projeto sem nenhuma versao criada.
    if (!cicloId) { setLinhas([]); setValores([]); setCarregando(false); return; }
    try {
      const rows = await execSF(SF_IDS.hotPremissasGeraisPorCiclo, { cicloId });
      const row = rows?.[0] || {};
      setLinhas(jsonField(row.LINHAS).sort((a: any, b: any) => (Number(a.ORDEM) - Number(b.ORDEM)) || (Number(a.ID) - Number(b.ID))));
      setValores(jsonField(row.VALORES));
    } catch (e) { console.error('Erro ao carregar premissas gerais:', e); }
    setCarregando(false);
  }, [cicloId]);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);

  const valorDe = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of valores) m.set(`${v.LINHA_ID}_${v.MES}`, Number(v.VALOR) || 0);
    return (linhaId: number, mes: number) => m.get(`${linhaId}_${mes}`) ?? 0;
  }, [valores]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase('pt-BR');
    if (!t) return linhas;
    return linhas.filter((l: any) => String(l.NOME || '').toLocaleLowerCase('pt-BR').includes(t));
  }, [linhas, busca]);

  const adicionar = async () => {
    if (!cicloId || somenteLeitura) return;
    setSalvando(true);
    try {
      await createRecord('PREMISSA_LINHA', {
        CICLO_ID: cicloId, NOME: 'Nova premissa',
        ORDEM: linhas.length, CRIADO_EM: new Date().toISOString().slice(0, 19),
      });
      await carregar();
      onToast('success', 'Premissa adicionada');
    } catch { onToast('error', 'Erro ao adicionar premissa'); }
    setSalvando(false);
  };

  const renomear = async (linha: any, nome: string) => {
    // O vinculo com a linha do modelo e por NOME: renomear aqui desliga a linha
    // que apontava para o nome antigo. Por isso o aviso, e nao um bloqueio —
    // renomear tem de continuar possivel enquanto ninguem usa a premissa ainda.
    await updateRecord('PREMISSA_LINHA', linha.ID, { NOME: nome });
    await carregar();
    onToast('success', 'Premissa renomeada — confira os modelos que a utilizam');
  };

  const salvarValor = async (linhaId: number, mes: number, valor: number) => {
    if (somenteLeitura) return;
    await execSF(SF_IDS.upsertPremissaValor, { linhaId, mes, valor });
    await carregar();
  };

  // Preenche o ano inteiro com o valor de janeiro — premissa constante e o caso
  // mais comum e digitar 12 vezes o mesmo numero seria hostil.
  const repetirAno = async (linha: any) => {
    if (somenteLeitura) return;
    const base = valorDe(linha.ID, 1);
    setSalvando(true);
    try {
      for (let mes = 2; mes <= 12; mes++) {
        await execSF(SF_IDS.upsertPremissaValor, { linhaId: linha.ID, mes, valor: base });
      }
      await carregar();
      onToast('success', 'Valor de janeiro repetido para o ano');
    } catch { onToast('error', 'Erro ao repetir valor'); }
    setSalvando(false);
  };

  const excluir = async () => {
    const alvo = excluindo;
    setExcluindo(null);
    if (!alvo) return;
    try {
      await execSF(SF_IDS.excluirPremissaGeral, { linhaId: alvo.ID });
      await carregar();
      onToast('success', 'Premissa removida');
    } catch { onToast('error', 'Erro ao remover premissa'); }
  };

  const thCls = 'text-left px-6 py-3 uppercase tracking-wide font-medium';
  const thClsMes = 'text-right px-3 py-3 uppercase tracking-wide font-medium';
  const thClsAction = 'text-center px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap';

  return (
    <>
      <div className="flex gap-3 flex-wrap items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:border-transparent transition-all duration-200"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
              placeholder="Buscar premissa..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>
        {!somenteLeitura && (
          <span className="flex items-center gap-2">
            <Button onClick={adicionar} disabled={salvando}><Plus size={16} className="mr-1" /> Nova Premissa</Button>
          </span>
        )}
      </div>

      {carregando ? <SkeletonTable columns={6} rows={5} /> : (
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            <CabecalhoOrdenavel campo="nome" rotulo="Premissa" ordem={ord.ordem} onOrdenar={ord.alternarOrdem} className={thCls} style={{ minWidth: 200 }} />
            {MESES.map((m) => (
              <th key={m} className={thClsMes} style={{ minWidth: 78 }}>{m}</th>
            ))}
            <th className={thClsAction} style={{ width: '1%' }}>Ações</th>
          </tr></thead>
          <tbody>
            {ord.ordenar(filtradas).map((linha: any) => (
              <tr key={linha.ID} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="py-2 px-5">
                  <TextoEditavel
                    valor={String(linha.NOME || '')}
                    disabled={somenteLeitura}
                    rotulo="Nome da premissa"
                    onSalvar={(v) => renomear(linha, v)}
                  />
                </td>
                {MESES.map((_, i) => (
                  <td key={i} className="py-2 px-1">
                    <NumeroEditavel
                      valor={valorDe(linha.ID, i + 1)}
                      disabled={somenteLeitura || salvando}
                      rotulo={`${linha.NOME} em ${MESES[i]}`}
                      onSalvar={(v) => salvarValor(linha.ID, i + 1, v)}
                    />
                  </td>
                ))}
                <td className="px-3 py-2" style={{ width: '1%' }}>
                  {!somenteLeitura && (
                    <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                      <button onClick={() => repetirAno(linha)} disabled={salvando}
                        className="p-1.5 rounded cursor-pointer border-0 bg-transparent disabled:opacity-50"
                        style={{ color: 'var(--color-text-secondary)' }}
                        title="Repetir o valor de janeiro para o ano inteiro"><ArrowRight size={16} /></button>
                      <button onClick={() => setExcluindo(linha)}
                        className="p-1.5 rounded cursor-pointer border-0 bg-transparent"
                        style={{ color: '#ef4444' }}
                        title="Excluir"><Trash2 size={16} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={14} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Nenhuma premissa cadastrada
              </td></tr>
            )}
          </tbody>
        </table></div>
      </div>
      )}

      <ConfirmDialog
        isOpen={!!excluindo}
        onClose={() => setExcluindo(null)}
        onConfirm={excluir}
        title="Remover premissa"
        message={`Remover "${excluindo?.NOME || ''}" e todos os seus valores mensais. As linhas de modelo que usam esta premissa passam a valer zero. Deseja continuar?`}
        confirmLabel="Remover"
      />
    </>
  );
}
