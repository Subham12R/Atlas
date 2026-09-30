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
