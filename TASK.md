# 当前任务：PHOENIX-LEAD-COLOR-18（2026-10-23）

针对 BetterMV 涅槃舞台场景（`src/scenes/phoenix.ts`）完成三大维度的声光与写实视觉升级：
1. **双 Lead 代表色系统与人声融合机制（`src/scenes/phoenixLeadColor.ts`）**：
   - 提取专辑封面主双色体系，构建 A、B 两套四级热度色板（`core`、`bright`、`mid`、`deep`）。
   - 接入音轨分析器（`lead` 与 `keys/synth` 持续包络、起音强度与分离度/主导度），动态生成 30fps 平滑控制轨迹（`uLeadA`、`uLeadB`、`uLeadShareB`、`uColorFusion`、`uLeadGlow`、`uLeadPulse`）。
   - **动态色彩流动与人声融合**：无人声（纯器乐）时，音响光环、火凤羽流与水面反射由 A / B 两套代表色独立驱动，色块分明、各具流向；当有人声介入（根据 `vocal` / `lyrics` 活跃度与句段能量）时，两套代表色发生柔和融合（`uColorFusion` 平滑抬升），人声结束后平滑还原。
2. **写实猛禽特征与羽毛质感重塑**：
   - **头部与颈部写实化**：重塑头部与喙部体块，引入苍鹰式坚硬向下勾喙（`evalBeakRealistic`）、平直深邃眉弓阴影（`browShadow`）、饱满后枕与自然放大的粗颈（`dHeadDome`、`dNeck`），彻底消除原本机械/动漫剪影感。
   - **翼面覆羽质感**：新增多层密集鳞瓦状覆羽与羽流交错阴影（`evalCovertFeathers`、`occluderShadow`），形成层次分明、光影深邃的写实猛禽翼面。
3. **粗壮大圆音箱光环与细节伪影修复**：
   - 保留正面板 ~91% 比例的发光圆环与内凹凹面振膜（`evaluateGiantSpeaker`）。
   - 修复光环外侧放射状色楔伪影：压缩 `wBHalo` 的过渡范围至本体内核（`0.002..0.008`），外部漫射与下冲光晕直接使用场景主导色 `wBAmbient`，消除极坐标/大尺度噪声在外部空气中拉出的扇形硬边缘。
   - 修复凤凰背焰薄火区域色斑：通过 `bgTongueMask`（火舌浓密程度门限）加权，稀薄外焰与羽端淡入主导色，消除突兀颜色跳变。

验证与部署：
- `npm run typecheck` 通过（0 错误），`npm run export:test` 通过（2/2 通过），`npm run export:build` 构建通过，版本递增至 `0.9.0-local-export.31`。
- 使用真实 Edge/Direct3D 11 运行 `tools/verify-phoenix-lead-color.mjs`，在 `D:\NCM\state\phoenix-lead-color-20261023\verification\renders\` 下生成全套渲染图（含全画幅、特写、跨封面取色）、多组前后对比图（`compare-*.png`）以及 8 秒 30fps 连续播放动画视频（`after-phoenix-stage-playback.mp4`，6.93MB）。
- 已部署至 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin` 与 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv\bettermv.js`，读回 SHA256 与构建产物完全一致。`require_restart=true`；当前确认磁盘部署与本地浏览器 GPU 渲染验证完成，需完全重启网易云音乐客户端加载生效。

## 历史任务：PHOENIX-STAGE-REFINEMENT-17（2026-10-22）

参考 ILLENIUM《Awake》专辑封面（`public/awake-cover.jpg`）的结构、光影、比例与材质关系，对涅槃舞台场景（`src/scenes/phoenix.ts`）的巨型音响、火凤、中央专辑封面排布及湿润地面反射进行精细化打磨，同时严格保持动态专辑封面取色体系（不写死橙金配色）。

核心改进：
1. **两侧巨型立体音响（`evaluateGiantSpeaker`）**：突出单一主要大圆单元（`ringRadius = 0.0835`，上方小圆单元存在感降至 `< 2%` 暗部微痕）；建立箱体正面板与朝向舞台内侧立面的三维转角厚度与受光关系，去除整圈等亮描边与机械斜纹网罩；将箱体正面、发光圆环与内凹振膜统一到内倾透视关系下，表现单元嵌入箱体的内凹边壁（`inRecessWall`）、悬边立体明暗（`inSurround`）、柔和凹面振膜掠射受光（`concaveGrazing`）与中心防尘帽过渡；发光圆环分出高亮内核、火焰日冕过渡带与非对称外围辉光三层（使用二维平面坐标 `ringPlaneUv = dpPersp * 24.0` 采样火焰噪声，彻底消除极坐标角度采样造成的径向射线伪影），并通过前景体积烟雾（`speakerBaseMistLight`）自然漫射音箱下方暖雾光池。
2. **涅槃火凤（`evalWingSpine`、`evaluatePhoenixAndFire`）**：区分贴近身体的暗部覆羽（`dCovertWing`）与外侧散开的 13 簇次级/内侧初级飞羽 + 6 簇翼尖指状初级飞羽，引入长短、间距、弯曲、朝向差异与邻近羽片遮挡阴影（`occluderShadow`）；去除上翼缘完整高亮描边，加宽肩背与胸腹过渡体块（`dShoulderMass`、`dTorso`），自然收拢头颈与 3 束短羽冠，将尾羽整理为 7 束前后双层交叠扇面；火焰沿覆羽齿状下缘、飞羽羽叶、翼尖、尾端与背部冠冕连续而断续地分布（`flameRootY` 锚定于 `covertChordFrac` 与 `covertScallop`，消除翼面中段僵直分界线）；扇翅与悬浮动力学沉稳克制，具备翅根→腕部→翼尖→尾羽的相位传递。
3. **中央专辑封面与舞台空间层次（`evaluateCenterAlbumScreen`、`renderUpperStage`）**：中央门廊中上部（`y = 0.586 .. 0.946`）完整呈现 1:1 比例原专辑封面，不裁切下半部分、不涂改封面内容；前景火凤悬浮于 `y ≈ 0.504`，与封面内部图案在纵向与景深上自然错开，避免双凤重叠。
4. **湿润地面反射与整体光影（`renderStageFloor`）**：水面保留深邃暗部混凝土地基，反射光柱与两侧音箱光环及中央火凤位置严格对应，并由横向水波纹与地坪接缝自然打散；前景冥想人物底部接触暗部与被水纹打散的倒影自然接地。

验证与部署：
- `npm run typecheck` 通过（0 错误），`npm run export:test`（2/2 通过），`npm run export:build` 通过。
- 使用 Playwright + Headless Edge WebGL2 实际 GPU 渲染基线与改后全画幅、局部特写（音响、火凤、水面）、跨封面取色测试（冷蓝封面与默认封面）、同画面前后对比图（`compare-*.png`）以及 8 秒 30fps 连续播放视频（`after-phoenix-stage-playback.mp4`），全部保存在 `D:\NCM\state\phoenix-stage-refinement-20261022\verification\renders\`。
- 已部署至 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin` 与 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv\bettermv.js`，读回 SHA256 与构建产物完全一致。`require_restart=true`；当前确认磁盘部署与本地浏览器 GPU 渲染验证完成，尚未声明运行中的网易云宿主进程已加载新版本。

## 历史任务：RUSH-DROP-TRANSITION-16（2026-10-21）

用户已确认 Drop 位置正确，反馈前一段进入 Drop 时闪黑。新鲜网易云 `.27` 诊断（北京时间 2026-10-21 12:43）确认律动 `pulse` 的第二 Drop 从 192.01 秒开始；本轮保留该段落结果，不再改分析器或歌词源码。

根因是 `director.ts` 的通用 Drop 前预黑规则：在 Drop 前半拍强制 `fx.fade=1`。律动本身 `dip=0`，而水下场景已屏蔽双色冲击帧，不能把这首歌的黑闪归因于水下入场或冲击帧。冻结 `.27` 的真实 GPU 连续渲染复现了预黑。

修复：移除强制预黑；不同场景进入 Drop 时用最长 180 毫秒、四分之一拍的短叠化，完全在已确认的 Drop 入口前完成，入场场景保持首帧。字符屏等外观同步渐退，避免最后一帧突然关闭。Drop 不再触发通用双色冲击/切片故障/可选暗场，保留入拍推进和其它段落原有转场。生产源码差异仅 `src/director/director.ts`、`src/render/shots.ts`、`src/style/style.ts`，全部分析/歌词源码与 `.27` 基线一致。

验证完成：相关测试 35/35、类型检查、插件构建通过。使用 D 盘原 MP3/LRC 及内嵌封面，在 Edge / Intel Iris Xe 实际 GPU 上以律动固定 seed 0 连续渲染入口前后，60 fps、旧新各 72 帧；使用上述实时 `.27` 的段落边界和实测能量，旧新镜头计划完全相同。旧版预黑标记 26 帧，新版 0 帧；新版无平暗空帧、无浏览器错误。已查看入口前、入口和入口后一帧。证据是本地浏览器渲染，不是网易云窗口取帧，也不代表所有随机镜头都已逐一视觉验收。

`.28` 已安装到 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin` 和 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv`，包、运行时 JS、manifest 与构建产物逐项读回一致。旧 `.27` 和源码基线保存在 `D:\NCM\state\rush-drop-transition-20261021`。`require_restart=true`；只确认新版本磁盘部署，尚未取得网易云加载 `.28` 的运行中证据。

对照视频：`D:\NCM\exports\Rush-drop-transition-20261021\Drop2-before-after.mp4`（左旧右新）；机器验证 `verification.json`；交付散列 `D:\NCM\state\rush-drop-transition-20261021\delivery.json`。

## 历史任务：RUSH-DROP-ENTRY-15（2026-10-21）

用户再次确认 Drop2 仍从约 194.9 秒才出现，要求优先检查段落分配源码。`.26` 的新鲜网易云分析 JSON 确认它确实跑了 `.26`，但仍输出 175.73–194.90 秒 build、194.90 秒起 drop。旧诊断只保存最终段落，没有保存粗切点和候选拒绝指标，所以不能把某个具体音频阈值说成已证实的实时触发原因。

源码层的缺陷已确认：`.26` 的回溯虽然搜索了粗切点之前，但候选时间仍依赖强 kick 列表（强度 ≥0.65）；缺失/偏弱的在线 kick 标记会使回溯没有候选，194.90 秒附近的既有支持又会保留晚切点。已在 `src/analysis/entries.ts` 增加与 kick 列表无关的低频、高频、RMS 持续包络回扫；粗切点偏早时仍要求 kick 支持，避免孤立填充音把 Drop 前移。没有加入歌名、歌曲 ID 或固定秒数分支。

新增 Rush 运行诊断：记录 DP 原始粗切点、184–199 秒附近边界新颖度/歌词/低频指标、最终标签信息，以及每个 Drop 候选的回扫范围、参考能量、通过/拒绝项和选定入口，写入既有 `rush-over-me-live-analysis.json` 的 `analysis.sectionTrace`。这使新版本的在线复测可以区分“原始分段切点偏晚”与“入口确认未回扫成功”。

验证：类型检查通过；Drop preparation 单测 13/13 通过；D 盘原 MP3 的本地歌词、70/140 BPM、无歌词和早副歌提示共 5 组全曲回归通过。人为把粗切点设为 194.90 秒后，常规 kick 列表和空 kick 列表两种输入都将 Drop2 恢复至 192.01 秒；191.7 秒为 build、192.2 秒为 drop，Outro 仍为 220.59 秒，Drop/Outro 场景互异回归 4 风格 × 32 seed 通过。插件构建通过。

`.27` 已逐项部署到 `D:\NCM\BetterNCM\plugins\BetterMV-0.9.0-local-export.plugin` 和 `D:\NCM\BetterNCM\plugins_runtime\ncm-better-mv`，散列与构建包匹配；`.26` 安装文件备份在 `D:\NCM\state\rush-drop-segmentation-20261020\installed-before`，源码及文档基线在 `source-before`。`require_restart=true`；检查时网易云进程未运行，因此当前仅确认磁盘部署，未声称 `.27` 已由宿主加载。旧的 live JSON 仍是 `.26`，在线 `.27` 实时段落复核待应用下次启动/分析后读取新 `sectionTrace`。

详细机器记录：`D:\NCM\state\rush-drop-segmentation-20261020\delivery.json`；D 盘原曲回归：`D:\NCM\exports\Rush-form-20261020\regression.json`。

## 历史任务：RUSH-DROP-ENTRY-14（2026-10-20）

用户明确网易云选择的是律动风格，保存配置也是 `pulse`。当时 D 盘源音频分析得出的第二 Drop 边界为 192.01 秒（3:12.01），律动 seed 20261020 计划使用 `underwater/dive`。该镜头原本用 2.4 秒从浅层下潜至完整高潮深度，造成段落已进入 Drop、画面却约在 3:14 才显出完整 Drop。

修改 `src/scenes/underwater.ts`，令 Dive Drop 从首帧到达完整深度；普通 Dive 镜头保留原 2.4 秒入场。分析版本、歌曲/LRC、用户配置不改。类型检查、7 项镜头测试和 D 盘原曲 5 组分析回归通过。真实网易云运行中取帧未完成，不能把磁盘部署称为宿主已加载。交付记录：`D:\NCM\state\before-rush-drop-entry-20261020\delivery.json`。

## 历史任务：RUSH-OUTRO-13（2026-10-20）

修复 Rush Over Me 3:40 附近重复 hook 后的 Outro 漏检，并保证最终 Drop 与 Outro 不复用场景。根因已定位为段落分类器和镜头选择器：最后一句重复 hook 被主唱覆盖过滤；因后续 Drop 鼓组仍强，旧尾段规则一直把它标为 Drop，直到临近静音才标 Outro。不同段落的开场场景池也会重叠，段落 hero 选择没有排除最终 Drop 用过的场景。音源路径不是此次根因。

已修改 `sections.ts`、`analysis/index.ts`、`director.ts`：以重复的最后一句、其后真实尾段衰减作为泛化收尾证据；Outro 从最后歌词结束处切入；分析版本升至10以使旧段落缓存失效；Outro 场景排除此前 Drop 场景，最终画布也避免复用 Drop 画布。无曲名、歌曲ID或固定秒数分支。

D盘原曲/LRC回归定位Outro于220.59秒、Drop2于约192.00秒；四种风格、32个镜头seed分别验证Drop/Outro场景不相同。`.23` 已部署到 `D:\NCM\BetterNCM\plugins` 和 `plugins_runtime\ncm-better-mv`，包与runtime逐项回读核对；回退基线及部署记录见 `D:\NCM\state\before-rush-outro-20261020`。插件要求完全重启；本轮未声称网易云进程已加载`.23`。Headless Edge启动失败，故无本轮实时画面截图验收。

## 历史任务：RUSH-LOCAL-AUDIO-12（2026-10-20）

此前 `.22` 修复本地曲目同名音频与歌词热重载分析来源，并部署到实际插件/runtime目录。它保留分析版本9，没有处理最终重复hook作为Outro起点；本轮 `.23` 解决后续分类和场景问题。详细历史记录保留在 `STATUS.md`。

# 历史任务：RUSH-ARMILLARY-11（2026-10-20）

用户反馈3:11附近浑天仪再次出现，影响Drop2画面进入。冻结.19后检查实际镜头，修复“每次Drop前都尝试插入浑天仪”的通用策略：只在首个实际Drop前尝试编排，首段不足时跳过，不延后补放；保留结束gather及禁用设置，不修改已验证的音乐段落和时间轴。原曲连续前后对照、相关测试与类型检查后交付.20。

证据：`D:\NCM\exports\Rush-armillary-20261020`；备份和交付散列：`D:\NCM\state\rush-armillary-20261020`。以下保留历史。

# RUSH-FORM-10（2026-10-20）

用户要求定位并修复 Rush Over Me 约1:40人声短句与2:55 build-up导致Drop提前的问题，用D盘CloudMusic原曲检验。只对通用结构入口增加声学验证，不写歌曲名称、ID或固定时间分支；保留歌词、原音频、旋律动效和个人配置。冻结源码及运行时后，检查完整原曲、原始/当前歌词快照、速度八度、自动镜头与现有歌曲回归，交付.19、分析版本9。

最终状态及证据见 `STATUS.md` 顶部和 `D:\NCM\exports\Rush-form-20261020\修复与验证说明.md`。以下保留历史任务。

# ALL-SCENE-RESPONSE-09

用户要求将动效响应应用到所有场景。以现有 .14 为冻结基线，补齐全部 37 个注册场景的前景主体运动及起音高亮，包含 pulse/ballad、原生 ink 分支、歌词缺省和四种后期外观。所有场景消费共享的 lead/keys/synth/bass 仲裁，不能用 overlay 或全屏后期冒充主体响应。保留 literal 波形数据和歌词时间，不改变音乐分析/段落算法。

安装前基线：`D:\NCM\state\all-scene-response-20261018\baseline`。逐场景真实 Edge WebGL 检验使用相同原声与冻结镜头种子，对照关闭 accepted foreground 的画面；同时检查连续采样、主体数据与拖动一致性。以相关回归、类型检查、实际 GPU 结果和包内逐文件散列作为交付证据。发布 .15，沿用插件安装及桌面完整版替换授权。

以下保留历史。

# SUNSHINE-FORM-KEYS-08

用户反馈：D盘野葱《Sunshine》段落切点不齐、前1:07应全部intro却被标成drop/verse/break、电钢琴贯穿全曲却几乎没有主体动效。本轮直接修复底层结构及声部响应，保留.13的lead优先与连续Drop镜头、导出、本地歌词和配置。

- 固定实际音频为当前存在的`D:\野葱视频转换器\音频转换\David Guetta,Avicii - Sunshine_1.mp3`，文件SHA256 `6b88b96f170d9b548b5f3e523895bbbbc4671fd1272e3db9907cbb354fbefd81`。曾存在的不带_1副本仅封装不同，root已确认明确双声道平均后的PCM相同；所有新验收使用_1。同名或旧缓存不替代实际输入核验。
- 结构必须使用声学、重复主题和长前奏上下文等泛化证据，不维护单曲ID/名字/67秒时间表。把用户提供的1:07用作外部验证锚点，不能作为实现分支。核对全曲切点及其他已验证歌曲，不只改标签文字。
- 电钢琴应进入共享主体包络、起音事件、频谱灯光和主运动；不允许调大全频能量冒充旋律响应，也不能让鼓/噪声重新触发强高亮。保留短/稀疏lead、同起音、bass泛音重合及无lead的bass反馈约束。
- 真实片段连续渲染要覆盖前奏、67秒附近、高潮与后段，固定种子、隐藏overlay，检查主体像素/几何变化。已知独立PCM键盘源提供因果测试；插件自身roles计数不等于真实音色标签。
- 安装前已有.13源码、插件/runtime备份及散列，位于`D:\NCM\state\sunshine-form-keys-20261018\baseline`。完成相关回归、类型检查、连续渲染与交付包核对后安装.14，更新桌面完整版，核对后仅移除旧.13桌面包；沿用既有交付授权。

以下为此前任务历史。

## LEAD-REDO-07，重做 lead 优先及 Drop 连续镜头

本轮重做用户明确否决的 .12。以实际《Lights Out》完整两个Drop检验隧道与推进；优先权须包含短促lead、同起音及bass泛音重合首音。事件、脉冲、频谱和运动统一仲裁，已有低音冲击平滑让位，拖动与积分位移保持一致。连续及相邻细分Drop保持同场景、variant、seed和相机时钟，只有明确全混音停顿才允许内部切镜。沿用直接安装及桌面完整版交付授权，发布 .13。自身roles计数和静帧不能当真实音色验收；要保存冻结.12与候选的完整原声对照。

以下保留此前歌词、结构与场景改动历史，旧 .12 的“通过”记录已被用户反馈撤销。

任务 ID：LYRIC-CAL-01。计划日期：2026-10-17（北京时间）。

## 用户目标

当一首歌有的歌词快、有的慢时，允许按实际音频重新寻找逐字时间，并单独修正个别句子；不依赖一个整首偏移量硬调。《Fellow Feeling》为首要实测歌曲。

## 先读再做

依次阅读本文件、`STATUS.md`、`PROJECT.md`、`ACCEPTANCE.md`，再核实实际目录、适用的 AGENTS.md、Git/文件差异。备份将修改的源码，记录现有配置与已安装插件散列。当前源目录没有 Git；使用文件级备份和差异，不要覆盖已有本地改动。

## 已确认的具体限制

1. `src/plugin/aligner.ts` 中 `needsAlignment` 仅接受全部 `timedWords=false` 的歌词；`cachedAlignment` 与 `alignSong` 都受它限制。《Fellow Feeling》官方已有逐字歌词，自动路径会跳过它。
2. 强制模式必须真实重新计算，不能仅绕过 `needsAlignment` 后又返回旧缓存；自动结果与人工修正需要明确的版本及缓存失效规则。
3. `applyAlignment` 现用 `line.start = Math.min(oldStart, firstWordStart)`、`line.end = Math.max(oldEnd, lastWordEnd)`；这不支持把原本过早的句首真正推后，也会残留错误的结束时间。
4. `tools/aligner/fa.py` 默认搜索窗口较窄（`pre=0.5`、`late=1.5`）。仅加一个强制按钮无法修好超出旧窗口的局部误差；需要有边界、置信度与重复歌词约束的重对齐策略。
5. 全局歌词延迟非零时，`MvPlayer.load` 会复制 `song.lines`。异步对齐仅回写原数组可能无法刷新当前画面；新功能需统一生成有效歌词并安全更新当前播放。
6. 导出当前传递歌词快照及 `lyricDelays`，容易因新校准层处理位置不一致而重复叠加；需明确处理顺序。

## 本轮实现范围

### 1. 本曲“强制重新对齐”

- MV 歌词设置中提供明确入口，已有逐字歌词也能手动触发。
- 在本机用现有对齐模型实际重算；处理缺包、进行中、成功、低置信度、失败/超时和切歌情况。
- 强制操作重新生成相应结果，不命中旧结果冒充重算；保留原歌词及上一次可用结果，失败不破坏已可用的歌词或人工修正。
- 对齐成功后，同句可提前也可推后；句首、句尾及各词时间保持合理。按 `ACCEPTANCE.md` 验证超出旧搜索窗的双向误差。
- 若修改 Python 对齐脚本，核实项目脚本与本机实际包 `D:\NCM\BetterNCM\BetterMV\aligner` 的关系。先在隔离候选包中测试，交付明确升级/回退清单，不直接替换在用包，不重复下载已有模型。

### 2. 本曲“逐句时间修正”

- 展示歌词列表、播放定位、选中句子后提前/推后 100 ms、直接输入偏移、重置该句及重置本曲人工修正。
- 可使用按钮把选中句首对到当前播放时刻；若采用此方式，整句所有词同步平移，保留句内节奏。逐字时间本身错误仍交由重新对齐处理，不承诺逐词手工编辑器。
- 每句独立持久化。同一句文本重复出现时必须能分别调整；按歌曲 ID、原始歌词版本指纹和句子身份管理，不能仅用歌词文本作键。
- 不污染原始歌词，不重复应用修正；切歌、拖动、重新加载、重启后仍正确。
- 当原歌词版本变化或自动基准重算，明确保留、重定位或提示旧修正的规则；不能静默把修正套到另一句。

### 3. 统一有效时间轴

- 明确实现“原始歌词 → 接受的对齐结果 → 该句人工偏移 → 本曲全局歌词延迟”的顺序（或等价可证明的设计）。每层最多应用一次，能单独撤销。
- 当前播放和 MP4 导出使用同一份有效歌词定义；导出冻结提交时的校准快照，后续编辑不污染进行中的任务。
- 校准只能影响歌词呈现，不能把校准后的时间重新喂入音乐分析造成节拍/段落变化；编辑时保留已有 analysis、歌曲时间、随机种子和镜头计划。
- 异步结果不得覆盖更新的人工操作、另一首歌或更新一代任务的结果。

### 4. 本曲“使用本地 LRC”（本次新增）

- 歌词设置中提供“导入本地 LRC”，支持绝对路径输入与文件选择器，按歌曲 ID 保存绑定并持久化（`localLrcPaths`），重启后继续有效。
- 本地歌词优先，完整替换本曲在线歌词；绝对不被网易云错误的逐字歌词（yrc）覆盖。
- 保留本地 LRC 已校准的句子起止时间；允许声学模型计算句内单词时间。旧的“整个后台对齐都跳过”要求已由 2026-10-18 用户直接实施授权下的修正替代。
- 当前播放与 MP4 导出使用同一份本地歌词（导出快照 `lines` 统一）。
- 显示当前歌词来源状态（`本地 LRC` 或 `网易云在线歌词`），并提供“重新读取文件”和“恢复网易云歌词”按钮。
- 实测歌曲验证导入、重新读取、恢复网易云歌词、重启恢复及 MP4 导出；两侧波纹（Melody / Lead Motion）与音乐时间保持绝对不变。

## 主要文件（检查后决定最小修改集合）

`src/lyrics/local.ts`（新增）、`src/plugin/ui.ts`、`src/plugin/main.ts`、`src/plugin/export.ts`、`src/plugin/aligner.ts`、`tools/test-local-lrc-e2e.ts`（新增）。

## 实测输入与现有证据

- **本地 LRC 实测目标**：
  - 音频：`D:\野葱视频转换器\音频转换\NURKO,Neriah - Love Is A Highway.mp3`
  - 歌词文件：`D:\CloudMusic\VipSongsDownload\NURKO,Neriah - Love Is A Highway.lrc`
  - 歌曲 ID：2052331548 / 2045041767（约 234.7 秒）
  - 自动化验证脚本：`tools/test-local-lrc-e2e.ts`
- 音频：`D:\野葱视频转换器\音频转换\Porter Robinson - Fellow Feeling.mp3`。
- 歌曲 ID：28912014，原曲 Porter Robinson / Worlds，约 350.15 秒。
- 已准备好的音频、封面、官方歌词和元数据：`D:\NCM\exports\Fellow-Feeling-lyric-probe`。
- 现有探测脚本：`tools/probe-fellow-lyric-ribbons.mjs`。
- 回归歌曲与证据目录：`D:\NCM\exports\Cant-Let-You-Go-drop-response`、`D:\NCM\exports\Sunshine-structure-response`；Homura 的既有本机 fixture 见 `D:\NCM\BetterNCM\export-jobs\741d3da3-67d0-405d-8b1f-9c06bce5230d`。优先复用已有数据，不转存用户音乐到交付压缩包。

## 非目标与交付

不改音频时钟、蓝牙补偿、全曲节拍/段落分析、场景动效强度；不整库清缓存、不破解 NCM、不上传歌曲、不顺手修复不相关历史问题。

逐项执行 `ACCEPTANCE.md`，在 `STATUS.md` 记录实现、自测命令、产物路径、失败/未测项及原因。候选插件单独命名输出到工作区；不要把完整包做成插件单文件包。提交变更清单和可对照差异，状态写为“Antigravity 自测完成，Codex 独立验收待进行”，不可自称已被 Codex 验收。

## 当前补充任务 LOCAL-WORD-01（2026-10-18）

用户已明确回复“你直接做吧”：由 Codex 直接实现、实测、安装 .7 并更新桌面完整版。本次范围为本地 LRC 的声学逐字对齐。保留句子起止、文字、现有翻译、音频分析、种子和镜头计划；自动对齐和手动重算均可用，重算绕过缓存，重读后可复用缓存。异步旧结果不能覆盖新导入/恢复的歌词。显示真实接受数量，弱匹配保留估算。导出冻结有效词时间，同时以原分析歌词生成音乐分析。先前全体 LYRIC-CAL-01（逐句人工校准等）不属于本次完成声明。

## 当前修复 LRC-READ-02（2026-10-18）

用户在网易云中读取 Love Is A Highway 本地 LRC 收到“未读到有效的带时间歌词”。文件仍为 2708 字节、UTF-8，Node 与浏览器共享读取可解析 53 句。修复选择器只提供 file.name 时误作路径、未验证便保存绑定、文本接口空内容难以区分、以及文件字节编码兼容。保留上一轮全部模型、显示时间与导出实现；直接修复、安装 .8 并刷新桌面完整版。原始 LRC 不修改。必须区分真实网易云反馈与适配器测试，不能声称截图的唯一根因已在原客户端完整定位。

## 当前任务 MELODIC-FORM-03（2026-10-18）

用户明确要求修改歌曲段落识别底层：Love Is A Highway 约 0:22、1:08、2:13、2:28 应分别为预副歌、build-up、主歌、预副歌。该请求取代前面歌词任务中“不改段落分析”的局部边界。由 Codex 直接实施、验证和交付 .9，沿用先前安装与桌面完整版交付授权。

不以歌曲名、歌曲 ID、指定秒数或曲风标签写分支。使用音频低频发音起伏、全频能量、鼓组、段落重复和主唱歌词上下文区分铺垫与释放；证据不足时保留旧识别。真实音频覆盖本地 LRC、在线歌词、网易云 BPM/副歌提示和另一速度八度；其他现有歌曲与 .8 冻结基线比较。有限回归不能声称保证所有音乐类型完全正确。保持既有旋律响应、导出、歌词对齐及个人配置，原 LRC 不写入。

## 当前任务 TIMBRE-LIGHT-04（2026-10-18）

用户要求重点观察 Love Is A Highway 1:39 后的 Drop，让 synth stab、bass stab、lead 主导高亮，避免任意声音都触发粒子亮光。直接实施、安装 .10 并更新桌面完整版，沿用既有交付授权。允许修改分析新增声部估计、音乐查询、场景高亮及有关后期触发。不得写入单曲时间特例，不改变已修复的歌曲结构、原旋律包络、歌词时间或音频时钟。实际混音中的声部属于估计，不能声称已经获得分轨或精确识别所有乐器。

## 当前任务 ALL-SCENE-TIMBRE-05（2026-10-18）

用户补充要求“所有动效都要有”。把主体音色响应扩展到所有场景、外观和段落，而非仅 Drop 的部分高亮场景；所有基于鼓点的视觉脉冲与预先生成的事件光效也要接入相应声部类别，柔和场景同样生效。鼓点保留轻量节拍背景，不能单独触发强高亮。频谱几何仍可使用原频谱，频谱灯光使用主体声部通道。沿用 .10 的既有直接安装与桌面完整包授权；发布 .11，保留此前功能、歌曲分析、歌词/音频时钟和配置。安装前以当前 .10 为基线备份。此轮不自行声称网易云内已完成试听；复杂混音里的角色分类仍是声学估计。

## 当前任务 LEAD-PRIORITY-06（2026-10-18）

用户要求：当低沉 wobble bass / bass stab 与明亮 lead 同时出现时，lead 优先成为动效来源；使用 D 盘《Lights Out》在隧道与推进场景验证。

- 不写歌曲名称、歌曲 ID 或固定时间特例；沿用全曲通用声学估计。
- 同时有可辨 lead 与 bass 起音时，主体包络、攻击、亮度和同一时刻的 bass 事件让 lead 优先；无 lead 时 bass-only 的运动保留。
- 不改音频时钟、段落标签/结构、本地歌词内容、既有分析主字段或用户配置。
- 用真实 MP3 + LRC 做音频分析，并在实际浏览器渲染中强制检查隧道和推进；另运行相关角色优先级单元测试及类型检查。
- 以当前 .11 插件/运行时为基线备份，按既有授权安装新插件并更新桌面完整包；不把测试歌曲加入包。
