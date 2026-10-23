# MD → 桌宠部件：导入 / 对齐 / 导出 操作技巧

> 面向：下一次把新的服饰文件变成桌宠可用部件时的**你自己动手那一段**（MD 里的操作）。
> MD 版本：Enterprise **2026.0.315**（portable，`E:\Marvelous Designer\`）
> 配套：3D/接线/验证已经全自动 → `tools/add_part.py`（见 `README_加部件.md`）

---

## 0. 每次开 MD 的第一件事（不点就全废）

```
MD 菜单 → 插件 → 插件 → md_start_listener
```

点完监听才在 **7421** 端口起来；Hermes 里 `ping` 返回 `pong: true` 才算连上。
MD 一重启就得重**新点一次**，这是唯一必须手动做的「开关」。

---

## 1. 全流程一览

```
① 人台 OBJ（已备好，不用再导）
        ↓
② MD 新建项目 → 导入人台 → 导入服装
        ↓
③ 尺寸对不上就在 2D 窗口手动缩 → 模拟 10 步 → 40 步
        ↓
④ 让 Hermes 从【模拟快照】导出干净 OBJ（不要用普通导出）
        ↓
⑤ tools/add_part.py --apply   ← 之后全自动
```

---

## 2. 导入纳西妲人台

**现成人台**：`E:\Marvelous Designer\avatar_naxida\纳西妲身体_mm.obj`

- 规格：**17,524 顶点 / 27,252 面**，高 **1066.3mm**，肩宽方向 **706.5mm**，T-pose，**脚底在 Y=0**，单位毫米、Y-up
- UI 路径：`文件 → 导入（Import）→ 角色 / Avatar` → 选这个 OBJ → 单位毫米、轴向 Y-up、Scale = 1.0
- 或让 Hermes 一条命令导入（已验证可用）：
  ```
  import_avatar(path=..., options={ImportObjectType:0, axisX:0, axisY:1, axisZ:2, bAdd:false, scale:1.0})
  ```

**验收**：3D 窗口里人台高度 ≈ 1.07 m、双臂平展（T-pose）、脚底贴地。

> ⚠️ 记一个数：人台导出时**脚底归零**了，但实际模型脚底在 `z = 77.06mm`。
> 所以之后把服装导进 Blender 要整体上移 **+77.06mm**（流水线配置里已经写好，别改）。

---

## 3. 导入服饰文件

| 格式 | 做法 | 备注 |
|---|---|---|
| `.zpac` | **直接拖进 MD 窗口**，或 `文件 → 导入 → 服装 / ZPAC` | 导入选项里**勾「合并 / Add」**，否则会替换掉当前版面 |
| `.obj` / `.fbx` | `文件 → 导入 → OBJ / FBX` | 注意单位与轴向 |

**验收**：
- 版片数对不对（例：休闲猫娘那套 = **25 版片 / 35,861 顶点 / 12 材质**）
- 有没有「找不到贴图」的提示（有就先把图放同目录）
- 进 3D 窗口看一眼：是穿在身上，还是飘在头顶 1 米外

---

## 4. 尺寸对不上怎么办（最常遇到，也最容易做错）

### 判据（先量再动）

| 现象 | 含义 | 处理 |
|---|---|---|
| 服装 Y 范围 ≈ 700~1900mm，高度 1100mm+ | 按 1.8m 成人做的，**整体偏大 ~1.7 倍** | 要缩到人台比例 |
| 服装高度 ≈ 人台 1066mm 的 1.0~1.05 倍 | 基本合适 | 只微调位置 |
| 局部紧（胸/腰嵌进身体） | 体型差异 | 靠模拟 + 手动挪点 |

**目标**：服装高度 ≈ 人台高度 × 1.0（连衣裙到膝上可以 0.75~0.9 倍）。

### 缩放怎么做

- MD 的 Python API **没有**缩放版片的接口（`pattern_api` / `utility_api` 都查过），右键菜单里也没有 —— 只能在 **2D 窗口手动**缩：
  1. 2D 窗口 `Ctrl+A` 全选
  2. 用变换手柄（或顶部工具条的缩放/Transform）缩到目标尺寸
  3. 切回 3D 窗口按**空格**跑模拟看大形
- 缩完通常还要**往下挪**，让肩线/领口落到位
- 实在不方便：**先缩再导入**也行 —— 在源头软件（Blender/3ds Max）里缩好再导 zpac

### 模拟节奏（别一次跑太多）

```
先 模拟 10 步  → 看大形（有没有穿模/飞出去）
再 模拟 40 步  → 看褶皱是否自然
不满意 → 继续 40 步；大改（删版片/挪点）→ 重来
```

> ⚠️ **删版片要小心**：上次删多了（35,861 → 13,349 顶点）直接**把缝线删断**，模拟出来只剩胸前一小块布。
> 只删明显多余的独立装饰片（蝴蝶结、飘带），别碰主体版片的缝线。

### 那次的成功数值（可以当验收线）

| 指标 | 好值 |
|---|---|
| 服装高度范围 | 343 ~ 1157mm（人台 0~1066） |
| 嵌入身体的点 | **0 点（0.0%）** |
| 里身体中位距离 | **+5.5mm** |
| 悬空 >40mm 的点 | ≤ 2%（猫耳这种正常） |

---

## 5. 导出结果（这里有坑，别用普通导出）

### ❌ 不要用 `文件 → 导出 → OBJ`

实测：MD 会把**还排在 2D 纸样区、没上身的版片**按纸样坐标一起写进同一个 OBJ →
X 跨度 **2589mm**、顶点数虚高（23,374 里混了 5,842 个纸样点），导进 Blender 直接报废。

### ✅ 正确做法：从「模拟快照」导出仅服装的 OBJ

1. 在 MD 里模拟到满意
2. 让 Hermes 执行 `get_simulation_metrics`（会做一次 **garment-only OBJ 导出**）
3. 拿到 `current_snapshot_id`，文件就在：
   ```
   C:\Users\24805\AppData\Local\marvelous-designer-mcp\cache\simulation-samples\<id>.obj
                                                            ...\<id>.mtl
                                                            ...\<id>.json
   ```
4. 拷出来改名，例如 `E:\Marvelous Designer\avatar_naxida\深海JK.obj`

实测那次：**17,532 顶点 / 26,014 面 / 12 材质**，Z 343~1157mm，UV 完整。

> ⚠️ 这个 `.mtl`（连材质名）是 **GBK 编码**。Blender / Python 按 UTF-8 读会崩在
> `UnicodeDecodeError: 0xf4`。**不用你处理** —— 流水线会自动转码并修贴图路径。

### 想留个存档

```
create_checkpoint(label="深海JK-定稿前")
```
→ 存成 `.zprj` 在 `...\marvelous-designer-mcp\checkpoints\<id>.zprj`，
以后 `restore_checkpoint(id)` 可整场景还原（含版片/缝线/材质/人台）。

---

## 6. 交给流水线（剩下全自动）

```bash
cd /e/NXD/NXD桌宠/_3d
D:/Python/python39.exe tools/add_part.py -c tools/parts/深海JK.json --apply
```

配置只需要改 **4 个字段**（其余照抄 `parts/猫娘服装.json`）：

```json
{
  "name": "深海JK",                     // Blender 对象名
  "label": "深海JK制服",                 // 设置页显示名
  "category": "👗 连衣裙",               // 部件分类（没有会自动建）
  "source": "E:/Marvelous Designer/avatar_naxida/深海JK.obj"
}
```

| 情况 | 配置怎么写 |
|---|---|
| 从**本次人台**导出的件 | `"offset": {"mode": "fixed", "z_mm": 77.06}`（保持） |
| 服装本身已经脚底贴地/比例正确 | `"offset": {"mode": "auto"}` |
| 帽子/耳饰/尾巴 | `"weights": {"mode": "hard", "bone": "头"}`（或 `下半身`） |
| 有印花/logo | `uv.rules` 加一条 `project`（定标见 README） |

---

## 7. 一页检查清单

**开 MD**
- [ ] 点了 `插件 → 插件 → md_start_listener`，Hermes `ping` 通

**导入**
- [ ] 人台是 `纳西妲身体_mm.obj`（1066mm 高、T-pose、脚底 0）
- [ ] 服装导入方式对（zpac 拖入 / 勾了「合并」）
- [ ] 版片数符合预期，无缺贴图警告

**调整**
- [ ] 服装高度 ≈ 人台 ×1.0（或连衣裙 0.75~0.9）
- [ ] 10 步 → 40 步模拟，胸/腰/大腿无穿模
- [ ] 没有断缝线（没删到主体版片）

**导出**
- [ ] **没**用普通「导出 OBJ」
- [ ] 走 `get_simulation_metrics` 快照，拷出 `.obj` + `.mtl`

**流水线**
- [ ] 配置改了 name / label / category / source
- [ ] `add_part.py --apply` 跑通：嵌入 0 点、复位偏差 0.0000mm、漏挂 0、死键 0

**收尾（你）**
- [ ] Blender 里看外观 → `Ctrl+S`
- [ ] 导出 PMX（`tools/导出PMX.py`）
- [ ] 重启桌宠（关掉 8810 进程）→ 设置页「部件」勾上验收

---

## 8. 速查数字

| 项 | 值 |
|---|---|
| 人台 | 17,524 顶点 / 27,252 面 / 高 **1066.3mm** / 肩宽 **706.5mm** / T-pose / 脚底 Y=0 |
| 人台→模型脚底差 | **+77.06mm**（导入 Blender 要补） |
| 上次成品服装 | 17,532 顶点 / 26,014 面 / 12 材质 / Z 343~1157mm / 嵌入 0 点 |
| MD listener | **7421**（`插件 → 插件 → md_start_listener`） |
| 快照 OBJ 目录 | `C:\Users\24805\AppData\Local\marvelous-designer-mcp\cache\simulation-samples\` |
| 检查点 ZPRJ 目录 | `C:\Users\24805\AppData\Local\marvelous-designer-mcp\checkpoints\` |
| Blender MCP | 9877；桌宠服务 8810 |
| MD Python | 3.11.8（`execute_python` 不是沙箱，只连本机） |

---

## 9. 已知限制（别浪费时间试）

- ❌ MD **没有**缩放版片的 API / 右键菜单项 → 只能手动缩或源头缩
- ❌ 导出选项里的 `bCreateUnifiedTexture` / `bUnifiedUVCoordinates`（统一贴图）**实测不生成图集**（OBJ、FBX 都试过）→ 别指望它修 UV，UV 问题交给流水线
- ❌ 普通 `export_obj` 会混入 2D 纸样坐标 → 只用快照 OBJ
- ⚠️ 无独显：Blender 无头渲染 EEVEE 是空白，要出图用 CYCLES CPU
