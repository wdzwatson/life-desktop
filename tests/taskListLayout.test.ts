import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list groups parent tasks with their subtasks in a scannable responsive flow', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  const appCss = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(appCss, /\.main-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-page\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-content\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-list-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-list-layout > \.task-details-panel\s*\{\s*display:\s*none/)
  assert.match(css, /\.task-list\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-row-group\s*\{[\s\S]*border:\s*1px solid var\(--color-border\)/)
  assert.match(css, /\.task-expanded-group\s*\{[\s\S]*border:\s*1px solid/)
  assert.match(tasksView, /className="task-subtask-list"/)
  assert.match(tasksView, /className="task-expanded-group"/)
  assert.match(
    tasksView,
    /expandedTaskGroupId, setExpandedTaskGroupId\] = useState<number \| null>/,
  )
  assert.match(tasksView, /current === taskId \? null : taskId/)
  assert.match(tasksView, /tasks\.subtask_progress_summary/)
  assert.match(tasksView, /tasks\.subtask_progress_compact/)
  assert.match(tasksView, /tasks\.subtask_expand/)
  assert.match(tasksView, /className="task-row__footer"/)
  assert.match(css, /\.task-row\s*\{[\s\S]*grid-template-areas:\s*'check main'\s*'footer footer'/)
  assert.match(css, /\.task-row\s*\{[\s\S]*min-height:\s*92px/)
  assert.match(css, /\.task-row__title\s*\{[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /\.task-row__title\s*\{[\s\S]*-webkit-line-clamp:\s*2/)
  assert.match(tasksView, /className="task-row__status" data-status=\{task\.status\}/)
  assert.match(css, /\.task-row__status\s*\{[\s\S]*flex:\s*0 0 auto/)
  assert.match(tasksView, /className=\{`task-row__priority-badge is-\$\{task\.priority\}`\}/)
  assert.match(tasksView, /className="task-row__lead"/)
  assert.match(tasksView, /getPriorityBadgeLabel\(task\.priority\)/)
  assert.match(tasksView, /className="task-row__deadline"/)
  assert.match(tasksView, /<Hourglass size=\{13\} aria-hidden="true" \/>/)
  assert.match(tasksView, /const formatCompactDue =/)
  assert.doesNotMatch(tasksView, /task-row__instance-schedule/)
  assert.match(tasksView, /getRepeatSummary\(task\)/)
  assert.match(tasksView, /className="task-row__recurrence"/)
  assert.match(tasksView, /getRuleScheduleSummary\(rule\)/)
  assert.match(tasksView, /getRuleTimesSummary\(rule\)/)
  assert.match(tasksView, /getRuleRangeSummary\(rule\)/)
  assert.match(tasksView, /rule\.frequency === 'custom'/)
  assert.match(tasksView, /task\.start_time \|\| task\.occurrence_time \|\| instanceTime/)
  assert.match(tasksView, /const statusOrder: Record<string, number> =/)
  assert.match(tasksView, /已逾期: 0/)
  assert.match(tasksView, /待审核: 1/)
  assert.match(
    tasksView,
    /const priorityOrder: Record<string, number> = \{ high: 0, mid: 1, low: 2 \}/,
  )
  assert.match(tasksView, /leftDueAt\.localeCompare\(rightDueAt\)/)
  assert.match(tasksView, /<Flag size=\{13\} aria-hidden="true" \/>/)
  assert.match(css, /\.task-row__lead\s*\{[\s\S]*flex-direction:\s*column[\s\S]*gap:\s*5px/)
  assert.match(css, /\.task-row__priority-badge\s*\{[\s\S]*width:\s*22px[\s\S]*height:\s*16px/)
  assert.doesNotMatch(css, /\.task-row__priority-badge\s*\{[^}]*position:\s*absolute/)
  assert.match(
    css,
    /\.task-row__heading\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
  )
  assert.match(tasksView, /className="task-row__recurrence-schedule"/)
  assert.match(tasksView, /className="task-row__recurrence-details"/)
  assert.doesNotMatch(tasksView, /className="task-row__context"/)
  assert.match(css, /\.task-row\.is-todo\s*\{[\s\S]*background-color:/)
  assert.match(css, /\.task-row\.is-in-progress\s*\{[\s\S]*background-color:/)
  assert.match(css, /\.task-row\.is-review\s*\{[\s\S]*background-color:/)
  assert.match(css, /\.task-row\.is-closed\s*\{[\s\S]*var\(--text-muted\) 8%/)
  assert.match(css, /\.task-expanded-group\s*\{[\s\S]*border:\s*1px solid var\(--color-border\)/)
  assert.match(css, /\.task-expanded-group\s*\{[\s\S]*margin:\s*0 8px 8px/)
  assert.match(css, /\.task-row-group > \.task-row\s*\{[\s\S]*height:\s*92px/)
  assert.match(css, /\.task-row--child\s*\{[\s\S]*border-left:\s*2px solid var\(--color-border\)/)
  assert.match(
    css,
    /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.task-list\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  )
})

test('list hover and keyboard focus use distinct visual treatments', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')

  assert.match(css, /\.task-row:hover\s*\{[^}]*transform:\s*translateX\(2px\)/)
  assert.match(css, /\.task-row:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  assert.doesNotMatch(css, /\.task-row:focus-visible\s*\{[^}]*transform:/)
})

test('expanding subtasks brings the detail panel into focus', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /expandedSubtaskPanelRef/)
  assert.match(tasksView, /panel\.scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/)
  assert.match(tasksView, /panel\.focus\(\{ preventScroll: true \}\)/)
  assert.match(tasksView, /ref=\{expandedSubtaskPanelRef\}/)
  assert.match(tasksView, /tabIndex=\{-1\}/)
})
