/**
 * Platform-aware shell quoting for composing command strings that are passed
 * to a POSIX shell (bash) or Windows `cmd.exe`.
 *
 * @module
 */

/**
 * Quote for POSIX shells (bash, sh, zsh). Wraps in single quotes and escapes
 * embedded single quotes via the standard `'\''` idiom.
 */
export function posixShellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Quote for Windows `cmd.exe`.
 *
 * Single quotes are NOT a quoting mechanism in `cmd.exe` — they are literal
 * characters. The only reliable quoting is double quotes, following the
 * CreateProcess/CRT rules (see MS "Everyone quotes command line arguments
 * the wrong way"):
 *
 *   - 2n backslashes before `"`  → n backslashes, end-of-quote
 *   - 2n+1 backslashes before `"` → n backslashes, literal `"`
 *   - backslashes not followed by `"` → literal backslashes
 *   - trailing backslashes before the closing quote must be doubled
 *
 * Strings with no whitespace or special characters are returned bare.
 */
export function cmdShellQuote(s: string): string {
  if (s.length > 0 && !/[\s"\\&|<>^%!()]/.test(s)) return s;

  let result = '"';
  let i = 0;
  while (i < s.length) {
    let backslashes = 0;
    while (i < s.length && s[i] === '\\') {
      backslashes++;
      i++;
    }
    if (i === s.length) {
      result += '\\'.repeat(backslashes * 2);
    } else if (s[i] === '"') {
      result += '\\'.repeat(backslashes * 2) + '\\"';
      i++;
    } else {
      result += '\\'.repeat(backslashes) + s[i];
      i++;
    }
  }
  result += '"';
  return result;
}

/**
 * Platform-aware shell quoting. Defaults to the current process's platform
 * but accepts an explicit `platform` override so callers (and tests) can pin
 * the target shell.
 */
export function shellQuote(
  s: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? cmdShellQuote(s) : posixShellQuote(s);
}
