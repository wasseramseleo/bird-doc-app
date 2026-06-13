/**
 * Derives a Beringer's Kürzel: first letter of the first name + first two
 * letters of the surname (Filip Reiter -> FRE), folded to ASCII.
 *
 * Mirrors the backend derivation (birds/kuerzel.py) so the inline-creation
 * dialog can auto-fill the Kürzel live while the field is still empty.
 */
function foldToAscii(value: string): string {
  return value
    .replace(/ß/g, 'ss')
    .replace(/ẞ/g, 'SS')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function deriveHandle(firstName: string, lastName: string): string {
  const first = foldToAscii(firstName.trim());
  const last = foldToAscii(lastName.trim());
  return (first.slice(0, 1) + last.slice(0, 2)).toUpperCase();
}
