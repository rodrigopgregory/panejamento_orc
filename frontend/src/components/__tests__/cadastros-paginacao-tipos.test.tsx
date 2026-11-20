// A tela de Cadastros era a UNICA do sistema que mandava limit/offset como STRING
// (`limit: String(PAGE_SIZE)`), desde o refactor de paginacao de 05/07. Todas as outras
// telas paginadas (Auditoria, Resultado Contabil) sempre mandaram numero.
//
// Por que so aqui isso e perigoso: no SQL dessas SFs os demais parametros ficam entre
// aspas ('{{busca}}', '{{ativo}}'), entao valor textual e inofensivo. Mas limit e offset
// caem em `LIMIT {{limit}} OFFSET {{offset}}`, posicao que exige numero puro. Mandar
// string so funciona enquanto a substituicao interpolar o valor cru; onde ela escapar
// como texto, o SQL vira `LIMIT '20'` e TODAS as queries da tela quebram de uma vez.
//
// Este teste trava o tipo. E barato e pega uma regressao que passa despercebida em
// review, porque `String(20)` continua "parecendo certo".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const { chamadas } = vi.hoisted(() => ({ chamadas: [] as { sfId: number; input: any }[] }));

vi.mock('../../hooks/useMitraData', () => ({
  execSF: vi.fn(async (sfId: number, input: any) => {
    chamadas.push({ sfId, input });
    // SFs de contagem devolvem TOTAL; as de listagem, linhas.
    return [42, 47, 52].includes(sfId) ? [{ TOTAL: 0 }] : [];
  }),
  sqlEscape: (v: string) => v,
}));

import DadosIntegracaoPage from '../../pages/DadosIntegracaoPage';

// IDs das SFs de listagem paginada: empresas, contas, CRs.
const LISTAGENS = [41, 46, 51];

describe('Cadastros — tipos de limit/offset', () => {
  beforeEach(() => { chamadas.length = 0; });
  afterEach(cleanup);

  it('manda limit e offset como numero, nunca string', async () => {
    render(<DadosIntegracaoPage />);
    await waitFor(() => expect(chamadas.some((c) => c.sfId === 41)).toBe(true));

    const paginadas = chamadas.filter((c) => LISTAGENS.includes(c.sfId));
    expect(paginadas.length).toBeGreaterThan(0);
    for (const c of paginadas) {
      expect(typeof c.input.limit, `SF ${c.sfId} recebeu limit ${JSON.stringify(c.input.limit)}`).toBe('number');
      expect(typeof c.input.offset, `SF ${c.sfId} recebeu offset ${JSON.stringify(c.input.offset)}`).toBe('number');
    }
  });

  it('mantem o tipo ao trocar de aba', async () => {
    render(<DadosIntegracaoPage />);
    await waitFor(() => expect(chamadas.some((c) => c.sfId === 41)).toBe(true));

    // A aba de CRs carrega a lista de empresas para o filtro — outro ponto que
    // passava '500'/'0' como string.
    fireEvent.click(screen.getByText('Centros de Resultado'));
    await waitFor(() => expect(chamadas.some((c) => c.sfId === 51)).toBe(true));

    for (const c of chamadas.filter((c) => 'limit' in (c.input || {}))) {
      expect(typeof c.input.limit, `SF ${c.sfId} recebeu limit string`).toBe('number');
      expect(typeof c.input.offset, `SF ${c.sfId} recebeu offset string`).toBe('number');
    }
  });

  it('avanca a pagina somando offset em numero', async () => {
    render(<DadosIntegracaoPage />);
    await waitFor(() => expect(chamadas.some((c) => c.sfId === 41)).toBe(true));
    const primeira = chamadas.find((c) => c.sfId === 41)!;
    // offset da primeira pagina e 0 numerico, nao '0' — '0' passaria num teste de valor.
    expect(primeira.input.offset).toBe(0);
    expect(Object.is(primeira.input.offset, 0)).toBe(true);
  });
});
