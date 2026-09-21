# 银蓝科技金丝熊 — 按重新上传的参考图重建

以本目录 `reference.png` 为造型依据，重新构建头部、身体、前臂、小爪、马甲和护目镜。参考图对应用户再次上传的银灰微蓝仓鼠：歪头、向内轻搭的小爪、弧形透明护目镜和开襟科技马甲。

这是可编辑的静态三维重建初版。单张图片不能给出完整背面结构，背部按马甲与镜腿的结构补全；实际三维造型仍是对参考图的近似，不代表逐像素复刻。

## 文件

- `blue-hamster-v2.blend`：角色与完整摄影棚场景，参考图已打包在文件内。
- `hero.png`：1200 × 1200，实际 Blender 主视图渲染。
- `front.png` / `rear.png`：1000 × 1100，正面与背面。
- `pet-transparent.png`：1024 × 1024，真实透明背景 RGBA 渲染。
- `reference.png`：本次重新上传的参考图。
- `preview.png`：建模阶段的 800 × 800 快速造型预览；最终效果以 `hero.png` 为准。
- `build_model.py`：新版造型、毛发、装备与渲染脚本。
- `blender_helpers.py`：通用几何体、材质与场景工具函数，不含角色造型数据。
- `model-info.json`：实际毛发和对象统计。
- `verify_model.py` / `verification.json`：保存文件重新打开、毛发数据和渲染图完整性检查。

## 可编辑结构

- 头部是按轮廓截面与局部曲率构建的一张连续网格，包含脸颊和口鼻起伏。
- 头部有独立姿态根节点，按参考方向倾斜约 14 度。
- 身体是紧凑的梨形曲面，前臂是连续弯曲且逐渐收窄的网格；小爪朝内轻搭。
- 约 35 万根原生 Hair Curves 短绒，每根有 6 个控制点、独立颜色与逐渐收细的半径；确切数量见 `model-info.json`。
- 马甲有弧形前襟、袖口、包边、缝线、织物材质和青蓝灯带。
- 护目镜有独立曲面透光镜片、镜框、镜腿和指示灯。
- 场景分为身体、面部、毛发、马甲、护目镜、姿态根节点和摄影棚七个集合。

毛发是实际三维曲线，参考图仅作为内嵌参考，不贴在平面上代替角色。当前没有骨骼绑定、动画，也未接入 Web 宠物系统。

## 本次检查

最终 `.blend` 已由独立 Blender 进程重新打开，内嵌参考图与本次上传文件的 SHA-256 一致。353,859 根毛发的坐标、半径与颜色属性检查通过；四张成品图的尺寸与像素数据有效，透明素材有真实 alpha 通道且主体未碰到画布边缘。详细记录见 `verification.json`。

主视图与背面已人工查看。当前形体和毛发表现仍比参考图偏卡通，完整性检查不代表已经达到逐细节的视觉复刻。

## 重建

在仓库根目录，使用独立 Blender 后台进程运行。本次使用 Blender 5.2.1 LTS：造型预览使用 Cycles CPU，最终高清输出使用本机 Apple M5 的 Cycles Metal。保存的场景仍默认 CPU，便于移机打开。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 10 --python design/blue-hamster-pet-v2/build_model.py
```

在有可用 Metal 设备的 Mac 上，可追加 `-- --gpu` 加速渲染。该选项只改变当前进程，不保存用户的全局 Blender 偏好；如果未检测到 Metal 设备会明确报错。

快速预览：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 10 --python design/blue-hamster-pet-v2/build_model.py -- --preview
```

从保存的模型渲染四张成品图：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background design/blue-hamster-pet-v2/blue-hamster-v2.blend --threads 10 --python design/blue-hamster-pet-v2/build_model.py -- --render-only
```

检查交付文件：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background design/blue-hamster-pet-v2/blue-hamster-v2.blend --python design/blue-hamster-pet-v2/verify_model.py
```

建模脚本会清空所在进程的场景并覆盖本目录生成文件，因此不要在用户正在编辑的场景中运行。独立后台进程不修改已有 Blender 窗口中的场景。已有设计版本保留在原目录。
