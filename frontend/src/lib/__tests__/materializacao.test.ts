import { describe, it, expect } from 'vitest';
import { mesesMaterializaveis, decidirGravacao, avisoContasNaoCalculadas } from '../materializacao';

describe('mesesMaterializaveis', () => {
  it('num ciclo 5+7 escreve de junho a dezembro', () => {
    expect(mesesMaterializaveis(5)).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });

  it('sem mes fechado escreve o ano inteiro', () => {
    expect(mesesMaterializaveis(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('ano todo fechado nao escreve nada', () => {
    expect(mesesMaterializaveis(12)).toEqual([]);
  });

  it('valor sujo nao vira mes negativo nem estoura dezembro', () => {
    expect(mesesMaterializaveis(NaN)).toHaveLength(12);
    expect(mesesMaterializaveis(-3)).toHaveLength(12);
    expect(mesesMaterializaveis(99)).toEqual([]);
  });
});

describe('decidirGravacao', () => {
  it('grava quando o numero mudou', () => {
    expect(decidirGravacao(103642, 2120)).toEqual({ gravar: true, valor: 103642 });
  });

  it('arredonda antes de gravar', () => {
    expect(decidirGravacao(103641.7, 0)).toEqual({ gravar: true, valor: 103642 });
  });

  it('nao reescreve o que ja esta igual', () => {
    expect(decidirGravacao(5000, 5000)).toEqual({ gravar: false, motivo: 'sem_mudanca' });
  });

  it('trata como igual a diferenca que some no arredondamento', () => {
    expect(decidirGravacao(5000.2, 5000)).toEqual({ gravar: false, motivo: 'sem_mudanca' });
  });

  it('recusa Infinity — divisao por zero nao pode virar valor no DRE', () => {
    expect(decidirGravacao(Infinity, 100)).toEqual({ gravar: false, motivo: 'nao_finito' });
    expect(decidirGravacao(-Infinity, 100)).toEqual({ gravar: false, motivo: 'nao_finito' });
  });

  it('recusa NaN', () => {
    expect(decidirGravacao(NaN, 100)).toEqual({ gravar: false, motivo: 'nao_finito' });
  });

  it('zero calculado sobre valor existente E uma mudanca real', () => {
    // Zerar e uma decisao do modelo, nao ausencia de dado: tem de ir ao banco.
    expect(decidirGravacao(0, 8000)).toEqual({ gravar: true, valor: 0 });
  });
});

describe('avisoContasNaoCalculadas', () => {
  it('nomeia as contas no aviso', () => {
    const msg = avisoContasNaoCalculadas(['3.1.02', '5.3.01']);
    expect(msg).toContain('3.1.02');
    expect(msg).toContain('5.3.01');
    expect(msg).toContain('valor anterior foi mantido');
  });
});
