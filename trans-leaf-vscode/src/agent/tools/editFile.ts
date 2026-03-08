import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool } from '../types.js';

/**
 * 编辑文件工具
 */
export class EditFileTool implements Tool {
  readonly name = 'editFile';
  readonly description = '编辑文件内容（查找并替换文本）';
  readonly parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      oldText: {
        type: 'string',
        description: '要查找的旧文本'
      },
      newText: {
        type: 'string',
        description: '替换的新文本'
      }
    },
    required: ['path', 'oldText', 'newText']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const oldText = args.oldText as string;
    const newText = args.newText as string;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }
    if (!oldText) {
      throw new Error('oldText 参数不能为空');
    }
    if (newText === undefined) {
      throw new Error('newText 参数不能为空');
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

    // 检查 oldText 是否存在
    if (!content.includes(oldText)) {
      throw new Error('在文件中未找到要替换的文本');
    }

    // 替换文本
    const newContent = content.replace(oldText, newText);

    // 写回文件
    await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf-8'));

    return '编辑已应用成功';
  }
}
