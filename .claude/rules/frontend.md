---
name: frontend-rules
description: 前端规范
type: frontend
paths: ["src/components/**", "src/pages/**", "src/app/**", "*.tsx", "*.jsx", "*.vue"]
---

# React 规范

## 组件

```
命名：PascalCase
文件：ComponentName.tsx
结构：interface Props → function → export
```

## Props

```
interface Props {
  title: string;
  onClick?: () => void;
}

export function Button({ title, onClick }: Props) {
  return <button onClick={onClick}>{title}</button>;
}
```

## Hooks

```
命名：use 前缀
职责：单一职责
依赖：完整依赖数组
清理：return 清理副作用
```

---

# Vue 3 规范

## 组件

```
文件：.vue 单文件
语法：script setup 优先
props：defineProps 泛型定义
```

## 组合式函数

```
目录：composables/
命名：use 前缀
职责：单一职责
```

---

# 通用规范

```
状态管理：
- useState：组件状态
- Context/Zustand：跨组件
- React Query/SWR：服务端数据

性能：
- 列表渲染必须加 key
- 大列表考虑虚拟化
- 避免不必要重渲染

样式：
- Tailwind CSS 或 CSS Modules
- 避免行内样式
```
