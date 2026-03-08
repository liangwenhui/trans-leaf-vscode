import * as vscode from 'vscode';
import type { Segment } from './segmenter.js';
import type { Translator } from '../translator/types.js';
import type { PromptContext } from './promptBuilder.js';
import type { FileAnalysis } from './analyzer.js';
import { buildSystemPrompt, buildUserPrompt } from './promptBuilder.js';

/**
 * 翻译任务
 */
export interface TranslateTask {
  segment: Segment;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  error?: string;
}

/**
 * 翻译队列上下文
 */
interface QueueContext {
  targetLang: 'zh-CN' | 'en';
  sourceLang: 'zh-CN' | 'en';
  analysis: FileAnalysis;
  translator: Translator;
  concurrency: number;
  onProgress: (completed: number, total: number) => void;
  cancellationToken: vscode.CancellationToken;
}

/**
 * 翻译任务队列
 * 控制并发翻译，处理取消和错误
 */
export class TranslationQueue {
  private tasks: TranslateTask[] = [];
  private running = 0;
  private abort = false;

  constructor(private context: QueueContext) {}

  /**
   * 翻译所有段
   * 返回每段的译文数组，顺序与 segments 对应
   * 任何一段失败则 throw Error
   * 取消则 throw CancellationError
   */
  async translateAll(segments: Segment[]): Promise<string[]> {
    this.tasks = segments.map(segment => ({
      segment,
      status: 'pending' as const
    }));

    const results = new Array<string>(segments.length);
    let completed = 0;

    // 启动初始任务
    for (let i = 0; i < Math.min(this.context.concurrency, segments.length); i++) {
      this.runNextTask().then(result => {
        if (result !== null) {
          const { index, text } = result;
          results[index] = text;
          completed++;
          this.context.onProgress(completed, segments.length);
        }
      });
    }

    // 等待所有任务完成或失败
    while (this.running > 0 || this.tasks.some(t => t.status === 'pending')) {
      // 检查取消
      if (this.context.cancellationToken.isCancellationRequested) {
        this.abort = true;
        // 等待已启动的任务完成
        while (this.running > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new vscode.CancellationError();
      }

      // 检查是否需要启动下一个任务
      if (this.abort) {
        // 等待运行中的任务完成
        while (this.running > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        break;
      }

      if (this.running < this.context.concurrency) {
        const pendingIndex = this.tasks.findIndex(t => t.status === 'pending');
        if (pendingIndex !== -1) {
          this.runNextTask().then(result => {
            if (result !== null) {
              const { index, text } = result;
              results[index] = text;
              completed++;
              this.context.onProgress(completed, segments.length);
            }
          });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 检查是否有失败的任务
    const failedTask = this.tasks.find(t => t.status === 'failed');
    if (failedTask) {
      throw new Error(`翻译第 ${failedTask.segment.index + 1} 段时失败：${failedTask.error}`);
    }

    if (this.abort) {
      throw new vscode.CancellationError();
    }

    return results;
  }

  /**
   * 运行下一个待翻译任务
   */
  private async runNextTask(): Promise<{ index: number; text: string } | null> {
    // 查找下一个待处理任务
    const task = this.tasks.find(t => t.status === 'pending');
    if (!task || this.abort) {
      return null;
    }

    task.status = 'running';
    this.running++;

    const promptCtx: PromptContext = {
      targetLang: this.context.targetLang,
      sourceLang: this.context.sourceLang,
      analysis: this.context.analysis,
      segmentIndex: task.segment.index,
      totalSegments: this.tasks.length
    };

    const systemPrompt = buildSystemPrompt(promptCtx);
    const userPrompt = buildUserPrompt(task.segment.text);

    try {
      const result = await this.context.translator.translateWithPrompt({
        systemPrompt,
        userPrompt
      });

      if (result.success) {
        task.status = 'done';
        task.result = result.text;
        return { index: task.segment.index, text: result.text };
      } else {
        task.status = 'failed';
        task.error = result.error || '未知错误';
        // 设置 abort 标志，停止后续任务
        this.abort = true;
        return null;
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      this.abort = true;
      return null;
    } finally {
      this.running--;
    }
  }
}
