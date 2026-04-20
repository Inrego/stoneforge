/**
 * Tests for the platform-aware shell-quote helper.
 *
 * Pure string assertions — runnable on any host OS.
 */

import { describe, it, expect } from 'bun:test';
import { posixShellQuote, cmdShellQuote, shellQuote } from './shell-quote.js';

describe('posixShellQuote', () => {
  it('wraps plain strings in single quotes', () => {
    expect(posixShellQuote('claude')).toBe("'claude'");
  });

  it('escapes embedded single quotes via the \'\\\'\' idiom', () => {
    expect(posixShellQuote("it's")).toBe("'it'\\''s'");
  });

  it('quotes strings containing spaces without altering them', () => {
    expect(posixShellQuote('path with space')).toBe("'path with space'");
  });

  it('handles double quotes literally', () => {
    expect(posixShellQuote('has"quote')).toBe("'has\"quote'");
  });
});

describe('cmdShellQuote', () => {
  it('returns simple strings bare (no whitespace or specials)', () => {
    expect(cmdShellQuote('claude')).toBe('claude');
    expect(cmdShellQuote('--flag')).toBe('--flag');
    expect(cmdShellQuote('v1.2.3')).toBe('v1.2.3');
  });

  it('double-quotes strings containing spaces', () => {
    expect(cmdShellQuote('path with space')).toBe('"path with space"');
  });

  it('escapes embedded double quotes as backslash-quote', () => {
    expect(cmdShellQuote('has"quote')).toBe('"has\\"quote"');
  });

  it('doubles trailing backslashes before the closing quote', () => {
    // Input:  trailing\
    // Output: "trailing\\"  (raw: "trailing\\\\" in JS string literal)
    expect(cmdShellQuote('trailing\\')).toBe('"trailing\\\\"');
  });

  it('doubles backslashes immediately preceding an embedded quote', () => {
    // Input: a\"b — one backslash then a quote inside the arg
    // Per CRT rules: the \ gets doubled (→ \\) and the " gets escaped (→ \")
    expect(cmdShellQuote('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('quotes strings containing cmd.exe metacharacters', () => {
    expect(cmdShellQuote('a|b')).toBe('"a|b"');
    expect(cmdShellQuote('a&b')).toBe('"a&b"');
    expect(cmdShellQuote('a<b')).toBe('"a<b"');
    expect(cmdShellQuote('a>b')).toBe('"a>b"');
    expect(cmdShellQuote('a^b')).toBe('"a^b"');
    expect(cmdShellQuote('a%b')).toBe('"a%b"');
  });

  it('handles an empty string by producing an empty quoted pair', () => {
    expect(cmdShellQuote('')).toBe('""');
  });

  it('passes single quotes through bare — cmd.exe does not parse them', () => {
    // Single quotes are literal characters in cmd.exe, so "it's" is a valid
    // bare argument. No wrapping needed.
    expect(cmdShellQuote("it's")).toBe("it's");
  });

  it('never wraps in single quotes — the root-cause bug in issue #51', () => {
    // Regression guard: issue #51 reported `''claude''` because the old
    // POSIX quoter wrapped in single quotes that cmd.exe took literally.
    const out = cmdShellQuote('claude');
    expect(out.startsWith("'")).toBe(false);
    expect(out.endsWith("'")).toBe(false);
  });
});

describe('shellQuote dispatcher', () => {
  it('routes to cmd.exe form when platform is win32', () => {
    expect(shellQuote('claude', 'win32')).toBe('claude');
    expect(shellQuote('path with space', 'win32')).toBe('"path with space"');
  });

  it('routes to POSIX form when platform is linux', () => {
    expect(shellQuote('claude', 'linux')).toBe("'claude'");
  });

  it('routes to POSIX form when platform is darwin', () => {
    expect(shellQuote('claude', 'darwin')).toBe("'claude'");
  });

  it('defaults to the current process platform when no override is given', () => {
    const expected =
      process.platform === 'win32' ? cmdShellQuote('claude') : posixShellQuote('claude');
    expect(shellQuote('claude')).toBe(expected);
  });
});
