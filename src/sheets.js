import { google } from 'googleapis';
import { config } from './config.js';

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: config.google.clientEmail,
    key: config.google.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

export async function ensureHeaders(headers) {
  const sheets = getSheetsClient();
  const range = `${config.google.tabName}!A1:AZ2`;

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range
  }).catch(() => ({ data: {} }));

  const firstRow = existing?.data?.values?.[0] || [];
  if (firstRow.length > 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: `${config.google.tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers]
    }
  });
}

export async function appendRows(rows) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: `${config.google.tabName}!A:AZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows
    }
  });
}
