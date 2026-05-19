---
name: testing-rules
description: 测试规范
type: testing
paths: ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/__tests__/**", "**/test_*.py"]
---

# 测试结构

```
describe('模块名', () => {
  describe('方法名', () => {
    it('应该做某事', () => {
      // Arrange - 准备数据
      // Act - 执行操作
      // Assert - 验证结果
    });
  });
});
```

---

# Mock 规则

```
用于：外部依赖（API、数据库、第三方）
禁止：mock 内部实现
优先：真实对象
```

---

# 覆盖率

```
核心业务：80%+
边界情况：必须测试
错误路径：必须测试
```

---

# 测试类型

```
单元测试：*.test.ts（函数、组件）
集成测试：**/integration/**（API、数据库）
E2E 测试：e2e/**/*.spec.ts（关键流程）
```
