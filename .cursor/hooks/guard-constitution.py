#!/usr/bin/env python3
"""Block agent edits that introduce constitution violations in tests/ and pages/."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

JS_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx"}
SPEC_NAME = re.compile(r"^.+\.(spec|test)\.(ts|tsx|js|jsx)$")

XPATH_LOCATOR = re.compile(r"""locator\s*\(\s*['"]//""")
ANY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r":\s*any\b"), ": any"),
    (re.compile(r"\bas\s+any\b"), "as any"),
    (re.compile(r"<any>"), "<any>"),
    (re.compile(r"Array<any>"), "Array<any>"),
)
FILL_LITERAL_EMAIL = re.compile(r"""\.fill\s*\(\s*['"][^'"]*@[^'"]*['"]""")
CREDENTIAL_LITERAL = re.compile(
    r"""(?i)(password|secret|api_key|token)\s*[:=]\s*['"][^'"]{4,}['"]"""
)
DESCRIBE_TAG = re.compile(r"test\.describe\s*\([\s\S]*?\{\s*tag\s*:", re.MULTILINE)
WAIT_FOR_TIMEOUT = ".waitForTimeout("


def eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def load_input() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        eprint("guard-constitution: empty stdin")
        sys.exit(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        eprint(f"guard-constitution: invalid JSON — {exc}")
        sys.exit(1)
    if not isinstance(data, dict):
        eprint("guard-constitution: hook payload must be a JSON object")
        sys.exit(1)
    return data


def normalize_path(file_path: str) -> str:
    return file_path.replace("\\", "/")


def is_guarded_path(file_path: str) -> bool:
    path = Path(normalize_path(file_path))
    if not path.parts or path.parts[0] not in ("tests", "pages"):
        return False
    return path.suffix.lower() in JS_EXTENSIONS


def is_spec_file(file_path: str) -> bool:
    return SPEC_NAME.match(Path(normalize_path(file_path)).name) is not None


def active_code(content: str) -> str:
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        code = line
        if "//" in line:
            code = line[: line.index("//")]
        lines.append(code)
    return "\n".join(lines)


def count_active_expects(content: str) -> int:
    return active_code(content).count("expect(")


def count_matches(pattern: re.Pattern[str], content: str) -> int:
    return len(pattern.findall(active_code(content)))


def count_substring(sub: str, content: str) -> int:
    return active_code(content).count(sub)


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


def reasons_from_diff(before: str, after: str, is_spec: bool) -> list[str]:
    reasons: list[str] = []
    before_active = active_code(before)
    after_active = active_code(after)

    if count_substring(WAIT_FOR_TIMEOUT, after) > count_substring(WAIT_FOR_TIMEOUT, before):
        reasons.append("introduced .waitForTimeout(")

    if count_matches(XPATH_LOCATOR, after) > count_matches(XPATH_LOCATOR, before):
        reasons.append("introduced XPath locator locator('//…')")

    for pattern, label in ANY_PATTERNS:
        if len(pattern.findall(after_active)) > len(pattern.findall(before_active)):
            reasons.append(f"introduced `{label}`")

    if count_matches(FILL_LITERAL_EMAIL, after) > count_matches(FILL_LITERAL_EMAIL, before):
        reasons.append("introduced hardcoded email in .fill('…@…')")

    if count_matches(CREDENTIAL_LITERAL, after) > count_matches(CREDENTIAL_LITERAL, before):
        reasons.append(
            "introduced hardcoded password/secret/api_key/token literal (4+ characters)"
        )

    if count_matches(DESCRIBE_TAG, after) > count_matches(DESCRIBE_TAG, before):
        reasons.append("introduced tag on test.describe(…, { tag: … })")

    if is_spec:
        before_expects = count_active_expects(before)
        after_expects = count_active_expects(after)
        if before_expects > after_expects:
            reasons.append(
                f"weakened assertions — active expect( count {before_expects} -> {after_expects}"
            )

    return reasons


def pattern_in_chunk(pattern: re.Pattern[str], chunk: str) -> bool:
    return bool(pattern.search(active_code(chunk)))


def substring_in_chunk(sub: str, chunk: str) -> bool:
    return sub in active_code(chunk)


def reasons_from_edit_chunk(old: str, new: str, is_spec: bool) -> list[str]:
    reasons: list[str] = []
    old_active = active_code(old)
    new_active = active_code(new)

    if substring_in_chunk(WAIT_FOR_TIMEOUT, new) and not substring_in_chunk(
        WAIT_FOR_TIMEOUT, old
    ):
        reasons.append("introduced .waitForTimeout(")

    if pattern_in_chunk(XPATH_LOCATOR, new) and not pattern_in_chunk(XPATH_LOCATOR, old):
        reasons.append("introduced XPath locator locator('//…')")

    for pattern, label in ANY_PATTERNS:
        if pattern.search(new_active) and not pattern.search(old_active):
            reasons.append(f"introduced `{label}`")

    if pattern_in_chunk(FILL_LITERAL_EMAIL, new) and not pattern_in_chunk(
        FILL_LITERAL_EMAIL, old
    ):
        reasons.append("introduced hardcoded email in .fill('…@…')")

    if pattern_in_chunk(CREDENTIAL_LITERAL, new) and not pattern_in_chunk(
        CREDENTIAL_LITERAL, old
    ):
        reasons.append(
            "introduced hardcoded password/secret/api_key/token literal (4+ characters)"
        )

    if pattern_in_chunk(DESCRIBE_TAG, new) and not pattern_in_chunk(DESCRIBE_TAG, old):
        reasons.append("introduced tag on test.describe(…, { tag: … })")

    if is_spec:
        old_expects = count_active_expects(old)
        new_expects = count_active_expects(new)
        if new_expects < old_expects:
            reasons.append(
                f"weakened assertions — active expect( count {old_expects} -> {new_expects}"
            )

    return reasons


def reasons_fallback(edits: list[dict], is_spec: bool) -> list[str]:
    reasons: list[str] = []
    for edit in edits:
        if not isinstance(edit, dict):
            continue
        old_string = edit.get("old_string")
        new_string = edit.get("new_string")
        if not isinstance(old_string, str) or not isinstance(new_string, str):
            continue
        reasons.extend(reasons_from_edit_chunk(old_string, new_string, is_spec))
    return dedupe(reasons)


def dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def block(file_path: str, reasons: list[str]) -> None:
    detail = "; ".join(reasons)
    message = f"Blocked: constitution violation in {file_path} — {detail}"
    payload = {"user_message": message, "agent_message": message}
    sys.stdout.write(json.dumps(payload))
    eprint(message)
    sys.exit(2)


def main() -> None:
    payload = load_input()
    file_path = payload.get("file_path")
    edits = payload.get("edits")

    if not isinstance(file_path, str) or not file_path:
        eprint("guard-constitution: missing or invalid file_path")
        sys.exit(1)
    if edits is None:
        edits = []
    if not isinstance(edits, list):
        eprint("guard-constitution: edits must be an array")
        sys.exit(1)

    if not is_guarded_path(file_path):
        sys.exit(0)

    path = Path(file_path)
    if not path.is_file():
        eprint(f"guard-constitution: file not found — {file_path}")
        sys.exit(1)

    after_content = path.read_text(encoding="utf-8")
    is_spec = is_spec_file(file_path)
    before_content = reconstruct_before(after_content, edits)

    if before_content is not None:
        reasons = reasons_from_diff(before_content, after_content, is_spec)
    else:
        reasons = reasons_fallback(edits, is_spec)

    if reasons:
        block(file_path, dedupe(reasons))

    eprint(f"guard-constitution: OK — {file_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
