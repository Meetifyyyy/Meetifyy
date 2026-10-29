/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RsvpButtons from '../RsvpButtons';

afterEach(cleanup);

const inBtn = () => screen.getByRole('button', { name: /I'm in/ });
const outBtn = () => screen.getByRole('button', { name: /I'm out/ });

describe('RsvpButtons', () => {
  it('shows no answer as neither pressed', () => {
    render(<RsvpButtons value={null} onChange={vi.fn()} />);
    expect(inBtn().getAttribute('aria-pressed')).toBe('false');
    expect(outBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the current answer as pressed', () => {
    const { rerender } = render(<RsvpButtons value="in" onChange={vi.fn()} />);
    expect(inBtn().getAttribute('aria-pressed')).toBe('true');
    expect(outBtn().getAttribute('aria-pressed')).toBe('false');

    rerender(<RsvpButtons value="out" onChange={vi.fn()} />);
    expect(inBtn().getAttribute('aria-pressed')).toBe('false');
    expect(outBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('sends the other answer, and nothing for the one already chosen', () => {
    const onChange = vi.fn();
    render(<RsvpButtons value="in" onChange={onChange} />);
    fireEvent.click(inBtn());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(outBtn());
    expect(onChange).toHaveBeenCalledWith('out');
  });

  it('disables both while an answer is being sent', () => {
    const onChange = vi.fn();
    render(<RsvpButtons value={null} onChange={onChange} busy />);
    expect(inBtn().disabled).toBe(true);
    expect(outBtn().disabled).toBe(true);
    fireEvent.click(outBtn());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can refuse "I\'m in" (full activity) while still offering "I\'m out"', () => {
    render(<RsvpButtons value="out" onChange={vi.fn()} joinDisabled joinLabel="Activity Full" />);
    expect(screen.getByRole('button', { name: /Activity Full/ }).disabled).toBe(true);
    expect(outBtn().disabled).toBe(false);
  });

  it('draws both with the same 3D thumbs image, the out one turned over', () => {
    const { container } = render(<RsvpButtons value={null} onChange={vi.fn()} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect([...imgs].map((i) => i.getAttribute('src'))).toEqual(['/thumbs_up_3d.png', '/thumbs_up_3d.png']);
    expect(imgs[1].className).not.toBe(imgs[0].className);
  });
});
