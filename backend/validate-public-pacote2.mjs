import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch {} }
  return o?.rows || [];
};
const sf147 = async (input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 147, input });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch {} }
  return o;
};
const ctx = (await q(`SELECT t.TOKEN, t.CICLO_ID, ps.DRIVER_ID FROM PREENCHIMENTO_TOKEN t
  JOIN PACOTE_STATUS ps ON ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID
  JOIN CICLO c ON c.ID = t.CICLO_ID AND c.STATUS <> 'FECHADO'
  WHERE t.ATIVO = 'true' AND ps.STATUS IN ('PENDENTE','CONFIRMADO','REPROVADO') ORDER BY t.ID DESC LIMIT 1`))[0];
const linha = (await q(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${ctx.DRIVER_ID} LIMIT 1`))[0];
if (!linha) { console.log('pacote sem linha de modelo — pulado'); process.exit(0); }
const readV = async () => (await q(`SELECT VALOR FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = ${linha.ID} AND CICLO_ID = ${ctx.CICLO_ID} AND PACOTE_ID = ${ctx.DRIVER_ID} AND CR_ID = 0 AND MES = 2`))[0];
const antes = await readV();
console.log('[1] linha antes:', JSON.stringify(antes || null));
console.log('[2] pkgLineCells:', JSON.stringify(await sf147({ token: ctx.TOKEN, op: 'pkgLineCells', pacoteId: Number(ctx.DRIVER_ID), cells: [{ formulaId: Number(linha.ID), mes: 2, valor: 555321, crId: 0 }] })));
const depois = await readV();
console.log('[3] gravou?', depois && Number(depois.VALOR) === 555321, JSON.stringify(depois || null));
if (antes) await sf147({ token: ctx.TOKEN, op: 'pkgLineCells', pacoteId: Number(ctx.DRIVER_ID), cells: [{ formulaId: Number(linha.ID), mes: 2, valor: Number(antes.VALOR), crId: 0 }] });
else await runDmlMitra({ projectId, sql: `DELETE FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = ${linha.ID} AND CICLO_ID = ${ctx.CICLO_ID} AND PACOTE_ID = ${ctx.DRIVER_ID} AND CR_ID = 0 AND MES = 2 AND VALOR = 555321` });
console.log('[4] restaurado:', JSON.stringify((await readV()) || null));
if (!(depois && Number(depois.VALOR) === 555321)) process.exit(1);
