# 配置指南

Quanta 系统配置完整指南。

## 配置文件

### 主配置: `config/config.json`

```json
{
  "mode": "strategy",
  "env": "simulate",
  "exchange": {
    "name": "okx",
    "testnet": true,
    "marketType": "spot",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret"
  },
  "ai": {
    "apiKey": "sk-or-v1-your-api-key-here",
    "model": "deepseek/deepseek-chat-v3-0324",
    "temperature": 0.7,
    "prompt": {
      "activeGroup": "default",
      "candles": { "m3": 10, "h4": 5 },
      "sections": { "candlesTA": true, "sentiment": true, "technicalState": true }
    }
  },
  "trading": {
    "coins": ["BTC", "ETH", "SOL"],
    "cyclePeriod": 180000,
    "maxPositions": 6,
    "leverageRange": [5, 40],
    "stopLoss": 0.05,
    "maxRisk": 0.05,
    "priceSanity": { "enabled": true, "maxDeviation": 0.05 }
  }
}
```

**关键字段:**

- `mode`: `strategy`（单策略）或 `arena`（多无人机）
- `env`: `simulate`, `paper`, 或 `live`
- `exchange.marketType`: `spot` 或 `swap`（影响杠杆和风险参数）

## 配置优先级

1. **命令行参数**（最高）
2. **环境变量**
3. `config/config.json`
4. **默认值**（最低）

## 环境变量

### 模式/环境

```bash
QUANTA_MODE=strategy   # 或 arena
QUANTA_ENV=paper       # 或 live|simulate
```

### 交易所

```bash
EXCHANGE_NAME=okx
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_MARKET_TYPE=swap    # 或 spot; 'perp'/'perpetual' → swap
```

### AI

```bash
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  # 可选
AI_TEMPERATURE=0.7
```

### AI 提示词

```bash
PROMPT_ACTIVE_GROUP=default
PROMPT_CANDLES_3M=10
PROMPT_CANDLES_4H=5
PROMPT_SECTIONS_CANDLES_TA=true
PROMPT_SECTIONS_SENTIMENT=true
PROMPT_SECTIONS_TECH_STATE=true
```

### 交易

```bash
TRADING_COINS=BTC,ETH,SOL
CYCLE_PERIOD=180000
MAX_POSITIONS=6
STOP_LOSS=0.05
MAX_RISK=0.05
TRADING_PRICE_SANITY_ENABLED=true
TRADING_PRICE_SANITY_MAX_DEVIATION=0.05
```

### 日志

```bash
LOG_DIR=/absolute/path/to/logs/text  # 覆盖 JSONL 日志目录
```

## 提示词组

提示词组存储在 `config/prompts/`。每个组包含:

- `metadata`: 名称、描述、版本
- `system`: 系统提示词模板（Mustache 变量）
- `user`: 用户提示词模板（Mustache 变量）

**可用组:**

- `default`: 平衡风险 + 技术分析
- `nofx`: NoFX 风格的分阶段决策框架

**切换组:**

```json
{
  "ai": {
    "prompt": {
      "activeGroup": "nofx"
    }
  }
}
```

或通过环境变量:

```bash
PROMPT_ACTIVE_GROUP=nofx
```

**查看提示词:**

```bash
quanta prompts view                    # 查看当前活动组
quanta prompts view --rendered         # 查看渲染后的提示词
quanta prompts list                    # 列出所有组
```

## 关键设置

### AI 设置

- **apiKey**: OpenRouter API 密钥（必需，通过 `OPENROUTER_API_KEY` 或 `ai.apiKey` 设置）
- **model**: AI 模型（默认: `deepseek/deepseek-chat-v3-0324`）
- **temperature**: 创造性水平（默认: 0.7）
- **baseUrl**: OpenRouter API 基础 URL（可选，默认: `https://openrouter.ai/api/v1`）

**配置优先级:**

1. 环境变量（`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`）
2. `config.json` 值（`ai.apiKey`, `ai.model`, `ai.baseUrl`）
3. 默认值

**AI 错误处理**: 当 AI 客户端错误（4xx 状态码）时，工作流立即停止并显示清晰日志。

### 交易设置

- **coins**: 要交易的加密货币列表
- **maxPositions**: 最大并发持仓数
- **stopLoss**: 默认止损（交易 5%，模拟 3%）
- **maxRisk**: 每笔交易的最大风险（5%）
- **priceSanity**: 价格过期保护（偏差 > 5% 时转换为市价单）

### 交易所设置

- **name**: 交易所名称（`simulator`, `okx`, `binance`, `coinbase`, `hyperliquid`）
- **testnet**: 使用测试网环境（测试时为 true）
- **marketType**: `spot` 或 `swap`（别名: `perp`, `perpetual` 映射到 `swap`）

### 市场类型风险参数

系统根据 `marketType` 自动验证和调整风险参数:

**现货市场** (`marketType: "spot"`):

- 杠杆: 固定为 `1x - 1x`（无杠杆）
- 止损: 范围 `3% - 7%`
- 最大风险: 范围 `3% - 5%`
- 最大持仓: 范围 `6 - 10`

**合约/永续市场** (`marketType: "swap"`):

- 杠杆: 范围 `3x - 10x`
- 止损: 范围 `1% - 2%`
- 最大风险: 范围 `1% - 2%`
- 最大持仓: 范围 `1 - 4`

**启动验证:**

- 检查所有风险参数是否在允许范围内
- 自动调整超出范围的值并发出警告
- 显示有效风险参数摘要

### 合约选择（OKX）

- 在衍生品模式下，Quanta 使用 OKX USDT 保证金永续合约
- 符号内部标准化为 `BASE/USDT:USDT`
- 示例: `ETH` → `ETH/USDT:USDT`, `ETH-USDT-SWAP` → `ETH/USDT:USDT`

## CLI 配置

```bash
quanta config show      # 显示当前配置
quanta config set ai.model deepseek/deepseek-chat-v3-0324
quanta config validate  # 验证配置
quanta config save      # 保存配置
quanta config reset     # 重置为默认值
quanta config init      # 从示例初始化
```

## 配置示例

### 保守配置

```json
{
  "trading": {
    "coins": ["BTC"],
    "maxPositions": 2,
    "stopLoss": 0.02,
    "maxRisk": 0.02
  }
}
```

### 激进配置

```json
{
  "trading": {
    "coins": ["BTC", "ETH", "SOL", "BNB"],
    "maxPositions": 10,
    "stopLoss": 0.05,
    "maxRisk": 0.1
  }
}
```

## 常见问题

**配置未加载**: 检查文件是否存在 `cat config/config.json`，验证 JSON `quanta config validate`

**配置冲突**: 检查优先级顺序（命令行 > 环境变量 > config.json > 默认值）

**值未生效**: 环境变量会覆盖配置文件

**无效 JSON**: 使用 `quanta config validate` 检查语法

**缺少必需字段**: 使用 `quanta config init` 从示例创建
