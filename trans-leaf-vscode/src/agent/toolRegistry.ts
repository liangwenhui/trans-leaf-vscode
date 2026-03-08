import type { Tool } from './types.js';

/**
 * 工具注册表类
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/**
 * 工厂函数 - 创建并返回配置好的工具注册表
 */
export async function createToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();

  // 导入所有工具
  const { TranslateTextTool } = await import('./tools/translateText.js');
  const { ReadFileTool } = await import('./tools/readFile.js');
  const { WriteFileTool } = await import('./tools/writeFile.js');
  const { EditFileTool } = await import('./tools/editFile.js');
  const { SearchFilesTool } = await import('./tools/searchFiles.js');
  const { GrepContentTool } = await import('./tools/grepContent.js');
  const { ListDirectoryTool } = await import('./tools/listDirectory.js');
  const { RunCommandTool } = await import('./tools/runCommand.js');

  registry.register(new TranslateTextTool());
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new SearchFilesTool());
  registry.register(new GrepContentTool());
  registry.register(new ListDirectoryTool());
  registry.register(new RunCommandTool());

  return registry;
}
