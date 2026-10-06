import { describe, expect, it } from 'vitest'
import type { SceneObject } from '../types/scene'
import { findCycleMembers, repairHierarchy, assertValidHierarchy } from './hierarchy'
import { GENESIS_REV, migrateDocument, sanitizeObjects } from './revision'
import type { MergeNote } from '../types/revision'

function object(id: string, parentId: string | null = null): SceneObject {
  return {
    id,
    name: id,
    type: 'box',
    parentId,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    castShadow: true,
    receiveShadow: true,
    material: { color: '#ffffff', roughness: 0.5, metalness: 0, opacity: 1, wireframe: false },
  }
}

describe('migrateDocument 旧版迁移', () => {
  it('旧版 v1 文件迁移为 v2 并全字段盖章', () => {
    const legacy = { version: 1, name: '旧展台', objects: [object('a'), object('b', 'a')], savedAt: '2026-01-01' }
    const { document, migrated } = migrateDocument(legacy)
    expect(migrated).toBe(true)
    expect(document.version).toBe(2)
    expect(document.revision.head).not.toBe(GENESIS_REV)
    expect(document.revision.objectMeta.a.createdRev).toBe(document.revision.head)
    expect(document.revision.objectMeta.a.fieldRevs['material.color']).toBe(document.revision.head)
    expect(document.revision.history).toHaveLength(1)
  })

  it('v2 文件直接通过并补齐缺失字段戳', () => {
    const { document } = migrateDocument({ version: 1, name: 'x', objects: [object('a')] })
    const again = migrateDocument(document)
    expect(again.migrated).toBe(false)
    expect(again.document.revision.head).toBe(document.revision.head)
    expect(again.document.revision.objectMeta.a.createdRev).toBe(document.revision.head)
  })

  it('清洗坏数据：悬空父级置根、环路打断、缺省字段补齐', () => {
    const dirty = {
      name: '坏文件',
      objects: [
        { id: 'a', type: 'box', parentId: 'ghost' },
        { id: 'b', type: 'box', parentId: 'c' },
        { id: 'c', type: 'box', parentId: 'b' },
        { id: 'a', type: 'sphere' },
      ],
    }
    const { document, migrated, notes } = migrateDocument(dirty)
    expect(migrated).toBe(true)
    const [a, b, c, dup] = document.objects
    expect(a.parentId).toBeNull()
    expect(findCycleMembers(document.objects)).toBeNull()
    expect(dup.id).not.toBe('a')
    expect(a.material.roughness).toBeTypeOf('number')
    expect(a.position).toHaveLength(3)
    expect(notes.length).toBeGreaterThan(0)
    expect(() => assertValidHierarchy(document.objects)).not.toThrow()
  })

  it('拒绝无效文件', () => {
    expect(() => migrateDocument(null)).toThrow()
    expect(() => migrateDocument({ name: '没有 objects' })).toThrow('场景 JSON 缺少 objects')
  })
})

describe('层级修复', () => {
  it('findCycleMembers 找到环路', () => {
    const objects = [object('a', 'c'), object('b', 'a'), object('c', 'b'), object('d')]
    expect(findCycleMembers(objects)?.sort()).toEqual(['a', 'b', 'c'])
    expect(findCycleMembers([object('a'), object('b', 'a')])).toBeNull()
  })

  it('repairHierarchy 优先回退相对基线改动的边', () => {
    const base = new Map([
      ['a', object('a')],
      ['b', object('b')],
    ])
    const objects = [object('a', 'b'), object('b', 'a')]
    const notes: MergeNote[] = []
    repairHierarchy(objects, base, notes, 'rev-test')
    expect(findCycleMembers(objects)).toBeNull()
    expect(notes.some((note) => note.kind === 'cycle')).toBe(true)
    // 两条边都相对基线改过，断开其中一条即可
    expect(objects.filter((item) => item.parentId === null).length).toBeGreaterThan(0)
  })

  it('sanitizeObjects 去重 id', () => {
    const { objects } = sanitizeObjects([object('x'), object('x')])
    expect(new Set(objects.map((item) => item.id)).size).toBe(2)
  })
})
