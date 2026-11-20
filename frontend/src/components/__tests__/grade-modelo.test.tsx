// O Handsontable de verdade nao renderiza sob jsdom (as suites que tentam
// estouram o tempo). Mas o que precisa de prova aqui nao e o Handsontable — e a
// nossa mecanica em volta dele: quantas vezes a grade e reconstruida quando o pai
// re-renderiza. E isso da para medir com um dublê que so conta chamadas.
//
// Vale a pena travar: e exatamente essa contagem que separa "atualizou a celula"
// de "repintou a tabela inteira", que era o defeito do piscar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, act } from '@testing-library/react';

const propsRecebidas: any[] = [];
const instancia = { render: vi.fn() };

vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => {
    propsRecebidas.push(props);
    // O ref do wrapper real expoe hotInstance; o dublê entrega o mesmo formato.
    props.ref?.({ hotInstance: instancia });
    return null;
  },
}));

const { default: GradeModelo } = await import('../GradeModelo');

const META = [
  { kind: 'account' as const, label: '3.1 - Receita de Servicos' },
  { kind: 'total' as const, label: 'Total' },
];

/** Linha de conta + linha de Total, com o valor de janeiro parametrizado. */
const dadosCom = (janeiro: number) => [
  ['3.1 - Receita de Servicos', janeiro, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, janeiro],
  ['Total', janeiro, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, janeiro],
];

function montar(aoAlterar = () => {}) {
  let aplicar: (n: number) => void = () => {};
  function Pai() {
    const [janeiro, setJaneiro] = useState(100);
    aplicar = setJaneiro;
    return (
      <GradeModelo
        dados={dadosCom(janeiro)}
        rowMeta={META}
        colHeaders={['Conta', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez', 'Total']}
        colunaTravada={() => false}
        aoAlterar={aoAlterar}
      />
    );
  }
  render(<Pai />);
  return { aplicar: (n: number) => act(() => aplicar(n)) };
}

beforeEach(() => {
  propsRecebidas.length = 0;
  instancia.render.mockClear();
});

describe('grade de modelo — re-render do pai nao reconstroi a grade', () => {
  it('a grade e montada uma vez e nao recebe props de novo quando so o valor muda', () => {
    const { aplicar } = montar();
    const montagens = propsRecebidas.length;

    aplicar(200);
    aplicar(300);

    // Cada re-render que chegasse ao HotTable viraria updateSettings -> replaceData,
    // que destroi o dataMap e repinta a tabela toda. Nenhum deve passar.
    expect(propsRecebidas.length).toBe(montagens);
  });

  it('o valor novo chega na tela por render(), sem passar pelo data', () => {
    const { aplicar } = montar();
    aplicar(200);

    expect(instancia.render).toHaveBeenCalled();
    // O array entregue ao Handsontable e o mesmo de sempre, atualizado in-place.
    const dados = propsRecebidas[0].data;
    expect(dados[0][1]).toBe(200);
    expect(dados[0][13]).toBe(200);
  });

  it('nao desfaz a edicao enquanto a gravacao ainda esta em voo', () => {
    // O pai re-renderiza por causa do save de OUTRA celula e ainda traz o valor
    // de antes; escrever isso de volta apagaria o numero recem-digitado.
    const { aplicar } = montar();
    const { data, afterChange } = propsRecebidas[0];

    data[0][1] = 999;                                   // o usuario digitou
    act(() => afterChange([[0, 1, 100, 999]], 'edit'));  // e o Handsontable avisou

    aplicar(100);                                        // render com o valor velho
    expect(data[0][1]).toBe(999);

    aplicar(999);                                        // o backend confirmou
    expect(data[0][1]).toBe(999);
  });
});
