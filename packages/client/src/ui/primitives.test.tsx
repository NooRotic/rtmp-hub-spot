import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { NTWindow } from './NTWindow';
import { NTButton } from './NTButton';
import { NTField } from './NTField';

afterEach(cleanup);

describe('NTWindow', () => {
  it('renders a title bar when title is given and always renders children', () => {
    const { container } = render(<NTWindow title="Sources">body text</NTWindow>);
    expect(container.querySelector('.ntd-window__title')!.textContent).toContain('Sources');
    expect(screen.getByText('body text')).toBeTruthy();
  });
  it('omits the title bar when no title', () => {
    const { container } = render(<NTWindow>only body</NTWindow>);
    expect(container.querySelector('.ntd-window__title')).toBeNull();
  });
});

describe('NTButton', () => {
  it('fires onClick and adds the go class for the primary variant', () => {
    const onClick = vi.fn();
    const { container } = render(<NTButton go onClick={onClick}>Copy</NTButton>);
    const btn = container.querySelector('button')!;
    expect(btn.classList.contains('ntd-btn--go')).toBe(true);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('is a plain beveled button without go', () => {
    const { container } = render(<NTButton>Plain</NTButton>);
    expect(container.querySelector('button')!.classList.contains('ntd-btn--go')).toBe(false);
  });
});

describe('NTField', () => {
  it('applies the status tone border class and forwards value', () => {
    const { container } = render(<NTField tone="error" value="bad" readOnly />);
    const input = container.querySelector('input')!;
    expect(input.classList.contains('ntd-field--error')).toBe(true);
    expect(input.value).toBe('bad');
  });
  it('defaults to idle tone', () => {
    const { container } = render(<NTField value="x" readOnly />);
    expect(container.querySelector('input')!.classList.contains('ntd-field--idle')).toBe(true);
  });
});
