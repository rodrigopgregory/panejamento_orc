// AJUSTE DE DADOS — APAGA lancamentos. Ciclo vigente (nao FECHADO) apenas.
//
// Expurga do ORCAMENTO o que esta no grupo 5.1 de um CR mas nao saiu do calculo
// da folha daquele CR. A regra que define "residuo" e a de
// auditoria-pessoal-dre.mjs: a folha e a dona do grupo 5.1 de um CR, entao o
// valor legitimo e exatamente o que a gravacao da folha (SF 61) escreveu nos
// tres destinos — 5.1.01.01 (salario), 5.1.02 (encargos), 5.1.03 (beneficios).
//
// Na pratica o residuo aparece de dois jeitos:
//   - CR sem folha calculada, mas com saldo no grupo 5.1 (CR002, CR007)
//   - CR com folha calculada e saldo por cima, nas analiticas que a folha nao
//     escreve: 5.1.02.01, 5.1.02.02, 5.1.03.01, 5.1.03.02, 5.1.04
//
// O CR001 e a prova da regra: unico com folha calculada e confirmada, e nele as
// analiticas estao vazias.
//
// O que este script NAO faz: nao toca em ORCAMENTO_PESSOAL (a projecao por
// colaborador), nao toca nos tres destinos de um CR com folha calculada, e nao
// toca em ciclo FECHADO.
//
// Uso: node limpar-residuo-pessoal.mjs           (simulacao, nao apaga)
//      node limpar-residuo-pessoal.mjs --aplicar (apaga de verdade)
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const APLICAR = process.argv.includes('--aplicar');
const DESTINOS_FOLHA = ['5.1.01.01', '5.1.02', '5.1.03'];

const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, STATUS FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) throw new Error('nenhum ciclo vigente');
  if (ciclo.STATUS === 'FECHADO') throw new Error(`ciclo ${ciclo.ID} esta FECHADO — nao se mexe em versao fechada`);
  console.log(`Ciclo ${ciclo.ID} — ${ciclo.NOME} (${ciclo.STATUS})`);
  console.log(APLICAR ? 'MODO: APLICAR (vai apagar)\n' : 'MODO: simulacao (nada sera apagado)\n');

  // CRs com folha calculada — neles os tres destinos sao intocaveis.
  const comFolha = new Set(
    (await q(`SELECT DISTINCT CR_ID FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${ciclo.ID}`)).map((r) => Number(r.CR_ID)));

  const linhas = await q(`
    SELECT cr.ID AS CR_ID, cr.CODIGO AS CR, cc.CODIGO AS CONTA, cc.ID AS CONTA_ID,
           ROUND(SUM(o.VALOR), 2) AS VALOR, COUNT(*) AS MESES
    FROM ORCAMENTO o
    JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
    JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
    WHERE o.CICLO_ID = ${ciclo.ID} AND cc.CODIGO LIKE '5.1%'
    GROUP BY cr.ID, cr.CODIGO, cc.CODIGO, cc.ID
    ORDER BY cr.CODIGO, cc.CODIGO`);

  // Residuo = tudo que nao e destino-da-folha-em-CR-com-folha.
  const alvos = linhas.filter((l) => !(comFolha.has(Number(l.CR_ID)) && DESTINOS_FOLHA.includes(l.CONTA)));
  if (!alvos.length) { console.log('Nenhum residuo. Nada a fazer.'); return; }

  let total = 0;
  let crAtual = '';
  for (const a of alvos) {
    if (a.CR !== crAtual) {
      crAtual = a.CR;
      console.log(`${a.CR}${comFolha.has(Number(a.CR_ID)) ? ' (folha calculada — destinos preservados)' : ' (SEM folha calculada)'}:`);
    }
    console.log(`  ${a.CONTA.padEnd(11)} ${brl(a.VALOR).padStart(13)}  (${a.MESES} meses)`);
    total += Number(a.VALOR);
  }
  console.log(`\nTotal a expurgar: ${brl(total)} em ${alvos.length} conta(s)/CR`);

  if (!APLICAR) {
    console.log('\nSimulacao. Rode com --aplicar para efetivar.');
    return;
  }

  // Apaga por par (CR, conta) — nunca a conta inteira do ciclo.
  //
  // A contagem sai de um COUNT antes e depois, nao do retorno do DML: o nome do
  // campo de linhas afetadas varia conforme o driver e ler o campo errado faz o
  // script relatar "0 apagados" numa operacao que apagou 2,3 milhoes — um
  // silencio pior do que erro nenhum.
  const contar = async () => Number((await q(
    `SELECT COUNT(*) AS N FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
     WHERE o.CICLO_ID = ${ciclo.ID} AND cc.CODIGO LIKE '5.1%'`))[0]?.N || 0);
  const antes = await contar();
  for (const a of alvos) {
    await runDmlMitra({
      projectId,
      sql: `DELETE FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CR_ID = ${a.CR_ID} AND CONTA_ID = ${a.CONTA_ID}`,
    });
  }
  console.log(`\nLinhas apagadas: ${antes - (await contar())}`);

  const [depois] = await q(`
    SELECT ROUND(SUM(o.VALOR), 2) AS TOTAL FROM ORCAMENTO o
    JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
    WHERE o.CICLO_ID = ${ciclo.ID} AND cc.CODIGO LIKE '5.1%'`);
  const [projetado] = await q(`SELECT ROUND(SUM(TOTAL), 2) AS TOTAL FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${ciclo.ID}`);
  console.log(`Grupo 5.1 no DRE: ${brl(depois?.TOTAL)}   folha projetada: ${brl(projetado?.TOTAL)}`);
  console.log(Math.abs(Number(depois?.TOTAL) - Number(projetado?.TOTAL)) < 0.05
    ? 'OK — o DRE de pessoal agora e exatamente a folha calculada.'
    : 'ATENCAO — ainda ha diferenca; rode auditoria-pessoal-dre.mjs.');
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
