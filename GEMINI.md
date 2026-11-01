# BetterMV 插件仓库自动化与 GitHub 实时同步规则

- 在 Windows PowerShell 中请使用 `npm.cmd` 执行脚本命令。
- 每次完成插件源码或场景动效改进后，必须：
  1. 递增 `exporter/build-plugin.mjs` 中的 `VERSION` 尾号（若本轮尚未递增）；
  2. 依次通过 `npm.cmd run typecheck`、`npm.cmd run export:test` 与 `npm.cmd run export:build`；
  3. 自动执行 `git add -A`、使用简体中文编写包含版本号与改进摘要的 `git commit`，并执行 `git push origin main` 实时推送到 `git@github.com:CyrilVaelen/NCM-BetterMV-Reproduce.git`（严禁提交版权音视频、`.bak`/`.candidate` 临时备份或私人密钥）。
