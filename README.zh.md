# 天枢插件索引

[English](README.md)

社区插件用 Pull Request 上架。对着 `main` 放一份 `proposals/<插件id>/<版本>.json`。

JSON 里要有 `plugin_id`、`version`、`user_id`（天枢账号 id）、`source`、`source_tag`、`pack_url`（GitHub 或 GitCode 的 Release 文件）。没签名的 PR 可以开。审核通过后，用该账号签过名的包会合并；没签名的会再要你签一份。

`example.community.template` 和占用 `tianshu` 的 id 在这条路上会被拒绝。

官方插件只在本仓开 PR（不要 fork）：`official/<插件id>/<版本>/<os>-<arch>.json`，必须已签名的 native 包。`os` 是 `linux` / `windows` / `macos`，`arch` 是 `x86_64` / `aarch64`。一次 PR 一个插件版本，多个目标可以一起。
