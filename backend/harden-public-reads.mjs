// Reconstrói as SFs públicas de LEITURA como JAVASCRIPT com sanitização
// server-side do token. As versões SQL (substituição textual de {{token}})
// eram injetáveis por serem públicas (sem auth). Agora o token é reduzido a
// [0-9a-fA-F-] e o crId a inteiro ANTES de montar o SQL — imune a injeção
// independentemente do chamador.

import 'dotenv/config';
import {
  configureSdkMitra, listServerFunctionsMitra,
  deleteServerFunctionMitra, createServerFunctionMitra, togglePublicExecutionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const HEADER =
`const { runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
if (!token) return { rows: [], rowCount: 0 };`;

const SFS = [
  {
    name: 'publicResolverToken',
    description: 'PUBLICA JS — valida token e retorna ciclo/gestor (param: token)',
    code:
`${HEADER}
const agora = new Date().toISOString().slice(0, 19);
const r = await runQueryMitra({ projectId, sql:
  "SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL, c.NOME AS CICLO_NOME, c.ANO AS CICLO_ANO " +
  "FROM PREENCHIMENTO_TOKEN t JOIN GESTOR g ON g.ID = t.GESTOR_ID JOIN CICLO c ON c.ID = t.CICLO_ID " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '" + agora + "') LIMIT 1" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };`,
  },
  {
    name: 'publicListarCRs',
    description: 'PUBLICA JS — lista CRs do gestor do token no ciclo, com status (param: token)',
    code:
`${HEADER}
const r = await runQueryMitra({ projectId, sql:
  "SELECT cr.ID AS CR_ID, cr.CODIGO, cr.NOME, COALESCE(os.STATUS, 'PENDENTE') AS STATUS " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID " +
  "JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID AND cr.ATIVO = 'true' " +
  "LEFT JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = cr.ID " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' ORDER BY cr.CODIGO" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };`,
  },
  {
    name: 'publicCarregarConfig',
    description: 'PUBLICA JS — config conta x driver de um CR, autorizado pelo token (params: token, crId)',
    code:
`${HEADER}
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
return r && r.result ? r.result : { rows: [], rowCount: 0 };`,
  },
  {
    name: 'publicCarregarValores',
    description: 'PUBLICA JS — valores ja preenchidos de um CR, autorizado pelo token (params: token, crId)',
    code:
`${HEADER}
const crId = Number(event.crId);
if (!Number.isInteger(crId)) return { rows: [], rowCount: 0 };
const r = await runQueryMitra({ projectId, sql:
  "SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' GROUP BY o.CONTA_ID, o.MES" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };`,
  },
];

async function run() {
  const all = await listServerFunctionsMitra({ projectId });
  const list = all?.result || all?.content || all || [];
  for (const sf of SFS) {
    const ex = Array.isArray(list) ? list.find((s) => s.name === sf.name) : null;
    if (ex) {
      await deleteServerFunctionMitra({ projectId, serverFunctionId: ex.id });
      console.log(`- removida SQL antiga ${sf.name} (id ${ex.id})`);
    }
    const c = await createServerFunctionMitra({ projectId, name: sf.name, type: 'JAVASCRIPT', code: sf.code, description: sf.description });
    const id = c?.result?.serverFunctionId || c?.serverFunctionId || c?.id;
    await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
    console.log(`+ recriada JS ${sf.name} (id ${id}) [PUBLICA]`);
  }
  console.log('\nConcluido.');
}
run().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
