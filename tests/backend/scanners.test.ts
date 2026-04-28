import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { scanClaudeCode } from '../../electron/scanners/claude'
import { scanCodex } from '../../electron/scanners/codex'
import { cacheKey } from '../../electron/scanners/shared'
import { readClaudeReplay, readCodexReplay } from '../../electron/replay'

async function tempRoot(name: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`))
}

async function writeJsonl(filePath: string, lines: string[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
}

test('scanClaudeCode weights cache tokens at 0.1x and skips malformed rows', async () => {
  const root = await tempRoot('agent-token-claude')
  try {
    const filePath = path.join(root, 'project-a', 'session-1.jsonl')
    await writeJsonl(filePath, [
      '{bad json',
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-24T01:00:00.000Z',
        sessionId: 'session-1',
        cwd: '/tmp/project-a',
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 300,
          },
        },
      }),
    ])

    const result = await scanClaudeCode(new Map(), root)
    assert.equal(result.records.length, 1)
    assert.equal(result.parsedFiles, 1)
    assert.equal(result.reusedFiles, 0)
    assert.equal(result.records[0].totalTokens, 200)
    assert.equal(result.records[0].rawTotalTokens, 650)
    assert.equal(result.records[0].cacheTokens, 500)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scanClaudeCode reads third-party model names from fallback fields', async () => {
  const root = await tempRoot('agent-token-claude-third-party')
  try {
    const filePath = path.join(root, 'project-a', 'session-third-party.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-24T01:00:00.000Z',
        sessionId: 'session-third-party',
        cwd: '/tmp/project-a',
        request: {
          body: {
            model: 'minimax-2.7',
          },
        },
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ])

    const result = await scanClaudeCode(new Map(), root)
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].model, 'minimax-2.7')
    assert.equal(result.records[0].totalTokens, 150)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scanCodex uses last_token_usage total tokens and ignores cumulative totals', async () => {
  const root = await tempRoot('agent-token-codex')
  try {
    const filePath = path.join(root, '2026', '04', '24', 'rollout.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-session-1', cwd: '/tmp/codex-project' },
      }),
      JSON.stringify({
        type: 'turn_context',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: { model: 'gpt-5.4', cwd: '/tmp/codex-project' },
      }),
      '{bad json',
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.000Z',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 9999 },
            last_token_usage: {
              input_tokens: 10,
              cached_input_tokens: 4,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 35,
            },
          },
        },
      }),
    ])

    const result = await scanCodex(new Map(), root)
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].sessionId, 'codex-session-1')
    assert.equal(result.records[0].sessionTitle, 'codex-project')
    assert.equal(result.records[0].model, 'gpt-5.4')
    assert.equal(result.records[0].inputTokens, 10)
    assert.equal(result.records[0].outputTokens, 25)
    assert.equal(result.records[0].cacheTokens, 4)
    assert.equal(result.records[0].totalTokens, 35)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scanners reuse unchanged file cache entries', async () => {
  const root = await tempRoot('agent-token-cache')
  try {
    const filePath = path.join(root, 'project-a', 'session-1.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-24T01:00:00.000Z',
        sessionId: 'session-1',
        cwd: '/tmp/project-a',
        message: {
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ])

    const first = await scanClaudeCode(new Map(), root)
    const cache = new Map(first.cacheEntries.map((entry) => [cacheKey(entry.source, entry.filePath), entry]))
    const second = await scanClaudeCode(cache, root)

    assert.equal(second.records.length, 1)
    assert.equal(second.parsedFiles, 0)
    assert.equal(second.reusedFiles, 1)
    assert.equal(second.records[0].totalTokens, 30)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readClaudeReplay reconstructs messages tools and usage events', async () => {
  const root = await tempRoot('agent-token-replay-claude')
  try {
    const filePath = path.join(root, 'project-a', 'session-replay.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-24T01:00:00.000Z',
        sessionId: 'session-replay',
        message: {
          role: 'user',
          content: '请读取 README',
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-24T01:00:01.000Z',
        sessionId: 'session-replay',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'text', text: '我先查看文件。' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 30,
          },
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-04-24T01:00:02.000Z',
        sessionId: 'session-replay',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'README contents' }],
        },
      }),
    ])

    const events = await readClaudeReplay('session-replay', root)
    assert.equal(events.some((event) => event.role === 'user' && event.content === '请读取 README'), true)
    assert.equal(events.some((event) => event.type === 'tool_call' && event.toolName === 'Read'), true)
    assert.equal(events.some((event) => event.type === 'tool_result' && event.content === 'README contents'), true)
    const usage = events.find((event) => event.type === 'token_usage')
    assert.equal(usage?.totalTokens, 155)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay reconstructs basic message and token events', async () => {
  const root = await tempRoot('agent-token-replay-codex')
  try {
    const filePath = path.join(root, '2026', '04', '24', 'rollout.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay', cwd: '/tmp/codex-project' },
      }),
      JSON.stringify({
        type: 'turn_context',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: { model: 'gpt-5.4' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.000Z',
        payload: {
          type: 'user_message',
          message: '请检查代码。',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.500Z',
        payload: {
          type: 'agent_message',
          message: '我会检查代码。',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:03.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 10,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              cached_input_tokens: 3,
              total_tokens: 35,
            },
          },
        },
      }),
    ])

    const events = await readCodexReplay('codex-replay', root)
    assert.equal(events.some((event) => event.role === 'user' && event.content === '请检查代码。'), true)
    assert.equal(events.some((event) => event.role === 'assistant' && event.content === '我会检查代码。'), true)
    const usage = events.find((event) => event.type === 'token_usage')
    assert.equal(usage?.model, 'gpt-5.4')
    assert.equal(usage?.totalTokens, 35)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay conversationOnly hides technical events', async () => {
  const root = await tempRoot('agent-token-replay-codex-conversation')
  try {
    const filePath = path.join(root, '2026', '04', '24', 'conversation.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-conversation' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: { type: 'task_started', content: '<permissions instructions>' },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-24T01:00:01.500Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>' }],
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.000Z',
        payload: { type: 'user_message', message: '只看这个问题。' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:03.000Z',
        payload: { type: 'agent_message', message: '只看这个回答。' },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-24T01:00:03.500Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '只看这个回答。' }],
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:04.000Z',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
        },
      }),
    ])

    const events = await readCodexReplay('codex-replay-conversation', root, [], { conversationOnly: true })

    assert.deepEqual(events.map((event) => [event.role, event.content]), [
      ['user', '只看这个问题。'],
      ['assistant', '只看这个回答。'],
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay conversationOnly keeps only final assistant message per turn', async () => {
  const root = await tempRoot('agent-token-replay-codex-final-answer')
  try {
    const filePath = path.join(root, '2026', '04', '24', 'final-answer.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-final-answer' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: { type: 'user_message', message: '修一下回放。' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.000Z',
        payload: { type: 'agent_message', message: '我先检查文件。' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:03.000Z',
        payload: { type: 'agent_message', message: '现在跑测试。' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:04.000Z',
        payload: { type: 'agent_message', message: '修好了，回放现在只显示最终总结。' },
      }),
    ])

    const events = await readCodexReplay('codex-replay-final-answer', root, [], { conversationOnly: true })

    assert.deepEqual(events.map((event) => [event.role, event.content]), [
      ['user', '修一下回放。'],
      ['assistant', '修好了，回放现在只显示最终总结。'],
    ])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay keeps image attachments for conversation replay', async () => {
  const root = await tempRoot('agent-token-replay-codex-images')
  try {
    const filePath = path.join(root, '2026', '04', '24', 'images.jsonl')
    await writeJsonl(filePath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-images' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:02.000Z',
        payload: {
          type: 'user_message',
          message: '看这张图',
          images: ['data:image/png;base64,AAAA'],
        },
      }),
    ])

    const events = await readCodexReplay('codex-replay-images', root, [], { conversationOnly: true })

    assert.equal(events.length, 1)
    assert.equal(events[0].attachments?.[0].url, 'data:image/png;base64,AAAA')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay can limit replay parsing to candidate files', async () => {
  const root = await tempRoot('agent-token-replay-codex-candidates')
  try {
    const selectedFile = path.join(root, '2026', '04', '24', 'selected.jsonl')
    const unrelatedFile = path.join(root, '2026', '04', '24', 'unrelated.jsonl')
    await writeJsonl(selectedFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-candidate' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: {
          type: 'agent_message',
          role: 'assistant',
          message: 'selected file message',
        },
      }),
    ])
    await writeJsonl(unrelatedFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-candidate' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: {
          type: 'agent_message',
          role: 'assistant',
          message: 'unrelated file message',
        },
      }),
    ])

    const events = await readCodexReplay('codex-replay-candidate', root, [selectedFile])

    assert.equal(events.some((event) => event.content === 'selected file message'), true)
    assert.equal(events.some((event) => event.content === 'unrelated file message'), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readCodexReplay skips a root when candidates belong to another root', async () => {
  const localRoot = await tempRoot('agent-token-replay-local-root')
  const remoteRoot = await tempRoot('agent-token-replay-remote-root')
  try {
    const localFile = path.join(localRoot, '2026', '04', '24', 'selected.jsonl')
    const remoteFile = path.join(remoteRoot, '2026', '04', '24', 'same-session.jsonl')
    await writeJsonl(localFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-cross-root' },
      }),
    ])
    await writeJsonl(remoteFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-24T01:00:00.000Z',
        payload: { id: 'codex-replay-cross-root' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-24T01:00:01.000Z',
        payload: {
          type: 'agent_message',
          role: 'assistant',
          message: 'remote fallback should not be scanned',
        },
      }),
    ])

    const events = await readCodexReplay('codex-replay-cross-root', remoteRoot, [localFile])

    assert.equal(events.length, 0)
  } finally {
    await fs.rm(localRoot, { recursive: true, force: true })
    await fs.rm(remoteRoot, { recursive: true, force: true })
  }
})
