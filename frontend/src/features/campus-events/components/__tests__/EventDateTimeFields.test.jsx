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
  it('shows the same calendar and slot list on a touch screen, without raising the keyboard', () => {
    touchScreen();
    const onDate = vi.fn();
    const onTime = vi.fn();
    render(
      <>
        <EventDateField id="d" value="" onChange={onDate} />
        <EventTimeField id="t" value="" onChange={onTime} />
      </>,
    );

    // No native date/time inputs: the form looks the same as on desktop.
    expect(document.querySelector('input[type="date"], input[type="time"]')).toBeNull();

    // The time box only opens the list: read-only, so no soft keyboard.
    const time = document.getElementById('t');
    expect(time.readOnly).toBe(true);
    expect(time.getAttribute('inputmode')).toBe('none');
    fireEvent.click(time);
    fireEvent.click(screen.getByRole('option', { name: /6:15\s?PM/i }));
    expect(onTime).toHaveBeenCalledWith('18:15');

    fireEvent.click(document.getElementById('d'));
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeTruthy();
  });

  it('lets a mouse type a time', () => {
    render(<EventTimeField id="t" value="" onChange={vi.fn()} />);
    expect(document.getElementById('t').readOnly).toBe(false);
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
