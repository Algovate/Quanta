# News Alpha Integration

News Alpha is a feature that integrates real-time cryptocurrency news data into Quanta's trading system to generate trading signals based on news sentiment, topics, and reliability.

## Overview

The News Alpha system:

- **Ingests** news from multiple sources (CryptoPanic, RSS feeds)
- **Enriches** news with sentiment analysis, topic classification, and entity linking
- **Scores** news events using configurable weights and topic boosts
- **Generates** trading signals based on aggregated news scores
- **Applies** time decay to prevent stale signals

## Architecture

### Components

1. **News Ingestion** (`src/data/news/`)
   - `NewsIngestor`: Orchestrates polling and deduplication
   - `CryptoPanicAdapter`: Fetches from CryptoPanic API
   - `RSSAdapter`: Fetches from RSS feeds (CoinDesk, CoinTelegraph)
   - `NewsStore`: In-memory store with TTL

2. **News Analytics** (`src/analytics/news/`)
   - `entity-linker.ts`: Links news text to tradable symbols
   - `features.ts`: Extracts novelty, reliability, volume shock
   - `scorer.ts`: Combines features into event scores with topic boosts

3. **News Strategy** (`src/strategies/news-alpha.ts`)
   - `NewsAlphaStrategy`: Generates trading signals from aggregated news
   - Applies kill-switches for high-risk topics (hack, outage)
   - Configurable weights, topic boosts, and decay rates

4. **LLM Enrichment** (`src/ai/news-llm.ts`)
   - Optional LLM-based sentiment and topic analysis
   - Budget and rate limiting controls
   - Caching to reduce API costs

5. **Workflow Integration** (`src/core/workflow-stages/fetch-news-data.ts`)
   - Fetches relevant news for each trading cycle
   - Applies time windowing and delivery lag

## Configuration

### Data Sources

Configure news sources in `config/config.json`:

```json
{
  "data": {
    "news": {
      "enabled": true,
      "sources": ["cryptopanic", "rss:coindesk", "rss:cointelegraph"],
      "pollIntervalMs": 45000,
      "cycleWindowMinutes": 3,
      "deliveryLagSeconds": 10
    }
  }
}
```

**Sources:**
- `cryptopanic`: CryptoPanic API (requires `CRYPTOPANIC_API_KEY` env var)
- `rss:coindesk`: CoinDesk RSS feed
- `rss:cointelegraph`: CoinTelegraph RSS feed

**Settings:**
- `pollIntervalMs`: How often to poll sources (default: 45000ms = 45s)
- `cycleWindowMinutes`: Time window for news aggregation per cycle (default: 3)
- `deliveryLagSeconds`: Safety lag for backtesting (default: 10s)

### Alpha Configuration

Configure news alpha signal generation:

```json
{
  "alpha": {
    "news": {
      "weights": {
        "sentiment": 0.5,
        "novelty": 0.2,
        "reliability": 0.2,
        "volumeShock": 0.1
      },
      "topicBoosts": {
        "hack": -0.5,
        "regulatory": -0.2,
        "etf": 0.6,
        "listing": 0.4
      },
      "halflifeMinutesByTopic": {
        "default": 30,
        "hack": 60,
        "etf": 120
      }
    }
  }
}
```

**Weights:** Control how much each feature contributes to the final score (must sum to 1.0)

**Topic Boosts:** Add/subtract from base score based on news topics

**Halflife:** Time decay rates per topic (in minutes)

### LLM Enrichment (Optional)

Enable LLM-based news enrichment:

```json
{
  "alpha": {
    "news": {
      "llm": {
        "enabledLLM": true,
        "triggers": {
          "minReliability": 0.6,
          "topics": ["hack", "etf", "regulatory"]
        },
        "budget": {
          "dailyUSD": 1.0,
          "rpm": 10
        },
        "provider": {
          "use": "openrouter",
          "model": "deepseek/deepseek-chat-v3-0324"
        }
      }
    }
  }
}
```

**Triggers:** Only enrich news that meets reliability threshold or has specific topics

**Budget:** Daily USD limit and requests per minute (RPM) limit

**Provider:** LLM provider and model to use

## CLI Commands

### View Recent News

```bash
quanta news [options]
```

**Options:**
- `-m, --minutes <n>`: Look back N minutes (default: 10)
- `-s, --symbols <symbols>`: Filter by symbols (comma-separated, e.g., "BTC,ETH")
- `-w, --watch`: Watch mode (continuous polling)
- `-p, --poll <ms>`: Poll interval in ms (default: 30000)
- `--llm`: Force LLM enrichment for CLI fetches
- `--llm-debug`: Show LLM usage status (used/skipped/cached)
- `--heartbeat`: Print heartbeat each poll when watching
- `--heartbeat-every <n>`: Print heartbeat every N polls (default: 1)

**Examples:**
```bash
# View last 10 minutes of news
quanta news

# View news for BTC in last 30 minutes
quanta news --minutes 30 --symbols BTC

# Watch news with heartbeat
quanta news --watch --heartbeat

# Watch with LLM enrichment and debug
quanta news --watch --llm --llm-debug
```

## How It Works

### 1. News Ingestion

- `NewsIngestor` polls configured sources every `pollIntervalMs`
- Each adapter normalizes news into `UnifiedNewsEvent` format
- Events are deduplicated and stored in `NewsStore` with TTL

### 2. Entity Linking

- News titles/bodies are analyzed to extract cryptocurrency symbols
- Entities are linked to tradable symbols (e.g., "Bitcoin" → "BTC/USDT")
- Confidence scores indicate link strength

### 3. Feature Extraction

For each news event:
- **Sentiment**: [-1, 1] from NLP or LLM analysis
- **Novelty**: [0, 1] based on similarity to recent events
- **Reliability**: [0, 1] based on source reputation
- **Volume Shock**: [0, 1] based on engagement metrics

### 4. Event Scoring

Events are scored using:
```
score = (sentiment * w_sentiment) + 
        (novelty * w_novelty) + 
        (reliability * w_reliability) + 
        (volumeShock * w_volumeShock) + 
        topic_boosts
```

### 5. Time Decay

Scores decay exponentially based on:
- Time since event
- Topic-specific halflife (e.g., ETF news decays slower than hack news)

### 6. Signal Generation

`NewsAlphaStrategy` generates signals:
- **Buy**: Positive decayed score above threshold
- **Sell**: Negative decayed score above threshold
- **Kill-switch**: For hack/outage topics, only protective sells allowed

## Kill-Switches

High-risk topics trigger protective behavior:

- **Hack**: Only sell signals, capped confidence (0.5 max)
- **Outage**: Only sell signals, capped confidence (0.5 max)

Configure in strategy params:
```json
{
  "killSwitch": {
    "hack": true,
    "outage": true
  }
}
```

## LLM Enrichment

### When LLM is Used

LLM enrichment is triggered when:
1. `enabledLLM` is true (or `force` flag is set)
2. Event meets reliability threshold OR has trigger topics
3. Budget limits are not exceeded

### LLM Output

LLM enriches events with:
- **Sentiment**: More accurate sentiment analysis
- **Topics**: Better topic classification
- **Reliability**: Confidence assessment

### Caching

LLM responses are cached by:
- Provider + model
- Source + event ID

Cache reduces API costs for duplicate or similar news.

### Debug Output

Use `--llm-debug` to see:
- `[LLM:used]`: LLM was called
- `[LLM:cache_hit]`: Used cached result
- `[LLM:skip:not_triggered]`: Didn't meet trigger criteria
- `[LLM:skip:budget_exceeded]`: Daily budget limit reached
- `[LLM:skip:rate_limited]`: RPM limit reached
- `[LLM:skip:error]`: LLM call failed

## Integration with Trading Cycle

News Alpha integrates into the 3-minute trading cycle:

1. **Background**: `NewsIngestor` continuously polls sources
2. **Cycle Start**: `FetchNewsDataStage` retrieves relevant news
3. **Signal Generation**: `NewsAlphaStrategy` generates signals from news
4. **Execution**: Signals are processed like any other strategy signals

## Best Practices

### Source Selection

- **CryptoPanic**: Good for real-time alerts, requires API key
- **RSS Feeds**: Free, but may have delays
- **Mix**: Use multiple sources for better coverage

### Weight Tuning

- Start with default weights
- Monitor signal quality
- Adjust based on backtest results
- Ensure weights sum to 1.0

### Topic Boosts

- Positive boosts for bullish topics (ETF, listing)
- Negative boosts for bearish topics (hack, regulatory)
- Adjust based on historical impact

### LLM Budget

- Start with low daily budget ($1-5)
- Monitor costs and adjust
- Use triggers to limit unnecessary calls
- Enable caching to reduce costs

### Backtesting

- Use `deliveryLagSeconds` to prevent look-ahead bias
- Test with historical news events
- Validate kill-switch behavior

## Limitations

1. **News Delay**: RSS feeds may have 5-15 minute delays
2. **Entity Linking**: Heuristic-based, may miss some symbols
3. **Sentiment Accuracy**: Rule-based NLP has limitations
4. **LLM Costs**: Enrichment adds API costs
5. **Noise**: Not all news is actionable

## Troubleshooting

### No News Found

- Check `data.news.sources` in config
- Verify API keys (for CryptoPanic)
- Check network connectivity
- Use `quanta news --watch` to monitor ingestion

### LLM Not Triggering

- Check `alpha.news.llm.enabledLLM` is true
- Verify trigger criteria (reliability/topics)
- Check budget limits
- Use `--llm-debug` to see skip reasons

### Signals Not Generated

- Check news is being ingested (`quanta news`)
- Verify strategy is enabled
- Check score thresholds
- Review topic boosts configuration

## Related Documentation

- [Configuration Guide](configuration.md) - Full configuration reference
- [Strategies Guide](strategies.md) - Strategy architecture
- [Commands Reference](commands.md) - CLI commands
- [Trading Guide](trading-guide.md) - Trading workflows

