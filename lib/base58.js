/**
 * Solana address validation, shared by the two endpoints that accept one.
 *
 * WHY A REGEX IS NOT ENOUGH
 *
 * `^[1-9A-HJ-NP-Za-km-z]{32,44}$` is the obvious check and it is wrong. A
 * Solana pubkey is exactly 32 BYTES, and base58 is not one character per byte:
 * 32 bytes encode to somewhere between 32 and 44 characters depending on the
 * leading digits. So the regex accepts a large family of strings that are the
 * right length and the wrong size.
 *
 * Measured against the live RPC: `"1" x 43 + "2"` is 44 valid base58 characters
 * and the node answers `Invalid param: WrongSize`. It is not an address at all.
 *
 * That matters here more than it looks. The contract address is what people
 * copy before they trade, and the failure mode of a wrong-but-plausible CA is a
 * pump.fun link that 404s — or, worse, someone else's token. The database CHECK
 * constraint is the same regex and cannot be tightened (PostgreSQL has no
 * base58 decode), so this is where the real gate lives; the constraint stays as
 * a cheap backstop on the character set.
 */

/** The base58 alphabet: no 0, O, I or l, which is the point of it. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX = new Map([...ALPHABET].map((ch, i) => [ch, i]));

/**
 * Decode base58 to bytes, or null if the string is not base58.
 *
 * Long division in base 256: for each character, multiply the accumulator by 58
 * and add the digit. `bytes` is kept little-endian because that is the order the
 * carry propagates, and reversed at the end.
 *
 * Written out rather than taken from a package because the whole project is
 * zero-dependency and this is 20 lines.
 */
function decode(str) {
  if (typeof str !== "string" || str.length === 0) return null;

  /* Leading '1' characters are leading zero BYTES, and they carry no
     information through the multiply-add — so they are counted and prepended. */
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  const bytes = [];
  for (let i = zeros; i < str.length; i++) {
    const v = INDEX.get(str[i]);
    if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }

  /* Drop the high zero bytes the integer part produced. Without this, a value
     whose top byte happens to be zero decodes one byte too long. */
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}

/**
 * True when `str` is a well-formed Solana address: base58, decoding to exactly
 * 32 bytes. This is the check both endpoints should use.
 */
function isValidAddress(str) {
  const bytes = decode(str);
  return bytes !== null && bytes.length === 32;
}

/**
 * Why an address was rejected, in words the operator can act on. Returns null
 * when it is valid.
 *
 * A single "invalid" message makes a mistyped character and a truncated paste
 * look identical, and they need different fixes.
 */
function addressProblem(str) {
  const s = typeof str === "string" ? str.trim() : "";
  if (!s) return "no address given";

  const bad = [...s].filter((ch) => !INDEX.has(ch));
  if (bad.length) {
    /* 0, O, I and l are the characters people transpose, so name them. */
    const notorious = bad.filter((ch) => "0OIl".includes(ch));
    return notorious.length
      ? `contains ${[...new Set(notorious)].map((c) => `"${c}"`).join(", ")}, which base58 excludes ` +
        `(0/O and I/l are left out because they are the ones people misread)`
      : `contains characters that are not base58 (${[...new Set(bad)].slice(0, 6).join("")})`;
  }

  const bytes = decode(s);
  if (!bytes) return "not valid base58";
  if (bytes.length !== 32) {
    return `${bytes.length} bytes when decoded, but a Solana address is exactly 32 ` +
           `(this string is ${s.length} characters, which is a plausible length and the wrong size)`;
  }
  return null;
}

export { isValidAddress, addressProblem, decode };
