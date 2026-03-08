import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from '../types.js';

const execAsync = promisify(exec);

/**
 * 运行命令工具
 */
export class RunCommandTool implements Tool {
  readonly name = 'runCommand';
  readonly description = '在终端中执行 shell 命令';
  readonly parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的命令'
      },
      cwd: {
        type: 'string',
        description: '工作目录（可选，默认工作区根目录）'
      }
    },
    required: ['command']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd as string | undefined;

    if (!command) {
      throw new Error('command 参数不能为空');
    }

    // 确定工作目录
    let workingDir = cwd;
    if (!workingDir) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('无法获取工作区根目录');
      }
      workingDir = workspaceRoot;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 // 1MB 缓冲区
      });

      // 合并 stdout 和 stderr，限制输出长度
      let output = (stdout || '') + (stderr || '');
      if (output.length > 10000) {
        output = output.slice(0, 10000) + '\n... (输出过长，已截断)';
      }

      return output || '命令执行成功（无输出）';
    } catch (error) {
      if (error instanceof Error) {
        const execError = error as any;
        const output = (execError.stdout || '') + (execError.stderr || execError.message || '');
        if (output) {
          return `命令执行出错:\n${output}`;
        }
        return `命令执行出错: ${error.message}`;
      }
      return `命令执行出错: ${String(error)}`;
    }
  }
}
