import { MockTranslator } from './mock.js';
import { AITranslator } from './aiTranslator.js';
import type { Translator } from './types.js';
import { getConfig } from '../utils/config.js';

/**
 * 翻译器工厂函数
 * 根据配置返回对应的翻译器实例
 */
export function createTranslator(): Translator {
  const config = getConfig();

  if (config.provider === 'mock') {
    return new MockTranslator();
  }

  if (!config.apiKey) {
    throw new Error('API Key 未配置');
  }

  return new AITranslator(
    config.provider,
    config.apiKey,
    config.model,
    config.apiBaseUrl || undefined
  );
}
