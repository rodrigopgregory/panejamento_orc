// Um setor ficou com os encargos lancados no orcamento e salario + beneficios
// descartados em silencio: as contas 5.1.01.01 e 5.1.03 nao estavam vinculadas
// ao driver PESSOAL naquele CR, entao o INSERT..SELECT da gravacao nao achou
// destino e gravou zero linhas — sem erro. A conferencia da epoca olhava so o
// total lancado, e como os encargos entraram o total ficou > 0 e a tela
// declarou sucesso. Foram R$ 300 mil que sumiram entre a Projecao Mensal (que
// mostrava tudo certo) e o DRE. Estes testes travam a conferencia bloco a bloco.
import { describe, it, expect } from 'vitest';
import { blocosFolhaNaoLancados, avisoFolhaNaoLancada, precisaAvisarFolhaNaoCalculada } from '../folha-lancamento';

const TODAS = ['5.1.01.01', '5.1.02', '5.1.03'];

// Projecao com os tres blocos preenchidos, como sai do calculo da folha.
const registros = [
  { SALARIO: 10000, ENCARGOS: 5600, BENEFICIOS: 2300 },
  { SALARIO: 8000, ENCARGOS: 4480, BENEFICIOS: 2300 },
];

describe('conferencia do lancamento da folha', () => {
  it('nao acusa nada quando os tres blocos tem conta vinculada', () => {
    expect(blocosFolhaNaoLancados(registros, TODAS)).toEqual([]);
    expect(avisoFolhaNaoLancada(registros, TODAS)).toBe('');
  });

  it('acusa a falha PARCIAL do CR005: encargos entram, salario e beneficios somem', () => {
    // Exatamente o vinculo que existia no CR005: so 5.1.02.
    const perdidos = blocosFolhaNaoLancados(registros, ['5.1.02']);
    expect(perdidos.map((b) => b.codigo)).toEqual(['5.1.01.01', '5.1.03']);

    const aviso = avisoFolhaNaoLancada(registros, ['5.1.02']);
    expect(aviso).toContain('Salários (conta 5.1.01.01)');
    expect(aviso).toContain('Benefícios (conta 5.1.03)');
    // A conta que ENTROU nao pode ser apontada como perdida.
    expect(aviso).not.toContain('5.1.02)');
  });

  it('acusa a falha total quando nenhuma conta esta vinculada', () => {
    expect(blocosFolhaNaoLancados(registros, []).map((b) => b.codigo)).toEqual(TODAS);
  });

  it('nomeia a conta faltante — e o dado que o administrador precisa', () => {
    expect(avisoFolhaNaoLancada(registros, ['5.1.01.01', '5.1.02'])).toContain('conta 5.1.03');
  });

  it('nao acusa bloco sem valor projetado: sem valor nao ha o que perder', () => {
    // Setor de estagiarios: salario e encargos, nenhum beneficio.
    const semBeneficio = [{ SALARIO: 5000, ENCARGOS: 2800, BENEFICIOS: 0 }];
    expect(blocosFolhaNaoLancados(semBeneficio, ['5.1.01.01', '5.1.02'])).toEqual([]);
  });

  it('trata projecao vazia e valores ausentes sem quebrar', () => {
    expect(blocosFolhaNaoLancados([], [])).toEqual([]);
    expect(blocosFolhaNaoLancados([{}, { SALARIO: null }], [])).toEqual([]);
  });

  it('soma os registros antes de decidir, nao olha so o primeiro', () => {
    // O primeiro registro nao tem beneficio; o segundo tem. O bloco de
    // beneficios precisa ser cobrado mesmo assim.
    const misto = [
      { SALARIO: 5000, ENCARGOS: 2800, BENEFICIOS: 0 },
      { SALARIO: 5000, ENCARGOS: 2800, BENEFICIOS: 900 },
    ];
    expect(blocosFolhaNaoLancados(misto, ['5.1.01.01', '5.1.02']).map((b) => b.codigo))
      .toEqual(['5.1.03']);
  });
});

// CR002 e CR007 chegaram a APROVADO/SUBMETIDO com despesa de pessoal no DRE sem
// nunca ter calculado a folha: o sistema deixava confirmar o driver PESSOAL sem
// projecao nenhuma. O aviso nao bloqueia — ha CR legitimo sem quadro proprio —
// mas obriga o gestor a assumir a escolha.
describe('precisaAvisarFolhaNaoCalculada', () => {
  it('avisa quando PESSOAL vai ser confirmado sem projecao', () => {
    expect(precisaAvisarFolhaNaoCalculada('PESSOAL', [])).toBe(true);
  });

  it('nao avisa quando a folha ja foi calculada', () => {
    expect(precisaAvisarFolhaNaoCalculada('PESSOAL', registros)).toBe(false);
  });

  it('nao avisa para os outros drivers, que nao dependem da folha', () => {
    for (const driver of ['RECEITA', 'BASE_ZERO', 'BASE_HISTORICO']) {
      expect(precisaAvisarFolhaNaoCalculada(driver, [])).toBe(false);
    }
  });

  it('trata projecao ausente como folha nao calculada', () => {
    expect(precisaAvisarFolhaNaoCalculada('PESSOAL', null)).toBe(true);
    expect(precisaAvisarFolhaNaoCalculada('PESSOAL', undefined)).toBe(true);
  });
});
