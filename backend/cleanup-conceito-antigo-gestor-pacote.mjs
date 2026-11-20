// Higienizacao do conceito antigo de pacotes — remove dados que ficaram sem
// conexao com um pacote valido no fluxo novo (rota pacote):
//  1) PACOTE_STATUS apontando para driver inexistente, inativo ou que nao e pacote
//  2) GESTOR_PACOTE apontando para driver inexistente, inativo ou que nao e pacote
//  3) ORCAMENTO_PACOTE do ciclo ATIVO cujo par (pacote, conta) nao existe mais no
//     mapeamento atual (CONTA_DRIVER.PACOTE_ID / CONTA_DRIVER_EXCECAO.PACOTE_ID)
// Ciclos FECHADOS nao sao tocados — sao historia das versoes.
import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || r; }

// 1) PACOTE_STATUS orfaos (driver sumiu, foi inativado ou nao e TIPO_DRIVER=PACOTE)
const psOrfaos = await q(`
  SELECT ps.ID, ps.CICLO_ID, ps.DRIVER_ID, ps.GESTOR_ID, d.NOME, d.ATIVO, d.TIPO_DRIVER
  FROM PACOTE_STATUS ps
  LEFT JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
  WHERE d.ID IS NULL OR d.ATIVO <> 'true' OR d.TIPO_DRIVER <> 'PACOTE'
`);
console.log(`PACOTE_STATUS orfaos: ${psOrfaos.length}`);
for (const r of psOrfaos) {
  console.log(`  - ID ${r.ID} (ciclo ${r.CICLO_ID}, driver ${r.DRIVER_ID}=${r.NOME ?? 'inexistente'}, ativo=${r.ATIVO})`);
  await runDmlMitra({ projectId, sql: `DELETE FROM PACOTE_STATUS WHERE ID = ${r.ID}` });
}

// 2) GESTOR_PACOTE orfaos
const gpOrfaos = await q(`
  SELECT gp.ID, gp.GESTOR_ID, gp.DRIVER_ID, d.NOME, d.ATIVO, d.TIPO_DRIVER
  FROM GESTOR_PACOTE gp
  LEFT JOIN DRIVERS d ON d.ID = gp.DRIVER_ID
  WHERE d.ID IS NULL OR d.ATIVO <> 'true' OR d.TIPO_DRIVER <> 'PACOTE'
`);
console.log(`GESTOR_PACOTE orfaos: ${gpOrfaos.length}`);
for (const r of gpOrfaos) {
  console.log(`  - ID ${r.ID} (gestor ${r.GESTOR_ID}, driver ${r.DRIVER_ID}=${r.NOME ?? 'inexistente'}, ativo=${r.ATIVO})`);
  await runDmlMitra({ projectId, sql: `DELETE FROM GESTOR_PACOTE WHERE ID = ${r.ID}` });
}

// 3) ORCAMENTO_PACOTE do(s) ciclo(s) nao fechado(s) com par (pacote, conta) fora do mapeamento atual
const ciclosAbertos = await q(`SELECT ID, NOME FROM CICLO WHERE STATUS <> 'FECHADO'`);
for (const ciclo of ciclosAbertos) {
  const orfaos = await q(`
    SELECT op.ID, op.DRIVER_ID, op.CONTA_ID
    FROM ORCAMENTO_PACOTE op
    WHERE op.CICLO_ID = ${ciclo.ID}
      AND NOT EXISTS (
        SELECT 1 FROM CONTA_DRIVER cd
        WHERE cd.CONTA_ID = op.CONTA_ID AND cd.PACOTE_ID = op.DRIVER_ID
      )
      AND NOT EXISTS (
        SELECT 1 FROM CONTA_DRIVER_EXCECAO ex
        WHERE ex.CONTA_ID = op.CONTA_ID AND ex.PACOTE_ID = op.DRIVER_ID AND ex.ATIVO = true
      )
  `);
  console.log(`ORCAMENTO_PACOTE orfaos no ciclo ${ciclo.ID} (${ciclo.NOME}): ${orfaos.length}`);
  if (orfaos.length > 0) {
    const ids = orfaos.map((r) => r.ID);
    for (let i = 0; i < ids.length; i += 200) {
      await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO_PACOTE WHERE ID IN (${ids.slice(i, i + 200).join(',')})` });
    }
  }
}

console.log('Higienizacao concluida.');
