# H-03 — 奶油色短绒仓鼠

第三版遵循用户选定的方向：Mogomogo 金丝熊的奶油色、小棕耳和黑豆眼，结合 potte 类毛绒玩具的圆润、紧凑体块。保留前两版，新模型单独保存。

## 造型

- 短而宽的豆子状身体，头部自然融入身体，没有长躯干或明显脖子。
- 微鼓脸颊融合为连续曲面，采用小黑豆眼、刺绣感鼻口。
- 小棕耳部分埋在头部，粉色小爪收拢在胸前，脚是简化的布偶形状。
- 实际曲线短绒采用轻微卷曲、短密混合，避免第二版的长直毛发。
- 科技元素仅保留一枚小型终端胸牌。

参考来源（用于设计方向，未导入或复制其模型、图片或纹理）：

- [三英贸易 Mogomogo 金丝熊商品图](https://item.rakuten.co.jp/laughlaugh/group326-/)
- [Sun Arrow potte 仓鼠商品图](https://petitpokke.shop-pro.jp/?pid=167528042)

## 文件

- `forgebadger-h03-plush.blend`：完整可编辑模型、短绒、材质、灯光和相机。
- `hero.png`：1200 × 1200 侧前方预览。
- `front.png` / `rear.png`：900 × 1000 正面、背面预览。
- `pet-transparent.png`：640 × 640 RGBA 透明背景预览。
- `build_hamster.py`：可重复执行的建模与 Cycles CPU 渲染脚本。
- `model-info.json`：实际短绒数量与 Blender 版本。

当前为静态造型，无骨骼或动画，未加入平台宠物选项。完整短绒保存在 Blender 曲线中，本版没有 GLB 导出。后续平台接入仍可使用预渲染精灵图。

## 重建

从仓库根目录运行：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python design/hamster-pet-v3/build_hamster.py
```

上述命令创建独立后台场景，不改变已打开的 Blender 窗口；重复执行会覆盖本目录同名输出。脚本会清空所在进程的场景，因此不要直接在用户正在编辑的场景中执行。
