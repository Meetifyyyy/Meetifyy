/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';

import { installLinkPressGuard } from '../installLinkPressGuard';

/**
 * Holding a link in the app lifts a draggable preview box. The guard cancels the
 * long press's contextmenu and the drag for links, and must leave editing alone.
 */
function fire(el, type) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('installLinkPressGuard', () => {
  let remove;
  afterEach(() => { remove?.(); document.body.innerHTML = ''; });

  const mount = (html) => {
    document.body.innerHTML = html;
    remove = installLinkPressGuard(document);
  };

  it('cancels the context menu and drag on a link, and on its children', () => {
    mount('<a href="/profile/x"><span id="name">x</span><img id="av" src="a.png"></a>');
    expect(fire(document.querySelector('a'), 'contextmenu')).toBe(true);
    expect(fire(document.getElementById('name'), 'contextmenu')).toBe(true);
    expect(fire(document.getElementById('av'), 'dragstart')).toBe(true);
    expect(fire(document.querySelector('a'), 'dragstart')).toBe(true);
  });

  it('leaves text outside links alone', () => {
    mount('<p id="t">hello</p><a>no href</a>');
    expect(fire(document.getElementById('t'), 'contextmenu')).toBe(false);
    expect(fire(document.querySelector('a'), 'contextmenu')).toBe(false);
  });

  it('leaves editable fields alone, even inside a link', () => {
    mount('<a href="/x"><input id="i"><textarea id="ta"></textarea><div id="ce" contenteditable="true"><b id="b">x</b></div></a>');
    for (const id of ['i', 'ta', 'ce', 'b']) {
      expect(fire(document.getElementById(id), 'contextmenu')).toBe(false);
      expect(fire(document.getElementById(id), 'dragstart')).toBe(false);
    }
  });

  it('does not stop propagation, so the app\'s own long-press menus still run', () => {
    mount('<div id="msg"><a href="/x" id="l">link</a></div>');
    let seen = false;
    document.getElementById('msg').addEventListener('contextmenu', () => { seen = true; });
    fire(document.getElementById('l'), 'contextmenu');
    expect(seen).toBe(true);
  });

  it('removes its listeners', () => {
    mount('<a href="/x" id="l">x</a>');
    remove();
    remove = undefined;
    expect(fire(document.getElementById('l'), 'contextmenu')).toBe(false);
  });
});
