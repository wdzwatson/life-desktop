import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task creation and editing use one right drawer with picker-based time and repeat controls', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /task-drawer/)
  assert.match(tasksView, /drawerMode === 'create'/)
  assert.match(
    tasksView,
    /import ReactDatePicker(?:, \{ registerLocale \})? from 'react-datepicker'/,
  )
  assert.match(tasksView, /DateTimePicker/)
  assert.match(tasksView, /TimePicker/)
  assert.match(tasksView, /portalId="task-drawer-datepicker-portal"/)
  assert.doesNotMatch(tasksView, /openDrawerDatePicker/)
  assert.doesNotMatch(tasksView, /onClickOutside=\{\(\) => setOpenDrawerDatePicker\(null\)\}/)
  assert.match(tasksView, /drawerStartDatePickerRef\.current\?\.setOpen\(false\)/)
  assert.match(tasksView, /drawerRuleStartDatePickerRef\.current\?\.setOpen\(true\)/)
  assert.match(tasksView, /closeDrawerDatePickersOnOutsidePointerDown/)
  assert.match(tasksView, /validation_title_required/)
  assert.match(tasksView, /task-time-window-error/)
  assert.match(tasksView, /recurring_task_checkbox_label/)
  assert.match(tasksView, /handleSaveDrawer/)
  assert.match(tasksView, /requiresReview: false/)
  assert.match(tasksView, /btn_create_task/)
  assert.match(tasksView, /<ViewportPortal>/)
  assert.match(tasksView, /task-rule-mode-control/)
  assert.match(tasksView, /task-rule-section__number/)
  assert.match(tasksView, /isMonthDayPickerExpanded/)
  assert.match(tasksView, /isRuleExclusionsExpanded/)
  assert.match(tasksView, /rule_instance_unchanged_note/)
  assert.match(tasksView, /rule_section_schedule/)
  assert.match(tasksView, /rule_section_frequency/)
  assert.match(tasksView, /rule_section_range/)
  assert.match(tasksView, /time_slots/)
  assert.match(tasksView, /recurring_rule_steps/)
})

test('recurring tasks use generation dates and a fixed per-instance deadline', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /taskDraft\.repeat === 'none' && \(/)
  assert.match(tasksView, /rule_section_deadline/)
  assert.match(tasksView, /rule_instance_deadline_summary/)
  assert.match(tasksView, /rule_instance_deadline_hint/)
  assert.match(tasksView, /ruleEndDate && ruleEndDate < ruleStartDate/)
  assert.match(tasksView, /validation_rule_end_date_before_start/)
  assert.match(tasksView, /task-drawer__schedule-section[\s\S]*quick_add_priority_label/)
  assert.match(tasksView, /due_time = '23:59:59'/)
})

test('task drawer keeps its actions within the visible viewport', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.css'), 'utf8')

  assert.match(css, /\.task-drawer\s*\{[\s\S]*height:\s*100dvh/)
  assert.match(css, /\.task-drawer__body\s*\{[\s\S]*overscroll-behavior:\s*contain/)
  assert.match(css, /\.task-drawer__rule-panel\s*\{[\s\S]*flex:\s*0 0 auto/)
  assert.match(css, /\.task-drawer__footer\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/)
})
