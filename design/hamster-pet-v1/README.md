# ForgeBadger H-02 — 科技仓鼠造型初稿

参考用户提供的仓鼠照片：奶油色与浅沙色毛发、圆耳、黑亮眼睛、粉鼻子、鼓鼓的颊囊与粉色小爪。采用适合平台宠物的圆润玩偶比例，配备单侧通讯器、青色终端胸牌和小型能源背包。科技装备保留在面部外围，保持动物的亲切感。

## 文件

- `forgebadger-h02.blend`：可编辑 Blender 场景，包含模型、材质、相机与摄影棚灯光。
- `forgebadger-h02.glb`：仅角色与装备，内置基础 PBR 材质，无外部资源依赖。
- `hero.png`：1200 × 1200 侧前方主视图。
- `front.png` / `rear.png`：900 × 1000 正面与背面。
- `pet-transparent.png`：640 × 640 RGBA 透明背景角色。
- `build_hamster.py`：可重复执行的建模、导出与渲染脚本。
- `model-info.json`：Blender 版本、网格数量、三角形数量与 GLB 大小。

## 当前范围

此版本是静态造型预览，尚未加入前端宠物选项，也没有骨骼绑定或动画片段。头、身体、双臂、双脚、背包有独立层级，可用于后续动作制作。Blender 中 Z 向上、面朝 -Y，GLB 使用 glTF 坐标约定。

毛发表现采用细微程序凹凸与柔和材质，并非逐根毛发。程序凹凸和部分高级材质参数只保留在 Blender 场景；GLB 使用基础 PBR 外观，因此直接查看 GLB 与 Cycles 渲染会有细节差异。

后续若接入平台，可沿用机器人的预渲染 WebP 精灵图方案；当前未修改应用运行时代码。

## 重建

本机已验证 Blender 5.2.1 LTS 后台 CPU Cycles 渲染。请从仓库根目录运行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python design/hamster-pet-v1/build_hamster.py
```

脚本在独立后台进程中重建场景并覆盖本目录同名输出文件，不影响已打开的 Blender 窗口。不要在用户正在编辑的场景中直接运行脚本，因为它会清空当前进程的场景。
