import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { __quotaTestHooks } from '../../electron/quota'

async function tempRoot(name: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`))
}

test('quota plan folders are normalized and auth files move to the matching folder', async () => {
  const root = await tempRoot('agent-token-quota-plan')
  try {
    const groupRoot = path.join(root, '自己的账号')
    const sourceDir = path.join(groupRoot, 'plus')
    const sourceFile = path.join(sourceDir, 'codex-user-plus.json')
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.writeFile(sourceFile, JSON.stringify({ email: 'user@example.com', access_token: 'token' }), 'utf8')

    await __quotaTestHooks.ensurePlanFolders(groupRoot)

    for (const planFolder of ['free', 'plus', 'pro5x', 'pro20x', 'business']) {
      const stat = await fs.stat(path.join(groupRoot, planFolder))
      assert.equal(stat.isDirectory(), true)
    }

    assert.equal(__quotaTestHooks.normalizePlanFolder('Pro 5x'), 'pro5x')
    assert.equal(__quotaTestHooks.normalizePlanFolder('pro_20x'), 'pro20x')
    assert.equal(__quotaTestHooks.normalizePlanFolder('business'), 'business')
    assert.equal(__quotaTestHooks.normalizePlanFolder('bussiness'), 'business')
    assert.equal(__quotaTestHooks.normalizePlanFolder('ChatGPT Business'), 'business')
    assert.equal(__quotaTestHooks.normalizePlanFolder('team'), null)

    const targetFile = await __quotaTestHooks.moveAuthFileToPlanFolder(
      { filePath: sourceFile, accountGroup: '自己的账号', groupRoot },
      'bussiness',
    )

    assert.equal(targetFile, path.join(groupRoot, 'business', 'codex-user-plus.json'))
    assert.equal(await fs.readFile(targetFile, 'utf8'), JSON.stringify({ email: 'user@example.com', access_token: 'token' }))
    await assert.rejects(fs.access(sourceFile))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('quota auth scan keeps the account group root stable inside plan folders', async () => {
  const root = await tempRoot('agent-token-quota-stable-root')
  try {
    const groupRoot = path.join(root, '自己的账号')
    const sourceDir = path.join(groupRoot, 'free')
    const sourceFile = path.join(sourceDir, 'codex-user.json')
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.writeFile(sourceFile, JSON.stringify({ email: 'user@example.com', access_token: 'token' }), 'utf8')

    const records = await __quotaTestHooks.walkAuthFiles(groupRoot, '自己的账号', groupRoot)
    assert.equal(records.length, 1)
    assert.equal(records[0].groupRoot, groupRoot)

    const targetFile = await __quotaTestHooks.moveAuthFileToPlanFolder(records[0], 'free')
    assert.equal(targetFile, sourceFile)
    await assert.rejects(fs.access(path.join(groupRoot, 'free', 'free')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('quota business accounts can be inferred from workspace codex file names', async () => {
  const root = await tempRoot('agent-token-quota-business-name')
  try {
    const groupRoot = path.join(root, '自己的账号')
    const sourceFile = path.join(groupRoot, 'codex-ab12cd34-user-name@example.com.json')
    await fs.mkdir(groupRoot, { recursive: true })
    await fs.writeFile(sourceFile, JSON.stringify({ access_token: 'token' }), 'utf8')

    assert.equal(__quotaTestHooks.inferPlanFolderFromFileName(sourceFile), 'business')
    assert.equal(__quotaTestHooks.fallbackEmail(sourceFile), 'user-name@example.com')
    const regularFile = path.join(groupRoot, 'codex-user-name@example.com.json')
    assert.equal(__quotaTestHooks.inferPlanFolderFromFileName(regularFile), null)
    assert.equal(__quotaTestHooks.fallbackEmail(regularFile), 'user-name@example.com')

    const targetFile = await __quotaTestHooks.moveAuthFileToPlanFolder(
      { filePath: sourceFile, accountGroup: '自己的账号', groupRoot },
      '',
    )

    assert.equal(targetFile, path.join(groupRoot, 'business', 'codex-ab12cd34-user-name@example.com.json'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('hidden quota accounts are returned without remote refresh errors', async () => {
  const root = await tempRoot('agent-token-quota-hidden')
  try {
    const groupRoot = path.join(root, '自己的账号')
    const sourceFile = path.join(groupRoot, 'codex-hidden.json')
    await fs.mkdir(groupRoot, { recursive: true })
    await fs.writeFile(sourceFile, JSON.stringify({ email: 'hidden@example.com' }), 'utf8')
    const record = { filePath: sourceFile, accountGroup: '自己的账号' as const, groupRoot }

    const hiddenKeys = new Set([
      __quotaTestHooks.quotaAccountKey(record),
    ])
    const row = await __quotaTestHooks.refreshRecord(
      record,
      '2026-05-13T00:00:00.000Z',
      hiddenKeys,
    )

    assert.equal(row.email, 'hidden@example.com')
    assert.equal(row.visibilityKey, '自己的账号:codex-hidden.json')
    assert.equal(row.hidden, true)
    assert.equal(row.error, '')
    assert.equal(row.primaryRemainingPercent, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('hidden quota keys distinguish separate json files for the same email', async () => {
  const root = await tempRoot('agent-token-quota-hidden-source')
  try {
    const groupRoot = path.join(root, '自己的账号')
    const freeFile = path.join(groupRoot, 'free', 'codex-same-free.json')
    const teamFile = path.join(groupRoot, 'codex-same-team.json')
    await fs.mkdir(path.dirname(freeFile), { recursive: true })
    await fs.writeFile(freeFile, JSON.stringify({ email: 'same@example.com' }), 'utf8')
    await fs.writeFile(teamFile, JSON.stringify({ email: 'same@example.com' }), 'utf8')

    const freeRecord = { filePath: freeFile, accountGroup: '自己的账号' as const, groupRoot }
    const teamRecord = { filePath: teamFile, accountGroup: '自己的账号' as const, groupRoot }
    const hiddenKeys = new Set([__quotaTestHooks.quotaAccountKey(freeRecord)])
    const timestamp = '2026-05-14T00:00:00.000Z'

    const freeRow = await __quotaTestHooks.refreshRecord(freeRecord, timestamp, hiddenKeys)
    const teamRow = await __quotaTestHooks.refreshRecord(teamRecord, timestamp, hiddenKeys)

    assert.equal(freeRow.visibilityKey, '自己的账号:free/codex-same-free.json')
    assert.equal(freeRow.email, 'same@example.com')
    assert.equal(freeRow.hidden, true)
    assert.equal(teamRow.visibilityKey, '自己的账号:codex-same-team.json')
    assert.equal(teamRow.email, 'same@example.com')
    assert.equal(teamRow.hidden, undefined)
    assert.equal(teamRow.error, 'missing access_token')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
