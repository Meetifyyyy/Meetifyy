/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RouteErrorScreen from '../RouteErrorScreen';
import { RouteErrorBoundary } from '../../ErrorBoundary';

const renderScreen = (props) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <RouteErrorScreen {...props} />
    </MemoryRouter>
  </QueryClientProvider>,
);

const root = document.documentElement;
const gradientVars = ['--bg-gradient-center', '--bg-gradient-mid', '--bg-gradient-edge'];

afterEach(() => {
  cleanup();
  gradientVars.forEach((name) => root.style.removeProperty(name));
  root.removeAttribute('data-theme');
});

describe('<RouteErrorScreen> on a public page', () => {
  it('covers the viewport and flattens the page gradient while it is up', () => {
    root.setAttribute('data-theme', 'light');
    renderScreen({ fullScreen: true });
    expect(screen.getByRole('alert').className).toMatch(/fullScreen/);
    gradientVars.forEach((name) => expect(root.style.getPropertyValue(name)).toBe('#ffffff'));
  });

  it('uses the dark surface in dark mode', () => {
    root.setAttribute('data-theme', 'dark');
    renderScreen({ fullScreen: true });
    gradientVars.forEach((name) => expect(root.style.getPropertyValue(name)).toBe('#000000'));
  });

  it('puts the page gradient back when it goes away', () => {
    root.setAttribute('data-theme', 'light');
    root.style.setProperty('--bg-gradient-edge', '#d1e3f8');
    const view = renderScreen({ fullScreen: true });
    view.unmount();
    expect(root.style.getPropertyValue('--bg-gradient-edge')).toBe('#d1e3f8');
    expect(root.style.getPropertyValue('--bg-gradient-mid')).toBe('');
  });

  it('leaves every other screen as the contained card, gradient untouched', () => {
    root.setAttribute('data-theme', 'light');
    renderScreen({});
    expect(screen.getByRole('alert').className).not.toMatch(/fullScreen/);
    gradientVars.forEach((name) => expect(root.style.getPropertyValue(name)).toBe(''));
  });
});

describe('<RouteErrorBoundary> on a public page', () => {
  const Crash = () => { throw new Error('boom'); };

  it('hands fullScreen to the screen it shows when the page crashes', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    root.setAttribute('data-theme', 'light');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <RouteErrorBoundary fullScreen><Crash /></RouteErrorBoundary>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert').className).toMatch(/fullScreen/);
    quiet.mockRestore();
  });
});
