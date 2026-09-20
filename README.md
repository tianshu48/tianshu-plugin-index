# Tianshu plugin index

[中文](README.zh.md)

Community plugins are listed with a pull request. Put one file at `proposals/<plugin-id>/<version>.json` against `main`.

The JSON needs `plugin_id`, `version`, `user_id` (your Tianshu account id), `source`, `source_tag`, and `pack_url` (a GitHub or GitCode Release asset). Unsigned PRs are allowed. After review, a pack signed with that account is merged; an unsigned pack gets a request to sign.

`example.community.template` and ids that use `tianshu` are rejected on this path.

Official plugins use a pull request on this repository only (not a fork): files at `official/<plugin-id>/<version>/<os>-<arch>.json`, already signed, native pack. `os` is `linux` / `windows` / `macos`; `arch` is `x86_64` / `aarch64`. One plugin version per PR; several platforms may share that PR.
