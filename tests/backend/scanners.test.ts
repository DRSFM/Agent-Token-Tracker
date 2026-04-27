import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { scanClaudeCode } from '../../electron/scanners/claude'
import { scanCodex } from '../../electron/scanners/codex'
import { cacheKey } from '../../electron/scanners/shared'

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
