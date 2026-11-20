import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function run() {
  const sql = `
    SELECT
      os.ID AS STATUS_ID,
      cr.ID AS CR_ID,
      cr.CODIGO AS CR_CODIGO,
      cr.NOME AS CR_NOME,
      c.NOME AS CICLO,
      g.NOME AS GESTOR,
      os.STATUS,
      os.COMENTARIO,
      os.ATUALIZADO_EM
    FROM ORCAMENTO_STATUS os
    JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
    LEFT JOIN CICLO c ON c.ID = os.CICLO_ID
    LEFT JOIN GESTOR_CR gc ON gc.CR_ID = cr.ID
    LEFT JOIN GESTOR g ON g.ID = gc.GESTOR_ID
    WHERE os.STATUS = 'SUBMETIDO'
    ORDER BY os.ATUALIZADO_EM ASC
  `;
  try {
    const res = await runQueryMitra({ projectId, sql });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.log('ERR:', e.message);
  }
}

run();
