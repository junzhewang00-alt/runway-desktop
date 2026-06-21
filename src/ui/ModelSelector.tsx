import type { ModelCapability } from '../types/models'

interface ModelSelectorProps {
  modelId: string
  models: ModelCapability[]
  onChange: (modelId: string) => void
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ modelId, models, onChange }) => {
  return (
    <select
      value={modelId}
      onChange={(e) => onChange(e.target.value)}
      style={styles.select}
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
}

const styles: Record<string, React.CSSProperties> = {
  select: {
    width: '100%',
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

export default ModelSelector
