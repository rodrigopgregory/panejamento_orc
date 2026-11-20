-- tipo: JAVASCRIPT | Fechamento de versao: congela TOTAL_MODELOS (snapshot) e desativa tokens dos links. Params: cicloIds[]

// Chamada pela tela de Versoes no momento em que versoes sao FECHADAS.
// Congela a completude (snapshot TOTAL_MODELOS) e desativa os tokens dos links.
const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const raw = Array.isArray(event.cicloIds) ? event.cicloIds : [event.cicloIds];
const ids = raw.map(Number).filter(Number.isInteger);
if (ids.length === 0) return { ok: false, error: 'cicloIds_invalido' };
const IN = ids.join(',');
await runDmlMitra({ projectId, sql:
  "UPDATE ORCAMENTO_STATUS os LEFT JOIN (SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL   FROM CR_CONTA crc   LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true   LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID   LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)   WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL' AND COALESCE(d.ESCOPO,'CR') <> 'PACOTE'   GROUP BY crc.CR_ID) live ON live.CR_ID = os.CR_ID " +
  "SET os.TOTAL_MODELOS = COALESCE(live.TOTAL, 0) WHERE os.CICLO_ID IN (" + IN + ")" });
await runDmlMitra({ projectId, sql:
  "UPDATE PACOTE_STATUS ps LEFT JOIN (SELECT COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) AS PACOTE_ID,        COUNT(DISTINCT modelo.ID) AS TOTAL   FROM CR_CONTA crc   LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true   LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID   LEFT JOIN DRIVERS modelo ON modelo.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) AND modelo.TIPO_DRIVER = 'NORMAL'   WHERE crc.ATIVO = true AND modelo.ID IS NOT NULL   GROUP BY COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)) live ON live.PACOTE_ID = ps.DRIVER_ID " +
  "SET ps.TOTAL_MODELOS = COALESCE(live.TOTAL, 0) WHERE ps.CICLO_ID IN (" + IN + ")" });
await runDmlMitra({ projectId, sql:
  "UPDATE PREENCHIMENTO_TOKEN SET ATIVO = 'false' WHERE CICLO_ID IN (" + IN + ")" });
return { ok: true, ciclos: ids.length };