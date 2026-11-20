// ──────────────────────────────────────────────────────────────────────
// Geracao e download de CSV.
//
// Duas escolhas deliberadas para o arquivo abrir certo no Excel em portugues:
//  - separador ponto e virgula: com virgula, o Excel pt-BR joga a linha toda
//    numa coluna so, porque a virgula ali e separador decimal;
//  - BOM UTF-8 no inicio: sem ele o Excel le como Latin-1 e os acentos viram
//    caracteres trocados.
// ──────────────────────────────────────────────────────────────────────

const SEPARADOR = ';';
const BOM = '﻿';

export function escaparCampoCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  // Aspas, separador e quebra de linha obrigam a envolver o campo em aspas,
  // dobrando as aspas internas (RFC 4180).
  if (texto.includes('"') || texto.includes(SEPARADOR) || texto.includes('\n') || texto.includes('\r')) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export function montarCsv(linhas: unknown[][]): string {
  return linhas.map((linha) => linha.map(escaparCampoCsv).join(SEPARADOR)).join('\r\n');
}

export function baixarCsv(nomeArquivo: string, linhas: unknown[][]): void {
  const conteudo = BOM + montarCsv(linhas);
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Sem revoke o blob fica retido na memoria da aba ate ela ser fechada.
  URL.revokeObjectURL(url);
}

export interface TemplateCsv {
  arquivo: string;
  colunas: string[];
  exemplos: string[][];
}

export function baixarTemplateCsv(template: TemplateCsv): void {
  baixarCsv(template.arquivo, [template.colunas, ...template.exemplos]);
}

// ── Leitura ──────────────────────────────────────────────────────────
// O caminho de volta do download acima: o arquivo que o usuario devolve
// preenchido. Aceita ponto e virgula (o que geramos, e o que o Excel pt-BR
// grava) e virgula, porque planilha exportada do Google Sheets sai com
// virgula mesmo em portugues — recusar o arquivo por causa disso seria
// atrito sem motivo.
function detectarSeparador(texto: string): string {
  // Olha so a primeira linha, e fora das aspas: um cabecalho como
  // "Nome;Cargo" nao tem aspas, mas um valor com virgula pode ter.
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
  let dentroDeAspas = false;
  let pontoEVirgula = 0;
  let virgulas = 0;
  for (const caractere of primeiraLinha) {
    if (caractere === '"') dentroDeAspas = !dentroDeAspas;
    else if (dentroDeAspas) continue;
    else if (caractere === ';') pontoEVirgula++;
    else if (caractere === ',') virgulas++;
  }
  return virgulas > pontoEVirgula ? ',' : SEPARADOR;
}

// Devolve a matriz de celulas ja sem aspas. Linhas totalmente vazias somem —
// planilha salva quase sempre traz uma linha em branco no fim, e ela nao e um
// registro a importar.
export function lerCsv(texto: string): string[][] {
  const conteudo = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const separador = detectarSeparador(conteudo);

  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let dentroDeAspas = false;

  const fecharCampo = () => { linha.push(campo.trim()); campo = ''; };
  const fecharLinha = () => {
    fecharCampo();
    if (linha.some((celula) => celula !== '')) linhas.push(linha);
    linha = [];
  };

  for (let i = 0; i < conteudo.length; i++) {
    const caractere = conteudo[i];
    if (dentroDeAspas) {
      // Aspas dobradas dentro do campo sao uma aspa literal (RFC 4180).
      if (caractere === '"' && conteudo[i + 1] === '"') { campo += '"'; i++; }
      else if (caractere === '"') dentroDeAspas = false;
      else campo += caractere;
      continue;
    }
    if (caractere === '"') dentroDeAspas = true;
    else if (caractere === separador) fecharCampo();
    else if (caractere === '\r') { /* o \n seguinte fecha a linha */ }
    else if (caractere === '\n') fecharLinha();
    else campo += caractere;
  }
  // Ultimo registro quando o arquivo nao termina em quebra de linha.
  if (campo !== '' || linha.length > 0) fecharLinha();

  return linhas;
}

// O template sai daqui em UTF-8 com BOM, mas o Excel so devolve UTF-8 quando o
// usuario escolhe "CSV UTF-8" ao salvar — no "CSV" comum ele grava Windows-1252
// e os acentos chegariam como caractere de substituicao. Decodifica como UTF-8 e,
// se aparecer lixo, refaz em Windows-1252.
export function decodificarCsv(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return utf8;
  }
}

// Numero como o usuario digita na planilha em portugues: "7.500,00", "7500,00",
// "R$ 1.234,56" e ate "1234.56" (quem editou no Sheets em ingles). A regra:
// existindo os dois separadores, o ULTIMO e o decimal e o outro e milhar.
export function lerNumero(valor: string): number | null {
  const limpo = String(valor ?? '').replace(/[^\d,.-]/g, '');
  if (limpo === '' || limpo === '-') return null;

  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  let normalizado: string;
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    const decimal = ultimaVirgula > ultimoPonto ? ',' : '.';
    const milhar = decimal === ',' ? '.' : ',';
    normalizado = limpo.split(milhar).join('').replace(decimal, '.');
  } else if (ultimaVirgula >= 0) {
    normalizado = limpo.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpo)) {
    // So pontos, todos separando grupos de 3: "1.500" e "1.234.567" sao milhar
    // em portugues, nao decimal. Sem esta regra "7.500" viraria 7,5 — e salario
    // nao tem casa decimal solitaria assim. "4.5" nao casa e segue decimal.
    normalizado = limpo.split('.').join('');
  } else {
    normalizado = limpo;
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}
