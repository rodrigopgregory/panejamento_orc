// ──────────────────────────────────────────────────────────────────────
// Carregamento de dados em lote da tela Premissas Folha: converte o CSV que
// o usuario devolve preenchido (o mesmo template que a tela oferece para
// download) nos registros de cada aba.
//
// Tudo aqui e funcao pura — o modal so mostra o que estas funcoes decidiram, e
// a gravacao so acontece depois que o usuario confirma a previa. A validacao e
// deliberadamente rigorosa: sao dados de folha em producao, e uma linha
// ambigua importada errado custa mais caro que uma linha recusada.
// ──────────────────────────────────────────────────────────────────────

import { lerCsv, lerNumero } from './csv';
import { TEMPLATES_FOLHA, MESES_LABELS } from './folha-tabelas';

export type AbaImportavel = keyof typeof TEMPLATES_FOLHA;

export interface ReferenciaCr { ID: number | string; CODIGO?: string; NOME?: string }
export interface ReferenciaEmpresa { ID: number | string; NOME?: string }

export interface ContextoImportacao {
  crs: ReferenciaCr[];
  empresas: ReferenciaEmpresa[];
  /** Cargos cadastrados: colaborador so entra com cargo que ja existe na lista. */
  cargos: { NOME?: string }[];
  /** Versao em que benefícios, encargos, dissidio e turnover serao gravados. */
  cicloId: number;
  /** Linhas ja existentes na aba, para nao duplicar o que esta no banco. */
  existentes: Record<string, unknown>[];
}

export interface LinhaImportada {
  /** Numero da linha no arquivo, contando o cabecalho — e o que o Excel mostra. */
  linha: number;
  valores: string[];
  registro: Record<string, unknown> | null;
  erro: string | null;
}

export interface ResultadoImportacao {
  colunas: string[];
  validas: LinhaImportada[];
  invalidas: LinhaImportada[];
  /** Erro que invalida o arquivo inteiro (cabecalho errado, arquivo vazio). */
  erroArquivo: string | null;
  tabela: string;
}

// ── Normalizacao e leitores de campo ─────────────────────────────────

function chave(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

// Id de referencia como texto: o banco devolve ora numero, ora string, e a
// comparacao de identidade precisa dos dois lados no mesmo formato.
function referencia(valor: unknown): string {
  return String(valor ?? '').trim();
}

const SIM = new Set(['sim', 's', 'true', 'verdadeiro', '1', 'x']);
const NAO = new Set(['nao', 'n', 'false', 'falso', '0', '']);

function lerSimNao(valor: string, campo: string): string {
  const k = chave(valor);
  if (SIM.has(k)) return 'true';
  if (NAO.has(k)) return 'false';
  throw new Error(`${campo}: use Sim ou Nao (recebido "${valor}")`);
}

function lerObrigatorio(valor: string, campo: string): string {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error(`${campo} e obrigatorio`);
  return texto;
}

function lerDecimal(valor: string, campo: string): number {
  const numero = lerNumero(valor);
  if (numero === null) throw new Error(`${campo}: "${valor}" nao e um numero`);
  if (numero < 0) throw new Error(`${campo} nao pode ser negativo`);
  return numero;
}

function lerMes(valor: string, campo: string): number {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error(`${campo} e obrigatorio`);
  const numero = Number(texto);
  if (Number.isInteger(numero) && numero >= 1 && numero <= 12) return numero;
  const indice = MESES_LABELS.findIndex((mes, i) => i > 0 && chave(mes) === chave(texto));
  if (indice > 0) return indice;
  throw new Error(`${campo}: "${valor}" nao e um mes valido`);
}

// Aceita o formato do template (YYYY-MM-DD) e o que o Excel pt-BR costuma
// gravar (DD/MM/YYYY). Grava sempre em ISO, que e o formato da coluna.
function lerData(valor: string, campo: string): string {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error(`${campo} e obrigatorio`);
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let ano: number, mes: number, dia: number;
  if (iso) { ano = +iso[1]; mes = +iso[2]; dia = +iso[3]; }
  else if (br) { dia = +br[1]; mes = +br[2]; ano = +br[3]; }
  else throw new Error(`${campo}: use AAAA-MM-DD (recebido "${valor}")`);

  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    throw new Error(`${campo}: "${valor}" nao e uma data valida`);
  }
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function lerOpcao(valor: string, campo: string, opcoes: string[]): string {
  const k = chave(valor);
  const achado = opcoes.find((opcao) => chave(opcao) === k);
  if (!achado) throw new Error(`${campo}: use ${opcoes.join(' ou ')} (recebido "${valor}")`);
  return achado;
}

function acharCr(valor: string, ctx: ContextoImportacao): number {
  const k = chave(valor);
  if (!k) throw new Error('Centro de Resultado e obrigatorio');
  // Codigo primeiro (e o que o template pede); nome como segunda chance, para
  // quem preencheu olhando a tela em vez do template.
  const achado = ctx.crs.find((cr) => chave(cr.CODIGO) === k)
    || ctx.crs.find((cr) => chave(cr.NOME) === k);
  if (!achado) throw new Error(`Centro de Resultado "${valor}" nao existe`);
  return Number(achado.ID);
}

function acharEmpresa(valor: string, ctx: ContextoImportacao): number {
  const k = chave(valor);
  if (!k) throw new Error('Empresa e obrigatoria');
  const achado = ctx.empresas.find((empresa) => chave(empresa.NOME) === k);
  if (!achado) throw new Error(`Empresa "${valor}" nao existe`);
  return Number(achado.ID);
}

function acharCargo(valor: string, ctx: ContextoImportacao): string {
  const k = chave(valor);
  if (!k) throw new Error('Cargo e obrigatorio');
  const achado = ctx.cargos.find((cargo) => chave(cargo.NOME) === k);
  // Cadastrar o cargo junto seria pior: a aba Cargos define salario medio, e um
  // cargo criado as cegas entraria zerado nas projecoes.
  if (!achado) throw new Error(`Cargo "${valor}" nao existe — cadastre na aba Cargos e Salarios`);
  return String(achado.NOME);
}

// ── Definicao de cada aba ────────────────────────────────────────────

interface DefinicaoAba {
  tabela: string;
  /** Monta o registro a partir das celulas ja indexadas por rotulo de coluna. */
  montar: (celula: (coluna: string) => string, ctx: ContextoImportacao) => Record<string, unknown>;
  /** Identidade do registro, para recusar duplicata do banco e do proprio arquivo. */
  identidade: (registro: Record<string, unknown>) => string;
  /** Mesma identidade, lida de uma linha que ja esta no banco. */
  identidadeExistente: (linha: Record<string, unknown>) => string;
  /** Texto do erro quando a identidade ja existe. */
  duplicado: string;
}

const ABAS: Record<AbaImportavel, DefinicaoAba> = {
  colaboradores: {
    tabela: 'COLABORADOR',
    montar: (celula, ctx) => ({
      NOME: lerObrigatorio(celula('Nome'), 'Nome'),
      CARGO: acharCargo(celula('Cargo'), ctx),
      CR_ID: acharCr(celula('Centro de Resultado'), ctx),
      EMPRESA_ID: acharEmpresa(celula('Empresa'), ctx),
      TIPO_CONTRATO: lerOpcao(celula('Tipo de Contrato'), 'Tipo de Contrato', ['CLT', 'PJ']),
      DATA_ADMISSAO: lerData(celula('Data de Admissao'), 'Data de Admissao'),
      SALARIO: lerDecimal(celula('Salario'), 'Salario'),
      ATIVO: lerSimNao(celula('Ativo'), 'Ativo'),
    }),
    identidade: (r) => `${chave(r.NOME)}|${referencia(r.CR_ID)}`,
    identidadeExistente: (l) => `${chave(l.NOME)}|${referencia(l.CR_ID)}`,
    duplicado: 'ja existe um colaborador com este nome neste centro de resultado',
  },
  cargos: {
    tabela: 'CARGO',
    montar: (celula) => ({
      NOME: lerObrigatorio(celula('Cargo'), 'Cargo'),
      SALARIO_MEDIO: lerDecimal(celula('Salario Medio'), 'Salario Medio'),
      ATIVO: lerSimNao(celula('Ativo'), 'Ativo'),
    }),
    identidade: (r) => chave(r.NOME),
    identidadeExistente: (l) => chave(l.NOME),
    duplicado: 'este cargo ja esta cadastrado',
  },
  beneficios: {
    tabela: 'BENEFICIO',
    montar: (celula, ctx) => ({
      NOME: lerObrigatorio(celula('Nome'), 'Nome'),
      TIPO: lerOpcao(celula('Tipo'), 'Tipo', ['FIXO', 'PERCENTUAL']),
      VALOR: lerDecimal(celula('Valor'), 'Valor'),
      PERCENTUAL: lerDecimal(celula('Percentual'), 'Percentual'),
      APLICA_CLT: lerSimNao(celula('Aplica CLT'), 'Aplica CLT'),
      APLICA_PJ: lerSimNao(celula('Aplica PJ'), 'Aplica PJ'),
      CICLO_ID: ctx.cicloId,
    }),
    identidade: (r) => chave(r.NOME),
    identidadeExistente: (l) => chave(l.NOME),
    duplicado: 'este beneficio ja esta cadastrado nesta versao',
  },
  encargos: {
    tabela: 'ENCARGO',
    montar: (celula, ctx) => ({
      NOME: lerObrigatorio(celula('Nome'), 'Nome'),
      PERCENTUAL: lerDecimal(celula('Percentual'), 'Percentual'),
      APLICA_CLT: lerSimNao(celula('Aplica CLT'), 'Aplica CLT'),
      APLICA_PJ: lerSimNao(celula('Aplica PJ'), 'Aplica PJ'),
      CICLO_ID: ctx.cicloId,
    }),
    identidade: (r) => chave(r.NOME),
    identidadeExistente: (l) => chave(l.NOME),
    duplicado: 'este encargo ja esta cadastrado nesta versao',
  },
  dissidio: {
    tabela: 'PREMISSA_DISSIDIO',
    montar: (celula, ctx) => ({
      EMPRESA_ID: acharEmpresa(celula('Empresa'), ctx),
      PERCENTUAL: lerDecimal(celula('Percentual'), 'Percentual'),
      MES_APLICACAO: lerMes(celula('Mes de Aplicacao'), 'Mes de Aplicacao'),
      CICLO_ID: ctx.cicloId,
      CRIADO_EM: new Date().toISOString().slice(0, 19),
    }),
    identidade: (r) => referencia(r.EMPRESA_ID),
    identidadeExistente: (l) => referencia(l.EMPRESA_ID),
    duplicado: 'esta empresa ja tem dissidio nesta versao — edite direto na tabela',
  },
  turnover: {
    tabela: 'PREMISSA_TURNOVER',
    montar: (celula, ctx) => ({
      EMPRESA_ID: acharEmpresa(celula('Empresa'), ctx),
      PERCENTUAL: lerDecimal(celula('Turnover Anual'), 'Turnover Anual'),
      CICLO_ID: ctx.cicloId,
      CRIADO_EM: new Date().toISOString().slice(0, 19),
    }),
    identidade: (r) => referencia(r.EMPRESA_ID),
    identidadeExistente: (l) => referencia(l.EMPRESA_ID),
    duplicado: 'esta empresa ja tem turnover nesta versao — edite direto na tabela',
  },
};

export function tabelaDaAba(aba: AbaImportavel): string {
  return ABAS[aba].tabela;
}

// ── Leitura do arquivo ───────────────────────────────────────────────

export function prepararImportacao(
  aba: AbaImportavel,
  textoCsv: string,
  ctx: ContextoImportacao,
): ResultadoImportacao {
  const definicao = ABAS[aba];
  const colunas = [...TEMPLATES_FOLHA[aba].colunas];
  const vazio: ResultadoImportacao = {
    colunas, validas: [], invalidas: [], erroArquivo: null, tabela: definicao.tabela,
  };

  const linhas = lerCsv(textoCsv);
  if (linhas.length === 0) return { ...vazio, erroArquivo: 'O arquivo esta vazio.' };

  // Cabecalho localizado por rotulo, nao por posicao: coluna a mais ou fora de
  // ordem nao deveria impedir a importacao. Faltando alguma, o arquivo inteiro
  // e recusado — adivinhar coluna de folha e como errar salario calado.
  const cabecalho = linhas[0].map(chave);
  const indices = new Map<string, number>();
  const faltando: string[] = [];
  for (const coluna of colunas) {
    const indice = cabecalho.indexOf(chave(coluna));
    if (indice === -1) faltando.push(coluna);
    else indices.set(coluna, indice);
  }
  if (faltando.length > 0) {
    return {
      ...vazio,
      erroArquivo: `O arquivo nao tem as colunas do template. Faltando: ${faltando.join(', ')}. Baixe o Template CSV e preencha sobre ele.`,
    };
  }

  const corpo = linhas.slice(1);
  if (corpo.length === 0) return { ...vazio, erroArquivo: 'O arquivo so tem o cabecalho, sem nenhuma linha de dados.' };

  const jaNoBanco = new Set(ctx.existentes.map((linha) => definicao.identidadeExistente(linha)));
  const jaNoArquivo = new Set<string>();
  const validas: LinhaImportada[] = [];
  const invalidas: LinhaImportada[] = [];

  corpo.forEach((valores, i) => {
    const linha = i + 2; // +1 do cabecalho, +1 porque planilha comeca em 1
    const celula = (coluna: string) => valores[indices.get(coluna) as number] ?? '';
    try {
      const registro = definicao.montar(celula, ctx);
      const identidade = definicao.identidade(registro);
      if (jaNoBanco.has(identidade)) throw new Error(`Ignorada: ${definicao.duplicado}`);
      if (jaNoArquivo.has(identidade)) throw new Error('Ignorada: repetida no proprio arquivo');
      jaNoArquivo.add(identidade);
      validas.push({ linha, valores, registro, erro: null });
    } catch (e) {
      invalidas.push({ linha, valores, registro: null, erro: (e as Error).message });
    }
  });

  return { ...vazio, validas, invalidas };
}
