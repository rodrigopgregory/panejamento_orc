// Agrupamento das tools do chat do Playground.
//
// A regra que importa: UM grupo por mensagem do agente. Antes cada chamada
// virava um chip novo numa linha propria — uma analise com cinco consultas
// repetia "Consultando dados" cinco vezes e empurrava a conversa pra baixo.
import { describe, it, expect } from 'vitest';
import { registrarTool, concluirTools, normalizarSegmentos } from '../../lib/playground';

interface ToolItem { label: string; count: number; done: boolean }
interface Seg { t: string; label?: string; items?: ToolItem[]; c?: string }

const msg = (segments: Seg[] = []) => ({ segments });
const grupo = (m: { segments: Seg[] }) => m.segments.find((s) => s.t === 'tools');

describe('agrupamento das tools do Playground', () => {
  it('repeticao do mesmo topico vira contador, nao um chip novo', () => {
    const m = msg();
    registrarTool(m, 'Consultando dados');
    registrarTool(m, 'Consultando dados');
    registrarTool(m, 'Consultando dados');

    expect(m.segments.filter((s) => s.t === 'tools')).toHaveLength(1);
    expect(grupo(m)!.items).toHaveLength(1);
    expect(grupo(m)!.items![0]).toMatchObject({ label: 'Consultando dados', count: 3, done: false });
  });

  it('topicos diferentes convivem no MESMO grupo, mesmo separados por fala', () => {
    const m = msg();
    registrarTool(m, 'Consultando dados');
    m.segments.push({ t: 'md', c: 'Encontrei um salto em março.' });
    registrarTool(m, 'Desenhando a tela');
    m.segments.push({ t: 'md', c: 'Pronto.' });
    registrarTool(m, 'Consultando dados');

    // um unico grupo, na posicao da PRIMEIRA tool — a fala nao abre grupo novo
    expect(m.segments.filter((s) => s.t === 'tools')).toHaveLength(1);
    expect(m.segments[0].t).toBe('tools');
    expect(grupo(m)!.items!.map((i) => [i.label, i.count])).toEqual([
      ['Consultando dados', 2],
      ['Desenhando a tela', 1],
    ]);
  });

  it('so a tool corrente fica ativa; as anteriores viram concluidas', () => {
    const m = msg();
    registrarTool(m, 'Lendo o schema');
    registrarTool(m, 'Consultando dados');

    const items = grupo(m)!.items!;
    expect(items.find((i) => i.label === 'Lendo o schema')!.done).toBe(true);
    expect(items.find((i) => i.label === 'Consultando dados')!.done).toBe(false);

    concluirTools([m]);
    expect(items.every((i) => i.done)).toBe(true);
  });

  it('conversa antiga (um segmento tool por chamada) e convertida na leitura', () => {
    const antiga = [
      { role: 'user', segments: [{ t: 'md', c: 'e aí?' }] },
      {
        role: 'agent',
        segments: [
          { t: 'tool', label: 'Consultando dados', done: true },
          { t: 'md', c: 'Investiguei o período.' },
          { t: 'tool', label: 'Consultando dados', done: true },
          { t: 'tool', label: 'Desenhando a tela', done: true },
        ],
      },
    ];

    const [user, agente] = normalizarSegmentos(antiga as never) as unknown as Array<{ segments: Seg[] }>;

    expect(user.segments).toEqual([{ t: 'md', c: 'e aí?' }]);
    expect(agente.segments.some((s) => s.t === 'tool')).toBe(false);
    expect(agente.segments.filter((s) => s.t === 'tools')).toHaveLength(1);
    expect(grupo(agente)!.items!.map((i) => [i.label, i.count])).toEqual([
      ['Consultando dados', 2],
      ['Desenhando a tela', 1],
    ]);
    // conversa carregada nunca aparece "em execucao"
    expect(grupo(agente)!.items!.every((i) => i.done)).toBe(true);
    // a fala continua depois do grupo
    expect(agente.segments[1]).toEqual({ t: 'md', c: 'Investiguei o período.' });
  });

  it('mensagem sem tool passa intacta pela normalizacao', () => {
    const original = [{ role: 'agent', segments: [{ t: 'md', c: 'só texto' }] }];
    expect(normalizarSegmentos(original as never)).toEqual(original);
  });
});
