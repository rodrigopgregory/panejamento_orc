import { describe, expect, it } from 'vitest';
import { colaboradorTemCustoNoMes } from '../pessoal';

describe('projeção de desligamento', () => {
  it('mantém os 12 meses quando não há desligamento', () => {
    const meses = Array.from({ length: 12 }, (_, index) => index + 1)
      .filter((mes) => colaboradorTemCustoNoMes(mes));

    expect(meses).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('encerra o custo a partir do mês do desligamento', () => {
    const meses = Array.from({ length: 12 }, (_, index) => index + 1)
      .filter((mes) => colaboradorTemCustoNoMes(mes, 5));

    expect(meses).toEqual([1, 2, 3, 4]);
  });

  it('permite encerrar o custo já em janeiro', () => {
    expect(colaboradorTemCustoNoMes(1, 1)).toBe(false);
  });
});
