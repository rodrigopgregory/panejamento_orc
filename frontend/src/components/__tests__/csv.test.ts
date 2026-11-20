// Trava o formato do CSV. Sao detalhes invisiveis no codigo e muito visiveis
// para quem abre o arquivo: separador errado joga a linha inteira numa coluna
// so, e falta de BOM estraga todos os acentos no Excel em portugues.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { escaparCampoCsv, montarCsv, baixarCsv, baixarTemplateCsv } from '../../lib/csv';
import { TEMPLATES_FOLHA } from '../../lib/folha-tabelas';

afterEach(() => vi.restoreAllMocks());

describe('escape de campo', () => {
  it('deixa texto simples sem aspas', () => {
    expect(escaparCampoCsv('Analista')).toBe('Analista');
  });

  it('protege campo que contem o separador', () => {
    expect(escaparCampoCsv('Alves; Souza')).toBe('"Alves; Souza"');
  });

  it('dobra aspas internas', () => {
    expect(escaparCampoCsv('Cargo "Senior"')).toBe('"Cargo ""Senior"""');
  });

  it('protege quebra de linha', () => {
    expect(escaparCampoCsv('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('transforma vazio e nulo em campo em branco', () => {
    expect(escaparCampoCsv(null)).toBe('');
    expect(escaparCampoCsv(undefined)).toBe('');
  });
});

describe('montagem do arquivo', () => {
  it('usa ponto e virgula como separador', () => {
    expect(montarCsv([['a', 'b'], ['1', '2']])).toBe('a;b\r\n1;2');
  });

  it('preserva a virgula decimal dos numeros', () => {
    // Se o separador fosse virgula, "7500,00" viraria duas colunas.
    const csv = montarCsv([['Salario'], ['7500,00']]);
    expect(csv).toBe('Salario\r\n7500,00');
    expect(csv.split('\r\n')[1].split(';').length).toBe(1);
  });
});

function capturarDownload() {
  const baixados: { nome: string; conteudo: string; bytes: Uint8Array }[] = [];
  let ultimoBlob: Blob | null = null;
  const criarElemento = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = criarElemento(tag);
    if (tag === 'a') {
      (el as HTMLAnchorElement).click = async () => {
        baixados.push({
          nome: (el as HTMLAnchorElement).download,
          // Blob.text() descarta o BOM por especificacao; os bytes crus sao o
          // unico jeito de provar que ele foi mesmo escrito no arquivo.
          conteudo: ultimoBlob ? await ultimoBlob.text() : '',
          bytes: ultimoBlob ? new Uint8Array(await ultimoBlob.arrayBuffer()) : new Uint8Array(),
        });
      };
    }
    return el;
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { ultimoBlob = b as Blob; return 'blob:teste'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return baixados;
}

describe('download', () => {
  it('acrescenta a extensao quando falta', async () => {
    const baixados = capturarDownload();
    baixarCsv('relatorio', [['a']]);
    await new Promise((r) => setTimeout(r, 0));
    expect(baixados[0].nome).toBe('relatorio.csv');
  });

  it('escreve o BOM UTF-8 para o Excel ler os acentos', async () => {
    const baixados = capturarDownload();
    baixarCsv('acentos.csv', [['Aplicação', 'Salário']]);
    await new Promise((r) => setTimeout(r, 0));
    expect(Array.from(baixados[0].bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(baixados[0].conteudo).toContain('Aplicação;Salário');
  });

  it('libera a URL do blob para nao vazar memoria', () => {
    capturarDownload();
    baixarCsv('x.csv', [['a']]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:teste');
  });
});

describe('templates das abas de folha', () => {
  const abas = Object.keys(TEMPLATES_FOLHA) as (keyof typeof TEMPLATES_FOLHA)[];

  it('cobre as seis abas da tela', () => {
    expect(abas).toEqual(['colaboradores', 'cargos', 'beneficios', 'encargos', 'dissidio', 'turnover']);
  });

  it('cada exemplo tem exatamente uma celula por coluna', () => {
    for (const aba of abas) {
      const t = TEMPLATES_FOLHA[aba];
      for (const exemplo of t.exemplos) {
        expect(exemplo.length, `${aba}: exemplo com ${exemplo.length} celulas para ${t.colunas.length} colunas`).toBe(t.colunas.length);
      }
    }
  });

  it('gera o arquivo com o cabecalho na primeira linha', async () => {
    const baixados = capturarDownload();
    const t = TEMPLATES_FOLHA.colaboradores;
    baixarTemplateCsv({ arquivo: t.arquivo, colunas: [...t.colunas], exemplos: t.exemplos.map((l) => [...l]) });
    await new Promise((r) => setTimeout(r, 0));
    const linhas = baixados[0].conteudo.replace('﻿', '').split('\r\n');
    expect(linhas[0]).toBe('Nome;Cargo;Centro de Resultado;Empresa;Tipo de Contrato;Data de Admissao;Salario;Ativo');
    expect(linhas.length).toBe(3);
  });
});
