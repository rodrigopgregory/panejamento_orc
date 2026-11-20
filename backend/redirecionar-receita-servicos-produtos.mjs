// REDIRECIONA A RECEITA DE TICKET x VOLUME: 3.1.01 (Servicos) -> 3.1.02 (Produtos)
//
// CONTEXTO: o modelo RECEITA calcula receita como volume x ticket medio (linhas
// livres L1 e L2). Ate ontem o resultado era gravado na conta 3.1.01 Receita de
// Servicos. O modelo foi reapontado para 3.1.02 Receita de Produtos.
//
// Ficaram duas pontas soltas:
//   1. a conta 3.1.02 so estava liberada em 2 dos 6 CRs que preenchem ticket x
//      volume — nos outros 4 a receita nao tinha onde cair;
//   2. o valor calculado pela configuracao ANTIGA continua parado em 3.1.01. Se
//      ficasse, quando a gravacao ao confirmar entrasse em vigor o DRE somaria
//      as duas contas e a receita apareceria dobrada.
//
// O QUE ESTE SCRIPT FAZ (somente no ciclo VIGENTE):
//   a. libera 3.1.02 nos CRs que preenchem ticket x volume e nao a tinham;
//   b. move o valor de 3.1.01 para 3.1.02, mes a mes, CR a CR;
//   c. apaga as linhas de 3.1.01 que foram movidas.
//
// Versoes fechadas NAO sao tocadas: elas registram o orcamento como ele foi
// aprovado, com a configuracao da epoca. Reescrever historico seria mentira.
//
// Uso:
//   node redirecionar-receita-servicos-produtos.mjs            (simulacao)
//   node redirecionar-receita-servicos-produtos.mjs --aplicar  (grava)
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const APLICAR = process.argv.includes('--aplicar');

const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const dml = async (sql) => { if (APLICAR) await runDmlMitra({ projectId, sql }); };
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ORIGEM = '3.1.01';
const DESTINO = '3.1.02';

async function main() {
  console.log(APLICAR ? '*** MODO APLICAR — vai gravar ***\n' : '--- SIMULACAO (nada sera gravado) ---\n');

  const [ciclo] = await q("SELECT ID, NOME FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) { console.log('Nenhum ciclo vigente.'); return; }
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME}\n`);

  const [origem] = await q(`SELECT ID, NOME FROM CONTA_CONTABIL WHERE CODIGO = '${ORIGEM}'`);
  const [destino] = await q(`SELECT ID, NOME FROM CONTA_CONTABIL WHERE CODIGO = '${DESTINO}'`);
  if (!origem || !destino) { console.log('Conta de origem ou destino nao encontrada.'); return; }

  // ── a. Liberar a conta de destino nos CRs que calculam ticket x volume ──
  // "Calcula ticket x volume" = tem valor gravado nas linhas livres do modelo
  // RECEITA. E esse o universo que perdeu destino com a troca.
  const linhasLivres = await q(`
    SELECT f.ID FROM DRIVER_FORMULA f
    JOIN DRIVERS d ON d.ID = f.DRIVER_ID
    WHERE d.NOME = 'RECEITA' AND f.CONTA_ID IS NULL`);
  const idsLivres = linhasLivres.map((l) => l.ID).join(',') || '0';

  const crsComTicketVolume = await q(`
    SELECT DISTINCT cr.ID, cr.CODIGO
    FROM DRIVER_FORMULA_VALOR v
    JOIN CENTRO_RESULTADO cr ON cr.ID = v.CR_ID
    WHERE v.CICLO_ID = ${ciclo.ID} AND v.FORMULA_ID IN (${idsLivres})
    ORDER BY cr.CODIGO`);

  const jaMapeados = new Set((await q(`
    SELECT CR_ID FROM CR_CONTA WHERE CONTA_ID = ${destino.ID}`)).map((r) => Number(r.CR_ID)));

  console.log(`=== a. Liberar ${DESTINO} ${destino.NOME} nos CRs que calculam ticket x volume ===`);
  let liberados = 0;
  for (const cr of crsComTicketVolume) {
    if (jaMapeados.has(Number(cr.ID))) {
      console.log(`  ${cr.CODIGO}: ja liberada`);
      continue;
    }
    console.log(`  ${cr.CODIGO}: LIBERAR`);
    // ATIVO e tinyint(1) nesta tabela — 'true' como string e recusado pelo banco.
    await dml(`INSERT INTO CR_CONTA (CR_ID, CONTA_ID, ATIVO, CRIADO_EM)
               VALUES (${cr.ID}, ${destino.ID}, 1, '${new Date().toISOString().slice(0, 19)}')`);
    liberados++;
  }

  // ── b/c. Mover o valor da origem para o destino ──
  const aMover = await q(`
    SELECT o.ID, o.CR_ID, cr.CODIGO AS CR, o.MES, o.VALOR, o.QUANTIDADE, o.VALOR_UNITARIO
    FROM ORCAMENTO o
    LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
    WHERE o.CICLO_ID = ${ciclo.ID} AND o.CONTA_ID = ${origem.ID}
    ORDER BY cr.CODIGO, o.MES`);

  const destinoAtual = await q(`
    SELECT o.ID, o.CR_ID, o.MES, o.VALOR
    FROM ORCAMENTO o
    WHERE o.CICLO_ID = ${ciclo.ID} AND o.CONTA_ID = ${destino.ID}`);
  const mapDestino = new Map(destinoAtual.map((r) => [`${r.CR_ID}_${r.MES}`, r]));

  console.log(`\n=== b. Mover ${ORIGEM} -> ${DESTINO} (ciclo vigente) ===`);
  const porCr = new Map();
  for (const r of aMover) {
    const k = r.CR || `id${r.CR_ID}`;
    porCr.set(k, (porCr.get(k) || 0) + Number(r.VALOR || 0));
  }
  let sobrescritos = 0;
  for (const r of aMover) {
    const alvo = mapDestino.get(`${r.CR_ID}_${r.MES}`);
    if (alvo) {
      sobrescritos++;
      await dml(`UPDATE ORCAMENTO SET VALOR = ${Number(r.VALOR) || 0} WHERE ID = ${alvo.ID}`);
    } else {
      await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO)
                 VALUES (${ciclo.ID}, ${r.CR_ID}, ${destino.ID}, ${r.MES}, ${Number(r.VALOR) || 0},
                         ${Number(r.QUANTIDADE) || 0}, ${Number(r.VALOR_UNITARIO) || 0})`);
    }
  }
  for (const [cr, total] of porCr) console.log(`  ${cr}: ${brl(total)}`);
  const totalMovido = [...porCr.values()].reduce((s, v) => s + v, 0);
  console.log(`  ---\n  Total movido: ${brl(totalMovido)} em ${aMover.length} linhas`);
  if (sobrescritos > 0) {
    const somaAntiga = destinoAtual.reduce((s, r) => s + Number(r.VALOR || 0), 0);
    console.log(`  ATENCAO: ${sobrescritos} linhas ja existiam em ${DESTINO} (${brl(somaAntiga)} no total)`);
    console.log(`  e foram substituidas pelo valor de ${ORIGEM}. Eram lancamento manual anterior a troca.`);
  }

  console.log(`\n=== c. Apagar as linhas de ${ORIGEM} que foram movidas ===`);
  if (aMover.length > 0) {
    await dml(`DELETE FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CONTA_ID = ${origem.ID}`);
    console.log(`  ${aMover.length} linhas apagadas de ${ORIGEM}`);
  } else {
    console.log('  (nada a apagar)');
  }

  // ── Conferencia: contagem antes/depois, medida no banco ──
  // Nao confio no retorno do driver para contar linhas afetadas: ja me enganou
  // uma vez, reportando 0 numa operacao que mexeu em milhoes. COUNT nao mente.
  if (APLICAR) {
    const [o] = await q(`SELECT COUNT(*) N, ROUND(COALESCE(SUM(VALOR),0),2) T FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CONTA_ID = ${origem.ID}`);
    const [d] = await q(`SELECT COUNT(*) N, ROUND(COALESCE(SUM(VALOR),0),2) T FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CONTA_ID = ${destino.ID}`);
    console.log('\n=== Depois ===');
    console.log(`  ${ORIGEM} ${origem.NOME}: ${o.N} linhas, ${brl(o.T)}`);
    console.log(`  ${DESTINO} ${destino.NOME}: ${d.N} linhas, ${brl(d.T)}`);
    console.log(`  CRs liberados para ${DESTINO}: +${liberados}`);
    if (Number(o.N) !== 0) console.log('  *** ORIGEM NAO ZEROU — conferir ***');
    if (Math.abs(Number(d.T) - totalMovido) > 0.01) console.log('  *** DESTINO NAO BATE COM O MOVIDO — conferir ***');
  } else {
    console.log(`\nSimulacao concluida. Para aplicar: node ${process.argv[1].split('/').pop()} --aplicar`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
