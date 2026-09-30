/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CalendarIcon from '../CalendarIcon';

afterEach(cleanup);

describe('calendar month casing', () => {
  it('supports sentence case for notification badges', () => {
    render(<CalendarIcon date="2026-10-01T12:00:00Z" size="badge" sentenceCaseMonth />);
    expect(screen.getByText('Oct').style.textTransform).toBe('none');
    expect(screen.queryByText('OCT')).toBeNull();
  });

  it('preserves uppercase months elsewhere', () => {
    render(<CalendarIcon date="2026-10-01T12:00:00Z" size="badge" />);
    expect(screen.getByText('OCT')).toBeTruthy();
  });
});
