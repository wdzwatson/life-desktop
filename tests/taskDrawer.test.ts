import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task creation and editing use one right drawer with picker-based time and repeat controls', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /task-drawer/)
  assert.match(tasksView, /drawerMode === 'create'/)
  assert.match(tasksView, /import DatePicker(?:, \{ registerLocale \})? from 'react-datepicker'/)
  assert.match(tasksView, /showTimeInput/)
  assert.doesNotMatch(tasksView, /timeIntervals=\{5\}/)
  assert.match(tasksView, /portalId="task-drawer-datepicker-portal"/)
  assert.doesNotMatch(tasksView, /openDrawerDatePicker/)
  assert.doesNotMatch(tasksView, /onClickOutside=\{\(\) => setOpenDrawerDatePicker\(null\)\}/)
  assert.match(tasksView, /drawerStartDatePickerRef\.current\?\.setOpen\(false\)/)
  assert.match(tasksView, /drawerRuleStartDatePickerRef\.current\?\.setOpen\(true\)/)
  assert.match(tasksView, /closeDrawerDatePickersOnOutsidePointerDown/)
  assert.match(tasksView, /validation_title_required/)
  assert.match(tasksView, /task-time-window-error/)
  assert.match(tasksView, /customInput=\{/)
  assert.match(tasksView, /DatePickerInput/)
  assert.match(tasksView, /recurring_task_checkbox_label/)
  assert.match(tasksView, /handleSaveDrawer/)
  assert.match(tasksView, /requiresReview: true/)
  assert.match(tasksView, /<ViewportPortal>/)
  assert.match(tasksView, /task-rule-mode-control/)
  assert.match(tasksView, /task-rule-section__number/)
  assert.match(tasksView, /isMonthDayPickerExpanded/)
  assert.match(tasksView, /isRuleExclusionsExpanded/)
  assert.match(tasksView, /rule_instance_unchanged_note/)
})

test('task drawer keeps its actions within the visible viewport', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')

  assert.match(css, /\.task-drawer\s*\{[\s\S]*height:\s*100dvh/)
  assert.match(css, /\.task-drawer__body\s*\{[\s\S]*overscroll-behavior:\s*contain/)
  assert.match(css, /\.task-drawer__rule-panel\s*\{[\s\S]*flex:\s*0 0 auto/)
  assert.match(css, /\.task-drawer__footer\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/)
})
