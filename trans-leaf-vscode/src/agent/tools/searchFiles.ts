import * as vscode from 'vscode';
import type { Tool } from '../types.js';

/**
 * 搜索文件工具
 */
export class SearchFilesTool implements Tool {
  readonly name = 'searchFiles';
  readonly description = '使用 glob 模式搜索文件';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob 搜索模式，如 **/*.ts'
      },
      maxResults: {
        type: 'number',
        description: '最大返回结果数，默认 100'
      }
    },
    required: ['pattern']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = args.pattern as string;
    const maxResults = (args.maxResults as number) ?? 100;

    if (!pattern) {
      throw new Error('pattern 参数不能为空');
    }

    // 排除 node_modules
    const exclude = '**/node_modules/**';

    try {
      const files = await vscode.workspace.findFiles(pattern, exclude, maxResults);

      if (files.length === 0) {
        return '未找到匹配的文件';
      }

      // 返回相对路径列表
      const relativePaths = files.map(f => vscode.workspace.asRelativePath(f));
      return relativePaths.join('\n');
    } catch (error) {
      throw new Error(`搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
