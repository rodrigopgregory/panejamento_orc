import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const S = [
  // Estaticas compartilhadas
  ['hotPreenchCiclos', `SELECT * FROM CICLO WHERE STATUS != 'FECHADO' ORDER BY ANO DESC`, 'Ciclos nao fechados (Preenchimento/Pessoal).'],
  ['hotCrsAtivos', `SELECT * FROM CENTRO_RESULTADO WHERE ATIVO = 'true' ORDER BY CODIGO`, 'CRs ativos ordenados por codigo.'],
  ['hotContasBasic', `SELECT ID, CODIGO, NOME, TIPO FROM CONTA_CONTABIL ORDER BY CODIGO`, 'Contas contabeis basicas.'],
  ['hotDreConfig', `SELECT * FROM DRE_CONFIG ORDER BY ORDEM`, 'DRE config.'],
  ['hotCiclosTodos', `SELECT * FROM CICLO ORDER BY ANO DESC, ID DESC`, 'Todos os ciclos (Versoes/Premissas).'],
  // Preenchimento — mount
  ['hotPreenchStatusCards', `SELECT os.*, cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME
     FROM ORCAMENTO_STATUS os JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
     WHERE os.CICLO_ID = {{cicloId}} AND os.GESTOR_ID = {{gestorId}} ORDER BY cr.CODIGO`, 'Status cards do gestor no ciclo.'],
  ['hotPreenchFinPorCr', `SELECT s.CR_ID,
       (SELECT COALESCE(SUM(VALOR),0) FROM ORCAMENTO WHERE CICLO_ID = s.CICLO_ID AND CR_ID = s.CR_ID) AS ORCADO,
       (SELECT COALESCE(SUM(VALOR),0) FROM REALIZADO_CONTABIL WHERE ANO = {{ano}} AND CR_ID = s.CR_ID) AS REALIZADO
     FROM ORCAMENTO_STATUS s WHERE s.CICLO_ID = {{cicloId}} AND s.GESTOR_ID = {{gestorId}}`, 'Orcado+realizado por CR do gestor.'],
  ['hotPreenchPacotes', `SELECT d.*, gp.ID as GP_ID FROM DRIVERS d
     JOIN GESTOR_PACOTE gp ON gp.DRIVER_ID = d.ID
     WHERE gp.GESTOR_ID = {{gestorId}} AND d.TIPO_DRIVER = 'PACOTE' AND d.ATIVO = 'true' ORDER BY d.NOME`, 'Pacotes do gestor.'],
  ['hotPreenchPacoteStatus', `SELECT * FROM PACOTE_STATUS WHERE CICLO_ID = {{cicloId}} AND GESTOR_ID = {{gestorId}}`, 'Status de pacotes do gestor no ciclo.'],
  // Preenchimento — abrir driver
  ['hotPkgRegras', `SELECT crc.ID, COALESCE(ex.DRIVER_ID, cd.DRIVER_ID) AS DRIVER_ID, crc.CR_ID, crc.CONTA_ID,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME, cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME,
       CASE WHEN ex.DRIVER_ID IS NOT NULL AND dexc.TIPO_DRIVER != 'PACOTE' THEN ex.DRIVER_ID
            WHEN ex.DRIVER_ID IS NULL AND cd.DRIVER_ID IS NOT NULL AND dgen.TIPO_DRIVER != 'PACOTE' THEN cd.DRIVER_ID ELSE NULL END AS MODELO_ID,
       CASE WHEN ex.DRIVER_ID IS NOT NULL AND dexc.TIPO_DRIVER != 'PACOTE' THEN dexc.NOME
            WHEN ex.DRIVER_ID IS NULL AND cd.DRIVER_ID IS NOT NULL AND dgen.TIPO_DRIVER != 'PACOTE' THEN dgen.NOME ELSE NULL END AS MODELO_NOME
     FROM CR_CONTA crc
     JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
     LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
     LEFT JOIN CONTA_DRIVER_EXCECAO ex ON ex.CR_ID = crc.CR_ID AND ex.CONTA_ID = crc.CONTA_ID AND ex.ATIVO = true
     LEFT JOIN DRIVERS dgen ON dgen.ID = cd.DRIVER_ID
     LEFT JOIN DRIVERS dexc ON dexc.ID = ex.DRIVER_ID
     WHERE crc.ATIVO = true AND COALESCE(ex.PACOTE_ID, cd.PACOTE_ID, ex.DRIVER_ID, cd.DRIVER_ID) = {{pkgId}}
     ORDER BY cr.CODIGO, cc.CODIGO`, 'Regras CRxConta do pacote (excecao sobrepoe global).'],
  ['hotPkgOrcamentoPacote', `SELECT * FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = {{pkgId}} AND CICLO_ID = {{cicloId}}`, 'ORCAMENTO_PACOTE do pacote/ciclo.'],
  ['hotPkgRateioConfig', `SELECT * FROM RATEIO_CONFIG WHERE DRIVER_ID = {{pkgId}} ORDER BY ID DESC LIMIT 1`, 'Ultimo RATEIO_CONFIG do pacote.'],
  ['hotPkgRateioCr', `SELECT * FROM RATEIO_CR WHERE RATEIO_CONFIG_ID = (SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID = {{pkgId}} ORDER BY ID DESC LIMIT 1)`, 'RATEIO_CR do ultimo config do pacote.'],
  ['hotPkgCrOrcamento', `SELECT CR_ID, MES, SUM(VALOR) as VALOR FROM ORCAMENTO
     WHERE CICLO_ID = {{cicloId}} AND DRIVER_TIPO = (SELECT NOME FROM DRIVERS WHERE ID = {{pkgId}}) GROUP BY CR_ID, MES`, 'ORCAMENTO por CR/mes do pacote (por nome do driver).'],
  ['hotPkgRealizadoAnterior', `SELECT rc.CONTA_ID, SUM(rc.VALOR) as VALOR
     FROM REALIZADO_CONTABIL rc
     JOIN (
       SELECT crc.CR_ID, crc.CONTA_ID FROM CR_CONTA crc
       LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
       LEFT JOIN CONTA_DRIVER_EXCECAO ex ON ex.CR_ID = crc.CR_ID AND ex.CONTA_ID = crc.CONTA_ID AND ex.ATIVO = true
       WHERE crc.ATIVO = true AND COALESCE(ex.PACOTE_ID, cd.PACOTE_ID, ex.DRIVER_ID, cd.DRIVER_ID) = {{pkgId}}
     ) reg ON reg.CR_ID = rc.CR_ID AND reg.CONTA_ID = rc.CONTA_ID
     WHERE rc.ANO = {{ano}} GROUP BY rc.CONTA_ID`, 'Realizado ano anterior das contas do pacote.'],
  // Versoes
  ['hotGestoresComCrs', `SELECT g.*, GROUP_CONCAT(gc.CR_ID) as CR_IDS FROM GESTOR g
     JOIN GESTOR_CR gc ON gc.GESTOR_ID = g.ID WHERE g.ATIVO = 'true' GROUP BY g.ID ORDER BY g.NOME`, 'Gestores ativos com CRs concatenados.'],
  // Premissas
  ['hotPremissaImpostoPorCiclo', `SELECT pi.*, cc.CODIGO, cc.NOME FROM PREMISSA_IMPOSTO pi
     JOIN CONTA_CONTABIL cc ON cc.ID = pi.CONTA_ID WHERE pi.CICLO_ID = {{cicloId}} ORDER BY cc.CODIGO`, 'Premissas de imposto do ciclo.'],
];

for (const [name, code, description] of S) {
  await createServerFunctionMitra({ projectId, name, type: 'SQL', code, description });
}
const list = await listServerFunctionsMitra({ projectId });
const fns = (list.result || list);
const out = {};
for (const [name] of S) out[name] = fns.find(x => x.name === name)?.id;
console.log(JSON.stringify(out, null, 0));
