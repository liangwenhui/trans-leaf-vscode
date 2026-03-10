import * as vscode from 'vscode';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { acquireLock, releaseLock } from '../utils/lock.js';
import { FileReviewPanel } from '../webview/fileReviewPanel.js';

/**
 * 分句数据结构
 */
export interface Sentence {
  index: number;
  source: string;
  target: string;
  translatable: boolean;
  status: 'untranslated' | 'translating' | 'translated' | 'edited';
  /**
   * 行位置信息，用于 saveAsFile 时还原原始格式
   * - lineIndex: 该句来自原文第几行（0-based）
   * - isWholeLine: 该句是否独占整行
   */
  lineIndex: number;
  isWholeLine: boolean;
}

/**
 * 全文分句翻译审阅命令
 */
export async function translateFileReview(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }

  // 选择目标语言
  const choice = await vscode.window.showQuickPick(
    [
      { label: '翻译为中文', value: 'zh-CN' as const },
      { label: 'Translate to English', value: 'en' as const }
    ],
    { placeHolder: '选择翻译目标语言' }
  );
  if (!choice) {
    return;
  }
  const targetLang = choice.value;

  const config = getConfig();

  // 检查 API Key
  if (config.provider !== 'mock' && !config.apiKey) {
    const action = await vscode.window.showWarningMessage(
      '请先配置 API Key',
      '打开设置'
    );
    if (action === '打开设置') {
      openSettings();
    }
    return;
  }

  const fullText = editor.document.getText();
  const fileName = editor.document.fileName.split(/[\\/]/).pop() || 'untitled';
  const languageId = editor.document.languageId;

  // 检测源语言
  const sourceLang = detectLanguage(fullText);
  const finalSourceLang: 'zh-CN' | 'en' =
    sourceLang === 'unknown'
      ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
      : sourceLang === targetLang
        ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
        : sourceLang;

  // 分句
  const sentences = splitIntoSentences(fullText, languageId);

  // 打开审阅面板
  FileReviewPanel.show({
    sentences,
    sourceLang: finalSourceLang,
    targetLang,
    fileName,
    concurrency: config.concurrency,
  });
}

/**
 * 将全文分割为句子列表
 */
export function splitIntoSentences(text: string, languageId: string): Sentence[] {
  const lines = text.split('\n');
  const sentences: Sentence[] = [];
  let index = 0;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块处理
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLines = [line];
        codeBlockStartLine = i;
      } else {
        codeBlockLines.push(line);
        sentences.push({
          index: index++,
          source: codeBlockLines.join('\n'),
          target: '',
          translatable: false,
          status: 'untranslated',
          lineIndex: codeBlockStartLine,
          isWholeLine: true,
        });
        codeBlockLines = [];
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // 空行
    if (line.trim() === '') {
      sentences.push({
        index: index++,
        source: '',
        target: '',
        translatable: false,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // Markdown 标题
    if (/^#{1,6}\s/.test(line)) {
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // 列表项
    if (/^(\s*[-*+]\s|\s*\d+\.\s)/.test(line)) {
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // 表格行
    if (/^\|.*\|$/.test(line.trim())) {
      const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());
      sentences.push({
        index: index++,
        source: line,
        target: '',
        translatable: !isSeparator,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: true,
      });
      continue;
    }

    // 普通文本：按标点断句
    const subSentences = splitByPunctuation(line);
    const wholeLine = subSentences.length === 1;
    for (const s of subSentences) {
      sentences.push({
        index: index++,
        source: s,
        target: '',
        translatable: true,
        status: 'untranslated',
        lineIndex: i,
        isWholeLine: wholeLine,
      });
    }
  }

  // 处理未闭合代码块
  if (inCodeBlock && codeBlockLines.length > 0) {
    sentences.push({
      index: index++,
      source: codeBlockLines.join('\n'),
      target: '',
      translatable: false,
      status: 'untranslated',
      lineIndex: codeBlockStartLine,
      isWholeLine: true,
    });
  }

  return sentences;
}

/**
 * 按标点符号断句
 */
function splitByPunctuation(text: string): string[] {
  const abbreviations = new Set([
    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.',
    'etc.', 'vs.', 'i.e.', 'e.g.', 'U.S.', 'UK.',
    'No.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.',
    'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
    'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.', 'Sun.',
  ]);

  function isAbbreviation(text: string, dotIndex: number): boolean {
    const start = Math.max(0, dotIndex - 10);
    const word = text.slice(start, dotIndex + 1);
    if (abbreviations.has(word)) {
      return true;
    }
    const singleLetter = text.slice(dotIndex - 1, dotIndex + 1);
    if (/^[A-Za-z]\.$/.test(singleLetter)) {
      return true;
    }
    return false;
  }

  const results: string[] = [];
  let lastIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1] || '';

    // 中文断句
    if (/[。！？；]/.test(char)) {
      const sentence = text.slice(lastIndex, i + 1).trim();
      if (sentence) {
        results.push(sentence);
      }
      lastIndex = i + 1;
      continue;
    }

    // 英文断句
    if (/[.!?]/.test(char) && (nextChar === ' ' || nextChar === '\n' || !nextChar)) {
      if (!isAbbreviation(text, i)) {
        const sentence = text.slice(lastIndex, i + 1).trim();
        if (sentence) {
          results.push(sentence);
        }
        lastIndex = i + 1;
      }
    }
  }

  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    results.push(remaining);
  }

  return results.length > 0 ? results : [text];
}
