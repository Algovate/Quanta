import fs from 'fs';
import path from 'path';
import { UnifiedLogger } from '../logging/index.js';

export interface PromptGroupMetadata {
  name: string;
  description?: string;
  version?: string;
}

export interface PromptGroup {
  metadata: PromptGroupMetadata;
  system: string;
  user: string;
}

/**
 * Load a prompt group from the config/prompts directory
 * @param groupName The name of the prompt group (without .json extension)
 * @returns The loaded prompt group
 * @throws Error if the group file doesn't exist or is invalid
 */
export function loadPromptGroup(groupName: string): PromptGroup {
  const configDir = path.join(process.cwd(), 'config', 'prompts');
  const promptFile = path.join(configDir, `${groupName}.json`);

  if (!fs.existsSync(promptFile)) {
    throw new Error(
      `Prompt group "${groupName}" not found. Expected file: ${promptFile}\n` +
        `Please create a prompt configuration file at ${promptFile}`
    );
  }

  try {
    const fileContent = fs.readFileSync(promptFile, 'utf-8');
    const parsed = JSON.parse(fileContent);

    // Validate the structure
    validatePromptGroup(parsed);

    return parsed as PromptGroup;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in prompt group "${groupName}": ${error.message}\n` + `File: ${promptFile}`
      );
    }
    throw error;
  }
}

/**
 * Validate that a prompt group has the required structure
 */
export function validatePromptGroup(group: any): void {
  if (!group) {
    throw new Error('Prompt group is null or undefined');
  }

  if (!group.metadata) {
    throw new Error('Prompt group missing required field: metadata');
  }

  if (!group.metadata.name || typeof group.metadata.name !== 'string') {
    throw new Error('Prompt group metadata missing required field: metadata.name');
  }

  if (!group.system || typeof group.system !== 'string') {
    throw new Error('Prompt group missing required field: system');
  }

  if (!group.user || typeof group.user !== 'string') {
    throw new Error('Prompt group missing required field: user');
  }
}

/**
 * Render a template string with Mustache-style variables
 * Supports {{variableName}} syntax
 * @param template The template string with {{variable}} placeholders
 * @param context Object containing variable values
 * @returns Rendered string with variables replaced
 */
export function renderTemplate(template: string, context: Record<string, any>): string {
  let rendered = template;

  // Match {{variable}} patterns
  const variableRegex = /\{\{(\w+)\}\}/g;

  rendered = rendered.replace(variableRegex, (_match, varName) => {
    if (varName in context) {
      const value = context[varName];
      // Handle null/undefined as empty string
      if (value === null || value === undefined) {
        return '';
      }
      // Convert to string
      return String(value);
    }
    // Variable not found - log warning but continue with empty string
    const logger = UnifiedLogger.getInstance();
    logger.warn(`Template variable "${varName}" not found in context`, {}, 'PromptLoader');
    return '';
  });

  return rendered;
}

/**
 * List all available prompt groups in the config/prompts directory
 * @returns Array of prompt group names (without .json extension)
 */
export function listPromptGroups(): string[] {
  const configDir = path.join(process.cwd(), 'config', 'prompts');

  if (!fs.existsSync(configDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(configDir);
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace(/\.json$/, ''))
      .sort();
  } catch (error) {
    const logger = UnifiedLogger.getInstance();
    logger.warn(
      `Failed to list prompt groups: ${error}`,
      error instanceof Error ? { error: error.message } : { error: String(error) },
      'PromptLoader'
    );
    return [];
  }
}
