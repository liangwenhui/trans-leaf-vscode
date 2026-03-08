/**
 * Agent 系统类型定义
 */

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 基础消息接口
 */
export interface BaseMessage {
  role: MessageRole;
  content: string;
}

/**
 * 带工具调用的 Assistant 消息
 */
export interface AssistantMessageWithTools {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

/**
 * 工具结果消息
 */
export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * 统一消息类型（联合类型）
 */
export type Message = BaseMessage | AssistantMessageWithTools | ToolMessage;

/**
 * 工具定义（统一格式）
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema 格式
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * LLM 响应（统一格式）
 */
export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

/**
 * Agent 回调接口
 */
export interface AgentCallbacks {
  /** 助手文本输出（流式） */
  onAssistantText: (text: string) => void;
  /** 工具调用开始 */
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  /** 工具执行结果 */
  onToolResult: (name: string, result: string, isError: boolean) => void;
  /** 请求用户确认（危险操作） */
  onConfirmRequest: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  /** 对话结束 */
  onDone: () => void;
  /** 发生错误 */
  onError: (error: string) => void;
}

/**
 * 工具接口
 */
export interface Tool {
  /** 工具名称 */
  readonly name: string;
  /** 工具描述 */
  readonly description: string;
  /** 参数 JSON Schema */
  readonly parameters: Record<string, unknown>;
  /** 执行工具 */
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: 'mock' | 'claude' | 'openai' | 'deepseek';
  apiKey: string;
  model: string;
  apiBaseUrl: string;
}
