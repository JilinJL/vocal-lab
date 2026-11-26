# 声镜 Sonic Mirror 路线图

> 本文是给实现方（人或 AI 编码代理）的执行说明。按阶段顺序做，每个阶段结束都要能独立发布。

## 0. 现状（v1.0.0）

- 技术栈：Vite 8 + Vue 3 + TypeScript，无路由、无状态库、无测试框架。
- 线上：GitHub Pages（`.github/workflows/pages.yml`，推送 `main` 自动发布），备选 Cloudflare Workers（`pnpm deploy`，需先 `wrangler login`）。
- 功能：麦克风实时音高（YIN）、音高曲线回看、88 键采样钢琴、A4 校准、示例曲线。
- 关键文件：
  - `src/audio/yinDetector.ts`：YIN 检测，纯函数。
  - `src/audio/pitchMath.ts`：频率、MIDI、音名、音分换算，纯函数。
  - `src/composables/useMicrophonePitch.ts`：麦克风采集、平滑、采样记录。
  - `src/audio/pianoSynth.ts`：钢琴采样加载与发声。
  - `src/components/PitchCurveCanvas.vue`：曲线画布，1142 行，最大的组件。

### 已知问题（v2 需要先处理）

1. **检测在主线程跑**：`processFrame` 每帧对 4096 点做 YIN，复杂度约 `2048 × 740` 次乘加，60fps 下约 9000 万次/秒。桌面没问题，中低端手机会掉帧、发热。
2. **琴声串音**：麦克风关闭了 `echoCancellation`。外放钢琴参考音时，麦克风会把琴声识别成人声。练习模式会频繁播放参考音，这个问题会直接影响打分。
3. **两个 AudioContext**：麦克风和钢琴各自 new 一个，时间轴不统一，无法精确对齐“参考音何时响起”和“人声何时到达”。
4. **没有持久化**：A4、音色、音量、窗口长度刷新即丢。
5. **没有测试**：纯函数（`pitchMath`、`yinDetector`）适合先补单元测试。

## 1. 版本划分

| 版本 | 主题 | 核心交付 |
| --- | --- | --- |
| v1.1 | 地基 | 引擎抽离 + AudioWorklet + 统一 AudioContext + 设置持久化 + Vitest |
| v1.2 | 移动端 Web | 响应式重排、触控钢琴、PWA 可安装、离线可用 |
| v2.0 | 练习模式 | 音阶/音程练习、Perfect/Great/Good/Miss 打分、成绩记录 |
| v2.1 | 歌曲跟练 | 导入 MIDI / 清唱音频，提取旋律线，跟唱打分 |
| v2.2 | 原生 App | Capacitor 打包 Android / iOS |
| v3.x | 扩展 | 伴奏人声分离、音域测试、练习统计、分享 |

先做 v1.1 再做练习模式，原因：打分依赖准确的时间对齐和稳定帧率，在主线程检测 + 双 AudioContext 上直接堆练习模式，后面必然返工。

## 2. v1.1 地基

### 2.1 目标结构

```
src/
  engine/
    audioContext.ts        # 全局唯一 AudioContext（懒创建，用户手势内 resume）
    pitchWorklet.ts        # AudioWorkletProcessor：环形缓冲 + YIN，postMessage 结果
    pitchEngine.ts         # 主线程封装：start/stop，订阅 PitchFrame
    yinDetector.ts         # 从 src/audio 移入，保持纯函数
    pitchMath.ts
  composables/
    useMicrophonePitch.ts  # 改为消费 pitchEngine，只负责平滑与记录
    useSettings.ts         # localStorage 持久化
```

### 2.2 任务

1. **统一 AudioContext**：新增 `engine/audioContext.ts` 导出 `getAudioContext()`；`PianoSynthesizer.ensureContext` 和麦克风都改用它。`stop()` 不再 `close()` 上下文，只断开节点、停止 track。
2. **AudioWorklet 检测**：
   - Worklet 内维护 2048 点环形缓冲（48kHz 下约 43ms，足够覆盖 65Hz 两个周期），每 512 点（约 10.7ms）跑一次 YIN。
   - 输出 `PitchFrame { t: number /* AudioContext 时间 */, frequency, clarity, rms }`。时间戳用 `currentTime`，后续打分全部基于这一时钟。
   - Vite 中用 `new URL('./pitchWorklet.ts', import.meta.url)` + `audioWorklet.addModule`，确认生产构建产出独立 JS 文件。
   - 不支持 AudioWorklet 时回退到现有 AnalyserNode 方案。
3. **YIN 性能**：差分函数改为只算到 `maxTau`，窗口 1024（当前 `halfN = 2048`）。用测试验证 C2–C6 正弦和带谐波信号误差 < 5 音分。
4. **设置持久化**：`useSettings` 管理 `a4Hz`、`windowSeconds`、`timbre`、`volume`、`showKeyShortcuts`，key 为 `sonic-mirror:settings:v1`，读失败用默认值。
5. **测试**：引入 Vitest，覆盖：
   - `pitchMath`：440Hz→A4/0¢，`frequencyToMidi` 与 `midiToFrequency` 互逆，A4=432 时换算。
   - `yinDetector`：合成正弦、锯齿波（含谐波）、白噪声（应返回 null）、低于 rmsThreshold（返回 null）。
   - 在 CI（`pages.yml` build 前）加 `pnpm test`。

### 2.3 验收

- 中端安卓机（如骁龙 7 系）Chrome 下开启检测 5 分钟，曲线不掉帧，主线程长任务 < 50ms。
- 刷新后设置保留。
- `pnpm test` 通过，CI 绿。

## 3. v1.2 移动端 Web（先 Web，后原生）

手机浏览器已经能用麦克风（HTTPS 下），先把 Web 做好，原生壳在 v2.2 再套。

### 3.1 布局

- 断点：`< 640px` 手机竖屏，`640–900px` 平板/横屏，`> 900px` 桌面（现状）。
- 手机竖屏结构（自上而下）：精简顶栏（开始检测 + 更多菜单）→ 大号当前音名 + 音分条 → 曲线（占剩余高度，最少 40vh）→ 底部钢琴（2 个八度，可左右滑动切换八度）。
- 时间轴跨度、A4、自动跟随移入“更多”底部抽屉（bottom sheet）。
- 页面高度用 `100dvh`，处理 iOS 安全区 `env(safe-area-inset-*)`。

### 3.2 触控

- 钢琴：手机上白键最小宽度 44px，显示 C3–C6 三个八度窗口，两侧箭头 / 横滑切换。保留滑奏（pointer 拖动）但避免与页面滚动冲突：钢琴区域 `touch-action: none`。
- 曲线：单指横拖回看，双指捏合调时间窗口（6/12/24s 吸附），点按显示该点音高。
- 去掉 hover 依赖的提示（`@media (hover: none)` 下改文案）。

### 3.3 平台兼容

- iOS Safari：`AudioContext` 必须在点击回调内同步创建/resume（v1.0 已调整顺序，需真机复测）；静音拨片打开时 Web Audio 无声，界面需提示“请关闭静音模式”。
- iOS 锁屏/切后台会挂起音频：监听 `visibilitychange`，回前台时自动 resume 或提示重新开始。
- Android Chrome：部分机型默认开启 AGC，若 `getUserMedia` 约束不生效，在界面上显示提示。

### 3.4 PWA

- 加 `vite-plugin-pwa`：manifest（名称、图标 192/512、`display: standalone`、主题色 `#11161c`）。
- Service Worker 预缓存 app shell；钢琴采样（2.9MB）运行时缓存（CacheFirst），首次只预取 C3–C5。
- 字体改为自托管或直接用系统字体，离线不依赖 Google Fonts（国内访问也更快）。

### 3.5 验收

- iPhone（Safari）与安卓（Chrome）真机：可开麦、曲线流畅、钢琴可弹、无横向溢出。
- 可“添加到主屏幕”，断网后打开可用（不含未缓存的采样音）。
- Lighthouse 移动端 Performance ≥ 85，PWA 检查通过。

## 4. v2.0 练习模式

### 4.1 用户流程

1. 顶栏切换「自由监测 / 练习」两种模式（练习模式用 URL hash `#/practice`，不引入路由库）。
2. 练习设置：
   - 音域：默认 `C3–C4`（男声）/ `A3–A4`（女声）两个预设，可用双滑块自定义，最小 1 个音，最大 3 个八度。
   - 练习类型：单音逐个（半音阶上行/下行/上下行）、大调音阶、五声音阶、随机音、音程（三度/五度/八度跳进）。
   - 节奏：每个音“示范时长”（默认 1.0s）+“跟唱时长”（默认 1.5s）+ 间隔（0.3s）；BPM 预设慢/中/快。
   - 跟唱方式：先听后唱（默认）/ 同时唱（适合戴耳机）。
3. 倒计时 3-2-1 后开始。每个音：钢琴示范 → 跟唱窗口亮起 → 实时显示判定 → 下一个。
4. 结束页：总分、各判定数量、最准/最差的音、每个音的平均音分偏差图，可“再来一次”或“只练错的音”。

### 4.2 数据模型

```ts
interface PracticeNote {
  midi: number
  demoStart: number   // AudioContext 时间
  singStart: number
  singEnd: number
}

interface NoteResult {
  midi: number
  grade: 'perfect' | 'great' | 'good' | 'miss'
  meanAbsCents: number   // 有效帧平均绝对偏差
  stability: number      // 有效帧音分标准差
  onsetDelayMs: number | null  // 从 singStart 到第一次进入 ±50¢ 的时间
  voicedRatio: number    // 有效帧占跟唱窗口比例
}

interface PracticeSession {
  id: string
  startedAt: number
  config: PracticeConfig
  results: NoteResult[]
  score: number          // 0–100
}
```

### 4.3 打分规则

只统计跟唱窗口内的帧；丢弃窗口开头 150ms（起音过渡）。有效帧条件：`clarity ≥ 0.8` 且偏差在 ±300¢ 内（超出视为唱错音，不当作噪声丢弃，计入 miss 判断）。

| 判定 | 条件（同时满足） | 颜色 token |
| --- | --- | --- |
| Perfect | `meanAbsCents ≤ 10` 且 `stability ≤ 12` 且 `voicedRatio ≥ 0.6` | `--grade-perfect: #f5c542`（金） |
| Great | `meanAbsCents ≤ 25` 且 `voicedRatio ≥ 0.5` | `--grade-great: #4fd1a5`（绿） |
| Good | `meanAbsCents ≤ 50` 且 `voicedRatio ≥ 0.4` | `--grade-good: #63b3ed`（蓝） |
| Miss | 其余情况，或无有效帧 | `--grade-miss: #ee7863`（红） |

- 八度容错：设置项「允许八度误差」（默认开），偏差先按 1200¢ 折叠到 ±600¢ 再判定，结果页标注“唱低/高八度”。
- 总分：Perfect 100 / Great 80 / Good 55 / Miss 0，取平均；连续 Perfect/Great 计 combo，结束页显示最高 combo。
- 阈值放在 `src/practice/grading.ts` 的常量里，并提供“宽松 / 标准 / 严格”三档（阈值整体乘 1.5 / 1 / 0.7）。
- 实时反馈：跟唱期间每 100ms 用当前已收集帧算一次临时判定，目标线颜色随之变化；窗口结束时锁定最终判定，弹出判定字样（缩放 + 淡出 400ms，遵守 `prefers-reduced-motion`）。

### 4.4 界面

- 复用 `PitchCurveCanvas`：新增 `targets` prop（`{ midi, start, end, grade? }[]`），在曲线背景画目标音条（类似 K 歌的音高条），人声曲线叠加其上；未来的音条提前 3s 出现，从右往左滚动。
- 左侧监测面板在练习模式下换成：当前目标音名、进度（第 n / N 个）、当前 combo、实时判定徽章。
- 判定颜色必须配文字，不能只靠颜色区分（沿用现有无障碍约定）。

### 4.5 实现拆分

1. `src/practice/sequences.ts`：根据配置生成 `midi[]`（纯函数 + 单测）。
2. `src/practice/scheduler.ts`：基于 AudioContext 时钟排程示范音与跟唱窗口（look-ahead 100ms，`setTimeout` 25ms 轮询，不依赖 `setInterval` 精度）。
3. `src/practice/grading.ts`：`gradeNote(frames, target, options): NoteResult`（纯函数 + 单测：理想正弦、+30¢ 偏移、颤音 ±20¢、只唱一半时长、唱高八度）。
4. `src/composables/usePractice.ts`：组合 scheduler + pitchEngine + grading，暴露状态机 `idle → countdown → running → paused → finished`。
5. `src/components/practice/PracticeSetup.vue`、`PracticeHud.vue`、`PracticeSummary.vue`。
6. 成绩存 IndexedDB（`idb-keyval` 即可），保留最近 100 次。

### 4.6 验收

- 用单测里的合成帧验证四档判定边界。
- 手动：戴耳机按 C 大调音阶练一遍，唱准时多数为 Perfect/Great；故意唱偏 40¢ 时为 Good；不唱为 Miss。
- 外放模式下示范音期间不计分，跟唱窗口内钢琴已静音（示范音 noteOff 后留 120ms 衰减再开窗）。

## 5. v2.1 导入歌曲跟练

### 5.1 支持的输入（按实现顺序）

1. **MIDI 文件（`.mid`）**：最准确。用 `@tonejs/midi` 解析，让用户选旋律轨（默认音符最多且音域在 C3–C6 的单音轨）。多音轨重叠时取最高音作为旋律。
2. **清唱 / 示范录音（`.mp3/.wav/.m4a`，单人声）**：`decodeAudioData` 后离线跑 YIN（放 Web Worker），得到参考音高曲线，再分段成音符（同一半音持续 ≥ 120ms 合并为一个音，间隙 < 60ms 视为连音）。
3. **带伴奏的歌曲**：浏览器里做人声分离成本高（模型 30MB+、手机耗时长），放到 v3 评估。v2.1 只做两件事：可加载伴奏音频作为背景播放；参考旋律需另导 MIDI 或清唱轨。
4. （可选）简谱文本：`1 2 3 | 5 - 6 5 |` 之类的简单语法，适合用户手输练习曲，解析器为纯函数。

### 5.2 跟练流程

- 导入后进入编辑页：显示旋律音条，支持整体移调（±12 半音，用于适配音域）、设置 A-B 循环段、调速 0.5×–1.25×（音频用 `playbackRate` + `preservesPitch`，MIDI 直接改时间）。
- 跟练时：伴奏或钢琴旋律播放 + 音条滚动 + 人声曲线叠加，每个音复用 4.3 的 `gradeNote` 打分（歌曲模式不丢弃起音 150ms，改为 80ms）。
- 时延校准：设置里提供“拍手校准”（播放节拍，用户跟着拍/唱，测出输入输出总延迟），打分时按该偏移对齐。蓝牙耳机延迟可达 200ms+，不校准会整体判慢。

### 5.3 存储与版权

- 导入文件只存本地（IndexedDB 存解析后的音符和原始文件 Blob），不上传服务器。
- 不内置任何受版权保护的歌曲；内置示例只用公共领域旋律（如《欢乐颂》《小星星》）。

### 5.4 验收

- 导入一个标准 MIDI，能选轨、移调、循环、跟唱打分。
- 导入 30s 清唱 wav，手机上 10s 内完成旋律提取，音符分段与人耳判断基本一致。

## 6. v2.2 原生 App（Android / iOS）

- 方案：**Capacitor** 包装现有 Web 构建。理由：代码零重写，Web 与 App 同一套；React Native / Flutter 需要重写音频与画布，不值得。
- 步骤：`@capacitor/core` + `@capacitor/android` + `@capacitor/ios`，`webDir: dist`，`BASE_PATH=/` 构建。
- 权限：Android `RECORD_AUDIO`；iOS `NSMicrophoneUsageDescription`（文案：“用于实时检测你的演唱音高，音频不离开设备”）。
- iOS：`AVAudioSession` 设为 `playAndRecord` + `defaultToSpeaker` + `allowBluetooth`，否则开麦后外放声音会变小或走听筒，需要一个小的原生插件或现成插件。
- 发布：Android 先出 APK 放到 GitHub Release，再考虑应用商店；iOS 需要 Apple 开发者账号（$99/年），先 TestFlight。
- 验收：两端真机开麦、练习模式、导入文件（用系统文件选择器）全部可用。

## 7. v3.x 更多功能（候选池，按价值排序）

1. **音域测试**：引导用户从舒适音滑到最低/最高，记录可用音域，自动设置练习默认范围。
2. **练习统计**：日历打卡、每个音的历史准确率热力图、“最不稳的音”推荐练习。
3. **练声曲库**：内置常见练声套路（五度音阶上行下行、琶音、唇颤音模板），每天推荐一组。
4. **录音回放**：练习时同步录下人声，结束后可回放并对照曲线。
5. **人声分离**：评估 ONNX Runtime Web + 轻量分离模型（如 Demucs 小模型），只在桌面开启。
6. **分享卡片**：把一次练习的曲线和分数导出为图片。
7. **多语言**：中英文切换（文案集中到 `src/i18n`）。

## 8. 给实现方的执行约定

- 一次只做一个版本，每个版本拆成多个小 PR / commit，每个 commit 后 `pnpm build` 必须通过；v1.1 起 `pnpm test` 也必须通过。
- 不改现有视觉风格：颜色、字体、圆角都用 `src/styles/tokens.css` 的变量，新颜色先加 token。
- 纯逻辑（序列生成、打分、MIDI 解析、旋律分段）写成纯函数并配单测，组件里不写算法。
- 音频相关时间一律用 AudioContext 时间（秒），不要混用 `performance.now()`。
- 无法自动验证的部分（真机、耳机、iOS 静音键）写进 PR 描述的“需人工验证”清单。
- 每个版本发布时：更新 `package.json` 版本号、README 功能列表、打 git tag `vX.Y.Z`、建 GitHub Release 写变更说明。

### v1.1 第一个任务（可直接开工）

> 在 `src/engine/` 新建统一 AudioContext 模块，让 `PianoSynthesizer` 和 `useMicrophonePitch` 共用；引入 Vitest 并为 `pitchMath.ts`、`yinDetector.ts` 补单测；在 `pages.yml` 的 build 前加 `pnpm test`。不改 UI。完成后 `pnpm build && pnpm test` 通过。
