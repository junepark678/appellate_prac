/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Convex transactions have a 16 MiB read limit. Reserve 4 MiB for linked
// session state and cap stored document analysis rows at the remaining 12 MiB.
export const maxSessionDocumentAnalysisReadBytes = 12 * 1024 * 1024

export function fitsSessionDocumentAnalysisReadBudget(readBytes: number) {
  return (
    Number.isSafeInteger(readBytes) &&
    readBytes >= 0 &&
    readBytes <= maxSessionDocumentAnalysisReadBytes
  )
}
