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

    for (const planFolder of ['free', 'plus', 'pro5x', 'pro20x']) {
      const stat = await fs.stat(path.join(groupRoot, planFolder))
      assert.equal(stat.isDirectory(), true)
    }

    assert.equal(__quotaTestHooks.normalizePlanFolder('Pro 5x'), 'pro5x')
    assert.equal(__quotaTestHooks.normalizePlanFolder('pro_20x'), 'pro20x')
    assert.equal(__quotaTestHooks.normalizePlanFolder('team'), null)

    const targetFile = await __quotaTestHooks.moveAuthFileToPlanFolder(
      { filePath: sourceFile, accountGroup: '自己的账号', groupRoot },
      'free',
    )

    assert.equal(targetFile, path.join(groupRoot, 'free', 'codex-user-plus.json'))
    assert.equal(await fs.readFile(targetFile, 'utf8'), JSON.stringify({ email: 'user@example.com', access_token: 'token' }))
    await assert.rejects(fs.access(sourceFile))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
