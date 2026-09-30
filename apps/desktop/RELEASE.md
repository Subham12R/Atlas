## Atlas 1.0.7

**Updates.** Profile now has an **Updates** panel that checks GitHub Releases for a newer Atlas, shows the release notes, and opens the download for your platform. Atlas is not code-signed, so it does not install updates by itself: download the new build and install it over the old one. The check contacts `api.github.com` only when you open Profile or press **Check for updates**, sends no personal data, and only ever opens links inside github.com/Subham12R/Atlas.

**Auto mode really searches now.** Auto used to pick a tool-calling route that could never search while chat memory was attached. It now runs the Search workflow for any model. It also recognises more lookups ("who is…", "tell me about…", "CEO of…", "release date…") and keeps searching for a short follow-up to a search.

**Follow-ups keep their subject.** "from adamas university" after "who is dr sajal saha" is rewritten into one full search query from the visible chat, and the query used is shown. Private memory and attached files are never used for it. If it is still ambiguous, Atlas asks. Answers no longer merge different people who share a name.

**Steadier local models.**
- Atlas starts Ollama with an 8192-token context (the default silently cut off instructions and sources) and caps reply length.
- A runaway or repeating "thinking" stream is stopped and retried once without reasoning.
- Sources and chat history are trimmed to fit small context windows instead of being cut off.
- Memory is cut at whole items; answers built from web results no longer save facts to memory.
- An overloaded or rate-limited provider (503/429) shows a short message instead of raw JSON.

## Atlas 1.0.6

**Web search without an API key, in one click.** Profile → Advanced → Web search → **Set up free search**. Atlas installs [free-search-mcp](https://github.com/sweetcornna/free-search-mcp) in the background (and `uv` if needed), runs a test search, and switches over only once that works; it takes about 10 seconds. Queries still go to public search engines, with SafeSearch set to strict. You can switch back to a Tavily key at any time.

**See what the model is thinking.** Replies from thinking models show a **Thinking** panel: open while the model thinks, then collapsed to "Thought for Ns". Click to expand. This works with LM Studio, Ollama, OpenRouter, Claude and Gemini. Chat-template tokens that some local models leaked into answers (such as `<|begin_of_box|>`) are removed.

**"Continue" continues.** After a failed reply, "continue", "try again" or "go on" re-runs that request instead of starting over. In Web search, a bare "continue" repeats your previous search question and never searches the word itself.

**Much better research and search with local models:**
- Research builds a real multi-query plan with local thinking models; before, it silently fell back to searching your raw question.
- Questions that name someone and then say "his" or "their" are no longer refused as "needs a subject".
- Citations written as `(S1)`, `【S1】`, `[Source 1]` or a bare `S1` are recognized, and Web search gets one repair attempt, so fewer answers end up as "Partial: missing citations".
- The model no longer calls your sources "untrusted evidence".

Also: `npm run build:server` uses the project's `server/.venv` automatically, and the install steps are updated for macOS 15 and later.

## Atlas 1.0.5

- **Research keeps the conversation.** Research answers now see the chat's earlier turns, so follow-ups like "and what about the second one?" stay on topic. Search queries still use at most the last few turns, and a bare "do" asks what to search for instead of searching the word.
- **Optional keyless web search.** Search and Research can use an installed [free-search-mcp](https://github.com/sweetcornna/free-search-mcp) instead of Tavily (`ATLAS_WEB_SEARCH_PROVIDER=free-search-mcp`). Tavily stays the default. Keyless search still sends queries to external search engines, and it is not yet verified inside the packaged app.
- **New safe tools:** a calculator and a side-by-side source comparison for tool-capable models.
- **Research digs deeper when evidence is thin**, with one extra bounded search round.
- **Chat polish:** a new greeting on the empty chat and a styled copy-code button.
- **Memory works in the downloaded app.** 1.0.4 is the first build made with a Python that can load the memory store's database extension. Earlier downloads (1.0.1) were built without it.

## Atlas 1.0.4

**Models and routing**
- The model picker has **Auto** (default). It uses local models first and only uses your connected cloud providers after you turn on **Allow cloud models in Auto**. Picking a specific model always uses exactly that model.
- A **reasoning slider** (Off, Low, Med, High, Max) in the model picker controls how much the model thinks. It applies to OpenAI reasoning models, Claude (extended thinking), Gemini 2.5/3, OpenRouter, and local models that support it. In Auto, the slider is a maximum and Auto picks less for simple messages.
- Auto now **searches the web by itself** when a message needs current information. It uses tool calls when the model supports them and the search pipeline otherwise; without a search key it answers without searching and says why.
- Fixed new chats failing with "No permitted model" when a cloud model was shown as selected.

**Conversation memory**
- Every message now carries the chat's own recent history, so context survives app and server restarts, model switches, Auto routing changes, and web searches or plan runs in between. Recreated sessions also keep the chat's memory summary.

**Chat**
- Replies show the steps of a run (planning, searches, tools) as chips, which are saved with the chat.
- **Retry** regenerates a reply in place and brings the original back if the retry fails. Cited sources appear as chips.
- Select text in a reply to **Explain**, **Shorten**, or **Ask** about it.
- Plan mode: tick the steps to run, then **Approve & run**, **Revise**, or **Dismiss**.
- "Memory used" details are shown as cards; clicking a past conversation opens it.
- Refreshed buttons and layout in Profile and Library.

**Also includes 1.0.3** (not published separately):
- Auto text chat can use a configured cloud model **when you explicitly select it**; otherwise Auto stays local-only.
- One intent selector replaces the separate mode and tool controls in the composer.
- Agent runs that fail now say why (unsupported model, missing search key, timeout, or tool limit) instead of a generic error.
- Grouped citations such as `[S1, S3]` are validated against the sources actually issued and link correctly in chat and export; exports render all heading levels. Search and Research ask who "his/her/their" refers to instead of searching a bare pronoun.
- Refreshed onboarding: the "Atlas" wordmark is no longer cropped, and account setup uses a WebGL flowing-gradient background (a still frame when reduced motion is on, a static gradient if WebGL is unavailable).

Cloud billing and Atlas-managed inference are not available. Reasoning levels were checked against provider documentation and automated tests, not against every model.

## Release pipeline

A version-matching `v*` tag triggers offline backend tests, desktop typechecking
and tests, an Apple Silicon bundle build, embedded-server smoke test, code-signature
verification, and DMG integrity/SHA-256 checks. The checksum detects accidental changes but is not a cryptographic signature of the publisher. GitHub publishes the release only
after those gates pass.

## Install on Apple Silicon

This free release is ad-hoc signed and is not notarized, so macOS will show a
security warning.

1. Download the `.dmg` and matching `.sha256` file from Assets below.
2. Verify the download with `shasum -a 256 -c <downloaded-dmg>.sha256`.
3. Open the DMG and drag Atlas to Applications.
4. Open Atlas from Applications. When macOS says it "could not verify" Atlas, click **Done** (not Move to Bin).
5. Open **System Settings → Privacy & Security**, scroll to **Security**, click **Open Anyway** next to the Atlas message, authenticate, then click **Open**. This is needed once per install. (On macOS 14 and earlier, Control-click Atlas and choose **Open** instead.)

Only bypass Gatekeeper for a build downloaded from the official Atlas repository. This release is for Apple Silicon Macs; it does not include automatic updates.
