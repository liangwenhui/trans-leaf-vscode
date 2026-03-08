import type { FileAnalysis } from './analyzer.js';

/**
 * Prompt 上下文
 */
export interface PromptContext {
  targetLang: 'zh-CN' | 'en';
  sourceLang: 'zh-CN' | 'en';
  analysis: FileAnalysis;
  segmentIndex: number;
  totalSegments: number;
}

/**
 * 构建系统 Prompt
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sourceLangName = ctx.sourceLang === 'zh-CN' ? '中文' : '英文';
  const targetLangName = ctx.targetLang === 'zh-CN' ? '中文' : '英文';

  let terminology = '';
  if (ctx.analysis.terminology.length > 0) {
    terminology = '\n3. 术语统一：以下术语请按指定方式翻译：\n';
    for (const term of ctx.analysis.terminology) {
      terminology += `   - ${term}\n`;
    }
  }

  const markdownExamples = '#、**、``、```、-、>、[]';

  return `你是一位专业的${ctx.analysis.domain}领域翻译专家。你正在翻译一份${ctx.analysis.fileType}格式的文档。

文档语境：${ctx.analysis.context}

翻译要求：
1. 将${sourceLangName}翻译为${targetLangName}
2. **严格保留原文的所有格式**：
   - 保留所有换行符（\\n）的位置和数量
   - 保留所有缩进（空格、Tab）
   - 保留 Markdown 标记（${markdownExamples} 等）原封不动
   - 保留 HTML 标签原封不动
   - 保留代码块内容不翻译
   - 保留 URL、文件路径不翻译
   - 保留数字、变量名、函数名不翻译${terminology}
4. 只输出译文，不要输出解释、注释或原文

当前翻译的是第 ${ctx.segmentIndex + 1}/${ctx.totalSegments} 段。请保持前后文风格一致。`;
}

/**
 * 构建用户 Prompt
 */
export function buildUserPrompt(text: string): string {
  return `请翻译以下文本：

${text}`;
}

/**
 * 构建选中文本翻译的简化 Prompt
 */
export function buildSimpleSelectionPrompt(
  text: string,
  sourceLang: 'zh-CN' | 'en',
  targetLang: 'zh-CN' | 'en'
): { systemPrompt: string; userPrompt: string } {
  const sourceLangName = sourceLang === 'zh-CN' ? '中文' : '英文';
  const targetLangName = targetLang === 'zh-CN' ? '中文' : '英文';

  const systemPrompt = `你是一位专业翻译。请将以下${sourceLangName}文本翻译为${targetLangName}。
严格保留原文的所有格式，包括换行、缩进、标记符号。只输出译文。`;

  return { systemPrompt, userPrompt: text };
}
