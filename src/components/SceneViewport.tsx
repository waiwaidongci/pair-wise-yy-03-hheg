import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, PerspectiveCamera, Stats, TransformControls, useCursor } from '@react-three/drei'
import { Leva, useControls } from 'leva'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneObject } from '../types/scene'
import { useEditorStore } from '../stores/editor'
import { isGeometry, TYPE_LABELS, worldMatrix } from '../utils/scene'
import Geometry from './Geometry'

interface Registry {
  current: Map<string, THREE.Object3D>
}

function GeometryMesh({ object, registry }: { object: SceneObject; registry: Registry }) {
  const select = useEditorStore((state) => state.select)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const meshRef = useRef<THREE.Mesh>(null!)

  useEffect(() => {
    if (meshRef.current) registry.current.set(object.id, meshRef.current)
    return () => { registry.current.delete(object.id) }
  }, [object.id, registry])

  function handlePointer(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    select(object.id)
  }

  return (
    <mesh
      ref={meshRef}
      castShadow={object.castShadow}
      receiveShadow={object.receiveShadow}
      visible={object.visible}
      onClick={handlePointer}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }}
      onPointerOut={() => setHovered(false)}
    >
      <Geometry type={object.type} />
      <meshStandardMaterial
        color={object.material.color}
        roughness={object.material.roughness}
        metalness={object.material.metalness}
        transparent={object.material.opacity < 1}
        opacity={object.material.opacity}
        wireframe={object.material.wireframe}
        emissive={hovered ? '#1d4ed8' : '#000000'}
        emissiveIntensity={hovered ? 0.08 : 0}
      />
    </mesh>
  )
}

function LightObject({ object, registry }: { object: SceneObject; registry: Registry }) {
  const select = useEditorStore((state) => state.select)
  const groupRef = useRef<THREE.Group>(null!)
  useEffect(() => {
    if (groupRef.current) registry.current.set(object.id, groupRef.current)
    return () => { registry.current.delete(object.id) }
  }, [object.id, registry])

  const common = {
    color: object.material.color,
    intensity: object.intensity ?? 1,
    castShadow: object.castShadow,
  }

  return (
    <group ref={groupRef} position={object.position} rotation={object.rotation} onClick={(event) => { event.stopPropagation(); select(object.id) }}>
      {object.type === 'directionalLight' && <directionalLight {...common} />}
      {object.type === 'pointLight' && <pointLight {...common} distance={object.distance} />}
      {object.type === 'spotLight' && <spotLight {...common} distance={object.distance} angle={0.45} penumbra={0.35} />}
      <mesh scale={0.12}>
        <octahedronGeometry />
        <meshBasicMaterial color={object.material.color} />
      </mesh>
    </group>
  )
}

function CameraObject({ object, registry }: { object: SceneObject; registry: Registry }) {
  const select = useEditorStore((state) => state.select)
  const cameraRef = useRef<THREE.PerspectiveCamera>(null!)
  useEffect(() => {
    if (cameraRef.current) registry.current.set(object.id, cameraRef.current)
    return () => { registry.current.delete(object.id) }
  }, [object.id, registry])
  return (
    <group position={object.position} rotation={object.rotation} onClick={(event) => { event.stopPropagation(); select(object.id) }}>
      <PerspectiveCamera ref={cameraRef} makeDefault={object.activeCamera} fov={object.fov ?? 50} near={0.1} far={1000} />
      <mesh scale={0.25}>
        <boxGeometry args={[0.8, 0.55, 0.7]} />
        <meshBasicMaterial color="#0ea5e9" wireframe />
      </mesh>
    </group>
  )
}

function ObjectView({ object, objects, registry }: { object: SceneObject; objects: SceneObject[]; registry: Registry }) {
  const children = objects.filter((item) => item.parentId === object.id)
  if (isGeometry(object.type) || object.parentId) {
    return (
      <group position={object.position} rotation={object.rotation} scale={object.scale}>
        {isGeometry(object.type) && <GeometryMesh object={object} registry={registry} />}
        {object.type === 'camera' && <CameraObject object={object} registry={registry} />}
        {!isGeometry(object.type) && object.type !== 'camera' && <LightObject object={object} registry={registry} />}
        {children.map((child) => <ObjectView key={child.id} object={child} objects={objects} registry={registry} />)}
      </group>
    )
  }
  return (
    <>
      <LightObject object={object} registry={registry} />
      <group position={object.position} rotation={object.rotation} scale={object.scale}>
        {children.map((child) => <ObjectView key={child.id} object={child} objects={objects} registry={registry} />)}
      </group>
    </>
  )
}

function SelectionControls({ registry }: { registry: Registry }) {
  const selectedId = useEditorStore((state) => state.selectedId)
  const mode = useEditorStore((state) => state.transformMode)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const snapSize = useEditorStore((state) => state.snapSize)
  const setTransform = useEditorStore((state) => state.setTransform)
  const [, refresh] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => refresh((value) => value + 1), 0)
    return () => window.clearTimeout(timer)
  }, [selectedId])

  const object = selectedId ? registry.current.get(selectedId) : undefined
  if (!object || !selectedId) return null
  const activeId = selectedId

  function commit() {
    if (!object) return
    setTransform(activeId, {
      position: object.position.toArray() as [number, number, number],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray() as [number, number, number],
    })
  }

  return (
    <TransformControls
      object={object}
      mode={mode}
      translationSnap={snapEnabled ? snapSize : null}
      rotationSnap={snapEnabled ? Math.PI / 12 : null}
      scaleSnap={snapEnabled ? 0.1 : null}
      onMouseUp={commit}
    />
  )
}

function InstanceBatch({ type, objects, registry }: { type: SceneObject['type']; objects: SceneObject[]; registry: Registry }) {
  const select = useEditorStore((state) => state.select)
  const ref = useRef<THREE.InstancedMesh>(null!)
  const matrices = useMemo(() => {
    const cache = new Map<string, THREE.Matrix4>()
    return objects.map((object) => worldMatrix(object.id, useEditorStore.getState().objects, cache))
  }, [objects])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    matrices.forEach((matrix, index) => {
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, new THREE.Color(objects[index].material.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    registry.current.set(`instance-${type}`, mesh)
  }, [matrices, objects, registry, type])

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, objects.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onClick={(event) => {
        event.stopPropagation()
        const index = event.instanceId
        if (index !== undefined) select(objects[index].id)
      }}
    >
      <Geometry type={type} />
      <meshStandardMaterial vertexColors roughness={0.48} metalness={0.04} />
    </instancedMesh>
  )
}

function InstancedScene({ objects, registry }: { objects: SceneObject[]; registry: Registry }) {
  const batches = useMemo(() => {
    const map = new Map<SceneObject['type'], SceneObject[]>()
    objects.filter((object) => isGeometry(object.type) && object.visible).forEach((object) => {
      map.set(object.type, [...(map.get(object.type) ?? []), object])
    })
    return [...map.entries()]
  }, [objects])
  const singleObjects = objects.filter((object) => !isGeometry(object.type) && !object.parentId)
  return (
    <>
      {batches.map(([type, batch]) => <InstanceBatch key={type} type={type} objects={batch} registry={registry} />)}
      {singleObjects.map((object) => <ObjectView key={object.id} object={object} objects={objects} registry={registry} />)}
    </>
  )
}

function SceneContent({ registry }: { registry: Registry }) {
  const objects = useEditorStore((state) => state.objects)
  const performance = useEditorStore((state) => state.performance)
  const showGrid = performance.showGrid
  return (
    <>
      <color attach="background" args={['#cdd7e5']} />
      <fog attach="fog" args={['#cdd7e5', 18, 55]} />
      <ambientLight intensity={0.7} />
      {showGrid && <Grid infiniteGrid cellSize={0.5} sectionSize={2.5} fadeDistance={32} sectionColor="#7b8da5" cellColor="#b5c0cf" />}
      {performance.instanceMode ? (
        <InstancedScene objects={objects} registry={registry} />
      ) : (
        objects.filter((object) => !object.parentId).map((object) => <ObjectView key={object.id} object={object} objects={objects} registry={registry} />)
      )}
      {!performance.instanceMode && <SelectionControls registry={registry} />}
    </>
  )
}

function RenderControls() {
  const controls = useControls('渲染性能', () => ({
    exposure: { value: 1.05, min: 0.2, max: 2.5, step: 0.05 },
    showStats: true,
  })) as unknown as { exposure: number; showStats: boolean }
  const gl = useThree((state) => state.gl)
  useEffect(() => { gl.toneMappingExposure = controls.exposure }, [controls.exposure, gl])
  return controls.showStats ? <Stats /> : null
}

export default function SceneViewport() {
  const registry = useRef<Map<string, THREE.Object3D>>(new Map())
  const performance = useEditorStore((state) => state.performance)
  return (
    <div className="viewport-wrap">
      <Canvas
        camera={{ position: [6, 5, 8], fov: 48 }}
        shadows={performance.shadows}
        dpr={performance.instanceMode ? [0.7, 1] : [1, performance.pixelRatio]}
        gl={{ antialias: !performance.instanceMode, powerPreference: 'high-performance' }}
      >
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2} maxDistance={45} />
        <SceneContent registry={registry} />
        <RenderControls />
      </Canvas>
      <Leva collapsed titleBar={{ title: '视图控制' }} />
    </div>
  )
}
