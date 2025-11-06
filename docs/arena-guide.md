# Quanta 竞技场 - 多无人机交易系统

同时运行多个交易工作流（"无人机"）以比较策略、提示词组和风险参数。

> **注意**: 当 API 服务器运行时，只能有一个执行会话处于活动状态（竞技场或策略）。竞技场仅支持纸面模式（真实市场数据，模拟执行）。

## 快速开始

### 1. 创建竞技场配置

在 `config/arena/` 中创建 JSON 文件:

```json
{
  "name": "我的竞技场",
  "mode": "paper",
  "drones": [
    {
      "id": "drone-1",
      "name": "保守",
      "coins": ["BTC", "ETH"],
      "promptPack": "conservative",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.02,
        "maxTotalRisk": 0.15,
        "defaultStopLoss": 0.05,
        "maxLeverage": 3,
        "minLeverage": 2,
        "maxPositions": 3
      }
    },
    {
      "id": "drone-2",
      "name": "激进",
      "coins": ["BTC", "ETH"],
      "promptPack": "aggressive",
      "initialBalance": 10000,
      "riskParams": {
        "maxRiskPerTrade": 0.05,
        "maxTotalRisk": 0.3,
        "defaultStopLoss": 0.03,
        "maxLeverage": 5,
        "minLeverage": 3,
        "maxPositions": 5
      }
    }
  ],
  "settings": {
    "maxConcurrentAICalls": 2
  }
}
```

### 2. 启动竞技场

```bash
# 列出可用配置
quanta arena configs

# 启动竞技场
quanta arena start --config my-arena

# 带持续时间限制启动（分钟）
quanta arena start --config my-arena --duration 30
```

### 3. 监控和比较

```bash
# 检查状态
quanta arena status <arenaId>

# 列出所有竞技场
quanta arena list

# 比较结果
quanta arena compare <arenaId>

# 停止竞技场
quanta arena stop <arenaId>
```

### 4. 查看日志

```bash
# 查看竞技场日志
quanta log view --context ArenaManager --follow

# 查看特定无人机日志
quanta log view --grep "arena-XXXX" --lines 100
```

**日志上下文**: `ArenaManager`, `ArenaStorage`, `ArenaOrchestrator:{arenaId}`, `Arena:{arenaId}:Drone:{droneId}`

## 配置

### 竞技场配置

```typescript
{
  name: string;
  mode: 'paper';  // 始终为 paper
  drones: DroneConfig[];
  settings?: {
    maxConcurrentAICalls?: number;  // 默认: 2
    cyclePeriod?: number;          // 周期持续时间（毫秒）
    maxDuration?: number;          // 最大运行时间（毫秒）
  }
}
```

### 无人机配置

```typescript
{
  id: string;
  name: string;
  coins: string[];
  promptPack: string;
  initialBalance: number;
  riskParams: {
    maxRiskPerTrade: number;
    maxTotalRisk: number;
    defaultStopLoss: number;
    maxLeverage: number;
    minLeverage: number;
    maxPositions: number;
  };
  aiConfig?: {
    model?: string;
    temperature?: number;
  };
}
```

## Web API

### 端点

- `POST /api/arena/start` - 启动竞技场
- `POST /api/arena/stop/:arenaId` - 停止竞技场
- `GET /api/arena/status/:arenaId` - 获取状态
- `GET /api/arena/list` - 列出所有竞技场
- `GET /api/arena/:arenaId/drones` - 获取无人机详情
- `GET /api/arena/:arenaId/comparison` - 获取比较
- `GET /api/arena/:arenaId/ai-analysis` - 获取 AI 分析

### WebSocket 事件

连接到 `ws://localhost:3001`:

- `arena:started` - 竞技场已启动
- `arena:stopped` - 竞技场已停止
- `arena:update` - 定期指标更新

详见 [命令参考](commands.md#竞技场命令) 获取完整 API 文档。

## 配置示例

查看 `config/arena/` 中的示例:

- `example-arena.json` - 基本比较
- `ppc.json` - 提示词组比较
- `risk-sweep.json` - 风险参数扫描
- `coin-strategy.json` - 币种选择比较

## 存储

竞技场结果存储在 `logs/arena.db`:

- `arena_runs` - 竞技场元数据
- `drone_results` - 最终指标
- `drone_snapshots` - 历史权益曲线

查询: `quanta arena compare <arenaId>`

## 最佳实践

1. **从小开始**: 先用 2-3 个无人机测试
2. **隔离变量**: 一次更改一个参数
3. **监控成本**: 跟踪 AI API 成本（特别是使用多个无人机时）
4. **设置持续时间限制**: 长时间运行时使用 `maxDuration`
5. **审查相关性**: 检查无人机是否在分散

## 常见问题

**竞技场无法启动**: 检查 JSON 有效性，验证提示词组是否存在，确保 API 密钥已配置

**无人机没有差异**: 验证不同的提示词组/风险参数，检查币种列表

**API 成本高**: 减少 `maxConcurrentAICalls`，使用更少的无人机，增加 `cyclePeriod`

**查看日志**: 使用 `quanta log view --context ArenaManager` - 详见 [命令参考](commands.md#日志命令)

## 高级

### 自定义提示词组

在 `config/prompts/` 中创建并在无人机配置中引用:

```json
{
  "promptPack": "my-custom-prompt"
}
```

### 事件订阅

```typescript
import { EventBus } from '@quanta/core/event-bus';

EventBus.on('arena:started', payload => console.log('已启动:', payload));
EventBus.on('drone:abc123:cycle:complete', payload => console.log('周期:', payload));
```

---

**相关**: [命令参考](commands.md#竞技场命令) | [配置指南](configuration.md)
