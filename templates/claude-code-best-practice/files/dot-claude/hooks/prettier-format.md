---
name: prettier-format-hook
description: 保存时自动格式化代码
type: hook
trigger: PostToolUse
matcher: Write|Edit
---

# prettier-format Hook

文件保存后自动格式化（仅当项目配置了 Prettier 时启用）。

## 触发条件

- Write 或 Edit 工具执行后
- 仅在项目根目录存在 `.prettierrc` 或 `prettier.config.js` 时生效

## 格式化命令

```bash
npx prettier --write {path}
```

## 注意事项

- 格式化失败不影响原操作
- 可通过 `--ignore-unknown` 忽略无后缀文件
- 大文件（>1MB）跳过格式化
