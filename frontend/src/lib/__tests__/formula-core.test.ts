import { describe, it, expect } from 'vitest';
import { avaliarFormula, formulaValida, tokensDaFormula, problemasDaFormula } from '../formula-core';

// Resolvers de mentira, so para o nucleo: {conta} e [linha] viram numeros.
const conta = (mapa: Record<string, number>) => (c: string) => mapa[c] ?? 0;
const linha = (mapa: Record<string, number>) => (l: string) => mapa[l];

describe('avaliarFormula', () => {
  it('resolve conta e linha na mesma expressao', () => {
    const v = avaliarFormula('{3.1.01} * [L2] / 100',
      conta({ '3.1.01': 200000 }), linha({ L2: 5 }));
    expect(v).toBe(10000);
  });

  it('multiplica duas linhas (o caso volume x ticket)', () => {
    expect(avaliarFormula('[L2]*[L1]', conta({}), linha({ L1: 11, L2: 9422 }))).toBe(103642);
  });

  it('cita a mesma linha duas vezes sem se perder', () => {
    expect(avaliarFormula('[L1] + [L1]', conta({}), linha({ L1: 7 }))).toBe(14);
  });

  it('conta ausente vale zero', () => {
    expect(avaliarFormula('{9.9.99} + 5', conta({}), linha({}))).toBe(5);
  });

  it('formula vazia vale zero', () => {
    expect(avaliarFormula('', conta({}), linha({}))).toBe(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Armadilhas conhecidas. Estes testes NAO descrevem o comportamento desejado —
// descrevem o comportamento ATUAL, medido. Existem para que a auditoria possa
// afirmar "o sistema faz isto" com prova, e para que o dia em que alguem
// corrigir, o teste quebre e a correcao seja consciente.
// ─────────────────────────────────────────────────────────────────────────────
describe('avaliarFormula — armadilhas atuais (comportamento medido, nao desejado)', () => {
  it('nome solto e apagado em silencio e a formula vira zero', () => {
    // "{3.1.01} * INFLACAO" -> "200000 * " -> nao compila -> 0
    expect(avaliarFormula('{3.1.01} * INFLACAO', conta({ '3.1.01': 200000 }), linha({}))).toBe(0);
  });

  it('% e o modulo do JavaScript, nao porcento', () => {
    // Quem escreve "{a} * 5%" espera 5 por cento; recebe o resto da divisao.
    expect(avaliarFormula('{a} * 5', conta({ a: 100 }), linha({}))).toBe(500);
    expect(avaliarFormula('{a} % 30', conta({ a: 100 }), linha({}))).toBe(10);
  });

  it('virgula nao e separador decimal', () => {
    // "1,05" no JavaScript e o operador virgula: avalia 1, descarta, devolve 05.
    expect(avaliarFormula('1,05', conta({}), linha({}))).toBe(5);
    expect(avaliarFormula('1.05', conta({}), linha({}))).toBe(1.05);
  });

  it('linha inexistente vale zero — a formula nao acusa a referencia orfa', () => {
    expect(avaliarFormula('[L9] * 1000', conta({}), linha({}))).toBe(0);
  });

  it('divisao por zero devolve Infinity, nao zero', () => {
    // O guarda "|| 0" no fim do avaliador so pega NaN e 0 — Infinity passa.
    // Numa conta calculada isso vira valor gravado no ORCAMENTO. A auditoria
    // procura por isto explicitamente.
    expect(avaliarFormula('{a} / 0', conta({ a: 10 }), linha({}))).toBe(Infinity);
    expect(Number.isFinite(avaliarFormula('{a} / [L1]', conta({ a: 10 }), linha({ L1: 0 })))).toBe(false);
  });

  it('0/0 vira NaN e o guarda o converte em zero', () => {
    expect(avaliarFormula('{a} / 0', conta({ a: 0 }), linha({}))).toBe(0);
  });
});

describe('formulaValida', () => {
  it('aceita formula que compila', () => {
    expect(formulaValida('{3.1.01} * [L2] / 100')).toBe(true);
  });

  it('recusa formula incompleta', () => {
    expect(formulaValida('2222 *')).toBe(false);
  });

  it('recusa vazia', () => {
    expect(formulaValida('')).toBe(false);
    expect(formulaValida('   ')).toBe(false);
  });

  it('aceita formula que so cita tokens que nao existem (limitacao atual)', () => {
    // Troca todo token por 1 antes de compilar, entao nao sabe se [L9] existe.
    expect(formulaValida('[L9] * 1000')).toBe(true);
  });
});

describe('tokensDaFormula', () => {
  it('separa contas de linhas', () => {
    expect(tokensDaFormula('{3.1.01} * [L2] + {3.2.01} - [ALIQ]')).toEqual({
      contas: ['3.1.01', '3.2.01'],
      linhas: ['L2', 'ALIQ'],
    });
  });

  it('formula sem token devolve listas vazias', () => {
    expect(tokensDaFormula('1000')).toEqual({ contas: [], linhas: [] });
  });
});

describe('problemasDaFormula', () => {
  const universo = { contas: ['3.1.01', '3.1.02', '3.2.01'], linhas: ['L1', 'L2', 'P1'] };

  it('formula sa nao tem problema', () => {
    expect(problemasDaFormula('({3.1.01} + {3.1.02}) * [P1] / 100', universo)).toEqual([]);
  });

  it('formula vazia avisa que a linha vai valer zero', () => {
    const p = problemasDaFormula('', universo);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('vazia');
  });

  it('acusa conta que nao existe no plano de contas', () => {
    const p = problemasDaFormula('{9.9.99} * 2', universo);
    expect(p.some((m) => m.includes('{9.9.99}'))).toBe(true);
  });

  it('acusa linha que nao existe no modelo', () => {
    const p = problemasDaFormula('[L9] * 1000', universo);
    expect(p.some((m) => m.includes('[L9]'))).toBe(true);
  });

  // Os tres casos que o avaliador engole calado — e que motivaram esta funcao.
  it('acusa nome solto, que a sanitizacao apagaria', () => {
    const p = problemasDaFormula('{3.1.01} * INFLACAO', universo);
    expect(p.some((m) => m.includes('nome solto'))).toBe(true);
  });

  it('acusa % usado como porcentagem', () => {
    const p = problemasDaFormula('{3.1.01} * 5%', universo);
    expect(p.some((m) => m.includes('resto de divisão'))).toBe(true);
  });

  it('acusa virgula decimal', () => {
    const p = problemasDaFormula('{3.1.01} * 1,05', universo);
    expect(p.some((m) => m.includes('ponto como separador'))).toBe(true);
  });

  it('acusa expressao incompleta', () => {
    const p = problemasDaFormula('{3.1.01} *', universo);
    expect(p.some((m) => m.includes('incompleta'))).toBe(true);
  });

  // Sem o universo de referencias a checagem de orfa e pulada — a tela pode nao
  // saber a lista, e nesse caso e melhor calar do que acusar em falso.
  it('sem universo conhecido nao acusa referencia orfa', () => {
    expect(problemasDaFormula('{9.9.99} * [L9]')).toEqual([]);
  });
});
