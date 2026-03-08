import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool } from '../types.js';

/**
 * 读取文件工具
 */
export class ReadFileTool implements Tool {
  readonly name = 'readFile';
  readonly description = '读取文件内容，支持行号过滤';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      startLine: {
        type: 'number',
        description: '起始行号（从1开始，可选）'
      },
      endLine: {
        type: 'number',
        description: '结束行号（可选）'
      }
    },
    required: ['path']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }

    // 解析路径
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('无法获取工作区根目录');
    }

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);

    // 读取文件
    const uri = vscode.Uri.file(absPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString('utf-8');

    // 行号过滤
    const lines = content.split('\n');
    const start = (startLine ?? 1) - 1;
    const end = endLine ?? lines.length;

    if (start < 0 || start >= lines.length) {
      throw new Error(`起始行号 ${startLine} 超出范围`);
    }
    if (end > lines.length) {
      throw new Error(`结束行号 ${endLine} 超出范围`);
    }

    const selectedLines = lines.slice(start, end);
    return selectedLines.map((line, i) => `${start + i + 1}| ${line}`).join('\n');
  }
}
