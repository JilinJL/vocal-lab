# 声镜 Sonic Mirror

基于 **Vite 8 + Vue 3 + TypeScript** 构建的实时人声音高曲线监测与 88 键标准音参考钢琴。

在线使用：<https://jilinjl.github.io/vocal-lab/>

## 功能特性

- **实时麦克风音高记录**：采用 YIN 算法（CMNDF + 抛物线插值）客观记录当前唱歌音高（如 `C5`、`E4`）、唱名简谱、精确频率（Hz）与 `-50¢ ~ +50¢` 音分偏移。
- **音高曲线与悬停回看**：高清 Canvas 实时绘制平滑人声轨迹，支持鼠标悬停曲线查看当时音高详情、拖拽回看历史与纵轴自动跟随。
- **88 键标准音钢琴**：完整 `A0–C8` 88 键真实钢琴 MP3 离线采样（另带柔和电钢、纯净正弦音色），支持电脑键盘弹奏、持续参考音定音线与 A4 基准音校准（432–446 Hz）。

## 使用提示

- 麦克风只在 HTTPS 或 `localhost` 下可用，音频全部在本机浏览器内处理，不会上传。
- 边弹参考音边唱时建议戴耳机，否则扬声器里的琴声会被麦克风识别成你的音高。
- 推荐 Chrome / Edge / Safari 最新版。

## 本地开发与部署

```bash
pnpm install
pnpm dev       # 本地开发
pnpm build     # 类型检查并构建生产包
pnpm deploy    # 构建并部署到 Cloudflare Workers (Static Assets)
```

- 推送到 `main` 后，`.github/workflows/pages.yml` 会自动构建并发布到 GitHub Pages。
- 部署到子路径时用 `BASE_PATH` 指定前缀，例如 `BASE_PATH=/vocal-lab/ pnpm build`；默认是 `/`。
- 下一版规划见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
