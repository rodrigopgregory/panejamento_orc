// Base de DEMO na versao ABERTA (ciclo 133): apaga os lancamentos de teste e
// semeia um cenario limpo e coerente — orcamento completo derivado da ultima
// versao fechada (120) com reajuste de 6%, pacote materializado pelo rateio,
// inputs de Volume/Ticket consistentes com a receita, statuses variados no
// workflow (aprovados, submetidos, reprovado com motivo, pendentes) e trilha
// de auditoria coerente. NAO toca em nenhuma versao FECHADA.
// Re-executavel: limpa o ciclo 133 e reconstroi do zero a cada rodada.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra, createRecordsBatchMitra } from 'mitra-sdk';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch {} }
  return o?.rows || [];
};
const dml = (sql) => runDmlMitra({ projectId, sql });

const CICLO = 133;           // versao aberta (era 'Teste')
const FONTE = 120;           // ultima versao fechada com dados completos
const UPLIFT = 1.06;         // reajuste sobre a fonte
const NOME_DEMO = 'Forecast 2026 (5+7)';
const PACOTE_ID = 24;        // CUSTOS_DE_SOFTWARE
const CONTA_SOFTWARE = 33;
const RATEIO_SOFTWARE = 2;   // rateio Pessoal (quantidades por CR)
const PKG_MENSAL = 24900;    // total mensal da linha Software

// datas coerentes (ultimos dias)
const d = (diasAtras, hora) => {
  const dt = new Date(Date.now() - diasAtras * 86400000);
  return dt.toISOString().slice(0, 10) + 'T' + hora;
};

console.log('[1] Renomeia a versao aberta:', NOME_DEMO);
await dml(`UPDATE CICLO SET NOME = '${NOME_DEMO}' WHERE ID = ${CICLO} AND STATUS <> 'FECHADO'`);

console.log('[2] Limpa os lancamentos de teste do ciclo', CICLO);
for (const t of ['ORCAMENTO', 'ORCAMENTO_PESSOAL', 'ORCAMENTO_PACOTE', 'DRIVER_FORMULA_VALOR', 'HIST_PREMISSA', 'CONTRATACAO_PROJETADA', 'AUMENTO_SALARIAL', 'DESLIGAMENTO_PROJETADO']) {
  await dml(`DELETE FROM ${t} WHERE CICLO_ID = ${CICLO}`);
}
await dml(`DELETE FROM WORKFLOW_AUDITORIA WHERE CICLO_ID = ${CICLO}`);

console.log('[3] Orcamento por CR (fonte: versao', FONTE, `x ${UPLIFT})`);
await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO)
  SELECT ${CICLO}, CR_ID, CONTA_ID, MES, ROUND(VALOR * ${UPLIFT}), QUANTIDADE, VALOR_UNITARIO
  FROM ORCAMENTO WHERE CICLO_ID = ${FONTE} AND CR_ID <> 6`); // CR006 fica PENDENTE sem lancamentos (comecando)

console.log('[4] Folha projetada (ORCAMENTO_PESSOAL)');
await dml(`INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL)
  SELECT ${CICLO}, CR_ID, COLABORADOR_ID, MES, ROUND(SALARIO * ${UPLIFT}, 2), ROUND(BENEFICIOS * ${UPLIFT}, 2), ROUND(ENCARGOS * ${UPLIFT}, 2), ROUND(TOTAL * ${UPLIFT}, 2)
  FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${FONTE} AND CR_ID <> 6`);

console.log('[5] Premissas historicas, contratacoes e aumentos');
await dml(`INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM)
  SELECT ${CICLO}, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, '${d(3, '09:12:00')}'
  FROM HIST_PREMISSA WHERE CICLO_ID = ${FONTE} AND CR_ID <> 6`);
await dml(`INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, CRIADO_EM)
  SELECT ${CICLO}, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, '${d(3, '10:05:00')}'
  FROM CONTRATACAO_PROJETADA WHERE CICLO_ID = ${FONTE} AND CR_ID <> 6`);
await dml(`INSERT INTO AUMENTO_SALARIAL (CICLO_ID, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, CRIADO_EM)
  SELECT ${CICLO}, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, '${d(3, '10:20:00')}'
  FROM AUMENTO_SALARIAL WHERE CICLO_ID = ${FONTE}`);

console.log('[6] Pacote Custos De Software — linha Software distribuida pelo rateio');
const crsConta = (await q(`SELECT CR_ID FROM CR_CONTA WHERE CONTA_ID = ${CONTA_SOFTWARE} AND ATIVO = true`)).map(r => Number(r.CR_ID));
const itens = (await q(`SELECT CR_ID, QUANTIDADE FROM RATEIO_ITEM WHERE RATEIO_ID = ${RATEIO_SOFTWARE}`))
  .filter(r => crsConta.includes(Number(r.CR_ID)) && Number(r.QUANTIDADE) > 0);
const totQtd = itens.reduce((s, r) => s + Number(r.QUANTIDADE), 0);
const pkgRows = [];
for (let mes = 1; mes <= 12; mes++) {
  let usado = 0;
  itens.forEach((r, i) => {
    const v = i === itens.length - 1 ? PKG_MENSAL - usado : Math.round(PKG_MENSAL * Number(r.QUANTIDADE) / totQtd);
    usado += v;
    pkgRows.push({ CICLO_ID: CICLO, DRIVER_ID: PACOTE_ID, CR_ID: Number(r.CR_ID), CONTA_ID: CONTA_SOFTWARE, MES: mes, VALOR: v });
  });
}
await createRecordsBatchMitra({ projectId, tableName: 'ORCAMENTO_PACOTE', records: pkgRows });

console.log('[7] Inputs de Receita (Volume x Ticket) coerentes com o orcamento da conta');
// formulas do modelo RECEITA: L1 = Volume de vendas (ID 59), L2 = Ticket Medio (ID 60)
const receitaRows = await q(`SELECT o.CR_ID, o.MES, o.VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = ${CICLO} AND o.CONTA_ID = 1`);
const dfv = [];
for (const r of receitaRows) {
  const ticket = 9200 + ((Number(r.MES) * 37) % 600); // 9200-9800, deterministico por mes
  const volume = Math.max(1, Math.round(Number(r.VALOR) / ticket));
  dfv.push({ FORMULA_ID: 59, CICLO_ID: CICLO, CR_ID: Number(r.CR_ID), MES: Number(r.MES), VALOR: volume });
  dfv.push({ FORMULA_ID: 60, CICLO_ID: CICLO, CR_ID: Number(r.CR_ID), MES: Number(r.MES), VALOR: ticket });
  // conta de receita alinhada ao produto Volume x Ticket (a linha de formula do grid bate com o DRE)
  await dml(`UPDATE ORCAMENTO SET VALOR = ${volume * ticket} WHERE CICLO_ID = ${CICLO} AND CR_ID = ${r.CR_ID} AND CONTA_ID = 1 AND MES = ${r.MES}`);
}
if (dfv.length) await createRecordsBatchMitra({ projectId, tableName: 'DRIVER_FORMULA_VALOR', records: dfv });

console.log('[8] Workflow: statuses variados (base da demo)');
const FULL4 = 'BASE_HISTORICO,BASE_ZERO,PESSOAL,RECEITA';
const FULL3 = 'BASE_HISTORICO,BASE_ZERO,PESSOAL';
const MOTIVO_CR5 = 'Benefícios acima do teto aprovado para 2026 — revisar as premissas de vale-refeição e plano de saúde antes de reenviar.';
const setCr = async (crId, status, csv, coment, quando) => {
  await dml(`UPDATE ORCAMENTO_STATUS SET STATUS = '${status}', DRIVERS_CONFIRMADOS = '${csv}',
    COMENTARIO = ${coment ? `'${coment.replace(/'/g, "''")}'` : "''"}, ATUALIZADO_EM = '${quando}'
    WHERE CICLO_ID = ${CICLO} AND CR_ID = ${crId}`);
};
await setCr(1, 'APROVADO',  FULL4, null, d(1, '15:40:00'));            // Diretoria Comercial — Aliny
await setCr(2, 'APROVADO',  FULL3, null, d(1, '16:05:00'));            // Diretoria de Tecnologia — Ana
await setCr(4, 'SUBMETIDO', FULL3, null, d(0, '09:30:00'));            // Operacoes — Ana (aguardando)
await setCr(5, 'REPROVADO', FULL3, MOTIVO_CR5, d(0, '10:15:00'));      // RH — Aliny (corrigindo)
await setCr(6, 'PENDENTE',  '',    null, d(2, '08:00:00'));            // Marketing — Victor (nao comecou)
await setCr(7, 'SUBMETIDO', FULL4, null, d(0, '11:20:00'));            // Consultoria Projetos — Juliana
await setCr(8, 'PENDENTE',  'BASE_ZERO,RECEITA', null, d(0, '14:00:00')); // Consultoria Estrategia — parcial
await dml(`UPDATE PACOTE_STATUS SET STATUS = 'SUBMETIDO', DRIVERS_CONFIRMADOS = 'CUSTOS_DE_SOFTWARE', COMENTARIO = '', ATUALIZADO_EM = '${d(0, '12:10:00')}'
  WHERE CICLO_ID = ${CICLO} AND DRIVER_ID = ${PACOTE_ID}`);

console.log('[9] Trilha de auditoria coerente');
const audit = [
  [1,  null, 'SUBMETIDO', 'PENDENTE',  'SUBMETIDO', '', 'Aliny Ferreira', 'LINK', d(1, '14:55:00')],
  [1,  null, 'APROVADO',  'SUBMETIDO', 'APROVADO',  '', 'Paula',          'APP',  d(1, '15:40:00')],
  [2,  null, 'SUBMETIDO', 'CONFIRMADO','SUBMETIDO', '', 'Ana Beatriz Silva', 'LINK', d(1, '11:10:00')],
  [2,  null, 'APROVADO',  'SUBMETIDO', 'APROVADO',  '', 'Paula',          'APP',  d(1, '16:05:00')],
  [4,  null, 'SUBMETIDO', 'CONFIRMADO','SUBMETIDO', '', 'Ana Beatriz Silva', 'LINK', d(0, '09:30:00')],
  [5,  null, 'SUBMETIDO', 'CONFIRMADO','SUBMETIDO', '', 'Aliny Ferreira', 'LINK', d(1, '17:22:00')],
  [5,  null, 'REPROVADO', 'SUBMETIDO', 'REPROVADO', MOTIVO_CR5, 'Paula', 'APP',  d(0, '10:15:00')],
  [7,  null, 'SUBMETIDO', 'CONFIRMADO','SUBMETIDO', '', 'Juliana Costa',  'LINK', d(0, '11:20:00')],
  [null, PACOTE_ID, 'SUBMETIDO', 'CONFIRMADO', 'SUBMETIDO', '', 'Aliny Ferreira', 'LINK', d(0, '12:10:00')],
];
for (const [crId, driverId, evento, de, para, coment, autor, origem, quando] of audit) {
  const gestor = crId
    ? (await q(`SELECT GESTOR_ID FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${CICLO} AND CR_ID = ${crId} LIMIT 1`))[0]?.GESTOR_ID
    : (await q(`SELECT GESTOR_ID FROM PACOTE_STATUS WHERE CICLO_ID = ${CICLO} AND DRIVER_ID = ${driverId} LIMIT 1`))[0]?.GESTOR_ID;
  await dml(`INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, DRIVER_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM) VALUES
    (${CICLO}, '${crId ? 'CR' : 'PACOTE'}', ${crId ?? 'NULL'}, ${driverId ?? 'NULL'}, ${gestor ?? 'NULL'}, '${evento}', '${de}', '${para}', '${String(coment).replace(/'/g, "''")}', '${autor}', '${origem}', '${quando}')`);
}

console.log('\n== RESUMO FINAL ==');
console.table(await q(`SELECT NOME, STATUS FROM CICLO WHERE ID = ${CICLO}`));
console.table(await q(`SELECT cr.CODIGO, s.STATUS, s.DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS s JOIN CENTRO_RESULTADO cr ON cr.ID = s.CR_ID WHERE s.CICLO_ID = ${CICLO} ORDER BY cr.CODIGO`));
console.table(await q(`SELECT d.NOME, s.STATUS FROM PACOTE_STATUS s JOIN DRIVERS d ON d.ID = s.DRIVER_ID WHERE s.CICLO_ID = ${CICLO}`));
console.table(await q(`SELECT 'ORCAMENTO' T, COUNT(*) N, ROUND(SUM(VALOR)) TOTAL FROM ORCAMENTO WHERE CICLO_ID = ${CICLO}
  UNION ALL SELECT 'ORCAMENTO_PACOTE', COUNT(*), ROUND(SUM(VALOR)) FROM ORCAMENTO_PACOTE WHERE CICLO_ID = ${CICLO}
  UNION ALL SELECT 'ORCAMENTO_PESSOAL', COUNT(*), NULL FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${CICLO}
  UNION ALL SELECT 'DFV (Volume/Ticket)', COUNT(*), NULL FROM DRIVER_FORMULA_VALOR WHERE CICLO_ID = ${CICLO}
  UNION ALL SELECT 'AUDITORIA', COUNT(*), NULL FROM WORKFLOW_AUDITORIA WHERE CICLO_ID = ${CICLO}`));
console.log('Demo pronta na versao aberta', CICLO, '-', NOME_DEMO);
