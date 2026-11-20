import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const dups = await runQueryMitra({
  projectId,
  sql: `SELECT CR_ID, CONTA_ID, COUNT(*) AS QTD, GROUP_CONCAT(ID) AS IDS
        FROM CR_CONTA
        WHERE ATIVO = true
        GROUP BY CR_ID, CONTA_ID
        HAVING COUNT(*) > 1
        ORDER BY QTD DESC`,
});
console.log(`Duplicatas em CR_CONTA (ATIVO=true): ${dups.result?.rows?.length || 0}`);
console.table(dups.result?.rows || []);

const conta = await runQueryMitra({
  projectId,
  sql: `SELECT CC.CODIGO, CC.NOME AS CONTA, CR.CODIGO AS CR_CODIGO, CR.NOME AS CR_NOME, CRC.*
        FROM CR_CONTA CRC
        JOIN CONTA_CONTABIL CC ON CC.ID = CRC.CONTA_ID
        JOIN CENTRO_RESULTADO CR ON CR.ID = CRC.CR_ID
        WHERE CC.CODIGO = '3.1.01' AND CRC.ATIVO = true
        ORDER BY CR.CODIGO, CRC.ID`,
});
console.log('\nConta 3.1.01 - CRs vinculadas:');
console.table(conta.result?.rows || []);
