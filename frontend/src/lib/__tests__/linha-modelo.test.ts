// A linha de modelo do tipo PREMISSA amarra na premissa geral por NOME, e nao
// por ID, porque PREMISSA_LINHA e clonada a cada versao com IDs novos enquanto
// DRIVER_FORMULA atravessa versoes. Estes testes travam essa decisao e o
// comportamento das linhas antigas, que nasceram sem TIPO.
import { describe, it, expect } from 'vitest';
import {
  tipoLinha, tipoDoRotulo, ROTULO_TIPO, ROTULOS_TIPO,
  chavePremissa, mapaPremissas, valorPremissa,
} from '../linha-modelo';

describe('tipoLinha', () => {
  it('reconhece os tres tipos', () => {
    expect(tipoLinha({ TIPO: 'INPUT' })).toBe('INPUT');
    expect(tipoLinha({ TIPO: 'FORMULA' })).toBe('FORMULA');
    expect(tipoLinha({ TIPO: 'PREMISSA' })).toBe('PREMISSA');
  });

  it('trata linha antiga sem TIPO como INPUT', () => {
    // Era o default implicito em todo o codigo (`TIPO || 'INPUT'`); mudar isso
    // transformaria linhas digitaveis em calculadas de um dia para o outro.
    expect(tipoLinha({})).toBe('INPUT');
    expect(tipoLinha({ TIPO: null })).toBe('INPUT');
    expect(tipoLinha({ TIPO: '' })).toBe('INPUT');
    expect(tipoLinha(null)).toBe('INPUT');
  });

  it('nao inventa tipo a partir de lixo', () => {
    expect(tipoLinha({ TIPO: 'QUALQUER' })).toBe('INPUT');
  });
});

describe('tipoDoRotulo', () => {
  it('faz o caminho de volta do que aparece na grade', () => {
    for (const tipo of ['INPUT', 'FORMULA', 'PREMISSA'] as const) {
      expect(tipoDoRotulo(ROTULO_TIPO[tipo])).toBe(tipo);
    }
  });

  it('expoe os tres rotulos na ordem do seletor', () => {
    expect(ROTULOS_TIPO).toEqual(['Input', 'Fórmula', 'Premissa']);
  });

  it('cai em INPUT quando o rotulo nao bate', () => {
    expect(tipoDoRotulo('')).toBe('INPUT');
    expect(tipoDoRotulo(undefined)).toBe('INPUT');
  });
});

describe('resolucao da premissa por nome', () => {
  const bloco = [
    { ID: 1, NOME: 'Inflação', MES: 1, VALOR: 4.5 },
    { ID: 1, NOME: 'Inflação', MES: 2, VALOR: 4.75 },
    { ID: 2, NOME: 'Câmbio', MES: 1, VALOR: 5.3 },
    { ID: 3, NOME: 'Sem valor', MES: null, VALOR: null },
  ];

  it('resolve pelo nome e mes', () => {
    const m = mapaPremissas(bloco);
    expect(valorPremissa(m, 'Inflação', 1)).toBe(4.5);
    expect(valorPremissa(m, 'Inflação', 2)).toBe(4.75);
    expect(valorPremissa(m, 'Câmbio', 1)).toBe(5.3);
  });

  it('ignora caixa e espaco nas pontas — o nome e digitado em duas telas', () => {
    const m = mapaPremissas(bloco);
    expect(valorPremissa(m, ' inflação ', 1)).toBe(4.5);
    expect(valorPremissa(m, 'INFLAÇÃO', 1)).toBe(4.5);
    expect(chavePremissa(' Câmbio ', 1)).toBe(chavePremissa('câmbio', 1));
  });

  it('vale zero quando a premissa nao existe na versao', () => {
    // Caso real: a linha do modelo cita uma premissa que a versao nova ainda nao
    // tem. Tem de valer zero, nao quebrar o calculo da tela inteira.
    const m = mapaPremissas(bloco);
    expect(valorPremissa(m, 'Nao existe', 1)).toBe(0);
    expect(valorPremissa(m, 'Inflação', 12)).toBe(0);
    expect(valorPremissa(null, 'Inflação', 1)).toBe(0);
  });

  it('premissa cadastrada sem nenhum valor nao entra no mapa', () => {
    const m = mapaPremissas(bloco);
    expect(valorPremissa(m, 'Sem valor', 1)).toBe(0);
    expect(m.size).toBe(3);
  });

  it('aguenta bloco vazio ou ausente', () => {
    expect(mapaPremissas([]).size).toBe(0);
    expect(mapaPremissas(null as any).size).toBe(0);
  });
});
