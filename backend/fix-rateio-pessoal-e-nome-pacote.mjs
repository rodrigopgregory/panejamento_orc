// Deixa o fluxo do pacote "certinho":
//  1) Rateio "Pessoal" (ID 2) passa a refletir o headcount REAL por setor
//     (colaboradores ativos por CR) — cobre TODOS os CRs ativos, mantivel como
//     dado de referencia (basta atualizar as quantidades quando o quadro mudar).
//  2) Pacote 24 renomeado: TESTE -> CUSTOS_DE_SOFTWARE, com descricao.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || []; };
const dml = async (sql) => { await runDmlMitra({ projectId, sql }); };

// 1) Rateio Pessoal = headcount real por CR
const RATEIO_ID = 2;
const head = await q(`
  SELECT cr.ID AS CR_ID, cr.CODIGO, COUNT(c.ID) AS PESSOAS
  FROM CENTRO_RESULTADO cr
  LEFT JOIN COLABORADOR c ON c.CR_ID = cr.ID AND (c.ATIVO = 'true' OR c.ATIVO IS NULL OR c.ATIVO = true)
  WHERE cr.ATIVO = 'true'
  GROUP BY cr.ID, cr.CODIGO`);
for (const h of head) {
  const exist = await q(`SELECT ID FROM RATEIO_ITEM WHERE RATEIO_ID = ${RATEIO_ID} AND CR_ID = ${h.CR_ID}`);
  if (exist.length > 0) await dml(`UPDATE RATEIO_ITEM SET QUANTIDADE = ${h.PESSOAS} WHERE ID = ${exist[0].ID}`);
  else await dml(`INSERT INTO RATEIO_ITEM (RATEIO_ID, CR_ID, QUANTIDADE) VALUES (${RATEIO_ID}, ${h.CR_ID}, ${h.PESSOAS})`);
  console.log(`Rateio Pessoal: ${h.CODIGO} = ${h.PESSOAS} pessoas`);
}
await dml(`UPDATE RATEIO SET DESCRICAO = 'Quantidade de colaboradores ativos por setor (headcount) — atualize as quantidades quando o quadro mudar' WHERE ID = ${RATEIO_ID}`);

// 2) Renomeia o pacote TESTE
await dml(`UPDATE DRIVERS SET NOME = 'CUSTOS_DE_SOFTWARE',
  DESCRICAO = 'Licencas e despesas de software lancadas pelo responsavel do pacote e distribuidas entre os setores pelo rateio de pessoas'
  WHERE ID = 24 AND ESCOPO = 'PACOTE'`);
console.log('Pacote 24 renomeado para CUSTOS_DE_SOFTWARE');

// Verificacao final
const check = await q(`SELECT d.NOME, (SELECT COUNT(*) FROM RATEIO_ITEM WHERE RATEIO_ID = ${RATEIO_ID} AND QUANTIDADE > 0) AS ITENS,
  (SELECT COUNT(*) FROM CONTA_DRIVER WHERE DRIVER_ID = 24) AS CONTAS,
  (SELECT COUNT(*) FROM GESTOR_PACOTE WHERE DRIVER_ID = 24) AS GESTOR,
  (SELECT COUNT(*) FROM PACOTE_STATUS WHERE DRIVER_ID = 24 AND CICLO_ID = 132) AS STATUS
  FROM DRIVERS d WHERE d.ID = 24`);
console.log('Estado final:', JSON.stringify(check[0]));
