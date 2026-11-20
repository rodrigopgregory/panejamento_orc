/**
 * Valida a consolidacao da folha ponta a ponta para os CRs que tem projecao
 * gravada na versao vigente: mostra o ORCAMENTO antes, roda limpar+gravar
 * (SF 60/61 — o mesmo par que o botao "Calcular Folha" dispara) e confere se o
 * lancado bate com ORCAMENTO_PESSOAL e se cai em conta que o grafico enxerga.
 *
 * Uso: node verify-folha-consolidacao.mjs [cicloId] [--apply]
 *   sem --apply  -> so diagnostico (nao escreve nada)
 *   com --apply  -> executa a consolidacao de fato
 */
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const CICLO = Number(process.argv[2]) || 133;
const APPLY = process.argv.includes('--apply');
// --cr=N restringe a um unico CR (usado para validar antes de aplicar em massa)
const SO_CR = (process.argv.find(a => a.startsWith('--cr=')) || '').split('=')[1];

async function q(sql) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(r?.result?.error);
  let o = r?.result?.output; if (typeof o === 'string') try { o = JSON.parse(o); } catch {}
  return (o && Array.isArray(o.rows)) ? o.rows : [];
}
async function sf(id, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  return r?.result?.output;
}
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const orcDe = (cr) => q(
  `SELECT cc.CODIGO, ROUND(SUM(o.VALOR),2) AS TOTAL FROM ORCAMENTO o
   JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
   WHERE o.CICLO_ID = ${CICLO} AND o.CR_ID = ${cr} AND cc.CODIGO LIKE '5.1%'
   GROUP BY cc.CODIGO ORDER BY cc.CODIGO`);

// Contas que o grafico de Pessoal enxerga = mapeamento vivo com driver PESSOAL
const contasVisiveis = (cr) => q(
  `SELECT cc.CODIGO FROM CR_CONTA rc
   JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
   LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
   LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
   LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
   WHERE rc.CR_ID = ${cr} AND rc.ATIVO = true AND d.NOME = 'PESSOAL'`);

async function main() {
  const ciclo = (await q(`SELECT NOME, STATUS FROM CICLO WHERE ID = ${CICLO}`))[0];
  console.log(`Ciclo ${CICLO} — ${ciclo?.NOME} (${ciclo?.STATUS})   modo=${APPLY ? 'APLICAR' : 'diagnostico'}\n`);

  const crs = await q(
    `SELECT op.CR_ID, cr.CODIGO, ROUND(SUM(op.SALARIO),2) AS SAL, ROUND(SUM(op.ENCARGOS),2) AS ENC,
            ROUND(SUM(op.BENEFICIOS),2) AS BEN, ROUND(SUM(op.TOTAL),2) AS TOT
     FROM ORCAMENTO_PESSOAL op JOIN CENTRO_RESULTADO cr ON cr.ID = op.CR_ID
     WHERE op.CICLO_ID = ${CICLO} GROUP BY op.CR_ID, cr.CODIGO ORDER BY cr.CODIGO`);

  if (!crs.length) return console.log('Nenhum CR com projecao de folha neste ciclo.');

  for (const c of crs) {
    if (SO_CR && String(c.CR_ID) !== String(SO_CR)) continue;
    console.log(`──────── ${c.CODIGO} (CR_ID ${c.CR_ID}) ────────`);
    console.log(`  Folha (ORCAMENTO_PESSOAL): salario ${brl(c.SAL)} | encargos ${brl(c.ENC)} | beneficios ${brl(c.BEN)} | total ${brl(c.TOT)}`);
    const antes = await orcDe(c.CR_ID);
    console.log(`  ORCAMENTO antes : ${antes.length ? antes.map(r => `${r.CODIGO}=${brl(r.TOTAL)}`).join('  ') : '(vazio)'}`);

    if (APPLY) {
      await sf(60, { cicloId: CICLO, crId: c.CR_ID });
      await sf(61, { cicloId: CICLO, crId: c.CR_ID });
      const depois = await orcDe(c.CR_ID);
      console.log(`  ORCAMENTO depois: ${depois.length ? depois.map(r => `${r.CODIGO}=${brl(r.TOTAL)}`).join('  ') : '(vazio)'}`);

      const vis = new Set((await contasVisiveis(c.CR_ID)).map(r => r.CODIGO));
      const esperado = { '5.1.01.01': Number(c.SAL), '5.1.02': Number(c.ENC), '5.1.03': Number(c.BEN) };
      let ok = true;
      for (const [cod, val] of Object.entries(esperado)) {
        const got = Number(depois.find(r => r.CODIGO === cod)?.TOTAL || 0);
        const bate = Math.abs(got - val) < 0.05;
        const visivel = vis.has(cod);
        if (!bate || !visivel) ok = false;
        console.log(`    ${bate ? 'OK ' : 'X  '} ${cod}: lancado ${brl(got)} vs folha ${brl(val)} | visivel no grafico: ${visivel ? 'sim' : 'NAO'}`);
      }
      const residuo = depois.find(r => r.CODIGO === '5.1.01');
      if (residuo) { ok = false; console.log(`    X   residuo em 5.1.01 = ${brl(residuo.TOTAL)} (deveria ter sido limpo)`); }
      console.log(`  => ${ok ? 'CONSOLIDACAO OK' : 'FALHOU'}`);
    }
    console.log('');
  }
}
main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
