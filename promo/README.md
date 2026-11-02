# 交织者 Interweaver · 主旨宣传片

> 「原来，知识是一张网。」—— 2 分 25 秒，1080p30，全片卡点 tech-house。
> **当前版本：v2（`v2/`，video-shotcraft 流水线 · Remotion）**；v1（纯 Canvas 管线）保留在 `film/` + `render.mjs` + `audio.mjs` 作历史参照。

## v2 一键出片

```bat
cd v2
渲染v2.bat
```

依次：全片渲染（带 BGM）→ 无 BGM 版 → 完成。或手动：

```bash
cd v2
npm run render            # out/interweaver-promo-v2.mp4（带 BGM）
npm run render:nobgm      # out/interweaver-promo-v2-nobgm.mp4（保留 SFX，供自配音乐）
```

单帧调试：`npx remotion still src/index.ts InterweaverPromo out/qa/f<帧号>.png --frame=<N>`
（帧号 = 拍号 × 0.48387 × 30；`src/beats.ts` 有全部拍号表）

## v2 相对 v1 的修复（用户反馈驱动）

1. **开场→混剪丝滑转场**：句号离纸成点 → 点镂空鼓成圆（circle-match-iris 命门写法）→ 圆径向坍缩成内接三角形（泰勒斯直角）→ n→∞ 弹回圆 → 圆左移直接长成单位圆生正弦。全程一支笔一台相机，无剪切。
2. **真实 BGM + 全片卡点**：Mixkit tech-house（实测 BPM=124.00，网格残差 p95=9.4ms）；选段 b161–467（开场压 breakdown、混剪压 b207 大 drop）；镜头边界/动效/SFX 全部 `beatF()` 拍号制；三个大 slam（成就砸落 b181 / 星网心跳 b249 / logo 落定 b293）钉在实测最强 kick 上。
3. **客观错误修复**：所有"圆-波投影线"严格水平/竖直（r=amp、圆心 y=波基线）；序章泰勒斯三角形的斜边严格为直径（v1 的 200°/340° 不是直径，直角标记是错的）。
4. **高潮星图扩散贴近原作**：层距 340px / 组带距 260px（v1 太挤），节点保留确定性微抖动。

## 结构

| 目录/文件 | 内容 |
|---|---|
| `v2/src/beats.ts` | **全片唯一事实源**：实测节拍网格、SHOTS 镜头表、SFX 钉帧表 |
| `v2/src/gen/*.ts` | 各幕 Canvas 程序渲染引擎（确定性，禁 Date.now/Math.random） |
| `v2/src/scenes/*.tsx` | Remotion 场景壳（canvas + DOM 文字层 + 成就卡 slam） |
| `v2/src/audio.tsx` | BGM + SFX 挂载 |
| `v2/analysis/` | BGM 节拍分析脚本与产物（beat_data.json）、音轨偏移回测脚本 |
| `v2/public/audio/` | BGM（Mixkit 免费商用）+ Freesound CC0 SFX（manifest/署名清单随工程） |
| `v2/DESIGN.md` | 设计 spec + 分镜（制作放行文档） |
| `v2/out/qa/` | 逐镜头验收静帧 |

## 修改日志

### 2026-11-02 · v2.1（独立终检修复）
独立审查（干净上下文 subagent，报告存 `v2/out/qa/FINAL-REVIEW.md`）3 必须修复 + 7 建议，已全部处理：
- **S1 泰勒斯几何不诚实** → 坍缩目标改为等边三角形（顶点是真实顶点），撤掉直角标记（泰勒斯由 S4 正确面板承担；原"直径斜边"在等边 morph 下中心退化不可画）。
- **S6 星图标签互压** → 标签可见性规则：近景（z≥1.15）全显；远景只留七星主角 + 交织节点。
- **S2 切点空帧** → 各子场景入场窗口前移过切点，切帧即有内容（真硬切，四切点对拍误差 ≤1f 已由审查验证）。
- 建议项：成就卡补 score-slam 悬停蓄力弧（b180.2 起）；S2 首段补解说字幕（产品正弦波 flavor 原句）；公式注记提到 38px；logo 淡入提前到 b0.8。
- 约束（Constraint）无独立演示镜头：确认放行——S4 泰勒斯面板已承载约束语义，五原语在 S3 落版中点名，不再加镜。
- 审查验证通过项：圆-波投影严格水平/竖直、四切点 ≤1f、心跳双峰音画同步、双版 4355 帧逐帧一致、Freesound 许可齐全、音轨偏移补偿 0.069s（残差 0.06f）。

### 2026-11-01 · v2.0（video-shotcraft 重制）
- 全片迁移到 Remotion 工程（`v2/`），镜头卡语法落地：circle-match-iris（点→圆镂空成环）、line-carry-transition（双纽线线头接力长成变量卡）、beat-cut-moves（微积分三连闪，全片唯一一次）、slam-entrance-moves B（成就卡砸落）。
- BGM 换真实音乐（tech-house 124BPM），librosa 网格拟合 + 全片 beatF 卡点；SFX 全部换 Freesound 拟音（快门/riser/心跳/风铃/铅笔/whoosh），保留产品成就音 achWeave 作叙事性引用。
- 修复：圆-正弦联动投影线不直、泰勒斯斜边非直径、星图过挤、成就卡文案溢出、line-carry 相机平移公式错误、成就卡 flavor 换行溢出。
- 交付两版：带 BGM / 无 BGM（保留 SFX）。

### 2026-11-01 · v1.0 初版（纯 Canvas 管线，`film/`）
- 见 git 历史与本 README 下方「v1 存档」一节。

---

## v1 存档（历史参照）

v1 为零依赖自研管线：`film.html` + `film/*.mjs`（六幕确定性 Canvas 渲染）→ `render.mjs`（puppeteer 逐帧 PNG 流直推 ffmpeg）+ `audio.mjs`（全合成配乐）→ `out/interweaver-promo.mp4`。
一键：`渲染宣传片.bat`（渲染 v1）。
v1 的声音与画面共用 `film/timeline.mjs`；星图数据 `film/knowledgeData.js` 由产品源码提取（v2 仍在复用）。
v1 已知问题（v2 已修）：转场为扫开式 wipe、BGM 全合成无卡点、Act1/3 圆-波投影线倾斜、星图偏挤。

