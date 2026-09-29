"""Build the self-contained server directory consumed by Electron Builder."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def pyinstaller_command(
    server_root: Path, build_root: Path, python_executable: str | None = None
) -> list[str]:
    command = [
        python_executable or sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        "atlas-server",
        "--distpath",
        str(build_root / "dist"),
        "--workpath",
        str(build_root / "work"),
        "--specpath",
        str(build_root / "spec"),
        "--paths",
        str(server_root),
        "--add-data",
        f"{server_root / 'brain' / 'schema.sql'}{os.pathsep}brain",
        "--collect-submodules",
        "adapters",
        "--collect-submodules",
        "brain",
    ]
    for package in ("fastembed", "sqlite_vec", "langchain_experimental"):
        command.extend(("--collect-all", package))
    command.append(str(server_root / "run_server.py"))
    return command


def main() -> None:
    server_root = Path(__file__).resolve().parent
    build_root = server_root.parent / "apps" / "desktop" / ".server-build"
    build_root.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        pyinstaller_command(server_root, build_root),
        cwd=server_root,
        check=True,
    )


if __name__ == "__main__":
    main()
