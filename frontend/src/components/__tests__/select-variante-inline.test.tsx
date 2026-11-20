// O Select e usado em praticamente todas as telas. A variante 'inline' foi
// adicionada para a tabela editavel; este teste garante que ela nao vazou para
// o comportamento padrao — quem nao pede variante continua com a caixa de sempre.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Select from '../ui/Select';

afterEach(cleanup);

const OPCOES = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
];

function gatilho(): HTMLElement {
  return screen.getAllByRole('button')[0];
}

describe('Select padrao', () => {
  it('mantem a caixa: superficie elevada e borda visivel', () => {
    render(<Select options={OPCOES} value="a" onChange={() => {}} />);
    const botao = gatilho();
    expect(botao.style.backgroundColor).toBe('var(--bg-elevated)');
    expect(botao.style.borderColor).toBe('var(--border)');
    expect(botao.className).not.toContain('celula-inline');
  });

  it('usa a altura de controle do design system (36px)', () => {
    render(<Select options={OPCOES} value="a" onChange={() => {}} />);
    expect(gatilho().className).toContain('pl-3');
    expect(gatilho().className).toContain('h-9');
  });
});

describe('Select inline', () => {
  it('nao pinta fundo nem borda: quem manda e a classe discreta', () => {
    render(<Select variant="inline" options={OPCOES} value="a" onChange={() => {}} />);
    const botao = gatilho();
    // Estilo inline venceria o CSS; por isso a variante deixa os dois vazios.
    expect(botao.style.backgroundColor).toBe('');
    expect(botao.style.borderColor).toBe('');
    expect(botao.className).toContain('celula-inline');
  });

  it('usa espacamento compacto, compativel com celula de tabela', () => {
    render(<Select variant="inline" options={OPCOES} value="a" onChange={() => {}} />);
    expect(gatilho().className).toContain('py-1');
    expect(gatilho().className).not.toContain('py-2');
  });

  it('continua selecionando normalmente', () => {
    let escolhido = '';
    render(<Select variant="inline" options={OPCOES} value="a" onChange={(v) => { escolhido = v; }} />);
    fireEvent.click(gatilho());
    fireEvent.click(screen.getByText('Beta'));
    expect(escolhido).toBe('b');
  });

  it('mostra o rotulo da opcao escolhida', () => {
    render(<Select variant="inline" options={OPCOES} value="b" onChange={() => {}} />);
    expect(gatilho().textContent).toContain('Beta');
  });
});
