#!/usr/bin/env python3
"""
Two file-level rules this project cannot afford to break, in one pass.

No em dash: the monorepo bans the character in anything written here, and a
grep for it inside a Makefile recipe depends on how the shell reads a byte
escape, which is not something to leave to chance.

No stray control byte: a NUL in a source file in this fleet once made every
grep-based check skip the file silently, and git refused to show the diff. A
test suite passed the whole time. Byte-scan instead of trusting a text tool.

Vendored kit files and js/vendor are excluded: they are upstream copies, they
are not ours to edit, and a sync script would overwrite any fix anyway.

Exit 0 clean, 1 findings, 2 could not run.
"""

import pathlib
import sys

EXTS = {'.js', '.mjs', '.json', '.md', '.txt', '.css', '.html', '.yml', '.yaml'}
EXCLUDE_PARTS = ('node_modules', '.git', 'js/vendor/', 'js/neokeys/')
EXCLUDE_NAMES = ('viz.js', 'viz.css')
EXCLUDE_PREFIX = ('neorgon-',)

ALLOWED_CONTROL = {9, 10, 13}  # tab, newline, carriage return

EM_DASH = '—'.encode('utf-8')


def owned(path: pathlib.Path) -> bool:
    rel = path.as_posix()
    if any(part in rel for part in EXCLUDE_PARTS):
        return False
    if path.name in EXCLUDE_NAMES:
        return False
    if any(path.name.startswith(p) for p in EXCLUDE_PREFIX):
        return False
    return path.suffix in EXTS


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    problems = []
    checked = 0

    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if not owned(rel):
            continue
        checked += 1
        data = path.read_bytes()

        if EM_DASH in data:
            line = data[:data.index(EM_DASH)].count(b'\n') + 1
            problems.append(f'{rel}:{line} em dash')

        stray = sorted({b for b in data if b < 32 and b not in ALLOWED_CONTROL})
        if stray:
            names = ', '.join(f'0x{b:02x}' for b in stray)
            problems.append(f'{rel} control byte(s): {names}')

    if not checked:
        print('  no files matched, which is broken discovery rather than a clean tree')
        return 2
    if problems:
        for p in problems:
            print(f'  {p}')
        print(f'  {len(problems)} problem(s) across {checked} file(s)')
        return 1
    print(f'  {checked} file(s) clean')
    return 0


if __name__ == '__main__':
    sys.exit(main())
