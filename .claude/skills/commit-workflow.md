---
name: commit-workflow
description: 提交工作流
type: workflow
---

# 提交工作流

## 执行步骤

```
1. git diff --staged
2. git log --oneline -5
3. 分析变更目的
4. 生成 Conventional Commits 格式提交
```

## 格式

```
<type>: <简短描述>

type：
feat - 新功能
fix - Bug 修复
refactor - 重构
docs - 文档
test - 测试
chore - 构建/工具
```

## 规则

```
- 标题不超过 50 字
- 描述为什么改，不描述改了什么
- 一个提交只做一件事
```

## 示例

```
feat: add user profile page

feat: resolve login redirect loop
When session expires, user was trapped in redirect loop.
Now properly clears auth state and redirects.
```

## 验证

```
提交前运行：npm run lint && npm test
```
