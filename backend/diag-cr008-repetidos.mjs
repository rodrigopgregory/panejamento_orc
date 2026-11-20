// SOMENTE LEITURA — diagnostica contas do CR008 com valores repetidos
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// 1. Identificar o CR008
const cr = await runQueryMitra({
  projectId,
  sql: `SELECT ID, CODIGO, NOME FROM CENTRO_RESULTADO WHERE CODIGO LIKE '%008%' OR NOME LIKE '%Estrat%'`,
});
console.log('=== CR encontrado ===');
console.table(cr.result?.rows || []);

const CR_ID = cr.result?.rows?.[0]?.ID;
if (!CR_ID) { console.log('CR008 nao encontrado'); process.exit(0); }

// 2. Ciclos em que o CR008 tem lancamentos
const ciclos = await runQueryMitra({
  projectId,
  sql: `SELECT o.CICLO_ID, COUNT(*) AS LANCAMENTOS, ROUND(SUM(o.VALOR)) AS TOTAL,
               (SELECT STATUS FROM ORCAMENTO_STATUS s WHERE s.CR_ID=o.CR_ID AND s.CICLO_ID=o.CICLO_ID LIMIT 1) AS STATUS
        FROM ORCAMENTO o WHERE o.CR_ID = ${CR_ID}
        GROUP BY o.CICLO_ID ORDER BY o.CICLO_ID`,
});
console.log('\n=== Ciclos com lancamentos do CR008 ===');
console.table(ciclos.result?.rows || []);

// 3. Para cada ciclo, detectar contas com valores repetidos
for (const c of ciclos.result?.rows || []) {
  const CICLO_ID = c.CICLO_ID;
  const rep = await runQueryMitra({
    projectId,
    sql: `SELECT o.CONTA_ID, cc.CODIGO, cc.NOME,
                 COUNT(*) AS MESES,
                 COUNT(DISTINCT o.VALOR) AS VALORES_DISTINTOS,
                 ROUND(SUM(o.VALOR)) AS TOTAL_ORCADO
          FROM ORCAMENTO o
          JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
          WHERE o.CR_ID = ${CR_ID} AND o.CICLO_ID = ${CICLO_ID}
          GROUP BY o.CONTA_ID, cc.CODIGO, cc.NOME
          HAVING COUNT(*) > COUNT(DISTINCT o.VALOR)
          ORDER BY (COUNT(*) - COUNT(DISTINCT o.VALOR)) DESC`,
  });
  console.log(`\n=== CICLO ${CICLO_ID} (status ${c.STATUS}) — contas com valor repetido ===`);
  console.table(rep.result?.rows || []);

  // Detalhe mes a mes das contas suspeitas
  for (const r of rep.result?.rows || []) {
    const det = await runQueryMitra({
      projectId,
      sql: `SELECT MES, VALOR FROM ORCAMENTO
            WHERE CR_ID=${CR_ID} AND CICLO_ID=${CICLO_ID} AND CONTA_ID=${r.CONTA_ID}
            ORDER BY MES`,
    });
    const vals = (det.result?.rows || []).map(x => Number(x.VALOR));
    // conta ocorrencias
    const freq = {};
    for (const v of vals) freq[v] = (freq[v] || 0) + 1;
    const repetidos = Object.entries(freq).filter(([, n]) => n > 1)
      .map(([v, n]) => `${Number(v).toLocaleString('pt-BR')} x${n}`).join(' | ');
    console.log(`  ${r.CODIGO} ${r.NOME}`);
    console.log(`    meses: ${vals.map(v => v.toLocaleString('pt-BR')).join(', ')}`);
    console.log(`    repetidos: ${repetidos}`);
  }
}

// 4. Base historica (realizado) por ano/conta do CR008
const hist = await runQueryMitra({
  projectId,
  sql: `SELECT rc.ANO, rc.CONTA_ID, cc.CODIGO, cc.NOME,
               COUNT(*) AS MESES, ROUND(SUM(rc.VALOR)) AS TOTAL,
               ROUND(MIN(rc.VALOR)) AS MIN_MES, ROUND(MAX(rc.VALOR)) AS MAX_MES,
               ROUND(AVG(rc.VALOR)) AS MEDIA_MES,
               ROUND(STDDEV_POP(rc.VALOR)) AS DESVIO
        FROM REALIZADO_CONTABIL rc
        JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
        WHERE rc.CR_ID = ${CR_ID}
        GROUP BY rc.ANO, rc.CONTA_ID, cc.CODIGO, cc.NOME
        ORDER BY rc.CONTA_ID, rc.ANO`,
});
console.log('\n=== Base historica REALIZADO_CONTABIL do CR008 ===');
console.table(hist.result?.rows || []);
