import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getDueTemplateOccurrence,
  getDueTemplateOccurrences,
  getNextTemplateOccurrences,
  getTemplateStartTime,
  toLocalDateKey,
} from '../src/views/taskScheduleUtils'

test('task template occurrence waits until local start time', () => {
  const rule = {
    id: 1,
    title: 'Morning review',
    frequency: 'daily',
    interval: 1,
    start_date: '2026-07-21',
    start_time: '09:00',
  }

  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 21, 8, 59)), null)
  assert.deepEqual(getDueTemplateOccurrence(rule, new Date(2026, 6, 21, 9, 0)), {
    dateKey: '2026-07-21',
    time: '09:00',
    instanceKey: '2026-07-21T09:00',
  })
})

test('scheduler can create the daily task at the beginning of its scheduled date', () => {
  const occurrence = getDueTemplateOccurrence(
    {
      id: 1,
      title: 'Morning review',
      frequency: 'daily',
      start_date: '2026-07-21',
      start_time: '09:00',
    },
    new Date(2026, 6, 22, 0, 1),
    { ignoreStartTime: true },
  )

  assert.equal(occurrence?.instanceKey, '2026-07-22T09:00')
})

test('one-time templates only occur on the configured start date before triggering', () => {
  assert.deepEqual(
    getDueTemplateOccurrence(
      {
        id: 1,
        title: 'Submit form',
        frequency: 'custom',
        start_date: '2026-07-21',
        start_time: '10:30',
      },
      new Date(2026, 6, 21, 10, 31),
    ),
    {
      dateKey: '2026-07-21',
      time: '10:30',
      instanceKey: '2026-07-21T10:30',
    },
  )
  assert.equal(
    getDueTemplateOccurrence(
      {
        id: 1,
        title: 'Submit form',
        frequency: 'custom',
        start_date: '2026-07-21',
        start_time: '10:30',
        last_trigger_time: '2026-07-21T10:31:00.000Z',
      },
      new Date(2026, 6, 21, 10, 32),
    ),
    null,
  )
})

test('weekly templates honor selected visual weekdays and interval', () => {
  const rule = {
    id: 1,
    title: 'Weekly planning',
    frequency: 'weekly',
    interval: 2,
    week_days: '2',
    start_date: '2026-07-06',
    start_time: '09:00',
  }

  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 7, 9, 0))?.dateKey, '2026-07-07')
  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 14, 9, 0)), null)
  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 21, 9, 0))?.dateKey, '2026-07-21')
})

test('weekday templates honor the configured working-day interval', () => {
  const rule = {
    id: 1,
    title: 'Every other workday',
    frequency: 'weekday',
    interval: 2,
    start_date: '2026-07-20',
    start_time: '09:00',
  }

  assert.ok(getDueTemplateOccurrence(rule, new Date(2026, 6, 20, 9, 0)))
  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 21, 9, 0)), null)
  assert.ok(getDueTemplateOccurrence(rule, new Date(2026, 6, 22, 9, 0)))
  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 25, 9, 0)), null)
})

test('weekday intervals start from the first weekday after a weekend start date', () => {
  const rule = {
    id: 1,
    title: 'Every other workday',
    frequency: 'weekday',
    interval: 2,
    start_date: '2026-07-18',
    start_time: '09:00',
  }

  assert.ok(getDueTemplateOccurrence(rule, new Date(2026, 6, 20, 9, 0)))
  assert.equal(getDueTemplateOccurrence(rule, new Date(2026, 6, 21, 9, 0)), null)
})

test('monthly templates can target the last day of month', () => {
  const occurrence = getDueTemplateOccurrence(
    {
      id: 1,
      title: 'Month end',
      frequency: 'monthly',
      interval: 1,
      month_days: '-1',
      start_date: '2026-07-01',
      start_time: '18:00',
    },
    new Date(2026, 6, 31, 18, 0),
  )

  assert.equal(occurrence?.instanceKey, '2026-07-31T18:00')
})

test('next template occurrences are future local instances', () => {
  const occurrences = getNextTemplateOccurrences(
    {
      id: 1,
      title: 'Every other day',
      frequency: 'daily',
      interval: 2,
      start_date: '2026-07-21',
      start_time: '08:00',
    },
    new Date(2026, 6, 21, 9, 0),
    3,
  )

  assert.deepEqual(
    occurrences.map((item) => item.instanceKey),
    ['2026-07-23T08:00', '2026-07-25T08:00', '2026-07-27T08:00'],
  )
})

test('multi-time templates create one occurrence for each configured time', () => {
  const occurrences = getDueTemplateOccurrences(
    {
      id: 1,
      title: 'Daily check-in',
      frequency: 'daily',
      start_date: '2026-07-21',
      start_time: '09:00',
      time_slots: '09:00,13:00,18:00',
    },
    new Date(2026, 6, 22, 8, 0),
    { ignoreStartTime: true },
  )

  assert.deepEqual(
    occurrences.map((item) => item.instanceKey),
    ['2026-07-22T09:00', '2026-07-22T13:00', '2026-07-22T18:00'],
  )
})

test('template date and time helpers normalize invalid values', () => {
  assert.equal(toLocalDateKey(new Date(2026, 6, 21)), '2026-07-21')
  assert.equal(getTemplateStartTime({ id: 1, title: 'Bad time', start_time: '99:99' }), '09:00')
})
