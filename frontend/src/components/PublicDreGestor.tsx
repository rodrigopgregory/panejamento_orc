import { useEffect, useMemo, useState } from 'react';
import { executePublicServerFunctionMitra } from 'mitra-interactions-sdk';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { MITRA_CONFIG } from '../mitra-config';

const DRE_SF_ID = 192;
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function block(value: any): any[] {
  if (typeof value === 'string') { try { return JSON.parse(value) || []; } catch { return []; } }
  return Array.isArray(value) ? value : [];
}

function rowsOf(response: any): any[] {
  let output = response?.result?.output ?? response?.output;
  if (typeof output === 'string') { try { output = JSON.parse(output); } catch { return []; } }
  return output?.rows || (Array.isArray(output) ? output : []);
}

function format(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

export default function PublicDreGestor({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showAa, setShowAa] = useState(true);
  const [showOrcado, setShowOrcado] = useState(true);
  const [showAtual, setShowAtual] = useState(false);
  const [showConsolidado, setShowConsolidado] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await executePublicServerFunctionMitra({
          projectId: MITRA_CONFIG.projectId,
          serverFunctionId: DRE_SF_ID,
          input: { token, agora: new Date().toISOString().slice(0, 19) },
        });
        const row = rowsOf(response)[0] || {};
        setData({
          ctx: block(row.CTX)[0] || null,
          config: block(row.CONFIG),
          contas: block(row.CONTAS),
          orcado: block(row.ORCADO),
          aa: block(row.REALIZADO_AA),
          atual: block(row.REALIZADO_ATUAL),
        });
      } catch (error) {
        console.error('DRE publico:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const series = useMemo(() => {
    if (!data?.ctx) return [];
    const toMap = (rows: any[]) => new Map(rows.map((row) => [`${row.CONTA_ID}:${row.MES}`, Number(row.VALOR) || 0]));
    const orcado = toMap(data.orcado);
    const aa = toMap(data.aa);
    const atual = toMap(data.atual);
    const sums = {
      orcado: Array(12).fill(0), aa: Array(12).fill(0), atual: Array(12).fill(0), consolidado: Array(12).fill(0),
    };

    return data.config.map((line: any) => {
      const subtotal = line.IS_SUBTOTAL === true || line.IS_SUBTOTAL === 'true';
      if (subtotal) {
        const item = { label: line.NOME_LINHA, subtotal, orcado: [...sums.orcado], aa: [...sums.aa], atual: [...sums.atual], consolidado: [...sums.consolidado] };
        return { ...item, totals: Object.fromEntries(Object.entries(item).filter(([key]) => ['orcado', 'aa', 'atual', 'consolidado'].includes(key)).map(([key, values]: any) => [key, values.reduce((sum: number, value: number) => sum + value, 0)])) };
      }

      const contas = data.contas.filter((conta: any) => String(conta.CODIGO || '').startsWith(line.PREFIXO_CONTA || ''));
      const sinal = Number(line.SINAL || 1);
      const values = { orcado: [] as number[], aa: [] as number[], atual: [] as number[], consolidado: [] as number[] };
      for (let mes = 1; mes <= 12; mes++) {
        let o = 0; let a = 0; let r = 0; let c = 0;
        contas.forEach((conta: any) => {
          const key = `${conta.ID}:${mes}`;
          const budget = orcado.get(key) || 0;
          o += budget;
          a += aa.get(key) || 0;
          const current = atual.get(key) || 0;
          r += current;
          c += atual.has(key) ? current : budget;
        });
        values.orcado.push(o * sinal); values.aa.push(a * sinal); values.atual.push(r * sinal); values.consolidado.push(c * sinal);
        sums.orcado[mes - 1] += o * sinal; sums.aa[mes - 1] += a * sinal; sums.atual[mes - 1] += r * sinal; sums.consolidado[mes - 1] += c * sinal;
      }
      return { label: line.NOME_LINHA, subtotal, ...values, totals: Object.fromEntries(Object.entries(values).map(([key, row]) => [key, row.reduce((sum, value) => sum + value, 0)])) };
    });
  }, [data]);

  const columns = [
    { key: 'aa', label: 'Realizado A.A.', visible: showAa, set: setShowAa },
    { key: 'orcado', label: 'Orçado', visible: showOrcado, set: setShowOrcado },
    { key: 'atual', label: 'Realizado atual', visible: showAtual, set: setShowAtual },
    { key: 'consolidado', label: 'Orçado + realizado', visible: showConsolidado, set: setShowConsolidado },
  ];
  const visibleColumns = columns.filter((column) => column.visible);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--color-primary)' }} /></div>;
  if (!data?.ctx) return <p className="py-12 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>Não foi possível carregar o DRE deste link.</p>;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-5 animate-fadeIn">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: 20 }}>DRE Consolidado</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>{data.ctx.CICLO_NOME} {data.ctx.ANO}</p>
        </div>
        <div className="relative">
          <button onClick={() => setShowPicker((open) => !open)} className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-lg" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
            <Eye size={14} /> Exibir colunas
          </button>
          {showPicker && <>
            <button className="fixed inset-0 z-10 cursor-default" aria-label="Fechar menu" onClick={() => setShowPicker(false)} />
            <div className="absolute right-0 z-20 mt-1 rounded-lg shadow-lg p-1.5 min-w-[190px]" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {columns.map((column) => (
                <button key={column.key} onClick={() => { if (column.visible && visibleColumns.length === 1) return; column.set(!column.visible); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs" style={{ color: column.visible ? 'var(--color-primary)' : 'var(--color-text-muted)', backgroundColor: column.visible ? 'var(--color-primary-bg)' : 'transparent' }}>
                  {column.visible ? <Eye size={14} /> : <EyeOff size={14} />}{column.label}
                </button>
              ))}
            </div>
          </>}
        </div>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="overflow-x-auto">
          <table className="dre-table w-full">
            <thead style={{ backgroundColor: 'var(--color-surface)' }}>
              <tr>
                <th className="dre-th dre-th-label sticky left-0 z-10" rowSpan={2} style={{ backgroundColor: 'var(--color-surface)' }}>Conta / Linha</th>
                {MONTHS.map((month) => <th key={month} colSpan={visibleColumns.length} className="dre-th dre-th-month">{month}</th>)}
                <th colSpan={visibleColumns.length} className="dre-th dre-th-total">Total</th>
              </tr>
              <tr>{MONTHS.flatMap((month) => visibleColumns.map((column) => <th key={`${month}-${column.key}`} className="dre-th-sub">{column.label}</th>))}{visibleColumns.map((column) => <th key={`total-${column.key}`} className="dre-th-sub">{column.label}</th>)}</tr>
            </thead>
            <tbody>{series.map((line: any) => <tr key={line.label} className={line.subtotal ? 'dre-row dre-row-sub' : 'dre-row'}>
              <td className={`dre-label sticky left-0 z-10 ${line.subtotal ? 'dre-sub' : ''}`} style={{ backgroundColor: line.subtotal ? 'var(--dre-sub-bg)' : 'var(--color-surface)' }}>{line.label}</td>
              {MONTHS.flatMap((_, index) => visibleColumns.map((column) => <td key={`${index}-${column.key}`} className={`dre-cell ${line.subtotal ? 'dre-sub' : ''}`}><div className="dre-val">{format(line[column.key][index])}</div></td>))}
              {visibleColumns.map((column) => <td key={`total-${column.key}`} className={`dre-cell dre-total ${line.subtotal ? 'dre-sub' : ''}`}><div className="dre-val">{format(line.totals[column.key])}</div></td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
