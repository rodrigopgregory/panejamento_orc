// Status "Pronto"/"Fórmula pendente" no Mapeamento: o bloco DRIVER_CONFIGS da
// SF 132 (hotModelagemBase) contava apenas linhas TIPO='FORMULA' com formula
// nao-vazia — modelo desenhado so com inputs (caso comum em pacote) ficava
// "Fórmula pendente" para sempre, mesmo publicado. Passa a contar TODAS as
// linhas do desenho (DRIVER_FORMULA), para modelos por setor e pacotes.
// Idempotente: so troca se o fragmento antigo existir.
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_ID = 132;
const OLD = "SELECT DRIVER_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA WHERE TIPO = 'FORMULA' AND FORMULA IS NOT NULL AND FORMULA <> '' GROUP BY DRIVER_ID";
const NEW = "SELECT DRIVER_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA GROUP BY DRIVER_ID";
const fn = await readServerFunctionMitra({ projectId, serverFunctionId: SF_ID });
const code = fn?.result?.code || '';
if (code.includes(NEW)) { console.log('SF 132 ja corrigida'); process.exit(0); }
if (!code.includes(OLD)) throw new Error('fragmento antigo nao encontrado na SF 132 — verificar manualmente');
await updateServerFunctionMitra({ projectId, serverFunctionId: SF_ID, code: code.replace(OLD, NEW) });
console.log('SF 132 atualizada: QTD agora conta todas as linhas do modelo');
