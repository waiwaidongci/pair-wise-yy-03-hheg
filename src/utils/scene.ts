import * as THREE from 'three'
import type { ObjectType, SceneObject, Vec3 } from '../types/scene'

export const GEOMETRY_TYPES: ObjectType[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane']
export const LIGHT_TYPES: ObjectType[] = ['directionalLight', 'pointLight', 'spotLight']

export const TYPE_LABELS: Record<ObjectType, string> = {
  box: '立方体',
  sphere: '球体',
  cylinder: '圆柱体',
  cone: '圆锥体',
  torus: '圆环',
  plane: '平面',
  directionalLight: '平行光',
  pointLight: '点光源',
  spotLight: '聚光灯',
  camera: '透视相机',
}

export const TYPE_COLORS: Record<ObjectType, string> = {
  box: '#3b82f6',
  sphere: '#14b8a6',
  cylinder: '#f59e0b',
  cone: '#ef4444',
  torus: '#8b5cf6',
  plane: '#64748b',
  directionalLight: '#fbbf24',
  pointLight: '#f97316',
  spotLight: '#fb7185',
  camera: '#0ea5e9',
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createSceneObject(type: ObjectType, parentId: string | null = null): SceneObject {
  const base: SceneObject = {
    id: uid(type),
    name: TYPE_LABELS[type],
    type,
    parentId,
    visible: true,
    position: [0, type === 'plane' ? 0 : 0.8, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    castShadow: !['plane', 'directionalLight', 'pointLight', 'spotLight', 'camera'].includes(type),
    receiveShadow: true,
    material: {
      color: TYPE_COLORS[type],
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      wireframe: false,
    },
  }
  if (type === 'plane') {
    base.scale = [4, 4, 4]
    base.rotation = [-Math.PI / 2, 0, 0]
  }
  if (type === 'directionalLight') {
    base.position = [4, 6, 3]
    base.intensity = 1.8
    base.material.color = '#fff4d6'
  }
  if (type === 'pointLight') {
    base.position = [1, 3, 1]
    base.intensity = 2
    base.distance = 12
    base.material.color = '#ffd7a8'
  }
  if (type === 'spotLight') {
    base.position = [3, 5, 3]
    base.intensity = 3
    base.distance = 15
    base.material.color = '#ffffff'
  }
  if (type === 'camera') {
    base.position = [5, 4, 7]
    base.fov = 52
    base.activeCamera = false
  }
  return base
}

export function createStarterScene(): SceneObject[] {
  const ground = createSceneObject('plane')
  ground.id = 'ground'
  ground.name = '主地面'
  ground.material.color = '#9aa7b8'

  const hero = createSceneObject('box')
  hero.id = 'hero-box'
  hero.name = '核心展台'
  hero.position = [0, 0.75, 0]
  hero.scale = [1.5, 1.5, 1.5]
  hero.material.color = '#2563eb'
  hero.castShadow = true

  const sphere = createSceneObject('sphere')
  sphere.id = 'hero-sphere'
  sphere.name = '悬浮球体'
  sphere.position = [2.3, 1.25, 0]
  sphere.material.color = '#14b8a6'

  const ring = createSceneObject('torus')
  ring.id = 'hero-ring'
  ring.name = '装饰圆环'
  ring.position = [-2.2, 1.4, 0]
  ring.rotation = [Math.PI / 2, 0, 0]
  ring.material.color = '#f59e0b'

  const sun = createSceneObject('directionalLight')
  sun.id = 'sun-light'
  sun.name = '主平行光'

  return [ground, hero, sphere, ring, sun]
}

export function isGeometry(type: ObjectType) {
  return GEOMETRY_TYPES.includes(type)
}

export function localMatrix(object: SceneObject, target = new THREE.Matrix4()) {
  const position = new THREE.Vector3(...object.position)
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...object.rotation))
  const scale = new THREE.Vector3(...object.scale)
  return target.compose(position, quaternion, scale)
}

export function worldMatrix(
  id: string,
  objects: SceneObject[],
  cache = new Map<string, THREE.Matrix4>(),
): THREE.Matrix4 {
  const cached = cache.get(id)
  if (cached) return cached
  const object = objects.find((item) => item.id === id)
  if (!object) return new THREE.Matrix4()
  const parent = object.parentId ? worldMatrix(object.parentId, objects, cache) : new THREE.Matrix4()
  const result = parent.clone().multiply(localMatrix(object))
  cache.set(id, result)
  return result
}

export function descendantsOf(id: string, objects: SceneObject[]) {
  const result = new Set<string>()
  const visit = (parentId: string) => {
    objects.filter((item) => item.parentId === parentId).forEach((item) => {
      result.add(item.id)
      visit(item.id)
    })
  }
  visit(id)
  return result
}

export function clonePosition(position: Vec3): Vec3 {
  return [position[0], position[1], position[2]]
}
