# 前端脚本结构（经典 script，不是 ES module）

> 本项目跑在 QtWebEngine（Chromium 87）里，**没有构建步骤、没有 importmap**。
> 所有文件都是经典 `<script>`，顶层 `var` / `function` 直接挂在全局。
> **加载顺序 = 依赖顺序**，不要随意调换；拆分时保留了原有的全局符号名。

## 共享层

| 文件 | 作用 |
|---|---|
| `js/shared/namespace.js` | `window.NXD` 命名空间（只负责建对象） |
| `js/shared/photo-grade.js` | 照片级调色后处理；`NXD.createPhotoGrade(renderer, getScene, getCamera, onApply)` |

共享层必须在页面业务脚本之前加载。

## 桌宠 `pet.html`（`js/pet/`）

| 顺序 | 文件 | 职责 |
|---|---|---|
| 00 | `00-bootstrap.js` | Ammo 适配、物理/帧率旋钮、拖动惯性、逐动作布料冻结 |
| 10 | `10-scene.js` | 渲染器、调色器、场景/相机/灯光、`PET_SETTINGS`、环境预设 |
| 20 | `20-toon.js` | 三渲二 ramp、描边壳、开关 |
| 30 | `30-settings.js` | `applySettings`、部件显隐、`/petsettings` 300ms 轮询 |
| 40 | `40-motions.js` | `S` 状态、`POSES`/`GROUPS`、VMD 装载/中转、骨骼层 |
| 50 | `50-expressions.js` | 自动表情、手动表情、视线、`resetToRest`、`setPose` |
| 60 | `60-model.js` | PMX 加载、材质转换、GPU 预热、骨骼/morph 表、`fitCamera` |
| 70 | `70-interaction.js` | 鼠标/拖动、命中框、逐像素位图、右键菜单、title 消息 |
| 80 | `80-assets.js` | 入场闸门、贴图就绪检查、部件名单 |
| 90 | `90-loop.js` | 主循环、物理/动作/表情叠加、入场显示、rAF |

## 调整台视口 `viewer.html`（`js/viewer/`）

| 顺序 | 文件 | 职责 |
|---|---|---|
| 10 | `10-scene.js` | 渲染器、调色器、场景/相机/灯光 |
| 20 | `20-env-camera.js` | 世界环境预设、轨道相机 |
| 30 | `30-model.js` | 尺寸、PMX 加载、morph 索引 |
| 40 | `40-expressions.js` | 本地表情层、表情写入、视线、复位 |
| 50 | `50-motions.js` | 动作系统、VMD、对外 `window.vwr` API |
| 60 | `60-assets.js` | 入场闸门、部件显隐（贴图就绪检查） |
| 70 | `70-settings.js` | 设置同步（灯光/部件，300ms 轮询） |
| 80 | `80-input.js` | 滚轮/中键/Shift 平移/缩放模态/快捷键 |
| 90 | `90-modes.js` | 渲染/白模/线框/三渲二、动作测试冻结 |
| 99 | `99-loop.js` | 主循环（静态场景按需渲染） |

## 调整台 `settings.html`（`js/settings/`）

| 顺序 | 文件 | 职责 |
|---|---|---|
| 10 | `10-state.js` | 默认值、全局状态、滑块绑定、恢复默认 |
| 20 | `20-parts.js` | `PART_TREE`、套装、搜索、分页、图标网格 |
| 30 | `30-expressions.js` | 表情面板、morph 分组、预设、推送 `/petsettings` |
| 40 | `40-init.js` | 页签恢复、拉部件清单/设置、侧栏收起 |
| 50 | `50-playbar.js` | 底部播放条（通过 iframe 的 `window.vwr` 驱动） |
| 60 | `60-action-test.js` | 动作测试、骨骼调试、链开关、导出 VMD |

## 改代码时的约定

1. **不要加 `import` / `export`**：Chromium 87 不支持 importmap，页面也没有 bundler。
2. **不要改全局符号名**：Python 宿主会调用 `setPose`、`window.petMouseAt`、`window.petDragVel`、`window.vwr`、`window.petApplySettings` 等；调整台 iframe 也依赖 `window.vwr`。
3. **依赖方向**：后面的文件可以调用前面的函数；前面的文件在运行时回调里也可以调用后面的全局函数（经典 script 共享同一个全局作用域），但**解析阶段**只能依赖已加载的文件。
4. **新增动作**：只改 `motions.js`（`MOTION_DEFS` / `MOTION_GROUP_DEFS`），不要在两个页面里写死动作表。
5. **新增部件**：跑 `tools/add_part_wire.py`，它会接 `js/settings/20-parts.js`、`js/pet/80-assets.js`、`js/viewer/60-assets.js`。
6. **改完自检**：
   ```bash
   node --check js/pet/*.js
   node --check js/viewer/*.js
   node --check js/settings/*.js
   python _check_sync.py
   ```
