import { Box, Button, IconButton, List, ListItemButton, ListItemText, Stack, Tooltip, Typography } from '@mui/material'
import { AddBoxOutlined, CameraAltOutlined, DeleteOutline, ExpandMore, LightModeOutlined, Visibility, VisibilityOff } from '@mui/icons-material'
import { useMemo, useState } from 'react'
import type { ObjectType, SceneObject } from '../types/scene'
import { useEditorStore } from '../stores/editor'
import { TYPE_LABELS } from '../utils/scene'

function ObjectRow({ object, depth }: { object: SceneObject; depth: number }) {
  const selectedId = useEditorStore((state) => state.selectedId)
  const select = useEditorStore((state) => state.select)
  const update = useEditorStore((state) => state.update)
  const remove = useEditorStore((state) => state.remove)
  const reparent = useEditorStore((state) => state.reparent)
  const [expanded, setExpanded] = useState(true)
  const objects = useEditorStore((state) => state.objects)
  const children = useMemo(() => objects.filter((item) => !item.deleted && item.parentId === object.id), [objects, object.id])
  const isLight = object.type.includes('Light')
  const isCamera = object.type === 'camera'

  return (
    <>
      <ListItemButton
        draggable
        selected={selectedId === object.id}
        onDragStart={(event) => event.dataTransfer.setData('application/x-scene-object', object.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const id = event.dataTransfer.getData('application/x-scene-object')
          if (id) reparent(id, object.id)
        }}
        onClick={() => select(object.id)}
        sx={{ pl: 1 + depth * 1.6, minHeight: 34, borderBottom: '1px solid #edf0f4' }}
      >
        {children.length > 0 && (
          <IconButton
            size="small"
            onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value) }}
            sx={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: '.15s' }}
          >
            <ExpandMore fontSize="inherit" />
          </IconButton>
        )}
        <Box sx={{ mr: 0.8, display: 'grid', placeItems: 'center', color: isLight ? '#d97706' : isCamera ? '#0284c7' : '#2563eb' }}>
          {isLight ? <LightModeOutlined fontSize="small" /> : isCamera ? <CameraAltOutlined fontSize="small" /> : <AddBoxOutlined fontSize="small" />}
        </Box>
        <ListItemText
          primary={object.name}
          secondary={TYPE_LABELS[object.type]}
          slotProps={{ primary: { fontSize: 12, fontWeight: 600 }, secondary: { fontSize: 10 } }}
        />
        <Tooltip title={object.visible ? '隐藏' : '显示'}>
          <IconButton size="small" onClick={(event) => { event.stopPropagation(); update(object.id, { visible: !object.visible }) }}>
            {object.visible ? <Visibility fontSize="inherit" /> : <VisibilityOff fontSize="inherit" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="删除">
          <IconButton size="small" color="error" onClick={(event) => { event.stopPropagation(); remove(object.id) }}>
            <DeleteOutline fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </ListItemButton>
      {expanded && children.map((child) => <ObjectRow key={child.id} object={child} depth={depth + 1} />)}
    </>
  )
}

export default function HierarchyPanel() {
  const objects = useEditorStore((state) => state.objects)
  const selectedId = useEditorStore((state) => state.selectedId)
  const add = useEditorStore((state) => state.add)
  const live = objects.filter((object) => !object.deleted)
  const roots = live.filter((object) => !object.parentId)
  const countGeometry = live.filter((object) => !object.type.includes('Light') && object.type !== 'camera').length

  return (
    <aside className="panel hierarchy-panel">
      <div className="panel-heading">
        <div><Typography variant="subtitle2">场景层级</Typography><Typography variant="caption" color="text.secondary">{live.length} 个对象 · {countGeometry} 个几何体</Typography></div>
      </div>
      <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
        {(['box', 'sphere', 'cylinder', 'cone', 'torus'] as ObjectType[]).map((type) => (
          <Button key={type} size="small" variant="outlined" onClick={() => add(type, selectedId)}>{TYPE_LABELS[type]}</Button>
        ))}
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ mb: 1.2 }}>
        <Button size="small" onClick={() => add('directionalLight', selectedId)}>平行光</Button>
        <Button size="small" onClick={() => add('pointLight', selectedId)}>点光源</Button>
        <Button size="small" onClick={() => add('camera', selectedId)}>相机</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">拖动物体到另一行可调整父子关系</Typography>
      <List dense disablePadding sx={{ mt: 1 }}>
        {roots.map((object) => <ObjectRow key={object.id} object={object} depth={0} />)}
      </List>
    </aside>
  )
}
