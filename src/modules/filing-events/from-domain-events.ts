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
