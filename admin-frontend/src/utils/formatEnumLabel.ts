/** Human-readable interface labels for enum values; never use on user/document text. */
export function formatEnumLabel(value?: string | null): string {
  const label = (value ?? '').replace(/_/g, ' ').toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}
