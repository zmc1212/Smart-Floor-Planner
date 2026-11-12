import { AssistantError } from '../contracts';
import type { ModelTool } from '../contracts/model';
import { toModelTool, toolDefinitionIssue, toolEngineLimits, type ToolDefinition } from './contract';

/**
 * Per-run tool registry. There is deliberately no process-wide singleton:
 * a business surface builds its own registry from the caller's authorized
 * capabilities, so one tenant/run can never see another's tools.
 *
 * Definitions are server-owned code. Model output can only select a registered
 * name; it can never add, replace or describe executable tool code.
 */
export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): this {
    const issue = toolDefinitionIssue(definition);
    if (issue) throw new AssistantError(`invalid_tool_definition:${issue}`, 500);
    if (this.definitions.has(definition.name)) {
      throw new AssistantError(`duplicate_tool_definition:${definition.name}`, 500);
    }
    if (this.definitions.size >= toolEngineLimits.maxDefinitions) {
      throw new AssistantError('tool_definition_limit', 500);
    }
    this.definitions.set(definition.name, definition);
    return this;
  }

  registerAll(definitions: readonly ToolDefinition[]): this {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }

  definitionsList(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  get size(): number {
    return this.definitions.size;
  }

  /** Ordered, deduplicated wire projection used by every model turn. */
  toModelTools(): ModelTool[] {
    return this.definitionsList().map(toModelTool);
  }
}
