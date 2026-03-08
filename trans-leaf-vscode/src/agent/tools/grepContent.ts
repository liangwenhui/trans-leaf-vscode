import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);

/**
 * 搜索文件内容工具
 */
export class GrepContentTool implements Tool {
  readonly name = 'grepContent';
  readonly description = '在文件中搜索匹配的文本内容（使用 grep）';
  readonly parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '要搜索的文本模式'
      },
      glob: {
        type: 'string',
        description: '文件 glob 模式，默认所有文件'
      },
      maxResults: {
        type: 'number',
        description: '最大返回结果数，默认 50'
      }
    },
    required: ['pattern']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = args.pattern as string;
    const glob = (args.glob as string) || '.';
    const maxResults = (args.maxResults as number) ?? 50;

    if (!pattern) {
      throw new Error('pattern 参数不能为空');
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('无法获取工作区根目录');
    }

    try {
      // 使用 grep 命令搜索
      // --include 指定文件类型，-n 显示行号，-r 递归搜索
      const include = glob !== '.' ? `--include="${glob}"` : '';
      const cmd = `grep -rn "${pattern}" ${workspaceRoot} ${include} --exclude-dir=node_modules 2>/dev/null | head -n ${maxResults}`;

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000,
        cwd: workspaceRoot,
        windowsHide: true
      });

      if (!stdout || stdout.trim() === '') {
        return `未找到匹配 "${pattern}" 的内容`;
      }

      // 转换为相对路径
      const lines = stdout.trim().split('\n');
      const relativeResults = lines.map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          const fullPath = match[1];
          const lineNumber = match[2];
          const content = match[3];
          const relativePath = vscode.workspace.asRelativePath(fullPath);
          return `${relativePath}:${lineNumber}:${content}`;
        }
        return line;
      });

      return relativeResults.join('\n');
    } catch (error) {
      // grep 没有找到结果时会返回非 0 退出码
      if (error instanceof Error && 'code' in error && (error as any).code === 1) {
        return `未找到匹配 "${pattern}" 的内容`;
      }
      throw new Error(`搜索失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
