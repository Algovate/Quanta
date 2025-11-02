import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadPromptGroup,
  renderTemplate,
  listPromptGroups,
  type PromptGroup,
} from '../../ai/prompt-loader.js';
import { getConfig } from '../../config/settings.js';
import { handleAsync } from '../../utils/error-handler.js';

interface ViewPromptOptions {
  group: string;
  rendered: boolean;
  systemOnly: boolean;
  userOnly: boolean;
  list: boolean;
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
      .action(async options => {
        await handleAsync(async () => {
          await PromptCommands.viewPrompt(options as ViewPromptOptions);
        }, 'PromptCommands.view');
      });
  }

  private static async viewPrompt(options: ViewPromptOptions): Promise<void> {
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
      const exampleContext = PromptCommands.createExampleContext();
      PromptCommands.displayExampleContext(exampleContext);
      PromptCommands.displayRenderedPrompts(promptGroup, exampleContext, displayOptions);
    } else {
      PromptCommands.displayRawPrompts(promptGroup, displayOptions);
      PromptCommands.displayTemplateVariables(promptGroup, displayOptions);
    }

    console.log('');
  }

  private static listPromptGroups(): void {
    const groups = listPromptGroups();
    if (groups.length === 0) {
      console.log(chalk.yellow('No prompt groups found in config/prompts/'));
      return;
    }

    const config = getConfig();
    const activeGroup = config.ai.prompt.activeGroup;

    console.log(chalk.bold('\n📋 Available Prompt Groups:\n'));
    groups.forEach(group => {
      const isActive = group === activeGroup;
      const marker = isActive ? chalk.green('✓ (active)') : '';
      console.log(`  ${isActive ? chalk.green(group) : group} ${marker}`);
    });
    console.log('');
  }

  private static getGroupName(providedGroup: string): string {
    if (providedGroup) {
      return providedGroup;
    }
    const config = getConfig();
    return config.ai.prompt.activeGroup;
  }

  private static displayMetadata(promptGroup: PromptGroup, groupName: string): void {
    console.log(chalk.bold('\n📝 Prompt Group: ') + chalk.cyan(groupName));
    if (promptGroup.metadata.description) {
      console.log(chalk.gray(`   Description: ${promptGroup.metadata.description}`));
    }
    if (promptGroup.metadata.version) {
      console.log(chalk.gray(`   Version: ${promptGroup.metadata.version}`));
    }
    console.log('');
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

  private static displayExampleContext(context: Record<string, string | number>): void {
    console.log(chalk.gray('Using example values for rendering:\n'));
    Object.entries(context).forEach(([key, value]) => {
      console.log(chalk.gray(`  ${key}: ${value}`));
    });
    console.log(chalk.gray('\n' + SEPARATOR + '\n'));
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
    console.log(chalk.bold.cyan(`\n=== ${title} ===\n`));
    console.log(content);
    console.log('');
  }

  private static displayTemplateVariables(promptGroup: PromptGroup, options: DisplayOptions): void {
    const systemVars = PromptCommands.extractVariables(promptGroup.system);
    const userVars = PromptCommands.extractVariables(promptGroup.user);

    if (systemVars.length === 0 && userVars.length === 0) {
      return;
    }

    console.log(chalk.gray('\n' + SEPARATOR));
    console.log(chalk.gray('\n📌 Template Variables:\n'));

    if (systemVars.length > 0 && options.showSystem) {
      PromptCommands.displayVariableList('System prompt variables', systemVars);
    }

    if (userVars.length > 0 && options.showUser) {
      PromptCommands.displayVariableList('User prompt variables', userVars);
    }
  }

  private static displayVariableList(title: string, variables: string[]): void {
    console.log(chalk.yellow(`  ${title}:`));
    variables.forEach(v => console.log(chalk.gray(`    {{${v}}}`)));
    console.log('');
  }

  /**
   * Extract variable names from a template string
   */
  private static extractVariables(template: string): string[] {
    const variableRegex = /\{\{(\w+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variableRegex.exec(template)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables).sort();
  }
}
