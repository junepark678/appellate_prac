# Fourth Circuit Expansion Rule/Event Copy Handoff

Scope: concise source-backed language for new Fourth Circuit criminal appeal, agency review, original writ, and Local Rule 31 briefing handling. Naming follows existing `ruleRefs` camelCase keys, all-caps `ruleId`, snake_case filing event IDs, and short user-facing labels already used in `src/domain/packs.ts` and `src/domain/filing/ca4-ecf-catalog.ts`.

## Proposed ruleRef keys and labels

| key | ruleId | label | sourceUrl |
| --- | --- | --- | --- |
| `frap4b` | `FRAP_4_B` | `Fed. R. App. P. 4(b)` | `https://www.ca4.uscourts.gov/docs/rules/rule04.pdf?sfvrsn=61cd152e_8` |
| `frap9` | `FRAP_9` | `Fed. R. App. P. 9` | `https://www.ca4.uscourts.gov/docs/rules/rule09.pdf?sfvrsn=1f95ca2d_3` |
| `ca4Local9` | `CA4_LR_9` | `4th Cir. Loc. R. 9` | `https://www.ca4.uscourts.gov/docs/rules/rule09.pdf?sfvrsn=1f95ca2d_3` |
| `frap15` | `FRAP_15` | `Fed. R. App. P. 15` | `https://www.ca4.uscourts.gov/docs/rules/rule15.pdf?sfvrsn=5b23a8e_6` |
| `frap15_1` | `FRAP_15_1` | `Fed. R. App. P. 15.1` | `https://www.ca4.uscourts.gov/docs/rules/rule15_1.pdf?sfvrsn=5800c8ba_2` |
| `frap16` | `FRAP_16` | `Fed. R. App. P. 16` | `https://www.ca4.uscourts.gov/docs/rules/rule16.pdf?sfvrsn=c4208aed_2` |
| `frap17` | `FRAP_17` | `Fed. R. App. P. 17` | `https://www.ca4.uscourts.gov/docs/rules/rule17.pdf?sfvrsn=2cfa7134_2` |
| `frap18` | `FRAP_18` | `Fed. R. App. P. 18` | `https://www.ca4.uscourts.gov/docs/rules/rule18.pdf?sfvrsn=bd4ba333_2` |
| `ca4Local18` | `CA4_LR_18` | `4th Cir. Loc. R. 18` | `https://www.ca4.uscourts.gov/docs/rules/rule18.pdf?sfvrsn=bd4ba333_2` |
| `frap19` | `FRAP_19` | `Fed. R. App. P. 19` | `https://www.ca4.uscourts.gov/docs/rules/rule19.pdf?sfvrsn=36742a6d_2` |
| `frap20` | `FRAP_20` | `Fed. R. App. P. 20` | `https://www.ca4.uscourts.gov/docs/rules/rule20.pdf?sfvrsn=1a84ce20_2` |
| `frap21` | `FRAP_21` | `Fed. R. App. P. 21` | `https://www.ca4.uscourts.gov/docs/rules/rule21.pdf?sfvrsn=e649f65c_10` |
| `ca4Local21` | `CA4_LR_21` | `4th Cir. Loc. R. 21` | `https://www.ca4.uscourts.gov/docs/rules/rule21.pdf?sfvrsn=e649f65c_10` |

Keep existing `frap31` and `ca4Local31`; add a criminal-specific deadline set rather than a separate `RuleRef`.

## Proposed RuleItem snippets

### Criminal appeal

- `FRAP_4_B`
  - topic: `criminal_notice_deadline`
  - plainText: `In a criminal case, a defendant's notice of appeal is generally due in the district court within 14 days after entry of the judgment or order appealed from, or after the government's notice of appeal; a government notice is generally due within 30 days.`
  - structuredConstraints: `deadline: criminal notice of appeal deadline`, `event_sequence: opens criminal appeal`
  - simulatorNotes: `Use a 14-day defendant notice deadline, a 30-day government notice deadline, and a 30-day excusable-neglect/good-cause extension window for training scenarios.`

- `FRAP_9`
  - topic: `criminal_release`
  - plainText: `Release or detention review in a criminal case requires the district-court order and reasons; factual challenges require the release transcript or an explanation why it was not obtained.`
  - structuredConstraints: `required_document: release order and reasons`, `required_document: transcript or no-transcript explanation`
  - simulatorNotes: `Release papers may proceed by appeal or by motion after a conviction appeal is pending; the clerk can refer the matter promptly without ordinary merits briefing.`

- `CA4_LR_9`
  - topic: `criminal_release_local_handling`
  - plainText: `Fourth Circuit local release practice gives prompt consideration to release appeals and motions, usually on the submitted materials and without oral argument.`
  - structuredConstraints: `event_sequence: prompt release review`, `certificate: disclosure for corporate defendants`
  - simulatorNotes: `A renewed post-conviction release motion should include the district court's statement of reasons and be submitted to a three-judge panel.`

### Agency review

- `FRAP_15`
  - topic: `agency_petition_review`
  - plainText: `Agency review is commenced by filing a petition for review in the court of appeals; the petition must name each party seeking review, name the agency as respondent, and specify the order or part to be reviewed.`
  - structuredConstraints: `required_document: petition for review`, `service: agency proceeding parties`, `fee_or_ifp: petition filing fee`
  - simulatorNotes: `The validator should reject generic "et al." petitioner naming, missing agency respondent, missing agency order, missing service list, or missing fee/IFP signal.`

- `FRAP_15_1`
  - topic: `nlrb_briefing_sequence`
  - plainText: `In NLRB review or enforcement proceedings, the party adverse to the Board proceeds first on briefing and oral argument unless the court orders otherwise.`
  - structuredConstraints: `event_sequence: adverse party proceeds first`
  - simulatorNotes: `Use only when the scenario marks the agency as NLRB.`

- `FRAP_16`
  - topic: `agency_record`
  - plainText: `The agency record consists of the order, findings or report, and the pleadings, evidence, and other agency proceedings materials; omissions or misstatements may be corrected by stipulation or court direction.`
  - structuredConstraints: `required_document: agency record or certified list`, `event_sequence: supplemental record correction`
  - simulatorNotes: `Record defects can generate a supplemental-record or correction event instead of a merits-brief rejection.`

- `FRAP_17`
  - topic: `agency_record_filing`
  - plainText: `The agency must file the record or certified list within 40 days after service of a petition for review unless a statute or court order sets a different time; the clerk notifies parties when the record is filed.`
  - structuredConstraints: `deadline: agency record due`, `event_sequence: clerk record notice`
  - simulatorNotes: `Agency record filing should trigger the Local Rule 31 briefing-schedule path.`

- `FRAP_18` / `CA4_LR_18`
  - topic: `agency_stay_pending_review`
  - plainText: `A petitioner ordinarily moves first before the agency for a stay; a court of appeals stay motion must show agency-first impracticability or describe agency denial or inaction, with supporting reasons, facts, sworn materials, relevant record parts, and reasonable notice.`
  - structuredConstraints: `required_document: stay pending review motion`, `event_sequence: agency-first stay signal`, `service: reasonable notice`
  - simulatorNotes: `Fourth Circuit Local Rule 18 applies the local stay and motion procedures accompanying FRAP 8 and 27.`

- `FRAP_19`
  - topic: `agency_partial_enforcement_judgment`
  - plainText: `After an opinion enforcing an agency order in part, the agency files a proposed conforming judgment within 14 days; a disagreeing party files its proposed judgment within 10 days.`
  - structuredConstraints: `deadline: proposed agency judgment`, `event_sequence: court settles judgment`
  - simulatorNotes: `Unlock this only after a panel disposition enforcing an agency order in part.`

- `FRAP_20`
  - topic: `agency_rule_applicability`
  - plainText: `Most appellate rules apply to review or enforcement of agency orders; "appellant" includes petitioner or applicant and "appellee" includes respondent.`
  - structuredConstraints: `event_sequence: agency role mapping`
  - simulatorNotes: `Use this as a source-backed role mapping for agency review labels and deadlines.`

### Original writ

- `FRAP_21`
  - topic: `original_writ`
  - plainText: `A mandamus or prohibition petition directed to a court is filed with the circuit clerk, served on all trial-court parties, copied to the trial judge, titled "In re [petitioner]," and must state relief sought, issues, necessary facts, reasons for the writ, and include essential orders or record parts.`
  - structuredConstraints: `required_document: original writ petition`, `service: all trial-court parties and trial judge copy`, `fee_or_ifp: docket fee or IFP`
  - simulatorNotes: `The clerk dockets the petition on fee/IFP compliance, submits it to the court, and the court may deny without answer or direct an answer by fixed date.`

- `CA4_LR_21`
  - topic: `original_writ_local_handling`
  - plainText: `Fourth Circuit local practice requires strict FRAP 21 compliance, the prescribed docket fee or proper IFP/PLRA papers, disclosure statements with the petition and answer, and panel submission after docketing.`
  - structuredConstraints: `certificate: disclosure statement`, `fee_or_ifp: writ docket fee or local IFP/PLRA forms`, `event_sequence: panel submission`
  - simulatorNotes: `For prisoner civil-matter writs require PLRA application, trust account statement, and consent-to-collection form; for criminal-matter prisoner writs allow standard IFP application.`

### Local Rule 31

- `CA4_LR_31`
  - topic: `briefing_deadlines`
  - plainText: `A formal briefing schedule controls joint-appendix designation and brief filing. It issues when the record is received or the Clerk determines the record is complete.`
  - structuredConstraints: `deadline: local briefing schedule handling`, `event_sequence: briefing order controls`
  - simulatorNotes: `Civil/agency schedules use the existing 40/30/21 day sequence unless the order states otherwise; criminal schedules use 35/21/10 days from the briefing order/opening brief/appellee brief sequence.`

## Proposed filing events

| eventId | label | domain | menu path | required documents / metadata | ruleRefs |
| --- | --- | --- | --- | --- | --- |
| `criminal_notice_of_appeal` | `Criminal Notice of Appeal` | `criminal_appeal` | `Case Opening > Notice of Appeal` or `Forms, Notices & Filing Fees > Notice of Appeal` | Notice of appeal PDF; fee/IFP status if modeled; certificate of service if filed in CA4 by mistake | `frap4b` |
| `criminal_docketing_statement` | `Docketing Statement (Criminal)` | `criminal_appeal` | `Forms, Notices & Filing Fees > Docketing statement (criminal)` | Docketing statement PDF; filing attorney; represented party; certificate of service | `frap4b`, `ca4Local31` |
| `motion_release_pending_appeal` | `Motion for Release Pending Appeal` | `criminal_appeal` | `Motions, Responses & Replies > MOTION > Release pending appeal` | Motion PDF; district-court release/detention order; statement of reasons; transcript or no-transcript explanation where factual basis is challenged; related entry if conviction appeal already pending | `frap9`, `ca4Local9`, `frap27` |
| `criminal_opening_brief` | `Opening Brief (Criminal)` | `criminal_appeal` | `Briefing Documents > BRIEF (formal briefs not under seal)` | Opening brief PDF; appendix PDF or linked appendix; certificate of service; certificate of compliance | `frap31`, `ca4Local31` |
| `criminal_appellee_brief` | `Appellee Brief (Criminal)` | `criminal_appeal` | `Briefing Documents > BRIEF (formal briefs not under seal)` | Appellee brief PDF; certificate of service; certificate of compliance | `frap31`, `ca4Local31` |
| `criminal_reply_brief` | `Reply Brief (Criminal)` | `criminal_appeal` | `Briefing Documents > BRIEF (formal briefs not under seal)` | Reply brief PDF; certificate of service; certificate of compliance | `frap31`, `ca4Local31` |
| `agency_petition_for_review` | `Petition for Review` | `agency_review` | `Forms, Notices & Filing Fees > Petition for review` | Petition PDF naming each petitioner, agency respondent, order under review; service list; filing fee or IFP signal | `frap15` |
| `agency_application_enforcement` | `Application to Enforce Agency Order` | `agency_review` | `Forms, Notices & Filing Fees > Application for enforcement` | Application PDF with proceedings, venue facts, relief requested; service list | `frap15` |
| `agency_cross_application_enforcement` | `Cross-Application to Enforce Agency Order` | `agency_review` | `Forms, Notices & Filing Fees > Application for enforcement` | Cross-application PDF; related petition; relief requested; certificate/service list | `frap15` |
| `agency_motion_intervene` | `Motion for Leave to Intervene` | `agency_review` | `Motions, Responses & Replies > MOTION > Intervene` | Motion PDF with concise interest and grounds; certificate of service; within 30 days after petition unless statute differs | `frap15`, `frap27` |
| `agency_record` | `Administrative Record` | `agency_review` | `Briefing Documents > Administrative record (electronic form)` | Original/certified record or designated parts; filed by agency | `frap16`, `frap17` |
| `agency_certified_list` | `Certified List in Lieu of Agency Record` | `agency_review` | `Briefing Documents > Certified list in lieu of agency record` | Certified list describing documents, transcripts, exhibits, and other record materials | `frap17` |
| `agency_record_stipulation` | `Stipulation That No Record Will Be Filed` | `agency_review` | `Motions, Responses & Replies > Consent/stipulation` | Written stipulation; certificate of service | `frap17` |
| `agency_motion_stay_pending_review` | `Motion to Stay Pending Review` | `agency_review` | `Motions, Responses & Replies > MOTION > Stay pending review` | Motion PDF; agency-first statement or impracticability showing; reasons/facts; affidavits/sworn statements for disputed facts; relevant record parts; notice certificate | `frap18`, `ca4Local18`, `frap27` |
| `agency_proposed_judgment` | `Proposed FRAP 19 Judgment` | `agency_review` | `Judgments > Proposed revision to FRAP 19 proposed judgment` | Proposed conforming judgment PDF; related disposition | `frap19` |
| `original_writ_petition` | `Petition for Writ of Mandamus or Prohibition` | `original_writ` | `Forms, Notices & Filing Fees > Petition for writ of mandamus/prohibition` | Petition PDF; essential order/record appendix; disclosure statement; fee/IFP/PLRA papers; service on all parties; copy to trial judge | `frap21`, `ca4Local21`, `frap26_1`, `ca4Local26_1` |
| `original_writ_answer` | `Answer to Writ Petition` | `original_writ` | `Motions, Responses & Replies > RESPONSE/ANSWER (to motion or request)` | Answer PDF; related writ petition; disclosure statement; certificate of service | `frap21`, `ca4Local21` |
| `original_writ_emergency_motion` | `Emergency Motion Pending Writ Petition` | `original_writ` | `Motions, Responses & Replies > MOTION > Emergency relief` | Motion PDF; relief requested; related writ petition; certificate of service | `frap21`, `ca4Local21`, `frap27` |
| `crime_victim_mandamus_petition` | `Crime Victims' Rights Mandamus Petition` | `original_writ` | `Forms, Notices & Filing Fees > Petition for writ of mandamus/prohibition` | Petition captioned for 18 U.S.C. 3771; immediate service statement; clerk-notification metadata | `frap21`, `ca4Local21` |

CA4 ECF page source-backed labels observed: `Docketing statement (criminal)`, `Docketing statement (civil/agency)`, `Administrative record (electronic form)`, `Certified list in lieu of agency record`, `Pay petition for review filing fee`, `RESPONSE/ANSWER (to motion or request)`, `Proposed revision to FRAP 19 proposed judgment`, `BRIEF (formal briefs not under seal)`, and `SEALED DOCUMENT (court access only)`.

## Proposed docket templates, clerk responses, and cure text

### Criminal appeal

- `criminal_notice_of_appeal`
  - docketTextTemplate: `Criminal notice of appeal filed by {participant}. Criminal appeal opened.`
  - possibleClerkResponses: `Case opened`, `Notice docketed with timeliness issue`, `Notice transmitted to district court if mistakenly filed in court of appeals`
  - cureSuggestion: `Confirm the notice was filed in the district court within the FRAP 4(b) period or identify excusable-neglect/good-cause extension posture.`

- `motion_release_pending_appeal`
  - docketTextTemplate: `Motion for release pending appeal filed by {participant}: {title}.`
  - possibleClerkResponses: `Referred for prompt panel consideration`, `Response requested`, `Release papers deficient`
  - cureSuggestion: `Attach the district-court release order and statement of reasons; add the release-hearing transcript or explain why no transcript was obtained.`

- `criminal_opening_brief`
  - docketTextTemplate: `Criminal opening brief and appendix filed by {participant}.`
  - possibleClerkResponses: `Brief accepted`, `Deficiency notice issued`, `Late brief default risk noted`
  - cureSuggestion: `File the criminal opening brief and appendix within 35 days after the briefing order or seek an extension showing extraordinary circumstances.`

- `criminal_appellee_brief`
  - docketTextTemplate: `Criminal appellee brief filed by {participant}.`
  - possibleClerkResponses: `Brief accepted`, `Deficiency notice issued`
  - cureSuggestion: `Wait for service of the appellant's criminal brief and file within the 21-day criminal briefing period unless the briefing order states otherwise.`

- `criminal_reply_brief`
  - docketTextTemplate: `Criminal reply brief filed by {participant}.`
  - possibleClerkResponses: `Brief accepted`, `Submitted to panel`
  - cureSuggestion: `Wait for service of the appellee brief and file within the 10-day criminal reply period unless the briefing order states otherwise.`

### Agency review

- `agency_petition_for_review`
  - docketTextTemplate: `Petition for review filed by {participant} against {agency}.`
  - possibleClerkResponses: `Agency proceeding opened`, `Service/list deficiency noted`, `Filing fee issue noted`
  - cureSuggestion: `Name each petitioner, name the agency respondent, identify the agency order or part under review, provide the service list, and resolve fee/IFP status.`

- `agency_application_enforcement`
  - docketTextTemplate: `Application to enforce agency order filed by {participant}.`
  - possibleClerkResponses: `Answer deadline set`, `Application deficiency noted`
  - cureSuggestion: `Include the agency proceedings statement, venue facts, and relief requested.`

- `agency_motion_intervene`
  - docketTextTemplate: `Motion for leave to intervene filed by {participant}: {title}.`
  - possibleClerkResponses: `Motion referred to panel`, `Intervention timeliness issue noted`
  - cureSuggestion: `File within 30 days after the petition for review or identify the statute authorizing a different intervention method.`

- `agency_record`
  - docketTextTemplate: `Administrative record filed by {agency}.`
  - possibleClerkResponses: `Record filed; briefing schedule to issue`, `Record deficiency noted`
  - cureSuggestion: `File the agency order, findings/report, and agency proceedings materials, or use the certified-list event if filing a certified list in lieu of the full record.`

- `agency_certified_list`
  - docketTextTemplate: `Certified list in lieu of agency record filed by {agency}.`
  - possibleClerkResponses: `Certified list filed; briefing schedule to issue`, `Certified list deficiency noted`
  - cureSuggestion: `Provide a certified list that adequately describes the documents, testimony transcripts, exhibits, and other materials constituting the record.`

- `agency_motion_stay_pending_review`
  - docketTextTemplate: `Motion to stay pending review filed by {participant}: {title}.`
  - possibleClerkResponses: `Emergency motion referred to panel`, `Response requested`, `Agency-first deficiency noted`
  - cureSuggestion: `State that a stay was first sought from the agency and was denied or not acted on, or show why agency-first relief was impracticable; attach supporting sworn materials and relevant record parts.`

- `agency_proposed_judgment`
  - docketTextTemplate: `Proposed FRAP 19 judgment filed by {participant}.`
  - possibleClerkResponses: `Proposed judgment lodged`, `Competing proposed judgment deadline set`
  - cureSuggestion: `Use this event only after an opinion enforcing an agency order in part and relate the filing to that disposition.`

### Original writ

- `original_writ_petition`
  - docketTextTemplate: `Petition for writ of mandamus or prohibition filed by {participant}.`
  - possibleClerkResponses: `Petition docketed and submitted to panel`, `Denied without answer`, `Answer directed`, `Fee or IFP deficiency noted`
  - cureSuggestion: `Use an "In re [petitioner]" caption, state relief/issues/facts/reasons, attach essential orders or record parts, serve all trial-court parties, provide a trial-judge copy, and resolve fee/IFP requirements.`

- `original_writ_answer`
  - docketTextTemplate: `Answer to writ petition filed by {participant}.`
  - possibleClerkResponses: `Answer filed; petition submitted`, `Disclosure deficiency noted`
  - cureSuggestion: `Relate the answer to the court's order directing response and include any required disclosure statement and certificate of service.`

- `original_writ_emergency_motion`
  - docketTextTemplate: `Emergency motion pending writ petition filed by {participant}: {title}.`
  - possibleClerkResponses: `Emergency motion referred under local motion procedures`, `Response requested`, `Held pending writ docketing`
  - cureSuggestion: `File the writ petition first or relate the motion to a docketed writ petition, state the emergency relief requested, and provide service information.`

- `crime_victim_mandamus_petition`
  - docketTextTemplate: `Crime Victims' Rights mandamus petition filed by {participant}.`
  - possibleClerkResponses: `Expedited petition docketed`, `Immediate service or clerk-notification deficiency noted`
  - cureSuggestion: `Caption the petition for 18 U.S.C. 3771, arrange immediate service on relevant parties, and record prefiling notification to the Clerk's Office.`

### Local Rule 31 briefing handling

- `briefing_schedule_criminal`
  - docketTextTemplate: `Briefing order filed. Criminal opening brief and appendix due {openingDueDate}; appellee brief due 21 days after service; reply due 10 days after service.`
  - possibleClerkResponses: `Criminal briefing schedule issued`, `Record not complete; schedule held`
  - cureSuggestion: `Wait for receipt of the record or Clerk determination that the record is complete before issuing or relying on the briefing schedule.`

- `briefing_schedule_agency`
  - docketTextTemplate: `Briefing order filed after agency record filing or Clerk record-complete determination.`
  - possibleClerkResponses: `Briefing schedule issued`, `Record/certified-list deficiency noted`
  - cureSuggestion: `File the administrative record, certified list, or stipulation that no record will be filed before merits briefing is scheduled.`

- `motion_extend_briefing_criminal_or_agency`
  - docketTextTemplate: `Motion to extend briefing deadline filed by {participant}: {title}.`
  - possibleClerkResponses: `Routine extension denied or shortened`, `Extension granted for extraordinary circumstances`, `Response requested`
  - cureSuggestion: `File well before the brief due date, state the additional time requested, and explain the extraordinary circumstances supporting the extension.`

## Validation issue copy

- `criminal_notice_of_appeal_after_deadline`: `The criminal notice of appeal appears after the open FRAP 4(b) notice deadline.` Cure: `Confirm timeliness, a triggering government notice, or district-court extension for excusable neglect or good cause.`
- `criminal_release_order_missing`: `Release papers do not include the district-court release/detention order and statement of reasons.` Cure: `Attach the order and reasons before filing or explain where they appear in the record.`
- `criminal_release_transcript_missing`: `Release papers challenge the factual basis but do not include the release transcript or a no-transcript explanation.` Cure: `Attach the transcript of release proceedings or explain why it was not obtained.`
- `criminal_brief_before_schedule`: `A criminal merits brief is being filed before the briefing order.` Cure: `Wait for the Local Rule 31 briefing order issued after record receipt or Clerk record-complete determination.`
- `criminal_opening_brief_late`: `The criminal opening brief appears after the 35-day period in the briefing order.` Cure: `File a motion for extension showing extraordinary circumstances or cure the late-brief default.`
- `agency_petition_party_naming`: `The petition for review does not clearly name each petitioner.` Cure: `Name each party seeking review in the caption or body; do not rely on "et al." or generic party labels.`
- `agency_order_missing`: `The petition for review does not identify the agency order or part under review.` Cure: `Specify the agency order, decision date, and part under review.`
- `agency_service_list_missing`: `The agency petition does not include a service list for agency proceeding participants.` Cure: `File the list of served agency participants and provide respondent service copies if required.`
- `agency_record_before_petition`: `An agency record event is not available before a petition/application opens the proceeding.` Cure: `File the petition for review or application for enforcement first.`
- `agency_record_late_or_missing`: `The agency record or certified list has not been filed in the record-filing window.` Cure: `File the record, certified list, stipulation that no record will be filed, or seek an order extending the time.`
- `agency_stay_agency_first_missing`: `The stay motion does not show agency-first relief or why agency-first relief was impracticable.` Cure: `State the agency stay request and result, or explain impracticability, and attach supporting record materials.`
- `writ_caption_defect`: `The writ petition caption does not follow the "In re [petitioner]" format.` Cure: `Revise the caption to identify the petitioner without naming the district judge as a respondent.`
- `writ_required_sections_missing`: `The writ petition does not show relief, issues, facts, reasons, or essential order/record attachments.` Cure: `Add the missing FRAP 21 content and essential record materials.`
- `writ_fee_ifp_missing`: `The writ petition lacks the docket fee or required IFP/PLRA papers.` Cure: `Pay the docket fee, file a proper IFP application, or for prisoner civil-matter writs file the PLRA application, trust account statement, and consent-to-collection form.`
- `writ_service_missing`: `The writ petition does not show service on all trial-court parties and a copy to the trial judge.` Cure: `Add a certificate showing service on all trial-court parties and delivery of a copy to the trial-court judge.`
- `local_rule_31_extension_weak`: `The briefing extension motion does not show extraordinary circumstances or was not filed well in advance of the due date.` Cure: `State the specific extraordinary circumstances, the added time requested, and file before the due date whenever possible.`

## Recommended event IDs

Core new IDs: `criminal_notice_of_appeal`, `criminal_docketing_statement`, `motion_release_pending_appeal`, `criminal_opening_brief`, `criminal_appellee_brief`, `criminal_reply_brief`, `agency_petition_for_review`, `agency_application_enforcement`, `agency_cross_application_enforcement`, `agency_motion_intervene`, `agency_record`, `agency_certified_list`, `agency_record_stipulation`, `agency_motion_stay_pending_review`, `agency_proposed_judgment`, `original_writ_petition`, `original_writ_answer`, `original_writ_emergency_motion`, `crime_victim_mandamus_petition`, `briefing_schedule_criminal`, `briefing_schedule_agency`.

Optional later IDs: `agency_answer_to_enforcement_application`, `agency_supplemental_record`, `agency_record_correction_stipulation`, `pay_petition_for_review_fee`, `plra_application`, `plra_trust_account_statement`, `plra_consent_to_payment`.

## Sources used

- Fourth Circuit Rules & Procedures index: `https://www.ca4.uscourts.gov/rules-and-procedures`
- Fourth Circuit CM/ECF Filing Events & Reliefs: `https://www.ca4.uscourts.gov/caseinformationefiling/efiling_cm-ecf/filingevents`
- FRAP 4, including Rule 4(b): `https://www.ca4.uscourts.gov/docs/rules/rule04.pdf?sfvrsn=61cd152e_8`
- FRAP/Local Rule 9: `https://www.ca4.uscourts.gov/docs/rules/rule09.pdf?sfvrsn=1f95ca2d_3`
- FRAP 15: `https://www.ca4.uscourts.gov/docs/rules/rule15.pdf?sfvrsn=5b23a8e_6`
- FRAP 15.1: `https://www.ca4.uscourts.gov/docs/rules/rule15_1.pdf?sfvrsn=5800c8ba_2`
- FRAP 16: `https://www.ca4.uscourts.gov/docs/rules/rule16.pdf?sfvrsn=c4208aed_2`
- FRAP 17: `https://www.ca4.uscourts.gov/docs/rules/rule17.pdf?sfvrsn=2cfa7134_2`
- FRAP/Local Rule 18: `https://www.ca4.uscourts.gov/docs/rules/rule18.pdf?sfvrsn=bd4ba333_2`
- FRAP 19: `https://www.ca4.uscourts.gov/docs/rules/rule19.pdf?sfvrsn=36742a6d_2`
- FRAP 20: `https://www.ca4.uscourts.gov/docs/rules/rule20.pdf?sfvrsn=1a84ce20_2`
- FRAP/Local Rule 21: `https://www.ca4.uscourts.gov/docs/rules/rule21.pdf?sfvrsn=e649f65c_10`
- FRAP/Local Rule 31: `https://www.ca4.uscourts.gov/docs/rules/rule31.pdf?sfvrsn=66d41700_12`
