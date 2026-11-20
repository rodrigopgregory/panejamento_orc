// Correcao aprovada pelo usuario (2026-07-07):
// 1. Excluir conjuntos orfaos de BENEFICIO/ENCARGO dos ciclos 107/108 (versoes deletadas).
// 2. Recalcular BENEFICIOS/ENCARGOS/TOTAL em ORCAMENTO_PESSOAL dos ciclos 120 e 121,
//    que foram gravados somando os conjuntos de TODOS os ciclos (~4x inflado) —
//    bug corrigido no frontend em 9234b73 (calcBenEnc sem filtro de ciclo).
// 3. Reagregar as contas 5.1.01/5.1.02/5.1.03 no ORCAMENTO via SFs 60/61 por CR.
// Formula identica ao calcBenEnc do frontend, usando SO o conjunto do proprio ciclo:
//   CLT: ben = F_CLT + salario * P_CLT/100 ; enc = salario * E_CLT/100
//   PJ:  ben = F_PJ  + salario * P_PJ/100  ; enc = 0
//   (COLABORADOR_ID NULL = contratacao projetada, tratada como CLT — igual ao frontend)
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error('query falhou: ' + (r?.result?.error || sql));
  return o?.rows || [];
};
const dml = async (sql) => {
  const r = await runDmlMitra({ projectId, sql });
  return r;
};

const CICLOS = [120, 121];

console.log('── ANTES ──');
console.log(JSON.stringify(await q(`SELECT CICLO_ID, CR_ID, ROUND(AVG(BENEFICIOS),0) AS BEN_MEDIO, ROUND(AVG(ENCARGOS),0) AS ENC_MEDIO FROM ORCAMENTO_PESSOAL WHERE CICLO_ID IN (${CICLOS.join(',')}) GROUP BY CICLO_ID, CR_ID`)));
console.log('ORCAMENTO 5.1.x antes:', JSON.stringify(await q(`SELECT o.CICLO_ID, o.CR_ID, cc.CODIGO, ROUND(SUM(o.VALOR),0) AS TOTAL_ANO FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID WHERE o.CICLO_ID IN (${CICLOS.join(',')}) AND cc.CODIGO IN ('5.1.01','5.1.02','5.1.03') GROUP BY o.CICLO_ID, o.CR_ID, cc.CODIGO ORDER BY 1,2,3`)));

// ── 1. Orfaos ──
console.log('── [1] Excluindo conjuntos orfaos (ciclos 107/108) ──');
await dml(`DELETE FROM BENEFICIO WHERE CICLO_ID IN (107, 108)`);
await dml(`DELETE FROM ENCARGO WHERE CICLO_ID IN (107, 108)`);
console.log('  orfaos removidos');

// ── 2. Recalculo por ciclo ──
for (const cicloId of CICLOS) {
  const [bset] = await q(`SELECT
    SUM(CASE WHEN TIPO='FIXO' AND APLICA_CLT='true' THEN VALOR ELSE 0 END) AS F_CLT,
    SUM(CASE WHEN TIPO<>'FIXO' AND APLICA_CLT='true' THEN PERCENTUAL ELSE 0 END) AS P_CLT,
    SUM(CASE WHEN TIPO='FIXO' AND APLICA_PJ='true' THEN VALOR ELSE 0 END) AS F_PJ,
    SUM(CASE WHEN TIPO<>'FIXO' AND APLICA_PJ='true' THEN PERCENTUAL ELSE 0 END) AS P_PJ
    FROM BENEFICIO WHERE CICLO_ID = ${cicloId}`);
  const [eset] = await q(`SELECT SUM(CASE WHEN APLICA_CLT='true' THEN PERCENTUAL ELSE 0 END) AS E_CLT FROM ENCARGO WHERE CICLO_ID = ${cicloId}`);
  const { F_CLT, P_CLT, F_PJ, P_PJ } = bset;
  const E_CLT = eset.E_CLT;
  console.log(`── [2] Ciclo ${cicloId}: F_CLT=${F_CLT} P_CLT=${P_CLT}% F_PJ=${F_PJ} P_PJ=${P_PJ}% E_CLT=${E_CLT}%`);

  await dml(`UPDATE ORCAMENTO_PESSOAL op
    LEFT JOIN COLABORADOR c ON c.ID = op.COLABORADOR_ID
    SET op.BENEFICIOS = ROUND(CASE WHEN c.ID IS NULL OR c.TIPO_CONTRATO = 'CLT'
          THEN ${F_CLT} + op.SALARIO * ${P_CLT} / 100
          ELSE ${F_PJ} + op.SALARIO * ${P_PJ} / 100 END, 2),
        op.ENCARGOS = ROUND(CASE WHEN c.ID IS NULL OR c.TIPO_CONTRATO = 'CLT'
          THEN op.SALARIO * ${E_CLT} / 100 ELSE 0 END, 2)
    WHERE op.CICLO_ID = ${cicloId}`);
  await dml(`UPDATE ORCAMENTO_PESSOAL SET TOTAL = ROUND(SALARIO + BENEFICIOS + ENCARGOS, 2) WHERE CICLO_ID = ${cicloId}`);

  // ── 3. Reagrega ORCAMENTO (contas 5.1.x) por CR — SFs 60 (limpar) + 61 (gravar) ──
  const crs = await q(`SELECT DISTINCT CR_ID FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${cicloId}`);
  for (const { CR_ID } of crs) {
    const r60 = await executeServerFunctionMitra({ projectId, serverFunctionId: 60, input: { cicloId, crId: CR_ID } });
    const r61 = await executeServerFunctionMitra({ projectId, serverFunctionId: 61, input: { cicloId, crId: CR_ID } });
    console.log(`  [3] ciclo ${cicloId} CR ${CR_ID}: limpar=${r60?.result?.executionStatus} gravar=${r61?.result?.executionStatus}`);
  }
}

console.log('── DEPOIS ──');
console.log(JSON.stringify(await q(`SELECT CICLO_ID, CR_ID, ROUND(AVG(BENEFICIOS),0) AS BEN_MEDIO, ROUND(AVG(ENCARGOS),0) AS ENC_MEDIO FROM ORCAMENTO_PESSOAL WHERE CICLO_ID IN (${CICLOS.join(',')}) GROUP BY CICLO_ID, CR_ID`)));
console.log('ORCAMENTO 5.1.x depois:', JSON.stringify(await q(`SELECT o.CICLO_ID, o.CR_ID, cc.CODIGO, ROUND(SUM(o.VALOR),0) AS TOTAL_ANO FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID WHERE o.CICLO_ID IN (${CICLOS.join(',')}) AND cc.CODIGO IN ('5.1.01','5.1.02','5.1.03') GROUP BY o.CICLO_ID, o.CR_ID, cc.CODIGO ORDER BY 1,2,3`)));
console.log('amostra CLT:', JSON.stringify(await q(`SELECT op.SALARIO, op.BENEFICIOS, op.ENCARGOS, op.TOTAL FROM ORCAMENTO_PESSOAL op JOIN COLABORADOR c ON c.ID = op.COLABORADOR_ID WHERE op.CICLO_ID = 121 AND c.TIPO_CONTRATO = 'CLT' LIMIT 2`)));
console.log('amostra PJ:', JSON.stringify(await q(`SELECT op.SALARIO, op.BENEFICIOS, op.ENCARGOS, op.TOTAL FROM ORCAMENTO_PESSOAL op JOIN COLABORADOR c ON c.ID = op.COLABORADOR_ID WHERE op.CICLO_ID = 121 AND c.TIPO_CONTRATO = 'PJ' LIMIT 2`)));
console.log('Concluido.');
