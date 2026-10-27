#!/usr/bin/env python3
"""Block agent edits that reduce active expect() calls in Playwright test files."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

GUARDED_NAME = re.compile(r"^.+\.(spec|test)\.(ts|tsx|js|jsx)$")


def eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def load_input() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        eprint("guard-test-assertions: empty stdin")
        sys.exit(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        eprint(f"guard-test-assertions: invalid JSON — {exc}")
        sys.exit(1)
    if not isinstance(data, dict):
        eprint("guard-test-assertions: hook payload must be a JSON object")
        sys.exit(1)
    return data


def normalize_path(file_path: str) -> str:
    return file_path.replace("\\", "/")


def is_guarded_path(file_path: str) -> bool:
    path = Path(normalize_path(file_path))
    if not path.parts or path.parts[0] != "tests":
        return False
    return GUARDED_NAME.match(path.name) is not None


def count_active_expects(content: str) -> int:
    total = 0
    for line in content.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        code = line
        if "//" in line:
            code = line[: line.index("//")]
        total += code.count("expect(")
    return total


def reconstruct_before(after_content: str, edits: list[dict]) -> str | None:
    content = after_content
    for edit in reversed(edits):
        if not isinstance(edit, dict):
            return None
        old_string = edit.get("old_string")
        new_string = edit.get("new_string")
        if not isinstance(old_string, str) or not isinstance(new_string, str):
            return None
        if new_string not in content:
            return None
        content = content.replace(new_string, old_string, 1)
    return content


def fallback_before_count(after_content: str, edits: list[dict]) -> int | None:
    after_count = count_active_expects(after_content)
    delta = 0
    for edit in edits:
        if not isinstance(edit, dict):
            return None
        old_string = edit.get("old_string")
        new_string = edit.get("new_string")
        if not isinstance(old_string, str) or not isinstance(new_string, str):
            return None
        delta += count_active_expects(old_string) - count_active_expects(new_string)
    return after_count + delta


def block(file_path: str, before_count: int, after_count: int) -> None:
    message = (
        f"Blocked: test assertions weakened in {file_path} — active expect( "
        f"count {before_count} -> {after_count}. Do not delete or comment out "
        f"assertions to make tests pass. Fix the app, locator, or test data instead."
    )
    payload = {"user_message": message, "agent_message": message}
    sys.stdout.write(json.dumps(payload))
    eprint(message)
    sys.exit(2)


def main() -> None:
    payload = load_input()
    file_path = payload.get("file_path")
    edits = payload.get("edits")

    if not isinstance(file_path, str) or not file_path:
        eprint("guard-test-assertions: missing or invalid file_path")
        sys.exit(1)
    if edits is None:
        edits = []
    if not isinstance(edits, list):
        eprint("guard-test-assertions: edits must be an array")
        sys.exit(1)

    if not is_guarded_path(file_path):
        sys.exit(0)

    path = Path(file_path)
    if not path.is_file():
        eprint(f"guard-test-assertions: file not found — {file_path}")
        sys.exit(1)

    after_content = path.read_text(encoding="utf-8")
    after_count = count_active_expects(after_content)

    before_content = reconstruct_before(after_content, edits)
    if before_content is not None:
        before_count = count_active_expects(before_content)
    else:
        fallback = fallback_before_count(after_content, edits)
        if fallback is None:
            eprint("guard-test-assertions: could not determine before-edit expect count")
            sys.exit(1)
        before_count = fallback

    if before_count > after_count:
        block(file_path, before_count, after_count)

    eprint(f"guard-test-assertions: OK — {after_count} active expect( preserved")
    sys.exit(0)


if __name__ == "__main__":
    main()
