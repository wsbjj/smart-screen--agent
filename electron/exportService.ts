import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { exportScorecardsToCsv, exportScorecardsToWorkbookBuffer } from '../src/core/exporter.js'
import type { CandidateScorecard } from '../src/shared/types.js'

export async function exportCsv(scorecards: CandidateScorecard[]): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '导出 CSV',
    defaultPath: '筛选结果.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  await writeFile(result.filePath, `\uFEFF${exportScorecardsToCsv(scorecards)}`, 'utf8')
  return result.filePath
}

export async function exportXlsx(scorecards: CandidateScorecard[]): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '导出 Excel',
    defaultPath: '筛选结果.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  await writeFile(result.filePath, await exportScorecardsToWorkbookBuffer(scorecards))
  return result.filePath
}
