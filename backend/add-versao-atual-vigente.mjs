// Opcao A — a versao marcada como ATUAL passa a valer para o sistema inteiro.
//
// Antes existiam DOIS criterios concorrentes de "qual versao esta valendo":
//   - Dashboard e DRE liam a marca VERSAO_ATUAL (o botao "Tornar atual");
//   - Orcamento, Preenchimento, Folha e Pessoal ignoravam a marca e pegavam
//     "a mais recente que nao esta FECHADO".
// Com isso o botao "Tornar atual" nao tinha efeito nenhum nas telas que mostram
// dado, e quando nenhuma versao ficava aberta (criar versao fecha a anterior;
// excluir a nova nao reabre ninguem) essas telas voltavam lista vazia e
// renderizavam em branco.
//
// Aqui o criterio passa a ser unico e igual ao que a SF 135 ja usava:
//   1) a versao marcada como atual; 2) senao, a mais recente nao fechada.
// E a lista de versoes das telas passa a incluir a versao atual mesmo fechada,
// para que ela possa ser consultada. A trava de edicao fica no frontend
// (versao fechada = somente leitura), no mesmo padrao que a tela de Premissas
// ja aplicava.
import 'dotenv/config';
import {
  configureSdkMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
  runDmlMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Lista de versoes oferecida as telas: as abertas + a atual (mesmo fechada).
const LISTA_DE = `FROM CICLO t WHERE t.STATUS != 'FECHADO'`;
const LISTA_PARA = `FROM CICLO t WHERE (t.STATUS != 'FECHADO' OR t.VERSAO_ATUAL = 'true')`;

// Resolucao do "ciclo default" quando a tela nao manda cicloId (cicloId = 0).
const RESOLVER_DE = `(SELECT ID FROM CICLO WHERE STATUS != 'FECHADO' ORDER BY ANO DESC, ID DESC LIMIT 1)`;
const RESOLVER_PARA = `COALESCE((SELECT ID FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1), (SELECT ID FROM CICLO WHERE STATUS != 'FECHADO' ORDER BY ANO DESC, ID DESC LIMIT 1))`;

// SF 103 e uma query solta (nao usa os blocos JSON) — reescrita direta.
const SF103 = `SELECT * FROM CICLO WHERE STATUS != 'FECHADO' OR VERSAO_ATUAL = 'true' ORDER BY ANO DESC, ID DESC`;

function contar(texto, alvo) {
  return texto.split(alvo).length - 1;
}

async function patchSF(id, nome) {
  const lido = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  const original = lido?.result?.code || '';
  if (!original) throw new Error(`SF ${id} (${nome}) sem codigo`);

  // O resolver e trocado ANTES da lista: os dois padroes sao distintos (o da
  // lista usa o alias `t.`, o do resolver nao), mas a ordem deixa isso explicito
  // em vez de depender do leitor reparar na diferenca.
  const nResolver = contar(original, RESOLVER_DE);
  const nLista = contar(original, LISTA_DE);

  let novo = original.split(RESOLVER_DE).join(RESOLVER_PARA);
  novo = novo.split(LISTA_DE).join(LISTA_PARA);

  if (novo === original) {
    console.log(`  SF ${id} (${nome}): nada a trocar — ja estava no criterio novo`);
    return;
  }
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: novo });
  console.log(`  SF ${id} (${nome}): ${nResolver} resolver(es) + ${nLista} lista(s) atualizados`);
}

async function main() {
  console.log('1) Criterio unico de versao vigente nas SFs');

  const lido103 = await readServerFunctionMitra({ projectId, serverFunctionId: 103 });
  if ((lido103?.result?.code || '').trim() !== SF103) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: 103, code: SF103 });
    console.log('  SF 103 (hotPreenchCiclos): reescrita');
  } else {
    console.log('  SF 103 (hotPreenchCiclos): ja estava no criterio novo');
  }

  await patchSF(124, 'hotOrcBase');
  await patchSF(129, 'hotFolhaBase');
  await patchSF(136, 'hotPessoalBase');
  await patchSF(138, 'hotOrcamentoStatus');

  // 2) Reabertura da versao de demonstracao.
  //
  // A "Forecast 2026 (5+7)" (ciclo 133) foi fechada por uma versao criada logo
  // depois e que acabou excluida — sobrou o sistema sem NENHUMA versao aberta.
  // O pedido e que ela volte a se comportar como se nunca tivesse sido fechada.
  // Volta como INICIADA (e nao PENDENTE) porque ela realmente foi disparada aos
  // gestores: ha submissoes, aprovacoes e reprovacoes registradas na trilha.
  // Marcar PENDENTE reescreveria a historia dela e ainda a deixaria elegivel
  // para exclusao, que so vale para versao nunca iniciada.
  console.log('2) Reabrindo a versao de demonstracao (ciclo 133)');
  await runDmlMitra({
    projectId,
    sql: `UPDATE CICLO SET STATUS = 'INICIADA' WHERE ID = 133 AND STATUS = 'FECHADO'`,
  });
  console.log('  ciclo 133 -> INICIADA');

  console.log('OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
