import * as vscode from 'vscode';

/**
 * 获取 Trans-Leaf 配置
 */
export function getConfig(): {
  provider: 'mock' | 'claude' | 'openai' | 'deepseek';
  apiKey: string;
  model: string;
  targetLanguage: 'zh-CN' | 'en';
  concurrency: number;
  apiBaseUrl: string;
} {
  const config = vscode.workspace.getConfiguration('transLeaf');
  return {
    provider: config.get('provider', 'mock'),
    apiKey: config.get('apiKey', ''),
    model: config.get('model', ''),
    targetLanguage: config.get('targetLanguage', 'zh-CN'),
    concurrency: config.get('concurrency', 3),
    apiBaseUrl: config.get('apiBaseUrl', ''),
  };
}

/**
 * 打开 Trans-Leaf 设置页面
 */
export function openSettings(): void {
  vscode.commands.executeCommand('workbench.action.openSettings', 'transLeaf');
}
