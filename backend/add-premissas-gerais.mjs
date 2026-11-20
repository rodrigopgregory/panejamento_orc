// Premissas gerais livres (nao atreladas a conta contabil) + linha de modelo
// do tipo PREMISSA.
//
// As tabelas PREMISSA_LINHA (nome, por versao) e PREMISSA_VALOR (12 meses) ja
// existiam no banco desde migrate-premissa-linha.mjs e ja sao clonadas quando se
// cria uma versao nova — nunca tiveram tela nem leitura. Este script liga as
// duas pontas.
//
// DECISAO DE MODELAGEM — o vinculo e por NOME, nao por ID:
// DRIVER_FORMULA e global (nao tem CICLO_ID), enquanto PREMISSA_LINHA e clonada
// a cada versao com IDs novos. Amarrar a linha do modelo ao ID da premissa
// quebraria silenciosamente na virada de versao — a linha apontaria para a
// premissa da versao anterior. Por isso DRIVER_FORMULA.PREMISSA_NOME guarda o
// nome, e a resolucao acontece contra as premissas da versao que esta aberta.
//
// Uso: node add-premissas-gerais.mjs
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, createServerFunctionMitra,
  readServerFunctionMitra, updateServerFunctionMitra, listServerFunctionsMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function ddl(rotulo, sql) {
  try { await runDdlMitra({ projectId, sql }); console.log(`  ok: ${rotulo}`); }
  catch (e) { console.log(`  ja existe/ignorado: ${rotulo} — ${String(e?.message || e).slice(0, 120)}`); }
}

// Bloco JSON com as premissas da versao — mesmo formato usado pelos demais
// blocos das SFs de detalhe. Uma linha por (premissa, mes).
const BLOCO_PREMISSAS = `,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',pl.ID,'NOME',pl.NOME,'ORDEM',pl.ORDEM,'MES',pv.MES,'VALOR',pv.VALOR)) FROM PREMISSA_LINHA pl LEFT JOIN PREMISSA_VALOR pv ON pv.LINHA_ID = pl.ID WHERE pl.CICLO_ID = {{cicloId}}),JSON_ARRAY()) AS PREMISSAS`;

// As SFs INTERNAS de detalhe sao um SELECT sem FROM, entao um bloco novo pode ser
// concatenado no fim. As PUBLICAS (link do gestor) terminam com o gate do token
// ("FROM PREENCHIMENTO_TOKEN tk ... LIMIT 1") — la o bloco precisa entrar ANTES do
// FROM, senao vira "LIMIT 1, COALESCE(...)" e a SF inteira quebra por sintaxe.
const ANCORA_TOKEN = '\nFROM PREENCHIMENTO_TOKEN tk';

async function acrescentarBloco(nome, bloco, marcador) {
  const todas = await listServerFunctionsMitra({ projectId });
  const alvo = (todas.result || todas || []).find((f) => f.name === nome);
  if (!alvo) { console.log(`  SF ${nome} nao encontrada — pulado`); return; }
  const atual = await readServerFunctionMitra({ projectId, serverFunctionId: alvo.id });
  const code = atual.result?.code || '';
  if (code.includes(marcador)) { console.log(`  SF ${nome} (id ${alvo.id}) ja tem o bloco — pulado`); return; }
  const idx = code.indexOf(ANCORA_TOKEN);
  const novo = idx === -1
    ? code.trimEnd() + bloco
    : code.slice(0, idx).trimEnd() + bloco + code.slice(idx);
  await updateServerFunctionMitra({ projectId, serverFunctionId: alvo.id, code: novo });
  console.log(`  ok: SF ${nome} (id ${alvo.id}) recebeu o bloco${idx === -1 ? '' : ' (antes do gate do token)'}`);
}

async function main() {
  console.log('1. Estrutura');
  // Upsert de valor depende da chave (LINHA_ID, MES).
  await ddl('indice unico PREMISSA_VALOR (LINHA_ID, MES)',
    'ALTER TABLE PREMISSA_VALOR ADD UNIQUE INDEX UK_PREMISSA_VALOR (LINHA_ID, MES)');
  // Nome da premissa que a linha do modelo consome (ver decisao acima).
  await ddl('coluna DRIVER_FORMULA.PREMISSA_NOME',
    'ALTER TABLE DRIVER_FORMULA ADD COLUMN PREMISSA_NOME VARCHAR(200)');

  console.log('\n2. Server Functions da tela de Premissas Gerais');
  const novas = [
    {
      name: 'hotPremissasGeraisPorCiclo',
      description: 'Premissas gerais livres (nome + valores mensais) de uma versao',
      code: `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',t.ID,'NOME',t.NOME,'ORDEM',t.ORDEM)) FROM PREMISSA_LINHA t WHERE t.CICLO_ID = {{cicloId}}),JSON_ARRAY()) AS LINHAS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',v.ID,'LINHA_ID',v.LINHA_ID,'MES',v.MES,'VALOR',v.VALOR)) FROM PREMISSA_VALOR v JOIN PREMISSA_LINHA l ON l.ID = v.LINHA_ID WHERE l.CICLO_ID = {{cicloId}}),JSON_ARRAY()) AS VALORES`,
    },
    {
      name: 'upsertPremissaValor',
      description: 'Grava o valor de uma premissa geral em um mes',
      code: `INSERT INTO PREMISSA_VALOR (LINHA_ID, MES, VALOR) VALUES ({{linhaId}}, {{mes}}, {{valor}})
ON DUPLICATE KEY UPDATE VALOR = {{valor}}`,
    },
    {
      name: 'excluirPremissaGeral',
      description: 'Remove uma premissa geral e todos os seus valores mensais',
      code: `DELETE pl, pv FROM PREMISSA_LINHA pl
LEFT JOIN PREMISSA_VALOR pv ON pv.LINHA_ID = pl.ID
WHERE pl.ID = {{linhaId}}`,
    },
  ];

  const existentes = await listServerFunctionsMitra({ projectId });
  const porNome = new Map((existentes.result || existentes || []).map((f) => [f.name, f.id]));
  for (const sf of novas) {
    if (porNome.has(sf.name)) {
      await updateServerFunctionMitra({ projectId, serverFunctionId: porNome.get(sf.name), code: sf.code, description: sf.description });
      console.log(`  ok: SF ${sf.name} atualizada (id ${porNome.get(sf.name)})`);
    } else {
      const r = await createServerFunctionMitra({ projectId, name: sf.name, type: 'SQL', code: sf.code, description: sf.description });
      console.log(`  ok: SF ${sf.name} criada (id ${r.result?.serverFunctionId})`);
    }
  }

  console.log('\n3. Bloco PREMISSAS nas SFs de detalhe (interna + link publico, CR + pacote)');
  for (const nome of ['hotOrcDetalheCr', 'hotOrcDetalhePkg', 'publicHotOrcDetalheCr', 'publicHotOrcDetalhePkg']) {
    await acrescentarBloco(nome, BLOCO_PREMISSAS, 'AS PREMISSAS');
  }

  console.log('\n4. Editor de modelo: nomes de premissa + PREMISSA_NOME nas linhas');
  const todas = await listServerFunctionsMitra({ projectId });
  const lista = todas.result || todas || [];
  const sf133 = lista.find((f) => f.name === 'hotFormulasModeloBase');
  if (sf133) {
    const atual = await readServerFunctionMitra({ projectId, serverFunctionId: sf133.id });
    let code = atual.result?.code || '';
    // PREMISSA_NOME junto dos demais campos da linha.
    if (!code.includes("'PREMISSA_NOME'")) {
      code = code.replace("'RATEIO_ID',t.RATEIO_ID)", "'RATEIO_ID',t.RATEIO_ID,'PREMISSA_NOME',t.PREMISSA_NOME)");
    }
    // Nomes disponiveis para o seletor. Distinct entre versoes: o modelo nao e
    // por versao, entao a lista tem de valer para qualquer uma.
    if (!code.includes('AS PREMISSAS_NOMES')) {
      code = code.trimEnd() + `,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('NOME',x.NOME)) FROM (SELECT DISTINCT pl.NOME FROM PREMISSA_LINHA pl ORDER BY pl.NOME) x),JSON_ARRAY()) AS PREMISSAS_NOMES`;
    }
    await updateServerFunctionMitra({ projectId, serverFunctionId: sf133.id, code });
    console.log(`  ok: SF hotFormulasModeloBase (id ${sf133.id})`);
  }

  console.log('\n5. Snapshot de publicacao e status: sem PREMISSA_NOME a versao publicada perde o vinculo');
  for (const nome of ['publicarModeloVersao', 'statusPublicacaoModelos']) {
    const sf = lista.find((f) => f.name === nome);
    if (!sf) { console.log(`  SF ${nome} nao encontrada — pulado`); continue; }
    const atual = await readServerFunctionMitra({ projectId, serverFunctionId: sf.id });
    let code = atual.result?.code || '';
    if (code.includes("'PREMISSA_NOME'")) { console.log(`  SF ${nome} ja tem — pulado`); continue; }
    const antes = code;
    // Ancora no ultimo campo do JSON_OBJECT de cada uma: a 194 termina em
    // RATEIO_ID, a 225 em ORDEM.
    code = code.replace("'RATEIO_ID',f.RATEIO_ID))", "'RATEIO_ID',f.RATEIO_ID,'PREMISSA_NOME',f.PREMISSA_NOME))")
               .replace("'ORDEM',f.ORDEM))", "'ORDEM',f.ORDEM,'PREMISSA_NOME',f.PREMISSA_NOME))");
    if (code === antes) { console.log(`  ATENCAO: nao achei onde encaixar em ${nome} — revisar a mao`); continue; }
    await updateServerFunctionMitra({ projectId, serverFunctionId: sf.id, code });
    console.log(`  ok: SF ${nome} (id ${sf.id})`);
  }

  console.log('\nIDs para o frontend:');
  const final = await listServerFunctionsMitra({ projectId });
  for (const f of (final.result || final || [])) {
    if (['hotPremissasGeraisPorCiclo', 'upsertPremissaValor', 'excluirPremissaGeral'].includes(f.name)) {
      console.log(`  ${f.name} = ${f.id}`);
    }
  }
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
