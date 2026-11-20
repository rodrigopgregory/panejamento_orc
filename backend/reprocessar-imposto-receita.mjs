// Reprocessa as contas CALCULADAS do modelo de Receita, CR a CR.
//
// POR QUE ESTE SCRIPT EXISTE
// A conta calculada so vira numero no DRE quando o gestor CONFIRMA o modelo
// (ver a nota MATERIALIZACAO em OrcamentoContent). Isso e proposital, mas tem um
// buraco: mudanca que nao passa por tecla digitada nao dispara nada. Foi o caso
// da aliquota de imposto — ela virou linha de PREMISSA depois que os CRs ja
// estavam confirmados, entao a tela passou a calcular certo enquanto ORCAMENTO
// (que e o que o DRE le) seguiu com o numero do mecanismo antigo.
//
// Este script faz exatamente o que o "Confirmar" faria, sem exigir que cada
// gestor reabra o CR. Ele NAO inventa regra: importa o avaliador de formula da
// tela e repete a mesma ordem, os mesmos resolvedores e a mesma decisao de
// gravacao. Se a regra mudar, ela muda num lugar so.
//
// LIMITES (iguais aos do confirmar)
//   - mes fechado nao e tocado: ele vem do realizado, nao do orcado;
//   - conta que nao esta mapeada no CR nao e gravada;
//   - valor identico ao que ja esta no banco nao gera escrita.
//
//   node reprocessar-imposto-receita.mjs            -> simulacao (nao grava)
//   node reprocessar-imposto-receita.mjs --aplicar  -> grava
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';
import { avaliarFormula, formulaValida } from '../frontend/src/lib/formula-core.js';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const dml = async (sql) => runDmlMitra({ projectId, sql });

const APLICAR = process.argv.includes('--aplicar');
const MODELO = 'RECEITA';

// mesmas regras de lib/materializacao.ts
const mesesMaterializaveis = (ultimoMesRealizado) => {
  const fechadoAte = Number.isFinite(ultimoMesRealizado) && ultimoMesRealizado > 0 ? Math.min(12, Math.floor(ultimoMesRealizado)) : 0;
  const meses = [];
  for (let m = fechadoAte + 1; m <= 12; m++) meses.push(m);
  return meses;
};
const decidirGravacao = (calculado, valorAtual) => {
  if (!Number.isFinite(calculado)) return { gravar: false, motivo: 'nao_finito' };
  const valor = Math.round(calculado);
  if (valor === Math.round(valorAtual)) return { gravar: false, motivo: 'sem_mudanca' };
  return { gravar: true, valor };
};

const [ciclo] = await q(`SELECT ID, NOME, ULTIMO_MES_REALIZADO FROM CICLO WHERE STATUS <> 'FECHADO' ORDER BY ID DESC LIMIT 1`);
if (!ciclo) { console.log('Nenhum ciclo aberto — nada a fazer.'); process.exit(0); }
const cicloId = Number(ciclo.ID);
const MESES = mesesMaterializaveis(Number(ciclo.ULTIMO_MES_REALIZADO));
console.log(`Ciclo ${cicloId} "${ciclo.NOME}" | meses a materializar: ${MESES.join(', ')} (1..${ciclo.ULTIMO_MES_REALIZADO} sao fechados e nao serao tocados)`);
console.log(APLICAR ? 'MODO: GRAVANDO\n' : 'MODO: simulacao — nada sera gravado (use --aplicar)\n');

const [driver] = await q(`SELECT ID FROM DRIVERS WHERE NOME = '${MODELO}' AND ATIVO = 'true'`);
const linhas = await q(`SELECT ID, ORDEM, CODIGO, TIPO, FORMULA, CONTA_ID, NOME_CUSTOM, PREMISSA_NOME
  FROM DRIVER_FORMULA WHERE DRIVER_ID = ${driver.ID} ORDER BY ORDEM`);

// Premissas gerais do ciclo: NOME -> mes -> valor
const premRows = await q(`SELECT pl.NOME, pv.MES, pv.VALOR FROM PREMISSA_LINHA pl
  JOIN PREMISSA_VALOR pv ON pv.LINHA_ID = pl.ID WHERE pl.CICLO_ID = ${cicloId}`);
const valorPremissa = (nome, mes) => Number(premRows.find(r => r.NOME === nome && Number(r.MES) === mes)?.VALOR || 0);

// CRs que tem alguma conta deste modelo mapeada
const crs = await q(`SELECT DISTINCT cr.ID, cr.CODIGO, cr.NOME FROM CR_CONTA crc
  JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE crc.ATIVO = true AND d.ID = ${driver.ID} ORDER BY cr.CODIGO`);

let escritas = 0, pulos = 0;
const resumo = [];

for (const cr of crs) {
  const crId = Number(cr.ID);

  // CONFIGS do CR — mesma resolucao de driver da SF 125 (excecao por CR vence).
  const configs = await q(`SELECT cc.ID AS CONTA_ID, cc.CODIGO, d.NOME AS DRIVER_TIPO, d.ID AS DRIVER_ID
    FROM CR_CONTA crc
    JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE crc.CR_ID = ${crId} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'`);
  const contasDoModelo = new Set(configs.filter(c => c.DRIVER_TIPO === MODELO).map(c => Number(c.CONTA_ID)));
  if (contasDoModelo.size === 0) continue;

  // budget: espelho de ORCAMENTO do CR (contas 3.x nao tem rateio de pacote, ja conferido)
  const orcRows = await q(`SELECT ID, CONTA_ID, MES, VALOR FROM ORCAMENTO WHERE CICLO_ID = ${cicloId} AND CR_ID = ${crId}`);
  const budget = new Map();
  const rowId = new Map();
  for (const r of orcRows) {
    budget.set(`${r.CONTA_ID}_${r.MES}`, Math.round(Number(r.VALOR) || 0));
    rowId.set(`${r.CONTA_ID}_${r.MES}`, Number(r.ID));
  }

  // valores das linhas de INPUT do modelo neste CR
  const clv = await q(`SELECT FORMULA_ID, MES, VALOR FROM DRIVER_FORMULA_VALOR
    WHERE CICLO_ID = ${cicloId} AND CR_ID = ${crId} AND COALESCE(PACOTE_ID, 0) = 0`);
  const valorLinha = (formulaId, mes) => Number(clv.find(v => Number(v.FORMULA_ID) === Number(formulaId) && Number(v.MES) === mes)?.VALOR || 0);

  // customBudget — folhas primeiro (INPUT e PREMISSA), como buildCustomBudgetMap
  const custom = new Map();
  const setKeys = (l, mes, val) => {
    if (l.NOME_CUSTOM) custom.set(`${l.NOME_CUSTOM}_${mes}`, val);
    if (l.CODIGO) custom.set(`${l.CODIGO}_${mes}`, val);
  };
  for (const l of linhas.filter(l => !l.CONTA_ID)) {
    for (let mes = 1; mes <= 12; mes++) {
      if (l.TIPO === 'INPUT') setKeys(l, mes, valorLinha(l.ID, mes));
      else if (l.TIPO === 'PREMISSA') setKeys(l, mes, valorPremissa(l.PREMISSA_NOME, mes));
    }
  }

  const avaliar = (formula, mes) => {
    const resolverConta = (codigo) => {
      const ref = configs.find(c => c.CODIGO === codigo);
      if (!ref) return 0;
      return budget.get(`${ref.CONTA_ID}_${mes}`) ?? 0;
    };
    const resolverLinha = (nome) => {
      const v = custom.get(`${nome}_${mes}`);
      if (v !== undefined) return v;
      // [Lx] de linha vinculada a conta: sinonimo do {codigo} da conta
      const l = linhas.find(l => String(l.CODIGO || '') === nome && l.CONTA_ID &&
        configs.some(c => Number(c.CONTA_ID) === Number(l.CONTA_ID)));
      if (!l) return undefined;
      return budget.get(`${l.CONTA_ID}_${mes}`) ?? 0;
    };
    return avaliarFormula(formula, resolverConta, resolverLinha);
  };

  // linhas custom com FORMULA (nenhuma hoje, mas o confirmar as resolve antes)
  for (const l of linhas.filter(l => !l.CONTA_ID && l.TIPO === 'FORMULA')) {
    for (let mes = 1; mes <= 12; mes++) setKeys(l, mes, avaliar(l.FORMULA || '', mes));
  }

  // contas calculadas, na ORDEM do modelo — uma pode ser base da outra
  for (const l of linhas.filter(l => l.CONTA_ID && l.TIPO === 'FORMULA' && formulaValida(l.FORMULA))) {
    const contaId = Number(l.CONTA_ID);
    if (!contasDoModelo.has(contaId)) continue;
    const codigo = configs.find(c => Number(c.CONTA_ID) === contaId)?.CODIGO || String(contaId);

    for (const mes of MESES) {
      const bruto = avaliar(l.FORMULA, mes);
      const atual = budget.get(`${contaId}_${mes}`) ?? 0;
      const d = decidirGravacao(bruto, atual);
      if (!d.gravar) { pulos++; continue; }

      // o mapa acompanha o que acabou de ser calculado: a conta seguinte pode usa-la como base
      budget.set(`${contaId}_${mes}`, d.valor);
      resumo.push({ CR: cr.CODIGO, CONTA: codigo, MES: mes, DE: atual, PARA: d.valor });

      if (APLICAR) {
        const id = rowId.get(`${contaId}_${mes}`);
        if (id) await dml(`UPDATE ORCAMENTO SET VALOR = ${d.valor} WHERE ID = ${id}`);
        else await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO)
                        VALUES (${cicloId}, ${crId}, ${contaId}, ${mes}, ${d.valor}, 0, 0)`);
      }
      escritas++;
    }
  }
}

console.table(resumo);
console.log(`\n${escritas} celula(s) ${APLICAR ? 'gravadas' : 'seriam gravadas'} | ${pulos} sem mudanca`);
if (!APLICAR) console.log('Simulacao. Rode com --aplicar para gravar.');
