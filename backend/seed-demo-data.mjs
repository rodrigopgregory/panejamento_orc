// Demo seed: distribui 7 orcamentos do CICLO 120 entre os 4 status do workflow
// e cria lancamentos completos pros que sao Submetido/Aprovado/Reprovado.
//
// Preserva os 38 lancamentos existentes em CR1 (BASE_ZERO, RECEITA) e
// completa apenas os drivers faltantes (BASE_HISTORICO, PESSOAL).
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const CICLO = 120;

async function query(sql) {
  const r = await runQueryMitra({ projectId, sql });
  return r?.result?.rows || [];
}
async function dml(sql) {
  return await runDmlMitra({ projectId, sql });
}

const NOW = '2026-05-29T14:00:00';

// ---------- 1) Atualizar STATUS dos orcamentos ----------

const PLANO_ORCAMENTOS = [
  // [ORCAMENTO_STATUS_ID, CR_ID, STATUS, COMENTARIO_OPCIONAL]
  [995,  1, 'APROVADO',  null],
  [998,  5, 'SUBMETIDO', null],
  [996,  2, 'APROVADO',  null],
  [1000, 4, 'REPROVADO', 'Revisar premissas de Operações — valores acima do teto aprovado pelo comitê.'],
  [994,  7, 'SUBMETIDO', null],
  // PENDENTE — nao mexer: 997 (CR8 Juliana), 999 (CR6 Victor)
];

const DRIVERS_CONFIRMADOS_TODOS = 'BASE_ZERO,BASE_HISTORICO,RECEITA,PESSOAL';

console.log('=== 1. Atualizando STATUS dos orcamentos ===');
for (const [id, cr, status, comment] of PLANO_ORCAMENTOS) {
  const escComment = comment ? `'${comment.replace(/'/g, "''")}'` : 'NULL';
  await dml(`UPDATE ORCAMENTO_STATUS
             SET STATUS = '${status}',
                 COMENTARIO = ${escComment},
                 DRIVERS_CONFIRMADOS = '${DRIVERS_CONFIRMADOS_TODOS}',
                 ATUALIZADO_EM = '${NOW}'
             WHERE ID = ${id}`);
  console.log(`  OK ORCAMENTO_STATUS ${id} (CR ${cr}) -> ${status}`);
}

// Pacote (Sarah, CUSTOS_SOFTWARE)
console.log('\n=== 2. Atualizando STATUS do pacote ===');
await dml(`UPDATE PACOTE_STATUS
           SET STATUS = 'SUBMETIDO',
               ATUALIZADO_EM = '${NOW}'
           WHERE ID = 130`);
console.log('  OK PACOTE_STATUS 130 (Sarah, CUSTOS_SOFTWARE) -> SUBMETIDO');

// ---------- 3) Criar lancamentos em ORCAMENTO ----------
// Para cada orcamento nao-pendente, lancar valores em todas as combinacoes
// (CR_CONTA x CONTA_DRIVER) ainda nao preenchidas, x 12 meses.

console.log('\n=== 3. Criando lancamentos em ORCAMENTO ===');

// Drivers e perfis de valor (base mensal + variacao por driver)
// faixas escolhidas pra dar realismo na demo
function valorBase(driverId) {
  // tipico mensal por conta (sera multiplicado por hash de conta pra variar)
  switch (driverId) {
    case 1: return 12000;   // BASE_ZERO  (despesas administrativas)
    case 2: return 25000;   // BASE_HIST  (despesas recorrentes)
    case 3: return 130000;  // RECEITA    (alto)
    case 4: return 45000;   // PESSOAL    (folha)
    case 5: return 11000;   // CUSTOS_SOFTWARE (pacote)
    default: return 5000;
  }
}

// Variacao mensal (sazonalidade + tendencia)
const FATOR_MES = [
  0.92, 0.95, 0.98, 1.00, 1.02, 1.04,
  1.06, 1.05, 1.03, 1.01, 0.99, 1.08, // dezembro com pico
];

function variacao(conta, driver, mes) {
  // hash determinístico pra variar valor entre contas
  const h = ((conta * 31 + driver * 7 + mes * 3) % 21) / 100; // -0.10 a +0.10
  return 1 + (h - 0.10);
}

function calcValor(conta, driver, mes) {
  const base = valorBase(driver);
  const v = base * FATOR_MES[mes - 1] * variacao(conta, driver, mes);
  return Math.round(v * 100) / 100;
}

// Coletar (CR, conta, driver) que precisam de lancamento
// para os 5 orcamentos nao-pendentes
const CRS_NAO_PENDENTES = PLANO_ORCAMENTOS.map(p => p[1]); // [1, 5, 2, 4, 7]
const placeholdersCr = CRS_NAO_PENDENTES.join(',');

// Mapa de (CR_ID, CONTA_ID, DRIVER_ID) que devem existir em ORCAMENTO
const combinacoes = await query(`
  SELECT crc.CR_ID, crc.CONTA_ID, cd.DRIVER_ID
  FROM CR_CONTA crc
  JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  WHERE crc.CR_ID IN (${placeholdersCr})
    AND crc.ATIVO = 1
    AND cd.DRIVER_ID IN (1,2,3,4)
`);

console.log(`  Combinacoes esperadas: ${combinacoes.length} (CR, CONTA, DRIVER)`);

// O que ja existe no ciclo 120 — vamos preservar
const existentes = await query(`
  SELECT DISTINCT o.CR_ID, o.CONTA_ID, o.MES
  FROM ORCAMENTO o
  WHERE o.CICLO_ID = ${CICLO}
`);
const chaveExist = new Set(existentes.map(r => `${r.CR_ID}|${r.CONTA_ID}|${r.MES}`));
console.log(`  Lancamentos ja existentes: ${existentes.length}`);

// Montar INSERTs em lote
const VALUES = [];
for (const c of combinacoes) {
  for (let mes = 1; mes <= 12; mes++) {
    const k = `${c.CR_ID}|${c.CONTA_ID}|${mes}`;
    if (chaveExist.has(k)) continue; // preserva existente
    const valor = calcValor(c.CONTA_ID, c.DRIVER_ID, mes);
    VALUES.push(`(${CICLO}, ${c.CR_ID}, ${c.CONTA_ID}, ${mes}, ${valor}, 0, 0)`);
  }
}
console.log(`  Lancamentos a inserir: ${VALUES.length}`);

// Inserir em chunks de 200
const CHUNK = 200;
let inseridos = 0;
for (let i = 0; i < VALUES.length; i += CHUNK) {
  const chunk = VALUES.slice(i, i + CHUNK);
  await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES ${chunk.join(',')}`);
  inseridos += chunk.length;
  console.log(`  Inseridos: ${inseridos} / ${VALUES.length}`);
}

// ---------- 4) Lancamentos do pacote CUSTOS_SOFTWARE ----------
console.log('\n=== 4. Criando lancamentos em ORCAMENTO_PACOTE (CUSTOS_SOFTWARE) ===');

// Contas mapeadas para o driver 5 (CUSTOS_SOFTWARE)
const contasPacote = await query(`
  SELECT DISTINCT cd.CONTA_ID
  FROM CONTA_DRIVER cd
  WHERE cd.DRIVER_ID = 5
`);
console.log(`  Contas do driver CUSTOS_SOFTWARE: ${contasPacote.length}`);

// Lancar pro pacote em TODAS CRs ativas (o pacote nao tem CR fixo —
// o gestor do pacote distribui entre CRs)
const crsAtivas = await query(`SELECT ID FROM CENTRO_RESULTADO WHERE ATIVO = 'true' ORDER BY ID`);
const idsCrs = crsAtivas.map(r => r.ID);

const VALUES_PAC = [];
for (const cr of idsCrs) {
  for (const conta of contasPacote) {
    for (let mes = 1; mes <= 12; mes++) {
      const valor = calcValor(conta.CONTA_ID, 5, mes);
      VALUES_PAC.push(`(${CICLO}, 5, ${conta.CONTA_ID}, ${mes}, ${valor}, ${cr})`);
    }
  }
}
console.log(`  Lancamentos de pacote a inserir: ${VALUES_PAC.length}`);

for (let i = 0; i < VALUES_PAC.length; i += CHUNK) {
  const chunk = VALUES_PAC.slice(i, i + CHUNK);
  await dml(`INSERT INTO ORCAMENTO_PACOTE (CICLO_ID, DRIVER_ID, CONTA_ID, MES, VALOR, CR_ID) VALUES ${chunk.join(',')}`);
}

// ---------- 5) Verificacao final ----------
console.log('\n=== 5. Verificacao final ===');
const finalStatus = await query(`
  SELECT os.ID, os.CR_ID, cr.NOME AS CR_NOME, g.NOME AS GESTOR, os.STATUS,
         (SELECT COUNT(*) FROM ORCAMENTO o WHERE o.CICLO_ID = ${CICLO} AND o.CR_ID = os.CR_ID) AS QTD_LANCAMENTOS
  FROM ORCAMENTO_STATUS os
  JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
  JOIN GESTOR g ON g.ID = os.GESTOR_ID
  WHERE os.CICLO_ID = ${CICLO}
  ORDER BY os.STATUS, cr.NOME
`);
console.table(finalStatus);

const finalPacote = await query(`
  SELECT ps.ID, d.NOME AS DRIVER, g.NOME AS GESTOR, ps.STATUS,
         (SELECT COUNT(*) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = ${CICLO} AND op.DRIVER_ID = ps.DRIVER_ID) AS QTD_LANCAMENTOS
  FROM PACOTE_STATUS ps
  JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
  JOIN GESTOR g ON g.ID = ps.GESTOR_ID
  WHERE ps.CICLO_ID = ${CICLO}
`);
console.table(finalPacote);

console.log('\nDemo seed concluida!');
