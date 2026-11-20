// Limpa "Diretoria Comercial" e "Marketing Digital" no ciclo aberto:
//   - ORCAMENTO_STATUS: STATUS = 'PENDENTE', COMENTARIO = NULL, DRIVERS_CONFIRMADOS = NULL, DATA_CONFIRMACAO = NULL
//   - ORCAMENTO: apaga todos os lancamentos do CR
//   - ORCAMENTO_PACOTE: apaga todos os lancamentos do CR
//
// Estado final: CR aparece como "Pendente", sem lancamentos, sem reprovacao
// nem justificativa — pronto pra lancar do zero.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// 1. Descobrir IDs dos CRs alvo
const crRes = await runQueryMitra({
  projectId,
  sql: `SELECT ID, CODIGO, NOME FROM CENTRO_RESULTADO
        WHERE NOME LIKE '%Diretoria Comercial%'
           OR NOME LIKE '%Marketing Digital%'
           OR NOME LIKE '%Marketing%'
        ORDER BY NOME`,
});
const crs = crRes.result?.rows || [];
if (crs.length === 0) {
  console.error('Nenhum dos 2 CRs encontrado. Abortando.');
  process.exit(1);
}
console.log('CRs alvo:');
crs.forEach((c) => console.log(`  ID=${c.ID}  CODIGO=${c.CODIGO}  NOME=${c.NOME}`));
const crIds = crs.map((c) => c.ID).join(',');

// 2. Descobrir o ciclo aberto (nao FINALIZADO/FECHADO)
const ciclosRes = await runQueryMitra({
  projectId,
  sql: `SELECT ID, NOME, ANO, STATUS FROM CICLO
        WHERE STATUS NOT IN ('FINALIZADA', 'FECHADO', 'FINALIZADO')
        ORDER BY ID DESC`,
});
const ciclos = ciclosRes.result?.rows || [];
if (ciclos.length === 0) {
  console.error('Nenhum ciclo aberto encontrado. Abortando.');
  process.exit(1);
}
console.log('\nCiclos abertos:');
ciclos.forEach((c) => console.log(`  ID=${c.ID}  NOME=${c.NOME}  ANO=${c.ANO}  STATUS=${c.STATUS}`));
const cicloIds = ciclos.map((c) => c.ID).join(',');

// 3. Diagnostico: quantos lancamentos vamos apagar
const countOrc = await runQueryMitra({
  projectId,
  sql: `SELECT CR_ID, COUNT(*) AS N FROM ORCAMENTO
        WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})
        GROUP BY CR_ID`,
});
const countPac = await runQueryMitra({
  projectId,
  sql: `SELECT CR_ID, COUNT(*) AS N FROM ORCAMENTO_PACOTE
        WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})
        GROUP BY CR_ID`,
});
const countSt = await runQueryMitra({
  projectId,
  sql: `SELECT CR_ID, STATUS, COMENTARIO, DRIVERS_CONFIRMADOS
        FROM ORCAMENTO_STATUS
        WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log('\nLancamentos ORCAMENTO:');
(countOrc.result?.rows || []).forEach((r) => console.log(`  CR=${r.CR_ID}: ${r.N} linhas`));
console.log('\nLancamentos ORCAMENTO_PACOTE:');
(countPac.result?.rows || []).forEach((r) => console.log(`  CR=${r.CR_ID}: ${r.N} linhas`));
console.log('\nORCAMENTO_STATUS atual:');
(countSt.result?.rows || []).forEach((r) =>
  console.log(`  CR=${r.CR_ID}: STATUS=${r.STATUS}  COMENT=${r.COMENTARIO || '(vazio)'}  DRIVERS=${r.DRIVERS_CONFIRMADOS || '(vazio)'}`)
);

// 4. Limpar ORCAMENTO
const delOrc = await runDmlMitra({
  projectId,
  sql: `DELETE FROM ORCAMENTO WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log(`\nORCAMENTO apagados: ${delOrc.result?.affectedRows ?? 'ok'}`);

// 5. Limpar ORCAMENTO_PACOTE
const delPac = await runDmlMitra({
  projectId,
  sql: `DELETE FROM ORCAMENTO_PACOTE WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log(`ORCAMENTO_PACOTE apagados: ${delPac.result?.affectedRows ?? 'ok'}`);

// 6. Resetar ORCAMENTO_STATUS pra pendente, sem justificativa nem drivers
const updSt = await runDmlMitra({
  projectId,
  sql: `UPDATE ORCAMENTO_STATUS
        SET STATUS = 'PENDENTE',
            COMENTARIO = NULL,
            DRIVERS_CONFIRMADOS = NULL
        WHERE CR_ID IN (${crIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log(`ORCAMENTO_STATUS resetados: ${updSt.result?.affectedRows ?? 'ok'}`);

// 7. Conferencia final
const final = await runQueryMitra({
  projectId,
  sql: `SELECT cr.NOME, os.CICLO_ID, os.STATUS, os.COMENTARIO,
               (SELECT COUNT(*) FROM ORCAMENTO o WHERE o.CR_ID = cr.ID AND o.CICLO_ID = os.CICLO_ID) AS N_ORC,
               (SELECT COUNT(*) FROM ORCAMENTO_PACOTE op WHERE op.CR_ID = cr.ID AND op.CICLO_ID = os.CICLO_ID) AS N_PAC
        FROM CENTRO_RESULTADO cr
        LEFT JOIN ORCAMENTO_STATUS os ON os.CR_ID = cr.ID
        WHERE cr.ID IN (${crIds}) AND os.CICLO_ID IN (${cicloIds})`,
});
console.log('\nEstado final:');
(final.result?.rows || []).forEach((r) =>
  console.log(`  ${r.NOME} (ciclo ${r.CICLO_ID}): STATUS=${r.STATUS}  COMENT=${r.COMENTARIO || '(vazio)'}  ORC=${r.N_ORC}  PAC=${r.N_PAC}`)
);
console.log('\nPronto.');
