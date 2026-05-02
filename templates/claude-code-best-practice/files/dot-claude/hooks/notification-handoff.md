---
name: notification-handoff-hook
description: 任务交接时发送通知
type: hook
trigger: PostToolUse
matcher: Write
---

# notification-handoff Hook

检测到任务交接文件时通知接收方。

## 触发条件

- Write 工具执行后
- 文件路径匹配 `*/handoffs/*.json`

## 交接文件格式

```json
{
  "from": "agent-name",
  "to": "target-agent",
  "task_id": "xxx",
  "task": "任务描述",
  "priority": "high|normal"
}
```

## 通知内容

当检测到交接文件时，输出：
```
📬 任务交接通知
- 来自：{from}
- 目标：{to}
- 任务ID：{task_id}
- 描述：{task}
```

## 注意事项

- 此 Hook 仅负责通知，不处理文件传输
- 接收方需主动读取交接文件获取详情
