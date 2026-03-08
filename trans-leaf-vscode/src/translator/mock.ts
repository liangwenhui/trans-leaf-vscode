import type { Translator, TranslateResult, TranslateOptions } from './types.js';

/**
 * Mock 翻译器 - 用于测试
 * 直接返回原文，不做任何修改
 */
export class MockTranslator implements Translator {
  async translate(text: string, _targetLang: string): Promise<TranslateResult> {
    return { text, success: true };
  }

  async translateWithPrompt(options: TranslateOptions): Promise<TranslateResult> {
    // Mock 模式返回原文
    return { text: options.userPrompt, success: true };
  }

  async analyze(_prompt: string): Promise<TranslateResult> {
    // Mock 模式返回默认分析结果 JSON
    const defaultAnalysis = {
      fileType: 'plain',
      domain: '通用',
      context: '通用文本',
      terminology: []
    };
    return { text: JSON.stringify(defaultAnalysis), success: true };
  }
}
