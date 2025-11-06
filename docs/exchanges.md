# 支持的交易所

Quanta 支持多个加密货币交易所，提供统一 API。

## 可用交易所

| 交易所      | 全名        | 缩写   | 状态    | 需要 API 密钥 |
| ----------- | ----------- | ------ | ------- | ------------- |
| Simulator   | Simulator   | -      | ✅ 内置 | 否            |
| Binance     | Binance     | `bin`  | ✅ 支持 | 是（交易时）  |
| OKX         | OKX         | -      | ✅ 支持 | 是（交易时）  |
| Coinbase    | Coinbase    | `cb`   | ✅ 支持 | 是（交易时）  |
| Hyperliquid | Hyperliquid | `hliq` | ✅ 支持 | 是（交易时）  |

## 交易所详情

### Simulator

- **类型**: 内置模拟
- **需要 API 密钥**: 否
- **用途**: 测试、开发、学习
- **特性**: 模拟市场数据、自动价格变动

### Binance

- **类型**: 中心化交易所（CEX）
- **需要 API 密钥**: 是（交易时）
- **用途**: 现货和期货交易
- **API 密钥**: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- **缩写**: `bin`

### OKX

- **类型**: 中心化交易所（CEX）
- **需要 API 密钥**: 是（交易时）
- **用途**: 现货、期货和期权交易
- **API 密钥**: `OKX_API_KEY`, `OKX_API_SECRET`
- **注意**: 衍生品使用 `BASE/USDT:USDT` 格式（例如 `ETH/USDT:USDT`）

### Coinbase

- **类型**: 中心化交易所（CEX）
- **需要 API 密钥**: 是（交易时）
- **用途**: 现货交易、机构
- **API 密钥**: `COINBASE_API_KEY`, `COINBASE_API_SECRET`
- **缩写**: `cb`

### Hyperliquid

- **类型**: 去中心化交易所（DEX）
- **需要 API 密钥**: 是（交易时）
- **用途**: 链上永续期货交易
- **API 密钥**: `HYPERLIQUID_API_KEY`, `HYPERLIQUID_API_SECRET`
- **缩写**: `hliq`
- **注意**: 使用 `/USDC:USDC` 符号格式（从 `/USDT` 自动转换）

## 使用示例

### 使用全名

```bash
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange coinbase --coin ETH
quanta test exchange --exchange hyperliquid --coin SOL
```

### 使用缩写

```bash
quanta test exchange --exchange bin --coin BTC
quanta test exchange --exchange cb --coin ETH
quanta test exchange --exchange hliq --coin SOL
```

### 测试所有交易所

```bash
quanta test exchange --all --coin BTC
quanta test exchange --all --verbose --coin BTC
```

## 环境变量

设置 API 凭据:

```bash
# Binance
export BINANCE_API_KEY=your_key
export BINANCE_API_SECRET=your_secret

# OKX
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret

# Coinbase
export COINBASE_API_KEY=your_key
export COINBASE_API_SECRET=your_secret

# Hyperliquid
export HYPERLIQUID_API_KEY=your_key
export HYPERLIQUID_API_SECRET=your_secret
```

或在 `config/config.json` 中配置:

```json
{
  "exchange": {
    "name": "okx",
    "apiKey": "your_api_key",
    "apiSecret": "your_api_secret",
    "testnet": true
  }
}
```

## 符号格式

Quanta 对所有交易所使用标准 `/USDT` 符号格式。特殊处理:

- **Hyperliquid**: 自动转换 `BTC/USDT` → `BTC/USDC:USDC`
- **OKX**: 永续合约使用 `BASE/USDT:USDT` 格式（例如 `ETH/USDT:USDT`）
- **其他交易所**: 使用提供的符号

示例:

```bash
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange hliq --coin BTC  # 自动转换符号
```

## 支持的功能

所有交易所支持:

- ✅ 市场数据获取（K 线、行情）
- ✅ 账户余额查询
- ✅ 持仓管理
- ✅ 下单（市价单）
- ✅ 取消订单

## 市场类型

### 现货交易

- **杠杆**: 仅 1x（无杠杆）
- **资金费率**: 无资金费率
- **用途**: 低风险、积累
- **推荐**: 适合初学者和保守策略

### 合约/永续交易

- **杠杆**: 3x 到 10x（可配置）
- **资金费率**: 定期资金费率
- **用途**: 高风险、做空能力
- **推荐**: 适合有经验交易者和适当风险管理

详见 [配置指南](configuration.md#市场类型风险参数)。

## 推荐

### 测试

- 使用 `simulator`（无需 API 密钥）
- 适合学习和开发
- 无外部依赖

### 生产

- 使用知名交易所（Binance, OKX, Coinbase）
- 真实交易前先用模拟器测试
- 可用时使用测试网

### DEX 交易

- 使用 `hyperliquid` 进行链上永续合约交易
- 了解链上交易成本
- 注意网络延迟

## 常见问题

### API 错误

```bash
# 检查 API 凭据
quanta config show

# 测试交易所连接
quanta test exchange --exchange <exchange> --coin BTC

# 详细测试
quanta test exchange --exchange <exchange> --coin BTC --verbose
```

### 符号错误

- 确保币种符号有效（BTC, ETH, SOL 等）
- Hyperliquid 需要永续格式，自动处理
- OKX 永续合约使用 `BASE/USDT:USDT` 格式
- 检查交易所特定的符号要求

### 连接问题

```bash
# 测试连接
quanta test exchange --exchange simulator --coin BTC

# 测试特定交易所
quanta test exchange --exchange okx --coin BTC --verbose

# 检查配置
quanta config show | grep -i exchange
```

更多帮助，请参考:

- [配置指南](configuration.md)
- [交易指南](trading-guide.md)
- [命令参考](commands.md)
