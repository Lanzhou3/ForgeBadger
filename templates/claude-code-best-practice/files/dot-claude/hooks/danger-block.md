---
name: danger-block-hook
description: 危险操作拦截
type: hook
trigger: PreToolUse
---

# 危险操作拦截 Hook

## 触发条件

匹配到以下模式时拦截并要求确认：

| 模式 | 风险等级 | 说明 |
|------|----------|------|
| `rm -rf` | CRITICAL | 递归强制删除 |
| `DROP TABLE` | CRITICAL | 删除数据库表 |
| `TRUNCATE` | HIGH | 清空表数据 |
| `DROP DATABASE` | CRITICAL | 删除数据库 |
| `CHMOD 777` | HIGH | 权限过大 |
| `curl.*\|.*bash` | CRITICAL | 远程代码执行 |

## 拦截流程

1. 识别危险操作
2. 暂停执行
3. 向用户确认：
   - 操作意图是什么？
   - 是否在 tmux/screen 中运行？
   - 确认无误后输入 `yes` 继续
4. 如果用户拒绝，生成安全的替代方案

## 示例拦截

```
⚠️ 危险操作拦截

检测到：`rm -rf ./dist`
意图：清除构建目录

确认以下情况：
□ 路径正确（当前目录无误）
□ 已备份重要文件
□ 在 tmux/screen 中运行（如适用）

输入 "yes" 继续，或描述替代方案：
```

## 替代方案建议

| 危险操作 | 安全替代 |
|----------|----------|
| `rm -rf *` | `rm -i *`（交互式确认） |
| `DROP TABLE` | `DELETE FROM`（逐行删除，可回滚） |
| `curl \| bash` | 先下载脚本，检查内容，再执行 |
