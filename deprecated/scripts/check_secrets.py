#!/usr/bin/env python3
"""
Lightweight pre-deploy secrets check for RecallBridge.

Scans source files for tokens that look like Twilio credentials, X_RB_KEY literals,
or long base64-ish blobs. Exits nonzero when potential secrets are found so you can
fix before copy/paste deploys.
"""

import argparse
import os
import re
from pathlib import Path
from typing import Iterable, List, Tuple

# Directories/files to skip to keep noise and PII exposure low.
SKIP_DIRS = {
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    ".idea",
    ".vscode",
    "Send Lists",
}
SKIP_FILES = {".env", ".env.local"}

# Only scan common text/code extensions.
ALLOWED_EXTS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".json",
    ".md",
    ".mdx",
    ".sh",
    ".txt",
    ".gs",
    ".gsx",
    ".yaml",
    ".yml",
}

Pattern = Tuple[str, re.Pattern, str]
PATTERNS: List[Pattern] = [
    ("twilio_account_sid", re.compile(r"AC[0-9a-fA-F]{32}"), "Possible Twilio Account SID"),
    ("twilio_api_key", re.compile(r"SK[0-9a-fA-F]{32}"), "Possible Twilio API Key"),
    (
        "twilio_auth_token_literal",
        re.compile(r"TWILIO_AUTH_TOKEN\s*[:=]\s*['\"]([A-Za-z0-9]{24,})['\"]", re.IGNORECASE),
        "Possible Twilio auth token literal",
    ),
    (
        "x_rb_key_literal",
        re.compile(r"X[_-]?RB[_-]?KEY\s*[:=]\s*['\"]([A-Za-z0-9]{8,})['\"]", re.IGNORECASE),
        "X_RB_KEY hardcoded in source",
    ),
    (
        "base64_like",
        re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/])"),
        "Long base64-like token",
    ),
]


def mask(token: str) -> str:
    if len(token) <= 12:
        return token
    return f"{token[:4]}...{token[-4:]}"


def looks_like_base64(token: str) -> bool:
    return any(c.islower() for c in token) and any(c.isupper() for c in token) and any(
        c.isdigit() for c in token
    )


def iter_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_dir():
            if path.name in SKIP_DIRS:
                continue
            # Skip anything nested under a skipped directory name.
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            continue
        if path.name in SKIP_FILES:
            continue
        if path.suffix not in ALLOWED_EXTS:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                continue
        except OSError:
            continue
        yield path


def scan_file(path: Path) -> List[Tuple[str, int, str, str]]:
    findings = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return findings

    for lineno, line in enumerate(text.splitlines(), start=1):
        for key, regex, desc in PATTERNS:
            for match in regex.finditer(line):
                token = match.group(1) if match.groups() else match.group(0)
                if key == "base64_like":
                    if "http" in line.lower():
                        continue
                    if len(token) < 48 or not looks_like_base64(token):
                        continue
                findings.append((str(path), lineno, desc, mask(token)))
    return findings


def main():
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Scan for secrets before deploy.")
    parser.add_argument("--root", default=str(default_root), help="Root directory to scan (default: repo root).")
    args = parser.parse_args()

    root_path = Path(args.root).resolve()
    if not root_path.exists():
        print(f"ERROR: root path not found: {root_path}")
        raise SystemExit(2)

    all_findings: List[Tuple[str, int, str, str]] = []
    for file_path in iter_files(root_path):
        all_findings.extend(scan_file(file_path))

    if not all_findings:
        print(f"No obvious secrets found under {root_path}")
        raise SystemExit(0)

    print("Potential secrets detected:")
    for fpath, lineno, desc, token in all_findings:
        print(f"- {fpath}:{lineno} :: {desc} -> {token}")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
