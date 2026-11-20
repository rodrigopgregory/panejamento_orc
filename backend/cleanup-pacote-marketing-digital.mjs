// Limpa o pacote "Marketing Digital" no ciclo aberto:
//   - PACOTE_STATUS: STATUS = 'PENDENTE', COMENTARIO = NULL
//   - ORCAMENTO_PACOTE: apaga todos os lancamentos do driver/pacote
//
// Estado final: pacote pendente, sem lancamentos, pronto pra refazer.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// 1. Achar o pacote
const drvRes = await runQueryMitra({
  projectId,
  sql: `SELECT ID, NOME, TIPO_DRIVER FROM DRIVERS
        WHERE TIPO_DRIVER = 'PACOTE' AND UPPER(NOME) LIKE '%MARKETING%'`,
});
const drvs = drvRes.result?.rows || [];
if (drvs.length === 0) {
  console.error('Pacote Marketing/Marketing Digital nao encontrado. Listando todos os pacotes:');
  const all = await runQueryMitra({
    projectId,
    sql: `SELECT ID, NOME FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE' ORDER BY NOME`,
  });
  (all.result?.rows || []).forEach((r) => console.log(`  ID=${r.ID}  ${r.NOME}`));
  process.exit(1);
}
console.log('Pacote(s) alvo:');
drvs.forEach((d) => console.log(`  ID=${d.ID}  ${d.NOME}`));
const drvIds = drvs.map((d) => d.ID).join(',');

// 2. Ciclo aberto
const cicloRes = await runQueryMitra({
  projectId,
  sql: `SELECT ID, NOME, STATUS FROM CICLO
        WHERE STATUS NOT IN ('FINALIZADA', 'FECHADO', 'FINALIZADO')
        ORDER BY ID DESC`,
});
const ciclos = cicloRes.result?.rows || [];
if (ciclos.length === 0) {
  console.error('Nenhum ciclo aberto. Abortando.');
  process.exit(1);
}
console.log('\nCiclos abertos:');
ciclos.forEach((c) => console.log(`  ID=${c.ID}  ${c.NOME}  ${c.STATUS}`));
const cicloIds = ciclos.map((c) => c.ID).join(',');

// 3. Estado antes
const beforeOrc = await runQueryMitra({
  projectId,
  sql: `SELECT DRIVER_ID, COUNT(*) AS N FROM ORCAMENTO_PACOTE
        WHERE DRIVER_ID IN (${drvIds}) AND CICLO_ID IN (${cicloIds})
        GROUP BY DRIVER_ID`,
});
const beforeSt = await runQueryMitra({
  projectId,
  sql: `SELECT DRIVER_ID, GESTOR_ID, STATUS, COMENTARIO FROM PACOTE_STATUS
        WHERE DRIVER_ID IN (${drvIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log('\nLancamentos ORCAMENTO_PACOTE:');
(beforeOrc.result?.rows || []).forEach((r) => console.log(`  DRIVER=${r.DRIVER_ID}: ${r.N} linhas`));
console.log('\nPACOTE_STATUS atual:');
(beforeSt.result?.rows || []).forEach((r) =>
  console.log(`  DRIVER=${r.DRIVER_ID}  GESTOR=${r.GESTOR_ID}  STATUS=${r.STATUS}  COMENT=${r.COMENTARIO || '(vazio)'}`)
);

// 4. Apagar lancamentos
const delOrc = await runDmlMitra({
  projectId,
  sql: `DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID IN (${drvIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log(`\nORCAMENTO_PACOTE apagados: ${delOrc.result?.affectedRows ?? 'ok'}`);

// 5. Resetar status (inclui DRIVERS_CONFIRMADOS, que controla o
// contador "X modelos preenchidos" na tela do gestor de pacote)
const updSt = await runDmlMitra({
  projectId,
  sql: `UPDATE PACOTE_STATUS
        SET STATUS = 'PENDENTE',
            COMENTARIO = NULL,
            DRIVERS_CONFIRMADOS = NULL
        WHERE DRIVER_ID IN (${drvIds}) AND CICLO_ID IN (${cicloIds})`,
});
console.log(`PACOTE_STATUS resetados: ${updSt.result?.affectedRows ?? 'ok'}`);

// 6. Estado final
const finalRes = await runQueryMitra({
  projectId,
  sql: `SELECT d.NOME, ps.CICLO_ID, ps.STATUS, ps.COMENTARIO,
               (SELECT COUNT(*) FROM ORCAMENTO_PACOTE op WHERE op.DRIVER_ID = d.ID AND op.CICLO_ID = ps.CICLO_ID) AS N_LANC
        FROM DRIVERS d
        LEFT JOIN PACOTE_STATUS ps ON ps.DRIVER_ID = d.ID
        WHERE d.ID IN (${drvIds}) AND ps.CICLO_ID IN (${cicloIds})`,
});
console.log('\nEstado final:');
(finalRes.result?.rows || []).forEach((r) =>
  console.log(`  ${r.NOME} (ciclo ${r.CICLO_ID}): STATUS=${r.STATUS}  COMENT=${r.COMENTARIO || '(vazio)'}  LANCAMENTOS=${r.N_LANC}`)
);
console.log('\nPronto.');
