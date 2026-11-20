import 'dotenv/config';
import { configureSdkMitra, listServerFunctionsMitra, updateServerFunctionMitra } from 'mitra-sdk';

// Corrige o denominador da barra de progresso ("X/Y modelos preenchidos").
//
// PROBLEMA: TOTAL_MODELOS e um SNAPSHOT congelado no fechamento da versao
// (fecharVersaoHousekeeping). As SFs de leitura usavam
// COALESCE(TOTAL_MODELOS, contagem_ao_vivo) — ou seja, o snapshot vencia SEMPRE,
// inclusive em versao ABERTA. Em versao aberta com snapshot obsoleto (ou 0,
// gravado pelo backfill inicial), o card mostrava "0/0 — 0%" enquanto os modelos
// dentro do CR apareciam confirmados. Sintoma classico: CR reprovado, o gestor
// entra pra ajustar e ve os modelos confirmados com a barra zerada.
//
// CORRECAO: o snapshot so vale quando a versao esta FECHADA; versao aberta usa
// sempre a contagem ao vivo.
//
// PROBLEMA 2 (so no publicHome): a contagem ao vivo do CR incluia modelos de
// PACOTE (ESCOPO='PACOTE'). O gestor nunca confirma a aba de pacote pelo CR,
// entao o CR jamais fechava 100% e o botao "Submeter CR" ficava travado.
// As demais SFs (95, 121, 170) ja excluiam — alinhado aqui.
//
// Somente ALTER de codigo de SF. Nenhum dado e alterado.

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Contagem ao vivo de modelos por CR — exclui modelos de pacote (mesma regra
// das SFs 95/121/170).
const LIVE_CR = `SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL'
    AND COALESCE(d.ESCOPO, 'CR') <> 'PACOTE'
  GROUP BY crc.CR_ID`;

// Contagem ao vivo de pares (conta, CR) por pacote.
const LIVE_PKG = `SELECT COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) AS PACOTE_ID,
       COUNT(DISTINCT modelo.ID) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS modelo ON modelo.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) AND modelo.TIPO_DRIVER = 'NORMAL'
  WHERE crc.ATIVO = true AND modelo.ID IS NOT NULL
  GROUP BY COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)`;

const CONTA_CSV = (col) =>
  `CASE WHEN ${col} IS NULL OR ${col} = '' THEN 0 ELSE LENGTH(${col}) - LENGTH(REPLACE(${col}, ',', '')) + 1 END`;

const PUBLIC_HOME = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CICLO_ID', x.CICLO_ID, 'GESTOR_ID', x.GESTOR_ID, 'GESTOR_NOME', x.GESTOR_NOME,
      'CICLO_NOME', x.CICLO_NOME, 'CICLO_ANO', x.CICLO_ANO))
    FROM (
      SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, c.NOME AS CICLO_NOME, c.ANO AS CICLO_ANO
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR g ON g.ID = t.GESTOR_ID
      JOIN CICLO c ON c.ID = t.CICLO_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      ORDER BY t.ID DESC LIMIT 1
    ) x), JSON_ARRAY()) AS CTX,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CR_ID', x.CR_ID, 'CODIGO', x.CODIGO, 'NOME', x.NOME, 'STATUS', x.STATUS,
      'COMENTARIO', x.COMENTARIO, 'FILLED', x.FILLED, 'TOTAL', x.TOTAL))
    FROM (
      SELECT cr.ID AS CR_ID, cr.CODIGO, cr.NOME,
             COALESCE(os.STATUS, 'PENDENTE') AS STATUS, os.COMENTARIO,
             ${CONTA_CSV('os.DRIVERS_CONFIRMADOS')} AS FILLED,
             COALESCE(CASE WHEN c.STATUS = 'FECHADO' THEN os.TOTAL_MODELOS END, mt.TOTAL, 0) AS TOTAL
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID AND cr.ATIVO = 'true'
      LEFT JOIN ORCAMENTO_STATUS os
        ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = cr.ID
      LEFT JOIN (${LIVE_CR}) mt ON mt.CR_ID = cr.ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS CRS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'STATUS_ID', x.STATUS_ID, 'DRIVER_ID', x.DRIVER_ID, 'NOME', x.NOME, 'DESCRICAO', x.DESCRICAO,
      'STATUS', x.STATUS, 'COMENTARIO', x.COMENTARIO, 'FILLED', x.FILLED, 'TOTAL', x.TOTAL))
    FROM (
      SELECT ps.ID AS STATUS_ID, ps.DRIVER_ID, d.NOME, d.DESCRICAO,
             COALESCE(ps.STATUS, 'PENDENTE') AS STATUS, ps.COMENTARIO,
             ${CONTA_CSV('ps.DRIVERS_CONFIRMADOS')} AS FILLED,
             COALESCE(CASE WHEN c.STATUS = 'FECHADO' THEN ps.TOTAL_MODELOS END, pt.TOTAL, 0) AS TOTAL
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN PACOTE_STATUS ps ON ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID
      JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
      LEFT JOIN (${LIVE_PKG}) pt ON pt.PACOTE_ID = ps.DRIVER_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS PACOTES`;

const KANBAN_MODELOS = `SELECT os.CR_ID, COALESCE(MAX(CASE WHEN c.STATUS = 'FECHADO' THEN os.TOTAL_MODELOS END), MAX(live.TOTAL), 0) AS TOTAL
FROM ORCAMENTO_STATUS os
JOIN CICLO c ON c.ID = os.CICLO_ID
LEFT JOIN (${LIVE_CR}) live ON live.CR_ID = os.CR_ID
WHERE os.CICLO_ID = {{cicloId}}
GROUP BY os.CR_ID`;

const KANBAN_PACOTES = `SELECT ps.DRIVER_ID AS PACOTE_ID, COALESCE(MAX(CASE WHEN c.STATUS = 'FECHADO' THEN ps.TOTAL_MODELOS END), MAX(live.TOTAL), 0) AS TOTAL
FROM PACOTE_STATUS ps
JOIN CICLO c ON c.ID = ps.CICLO_ID
LEFT JOIN (${LIVE_PKG}) live ON live.PACOTE_ID = ps.DRIVER_ID
WHERE ps.CICLO_ID = {{cicloId}}
GROUP BY ps.DRIVER_ID`;

const ALVOS = [
  { name: 'publicHome', code: PUBLIC_HOME,
    description: 'Home publica: contexto + cards de CRs e pacotes com status/progresso, escopado por token. Total de modelos: snapshot TOTAL_MODELOS so quando a versao esta FECHADA, senao contagem ao vivo (exclui modelos de pacote no CR). Params: token, agora' },
  { name: 'kanbanModelosPorCiclo', code: KANBAN_MODELOS,
    description: 'Total de modelos por CR do ciclo — snapshot TOTAL_MODELOS so quando a versao esta FECHADA, senao contagem ao vivo. Params: cicloId' },
  { name: 'kanbanPacoteTotais', code: KANBAN_PACOTES,
    description: 'Total de modelos NORMAL por pacote do ciclo — snapshot TOTAL_MODELOS so quando a versao esta FECHADA, senao contagem ao vivo. Params: cicloId' },
];

const sfs = await listServerFunctionsMitra({ projectId });
const lista = sfs?.result || sfs || [];
const byName = new Map(lista.map((s) => [s.name, s.id]));

for (const alvo of ALVOS) {
  const id = byName.get(alvo.name);
  if (!id) { console.log(`  ! SF ${alvo.name} nao encontrada — pulando`); continue; }
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: alvo.code, description: alvo.description });
  console.log(`  = SF ${id} ${alvo.name} atualizada`);
}

console.log('Denominador do progresso corrigido (snapshot so em versao FECHADA).');
