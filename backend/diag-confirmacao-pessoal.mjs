// SOMENTE LEITURA — cruza "folha calculada/confirmada" x "valor em conta 5.1".
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

console.log('--- ORCAMENTO_STATUS do ciclo 133 ---');
console.table(await q(`SELECT s.ID, cr.CODIGO AS CR, s.CR_ID, s.GESTOR_ID, s.STATUS, s.DRIVERS_CONFIRMADOS
  FROM ORCAMENTO_STATUS s LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = s.CR_ID
  WHERE s.CICLO_ID = 133 ORDER BY cr.CODIGO`));

console.log('--- por CR: folha projetada x confirmacao x valor em 5.1 ---');
console.table(await q(`
  SELECT cr.CODIGO AS CR,
    (SELECT ROUND(SUM(op.TOTAL),2) FROM ORCAMENTO_PESSOAL op WHERE op.CICLO_ID = 133 AND op.CR_ID = cr.ID) AS FOLHA_PROJETADA,
    (SELECT s.STATUS FROM ORCAMENTO_STATUS s WHERE s.CICLO_ID = 133 AND s.CR_ID = cr.ID LIMIT 1) AS STATUS,
    (SELECT s.DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS s WHERE s.CICLO_ID = 133 AND s.CR_ID = cr.ID LIMIT 1) AS CONFIRMADOS,
    (SELECT ROUND(SUM(o.VALOR),2) FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
       WHERE o.CICLO_ID = 133 AND o.CR_ID = cr.ID AND cc.CODIGO LIKE '5.1%') AS VALOR_5_1
  FROM CENTRO_RESULTADO cr ORDER BY cr.CODIGO`));

console.log('--- detalhe das contas 5.1 por CR ---');
console.table(await q(`SELECT cr.CODIGO AS CR, cc.CODIGO AS CONTA, ROUND(SUM(o.VALOR),2) AS VALOR
  FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
  WHERE o.CICLO_ID = 133 AND cc.CODIGO LIKE '5.1%' GROUP BY cr.CODIGO, cc.CODIGO ORDER BY cr.CODIGO, cc.CODIGO`));
