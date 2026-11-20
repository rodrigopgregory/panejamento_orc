// Validação das ops de pacote da SF 147: gates com token inválido (sem efeito)
// e escrita real com token ativo + restauração do valor original.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
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
  if (r?.result?.executionStatus === 'FAILED') throw new Error(r?.result?.error);
  return o;
};

const BAD = '00000000-0000-0000-0000-000000000000';
console.log('[1] submeterPacote token invalido:', JSON.stringify(await sf147({ token: BAD, op: 'submeterPacote', pacoteId: 24 })));
console.log('[2] pkgCells sem pacoteId:', JSON.stringify(await sf147({ token: BAD, op: 'pkgCells' })));

// contexto real: token ativo de um gestor com pacote editavel (PENDENTE/CONFIRMADO/REPROVADO)
const ctx = (await q(`SELECT t.TOKEN, t.GESTOR_ID, t.CICLO_ID, ps.DRIVER_ID, ps.STATUS
  FROM PREENCHIMENTO_TOKEN t
  JOIN PACOTE_STATUS ps ON ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID
  JOIN CICLO c ON c.ID = t.CICLO_ID AND c.STATUS <> 'FECHADO'
  WHERE t.ATIVO = 'true' AND ps.STATUS IN ('PENDENTE','CONFIRMADO','REPROVADO')
  ORDER BY t.ID DESC LIMIT 1`))[0];
if (!ctx) { console.log('[3-6] sem token ativo com pacote editavel — validacao de escrita pulada'); process.exit(0); }
console.log('[3] ctx:', JSON.stringify({ GESTOR_ID: ctx.GESTOR_ID, CICLO_ID: ctx.CICLO_ID, DRIVER_ID: ctx.DRIVER_ID, STATUS: ctx.STATUS }));

// par (conta, cr) valido do pacote
const par = (await q(`SELECT crc.CR_ID, crc.CONTA_ID FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  WHERE crc.ATIVO = true AND COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) = ${ctx.DRIVER_ID} LIMIT 1`))[0];
if (!par) { console.log('[4-6] pacote sem par conta x CR — pulado'); process.exit(0); }

const readCell = async () => (await q(`SELECT VALOR FROM ORCAMENTO_PACOTE WHERE CICLO_ID = ${ctx.CICLO_ID} AND DRIVER_ID = ${ctx.DRIVER_ID} AND CR_ID = ${par.CR_ID} AND CONTA_ID = ${par.CONTA_ID} AND MES = 1`))[0];
const antes = await readCell();
console.log('[4] celula antes:', JSON.stringify(antes || null));

const MAGIC = 777123;
console.log('[5] pkgCells token valido:', JSON.stringify(await sf147({ token: ctx.TOKEN, op: 'pkgCells', pacoteId: Number(ctx.DRIVER_ID), cells: [{ contaId: Number(par.CONTA_ID), mes: 1, valor: MAGIC, crId: Number(par.CR_ID) }] })));
const depois = await readCell();
const gravou = depois && Number(depois.VALOR) === MAGIC;
console.log('    gravou?', gravou, JSON.stringify(depois || null));

// restaura o estado original
if (antes) {
  await sf147({ token: ctx.TOKEN, op: 'pkgCells', pacoteId: Number(ctx.DRIVER_ID), cells: [{ contaId: Number(par.CONTA_ID), mes: 1, valor: Number(antes.VALOR), crId: Number(par.CR_ID) }] });
} else {
  const { runDmlMitra } = await import('mitra-sdk');
  await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO_PACOTE WHERE CICLO_ID = ${ctx.CICLO_ID} AND DRIVER_ID = ${ctx.DRIVER_ID} AND CR_ID = ${par.CR_ID} AND CONTA_ID = ${par.CONTA_ID} AND MES = 1 AND VALOR = ${MAGIC}` });
}
console.log('[6] restaurado:', JSON.stringify((await readCell()) || null));

// escrita com token INVALIDO nao pode afetar a celula
await sf147({ token: BAD, op: 'pkgCells', pacoteId: Number(ctx.DRIVER_ID), cells: [{ contaId: Number(par.CONTA_ID), mes: 1, valor: 999999, crId: Number(par.CR_ID) }] });
const aposBad = await readCell();
console.log('[7] apos escrita com token invalido (deve ser igual ao [6]):', JSON.stringify(aposBad || null));
if (!gravou) process.exit(1);
