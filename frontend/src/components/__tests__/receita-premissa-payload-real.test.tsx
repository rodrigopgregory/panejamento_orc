// A linha de PREMISSA depende de um campo que a SF precisa devolver.
//
// POR QUE ESTE TESTE USA PAYLOAD DE PRODUCAO, E NAO UMA FIXTURE ESCRITA A MAO
//
// A alíquota ficou zerada na grade de preenchimento por semanas. Havia teste
// cobrindo a cadeia inteira — premissa do ciclo -> linha PREMISSA -> fórmula ->
// valor na grade — e ele passava. Passava porque a fixture era escrita à mão e
// incluía `PREMISSA_NOME` em cada linha do modelo. A SF que alimenta a tela
// (124, e a 142 do link do gestor) NAO devolvia essa coluna. O teste validava a
// suposição de quem o escreveu, não o que o backend entrega.
//
// Sem `PREMISSA_NOME`, valorPremissa procura a chave "_6", não acha e devolve 0.
// A linha da alíquota aparece zerada, `[P1]` vale zero e o imposto some da grade
// sem erro nenhum — o sintoma é indistinguível de "ninguém cadastrou a alíquota".
//
// Por isso as fixtures aqui são o retorno LITERAL das SFs 124 e 125 para o CR007
// (regeneradas por backend/diag-cr007-receita.mjs + o script de fetch). Se um
// campo sumir do payload, este teste cai; nenhuma fixture escrita à mão pega isso.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (n: string) => JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${n}.json`, 'utf8'));
const F124 = fx('prod-cr007-sf124');
const F125 = fx('prod-cr007-sf125');

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => (id === 124 ? [F124] : id === 125 ? [F125] : []);
  return {
    execSF: vi.fn(byId), execSFCached: vi.fn(byId), querySQL: vi.fn(async () => []), jsonField,
    SF_IDS: new Proxy({ hotOrcBase: 124, hotOrcDetalheCr: 125 } as Record<string, number>, { get: (t, k: string) => (k in t ? t[k] : 0) }),
    MONTHS: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
    getPublicOrcToken: () => null, publicOrcWrite: vi.fn(async () => ({})),
    queuePublicOrcCell: vi.fn(), queuePublicFormulaCell: vi.fn(), flushPublicOrcQueue: vi.fn(async () => {}),
    avaliarWorkflow: vi.fn(async () => ({ ok: true })), avaliarErroMsg: () => '', invalidateSFCache: vi.fn(),
  };
});
vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: vi.fn(), patchRecordMitra: vi.fn(async () => ({})), createRecordMitra: vi.fn(async () => ({ ID: 1 })),
  deleteRecordMitra: vi.fn(async () => ({})), createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })), setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 }, sessaoRealAtiva: () => true }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Teste', PERFIL: 'admin' }) }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => <div data-testid="hottable" data-dados={JSON.stringify(props.data)} />,
}));

import OrcamentoContent from '../OrcamentoContent';

// Junho: primeiro mes aberto do ciclo 133 (ULTIMO_MES_REALIZADO = 5).
const JUN = 6;
const ISS = 'Alíquota ISS sobre Serviços';
const PIS = 'Alíquota PIS/COFINS';

const gradeReceita = async () => {
  render(<OrcamentoContent gestorId={4} selectedCR={7} selectedPackage={null} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Receita\d*%?$/ }, { timeout: 8000 }));
  let dados: any[][] = [];
  await waitFor(() => {
    for (const el of screen.getAllByTestId('hottable')) {
      const d = JSON.parse(el.getAttribute('data-dados') || '[]');
      if (d.some((l: any[]) => String(l?.[0] ?? '').startsWith('3.2.01'))) { dados = d; return; }
    }
    throw new Error('grade da receita ainda nao montada');
  }, { timeout: 8000 });
  return dados;
};
const linha = (d: any[][], rotulo: string) => d.find((l) => String(l[0] ?? '').startsWith(rotulo));

describe('contrato do payload: o modelo precisa chegar com PREMISSA_NOME', () => {
  it('a SF de base devolve o nome da premissa em cada linha do tipo PREMISSA', () => {
    const linhasPremissa = JSON.parse(F124.FORMULAS).filter((f: any) => f.TIPO === 'PREMISSA');
    expect(linhasPremissa.length).toBeGreaterThan(0);
    for (const l of linhasPremissa) {
      // O vinculo com a premissa geral e por NOME — sem ele a linha resolve zero.
      expect(String(l.PREMISSA_NOME || '')).not.toBe('');
    }
  });
});

describe('grade de Receita do CR007, com o payload real', () => {
  it('mostra o percentual da aliquota, e nao zero', async () => {
    const d = await gradeReceita();
    expect(linha(d, ISS)![JUN]).toBe(5);
    expect(linha(d, PIS)![JUN]).toBe(10);
  });

  it('mostra o imposto calculado na propria grade, sem depender do DRE', async () => {
    const d = await gradeReceita();
    // Base de junho = 3.1.02 + 3.1.01 + 3.1.04 = 160174 + 0 + 174698 = 334872.
    const base = linha(d, '3.1.02')![JUN] + linha(d, '3.1.01')![JUN] + linha(d, '3.1.04')![JUN];
    expect(base).toBe(334872);
    expect(linha(d, '3.2.01')![JUN]).toBe(Math.round(base * 5 / 100));
    expect(linha(d, '3.2.02')![JUN]).toBe(Math.round(base * 10 / 100));
  });

  it('o imposto entra no total da coluna', async () => {
    const d = await gradeReceita();
    const soma = d.slice(0, -1).reduce((s, l) => s + (typeof l[JUN] === 'number' ? l[JUN] : 0), 0);
    // O total soma as contas; as linhas de apoio (ticket, volume, aliquota) nao entram.
    expect(linha(d, 'Total')![JUN]).toBe(
      linha(d, '3.1.02')![JUN] + linha(d, '3.1.01')![JUN] + linha(d, '3.1.04')![JUN] +
      linha(d, '3.2.01')![JUN] + linha(d, '3.2.02')![JUN]
    );
    expect(soma).toBeGreaterThan(0);
  });
});
