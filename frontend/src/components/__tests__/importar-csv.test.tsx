// Prova o caminho completo do carregamento em lote: arquivo escolhido ->
// previa -> confirmacao -> gravacao. O que interessa e que o usuario so grave
// depois de ver o que vai entrar, e que o que entra seja o registro certo.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

// vi.hoisted porque o vi.mock abaixo sobe para o topo do arquivo e nao enxerga
// uma const declarada normalmente aqui.
const { batchCreate } = vi.hoisted(() => ({ batchCreate: vi.fn(async () => ({})) }));

vi.mock('../../hooks/useMitraData', () => ({ batchCreate }));

import ImportarCsvModal from '../ImportarCsvModal';
import { TEMPLATES_FOLHA } from '../../lib/folha-tabelas';

afterEach(cleanup);
beforeEach(() => batchCreate.mockClear());

const contexto = {
  crs: [{ ID: 7, CODIGO: 'CR001', NOME: 'Comercial' }],
  empresas: [{ ID: 3, NOME: 'Innovare Tecnologia Ltda' }],
  cargos: [{ NOME: 'Analista Financeiro' }],
  cicloId: 42,
  existentes: [],
};

const CABECALHO = 'Nome;Cargo;Centro de Resultado;Empresa;Tipo de Contrato;Data de Admissao;Salario;Ativo';

function montar(props: Record<string, unknown> = {}) {
  const onImportado = vi.fn();
  const onErro = vi.fn();
  render(
    <ImportarCsvModal
      aberto
      aba="colaboradores"
      titulo="Colaboradores"
      contexto={contexto}
      template={TEMPLATES_FOLHA.colaboradores}
      onFechar={vi.fn()}
      onImportado={onImportado}
      onErro={onErro}
      {...props}
    />,
  );
  return { onImportado, onErro };
}

async function escolher(conteudo: string) {
  const arquivo = new File([conteudo], 'colaboradores.csv', { type: 'text/csv' });
  // O input fica escondido atras do botao "Escolher arquivo"; o teste fala com
  // ele direto, que e o que o clique acaba fazendo.
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [arquivo], configurable: true });
  fireEvent.change(input);
}

describe('carregamento em lote de premissas de folha', () => {
  it('nao grava nada enquanto o usuario nao confirma', async () => {
    montar();
    await escolher(`${CABECALHO}\nMaria Souza;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;2026-02-01;7500,00;Sim`);

    expect(await screen.findByText(/1 linha pronta para importar/)).toBeTruthy();
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it('grava o registro convertido quando o usuario confirma', async () => {
    const { onImportado } = montar();
    await escolher(`${CABECALHO}\nMaria Souza;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;2026-02-01;7500,00;Sim`);

    fireEvent.click(await screen.findByRole('button', { name: /Importar 1 linha/ }));

    await waitFor(() => expect(batchCreate).toHaveBeenCalledTimes(1));
    expect(batchCreate).toHaveBeenCalledWith('COLABORADOR', [{
      NOME: 'Maria Souza',
      CARGO: 'Analista Financeiro',
      CR_ID: 7,
      EMPRESA_ID: 3,
      TIPO_CONTRATO: 'CLT',
      DATA_ADMISSAO: '2026-02-01',
      SALARIO: 7500,
      ATIVO: 'true',
    }]);
    expect(onImportado).toHaveBeenCalledWith(1);
  });

  it('mostra o motivo da linha recusada e importa so as boas', async () => {
    montar();
    await escolher([
      CABECALHO,
      'Maria Souza;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;2026-02-01;7500,00;Sim',
      'Joao Lima;Cargo Que Nao Existe;CR001;Innovare Tecnologia Ltda;CLT;2026-03-15;12000,00;Sim',
    ].join('\n'));

    expect(await screen.findByText(/1 linha pronta para importar/)).toBeTruthy();
    expect(screen.getByText(/1 linha ignorada/)).toBeTruthy();
    expect(screen.getByText(/Cargo "Cargo Que Nao Existe" nao existe/)).toBeTruthy();
    expect(screen.getByText('Linha 3')).toBeTruthy();
  });

  it('recusa o arquivo inteiro e bloqueia a importacao quando o cabecalho nao confere', async () => {
    montar();
    await escolher('Nome;Salario\nMaria Souza;7500,00');

    expect(await screen.findByText(/nao tem as colunas do template/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Importar$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('avisa quantas linhas ja tinham entrado quando a gravacao falha no meio', async () => {
    // 60 linhas = 2 blocos de gravacao; o segundo falha.
    const linhas = Array.from({ length: 60 }, (_, i) =>
      `Pessoa ${i};Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;2026-02-01;7500,00;Sim`);
    batchCreate.mockImplementationOnce(async () => ({}))
      .mockImplementationOnce(async () => { throw new Error('falha de rede'); });

    const { onImportado, onErro } = montar();
    await escolher([CABECALHO, ...linhas].join('\n'));
    fireEvent.click(await screen.findByRole('button', { name: /Importar 60 linhas/ }));

    await waitFor(() => expect(onErro).toHaveBeenCalledWith(50));
    expect(onImportado).not.toHaveBeenCalled();
  });
});
