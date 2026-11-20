// Protege a aritmetica das visoes graficas do "Resumo do realizado".
// Os graficos (SVG) nao renderizam em jsdom porque o ResponsiveContainer mede
// zero, entao os asserts miram o DOM textual que carrega os mesmos numeros:
// a legenda da composicao de despesas e o total do resultado acumulado.
// A regra de classificacao (receita x despesa) e a MESMA usada pelos KPIs da
// tela — se ela mudar de um lado so, cards e graficos passam a divergir.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ResumoRealizadoDashboard from '../ResumoRealizadoDashboard';
import { isReceitaTipo, isDespesaTipo } from '../../lib/realizado-tipos';

afterEach(cleanup);

interface AggRow {
  EMPRESA_ID: number; EMPRESA_NOME: string;
  CONTA_ID: number; CONTA_CODIGO: string; CONTA_NOME: string; CONTA_TIPO: string;
  CR_ID: number; CR_CODIGO: string; CR_NOME: string;
  MES: number; VALOR: number;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const LABELS = {
  RECEITA: 'Receita',
  CMV: 'CMV',
  DESPESA_PESSOAL: 'Despesa Pessoal',
  RESULTADO_FINANCEIRO: 'Resultado Financeiro',
};

function row(over: Partial<AggRow>): AggRow {
  return {
    EMPRESA_ID: 1, EMPRESA_NOME: 'Empresa Alpha',
    CONTA_ID: 1, CONTA_CODIGO: '3.01', CONTA_NOME: 'Vendas', CONTA_TIPO: 'RECEITA',
    CR_ID: 1, CR_CODIGO: 'CR1', CR_NOME: 'Comercial',
    MES: 1, VALOR: 0,
    ...over,
  };
}

// Jan: receita 1.000.000 / CMV 300.000 / pessoal 200.000  -> resultado  500.000
// Fev: receita   400.000 / CMV 300.000 / pessoal 200.000  -> resultado -100.000
// Acumulado no fim de Fev = 400.000. Meses seguintes ficam sem movimento.
const AGG = [
  row({ MES: 1, VALOR: 1_000_000 }),
  row({ MES: 1, VALOR: 300_000, CONTA_ID: 2, CONTA_CODIGO: '4.01', CONTA_NOME: 'Mercadorias', CONTA_TIPO: 'CMV' }),
  row({ MES: 1, VALOR: 200_000, CONTA_ID: 3, CONTA_CODIGO: '4.02', CONTA_NOME: 'Salarios', CONTA_TIPO: 'DESPESA_PESSOAL' }),
  row({ MES: 2, VALOR: 400_000 }),
  row({ MES: 2, VALOR: 300_000, CONTA_ID: 2, CONTA_CODIGO: '4.01', CONTA_NOME: 'Mercadorias', CONTA_TIPO: 'CMV' }),
  row({ MES: 2, VALOR: 200_000, CONTA_ID: 3, CONTA_CODIGO: '4.02', CONTA_NOME: 'Salarios', CONTA_TIPO: 'DESPESA_PESSOAL' }),
];

function renderDash(rows: AggRow[] = AGG) {
  return render(
    <ResumoRealizadoDashboard
      aggRows={rows}
      monthsShort={MONTHS}
      fiscalMonthNumbers={MESES}
      tipoLabels={LABELS}
    />,
  );
}

describe('classificacao de tipos (compartilhada com os KPIs)', () => {
  it('trata apenas RECEITA como receita', () => {
    expect(isReceitaTipo('RECEITA')).toBe(true);
    expect(isReceitaTipo('CMV')).toBe(false);
  });

  it('exclui RECEITA e RESULTADO_FINANCEIRO do bloco de despesas', () => {
    expect(isDespesaTipo('CMV')).toBe(true);
    expect(isDespesaTipo('DESPESA_PESSOAL')).toBe(true);
    expect(isDespesaTipo('RECEITA')).toBe(false);
    expect(isDespesaTipo('RESULTADO_FINANCEIRO')).toBe(false);
  });
});

describe('ResumoRealizadoDashboard', () => {
  it('acumula o resultado do ano somando os meses', () => {
    renderDash();
    // (1.000.000 - 500.000) + (400.000 - 500.000) = 400.000
    expect(screen.getByText('R$ 400.000')).toBeTruthy();
  });

  it('quebra a composicao das despesas por tipo com participacao', () => {
    renderDash();
    // CMV 600.000 e pessoal 400.000 sobre 1.000.000 de despesa total
    expect(screen.getByText('CMV')).toBeTruthy();
    expect(screen.getByText('600 mil')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('Despesa Pessoal')).toBeTruthy();
    expect(screen.getByText('400 mil')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('mantem RESULTADO_FINANCEIRO fora da composicao de despesas', () => {
    renderDash([...AGG, row({ MES: 1, VALOR: 900_000, CONTA_ID: 9, CONTA_TIPO: 'RESULTADO_FINANCEIRO', CONTA_NOME: 'Juros' })]);
    expect(screen.queryByText('Resultado Financeiro')).toBeNull();
    // acumulado segue 400.000: a linha financeira nao entra em receita nem despesa
    expect(screen.getByText('R$ 400.000')).toBeTruthy();
  });

  it('oferece a visao por empresa apenas quando ha mais de uma no filtro', () => {
    renderDash();
    expect(screen.getByText('Resultado por centro de resultado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Empresa' })).toBeNull();

    cleanup();
    renderDash([...AGG, row({ MES: 1, VALOR: 50_000, EMPRESA_ID: 2, EMPRESA_NOME: 'Empresa Beta' })]);
    expect(screen.getByRole('button', { name: 'Empresa' })).toBeTruthy();
  });

  it('avisa quando o periodo nao tem movimento', () => {
    renderDash([]);
    expect(screen.getAllByText('Sem movimento no período').length).toBeGreaterThan(0);
  });
});
