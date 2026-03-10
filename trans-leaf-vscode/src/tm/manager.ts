/**
 * 翻译记忆管理器
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { toTmx, fromTmx, TMX_FILENAME, type TuEntry } from './tmx.js';

export class TMManager {
  private cache: Map<string, TuEntry[]> = new Map();
  private workspacePath: string | undefined;

  constructor() {
    // 获取当前工作区路径
    if (vscode.workspace.workspaceFolders?.length) {
      this.workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * 保存翻译单元到 TMX 文件
   */
  async save(entries: TuEntry[]): Promise<boolean> {
    if (!this.workspacePath) {
      vscode.window.showWarningMessage('未检测到工作区，无法保存 TM');
      return false;
    }

    const tmxPath = path.join(this.workspacePath, TMX_FILENAME);

    try {
      // 读取现有条目
      const existing = await this.loadFromPath(tmxPath);

      // 合并新旧条目（去重）
      const merged = this.mergeEntries(existing, entries);

      // 写入 TMX 文件
      const tmxContent = toTmx(merged);
      await fs.writeFile(tmxPath, tmxContent, 'utf-8');

      // 更新缓存
      this.cache.set(tmxPath, merged);

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`保存 TM 失败：${msg}`);
      return false;
    }
  }

  /**
   * 从 TMX 文件加载所有条目
   */
  async load(): Promise<TuEntry[]> {
    if (!this.workspacePath) {
      return [];
    }

    const tmxPath = path.join(this.workspacePath, TMX_FILENAME);
    return this.loadFromPath(tmxPath);
  }

  /**
   * 从指定路径加载 TMX
   */
  private async loadFromPath(tmxPath: string): Promise<TuEntry[]> {
    // 检查缓存
    if (this.cache.has(tmxPath)) {
      return this.cache.get(tmxPath)!;
    }

    try {
      const content = await fs.readFile(tmxPath, 'utf-8');
      const entries = fromTmx(content);
      this.cache.set(tmxPath, entries);
      return entries;
    } catch (error) {
      // 文件不存在或读取失败，返回空数组
      return [];
    }
  }

  /**
   * 搜索匹配的翻译（用于将来查询）
   */
  async find(
    sourceText: string,
    sourceLang: string,
    targetLang: string
  ): Promise<TuEntry | null> {
    const entries = await this.load();

    // 精确匹配
    const exact = entries.find(
      e => e.sourceText === sourceText &&
           e.sourceLang === sourceLang &&
           e.targetLang === targetLang
    );
    if (exact) {
      return exact;
    }

    // 模糊匹配（可扩展）
    return null;
  }

  /**
   * 合并条目，去除重复
   */
  private mergeEntries(existing: TuEntry[], newEntries: TuEntry[]): TuEntry[] {
    const result = [...existing];
    const now = new Date().toISOString();

    for (const newEntry of newEntries) {
      // 查找是否已存在（相同原文和语言方向）
      const existingIndex = result.findIndex(
        e => e.sourceText === newEntry.sourceText &&
             e.sourceLang === newEntry.sourceLang &&
             e.targetLang === newEntry.targetLang
      );

      if (existingIndex >= 0) {
        // 更新现有条目
        result[existingIndex] = {
          ...result[existingIndex],
          targetText: newEntry.targetText,
          modifiedAt: now,
        };
      } else {
        // 添加新条目
        result.push({
          ...newEntry,
          createdAt: newEntry.createdAt || now,
        });
      }
    }

    return result;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// 单例
let instance: TMManager | undefined;

export function getTMManager(): TMManager {
  if (!instance) {
    instance = new TMManager();
  }
  return instance;
}
