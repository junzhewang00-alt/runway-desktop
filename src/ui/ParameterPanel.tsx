import type { ModelCapability } from '../types/models'

interface ParameterPanelProps {
  duration: number
  resolution: string
  aspectRatio: string
  cap: ModelCapability | undefined
  onDurationChange: (d: number) => void
  onResolutionChange: (r: string) => void
  onAspectRatioChange: (a: string) => void
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  duration, resolution, aspectRatio, cap,
  onDurationChange, onResolutionChange, onAspectRatioChange,
}) => {
  return (
    <div style={styles.row}>
      <select value={duration} onChange={(e) => onDurationChange(Number(e.target.value))}
        style={styles.select} title="视频时长">
        {cap?.durations.map((d) => (<option key={d} value={d}>{d}s</option>))}
      </select>
      <select value={resolution} onChange={(e) => onResolutionChange(e.target.value)}
        style={styles.select} title="视频分辨率">
        {cap?.resolutions.map((r) => (<option key={r} value={r}>{r}</option>))}
      </select>
      <select value={aspectRatio} onChange={(e) => onAspectRatioChange(e.target.value)}
        style={styles.select} title="画面比例">
        {cap?.aspectRatios.map((a) => (<option key={a} value={a}>{a}</option>))}
      </select>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    gap: 'var(--space-2)',
    marginTop: 'var(--space-2)',
  },
  select: {
    flex: 1,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-3)',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    outline: 'none',
  },
}

export default ParameterPanel
