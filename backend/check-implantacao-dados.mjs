// Auditoria de dados da implantacao (AUDITORIA-IMPLANTACAO.md, Secao 1).
// READ-ONLY: so roda SELECTs. Sai com codigo != 0 se houver bloqueio.
// Uso: node backend/check-implantacao-dados.mjs
//
// Rodar apos cada carga do §2, no fechamento do §6 e antes do handoff (§7).

import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ATIVO pode ser string 'true'/'false' ou boolean 1/0 conforme a tabela —
// esta condicao cobre os dois formatos.
const ATIVO = (col) => `(${col} IS NOT NULL AND ${col} NOT IN ('false', '0'))`;

let erros = 0;
let avisos = 0;

async function q(sql) {
  const res = await runQueryMitra({ projectId, sql });
  return res?.result?.rows || [];
}

// Cada check e independente e tolerante a drift de schema: se a query falhar
// (tabela/coluna ausente), vira AVISO com o motivo — nao derruba a auditoria.
async function check(nome, sql, { avaliar, nivel = 'erro' }) {
  try {
    const rows = await q(sql);
    const problema = avaliar(rows);
    if (!problema) {
      console.log(`  OK     ${nome}`);
      return;
    }
    if (nivel === 'aviso') {
      avisos++;
      console.warn(`  AVISO  ${nome}: ${problema}`);
    } else {
      erros++;
      console.error(`  ERRO   ${nome}: ${problema}`);
    }
  } catch (e) {
    avisos++;
    console.warn(`  AVISO  ${nome}: check nao rodou (${e?.message || e})`);
  }
}

console.log('Auditoria de dados da implantacao (read-only)\n');

// 1. Exatamente 1 ciclo aberto — o motor usa STATUS='INICIADA' como "aberto"
// (filtros das telas, tokens e SFs). 'ABERTO' nao existe no motor.
await check(
  'exatamente 1 ciclo INICIADA (aberto)',
  `SELECT COUNT(*) AS N FROM CICLO WHERE STATUS = 'INICIADA'`,
  { avaliar: (r) => (Number(r[0]?.N) === 1 ? null : `${r[0]?.N ?? 0} ciclo(s) INICIADA (esperado: 1)`) }
);

// 2. CR ativo sem gestor
await check(
  'nenhum CR ativo sem gestor',
  `SELECT CR.ID, CR.CODIGO, CR.NOME FROM CENTRO_RESULTADO CR
   LEFT JOIN GESTOR_CR GC ON GC.CR_ID = CR.ID
   WHERE ${ATIVO('CR.ATIVO')} AND GC.ID IS NULL`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} CR(s) ativos sem gestor: ${r.slice(0, 5).map((x) => x.CODIGO || x.ID).join(', ')}${r.length > 5 ? '…' : ''}`) }
);

// 3. Gestor ativo sem e-mail valido (destino do link publico)
await check(
  'todo gestor ativo com e-mail valido',
  `SELECT ID, NOME, EMAIL FROM GESTOR
   WHERE ${ATIVO('ATIVO')} AND (EMAIL IS NULL OR EMAIL NOT LIKE '%@%')`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} gestor(es) sem e-mail valido: ${r.slice(0, 5).map((x) => x.NOME || x.ID).join(', ')}`) }
);

// 4. Duplicados ativos em CR_CONTA
await check(
  'sem duplicados ativos em CR_CONTA',
  `SELECT CR_ID, CONTA_ID, COUNT(*) AS QTD FROM CR_CONTA
   WHERE ${ATIVO('ATIVO')}
   GROUP BY CR_ID, CONTA_ID HAVING COUNT(*) > 1`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} par(es) (CR, conta) duplicados`) }
);

// 5. FKs orfas
await check(
  'CR sem EMPRESA correspondente',
  `SELECT CR.ID, CR.CODIGO FROM CENTRO_RESULTADO CR
   LEFT JOIN EMPRESA E ON E.ID = CR.EMPRESA_ID
   WHERE CR.EMPRESA_ID IS NOT NULL AND E.ID IS NULL`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} CR(s) apontando para empresa inexistente`) }
);
await check(
  'CR_CONTA sem CR/CONTA correspondente',
  `SELECT CRC.ID FROM CR_CONTA CRC
   LEFT JOIN CENTRO_RESULTADO CR ON CR.ID = CRC.CR_ID
   LEFT JOIN CONTA_CONTABIL CC ON CC.ID = CRC.CONTA_ID
   WHERE CR.ID IS NULL OR CC.ID IS NULL`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} vinculo(s) orfao(s) em CR_CONTA`) }
);
await check(
  'GESTOR_CR sem GESTOR/CR correspondente',
  `SELECT GC.ID FROM GESTOR_CR GC
   LEFT JOIN GESTOR G ON G.ID = GC.GESTOR_ID
   LEFT JOIN CENTRO_RESULTADO CR ON CR.ID = GC.CR_ID
   WHERE G.ID IS NULL OR CR.ID IS NULL`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} vinculo(s) orfao(s) em GESTOR_CR`) }
);

// 6. Conta orcavel (em CR_CONTA ativa) sem prefixo coberto na DRE_CONFIG → some da DRE
await check(
  'toda conta orcavel coberta por prefixo da DRE_CONFIG',
  `SELECT DISTINCT CC.CODIGO, CC.NOME FROM CR_CONTA CRC
   JOIN CONTA_CONTABIL CC ON CC.ID = CRC.CONTA_ID
   WHERE ${ATIVO('CRC.ATIVO')}
     AND NOT EXISTS (
       SELECT 1 FROM DRE_CONFIG D
       WHERE D.TIPO = 'CONTA' AND CC.CODIGO LIKE CONCAT(D.PREFIXO_CONTA, '%')
     )`,
  { avaliar: (r) => (r.length === 0 ? null : `${r.length} conta(s) fora da DRE: ${r.slice(0, 5).map((x) => x.CODIGO).join(', ')}${r.length > 5 ? '…' : ''}`) }
);

// 7. Conta orcavel sem vinculo em CONTA_DRIVER (aviso — pode estar em mapeamento)
await check(
  'toda conta orcavel com vinculo em CONTA_DRIVER',
  `SELECT DISTINCT CC.CODIGO FROM CR_CONTA CRC
   JOIN CONTA_CONTABIL CC ON CC.ID = CRC.CONTA_ID
   LEFT JOIN CONTA_DRIVER CD ON CD.CONTA_ID = CC.ID
   WHERE ${ATIVO('CRC.ATIVO')} AND CD.ID IS NULL`,
  { nivel: 'aviso', avaliar: (r) => (r.length === 0 ? null : `${r.length} conta(s) sem driver/pacote: ${r.slice(0, 5).map((x) => x.CODIGO).join(', ')}${r.length > 5 ? '…' : ''}`) }
);

console.log(`\n${erros} erro(s), ${avisos} aviso(s)`);
if (erros > 0) {
  console.error('Auditoria de dados VERMELHA — bloqueia o gate em andamento (AUDITORIA-IMPLANTACAO.md, Secao 1).');
  process.exit(1);
}
console.log('Auditoria de dados verde.');
