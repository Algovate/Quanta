# Quanta 文档

AI 驱动的量化交易系统文档。

## 快速开始

1. [快速开始](getting-started.md) - 安装并运行第一个交易
2. [交易指南](trading-guide.md) - 交易操作和最佳实践
3. [配置指南](configuration.md) - 系统配置

## 文档

### 核心指南

- [快速开始](getting-started.md) - 安装和快速入门
- [交易指南](trading-guide.md) - 交易模式、工作流和风险管理
- [配置指南](configuration.md) - 配置文件和设置
- [竞技场指南](arena-guide.md) - 多无人机交易系统

### 参考

- [命令参考](commands.md) - 完整 CLI 命令参考
- [核心概念](concepts.md) - 架构、算法和术语
- [交易所](exchanges.md) - 支持的交易所和设置
- [交易周期价格使用](trading-cycle-price-usage.md) - 价格来源文档

## 核心概念

**交易模式**

- `simulate` - 模拟数据，无风险学习
- `paper` - 真实市场数据，模拟执行
- `live` - 使用实际资金的真实交易

**核心组件**

- 交易所接口 - 多交易所统一 API
- AI 代理 - 带置信度评分的信号生成
- 风险管理器 - 仓位大小和验证
- 订单执行器 - 下单和执行
- 持仓监控器 - 持仓跟踪和 P&L

## 快速链接

- [安装](getting-started.md#安装)
- [第一个交易](getting-started.md#运行第一个交易)
- [配置](configuration.md)
- [命令](commands.md)
