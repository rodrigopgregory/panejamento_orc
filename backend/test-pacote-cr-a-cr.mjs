// Validacao com dados reais das correcoes de pacote CR a CR (leitura apenas).
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

const token = process.env.MITRA_TOKEN;
const baseURL = process.env.MITRA_BASE_URL;
const projectId = Number(process.env.MITRA_PROJECT_ID);
configureSdkMitra({ baseURL, token, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { /* keep */ } }
  return o?.rows || [];
};
const sf = async (id, input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { /* keep */ } }
  return o?.rows?.[0] || {};
};
const jf = (v) => { if (v == null) return []; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } } return Array.isArray(v) ? v : []; };

// 1. Ciclo aberto + gestor com pacote
const ciclo = (await q(`SELECT ID, ANO FROM CICLO WHERE STATUS <> 'FECHADO' ORDER BY ID DESC LIMIT 1`))[0];
const gp = (await q(`SELECT gp.GESTOR_ID, gp.DRIVER_ID, d.NOME FROM GESTOR_PACOTE gp JOIN DRIVERS d ON d.ID=gp.DRIVER_ID WHERE d.ATIVO='true' AND d.TIPO_DRIVER='PACOTE' LIMIT 1`))[0];
console.log('ciclo:', ciclo, '| gestor do pacote:', gp);

// 2. CR com conta delegada a pacote (para testar denominador + PKG_BUDGET)
const crDeleg = (await q(`SELECT crc.CR_ID, COUNT(*) N FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID=crc.CR_ID AND cde.CONTA_ID=crc.CONTA_ID AND cde.ATIVO=true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID=crc.CONTA_ID
  JOIN DRIVERS d ON d.ID=COALESCE(cde.PACOTE_ID,cd.PACOTE_ID,cde.DRIVER_ID,cd.DRIVER_ID)
  WHERE crc.ATIVO=true AND d.TIPO_DRIVER='PACOTE' AND d.ATIVO='true' GROUP BY crc.CR_ID LIMIT 1`))[0];
console.log('CR com conta delegada a pacote:', crDeleg);

// 3. Gestor desse CR (ORCAMENTO_STATUS) para chamar SF 121
const st = crDeleg ? (await q(`SELECT GESTOR_ID FROM ORCAMENTO_STATUS WHERE CICLO_ID=${ciclo.ID} AND CR_ID=${crDeleg.CR_ID} LIMIT 1`))[0] : null;
if (st) {
  const k = await sf(121, { cicloId: ciclo.ID, gestorId: st.GESTOR_ID, ano: ciclo.ANO });
  const modelos = jf(k.MODELOS).find((m) => Number(m.CR_ID) === Number(crDeleg.CR_ID));
  const card = jf(k.CARDS).find((c) => Number(c.CR_ID) === Number(crDeleg.CR_ID));
  const confirmados = card?.DRIVERS_CONFIRMADOS ? card.DRIVERS_CONFIRMADOS.split(',').filter(Boolean).length : 0;
  console.log(`SF121 MODELOS do CR ${crDeleg.CR_ID}: total=${modelos?.TOTAL} | confirmados=${confirmados} | status=${card?.STATUS}`);
  // Denominador NAO deve incluir o pacote: comparar com contagem NORMAL
  const norm = (await q(`SELECT COUNT(DISTINCT d.NOME) N FROM CR_CONTA crc
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID=crc.CR_ID AND cde.CONTA_ID=crc.CONTA_ID AND cde.ATIVO=true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID=crc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID=COALESCE(cde.PACOTE_ID,cd.PACOTE_ID,cde.DRIVER_ID,cd.DRIVER_ID)
    WHERE crc.CR_ID=${crDeleg.CR_ID} AND crc.ATIVO=true AND d.ID IS NOT NULL AND d.ATIVO='true' AND d.TIPO_DRIVER='NORMAL'`))[0];
  console.log(`  esperado (so NORMAL)=${norm?.N} -> ${Number(modelos?.TOTAL) === Number(norm?.N) ? 'OK' : 'DIVERGENTE'}`);
}

// 4. Kanban do gestor do pacote: PKG_TOTAIS/PKG_FILLED
if (gp) {
  const k2 = await sf(121, { cicloId: ciclo.ID, gestorId: gp.GESTOR_ID, ano: ciclo.ANO });
  console.log('SF121 PKG_TOTAIS:', JSON.stringify(jf(k2.PKG_TOTAIS)));
  console.log('SF121 PKG_FILLED:', JSON.stringify(jf(k2.PKG_FILLED)));
}

// 5. SF 125 do CR delegado: PKG_BUDGET presente
if (crDeleg) {
  const d = await sf(125, { crId: crDeleg.CR_ID, cicloId: ciclo.ID, ano: ciclo.ANO, anoPrev: ciclo.ANO - 1, gestorId: 0, controlCicloId: 0 });
  const pb = jf(d.PKG_BUDGET);
  console.log(`SF125 PKG_BUDGET do CR ${crDeleg.CR_ID}: ${pb.length} linhas (ex: ${JSON.stringify(pb[0] || null)})`);

  // 6. Resumo consolidado: ORC do CR com e sem pacote
  const r = await sf(127, { crId: crDeleg.CR_ID, cicloId: ciclo.ID, ano: ciclo.ANO, anoPrev: ciclo.ANO - 1 });
  const orcTotal = jf(r.ORC).reduce((s, x) => s + Number(x.VALOR || 0), 0);
  const soOrc = (await q(`SELECT COALESCE(SUM(VALOR),0) T FROM ORCAMENTO WHERE CICLO_ID=${ciclo.ID} AND CR_ID=${crDeleg.CR_ID}`))[0];
  const pkgSubm = (await q(`SELECT COALESCE(SUM(op.VALOR),0) T FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID=${ciclo.ID} AND op.CR_ID=${crDeleg.CR_ID}
    AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID=op.CICLO_ID AND ps.DRIVER_ID=op.DRIVER_ID AND ps.STATUS IN ('SUBMETIDO','APROVADO'))`))[0];
  console.log(`SF127 ORC total=${orcTotal} | ORCAMENTO=${soOrc?.T} + PACOTE(submetido)=${pkgSubm?.T} = ${Number(soOrc?.T) + Number(pkgSubm?.T)} -> ${Math.round(orcTotal) === Math.round(Number(soOrc?.T) + Number(pkgSubm?.T)) ? 'OK' : 'DIVERGENTE'}`);
}

console.log('\nValidacao concluida.');
