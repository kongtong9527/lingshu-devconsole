import { useState } from 'react'
import { useStore } from '../store.js'
import type { CategoryGroup } from '../types.js'
import { ArrowRightIcon } from '../icons.js'
import { emptyGroupState, categoryFromState, visibleGroups, applyLinkageClear } from './filterState.js'
import { FilterGroupEditor } from './FilterGroupEditor.js'

/** 分类预览（getCategories）：渲染筛选分组，应用后组合 category 跳转 list。 */
export default function CategoriesPreview({ data }: { data: CategoryGroup[] }) {
  const runWith = useStore((s) => s.runWith)
  const [state, setState] = useState(emptyGroupState())

  const category = categoryFromState(data, state)
  const shown = visibleGroups(data, state)
  const handleChange = (next: ReturnType<typeof emptyGroupState>) =>
    setState((prev) => applyLinkageClear(data, prev, next))

  return (
    <div className="dc-preview-wrap">
      <div className="pv-categories pv-card">
        {shown.map((g) => (
          <FilterGroupEditor key={`${g.key}:${data.indexOf(g)}`} group={g} groups={data} state={state} onChange={handleChange} />
        ))}
        <div className="pv-category-footer">
          <div className="pv-category-preview">category = {category || '（未选择，进入默认列表）'}</div>
          <button
            type="button"
            className="pv-btn-primary"
            onClick={() => runWith({ action: 'list', category, page: '1', target: '' })}
          >
            应用筛选
            <ArrowRightIcon size={12} />
            跳转 list
          </button>
        </div>
      </div>
    </div>
  )
}