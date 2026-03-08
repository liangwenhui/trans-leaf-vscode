import type { Translator, TranslateResult, TranslateOptions } from './types.js';

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
 * AI 翻译器实现
 * 支持 Claude、OpenAI、DeepSeek
 */
export class AITranslator implements Translator {
  constructor(
    private provider: 'claude' | 'openai' | 'deepseek',
    private apiKey: string,
    private model: string,
    private baseUrl?: string
  ) {}

  async translate(text: string, targetLang: string): Promise<TranslateResult> {
    const sourceLang = this.getInverseLang(targetLang);
    const systemPrompt = `你是一位专业翻译。请将以下${sourceLang}文本翻译为${targetLang}。
严格保留原文的所有格式，包括换行、缩进、标记符号。只输出译文。`;

    return this.translateWithPrompt({
      systemPrompt,
      userPrompt: text
    });
  }

  async translateWithPrompt(options: TranslateOptions): Promise<TranslateResult> {
    const config = DEFAULT_CONFIGS[this.provider];
    const model = this.model || config.model;
    const baseUrl = this.baseUrl || config.baseUrl;
    const url = `${baseUrl}${config.path}`;

    try {
      const body = this.buildRequestBody(options, model);
      const headers = this.buildHeaders();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000) // 60 秒超时
      });

      if (!response.ok) {
        return this.handleError(response.status);
      }

      const result = await response.json();
      const text = this.extractResult(result);

      return { text, success: true };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { text: '', success: false, error: '请求超时' };
      }
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { text: '', success: false, error: '网络连接错误' };
      }
      return { text: '', success: false, error: String(error) };
    }
  }

  async analyze(prompt: string): Promise<TranslateResult> {
    const config = DEFAULT_CONFIGS[this.provider];
    const model = this.model || config.model;
    const baseUrl = this.baseUrl || config.baseUrl;
    const url = `${baseUrl}${config.path}`;

    try {
      const body = this.buildRequestBody(
        { systemPrompt: '', userPrompt: prompt },
        model,
        0 // 分析任务使用 temperature: 0
      );
      const headers = this.buildHeaders();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        return this.handleError(response.status);
      }

      const result = await response.json();
      const text = this.extractResult(result);

      return { text, success: true };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { text: '', success: false, error: '请求超时' };
      }
      return { text: '', success: false, error: String(error) };
    }
  }

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

  private buildRequestBody(
    options: TranslateOptions,
    model: string,
    temperature: number = 0.3
  ): unknown {
    if (this.provider === 'claude') {
      return {
        model,
        max_tokens: 8192,
        system: options.systemPrompt,
        messages: [{ role: 'user', content: options.userPrompt }]
      };
    }
    return {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt }
      ],
      temperature
    };
  }

  private extractResult(result: unknown): string {
    if (this.provider === 'claude') {
      const claudeResult = result as { content: Array<{ text: string }> };
      return claudeResult.content[0].text;
    }
    const openaiResult = result as { choices: Array<{ message: { content: string } }> };
    return openaiResult.choices[0].message.content;
  }

  private handleError(status: number): TranslateResult {
    switch (status) {
      case 401:
        return { text: '', success: false, error: 'API Key 无效，请检查配置' };
      case 429:
        return { text: '', success: false, error: '请求过于频繁，请稍后重试' };
      case 500:
      case 502:
      case 503:
      case 504:
        return { text: '', success: false, error: '翻译服务暂时不可用，请稍后重试' };
      default:
        return { text: '', success: false, error: `HTTP ${status} 错误` };
    }
  }

  private getInverseLang(lang: string): string {
    return lang === 'zh-CN' ? '英文' : '中文';
  }
}
