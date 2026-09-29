# Atlas desktop

An Electron application with React and TypeScript. Packaged builds include a
PyInstaller-built FastAPI server; no local server process is needed at runtime.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

Install server build dependencies in a Python virtual environment first.

```bash
# macOS/Linux
python3 -m venv ../../server/.venv
source ../../server/.venv/bin/activate
python -m pip install -r ../../server/requirements.txt
```

```powershell
# Windows PowerShell
py -3 -m venv ..\..\server\.venv
..\..\server\.venv\Scripts\Activate.ps1
python -m pip install -r ..\..\server\requirements.txt
```

Then package for the current host:

```bash
npm run build:mac     # Apple Silicon
npm run build:win
npm run build:linux
```

`build:mac` builds the server from `../../server` into the ignored
`.server-build` staging directory before packaging. In development the renderer
still uses the local server on port 8000; packaged apps start their own bundled
server on an available loopback port.

## Public macOS releases

The GitHub Actions workflow builds an Apple Silicon DMG when a `v*` tag is
pushed. The tag must match the version in `package.json`; the workflow uploads
the DMG and its SHA-256 checksum to a GitHub Release. Make the repository
public for free public downloads. Because the app is not Developer ID signed
or notarized, users must use Finder's **Control-click → Open** flow on first
launch. See [RELEASE.md](RELEASE.md) for the release instructions.
