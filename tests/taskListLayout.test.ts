import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('list groups parent tasks with their subtasks in a responsive grid', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')
  const appCss = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(appCss, /\.main-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-page\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-content\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /\.task-list-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(css, /\.task-list-layout > \.task-details-panel\s*\{\s*display:\s*none/)
  assert.match(css, /\.task-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /\.task-row-group\s*\{[\s\S]*border:\s*1px solid var\(--color-border\)/)
  assert.match(css, /\.task-expanded-group\s*\{[\s\S]*border:\s*1px solid/)
  assert.match(tasksView, /className="task-subtask-list"/)
  assert.match(tasksView, /className="task-expanded-group"/)
  assert.match(tasksView, /expandedTaskGroupId, setExpandedTaskGroupId\] = useState<number \| null>/)
  assert.match(tasksView, /current === taskId \? null : taskId/)
  assert.match(tasksView, /tasks\.subtask_progress_summary/)
  assert.match(tasksView, /tasks\.subtask_progress_compact/)
  assert.match(tasksView, /tasks\.subtask_expand/)
  assert.match(tasksView, /className="task-row__footer"/)
  assert.match(css, /\.task-row\s*\{[\s\S]*height:\s*112px/)
  assert.match(tasksView, /getRepeatSummary\(task\)/)
  assert.match(tasksView, /<Flag size=\{13\} aria-hidden="true" \/>/)
  assert.match(css, /\.task-row\.is-completed \.task-row__priority\s*\{[\s\S]*color:\s*var\(--text-muted\)/)
  assert.match(css, /\.task-expanded-group\s*\{[\s\S]*border:\s*1px solid var\(--color-border\)/)
  assert.match(css, /\.task-row--child\s*\{[\s\S]*border-left:\s*2px solid var\(--color-border\)/)
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.task-list\s*\{[\s\S]*grid-template-columns:\s*1fr/)
})
