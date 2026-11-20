import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const ex = async (id, input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows ?? o;
};
const jb = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } } return Array.isArray(v) ? v : [];  };

// A) snapshot preenchido nas versoes fechadas + tokens desativados
console.log('A) snapshots:', JSON.stringify(await q(`SELECT os.CICLO_ID, c.STATUS, COUNT(*) N, SUM(os.TOTAL_MODELOS IS NOT NULL) COM_SNAPSHOT FROM ORCAMENTO_STATUS os JOIN CICLO c ON c.ID=os.CICLO_ID GROUP BY os.CICLO_ID, c.STATUS ORDER BY os.CICLO_ID`)));
console.log('   tokens ativos por status de ciclo:', JSON.stringify(await q(`SELECT c.STATUS, SUM(t.ATIVO='true') ATIVOS, COUNT(*) TOTAL FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID GROUP BY c.STATUS`)));

// B) SF 122 nao traz mais FECHADO
const b122 = (await ex(122, {}))[0] || {};
const cicloRows = jb(b122.CICLOS);
console.log('B) SF 122 ciclos:', cicloRows.map(c => `${c.NOME}(${c.STATUS})`).join(', '), cicloRows.every(c => c.STATUS !== 'FECHADO') ? 'OK' : '!!! FECHADO PRESENTE');

// C) SF 95/96: ciclo INICIADA (live) e FECHADO (snapshot)
console.log('C) SF95 ciclo 121 (iniciada, live):', JSON.stringify(await ex(95, { cicloId: 121 })));
console.log('   SF95 ciclo 114 (fechada, snapshot):', JSON.stringify(await ex(95, { cicloId: 114 })));
console.log('   SF96 ciclo 121:', JSON.stringify(await ex(96, { cicloId: 121 })));
console.log('   SF96 ciclo 114:', JSON.stringify(await ex(96, { cicloId: 114 })));

// D) escrita publica bloqueada em ciclo FECHADO (reativo um token temporariamente)
const tk = (await q(`SELECT t.ID, t.TOKEN, t.CICLO_ID, gc.CR_ID FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID AND c.STATUS='FECHADO' JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID ORDER BY t.ID DESC LIMIT 1`))[0];
if (tk) {
  await runDmlMitra({ projectId, sql: `UPDATE PREENCHIMENTO_TOKEN SET ATIVO='true' WHERE ID=${tk.ID}` });
  const contaId = Number((await q(`SELECT CONTA_ID FROM CR_CONTA WHERE CR_ID=${tk.CR_ID} AND ATIVO=true LIMIT 1`))[0].CONTA_ID);
  const before = await q(`SELECT COUNT(*) N FROM ORCAMENTO WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${tk.CR_ID} AND CONTA_ID=${contaId} AND MES=10 AND VALOR=999888`);
  // tenta escrever na versao fechada com token ATIVO — os gates de ciclo devem bloquear
  await ex(147, { token: tk.TOKEN, op: 'orcCells', crId: Number(tk.CR_ID), cells: [{ contaId, mes: 10, valor: 999888 }] });
  await ex(69,  { token: tk.TOKEN, crId: Number(tk.CR_ID), valores: [{ contaId, mes: 10, valor: 999888 }] });
  const after = await q(`SELECT COUNT(*) N FROM ORCAMENTO WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${tk.CR_ID} AND CONTA_ID=${contaId} AND MES=10 AND VALOR=999888`);
  console.log(`D) escrita em ciclo FECHADO (SF147 e SF69, token ativo): antes=${before[0].N} depois=${after[0].N}`, Number(after[0].N) === Number(before[0].N) ? 'BLOQUEADA OK' : '!!! ESCREVEU');
  const st = await q(`SELECT STATUS FROM ORCAMENTO_STATUS WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${tk.CR_ID} LIMIT 1`);
  await ex(70, { token: tk.TOKEN, crId: Number(tk.CR_ID) });
  const st2 = await q(`SELECT STATUS FROM ORCAMENTO_STATUS WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${tk.CR_ID} LIMIT 1`);
  console.log(`   submeter em ciclo FECHADO: ${JSON.stringify(st)} -> ${JSON.stringify(st2)}`, JSON.stringify(st) === JSON.stringify(st2) ? 'BLOQUEADO OK' : '!!! MUDOU');
  await runDmlMitra({ projectId, sql: `UPDATE PREENCHIMENTO_TOKEN SET ATIVO='false' WHERE ID=${tk.ID}` });
  console.log('   token de teste desativado de volta');
}

// E) escrita na versao INICIADA continua funcionando (regressao)
const tkOk = (await q(`SELECT t.TOKEN, t.CICLO_ID, gc.CR_ID FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID AND c.STATUS='INICIADA' JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID WHERE t.ATIVO='true' AND NOT EXISTS (SELECT 1 FROM ORCAMENTO_STATUS os WHERE os.CICLO_ID=t.CICLO_ID AND os.CR_ID=gc.CR_ID AND os.STATUS IN ('APROVADO')) LIMIT 1`))[0];
if (tkOk) {
  const contaId = Number((await q(`SELECT CONTA_ID FROM CR_CONTA WHERE CR_ID=${tkOk.CR_ID} AND ATIVO=true LIMIT 1`))[0].CONTA_ID);
  const orig = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID=${tkOk.CICLO_ID} AND CR_ID=${tkOk.CR_ID} AND CONTA_ID=${contaId} AND MES=9`);
  await ex(147, { token: tkOk.TOKEN, op: 'orcCells', crId: Number(tkOk.CR_ID), cells: [{ contaId, mes: 9, valor: 555444 }] });
  const w = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID=${tkOk.CICLO_ID} AND CR_ID=${tkOk.CR_ID} AND CONTA_ID=${contaId} AND MES=9`);
  console.log(`E) escrita em INICIADA: ${w[0]?.VALOR}`, Number(w[0]?.VALOR) === 555444 ? 'FUNCIONA OK' : '!!!');
  if (orig.length) await ex(147, { token: tkOk.TOKEN, op: 'orcCells', crId: Number(tkOk.CR_ID), cells: [{ contaId, mes: 9, valor: Number(orig[0].VALOR) }] });
  else await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO WHERE CICLO_ID=${tkOk.CICLO_ID} AND CR_ID=${tkOk.CR_ID} AND CONTA_ID=${contaId} AND MES=9 AND VALOR=555444` });
  console.log('   restaurado');
}

// F) SF 170 housekeeping funciona (dry-run num ciclo fechado ja com snapshot — idempotente)
const hk = await ex(170, { cicloIds: [114] });
console.log('F) SF170 housekeeping ciclo 114:', JSON.stringify(hk));
