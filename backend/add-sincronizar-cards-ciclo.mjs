// SF de sincronizacao dos cards do workflow com o mapeamento de gestores.
//
// Por que existe: os cards do kanban (ORCAMENTO_STATUS = gestor x CR,
// PACOTE_STATUS = gestor x pacote) nasciam num unico momento — a criacao da
// versao (SF 191 criarVersaoOrcamento). Gestor criado/vinculado com o ciclo em
// andamento ficava sem card: nao aparecia no /workflow e o aprovador nao o via.
// Os pacotes tinham um remendo em loop no frontend (GestoresPage e ModelagemPage,
// duplicado); os CRs nao tinham nada.
//
// O que faz: reconcilia TODOS os ciclos nao fechados com o mapeamento atual, em
// conjunto (4 statements, sem loop pelo cliente). Idempotente — rodar duas vezes
// nao muda nada na segunda.
//   1. Remove o card ainda pendente (PENDENTE/CONFIRMADO) cujo vinculo deixou de
//      existir — inclui gestor desativado, pacote desativado e transferencia
//      (o vinculo antigo some).
//   2. Cria o card PENDENTE para todo vinculo ativo que ainda nao tem card no
//      ciclo. A chave e (ciclo, CR) / (ciclo, pacote): um card por objeto e ciclo.
//      Transferencia = passo 1 apaga o pendente do dono antigo + passo 2 cria o
//      do dono novo.
//   Cards SUBMETIDO/APROVADO/REPROVADO NAO sao tocados: ficam com quem submeteu,
//   como historico, mesmo que o vinculo mude (decisao de negocio pendente).
//
// Params: agora (YYYY-MM-DDTHH:mm:ss). Retorna CARDS_CR e CARDS_PACOTE nos
// ciclos abertos apos a reconciliacao.
//
// Este script tambem EXECUTA a SF uma vez ao final — fecha as lacunas que ja
// existam no projeto (vinculos feitos antes desta correcao).
import 'dotenv/config';
import {
  configureSdkMitra, createServerFunctionMitra, updateServerFunctionMitra,
  listServerFunctionsMitra, executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_NAME = 'sincronizarCardsCiclo';

const ABERTO = "c.STATUS <> 'FECHADO'";
const PENDENTES = "('PENDENTE', 'CONFIRMADO')";

// Vinculo ativo de CR: gestor ativo. Mesma regra da SF 191.
const VINCULO_CR = `SELECT 1 FROM GESTOR_CR gc
      JOIN GESTOR g ON g.ID = gc.GESTOR_ID AND g.ATIVO = 'true'`;
// Vinculo ativo de pacote: gestor ativo + driver ativo de escopo PACOTE.
const VINCULO_PKG = `SELECT 1 FROM GESTOR_PACOTE gp
      JOIN GESTOR g ON g.ID = gp.GESTOR_ID AND g.ATIVO = 'true'
      JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.ESCOPO = 'PACOTE'`;

const code = [
  // 1a. CR: apaga o pendente sem vinculo correspondente
  `DELETE os FROM ORCAMENTO_STATUS os
    JOIN CICLO c ON c.ID = os.CICLO_ID AND ${ABERTO}
    WHERE os.STATUS IN ${PENDENTES}
      AND NOT EXISTS (${VINCULO_CR}
        WHERE gc.CR_ID = os.CR_ID AND gc.GESTOR_ID = os.GESTOR_ID);`,
  // 1b. Pacote: idem
  `DELETE ps FROM PACOTE_STATUS ps
    JOIN CICLO c ON c.ID = ps.CICLO_ID AND ${ABERTO}
    WHERE ps.STATUS IN ${PENDENTES}
      AND NOT EXISTS (${VINCULO_PKG}
        WHERE gp.DRIVER_ID = ps.DRIVER_ID AND gp.GESTOR_ID = ps.GESTOR_ID);`,
  // 2a. CR: cria o card que falta (um por ciclo x CR)
  `INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, DRIVERS_CONFIRMADOS, ATUALIZADO_EM)
    SELECT c.ID, gc.GESTOR_ID, gc.CR_ID, 'PENDENTE', '', '{{agora}}'
    FROM CICLO c
    CROSS JOIN GESTOR_CR gc
    JOIN GESTOR g ON g.ID = gc.GESTOR_ID AND g.ATIVO = 'true'
    WHERE ${ABERTO}
      AND NOT EXISTS (SELECT 1 FROM ORCAMENTO_STATUS os
        WHERE os.CICLO_ID = c.ID AND os.CR_ID = gc.CR_ID);`,
  // 2b. Pacote: idem (um por ciclo x pacote)
  `INSERT INTO PACOTE_STATUS (CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS, ATUALIZADO_EM)
    SELECT c.ID, gp.DRIVER_ID, gp.GESTOR_ID, 'PENDENTE', '{{agora}}'
    FROM CICLO c
    CROSS JOIN GESTOR_PACOTE gp
    JOIN GESTOR g ON g.ID = gp.GESTOR_ID AND g.ATIVO = 'true'
    JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.ESCOPO = 'PACOTE'
    WHERE ${ABERTO}
      AND NOT EXISTS (SELECT 1 FROM PACOTE_STATUS ps
        WHERE ps.CICLO_ID = c.ID AND ps.DRIVER_ID = gp.DRIVER_ID);`,
  // Retorno: contagem nos ciclos abertos (a tela nao depende disso; serve ao log)
  `SELECT
      (SELECT COUNT(*) FROM ORCAMENTO_STATUS os JOIN CICLO c ON c.ID = os.CICLO_ID WHERE ${ABERTO}) AS CARDS_CR,
      (SELECT COUNT(*) FROM PACOTE_STATUS ps JOIN CICLO c ON c.ID = ps.CICLO_ID WHERE ${ABERTO}) AS CARDS_PACOTE;`,
].join('\n');

const description = 'Sincroniza os cards do workflow (ORCAMENTO_STATUS e PACOTE_STATUS) de TODOS os ciclos '
  + 'nao fechados com o mapeamento atual de gestores (GESTOR_CR / GESTOR_PACOTE). Idempotente. '
  + 'Remove cards PENDENTE/CONFIRMADO sem vinculo e cria os que faltam (um por ciclo x CR e ciclo x pacote). '
  + 'Cards SUBMETIDO/APROVADO/REPROVADO nao sao tocados. Chamar apos criar/vincular/transferir/desvincular gestor. '
  + 'Param: agora (YYYY-MM-DDTHH:mm:ss). Retorna CARDS_CR e CARDS_PACOTE.';

const listRes = await listServerFunctionsMitra({ projectId });
const list = listRes?.result || listRes || [];
const existing = (Array.isArray(list) ? list : []).find((f) => f.name === SF_NAME);

let sfId;
if (existing) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
  sfId = existing.id;
  console.log('SF atualizada, id =', sfId);
} else {
  const r = await createServerFunctionMitra({ projectId, name: SF_NAME, type: 'SQL', code, description });
  sfId = r?.result?.serverFunctionId ?? r?.result?.id;
  console.log('SF criada, id =', sfId ?? JSON.stringify(r?.result ?? r));
}

// Fecha as lacunas ja existentes nos ciclos abertos deste projeto.
if (sfId) {
  const agora = new Date().toISOString().slice(0, 19);
  const run = await executeServerFunctionMitra({ projectId, serverFunctionId: sfId, input: { agora } });
  const res = run?.result || {};
  let out = res.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  console.log('Execucao inicial:', res.executionStatus, JSON.stringify(out?.rows ?? out ?? res.error));
}
