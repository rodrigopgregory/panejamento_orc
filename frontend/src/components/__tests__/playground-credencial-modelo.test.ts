// Escolha do modelo do analista e leitura de data/hora do estudo.
//
// O bug que originou estes testes: o modelId ficava cravado no codigo. Se a
// credencial conectada nao oferecia AQUELE modelo, todo turno morria com
// "model not available" — que o app classificava como falta de credencial.
// Resultado pro usuario: conectava a conta e continuava travado, num laco.
import { describe, it, expect } from 'vitest';
import {
  escolherModelo,
  causaCredencial, tituloErroCredencial, textoErroCredencial,
  pareceErroDeCredencial, SEM_CREDENCIAL,
  fmtDataHora,
} from '../../lib/playground';

const grupo = (type: string, ...ids: string[]) => ({ type, models: ids.map((modelId) => ({ modelId })) });

describe('escolha do modelo pela credencial conectada', () => {
  it('usa o preferido (escolhido na Governanca de IA) quando a credencial o oferece', () => {
    const grupos = [grupo('subscription', 'outro/modelo', 'subscription:anthropic:escolhido')];
    expect(escolherModelo(grupos, 'subscription:anthropic:escolhido')).toBe('subscription:anthropic:escolhido');
  });

  it('sem preferido gravado escolhe sozinho — nenhum modelo fica cravado no codigo', () => {
    const grupos = [grupo('subscription', 'subscription:anthropic:a', 'subscription:anthropic:b')];
    expect(escolherModelo(grupos)).toBe('subscription:anthropic:a');
  });

  it('preferido que a credencial NAO oferece cai no disponivel, sem derrubar a pergunta', () => {
    const grupos = [grupo('subscription', 'subscription:anthropic:a')];
    expect(escolherModelo(grupos, 'modelo/inexistente')).toBe('subscription:anthropic:a');
  });

  it('cai para o modelo disponivel quando o preferido nao existe na conta', () => {
    // exatamente o cenario do bug: conta Claude sem o fable-5
    const grupos = [grupo('subscription', 'subscription:anthropic:claude-opus-4-8')];
    expect(escolherModelo(grupos)).toBe('subscription:anthropic:claude-opus-4-8');
  });

  it('prefere assinatura a API key avulsa quando ha os dois', () => {
    const grupos = [grupo('api_key', 'openai/gpt-5.5'), grupo('subscription', 'subscription:anthropic:x')];
    expect(escolherModelo(grupos)).toBe('subscription:anthropic:x');
  });

  it('ignora grupos sem modelo', () => {
    const grupos = [{ type: 'subscription', models: [] }, grupo('api_key', 'glm/glm-5.1')];
    expect(escolherModelo(grupos)).toBe('glm/glm-5.1');
  });

  it('sem nenhum modelo devolve vazio — o unico caso de "falta credencial"', () => {
    expect(escolherModelo([])).toBe('');
    expect(escolherModelo([{ type: 'subscription', models: [] }])).toBe('');
  });
});

describe('instrucao do erro de credencial', () => {
  it('separa "nao ha credencial" de "a credencial falhou"', () => {
    expect(causaCredencial(SEM_CREDENCIAL)).toBe('sem');
    expect(causaCredencial('model not available')).toBe('falhou');
    expect(causaCredencial('403 forbidden')).toBe('falhou');
  });

  it('cada causa tem titulo e instrucao proprios', () => {
    expect(tituloErroCredencial('sem')).not.toBe(tituloErroCredencial('falhou'));
    expect(textoErroCredencial('sem')).toMatch(/Nenhuma credencial/i);
    expect(textoErroCredencial('falhou')).toMatch(/conectada, mas a chamada falhou/i);
  });

  it('o marcador interno continua sendo reconhecido como erro de credencial', () => {
    // se o regex deixasse de casar, o painel de conexao nao abriria
    expect(pareceErroDeCredencial(SEM_CREDENCIAL)).toBe(true);
  });
});

describe('fuso horario dos estudos', () => {
  // Os timestamps sao gravados em UTC sem sufixo ("2026-07-31T11:01:24").
  // Sem marcar como UTC, o new Date() lia como hora LOCAL e a tela mostrava
  // 11:01 para quem no Brasil criou o estudo as 08:01.
  it('interpreta a string sem fuso como UTC e mostra no fuso de quem olha', () => {
    const saoPaulo = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
    }).format(new Date('2026-07-31T11:01:24Z'));
    expect(saoPaulo).toBe('08:01');

    // o formatador do app usa o fuso do ambiente; o que precisa valer sempre e
    // que ele NAO ecoe o horario UTC cru quando o ambiente nao e UTC
    const esperado = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
      .format(new Date('2026-07-31T11:01:24Z'));
    expect(fmtDataHora('2026-07-31T11:01:24')).toContain(esperado);
  });

  it('respeita a string que ja vem com fuso explicito', () => {
    const comZ = fmtDataHora('2026-07-31T11:01:24Z');
    const sem = fmtDataHora('2026-07-31T11:01:24');
    expect(comZ).toBe(sem);
  });

  it('devolve o valor cru quando a data e invalida e vazio quando ausente', () => {
    expect(fmtDataHora('')).toBe('');
    expect(fmtDataHora(undefined)).toBe('');
    expect(fmtDataHora('nao-e-data')).toBe('nao-e-data');
  });
});
