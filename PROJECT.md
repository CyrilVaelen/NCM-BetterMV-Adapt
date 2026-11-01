# BetterMV 本地增强版：项目约定

## 工作目录和角色

- 唯一实现源目录：`D:\NCM\NCM-BetterMV-0.9.0`。
- 本机安装目录：`D:\NCM\BetterNCM\plugins`；不是源目录，也不是独立同步工作区。
- Antigravity 负责实现、自测和提供证据；Codex 负责审查改动及独立验收；用户确认使用体验。
- `PROJECT.md` 记录长期架构；`ACCEPTANCE.md` 记录可观察标准；`TASK.md` 限定本轮任务；`STATUS.md` 记录实际进展。
- 当前为源码包解压目录，2026-10-17 检查时不是 Git 仓库。不要假装已有 Git diff；先做文件备份和 SHA-256 清单，再交付可对照的补丁/文件差异。若后来已有 Git，先核实并遵循现状。

## 架构

- TypeScript + Three.js，客户端目标包含网易云 Chromium 91；纯音乐分析在 `src/analysis`。
- `src/app/prepare.ts` 准备歌曲及分析；`src/app/player.ts` 创建播放场景并叠加本曲全局歌词延迟。
- `src/director/music.ts` 根据音频时间提供节拍、能量和旋律信号；`src/director/overlay.ts` / `src/render/lead-motion.ts` 绘制两侧旋律波纹。
- `src/lyrics/parse.ts` 解析原歌词；`src/plugin/aligner.ts`、`tools/aligner/align.py`、`tools/aligner/fa.py` 处理可选本地音频对齐。
- `src/plugin/main.ts`、`src/plugin/ui.ts` 负责实时歌曲状态、设置和交互。
- `src/plugin/export.ts` 向本地服务传递歌曲快照；`exporter/render-page.ts` 离线渲染；`exporter/server.mjs`、`exporter/runner.mjs` 导出 MP4。

## 稳定约束

- 歌词时间、音频时间和画面延迟各自有明确职责。歌词校准只移动歌词，不能移动音频、节拍、主体动效、两侧波纹或整幅画面时钟。
- 同曲同随机种子的镜头安排应可复现，不能通过校准歌词悄悄重新抽取随机种子。
- 保留 MP4 导出、已有全曲旋律响应、Drop 主体增强、Sunshine 段落修正及现有个人配置。
- 主体音色响应覆盖所有场景、外观和歌曲段落；脉冲与预计算音频事件使用相应的 synth stab、bass stab 或 lead 声部估计。
- 原始歌词与有效歌词需要区分：校准应可撤销、可重算，禁止反复叠加造成漂移。
- 处理音乐和歌词的本地模型无需上传用户音频。本地导出 token 不得写入日志、提示词或公开材料。
- 新界面使用简明中文，沿用现有设置样式；后台路径、缓存键和模型参数不应进入普通用户操作流程。

## 构建与交付

- 现有命令：`npm run typecheck`、`npm run export:build`、`npm run export:test`。
- 只有实际执行并取得结果的检查才能写 PASS。实现者自测不等于 Codex 独立验收。
- 交付新功能时先提供可审查源码、测试记录和候选插件；本轮不替换正在使用的插件，不覆盖桌面已验收压缩包。
- 不自动初始化 Git、不重装网易云或 BetterNCM、不调整加载器、不做与当前任务无关的重构。

## 2026-10-18 本次直接实施授权

用户“你直接做吧”授权 Codex 实现并安装本地 LRC 逐字对齐修复、更新桌面完整版。此前 Antigravity 执行/仅候选包的限制不适用于本次 LOCAL-WORD-01；其他长期架构和历史任务边界仍保留。

## 2026-10-18 段落识别修改授权

用户明确要求底层支持 melodic dubstep 的段落识别，当前 MELODIC-FORM-03 可以修改音频分析代码；原歌词校准任务的“不改分析”仅约束歌词显示校准，不阻止本次单独授权的结构修复。新结构模型须由声学和重复段落证据触发，不能维护单曲时间表。保留旧算法作为证据不足时的路径；安装前备份 .8，记录实际回归、渲染和完整包验证结果。

## 2026-10-18 主体音色高亮授权

当前 TIMBRE-LIGHT-04 修改 Drop 高亮的音频来源，使用独立的主体声部估计和独立纹理通道；字面频谱、原有 lead 包络和所有非 Drop 音乐查询保留。音色与打击声重叠时不可按鼓点时间一律排除。实际声部分类应注明声学估计的边界。安装前保存 .9 源码及插件基线，交付保留全部此前改动。
