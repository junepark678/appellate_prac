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

import type { FilingEvent } from '../../domain/types'
import type { FilingEventModule, FilingFieldDefinition } from '../types'

const commonRequiredFields: FilingFieldDefinition[] = [
  { id: 'title', label: 'Filing title', type: 'text', required: true },
  { id: 'certificateOfService', label: 'Certificate of service', type: 'boolean', required: true },
  { id: 'sealed', label: 'Filed under seal', type: 'boolean', required: true },
  { id: 'notes', label: 'Filing notes', type: 'textarea', required: false },
]

export function filingEventModuleFromEvent(event: FilingEvent): FilingEventModule {
  return {
    id: event.id,
    label: event.label,
    category: event.domain,
    allowedRoles: event.allowedParticipantRoles,
    requiredDocuments: event.requiredDocuments,
    optionalDocuments: event.optionalDocuments,
    requiredFields: event.id.includes('brief')
      ? [
          ...commonRequiredFields,
          {
            id: 'certificateOfCompliance',
            label: 'Certificate of compliance',
            type: 'boolean',
            required: true,
          },
        ]
      : commonRequiredFields,
    constraints: event.validationRuleRefs.map((ruleRef) => ruleRef.ruleId),
    receiptTemplateId: `${event.id}:receipt`,
    docketTemplateId: `${event.id}:docket`,
    event,
  }
}
