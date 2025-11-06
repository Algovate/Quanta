import { Command } from 'commander';
import { UnifiedLogger } from '../../logging/index.js';
import { NewsIngestor } from '../../data/index.js';
import { ensureEntities } from '../../analytics/news/entity-linker.js';
import { annotateTopicsAndSentiment } from '../../ai/news-nlp.js';

export function registerNewsCommand(program: Command): void {
  program
    .command('news')
    .description('Fetch and display recent crypto news from configured sources')
    .option('-m, --minutes <n>', 'Lookback window in minutes', (v: string) => parseInt(v, 10), 10)
    .option('-s, --symbols <list>', 'Comma-separated symbols (e.g., BTC,ETH)', 'BTC,ETH,SOL')
    .option('-w, --watch', 'Continue monitoring for new items', false)
    .option('--llm', 'Use LLM enrichment (respects config triggers/budget)', false)
    .option('--llm-debug', 'Print whether LLM was used or skipped with reason', false)
    .option('--heartbeat', 'Print a heartbeat each poll when watching', false)
    .option(
      '--heartbeat-every <n>',
      'Print heartbeat every N polls (default 1)',
      (v: string) => parseInt(v, 10),
      1
    )
    .option(
      '-p, --poll <ms>',
      'Polling interval (ms) when watch is enabled',
      (v: string) => parseInt(v, 10),
      30000
    )
    .action(
      async (opts: {
        minutes: number;
        symbols: string;
        watch?: boolean;
        poll?: number;
        llm?: boolean;
        llmDebug?: boolean;
        heartbeat?: boolean;
        heartbeatEvery?: number;
      }) => {
        const logger = UnifiedLogger.getInstance();
        const cfg = (await import('../../config/index.js')).getConfig();
        const newsCfg = (cfg as any)?.data?.news;
        if (!newsCfg?.sources || newsCfg.sources.length === 0) {
          console.log('No news sources configured. Please set data.news.sources in config.json');
          return;
        }

        const ingestor = new NewsIngestor({
          enabled: true,
          pollIntervalMs: 30_000,
          sources: newsCfg.sources,
          llm: opts.llm
            ? {
                enabledLLM: true,
                force: true,
                triggers: (cfg as any)?.alpha?.news?.triggers,
                budget: (cfg as any)?.alpha?.news?.budget,
                provider: (cfg as any)?.alpha?.news?.provider,
              }
            : undefined,
        });

        for (const src of newsCfg.sources) {
          if (src === 'cryptopanic') {
            const { CryptoPanicAdapter } = await import('../../data/news/cryptopanic-adapter.js');
            ingestor.registerAdapter(new CryptoPanicAdapter(process.env.CRYPTOPANIC_API_KEY));
          } else if (typeof src === 'string' && src.startsWith('rss:')) {
            const feed = src.split(':')[1];
            const url =
              feed === 'coindesk'
                ? 'https://www.coindesk.com/arc/outboundfeeds/rss/'
                : feed === 'cointelegraph'
                  ? 'https://cointelegraph.com/rss'
                  : undefined;
            if (url) {
              const { RSSAdapter } = await import('../../data/news/rss-adapter.js');
              ingestor.registerAdapter(new RSSAdapter(url, feed));
            }
          }
        }

        // Prepare adapters
        let since = Date.now() - Math.max(1, opts.minutes) * 60 * 1000;
        const adapters = (ingestor as any).adapters as Array<{
          fetchSince: (ts: number) => Promise<any[]>;
          name: string;
        }>;
        if (!adapters || adapters.length === 0) {
          console.log('No adapters registered.');
          return;
        }

        const wanted = new Set(
          (opts.symbols || 'BTC,ETH,SOL')
            .split(',')
            .map(s => s.trim().toUpperCase())
            .filter(Boolean)
            .map(s => `${s}/USDT`)
        );

        const printBatch = (batch: any[]) => {
          const filtered = batch.filter(ev =>
            wanted.size === 0 ? true : (ev.entities || []).some((en: any) => wanted.has(en.symbol))
          );
          filtered
            .sort((a, b) => a.ts - b.ts)
            .slice(-200)
            .forEach(ev => {
              const ts = new Date(ev.ts).toISOString();
              const syms = (ev.entities || []).map((e: any) => e.symbol).join(',');
              const topics = (ev.topics || []).join(',');
              const llm = (ev.meta && (ev.meta as any).llm) as
                | { used?: boolean; reason?: string }
                | undefined;
              const llmMark = opts.llmDebug
                ? ` [LLM:${llm?.used ? 'used' : 'skip'}${llm?.reason ? ':' + llm.reason : ''}]`
                : '';
              console.log(
                `[${ts}] [${ev.source}] [${syms}] [${topics}]${llmMark} ${ev.title || ''}`
              );
            });
          return filtered.length;
        };

        const fetchOnce = async (): Promise<number> => {
          const all: any[] = [];
          await Promise.all(
            adapters.map(async a => {
              try {
                const evs = await a.fetchSince(since);
                if (evs && evs.length)
                  all.push(...evs.map(ev => annotateTopicsAndSentiment(ensureEntities(ev))));
              } catch (e) {
                logger.warn(
                  'news adapter failed',
                  e instanceof Error ? { error: e.message } : {},
                  'NewsCLI'
                );
              }
            })
          );
          if (all.length) since = Math.max(since, Math.max(...all.map(e => e.ts)) + 1);
          return printBatch(all);
        };

        const printed = await fetchOnce();
        if (!opts.watch) {
          if (printed === 0) console.log('No recent news found for selected symbols.');
          return;
        }

        console.log(`Watching news every ${opts.poll}ms... (Ctrl+C to stop)`);
        let pollCount = 0;
        const timer = setInterval(
          async () => {
            try {
              const count = await fetchOnce();
              pollCount++;
              if (opts.heartbeat && pollCount % Math.max(1, opts.heartbeatEvery || 1) === 0) {
                const now = new Date().toISOString();
                console.log(`⏳ [${now}] heartbeat (${count} new)`);
              }
            } catch (e) {
              logger.warn(
                'watch fetch failed',
                e instanceof Error ? { error: e.message } : {},
                'NewsCLI'
              );
            }
          },
          Math.max(5_000, Number(opts.poll) || 30_000)
        );

        const onExit = () => {
          clearInterval(timer);
          process.exit(0);
        };
        process.on('SIGINT', onExit);
        process.on('SIGTERM', onExit);
      }
    );
}
