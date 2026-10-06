import * as THREE from 'three'
import type { RevisionState } from '../types/revision'
import type { SceneDocument, SceneObject, Vec3 } from '../types/scene'
import { worldMatrix } from './scene'

export interface WorldBounds {
  min: Vec3
  max: Vec3
  size: Vec3
  center: Vec3
}

/** 各类型本地包围盒半尺寸（与 Geometry.tsx 的几何参数对应；灯光/相机按点处理） */
const LOCAL_HALF_EXTENTS: Record<SceneObject['type'], Vec3> = {
  box: [0.6, 0.6, 0.6],
  sphere: [0.65, 0.65, 0.65],
  cylinder: [0.52, 0.55, 0.52],
  cone: [0.62, 0.6, 0.62],
  torus: [0.85, 0.85, 0.2],
  plane: [0.5, 0.5, 0],
  directionalLight: [0, 0, 0],
  pointLight: [0, 0, 0],
  spotLight: [0, 0, 0],
  camera: [0, 0, 0],
}

/** 世界包围盒：沿父子层级把每个对象的本地包围盒变换到世界空间后合并 */
export function computeWorldBounds(objects: SceneObject[]): WorldBounds | null {
  if (objects.length === 0) return null
  const cache = new Map<string, THREE.Matrix4>()
  const box = new THREE.Box3()
  const corner = new THREE.Vector3()
  for (const object of objects) {
    const half = LOCAL_HALF_EXTENTS[object.type]
    const matrix = worldMatrix(object.id, objects, cache)
    for (let cornerIndex = 0; cornerIndex < 8; cornerIndex += 1) {
      corner
        .set(
          (cornerIndex & 1 ? 1 : -1) * half[0],
          (cornerIndex & 2 ? 1 : -1) * half[1],
          (cornerIndex & 4 ? 1 : -1) * half[2],
        )
        .applyMatrix4(matrix)
      box.expandByPoint(corner)
    }
  }
  if (box.isEmpty()) return null
  return {
    min: box.min.toArray() as Vec3,
    max: box.max.toArray() as Vec3,
    size: box.getSize(new THREE.Vector3()).toArray() as Vec3,
    center: box.getCenter(new THREE.Vector3()).toArray() as Vec3,
  }
}

export interface ExportPreview {
  document: SceneDocument
  json: string
  bytes: number
  objectCount: number
  bounds: WorldBounds | null
  head: string
  savedAt: string
}

/** 导出预览：完整序列化当前文档并统计尺寸、对象数与世界包围盒 */
export function buildExportPreview(name: string, objects: SceneObject[], revision: RevisionState): ExportPreview {
  const document: SceneDocument = {
    version: 2,
    name,
    objects: JSON.parse(JSON.stringify(objects)) as SceneObject[],
    savedAt: new Date().toISOString(),
    revision: JSON.parse(JSON.stringify(revision)) as RevisionState,
  }
  const json = JSON.stringify(document, null, 2)
  return {
    document,
    json,
    bytes: new TextEncoder().encode(json).length,
    objectCount: objects.length,
    bounds: computeWorldBounds(objects),
    head: revision.head,
    savedAt: document.savedAt,
  }
}
