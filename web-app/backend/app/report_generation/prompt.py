############################################
# This file contains the prompt messages
# for the EEG report generation task.
############################################

import json

def reportPrompt(finalResults, reportLang='English', promptLength='long'):
    if promptLength=='long':
       
        message="""You are a neurologist with access to a comprehensive neurological database from Medline and textbooks. 
            JSON Findings:
            {}
            Meanings of JSON findings:
            'backgroundFrequency': the background frequency of the EEG in the left and right hemispheres. Differences <=0.5 Hz are considered symmetric.
            'bg_active': the overall presence of background activity.
            'bg_amp_sym', 'bg_freq': symmetry of alpha amplitude and background frequency.            
            'abnormalFindings': all abnormal findings in the EEG examination.

            Task: Generate a detailed and structured EEG report based on the provided EEG findings.
            === EEG Findings ===
            Present the EEG findings in a list format in concise and professional language.
            === Conclusion ===
            - If the results are normal: "The EEG examination reveals normal findings."
            - If the results are abnormal: "Abnormal EEG findings are observed."
            - A brief description of the abnormal observations should be included.
            === Clinical Correlation ===
            - For normal EEG results: "No evidence of cortical dysfunction or epileptiform activity is observed."
            === Advanced Strategies ===
            - - For abnormal EEG results, very briefly suggest further investigations or follow-up tests.

            Examples for Abnormal Clinical Correlations:
            - Diffuse background slowing may indicate associations with degenerative diseases, metabolic encephalopathy, and bilateral cortical lesions.
            - Slow waves in a specific region or hemisphere might suggest a structural lesion in the corresponding brain region.
            - Detection of spikes or sharp waves raises concerns about an increasing risk of epilepsy.
            - Excess beta activity is linked to factors like anxiety or the effects of certain drugs, such as benzodiazepines.

        Examples for Advanced Strategies:
            - For structural lesions: Recommend neuroimaging studies, such as MRI or CT, to identify abnormalities.
            - In cases of epilepsy: Suggest long-term video EEG monitoring for detecting epileptiform activity.
            - In the presence of artifacts: Advise a repeat EEG examination to confirm findings.
            - Emphasize that correlation with clinical symptoms and other laboratory tests is essential for establishing a diagnosis.

            Important Notes:
                - Must Enclose the title of each section in ===

            Report: 
            Your detailed and structured EEG report in {}.
        """.format(finalResults, reportLang)
    elif  promptLength=='medium':
        message="""
            You are a neurologist with access to a comprehensive neurological database from Medline and textbooks. 
            JSON Findings:
            {}
            Meanings of JSON findings:
            'backgroundFrequency': the background frequency of the EEG in the left and right hemispheres. Differences <=0.5 Hz are considered symmetric.
            'bg_active': the overall presence of background activity.
            'bg_amp_sym', 'bg_freq': symmetry of alpha amplitude and background frequency.            
            'abnormalFindings': all abnormal findings in the EEG examination.

            Task: Generate a detailed and structured EEG report based on the provided EEG findings.
            === EEG Findings ===
            Present the EEG findings in a list format in concise and professional language.
            === Conclusion ===
            - A brief description of the normal or abnormal observations.
            === Clinical Correlation ===
            === Advanced Strategies ===
            - - For abnormal EEG results, very briefly suggest further investigations or follow-up tests.
            Report: 
            Your detailed and structured EEG report in {}.
        """.format(finalResults, reportLang)
    elif promptLength=='short':
        message="""
            You are a neurologist. 
            Task: Generate a EEG report based on the provided EEG findings.
            EEG Findings, Conclusion, Clinical Correlation, and Advanced Strategies should be included.
            JSON Findings:
            {}
            Meanings of JSON findings:
            'bg_active': presence of background activity.
            'bg_amp_sym', 'bg_freq': symmetry of background alpha amplitude and  frequency.            
            'abnormalFindings': all abnormal findings in the EEG examination.
            Your EEG report in {}:
        """.format(finalResults, reportLang)

    return message

def mcs18ReportPrompt_old(
        finalResults,
        seizure_detection=None,
        annotations=None,
        reportLang='English'
    ):

    combined_findings = {
        "background_analysis": finalResults
    }

    if seizure_detection is not None:
        combined_findings["seizure_detection"] = seizure_detection
    
    if annotations is not None:
        combined_findings["annotations"] = annotations

    findings_json = json.dumps(
        combined_findings,
        ensure_ascii=False,
        indent=2
    )

    message = """
You are generating a clinical-style EEG report draft from structured automated EEG analysis results.

Structured EEG findings:
{}

Meaning of the fields:

"background_analysis":
- "EEG_quality": overall technical quality of the EEG after automated preprocessing.
- "bad_channels": channels flagged by the automated artifact-detection process. Report them as artifact-affected or flagged channels; do not infer the specific cause of the signal-quality issue.
- "backgroundFrequency": estimated dominant background frequency for the right and left hemispheres.
- "bg_active": automated classification of background activity as normal background frequency or diffuse background slowing.
- "bg_amp": estimated background alpha amplitude category.
- "bg_amp_sym": automated assessment of left-right alpha amplitude symmetry.
- "bg_freq": automated assessment of left-right background-frequency symmetry. Differences below 1 Hz are treated as symmetric by this implementation.
- "abnormalFindings": abnormalities explicitly identified by the automated background-analysis pipeline.

"seizure_detection":
This component is present only when automated seizure-detection results have been supplied.
- "recording_id": identifies the EEG recording to which the results belong.
- "threshold": decision threshold used by the seizure-detection model.
- "seizure_count": number of candidate seizure intervals returned by the detector.
- "seizures": list of candidate seizure intervals.
For each seizure candidate:
  - "start_seconds": start time in seconds from the beginning of the recording.
  - "end_seconds": end time in seconds from the beginning of the recording.
  - "duration_seconds": duration of the detected interval.
  - "mean_probability": mean model probability across that detected interval.
  - "max_probability": maximum model probability reached within that detected interval.
The seizure probabilities are outputs from the automated model. They must not be interpreted as clinical certainty, probability of epilepsy, or clinician confirmation of a seizure.

"annotations":
This component is present only when reviewer annotations have been supplied.
- "recording_id": identifies the EEG recording to which the annotations belong.
- "annotations": list of reviewer-created annotations.
For each annotation:
  - "start_seconds": start time in seconds from the beginning of the recording.
  - "end_seconds": end time in seconds from the beginning of the recording.
  - "channels": EEG channels selected by the reviewer.
  - "label": annotation category selected by the reviewer from the available labels.
  - "notes": reviewer-entered notes.
A reviewer label such as "Seizure" represents what the reviewer entered and must not automatically be treated as an independently confirmed seizure.

Important constraints:
1. Use only the supplied structured findings when describing EEG observations.
2. Do not invent findings that are not present in the supplied data.
3. Do not state that epileptiform discharges, spikes, sharp waves, or other EEG features are present or absent unless explicitly supplied.
4. Do not infer a diagnosis from the EEG findings alone.
5. Do not invent patient history, symptoms, medications, laboratory results, imaging findings, age, or clinical circumstances.
6. Clearly distinguish:
   - automated background-analysis findings,
   - automated seizure-detection results,
   - human reviewer annotations.
7. Automated seizure intervals are candidate detections requiring clinical review; do not describe them as clinician-confirmed seizures.
8. Model probability values describe the seizure detector's output within an interval and must not be interpreted as diagnostic certainty.
9. Reviewer labels and notes must be reported as reviewer-entered information, not as independently verified automated findings.
10. If an automated seizure candidate and a reviewer annotation overlap in time, you may state that they overlap temporally. Do not state that one confirms or validates the other.
11. Empty reviewer labels or notes should simply be omitted from the written description.
12. If technical quality is not good or bad channels are present, mention this as a limitation where relevant.
13. If seizure-detection results are not supplied, make no statement about whether seizures are present or absent.
14. If seizure_detection is supplied and seizure_count is 0, state only that the automated detector returned no candidate seizure intervals; do not state that the EEG contains no seizures.
15. If reviewer annotations are not supplied, do not mention reviewer observations.
16. Avoid repeating equivalent findings that appear more than once in the structured data.
17. When discussing clinical correlation, clearly distinguish general clinical associations from findings in this recording.

Task:
Generate a concise, professional EEG report using the following sections.

=== EEG Findings ===
- Summarize the technical quality and bad channels.
- Describe the background frequency.
- Describe background activity and amplitude.
- Describe amplitude and frequency symmetry.
- State only abnormalities explicitly supported by the supplied findings.

=== Automated Seizure Detection ===
Include this section only if "seizure_detection" is supplied.
- State the number of candidate seizure intervals returned by the automated detector.
- State the decision threshold if supplied.
- For each candidate interval, report:
  - start time,
  - end time,
  - duration,
  - mean probability,
  - maximum probability.
- Clearly describe these as automated candidate detections requiring clinical review.
- Do not convert model probabilities into diagnostic certainty.

=== Reviewer Annotations ===
Include this section only if "annotations" is supplied.
For each reviewer annotation:
- report its start and end times;
- report the selected channels;
- report the label if provided;
- report the notes if provided.
Describe labels and notes explicitly as reviewer-entered information.
Do not reinterpret or independently validate the reviewer annotation.

=== Conclusion ===
Summarize the supplied findings from all available components.
Clearly distinguish automated background findings, automated seizure detections, and reviewer annotations.
If only background analysis is supplied, summarize only the automated background-analysis findings.
Do not describe features that were not evaluated.
Use the wording "automated background analysis identified abnormal findings" when abnormalities are present.
Do not describe the entire EEG as abnormal or normal beyond what this automated analysis evaluated.

=== Clinical Correlation ===
Explain the general clinical significance of the observed EEG abnormalities.
You may describe several commonly associated clinical possibilities when relevant, but clearly present them as general associations rather than findings or diagnoses.
Do not imply that any particular cause is present in this patient unless it is supplied in the structured findings.
Clearly state that the underlying cause cannot be determined from the automated EEG analysis alone and requires correlation with clinical history and other investigations.

=== Advanced Strategies ===
Provide reasonable follow-up considerations that a clinician may consider based on the reported EEG findings and recording quality.
Recommendations must be conditional rather than patient-specific.
Explain briefly why each suggested follow-up may be relevant.
Do not prescribe treatment or imply that a particular investigation is mandatory.

Important formatting requirement:
Enclose every section title in === exactly as shown above.

Generate the report in {}.
""".format(findings_json, reportLang)
    return message


def mcs18ReportPrompt(
        finalResults,
        seizure_detection=None,
        annotations=None,
        reportLang='English'
    ):

    combined_findings = {"background_analysis": finalResults}

    if seizure_detection is not None:
        combined_findings["seizure_detection"] = seizure_detection

    if annotations is not None and annotations.get("annotations"):
        combined_findings["annotations"] = annotations

    findings_json = json.dumps(
        combined_findings,
        ensure_ascii=False,
        indent=2
    )

    message = """
You are generating AI-assisted interpretive sections for an EEG analysis report.

Structured findings:
{}


Relevant field meanings:

"background_analysis":
- "EEG_quality": overall technical quality after automated preprocessing.
- "bad_channels": channels flagged by the automated artifact-detection process.
- "backgroundFrequency": estimated dominant background frequency for the right and left hemispheres.
- "bg_active": automated classification of background activity, such as normal background frequency or diffuse background slowing.
- "bg_amp": estimated background alpha amplitude category.
- "bg_amp_sym": automated assessment of left-right alpha amplitude symmetry.
- "bg_freq": automated assessment of left-right background-frequency symmetry.
- "abnormalFindings": abnormalities explicitly identified by the automated background-analysis pipeline.

"seizure_detection":
- "seizure_count": number of candidate seizure intervals returned by the automated detector.
- "seizures": automated candidate intervals; these are not clinician-confirmed seizures.

"annotations":
- "annotations": reviewer-created annotations.
- "label": category selected by the reviewer from the available labels.
- "notes": reviewer-entered notes.


Important rules:
1. Use only the supplied structured findings.
2. Do not invent diagnoses, symptoms, patient history, medication, imaging, laboratory findings, or clinical circumstances.
3. Automated seizure detections are candidate intervals requiring clinical review. Do not describe them as confirmed seizures.
4. Model probability values are model outputs and do not represent diagnostic certainty.
5. Reviewer annotation labels are reviewer-selected categories, while notes are reviewer-entered text. Do not independently validate or reinterpret either.
6. If seizure_detection is supplied with seizure_count = 0, state only that the automated detector returned no candidate seizure intervals. Do not state that the EEG contains no seizures.
7. Do not claim that epileptiform discharges, spikes, sharp waves, or other EEG features are present or absent unless explicitly supplied.
8. Clearly distinguish automated background-analysis findings, automated seizure-detection results, and reviewer annotations where relevant.
9. Do not repeat detailed timestamps, probability values, or individual annotation details because these are presented elsewhere in the report.
10. Do not prescribe treatment or imply that any investigation is mandatory.


Task:

=== Conclusion ===
Write a concise professional summary of the clinically relevant automated findings.
- Do not repeat exact frequencies, amplitudes, probability values, timestamps, or channel names unless they are necessary to understand the conclusion.
- If the "annotations" component is not supplied, do not mention reviewer annotations.
- Focus on the main background abnormality, the presence or absence of candidate seizure detections, and any clinically relevant reviewer information.
- If a relevant abnormal automated finding is present, include at most one brief sentence describing its general clinical significance.
- Present clinical significance only as a general association, not as a diagnosis or conclusion about this patient.
- When describing general clinical significance, keep it broad and cautious. Do not introduce specific causes or diagnoses that are not supplied in the structured findings.
  For diffuse background slowing, wording such as "a nonspecific finding that may be associated with diffuse cerebral dysfunction" is appropriate.
- Do not infer frequency-band labels or other derived interpretations from numerical values unless they are explicitly supplied in the structured findings.
- State that the findings should be interpreted together with the EEG recording and relevant clinical information.
- Keep this section to approximately 80 to 120 words.

=== Suggested Next Steps ===
Provide at most 2 concise bullet points describing conditional considerations for clinical review.
- Each bullet should contain only one sentence.
- Do not repeat detailed findings already stated elsewhere.
- Suggestions may include direct EEG review, review of candidate intervals, correlation with available video or clinical information, or assessment of artifact-affected channels where relevant.
- Do not prescribe treatment.
- Do not imply that any investigation is mandatory.
- Keep this section to approximately 40 to 60 words.
- Use "-" for every bullet and place each bullet on its own line.

Do not include any sections other than the two sections above.
Enclose every section title in === exactly as shown above.
Generate the sections in {}.
""".format(findings_json, reportLang)
    return message


def validatePrompt(text):
    prompt="""
    Task: Read the EEG report and answer the following questions, answering 1 for yes and 0 for no.
    Questions:
    a.Does the report mention "diffuse background slowing" or "Increased background slow waves ratio diffusely"?
    b.Dose the report mention background asymmetry such as "lower amplitude" or "lower frequency" in right or left hemisphere, or "focal/regional slowing(delta/theta)"?
    Important Note: 
    1.if the left and right background frequency differ by within 1 Hz, it is considered as normal.
    2. Excessive beta activity is not classified as abnormal diffuse background slowing nor focal slow wave.
    The EEG report:
    {}
    Your answer should be in array format ([int, int]), and do not include any other information.
    Your answer array:
    """.format(text)
    
    return prompt