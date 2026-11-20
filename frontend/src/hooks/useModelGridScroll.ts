import { useMemo, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────
// Correcao do scroll horizontal da grade de modelo.
//
// Sintoma: depois de clicar numa celula, rolar de volta para a esquerda nao
// funciona — a viewport salta de volta para a celula focada.
//
// Causa: o wrapper React do Handsontable chama updateSettings a cada render e
// sempre manda `data`. Como o array de dados e remontado no corpo do render, a
// identidade muda sempre, todo re-render vira updateData(), e o updateData roda
// selection.refresh(), que reposiciona a viewport na celula com foco.
//
// Medido em Chromium (coluna 13 selecionada, scrollLeft 0, apos um re-render):
//   sem nada                                  -> 0 vira 384   (o defeito)
//   beforeViewportScrollHorizontally => false -> 0 vira 384   (NAO resolve)
//   preventScrolling.value = true             -> 0 continua 0 (resolve)
//
// A supressao vale so na janela do updateData: navegacao de verdade (teclado,
// clique em celula fora da viewport) continua rolando normalmente.
// ──────────────────────────────────────────────────────────────────────

export function useModelGridScroll() {
  const suprimir = useRef(false);

  return useMemo(() => ({
    beforeUpdateData: () => {
      suprimir.current = true;
      // A rolagem indesejada acontece de forma sincrona dentro do updateData.
      // Liberar no proximo macrotask garante que a supressao nunca fique presa.
      setTimeout(() => { suprimir.current = false; }, 0);
    },
    afterSelection: (_r: number, _c: number, _r2: number, _c2: number, preventScrolling: any) => {
      if (suprimir.current && preventScrolling) preventScrolling.value = true;
    },
    afterSelectionFocusSet: (_r: number, _c: number, preventScrolling: any) => {
      if (suprimir.current && preventScrolling) preventScrolling.value = true;
    },
  }), []);
}
