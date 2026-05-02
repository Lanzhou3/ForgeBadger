---
name: security-rules
description: 安全规范
type: security
paths: ["**"]
---

# 安全规范（全局）

## 硬编码红线

以下内容**绝对禁止**硬编码在代码中：
- API 密钥 / Token
- 数据库密码
- 加密密钥（JWT Secret 等）
- 第三方服务凭据
- 私钥/证书

**正确做法**：使用环境变量

```typescript
// 错误
const apiKey = 'sk-xxxxxxx';

// 正确
const apiKey = process.env.API_KEY;
```

## 输入校验

| 场景 | 要求 |
|------|------|
| 用户表单 | 必须校验类型、长度、格式 |
| API 参数 | 使用 schema 校验（zod/joi） |
| 文件上传 | 校验文件类型、大小、MIME |
| SQL 查询 | 参数化查询，禁止拼接 |
| HTML 输出 | 转义用户输入，防 XSS |

## 权限控制

- 认证：Token / Session 校验
- 授权：基于角色的访问控制（RBAC）
- 文件访问：校验用户是否有权访问该资源

## 敏感数据

- 日志中禁止打印密码、Token、信用卡号
- 响应中过滤敏感字段
- 数据库中敏感字段加密存储

## CSRF / XSS 防护

- CSRF Token 校验
- 用户输入转义
- CSP（Content Security Policy）配置
- HTTPOnly / Secure Cookie 设置
