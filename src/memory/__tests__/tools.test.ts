import { describe, expect, it } from 'vitest';
import { MemoryTools, toMcpContent } from '../tools.js';

describe('toMcpContent', () => {
  it('wraps text results', () => {
    expect(toMcpContent({ text: 'hi' })).toEqual({
      content: [{ type: 'text', text: 'hi' }],
    });
  });

  it('preserves isError', () => {
    expect(toMcpContent({ text: 'nope', isError: true }).isError).toBe(true);
  });
});

describe('MemoryTools formatting', () => {
  it('formats empty list and missing chat', async () => {
    const store = {
      search: async () => [],
      getChat: () => null,
      listChats: () => [],
      addChat: async () => 1,
      persist: async () => {},
    };
    const tools = new MemoryTools(store as never);
    expect((await tools.recall({ query: 'x' })).text).toContain('No matching');
    expect((await tools.getChat({ chatId: 1 })).isError).toBe(true);
    expect((await tools.listChats()).text).toBe('Memory is empty.');
  });

  it('formats recall hits', async () => {
    const store = {
      search: async () => [
        {
          id: 3,
          title: 'Auth fix',
          project: 'api',
          createdAt: '2026-07-01T00:00:00.000Z',
          score: 0.5,
          chars: 10,
          snippet: 'mutex around refresh',
        },
      ],
      getChat: () => null,
      listChats: () => [],
      addChat: async () => 1,
      persist: async () => {},
    };
    const tools = new MemoryTools(store as never);
    const result = await tools.recall({ query: 'auth' });
    expect(result.text).toContain('[chat 3] Auth fix');
    expect(result.text).toContain('mutex around refresh');
  });

  it('remembers notes via addChat', async () => {
    const calls: unknown[] = [];
    const store = {
      search: async () => [],
      getChat: () => null,
      listChats: () => [],
      addChat: async (input: unknown) => {
        calls.push(input);
        return 42;
      },
      persist: async () => {
        calls.push('persist');
      },
    };
    const tools = new MemoryTools(store as never);
    const result = await tools.remember({
      text: 'we chose SQLite over Postgres for local memory',
      project: 'memgrep',
    });
    expect(result.text).toContain('chat 42');
    expect(calls[0]).toMatchObject({
      content: 'we chose SQLite over Postgres for local memory',
      project: 'memgrep',
      tool: 'note',
    });
    expect(calls).toContain('persist');
  });
});
