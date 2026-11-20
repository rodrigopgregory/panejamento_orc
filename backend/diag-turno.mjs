import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 76;

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

const p = (t, rows) => { console.log(`\n=== ${t} ===`); if (!rows.length) return console.log('  (vazio)'); rows.forEach(r => console.log('  ' + JSON.stringify(r))); };

async function main() {
  p('CICLOS', await query("SELECT ID, NOME, ANO, STATUS, VERSAO_ATUAL FROM CICLO ORDER BY ID DESC"));

  // ---- BUG folha: DRIVER_CONFIG legado vs CONTA_DRIVER vivo
  p('DRIVER_CONFIG (legado, usado pelas SF 60/61)', await query("SELECT * FROM DRIVER_CONFIG"));
  p('CONTAS 5.1.x (plano de contas de pessoal)', await query("SELECT ID, CODIGO, NOME FROM CONTA_CONTABIL WHERE CODIGO LIKE '5.1%' ORDER BY CODIGO"));
  p('Mapeamento vivo PESSOAL (CONTA_DRIVER x DRIVERS)', await query(
    "SELECT cd.CONTA_ID, cc.CODIGO, cc.NOME, d.NOME AS DRIVER FROM CONTA_DRIVER cd JOIN DRIVERS d ON d.ID=cd.DRIVER_ID JOIN CONTA_CONTABIL cc ON cc.ID=cd.CONTA_ID WHERE d.NOME LIKE '%PESSOAL%' OR d.NOME LIKE '%Pessoal%'"));
  p('ORCAMENTO_PESSOAL (agregado por ciclo/cr)', await query(
    "SELECT CICLO_ID, CR_ID, COUNT(*) AS LINHAS, SUM(TOTAL) AS TOTAL FROM ORCAMENTO_PESSOAL GROUP BY CICLO_ID, CR_ID ORDER BY CICLO_ID DESC, CR_ID"));
  p('ORCAMENTO em contas 5.1.x (o que chegou de fato)', await query(
    "SELECT o.CICLO_ID, o.CR_ID, cc.CODIGO, COUNT(*) AS LINHAS, SUM(o.VALOR) AS TOTAL FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID=o.CONTA_ID WHERE cc.CODIGO LIKE '5.1%' GROUP BY o.CICLO_ID, o.CR_ID, cc.CODIGO ORDER BY o.CICLO_ID DESC"));

  // ---- BUG rateio (custos com software)
  p('DRIVERS escopo PACOTE', await query("SELECT ID, NOME, TIPO_DRIVER, ESCOPO, ATIVO FROM DRIVERS WHERE ESCOPO='PACOTE'"));
  p('DRIVER_FORMULA de pacotes (linhas de conta)', await query(
    "SELECT df.ID, df.DRIVER_ID, d.NOME AS PACOTE, df.CODIGO, df.NOME_CUSTOM, df.CONTA_ID, cc.CODIGO AS CONTA, df.GRANULARIDADE, df.RATEIO_ID FROM DRIVER_FORMULA df JOIN DRIVERS d ON d.ID=df.DRIVER_ID LEFT JOIN CONTA_CONTABIL cc ON cc.ID=df.CONTA_ID WHERE d.ESCOPO='PACOTE' AND df.CONTA_ID IS NOT NULL ORDER BY df.DRIVER_ID, df.CODIGO"));
  p('RATEIO (cadastro)', await query("SELECT ID, NOME, ATIVO FROM RATEIO"));
  p('RATEIO_ITEM (quantidades)', await query(
    "SELECT ri.RATEIO_ID, r.NOME AS RATEIO, ri.CR_ID, cr.CODIGO AS CR, ri.QUANTIDADE FROM RATEIO_ITEM ri JOIN RATEIO r ON r.ID=ri.RATEIO_ID LEFT JOIN CENTRO_RESULTADO cr ON cr.ID=ri.CR_ID ORDER BY ri.RATEIO_ID, ri.CR_ID"));
  p('CR_CONTA das contas usadas em pacotes', await query(
    "SELECT cc2.CONTA_ID, cc.CODIGO AS CONTA, cc2.CR_ID, cr.CODIGO AS CR, cc2.ATIVO FROM CR_CONTA cc2 JOIN CONTA_CONTABIL cc ON cc.ID=cc2.CONTA_ID LEFT JOIN CENTRO_RESULTADO cr ON cr.ID=cc2.CR_ID WHERE cc2.CONTA_ID IN (SELECT DISTINCT CONTA_ID FROM DRIVER_FORMULA WHERE CONTA_ID IS NOT NULL AND DRIVER_ID IN (SELECT ID FROM DRIVERS WHERE ESCOPO='PACOTE')) ORDER BY cc2.CONTA_ID, cc2.CR_ID"));
  p('PACOTE_STATUS', await query("SELECT ID, CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS FROM PACOTE_STATUS ORDER BY ID DESC"));
}

main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
