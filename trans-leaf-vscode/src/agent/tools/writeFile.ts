import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool } from '../types.js';

/**
 * 写入文件工具
 */
export class WriteFileTool implements Tool {
  readonly name = 'writeFile';
  readonly description = '写入内容到文件（会覆盖原有内容）';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      content: {
        type: 'string',
        description: '要写入的内容'
      }
    },
    required: ['path', 'content']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }
    if (content === undefined) {
      throw new Error('content 参数不能为空');
    }

    // 解析路径
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('无法获取工作区根目录');
    }

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);

    // 写入文件
    const uri = vscode.Uri.file(absPath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

    return `文件已写入: ${filePath}`;
  }
}
