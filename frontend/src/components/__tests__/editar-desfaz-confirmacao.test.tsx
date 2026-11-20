// Editar um modelo confirmado devolve ele para "nao confirmado".
//
// O buraco que isso fecha: conta calculada so vira numero em ORCAMENTO no
// confirmar. Confirmar -> editar -> nao reconfirmar deixava a grade com um
// numero e o DRE com outro, sem nada denunciar. Agora editar tira a confirmacao,
// o CR sai dos 100% e o workflow trava a submissao ate reconfirmar.
//
// O ultimo teste guarda a ponta perigosa: a materializacao do confirmar grava
// pelo MESMO saveBudgetCell que o gestor usa ao digitar, entao o confirmar tem de
// terminar CONFIRMADO e continuar assim. Ele verifica o resultado, nao o
// mecanismo — hoje quem impede o autodesfazer e a ordem dentro de
// aplicarConfirmacaoDriver (materializa antes de marcar confirmado), com a trava
// de materializandoRef como reforco explicito. Se alguem mexer nessa ordem OU na
// trava a ponto de o ciclo se morder, este teste cai.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (n: string) => JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${n}.json`, 'utf8'));
const F124 = fx('prod-cr007-sf124');
const F125_BASE = fx('prod-cr007-sf125');

// O CR007 real esta SUBMETIDO (tela em leitura, sem edicao possivel). Aqui ele
// entra como PENDENTE com a Receita ja confirmada — o estado em que o buraco
// aparecia.
const F125 = {
  ...F125_BASE,
  STATUS: JSON.stringify([{ ID: 1089, CICLO_ID: 133, CR_ID: 7, GESTOR_ID: 4, STATUS: 'PENDENTE', COMENTARIO: '', DRIVERS_CONFIRMADOS: 'RECEITA', TOTAL_MODELOS: 4 }]),
};

const { patches } = vi.hoisted(() => ({ patches: [] as any[] }));

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
  configureSdkMitra: vi.fn(),
  patchRecordMitra: vi.fn(async (a: any) => { patches.push(a); return {}; }),
  createRecordMitra: vi.fn(async () => ({ ID: 1 })), deleteRecordMitra: vi.fn(async () => ({})),
  createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })), setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 }, sessaoRealAtiva: () => true }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Teste', PERFIL: 'admin' }) }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));

// O grid guarda o afterChange para o teste poder simular a digitacao do gestor.
const { hot } = vi.hoisted(() => ({ hot: { aoAlterar: null as any, dados: null as any } }));
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => {
    if ((props.data || []).some((l: any[]) => String(l?.[0] ?? '').startsWith('3.2.01'))) {
      hot.aoAlterar = props.afterChange; hot.dados = props.data;
    }
    return <div data-testid="hottable" data-dados={JSON.stringify(props.data)} />;
  },
}));

import OrcamentoContent from '../OrcamentoContent';

const JUN = 6;
const LINHA_SERVICOS = 3; // 3.1.01 Receita de Servicos, linha de INPUT do modelo

const abrirReceita = async () => {
  patches.length = 0;
  hot.aoAlterar = null;
  render(<OrcamentoContent gestorId={4} selectedCR={7} selectedPackage={null} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Receita\d*%?$/ }, { timeout: 8000 }));
  await waitFor(() => { if (!hot.aoAlterar) throw new Error('grade nao montada'); }, { timeout: 8000 });
};

const digitarEmServicos = (valor: number) => {
  const antes = hot.dados[LINHA_SERVICOS][JUN];
  hot.dados[LINHA_SERVICOS][JUN] = valor;
  hot.aoAlterar([[LINHA_SERVICOS, JUN, antes, valor]], 'edit', hot.dados);
};

const patchesDeStatus = () => patches.filter((p) => p.tableName === 'ORCAMENTO_STATUS');

describe('editar um modelo confirmado desfaz a confirmacao', () => {
  it('parte de Receita confirmada', async () => {
    await abrirReceita();
    expect(await screen.findByText(/Receita confirmado/)).toBeTruthy();
  });

  it('digitar tira a confirmacao e devolve o CR para pendente', async () => {
    await abrirReceita();
    digitarEmServicos(50000);

    // O modelo volta a oferecer o botao de confirmar.
    expect(await screen.findByRole('button', { name: /Confirmar Receita/ }, { timeout: 5000 })).toBeTruthy();

    await waitFor(() => {
      const st = patchesDeStatus();
      expect(st.length).toBeGreaterThan(0);
      // RECEITA sai do CSV de confirmados.
      expect(String(st[0].data.DRIVERS_CONFIRMADOS)).not.toContain('RECEITA');
    }, { timeout: 5000 });
  });

  it('avisa por que a confirmacao caiu, em vez de sumir calado', async () => {
    await abrirReceita();
    digitarEmServicos(50000);
    expect(await screen.findByText(/voltou a pendente/i, {}, { timeout: 5000 })).toBeTruthy();
  });

  it('um drag-fill de varias celulas desconfirma UMA vez so', async () => {
    await abrirReceita();
    const linhas = [6, 7, 8, 9, 10, 11, 12].map((mes) => {
      const antes = hot.dados[LINHA_SERVICOS][mes];
      hot.dados[LINHA_SERVICOS][mes] = 4000;
      return [LINHA_SERVICOS, mes, antes, 4000];
    });
    hot.aoAlterar(linhas, 'edit', hot.dados);

    await waitFor(() => { expect(patchesDeStatus().length).toBeGreaterThan(0); }, { timeout: 5000 });
    // 7 celulas editadas, mas o status e escrito uma vez.
    expect(patchesDeStatus().length).toBe(1);
  });

  // A PROJECAO EM MASSA e mais dura que o drag-fill.
  //
  // O drag-fill entrega as celulas numa chamada so, entao as gravacoes saem em
  // rajada e a primeira desconfirmacao ainda esta no ar quando a ultima chega. Ja
  // a projecao historica grava um mes por vez, com await entre eles: a primeira
  // desconfirmacao TERMINA antes de a segunda celula ser escrita.
  //
  // Enquanto a trava era "tem uma desconfirmacao em voo?", ela abria justo nesse
  // intervalo, e o modelo se desconfirmava de novo a cada mes — doze avisos
  // identicos por uma acao. A trava agora e o confirmedDriversRef, que ja saiu do
  // conjunto na primeira celula e nao volta.
  it('uma projecao de varios meses, gravados um a um, desconfirma UMA vez so', async () => {
    await abrirReceita();

    for (const mes of [6, 7, 8, 9, 10, 11, 12]) {
      const antes = hot.dados[LINHA_SERVICOS][mes];
      hot.dados[LINHA_SERVICOS][mes] = 4000;
      hot.aoAlterar([[LINHA_SERVICOS, mes, antes, 4000]], 'edit', hot.dados);
      // Deixa a gravacao anterior fechar por completo antes do proximo mes —
      // e exatamente isso que o await do laco de applyHistorico faz.
      await new Promise((r) => setTimeout(r, 60));
    }

    await waitFor(() => { expect(patchesDeStatus().length).toBeGreaterThan(0); }, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(patchesDeStatus().length).toBe(1);
    expect(screen.getAllByText(/voltou a pendente/i).length).toBe(1);
  });
});

describe('confirmar nao pode se autodesfazer', () => {
  it('a gravacao das contas calculadas nao dispara a desconfirmacao', async () => {
    await abrirReceita();
    // Sai do estado confirmado para poder confirmar de novo.
    digitarEmServicos(50000);
    const btn = await screen.findByRole('button', { name: /Confirmar Receita/ }, { timeout: 5000 });
    patches.length = 0;
    fireEvent.click(btn);

    // Ao fim da materializacao o modelo tem de ficar confirmado — e assim seguir.
    expect(await screen.findByText(/Receita confirmado/, {}, { timeout: 8000 })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('button', { name: /Confirmar Receita/ })).toBeNull();

    // E o CSV gravado no fim tem de conter RECEITA, nao o contrario.
    const st = patchesDeStatus();
    expect(st.length).toBeGreaterThan(0);
    expect(String(st[st.length - 1].data.DRIVERS_CONFIRMADOS)).toContain('RECEITA');
  });
});
