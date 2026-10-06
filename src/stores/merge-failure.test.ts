import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ real: null as null | typeof import('../utils/merge').mergeScenes }))

vi.mock('../utils/merge', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/merge')>()
  holder.real = original.mergeScenes
  return { ...original, mergeScenes: vi.fn((...args: Parameters<typeof original.mergeScenes>) => holder.real!(...args)) }
})

import * as mergeModule from '../utils/merge'
import { useEditorStore } from './editor'
import type { SceneDocument } from '../types/scene'

const store = () => useEditorStore.getState()
const mergeScenesMock = () => vi.mocked(mergeModule.mergeScenes)

/** 构造对方文件：在我方修改之前导出的版本上改 hero-box 颜色并推进修订头（形成分叉） */
function theirDocument(document: SceneDocument) {
  document.objects.find((item) => item.id === 'hero-box')!.material.color = '#ff0000'
  const rev = 'rev-theirs-1'
  document.revision!.objectMeta['hero-box'].fieldRevs['material.color'] = rev
  document.revision!.history.push({ id: rev, parents: [document.revision!.head], at: new Date().toISOString(), label: '对方修改' })
  document.revision!.head = rev
  return document
}

describe('合并失败：保留现场并重试', () => {
  beforeEach(() => {
    store().reset()
    mergeScenesMock().mockClear()
    mergeScenesMock().mockImplementation((...args) => holder.real!(...args))
  })

  it('合并抛错后现场不变，mergeFailure 记录可重试，重试成功落地', () => {
    // 先导出共同版本，再各自分叉
    const exported = store().exportDocument()
    store().update('hero-sphere', { name: '我方改的名' })
    const document = theirDocument(exported)

    mergeScenesMock().mockImplementationOnce(() => {
      throw new Error('模拟合并崩溃')
    })
    store().importDocument(document)

    // 现场保留：我方改动还在，对方改动没进来
    expect(store().objects.find((item) => item.id === 'hero-sphere')!.name).toBe('我方改的名')
    expect(store().objects.find((item) => item.id === 'hero-box')!.material.color).not.toBe('#ff0000')
    expect(store().mergeFailure?.message).toContain('模拟合并崩溃')
    expect(store().notice).toContain('合并失败')

    // 重试（mock 只抛一次）→ 合并成功
    store().retryMerge()
    expect(store().mergeFailure).toBeNull()
    expect(store().objects.find((item) => item.id === 'hero-box')!.material.color).toBe('#ff0000')
    expect(store().objects.find((item) => item.id === 'hero-sphere')!.name).toBe('我方改的名')
    expect(store().notice).toContain('合并完成')
  })

  it('持续失败可反复重试，场景始终不被破坏', () => {
    const exported = store().exportDocument()
    store().update('hero-sphere', { name: '我方改的名' })
    const document = theirDocument(exported)
    const objectCountBefore = store().objects.length

    mergeScenesMock().mockImplementation(() => {
      throw new Error('一直失败')
    })
    store().importDocument(document)
    expect(store().mergeFailure).toBeTruthy()
    store().retryMerge()
    expect(store().mergeFailure).toBeTruthy()
    expect(store().objects).toHaveLength(objectCountBefore)
    expect(store().objects.find((item) => item.id === 'hero-sphere')!.name).toBe('我方改的名')

    store().dismissMergeFailure()
    expect(store().mergeFailure).toBeNull()
  })
})
