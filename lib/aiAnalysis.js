const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini';
const FAST_MODEL = process.env.FAST_MODEL || 'gpt-5-nano';

const LEGAL_ANALYSIS_INSTRUCTIONS = `You are an evidence-bound legal document analysis assistant.
Return ONLY valid JSON that follows the provided schema.
Do not assert misconduct as fact unless directly supported by document text.
Use cautious language: potential concern, possible irregularity, requires review, document suggests.
Separate facts, allegations, court findings, attorney arguments, and AI observations where possible.
Flag: missing notice/service, ex parte issues, sealing/confidentiality, conflicts of interest, GAL role concerns, unexplained restrictions, credibility issues, financial irregularities, and inconsistencies.
Extract names and roles separately, build timeline events from dates, and identify repeated actors/patterns.
If the document indicates sealed/confidential/restricted content, recommendedHumanReview must be true.`;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries([
    'documentType','jurisdiction','county','court','caseNumber','filingDate','hearingDate','publicSummary','privateAdminSummary'
  ].map((k) => [k, { type: 'string' }])),
  required: ['documentType','jurisdiction','county','court','caseNumber','filingDate','hearingDate','publicSummary','privateAdminSummary'],
};
['parties','childNames','judges','guardiansAdLitem','attorneys','prosecutors','evaluators','agencies','orders','rulings','factualAllegations','evidenceDiscussed','legalIssues','dueProcessConcerns','proceduralIrregularities','potentialConflicts','sealedOrConfidentialIndicators','credibilityConcerns','notableQuotes','patternTags','misconductConcernTags','extractionWarnings'].forEach((k)=>{ANALYSIS_SCHEMA.properties[k]={type:'array',items:{type:'string'}};ANALYSIS_SCHEMA.required.push(k);});
ANALYSIS_SCHEMA.properties.timelineEvents={type:'array',items:{type:'object',additionalProperties:false,properties:{date:{type:'string'},event:{type:'string'},category:{type:'string'}},required:['date','event','category']}};
ANALYSIS_SCHEMA.required.push('timelineEvents');
ANALYSIS_SCHEMA.properties.confidenceScores={type:'object',additionalProperties:false,properties:{classification:{type:'number'},extraction:{type:'number'},legalAnalysis:{type:'number'}},required:['classification','extraction','legalAnalysis']};
ANALYSIS_SCHEMA.required.push('confidenceScores');
ANALYSIS_SCHEMA.properties.recommendedHumanReview={type:'boolean'};
ANALYSIS_SCHEMA.required.push('recommendedHumanReview');

async function classifyDocument(openai, text, filename='') {
  const result = await openai.responses.create({
    model: FAST_MODEL,
    input: `Classify this legal document type in <=5 words and guess jurisdiction/court if present. Return JSON {documentType,jurisdiction,court,county,confidence}. Filename: ${filename}\n\n${text.slice(0, 5000)}`,
    max_output_tokens: 250,
  });
  const output = (result.output_text || '').trim();
  try { return JSON.parse(output); } catch { return {}; }
}

async function analyzeLegalDocument({ openai, text, filename='', initial={} }) {
  const response = await openai.responses.create({
    model: ANALYSIS_MODEL,
    instructions: LEGAL_ANALYSIS_INSTRUCTIONS,
    text: {
      format: {
        type: 'json_schema',
        name: 'legal_doc_analysis',
        schema: ANALYSIS_SCHEMA,
        strict: true,
      },
    },
    input: [{ role: 'user', content: `Filename: ${filename}\nInitial hints: ${JSON.stringify(initial)}\n\nDocument text:\n${text.slice(0, 30000)}` }],
    max_output_tokens: 2200,
  });
  const parsed = response.output_parsed;
  if (parsed && typeof parsed === 'object') return parsed;
  const raw = response.output_text || '';
  return JSON.parse(raw);
}

module.exports = { ANALYSIS_MODEL, FAST_MODEL, LEGAL_ANALYSIS_INSTRUCTIONS, classifyDocument, analyzeLegalDocument };
