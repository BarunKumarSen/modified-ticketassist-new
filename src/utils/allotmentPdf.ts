import type { Asset, FreelancerAllotmentRecord } from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import { resolveCenterOfficeInfo } from './entityValidation';

function sanitizeFilenameSegment(value: string): string {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCenterPrefixCode(
  centerName: string | undefined | null,
  centers: readonly EmployeeCenterRecord[] = []
): string {
  const clean = (centerName || '').trim();
  const matched = centers.find(
    (c) => c.name.trim().toLowerCase() === clean.toLowerCase()
  );
  const matchedCode =
    matched?.centerCode?.trim() ||
    (matched as (EmployeeCenterRecord & { code?: string }) | undefined)?.code?.trim();
  if (matchedCode) {
    return matchedCode.toUpperCase();
  }
  const letters = clean.replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'MRC').toUpperCase();
}

/**
 * Formats exact PDF filename required:
 * "IT Equipment Allotment & Undertaking Form [Freelancer Name] ([CenterCode+ID/Code]).pdf"
 */
export function buildFreelancerAllotmentFileName(
  allotment: Pick<FreelancerAllotmentRecord, 'flpName' | 'flpCode' | 'centerName'>,
  centers: readonly EmployeeCenterRecord[] = []
): string {
  const name = sanitizeFilenameSegment(allotment.flpName) || 'Freelancer';
  const rawCode = sanitizeFilenameSegment(allotment.flpCode).toUpperCase().replace(/\s+/g, '');
  const centerCode = resolveCenterPrefixCode(allotment.centerName, centers);
  const combinedCode = rawCode.startsWith(centerCode)
    ? rawCode
    : `${centerCode}${rawCode}`;
  return `IT Equipment Allotment & Undertaking Form ${name} (${combinedCode}).pdf`;
}

function escapePdfText(text: string): string {
  return String(text || '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapTextLines(text: string, maxChars = 90): string[] {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Builds a valid multi-page (2-page) A4 PDF 1.4 document matching the exact
 * Freelancer IT Equipment Allotment Request & Undertaking form content.
 */
export function buildFreelancerAllotmentPdfBytes(params: {
  allotment: FreelancerAllotmentRecord;
  assets: readonly Asset[];
  centers: readonly EmployeeCenterRecord[];
}): Uint8Array {
  const { allotment, assets, centers } = params;
  const office = resolveCenterOfficeInfo(allotment.centerName, centers);
  const centerAddress = allotment.centerAddress?.trim() || office.address;
  const centerPhone = allotment.centerPhone?.trim() || office.phone;
  const centerName = allotment.centerName || office.name;

  const matchedAssets = allotment.assetIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is Asset => Boolean(a));

  const equipmentLabelList =
    matchedAssets.length > 0
      ? matchedAssets
          .map((a) => `${a.id}${a.serial ? ` / ${a.serial}` : ''}`)
          .join(', ')
      : allotment.assetIds.join(', ');
  const firstAssetCodeList = allotment.assetIds.join(', ');

  const page1Lines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: 'Median Research & Consulting Pvt. Ltd.', bold: true, size: 12 },
    ...(centerAddress ? [{ text: centerAddress, size: 9 }] : []),
    ...(centerPhone ? [{ text: `T: ${centerPhone} | W: www.medianresearch.in`, size: 9 }] : [{ text: 'W: www.medianresearch.in', size: 9 }]),
    { text: 'Request for Allotment and Receipt of IT Equipment for conducting fieldwork', bold: true, size: 11 },
    { text: '', size: 8 },
    ...wrapTextLines(
      `I, ${allotment.flpName} residing at ${allotment.flpAddress}, having AADHAR Card number ${allotment.aadhaarNo} and PAN Card number ${allotment.panNo} and currently working as a freelance supplier for conducting interview and collecting data on project specific assignment basis with Median Research & Consulting Pvt Ltd, hereby request ${centerName} to issue the following IT Equipment/s for executing the assignment given by ${allotment.executiveName}.`
    ).map((t) => ({ text: t, size: 9 })),
    { text: `Date: ${allotment.issueDate}    |    Job Number: ${allotment.jobNumber}`, bold: true, size: 9 },
    { text: '-'.repeat(92), size: 8 },
    { text: 'Sl | Item / Category / Model | Asset Code | IMEI / Serial | Qty | Issue Date | Return Date', bold: true, size: 8 },
    ...((matchedAssets.length > 0
      ? matchedAssets
      : allotment.assetIds.map((id) => ({
          id,
          category: 'IT Equipment',
          brand: '',
          model: '',
          serial: '',
          imei1: '',
          dateOfReturn: '',
        }))
    ).map((asset, idx) => ({
      text: `${idx + 1} | ${asset.category} (${centerName}) ${[asset.brand, asset.model].filter(Boolean).join(' ')} | ${asset.id} | ${asset.imei1 || asset.serial || '-'} | 1 | ${allotment.issueDate} | ${asset.dateOfReturn || '-'}`,
      size: 8,
    }))),
    ...allotment.accessories.map((acc, idx) => ({
      text: `${matchedAssets.length + idx + 1} | ${acc.name} | - | - | ${acc.qty} | - | -`,
      size: 8,
    })),
    { text: `Remarks: ${allotment.remarks || 'None'}`, size: 9 },
    { text: '-'.repeat(92), size: 8 },
    ...wrapTextLines(
      `I confirm receipt from ${centerName} of the above IT Equipment in good working condition and undertake to return the items to ${centerName} on completion of assignment or instruction whichever is earlier.`
    ).map((t) => ({ text: t, size: 9 })),
    { text: '', size: 8 },
    { text: `Freelancer Name: ${allotment.flpName}    |    Executive Name: ${allotment.executiveName}`, size: 9 },
    { text: `Freelancer Address: ${allotment.flpAddress}    |    Executive Emp ID: ${allotment.executiveEmpId || '-'}`, size: 9 },
    { text: `Freelancer Code: ${allotment.flpCode}    |    Mobile No.: ${allotment.mobileNo}    |    Date: ${allotment.allotmentDate}`, size: 9 },
  ];

  const page2Lines: Array<{ text: string; bold?: boolean; size?: number }> = [
    { text: 'Median Research & Consulting Pvt. Ltd.', bold: true, size: 12 },
    ...(centerAddress ? [{ text: centerAddress, size: 9 }] : []),
    ...(centerPhone ? [{ text: `T: ${centerPhone} | W: www.medianresearch.in`, size: 9 }] : [{ text: 'W: www.medianresearch.in', size: 9 }]),
    { text: 'Undertaking', bold: true, size: 12 },
    ...wrapTextLines(
      `I, ${allotment.flpName} residing at ${allotment.flpAddress}, having AADHAR Card number ${allotment.aadhaarNo} and PAN Card number ${allotment.panNo} hereby confirm that:`
    ).map((t) => ({ text: t, size: 9 })),
    ...wrapTextLines(`1. This Undertaking is read with Request for allotment letter (${firstAssetCodeList}) dated ${allotment.allotmentDate}.`).map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines(`2. I have checked and verified IT Equipment (${equipmentLabelList}) dated ${allotment.allotmentDate} in working condition.`).map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('3. I shall be solely responsible for safe custody and return in good working condition (normal wear and tear acceptable).').map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('4. In case of loss or damage due to negligence, I shall reimburse Median Research & Consulting Pvt Ltd the actual repair or replacement cost.').map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines(`5. Equipment (${firstAssetCodeList} dated ${allotment.allotmentDate}) shall only be used for assigned interviewing and data collection without unauthorized transfer.`).map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('6. I shall not modify or use the IT Equipment for any unauthorized or illegal purpose.').map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('7. I take full responsibility for utmost care and safe handling of the IT Equipment.').map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('8. I authorize Median Research & Consulting Pvt Ltd to deduct actual loss cost from current/future dues in case of negligent loss.').map((t) => ({ text: t, size: 8 })),
    ...wrapTextLines('9. In case of theft/forced snatching, I shall lodge an immediate Police FIR and submit original copy within 3 days to authorized staff.').map((t) => ({ text: t, size: 8 })),
    { text: '', size: 8 },
    { text: 'Signed By: _____________________                Signed By: _____________________', size: 9 },
    { text: `Freelancer Name: ${allotment.flpName} | Freelancer ID: ${allotment.flpCode} | Mobile No: ${allotment.mobileNo}`, size: 9 },
    { text: `Freelancer Address: ${allotment.flpAddress}`, size: 9 },
    { text: `Name of Issuer (EMP): ${allotment.executiveName}${allotment.executiveEmpId ? ` (${allotment.executiveEmpId})` : ''}    Signature of Issuer: _______________`, size: 9 },
    { text: `Witness 1: ${allotment.witness1Name || '_______________________'}    Witness 2: ${allotment.witness2Name || '_______________________'}    Date: ${allotment.allotmentDate}`, size: 9 },
  ];

  const renderPageStream = (items: Array<{ text: string; bold?: boolean; size?: number }>) => {
    const ops: string[] = ['BT', '42 800 Td'];
    for (const item of items) {
      const font = item.bold ? '/F1' : '/F2';
      const size = item.size || 9;
      ops.push(`${font} ${size} Tf`, `(${escapePdfText(item.text)}) Tj`, `0 -${size + 5} Td`);
    }
    ops.push('ET');
    return ops.join('\n');
  };

  const stream1 = renderPageStream(page1Lines);
  const stream2 = renderPageStream(page2Lines);

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> >>\nendobj\n',
    `6 0 obj\n<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream\nendobj\n`,
    '7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
