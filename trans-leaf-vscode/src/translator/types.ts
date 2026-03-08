/**
 * 翻译结果
 */
export interface TranslateResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * 翻译选项
 */
export interface TranslateOptions {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * 翻译器接口
 */
export interface Translator {
  /**
   * 简单翻译（选中文本用）
   */
  translate(text: string, targetLang: string): Promise<TranslateResult>;

  /**
   * 带 prompt 上下文的翻译（分段翻译用）
   */
  translateWithPrompt(options: TranslateOptions): Promise<TranslateResult>;

  /**
   * 文件分析（返回 JSON 字符串）
   */
  analyze(prompt: string): Promise<TranslateResult>;
}
