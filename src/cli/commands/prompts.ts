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
            PromptCommands.listPromptGroups();
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
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';

    if (options.list) {
      PromptCommands.listPromptGroups();
      return;
    }

    const groupName = PromptCommands.getGroupName(options.group);
    const promptGroup = loadPromptGroup(groupName);

    PromptCommands.displayMetadata(promptGroup, groupName);

    const displayOptions: DisplayOptions = {
      showSystem: !options.userOnly,
      showUser: !options.systemOnly,
      rendered: options.rendered,
    };

    if (options.rendered) {
      const exampleContext = PromptCommands.resolveContext(options.context);
      PromptCommands.displayRenderedPrompts(promptGroup, exampleContext, displayOptions);
      if (options.vars) {
        PromptCommands.displayVariablesWithPresence(promptGroup, exampleContext, displayOptions);
      }
    } else {
      PromptCommands.displayRawPrompts(promptGroup, displayOptions);
      if (options.vars) {
        PromptCommands.displayTemplateVariables(promptGroup, displayOptions);
      }
    }

    logger.info('', {}, context);
    // Ensure clean shutdown for CLI
    logger.shutdown();
  }

  private static listPromptGroups(): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    const groups = listPromptGroups();
    if (groups.length === 0) {
      logger.info(chalk.yellow('No prompt groups found in config/prompts/'), {}, context);
      return;
    }

    const config = getConfig();
    const activeGroup = config.ai.prompt.activeGroup;

    logger.info(chalk.bold('\n📋 Available Prompt Groups:\n'), {}, context);
    groups.forEach(group => {
      const isActive = group === activeGroup;
      const marker = isActive ? chalk.green('✓ (active)') : '';
      logger.info(`  ${isActive ? chalk.green(group) : group} ${marker}`, {}, context);
    });
    logger.info('', {}, context);
  }

  private static getGroupName(providedGroup: string): string {
    if (providedGroup) {
      return providedGroup;
    }
    const config = getConfig();
    return config.ai.prompt.activeGroup;
  }

  private static displayMetadata(promptGroup: PromptGroup, groupName: string): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    logger.info(chalk.bold('\n📝 Prompt Group: ') + chalk.cyan(groupName), {}, context);
    if (promptGroup.metadata.description) {
      logger.info(chalk.gray(`   Description: ${promptGroup.metadata.description}`), {}, context);
    }
    if (promptGroup.metadata.version) {
      logger.info(chalk.gray(`   Version: ${promptGroup.metadata.version}`), {}, context);
    }
    logger.info('', {}, context);
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

  private static resolveContext(contextPath: string | undefined): Record<string, string | number> {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    if (contextPath) {
      logger.info(chalk.gray('Using context file for rendering:\n'), {}, context);
      const ctx = PromptCommands.loadContextFromFile(contextPath);
      Object.entries(ctx).forEach(([key, value]) => {
        logger.info(chalk.gray(`  ${key}: ${value as any}`), {}, context);
      });
      logger.info(chalk.gray('\n' + SEPARATOR + '\n'), {}, context);
      return ctx as Record<string, string | number>;
    }
    const example = PromptCommands.createExampleContext();
    PromptCommands.displayExampleContext(example);
    return example;
  }

  private static displayExampleContext(context: Record<string, string | number>): void {
    const logger = UnifiedLogger.getInstance();
    const contextName = 'PromptCommands';
    logger.info(chalk.gray('Using example values for rendering:\n'), {}, contextName);
    Object.entries(context).forEach(([key, value]) => {
      logger.info(chalk.gray(`  ${key}: ${value}`), {}, contextName);
    });
    logger.info(chalk.gray('\n' + SEPARATOR + '\n'), {}, contextName);
  }

  private static displayRenderedPrompts(
    promptGroup: PromptGroup,
    context: Record<string, string | number>,
    options: DisplayOptions
  ): void {
    if (options.showSystem) {
      PromptCommands.displayPrompt(
        'SYSTEM PROMPT (RENDERED)',
        renderTemplate(promptGroup.system, context)
      );
    }

    if (options.showUser) {
      PromptCommands.displayPrompt(
        'USER PROMPT (RENDERED)',
        renderTemplate(promptGroup.user, context)
      );
    }
  }

  private static displayRawPrompts(promptGroup: PromptGroup, options: DisplayOptions): void {
    if (options.showSystem) {
      PromptCommands.displayPrompt('SYSTEM PROMPT (RAW)', promptGroup.system);
    }

    if (options.showUser) {
      PromptCommands.displayPrompt('USER PROMPT (RAW)', promptGroup.user);
    }
  }

  private static displayPrompt(title: string, content: string): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    logger.info(chalk.bold.cyan(`\n=== ${title} ===\n`), {}, context);
    logger.info(content, {}, context);
    logger.info('', {}, context);
  }

  private static displayTemplateVariables(promptGroup: PromptGroup, options: DisplayOptions): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    const { system: systemVars, user: userVars } = extractGroupVariables(promptGroup);

    if (systemVars.length === 0 && userVars.length === 0) {
      return;
    }

    logger.info(chalk.gray('\n' + SEPARATOR), {}, context);
    logger.info(chalk.gray('\n📌 Template Variables:\n'), {}, context);

    if (systemVars.length > 0 && options.showSystem) {
      PromptCommands.displayVariableList('System prompt variables', systemVars);
    }

    if (userVars.length > 0 && options.showUser) {
      PromptCommands.displayVariableList('User prompt variables', userVars);
    }
  }

  private static displayVariableList(title: string, variables: string[]): void {
    const logger = UnifiedLogger.getInstance();
    const context = 'PromptCommands';
    logger.info(chalk.yellow(`  ${title}:`), {}, context);
    variables.forEach(v => logger.info(chalk.gray(`    {{${v}}}`), {}, context));
    logger.info('', {}, context);
  }

  /**
   * Extract variable names from a template string
   */
  private static displayVariablesWithPresence(
    promptGroup: PromptGroup,
    context: Record<string, any>,
    options: DisplayOptions
  ): void {
    const logger = UnifiedLogger.getInstance();
    const contextName = 'PromptCommands';
    const { system: systemVars, user: userVars } = extractGroupVariables(promptGroup);
    const showSection = (title: string, vars: string[]) => {
      if (vars.length === 0) return;
      logger.info(chalk.yellow(`  ${title}:`), {}, contextName);
      vars.forEach(v => {
        const present = Object.prototype.hasOwnProperty.call(context, v);
        logger.info(`    {{${v}}} ${present ? chalk.green('✓') : chalk.red('✗')}`, {}, contextName);
      });
      logger.info('', {}, contextName);
    };
    logger.info(chalk.gray('Variable presence (context provided):\n'), {}, contextName);
    if (options.showSystem) showSection('System prompt variables', systemVars);
    if (options.showUser) showSection('User prompt variables', userVars);
  }

  private static diffGroups(options: DiffPromptOptions): void {
    const logger = UnifiedLogger.getInstance();
    const loggerContext = 'PromptCommands';

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
      logger.info(`\n${header}\n${hint}\n`, {}, loggerContext);
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

    const templateContext = options.rendered
      ? PromptCommands.resolveContext(options.context)
      : undefined;

    const leftTexts =
      options.rendered && templateContext
        ? renderGroup(left, templateContext)
        : { system: left.system, user: left.user };
    const rightTexts =
      options.rendered && templateContext
        ? renderGroup(right, templateContext)
        : { system: right.system, user: right.user };

    const sections: Array<{ title: string; a: string; b: string }> = [];
    if (showSystem) sections.push({ title: 'SYSTEM', a: leftTexts.system, b: rightTexts.system });
    if (showUser) sections.push({ title: 'USER', a: leftTexts.user, b: rightTexts.user });

    sections.forEach(section => {
      logger.info(
        chalk.bold(`\n=== ${section.title} DIFF (${leftName} ↔ ${rightName}) ===\n`),
        {},
        loggerContext
      );
      const diff = PromptCommands.createUnifiedDiff(section.a, section.b, leftName, rightName);
      if (diff.trim().length === 0) {
        logger.info(chalk.gray('No differences.'), {}, loggerContext);
      } else {
        logger.info(diff, {}, loggerContext);
      }
    });

    logger.info('', {}, loggerContext);
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
