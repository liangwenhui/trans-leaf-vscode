import * as vscode from 'vscode';
import { createTranslator } from '../translator/index.js';
import { detectLanguage } from '../lang/detector.js';
import { getConfig, openSettings } from '../utils/config.js';
import { buildSimpleSelectionPrompt } from '../engine/promptBuilder.js';
import { acquireLock, releaseLock } from '../utils/lock.js';

/**
 * 翻译选中文本命令
 */
export async function translateSelection(targetLang?: 'zh-CN' | 'en'): Promise<void> {
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
        progress.report({ message: '正在翻译...' });

        // 构建简化 prompt
        const { systemPrompt, userPrompt } = buildSimpleSelectionPrompt(
          selectedText,
          finalSourceLang,
          targetLang
        );

        // 调用翻译
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

        // 替换选中文本
        await editor.edit(editBuilder => {
          editBuilder.replace(selection, result.text);
        });

        vscode.window.setStatusBarMessage('🍃 Trans-Leaf: 翻译完成', 3000);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`翻译失败：${message}`);
  } finally {
    releaseLock();
  }
}
