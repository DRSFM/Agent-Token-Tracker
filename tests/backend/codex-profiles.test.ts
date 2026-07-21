import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { discoverCodexApiTargets } from '../../electron/scanners/codex-profiles'

async function tempRoot(name: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`))
}

test('API Codex profiles discover root, indexed, and unlisted upstreams', async () => {
  const root = await tempRoot('agent-token-codex-profiles')
  try {
    await fs.mkdir(path.join(root, 'sessions'), { recursive: true })
    await fs.mkdir(path.join(root, 'profiles', 'muyuanpub', 'sessions'), { recursive: true })
    await fs.mkdir(path.join(root, 'profiles', 'extra', 'sessions'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'profiles.json'),
      JSON.stringify({
        profiles: [
          { id: 'anyrouter', name: 'anyrouter', baseUrl: 'https://anyrouter.test/v1' },
          {
            id: 'muyuanpub',
            name: 'muyuanpub',
            baseUrl: 'https://muyuan.test/v1',
            home: 'profiles\\muyuanpub',
          },
        ],
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(root, 'profiles', 'extra', 'config.toml'),
      '[model_providers.apicodex]\nbase_url = "https://extra.test/v1"\n',
      'utf8',
    )

    const targets = await discoverCodexApiTargets(root)

    assert.deepEqual(
      targets.map((target) => ({
        rootPath: target.rootPath,
        id: target.upstream.id,
        label: target.upstream.label,
        baseUrl: target.upstream.baseUrl,
      })),
      [
        {
          rootPath: path.join(root, 'sessions'),
          id: 'anyrouter',
          label: 'AnyRouter',
          baseUrl: 'https://anyrouter.test/v1',
        },
        {
          rootPath: path.join(root, 'profiles', 'extra', 'sessions'),
          id: 'extra',
          label: 'extra',
          baseUrl: 'https://extra.test/v1',
        },
        {
          rootPath: path.join(root, 'profiles', 'muyuanpub', 'sessions'),
          id: 'muyuanpub',
          label: 'muyuanpub',
          baseUrl: 'https://muyuan.test/v1',
        },
      ],
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('API Codex profile discovery returns no source for a missing root', async () => {
  const parent = await tempRoot('agent-token-codex-profiles-missing')
  try {
    assert.deepEqual(await discoverCodexApiTargets(path.join(parent, 'not-created')), [])
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})
