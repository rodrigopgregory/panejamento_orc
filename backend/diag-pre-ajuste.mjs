// SOMENTE LEITURA — foto de antes do ajuste.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

console.log('--- ciclos ---');
console.table(await q('SELECT * FROM CICLO ORDER BY ID DESC LIMIT 5'));

console.log('--- ORCAMENTO_PESSOAL: ciclos x CR com projecao ---');
console.table(await q(`SELECT CICLO_ID, CR_ID, COUNT(*) AS LINHAS, ROUND(SUM(TOTAL),2) AS TOTAL
  FROM ORCAMENTO_PESSOAL GROUP BY CICLO_ID, CR_ID ORDER BY CICLO_ID DESC, CR_ID`));

console.log('--- ORCAMENTO ciclo 133, contas 5.1, por CR (ANTES) ---');
console.table(await q(`SELECT cr.CODIGO AS CR, cc.CODIGO AS CONTA, ROUND(SUM(o.VALOR),2) AS VALOR, COUNT(*) AS MESES
  FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
  JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
  WHERE o.CICLO_ID = 133 AND cc.CODIGO LIKE '5.1%'
  GROUP BY cr.CODIGO, cc.CODIGO ORDER BY cr.CODIGO, cc.CODIGO`));
