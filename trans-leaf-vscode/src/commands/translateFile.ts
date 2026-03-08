import * as vscode from 'vscode';
import { createTranslator } from '../translator/index.js';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { analyzeFile, type FileAnalysis } from '../engine/analyzer.js';
import { segmentText, type Segment } from '../engine/segmenter.js';
import { TranslationQueue } from '../engine/queue.js';
import { buildSystemPrompt, buildUserPrompt, type PromptContext } from '../engine/promptBuilder.js';
import { acquireLock, releaseLock } from '../utils/lock.js';

/**
 * 翻译全文命令
 */
export async function translateFile(targetLang?: 'zh-CN' | 'en'): Promise<void> {
  // 如果没有指定目标语言，让用户选择
  if (!targetLang) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '翻译为中文', value: 'zh-CN' },
        { label: 'Translate to English', value: 'en' }
      ],
      { placeHolder: '选择翻译目标语言' }
    );
    if (!choice) {
      return;
    }
    targetLang = choice.value as 'zh-CN' | 'en';
  }

  // 并发保护
  if (!acquireLock()) {
    vscode.window.showWarningMessage('翻译正在进行中，请等待完成或取消当前翻译');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    releaseLock();
    vscode.window.showWarningMessage('请先打开一个文件');
    return;
  }

  const document = editor.document;
  const fullText = document.getText();

  if (!fullText.trim()) {
    releaseLock();
    vscode.window.showWarningMessage('文件内容为空');
    return;
  }

  // 确认弹窗
  const confirm = await vscode.window.showWarningMessage(
    `确定要将整个文件翻译为${targetLang === 'zh-CN' ? '中文' : '英文'}吗？翻译后可用 Ctrl+Z 撤销。`,
    '确定',
    '取消'
  );
  if (confirm !== '确定') {
    releaseLock();
    return;
  }

  try {
    const config = getConfig();

    // 检查 API Key（mock 除外）
    if (config.provider !== 'mock' && !config.apiKey) {
      const action = await vscode.window.showWarningMessage(
        '请先配置 API Key：点击 Trans-Leaf 状态栏 → 设置',
        '打开设置'
      );
      if (action === '打开设置') {
        openSettings();
      }
      return;
    }

    // 检测源语言
    const sourceLang = detectLanguage(fullText);
    if (sourceLang === targetLang) {
      vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 源语言与目标语言相同，跳过翻译', 3000);
      return;
    }

    // 处理 unknown 情况
    const finalSourceLang: 'zh-CN' | 'en' =
      sourceLang === 'unknown'
        ? (targetLang === 'zh-CN' ? 'en' : 'zh-CN')
        : sourceLang;

    // 创建翻译器
    const translator = createTranslator();

    // 显示进度
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '🍃 Trans-Leaf',
        cancellable: true
      },
      async (progress, token) => {
        // 第一步：文件分析
        progress.report({ message: '正在分析文件...' });
        const analysis: FileAnalysis = await analyzeFile(
          fullText,
          document.languageId,
          translator,
          config.provider === 'mock'
        );

        if (token.isCancellationRequested) {
          vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
          return;
        }

        // 第二步：文本分段
        progress.report({ message: '正在分段...' });
        const segments = segmentText(fullText, document.languageId);

        if (token.isCancellationRequested) {
          vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
          return;
        }

        // 第三步：按队列并发翻译
        let currentSegment = 0;
        const queue = new TranslationQueue({
          targetLang: targetLang,
          sourceLang: finalSourceLang,
          analysis,
          translator,
          concurrency: config.concurrency,
          onProgress: (completed, total) => {
            progress.report({
              message: `正在翻译 ${completed}/${total} 段...`
            });
          },
          cancellationToken: token
        });

        const results = await queue.translateAll(segments);

        if (token.isCancellationRequested) {
          vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
          return;
        }

        // 第四步：合并所有段的译文
        const mergedTranslation = results.join('\n');

        // 第五步：单次替换整个文档
        await editor.edit(editBuilder => {
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          editBuilder.replace(fullRange, mergedTranslation);
        });

        vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译完成', 3000);
      }
    );
  } catch (error) {
    if (error instanceof vscode.CancellationError) {
      vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`翻译失败：${message}`);
  } finally {
    releaseLock();
  }
}
