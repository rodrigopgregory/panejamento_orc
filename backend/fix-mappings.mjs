import 'dotenv/config';
import { configureSdkMitra } from 'mitra-sdk';
import { executeServerFunctionMitra } from 'mitra-sdk';
import { createRecordMitra, deleteRecordMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 18;

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

async function fix() {
  console.log('=== Ajuste de Mapeamentos ===\n');

  // Get active cycle
  const ciclos = await query("SELECT * FROM CICLO WHERE VERSAO_ATUAL = 'true'");
  const cicloId = ciclos[0]?.ID;
  if (!cicloId) { console.log('Sem versão ativa!'); return; }
  console.log(`Versão ativa: ${ciclos[0].NOME} (ID: ${cicloId})\n`);

  // Get drivers
  const drivers = await query("SELECT * FROM DRIVERS WHERE ATIVO = 'true'");
  const driverMap = {};
  for (const d of drivers) driverMap[d.NOME] = d;
  console.log('Drivers:', Object.keys(driverMap).join(', '));

  // Get all current mappings for this cycle
  const configs = await query(`
    SELECT dc.*, cc.CODIGO, cc.NOME as CONTA_NOME
    FROM DRIVER_CONFIG dc
    JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
    WHERE dc.CICLO_ID = ${cicloId}
  `);
  console.log(`Mapeamentos atuais: ${configs.length}\n`);

  // Get all contas
  const contas = await query("SELECT * FROM CONTA_CONTABIL ORDER BY CODIGO");
  const contaByCode = {};
  for (const c of contas) contaByCode[c.CODIGO] = c;

  // Get all CRs
  const crs = await query("SELECT * FROM CENTRO_RESULTADO WHERE ATIVO = 'true' ORDER BY CODIGO");
  console.log(`CRs ativos: ${crs.length}\n`);

  let removed = 0;
  let added = 0;

  // ========================================
  // FIX 1: Mover impostos sobre receita (3.2.xx) de BASE_HISTORICO para RECEITA
  // Impostos sobre receita são proporcionais à receita, devem acompanhar o modelo RECEITA
  // ========================================
  console.log('--- FIX 1: Impostos sobre receita → RECEITA ---');
  const impostoContas = ['3.2.01', '3.2.02', '3.2.03']; // ISS, PIS/COFINS, ICMS

  for (const codigo of impostoContas) {
    const conta = contaByCode[codigo];
    if (!conta) continue;

    // Remove from BASE_HISTORICO
    const wrongMappings = configs.filter(c => c.CONTA_ID === conta.ID && c.DRIVER_TIPO === 'BASE_HISTORICO');
    for (const wm of wrongMappings) {
      console.log(`  Removendo ${codigo} ${conta.NOME} do BASE_HISTORICO (CR ${wm.CR_ID})`);
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: wm.ID });
      removed++;
    }

    // Get CRs that have RECEITA mapped (impostos devem existir onde há receita)
    const receitaCRs = configs.filter(c => c.DRIVER_TIPO === 'RECEITA').map(c => c.CR_ID);
    const uniqueReceitaCRs = [...new Set(receitaCRs)];

    for (const crId of uniqueReceitaCRs) {
      // Check if already mapped to RECEITA in this CR
      const exists = configs.some(c => c.CONTA_ID === conta.ID && c.CR_ID === crId && c.DRIVER_TIPO === 'RECEITA');
      if (!exists) {
        console.log(`  Adicionando ${codigo} ${conta.NOME} ao RECEITA (CR ${crId})`);
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: crId,
            CONTA_ID: conta.ID,
            DRIVER_TIPO: 'RECEITA',
            DRIVER_ID: driverMap['RECEITA'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 2: Remover duplicatas — Viagens (5.4.01) está em BASE_HISTORICO e BASE_ZERO para CR 1
  // Viagens fazem mais sentido em BASE_ZERO (orçamento de baixo pra cima)
  // ========================================
  console.log('\n--- FIX 2: Remover duplicatas Viagens ---');
  const viagensConta = contaByCode['5.4.01'];
  if (viagensConta) {
    const viagensBH = configs.filter(c => c.CONTA_ID === viagensConta.ID && c.DRIVER_TIPO === 'BASE_HISTORICO');
    for (const vbh of viagensBH) {
      // Check if also in BASE_ZERO for same CR
      const alsoInBZ = configs.some(c => c.CONTA_ID === viagensConta.ID && c.CR_ID === vbh.CR_ID && c.DRIVER_TIPO === 'BASE_ZERO');
      if (alsoInBZ) {
        console.log(`  Removendo duplicata Viagens do BASE_HISTORICO (CR ${vbh.CR_ID}) — mantendo em BASE_ZERO`);
        await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: vbh.ID });
        removed++;
      } else {
        // Move from BASE_HISTORICO to BASE_ZERO
        console.log(`  Movendo Viagens de BASE_HISTORICO para BASE_ZERO (CR ${vbh.CR_ID})`);
        await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: vbh.ID });
        removed++;
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: vbh.CR_ID,
            CONTA_ID: viagensConta.ID,
            DRIVER_TIPO: 'BASE_ZERO',
            DRIVER_ID: driverMap['BASE_ZERO'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 3: Remover duplicata Aluguel (5.2.01) no BASE_HISTORICO
  // Aluguel faz mais sentido em BASE_ZERO (valor definido por contrato)
  // ========================================
  console.log('\n--- FIX 3: Aluguel → manter só em BASE_ZERO ---');
  const aluguelConta = contaByCode['5.2.01'];
  if (aluguelConta) {
    const aluguelBH = configs.filter(c => c.CONTA_ID === aluguelConta.ID && c.DRIVER_TIPO === 'BASE_HISTORICO');
    for (const abh of aluguelBH) {
      const alsoInBZ = configs.some(c => c.CONTA_ID === aluguelConta.ID && c.CR_ID === abh.CR_ID && c.DRIVER_TIPO === 'BASE_ZERO');
      if (alsoInBZ) {
        console.log(`  Removendo duplicata Aluguel do BASE_HISTORICO (CR ${abh.CR_ID})`);
        await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: abh.ID });
        removed++;
      } else {
        // Move to BASE_ZERO
        console.log(`  Movendo Aluguel de BASE_HISTORICO para BASE_ZERO (CR ${abh.CR_ID})`);
        await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: abh.ID });
        removed++;
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: abh.CR_ID,
            CONTA_ID: aluguelConta.ID,
            DRIVER_TIPO: 'BASE_ZERO',
            DRIVER_ID: driverMap['BASE_ZERO'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 4: Seguros (5.4.03) e Depreciação (5.4.04) — mover de BASE_HISTORICO para BASE_ZERO
  // São despesas previsíveis com valor definido, não projeção histórica
  // ========================================
  console.log('\n--- FIX 4: Seguros e Depreciação → BASE_ZERO ---');
  const moveToBaseZero = ['5.4.03', '5.4.04'];
  for (const codigo of moveToBaseZero) {
    const conta = contaByCode[codigo];
    if (!conta) continue;
    const bhMappings = configs.filter(c => c.CONTA_ID === conta.ID && c.DRIVER_TIPO === 'BASE_HISTORICO');
    for (const bh of bhMappings) {
      console.log(`  Movendo ${codigo} ${conta.NOME} de BASE_HISTORICO para BASE_ZERO (CR ${bh.CR_ID})`);
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: bh.ID });
      removed++;
      const existsBZ = configs.some(c => c.CONTA_ID === conta.ID && c.CR_ID === bh.CR_ID && c.DRIVER_TIPO === 'BASE_ZERO');
      if (!existsBZ) {
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: bh.CR_ID,
            CONTA_ID: conta.ID,
            DRIVER_TIPO: 'BASE_ZERO',
            DRIVER_ID: driverMap['BASE_ZERO'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 5: Subcontas de pessoal sem mapeamento → PESSOAL
  // 5.1.01.01, 5.1.02.01, 5.1.02.02, 5.1.03.01, 5.1.03.02
  // ========================================
  console.log('\n--- FIX 5: Subcontas de pessoal → PESSOAL ---');
  const pessoalSubcontas = ['5.1.01.01', '5.1.02.01', '5.1.02.02', '5.1.03.01', '5.1.03.02'];
  // Get CRs that have parent PESSOAL accounts (5.1.01, 5.1.02, 5.1.03)
  const pessoalCRs = [...new Set(configs.filter(c => c.DRIVER_TIPO === 'PESSOAL').map(c => c.CR_ID))];

  for (const codigo of pessoalSubcontas) {
    const conta = contaByCode[codigo];
    if (!conta) continue;
    for (const crId of pessoalCRs) {
      const exists = configs.some(c => c.CONTA_ID === conta.ID && c.CR_ID === crId);
      if (!exists) {
        console.log(`  Adicionando ${codigo} ${conta.NOME} ao PESSOAL (CR ${crId})`);
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: crId,
            CONTA_ID: conta.ID,
            DRIVER_TIPO: 'PESSOAL',
            DRIVER_ID: driverMap['PESSOAL'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 6: Despesas com Software (4.1.5) → BASE_ZERO
  // ========================================
  console.log('\n--- FIX 6: Despesas com Software → BASE_ZERO ---');
  const swConta = contaByCode['4.1.5'];
  if (swConta) {
    // Map to tech-related CRs (Dir. Tecnologia = CR 2)
    const techCRs = crs.filter((cr) => cr.NOME.toLowerCase().includes('tecnologia'));
    for (const cr of techCRs) {
      const exists = configs.some(c => c.CONTA_ID === swConta.ID && c.CR_ID === cr.ID);
      if (!exists) {
        console.log(`  Adicionando 4.1.5 ${swConta.NOME} ao BASE_ZERO (CR ${cr.CODIGO} ${cr.NOME})`);
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: cr.ID,
            CONTA_ID: swConta.ID,
            DRIVER_TIPO: 'BASE_ZERO',
            DRIVER_ID: driverMap['BASE_ZERO'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  // ========================================
  // FIX 7: ICMS (3.2.03) → RECEITA (onde houver receita de produtos)
  // ========================================
  console.log('\n--- FIX 7: ICMS → RECEITA ---');
  const icmsConta = contaByCode['3.2.03'];
  if (icmsConta) {
    // ICMS aplica onde há receita de produtos
    const produtoReceitaCRs = configs
      .filter(c => c.DRIVER_TIPO === 'RECEITA' && c.CODIGO === '3.1.02')
      .map(c => c.CR_ID);
    for (const crId of produtoReceitaCRs) {
      const exists = configs.some(c => c.CONTA_ID === icmsConta.ID && c.CR_ID === crId);
      if (!exists) {
        console.log(`  Adicionando 3.2.03 ICMS ao RECEITA (CR ${crId})`);
        await createRecordMitra({
          projectId, tableName: 'DRIVER_CONFIG',
          data: {
            CR_ID: crId,
            CONTA_ID: icmsConta.ID,
            DRIVER_TIPO: 'RECEITA',
            DRIVER_ID: driverMap['RECEITA'].ID,
            CICLO_ID: cicloId,
          }
        });
        added++;
      }
    }
  }

  console.log(`\n=== Concluído! Removidos: ${removed} | Adicionados: ${added} ===`);
}

fix().catch(console.error);
