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
