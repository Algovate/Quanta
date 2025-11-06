# 核心概念

Quanta 关键术语、概念和算法指南。

## 架构

### 三阶段交易系统

```
感知 → 决策 → 执行
  ↓      ↓      ↓
市场数据 → AI 分析 → 风险管理 + 订单
```

### 核心组件

1. **交易所接口** - 多交易所统一 API（Simulator, OKX, Binance, Coinbase, Hyperliquid）
2. **市场数据提供者** - 获取 K 线数据和计算技术指标
3. **AI 代理** - 生成交易信号并评分置信度
4. **风险管理器** - 仓位大小和风险验证
5. **订单执行器** - 下单和管理执行
6. **持仓监控器** - 跟踪持仓和 P&L

## 交易概念

### 执行模式 vs 环境

**执行模式** (`mode`): 交易执行方式

- `strategy`: 单一交易工作流（默认）
- `arena`: 多无人机交易竞技场（策略对比）

**环境** (`env`): 交易环境和数据源

- `simulate`: 模拟数据，无风险学习
- `paper`: 真实市场数据，模拟执行
- `live`: 真实交易，使用实际资金

### 订单类型

**做多（买入）**: 预期价格上涨，买入，价格上涨时盈利

**做空（卖出）**: 预期价格下跌，卖出，价格下跌时盈利

### 持仓生命周期

```
开仓 → 监控 → 平仓
  ↓      ↓      ↓
信号   P&L 更新  止损/止盈
```

## 盈亏计算

### 核心公式

**做多持仓:**

```typescript
PnL = (当前价格 - 开仓价格) × 持仓大小
```

**做空持仓:**

```typescript
PnL = (开仓价格 - 当前价格) × 持仓大小
```

### 已实现 vs 未实现盈亏

- **未实现盈亏**: 持仓中的盈亏（价格变动时波动）
- **已实现盈亏**: 平仓时锁定的盈亏（实际现金）

### 杠杆和保证金

杠杆影响保证金要求，不影响 PnL 计算:

```typescript
保证金 = (持仓大小 × 价格) / 杠杆
```

### 账户权益

```typescript
权益 = 余额 + 未实现盈亏;
余额 = 初始资金 + 所有已实现盈亏;
可用保证金 = 权益 - 已用保证金;
保证金比率 = 已用保证金 / 权益;
```

## 技术指标

### 移动平均线

**EMA（指数移动平均）**: 更重视近期价格，公式: `EMA = (价格 × α) + (前一个 EMA × (1 - α))`，α = 2 / (n + 1)

**SMA（简单移动平均）**: 最近 n 个收盘价的算术平均值

### MACD

**组件:**

- MACD 线: EMA(12) - EMA(26)
- 信号线: MACD 线的 EMA(9)
- 柱状图: MACD 线 - 信号线

**信号:**

- 看涨: MACD 上穿信号线
- 看跌: MACD 下穿信号线

### RSI

**计算:**

- RSI = 100 - (100 / (1 + RS))
- RS = 平均涨幅 / 平均跌幅
- 范围: 0 到 100

**解释:**

- 超买: RSI > 70
- 超卖: RSI < 30
- 中性: 30 < RSI < 70

### ATR

**计算:**

- 真实波动幅度 = Max(当前最高 - 当前最低, |当前最高 - 前收盘|, |当前最低 - 前收盘|)
- ATR = n 期的真实波动幅度平均值

**用途:** 波动性测量、止损设置、仓位大小

### 布林带

**公式（n=20, k=2）:**

- 中轨 = SMA(n)
- 标准差 = 最近 n 个收盘价的标准差
- 上轨 = 中轨 + k·标准差
- 下轨 = 中轨 − k·标准差

**衍生指标:**

- %B = (收盘价 − 下轨) / (上轨 − 下轨)
- 带宽 = (上轨 − 下轨) / 中轨

## 风险管理

### 仓位大小

**核心原则**: 永远不要承担超过可承受损失的风险

**仓位大小公式:**

```
1. 基于风险的仓位: 仓位价值 = 风险金额 / 止损百分比
2. 基于资本的仓位: 最多可用资本的 30%（保留 40% 作为储备）
3. 最小仓位: Max($200, 账户权益的 1%)
4. 最终大小 = Max(基于风险, 最小)，但不超过基于资本
```

**示例:**

- 账户余额: $10,000
- 可用资本: $6,000（保留后）
- 每笔交易风险: 5% = $500
- 止损: 3%
- 基于风险的仓位价值: $500 / 0.03 = $16,667
- 基于资本的仓位价值: $6,000 × 30% = $1,800
- 最小仓位价值: Max($200, $100) = $200
- 最终仓位价值: $1,800（受资本限制）

### 止损

**类型:**

- **百分比**: 开仓价下方 3%（默认）
- **ATR 基础**: 开仓价下方 2×ATR
- **固定金额**: 最多 $500 损失

**设置:**

- 做多: 开仓价下方
- 做空: 开仓价上方

### 止盈

**默认**: 6%（止损的 2 倍）

**策略:**

- 固定: 6% 利润目标
- 跟踪: 随价格变动调整
- 多级: 分批获利

### 风险参数

- **每笔交易最大风险**: 5%（可配置）
- **总风险上限**: 30%
- **最大持仓数**: 5-6 个并发持仓
- **置信度阈值**: 0.55（55%）
- **资本配置**: 每个持仓最多可用交易资本的 30%
- **现金储备**: 保留 40% 可用保证金作为储备

### 杠杆

**杠杆范围**: 根据市场类型可配置

- **现货市场**: 杠杆固定为 1x（无杠杆）
- **合约/永续市场**: 范围 3x 到 10x（可配置，默认 5x-40x 但会被限制）

**工作原理:**

- 10x 杠杆: $1 可控制 $10
- 放大收益和损失
- 示例: 10% 价格变动 = 100% 盈亏（使用 10x 杠杆）

**市场类型限制:**

- **现货** (`marketType: "spot"`): 杠杆固定为 1x - 1x（无杠杆）
- **合约/永续** (`marketType: "swap"`): 杠杆限制为 3x - 10x

## AI 和信号

### 交易信号

**信号结构:**

```typescript
{
  action: "LONG" | "SHORT" | "HOLD",
  coin: "BTC",
  confidence: 0.75,  // 0-1
  reasoning: "强烈的看涨动能...",
  entry_price: 50000,
  position_size: 0.1,
  stop_loss: 48500,
  profit_target: 53000
}
```

### 信号生成流程

1. **市场分析** - 获取多时间框架数据，计算指标，分析价格行为
2. **AI 决策** - 处理市场数据，生成信号，分配置信度分数，提供推理
3. **风险验证** - 检查持仓限制，验证止损，计算仓位大小
4. **执行** - 下单，设置止损，设置止盈，监控持仓

### 置信度水平

- **高（0.7-1.0）**: 明确趋势，强指标，高概率
- **中（0.4-0.7）**: 混合信号，中等指标，平衡风险
- **低（0.0-0.4）**: 弱信号，冲突指标，通常被拒绝

### AI 提示词上下文

AI 从存储在 `config/prompts/` 的外部提示词组配置接收提示词。每个提示词组定义:

- **系统提示词**: 指令、约束、决策框架、输出格式要求
- **用户提示词**: 动态市场数据、账户信息、持仓详情

活动提示词组通过配置中的 `ai.prompt.activeGroup` 指定。

**系统提示词变量:**
`{{tradableCoins}}`, `{{maxPositions}}`, `{{maxRiskPerTrade}}`, `{{minLeverage}}`, `{{maxLeverage}}`, `{{defaultStopLoss}}`

**用户提示词变量:**
`{{elapsedMinutes}}`, `{{currentTime}}`, `{{invokeCount}}`, `{{candlesTA}}`, `{{accountInfo}}`, `{{positionsInfo}}`, `{{sentimentInfo}}`, `{{technicalState}}`

详见 [配置指南](configuration.md#提示词组)。

### Mock AI vs Real AI

- **Mock AI**: 预定义逻辑，快速执行，适合测试，无需 API 密钥
- **Real AI**: 实时市场分析，真实 AI 推理，更真实，需要 API 密钥

## 执行流程

### 完整交易周期

```
定时器（3 分钟）
    ↓
1. 市场数据获取
   - 获取 K 线
   - 计算指标
   - 分析趋势
    ↓
2. AI 信号生成
   - 分析市场数据
   - 生成信号
   - 置信度评分
    ↓
3. 风险验证
   - 检查持仓限制
   - 验证止损
   - 计算仓位大小
    ↓
4. 订单执行
   - 下单
   - 设置止损
   - 设置止盈
    ↓
5. 持仓监控
   - 跟踪 P&L
   - 更新标记
   - 检查退出条件
    ↓
6. 组合更新
   - 更新风险敞口
   - 计算杠杆
   - 更新指标
```

### 退出条件

- **止损触发**: 价格触及止损，持仓平仓，损失已实现
- **止盈触发**: 价格触及目标，持仓平仓，利润已实现
- **手动退出**: 用户干预，强制平仓，立即退出

## 算法

### 仓位大小算法

```typescript
function calculatePositionSize(
  signal: TradingSignal,
  account: Account,
  currentPrice: number
): PositionSizing {
  // 步骤 1: 计算风险金额
  const riskAmount = account.equity * maxRiskPerTrade;

  // 步骤 2: 计算基于风险的仓位价值
  const stopLoss = signal.stop_loss || 0.05;
  const riskBasedPositionValue = riskAmount / stopLoss;

  // 步骤 3: 计算基于资本的仓位价值
  // 保留 40% 作为额外持仓的储备
  const availableForTrade = account.availableMargin * 0.6;
  const maxCapitalBasedValue = availableForTrade * 0.3;

  // 步骤 4: 选择较小值以确保安全
  const finalPositionValue = Math.min(maxCapitalBasedValue, riskBasedPositionValue);

  // 步骤 5: 应用最小仓位大小
  const minPositionValue = Math.max(200, account.equity * 0.01);
  const adjustedPositionValue = Math.max(minPositionValue, finalPositionValue);

  // 步骤 6: 转换为持仓单位
  const pricePerUnit = signal.entry_price || currentPrice;
  const positionSize = adjustedPositionValue / pricePerUnit;

  return { coin: signal.coin, suggestedSize: positionSize, riskAmount, stopLossPrice: calculateStopLoss(...) };
}
```

### 风险验证算法

```typescript
function validateRisk(
  signal: TradingSignal,
  currentPositions: Position[],
  account: Account
): boolean {
  // 检查信号格式
  if (!signal.coin || !signal.action || !signal.confidence) return false;

  // 检查置信度阈值
  if (signal.confidence < 0.55) return false;

  // 检查最大持仓数
  if (currentPositions.length >= maxPositions) return false;

  // 检查现有持仓
  const positionSymbol = `${signal.coin}/USDT`;
  const existingPosition = currentPositions.find(p => p.symbol === positionSymbol);
  if (existingPosition && (signal.action === 'LONG' || signal.action === 'SHORT')) return false;

  // 检查总风险敞口
  const totalRisk = calculateTotalRisk(currentPositions, account);
  if (totalRisk >= maxTotalRisk) return false;

  // 检查止损有效性
  if (signal.stop_loss && (signal.stop_loss < 0.01 || signal.stop_loss > 0.1)) return false;

  return true;
}
```

### 止损计算算法

```typescript
function calculateStopLoss(
  action: 'LONG' | 'SHORT',
  entryPrice: number,
  stopLossPercentage: number,
  atr?: number
): number {
  if (atr) {
    // 基于 ATR 的止损（更动态）
    return action === 'LONG' ? entryPrice - atr * 2 : entryPrice + atr * 2;
  } else {
    // 基于百分比的止损（更简单）
    return action === 'LONG'
      ? entryPrice * (1 - stopLossPercentage)
      : entryPrice * (1 + stopLossPercentage);
  }
}
```

## 术语表

- **账户余额**: 交易所账户中的总资金
- **API 密钥**: 交易所访问的认证密钥
- **ATR**: 平均真实波动幅度 - 波动性指标
- **回测**: 在历史数据上测试策略
- **K 线**: 价格行为表示（开盘、最高、最低、收盘）
- **置信度**: 信号可靠性分数（0-1）
- **回撤**: 峰值到谷值的下降
- **环境** (`env`): 交易环境设置（`simulate`, `paper`, `live`）
- **交易所**: 交易平台（Binance, OKX, Coinbase, Hyperliquid, Simulator）
- **执行模式** (`mode`): 交易执行方式（`single`, `arena`）
- **杠杆**: 借贷能力（放大仓位大小）
- **做多持仓**: 看涨押注（当前价格买入，价格上涨时盈利）
- **保证金**: 杠杆的抵押品
- **P&L（盈亏）**: 交易结果（未实现: 持仓中，已实现: 已平仓）
- **持仓**: 活跃交易（做多或做空，开仓或平仓）
- **风险管理**: 损失预防（仓位大小、止损、分散）
- **RSI**: 相对强弱指标 - 动量指标
- **做空持仓**: 看跌押注（当前价格卖出，价格下跌时盈利）
- **信号**: 交易建议（AI 生成，动作 + 置信度）
- **止损**: 损失限制（自动退出，风险控制）
- **止盈**: 利润目标（自动退出，锁定利润）
- **技术指标**: 价格分析工具（MACD, RSI, EMA, ATR）
- **未实现 P&L**: 账面盈亏（持仓中，随价格波动）
