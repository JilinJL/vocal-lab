# VocalLab

基于 **Vite 8 + Vue 3 + TypeScript + Capacitor + C++17 / Google Oboe** 构建的实时人声音高监测、逐音练习打分、歌曲导入跟练与 88 键标准音参考钢琴。支持桌面/移动端网页、PWA 安装以及原生低延迟 Android App（APK）。

在线使用：<https://jilinjl.github.io/vocal-lab/>
Android APK 下载：<https://github.com/JilinJL/vocal-lab/releases>

## 功能特性

- **自由监测（Monitor）**：采用 YIN 算法（CMNDF + 抛物线插值）实时检测唱歌音高（如 `C5`、`E4`）、唱名简谱、精确频率（Hz）与 `-50¢ ~ +50¢` 音分偏移；支持高清 Canvas 曲线绘制、悬停/点按查音、拖拽回看历史与纵轴自动跟随。
- **音准练习（Practice）**：默认 `A3–E4` 音域并支持自由设定范围、人声预设及多种练习模式（半音上行/下行/往返、大调音阶、五声音阶、三度/五度音程、随机）；支持「先听示范再跟唱」与「同步跟唱」模式，对每个目标音给出 **Perfect / Great / Good / Miss** 彩色分级判定、连击数、结算摘要、错音重练及本机历史记录。
- **节奏训练与闯关（Rhythm）**：提供「节拍 / 律动 / 闯关」三个独立子视图；内置 6 大分类 20+ 经典节奏型与 5 层鼓点步进网格（拍点 + 底鼓 / 军鼓 / 踩镲 / 加花，3 档力度、摇摆感 50%–66%、40–200 BPM + TAP 敲速 + 仅拍点），以及 60fps 滚动轨道节奏打点小游戏（支持正拍 / 底鼓 / 军鼓 / 盲拍挑战、Perfect–Miss 毫秒级判定、抢拍/拖拍偏移分析与本地战绩）。
- **歌曲跟练（Songs）**：内置公开版权示例旋律，支持导入本地 **MIDI（`.mid`/`.midi`）**（可选音轨）或 **单人清唱音频（`.wav`/`.mp3`/`.m4a`）**（Web Worker 离线 YIN 提取旋律）；支持移调、变速、A-B 片段循环、示范音试听与逐音跟唱打分。
- **移动端原生手势与 PWA**：竖屏全画布优先布局、底部拇指热区操作栏与三 Tab 导航；支持**长按画布试听音高**、**双指捏合缩放音域**、**双击回实时视角**、**左右滑动快切音域预设/曲目**、**下拉手势关闭抽屉**，以及**滑出式触控滑奏钢琴（长按琴键锁定持续音）**与离线 PWA 安装。
- **Android 原生低延迟音频引擎（v1.3）**：基于 Capacitor 8 + C++17 + Google Oboe（AAudio / OpenSL ES）原生录音采集与 16 复音合成器，独立 DSP 线程执行零分配 YIN 检测，统一 `CLOCK_MONOTONIC` 时钟并保持媒体路由外放不切听筒；同步集成系统触感反馈、深色状态栏、常亮防锁屏与物理返回键层级接管。
- **88 键标准音钢琴**：完整 `A0–C8` 88 键真实钢琴 MP3 离线采样（另带柔和电钢、纯净正弦音色），支持电脑键盘弹奏、持续参考音定音线与 A4 基准音校准（432–446 Hz）。

## 使用提示

- 麦克风只在 HTTPS 或 `localhost` 下可用，音频全部在本机浏览器内处理，不会上传。
- 边弹参考音边唱或跟练歌曲时建议戴耳机，否则扬声器里的琴声会被麦克风识别成你的音高。
- 若使用蓝牙耳机感觉判定偏慢，可在顶部「设置」中调节「跟练延迟补偿」。
- 推荐 Chrome / Edge / Safari 最新版。

## 本地开发与部署

```bash
pnpm install
pnpm dev          # 本地开发
pnpm test         # 运行 Vitest 单元测试
pnpm build        # 类型检查并构建 Web/PWA 生产包
pnpm build:mobile # 构建移动端 Web 资源（关闭 PWA SW 注入）
pnpm cap:sync     # 构建移动端资源并同步到 android/ 工程
pnpm android:apk  # 本地编译 Android Debug APK（需 JDK 21 + Android SDK/NDK 27）
pnpm deploy       # 构建并部署到 Cloudflare Workers (Static Assets)
```

- 推送到 `main` 后，`.github/workflows/pages.yml` 会自动运行单元测试、构建并发布到 GitHub Pages。
- 推送 `v*` 标签或手动触发 `.github/workflows/android-apk.yml` 会自动编译并上传 Android APK 到 Release。
- 部署到子路径时用 `BASE_PATH` 指定前缀，例如 `BASE_PATH=/vocal-lab/ pnpm build`；默认是 `/`。
- 版本路线图见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
