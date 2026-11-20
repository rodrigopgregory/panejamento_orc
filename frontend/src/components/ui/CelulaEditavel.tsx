import { useRef, useState } from 'react';
import Select from './Select';
import Badge from './Badge';

// ──────────────────────────────────────────────────────────────────────
// Celulas de edicao inline discretas.
//
// Principio: em repouso a celula mantem a tipografia e o alinhamento das
// celulas nao editaveis — sem caixa e sem borda. O unico sinal de que da para
// editar e um pontilhado fino sob o proprio valor, na largura do texto; o fundo
// aparece de leve no hover e a borda so no foco, enquanto a edicao acontece.
// Toda a aparencia mora nas classes `.celula-inline*` no index.css.
//
// Os campos de texto/numero sao NAO CONTROLADOS (defaultValue). E proposital: a
// tela recarrega os dados depois de gravar, e um campo controlado piscaria o
// valor antigo ate a resposta chegar. Como consequencia, a linha precisa de key
// estavel (o ID do registro) — se a key mudar, o React remonta o input e o
// texto se perde.
//
// Nos numeros, o campo mostra o valor JA FORMATADO em repouso (R$ 7.500) e
// troca para o numero cru ao receber foco, voltando a formatar ao sair. Assim a
// tabela continua legivel como tabela, e so vira formulario durante a digitacao.
//
// Selecao e selo sao CONTROLADOS, e por isso precisam do valor otimista abaixo:
// a tela so recarrega os dados ~1s depois de gravar (recarga coalescida), e sem
// isso o clique ficaria sem resposta visivel ate a rede responder. Se a gravacao
// falhar, `onSalvar` rejeita e a celula volta sozinha ao valor anterior.
// ──────────────────────────────────────────────────────────────────────

const classeBase = 'celula-inline w-full text-sm rounded-md border transition-all duration-200 focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';

// Onde se digita ou se escolhe, o valor ganha o pontilhado discreto de campo.
// O selo colorido fica de fora: ele ja e um objeto visivel na celula, e um
// sublinhado sob um selo so sujaria a leitura.
const classeCampo = `${classeBase} celula-inline-marca`;

const anelFoco = { '--tw-ring-color': 'var(--color-primary-light)' } as React.CSSProperties;

type AoSalvar = (v: string) => void | Promise<void>;

// Mostra a escolha do usuario na hora e desfaz se a gravacao falhar. O ajuste
// durante o render e o padrao do React para estado derivado de prop: quando a
// tela recarrega e traz outro valor, o local acompanha.
function useValorOtimista(valor: string): [string, (v: string) => void] {
  const [local, setLocal] = useState(valor);
  const anterior = useRef(valor);
  if (anterior.current !== valor) {
    anterior.current = valor;
    setLocal(valor);
  }
  return [local, setLocal];
}

function formatar(valor: number, moeda?: boolean, sufixo?: string): string {
  if (!valor) return '';
  // Casas decimais so quando existem: salario redondo aparece "R$ 7.500", e com
  // centavos aparece "R$ 8.500,50" — nunca "R$ 8.500,5" nem "R$ 7.500,00".
  // As duas casas sao regra de DINHEIRO (centavos), nao de numero: percentual
  // se escreve "4,5%", e nao "4,50%".
  const temDecimais = !Number.isInteger(valor);
  const numero = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: moeda && temDecimais ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(valor);
  if (moeda) return `R$ ${numero}`;
  return sufixo ? `${numero}${sufixo}` : numero;
}

function paraEdicao(valor: number): string {
  return valor ? String(valor).replace('.', ',') : '';
}

export function NumeroEditavel({ valor, onSalvar, disabled, moeda, sufixo, rotulo, alinhamento = 'right' }: {
  valor: number;
  onSalvar: (v: number) => void | Promise<void>;
  disabled?: boolean;
  moeda?: boolean;
  sufixo?: string;
  rotulo?: string;
  alinhamento?: 'left' | 'right';
}) {
  const campo = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={campo}
      type="text"
      inputMode="decimal"
      // Em repouso mostra formatado; ao focar, troca para o numero cru.
      defaultValue={formatar(valor, moeda, sufixo)}
      // Celula vazia nao tem texto para sublinhar, e ficaria sem nenhum sinal de
      // que da para digitar. O travessao e o que a tabela ja usaria para "sem valor".
      placeholder="—"
      disabled={disabled}
      aria-label={rotulo}
      className={`${classeCampo} px-2 py-1 tabular-nums`}
      style={{ ...anelFoco, textAlign: alinhamento, color: 'var(--color-text)' }}
      onFocus={(e) => {
        e.target.value = paraEdicao(valor);
        e.target.select();
      }}
      onBlur={(e) => {
        const novo = Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0;
        e.target.value = formatar(novo, moeda, sufixo);
        if (novo === valor) return;
        // Campo nao controlado: se a gravacao falhar, o texto digitado ficaria
        // na tela mostrando algo que nao esta no banco. Devolve na mao.
        Promise.resolve(onSalvar(novo)).catch(() => {
          if (campo.current) campo.current.value = formatar(valor, moeda, sufixo);
        });
      }}
      onKeyDown={(e) => {
        const alvo = e.target as HTMLInputElement;
        if (e.key === 'Enter') alvo.blur();
        if (e.key === 'Escape') { alvo.value = paraEdicao(valor); alvo.blur(); }
      }}
    />
  );
}

// Texto livre na celula — mesma regra do numero: sem caixa em repouso, campo
// nao controlado, e o valor anterior volta sozinho se a gravacao falhar.
export function TextoEditavel({ valor, onSalvar, disabled, rotulo, placeholder }: {
  valor: string;
  onSalvar: (v: string) => void | Promise<void>;
  disabled?: boolean;
  rotulo?: string;
  placeholder?: string;
}) {
  const campo = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={campo}
      type="text"
      defaultValue={valor}
      placeholder={placeholder || '—'}
      disabled={disabled}
      aria-label={rotulo}
      className={`${classeCampo} px-2 py-1`}
      style={{ ...anelFoco, color: 'var(--color-text)' }}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const novo = e.target.value.trim();
        // Nome vazio nao e uma edicao, e um acidente: devolve o anterior.
        if (!novo) { e.target.value = valor; return; }
        if (novo === valor) return;
        Promise.resolve(onSalvar(novo)).catch(() => {
          if (campo.current) campo.current.value = valor;
        });
      }}
      onKeyDown={(e) => {
        const alvo = e.target as HTMLInputElement;
        if (e.key === 'Enter') alvo.blur();
        if (e.key === 'Escape') { alvo.value = valor; alvo.blur(); }
      }}
    />
  );
}

export function SelecaoEditavel({ valor, opcoes, onSalvar, disabled }: {
  valor: string;
  opcoes: { value: string; label: string }[];
  onSalvar: AoSalvar;
  disabled?: boolean;
}) {
  const [atual, definir] = useValorOtimista(valor);
  return (
    <Select
      variant="inline"
      options={opcoes}
      value={atual}
      disabled={disabled}
      onChange={(v) => {
        if (v === atual) return;
        definir(v);
        Promise.resolve(onSalvar(v)).catch(() => definir(valor));
      }}
    />
  );
}

// Colunas categoricas (Sim/Nao, Fixo/Percentual) continuam sendo o selo colorido
// que a tabela ja mostrava — o clique alterna para a proxima opcao. Trocar o selo
// por um seletor com caixa transformaria a coluna num formulario, que e
// justamente o que se quer evitar.
export function SeloEditavel({ valor, opcoes, onSalvar, disabled, rotulo }: {
  valor: string;
  opcoes: { value: string; label: string; variante: 'success' | 'danger' | 'info' | 'warning' | 'neutral' }[];
  onSalvar: AoSalvar;
  disabled?: boolean;
  rotulo: string;
}) {
  const [atual, definir] = useValorOtimista(valor);
  const indice = Math.max(0, opcoes.findIndex((o) => o.value === atual));
  const opcao = opcoes[indice];
  const proxima = opcoes[(indice + 1) % opcoes.length];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${rotulo}: ${opcao.label}`}
      title={`Alternar para ${proxima.label}`}
      className={`${classeBase} px-2 py-1 text-left`}
      style={anelFoco}
      onClick={() => {
        definir(proxima.value);
        Promise.resolve(onSalvar(proxima.value)).catch(() => definir(valor));
      }}
    >
      <Badge variant={opcao.variante}>{opcao.label}</Badge>
    </button>
  );
}
