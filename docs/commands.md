# 命令参考

所有 Quanta 命令的完整参考。

## 交易命令

### `trade start` - 启动交易系统

```bash
quanta trade start [options]

选项:
  -e, --env <env>      环境: simulate, paper, live (默认: "simulate")
  -c, --coins <coins>  币种列表，逗号分隔 (默认: "BTC,ETH,SOL")
```

**示例:**

```bash
quanta trade start --env simulate --coins BTC,ETH,SOL
quanta trade start --env paper --coins BTC,ETH,SOL
quanta trade start --env live --coins BTC
```

> **注意**: 多无人机竞技场交易请使用 `arena` 命令。

### `trade backtest` - 运行回测

```bash
quanta trade backtest [options]

选项:
  -c, --coins <coins>           币种列表，逗号分隔
  -s, --start <date>            开始日期 (YYYY-MM-DD)
  -e, --end <date>              结束日期 (YYYY-MM-DD)
  --initial-balance <amount>    初始余额 (默认: "10000")
  --seed <number>               随机种子
  --verbose                     详细输出
  --quiet                       最小输出
  --json                        输出 JSON
  --summary-only                仅显示摘要
```

**示例:**

```bash
quanta trade backtest
quanta trade backtest --start 2024-06-01 --end 2024-10-01
quanta trade backtest --seed 42 --summary-only
```

> **默认**: 未指定日期时，默认使用最近 4 个月的数据。

## 测试命令

### `test ai` - 测试 AI 集成

```bash
quanta test ai [options]

选项:
  -t, --type <type>  AI 类型: mock, real, both (默认: "both")
  -c, --coin <coin>  测试币种 (默认: "BTC")
  -v, --verbose      详细输出
```

**示例:**

```bash
quanta test ai --type mock --coin BTC
quanta test ai --type real --coin BTC
```

### `test exchange` - 测试交易所数据

```bash
quanta test exchange [options]

选项:
  -e, --exchange <exchange>  交易所名称 (默认: "simulator")
  -a, --all                  测试所有支持的交易所
  -c, --coin <coin>           测试币种 (默认: "BTC")
  -v, --verbose               详细输出
```

**示例:**

```bash
quanta test exchange --exchange okx --coin BTC
quanta test exchange --all --coin BTC
quanta test exchange --exchange bin --coin BTC
```

**支持的交易所**: simulator, binance/bin, okx, coinbase/cb, hyperliquid/hliq

## 模拟命令

### `simulate cycle` - 模拟交易周期

```bash
quanta simulate cycle [options]

选项:
  -c, --coins <coins>           币种列表，逗号分隔
  -b, --initial-balance <amount> 初始余额（美元）
  -v, --verbose                 详细日志
  --cycles <number>             运行周期数
  -a, --ai <type>               AI 类型: mock 或 real
```

**示例:**

```bash
quanta simulate cycle --coins BTC --verbose
quanta simulate cycle --coins BTC,ETH --cycles 5 --verbose
```

> **注意**: `simulate cycle` 用于单次或少量周期。持续交易请使用 `quanta trade start --env simulate`。

## 服务器命令

### `server start` - 启动 API 服务器

```bash
quanta server start [options]

选项:
  -p, --port <port>  监听端口 (默认: "3001")
```

### `server stop` - 停止 API 服务器

```bash
quanta server stop
```

### `server status` - 检查服务器状态

```bash
quanta server status
```

## 配置命令

```bash
quanta config show          # 显示当前配置
quanta config set <key> <value>  # 设置配置值
quanta config validate      # 验证配置
quanta config save          # 保存配置到文件
quanta config reset         # 重置为默认值
quanta config init          # 从示例初始化
```

**示例:**

```bash
quanta config set ai.model deepseek/deepseek-chat-v3-0324
quanta config set ai.temperature 0.7
```

## 日志命令

### `log view` - 查看控制台输出

查看 `trade start` 和 `server start` 期间捕获的控制台日志。

```bash
quanta log view [options]

选项:
  --lines <n>          显示最后 N 行 (默认: 50)
  -f, --follow        跟随模式（实时更新）
  --context <context> 按上下文筛选
  --level <level>     按日志级别筛选 (info|warn|error|debug)
  --grep <pattern>     搜索/筛选模式
```

**示例:**

```bash
quanta log view
quanta log view --follow
quanta log view --follow --context Workflow
```

### 其他日志命令

```bash
quanta log clean [--all] [--days <n>] [--force] [--dry-run]  # 清理旧日志
quanta log list [--format <format>] [--sort <field>]          # 列出日志文件
quanta log stats [--days <n>] [--context <context>]           # 显示统计信息
quanta log export --output <file> [--format <format>]         # 导出日志
```

## 提示词命令

### `prompts list` - 列出提示词组

```bash
quanta prompts list
```

### `prompts view` - 查看提示词组内容

```bash
quanta prompts view [options]

选项:
  -g, --group <name>       提示词组名称
  -r, --rendered           显示渲染后的提示词（含示例值）
  -s, --system-only        仅显示系统提示词
  -u, --user-only          仅显示用户提示词
  --context <path.json>    使用 JSON 文件中的值渲染
  --vars                   显示模板变量
```

**示例:**

```bash
quanta prompts view
quanta prompts view --rendered
quanta prompts view --group default
```

### `prompts diff` - 比较提示词组

```bash
quanta prompts diff -g <left> --with <right> [options]

选项:
  -r, --rendered     渲染后比较
  -s, --system-only  仅比较系统提示词
  -u, --user-only    仅比较用户提示词
```

## 竞技场命令

详见 [竞技场指南](arena-guide.md)。

```bash
quanta arena configs          # 列出竞技场配置
quanta arena start --config <name>  # 启动竞技场
quanta arena status <arenaId> # 检查状态
quanta arena list             # 列出所有竞技场
quanta arena stop <arenaId>   # 停止竞技场
```

## 常用命令速查

```bash
# 快速测试
quanta test ai --type mock --coin BTC

# 运行模拟
quanta simulate cycle --coins BTC,ETH,SOL --verbose

# 开始交易
quanta trade start --env simulate --coins BTC,ETH,SOL

# 查看详细输出
quanta log view --follow
```
