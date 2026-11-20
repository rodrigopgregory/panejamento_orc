// TextoEditavel entrou em CelulaEditavel para a tabela de Premissas Gerais
// seguir o mesmo padrao de edicao inline de Premissas Folha (numero e selecao ja
// existiam; faltava texto).
//
// O que precisa ficar de pe:
//  - em repouso e uma celula de tabela, nao um formulario;
//  - nome apagado nao vira nome vazio no banco — volta ao anterior;
//  - se a gravacao falhar, o texto digitado nao pode ficar na tela mentindo.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TextoEditavel } from '../ui/CelulaEditavel';

afterEach(cleanup);

describe('TextoEditavel', () => {
  it('grava o texto novo ao sair do campo', async () => {
    const salvar = vi.fn();
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={salvar} />);
    const campo = screen.getByLabelText('Nome') as HTMLInputElement;

    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: 'Câmbio' } });
    fireEvent.blur(campo);

    expect(salvar).toHaveBeenCalledWith('Câmbio');
  });

  it('nao grava quando o texto nao mudou', () => {
    const salvar = vi.fn();
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={salvar} />);
    const campo = screen.getByLabelText('Nome') as HTMLInputElement;

    fireEvent.blur(campo);

    expect(salvar).not.toHaveBeenCalled();
  });

  it('campo apagado volta ao valor anterior e nao grava vazio', () => {
    const salvar = vi.fn();
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={salvar} />);
    const campo = screen.getByLabelText('Nome') as HTMLInputElement;

    fireEvent.change(campo, { target: { value: '   ' } });
    fireEvent.blur(campo);

    expect(salvar).not.toHaveBeenCalled();
    expect(campo.value).toBe('Inflação');
  });

  it('gravacao que falha devolve o valor anterior ao campo', async () => {
    const salvar = vi.fn().mockRejectedValue(new Error('sem rede'));
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={salvar} />);
    const campo = screen.getByLabelText('Nome') as HTMLInputElement;

    fireEvent.change(campo, { target: { value: 'Câmbio' } });
    fireEvent.blur(campo);

    await waitFor(() => expect(campo.value).toBe('Inflação'));
  });

  it('Escape cancela a edicao', () => {
    const salvar = vi.fn();
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={salvar} />);
    const campo = screen.getByLabelText('Nome') as HTMLInputElement;

    fireEvent.change(campo, { target: { value: 'Câmbio' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    fireEvent.blur(campo);

    expect(salvar).not.toHaveBeenCalled();
    expect(campo.value).toBe('Inflação');
  });

  it('em repouso usa a classe de celula inline, sem caixa de formulario', () => {
    render(<TextoEditavel valor="Inflação" rotulo="Nome" onSalvar={vi.fn()} />);
    const campo = screen.getByLabelText('Nome');
    expect(campo.className).toContain('celula-inline');
    expect(campo.className).toContain('celula-inline-marca');
  });
});
