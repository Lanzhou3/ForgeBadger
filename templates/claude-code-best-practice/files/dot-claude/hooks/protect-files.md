---
name: protect-files-hook
description: 保护关键文件不被修改
type: hook
trigger: PreToolUse
matcher: Edit|Write
---

# protect-files Hook

当检测到对受保护文件的 Edit/Write 操作时拦截。

## 受保护文件

以下文件禁止通过 Edit/Write 工具修改：
- `.claude/settings.json`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `Cargo.lock`, `go.sum`
- `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`
- 测试文件（除非明确要求修改测试）

## 判断逻辑

当用户请求 Edit 或 Write 操作时：
1. 检查目标文件路径
2. 若匹配受保护模式，输出拦截原因并建议替代方案
3. 若确需修改（如更新依赖版本），说明风险并要求确认

## 替代方案

- 修改配置 → 建议通过环境变量或配置文件处理
- 修改测试 → 确认是测试本身有 bug 还是功能代码需要修改
