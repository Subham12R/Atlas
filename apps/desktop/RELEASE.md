## Atlas 1.0.2

Adds local-first Auto routing for text chat, guarded agent workflows, selected-document retrieval, and explicit model/tool failure states. Auto does not silently route to cloud models. Cloud billing and managed inference are not part of this release.

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
