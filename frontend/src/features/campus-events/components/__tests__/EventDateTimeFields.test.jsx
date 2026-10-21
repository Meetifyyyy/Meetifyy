/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventDateField, EventTimeField } from '../EventDateTimeFields';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const touchScreen = () =>
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query.includes('coarse'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

describe('EventDateTimeFields', () => {
  it('uses the platform pickers on a touch screen, with the same value shapes', () => {
    touchScreen();
    const onDate = vi.fn();
    const onTime = vi.fn();
    render(
      <>
        <EventDateField id="d" value="2026-10-23" min="2026-10-22" onChange={onDate} />
        <EventTimeField id="t" value="09:30" onChange={onTime} />
      </>,
    );

    const date = document.getElementById('d');
    const time = document.getElementById('t');
    expect(date.type).toBe('date');
    expect(date.min).toBe('2026-10-22');
    expect(time.type).toBe('time');

    fireEvent.change(date, { target: { value: '2026-10-25' } });
    fireEvent.change(time, { target: { value: '18:15' } });
    expect(onDate).toHaveBeenCalledWith('2026-10-25');
    expect(onTime).toHaveBeenCalledWith('18:15');
  });

  it('with a mouse, a typed time is committed on blur and junk is dropped', () => {
    const onTime = vi.fn();
    render(<EventTimeField id="t" value="" onChange={onTime} />);
    const box = document.getElementById('t');

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '7:45pm' } });
    fireEvent.blur(box, { relatedTarget: document.body });
    expect(onTime).toHaveBeenLastCalledWith('19:45');

    onTime.mockClear();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'soon' } });
    fireEvent.blur(box, { relatedTarget: document.body });
    expect(onTime).not.toHaveBeenCalled();
  });

  it('with a mouse, a past day cannot be picked', () => {
    render(<EventDateField id="d" value="" min="2026-10-22" onChange={vi.fn()} />);
    fireEvent.click(document.getElementById('d'));
    const day = screen.getByRole('button', { name: /October 21, 2026/ });
    expect(day.disabled).toBe(true);
  });
});
