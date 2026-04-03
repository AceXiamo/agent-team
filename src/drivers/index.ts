import { DriverRegistry } from '../core/registry.js';
import { ClaudeDriver } from './claude.js';
import { CopilotDriver } from './copilot.js';
import { CodexDriver } from './codex.js';
import { KimiDriver } from './kimi.js';

export function createDefaultRegistry(): DriverRegistry {
  return new DriverRegistry([new ClaudeDriver(), new CodexDriver(), new KimiDriver(), new CopilotDriver()]);
}
