/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { capturePostCard } from '../cardCapture';

vi.mock('html2canvas', () => {
  return {
    default: vi.fn(),
  };
});

import html2canvas from 'html2canvas';

describe('capturePostCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no element is provided', async () => {
    const result = await capturePostCard(null);
    expect(result).toBeNull();
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it('captures the element into a transparent image/png File', async () => {
    const mockBlob = new Blob(['mock-image-data'], { type: 'image/png' });
    const mockCanvas = {
      toBlob: vi.fn((callback) => callback(mockBlob)),
    };
    html2canvas.mockResolvedValue(mockCanvas);

    const div = document.createElement('div');
    div.className = 'post';
    document.body.appendChild(div);

    const file = await capturePostCard(div, 'test-story.jpg');

    expect(html2canvas).toHaveBeenCalledWith(
      div,
      expect.objectContaining({
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
      }),
    );
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test-story.png');
    expect(file.type).toBe('image/png');

    document.body.removeChild(div);
  });

  it('returns null if html2canvas fails or throws', async () => {
    html2canvas.mockRejectedValue(new Error('Canvas rendering error'));

    const div = document.createElement('div');
    const file = await capturePostCard(div);

    expect(file).toBeNull();
  });

  it('returns null if toBlob returns empty or null', async () => {
    const mockCanvas = {
      toBlob: vi.fn((callback) => callback(null)),
    };
    html2canvas.mockResolvedValue(mockCanvas);

    const div = document.createElement('div');
    const file = await capturePostCard(div);

    expect(file).toBeNull();
  });
});
