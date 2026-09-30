import json
import os
import runpy
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import Mock, patch

from build_embedded import pyinstaller_command


SERVER_ROOT = Path(__file__).resolve().parents[1]


class EmbeddedServerBuildTests(unittest.TestCase):
    def test_build_command_uses_portable_onedir_bundle_and_source_data(self):
        build_root = Path("/tmp/atlas-build")
        command = pyinstaller_command(SERVER_ROOT, build_root)

        self.assertIn("--onedir", command)
        self.assertNotIn("--onefile", command)
        self.assertIn(str(SERVER_ROOT / "run_server.py"), command)
        self.assertEqual(
            command[command.index("--add-data") + 1],
            f"{SERVER_ROOT / 'brain' / 'schema.sql'}{os.pathsep}brain",
        )
        self.assertEqual(
            command[command.index("--distpath") + 1], str(build_root / "dist")
        )
        for package in ("fastembed", "sqlite_vec", "langchain_experimental"):
            self.assertIn(package, command[command.index("--collect-all") + 1 :])


class EmbeddedServerRuntimeTests(unittest.TestCase):
    def test_server_uses_packaged_port_from_environment(self):
        app_module = types.ModuleType("api")
        app_module.app = object()
        uvicorn_module = types.ModuleType("uvicorn")
        uvicorn_module.run = Mock()

        with (
            patch.dict(
                sys.modules,
                {"api": app_module, "uvicorn": uvicorn_module},
            ),
            patch.dict(os.environ, {"ATLAS_PORT": "43127"}),
        ):
            runpy.run_path(str(SERVER_ROOT / "run_server.py"), run_name="__main__")

        uvicorn_module.run.assert_called_once_with(
            app_module.app, host="127.0.0.1", port=43127, log_level="warning"
        )

    def test_built_server_runs_from_outside_the_checkout(self):
        bundle_root = Path(
            os.environ.get(
                "ATLAS_SERVER_BUNDLE",
                str(
                    SERVER_ROOT.parent
                    / "apps"
                    / "desktop"
                    / ".server-build"
                    / "dist"
                    / "atlas-server"
                ),
            )
        )
        executable = bundle_root / ("atlas-server.exe" if os.name == "nt" else "atlas-server")
        if not executable.is_file():
            self.skipTest("run after build_embedded.py creates the PyInstaller bundle")

        with tempfile.TemporaryDirectory(prefix="atlas-bundle-smoke-") as data_dir:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]

            env = {
                key: os.environ[key]
                for key in ("PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TEMP", "TMP")
                if key in os.environ
            }
            token = secrets.token_hex(32)
            env.update(
                HOME=data_dir,
                ATLAS_PORT=str(port),
                ATLAS_API_TOKEN=token,
                BRAIN_ENABLED="0",
                BRAIN_DB_PATH=str(Path(data_dir) / "brain.db"),
                CHATS_DB_PATH=str(Path(data_dir) / "chats.db"),
                CREDENTIALS_DB_PATH=str(Path(data_dir) / "credentials.db"),
            )
            log_path = Path(data_dir) / "server.log"
            with log_path.open("w") as log:
                process = subprocess.Popen(
                    [str(executable)], cwd=data_dir, env=env, stdout=log, stderr=log
                )
                try:
                    deadline = time.monotonic() + 55
                    while time.monotonic() < deadline:
                        try:
                            url = f"http://127.0.0.1:{port}/providers"
                            request = urllib.request.Request(
                                url, headers={"Authorization": f"Bearer {token}"}
                            )
                            with urllib.request.urlopen(request, timeout=1) as response:
                                self.assertEqual(response.status, 200)
                                self.assertIsNotNone(json.load(response))
                            with self.assertRaises(urllib.error.HTTPError) as unauthorized:
                                urllib.request.urlopen(url, timeout=1)
                            self.assertEqual(unauthorized.exception.code, 401)
                            return
                        except (OSError, urllib.error.URLError):
                            if process.poll() is not None:
                                self.fail(
                                    f"bundled server exited {process.returncode}: "
                                    f"{log_path.read_text(errors='replace')}"
                                )
                            time.sleep(0.25)
                    self.fail(
                        f"bundled server timed out: {log_path.read_text(errors='replace')}"
                    )
                finally:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()


if __name__ == "__main__":
    unittest.main()
