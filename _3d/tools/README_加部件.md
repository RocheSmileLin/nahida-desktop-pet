# 加部件流水线（自动化）

把任意外部服装/配件（MD 导出 OBJ、FBX…）变成桌宠里**可开可关的部件**，一条命令跑完 3D 处理 + 前端接线 + 验证。

```
python tools\add_part.py -c tools\parts\猫娘服装.json            # 预演（不改任何文件）
python tools\add_part.py -c tools\parts\猫娘服装.json --apply     # 真跑
```

---

## 三步流程

| 步 | 谁做 | 内容 |
|---|---|---|
| ① 准备 | 你 | 把服装放进 Blender 场景需要先有源文件（OBJ/FBX），然后在 `tools/parts/` 复制一份配置改 4 个字段 |
| ② 跑流水线 | 命令 | `add_part.py --apply`：3D 处理 → 接线 → 验证（约 10 秒/件，17.5k 顶点实测 8 秒） |
| ③ 收尾 | 你 | Blender 里看外观 → `Ctrl+S` → 导出 PMX → 重启桌宠 → 设置页勾选验收 |

> ⚠️ 3D 阶段会无头打开并**保存** `纳西妲完美版_骨骼中文化.blend`，所以跑之前**先关 Blender**。
> Blender 开着时 `add_part.py` 会自动跳过 3D 阶段（不会抢文件），只跑接线。
> 也可以让 Hermes 用 MCP 在**已打开的会话里**执行 `add_part_3d.py`。

---

## 配置（`tools/parts/<名字>.json`）

```json
{
  "name": "猫娘服装",            // Blender 对象名（同名会先删旧的再导入）
  "label": "猫娘连衣裙",          // 设置页显示名
  "category": "👗 连衣裙",        // PART_TREE 分类（没有就自动新建）
  "source": "E:/.../猫娘服装_utf8.obj",
  "source_type": "obj",
  "arm": "纳西妲_arm",
  "material_prefix": "猫娘-",     // 材质名统一前缀（= PMX 名 = 软件端开关键）
  "axis": { "forward": "NEGATIVE_Z", "up": "Y", "scale": 0.001 },
  "offset": { "mode": "fixed", "z_mm": 77.06 },
  "materials": { "from_mtl": true },
  "uv": { "rules": [
      { "mat_prefix": "sweater正面", "mode": "project", "k": 0.0013,
        "anchor": [0.447, 0.704], "anchor_z": "top30" },
      { "mat_prefix": "爪子口袋", "mode": "island", "fill": 0.84 } ] },
  "weights": { "mode": "skin", "max_bones": 4,
               "smooth": { "z_max": 0.70, "radius_mm": 12, "rounds": 3 } },
  "cloth": true
}
```

### 字段说明

| 字段 | 取值 | 说明 |
|---|---|---|
| `offset.mode` | `auto` / `fixed` | `auto` = 自动把最低点对齐到身体脚底；`fixed` = 手动给 `z_mm`（MD 人台脚底归零的件用这个） |
| `material_prefix` | 字符串 | 每次导入 Blender 会加 `_FRONT_1685.001` 之类后缀，这里统一抹掉并加前缀，保证名字可复现 |
| `materials.from_mtl` | true/false | 按 MTL 的 `Kd` / `map_Kd` / `map_bump` **重建节点**（MD 的 MTL 常把法线图当颜色图接错） |
| `uv.rules[].mode` | `keep` / `project` / `island` | `keep` 不动；`project` = 世界 XZ 正交投影（印花定标：`k`=uv/mm，`anchor`=贴图里图案中心，`anchor_z`=`top30`/`center`/毫米值）；`island` = 每个 UV 岛铺满一张贴图（爪印、口袋徽章） |
| `weights.mode` | `skin` / `hard` | `skin` = 抄最近身体皮肤顶点权重（KD 8→24→64、1/d²、左右去串、≤N 骨、两段归一化）；`hard` = 100% 绑单骨（猫耳→头、尾巴→下半身） |
| `weights.smooth` | 可省 | 裙摆区空间平滑，消掉腿骨与下半身之间的权重跳变 |
| `cloth` | true/false | true → 额外写进 `CLOTH_MATS` 与 `TOP_BOTTOM_MATS`（上下装：优先上传显存、参与穿模排序） |

---

## 各阶段产物

**3D（`add_part_3d.py`）**
1. 备份 `.blend` → `_backup/纳西妲_加部件前_<时间>.blend`
2. OBJ/MTL 编码转换（GBK→UTF-8）+ **贴图拷到同目录**（Blender 只按 OBJ 同目录找贴图，写绝对路径会失败）
3. 导入（毫米→米、Y-up→Z-up）、只保留顶点最多的网格
4. 对齐、材质名稳定化、MTL 重建、UV 规则
5. 挂父级 + **补 Armature 修改器**（外部件常只挂父级、没有修改器 → 完全不动）
6. 权重 + 裙摆平滑
7. 验收：穿模（BVH 有符号距离）+ 5 组姿势跟随（复位偏差必须 0.0000mm）
8. 存盘 + 写 `tools/parts/<名字>.materials.json`（接线阶段的输入）

**接线（`add_part_wire.py`）** 幂等，重复跑只补缺
- `部件材质对照.json`、`pet_settings.json`（`parts[key]=false` 默认不戴）、`sets.json`（每套 `hide[key]=false`）
- `js/settings/20-parts.js` → `PART_TREE`（有同名分类就追加，没有就新建）
- `js/pet/80-assets.js` → `CLOTH_MATS`；`cloth=true` 再写 `TOP_BOTTOM_MATS`；`js/viewer/60-assets.js` → `TOP_BOTTOM_MATS`
- 自动备份 6 个文件到 `_backup/接线_<时间>/`（按原目录结构保存，如 `js/pet/80-assets.js`）

**验证**
- 4 个数组的 JS 语法（node --check）
- 漏挂：每个材质有没有出现在该出现的数组里
- 死键：`pet_settings.json` 里的键在对照表里存不存在
- `/petparts`：桌宠运行时比对上报清单（PMX 没导出会提示缺 N 个）

---

## 踩过的坑（都已内置处理）

| 坑 | 处理 |
|---|---|
| 贴图全丢（`Cannot load image file: ...\E:/...`） | 贴图**拷到 OBJ 同目录**、MTL 里写纯文件名 |
| 材质名每次带 `_FRONT_1685.001`，接线键对不上 | 导入后统一抹后缀 + 加 `material_prefix` |
| MD 的 MTL 把**法线图当底色** | `from_mtl` 重建节点：`map_Kd`→Base Color、`map_bump`→Normal |
| MD 的 UV 是平铺模式（跑到 −1.47~2.23），印花错位 | `uv.rules` 按世界坐标重投影 |
| 外部件没有 Armature 修改器 → 不跟骨 | 自动补 |
| 自动权重只成功一半（大量顶点无权重） | 改用抄最近身体皮肤顶点 |
| 纯 Python 读 GBK 的 MTL / 材质名坏 UTF-8 | 全程按引用操作、不读 `.name`；编码三段回退 |

---

## 实测参数（猫娘服装）

- 17,532 顶点 / 26,014 面 / 12 材质；导入→权重→验收 **8.2 秒**
- 对齐 `+77.06mm`；嵌入 **0 点 (0.0%)**、离体中位 **+5.5mm**
- 姿势跟随：上半身 15°→胸口 14.5mm、下半身 15°→下摆 17.4mm、腿 25°→下摆 4.3mm、肩 20°→袖 29.5mm、头 20°→0mm；复位偏差 **0.0000mm**
- 胸口印花：`k=0.0013`、`anchor=[0.447,0.704]`、`anchor_z=top30` → 图案约 77mm、落在胸线
