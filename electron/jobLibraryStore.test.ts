import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createJobLibraryStore } from './jobLibraryStore.js'
import type { JobAgentConfig } from '../src/shared/types.js'

const baseConfig: JobAgentConfig = {
  id: 'custom-amazon-operator',
  title: '亚马逊运营',
  summary: '负责亚马逊店铺运营',
  mustHaves: ['亚马逊运营经验'],
  niceToHaves: ['广告投放'],
  riskFlags: ['缺少结果数据'],
  criteria: [
    {
      id: 'amazon-operation',
      label: '亚马逊运营',
      weight: 100,
      description: '是否有独立运营经验',
    },
  ],
  instructions: '只根据简历证据评分',
  thresholds: {
    strongYes: 85,
    yes: 75,
    maybe: 60,
  },
}

describe('job library store', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  async function createTempStore() {
    const directory = await mkdtemp(join(tmpdir(), 'smart-screen-jobs-'))
    tempDirs.push(directory)
    return createJobLibraryStore(join(directory, 'job-library.sqlite3'))
  }

  it('saves, lists, updates, and deletes custom jobs in SQLite', async () => {
    const store = await createTempStore()

    const created = store.saveJob({
      title: '亚马逊运营',
      salary: '10-15K',
      meta: '1-3年 / 大专 / 深圳',
      jdText: '亚马逊运营 JD',
      sourceFileName: 'amazon.txt',
      config: baseConfig,
    })

    expect(created).toMatchObject({
      id: baseConfig.id,
      title: '亚马逊运营',
      salary: '10-15K',
      meta: '1-3年 / 大专 / 深圳',
      jdText: '亚马逊运营 JD',
      sourceFileName: 'amazon.txt',
    })
    expect(created.config.id).toBe(created.id)
    expect(store.listJobs()).toEqual([created])

    const updated = store.saveJob({
      id: created.id,
      title: '亚马逊高级运营',
      salary: '15-25K',
      meta: '3-5年 / 本科 / 深圳',
      jdText: '更新后的亚马逊运营 JD',
      sourceFileName: 'amazon-updated.txt',
      config: {
        ...baseConfig,
        id: 'model-returned-different-id',
        title: '亚马逊高级运营',
        criteria: [
          {
            id: 'growth-data',
            label: '增长数据',
            weight: 100,
            description: '是否能用数据复盘',
          },
        ],
      },
    })

    expect(updated.id).toBe(created.id)
    expect(updated.config.id).toBe(created.id)
    expect(updated.config.title).toBe('亚马逊高级运营')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime())
    expect(store.listJobs()).toEqual([updated])

    expect(store.deleteJob(created.id)).toBe(true)
    expect(store.deleteJob(created.id)).toBe(false)
    expect(store.listJobs()).toEqual([])

    store.close()
  })
})
