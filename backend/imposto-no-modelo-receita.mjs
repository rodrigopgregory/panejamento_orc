// IMPOSTO SOBRE RECEITA: DE MODULO ESCONDIDO PARA LINHA DO MODELO
//
// Ate aqui o imposto era calculado por um mecanismo que nao aparecia em lugar
// nenhum da tela: ao confirmar a Receita, o sistema lia a aliquota em
// PREMISSA_IMPOSTO, multiplicava pela soma das contas de receita do CR e
// gravava. Quem olhasse o modelo nao via regra nenhuma — a conta de imposto
// figurava como um input comum.
//
// Isso tinha duas consequencias praticas:
//   · nao dava para auditar (o numero gravado nao reproduzia 5% de base
//     nenhuma, porque era resto de uma execucao antiga sobre outra base);
//   · nao dava para mudar sem mexer no codigo.
//
// Agora a regra mora no modelo, escrita:
//
//     3.2.01 ISS = ({3.1.01} + {3.1.02} + {3.1.04}) * [P1] / 100
//
// onde [P1] e uma linha do tipo Premissa apontando para a aliquota cadastrada
// em Premissas Gerais. A gravacao no ORCAMENTO passa a acontecer pelo mesmo
// caminho de qualquer outra conta calculada: a materializacao do confirmar.
//
// MUDANCA DE COMPORTAMENTO ASSUMIDA: a base do imposto deixa de ser "todas as
// contas de receita mapeadas no CR" e passa a ser a lista escrita na formula.
// Mapear uma conta de receita nova nao entra no imposto sozinho — alguem tem de
// incluir na formula. E o preco de a regra ser visivel, e foi uma escolha.
//
// Uso:
//   node imposto-no-modelo-receita.mjs            (simulacao)
//   node imposto-no-modelo-receita.mjs --aplicar  (grava)
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
const esc = (s) => String(s).replace(/'/g, "''");
const agora = () => new Date().toISOString().slice(0, 19);

async function main() {
  console.log(APLICAR ? '*** MODO APLICAR — vai gravar ***\n' : '--- SIMULACAO (nada sera gravado) ---\n');

  const [ciclo] = await q("SELECT ID, NOME FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) { console.log('Nenhum ciclo vigente.'); return; }
  const [driver] = await q("SELECT ID FROM DRIVERS WHERE NOME = 'RECEITA'");
  if (!driver) { console.log('Modelo RECEITA nao encontrado.'); return; }
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME}\n`);

  // Linhas do modelo, com o tipo da conta contabil junto: e ele que separa
  // receita de imposto (a coluna TIPO de DRIVER_CONFIG nao existe no banco —
  // o "TIPO=IMPOSTO" que o frontend usa vem de CONTA_CONTABIL).
  const linhas = await q(`
    SELECT f.ID, f.ORDEM, f.TIPO, f.CODIGO, f.CONTA_ID, c.CODIGO AS CC, c.NOME AS CONTA, c.TIPO AS TIPO_CONTA
    FROM DRIVER_FORMULA f
    LEFT JOIN CONTA_CONTABIL c ON c.ID = f.CONTA_ID
    WHERE f.DRIVER_ID = ${driver.ID}
    ORDER BY f.ORDEM`);

  const contasReceita = linhas.filter((l) => l.CONTA_ID && l.TIPO_CONTA !== 'IMPOSTO');
  const base = contasReceita.map((l) => `{${l.CC}}`).join(' + ');
  if (!base) { console.log('Nenhuma conta de receita no modelo — nada a fazer.'); return; }
  console.log(`Base do imposto (explicita a partir das contas de receita do modelo):\n  ${base}\n`);

  const aliquotas = await q(`
    SELECT p.CONTA_ID, c.CODIGO, c.NOME, p.PERCENTUAL
    FROM PREMISSA_IMPOSTO p JOIN CONTA_CONTABIL c ON c.ID = p.CONTA_ID
    WHERE p.CICLO_ID = ${ciclo.ID} ORDER BY c.CODIGO`);
  if (aliquotas.length === 0) { console.log('Nenhuma aliquota cadastrada — nada a migrar.'); return; }

  const codigosEmUso = new Set(linhas.map((l) => l.CODIGO).filter(Boolean));
  const proximoCodigo = () => {
    for (let i = 1; i < 100; i++) { const c = `P${i}`; if (!codigosEmUso.has(c)) { codigosEmUso.add(c); return c; } }
    throw new Error('sem codigo livre para linha de premissa');
  };

  // Impostos vao para o fim do modelo; as premissas entram logo antes deles,
  // para o modelo ler de cima para baixo: entradas, receitas, premissas, impostos.
  const impostos = linhas.filter((l) => l.TIPO_CONTA === 'IMPOSTO');
  const ordemBase = Math.max(...linhas.map((l) => Number(l.ORDEM) || 0)) - impostos.length;

  let ordem = ordemBase;
  const criadas = [];

  for (const a of aliquotas) {
    const nomePremissa = `Alíquota ${a.NOME}`;
    const linhaImposto = impostos.find((l) => Number(l.CONTA_ID) === Number(a.CONTA_ID));
    if (!linhaImposto) {
      console.log(`  ${a.CODIGO}: sem linha no modelo RECEITA — pulando`);
      continue;
    }

    // ── 1. Aliquota vira premissa livre (12 meses com o mesmo valor) ──
    const [existente] = await q(`
      SELECT ID FROM PREMISSA_LINHA WHERE CICLO_ID = ${ciclo.ID} AND NOME = '${esc(nomePremissa)}'`);
    if (existente) {
      console.log(`  premissa "${nomePremissa}" ja existe (id ${existente.ID})`);
    } else {
      ordem++;
      console.log(`  criar premissa "${nomePremissa}" = ${a.PERCENTUAL} (12 meses)`);
      await dml(`INSERT INTO PREMISSA_LINHA (CICLO_ID, NOME, ORDEM, CRIADO_EM)
                 VALUES (${ciclo.ID}, '${esc(nomePremissa)}', ${ordem}, '${agora()}')`);
      const valores = [];
      for (let m = 1; m <= 12; m++) valores.push(`((SELECT ID FROM (SELECT ID FROM PREMISSA_LINHA WHERE CICLO_ID = ${ciclo.ID} AND NOME = '${esc(nomePremissa)}' LIMIT 1) t), ${m}, ${Number(a.PERCENTUAL) || 0})`);
      await dml(`INSERT INTO PREMISSA_VALOR (LINHA_ID, MES, VALOR) VALUES ${valores.join(', ')}`);
    }

    // ── 2. Linha do modelo do tipo Premissa, referenciavel por [Pn] ──
    const [linhaPrem] = await q(`
      SELECT ID, CODIGO FROM DRIVER_FORMULA
      WHERE DRIVER_ID = ${driver.ID} AND TIPO = 'PREMISSA' AND PREMISSA_NOME = '${esc(nomePremissa)}'`);
    let codigo;
    if (linhaPrem) {
      codigo = linhaPrem.CODIGO;
      console.log(`  linha de premissa ja existe: [${codigo}]`);
    } else {
      codigo = proximoCodigo();
      ordem++;
      console.log(`  criar linha de premissa [${codigo}] -> "${nomePremissa}"`);
      // FORMULA e NOT NULL na tabela; linha de premissa nao usa o campo, entao
      // entra vazia. Quem decide o comportamento da linha e o TIPO.
      await dml(`INSERT INTO DRIVER_FORMULA (DRIVER_ID, CONTA_ID, FORMULA, TIPO, ORDEM, NOME_CUSTOM, CODIGO, PREMISSA_NOME)
                 VALUES (${driver.ID}, NULL, '', 'PREMISSA', ${ordem}, '${esc(nomePremissa)}', '${codigo}', '${esc(nomePremissa)}')`);
    }

    // ── 3. A conta de imposto passa a ser calculada, com a regra a vista ──
    const formula = `(${base}) * [${codigo}] / 100`;
    ordem++;
    console.log(`  ${a.CODIGO} ${a.NOME}: INPUT -> FORMULA  ${formula}`);
    await dml(`UPDATE DRIVER_FORMULA SET TIPO = 'FORMULA', FORMULA = '${esc(formula)}', ORDEM = ${ordem}
               WHERE ID = ${linhaImposto.ID}`);
    criadas.push({ conta: a.CODIGO, formula });
  }

  // Imposto sem aliquota cadastrada continua input: nao ha regra para escrever,
  // e inventar uma seria pior do que deixar o gestor lancar a mao.
  for (const l of impostos) {
    if (aliquotas.some((a) => Number(a.CONTA_ID) === Number(l.CONTA_ID))) continue;
    ordem++;
    console.log(`  ${l.CC} ${l.CONTA}: sem aliquota cadastrada — segue como lancamento manual`);
    await dml(`UPDATE DRIVER_FORMULA SET ORDEM = ${ordem} WHERE ID = ${l.ID}`);
  }

  if (APLICAR) {
    console.log('\n=== Depois ===');
    for (const r of await q(`
      SELECT f.ORDEM, f.TIPO, f.CODIGO, f.NOME_CUSTOM, c.CODIGO AS CC, f.FORMULA, f.PREMISSA_NOME
      FROM DRIVER_FORMULA f LEFT JOIN CONTA_CONTABIL c ON c.ID = f.CONTA_ID
      WHERE f.DRIVER_ID = ${driver.ID} ORDER BY f.ORDEM`)) {
      const alvo = r.CC ? r.CC : `[${r.CODIGO}] ${r.NOME_CUSTOM || ''}`;
      console.log(`  ${String(r.ORDEM).padStart(2)} ${String(r.TIPO).padEnd(8)} ${String(alvo).padEnd(34)} ${r.FORMULA || r.PREMISSA_NOME || ''}`);
    }
    const prem = await q(`
      SELECT l.NOME, COUNT(v.ID) MESES, MIN(v.VALOR) V
      FROM PREMISSA_LINHA l LEFT JOIN PREMISSA_VALOR v ON v.LINHA_ID = l.ID
      WHERE l.CICLO_ID = ${ciclo.ID} GROUP BY l.ID, l.NOME ORDER BY l.ORDEM`);
    console.log('\n  Premissas do ciclo:');
    for (const p of prem) console.log(`    ${p.NOME}: ${p.MESES} meses, valor ${p.V}`);
  } else {
    console.log(`\nSimulacao concluida. Para aplicar: node ${process.argv[1].split('/').pop()} --aplicar`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
