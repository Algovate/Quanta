# Supported Exchanges

Quanta supports multiple cryptocurrency exchanges with unified API.

## Available Exchanges

| Exchange    | Full Name   | Abbreviation | Status       |
| ----------- | ----------- | ------------ | ------------ |
| Simulator   | Simulator   | -            | ✅ Built-in  |
| Binance     | Binance     | `bin`        | ✅ Supported |
| OKX         | OKX         | -            | ✅ Supported |
| Coinbase    | Coinbase    | `cb`         | ✅ Supported |
| Hyperliquid | Hyperliquid | `hliq`       | ✅ Supported |

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
quanta test exchange --all --coin BTC --timeframe 1h
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

## Symbol Format

Quanta uses standard `/USDT` symbol format for all exchanges. Special handling:

- **Hyperliquid**: Automatically converts `BTC/USDT` → `BTC/USDC:USDC`
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

## Recommendations

1. **For Testing**: Use `simulator` (no API keys needed)
2. **For Production**: Use reputable exchanges (Binance, OKX, Coinbase)
3. **For DEX Trading**: Use `hyperliquid` for on-chain perpetuals
4. **For Risk Management**: Test first with simulator before real trading

## Trading Features

### Position Sizing

- Maximum position size: 30% of available trading capital per trade
- Risk-based sizing: Based on stop-loss percentage and account equity
- Minimum position: 1% of equity or $200 (whichever is greater)
- Leverage: Configurable (default: 1x for spot, 5-40x for derivatives)

### Risk Management

- Stop Loss: Automatic calculation based on volatility (default: 3%)
- Take Profit: Set based on risk-reward ratio
- Position Limits: Configurable max positions per cycle

### Order Execution

- Market orders: Immediate execution
- Order validation: Balance and risk checks before execution
- Auto retry: On network errors (configurable)

## Troubleshooting

### API Errors

```bash
# Check API credentials
quanta config show

# Test exchange connection
quanta test exchange --exchange <exchange> --coin BTC
```

### Symbol Errors

- Ensure coin symbol is valid (BTC, ETH, SOL, etc.)
- Hyperliquid requires perpetual format, auto-handled
- Check exchange-specific symbol requirements

### Network Errors

- Check internet connection
- Verify API endpoint accessibility
- Review rate limits
- Check firewall settings if using VPN or proxy

---

**Last Updated**: January 2025  
**Version**: 0.1.0
