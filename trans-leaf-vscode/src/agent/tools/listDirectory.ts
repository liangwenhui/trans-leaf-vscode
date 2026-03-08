import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool } from '../types.js';

/**
 * 列出目录内容工具
 */
export class ListDirectoryTool implements Tool {
  readonly name = 'listDirectory';
  readonly description = '列出目录中的文件和子目录';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '目录路径（相对或绝对路径）'
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录，默认 false'
      }
    },
    required: ['path']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = args.path as string;
    const recursive = (args.recursive as boolean) ?? false;

    if (!dirPath) {
      throw new Error('path 参数不能为空');
    }

    // 解析路径
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('无法获取工作区根目录');
    }

    const absPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.join(workspaceRoot, dirPath);

    try {
      const result = await this.listDir(absPath, recursive, 0);
      return result;
    } catch (error) {
      throw new Error(`列出目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async listDir(dirPath: string, recursive: boolean, depth: number): Promise<string> {
    const uri = vscode.Uri.file(dirPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);

    const lines: string[] = [];

    for (const [name, type] of entries) {
      const prefix = type === vscode.FileType.Directory ? '[DIR]  ' : '       ';
      lines.push(`${prefix}${name}`);

      // 递归处理子目录（限制深度避免无限递归）
      if (recursive && type === vscode.FileType.Directory && depth < 5 && name !== 'node_modules') {
        const subPath = path.join(dirPath, name);
        try {
          const subResult = await this.listDir(subPath, true, depth + 1);
          if (subResult) {
            const subLines = subResult.split('\n').filter(l => l);
            for (const subLine of subLines) {
              lines.push(`  ${subLine}`);
            }
          }
        } catch {
          // 忽略无法访问的子目录
        }
      }
    }

    return lines.join('\n');
  }
}
