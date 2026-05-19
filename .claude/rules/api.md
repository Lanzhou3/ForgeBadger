---
name: api-rules
description: API 开发和数据库规范
type: api
paths: ["src/api/**", "src/db/**", "**/schema.prisma", "**/migration/**", "**/models/**"]
---

# API 规范

## 响应格式

OpenForge REST API 必须使用项目级响应 envelope：

```
{
  "code": 0,
  "data": {},
  "message": ""
}
```

错误响应：

```
{
  "code": 1,
  "message": "error description",
  "details": {}
}
```

说明：

- `code: 0` 表示成功。
- `code: 1` 表示失败。
- `data` 只在成功时返回业务数据。
- `details` 只在需要结构化错误上下文时返回。
- 不使用 `{ success, data, error }` 格式，避免与 `CLAUDE.md` 和 `docs/TECH-ARCHITECTURE.md` 冲突。

## HTTP 方法

```
GET    - 查询（幂等）
POST   - 创建
PUT    - 全量更新
PATCH  - 部分更新
DELETE - 删除（幂等）
```

## 状态码

```
200 - 成功
201 - 创建成功
400 - 参数错误
401 - 未认证
403 - 无权限
404 - 资源不存在
500 - 服务器错误
```

---

# 数据库规范

## SQL 查询

```
禁止：字符串拼接 SQL
必须：参数化查询

错误：
query(`SELECT * FROM users WHERE id = ${userId}`)

正确：
query('SELECT * FROM users WHERE id = $1', [userId])
```

## 危险操作确认

```
DROP TABLE    - 操作前确认影响
TRUNCATE      - 操作前确认影响
DELETE        - 操作前确认 where 条件
```

---

# 输入校验

```
必须：用户输入必须校验
必须：使用 schema 校验（zod/joi/pydantic）
失败：返回 400 Bad Request
```

---

# 错误处理

```
try {
  // 操作
} catch (error) {
  // 记录错误
  // 返回统一错误格式
}
```
