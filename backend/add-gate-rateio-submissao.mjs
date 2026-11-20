// Gate de submissao do PACOTE: linha com conta contabil, NAO granular por CR e
// sem rateio aplicavel (RATEIO_ID nulo ou rateio sem nenhuma quantidade > 0)
// bloqueia o submeter — sem isso o valor da linha nao desce para nenhum CR e o
// pacote subia "furado". Aplica nas DUAS rotas: SF 171 (app interno) e SF 147
// (link publico, op submeterPacote). Idempotente: so insere se ainda nao existe.
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const GATE_SQL = (driverExpr) =>
  "SELECT COUNT(*) AS N FROM DRIVER_FORMULA df" +
  " WHERE df.DRIVER_ID = \" + " + driverExpr + " + \"" +
  " AND df.CONTA_ID IS NOT NULL" +
  " AND (df.GRANULARIDADE IS NULL OR df.GRANULARIDADE <> 'CR')" +
  " AND (df.RATEIO_ID IS NULL OR NOT EXISTS (SELECT 1 FROM RATEIO_ITEM ri WHERE ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0))";

// ── SF 171 (avaliarWorkflowStatus) ──
{
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: 171 });
  let code = fn.result.code;
  if (code.includes('rateio_pendente')) {
    console.log('SF 171: gate ja presente');
  } else {
    const ANCHOR = "if (ALLOWED[acao].indexOf(de) === -1) return { ok: false, error: 'transicao_invalida', de: de, para: acao };";
    if (!code.includes(ANCHOR)) throw new Error('anchor SF 171 nao encontrado');
    const GATE = ANCHOR + `
// Pacote so pode ser SUBMETIDO com todas as linhas de conta lançaveis: linha
// nao granular por CR precisa de rateio aplicado com quantidades — sem isso o
// valor nao desce para nenhum CR.
if (tipo === 'PACOTE' && acao === 'SUBMETIDO') {
  const pend = (await q("` + GATE_SQL('row.REF_ID') + `"))[0];
  if (pend && Number(pend.N) > 0) return { ok: false, error: 'rateio_pendente', linhas: Number(pend.N) };
}`;
    code = code.replace(ANCHOR, GATE);
    await updateServerFunctionMitra({ projectId, serverFunctionId: 171, code });
    console.log('SF 171: gate de rateio inserido');
  }
}

// ── SF 147 (publicOrcWrite, op submeterPacote) ──
{
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: 147 });
  let code = fn.result.code;
  if (code.includes('rateio_pendente')) {
    console.log('SF 147: gate ja presente');
  } else {
    const ANCHOR = "if (ctx.STATUS !== 'PENDENTE' && ctx.STATUS !== 'CONFIRMADO' && ctx.STATUS !== 'REPROVADO') return { ok: false, error: 'status_nao_permite', status: ctx.STATUS };";
    if (!code.includes(ANCHOR)) throw new Error('anchor SF 147 nao encontrado');
    const GATE = ANCHOR + `
  // Mesmo gate da rota interna (SF 171): linha de conta nao granular sem rateio
  // aplicavel trava a submissao do pacote.
  const pend = (await q("` + GATE_SQL('pacoteId') + `"))[0];
  if (pend && Number(pend.N) > 0) return { ok: false, error: 'rateio_pendente', linhas: Number(pend.N) };`;
    code = code.replace(ANCHOR, GATE);
    await updateServerFunctionMitra({ projectId, serverFunctionId: 147, code });
    console.log('SF 147: gate de rateio inserido');
  }
}
