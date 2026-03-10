import * as vscode from 'vscode';
import { createTranslator } from '../translator/index.js';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { buildSimpleSelectionPrompt } from '../engine/promptBuilder.js';
import { acquireLock, releaseLock } from '../utils/lock.js';
import { TranslationReviewPanel } from '../webview/reviewPanel.js';

/**
 * 翻译选中文本并打开审阅面板
 */
export async function translateAndReview(targetLang?: 'zh-CN' | 'en'): Promise<void> {
  // 如果没有指定目标语言，让用户选择
  if (!targetLang) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '翻译并审阅 → 中文', value: 'zh-CN' as const },
        { label: 'Translate & Review → English', value: 'en' as const }
      ],
      { placeHolder: '选择翻译目标语言' }
    );
    if (!choice) {
      return;
    }
    targetLang = choice.value;
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

  const selection = editor.selection;
  if (selection.isEmpty) {
    releaseLock();
    vscode.window.showWarningMessage('请先选中要翻译的文本');
    return;
  }

  const selectedText = editor.document.getText(selection);
  if (!selectedText.trim()) {
    releaseLock();
    vscode.window.showWarningMessage('选中的文本为空');
    return;
  }

  // 保存原始引用，供后续 onWrite 使用
  const originalEditor = editor;
  const originalSelection = selection;
  const originalUri = editor.document.uri;

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
    const sourceLang = detectLanguage(selectedText);
    if (sourceLang === targetLang) {
      vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 源语言与目标语言相同，跳过翻译', 3000);
      return;
    }

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
        progress.report({ message: '正在翻译...' });

        const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(
          selectedText,
          finalSourceLang,
          targetLang
        );

        const result = await translator.translateWithPrompt({
          systemPrompt,
          userPrompt
        });

        if (token.isCancellationRequested) {
          vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译已取消', 3000);
          return;
        }

        if (!result.success) {
          throw new Error(result.error || '翻译失败');
        }

        // ★ 不直接替换选区，而是打开审阅面板
        TranslationReviewPanel.show({
          sourceText: selectedText,
          translatedText: result.text,
          sourceLang: finalSourceLang,
          targetLang,
          onWrite: async (text: string, _saveToTM: boolean) => {
            // 写入文件：检查 editor 是否仍然有效
            const targetEditor = vscode.window.visibleTextEditors.find(
              e => e.document.uri.toString() === originalUri.toString()
            );

            if (!targetEditor) {
              vscode.window.showWarningMessage('原始编辑器已关闭，无法写入');
              return;
            }

            // 检查文档是否被修改（选区可能已失效）
            const currentText = targetEditor.document.getText(originalSelection);
            if (currentText !== selectedText) {
              const confirm = await vscode.window.showWarningMessage(
                '选区内容已发生变化，仍要写入吗？',
                '写入', '取消'
              );
              if (confirm !== '写入') {
                return;
              }
            }

            await targetEditor.edit(editBuilder => {
              editBuilder.replace(originalSelection, text);
            });

            vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 译文已写入文件', 3000);

            // saveToTM 预留 — 后续接入 MemoryManager
            // if (_saveToTM) {
            //   memoryManager.saveTM({ source: selectedText, target: text, ... });
            // }
          }
        });
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`翻译失败：${message}`);
  } finally {
    releaseLock();
  }
}
