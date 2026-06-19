/**
 * Jest globalSetup — fail fast if any test file contains focused tests
 * (`it.only`, `test.only`, `describe.only`).
 *
 * Replaces Jest's removed `--forbidOnly` flag (Jest 30+).
 *
 * Runs once at the start of the suite. If any focused test is detected,
 * it throws with a clear message pointing at every offending file and
 * line, so the offending `.only(` is impossible to miss in CI output.
 *
 * Limitations:
 * - Only checks static source. A `.only` constructed at runtime
 *   (e.g. `tests[Symbol.iterator]`) would slip through, but in practice
 *   the day-to-day footgun is leaving a stray `.only(` after debugging.
 * - Line comments (`//`) are stripped before matching. Block comments
 *   are not — keep that in mind if documenting focused tests in a block.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = join(projectRoot, "tests");

// `it.only(`, `test.only(`, `describe.only(`
// Word boundary on the left avoids matching helpers like `xit.only(`.
const FOCUSED_PATTERN = /\b(?:it|test|describe)\.only\s*\(/;

const TEST_FILE = /\.(test|spec)\.[mc]?[jt]sx?$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (TEST_FILE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

export default function noFocusedTests() {
  const files = walk(testsRoot);
  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      // Strip line comments to avoid false positives
      const code = line.replace(/\/\/.*$/, "");
      if (FOCUSED_PATTERN.test(code)) {
        violations.push(`  ${relative(projectRoot, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  if (violations.length > 0) {
    throw new Error(
      [
        "Refusing to run: focused tests detected (`.only(`).",
        "Remove every `.only(` before running the suite:",
        ...violations,
      ].join("\n"),
    );
  }
}
