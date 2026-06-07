import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { StatusTag } from './StatusTag';

afterEach(cleanup);

describe('StatusTag', () => {
  it('renders the label and a live tone for a live state', () => {
    const { container } = render(<StatusTag state="live" label="On Air" />);
    expect(screen.getByText('On Air')).toBeTruthy();
    const tag = container.querySelector('.ntd-tag')!;
    expect(tag.classList.contains('ntd-tag--live')).toBe(true);
    expect(tag.getAttribute('data-tone')).toBe('live');
  });

  it('falls back to the raw state as label and maps error→error tone', () => {
    const { container } = render(<StatusTag state="error" />);
    expect(screen.getByText('error')).toBeTruthy();
    const tag = container.querySelector('.ntd-tag')!;
    expect(tag.classList.contains('ntd-tag--error')).toBe(true);
  });

  it('maps connecting→warn tone', () => {
    const { container } = render(<StatusTag state="connecting" label="Connecting" />);
    expect(container.querySelector('.ntd-tag')!.classList.contains('ntd-tag--warn')).toBe(true);
  });
});
