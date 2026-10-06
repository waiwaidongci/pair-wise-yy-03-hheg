import { describe, expect, it } from 'vitest'
import type { FieldPath, ObjectMeta, RevisionState, SceneSnapshot } from '../types/revision'
import type { SceneObject } from '../types/scene'
import { findCycleMembers } from './hierarchy'
import { applyResolutions, conflictKey, findMergeBase, isAncestorRev, mergeScenes } from './merge'
import { TRACKED_FIELDS, fullFieldRevs } from './revision'

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

/** 构造一个修订快照：所有对象默认全部字段盖 rev 的戳 */
function makeSnapshot(rev: string, objects: SceneObject[], parents: string[] = []): SceneSnapshot {
  const objectMeta: Record<string, ObjectMeta> = {}
  for (const item of objects) objectMeta[item.id] = { createdRev: rev, fieldRevs: fullFieldRevs(rev) }
  return {
    name: '测试场景',
    objects,
    revision: { head: rev, objectMeta, tombstones: {}, history: [{ id: rev, parents, at: 't', label: rev }] },
  }
}

/** 基于某个快照派生新修订：应用变更并给变化的字段盖新戳 */
function derive(base: SceneSnapshot, rev: string, mutate: (objects: SceneObject[]) => Array<{ id: string; fields: FieldPath[] }>): SceneSnapshot {
  const objects = JSON.parse(JSON.stringify(base.objects)) as SceneObject[]
  const changed = mutate(objects)
  const snapshot = makeSnapshot(rev, objects, [base.revision.head])
  snapshot.revision.objectMeta = JSON.parse(JSON.stringify(base.revision.objectMeta)) as Record<string, ObjectMeta>
  for (const { id, fields } of changed) {
    for (const field of fields) snapshot.revision.objectMeta[id].fieldRevs[field] = rev
  }
  snapshot.revision.tombstones = JSON.parse(JSON.stringify(base.revision.tombstones))
  return snapshot
}

function removeObject(snapshot: SceneSnapshot, id: string, rev: string): SceneSnapshot {
  const meta = snapshot.revision.objectMeta[id]
  snapshot.objects = snapshot.objects.filter((item) => item.id !== id)
  delete snapshot.revision.objectMeta[id]
  snapshot.revision.tombstones[id] = { createdRev: meta?.createdRev ?? rev, deletedRev: rev }
  snapshot.revision.head = rev
  snapshot.revision.history.push({ id: rev, parents: [snapshot.revision.history[0].id], at: 't', label: '删除' })
  return snapshot
}

const byId = (objects: SceneObject[], id: string) => objects.find((item) => item.id === id)

describe('三方合并', () => {
  it('只有一边改过的字段直接采用', () => {
    const base = makeSnapshot('r1', [object('a'), object('b')])
    const ours = derive(base, 'r2', () => [])
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'a')!.material.color = '#ff0000'
      byId(objects, 'b')!.position = [1, 2, 3]
      return [
        { id: 'a', fields: ['material.color'] },
        { id: 'b', fields: ['position'] },
      ]
    })
    const outcome = mergeScenes(base, ours, theirs)
    expect(outcome.conflicts).toHaveLength(0)
    expect(byId(outcome.objects, 'a')!.material.color).toBe('#ff0000')
    expect(byId(outcome.objects, 'b')!.position).toEqual([1, 2, 3])
  })

  it('双方改同一字段且值不同 → 冲突；裁决后生效', () => {
    const base = makeSnapshot('r1', [object('a')])
    const ours = derive(base, 'r2', (objects) => {
      byId(objects, 'a')!.material.color = '#111111'
      return [{ id: 'a', fields: ['material.color'] }]
    })
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'a')!.material.color = '#222222'
      return [{ id: 'a', fields: ['material.color'] }]
    })
    const outcome = mergeScenes(base, ours, theirs)
    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0].field).toBe('material.color')
    // 未裁决前暂用我方值
    expect(byId(outcome.objects, 'a')!.material.color).toBe('#111111')

    const resolved = applyResolutions(outcome, { [conflictKey(outcome.conflicts[0])]: 'theirs' })
    expect(byId(resolved.objects, 'a')!.material.color).toBe('#222222')
    expect(resolved.objectMeta.a.fieldRevs['material.color']).toBe(outcome.mergeRev)
  })

  it('双方改同一字段但值相同 → 自动合并无冲突', () => {
    const base = makeSnapshot('r1', [object('a')])
    const mutate = (objects: SceneObject[]) => {
      byId(objects, 'a')!.name = '同一个名字'
      return [{ id: 'a', fields: ['name'] as FieldPath[] }]
    }
    const outcome = mergeScenes(base, derive(base, 'r2', mutate), derive(base, 'r3', mutate))
    expect(outcome.conflicts).toHaveLength(0)
    expect(byId(outcome.objects, 'a')!.name).toBe('同一个名字')
  })

  it('一方新增对象被采纳，双方各自新增都保留', () => {
    const base = makeSnapshot('r1', [object('a')])
    const ours = derive(base, 'r2', (objects) => {
      objects.push(object('ours-new'))
      return []
    })
    ours.revision.objectMeta['ours-new'] = { createdRev: 'r2', fieldRevs: fullFieldRevs('r2') }
    const theirs = derive(base, 'r3', (objects) => {
      objects.push(object('theirs-new'))
      return []
    })
    theirs.revision.objectMeta['theirs-new'] = { createdRev: 'r3', fieldRevs: fullFieldRevs('r3') }
    const outcome = mergeScenes(base, ours, theirs)
    expect(outcome.conflicts).toHaveLength(0)
    expect(byId(outcome.objects, 'ours-new')).toBeTruthy()
    expect(byId(outcome.objects, 'theirs-new')).toBeTruthy()
  })

  it('我方删除的对象不会被旧文件带回来', () => {
    const base = makeSnapshot('r1', [object('a'), object('b')])
    const ours = removeObject(derive(base, 'r-x', () => []), 'b', 'r2')
    // 对方在基线之后也有改动（新增对象），但没碰过 b
    const theirs = derive(base, 'r3', (objects) => {
      objects.push(object('c'))
      return []
    })
    theirs.revision.objectMeta.c = { createdRev: 'r3', fieldRevs: fullFieldRevs('r3') }
    const outcome = mergeScenes(base, ours, theirs)
    expect(byId(outcome.objects, 'b')).toBeUndefined()
    expect(byId(outcome.objects, 'c')).toBeTruthy()
    expect(outcome.conflicts).toHaveLength(0)
    expect(outcome.notes.some((note) => note.kind === 'tombstone')).toBe(true)
    expect(outcome.tombstones.b).toBeTruthy()
  })

  it('我方删除、对方修改 → 整对象冲突，两个方向都能裁决', () => {
    const base = makeSnapshot('r1', [object('a')])
    const ours = removeObject(derive(base, 'r-x', () => []), 'a', 'r2')
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'a')!.material.color = '#ff0000'
      return [{ id: 'a', fields: ['material.color'] }]
    })
    const outcome = mergeScenes(base, ours, theirs)
    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0].field).toBe('object')

    const key = conflictKey(outcome.conflicts[0])
    const keepDeleted = applyResolutions(outcome, { [key]: 'ours' })
    expect(byId(keepDeleted.objects, 'a')).toBeUndefined()
    expect(keepDeleted.tombstones.a).toBeTruthy()

    const restored = applyResolutions(outcome, { [key]: 'theirs' })
    expect(byId(restored.objects, 'a')!.material.color).toBe('#ff0000')
    expect(restored.tombstones.a).toBeUndefined()
  })

  it('双方分别改了不同字段 → 各自生效不冲突', () => {
    const base = makeSnapshot('r1', [object('a')])
    const ours = derive(base, 'r2', (objects) => {
      byId(objects, 'a')!.name = '我方改的名'
      return [{ id: 'a', fields: ['name'] }]
    })
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'a')!.material.roughness = 0.9
      return [{ id: 'a', fields: ['material.roughness'] }]
    })
    const outcome = mergeScenes(base, ours, theirs)
    expect(outcome.conflicts).toHaveLength(0)
    expect(byId(outcome.objects, 'a')!.name).toBe('我方改的名')
    expect(byId(outcome.objects, 'a')!.material.roughness).toBe(0.9)
  })

  it('双方交叉挂父子 → 合并结果不能有环路', () => {
    const base = makeSnapshot('r1', [object('a'), object('b')])
    const ours = derive(base, 'r2', (objects) => {
      byId(objects, 'a')!.parentId = 'b'
      return [{ id: 'a', fields: ['parentId'] }]
    })
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'b')!.parentId = 'a'
      return [{ id: 'b', fields: ['parentId'] }]
    })
    const outcome = mergeScenes(base, ours, theirs)
    expect(findCycleMembers(outcome.objects)).toBeNull()
    expect(outcome.notes.some((note) => note.kind === 'cycle')).toBe(true)
  })

  it('父级被删除的对象移到根节点', () => {
    const base = makeSnapshot('r1', [object('parent'), object('child', 'parent')])
    const ours = removeObject(derive(base, 'r-x', () => []), 'parent', 'r2')
    const theirs = derive(base, 'r3', (objects) => {
      byId(objects, 'child')!.name = '孩子改名'
      return [{ id: 'child', fields: ['name'] }]
    })
    const outcome = mergeScenes(base, ours, theirs)
    const child = byId(outcome.objects, 'child')
    expect(child).toBeTruthy()
    expect(child!.parentId).toBeNull()
    expect(child!.name).toBe('孩子改名')
    expect(outcome.notes.some((note) => note.kind === 'orphan')).toBe(true)
  })

  it('空基线退化：同 id 对象按值比对，不同值列冲突', () => {
    const ours = makeSnapshot('r1', [object('a')])
    const theirs = makeSnapshot('r2', [object('a')])
    byId(theirs.objects, 'a')!.name = '对方场景'
    const outcome = mergeScenes(null, ours, theirs)
    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0].field).toBe('name')
  })
})

describe('修订图', () => {
  const entries = new Map(
    [
      { id: 'g', parents: [] },
      { id: 'r1', parents: ['g'] },
      { id: 'r2', parents: ['r1'] },
      { id: 'm', parents: ['r2', 'x'] },
    ].map((entry) => [entry.id, { ...entry, at: 't', label: entry.id }]),
  )

  it('isAncestorRev 判断祖先关系', () => {
    expect(isAncestorRev('g', 'm', entries)).toBe(true)
    expect(isAncestorRev('r2', 'm', entries)).toBe(true)
    expect(isAncestorRev('m', 'g', entries)).toBe(false)
    expect(isAncestorRev('unknown', 'm', entries)).toBe(false)
  })

  it('findMergeBase 选有快照的最深共同祖先', () => {
    const revision = (head: string): RevisionState => ({
      head,
      objectMeta: {},
      tombstones: {},
      history: [...entries.values()],
    })
    const snapshots = { g: makeSnapshot('g', []), r1: makeSnapshot('r1', []) }
    const { base, ancestorId } = findMergeBase(revision('r2'), revision('m'), snapshots)
    expect(ancestorId).toBe('r1')
    expect(base).toBe(snapshots.r1)
    expect(findMergeBase(revision('r2'), revision('m'), {}).base).toBeNull()
  })
})

describe('TRACKED_FIELDS 覆盖', () => {
  it('材质与层级字段都在追踪列表里', () => {
    for (const field of ['parentId', 'material.color', 'material.roughness', 'material.metalness', 'material.opacity', 'material.wireframe']) {
      expect(TRACKED_FIELDS).toContain(field)
    }
  })
})
