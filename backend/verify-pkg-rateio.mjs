/**
 * Reproduz, contra os dados reais, a logica de computePkgModel() do
 * OrcamentoContent para o pacote CUSTOS_DE_SOFTWARE (driver 24) — para saber se
 * `rateioOk` da true ou false, e por que.
 */
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const jf = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };
async function sf(id, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output; if (typeof o === 'string') try { o = JSON.parse(o); } catch {}
  return o;
}

const PKG = 24;
for (const cicloId of [133, 132]) {
  console.log(`\n########## CICLO ${cicloId} — pacote ${PKG} (CUSTOS_DE_SOFTWARE) ##########`);

  // SF 124: base (FORMULAS com RATEIO_ID/GRANULARIDADE)
  const base = await sf(124, {});
  const b0 = base?.rows?.[0] || {};
  const formulas = jf(b0.FORMULAS).filter(f => Number(f.DRIVER_ID) === PKG);

  // SF 126: detalhe do pacote (CONFIGS, RATEIOS, RATEIO_ITENS, STATUS)
  const det = await sf(126, { pkgId: PKG, cicloId, ano: 2026, anoPrev: 2025, controlCicloId: 0 });
  const d0 = det?.rows?.[0] || {};
  const configs = jf(d0.CONFIGS), rateios = jf(d0.RATEIOS), itens = jf(d0.RATEIO_ITENS), status = jf(d0.STATUS);

  console.log(`STATUS do pacote : ${status[0]?.STATUS ?? '(sem registro)'}`);
  console.log(`Blocos SF126     : CONFIGS=${configs.length} RATEIOS=${rateios.length} RATEIO_ITENS=${itens.length}`);

  // driverConfigs.filter(dc => dc.DRIVER_TIPO === driverName)
  const cfgPkg = configs.filter(c => c.DRIVER_TIPO === 'CUSTOS_DE_SOFTWARE');
  console.log(`CONFIGS do pacote: ${cfgPkg.length}`);

  for (const l of formulas) {
    if (!l.CONTA_ID) continue;
    const contaId = Number(l.CONTA_ID);
    const pares = cfgPkg.filter(c => Number(c.CONTA_ID) === contaId);
    const nome = l.NOME_CUSTOM || l.LABEL || '';
    if (pares.length === 0) { console.log(`  linha "${nome}" conta ${contaId}: SEM PARES -> pulada (continue)`); continue; }
    const granular = l.GRANULARIDADE === 'CR';
    const rateioId = l.RATEIO_ID != null ? Number(l.RATEIO_ID) : null;
    const validCrs = new Set(pares.map(p => Number(p.CR_ID)));
    const sh = itens.filter(it => Number(it.RATEIO_ID) === rateioId && validCrs.has(Number(it.CR_ID)) && Number(it.QUANTIDADE) > 0);
    const rateioOk = sh.length > 0;
    console.log(`  linha "${nome}" conta=${contaId} granular=${granular} RATEIO_ID=${rateioId}`);
    console.log(`    validCrs=[${[...validCrs]}]  shares=${sh.length}  => rateioOk=${rateioOk}` + (granular ? '  (granular: rateio nao se aplica)' : ''));
    if (!granular && !rateioOk) console.log(`    >>> ESTA LINHA APARECE COMO "sem rateio" E FICA BLOQUEADA (readOnly)`);
  }
}
