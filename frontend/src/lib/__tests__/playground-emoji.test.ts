// Emoji do modelo travando a gravação — a causa raiz provada em 2026-08-03.
//
// O banco do projeto é utf8mb3 (máximo 3 bytes por caractere) com
// STRICT_TRANS_TABLES ligado. Emoji ocupa 4 bytes. Rodando a MESMA server
// function duas vezes seguidas no mesmo estudo:
//   com emoji  -> FAILED  "'\xF0\x9F\x93\x8A 2...' for column 'HTML' at row 1"
//   sem emoji  -> COMPLETED
// Um único emoji em qualquer ponto do HTML fazia a tela nunca ser publicada:
// o estudo terminava só com a conversa — o sintoma de "não gera dashboard".
//
// O guard definitivo está no esc() das SFs (o analista chama salvar_html
// direto do sandbox, esse HTML nunca passa pelo frontend). Estes testes travam
// a parte que vive aqui: o filtro espelhado, a detecção do erro e a instrução
// no contexto do analista.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSF = vi.fn();
vi.mock('../../hooks/useMitraData', () => ({ execSF: (...a: unknown[]) => execSF(...a) }));

import {
  semCaracteres4Bytes, pareceErroDeEncoding, textoErroEncoding,
  buildContexto, suffixTurno,
} from '../playground';

beforeEach(() => {
  vi.clearAllMocks();
  execSF.mockResolvedValue([]);
});

const EMOJI = '\u{1F4CA}';    // gráfico de barras — o clássico do modelo
const ASTRAL = '\u{1D400}';   // "A" matemático: 4 bytes sem ser emoji

describe('semCaracteres4Bytes', () => {
  it('remove emoji preservando o resto do texto', () => {
    expect(semCaracteres4Bytes(`Receita ${EMOJI} 2026`)).toBe('Receita  2026');
  });

  it('remove qualquer caractere acima de U+FFFF, nao so emoji', () => {
    expect(semCaracteres4Bytes(`Var ${ASTRAL} 12%`)).toBe('Var  12%');
  });

  it('NAO mexe em acentuacao portuguesa (2 bytes, o banco aceita)', () => {
    const t = 'Orçamento, análise de variação — não à toa';
    expect(semCaracteres4Bytes(t)).toBe(t);
  });

  it('preserva os caracteres estruturais do HTML e do JSON', () => {
    const html = `<h1 class="k">R$ 1.234,50 & <b>'x'</b></h1>`;
    expect(semCaracteres4Bytes(html)).toBe(html);
  });

  it('limpa emoji no meio de um HTML sem quebrar as tags em volta', () => {
    const limpo = semCaracteres4Bytes(`<h1>Receita ${EMOJI}</h1><p>ok</p>`);
    expect(limpo).toBe('<h1>Receita </h1><p>ok</p>');
    expect(limpo).not.toMatch(/[\uD800-\uDFFF]/); // nenhum surrogate solto
  });

  it('tolera vazio, null e undefined', () => {
    expect(semCaracteres4Bytes('')).toBe('');
    expect(semCaracteres4Bytes(null as any)).toBe('');
    expect(semCaracteres4Bytes(undefined as any)).toBe('');
  });
});

describe('pareceErroDeEncoding', () => {
  it('reconhece o erro REAL que o banco devolveu na reproducao', () => {
    const real = `HTTP 400: {"type":"SQLExecutionError","code":"DML_EXECUTION_FAILED","message":"'\\xF0\\x9F\\x93\\x8A 2...' for column 'HTML' at row 1"}`;
    expect(pareceErroDeEncoding(real)).toBe(true);
  });

  it('reconhece o erro de comparacao dentro de uma consulta', () => {
    const real = "Illegal mix of collations (utf8mb3_bin,IMPLICIT) and (utf8mb4_0900_ai_ci,COERCIBLE) for operation '='";
    expect(pareceErroDeEncoding(real)).toBe(true);
  });

  it('nao confunde com erro comum de analise', () => {
    expect(pareceErroDeEncoding('Table ORCAMENTO_X doesn\'t exist')).toBe(false);
    expect(pareceErroDeEncoding('a coluna VALOR esta vazia para o ciclo')).toBe(false);
    expect(pareceErroDeEncoding('')).toBe(false);
  });

  it('a explicacao e em portugues, sem jargao de banco', () => {
    const t = textoErroEncoding();
    expect(t).toMatch(/emoji/i);
    expect(t).not.toMatch(/collation|utf8|charset|surrogate/i);
  });
});

describe('contexto do analista', () => {
  it('proibe emoji explicitamente no contexto inicial', async () => {
    const ctx = await buildContexto(1, 'qual a receita?');
    expect(ctx).toMatch(/emoji/i);
    expect(ctx).toMatch(/4 bytes/i);
  });

  it('repete a proibicao nos turnos seguintes (a thread longa esquece)', () => {
    expect(suffixTurno(1, 'e agora?')).toMatch(/emoji/i);
  });

  it('o proprio contexto nao contem emoji — ele tambem trafega ate o banco', async () => {
    const ctx = await buildContexto(1, 'qual a receita?');
    expect(ctx).not.toMatch(/[\uD800-\uDFFF]/);
    expect(suffixTurno(1, 'e agora?')).not.toMatch(/[\uD800-\uDFFF]/);
  });
});
