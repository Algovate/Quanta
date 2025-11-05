# Supported Exchanges

Quanta supports multiple cryptocurrency exchanges with a unified API.

## Available Exchanges

| Exchange    | Full Name   | Abbreviation | Status       | API Keys Required |
| ----------- | ----------- | ------------ | ------------ | ----------------- |
| Simulator   | Simulator   | -            | ✅ Built-in  | No                |
| Binance     | Binance     | `bin`        | ✅ Supported | Yes (for trading) |
| OKX         | OKX         | -            | ✅ Supported | Yes (for trading) |
| Coinbase    | Coinbase    | `cb`         | ✅ Supported | Yes (for trading) |
| Hyperliquid | Hyperliquid | `hliq`       | ✅ Supported | Yes (for trading) |

## Exchange Details

### Simulator

- **Type**: Built-in simulation
- **API Key Required**: No
- **Use Case**: Testing, development, learning
- **Features**: Mock market data, automatic price movements

### Binance

- **Type**: Centralized Exchange (CEX)
- **API Key Required**: Yes (for trading)
- **Use Case**: Spot and futures trading
- **API Keys**: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- **Abbreviation**: `bin`

### OKX

- **Type**: Centralized Exchange (CEX)
- **API Key Required**: Yes (for trading)
- **Use Case**: Spot, futures, and options trading
- **API Keys**: `OKX_API_KEY`, `OKX_API_SECRET`
- **Note**: For derivatives, uses `BASE/USDT:USDT` format (e.g., `ETH/USDT:USDT`)

### Coinbase

- **Type**: Centralized Exchange (CEX)
- **API Key Required**: Yes (for trading)
- **Use Case**: Spot trading, institutional
- **API Keys**: `COINBASE_API_KEY`, `COINBASE_API_SECRET`
- **Abbreviation**: `cb`

### Hyperliquid

- **Type**: Decentralized Exchange (DEX)
- **API Key Required**: Yes (for trading)
- **Use Case**: Perpetual futures trading on-chain
- **API Keys**: `HYPERLIQUID_API_KEY`, `HYPERLIQUID_API_SECRET`
- **Abbreviation**: `hliq`
- **Note**: Uses `/USDC:USDC` symbol format (auto-converted from `/USDT`)

## Usage Examples

### Using Full Names

```bash
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange coinbase --coin ETH
quanta test exchange --exchange hyperliquid --coin SOL
```

### Using Abbreviations

```bash
quanta test exchange --exchange bin --coin BTC
quanta test exchange --exchange cb --coin ETH
quanta test exchange --exchange hliq --coin SOL
```

### Test All Exchanges

```bash
# Quick connectivity test
quanta test exchange --all --coin BTC

# Detailed test with comprehensive analysis
quanta test exchange --all --verbose --coin BTC
```

## Environment Variables

Set up your API credentials:

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

- **Hyperliquid**: Automatically converts `BTC/USDT` → `BTC/USDC:USDC`
- **OKX**: Uses `BASE/USDT:USDT` format for perpetuals (e.g., `ETH/USDT:USDT`)
- **Other exchanges**: Use symbols as provided

Example:

```bash
# Works with all exchanges automatically
quanta test exchange --exchange binance --coin BTC
quanta test exchange --exchange hliq --coin BTC  # auto-converts symbol
```

## Features Supported

All exchanges support:

- ✅ Market data fetching (candlesticks, ticker)
- ✅ Account balance query
- ✅ Position management
- ✅ Order placement (market orders)
- ✅ Order cancellation

## Market Types

### Spot Trading

- **Leverage**: 1x only (no leverage)
- **Funding**: No funding fees
- **Use Case**: Lower risk, accumulation
- **Recommended**: For beginners and conservative strategies

### Swap/Perpetual Trading

- **Leverage**: 3x to 10x (configurable)
- **Funding**: Periodic funding fees apply
- **Use Case**: Higher risk, shorting capability
- **Recommended**: For experienced traders with proper risk management

See [Configuration Guide](configuration.md#market-types) for details on market type configuration.

## Recommendations

### For Testing

- Use `simulator` (no API keys needed)
- Perfect for learning and development
- No external dependencies

### For Production

- Use reputable exchanges (Binance, OKX, Coinbase)
- Test first with simulator before real trading
- Use testnet when available

### For DEX Trading

- Use `hyperliquid` for on-chain perpetuals
- Understand on-chain transaction costs
- Be aware of network latency

### For Risk Management

- Test first with simulator before real trading
- Start with paper trading mode
- Use small position sizes initially
- Monitor positions regularly

## Troubleshooting

### API Errors

```bash
# Check API credentials
quanta config show

# Test exchange connection
quanta test exchange --exchange <exchange> --coin BTC

# Test with verbose output
quanta test exchange --exchange <exchange> --coin BTC --verbose
```

### Symbol Errors

- Ensure coin symbol is valid (BTC, ETH, SOL, etc.)
- Hyperliquid requires perpetual format, auto-handled
- OKX uses `BASE/USDT:USDT` format for perpetuals
- Check exchange-specific symbol requirements

### Network Errors

- Check internet connection
- Verify API endpoint accessibility
- Review rate limits
- Check firewall settings if using VPN or proxy

### Connection Issues

```bash
# Test connectivity
quanta test exchange --exchange simulator --coin BTC

# Test specific exchange
quanta test exchange --exchange okx --coin BTC --verbose

# Check configuration
quanta config show | grep -i exchange
```

For more help, see:

- [Configuration Guide](configuration.md)
- [Trading Guide](trading-guide.md)
- [Command Reference](commands.md)
