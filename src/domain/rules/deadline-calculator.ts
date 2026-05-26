import type { DeadlineRule } from '../types'
import { ca4DeadlineRules } from './ca4-source-profile'

export type HolidayCalendar = {
  id: string
  holidays: string[]
}

export const usFederal2026HolidayCalendar: HolidayCalendar = {
  id: 'us_federal_2026',
  holidays: [
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-10-12',
    '2026-11-11',
    '2026-11-26',
    '2026-12-25',
  ],
}

const holidayCalendars: Record<string, HolidayCalendar> = {
  [usFederal2026HolidayCalendar.id]: usFederal2026HolidayCalendar,
}

function utcDateOnly(dateIso: string) {
  return dateIso.slice(0, 10)
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(Date.UTC(year, monthIndex, 1))
  const offset = (weekday - date.getUTCDay() + 7) % 7
  date.setUTCDate(1 + offset + (nth - 1) * 7)
  return utcDateOnly(date.toISOString())
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0))
  const offset = (date.getUTCDay() - weekday + 7) % 7
  date.setUTCDate(date.getUTCDate() - offset)
  return utcDateOnly(date.toISOString())
}

function observedFixedHoliday(year: number, monthIndex: number, day: number) {
  const date = new Date(Date.UTC(year, monthIndex, day))
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1)
  return utcDateOnly(date.toISOString())
}

function federalHolidaysForYear(year: number) {
  return [
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 9, 1, 2),
    observedFixedHoliday(year, 10, 11),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]
}

function plusDays(dateIso: string, days: number) {
  const date = new Date(dateIso)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

function isWeekend(date: Date) {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function isHoliday(date: Date, holidayCalendarId: string) {
  if (holidayCalendarId.startsWith('us_federal')) {
    return federalHolidaysForYear(date.getUTCFullYear()).includes(
      utcDateOnly(date.toISOString()),
    )
  }
  const holidays = holidayCalendars[holidayCalendarId]?.holidays ?? []
  return holidays.includes(utcDateOnly(date.toISOString()))
}

function carryForward(date: Date, holidayCalendarId: string) {
  const next = new Date(date)
  while (isWeekend(next) || isHoliday(next, holidayCalendarId)) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

function addBusinessDays(startIso: string, days: number, holidayCalendarId: string) {
  const date = new Date(startIso)
  let remaining = days
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (!isWeekend(date) && !isHoliday(date, holidayCalendarId)) {
      remaining -= 1
    }
  }
  return date
}

export function calculateDeadlineDueDate(
  triggerDateIso: string,
  rule: DeadlineRule,
): string {
  const rawDueDate =
    rule.unit === 'business_day'
      ? addBusinessDays(triggerDateIso, rule.offset, rule.holidayCalendarId)
      : plusDays(triggerDateIso, rule.offset)
  const finalDueDate =
    rule.businessDayRule === 'carry_forward'
      ? carryForward(rawDueDate, rule.holidayCalendarId)
      : rawDueDate
  return finalDueDate.toISOString()
}

export function deadlineRuleForTrigger(triggerEventId: string, targetEventId?: string) {
  return ca4DeadlineRules.find(
    (rule) =>
      rule.triggerEventId === triggerEventId &&
      (!targetEventId || rule.targetEventId === targetEventId),
  )
}

export function calculateDeadlineForTrigger(
  triggerDateIso: string,
  triggerEventId: string,
  targetEventId?: string,
) {
  const rule = deadlineRuleForTrigger(triggerEventId, targetEventId)
  return rule
    ? {
        rule,
        dueDate: calculateDeadlineDueDate(triggerDateIso, rule),
      }
    : null
}
