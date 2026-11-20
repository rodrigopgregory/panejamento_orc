// Cobre o que foi adicionado a tela Premissas Folha:
//  - edicao inline grava o campo certo, sem abrir formulario;
//  - a recarga da SF 129 e COALESCIDA (varias edicoes = uma ida a rede), que e
//    a estrategia de carregamento que a tela precisava preservar;
//  - clique no cabecalho ordena as linhas.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const { chamadasSF, updates, falha } = vi.hoisted(() => ({
  chamadasSF: [] as { sfId: number; input: Record<string, unknown> }[],
  updates: [] as { tabela: string; id: number; dados: Record<string, unknown> }[],
  falha: { proxima: false },
}));

vi.mock('../../hooks/useMitraData', async () => {
  const { useState, useEffect, useCallback } = await import('react');
  const jsonField = (v: unknown): unknown[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v as string); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const CRS = [{ ID: 1, CODIGO: 'CR001', NOME: 'Comercial' }, { ID: 2, CODIGO: 'CR002', NOME: 'Operacoes' }];
  const EMPRESAS = [{ ID: 1, NOME: 'Alpha' }, { ID: 2, NOME: 'Beta' }];
  const CARGOS = [{ ID: 1, NOME: 'Analista', SALARIO_MEDIO: 5000 }, { ID: 2, NOME: 'Gerente', SALARIO_MEDIO: 12000 }];
  // Nomes fora de ordem alfabetica de proposito, para o teste de ordenacao.
  const COLABORADORES = [
    { ID: 10, NOME: 'Zuleica Alves', CARGO: 'Analista', CR_ID: 1, CR_CODIGO: 'CR001', CR_NOME: 'Comercial', EMPRESA_ID: 1, EMPRESA_NOME: 'Alpha', TIPO_CONTRATO: 'CLT', SALARIO: 4000, ATIVO: 'true' },
    { ID: 11, NOME: 'Bruno Dias', CARGO: 'Gerente', CR_ID: 2, CR_CODIGO: 'CR002', CR_NOME: 'Operacoes', EMPRESA_ID: 2, EMPRESA_NOME: 'Beta', TIPO_CONTRATO: 'PJ', SALARIO: 9000, ATIVO: 'true' },
    { ID: 12, NOME: 'Marcia Reis', CARGO: 'Analista', CR_ID: 1, CR_CODIGO: 'CR001', CR_NOME: 'Comercial', EMPRESA_ID: 1, EMPRESA_NOME: 'Alpha', TIPO_CONTRATO: 'CLT', SALARIO: 15000, ATIVO: 'true' },
  ];
  const BENEFICIOS = [
    { ID: 20, NOME: 'Vale Refeicao', TIPO: 'FIXO', VALOR: 800, PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'false' },
    { ID: 21, NOME: 'Plano de Saude', TIPO: 'PERCENTUAL', VALOR: 0, PERCENTUAL: 4.5, APLICA_CLT: 'true', APLICA_PJ: 'true' },
  ];
  const ENCARGOS = [
    { ID: 30, NOME: 'INSS Patronal', PERCENTUAL: 20, APLICA_CLT: 'true', APLICA_PJ: 'false' },
    { ID: 31, NOME: 'FGTS', PERCENTUAL: 8, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  ];
  const DISSIDIOS = [{ ID: 40, CICLO_ID: 7, EMPRESA_ID: 1, EMPRESA_NOME: 'Alpha', PERCENTUAL: 5.5, MES_APLICACAO: 5 }];
  const TURNOVERS = [{ ID: 50, CICLO_ID: 7, EMPRESA_ID: 1, EMPRESA_NOME: 'Alpha', PERCENTUAL: 12 }];
  const CARGOS_TABELA = [
    { ID: 1, NOME: 'Analista', SALARIO_MEDIO: 5000, ATIVO: 'true' },
    { ID: 2, NOME: 'Gerente', SALARIO_MEDIO: 12000, ATIVO: 'false' },
  ];
  const linha = {
    COLABORADORES: JSON.stringify(COLABORADORES),
    CRS: JSON.stringify(CRS),
    EMPRESAS: JSON.stringify(EMPRESAS),
    CARGOS: JSON.stringify(CARGOS),
    CICLOS: JSON.stringify([{ ID: 7, NOME: 'Orcamento 2026', ANO: 2026, STATUS: 'INICIADA' }]),
    BENEFICIOS: JSON.stringify(BENEFICIOS),
    ENCARGOS: JSON.stringify(ENCARGOS),
    DISSIDIOS: JSON.stringify(DISSIDIOS),
    TURNOVERS: JSON.stringify(TURNOVERS),
  };
  const useSF = (sfId: number, input: Record<string, unknown> = {}) => {
    const [data, setData] = useState<unknown[]>([]);
    const [loading, setLoading] = useState(true);
    const key = sfId + ':' + JSON.stringify(input);
    const refetch = useCallback(async () => {
      chamadasSF.push({ sfId, input });
      setData([linha]);
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    useEffect(() => { refetch(); }, [refetch]);
    return { data, loading, refetch };
  };
  return {
    useSF,
    useList: () => ({ data: CARGOS_TABELA, loading: false, refetch: vi.fn() }),
    execSF: vi.fn(async () => []),
    execSFCached: vi.fn(async () => []),
    querySQL: vi.fn(async () => []),
    createRecord: vi.fn(async () => ({})),
    updateRecord: vi.fn(async (tabela: string, id: number, dados: Record<string, unknown>) => {
      updates.push({ tabela, id, dados });
      if (falha.proxima) { falha.proxima = false; throw new Error('rede fora'); }
      return {};
    }),
    removeRecord: vi.fn(async () => ({})),
    jsonField,
    SF_IDS: new Proxy({ hotFolhaBase: 129 } as Record<string, number>, {
      get: (t, k: string) => (k in t ? t[k] : 0),
    }),
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
  };
});

vi.mock('../../lib/auth', () => ({
  getUser: () => ({ ID: 1, NOME: 'Teste', PERFIL: 'ADMIN', EMAIL: 't@t.com' }),
  getDemoGestorId: () => null,
  canAccessPath: () => true,
  getLandingPath: () => '/',
  logout: vi.fn(),
  isAdmin: () => true,
}));

async function abrirTela(aba?: RegExp) {
  chamadasSF.length = 0;
  updates.length = 0;
  falha.proxima = false;
  const Page = (await import('../../pages/FolhaPage')).default;
  render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
  if (aba) {
    fireEvent.click(screen.getByRole('button', { name: aba }));
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
  }
}

// Celula de selo: o botao que embrulha o Badge da coluna categorica.
function selo(rotulo: RegExp): HTMLButtonElement {
  return screen.getByLabelText(rotulo) as HTMLButtonElement;
}

function nomesNaTela(): string[] {
  // Nome voltou a ser texto simples: leio a primeira celula de cada linha.
  return screen.getAllByRole('row').slice(1)
    .map((linha) => within(linha).getAllByRole('cell')[0]?.textContent?.trim() || '')
    .filter(Boolean);
}

function camposSalario(): HTMLInputElement[] {
  return screen.getAllByLabelText(/^Salário de /) as HTMLInputElement[];
}

describe('Premissas Folha — o que fica editavel', () => {
  it('nao transforma o nome em campo: ele e a identidade da linha', async () => {
    await abrirTela();
    expect(screen.queryByPlaceholderText('Nome do colaborador')).toBeNull();
    expect(nomesNaTela()).toContain('Bruno Dias');
  });

  it('edita na propria linha, sem abrir formulario', async () => {
    await abrirTela();
    expect(camposSalario().length).toBe(3);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('usa a aparencia discreta em todas as celulas editaveis', async () => {
    await abrirTela();
    // A classe carrega o estilo: sem caixa em repouso, fundo no hover, borda no foco.
    for (const campo of camposSalario()) {
      expect(campo.className).toContain('celula-inline');
    }
    const contratos = screen.getAllByRole('button').filter((b) => /CLT|PJ/.test(b.textContent || ''));
    expect(contratos.length).toBeGreaterThan(0);
    for (const botao of contratos) expect(botao.className).toContain('celula-inline');
  });

  it('marca o valor onde se digita ou se escolhe, e deixa o selo sem marca', async () => {
    await abrirTela();
    // O pontilhado sob o valor e o que diferencia campo de texto fixo — sem ele
    // a celula fica escondida demais e ninguem descobre que da para editar.
    for (const campo of camposSalario()) {
      expect(campo.className).toContain('celula-inline-marca');
    }
    const contratos = screen.getAllByRole('button').filter((b) => /^(CLT|PJ)$/.test(b.textContent?.trim() || ''));
    expect(contratos.length).toBeGreaterThan(0);
    for (const botao of contratos) expect(botao.className).toContain('celula-inline-marca');
  });

  it('deixa o selo sem a marca de campo', async () => {
    // O selo ja e um objeto visivel na celula: sublinhar sujaria a leitura.
    await abrirTela(/Cargos e Salários/);
    expect(selo(/^Ativo em Analista/).className).not.toContain('celula-inline-marca');
  });
});

describe('Premissas Folha — numero formatado em repouso', () => {
  it('mostra o salario formatado enquanto ninguem edita', async () => {
    await abrirTela();
    const valores = camposSalario().map((c) => c.value);
    expect(valores).toContain('R$ 15.000');
    expect(valores).toContain('R$ 4.000');
    // Sem ",00" pendurado em valor redondo.
    expect(valores.some((v) => v.endsWith(',00'))).toBe(false);
  });

  it('troca para o numero cru ao receber foco', async () => {
    await abrirTela();
    const campo = camposSalario()[0];
    const formatado = campo.value;
    fireEvent.focus(campo);
    expect(campo.value).not.toBe(formatado);
    expect(campo.value).not.toContain('R$');
  });

  it('grava o numero e volta a formatar ao sair', async () => {
    await abrirTela();
    const campo = camposSalario()[0];
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: '8.500,50' } });
    fireEvent.blur(campo);

    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0].tabela).toBe('COLABORADOR');
    expect(updates[0].dados).toEqual({ SALARIO: 8500.5 });
    // Centavos aparecem completos; valor redondo fica sem casas decimais.
    expect(campo.value).toBe('R$ 8.500,50');
  });

  it('nao grava quando o valor sai igual ao que entrou', async () => {
    await abrirTela();
    const campo = camposSalario()[0];
    fireEvent.focus(campo);
    fireEvent.blur(campo);
    await new Promise((r) => setTimeout(r, 30));
    expect(updates.length).toBe(0);
  });

  it('Escape descarta a edicao sem gravar', async () => {
    await abrirTela();
    const campo = camposSalario()[0];
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: '99999' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    fireEvent.blur(campo);
    await new Promise((r) => setTimeout(r, 30));
    expect(updates.length).toBe(0);
  });
});

describe('Premissas Folha — recarga coalescida (estrategia de carregamento)', () => {
  it('varias edicoes seguidas resultam em UMA recarga da SF 129', async () => {
    await abrirTela();
    const aposMontagem = chamadasSF.filter((c) => c.sfId === 129).length;
    expect(aposMontagem).toBe(1);

    const campos = camposSalario();
    for (let i = 0; i < 3; i++) {
      fireEvent.focus(campos[i]);
      fireEvent.change(campos[i], { target: { value: String(1000 + i) } });
      fireEvent.blur(campos[i]);
    }
    await waitFor(() => expect(updates.length).toBe(3));

    await waitFor(
      () => expect(chamadasSF.filter((c) => c.sfId === 129).length).toBe(aposMontagem + 1),
      { timeout: 2000 },
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(chamadasSF.filter((c) => c.sfId === 129).length).toBe(aposMontagem + 1);
  });
});

describe('Premissas Folha — ordenacao por clique no cabecalho', () => {
  it('ordena de A a Z e inverte no segundo clique', async () => {
    await abrirTela();
    const cabecalho = screen.getByRole('columnheader', { name: /Nome/ });
    expect(cabecalho.getAttribute('aria-sort')).toBe('none');

    fireEvent.click(cabecalho);
    expect(cabecalho.getAttribute('aria-sort')).toBe('ascending');
    expect(nomesNaTela()).toEqual(['Bruno Dias', 'Marcia Reis', 'Zuleica Alves']);

    fireEvent.click(cabecalho);
    expect(cabecalho.getAttribute('aria-sort')).toBe('descending');
    expect(nomesNaTela()).toEqual(['Zuleica Alves', 'Marcia Reis', 'Bruno Dias']);
  });

  it('terceiro clique volta a ordem original da tela', async () => {
    await abrirTela();
    const cabecalho = screen.getByRole('columnheader', { name: /Nome/ });
    const original = nomesNaTela();
    fireEvent.click(cabecalho);
    fireEvent.click(cabecalho);
    fireEvent.click(cabecalho);
    expect(cabecalho.getAttribute('aria-sort')).toBe('none');
    expect(nomesNaTela()).toEqual(original);
  });

  it('ordena salario do maior para o menor no primeiro clique', async () => {
    await abrirTela();
    const cabecalho = screen.getByRole('columnheader', { name: /Salário/ });
    fireEvent.click(cabecalho);
    expect(cabecalho.getAttribute('aria-sort')).toBe('descending');
    expect(nomesNaTela()).toEqual(['Marcia Reis', 'Bruno Dias', 'Zuleica Alves']);
  });

  it('a ordenacao nao dispara ida a rede — os dados ja estao na memoria', async () => {
    await abrirTela();
    const antes = chamadasSF.length;
    fireEvent.click(screen.getByRole('columnheader', { name: /Nome/ }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Salário/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(chamadasSF.length).toBe(antes);
  });
});

describe('Premissas Folha — template CSV', () => {
  it('oferece o download do template na aba', async () => {
    await abrirTela();
    const botao = screen.getByRole('button', { name: /Template CSV/ });
    const cliques: string[] = [];
    const criarElemento = document.createElement.bind(document);
    const spyCreate = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = criarElemento(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = () => { cliques.push((el as HTMLAnchorElement).download); };
      return el;
    });
    const spyUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:teste');
    const spyRevoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    fireEvent.click(botao);
    expect(cliques).toEqual(['template-colaboradores.csv']);

    spyCreate.mockRestore(); spyUrl.mockRestore(); spyRevoke.mockRestore();
  });
});

// ── Propagacao do design para as outras cinco abas ────────────────────
// O que se prova aqui e o principio combinado com o usuario: a coluna
// categorica continua sendo o selo colorido que a tabela ja mostrava (nao vira
// caixa de formulario), o nome/empresa continua texto por ser a identidade da
// linha, e o clique grava o campo certo da tabela certa.

function primeiraColuna(): string[] {
  return screen.getAllByRole('row').slice(1)
    .map((linha) => within(linha).getAllByRole('cell')[0]?.textContent?.trim() || '')
    .filter(Boolean);
}

function editarNumero(campo: HTMLInputElement, texto: string) {
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.blur(campo);
}

describe('Premissas Folha — aba Cargos e Salarios', () => {
  it('edita o salario medio na propria linha', async () => {
    await abrirTela(/Cargos e Salários/);
    const campo = screen.getByLabelText(/^Salário médio de Analista/) as HTMLInputElement;
    expect(campo.value).toBe('R$ 5.000');
    editarNumero(campo, '6.000');
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'CARGO', id: 1, dados: { SALARIO_MEDIO: 6000 } });
  });

  it('mantem Ativo como selo colorido e alterna no clique', async () => {
    await abrirTela(/Cargos e Salários/);
    const botao = selo(/^Ativo em Analista/);
    expect(botao.textContent).toBe('Sim');
    // O selo continua sendo o Badge (agora rounded-full, do design system),
    // embrulhado num gatilho sem caixa.
    expect(botao.querySelector('span')?.className).toContain('rounded-full');
    expect(botao.className).toContain('celula-inline');

    fireEvent.click(botao);
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'CARGO', id: 1, dados: { ATIVO: 'false' } });
    // Responde na hora, sem esperar a recarga da SF 129.
    expect(selo(/^Ativo em Analista/).textContent).toBe('Não');
  });

  it('nao transforma o nome do cargo em campo', async () => {
    await abrirTela(/Cargos e Salários/);
    expect(primeiraColuna()).toEqual(['Analista', 'Gerente']);
  });
});

describe('Premissas Folha — aba Beneficios', () => {
  it('edita o valor de um beneficio fixo', async () => {
    await abrirTela(/Benefícios/);
    const campo = screen.getByLabelText(/^Valor de Vale Refeicao/) as HTMLInputElement;
    editarNumero(campo, '900');
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'BENEFICIO', id: 20, dados: { VALOR: 900 } });
  });

  it('beneficio percentual nao tem campo de valor em reais', async () => {
    await abrirTela(/Benefícios/);
    expect(screen.queryByLabelText(/^Valor de Plano de Saude/)).toBeNull();
    const campo = screen.getByLabelText(/^Percentual de Plano de Saude/) as HTMLInputElement;
    expect(campo.value).toBe('4,5%');
  });

  it('CLT e selo, como nas outras abas', async () => {
    await abrirTela(/Benefícios/);
    const botao = selo(/^Aplica CLT em Vale Refeicao/);
    expect(botao.querySelector('span')?.className).toContain('rounded-full');
    fireEvent.click(botao);
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'BENEFICIO', id: 20, dados: { APLICA_CLT: 'false' } });
  });
});


describe('Premissas Folha — aba Encargos', () => {
  it('edita o percentual na linha', async () => {
    await abrirTela(/Encargos/);
    const campo = screen.getByLabelText(/^Percentual de INSS Patronal/) as HTMLInputElement;
    expect(campo.value).toBe('20%');
    editarNumero(campo, '22,5');
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'ENCARGO', id: 30, dados: { PERCENTUAL: 22.5 } });
    expect(campo.value).toBe('22,5%');
  });

  it('CLT continua selo', async () => {
    await abrirTela(/Encargos/);
    const botao = selo(/^Aplica CLT em FGTS/);
    expect(botao.querySelector('span')?.className).toContain('rounded-full');
    fireEvent.click(botao);
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'ENCARGO', id: 31, dados: { APLICA_CLT: 'false' } });
  });
});

describe('Premissas Folha — abas Dissidio e Turnover', () => {
  it('edita o percentual do dissidio', async () => {
    await abrirTela(/Dissídio/);
    const campo = screen.getByLabelText(/^Dissídio de Alpha/) as HTMLInputElement;
    expect(campo.value).toBe('5,5%');
    editarNumero(campo, '6');
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'PREMISSA_DISSIDIO', id: 40, dados: { PERCENTUAL: 6 } });
  });

  it('troca o mes de aplicacao pelo seletor da linha', async () => {
    await abrirTela(/Dissídio/);
    const gatilho = screen.getByRole('button', { name: 'Maio' });
    expect(gatilho.className).toContain('celula-inline');
    fireEvent.click(gatilho);
    fireEvent.click(await screen.findByRole('button', { name: 'Janeiro' }));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'PREMISSA_DISSIDIO', id: 40, dados: { MES_APLICACAO: 1 } });
  });

  it('edita o turnover anual', async () => {
    await abrirTela(/Turnover/);
    const campo = screen.getByLabelText(/^Turnover de Alpha/) as HTMLInputElement;
    expect(campo.value).toBe('12%');
    editarNumero(campo, '15');
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]).toEqual({ tabela: 'PREMISSA_TURNOVER', id: 50, dados: { PERCENTUAL: 15 } });
  });

  it('empresa continua texto nas duas abas', async () => {
    await abrirTela(/Turnover/);
    expect(primeiraColuna()).toEqual(['Alpha']);
  });
});

describe('Premissas Folha — gravacao que falha desfaz o que a celula mostrou', () => {
  it('o selo volta ao valor anterior', async () => {
    await abrirTela(/Cargos e Salários/);
    falha.proxima = true;
    fireEvent.click(selo(/^Ativo em Analista/));
    await waitFor(() => expect(updates.length).toBe(1));
    await waitFor(() => expect(selo(/^Ativo em Analista/).textContent).toBe('Sim'));
  });

  it('o campo numerico volta ao valor anterior', async () => {
    await abrirTela(/Encargos/);
    falha.proxima = true;
    const campo = screen.getByLabelText(/^Percentual de INSS Patronal/) as HTMLInputElement;
    editarNumero(campo, '99');
    await waitFor(() => expect(updates.length).toBe(1));
    await waitFor(() => expect(campo.value).toBe('20%'));
  });
});
