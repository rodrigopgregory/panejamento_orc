// Fuso da suite fixado em America/Sao_Paulo (UTC-3) pelo vitest.config — ver
// `test.env.TZ`. Sem isso estes testes passariam por acidente numa maquina UTC,
// que e exatamente o cenario que escondeu o bug original.
import { describe, it, expect } from 'vitest';
import {
  paraLocal, isoLocal, parteData, fmtHora, fmtDataBr,
  fmtDataHora, fmtDataExtenso, diaUtc, rotuloDia,
} from '../auditoria-datas';

describe('auditoria — instante gravado em UTC vira horario local', () => {
  it('recua 3h ao exibir a hora (UTC-3)', () => {
    // A SF carimbou 17:17 UTC; quem operou viu 14:17 no relogio dele.
    expect(fmtHora('2026-07-15T17:17:45')).toBe('14:17');
  });

  it('mantem a data quando a conversao nao cruza a meia-noite', () => {
    expect(parteData('2026-07-15T17:17:45')).toBe('2026-07-15');
    expect(fmtDataHora('2026-07-15T17:17:45')).toBe('15/07/2026 14:17');
  });

  it('volta um dia quando o UTC ja virou mas o local ainda nao', () => {
    // 01:30 UTC do dia 16 = 22:30 local do dia 15. Exibir a string crua
    // jogaria o evento para o dia seguinte, sob o cabecalho errado.
    expect(parteData('2026-07-16T01:30:00')).toBe('2026-07-15');
    expect(fmtHora('2026-07-16T01:30:00')).toBe('22:30');
    expect(fmtDataHora('2026-07-16T01:30:00')).toBe('15/07/2026 22:30');
  });

  it('formata por extenso no dia local, nao no UTC', () => {
    expect(fmtDataExtenso('2026-07-16T01:30:00')).toBe('15 de julho de 2026');
    expect(fmtDataExtenso('2026-01-01T02:00:00')).toBe('31 de dezembro de 2025');
  });

  it('trata valor ausente ou invalido sem quebrar a tela', () => {
    expect(paraLocal(null)).toBeNull();
    expect(fmtHora(null)).toBe('');
    expect(parteData('')).toBe('');
    expect(fmtDataHora('nao-e-data')).toBe('');
    expect(fmtDataExtenso(null)).toBe('');
  });
});

describe('auditoria — dia de calendario do filtro nao sofre conversao', () => {
  it('formata a data escolhida exatamente como foi escolhida', () => {
    // Regressao: passar isso pelo conversor de instante mostraria 29/07.
    expect(fmtDataBr('2026-07-30')).toBe('30/07/2026');
    expect(fmtDataBr('')).toBe('');
  });

  it('isoLocal le o Date pelos getters locais', () => {
    expect(isoLocal(new Date(2026, 6, 30, 23, 59))).toBe('2026-07-30');
  });
});

describe('auditoria — recorte de periodo traduzido para dia UTC', () => {
  it('abre o intervalo no dia UTC do inicio local', () => {
    // 30/07 00:00 local = 30/07 03:00 UTC — mesmo dia UTC.
    expect(diaUtc('2026-07-30', false)).toBe('2026-07-30');
  });

  it('estende o fim para o dia UTC seguinte quando a noite local ja virou', () => {
    // 30/07 23:59 local = 31/07 02:59 UTC. Sem isso o SQL cortava os eventos
    // do fim da noite, que sao justamente os mais recentes da tela.
    expect(diaUtc('2026-07-30', true)).toBe('2026-07-31');
  });

  it('devolve vazio para limite ausente ou malformado (sem filtro)', () => {
    expect(diaUtc('', false)).toBe('');
    expect(diaUtc('', true)).toBe('');
    expect(diaUtc('lixo', false)).toBe('');
  });

  it('cobre a noite local inteira entre os dois limites', () => {
    const de = diaUtc('2026-07-30', false);
    const ate = diaUtc('2026-07-30', true);
    // Um evento as 22:00 local do dia 30 fica gravado como 31/07T01:00 UTC.
    const gravado = '2026-07-31T01:00:00';
    const diaGravadoUtc = gravado.slice(0, 10);
    expect(diaGravadoUtc >= de && diaGravadoUtc <= ate).toBe(true);
    // e a tela o exibe no dia 30, coerente com o filtro que o trouxe.
    expect(parteData(gravado)).toBe('2026-07-30');
  });
});

describe('auditoria — rotulo do bloco usa a mesma base da chave do grupo', () => {
  const agora = new Date(2026, 6, 30, 9, 0); // 30/07/2026 09:00 local

  it('marca Hoje e Ontem pelo dia local', () => {
    expect(rotuloDia('2026-07-30', agora)).toBe('Hoje');
    expect(rotuloDia('2026-07-29', agora)).toBe('Ontem');
  });

  it('nomeia o dia da semana para datas mais antigas', () => {
    expect(rotuloDia('2026-07-27', agora)).toBe('segunda-feira, 27 de julho de 2026');
  });

  it('classifica como Hoje um evento da noite anterior em UTC', () => {
    // Evento gravado 30/07T01:00 UTC = 29/07 22:00 local -> bloco de Ontem.
    expect(rotuloDia(parteData('2026-07-30T01:00:00'), agora)).toBe('Ontem');
  });

  it('descreve a ausencia de data em vez de renderizar vazio', () => {
    expect(rotuloDia('', agora)).toBe('Sem data registrada');
  });
});
