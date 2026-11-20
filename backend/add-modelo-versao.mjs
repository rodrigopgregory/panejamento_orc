// Publicacao + historico (somente visualizacao) do desenho de um modelo personalizado.
// Modelo 1B: as edicoes continuam ao vivo (auto-save em DRIVER_FORMULA); "Publicar"
// apenas GRAVA UM SNAPSHOT do estado atual no historico (DRIVER_VERSAO) e serve de
// marco ("publicado em X"). Nada aqui altera o fluxo de leitura do preenchimento.
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, executeServerFunctionMitra,
  listServerFunctionsMitra, createServerFunctionMitra, updateServerFunctionMitra,
  readServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

// 1. Tabela de snapshots (idempotente)
const has = await query("SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DRIVER_VERSAO'");
if (Number(has[0]?.N) === 0) {
  await runDdlMitra({ projectId, sql: `CREATE TABLE DRIVER_VERSAO (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    DRIVER_ID INT NOT NULL,
    NUMERO INT NOT NULL,
    SNAPSHOT LONGTEXT,
    CRIADO_EM VARCHAR(19),
    CRIADO_POR VARCHAR(100)
  )` });
  console.log('tabela DRIVER_VERSAO criada');
} else {
  console.log('tabela DRIVER_VERSAO ja existe');
}

// Campos do snapshot (mesma forma usada no front para detectar "alteracoes nao publicadas")
const SNAP_OBJ = "JSON_OBJECT('CODIGO',f.CODIGO,'NOME_CUSTOM',f.NOME_CUSTOM,'CONTA_ID',f.CONTA_ID,'TIPO',f.TIPO,'FORMULA',f.FORMULA,'ORDEM',f.ORDEM,'ESCONDER',f.ESCONDER,'NEGRITO',f.NEGRITO,'FORMATO',f.FORMATO)";

// 2. SFs
const SFS = [
  {
    name: 'publicarModeloVersao',
    type: 'SQL',
    description: 'Grava um snapshot do estado atual das linhas do modelo (DRIVER_FORMULA) como nova versao no historico. Params: driverId, agora. Autor = usuario logado (:VAR_USER).',
    // INSERT ... SELECT (sem FROM): derived-table no MAX(NUMERO) evita erro 1093 (ler a tabela alvo).
    code: `INSERT INTO DRIVER_VERSAO (DRIVER_ID, NUMERO, SNAPSHOT, CRIADO_EM, CRIADO_POR)
SELECT
  {{driverId}},
  (SELECT COALESCE(MAX(NUMERO),0)+1 FROM (SELECT NUMERO FROM DRIVER_VERSAO WHERE DRIVER_ID = {{driverId}}) x),
  (SELECT JSON_ARRAYAGG(${SNAP_OBJ}) FROM DRIVER_FORMULA f WHERE f.DRIVER_ID = {{driverId}}),
  '{{agora}}',
  :VAR_USER`,
  },
  {
    name: 'listarModeloVersoes',
    type: 'SQL',
    description: 'Lista as versoes publicadas de um modelo (sem o snapshot, para ser leve). Param: driverId.',
    code: `SELECT v.ID, v.NUMERO, v.CRIADO_EM, COALESCE(u.DESCR, v.CRIADO_POR) AS AUTOR,
       JSON_LENGTH(v.SNAPSHOT) AS QTD_LINHAS
FROM DRIVER_VERSAO v
LEFT JOIN INT_USER u ON u.ID = v.CRIADO_POR
WHERE v.DRIVER_ID = {{driverId}}
ORDER BY v.NUMERO DESC`,
  },
  {
    name: 'getModeloVersao',
    type: 'SQL',
    description: 'Retorna o snapshot completo de uma versao para visualizacao. Param: versaoId.',
    code: `SELECT ID, NUMERO, CRIADO_EM, SNAPSHOT FROM DRIVER_VERSAO WHERE ID = {{versaoId}}`,
  },
];

const list = await listServerFunctionsMitra({ projectId });
const existing = (list?.result || list || []);
const ids = {};
for (const sf of SFS) {
  const found = existing.find((s) => s.name === sf.name);
  if (found) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: found.id, code: sf.code, description: sf.description });
    ids[sf.name] = found.id;
    console.log(`SF ${sf.name} atualizada (id ${found.id})`);
  } else {
    const res = await createServerFunctionMitra({ projectId, name: sf.name, type: sf.type, code: sf.code, description: sf.description });
    ids[sf.name] = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
    console.log(`SF ${sf.name} criada (id ${ids[sf.name]})`);
  }
}

// 3. Estender SF 133 (hotFormulasModeloBase) com a ULTIMA_VERSAO publicada.
//    A SNAPSHOT vai como STRING (dupla parse no front) — previsivel e sem ambiguidade.
const sf133 = await readServerFunctionMitra({ projectId, serverFunctionId: 133 });
let code133 = sf133?.result?.code || '';
if (code133.includes('ULTIMA_VERSAO')) {
  console.log('SF 133 ja tem ULTIMA_VERSAO');
} else {
  const bloco = `,\n  COALESCE((SELECT JSON_OBJECT('ID',v.ID,'NUMERO',v.NUMERO,'CRIADO_EM',v.CRIADO_EM,'SNAPSHOT',v.SNAPSHOT) FROM DRIVER_VERSAO v WHERE v.DRIVER_ID = {{driverId}} ORDER BY v.NUMERO DESC LIMIT 1),JSON_OBJECT()) AS ULTIMA_VERSAO`;
  // Acrescenta a nova coluna logo apos o bloco VINCULOS (ultima coluna atual)
  const anchor = 'AS VINCULOS';
  const at = code133.lastIndexOf(anchor);
  if (at === -1) throw new Error('ancora VINCULOS nao encontrada na SF 133');
  const insertAt = at + anchor.length;
  code133 = code133.slice(0, insertAt) + bloco + code133.slice(insertAt);
  await updateServerFunctionMitra({ projectId, serverFunctionId: 133, code: code133 });
  console.log('SF 133 estendida com ULTIMA_VERSAO');
}

// 4. Teste: publica uma versao de um driver autoravel e verifica o registro + :VAR_USER
const drv = await query("SELECT ID, NOME FROM DRIVERS WHERE TIPO_DRIVER <> 'PACOTE' AND (ORIGEM IS NULL OR ORIGEM NOT IN ('NATIVO','IA')) AND ID IN (SELECT DRIVER_ID FROM DRIVER_FORMULA) ORDER BY ID LIMIT 1");
if (drv[0]) {
  const agora = new Date().toISOString().slice(0, 19);
  await executeServerFunctionMitra({ projectId, serverFunctionId: ids.publicarModeloVersao, input: { driverId: drv[0].ID, agora } });
  const versoes = await executeServerFunctionMitra({ projectId, serverFunctionId: ids.listarModeloVersoes, input: { driverId: drv[0].ID } });
  let vo = versoes?.result?.output; if (typeof vo === 'string') vo = JSON.parse(vo);
  console.log(`TESTE publicar driver ${drv[0].ID} (${drv[0].NOME}) -> versoes:`, JSON.stringify(vo?.rows));
  // Confirma :VAR_USER
  const raw = await query(`SELECT ID, NUMERO, CRIADO_POR, LEFT(SNAPSHOT, 80) AS SNAP80 FROM DRIVER_VERSAO WHERE DRIVER_ID = ${drv[0].ID} ORDER BY NUMERO DESC LIMIT 1`);
  console.log('registro:', JSON.stringify(raw[0]));
  // Verifica SF 133 devolvendo ULTIMA_VERSAO
  const r133 = await executeServerFunctionMitra({ projectId, serverFunctionId: 133, input: { driverId: drv[0].ID } });
  let o133 = r133?.result?.output; if (typeof o133 === 'string') o133 = JSON.parse(o133);
  console.log('SF133 ULTIMA_VERSAO:', String(o133?.rows?.[0]?.ULTIMA_VERSAO).slice(0, 120));
}

console.log('IDS:', JSON.stringify(ids));
