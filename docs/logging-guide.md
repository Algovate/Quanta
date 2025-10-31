# Logging 使用指南

## 快速开始

### 基本用法

```typescript
import { Logger } from '../utils/logger.js';

// 获取 Logger 实例
const logger = Logger.getInstance('MyModule');

// 记录不同级别的日志
logger.info('应用程序启动');
logger.warn('磁盘空间不足');
logger.error('数据库连接失败', error);
logger.debug('调试信息', { userId: 123 });
```

## 日志级别

### 1. ERROR - 错误

用于记录程序错误和异常情况。

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('关键操作失败', error, {
    operationId: '123',
    userId: 456,
    details: '数据库连接超时',
  });
}
```

**文件输出**:

```json
{
  "timestamp": "2025-10-28T10:30:00.000Z",
  "level": "error",
  "context": "MyModule",
  "message": "关键操作失败",
  "error": "数据库连接超时",
  "stack": "Error: ...",
  "operationId": "123",
  "userId": 456
}
```

### 2. WARN - 警告

用于记录潜在问题和不推荐的操作。

```typescript
if (apiUsage > 90) {
  logger.warn('API 使用率过高', {
    usage: 92,
    limit: 100,
  });
}
```

### 3. INFO - 信息

用于记录重要业务流程和状态变更。

```typescript
logger.info('用户登录成功', {
  userId: 123,
  ip: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
});
```

### 4. DEBUG - 调试

用于记录详细的调试信息（开发环境）。

```typescript
logger.debug('缓存命中', {
  key: 'user:123',
  cacheSize: 42,
  hitRate: 0.85,
});
```

## 结构化管理

### 记录元数据

```typescript
// 交易信号生成
logger.info('AI Signal Generation', {
  signalCount: 3,
  signals: [
    { coin: 'BTC', action: 'LONG', confidence: 0.85 },
    { coin: 'ETH', action: 'HOLD', confidence: 0.65 },
  ],
});

// 周期总结
logger.info('Cycle Summary', {
  cycle: 42,
  runtime: '15m 30s',
  account: {
    equity: 10000,
    totalPnl: 250.5,
    leverage: 2.5,
  },
});
```

## 背景模式

### 自动检测

Logger 会自动检测是否在后台运行：

```typescript
// TTY 可用 = 交互模式 (前台)
// TTY 不可用 = 后台模式

const logger = Logger.getInstance('Workflow');
if (logger.isBackgroundMode()) {
  // 在后台运行 - 日志会简化格式
}
```

### 强制后台模式

```bash
# 环境变量
BACKGROUND_MODE=true quanta trade start

# 或
export BACKGROUND_MODE=true
quanta trade start
```

### 行为差异

**交互模式**:

```
🚀 Starting Quanta trading workflow...
💰 Account: $10000.00 | Positions: 2
```

**后台模式**:

```
[2025-10-28T10:30:00.000Z] [INFO] [Workflow] Starting Quanta trading workflow
[2025-10-28T10:30:00.000Z] [INFO] [Workflow] Account: $10000.00 | Positions: 2
```

## 配置方式

### 方式 1: 环境变量（推荐）

```bash
# 设置日志级别
LOG_LEVEL=debug

# 设置日志目录
LOG_DIR=/var/log/quanta

# 设置最大文件大小 (10MB)
LOG_MAX_SIZE=10485760

# 设置保留天数 (14天)
LOG_MAX_FILES=14

# 禁用文件输出
LOG_FILE_OUTPUT=false

# 强制后台模式
BACKGROUND_MODE=true
```

### 方式 2: 配置文件

编辑 `config/config.json`:

```json
{
  "logging": {
    "level": "info",
    "fileOutput": true,
    "logDir": "./logs",
    "maxFileSize": 10485760,
    "maxFiles": 14,
    "backgroundMode": false
  }
}
```

### 方式 3: 运行时更新

```typescript
const logger = Logger.getInstance();
logger.updateConfig({
  level: LogLevel.DEBUG,
  backgroundMode: true,
});
```

## 日志文件结构

### 目录结构

```
logs/
├── combined.log              # 所有日志
├── error.log                 # 仅错误日志
├── combined.2025-10-28.log  # 已旋转的日志
└── error.2025-10-28.log
```

### 文件内容示例

**combined.log**:

```json
{"timestamp":"2025-10-28T10:30:00.000Z","level":"info","context":"Workflow","message":"交易循环开始","cycle":42}
{"timestamp":"2025-10-28T10:30:01.000Z","level":"info","context":"Workflow","message":"AI Signal Generation","signalCount":2}
{"timestamp":"2025-10-28T10:30:02.000Z","level":"error","context":"OpenRouter","message":"API 请求失败","error":"超时"}
```

**error.log**:

```json
{
  "timestamp": "2025-10-28T10:30:02.000Z",
  "level": "error",
  "context": "OpenRouter",
  "message": "API 请求失败",
  "error": "超时",
  "stack": "..."
}
```

## 日志轮转

### 自动轮转

Logger 会在以下情况自动轮转：

1. **时间轮转**: 每天午夜自动轮转
2. **大小轮转**: 文件超过配置的最大大小（默认 10MB）
3. **清理**: 自动删除超过保留期的旧日志（默认 14 天）

### 轮转日志命名

```
combined.log                          # 当前日志
combined.2025-10-28.1698480000000.log  # 已轮转日志
combined.2025-10-27.1698393600000.log # 更旧的日志
```

### 手动触发

```typescript
const logger = Logger.getInstance();
logger.flushSync(); // 立即刷新缓冲区
```

## 最佳实践

## Backtest 渲染与降噪

### 渲染器概览

Backtest 使用终端渲染器提供进度、心跳与周期摘要：

- 进度条: `--no-progress` 可禁用
- 心跳: 长时间无输出时，每 ~1.5s 提示一次
- 周期摘要: 仅在采样间隔或显著变化时输出，减少噪声

### 降噪阈值（可配置）

通过 CLI 调整输出触发阈值：

- `--cycle-sample <n>`: 每 N 个周期输出一次（默认 10）
- `--equity-delta-pct <pct>`: 账户权益相对变化超过 pct 时输出（默认 0.001 = 0.1%）
- `--upnl-delta <usd>`: UPNL 绝对变化超过 usd 时输出（默认 $10）
- `--exposure-delta-pct <pct>`: 暴露（未加杠杆）相对变化超过 pct 时输出（默认 0.1）
- `--leverage-delta <val>`: 杠杆绝对变化超过 val 时输出（默认 0.2）
- `--dd-steps <steps>`: 回撤阈值，逗号分隔，例如 `5,10,15`

### 结构化提示

- RISK 行：当回撤跨越配置阈值时输出，例如：
  - `RISK | dd=6.2% crossed 5% | eq=$10,120 | lev=1.80`
- 周期行：包含 Eq、Positions、G/A/R、UPNL、EXP、LV 等关键字段

### 报告视图控制

- `--summary-only`: 仅输出概览一行
- `--no-risks` / `--no-signals` / `--no-equity`: 隐藏对应报告分区

### 1. 使用有意义的上下文

```typescript
// ❌ 不好
const logger = Logger.getInstance();

// ✅ 好
const logger = Logger.getInstance('OrderExecutor');
const logger = Logger.getInstance('RiskManager');
```

### 2. 添加结构化元数据

```typescript
// ❌ 不好
logger.info('Order placed');

// ✅ 好
logger.info('Order placed', {
  orderId: order.id,
  symbol: 'BTC/USDT',
  side: 'buy',
  amount: 0.1,
  price: 45000,
});
```

### 3. 正确使用错误日志

```typescript
// ❌ 不好
console.error(error);

// ✅ 好
logger.error('Database connection failed', error, {
  host: 'db.example.com',
  port: 5432,
  timeout: 5000,
});
```

### 4. 避免在循环中过度日志

```typescript
// ❌ 不好 - 每秒产生 60 条日志
setInterval(() => {
  logger.info('Heartbeat');
}, 1000);

// ✅ 好 - 每 5 秒一条日志
let lastLog = 0;
setInterval(() => {
  if (Date.now() - lastLog > 5000) {
    logger.debug('Heartbeat');
    lastLog = Date.now();
  }
}, 1000);
```

### 5. 日志级别策略

```
DEBUG: 详细的调试信息（开发环境）
  - 数据库查询详情
  - 内部状态变更
  - 详细的请求/响应数据

INFO: 业务流程和关键事件
  - 交易信号生成
  - 订单执行
  - 周期总结

WARN: 潜在问题
  - API 使用率过高
  - 缓存未命中
  - 性能警告

ERROR: 错误和异常
  - API 调用失败
  - 数据库错误
  - 严重业务逻辑错误
```

## 集成示例

### 工作流集成

```typescript
// src/core/workflow.ts
export class TradingWorkflow {
  private logger: Logger;
  private isBackgroundMode: boolean;

  constructor(...) {
    this.logger = Logger.getInstance('Workflow');
    this.isBackgroundMode = this.logger.isBackgroundMode();
  }

  async executeCycle() {
    this.logger.info('Cycle Summary', {
      cycle: this.state.cycleCount,
      equity: account.equity,
      positions: positions.length
    });
  }
}
```

### 错误处理集成

```typescript
// src/ai/agent.ts
try {
  const response = await this.callOpenRouterAPI(prompt);
  return this.parseResponse(response);
} catch (error) {
  this.logger.error('Error generating trading signal', error, {
    model: this.model,
    requestId: crypto.randomUUID(),
  });
  return [];
}
```

## 性能考虑

### 缓冲机制

Logger 使用缓冲机制提高性能：

- **大小触发**: 缓冲区达到 50 个条目时自动刷新
- **时间触发**: 每 100ms 自动刷新一次
- **手动触发**: 调用 `flushSync()` 立即刷新

```typescript
// 立即刷新（谨慎使用）
logger.flushSync();

// 正常使用（自动缓冲）
logger.info('Message');
logger.warn('Warning');
// 最多等待 100ms 或 50 个条目后刷新
```

### 优雅关闭

Logger 会自动处理进程关闭信号：

```typescript
// 自动注册 SIGTERM 和 SIGINT 处理器
// 进程关闭时会自动刷新缓冲区
```

**手动测试**:

```bash
# 启动应用
quanta trade start &

# 发送关闭信号
kill -SIGTERM <pid>

# 确保日志已刷新到文件
tail -f logs/combined.log
```

## 监控和分析

### 查看日志文件

```bash
# 查看所有日志
tail -f logs/combined.log

# 只查看错误
tail -f logs/error.log

# 搜索特定内容
grep "OrderExecutor" logs/combined.log

# 统计错误数量
grep -c '"level":"error"' logs/combined.log
```

### 使用 jq 分析 JSON 日志

```bash
# 提取所有错误
cat logs/combined.log | jq 'select(.level == "error")'

# 统计各模块的错误数
cat logs/combined.log | jq -r '.context' | sort | uniq -c

# 查看最近的交易信号
cat logs/combined.log | jq 'select(.message == "AI Signal Generation")'
```

## 常见问题

### Q: 如何禁用文件日志？

```bash
LOG_FILE_OUTPUT=false quanta trade start
```

### Q: 如何改变日志目录？

```bash
LOG_DIR=/var/log/quanta quanta trade start
```

### Q: 如何临时提高日志详细度？

```bash
LOG_LEVEL=debug quanta trade start
```

### Q: 如何在后台运行时减少日志量？

后台模式会自动简化输出，日志会保存到文件。

## 示例场景

### 场景 1: 本地开发

```bash
# 全功能日志
LOG_LEVEL=debug npm run dev
```

### 场景 2: 生产部署

```bash
# 最小日志，文件输出
LOG_LEVEL=info \
LOG_FILE_OUTPUT=true \
BACKGROUND_MODE=true \
npm start
```

### 场景 3: 调试生产问题

```bash
# 详细日志用于调试
LOG_LEVEL=debug \
LOG_MAX_FILES=30 \
quanta trade start
```
