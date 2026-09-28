/**
 * Removes anything shaped like a tag from plain-text input.
 *
 * One pass is complete. `<[^>]*>?` matches from EVERY `<` it meets: the body
 * may itself contain `<`, and the closing `>` is optional, so no `<` survives
 * and no tag can be reassembled from what is left (`<scr<b>ipt>x` is "ipt>x").
 * Kept free of imports so the auth module can use it without loading
 * sanitize-html.
 */
export function stripTags(value: string): string {
  return value.replace(/<[^>]*>?/g, '');
}
