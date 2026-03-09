import * as vscode from 'vscode';
import { LLMClient } from './llm.js';
import type {
  Message,
  ToolCall,
  ToolResult,
  AgentCallbacks,
  Tool,
  ToolDefinition,
  LLMConfig
} from './types.js';

const MAX_ITERATIONS = 20;
const DANGEROUS_TOOLS = new Set<string>();  // 仅删除类操作需要确认，当前无删除工具

/**
 * Agent 循环类 - 处理对话和工具调用
 */
export class AgentLoop {
  private messages: Message[] = [];
  private llmClient: LLMClient;
  private toolMap: Map<string, Tool>;
  alwaysWriteFile: boolean = false;  // 是否自动写入文件，跳过确认

  constructor(
    config: LLMConfig,
    tools: Tool[],
    private readonly callbacks: AgentCallbacks
  ) {
    this.llmClient = new LLMClient(config);
    this.toolMap = new Map();
    for (const tool of tools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  /**
   * 处理用户消息
   */
  async handleUserMessage(text: string, attachedFile?: { path: string; name: string }): Promise<void> {
    let content = text;
    
    // 如果有附件文件，读取文件内容作为上下文
    if (attachedFile) {
      try {
        const fs = await import('fs/promises');
        const fileContent = await fs.readFile(attachedFile.path, 'utf-8');
        content = `【文件: ${attachedFile.name}】
\`\`\`${attachedFile.name.split('.').pop()}\`\`\`
${fileContent}
\`\`\`

---

${text}`;
      } catch (e) {
        console.error('[Trans-Leaf] 读取文件失败:', e);
        content = `【附件文件: ${attachedFile.name} (读取失败)】

${text}`;
      }
    }
    
    // 添加用户消息
    this.messages.push({ role: 'user', content });

    // 开始循环
    await this.runLoop();
  }

  /**
   * 重置对话
   */
  reset(): void {
    this.messages = [];
  }

  /**
   * 主循环
   */
  private async runLoop(): Promise<void> {
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      try {
        // 准备消息（注入 system prompt）
        const messagesWithSystem = this.prepareMessages();

        // 获取工具定义
        const toolDefs = this.getToolDefinitions();

        // 调用 LLM
        const response = await this.llmClient.chat(messagesWithSystem, toolDefs);

        // 处理文本内容
        if (response.content) {
          this.callbacks.onAssistantText(response.content);
        }

        // 检查是否需要调用工具
        if (response.tool_calls && response.tool_calls.length > 0) {
          // 添加 assistant 消息（包含 tool_calls）
          this.messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls
          });

          // 执行工具
          const toolResults = await this.executeTools(response.tool_calls);

          // 添加工具结果消息
          for (const result of toolResults) {
            this.messages.push({
              role: 'tool',
              tool_call_id: result.tool_call_id,
              content: result.content,
              is_error: result.is_error
            });
          }

          // 继续循环
          continue;
        }

        // 添加普通 assistant 消息
        this.messages.push({
          role: 'assistant',
          content: response.content
        });

        // 对话结束
        break;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.callbacks.onError(errorMsg);
        break;
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      this.callbacks.onError('Agent 循环次数超过限制（20次），已停止');
    }

    this.callbacks.onDone();
  }

  /**
   * 准备消息（注入 system prompt）
   */
  private prepareMessages(): Message[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '未知';

    const systemMessage: Message = {
      role: 'system',
      content: `你是 Trans-Leaf，一个 VS Code 中的 AI 翻译助手。
你是一位专业翻译，但不要擅自翻译，等待用户的指示。
你可以使用工具帮助用户完成翻译和代码相关任务。
当前工作区根目录: ${workspaceRoot}

规则：
- 不要擅自帮用户翻译，等待用户的明确指示
- 翻译时严格保留原文的所有格式，包括换行、缩进、标记符号，只输出译文
- 对于翻译任务，优先使用 translateText 工具
- 修改文件前先用 readFile 了解内容
- 保持回答简洁，用中文交流（除非用户用英文）`
    };

    return [systemMessage, ...this.messages];
  }

  /**
   * 获取工具定义
   */
  private getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.toolMap.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  /**
   * 执行工具
   */
  private async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = this.toolMap.get(call.name);

      if (!tool) {
        const errorMsg = `工具 ${call.name} 不存在`;
        this.callbacks.onToolResult(call.name, errorMsg, true);
        results.push({
          tool_call_id: call.id,
          content: errorMsg,
          is_error: true
        });
        continue;
      }

      // 危险工具需要用户确认（除非设置了 alwaysWriteFile）
      if (DANGEROUS_TOOLS.has(call.name) && !this.alwaysWriteFile) {
        const confirmed = await this.callbacks.onConfirmRequest(call.name, call.arguments);
        if (!confirmed) {
          const cancelMsg = '用户拒绝了此操作';
          this.callbacks.onToolResult(call.name, cancelMsg, true);
          results.push({
            tool_call_id: call.id,
            content: cancelMsg,
            is_error: true
          });
          continue;
        }
      }

      // 通知工具调用开始
      this.callbacks.onToolCall(call.name, call.arguments);

      // 执行工具
      try {
        const result = await tool.execute(call.arguments);
        this.callbacks.onToolResult(call.name, result, false);
        results.push({
          tool_call_id: call.id,
          content: result,
          is_error: false
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.callbacks.onToolResult(call.name, errorMsg, true);
        results.push({
          tool_call_id: call.id,
          content: errorMsg,
          is_error: true
        });
      }
    }

    return results;
  }
}
