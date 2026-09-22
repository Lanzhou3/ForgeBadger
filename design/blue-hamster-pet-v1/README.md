# 银蓝科技金丝熊 — Blender 静态模型

以本目录 `reference.png`（本次用户确认的银灰微蓝、透明 AR 护目镜、石墨色马甲概念图）为唯一造型参考，从零制作。没有读取或复用旧版金丝熊草稿、模型或建模脚本。

这是概念图的可编辑三维重建初版，实际造型更偏圆润卡通；渲染图来自本目录的真实 Blender 场景。

## 交付文件

- `blue-hamster.blend`：完整可编辑场景，包含角色、毛发、装备、灯光和相机；概念参考图已内嵌。
- `hero.png`：1200 × 1200，侧前方主视图。
- `front.png` / `rear.png`：1000 × 1100，正面与背面。
- `pet-transparent.png`：1024 × 1024，真实透明背景 RGBA 素材。
- `reference.png`：用户确认的原始概念图，独立保存。
- `preview.png`：建模期间的 768 × 768 快速预览。
- `build_blue_hamster.py`：完整、确定性的建模与渲染脚本。
- `model-info.json`：实际几何体和毛发统计。
- `verify_model.py` / `verification.json`：保存文件与输出图像的完整性检查脚本、执行记录。

## 模型结构

场景按身体、面部、毛发、马甲、护目镜、姿态控制、摄影棚分为七个集合。

- 身体与头部为平滑网格，脸颊和口鼻以体素重建融合。
- 244,335 根实际三维短绒，保存在 6 个原生 Hair Curves 对象中；每根有 5 个控制点、逐渐收细的半径和独立毛色。
- 内外耳分层，眼睛、鼻口、胡须、小爪与指甲独立可编辑。
- 马甲含织物材质、包边、缝线、独立青蓝灯带。
- 护目镜含曲面透明镜片、镜框、镜腿与指示灯。
- 头部有独立旋转中心；这不等于完成了角色骨骼绑定。
- Blender 中 Z 向上、角色面朝 -Y，尺寸为造型单位。

当前是**静态外观模型**，没有骨骼、动画或平台接入。完整毛发与程序材质以 `.blend` 为交付源文件；没有用省略毛发的 GLB 代替完整外观。

## 重建和渲染

在仓库根目录运行。本次实际使用 Blender 5.2.1 LTS、Cycles CPU。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 10 --python design/blue-hamster-pet-v1/build_blue_hamster.py
```

脚本只应在独立后台进程运行：它会清空该进程的场景并覆盖本目录的生成文件，不要在正在编辑的 Blender 场景中执行。已有 Blender 窗口不受独立进程影响。

快速建模预览：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 10 --python design/blue-hamster-pet-v1/build_blue_hamster.py -- --preview
```

直接从保存的模型重新渲染四张成品图：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background design/blue-hamster-pet-v1/blue-hamster.blend --threads 10 --python design/blue-hamster-pet-v1/build_blue_hamster.py -- --render-only
```

检查交付文件：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background design/blue-hamster-pet-v1/blue-hamster.blend --python design/blue-hamster-pet-v1/verify_model.py
```

本机受限沙箱中的 Blender 启动会在 Metal 初始化时崩溃；以上独立后台命令已在获得执行权限的环境中使用。渲染使用 CPU，不依赖正在打开的 Blender 场景。
