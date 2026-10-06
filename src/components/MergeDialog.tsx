import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type { Conflict, FieldConflict, ModifyDeleteConflict, ResolutionMap } from '../utils/merge'
import { emptyResolutions } from '../utils/merge'
import { useEditorStore } from '../stores/editor'
import { TYPE_LABELS } from '../utils/scene'
import type { ObjectType } from '../types/scene'

function formatValue(path: string, value: unknown): string {
  if (value === undefined || value === null) return '（无）'
  if (path.startsWith('material.')) {
    if (path === 'material.color') return String(value)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (path === 'type') return TYPE_LABELS[value as ObjectType] ?? String(value)
  if (path === 'parentId') return value ? String(value) : '场景根节点'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  return String(value)
}

function FieldConflictCard({ conflict, resolutions, onChange }: {
  conflict: FieldConflict
  resolutions: ResolutionMap
  onChange: (key: string, value: 'ours' | 'theirs') => void
}) {
  const key = `${conflict.objectId}:${conflict.path}`
  const value = resolutions.fields[key] ?? 'ours'
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 0.4 }}>
          {conflict.objectName} · {conflict.label}
        </Typography>
        <RadioGroup
          row
          value={value}
          onChange={(event) => onChange(key, event.target.value as 'ours' | 'theirs')}
        >
          <FormControlLabel value="ours" control={<Radio size="small" />} label={`甲方（本地）：${formatValue(conflict.path, conflict.oursValue)}`} />
          <FormControlLabel value="theirs" control={<Radio size="small" />} label={`乙方（文件）：${formatValue(conflict.path, conflict.theirsValue)}`} />
        </RadioGroup>
      </CardContent>
    </Card>
  )
}

function ModifyDeleteCard({ conflict, resolutions, onChange }: {
  conflict: ModifyDeleteConflict
  resolutions: ResolutionMap
  onChange: (objectId: string, value: 'delete' | 'resurrect') => void
}) {
  const value = resolutions.delete[conflict.objectId] ?? 'delete'
  const deletedSide = conflict.deletedBy === 'ours' ? '甲方（本地）' : '乙方（文件）'
  const modifiedSide = conflict.modifiedBy === 'ours' ? '甲方（本地）' : '乙方（文件）'
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 0.4 }}>{conflict.objectName} · 修改 / 删除冲突</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.6 }}>
          {deletedSide}删除了该对象，{modifiedSide}修改了它。若保留删除，旧文件无法将其带回。
        </Typography>
        <RadioGroup
          row
          value={value}
          onChange={(event) => onChange(conflict.objectId, event.target.value as 'delete' | 'resurrect')}
        >
          <FormControlLabel value="delete" control={<Radio size="small" />} label="保留删除（墓碑）" />
          <FormControlLabel value="resurrect" control={<Radio size="small" />} label={`恢复对象并采用${modifiedSide}修改`} />
        </RadioGroup>
      </CardContent>
    </Card>
  )
}

function CycleCard({ cycle, value, onChange }: {
  cycle: string[]
  value: 'ours' | 'theirs' | 'break' | undefined
  onChange: (value: 'ours' | 'theirs' | 'break') => void
}) {
  const objects = useEditorStore((state) => state.objects)
  const nameOf = (id: string) => objects.find((object) => object.id === id)?.name ?? id
  return (
    <Card variant="outlined" sx={{ mb: 1, borderColor: 'warning.main' }}>
      <CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 0.4 }}>层级环路</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.6 }}>
          {cycle.map(nameOf).join(' → ')} → {nameOf(cycle[0])}
        </Typography>
        <RadioGroup row value={value ?? 'break'} onChange={(event) => onChange(event.target.value as 'ours' | 'theirs' | 'break')}>
          <FormControlLabel value="ours" control={<Radio size="small" />} label="采用甲方层级" />
          <FormControlLabel value="theirs" control={<Radio size="small" />} label="采用乙方层级" />
          <FormControlLabel value="break" control={<Radio size="small" />} label="断开环路（末对象置根节点）" />
        </RadioGroup>
      </CardContent>
    </Card>
  )
}

export default function MergeDialog({ onRetry }: { onRetry: () => void }) {
  const pendingMerge = useEditorStore((state) => state.pendingMerge)
  const mergeError = useEditorStore((state) => state.mergeError)
  const applyMerge = useEditorStore((state) => state.applyMerge)
  const cancelMerge = useEditorStore((state) => state.cancelMerge)
  const [resolutions, setResolutions] = useState<ResolutionMap>(emptyResolutions())

  useEffect(() => {
    setResolutions(emptyResolutions())
  }, [pendingMerge])

  const conflicts = pendingMerge?.result.conflicts ?? []
  const fieldConflicts = useMemo(() => conflicts.filter((c): c is FieldConflict => c.kind === 'field'), [conflicts])
  const deleteConflicts = useMemo(() => conflicts.filter((c): c is ModifyDeleteConflict => c.kind === 'modify-delete'), [conflicts])
  const cycleConflicts = useMemo(() => conflicts.filter((c) => c.kind === 'cycle'), [conflicts])

  if (!pendingMerge && !mergeError) return null

  const setField = (key: string, value: 'ours' | 'theirs') => {
    setResolutions((current) => ({ ...current, fields: { ...current.fields, [key]: value } }))
  }
  const setDelete = (objectId: string, value: 'delete' | 'resurrect') => {
    setResolutions((current) => ({ ...current, delete: { ...current.delete, [objectId]: value } }))
  }

  const isApplyFailure = Boolean(mergeError && pendingMerge)
  const isFileFailure = Boolean(mergeError && !pendingMerge)

  return (
    <Dialog open onClose={cancelMerge} maxWidth="md" fullWidth>
      <DialogTitle>
        {mergeError && !pendingMerge ? '合并失败' : `合并冲突裁决（${conflicts.length} 项）`}
      </DialogTitle>
      <DialogContent>
        {isFileFailure ? (
          <Stack spacing={1.5}>
            <Alert severity="error">{mergeError}</Alert>
            <Typography variant="body2" color="text.secondary">
              当前场景未受影响，可重新选择文件重试，或关闭对话框保留现场。
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1}>
            {isApplyFailure && <Alert severity="error">{mergeError}</Alert>}
            <Alert severity="info">
              双方对同一对象的同一字段都做了修改。选择采用哪一方；未裁决的字段默认保留甲方（本地）版本。
            </Alert>
            {cycleConflicts.map((conflict, index) => (
              <CycleCard
                key={`cycle-${index}`}
                cycle={conflict.kind === 'cycle' ? conflict.cycle : []}
                value={resolutions.cycle}
                onChange={(value) => setResolutions((current) => ({ ...current, cycle: value }))}
              />
            ))}
            {deleteConflicts.map((conflict) => (
              <ModifyDeleteCard
                key={`delete-${conflict.objectId}`}
                conflict={conflict}
                resolutions={resolutions}
                onChange={setDelete}
              />
            ))}
            {fieldConflicts.map((conflict) => (
              <FieldConflictCard
                key={`field-${conflict.objectId}-${conflict.path}`}
                conflict={conflict}
                resolutions={resolutions}
                onChange={setField}
              />
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {isFileFailure ? (
          <>
            <Button onClick={cancelMerge}>关闭并保留现场</Button>
            <Button variant="contained" onClick={onRetry}>重新选择文件</Button>
          </>
        ) : (
          <>
            <Button onClick={cancelMerge}>取消合并（保留现场）</Button>
            <Button
              variant="contained"
              onClick={() => applyMerge({ ...resolutions, cycle: resolutions.cycle ?? 'break' })}
            >
              应用合并
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
