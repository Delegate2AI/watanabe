
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An address, which is what the directory exists to stop rendering. */
function isAddress(value: string): boolean {
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

export function looksLikeOpaqueId(value: string, email?: string): boolean {
  const name = value.trim();
  if (!name) return true;
  if (isAddress(name)) return true;
  if (email && name.toLowerCase() === email.trim().toLowerCase()) return true;
  // Whitespace means someone wrote it for a human to read. Keep it.
  if (/\s/.test(name)) return false;
  if (/^\d+$/.test(name)) return true;
  if (UUID.test(name)) return true;
  // One long unbroken token mixing letters and digits, with none of the
  // punctuation a written name uses: an identifier, not a name.
  return name.length >= 8 && /\d/.test(name) && /[a-z]/i.test(name) && !/[.\-_']/.test(name);
}
