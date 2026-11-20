// Qual credencial roda o estudo: a COMPARTILHADA da empresa ou a DO USUARIO.
//
// A hierarquia, nesta ordem: (1) a connection compartilhada do projeto — a
// razao de ela existir e todos consumirem a IA pela MESMA credencial, sem
// ninguem plugar chave propria; (2) sem ela, a credencial do proprio usuario
// logado; (3) NUNCA a de outro usuario, em especial a do dono do sistema.
//
// Duas distincoes que estes testes protegem:
//
// a) lista `null` (a CONSULTA falhou) e diferente de lista VAZIA (a consulta
//    foi bem e nao ha credencial ali). Tratar as duas igual foi o que gerou
//    "conectei e perdeu" — o app acusava falta de credencial em situacoes que
//    eram so rede/ambiente.
//
// b) um connectionId ERRADO nao da erro: o servidor o descarta em silencio,
//    atende com a credencial pessoal e devolve uma lista normal. Entao "veio
//    lista" nao prova nada — a lista vem sempre. So a COMPARACAO com a lista
//    pessoal distingue "a connection respondeu" de "o id foi ignorado".
import { describe, it, expect } from 'vitest';
import {
  decidirCredencial, sanitizarConnectionId, rotuloOrigem, assinaturaModelos,
  descreverOrigem, tituloErroCredencial, textoErroCredencial,
  connectionIdInjetado,
} from '../../lib/playground';

const grupo = (type: string, ...ids: string[]) => ({ type, models: ids.map((modelId) => ({ modelId })) });
const MODELO_PESSOAL = 'subscription:anthropic:pessoal';
const PESSOAL = [grupo('subscription', MODELO_PESSOAL)];
const EMPRESA = [grupo('subscription', 'subscription:anthropic:claude-opus-4-8')];

describe('prioridade entre a credencial da empresa e a do usuario', () => {
  it('usa a da EMPRESA mesmo quando o usuario tem credencial propria', () => {
    // O caso que faz a connection existir: se a pessoal ganhasse, o dono do
    // sistema (que sempre tem chave) nunca passaria pela connection.
    const r = decidirCredencial(PESSOAL, EMPRESA, 'conn-empresa');
    expect(r?.origem).toBe('empresa');
    expect(r?.connectionId).toBe('conn-empresa');
    expect(r?.modelId).toBe('subscription:anthropic:claude-opus-4-8');
  });

  it('cai para a do USUARIO quando nao ha compartilhada configurada', () => {
    const r = decidirCredencial(PESSOAL, null, '');
    expect(r?.origem).toBe('usuario');
    expect(r?.modelId).toBe(MODELO_PESSOAL);
    // connectionId vazio e o que faz a plataforma usar a conta de quem chama
    expect(r?.connectionId).toBe('');
  });

  it('cai para a do USUARIO quando a compartilhada esta apontada mas sem modelo', () => {
    // connection apontada para algo que perdeu acesso: nao adianta insistir
    const r = decidirCredencial(PESSOAL, [], 'conn-empresa');
    expect(r?.origem).toBe('usuario');
    expect(r?.connectionId).toBe('');
  });

  it('SEM credencial pessoal, a compartilhada atende — o teste decisivo', () => {
    // Este e o unico cenario que prova que a connection funciona. Testar so
    // com o dono (que tem chave pessoal) faz TUDO passar sem provar nada.
    const r = decidirCredencial([], EMPRESA, 'conn-empresa');
    expect(r?.origem).toBe('empresa');
    expect(r?.connectionId).toBe('conn-empresa');
  });

  it('sem credencial pessoal e sem compartilhada configurada, nao ha escolha', () => {
    expect(decidirCredencial([], null, '')).toBeNull();
  });

  it('nenhuma das duas com modelo: nao ha escolha', () => {
    expect(decidirCredencial([], [], 'conn-empresa')).toBeNull();
  });

  it('grupo pessoal presente porem vazio nao impede a empresa', () => {
    const r = decidirCredencial([{ type: 'subscription', models: [] }], EMPRESA, 'conn-empresa');
    expect(r?.origem).toBe('empresa');
  });

  it('identificador so com caracteres invalidos e tratado como ausente', () => {
    const r = decidirCredencial(PESSOAL, EMPRESA, '   ');
    expect(r?.origem).toBe('usuario');
  });
});

describe('connectionId recusado em silencio pela plataforma', () => {
  it('lista IDENTICA a pessoal significa id ignorado — nao usa como empresa', () => {
    // O servidor descartou o id e devolveu a credencial pessoal. Aceitar isso
    // como "a connection respondeu" foi o que manteve o bug vivo: o painel
    // mostrava Anthropic/35 modelos vindos da conta pessoal de quem estava
    // logado, enquanto a connection so tinha uma assinatura ChatGPT.
    const r = decidirCredencial(PESSOAL, PESSOAL, 'id-errado');
    expect(r?.origem).toBe('usuario');
    expect(r?.connectionId).toBe('');
    expect(r?.idIgnorado).toBe('id-errado');
  });

  it('a ordem dos modelos nao muda a conclusao (compara o CONJUNTO)', () => {
    const a = [grupo('subscription', 'm-1', 'm-2')];
    const b = [grupo('subscription', 'm-2', 'm-1')];
    const r = decidirCredencial(a, b, 'id-errado');
    expect(r?.idIgnorado).toBe('id-errado');
    expect(r?.origem).toBe('usuario');
  });

  it('listas DIFERENTES provam que a connection tem credencial propria', () => {
    const r = decidirCredencial(PESSOAL, EMPRESA, 'conn-ok');
    expect(r?.origem).toBe('empresa');
    expect(r?.idIgnorado).toBeUndefined();
  });

  it('sem credencial pessoal nao ha com o que comparar: aceita a connection', () => {
    // refPessoal vazio — qualquer lista da connection e dela mesma
    const r = decidirCredencial([], EMPRESA, 'conn-empresa');
    expect(r?.origem).toBe('empresa');
    expect(r?.idIgnorado).toBeUndefined();
  });

  it('assinatura ignora modelo sem id e e estavel', () => {
    expect(assinaturaModelos([grupo('subscription', 'b', 'a')])).toBe('a|b');
    expect(assinaturaModelos([{ type: 's', models: [{ modelId: '' }] }])).toBe('');
    expect(assinaturaModelos(null)).toBe('');
  });
});

describe('a tela conta a origem REAL', () => {
  it('diz que veio da conexao do projeto, com o id', () => {
    const t = descreverOrigem({ origem: 'empresa', connectionId: 'conn-abc' });
    expect(t).toMatch(/conexão do projeto/i);
    expect(t).toMatch(/conn-abc/);
    expect(t).toMatch(/todos os usuários/i);
  });

  it('diz que veio da credencial pessoal', () => {
    const t = descreverOrigem({ origem: 'usuario', connectionId: '' });
    expect(t).toMatch(/credencial pessoal/i);
    expect(t).not.toMatch(/conexão do projeto/i);
  });

  it('denuncia o identificador recusado em vez de esconder', () => {
    const t = descreverOrigem({ origem: 'usuario', connectionId: '', idIgnorado: 'id-errado' });
    expect(t).toMatch(/id-errado/);
    expect(t).toMatch(/recusado/i);
  });
});

describe('identificador da conexao compartilhada', () => {
  it('remove o que poderia escapar do SQL da SF de gravacao', () => {
    expect(sanitizarConnectionId("conn'; DROP TABLE APP_CONFIG; --")).toBe('connDROPTABLEAPP_CONFIG--');
  });

  it('preserva o formato usual e apara espacos', () => {
    expect(sanitizarConnectionId('  conn-abc_123.def:1  ')).toBe('conn-abc_123.def:1');
  });

  it('limita o tamanho ao que a coluna aguenta', () => {
    expect(sanitizarConnectionId('a'.repeat(400)).length).toBe(120);
  });
});

describe('mensagem de erro conforme a credencial que falhou', () => {
  it('nao manda o usuario reconectar a propria conta quando quem falhou foi a da empresa', () => {
    const daEmpresa = textoErroCredencial('falhou', 'empresa');
    expect(daEmpresa).toMatch(/compartilhada da empresa/i);
    expect(daEmpresa).toMatch(/quem administra/i);
    expect(tituloErroCredencial('falhou', 'empresa')).toMatch(/da empresa/i);
  });

  it('quando a falha e da conta do usuario, a instrucao e reconectar', () => {
    expect(textoErroCredencial('falhou', 'usuario')).toMatch(/Reconecte/i);
    expect(tituloErroCredencial('falhou', 'usuario')).toMatch(/sua conta/i);
  });

  it('sem credencial nenhuma, o texto oferece os DOIS caminhos', () => {
    const t = textoErroCredencial('sem');
    expect(t).toMatch(/Conecte a sua conta/i);
    expect(t).toMatch(/compartilhada/i);
  });

  it('rotulo curto de cada origem', () => {
    expect(rotuloOrigem('usuario')).toBe('sua conta');
    expect(rotuloOrigem('empresa')).toBe('credencial da empresa');
  });
});

// Descoberta automatica do identificador da connection: nao existe API que
// liste as connections do projeto, entao o unico canal e o `window.__mitraEnv`
// que o build-proxy injeta no app publicado. Se a plataforma expuser o id ali,
// o app usa sem ninguem digitar nada; se nao, devolve '' e a hierarquia segue.
describe('connectionIdInjetado (descoberta via __mitraEnv)', () => {
  const w = window as unknown as { __mitraEnv?: Record<string, unknown> };
  const limpar = () => { delete w.__mitraEnv; };

  it('sem __mitraEnv: vazio (nada muda na hierarquia)', () => {
    limpar();
    expect(connectionIdInjetado()).toBe('');
  });

  it('achou uma chave com "connection" no nome: usa o valor sanitizado', () => {
    w.__mitraEnv = { agentWsUrl: 'wss://x', agentConnectionId: ' conn-abc ' };
    expect(connectionIdInjetado()).toBe('conn-abc');
    limpar();
  });

  it('chaves sem relacao com connection sao ignoradas', () => {
    w.__mitraEnv = { agentWsUrl: 'wss://x', apiBaseURL: 'https://y' };
    expect(connectionIdInjetado()).toBe('');
    limpar();
  });

  it('valor nao-string ou vazio nao vira id', () => {
    w.__mitraEnv = { connectionId: 42, projectConnection: '' };
    expect(connectionIdInjetado()).toBe('');
    limpar();
  });
});
