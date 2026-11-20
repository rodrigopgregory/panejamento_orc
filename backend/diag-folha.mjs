import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = res?.result?.output;
  if (typeof o === 'string') try { o = JSON.parse(o); } catch {}
  return (o && Array.isArray(o.rows)) ? o.rows : (Array.isArray(o) ? o : []);
}
const p = (t, rows) => { console.log(`\n=== ${t} ===`); if (!rows.length) return console.log('  (vazio)'); rows.forEach(r => console.log('  ' + JSON.stringify(r))); };

async function main() {
  p('CR_CONTA das contas 5.1.x (quais CRs enxergam cada conta)', await query(
    "SELECT cc.CODIGO, cc.ID AS CONTA_ID, GROUP_CONCAT(cr.CODIGO ORDER BY cr.CODIGO) AS CRS FROM CR_CONTA rc JOIN CONTA_CONTABIL cc ON cc.ID=rc.CONTA_ID JOIN CENTRO_RESULTADO cr ON cr.ID=rc.CR_ID WHERE cc.CODIGO LIKE '5.1%' AND rc.ATIVO=true GROUP BY cc.ID, cc.CODIGO ORDER BY cc.CODIGO"));

  p('Driver resolvido por CONTA x CR para 5.1.x (o que o grafico enxerga)', await query(
    `SELECT cc.CODIGO, cr.CODIGO AS CR, COALESCE(d2.NOME, d1.NOME) AS DRIVER
     FROM CR_CONTA rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
     LEFT JOIN DRIVERS d2 ON d2.ID = cde.DRIVER_ID
     LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
     LEFT JOIN DRIVERS d1 ON d1.ID = cd.DRIVER_ID
     WHERE cc.CODIGO LIKE '5.1%' AND rc.ATIVO = true
     ORDER BY cc.CODIGO, cr.CODIGO`));

  p('CONTA_DRIVER bruto para 5.1.x', await query(
    "SELECT cc.CODIGO, cc.ID AS CONTA_ID, d.NOME AS DRIVER, cd.PACOTE_ID FROM CONTA_DRIVER cd JOIN CONTA_CONTABIL cc ON cc.ID=cd.CONTA_ID LEFT JOIN DRIVERS d ON d.ID=cd.DRIVER_ID WHERE cc.CODIGO LIKE '5.1%' ORDER BY cc.CODIGO"));

  p('Linhas do DRE (prefixos usados)', await query("SELECT * FROM DRE_LINHA ORDER BY ORDEM").catch(() => []));

  p('Tabelas existentes', await query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME NOT LIKE 'INT_%' ORDER BY TABLE_NAME"));
}
main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
