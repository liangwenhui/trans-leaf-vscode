import * as vscode from 'vscode';
import { translateSelection } from './commands/translateSelection.js';
import { translateFile } from './commands/translateFile.js';
import { openSettings } from './utils/config.js';
import { ChatView } from './webview/chatView.js';

/**
 * 插件激活函数
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Trans-Leaf 插件已激活');

  // 注册聊天侧边栏视图
  let chatView: ChatView | undefined;

  const chatViewProvider = vscode.window.registerWebviewViewProvider(
    'transLeaf.chatView',
    {
      resolveWebviewView: (webviewView) => {
        chatView = new ChatView(context.extensionUri, webviewView);
      }
    },
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  // 创建状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(leaf) Trans-Leaf';
  statusBarItem.tooltip = 'Trans-Leaf 翻译插件';
  statusBarItem.command = 'transLeaf.showMenu';
  statusBarItem.show();

  // 注册状态栏菜单命令
  const showMenuCommand = vscode.commands.registerCommand(
    'transLeaf.showMenu',
    async () => {
      const options = [
        { label: '$(file-text) 翻译文件为中文', value: 'translateFileToZh' },
        { label: '$(file-text) Translate File to English', value: 'translateFileToEn' },
        { label: '$(gear) 设置 (Settings)', value: 'settings' }
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Trans-Leaf 菜单'
      });

      if (choice?.value === 'translateFileToZh') {
        await vscode.commands.executeCommand('transLeaf.translateFileToZh');
      } else if (choice?.value === 'translateFileToEn') {
        await vscode.commands.executeCommand('transLeaf.translateFileToEn');
      } else if (choice?.value === 'settings') {
        openSettings();
      }
    }
  );

  // 注册翻译选中文本为中文命令
  const translateSelectionToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateSelectionToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) 翻译中...';
      try {
        await translateSelection('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
        setTimeout(() => {
          statusBarItem.text = '$(leaf) Trans-Leaf';
        }, 3000);
      }
    }
  );

  // 注册翻译选中文本为英文命令
  const translateSelectionToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateSelectionToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateSelection('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
        setTimeout(() => {
          statusBarItem.text = '$(leaf) Trans-Leaf';
        }, 3000);
      }
    }
  );

  // 注册翻译全文为中文命令
  const translateFileToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) 翻译中...';
      try {
        await translateFile('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
        setTimeout(() => {
          statusBarItem.text = '$(leaf) Trans-Leaf';
        }, 3000);
      }
    }
  );

  // 注册翻译全文为英文命令
  const translateFileToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateFile('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
        setTimeout(() => {
          statusBarItem.text = '$(leaf) Trans-Leaf';
        }, 3000);
      }
    }
  );

  // 添加到订阅列表，确保插件停用时清理
  context.subscriptions.push(
    statusBarItem,
    showMenuCommand,
    translateSelectionToZhCommand,
    translateSelectionToEnCommand,
    translateFileToZhCommand,
    translateFileToEnCommand,
    chatViewProvider
  );
}

/**
 * 插件停用函数
 */
export function deactivate() {
  console.log('Trans-Leaf 插件已停用');
}
