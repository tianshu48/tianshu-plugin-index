# 天枢插件索引

[English](README.md)

社区插件用 Pull Request 上架。对着 `main` 放一份 `proposals/<插件id>/<版本>.json`。

JSON 里要有 `plugin_id`、`version`、`user_id`（天枢账号 id）、`source`、`source_tag`、`pack_url`（GitHub 或 GitCode 的 Release 文件）。没签名的 PR 可以开。审核通过后，用该账号签过名的包会合并；没签名的会再要你签一份。

`example.community.template` 和占用 `tianshu` 的 id 在这条路上会被拒绝。

官方插件只在本仓开 PR（不要 fork）：一份 `official/<插件id>/<版本>.json`，必须已签名的 native 包。审核和合并方式和社区一样。
