# Supported Exchanges

Quanta supports multiple cryptocurrency exchanges with a unified API.

## Available Exchanges

| Exchange    | Full Name   | Abbreviation | Status       | Requires API Key  |
| ----------- | ----------- | ------------ | ------------ | ----------------- |
| Simulator   | Simulator   | -            | ✅ Built-in  | No                |
| Binance     | Binance     | `bin`        | ✅ Supported | Yes (for trading) |
| OKX         | OKX         | -            | ✅ Supported | Yes (for trading) |
| Coinbase    | Coinbase    | `cb`         | ✅ Supported | Yes (for trading) |
| Hyperliquid | Hyperliquid | `hliq`       | ✅ Supported | Yes (for trading) |

## Exchange Details

### Simulator

- **Type**: Built-in simulation
- **Requires API Key**: No
- **Use Case**: Testing, development, learning
- **Features**: Simulated market data, automatic price movements

### Binance

- **Type**: Centralized Exchange (CEX)
- **Requires API Key**: Yes (for trading)
- **Use Case**: Spot and futures trading
- **API Keys**: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- **Abbreviation**: `bin`

### OKX

- **Type**: Centralized Exchange (CEX)
- **Requires API Key**: Yes (for trading)
- **Use Case**: Spot, futures, and options trading
- **API Keys**: `OKX_API_KEY`, `OKX_API_SECRET`
- **Note**: Derivatives use `BASE/USDT:USDT` format (e.g., `ETH/USDT:USDT`)

### Coinbase

- **Type**: Centralized Exchange (CEX)
- **Requires API Key**: Yes (for trading)
- **Use Case**: Spot trading, institutional
- **API Keys**: `COINBASE_API_KEY`, `COINBASE_API_SECRET`
- **Abbreviation**: `cb`

### Hyperliquid

- **Type**: Decentralized Exchange (DEX)
- **Requires API Key**: Yes (for trading)
- **Use Case**: On-chain perpetual futures trading
- **API Keys**: `HYPERLIQUID_API_KEY`, `HYPERLIQUID_API_SECRET`
- **Abbreviation**: `hliq`
- **Note**: Uses `/USDC:USDC` symbol format (auto-converted from `/USDT`)

## Usage Examples

### Using Full Name

```bash
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange coinbase --coin ETH
quanta test exchange --exchange hyperliquid --coin SOL
```

### Using Abbreviation

```bash
quanta test exchange --exchange bin --coin BTC
quanta test exchange --exchange cb --coin ETH
quanta test exchange --exchange hliq --coin SOL
```

### Test All Exchanges

```bash
quanta test exchange --all --coin BTC
quanta test exchange --all --verbose --coin BTC
```

## Environment Variables

Set API credentials:

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

Or configure in `config/config.json`:

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

## Symbol Format

Quanta uses standard `/USDT` symbol format for all exchanges. Special handling:

- **Hyperliquid**: Auto-converts `BTC/USDT` → `BTC/USDC:USDC`
- **OKX**: Perpetual contracts use `BASE/USDT:USDT` format (e.g., `ETH/USDT:USDT`)
- **Other exchanges**: Use provided symbol

**Examples:**

```bash
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange hliq --coin BTC  # Auto-converts symbol
```

## Supported Features

All exchanges support:

- ✅ Market data fetching (candles, tickers)
- ✅ Account balance queries
- ✅ Position management
- ✅ Order placement (market orders)
- ✅ Order cancellation

## Market Types

### Spot Trading

- **Leverage**: 1x only (no leverage)
- **Funding Rate**: No funding rate
- **Use Case**: Low risk, accumulation
- **Recommendation**: Good for beginners and conservative strategies

### Contract/Perpetual Trading

- **Leverage**: 3x to 10x (configurable)
- **Funding Rate**: Periodic funding rate
- **Use Case**: Higher risk, shorting capability
- **Recommendation**: For experienced traders with proper risk management

See [Configuration Guide](configuration.md#market-type-risk-parameters) for details.

## Recommendations

### Testing

- Use `simulator` (no API keys needed)
- Good for learning and development
- No external dependencies

### Production

- Use established exchanges (Binance, OKX, Coinbase)
- Test with simulator before real trading
- Use testnet when available

### DEX Trading

- Use `hyperliquid` for on-chain perpetual futures trading
- Understand on-chain transaction costs
- Be aware of network latency

## Troubleshooting

### API Errors

```bash
# Check API credentials
quanta config show

# Test exchange connection
quanta test exchange --exchange <exchange> --coin BTC

# Detailed test
quanta test exchange --exchange <exchange> --coin BTC --verbose
```

### Symbol Errors

- Ensure coin symbols are valid (BTC, ETH, SOL, etc.)
- Hyperliquid requires perpetual format, auto-handled
- OKX perpetual contracts use `BASE/USDT:USDT` format
- Check exchange-specific symbol requirements

### Connection Issues

```bash
# Test connection
quanta test exchange --exchange simulator --coin BTC

# Test specific exchange
quanta test exchange --exchange okx --coin BTC --verbose

# Check configuration
quanta config show | grep -i exchange
```

For more help, see:

- [Configuration Guide](configuration.md)
- [Trading Guide](trading-guide.md)
- [Commands Reference](commands.md)
