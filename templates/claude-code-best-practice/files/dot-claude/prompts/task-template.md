---
name: task-template
description: 任务提示词模板
type: template
---

# 标准任务模板

## 结构

```
你是一个 [角色]。
请完成 [具体任务]。

验证方式：
- [测试用例]
- [预期行为]
- [截图]

技术栈：[技术栈]
约束：[约束]
相关文件：[文件]
```

## 示例

```
你是一个后端工程师。
请为订单模块实现 CRUD API。

验证方式：
- npm test 订单创建/查询/更新/删除全部通过
- POST /api/orders 返回 201
- GET /api/orders/:id 不存在返回 404

技术栈：Node.js + Express + Prisma
约束：RESTful，参数校验，错误格式统一

相关文件：src/api/orders/route.ts
```

## 规则

```
- 提供验证方式（测试、截图、构建）
- 指定输出格式
- 说明边界情况
- 指向现有代码模式参考
```
