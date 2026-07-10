import { MemoryStore } from '../memory/store.js';
import { MemoryTools, type ToolResult } from '../memory/tools.js';
import type { MemoryAccess } from './types.js';

export class LocalMemoryAccess implements MemoryAccess {
  private constructor(
    private readonly store: MemoryStore,
    private readonly tools: MemoryTools,
  ) {}

  static async open(storeDir?: string): Promise<LocalMemoryAccess> {
    const store = await MemoryStore.open(storeDir);
    return new LocalMemoryAccess(store, new MemoryTools(store));
  }

  recall(query: string, k?: number): Promise<ToolResult> {
    return this.tools.recall({ query, k });
  }

  getChat(chatId: number): Promise<ToolResult> {
    return this.tools.getChat({ chatId });
  }

  listChats(project?: string): Promise<ToolResult> {
    return this.tools.listChats({ project });
  }

  close(): void {
    this.store.close();
  }
}
