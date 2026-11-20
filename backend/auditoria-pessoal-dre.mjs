// AUDITORIA SOMENTE-LEITURA — nao altera nada.
//
// FRAMEWORK: a folha e a dona do grupo 5.1 de um CR.
//
// O grupo de contas de pessoal (5.1) de um centro de resultado nao e um balde
// onde se lanca a mao. Ele e o resultado do calculo da folha daquele CR. Logo,
// para um CR entrar no DRE com despesa de pessoal, duas coisas tem de ser
// verdade ao mesmo tempo:
//
//   1. a folha daquele CR foi CALCULADA  (ha linha em ORCAMENTO_PESSOAL)
//   2. o driver PESSOAL foi CONFIRMADO   (ORCAMENTO_STATUS.DRIVERS_CONFIRMADOS)
//
// E o valor no ORCAMENTO tem de ser IGUAL ao projetado. Nao "parecido", nao
// "maior porque tem outras coisas": igual. Qualquer centavo alem disso nao saiu
// da folha — e residuo, e o DRE (que agrega por prefixo 5.1) soma esse residuo
// como se fosse despesa real.
//
// Nao existe nuance de conta-mae x conta-filha aqui: num CR com a folha rodada
// direito, as analiticas ficam vazias porque a folha grava so nos tres destinos
// (5.1.01.01 salario, 5.1.02 encargos, 5.1.03 beneficios). Valor numa analitica
// e sintoma de lancamento que passou por fora do calculo.
//
// Uso: node auditoria-pessoal-dre.mjs
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => Number(v || 0);

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, ANO, STATUS FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) { console.log('Nenhum ciclo vigente.'); return; }
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME} (${ciclo.STATUS})\n`);

  const linhas = await q(`
    SELECT cr.ID AS CR_ID, cr.CODIGO AS CR,
      (SELECT ROUND(SUM(op.TOTAL), 2) FROM ORCAMENTO_PESSOAL op
        WHERE op.CICLO_ID = ${ciclo.ID} AND op.CR_ID = cr.ID) AS PROJETADO,
      (SELECT s.STATUS FROM ORCAMENTO_STATUS s
        WHERE s.CICLO_ID = ${ciclo.ID} AND s.CR_ID = cr.ID LIMIT 1) AS STATUS,
      (SELECT s.DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS s
        WHERE s.CICLO_ID = ${ciclo.ID} AND s.CR_ID = cr.ID LIMIT 1) AS CONFIRMADOS,
      (SELECT ROUND(SUM(o.VALOR), 2) FROM ORCAMENTO o
        JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
        WHERE o.CICLO_ID = ${ciclo.ID} AND o.CR_ID = cr.ID AND cc.CODIGO LIKE '5.1%') AS NO_DRE
    FROM CENTRO_RESULTADO cr ORDER BY cr.CODIGO`);

  // Onde exatamente esta o residuo, conta a conta.
  const detalhe = await q(`
    SELECT cr.CODIGO AS CR, cc.CODIGO AS CONTA, ROUND(SUM(o.VALOR), 2) AS VALOR
    FROM ORCAMENTO o
    JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
    JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
    WHERE o.CICLO_ID = ${ciclo.ID} AND cc.CODIGO LIKE '5.1%'
    GROUP BY cr.CODIGO, cc.CODIGO ORDER BY cr.CODIGO, cc.CODIGO`);
  const DESTINOS_FOLHA = ['5.1.01.01', '5.1.02', '5.1.03'];

  let totalDre = 0;
  let totalLegitimo = 0;
  let totalResiduo = 0;
  const problemas = [];

  console.log('== Regra aplicada CR a CR ==\n');
  for (const l of linhas) {
    const projetado = n(l.PROJETADO);
    const noDre = n(l.NO_DRE);
    const calculada = projetado > 0;
    const confirmada = String(l.CONFIRMADOS || '').split(',').includes('PESSOAL');
    totalDre += noDre;

    if (!calculada && noDre === 0) continue; // CR sem pessoal — nada a dizer

    const contasDoCr = detalhe.filter((d) => d.CR === l.CR);
    const foraDaFolha = contasDoCr.filter((d) => !DESTINOS_FOLHA.includes(d.CONTA));
    const residuoAnalitico = foraDaFolha.reduce((s, d) => s + n(d.VALOR), 0);

    let veredito;
    let residuo = 0;
    if (!calculada) {
      veredito = 'ERRADO — folha NAO calculada, mas ha valor caindo no DRE';
      residuo = noDre;
    } else if (Math.abs(noDre - projetado) > 0.05 && !confirmada) {
      // Sem confirmacao E com valor que nao bate: o excedente nao veio da folha.
      veredito = `ERRADO — folha calculada, nao confirmada, e o DRE conta mais do que foi projetado (status ${l.STATUS || 'sem registro'})`;
      residuo = noDre - projetado;
    } else if (!confirmada) {
      // Valor bate com a folha, so falta o gestor confirmar. Nao ha residuo: e
      // etapa do fluxo, nao defeito de dado. Marcar como erro aqui treinaria o
      // usuario a ignorar a auditoria.
      veredito = `A CONFIRMAR — o valor bate com a folha, mas o gestor ainda nao confirmou o driver PESSOAL (status ${l.STATUS || 'sem registro'})`;
    } else if (Math.abs(noDre - projetado) > 0.05) {
      veredito = 'ERRADO — folha calculada e confirmada, mas o DRE conta mais do que foi projetado';
      residuo = noDre - projetado;
    } else {
      veredito = 'OK — calculada, confirmada e o DRE bate com o projetado';
    }

    totalResiduo += Math.max(0, residuo);
    totalLegitimo += noDre - Math.max(0, residuo);

    console.log(`${l.CR}  ${veredito}`);
    console.log(`  calculada: ${calculada ? `sim (${brl(projetado)})` : 'NAO'}   confirmada: ${confirmada ? 'sim' : 'NAO'}   status: ${l.STATUS || '—'}`);
    console.log(`  no DRE: ${brl(noDre)}${residuo > 0.05 ? `   residuo: ${brl(residuo)}` : ''}`);
    if (residuo > 0.05 && residuoAnalitico > 0.05) {
      console.log(`  fora dos destinos da folha: ${foraDaFolha.map((d) => `${d.CONTA}=${brl(d.VALOR)}`).join('  ')}`);
    }
    console.log('');
    if (residuo > 0.05) problemas.push({ cr: l.CR, residuo, contas: foraDaFolha, calculada, confirmada, status: l.STATUS });
  }

  console.log('== Fechamento do grupo 5.1 no DRE ==');
  console.log(`  hoje no DRE:        ${brl(totalDre)}`);
  console.log(`  legitimo (folha):   ${brl(totalLegitimo)}`);
  console.log(`  residuo a expurgar: ${brl(totalResiduo)}`);
  console.log(`\n${problemas.length ? `${problemas.length} CR(s) fora da regra.` : 'Todos os CRs dentro da regra.'}`);
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
