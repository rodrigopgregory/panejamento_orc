import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────
// Cabecalho de coluna que ordena as linhas ao ser clicado, com o mesmo
// indicador visual usado na tabela de lancamentos do Resultado Contabil:
// seta na cor primaria quando ativa, seta neutra so no hover quando nao.
// ──────────────────────────────────────────────────────────────────────

export default function CabecalhoOrdenavel({ campo, rotulo, ordem, onOrdenar, className = '', alinhamento = 'left', style }: {
  campo: string;
  rotulo: string;
  ordem: { campo: string; dir: 'asc' | 'desc' } | null;
  onOrdenar: (campo: string) => void;
  className?: string;
  alinhamento?: 'left' | 'right' | 'center';
  style?: React.CSSProperties;
}) {
  const ativa = ordem?.campo === campo ? ordem.dir : null;
  const Icone = ativa === 'asc' ? ArrowUp : ativa === 'desc' ? ArrowDown : ChevronsUpDown;

  return (
    <th
      scope="col"
      aria-sort={ativa === 'asc' ? 'ascending' : ativa === 'desc' ? 'descending' : 'none'}
      onClick={() => onOrdenar(campo)}
      title="Clique para ordenar"
      className={`${className} cursor-pointer select-none group`}
      style={style}
    >
      <span
        className="inline-flex items-center gap-1"
        style={{ flexDirection: alinhamento === 'right' ? 'row-reverse' : 'row' }}
      >
        {rotulo}
        <Icone
          size={12}
          aria-hidden
          className={`shrink-0 transition-opacity duration-150 ${ativa ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}
          style={{ color: ativa ? 'var(--color-primary)' : undefined }}
        />
      </span>
    </th>
  );
}
