---
name: backend-rules
description: 后端规范
type: backend
paths: ["src/server/**", "src/services/**", "src/workers/**", "**/service.ts", "**/handler.ts"]
---

# 函数设计

```
原则：单一职责
限制：不超过 50 行
嵌套：不超过 4 层，用 early return
```

## 错误示例

```
async function handleUserAction(userId, action) {
  const user = await validateUser(userId);
  const result = await executeAction(user, action);
  await logAction(userId, action);
  await sendNotification(userId, action);
  return result;
}
```

## 正确示例

```
async function handleUserAction(userId, action) {
  const user = await validateUser(userId);
  const result = await executeAction(user, action);
  await Promise.all([
    logAction(userId, action),
    sendNotification(userId, action)
  ]);
  return result;
}
```

---

# 异步处理

```
必须：try/catch 包装异步操作
必须：记录错误上下文
禁止：裸 throw
```

---

# 日志

```
格式：结构化日志
必须包含：userId, action, duration, timestamp
禁止：打印敏感数据
```

---

# 环境配置

```
禁止：硬编码
必须：process.env
建议：zod 校验环境变量类型
```
