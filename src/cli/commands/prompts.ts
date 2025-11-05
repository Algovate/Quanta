import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadPromptGroup,
  renderTemplate,
  listPromptGroups,
  extractGroupVariables,
  renderGroup,
  type PromptGroup,
} from '../../ai/prompt-loader.js';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../config/settings.js';
import { handleAsync } from '../../utils/error-handler.js';
import { safeAction } from '../shared/command-utils.js';
import { UnifiedLogger } from '../../logging/index.js';

interface ViewPromptOptions {
  group: string;
  rendered: boolean;
  systemOnly: boolean;
  userOnly: boolean;
  list: boolean;
  context?: string;
  vars?: boolean;
}

interface DiffPromptOptions {
  group: string;
  with: string;
  rendered: boolean;
  systemOnly: boolean;
  userOnly: boolean;
  context?: string;
}

interface DisplayOptions {
  showSystem: boolean;
  showUser: boolean;
  rendered: boolean;
}

const SEPARATOR = '─'.repeat(80);

export class PromptCommands {
  static register(program: Command): void {
    program
      .command('view')
      .description('View prompt group content')
      .option('-g, --group <name>', 'Prompt group name (default: from config)', '')
      .option('-r, --rendered', 'Show rendered prompts with example values', false)
      .option('-s, --system-only', 'Show only system prompt', false)
      .option('-u, --user-only', 'Show only user prompt', false)
      .option('--list', 'List all available prompt groups', false)
      .option('--context <path.json>', 'Render using values from context JSON file')
      .option('--vars', 'Show template variables and presence status', false)
      .action(
        safeAction(async options => {
          await handleAsync(async () => {
            await PromptCommands.viewPrompt(options as ViewPromptOptions);
          }, 'PromptCommands.view');
        }, 'PromptCommands.view')
      );

    program
      .command('list')
      .description('List available prompt groups')
      .action(
        safeAction(async () => {
          await handleAsync(async () => {
            const logger = UnifiedLogger.getInstance();
            const originalConsole = logger.getOriginalConsole();
            PromptCommands.listPromptGroups(originalConsole);
            logger.shutdown();
          }, 'PromptCommands.list');
        }, 'PromptCommands.list')
      );

    const diffCmd = program
      .command('diff')
      .description('Diff prompt groups (raw or rendered)')
      .option('-g, --group <name>', 'Left group name', '')
      .requiredOption('--with <name>', 'Right group name')
      .option('-r, --rendered', 'Render before diffing', false)
      .option('-s, --system-only', 'Diff only system prompt', false)
      .option('-u, --user-only', 'Diff only user prompt', false)
      .option('--context <path.json>', 'Render using values from context JSON file')
      .action(
        safeAction(async (options: any) => {
          await handleAsync(async () => {
            await PromptCommands.diffGroups(options as DiffPromptOptions);
          }, 'PromptCommands.diff');
        }, 'PromptCommands.diff')
      );
    diffCmd.showHelpAfterError();
  }

  private static async viewPrompt(options: ViewPromptOptions): Promise<void> {
    // Use originalConsole to bypass logger interception and ensure output displays
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    if (options.list) {
      PromptCommands.listPromptGroups(originalConsole);
      return;
    }

    const groupName = PromptCommands.getGroupName(options.group);
    const promptGroup = loadPromptGroup(groupName);

    PromptCommands.displayMetadata(promptGroup, groupName, originalConsole);

    const displayOptions: DisplayOptions = {
      showSystem: !options.userOnly,
      showUser: !options.systemOnly,
      rendered: options.rendered,
    };

    if (options.rendered) {
      const exampleContext = PromptCommands.resolveContext(options.context, originalConsole);
      PromptCommands.displayRenderedPrompts(
        promptGroup,
        exampleContext,
        displayOptions,
        originalConsole
      );
      if (options.vars) {
        PromptCommands.displayVariablesWithPresence(
          promptGroup,
          exampleContext,
          displayOptions,
          originalConsole
        );
      }
    } else {
      PromptCommands.displayRawPrompts(promptGroup, displayOptions, originalConsole);
      if (options.vars) {
        PromptCommands.displayTemplateVariables(promptGroup, displayOptions, originalConsole);
      }
    }

    originalConsole.log('');
    // Ensure clean shutdown for CLI
    logger.shutdown();
  }

  private static listPromptGroups(originalConsole: { log: typeof console.log }): void {
    const groups = listPromptGroups();
    if (groups.length === 0) {
      originalConsole.log(chalk.yellow('No prompt groups found in config/prompts/'));
      return;
    }

    const config = getConfig();
    const activeGroup = config.ai.prompt.activeGroup;

    originalConsole.log(chalk.bold('\n📋 Available Prompt Groups:\n'));
    groups.forEach(group => {
      const isActive = group === activeGroup;
      const marker = isActive ? chalk.green('✓ (active)') : '';
      originalConsole.log(`  ${isActive ? chalk.green(group) : group} ${marker}`);
    });
    originalConsole.log('');
  }

  private static getGroupName(providedGroup: string): string {
    if (providedGroup) {
      return providedGroup;
    }
    const config = getConfig();
    return config.ai.prompt.activeGroup;
  }

  private static displayMetadata(
    promptGroup: PromptGroup,
    groupName: string,
    originalConsole: { log: typeof console.log }
  ): void {
    originalConsole.log(chalk.bold('\n📝 Prompt Group: ') + chalk.cyan(groupName));
    if (promptGroup.metadata.description) {
      originalConsole.log(chalk.gray(`   Description: ${promptGroup.metadata.description}`));
    }
    if (promptGroup.metadata.version) {
      originalConsole.log(chalk.gray(`   Version: ${promptGroup.metadata.version}`));
    }
    originalConsole.log('');
  }

  private static createExampleContext(): Record<string, string | number> {
    const config = getConfig();
    return {
      // System prompt variables
      tradableCoins: config.trading.coins.join(', '),
      maxPositions: config.trading.maxPositions,
      maxRiskPerTrade: (config.trading.maxRisk * 100).toFixed(0),
      minLeverage: config.trading.leverageRange[0],
      maxLeverage: config.trading.leverageRange[1],
      defaultStopLoss: (config.trading.stopLoss * 100).toFixed(1),
      // User prompt variables (example values)
      elapsedMinutes: 15,
      currentTime: new Date().toISOString(),
      invokeCount: 5,
      candlesTA: '[Example: CANDLES & TECHNICAL ANALYSIS section would appear here]',
      accountInfo: '[Example: ACCOUNT INFORMATION section would appear here]',
      positionsInfo: '[Example: POSITIONS section would appear here]',
      sentimentInfo: '[Example: SENTIMENT section would appear here]',
      technicalState: '[Example: TECHNICAL STATE section would appear here]',
    };
  }

  private static loadContextFromFile(filePath: string): Record<string, any> {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load context from ${resolved}: ${message}`);
    }
  }

  private static resolveContext(
    contextPath: string | undefined,
    originalConsole: { log: typeof console.log }
  ): Record<string, string | number> {
    if (contextPath) {
      originalConsole.log(chalk.gray('Using context file for rendering:\n'));
      const ctx = PromptCommands.loadContextFromFile(contextPath);
      Object.entries(ctx).forEach(([key, value]) => {
        originalConsole.log(chalk.gray(`  ${key}: ${value as any}`));
      });
      originalConsole.log(chalk.gray('\n' + SEPARATOR + '\n'));
      return ctx as Record<string, string | number>;
    }
    const example = PromptCommands.createExampleContext();
    PromptCommands.displayExampleContext(example, originalConsole);
    return example;
  }

  private static displayExampleContext(
    context: Record<string, string | number>,
    originalConsole: { log: typeof console.log }
  ): void {
    originalConsole.log(chalk.gray('Using example values for rendering:\n'));
    Object.entries(context).forEach(([key, value]) => {
      originalConsole.log(chalk.gray(`  ${key}: ${value}`));
    });
    originalConsole.log(chalk.gray('\n' + SEPARATOR + '\n'));
  }

  private static displayRenderedPrompts(
    promptGroup: PromptGroup,
    context: Record<string, string | number>,
    options: DisplayOptions,
    originalConsole: { log: typeof console.log }
  ): void {
    if (options.showSystem) {
      PromptCommands.displayPrompt(
        'SYSTEM PROMPT (RENDERED)',
        renderTemplate(promptGroup.system, context),
        originalConsole
      );
    }

    if (options.showUser) {
      PromptCommands.displayPrompt(
        'USER PROMPT (RENDERED)',
        renderTemplate(promptGroup.user, context),
        originalConsole
      );
    }
  }

  private static displayRawPrompts(
    promptGroup: PromptGroup,
    options: DisplayOptions,
    originalConsole: { log: typeof console.log }
  ): void {
    if (options.showSystem) {
      PromptCommands.displayPrompt('SYSTEM PROMPT (RAW)', promptGroup.system, originalConsole);
    }

    if (options.showUser) {
      PromptCommands.displayPrompt('USER PROMPT (RAW)', promptGroup.user, originalConsole);
    }
  }

  private static displayPrompt(
    title: string,
    content: string,
    originalConsole: { log: typeof console.log }
  ): void {
    originalConsole.log(chalk.bold.cyan(`\n=== ${title} ===\n`));
    originalConsole.log(content);
    originalConsole.log('');
  }

  private static displayTemplateVariables(
    promptGroup: PromptGroup,
    options: DisplayOptions,
    originalConsole: { log: typeof console.log }
  ): void {
    const { system: systemVars, user: userVars } = extractGroupVariables(promptGroup);

    if (systemVars.length === 0 && userVars.length === 0) {
      return;
    }

    originalConsole.log(chalk.gray('\n' + SEPARATOR));
    originalConsole.log(chalk.gray('\n📌 Template Variables:\n'));

    if (systemVars.length > 0 && options.showSystem) {
      PromptCommands.displayVariableList('System prompt variables', systemVars, originalConsole);
    }

    if (userVars.length > 0 && options.showUser) {
      PromptCommands.displayVariableList('User prompt variables', userVars, originalConsole);
    }
  }

  private static displayVariableList(
    title: string,
    variables: string[],
    originalConsole: { log: typeof console.log }
  ): void {
    originalConsole.log(chalk.yellow(`  ${title}:`));
    variables.forEach(v => originalConsole.log(chalk.gray(`    {{${v}}}`)));
    originalConsole.log('');
  }

  /**
   * Extract variable names from a template string
   */
  private static displayVariablesWithPresence(
    promptGroup: PromptGroup,
    context: Record<string, any>,
    options: DisplayOptions,
    originalConsole: { log: typeof console.log }
  ): void {
    const { system: systemVars, user: userVars } = extractGroupVariables(promptGroup);
    const showSection = (title: string, vars: string[]) => {
      if (vars.length === 0) return;
      originalConsole.log(chalk.yellow(`  ${title}:`));
      vars.forEach(v => {
        const present = Object.prototype.hasOwnProperty.call(context, v);
        originalConsole.log(`    {{${v}}} ${present ? chalk.green('✓') : chalk.red('✗')}`);
      });
      originalConsole.log('');
    };
    originalConsole.log(chalk.gray('Variable presence (context provided):\n'));
    if (options.showSystem) showSection('System prompt variables', systemVars);
    if (options.showUser) showSection('User prompt variables', userVars);
  }

  private static diffGroups(options: DiffPromptOptions): void {
    const logger = UnifiedLogger.getInstance();
    const originalConsole = logger.getOriginalConsole();

    const leftName = PromptCommands.getGroupName(options.group);
    const rightName = options.with;
    if (!rightName) {
      throw new Error('Missing required option: --with <name>');
    }

    // Friendly validation for group names
    const groups = listPromptGroups();
    const validateOrSuggest = (name: string): string | null => {
      if (groups.includes(name)) return null;
      // simple suggestion: closest by Levenshtein distance
      const suggest = PromptCommands.suggestClosestGroup(name, groups);
      const header = chalk.yellow(`Prompt group "${name}" not found.`);
      const hint = suggest
        ? `Did you mean ${chalk.cyan(suggest)}?`
        : `Use ${chalk.cyan('tsx src/index.ts prompts view --list')} to see available groups.`;
      originalConsole.log(`\n${header}\n${hint}\n`);
      logger.shutdown();
      return name;
    };

    if (validateOrSuggest(leftName) || validateOrSuggest(rightName)) {
      return; // Stop if any name invalid; message already shown
    }

    const left = loadPromptGroup(leftName);
    const right = loadPromptGroup(rightName);

    const showSystem = !options.userOnly;
    const showUser = !options.systemOnly;

    const context = options.rendered
      ? PromptCommands.resolveContext(options.context, originalConsole)
      : undefined;

    const leftTexts =
      options.rendered && context
        ? renderGroup(left, context)
        : { system: left.system, user: left.user };
    const rightTexts =
      options.rendered && context
        ? renderGroup(right, context)
        : { system: right.system, user: right.user };

    const sections: Array<{ title: string; a: string; b: string }> = [];
    if (showSystem) sections.push({ title: 'SYSTEM', a: leftTexts.system, b: rightTexts.system });
    if (showUser) sections.push({ title: 'USER', a: leftTexts.user, b: rightTexts.user });

    sections.forEach(section => {
      originalConsole.log(
        chalk.bold(`\n=== ${section.title} DIFF (${leftName} ↔ ${rightName}) ===\n`)
      );
      const diff = PromptCommands.createUnifiedDiff(section.a, section.b, leftName, rightName);
      if (diff.trim().length === 0) {
        originalConsole.log(chalk.gray('No differences.'));
      } else {
        originalConsole.log(diff);
      }
    });

    originalConsole.log('');
    logger.shutdown();
  }

  private static suggestClosestGroup(name: string, candidates: string[]): string | undefined {
    const distance = (a: string, b: string): number => {
      const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
        Array(b.length + 1).fill(0)
      );
      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      return dp[a.length][b.length];
    };

    let best: { name: string; d: number } | undefined;
    for (const c of candidates) {
      const d = distance(name, c);
      if (!best || d < best.d) best = { name: c, d };
    }
    return best && best.d <= 3 ? best.name : undefined;
  }

  private static createUnifiedDiff(a: string, b: string, aLabel: string, bLabel: string): string {
    const aLines = a.split(/\r?\n/);
    const bLines = b.split(/\r?\n/);
    // Simple Myers-style diff fallback using LCS DP (small inputs expected)
    const n = aLines.length;
    const m = bLines.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] =
          aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out: Array<{ tag: ' ' | '-' | '+'; text: string }> = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (aLines[i] === bLines[j]) {
        out.push({ tag: ' ', text: aLines[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ tag: '-', text: aLines[i] });
        i++;
      } else {
        out.push({ tag: '+', text: bLines[j] });
        j++;
      }
    }
    while (i < n) out.push({ tag: '-', text: aLines[i++] });
    while (j < m) out.push({ tag: '+', text: bLines[j++] });

    if (out.every(l => l.tag === ' ')) return '';

    const header = `--- ${aLabel}\n+++ ${bLabel}`;
    const body = out
      .map(l =>
        l.tag === ' ' ? l.text : l.tag === '-' ? chalk.red(`-${l.text}`) : chalk.green(`+${l.text}`)
      )
      .join('\n');
    return `${header}\n${body}`;
  }
}
