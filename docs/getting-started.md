# 快速开始

Quanta 快速入门指南。

## 安装

**要求**: Node.js 18+ 和 npm

```bash
git clone https://github.com/Algovate/Quanta.git
cd Quanta
npm install
npm run build

# 验证安装
quanta --help
```

## 运行第一个交易

### 1. 测试系统

```bash
# 使用模拟 AI 测试（无需 API 密钥）
quanta simulate cycle --coins BTC --verbose

# 测试 AI 集成
quanta test ai --type mock --coin BTC

# 测试交易所连接
quanta test exchange --exchange simulator --coin BTC
```

### 2. 配置 API 密钥（可选）

**纸面交易**：API 密钥可选  
**实盘交易**：需要 API 密钥

```bash
# OpenRouter API 密钥（用于真实 AI）
export OPENROUTER_API_KEY=your_key_here

# 交易所 API 密钥（用于实盘交易）
export OKX_API_KEY=your_key
export OKX_API_SECRET=your_secret
```

### 3. 开始交易

```bash
# 模拟模式（模拟数据，无风险）
quanta trade start --env simulate --coins BTC,ETH

# 纸面交易（真实数据，模拟执行）
quanta trade start --env paper --coins BTC,ETH

# 实盘交易（真实资金 - 请谨慎使用！）
quanta trade start --env live --coins BTC
```

系统每 3 分钟运行一个交易周期。按 `Ctrl+C` 停止。

### 4. 查看日志

```bash
# 查看最后 50 行
quanta log view

# 实时跟踪
quanta log view --follow

# 按上下文筛选
quanta log view --context Workflow --follow
```

## 交易模式

| 模式 | 市场数据 | 执行方式 | 风险 | 适用场景 |
|------|---------|---------|------|---------|
| **simulate** | 模拟 | 模拟 | 无 | 学习测试 |
| **paper** | 真实 | 模拟 | 无 | 策略验证 |
| **live** | 真实 | 真实 | 高 | 实盘交易 |

## 安全建议

✅ **始终先在模拟模式测试**  
✅ **使用纸面交易验证策略**  
✅ **充分测试后再使用实盘模式**  
❌ **不要使用无法承受损失的资金交易**

## 推荐流程

```
1. 模拟模式 → 了解系统
   ↓
2. 纸面交易 → 用真实数据验证
   ↓
3. 小规模实盘测试 → 最小风险
   ↓
4. 正式生产 → 验证后可扩大规模
```

## 下一步

- [交易指南](trading-guide.md) - 完整交易操作
- [配置指南](configuration.md) - 高级配置
- [核心概念](concepts.md) - 算法详解
- [命令参考](commands.md) - 完整命令列表

## 常见问题

### 安装问题

```bash
# 检查 Node.js 版本
node --version  # 应为 18+

# 重新构建
npm run build
```

### 配置问题

```bash
# 验证配置
quanta config validate

# 显示当前配置
quanta config show
```

### API 连接问题

```bash
# 测试交易所连接
quanta test exchange --exchange simulator --coin BTC

# 测试 AI 集成
quanta test ai --type mock --coin BTC
```
