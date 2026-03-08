import type {
  Message,
  ToolDefinition,
  ToolCall,
  LLMResponse,
  LLMConfig,
  AssistantMessageWithTools,
  ToolMessage
} from './types.js';

// 各服务商默认配置
const DEFAULT_CONFIGS = {
  claude: {
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com',
    path: '/v1/messages'
  },
  openai: {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com',
    path: '/v1/chat/completions'
  },
  deepseek: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    path: '/v1/chat/completions'
  }
};

/**
 * LLM 调用类 - 支持 Claude、OpenAI、DeepSeek
 */
export class LLMClient {
  private readonly provider: LLMConfig['provider'];
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly defaultConfig: typeof DEFAULT_CONFIGS[keyof typeof DEFAULT_CONFIGS];

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.apiBaseUrl || DEFAULT_CONFIGS[config.provider].baseUrl;
    this.defaultConfig = DEFAULT_CONFIGS[config.provider];
  }

  /**
   * 发送聊天请求
   */
  async chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    // Mock provider 直接返回固定消息
    if (this.provider === 'mock') {
      return {
        content: '[Mock] 我是模拟 AI，无法执行真实对话。请配置 API Key。',
        stop_reason: 'end_turn'
      };
    }

    const url = `${this.baseUrl}${this.defaultConfig.path}`;
    const body = this.buildRequestBody(messages, tools);
    const headers = this.buildHeaders();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000) // 2 分钟超时
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return this.parseResponse(result);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('请求超时');
      }
      throw error;
    }
  }

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    if (this.provider === 'claude') {
      return {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      };
    }
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-type': 'application/json'
    };
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[]
  ): unknown {
    const model = this.model || this.defaultConfig.model;

    if (this.provider === 'claude') {
      return this.buildClaudeRequest(messages, tools, model);
    }
    return this.buildOpenAIRequest(messages, tools, model);
  }

  /**
   * 构建 Claude 请求体
   */
  private buildClaudeRequest(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    model: string
  ): unknown {
    // Claude 需要分离 system 消息
    let systemPrompt = '';
    const apiMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'tool') {
        // tool 结果转换成 user 消息中的 tool_result
        const toolMsg = msg as ToolMessage;
        apiMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolMsg.tool_call_id,
            content: toolMsg.content,
            is_error: toolMsg.is_error || false
          }]
        });
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessageWithTools;
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          // 包含 tool_use 的 assistant 消息
          const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
          if (assistantMsg.content) {
            content.push({ type: 'text', text: assistantMsg.content });
          }
          for (const tc of assistantMsg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments
            });
          }
          apiMessages.push({ role: 'assistant', content });
        } else {
          // 普通 assistant 消息
          apiMessages.push({
            role: 'assistant',
            content: [{ type: 'text', text: msg.content }]
          });
        }
      } else {
        // 普通 user 消息
        apiMessages.push({
          role: 'user',
          content: [{ type: 'text', text: msg.content }]
        });
      }
    }

    const request: Record<string, unknown> = {
      model,
      max_tokens: 8192,
      messages: apiMessages
    };

    if (systemPrompt) {
      request.system = systemPrompt;
    }

    if (tools && tools.length > 0) {
      request.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    return request;
  }

  /**
   * 构建 OpenAI 兼容请求体
   */
  private buildOpenAIRequest(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    model: string
  ): unknown {
    const apiMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        const assistantMsg = msg as AssistantMessageWithTools;
        const apiMsg: Record<string, unknown> = {
          role: 'assistant',
          content: msg.content || ''
        };
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          apiMsg.tool_calls = assistantMsg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }));
        }
        apiMessages.push(apiMsg);
      } else if (msg.role === 'tool') {
        const toolMsg = msg as ToolMessage;
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolMsg.tool_call_id,
          content: toolMsg.content
        });
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const request: Record<string, unknown> = {
      model,
      messages: apiMessages,
      temperature: 0.7
    };

    if (tools && tools.length > 0) {
      request.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));
    }

    return request;
  }

  /**
   * 解析响应
   */
  private parseResponse(result: unknown): LLMResponse {
    if (this.provider === 'claude') {
      return this.parseClaudeResponse(result);
    }
    return this.parseOpenAIResponse(result);
  }

  /**
   * 解析 Claude 响应
   */
  private parseClaudeResponse(result: unknown): LLMResponse {
    const claudeResult = result as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
    };

    const textParts = claudeResult.content.filter(c => c.type === 'text');
    const toolParts = claudeResult.content.filter(c => c.type === 'tool_use');

    const content = textParts.map(t => t.text || '').join('');
    const tool_calls: ToolCall[] = toolParts.map(t => ({
      id: t.id || '',
      name: t.name || '',
      arguments: t.input || {}
    }));

    return {
      content,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      stop_reason: claudeResult.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn'
    };
  }

  /**
   * 解析 OpenAI 响应
   */
  private parseOpenAIResponse(result: unknown): LLMResponse {
    const openaiResult = result as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = openaiResult.choices[0];
    const content = choice.message.content || '';

    let tool_calls: ToolCall[] | undefined;
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      tool_calls = choice.message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }));
    }

    return {
      content,
      tool_calls,
      stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'
    };
  }
}
