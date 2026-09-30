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

Run the server and `npm run dev` with the **same** strong `ATLAS_API_TOKEN`
in their process environments (at least 32 ASCII characters). In packaged
builds Electron generates a fresh token and passes it to the embedded server;
no manual configuration is needed. The renderer receives it over preload IPC
and sends it only as an Authorization header to the loopback API.

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

## Agent modes

Search and Research require a Tavily key in Profile → Advanced. Search performs
one query; Research plans at most 3 queries, keeps at most 12 unique results,
fetches no more than 3 public pages, and stops after 90 seconds. Source IDs
(`[S#]`) are structural references, not a guarantee that a claim is true.
Stopping an agent run cancels the active request and prevents later steps.

Selected text attachments are limited to 5 files, 5 MiB per file, and 10 MiB
total. They are sent only for the current run; attachment citations (`[A#]`)
show the selected filename/section and are not external links. PDF/Office
parsing and arbitrary filesystem access are not supported.

Safe tools are read-only and enabled only for advertised OpenAI, Anthropic, and
Gemini models. When Brain or a selected file is in scope, Safe Tools exposes
local reads only; use Search or Research for public web queries. OpenRouter/local
models, shell execution, and arbitrary code execution are disabled. Document
drafts do not touch disk until the user reviews the complete Markdown content,
selects a destination, and confirms saving or replacement.

## Public macOS releases

The GitHub Actions workflow builds an Apple Silicon DMG when a `v*` tag is
pushed. The tag must match the version in `package.json`; the workflow uploads
the DMG and its SHA-256 checksum to a GitHub Release. Make the repository
public for free public downloads. Because the app is not Developer ID signed
or notarized, users must use Finder's **Control-click → Open** flow on first
launch. See [RELEASE.md](RELEASE.md) for the release instructions.
