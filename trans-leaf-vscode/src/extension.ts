import * as vscode from 'vscode';
import { translateAndReview } from './commands/translateAndReview.js';
import { translateFileReview } from './commands/translateFileReview.js';
import { translateFile } from './commands/translateFile.js';
import { openSettings } from './utils/config.js';
import { ChatView } from './webview/chatView.js';

/**
 * Plugin activation function
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Trans-Leaf plugin activated');

  // Register chat sidebar view
  let chatView: ChatView | undefined;

  const chatViewProvider = vscode.window.registerWebviewViewProvider(
    'transLeaf.chatView',
    {
      resolveWebviewView: (webviewView) => {
        chatView = new ChatView(context.extensionUri, webviewView);
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        if (activeUri) {
          setTimeout(() => chatView?.updateActiveFile(activeUri), 500);
        }
      }
    },
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );

  // Listen for active editor changes
  const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && chatView) {
      chatView.updateActiveFile(editor.document.uri);
    }
  });

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(leaf) Trans-Leaf';
  statusBarItem.tooltip = 'Trans-Leaf Translation Plugin';
  statusBarItem.command = 'transLeaf.showMenu';
  statusBarItem.show();

  // Register status bar menu command
  const showMenuCommand = vscode.commands.registerCommand(
    'transLeaf.showMenu',
    async () => {
      const options = [
        { label: '$(file-text) Translate File to Chinese', value: 'translateFileToZh' },
        { label: '$(file-text) Translate File to English', value: 'translateFileToEn' },
        { label: '$(table) 分句翻译审阅', value: 'translateFileReview' },
        { label: '$(gear) Settings', value: 'settings' }
      ];

      const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Trans-Leaf Menu'
      });

      if (choice?.value === 'translateFileToZh') {
        await vscode.commands.executeCommand('transLeaf.translateFileToZh');
      } else if (choice?.value === 'translateFileToEn') {
        await vscode.commands.executeCommand('transLeaf.translateFileToEn');
      } else if (choice?.value === 'translateFileReview') {
        await vscode.commands.executeCommand('transLeaf.translateFileReview');
      } else if (choice?.value === 'settings') {
        openSettings();
      }
    }
  );

  // Register translate & review to Chinese (O1)
  const translateAndReviewToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateAndReviewToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateAndReview('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register translate & review to English (O1)
  const translateAndReviewToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateAndReviewToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateAndReview('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register translate full file to Chinese command
  const translateFileToZhCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToZh',
    async () => {
      statusBarItem.text = '$(sync~spin) 翻译中...';
      try {
        await translateFile('zh-CN');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register translate full file to English command
  const translateFileToEnCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileToEn',
    async () => {
      statusBarItem.text = '$(sync~spin) Translating...';
      try {
        await translateFile('en');
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // ★ NEW: Register file review command (O2)
  const translateFileReviewCommand = vscode.commands.registerCommand(
    'transLeaf.translateFileReview',
    async () => {
      statusBarItem.text = '$(sync~spin) 分句审阅...';
      try {
        await translateFileReview();
      } finally {
        statusBarItem.text = '$(leaf) Trans-Leaf';
      }
    }
  );

  // Register write translation result command
  const writeTranslationCommand = vscode.commands.registerCommand(
    'transLeaf.writeTranslation',
    async (translation: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await editor.edit((editBuilder) => {
          editBuilder.replace(editor.selection, translation);
        });
        vscode.window.showInformationMessage('Translation result written to file');
      }
    }
  );

  context.subscriptions.push(
    statusBarItem,
    showMenuCommand,
    translateAndReviewToZhCommand,
    translateAndReviewToEnCommand,
    translateFileToZhCommand,
    translateFileToEnCommand,
    translateFileReviewCommand,
    chatViewProvider,
    activeEditorDisposable,
    writeTranslationCommand
  );
}

/**
 * Plugin deactivation function
 */
export function deactivate() {
  console.log('Trans-Leaf plugin deactivated');
}
