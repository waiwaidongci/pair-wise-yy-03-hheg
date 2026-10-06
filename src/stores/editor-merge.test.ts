import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editor'
import type { FieldPath } from '../types/revision'
import type { SceneDocument } from '../types/scene'

const store = () => useEditorStore.getState()

/** 模拟队友：在导出文件上继续开发（新修订 + 字段盖章） */
function teammateEdit(document: SceneDocument, edit: (doc: SceneDocument) => Array<{ id: string; fields: string[] }>): SceneDocument {
  const rev = `rev-teammate-${Math.random().toString(36).slice(2, 8)}`
  const changed = edit(document)
  const revision = document.revision!
  for (const { id, fields } of changed) {
    for (const field of fields) {
      revision.objectMeta[id].fieldRevs[field as FieldPath] = rev
    }
  }
  revision.history.push({ id: rev, parents: [revision.head], at: new Date().toISOString(), label: '队友修改' })
  revision.head = rev
  return document
}

describe('编辑器修订追踪', () => {
  beforeEach(() => store().reset())

  it('编辑会盖章字段并递增版本号（派生数据失效令牌）', () => {
    const before = store()
    const sceneVersion = before.sceneVersion
    const structureVersion = before.structureVersion
    const headBefore = before.revision.head

    store().update('hero-box', { material: { ...store().objects.find((o) => o.id === 'hero-box')!.material, color: '#123456' } })
    const after = store()
    expect(after.revision.head).not.toBe(headBefore)
    expect(after.revision.objectMeta['hero-box'].fieldRevs['material.color']).toBe(after.revision.head)
    expect(after.sceneVersion).toBe(sceneVersion + 1)
    expect(after.structureVersion).toBe(structureVersion) // 非结构变化

    store().reparent('hero-sphere', 'hero-box')
    expect(store().structureVersion).toBe(structureVersion + 1) // 层级变化
    expect(store().revision.objectMeta['hero-sphere'].fieldRevs.parentId).toBe(store().revision.head)
  })

  it('删除留下墓碑，导出文件携带修订信息', () => {
    store().remove('hero-ring')
    expect(store().revision.tombstones['hero-ring']).toBeTruthy()
    const doc = store().exportDocument()
    expect(doc.version).toBe(2)
    expect(doc.revision?.tombstones['hero-ring']).toBeTruthy()
    expect(doc.revision?.objectMeta['hero-box'].fieldRevs.name).toBeTruthy()
  })
})

describe('导入合并流程', () => {
  beforeEach(() => store().reset())

  it('单边修改自动合并：对方改颜色、我方改名字，互不覆盖', () => {
    const exported = store().exportDocument()
    // 我方改名字
    store().update('hero-box', { name: '我方的主展台' })
    // 对方改颜色
    const theirs = teammateEdit(exported, (doc) => {
      doc.objects.find((o) => o.id === 'hero-box')!.material.color = '#ff0000'
      return [{ id: 'hero-box', fields: ['material.color'] }]
    })
    store().importDocument(theirs)
    const hero = store().objects.find((o) => o.id === 'hero-box')!
    expect(hero.name).toBe('我方的主展台')
    expect(hero.material.color).toBe('#ff0000')
    expect(store().pendingMerge).toBeNull()
    expect(store().notice).toContain('合并完成')
  })

  it('双方改同一字段 → 挂起冲突，现场不变，裁决后落地', () => {
    const exported = store().exportDocument()
    store().update('hero-box', { material: { ...store().objects.find((o) => o.id === 'hero-box')!.material, color: '#111111' } })
    const theirs = teammateEdit(exported, (doc) => {
      doc.objects.find((o) => o.id === 'hero-box')!.material.color = '#222222'
      return [{ id: 'hero-box', fields: ['material.color'] }]
    })
    store().importDocument(theirs)

    // 冲突挂起，场景保持我方原样
    expect(store().pendingMerge).not.toBeNull()
    expect(store().pendingMerge!.outcome.conflicts).toHaveLength(1)
    expect(store().objects.find((o) => o.id === 'hero-box')!.material.color).toBe('#111111')

    store().resolveMerge({ 'hero-box:material.color': 'theirs' })
    expect(store().pendingMerge).toBeNull()
    expect(store().objects.find((o) => o.id === 'hero-box')!.material.color).toBe('#222222')
  })

  it('取消合并：当前场景不动', () => {
    const exported = store().exportDocument()
    store().update('hero-box', { material: { ...store().objects.find((o) => o.id === 'hero-box')!.material, color: '#111111' } })
    const theirs = teammateEdit(exported, (doc) => {
      doc.objects.find((o) => o.id === 'hero-box')!.material.color = '#222222'
      return [{ id: 'hero-box', fields: ['material.color'] }]
    })
    store().importDocument(theirs)
    expect(store().pendingMerge).not.toBeNull()
    store().cancelMerge()
    expect(store().pendingMerge).toBeNull()
    expect(store().objects.find((o) => o.id === 'hero-box')!.material.color).toBe('#111111')
  })

  it('我方删除的对象不会因导入旧文件复活', () => {
    const exported = store().exportDocument()
    store().remove('hero-ring')
    // 对方基于旧文件加了新对象，但没动 hero-ring
    const theirs = teammateEdit(exported, (doc) => {
      const extra = { ...doc.objects[1], id: 'teammate-box', name: '队友新箱体' }
      doc.objects.push(extra)
      doc.revision!.objectMeta['teammate-box'] = { createdRev: 'rev-teammate-add', fieldRevs: {} }
      return []
    })
    theirs.revision!.history.push({ id: 'rev-teammate-add', parents: [theirs.revision!.history[0].id], at: new Date().toISOString(), label: '队友新增' })
    store().importDocument(theirs)
    expect(store().objects.find((o) => o.id === 'hero-ring')).toBeUndefined()
    expect(store().objects.find((o) => o.id === 'teammate-box')).toBeTruthy()
    expect(store().revision.tombstones['hero-ring']).toBeTruthy()
  })

  it('对方领先时快进，版本一致时不重复合并', () => {
    const exported = store().exportDocument()
    const theirs = teammateEdit(exported, (doc) => {
      doc.objects.find((o) => o.id === 'hero-box')!.name = '队友改的名'
      return [{ id: 'hero-box', fields: ['name'] }]
    })
    store().importDocument(theirs)
    expect(store().objects.find((o) => o.id === 'hero-box')!.name).toBe('队友改的名')
    expect(store().notice).toContain('快进')

    store().importDocument(store().exportDocument())
    expect(store().notice).toContain('无需合并')
  })

  it('旧版文件先迁移兼容再读入', () => {
    const legacy = {
      version: 1,
      name: '旧版展台',
      objects: [
        { id: 'old-box', name: '旧箱体', type: 'box', parentId: null, visible: true, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], castShadow: true, receiveShadow: true, material: { color: '#ff0000', roughness: 0.5, metalness: 0, opacity: 1, wireframe: false } },
      ],
      savedAt: '2026-01-01T00:00:00.000Z',
    }
    store().importDocument(legacy)
    expect(store().name).toBe('旧版展台')
    expect(store().objects).toHaveLength(1)
    expect(store().revision.objectMeta['old-box'].createdRev).toBe(store().revision.head)
    expect(store().notice).toContain('迁移兼容')
  })
})
