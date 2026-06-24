import ExcelJS from 'exceljs'
import type { CandidateScorecard } from '../shared/types.js'

function joinList(items: string[]): string {
  return items.filter(Boolean).join('；')
}

function csvEscape(value: string | number): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function summaryRows(scorecards: CandidateScorecard[]) {
  return scorecards.map((scorecard, index) => ({
    排名: index + 1,
    候选人: scorecard.candidateName,
    文件名: scorecard.fileName,
    '岗位 Agent': scorecard.jobAgentTitle ?? '',
    总分: scorecard.overallScore,
    推荐等级: scorecard.recommendation,
    亮点: joinList(scorecard.strengths),
    缺失项: joinList(scorecard.gaps),
    风险点: joinList(scorecard.risks),
    证据摘要: joinList(scorecard.evidenceSummary),
    复核建议: scorecard.reviewerNotes,
  }))
}

function detailRows(scorecards: CandidateScorecard[]) {
  return scorecards.flatMap((scorecard) =>
    scorecard.criterionScores.map((criterion) => ({
      候选人: scorecard.candidateName,
      文件名: scorecard.fileName,
      评分维度: criterion.label,
      维度分: criterion.score,
      权重: criterion.weight,
      匹配证据: joinList(criterion.evidence),
      缺失项: joinList(criterion.missing),
    })),
  )
}

export function exportScorecardsToCsv(scorecards: CandidateScorecard[]): string {
  const rows = summaryRows(scorecards)
  const headers = ['排名', '候选人', '文件名', '岗位 Agent', '总分', '推荐等级', '亮点', '缺失项', '风险点', '证据摘要', '复核建议']

  return [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header as keyof typeof row])).join(','),
    ),
  ].join('\n')
}

export async function exportScorecardsToWorkbookBuffer(scorecards: CandidateScorecard[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Smart Screen Agent'
  workbook.created = new Date()

  const summary = workbook.addWorksheet('候选人排名')
  const details = workbook.addWorksheet('详细评分卡')
  const summaryData = summaryRows(scorecards)
  const detailData = detailRows(scorecards)

  summary.columns = [
    { header: '排名', key: '排名', width: 8 },
    { header: '候选人', key: '候选人', width: 18 },
    { header: '文件名', key: '文件名', width: 26 },
    { header: '岗位 Agent', key: '岗位 Agent', width: 24 },
    { header: '总分', key: '总分', width: 10 },
    { header: '推荐等级', key: '推荐等级', width: 14 },
    { header: '亮点', key: '亮点', width: 36 },
    { header: '缺失项', key: '缺失项', width: 36 },
    { header: '风险点', key: '风险点', width: 36 },
    { header: '证据摘要', key: '证据摘要', width: 42 },
    { header: '复核建议', key: '复核建议', width: 36 },
  ]
  summary.addRows(summaryData)

  details.columns = [
    { header: '候选人', key: '候选人', width: 18 },
    { header: '文件名', key: '文件名', width: 26 },
    { header: '评分维度', key: '评分维度', width: 20 },
    { header: '维度分', key: '维度分', width: 10 },
    { header: '权重', key: '权重', width: 10 },
    { header: '匹配证据', key: '匹配证据', width: 48 },
    { header: '缺失项', key: '缺失项', width: 42 },
  ]
  details.addRows(detailData)

  for (const sheet of [summary, details]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2A24' },
    }
    sheet.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true }
    })
  }

  const data = await workbook.xlsx.writeBuffer({ useSharedStrings: true })
  return Buffer.from(data)
}
