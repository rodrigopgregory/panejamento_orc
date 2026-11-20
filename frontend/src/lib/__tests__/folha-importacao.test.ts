import { describe, expect, it } from 'vitest';
import { lerCsv, lerNumero } from '../csv';
import { prepararImportacao } from '../folha-importacao';

const ctx = {
  crs: [{ ID: 7, CODIGO: 'CR001', NOME: 'Comercial' }],
  empresas: [{ ID: 3, NOME: 'Innovare Tecnologia Ltda' }],
  cargos: [{ NOME: 'Analista Financeiro' }],
  cicloId: 42,
  existentes: [] as Record<string, unknown>[],
};

const CABECALHO_COLAB = 'Nome;Cargo;Centro de Resultado;Empresa;Tipo de Contrato;Data de Admissao;Salario;Ativo';
const LINHA_OK = 'Maria Souza;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;2026-02-01;7500,00;Sim';

describe('lerCsv', () => {
  it('lê o separador ponto e vírgula que o template usa', () => {
    expect(lerCsv('a;b;c')).toEqual([['a', 'b', 'c']]);
  });

  it('aceita vírgula quando o arquivo veio de planilha em inglês', () => {
    expect(lerCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('preserva o separador que está dentro de aspas', () => {
    expect(lerCsv('"Souza; Maria";CLT')).toEqual([['Souza; Maria', 'CLT']]);
  });

  it('trata aspas dobradas como uma aspa literal', () => {
    expect(lerCsv('"diz ""oi""";x')).toEqual([['diz "oi"', 'x']]);
  });

  it('descarta o BOM e as linhas em branco do fim do arquivo', () => {
    expect(lerCsv('﻿a;b\r\n1;2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('lerNumero', () => {
  it('lê decimal em português', () => {
    expect(lerNumero('7500,00')).toBe(7500);
    expect(lerNumero('4,5')).toBe(4.5);
  });

  it('lê milhar com ponto e decimal com vírgula', () => {
    expect(lerNumero('1.234,56')).toBe(1234.56);
    expect(lerNumero('R$ 12.000,00')).toBe(12000);
  });

  it('trata ponto separando grupos de três como milhar, não decimal', () => {
    expect(lerNumero('7.500')).toBe(7500);
    expect(lerNumero('1.234.567')).toBe(1234567);
  });

  it('mantém o ponto como decimal quando não é grupo de três', () => {
    expect(lerNumero('4.5')).toBe(4.5);
  });

  it('devolve null para texto sem número', () => {
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
  });
});

describe('prepararImportacao — colaboradores', () => {
  it('converte a linha do template no registro do banco', () => {
    const r = prepararImportacao('colaboradores', `${CABECALHO_COLAB}\n${LINHA_OK}`, ctx);

    expect(r.erroArquivo).toBeNull();
    expect(r.invalidas).toEqual([]);
    expect(r.tabela).toBe('COLABORADOR');
    expect(r.validas[0].registro).toEqual({
      NOME: 'Maria Souza',
      CARGO: 'Analista Financeiro',
      CR_ID: 7,
      EMPRESA_ID: 3,
      TIPO_CONTRATO: 'CLT',
      DATA_ADMISSAO: '2026-02-01',
      SALARIO: 7500,
      ATIVO: 'true',
    });
  });

  it('recusa o arquivo inteiro quando falta coluna do template', () => {
    const r = prepararImportacao('colaboradores', 'Nome;Cargo\nMaria;Analista', ctx);

    expect(r.erroArquivo).toContain('Centro de Resultado');
    expect(r.validas).toEqual([]);
  });

  it('aceita as colunas fora da ordem do template', () => {
    const csv = 'Ativo;Salario;Data de Admissao;Tipo de Contrato;Empresa;Centro de Resultado;Cargo;Nome\n'
      + 'Sim;7500,00;2026-02-01;CLT;Innovare Tecnologia Ltda;CR001;Analista Financeiro;Maria Souza';
    const r = prepararImportacao('colaboradores', csv, ctx);

    expect(r.invalidas).toEqual([]);
    expect(r.validas[0].registro?.NOME).toBe('Maria Souza');
  });

  it('aponta a linha e o motivo de cada recusa, sem derrubar as boas', () => {
    const csv = [
      CABECALHO_COLAB,
      LINHA_OK,
      'Joao Lima;Cargo Inexistente;CR001;Innovare Tecnologia Ltda;CLT;2026-03-15;12000,00;Sim',
      'Ana Dias;Analista Financeiro;CR999;Innovare Tecnologia Ltda;CLT;2026-03-15;12000,00;Sim',
      'Rui Melo;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;31/02/2026;12000,00;Sim',
    ].join('\n');
    const r = prepararImportacao('colaboradores', csv, ctx);

    expect(r.validas).toHaveLength(1);
    expect(r.invalidas.map((i) => i.linha)).toEqual([3, 4, 5]);
    expect(r.invalidas[0].erro).toContain('Cargo "Cargo Inexistente" nao existe');
    expect(r.invalidas[1].erro).toContain('Centro de Resultado "CR999" nao existe');
    expect(r.invalidas[2].erro).toContain('nao e uma data valida');
  });

  it('aceita data no formato que o Excel pt-BR grava', () => {
    const csv = `${CABECALHO_COLAB}\nMaria Souza;Analista Financeiro;CR001;Innovare Tecnologia Ltda;CLT;1/2/2026;7500,00;Sim`;
    const r = prepararImportacao('colaboradores', csv, ctx);

    expect(r.validas[0].registro?.DATA_ADMISSAO).toBe('2026-02-01');
  });

  it('ignora quem ja esta no banco no mesmo centro de resultado', () => {
    const r = prepararImportacao('colaboradores', `${CABECALHO_COLAB}\n${LINHA_OK}`, {
      ...ctx,
      existentes: [{ NOME: 'Maria Souza', CR_ID: 7 }],
    });

    expect(r.validas).toEqual([]);
    expect(r.invalidas[0].erro).toContain('ja existe um colaborador');
  });

  it('ignora a linha repetida dentro do proprio arquivo', () => {
    const r = prepararImportacao('colaboradores', `${CABECALHO_COLAB}\n${LINHA_OK}\n${LINHA_OK}`, ctx);

    expect(r.validas).toHaveLength(1);
    expect(r.invalidas[0].erro).toContain('repetida no proprio arquivo');
  });
});

describe('prepararImportacao — demais abas', () => {
  it('carimba a versao corrente nas abas por versao', () => {
    const r = prepararImportacao('encargos', 'Nome;Percentual;Aplica CLT;Aplica PJ\nFGTS;8;Sim;Nao', ctx);

    expect(r.validas[0].registro).toEqual({
      NOME: 'FGTS', PERCENTUAL: 8, APLICA_CLT: 'true', APLICA_PJ: 'false', CICLO_ID: 42,
    });
  });

  it('lê o mês do dissídio por nome ou por número', () => {
    const csv = 'Empresa;Percentual;Mes de Aplicacao\n'
      + 'Innovare Tecnologia Ltda;5,5;Maio';
    const r = prepararImportacao('dissidio', csv, ctx);

    expect(r.validas[0].registro?.MES_APLICACAO).toBe(5);
    expect(r.validas[0].registro?.EMPRESA_ID).toBe(3);
    expect(r.validas[0].registro?.CICLO_ID).toBe(42);
  });

  it('recusa mês fora do intervalo', () => {
    const r = prepararImportacao('dissidio', 'Empresa;Percentual;Mes de Aplicacao\nInnovare Tecnologia Ltda;5;13', ctx);

    expect(r.invalidas[0].erro).toContain('nao e um mes valido');
  });

  it('recusa arquivo com cabecalho e nenhuma linha de dados', () => {
    const r = prepararImportacao('cargos', 'Cargo;Salario Medio;Ativo', ctx);

    expect(r.erroArquivo).toContain('so tem o cabecalho');
  });
});
