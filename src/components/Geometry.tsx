import type { ObjectType } from '../types/scene'

export default function Geometry({ type }: { type: ObjectType }) {
  if (type === 'sphere') return <sphereGeometry args={[0.65, 32, 24]} />
  if (type === 'cylinder') return <cylinderGeometry args={[0.52, 0.52, 1.1, 32]} />
  if (type === 'cone') return <coneGeometry args={[0.62, 1.2, 32]} />
  if (type === 'torus') return <torusGeometry args={[0.65, 0.2, 20, 48]} />
  if (type === 'plane') return <planeGeometry args={[1, 1, 1, 1]} />
  return <boxGeometry args={[1.2, 1.2, 1.2]} />
}
