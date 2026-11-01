# 交织者 Interweaver · 主旨宣传片（纯代码渲染）

> 「原来，知识是一张网。」—— 2 分 38 秒，1080p30，Canvas2D 逐帧程序渲染 + 纯代码合成配乐。
> 零图片素材、零音频素材：品牌标记、知识网、配乐音效全部由代码生成。

## 一键渲染

双击（或命令行执行）：

```bat
渲染宣传片.bat
```

依次完成：`audio.mjs`（合成音频 → `out/audio.wav`）→ `render.mjs full`（4 个无头 Chrome 页面并行渲染 4740 帧，PNG 流直推 ffmpeg）→ `out/interweaver-promo.mp4`。

## 文件结构

| 文件 | 作用 |
|------|------|
| `film.html` | 渲染入口（1920×1080 canvas；`?t=秒` 可定格预览单帧） |
| `film/timeline.mjs` | **全片唯一事实来源**：六幕时刻表、织网边调度、和弦计划、音高 DNA |
| `film/lib.mjs` | 渲染原语：品牌色板、iOS 弹簧缓动、辉光精灵、丝线（与 `app/src/render.js` 同款行进虚线）、logo 三段路径、纸面网格/颗粒 |
| `film/knowledgeData.js` | Act4 星图数据（由 `app/src/achievements/nodes.js`+`patterns.js` 提取生成，勿手改） |
| `film/act0.mjs` | 0–16s 吐槽：灰色符号墙 → 紫色正弦扫开 →「数学，本来很美。」 |
| `film/act1.mjs` | 16–52s 数学之美混剪：圆规→泰勒斯→n→∞→单位圆生正弦→傅里叶→抛物线→黄金螺线→双纽线 |
| `film/act2.mjs` + `film/montage.mjs` | 52–104s 自问自答讲「关联」：滑杆驱圆 → 反向求解 → θ 同驱圆波 → 四格微积分蒙太奇 → 五原语落版 |
| `film/act3.mjs` | 104–120s 顿悟：绑定网闭合成环 →「✦ 欧拉之环」弹卡 → 坠入深空 |
| `film/act4.mjs` | 120–148s 终章：七星点亮 → 英雄路径生长 → 全网级联 → 心跳 →「原来，知识是一张网。」 |
| `film/act5.mjs` | 148–158s 落版：双纽线一笔画 + 字版收束 |
| `audio.mjs` | 配乐/音效合成器（和声垫取自 `app/src/ambientAudio.js` 和弦池；成就音 = `app/src/sfx.js` 的 achWeave 三音） |
| `render.mjs` | 渲染管线：`probe <秒...>` 单帧调试 / `full` 全片（puppeteer-core + 系统 Chrome + ffmpeg image2pipe） |
| `probes/` | 调试单帧（.gitignore） |
| `out/` | 成片与音频（mp4 提交入库；wav 忽略） |

## 环境依赖

- Node.js（项目已有）+ `app/node_modules` 里的 puppeteer-core（复用，未新装）
- 系统 Chrome（`C:/Program Files/Google/Chrome/Application/chrome.exe`，可被 `PROMO_CHROME` 覆盖）
- ffmpeg（winget `Gyan.FFmpeg`，可被 `PROMO_FFMPEG` 覆盖）

## 修改日志

### 2026-11-01 · v1.0 初版
- 新建 `promo/` 宣传片工程：六幕 158s 脚本、Canvas 渲染管线、程序合成配乐。
- 视觉口径对齐 `docs/06-前端设计规范.md`（纸面/深空双色调、丝线规格、iOS 弹簧曲线）；品牌标记路径取自 `app/brand/logo.svg`。
- 修复记录：Act1 段落退场缺失导致三角形残留（`return` 误用整幕退出）；Act3 坠落期卡片/丝线 alpha 未联动；Act2 落版文字出血；螺线段重做为斐波那契方块经典构图。

## 验收清单

- [x] 时长 158s（2:38，在 2–3 分钟要求内）、30fps、1920×1080
- [x] 左上角常驻品牌 logo（深浅色随幕切换）
- [x] 开头吐槽枯燥数学 → 强调「数学之美」
- [x] 几何混剪 + 无缝转场（一线到底：每段的线头就是下一段的起笔）
- [x] 自问自答讲清「关联」（正向驱动 → 反向求解 → 一源多驱）
- [x] 终章震撼：知识网织成 + 心跳 +「原来，知识是一张网。」
- [x] 背景音乐 + 音效（程序合成，与画面共享同一时间轴）
- [x] 单一视频文件交付（`out/interweaver-promo.mp4`）
- [x] 提供的 logo/海报文件未作为素材掺入（logo 按其 SVG 路径数据以代码重绘）
