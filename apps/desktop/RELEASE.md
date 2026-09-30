## Atlas 1.0.3

- Auto text chat can use a configured cloud model **when you explicitly select it**; otherwise Auto stays local-only.
- One intent selector replaces the separate mode and tool controls in the composer.
- Agent runs that fail now say why (unsupported model, missing search key, timeout, or tool limit) instead of a generic error.
- Grouped citations such as `[S1, S3]` are validated against the sources actually issued and link correctly in chat and export; exports render all heading levels. Search and Research ask who "his/her/their" refers to instead of searching a bare pronoun.
- Refreshed onboarding: the "Atlas" wordmark is no longer cropped, and account setup uses a WebGL flowing-gradient background (a still frame when reduced motion is on, a static gradient if WebGL is unavailable).

Cloud billing and Atlas-managed inference are not available.

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
4. In Finder, Control-click Atlas, choose **Open**, then confirm **Open** in the warning dialog.

Only bypass Gatekeeper for a build downloaded from the official Atlas repository. This release is for Apple Silicon Macs; it does not include automatic updates.
