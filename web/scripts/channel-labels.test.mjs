import { describe, expect, it } from 'vitest'
import { labelsByBroadcaster } from './channel-labels.mjs'

describe('labelsByBroadcaster', () => {
  it('maps broadcaster ids to string labels and ignores bad rows', () => {
    const m = labelsByBroadcaster([
      { broadcaster_id: '1', content_classification_labels: ['SexualThemes', 'MatureGame', 5] },
      { broadcaster_id: '2', content_classification_labels: [] },
      { broadcaster_id: '3' },
      { broadcaster_id: 4, content_classification_labels: ['x'] },
      null,
    ])
    expect([...m.entries()]).toEqual([['1', ['SexualThemes', 'MatureGame']], ['2', []], ['3', []]])
  })

  it('tolerates a non-array response', () => {
    expect(labelsByBroadcaster(undefined).size).toBe(0)
  })
})
