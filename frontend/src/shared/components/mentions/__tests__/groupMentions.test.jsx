/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';

/**
 * Mentions in chats: a group feature.
 *
 * - In a direct chat "@" is plain text: no picker opens (it used to search
 *   every account on the platform).
 * - In a group the picker lists that group's members and @everyone, filtered
 *   in memory as you type, with no request at all.
 * - @everyone renders as a tag, but it is not a person: no profile to open.
 */
const searchSpy = vi.fn(() => ({ suggestions: [], loading: false }));
vi.mock('@shared/hooks/useMentionSuggestions', () => ({
  useMentionSuggestions: (args) => searchSpy(args),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@shared/hooks/useUsersMap', () => ({ useUsersMap: () => ({}) }));

// jsdom has no layout: the picker positions itself from the caret's box.
Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
Element.prototype.scrollIntoView = () => {};

const { default: MentionInput } = await import('../MentionInput');
const { default: RichText } = await import('../RichText');
const { filterLocalMentions, EVERYONE_MENTION } = await import('../localMentions');

afterEach(() => {
  cleanup();
  searchSpy.mockClear();
  navigate.mockReset();
});

const MEMBERS = [
  { id: 'u1', username: 'ana', displayName: 'Ana Rao' },
  { id: 'u2', username: 'ben', displayName: 'Ben Ali' },
  { id: 'u3', username: 'zara_k', displayName: 'Zara Kaur' },
];

function typeInto(editor, text) {
  editor.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(editor.firstChild || editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  fireEvent.input(editor);
}

describe('filterLocalMentions', () => {
  it('puts @everyone first while what is typed could be it, then name matches', () => {
    expect(filterLocalMentions(MEMBERS, '').map((m) => m.username)).toEqual(['everyone', 'ana', 'ben', 'zara_k']);
    expect(filterLocalMentions(MEMBERS, 'e').map((m) => m.username)).toEqual(['everyone', 'ben']);
    expect(filterLocalMentions(MEMBERS, 'ka').map((m) => m.username)).toEqual(['zara_k']);
    expect(filterLocalMentions(MEMBERS, 'xyz')).toEqual([]);
  });

  it('matches the start of any word of a name before a match inside one', () => {
    expect(filterLocalMentions(MEMBERS, 'ali').map((m) => m.username)).toEqual(['ben']);
    expect(filterLocalMentions(MEMBERS, 'a').map((m) => m.username)).toEqual(['ana', 'ben', 'zara_k']);
  });
});

describe('the chat composer', () => {
  it('opens no picker in a direct chat', () => {
    const { container } = render(<MentionInput value="" onChange={() => {}} mentionMode="off" />);
    typeInto(container.querySelector('[role="textbox"]'), 'hi @an');
    expect(screen.queryByText('Ana Rao')).toBeNull();
    expect(screen.queryByText('@everyone')).toBeNull();
    expect(searchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('lists the group\'s members and @everyone, without searching', () => {
    const { container } = render(
      <MentionInput value="" onChange={() => {}} mentionMode="local" mentionCandidates={MEMBERS} />,
    );
    typeInto(container.querySelector('[role="textbox"]'), 'hi @');
    expect(screen.getByText('@everyone')).toBeTruthy();
    expect(screen.getByText('Ana Rao')).toBeTruthy();
    expect(searchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('choosing @everyone tags it the way the server checks it', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MentionInput value="" onChange={onChange} mentionMode="local" mentionCandidates={MEMBERS} />,
    );
    typeInto(container.querySelector('[role="textbox"]'), 'hi @ev');
    fireEvent.click(screen.getByText('@everyone'));
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.text.startsWith('hi @everyone')).toBe(true);
    expect(last.mentions).toEqual([{ userId: EVERYONE_MENTION.id, username: 'everyone', start: 3, end: 12 }]);
  });
});

describe('@everyone in a message', () => {
  it('is marked like a mention but opens no profile', () => {
    const { container } = render(
      <RichText
        content="hi @everyone"
        mentions={[{ userId: 'everyone', username: 'everyone', start: 3, end: 12 }]}
        verifiedMentionsOnly
        mentionClassName="M"
      />,
    );
    const tag = container.querySelector('.M');
    expect(tag.textContent).toBe('@everyone');
    fireEvent.click(tag);
    expect(navigate).not.toHaveBeenCalled();
  });
});
