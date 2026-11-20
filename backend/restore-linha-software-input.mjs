// Recria a linha "software input" do pacote CUSTOS_DE_SOFTWARE (driver 24) —
// perdida porque o editor so persistia a linha na primeira edicao (bug corrigido
// no FormulasModeloEditor: agora a linha e criada no banco ja no Adicionar).
// Idempotente: nao duplica se a linha ja existir.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, createRecordsBatchMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch {} }
  return o?.rows || [];
};
const DRIVER = 24;
const existe = await q(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${DRIVER} AND LOWER(NOME_CUSTOM) = 'software input' LIMIT 1`);
if (existe.length) { console.log('linha ja existe (ID', existe[0].ID, ') — nada a fazer'); process.exit(0); }
const atuais = await q(`SELECT CODIGO, ORDEM FROM DRIVER_FORMULA WHERE DRIVER_ID = ${DRIVER}`);
let maxSeq = 0, maxOrdem = 0;
for (const r of atuais) {
  const m = /^L(\d+)$/.exec(String(r.CODIGO || ''));
  if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  maxOrdem = Math.max(maxOrdem, Number(r.ORDEM) || 0);
}
maxSeq = Math.max(maxSeq, atuais.length);
await createRecordsBatchMitra({ projectId, tableName: 'DRIVER_FORMULA', records: [{
  DRIVER_ID: DRIVER, CONTA_ID: null, NOME_CUSTOM: 'software input', TIPO: 'INPUT', FORMULA: '',
  CODIGO: `L${maxSeq + 1}`, ORDEM: maxOrdem + 1, ESCONDER: false, NEGRITO: false, FORMATO: 'SEM_PREFIXO',
}] });
console.log(`linha "software input" recriada com CODIGO L${maxSeq + 1}, ORDEM ${maxOrdem + 1}`);
console.table(await q(`SELECT ID, CODIGO, NOME_CUSTOM, CONTA_ID, TIPO, ORDEM FROM DRIVER_FORMULA WHERE DRIVER_ID = ${DRIVER} ORDER BY ORDEM`));
