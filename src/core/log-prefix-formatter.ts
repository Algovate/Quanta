import chalk from 'chalk';
import { ExecutionSessionManager } from './execution-session-manager.js';

export function formatWithArenaPrefix(loggerContext: string, message: string): string {
  if (!loggerContext.startsWith('Arena:')) return message;
  const parts = loggerContext.split(':');
  if (parts.length < 4 || parts[0] !== 'Arena' || parts[2] !== 'Drone') return message;

  // parts[1] is arenaId, not used in message prefix
  const droneId = parts[3];
  const droneName = parts.length >= 5 ? parts[4] : undefined;

  const sessionManager = ExecutionSessionManager.getInstance();
  const activeSession = sessionManager.getActive();

  const prefixParts: string[] = [];
  if (droneName) {
    prefixParts.push(chalk.cyan(`[${droneName}]`));
  } else {
    prefixParts.push(chalk.cyan(`[Drone:${droneId}]`));
  }
  if (activeSession) {
    prefixParts.push(chalk.gray(`[Session:${activeSession.id}]`));
  }
  return prefixParts.length > 0 ? `${prefixParts.join(' ')} ${message}` : message;
}
