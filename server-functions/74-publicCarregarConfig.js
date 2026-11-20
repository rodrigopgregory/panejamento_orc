-- tipo: JAVASCRIPT | PUBLICA JS — config conta x driver de um CR, autorizado pelo token (params: token, crId)
const { runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
if (!token) return { rows: [], rowCount: 0 };
const crId = Number(event.crId);
if (!Number.isInteger(crId)) return { rows: [], rowCount: 0 };
const r = await runQueryMitra({ projectId, sql:
  "SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO, d.NOME AS DRIVER_TIPO, d.ID AS DRIVER_ID " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true " +
  "JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID " +
  "LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true " +
  "LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID " +
  "LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' AND d.ID IS NOT NULL AND d.ATIVO = 'true' ORDER BY cc.CODIGO" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };