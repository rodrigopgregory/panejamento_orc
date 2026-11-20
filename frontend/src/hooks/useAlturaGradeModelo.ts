import { useEffect, useRef, useState } from 'react';
import { ALTURA_MAX_GRADE_MODELO, alturaGradeModelo } from '../lib/model-grid';

// ──────────────────────────────────────────────────────────────────────
// Altura da grade de modelo medida no DOM.
//
// Sintoma: a ultima linha (o Total) aparece com a parte de baixo cortada.
//
// Causa: a altura vinha de `nLinhas * 38 + 76`, e o 76 e uma estimativa dos dois
// cabecalhos que nao reserva NADA para a barra de rolagem horizontal. As colunas
// somam 1520px (260 + 12*96 + 108), entao a barra praticamente sempre aparece,
// ocupa o rodape do .wtHolder e come o final da ultima linha.
//
// Aqui nao se estima: le-se o .wtHider, que ja tem a altura exata do conteudo
// (cabecalhos + linhas + bordas), e soma-se a barra horizontal real, que e a
// diferenca entre offsetHeight e clientHeight do .wtHolder. Assim a conta
// continua certa se a fonte, o tema ou a espessura da barra mudarem.
// ──────────────────────────────────────────────────────────────────────

export function useAlturaGradeModelo(
  raizRef: { current: HTMLElement | null },
  nLinhas: number,
): number {
  const [medida, setMedida] = useState<number | null>(null);
  // A ultima medida tambem vive num ref: o comparador roda dentro do
  // ResizeObserver, fora do ciclo de render, e ler do state ali daria valor velho.
  const medidaRef = useRef<number | null>(null);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;

    const medir = () => {
      const hider = raiz.querySelector('.ht_master .wtHider') as HTMLElement | null;
      const holder = raiz.querySelector('.ht_master .wtHolder') as HTMLElement | null;
      // Antes do Handsontable montar nao ha o que medir — o observer chama de
      // novo assim que a grade ganha tamanho.
      if (!hider || !holder) return;
      const conteudo = hider.offsetHeight;
      if (conteudo <= 0) return;
      const barraHorizontal = Math.max(0, holder.offsetHeight - holder.clientHeight);
      const alvo = Math.min(conteudo + barraHorizontal, ALTURA_MAX_GRADE_MODELO);
      // Tolerancia de 1px: sem ela, um arredondamento de subpixel faria
      // medida -> altura -> nova medida girando para sempre no observer.
      if (medidaRef.current !== null && Math.abs(medidaRef.current - alvo) <= 1) return;
      medidaRef.current = alvo;
      setMedida(alvo);
    };

    medir();
    if (typeof ResizeObserver === 'undefined') return;
    // rAF porque o observer dispara no meio do layout: medir ali leria o estado
    // anterior do .wtHider e ainda geraria o aviso de loop do ResizeObserver.
    let agendado = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(agendado);
      agendado = requestAnimationFrame(medir);
    });
    observer.observe(raiz);
    return () => { cancelAnimationFrame(agendado); observer.disconnect(); };
  }, [raizRef, nLinhas]);

  return medida ?? alturaGradeModelo(nLinhas);
}
