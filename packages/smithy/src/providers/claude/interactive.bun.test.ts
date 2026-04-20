/**
 * Claude Interactive Provider Tests
 *
 * Tests for the ClaudeInteractiveProvider model passthrough functionality.
 */

import { describe, it, expect } from 'bun:test';
import type { InteractiveSpawnOptions } from '../types.js';
import { posixShellQuote, shellQuote as platformShellQuote } from '../shell-quote.js';

/**
 * For these buildArgs assertions we pin to the POSIX form so expectations are
 * deterministic regardless of the host OS that runs the test. A separate
 * suite below exercises the Windows quoter directly.
 */
const shellQuote = posixShellQuote;

/**
 * Simulates the buildArgs() method from ClaudeInteractiveProvider.
 * This allows us to test the argument building logic without spawning a real PTY.
 */
function buildArgs(options: InteractiveSpawnOptions, sessionId: string): string[] {
  const args: string[] = [
    '--dangerously-skip-permissions',
  ];

  if (options.resumeSessionId) {
    args.push('--resume', shellQuote(options.resumeSessionId));
  } else {
    args.push('--session-id', shellQuote(sessionId));
  }

  // Pass model if specified
  if (options.model) {
    args.push('--model', shellQuote(options.model));
  }

  return args;
}

describe('ClaudeInteractiveProvider', () => {
  describe('buildArgs() model passthrough', () => {
    it('should include --model flag when model is provided', () => {
      const options: InteractiveSpawnOptions = {
        workingDirectory: '/test/dir',
        model: 'claude-sonnet-4-20250514',
      };

      const args = buildArgs(options, 'new-session-id');

      expect(args).toContain('--model');
      expect(args).toContain("'claude-sonnet-4-20250514'");
    });

    it('should not include --model flag when model is not provided', () => {
      const options: InteractiveSpawnOptions = {
        workingDirectory: '/test/dir',
        // model is undefined
      };

      const args = buildArgs(options, 'new-session-id');

      expect(args).not.toContain('--model');
    });

    it('should include both --model and --session-id for new sessions', () => {
      const options: InteractiveSpawnOptions = {
        workingDirectory: '/test/dir',
        model: 'claude-opus-4-20250514',
      };

      const args = buildArgs(options, 'abc-123');

      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--session-id');
      expect(args).toContain("'abc-123'");
      expect(args).toContain('--model');
      expect(args).toContain("'claude-opus-4-20250514'");
    });

    it('should include both --model and --resume for resumed sessions', () => {
      const options: InteractiveSpawnOptions = {
        workingDirectory: '/test/dir',
        model: 'claude-sonnet-4-20250514',
        resumeSessionId: 'existing-session-456',
      };

      const args = buildArgs(options, 'ignored-session-id');

      expect(args).toContain('--resume');
      expect(args).toContain("'existing-session-456'");
      expect(args).toContain('--model');
      expect(args).toContain("'claude-sonnet-4-20250514'");
      expect(args).not.toContain('--session-id');
    });

    it('should properly quote model names with special characters', () => {
      const options: InteractiveSpawnOptions = {
        workingDirectory: '/test/dir',
        model: "model-with-'quotes",
      };

      const args = buildArgs(options, 'session-id');

      // shellQuote handles quotes by escaping them
      const modelIndex = args.indexOf('--model');
      expect(modelIndex).toBeGreaterThan(-1);
      const modelValue = args[modelIndex + 1];
      expect(modelValue).toBe("'model-with-'\\''quotes'");
    });
  });

  describe('provider setup', () => {
    it('should have correct provider name', async () => {
      const { ClaudeInteractiveProvider } = await import('./interactive.js');
      const provider = new ClaudeInteractiveProvider();
      expect(provider.name).toBe('claude-interactive');
    });

    it('should accept custom executable path', async () => {
      const { ClaudeInteractiveProvider } = await import('./interactive.js');
      const provider = new ClaudeInteractiveProvider('/custom/path/claude');
      expect(provider.name).toBe('claude-interactive');
    });
  });

  describe('Windows quoting (issue #51)', () => {
    it('quotes the executable with double quotes on win32, not single quotes', () => {
      // Regression guard: on Windows, shellQuote must never wrap the command
      // in single quotes (cmd.exe treats `'` as a literal character and the
      // old POSIX quoter produced `''claude''` failures).
      expect(platformShellQuote('claude', 'win32')).toBe('claude');
      expect(platformShellQuote('path with space', 'win32')).toBe('"path with space"');
    });

    it('routes to POSIX form on linux/darwin', () => {
      expect(platformShellQuote('claude', 'linux')).toBe("'claude'");
      expect(platformShellQuote('claude', 'darwin')).toBe("'claude'");
    });
  });
});
