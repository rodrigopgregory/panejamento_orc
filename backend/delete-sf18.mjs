import 'dotenv/config';
import { configureSdkMitra, deleteServerFunctionMitra, readServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Confirma que a SF 18 ainda e o {{sql}} arbitrario antes de remover
const sf18 = await readServerFunctionMitra({ projectId, serverFunctionId: 18 }).catch(() => null);
if (!sf18?.result) { console.log('SF 18 ja nao existe — nada a fazer.'); process.exit(0); }
console.log('SF 18 atual:', JSON.stringify({ name: sf18.result.name, code: sf18.result.code, public: sf18.result.publicExecution }));

const del = await deleteServerFunctionMitra({ projectId, serverFunctionId: 18 });
console.log('DELETE SF 18:', JSON.stringify(del.result ?? del));

// Confirma que a substituta 76 e as publicas seguem vivas
const all = await listServerFunctionsMitra({ projectId });
const list = all.result || all;
const keep = list.filter(f => [76,77,78,72,73,74,75,69,70,63,64].includes(f.id)).map(f => `${f.id}:${f.name}`);
console.log('SFs criticas presentes:', keep.join(', '));
const stillHas18 = list.some(f => f.id === 18);
console.log('SF 18 ainda existe?', stillHas18);
