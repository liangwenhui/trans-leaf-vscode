import type { Tool } from '../types.js';
import { createTranslator } from '../../translator/index.js';
import { buildSimpleSelectionPrompt } from '../../engine/promptBuilder.js';

/**
 * 翻译文本工具
 */
export class TranslateTextTool implements Tool {
  readonly name = 'translateText';
  readonly description = '翻译文本到指定语言';
  readonly parameters = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '要翻译的文本'
      },
      targetLang: {
        type: 'string',
        description: '目标语言，支持 zh-CN（中文）或 en（英文）',
        enum: ['zh-CN', 'en']
      }
    },
    required: ['text', 'targetLang']
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const text = args.text as string;
    const targetLang = args.targetLang as 'zh-CN' | 'en';

    if (!text) {
      throw new Error('text 参数不能为空');
    }
    if (!targetLang || (targetLang !== 'zh-CN' && targetLang !== 'en')) {
      throw new Error('targetLang 必须是 zh-CN 或 en');
    }

    const translator = createTranslator();
    const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(text, 'auto', targetLang);
    const result = await translator.translateWithPrompt({ systemPrompt, userPrompt });

    if (!result.success) {
      throw new Error(result.error || '翻译失败');
    }

    return result.text;
  }
}
