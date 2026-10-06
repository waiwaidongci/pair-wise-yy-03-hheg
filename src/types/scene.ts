import type { RevisionState } from './revision'

export type Vec3 = [number, number, number]
export type ObjectType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'directionalLight' | 'pointLight' | 'spotLight' | 'camera'
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface MaterialSpec {
  color: string
  roughness: number
  metalness: number
  opacity: number
  wireframe: boolean
}

export interface SceneObject {
  id: string
  name: string
  type: ObjectType
  parentId: string | null
  visible: boolean
  position: Vec3
  rotation: Vec3
  scale: Vec3
  castShadow: boolean
  receiveShadow: boolean
  material: MaterialSpec
  intensity?: number
  distance?: number
  fov?: number
  activeCamera?: boolean
}

export interface SceneDocument {
  version: 2
  name: string
  objects: SceneObject[]
  savedAt: string
  /** v2 起携带修订信息；旧文件没有，导入时先迁移兼容 */
  revision?: RevisionState
}

export interface PerformanceSettings {
  instanceMode: boolean
  shadows: boolean
  showGrid: boolean
  pixelRatio: number
}
