## 2026-10-23 PHOENIX-LEAD-COLOR-18：双 Lead 代表色系统、猛禽覆羽质感与光环细节修复，.31 已部署

针对 BetterMV 涅槃舞台场景（`src/scenes/phoenix.ts`）完成三大维度的声光与写实视觉升级：

- **双 Lead 代表色系统与人声融合机制（`src/scenes/phoenixLeadColor.ts`）**：
  - 新建色彩分析模块，提取专辑封面主双色体系，构建 A、B 两套四级热度色板（`core`、`bright`、`mid`、`deep`）。
  - 根据音轨分析器中两路高频 Lead（`lead` 与 `keys/synth`）的分离度与主导度，动态生成 30fps 平滑控制轨迹（`uLeadA`、`uLeadB`、`uLeadShareB`、`uColorFusion`、`uLeadGlow`、`uLeadPulse`）。
  - **动态色彩流动与人声融合**：无人声（纯器乐）时，音响光环、火凤羽流与水面反射由 A / B 两套代表色独立驱动，色块分明、各具流向；当有人声介入（根据 `vocal` / `lyrics` 活跃度与句段能量）时，两套代表色发生柔和融合（`uColorFusion` 平滑抬升），人声结束后平滑还原。
- **写实猛禽特征与羽毛质感重塑**：
  - **头部与颈部写实化**：重塑头部与喙部体块，引入苍鹰式坚硬向下勾喙（`evalBeakRealistic`）、平直深邃眉弓阴影（`browShadow`）、饱满后枕与自然放大的粗颈（`dHeadDome`、`dNeck`），彻底消除原本机械/动漫剪影感。
  - **翼面覆羽质感**：新增多层密集鳞瓦状覆羽与羽流交错阴影（`evalCovertFeathers`、`occluderShadow`），形成层次分明、光影深邃的写实猛禽翼面。
- **粗壮大圆音箱光环与细节伪影修复**：
  - 正面板保留 ~91% 比例的发光圆环与内凹凹面振膜（`evaluateGiantSpeaker`）。
  - 修复光环外侧放射状色楔伪影：压缩 `wBHalo` 的过渡范围至本体内核（`0.002..0.008`），外部漫射与下冲光晕直接使用场景主导色 `wBAmbient`，消除极坐标/大尺度噪声在外部空气中拉出的扇形硬边缘。
  - 修复凤凰背焰薄火区域色斑：通过 `bgTongueMask`（火舌浓密程度门限）加权，稀薄外焰与羽端淡入主导色，消除突兀颜色跳变。
- **验证与部署记录**：
  - `npm run typecheck` 通过（0 错误）；`npm run export:test`（2/2 通过）；`npm run export:build` 构建通过，版本递增至 `0.9.0-local-export.31`。
  - 源码基线备份：`D:\NCM\state\phoenix-lead-color-20261023\baseline\phoenix.ts.bak`（SHA256 `ACE58C98FC7072C5E235F0F334EF11B0C12EAFC6ABC37ABB2859D21D72940FC5`）。
  - 修改后源码：`D:\NCM\NCM-BetterMV-0.9.0\src\scenes\phoenix.ts`（SHA256 `73ED16200891C86CED82925086C36E85E1D5DF92E8ADD7FF4AD6F1018A9D5441`），新增文件 `src/scenes/phoenixLeadColor.ts`（SHA256 `CE6B2CCC4EBC9D9E7B2BE286840EE5F54AE3F8A497D9C29B73567DDAF2EF520F`），差异补丁保存在 `D:\NCM\state\phoenix-lead-color-20261023\verification\phoenix.ts.diff`。
  - 视觉验证产物：`D:\NCM\state\phoenix-lead-color-20261023\verification\renders\`（含全画幅、特写、跨封面色调验证、前后对比图 `compare-*.png` 及 8 秒 30fps 连续视频 `after-phoenix-stage-playback.mp4`）。
  - 活动插件包 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin`（SHA256 `77C90C01CA66D730CA0E3F9669A5E15CC7953B2B98A71E071FF7CB80A0D796BD`）与活动运行时 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv\bettermv.js`（SHA256 `F23ECBF154EE2A43C6E84F2062D4DF9DF0D7FC151863AC7D879C9D26F692941C`）已同步并读回核验一致。`require_restart=true`，需重启网易云音乐客户端加载。

## 2026-10-22 PHOENIX-STAGE-REFINEMENT-17：涅槃舞台音响、火凤、完整封面与水面反射精细化打磨

参照 `public/awake-cover.jpg` 的结构、光影、比例与材质关系，对 `src/scenes/phoenix.ts` 进行了全面视觉升级，同时完整保留专辑封面动态调色板（`uStageDark`、`uSmokeWarm`、`uFireDeep`、`uFireMid`、`uFireBright`、`uFireCore`）：

- **巨型立体音响（`evaluateGiantSpeaker`）**：
  - 突出单一主大圆单元（`ringRadius = 0.0835`），将上方小圆单元存在感压低至 `< 2%` 的微弱暗部结构暗示。
  - 建立正面板（`inFrontBaffle`）与朝向舞台内侧的三维侧立面（`inSideWall`）体块转折，消除平面方盒感与整圈等亮描边。
  - 统一箱体正面、圆环与内凹振膜的内倾透视变换（`dpPersp`、`dpLensPersp`），构建单元嵌入箱体的外侧内凹受光边壁（`inRecessWall`）、悬边立体明暗（`inSurround`）、柔和凹面振膜掠射受光（`bowlIllum`）与中心防尘帽过渡。
  - 发光圆环分为高亮内核（`ringCore`）、火焰过渡带（`ringTransition`）与非对称外围辉光（`ringOuterHalo`）三层，采用二维各向同性平面坐标 `ringPlaneUv = dpPersp * 24.0` 采样火焰噪声，消除了极坐标角度采样在振膜内造成的径向射线伪影；音箱底部暖雾光池通过 `renderUpperStage` 的前景体积烟雾 `speakerBaseMistLight` 自然散射，消除了箱体底部的生硬矩形亮角。
- **涅槃火凤（`evalWingSpine`、`evaluatePhoenixAndFire`）**：
  - 区分贴近身体的暗部覆羽（`dCovertWing`）与外侧散开的 13 簇次级/内侧初级飞羽 + 6 簇翼尖指状初级飞羽，具非均匀长度、弯曲、间距与邻近羽片遮挡阴影（`occluderShadow`）。
  - 去除上翼缘完整高亮描边，加宽肩背与翅根连接体块（`dShoulderMass`），紧凑收拢头颈与 3 束短羽冠，将尾羽整理为 7 束前后双层紧密交叠的扇面。
  - 火焰沿覆羽齿状下缘、飞羽羽叶、翼尖、尾端与背部冠冕分布，将翼下火舌锚点 `flameRootY` 绑定至 `covertChordFrac` 与 `covertScallop` 阶梯，消除了翼面中段僵直的对角切线。
- **中央完整专辑封面与地面反射（`evaluateCenterAlbumScreen`、`renderStageFloor`）**：
  - 中央门廊中上部（`y = 0.586 .. 0.946`）完整渲染 1:1 比例专辑封面，不裁切下半部分；前景火凤位于 `y ≈ 0.504`，空间层次分明且不与封面图案重叠。
  - 湿润地面保留深色混凝土暗部，两侧音箱与中央火凤反射光柱位置严格对应，并由横向水波与地面接缝自然打散。
- **验证与部署记录**：
  - `npm run typecheck` 通过；`npm run export:test`（2/2 通过）；`npm run export:build` 通过。
  - 源码基线备份：`D:\NCM\state\phoenix-stage-refinement-20261022\baseline\phoenix.ts.bak`（SHA256 `536911DD40DCB01BBC82B1DE6E2BADE1E5DB3C1C69586F66C018D0D805572955`）。
  - 修改后源码：`D:\NCM\NCM-BetterMV-0.9.0\src\scenes\phoenix.ts`（SHA256 `ACE58C98FC7072C5E235F0F334EF11B0C12EAFC6ABC37ABB2859D21D72940FC5`），差异补丁保存在 `D:\NCM\state\phoenix-stage-refinement-20261022\verification\phoenix.ts.diff`。
  - 视觉验证产物：`D:\NCM\state\phoenix-stage-refinement-20261022\verification\renders\`（含全画幅、局部特写、跨封面色调验证、前后对比图 `compare-*.png` 及 8 秒 30fps 连续视频 `after-phoenix-stage-playback.mp4`）。
  - 活动插件包 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin`（SHA256 `3AB9891B6A52A2A7A76C4B06BE001EF8812222E729990D486E2688EFC03E7018`）与活动运行时 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv\bettermv.js`（SHA256 `084049006DA9B180964A8BF8CC12F15E3A0FBB9B3FC8B7ED86EAB46AC7B66868`）已同步并读回核验一致。`require_restart=true`，需重启网易云音乐客户端加载。

## 2026-10-21 RUSH-DROP-TRANSITION-16：消除 Drop 前预黑，`.28` 已部署

用户确认入口已正确，新增反馈为进入 Drop 时闪黑。已读取新鲜网易云 `.27` 实时诊断：时间为北京时间 2026-10-21 12:43:05，实际风格 `pulse`，175.73–192.01 秒 build、192.01 秒起 drop；段落修复已经在宿主生效。

黑闪来自 `director.ts` 中 Drop 前半拍的强制 `fx.fade=1`。律动的普通 dip 为 0，水下画面本来就屏蔽双色 impact；本轮真实 GPU 复现也确认 impact 始终为 0。删除预黑，加入最长 180 毫秒的入拍前叠化，并让字符/CRT 等外观同步释放。Drop 边界完全不变，到 192.01 秒已是完整 Drop 画面；不在入拍之后继续等待转场。另保护其它场景 Drop 入口不被通用双色冲击、glitch 和可选 dip 覆盖。

- 生产源码仅 3 处文件变化：`director/director.ts`、`render/shots.ts`、`style/style.ts`；分析与歌词全部源码逐文件散列和 `.27` 冻结基线相同，保留并发歌词修复结果。
- 新增 7 项转场行为检查；连同稳定 Drop、浑天仪、镜头运动和 Drop preparation，共 35/35 通过；类型检查、插件构建通过。
- D 盘原 MP3/LRC、内嵌专辑封面、完整 MvPlayer 后期链，Edge Intel Iris Xe D3D11 实际 GPU；固定律动 seed 0，使用实时 `.27` 段落/能量，以 60 fps 渲染 191.41–192.593 秒，旧新各 72 帧，镜头场景和边界完全相同。旧预黑标记 26 帧，新预黑、impact、平暗空帧均 0；浏览器错误 0。已经查看 191.99333 / 192.01000 / 192.02667 秒相邻画面。第一候选的字符屏突变被发现并修正，第一候选证据另存 `state/rush-drop-transition-20261021/candidate1`，没有冒充最终结果。
- `.28` 活动插件包 SHA256 `094321e181948a755b41614fece5437be4cfe88865b75bc50fdee56c5076adf6`；活动 runtime JS `94cf65e44ca57e98482eb9b955d110d53fb10e836fe4353e2b35d2f625615806`；manifest `041044391ff5b4c1ffe84e7174f54e65babe800dd764e40a9284e087a5f4ab1f`。包内 JS 与构建产物及活动 runtime 一致，版本均 `.28`。实际目标是 `D:\NCM\BetterNCM\plugins` 与 `plugins_runtime\ncm-better-mv`。
- 独立版本包：`D:\NCM\BetterMV-0.9.0-local-export.28-drop-transition.plugin`。备份与交付散列：`D:\NCM\state\rush-drop-transition-20261021`。可复现转场视频和帧记录：`D:\NCM\exports\Rush-drop-transition-20261021`。
- 本轮画面为本地 Edge 验证，并非网易云窗口录像；当前确认 `.28` 磁盘部署，尚未确认宿主加载 `.28`。插件要求完全退出重开网易云；不用清缓存或修改个人配置。

## 2026-10-21 RUSH-DROP-ENTRY-15：段落源码回扫，`.27` 已部署

用户反馈 Drop2 仍从 194.9 秒才分配为 drop。`.26` 的 fresh live JSON 确认运行时版本正确但标签未变：175.73–194.90 秒为 build，194.90 秒开始 drop。该 JSON 没有保留粗边界和候选拒绝信息，因此没有把某一项实时阈值失败伪称为已证实根因。

源码审查确认 `.26` 回溯完全依赖强 kick 事件（强度 ≥0.65）。在线 hit 检测若遗漏/压低真实鼓点，早期 Drop 入口就不会成为候选；194.90 秒附近的 kick 与低频又会让原粗边界被视为已支持。`src/analysis/entries.ts` 已改为在晚切点之前直接扫描低频、高频及 RMS 包络，要求局部起音、铺垫前缀对比和后续整句能量持续成立，不再把强 kick 命中作为回扫前置条件。对偏早的粗边界仍保留 kick 支持的正向校正，以保护孤立填充音反例。

`src/plugin/main.ts` 在 Rush fresh analysis 时捕获 `sections.ts` 原始 DP cuts、184–199 秒边界特征、最终分段信息及每个入口候选的阈值/拒绝理由，附加到诊断 JSON 的 `analysis.sectionTrace`。新的在线记录将能验证这次 envelope scan 是否确实改变最终标签。

- D 盘 CloudMusic 原 MP3/LRC 重新分析：本地、70 BPM、140 BPM、无歌词、早 chorus hint 五组均通过；入口 192.003–192.01 秒，191.7 秒 build、192.2 秒 drop；Outro 220.59 秒；场景互异 4 风格 × 32 seed 通过。
- 针对 live 粗边界 194.90 秒的回归：完整 D 盘音频低/高频与 RMS 保持真实，只分别使用完整 kick 列表和空 kick 列表，均恢复到 192.01 秒。
- Drop preparation 单测 13/13 通过；`npm run typecheck`、`npm run export:build` 通过。
- `.27` 包、runtime JS、manifest 已部署并逐个读回核验。包 SHA256 `4b3a56fd984a9cbe2a86ecdbebc9cbe776b624b378f63f73d01dde5b4e8b190e`；runtime JS SHA256 `4d8885d9f986229773c2f1a9bef3fbe777c1e4ed9ea3a3b216c680f69ee97c1b`；manifest SHA256 `b65a46a56d2d3d26465a6336ed5ea6134b6cc43ffcc374bcd9472f880e85c0e2`。`.26` 安装前文件备份和源码快照位于 `D:\NCM\state\rush-drop-segmentation-20261020`。
- `require_restart=true`；检查时没有网易云进程，故只能确认已部署到活动目录，不能声称 `.27` 已加载或在线问题已在宿主复验。下次打开/重新分析 Rush 后，`D:\NCM\BetterNCM\BetterMV\rush-over-me-live-analysis.json` 会包含新 `sectionTrace`。现存 JSON 时间为 2026-10-20 23:48，记录的是 `.26`。

机器交付记录：`D:\NCM\state\rush-drop-segmentation-20261020\delivery.json`；分段回归：`D:\NCM\exports\Rush-form-20261020\regression.json`。

## 2026-10-20 RUSH-DROP-ENTRY-14：律动 Drop2 首帧入深，`.24` 已部署

用户确认网易云当前选择的是律动风格。配置记录为 `style=pulse`，Drop2 段落和镜头计划都从 192.01 秒（3:12.01）切入；延后显效来自 `underwater/dive` 镜头的 2.4 秒下潜起势（镜头高度从 -9.5 逐渐到 -13.6），不是段落判据、律动转场或加载旧插件。

修复仅改 `src/scenes/underwater.ts`：Dive Drop 在第一帧直接使用完整深度；非 Drop 镜头仍保留原先 2.4 秒起势。音乐分析版本、歌词、音源、用户配置均未改。相对 `.23` 安装交付记录，104 个生产源中仅此 1 个源码变化。

`npm run typecheck` 通过；镜头回归 7/7 通过；D 盘原曲整曲回归 5 组通过。律动风格的 `local-140` 检查在 191.7 秒仍为 build、192.01 秒进入 `underwater/dive` Drop 且首帧进度为 1，192.2 秒为 Drop；Outro 仍从 220.59 秒开始，跨 4 种风格 × 32 个 seed 的 Drop/Outro 场景互异检查仍通过。回归明细见 `D:\NCM\exports\Rush-form-20261020\regression.json`。

`.24` 已部署到 BetterNCM 活动插件包和 `plugins_runtime/ncm-better-mv`。活动包 SHA256 `687ffb66bb1a6ee18782bd4597f74762b938ac87aa950c74cc2dc33b0d67a1bf`；运行时 JS SHA256 `e5dccbb950e6c8124ab982e65d5b432e4756b72f312c095e69a74ac6e1492eed`，与构建产物及插件包内 JS 一致。`.23` 原包和运行时已备份；部署记录在 `D:\NCM\state\before-rush-drop-entry-20261020\delivery.json`。

安装后尝试使用 Headless Edge 对新入口重新取帧，但浏览器在页面创建前退出（Crashpad 管道关闭）；本轮没有拿到新的 GPU 画面证据，也没有网易云播放进程可核验。磁盘包和运行时已确认是 `.24`，`require_restart=true`；完全退出并重开网易云后才会加载本轮版本。完整验证边界及输入散列见 `D:\NCM\exports\Rush-drop-entry-20261020\修复与验证说明.md`。

## 2026-10-20 RUSH-LOCAL-AUDIO-12：诊断 `.21` 音源错位并安装 `.22`

用户多次重启后仍复现段落问题。读回实际 BetterNCM 插件目录确认重启前加载包为 `.21`；源码里的修复此前未构建安装，因此重启不能改变行为。`.21` 忽略了播放器提供的本地曲目标记：即使该曲绑定了 D 盘 LRC，也仍按网易云歌曲 ID 读取缓存/在线音频。歌词更新路径只重建计划、不重建依赖歌词的段落分析，异步歌词更新可与旧 `analysisLines` 不一致。

`.22` 改为：本地曲目且绑定 LRC 时优先读 LRC 同目录同名音频；歌词刷新后以 `PreparedSong` 保留的同一音频重新做段落分析，并更新结构条、MV计划与说明。UI说明实际分析音频来源，便于区分本地文件和网易云音源。没有加入歌名/歌曲 ID/固定时间特判，不改变分析版本 9、用户设置或原音乐/LRC。

- D 盘实测输入：`D:\CloudMusic\Seven Lions,Said The Sky,ILLENIUM - Rush Over Me.mp3`；同名 LRC。插件音源选择器返回 `paired-local-file`，音频 SHA256 与源 MP3 一致：`f12354d6bc06a4dda49fe62baa22cd05fca2b96864ae765ada18e2f6ba5e34db`，时长 259.556 秒。
- 插件同一分析器在 100.82、101、102.8 秒及 175.8、189.8、191.7 秒均标为 build；103.3 秒、192.2 秒标为 drop。边界分别为首个 drop 103.12 秒、第二个 drop 192.003 秒。报告：`D:\NCM\exports\Rush-local-input-fix-20261020\validation.json`。
- `npm run typecheck` 通过；段落入口/回归测试 10/10 通过。浏览器/网易云播放进程测试没有冒充为已完成。
- 构建及安装后 `.22` 包 SHA256 `e83e619e62835ce5b80d0cd3b062b3e1a06942207c40769829e1f34106e198ef`；安装包、运行目录 JS/manifest 回读校验一致，运行 JS 与新 `dist` SHA256 均为 `2548528c923c72c7f5cc4393f9542066801bd084d30397578d6468e49dafebdf`。完整散列及 104 个生产源散列：`D:\NCM\state\rush-local-input-fix-20261020\delivery.json`。
- 插件 manifest 标记 `require_restart: true`。之前多次重启是在 `.22` 安装前；需要在本轮安装后完全退出并重开网易云，再重新打开 MV。之后 UI 会显示“分析音频：本地 LRC 同名音频文件”。
- 为防止复发，已在 `ACCEPTANCE.md` 增加所有本地插件改动通用的部署闭环：先确认活动 profile 和实际目标，备份、安装包与 runtime，逐个回读版本/SHA；需要重启时区分磁盘部署和进程已加载，失败即不得报完成。

## 2026-10-20 RUSH-ARMILLARY-11：.20 已验证并安装

问题在镜头装饰策略：原来每次非Drop→Drop都会再次插入orbit。实际Rush在188.4429–192.01秒为浑天仪，随后才切Drop2；未发现旧计划越过192.01秒，不能冒称重复了两个重叠镜头。本曲首次Drop前最后build太短，原策略未插入浑天仪，第二次才插入这个重复过场。

现仅首个实际Drop前可编排orbit，首段不足就跳过，不延后补放；后续Drop直接进入自身场景。结尾gather、禁用设置保留，音乐分析版本仍9。生产源只改director.ts和catalog.ts，全部音乐分析/歌词源码与.19基线逐字节一致。

新增7项镜头测试、原34项有关测试、类型检查通过。冻结旧导演同组测试6项策略失败，新策略7/7通过。实际Edge使用原MP3、新鲜prepareSong分析、固定seed20261020和自动镜头连续渲染187–195秒：before/after各240帧原声，Drop2前无crystal，192.01秒精确切入underwater；入口和后续帧transition=null、fade=0，无页面错误或WebGL丢失。root已抽查191秒前后及起音后一帧图像。未冒称网易云运行中试听。

安装包.20、runtime JS/manifest回读散列一致，见state/rush-armillary-20261020/delivery.json。保留.19独立插件和本轮baseline，可回退。需完全退出重开网易云并重新打开MV。旧计划在175.5456–175.66秒存在114.4ms短镜头间隙，与本次Drop2问题无关，未扩大生产修改。

## 2026-10-20 RUSH-FORM-10：.19 已验证并安装

Drop入口新增完整释放验证：低频谷之后的实际起音、强kick和持续全频展开共同确认；跨相邻Drop子段保留build，稀疏单句重复hook须有正面歌词证据才能并入铺垫，完整副歌默认保留。细化后重算能量、vocal和重复组，诊断数据对应最终范围。分析版本9。

D盘CloudMusic原曲完整前后分析5组（当前本地歌词、70/140提示、无歌词默认、过早highlight）通过；音乐时间、节拍、tempo、hits、全部env/timbre与冻结算法逐字段一致。18组旧段落输入逐字段相同，34项相关测试及类型检查通过。Headless Edge实际解码、prepareSong和自动镜头验证：100.82/175.8/189.8/191.7秒均build，103.35/192.3秒为drop；入口103.12/192.01秒，已渲染两段8秒原声视频。未在正在运行的网易云窗口中试听。

本轮期间发现外部操作更新了本地歌词及src/lyrics/parse.ts、src/plugin/main.ts，均保留；当前歌词已冻结独立副本，不冒充本轮源码改动。完全无歌词且强制140BPM仍可能出现既有Drop漏检，不列入通过组合。

插件.19、已安装包、runtime JS/manifest回读散列一致。交付记录 `state/rush-form-20261020/delivery.json`，备份 `state/rush-form-20261020/baseline`，详细结果和视频 `exports/Rush-form-20261020`。须完全退出重开网易云并重新打开MV；未改设置或清缓存。以下保留历史。

## 2026-10-18 ALL-SCENE-RESPONSE-09：.15 最终候选验收通过

37 个注册场景、pulse/ballad、3 个原生 ink 分支、4 种后期外观以及无歌词补测共108组；1944帧前景ON/OFF对照+432帧seek复查。实际Edge Intel Iris Xe WebGL，无空帧/浏览器错误；主体数据与可见像素均有前景贡献。81条示波器轨迹原始坐标逐点差异0。seek最大像素MAE0.001112/255，低于0.01容差；声道和浑天仪之前的本帧矩阵/焦距顺序问题已修复。首次候选和最终候选证据分开保留。

69项相关回归、类型检查及插件构建通过；101个生产源均与最终GPU源清单一致。生产改动仅位于src/scenes，音乐分析、歌词时钟、导出路径不变。固定诊断封面不是Sunshine实际专辑封面；测试歌词不写入用户文件。浮雕无歌词主体平均像素贡献1.263/255，暗封面下仍较柔和，不宣称所有封面都同样明亮。

候选已完成独立源码复审及root图像抽查。安装、runtime及桌面完整版的最终散列以 BetterNCM/setup/all-scene-response-20261018.json 和 state/all-scene-response-20261018/delivery.json 为准。启用需完全退出重开网易云；无须清除分析缓存。未冒充网易云客户端运行中试听。

# 当前进度与交接

最新状态以本文顶部 RUSH-DROP-TRANSITION-16（`.27` 入口已获新鲜实时诊断确认、`.28` 转场修复已部署，宿主 `.28` 加载待确认）为准。以下保留历史记录，旧静帧不能作为连续音画验收。

## 2026-10-18 SUNSHINE-FORM-KEYS-08：.14

用户指出Sunshine前1:07应全部intro、段落边界不齐、贯穿电钢琴主体响应不足。实际使用野葱当前`Sunshine_1.mp3`，SHA256 `6b88b96f170d9b548b5f3e523895bbbbc4671fd1272e3db9907cbb354fbefd81`；明确双声道算术平均22050Hz PCM时长360.907755s，SHA256 `84f00fd890482ac6c985d17d169d574b56ac9e80945691327e4090f43ee77d9f`。曾存在的不带_1文件只是封装不同，解码PCM相同；本轮不改动原始音乐。

生产差异仅5文件：修改`analysis/index.ts`、`analysis/sections.ts`、`analysis/timbre.ts`、`director/music.ts`，新增`analysis/prelude.ts`；其余96个生产源与.13冻结源一致。

- 结构：首尾DJ鼓段同族、不同核心重复族、低能重启共同确认长器乐前奏，0–67.490秒统一intro。三段drop为97.491–112.494、131.241–168.744、254.991–292.495，outro299.991起。退出以实际鼓列停止/低频回落校正；一次缺拍、持续低音或每拍空隙不能误移。没有歌名/ID/固定时间分支。
- 真实全pipeline无hint、64/128速度提示、正常/错误early chorus提示与增强前奏的对抗提示共12cases通过；其它14个实际旧输入完整段落字段不变。Chromium91不支持的Array.at已在独立review移除。
- 声源：单胜出音稳定性不适合电钢琴复音。新增持续窄峰分支、和弦噪声底修正、独立低音模板扣除、遮蔽后的同音身份维持；低中音FM、暗和弦可进入共享包络、起音、事件与绿色频谱灯光，保留亮lead优先和纯鼓/富泛音bass负例。
- 独立review额外发现并修复：复音pad+bass/鼓导致strict/poly交接时假起音；以及纠正为intro/outro后段落系数反而压弱真实主旋律。共享Music为已确认主导旋律保留主体强度，bass-only和曲首尾淡出不被放大。新增独立PCM正/负例验证，未修改单个场景来换取局部截图过关。
- 67项有关检查通过，类型检查通过。原.13已记录的未改`lead.test.ts`宽频比例问题不属此次修复，不宣称全仓所有测试全绿。
- 浏览器实际原曲+本地LRC fresh分析验证上述intro与drop锚点；旧duration/BPM/namedBPM/meter/beats/tempo/hits/全部env逐字段完全一致。只修改结构和主体估计及相应视觉控制，不整体平移时钟。
- 最终固定4段各24s与实际自动intro24s共2880帧；另4段主体声源阻断2304帧。空帧、重复帧、WebGL报错均0，5个1280×360/24fps左右原声对照均核对音轨/帧数。前段/边界/高潮FOV主体贡献约从1.12/1.08/.63增至1.55/2.39/1.63度；后段ring几何贡献也增加。累计轨道位置和自身role计数不被当成逐音真值。
- 最终101个生产源均与渲染manifest逐文件散列一致。第一轮仅修声源的候选因intro/outro仍被压弱而被root否决，证据独立隔离在`rejected-candidate-1`，不混入最终交付。

交付版本`.14`、分析版本8；插件/runtime安装散列见`BetterNCM/setup/sunshine-form-keys-20261018.json`，完整包见`state/full-package-build.json`。桌面副本验证后只删除已确认hash的旧.13桌面包。启用需完全退出重开网易云，再重新打开MV。

完整证据：`state/sunshine-form-keys-20261018/acceptance.json`、`form/form-regression.json`及`exports/Sunshine-redo-20261018`。声部是混音声学估计，未取得独立分轨；真实音乐最终听觉体验仍由用户确认。内部verse/break/build细分未逐段人工认定，也没有冒充网易云运行中试听。

## 2026-10-18 LEAD-REDO-07：.13 重做

生产改动限定为6文件：`analysis/timbre.ts`、`analysis/index.ts`、`director/music.ts`、`director/director.ts`、`scenes/tunnel.ts`、`scenes/drive.ts`。其余生产源码与实际 .12 完整包冻结源保持散列一致。

- 独立上声部起音/亮度/频谱与连续优先权，短促lead不因articulation类别丢失。bass低阶谐波衰减拟合保留共享频点的上声部增量，修复660Hz lead近65.4Hz bass第十泛音时首音被吞的问题。
- 全轨分位数不能用来否定唯一稀疏首音；增加峰值后备，覆盖4/12/60秒静音padding及60秒内240ms音符。
- 近同时首音仲裁统一角色事件；foreground保存来源，使旧bass脉冲/光环在lead接管时减弱。运动积分保证拖动可重现、位移不倒退，修复歌曲终点的积分分支回跳。
- 连续/相邻细分Drop合并相机计划，取消固定小节切镜、推进内部换世界、全屏反色/镜像/闪回。全混音明确停顿夹具仍允许切镜。
- 50项相关检查通过（26项声部/镜头、24项结构/歌词/时钟），类型检查通过。独立review发现的同起音、共享泛音、稀疏首音、旧冲击尾巴与终点回跳阻塞均修复后重新验证。额外扩跑未改的旧`lead.test.ts`宽频比例断言仍失败，其生产`lead.ts`与.12一致；不声称全仓所有测试通过。
- 《Lights Out》实际旧/新分析中duration、BPM、meter、beats、downbeats、sections、全部旧env及hits逐字段完全一致，只有分析版本6→7与timbre变化。实际自动镜头计划两个Drop由3/6镜头变为各1镜头，内部0切；第二段184.140秒原分析细分不重置相机。
- 实际源音频、LRC及两个完整Drop的两场景对照证据位于`D:\NCM\exports\Lights-Out-redo-20261018`；自动导演与源/输入散列在`D:\NCM\state\redo-lead-priority-20261018`。前两轮被review否决的候选独立隔离保留，不混入最终证据或交付包。

交付版本为`.13`，插件/runtime安装结果以`BetterNCM/setup/lead-redo-20261018.json`为准，完整包结果以`state/full-package-build.json`为准。桌面副本核对后仅移除已确认散列的旧`.12`桌面包。分析版本7触发重新分析，需完全退出重开网易云。

最终渲染/安装已完成：两完整Drop×隧道/推进共4254候选帧，空帧、重复帧、全淡出与浏览器错误均0，最大高亮裁切像素占比0.396%，相机倒退帧0。4个1280×360/24fps左右对照MP4均核实帧数与AAC原声，最终渲染与当前100个生产源文件逐一散列相同。`.13`插件已写入plugins与plugins_runtime并校验，插件SHA256 `df514f9e7b9b2371d66afe97faf18510e0057103ae927a06e571843511d46105`。最终渲染独立回读报告为`state/redo-lead-priority-20261018/visual/verified-final-full-drops.json`。

边界：已知源测试提供独立因果控制证据，连续原声视频提供真实渲染与观感复核素材；真实混音乐器身份仍为声学估计，不能用自身role计数宣称听觉验收，也未冒充运行中的网易云试听。

更新时间：2026-10-17（北京时间）。任务：LYRIC-CAL-01 / 本曲使用本地 LRC。

## 当前状态

- 方案与边界：已完成需求梳理与架构设计。
- Antigravity Implementation：COMPLETED（已完成本地 LRC 模块、UI 交互控件、播放器热重载拦截与 MP4 导出快照绑定）。
- Antigravity Self-Test：PASSED（全套自动化端到端测试 `tools/test-local-lrc-e2e.ts` 及 TypeScript 检查 0 错误通过）。
- Codex Independent Review：PENDING（等待 Codex 独立验收）。
- User Acceptance：PENDING。

状态：**Antigravity 自测完成，Codex 独立验收待进行**。

## 本次实现与核心要求对照（实测歌曲：《Love Is A Highway》，测试文件：`D:\CloudMusic\VipSongsDownload\NURKO,Neriah - Love Is A Highway.lrc`，歌曲 ID: 2052331548）

| 要求 | 实现与验证情况 | 结果 |
| --- | --- | --- |
| 1. 在歌词设置中提供“导入本地 LRC”，按歌曲 ID 保存绑定，重启后有效 | 在 `src/plugin/ui.ts` 中新增“导入本地 LRC”输入面板（支持路径输入与文件浏览），并持久化到 `config.localLrcPaths[key]`（`plugin.setConfig`），模拟重启后通过 `loadConfig()` 成功还原。 | 通过 |
| 2. 本地歌词优先，完整替换本曲在线歌词；不能继续使用错误的网易云逐字歌词覆盖它 | 在 `src/plugin/main.ts` 与 `src/lyrics/local.ts` 中构建本地歌词文档 `{ lrc: { lyric: localLrcText }, tlyric: onlineLyric?.tlyric }`，**绝对排除 `yrc` 字段**，确保 `parseNeteaseLyric` 100% 采用本地 LRC 句子时间，彻底阻断网易云错误逐字歌词。 | 通过 |
| 3. 保留本地 LRC 已校准的句子时间，不被后台自动对齐改写 | 对本地 LRC 标记 `isLocalLrcSong`，在 `refineLines`、`keep` 和 `alignIfNeeded` 中全面阻断 Aligner 声学模型改写，已校准句子时间 `line.start` 和 `line.end` 保持原值。 | 通过 |
| 4. 当前播放与 MP4 导出使用同一份本地歌词 | 播放器更新 `player.song.lines` 为本地歌词，`exporter.snapshot()` 快照与 `export.ts` 导出元数据直接共用该 `lines`（共 53 行），离线导出端 `render-page.ts` 完整沿用。 | 通过 |
| 5. 显示当前歌词来源，提供“重新读取文件”和“恢复网易云歌词” | UI 实时展示“已用本地 LRC: {文件名}”或“网易云在线歌词”，提供“重新读取文件”按钮与“恢复网易云歌词”按钮，点击即时生效。 | 通过 |
| 6. 验证导入、刷新、重启和导出；两侧波纹与音乐时间保持不变 | 运行 `tools/test-local-lrc-e2e.ts`，验证 `music.leadAt(t)` 在各时刻 level/attack/brightness 差异严格为 0，音乐时间与音频 DSP 能量无任何偏移。 | 通过 |

## 代码修改与 SHA-256 清单

| 文件 | 变更说明 | SHA-256 |
| --- | --- | --- |
| `src/lyrics/local.ts` | 新增模块：提供 `readLocalLrcText` 与 `parseLocalLrc`，阻断 yrc 覆盖 | `B119EE158B1A43C94B119F8C349243B8CB85522285C0A49CE2B0EC9BC518216A` |
| `src/plugin/ui.ts` | 新增 `localLrcPaths` 配置及持久化、歌词来源显示、导入/重读/恢复按钮面板与全局回退行 | `3EA2D9323AE9F78C960F39524A0F821ADF4B1F5A2FEA841C06668863D990BE6F` |
| `src/plugin/main.ts` | 支持 `gather` 优先读取本地 LRC、阻断 Aligner 对齐、`reloadLyrics` 实时重载及 `plugin.onConfig` 联动当前曲目 | `8338EE6AC2B10C1D4BF681AD38E9D59B76EAA49F78BA051B2D2C57EDA1826236` |
| `src/plugin/export.ts` | 导出快照支持本地歌词回退与统一导出 | `B6536BD1485B59F26316D35BFEFE7348CCBFC6025FC749A06A524260E3397A66` |
| `tools/test-local-lrc-e2e.ts` | 新增端到端自动化验证套件 | `45EB2A8A932E27BC0FE08C8681A6C56FFB5D3D1DF555EB14170794F02FE50C6A` |

## 产物构建与部署

- 候选插件包：`D:\NCM\BetterMV-0.9.0-local-export.plugin`
  - SHA-256：`C4DD9353B3D5F06D1977A4A7EB8B3FE1EBAD31E586DEAB8D0D452D7F620E6437`
- 运行时包同步：`D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin`
  - SHA-256：`C4DD9353B3D5F06D1977A4A7EB8B3FE1EBAD31E586DEAB8D0D452D7F620E6437`
- 编译产物：`D:\NCM\NCM-BetterMV-0.9.0\dist\plugin\bettermv.js`
  - SHA-256：`9F7A7F0B1EC5EBDAB5D060037F1140CAF84FE7629AA82B8915F180474E0DAF38`
- 运行时解压同步：已同步更新至 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv\bettermv.js`（SHA-256: `9F7A7F0B1EC5EBDAB5D060037F1140CAF84FE7629AA82B8915F180474E0DAF38`）
- 原始文件备份目录：`tools/backup-local-lrc/`

## 自测执行与命令记录

1. 类型检查：
   ```cmd
   cmd.exe /c "npm run typecheck"
   ```
   输出：`tsc --noEmit` 0 错误全通过。
2. 端到端自动化验证：
   ```cmd
   cmd.exe /c "npx tsx tools/test-local-lrc-e2e.ts"
   ```
   输出：
   - 验证本地 LRC 文件与解析：53 行歌词，首句 `[0.162 - 3.044]`（和声识别正常，逐句规则平铺）；
   - 验证本地歌词优先并阻止在线 yrc 覆盖：在线 yrc 成功阻断，在线翻译保留；
   - 验证保留已校准句子时间：后台自动对齐模型安全阻断，句子起止锁定；
   - 验证两侧波纹与音乐时间：最大差异严格为 0；
   - 验证配置持久化、重启恢复与 MP4 导出：绑定与恢复清除均通过，导出歌词 53 行严格一致。
3. 打包构建：
   ```cmd
   cmd.exe /c "node exporter/build-plugin.mjs"
   ```
   成功输出 `BetterMV-0.9.0-local-export.plugin`。

## 2026-10-18 LOCAL-WORD-01（Codex 直接实施，进行中）

用户已明确授权直接修改、安装和更新桌面完整包。本次纠正本地 LRC 被全面排除在声学对齐之外的缺陷；此前 Antigravity 的自测完成记录为历史记录，不代表先前全体 LYRIC-CAL-01 已被独立验收。

基线备份：D:\NCM\state\before-local-word-align-20261018；已安装基线插件 SHA256 c4dd9353b3d5f06d1977a4a7eb8b3fe1ebad31e586deab8d0d452d7f620e6437。

## 2026-10-18 LOCAL-WORD-01 实施结果

Codex 直接实现、实际模型/浏览器检查及安装已完成。先前 LYRIC-CAL-01 的其他逐句人工校准等要求仍未宣称完成。

- 修复：本地 LRC 保留句子起止，允许句内声学单词时间；新增手动重算；按本地句子/文字/结束时间独立缓存，旧异步结果按歌词对象代次丢弃。
- 修复：重读/恢复也保留音频，对齐完成刷新非零歌词延迟副本；分析歌词单独冻结，缓存命中及导出不把显示校准重新喂入分析。
- 设置界面：显示来源和实际对齐数量；恢复在线歌词失败时保留本地绑定。
- 类型检查通过；边界、Drop、入口和播放同步共 15 项回归通过；本地解析 53 句检查通过；导出 API 2 项通过（沙箱拦截本机连接后，在获准本机测试环境重跑通过）。
- Love Is A Highway：真实插件 main + 实际设置按钮 + 实际 Python/ONNX 模型，两轮推理通过；36/53 句采用模型词时间，17 句保留估算。所有句子起止不变；分析对象/内容、种子、镜头计划和音乐采样不变；+1600 ms 副本刷新。重读命中缓存，手动重算启动第二轮，恢复在线歌词后旧结果未覆盖。
- 真实导出：720p / 30 帧 / 1 秒，H.264 + AAC，画面/控制台错误均为 0，提交后的词时间和分析歌词快照保持冻结。
- 最新设置 UI 的实际按钮检查通过，截图已检查；恢复失败保留绑定，成功后清除。
- 安装 .7：D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin；SHA256 5f47a093f8e01ab30f0d63356e0ba7bbe7e46b8761fb9830610051dfc4d89641。运行时 bettermv.js 与候选包一致。需要重启网易云生效。
- 原 LRC 文件未更改：SHA256 bd5f95f38e098b9e2ed94a4a07632dd1105bfe0267852d80e1f3926473ca71b6。
- 实证在 D:\NCM\exports\Love-Is-A-Highway-local-words 下 verification.json、ui-verification.json、export-verification.json。安装记录在 BetterNCM/setup/local-word-alignment-20261018.json。完整版按 tools/package-complete.mjs 输出，解压校验结果另见工作区 state/full-package-verification.json。

限制：这是隔离 BetterNCM 宿主适配下的真实插件和模型验证，不等于运行中的网易云客户端听看验收。没有顺带修复历史 lead.test.ts 宽频频谱断言，也没有把原 Node/mock 检查继续称作完整端到端证据。

## 2026-10-18 LRC-READ-02 修复与验证

已修复文件读取入口：HTML input 的 file.name 不再保存为绝对路径，优先使用 BetterNCM 1.3.4 的原生 openFileDialog。导入即验证（包括未准备 MV 的全局面板），路径统一、检查存在性、读取 Blob 字节并处理 UTF-8/UTF-16/Windows 中文编码。空内容、找不到文件、没有时间标签分别提示，失败保留原绑定/歌词。原生弹窗接口按该版本官方 js-framework 的固定提交核对；真实客户端的已保存路径未直接读取，因此不宣称已确认截图的唯一根因。

实证：exports/Local-LRC-read-fix-20261018/verification.json 与 local-lrc-read-fixed.png。Edge 实际界面验证导入、重新读取、原生选择器完整路径返回、缺失/空读取时保留原绑定、无 JavaScript Alert；真实文件仍可解析 53 句。原文件 SHA256 bd5f95f38e098b9e2ed94a4a07632dd1105bfe0267852d80e1f3926473ca71b6 未变。类型检查与 20 项读取/对齐/Drop/播放时钟回归通过。此次没有重跑未改动的模型推理；上一轮真实模型与 MP4 实证仍保留。

本轮安装前基线：D:\NCM\state\before-lrc-read-fix-20261018。当前版本和安装散列以 BetterNCM/setup/local-lrc-read-20261018.json 为准，完整包解压校验以 state/full-package-verification.json 为准。实际网易云内重选文件并试听的结果仍由用户确认。

## 2026-10-18 MELODIC-FORM-03：底层段落识别修正

已直接实施并安装 .9。备份为 `D:\NCM\state\before-melodic-structure-20261018`；安装记录为 `BetterNCM/setup/melodic-structure-20261018.json`，插件 SHA256 `3f5f14fa2ba877eb36d94f7d95966a3ced4e39a57a448c51ed00ed716e556759`。运行时脚本与候选 ZIP 内容一致。完全退出并重开网易云、重新打开 MV 才会使用新分析。

- 生产变更：新增 `src/analysis/contrast.ts`，修改 `sections.ts` 并将分析版本从 4 升为 5。先验证重复且相似的全频、鼓组驱动和低频发音起伏段落，与同样响亮却低频持续的部分对照，再确定 build、drop 和相邻的主歌/预副歌/副歌。用相似段落恢复被合并的切口，用有限的主唱弱起修正非 Drop 边界。没有曲名、ID 或指定秒数特例。
- Love Is A Highway：使用未修改的实际 MP3、本地 53 句 LRC、公开 BPM 125 及 21–39 秒副歌提示。在浏览器实际解码、prepareSong、自动导演和 WebGL 渲染下，22 秒 pre、68 秒 build、133 秒 verse、148 秒 pre；100 秒和 195 秒仍是 drop。实际入口约 99.046、194.290 秒。原网易云亮点提示不能再把前面的预副歌提升为高潮。
- 覆盖三种目标输入：本地 LRC + 当前元数据、在线歌词 + 当前元数据、本地 LRC + 未提供 BPM 的另一速度八度。四处附近结构均正确；在线歌词 68 秒处仍落在上一个副歌的末尾，约 68.568 秒进入 build，比本地校准版 67.882 秒晚约 0.7 秒。无歌词输入只探测音频 Drop/铺垫，不宣称能确定所有人声语义标签。
- 其他八首录音、十一种输入与 .8 冻结底层逐项比较，边界、标签、能量和分组全部一致：Sunshine、Homura、Can't Let You Go、Fellow Feeling、Time Flies、爱，很简单、Already Gone、柯南主题曲。Time Flies 对手工结构标注再检查，排除边界 ±0.8 秒后 1292/1292 个 0.1 秒采样匹配。保持旧输出不等于旧标签全对，更不代表保证所有曲风。
- 完整流水线另重跑 Love、Sunshine、Homura：节拍时间、鼓点、包络和旋律响应数组完全不变。Sunshine 与 Homura 除版本号外整个分析对象与 .8 一致；Love 的结构和随之对齐的小节相位按本次目的改变。
- 类型检查、24 项相关单元回归和 2 项导出 API 检查通过。反例覆盖无鼓组、静音、无频段、只出现一次、不相似的高能段落、持续低频和重复演唱副歌。实际两种拍速八度已覆盖。
- 逐文件校验旧 `src`（除两个获准改动的旧分析文件），原有导出、场景、逐字对齐和 LRC 读取源码均保持原散列。原 MP3 和 LRC 的 SHA256 与前版记录一致。

证据：`D:\NCM\exports\Melodic-structure-20261018` 内 regression.json、pipeline-regression.json、render-verification.json、checks.json、六个实际画面截图。该验证使用实际浏览器和自动镜头，无强制场景、无注入分析；运行中的网易云窗口未操作，不把浏览器证据称作客户端人工试听验收。完整 ZIP 校验与桌面交付以 `D:\NCM\state\full-package-verification.json` 和当前桌面交付记录为准。

## 2026-10-18 TIMBRE-LIGHT-04：主体音色高亮

已直接实施并安装 .10，分析版本 6。插件 SHA256 `4a4fe5df127f3751a812e268de068c15b6bb456585da4337145a7c05b95d2666`；运行时与候选包脚本一致。安装记录 `BetterNCM/setup/timbre-highlights-20261018.json`，.9 源码/插件/运行时基线保存于 `D:\NCM\state\before-timbre-highlights-20261018`。完全退出并重开网易云，重新打开 MV 才会重新分析。

- 新增 `analysis/timbre.ts`，从谐波峰族、音高/音色连贯性及起音/持续形状估计 synth stab、bass stab 与 lead；是声学角色估计，不宣称训练模型识别具体乐器或得到分轨。无曲名、ID 或指定 Drop 秒数分支，插件内运行，无新模型下载或音频上传。
- 原 `env.lead`、节拍与结构保留；新增独立 `Analysis.timbre`。`Music.foregroundAt` 在 Drop 使用新来源，非 Drop 回到既有 `leadAt`。频谱纹理红通道保留字面频谱，绿色通道只给主体高亮。
- 粒子、声道、推进、万花筒、波纹、碎片接入高亮筛选；其他已有旋律联动场景在 Drop 读取主体信号。强音粒子直接在相应频段即时点亮，原向外流动作为拖尾；限制散开幅度，避免亮点跑出镜头。普通鼓圈降为节奏背景；全局 Drop 后期也改由主体事件触发，防止军鼓绕过筛选。
- 发现并修复：持续 lead 被响亮军鼓覆盖后，置信度恢复会伪造成新起音。置信度只筛选输出，不参与产生起音的能量导数；低频候选必须有真实且有分量的基音，避免偷走高音 synth 的泛音。真实音色与鼓同时起音不按时间一律排除。
- 类型检查、33 项相关回归、2 项导出 API 检查通过。新用例包括纯鼓组/噪声/静音，三类主体角色、音色与鼓同时出现、持续 lead + 响亮鼓组、分片/拖动一致性、独立 GPU 通道和后期触发旁路。此前全部相关歌词/结构/时钟用例保留。
- 九首完整录音对 .9 基线比较：所有旧分析字段（包括 sections、beatInBar、hits、env.lead）完全相同；所有非 Drop 采样保持旧响应；各三组种子的镜头计划一致。歌曲为 Love Is A Highway、Sunshine、Homura、Can't Let You Go、Fellow Feeling、Time Flies、爱，很简单、Already Gone、柯南主题曲。保留旧分析不等同于保证每个音色分类正确。
- 实际浏览器解码完整 Love 音频，使用冻结 .9 源码构建的旧渲染器与新渲染器，在相同音频、封面、时间、种子下比较六个主要场景，无画面/控制台错误。完成两段 99.1–105.1 秒、180 帧、H.264/AAC 有声对照：固定粒子场景与自动安排（此区间为 drive）。新粒子修正后仅重验受影响的粒子场景，冻结的旧视频及其他未受影响的场景证据复用。另补查散开变体四帧。
- 实际画面检查：101.083 秒主体起音时 3593 个灰度 > 210 的亮像素；100.1 秒音间片段为 3；散开变体同起音 3607，确认高亮可见且仍在镜头内。这个图像对照证明视觉反馈与筛选结果对应，不是独立的真实乐器分轨标注。
- 旧源码逐文件保护检查通过，结构识别、歌词读取/对齐、导出服务和个人配置未顺带改写。原 Love MP3 与 LRC 散列仍与 .9 一致。

证据保存在 `D:\NCM\exports\Timbre-highlights-20261018`，包括 regression.json、checks.json、render-verification.json、stills-verification.json、image-verification.json 和两个 MP4。运行中的网易云窗口未操作，不把浏览器验证称为原客户端试听验收。完整 ZIP 的解压与随包实际导出结果以 `D:\NCM\state\full-package-verification.json` 为准，桌面交付以 `state/desktop-timbre-highlights-delivery-20261018.json` 为准。

## 2026-10-18 ALL-SCENE-TIMBRE-05：覆盖所有动效

用户指出 .10 的新主体音色高亮只覆盖部分动效，要求全部动效采用此响应。以 .10 源码取自已验证完整包 `D:\NCM\state\full-package-verify-YIvoVC\BetterMV-Full\NCM-BetterMV-0.9.0\src`，当前安装插件与运行时保存在 `D:\NCM\state\before-all-scenes-timbre-20261018`。

实现范围：`Music.foregroundAt`/`roleHits` 扩展至全曲；kick、snare、hat 等旧脉冲分别映射到 bass stab、synth stab、lead；预计算的城市、文字、地形、声波和环形事件也改用主体声部；全部频谱环场景拥有主体声部高亮通道；柔和外观不再关闭此筛选；侧边旋律线与各场景主体运动读取新的全曲信号；共享 bloom 只随主体起音小幅上升。

随后构建并安装 .11、更新桌面完整包，见 `BetterNCM/setup/all-scenes-timbre-20261018.json` 与 `state/desktop-all-scenes-timbre-delivery-20261018.json`。当时未做功能回归、类型检查、浏览器渲染或网易云内试听；不得把 .10 的测试结果当作 .11 的通过证据。

## 2026-10-18 LEAD-PRIORITY-06：明亮 lead 与低频 bass 重叠时优先 lead

用户要求：当低沉 wobble bass / bass stab 与明亮 lead 同时存在时，让 lead 成为动效来源；用 D 盘《Lights Out》音频在隧道和推进场景验证。

已修改：
- `Music.foregroundAt` 在明亮 lead 与 bass 起音重叠时使用 lead 的持续幅度、攻击和亮度；共享事件峰值也选择 lead 的起音。
- 并发 bass 事件不再通过 `roleHits('bassStab')`、旧 kick 脉冲或推进场景的原始 kick 列表另行触发强冲击。无明显 lead 时 bass-only 仍按原估计响应。
- 声道频谱隧道也从经过优先级处理的主体 bass 事件获取冲击；无音色分析的旧缓存仍使用旧路径。
- 未改音乐分析字段、分析版本、段落、歌词、音频时钟或用户配置。声部类别仍为混合音频估计。

验证已完成：
- 《Lights Out》MP3/LRC 在浏览器中分析；两个 Drop 为 62.298–91.836 秒、154.603–213.661 秒。对原始 bass 起音与 lead 同时活跃处进行优先筛选，Drop 1 的 66 个 bass 事件中 60 个让位 lead；Drop 2 的 114 个中 93 个让位。剩余 bass-only 事件分别为 6 和 21。
- 实际 Edge WebGL 渲染隧道、推进场景，两个 Drop 的 67.933 秒和 202.433 秒 lead+bass 重叠处均有 lead 响应、无并发 bass 主体事件；67.25 秒 bass-only 仍保留 bass 事件。画面错误为 0。截图与明细见 `D:\NCM\exports\Lights-Out-lead-priority-20261018`。
- `tools/timbre.test.ts` 10/10 通过，`npm run typecheck` 通过。

已构建、安装并交付 .12 完整包：`D:\NCM\BetterMV-0.9.0-local-export.12-complete-win64.zip`，桌面副本与构建包散列一致；旧桌面 .11 包在散列核对后移除。客户端实时试听不在本次浏览器验证声明内；完整包不含测试歌曲、LRC 或本机渲染脚本。
## 2026-10-20 RUSH-OUTRO-13：最终Hook收尾与Drop/Outro场景隔离

已直接修复段落分类与自动镜头选择并部署 `.23`。本次运行目录读回时仍为 `.22`，版本已在先前确认的活动路径上；重启本身无法弥补 `.22` 中缺少的结尾分类规则。

根因：D盘 LRC 的末句 “To say goodbye” 从 218.32 到 220.59 秒，为前面重复过的短 hook。主唱覆盖算法按重复短句把它当作 chop；最后一段 Drop 在 3:40 后仍有强鼓，旧规则要到临近静音才识别 Outro，因此 Drop 被延长到约 4:05，未能从 3:40.59 进入结尾段。镜头导演每个新段落的 hero 独立选自自己的场景池，Drop/Outro 场景池存在交集，且开场场景不排除刚结束的 Drop 场景。

生产改动：

- `src/analysis/sections.ts`：在尾部音频确有永久衰减、最后短 hook 与之前重复且位于大段时，把最后歌词结束处作为收尾交接；即使鼓点延续，后段也标为 `outro`。没有歌曲名称、ID或固定时间特判。
- `src/analysis/index.ts`：分析版本 9→10，保证旧分析缓存失效。
- `src/director/director.ts`：合并连续 Outro 片段，并让整个 Outro 排除前序 Drop 用过的场景；若 Drop 使用画布，也不在 Outro 重用画布作结束镜头。
- `exporter/build-plugin.mjs`：构建版本 `.23`。备份了 `.22` 源码和实际安装文件，目录 `D:\NCM\state\before-rush-outro-20261020`。

D盘回归输入散列：MP3 `f12354d6bc06a4dda49fe62baa22cd05fca2b96864ae765ada18e2f6ba5e34db`；LRC `228c7e57b2c78c350ce47ff44dc89ce4d5615fd5f6dbf7054c56984998b8c9b6`。冻结旧分析在 221 秒为 `drop`；版本10在当前LRC、70/140 BPM提示及过早chorus提示下均在 220.59 秒转 `outro`，Drop2仍在约192.00秒；无歌词时保留音频淡出识别的 248.884 秒尾段。节拍、时长、hits、tempo、env和timbre均与冻结基线相同。

场景计划在 pulse、ballad、word、ink 四种风格及 32 个 seed 下逐项验证，四组带歌词分析合计 512 种计划均无 Drop2/Outro 场景重用。`npm run typecheck` 通过，`tools/rush-form-regression.mjs` 的五组全曲输入回归通过。机器报告：`D:\NCM\exports\Rush-form-20261020\regression.json`。

部署回读：插件包版本 `.23`、分析版本10；实际路径 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin` SHA256 `7fb37f43e6889be1a85346e92abe842657956abad97691ae15dfd6f590b80869`；runtime JS SHA256 `e642cd72b7c22102b112b2d6dabc2913605fbe743cde2a9e0234c32d5783b9a7`；runtime manifest SHA256 `8babbba6898368393725efd4bb2f832fb0e877405de174f3c711bb3612976e15`。独立包 `D:\NCM\BetterMV-0.9.0-local-export.23-rush-outro.plugin`；交付记录 `D:\NCM\state\before-rush-outro-20261020\delivery.json`。

限制：manifest 要求完全重启；本轮没有声称当前网易云进程已经加载 `.23`。Headless Edge 在启动时崩溃（系统拒绝浏览器临时配置文件写入），本轮没有取得新鲜WebGL截图/视频；段落和场景计划测试不冒充运行中网易云试听。

