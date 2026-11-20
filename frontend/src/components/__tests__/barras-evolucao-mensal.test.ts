// Mede o vao entre as barras de receita e despesa do grafico "Evolucao mensal"
// rodando a matematica REAL do Recharts (getBarPosition) sobre exatamente a
// configuracao que a tela usa.
//
// Os graficos nao renderizam em jsdom (o ResponsiveContainer mede zero), entao
// este e o unico jeito de provar o espacamento sem abrir o navegador. Serve
// tambem de trava: voltar para maxBarSize faz o vao explodir e o teste quebra.
import { describe, it, expect } from 'vitest';
import { getBarPosition } from 'recharts/lib/util/ChartUtils';
import { BARRAS_EVOLUCAO_MENSAL } from '../../lib/barras-evolucao-mensal';

const { barSize, barGap, barCategoryGap } = BARRAS_EVOLUCAO_MENSAL;

// Duas series por mes: receita e despesa.
function posicoes(bandSize: number, sizeList: { barSize?: number }[], maxBarSize?: number) {
  return getBarPosition({
    barGap,
    barCategoryGap,
    bandSize,
    maxBarSize,
    sizeList: sizeList.map((s, i) => ({ item: { type: 'Bar', key: i }, stackList: [], ...s })),
  }) as { position: { offset: number; size: number } }[];
}

function vao(bandSize: number, sizeList: { barSize?: number }[], maxBarSize?: number) {
  const p = posicoes(bandSize, sizeList, maxBarSize);
  const receita = p[0].position;
  const despesa = p[1].position;
  return despesa.offset - (receita.offset + receita.size);
}

const COMO_A_TELA_USA = [{ barSize }, { barSize }];

describe('espacamento das barras — evolucao mensal', () => {
  // 5 meses realizados numa tela larga: a faixa de cada mes fica bem folgada.
  // Era exatamente o cenario que deixava as barras distantes.
  it('mantem o vao igual ao barGap mesmo com a faixa do mes bem larga', () => {
    expect(vao(254, COMO_A_TELA_USA)).toBe(barGap);
  });

  it('mantem o mesmo vao quando ha 12 meses e a faixa e estreita', () => {
    expect(vao(106, COMO_A_TELA_USA)).toBe(barGap);
  });

  it('nao deixa o vao crescer conforme a tela alarga', () => {
    const vaos = [120, 200, 300, 500, 800].map((band) => vao(band, COMO_A_TELA_USA));
    expect(new Set(vaos).size).toBe(1);
    expect(vaos[0]).toBe(barGap);
  });

  it('mantem as duas barras com a mesma largura', () => {
    const p = posicoes(254, COMO_A_TELA_USA);
    expect(p[0].position.size).toBe(barSize);
    expect(p[1].position.size).toBe(barSize);
  });

  it('encolhe as barras em vez de vazar quando a faixa nao comporta as duas', () => {
    const estreita = 40;
    const p = posicoes(estreita, COMO_A_TELA_USA);
    const largura = p[0].position.size + p[1].position.size;
    expect(largura).toBeLessThanOrEqual(estreita);
    expect(p[0].position.size).toBeGreaterThan(0);
  });

  // Trava de regressao: documenta por que maxBarSize foi abandonado.
  it('com maxBarSize o vao cresceria junto com a largura da faixa', () => {
    const semBarSize = [{}, {}];
    const estreito = vao(120, semBarSize, barSize);
    const largo = vao(500, semBarSize, barSize);
    expect(largo).toBeGreaterThan(estreito);
    // Na faixa larga o vao passaria a ser maior que a propria barra.
    expect(largo).toBeGreaterThan(barSize);
  });
});
