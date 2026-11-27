import React from 'react';
import { Download, Printer, X } from 'lucide-react';
import type {
  Asset,
  FreelancerAllotmentRecord,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';
import {
  buildFreelancerAllotmentFileName,
  buildFreelancerAllotmentPdfBytes,
} from '../utils/allotmentPdf';
import { resolveCenterOfficeInfo } from '../utils/entityValidation';

interface FreelancerAllotmentPrintModalProps {
  allotment: FreelancerAllotmentRecord;
  assets: Asset[];
  centers: EmployeeCenterRecord[];
  onClose: () => void;
}

const CompanyLetterhead: React.FC<{
  address: string;
  phone: string;
}> = ({ address, phone }) => (
  <div className="flex items-start gap-3 mb-4 pb-2 border-b border-slate-300">
    <img
      src="/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg"
      alt="Median Research & Consulting"
      className="w-12 h-12 object-contain shrink-0"
    />
    <div className="text-[10.5px] leading-snug text-slate-900">
      <p className="font-bold text-[12px]">Median Research &amp; Consulting Pvt. Ltd.</p>
      <p>{address}</p>
      <p>T: {phone}</p>
      <p>W: www.medianresearch.in</p>
    </div>
  </div>
);

export const FreelancerAllotmentPrintModal: React.FC<FreelancerAllotmentPrintModalProps> = ({
  allotment,
  assets,
  centers,
  onClose,
}) => {
  const resolvedOffice = resolveCenterOfficeInfo(allotment.centerName, centers);
  const centerAddress = allotment.centerAddress?.trim() || resolvedOffice.address;
  const centerPhone = allotment.centerPhone?.trim() || resolvedOffice.phone;
  const centerName = allotment.centerName || resolvedOffice.name;

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

  const equipmentRowsCount = Math.max(1, matchedAssets.length || allotment.assetIds.length);

  const pdfFileName = buildFreelancerAllotmentFileName(allotment, centers);

  const handlePrint = () => {
    const prevTitle = document.title;
    document.title = pdfFileName.replace(/\.pdf$/i, '');
    const restore = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1500);
  };

  const handleDownloadPdf = () => {
    const bytes = buildFreelancerAllotmentPdfBytes({ allotment, assets, centers });
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = pdfFileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Printable Freelancer IT Equipment Allotment & Undertaking Form"
      className="print-modal-root fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-start p-4 overflow-y-auto"
    >
      {/* Top Action Toolbar (Hidden when printing) */}
      <div className="no-print sticky top-0 z-30 w-full max-w-[215mm] bg-[#1c1c1e] text-white rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-2 shadow-xl">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate" title={pdfFileName}>
            {pdfFileName}
          </p>
          <p className="text-[10px] text-slate-300">
            2-Page A4 Layout · Center: {centerName} · {centerPhone || 'Phone N/A'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadPdf}
            data-testid="download-allotment-pdf-btn"
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            data-testid="print-allotment-btn"
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save as PDF</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close printable form"
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Printable 2-Page A4 Sheets */}
      <div className="print-modal-card w-full max-w-[215mm] space-y-6 pb-8">
        {/* ======================== PAGE 1 ======================== */}
        <section
          data-testid="allotment-print-page-1"
          className="print-sheet print-page-break bg-white text-slate-900 shadow-lg border border-slate-200 px-10 py-8 text-[11.5px] leading-relaxed font-sans"
        >
          <CompanyLetterhead address={centerAddress} phone={centerPhone} />

          <h1 className="text-center font-bold underline text-[13px] mb-4">
            Request for Allotment and Receipt of IT Equipment for conducting fieldwork
          </h1>

          <p className="text-justify mb-3">
            I, <strong>{allotment.flpName}</strong> residing at{' '}
            <strong>{allotment.flpAddress}</strong>, having AADHAR Card number{' '}
            <strong>{allotment.aadhaarNo}</strong> and PAN Card number{' '}
            <strong>{allotment.panNo}</strong> and currently working as a freelance supplier for
            conducting interview and collecting data on project specific assignment basis with
            Median Research &amp; Consulting Pvt Ltd, I hereby request to center{' '}
            <strong>{centerName}</strong> issue following IT Equipment/s to me for the purpose of
            executing the below stated assignment given to me by{' '}
            <strong>{allotment.executiveName}</strong>.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 font-semibold mb-3">
            <p>
              Date: <span className="font-mono font-bold">{allotment.issueDate}</span>
            </p>
            <p>
              Job Number <span className="font-mono font-bold ml-1">{allotment.jobNumber}</span>
            </p>
          </div>

          {/* Equipment & Accessories Table */}
          <table className="w-full border-collapse border border-slate-800 text-[10.5px] mb-4">
            <thead>
              <tr>
                <th
                  colSpan={7}
                  className="border border-slate-800 bg-slate-100 text-center py-1 font-bold"
                >
                  List of IT Equipments
                </th>
              </tr>
              <tr className="bg-slate-50 text-left">
                <th className="border border-slate-800 px-2 py-1 w-10 text-center">Sl No.</th>
                <th className="border border-slate-800 px-2 py-1">Item(OpCo. &amp; Model)</th>
                <th className="border border-slate-800 px-2 py-1">Asset Code</th>
                <th className="border border-slate-800 px-2 py-1">IMEI / Device ID 1/SL NO</th>
                <th className="border border-slate-800 px-2 py-1 w-10 text-center">Nos</th>
                <th className="border border-slate-800 px-2 py-1">Date of Issue</th>
                <th className="border border-slate-800 px-2 py-1">Date &amp; Time of Return</th>
              </tr>
            </thead>
            <tbody>
              {(matchedAssets.length > 0
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
              ).map((asset, index) => (
                <tr key={asset.id}>
                  <td className="border border-slate-800 px-2 py-1 text-center tabular-nums">
                    {index + 1}
                  </td>
                  <td className="border border-slate-800 px-2 py-1">
                    {asset.category} ({centerName})
                    {asset.brand || asset.model
                      ? ` (${[asset.brand, asset.model].filter(Boolean).join(' ')})`
                      : ''}
                  </td>
                  <td className="border border-slate-800 px-2 py-1 font-mono font-semibold">
                    {asset.id}
                  </td>
                  <td className="border border-slate-800 px-2 py-1 font-mono">
                    {asset.imei1 || asset.serial || '—'}
                  </td>
                  <td className="border border-slate-800 px-2 py-1 text-center tabular-nums">1</td>
                  <td className="border border-slate-800 px-2 py-1 font-mono tabular-nums">
                    {allotment.issueDate}
                  </td>
                  <td className="border border-slate-800 px-2 py-1 font-mono tabular-nums">
                    {asset.dateOfReturn || ''}
                  </td>
                </tr>
              ))}

              {allotment.accessories.map((acc, idx) => (
                <tr key={`acc-${idx}`}>
                  <td className="border border-slate-800 px-2 py-1 text-center tabular-nums">
                    {equipmentRowsCount + idx + 1}
                  </td>
                  <td className="border border-slate-800 px-2 py-1">{acc.name}</td>
                  <td className="border border-slate-800 px-2 py-1"></td>
                  <td className="border border-slate-800 px-2 py-1"></td>
                  <td className="border border-slate-800 px-2 py-1 text-center tabular-nums">
                    {acc.qty}
                  </td>
                  <td className="border border-slate-800 px-2 py-1"></td>
                  <td className="border border-slate-800 px-2 py-1"></td>
                </tr>
              ))}

              <tr>
                <td colSpan={7} className="border border-slate-800 px-2 py-1.5">
                  <span className="font-semibold">Remarks if any:</span>{' '}
                  <span>{allotment.remarks || ''}</span>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="space-y-2.5 text-justify mb-5">
            <p>
              I hereby also confirm receipt from center <strong>{centerName}</strong> of the above
              Netbook/Tablet/Laptop along with all items listed above (hereinafter collectively
              referred to as &lsquo;IT Equipment&rsquo;) mentioned above in good working condition for
              conducting interview and data collection.
            </p>
            <p>
              I understand that the above stated &lsquo;IT Equipment&rsquo; are the property of Median Research & Consulting Pvt. Ltd. {' '}
              <strong>{centerName}</strong> and are to be used only for above stated assignment
              issued for Market Research work of Median Research & Consulting Pvt. Ltd. <strong>{centerName}</strong>.
            </p>
            <p>
              I further undertake to return the above stated &lsquo;IT Equipment&rsquo; to Median Research & Consulting Pvt. Ltd. {' '}
              <strong>{centerName}</strong> or the person authorized by them on completion of my
              assignment or on instruction (verbal or written) of Median Research & Consulting Pvt. Ltd. <strong>{centerName}</strong>{' '}
              whichever is earlier.
            </p>
          </div>

          <table className="w-full border-collapse border border-slate-800 text-[10.5px]">
            <tbody>
              <tr>
                <td className="border border-slate-800 px-3 py-2 align-top w-1/2 space-y-1">
                  <p>
                    <strong>Freelancer Name:</strong> {allotment.flpName}
                  </p>
                  <p>
                    <strong>Freelancer Address:</strong> {allotment.flpAddress}
                  </p>
                  <p>
                    <strong>Freelancer Code:</strong>{' '}
                    <span className="font-mono">{allotment.flpCode}</span>
                  </p>
                  <p>
                    <strong>MOBILE NO.:</strong> {allotment.mobileNo}
                  </p>
                </td>
                <td className="border border-slate-800 px-3 py-2 align-top w-1/2 space-y-1">
                  <p>
                    <strong>EXECUTIVE NAME:</strong> {allotment.executiveName}
                  </p>
                  <p>
                    <strong>EXECUTIVE EMP. ID:</strong>{' '}
                    <span className="font-mono">{allotment.executiveEmpId || '—'}</span>
                  </p>
                  <p className="pt-2">
                    <strong>EXECUTIVE SIGNATURE:</strong> _______________________
                  </p>
                  <p>
                    <strong>DATE:</strong> {allotment.allotmentDate}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ======================== PAGE 2 ======================== */}
        <section
          data-testid="allotment-print-page-2"
          className="print-sheet bg-white text-slate-900 shadow-lg border border-slate-200 px-10 py-8 text-[11px] leading-relaxed font-sans"
        >
          <CompanyLetterhead address={centerAddress} phone={centerPhone} />

          <h2 className="text-center font-bold underline text-[13px] mb-4">Undertaking</h2>

          <p className="text-justify mb-3">
            I, <strong>{allotment.flpName}</strong> residing at{' '}
            <strong>{allotment.flpAddress}</strong>, having AADHAR Card number{' '}
            <strong>{allotment.aadhaarNo}</strong> and PAN Card number{' '}
            <strong>{allotment.panNo}</strong> hereby confirm that:
          </p>

          <ol className="list-decimal pl-5 space-y-1.5 text-justify mb-6">
            <li>
              This &lsquo;Undertaking&rsquo; should be read and adopted in conjunction with
              &lsquo;Request for allotment of IT Equipment for conducting fieldwork&rsquo; letter with{' '}
              <strong>({firstAssetCodeList})</strong> dated <strong>{allotment.allotmentDate}</strong>.
            </li>
            <li>
              I have personally checked and verified the &lsquo;IT Equipment&rsquo; stated in above
              said &lsquo;Request for Allotment and Receipt of IT Equipment for conducting
              fieldwork&rsquo; letter with serial number <strong>({equipmentLabelList})</strong>{' '}
              dated <strong>{allotment.allotmentDate}</strong> and record that the said &lsquo;IT
              Equipment&rsquo; are in working condition.
            </li>
            <li>
              I shall be solely responsible for the safe custody of the &lsquo;IT Equipment&rsquo;
              and shall return the same in good working condition. (Normal wear and tear acceptable)
            </li>
            <li>
              In case of any loss or damage due to poor handling or negligence, I shall reimburse
              Median Research &amp; Consulting Pvt Ltd actual cost of repair or in case of loss of
              the &lsquo;IT Equipment&rsquo; in part or full, the actual cost of &lsquo;IT
              Equipment&rsquo;.
            </li>
            <li>
              I shall use the said &lsquo;IT Equipment&rsquo; only for the purpose of conducting
              interview and collecting data on <strong>({firstAssetCodeList} dated {allotment.allotmentDate})</strong>{' '}
              issued to me and undertake not to transfer/loan or otherwise handover to any person
              without written instruction from Kantar Operations or the person authorized by them.
            </li>
            <li>
              I shall not modify the &lsquo;IT Equipment&rsquo; in any manner nor will use this for
              any illegal/unauthorized purpose.
            </li>
            <li>
              I take full responsibility for taking utmost care when handling this costly IT
              Equipment. Further, I shall ensure that no damage or rough handling of this equipment
              is done by me.
            </li>
            <li>
              In case of any part/full loss, due to negligence, mishandling or usage for
              non-authorized purpose on my part, I hereby authorize Median Research &amp; Consulting
              Pvt Ltd to deduct the actual cost of the &lsquo;IT Equipment&rsquo; from my dues
              (current/future) without any further notice to me.
            </li>
            <li>
              In case of loss due to forced snatching, stealing while traveling on job/ project or
              from my house, I shall file / lodge a Police Complaint / FIR immediately at the nearest
              police station and submit original copy within 3 days of the incident to Median
              Research &amp; Consulting Pvt Ltd Authorized staff. In case i am unable to do so
              within the stipulated time, I hereby authorize Median Research &amp; Consulting Pvt Ltd
              to deduct the actual cost of the &lsquo;IT Equipment&rsquo; from my dues
              (current/future) without any further notice to me.
            </li>
          </ol>

          <div className="flex items-center justify-between px-4 pt-4 pb-5">
            <div className="text-center">
              <p className="border-t border-slate-800 pt-1 px-8 font-semibold">Signed By</p>
            </div>
            <div className="text-center">
              <p className="border-t border-slate-800 pt-1 px-8 font-semibold">Signed By</p>
            </div>
          </div>

          <table className="w-full border-collapse border border-slate-800 text-[10.5px]">
            <tbody>
              <tr>
                <td className="border border-slate-800 px-3 py-2 align-top w-1/2 space-y-1">
                  <p>
                    <strong>Freelancer Name:</strong> {allotment.flpName}
                  </p>
                  <p>
                    <strong>Freelancer Address:</strong> {allotment.flpAddress}
                  </p>
                  <p>
                    <strong>Freelancer ID:</strong>{' '}
                    <span className="font-mono">{allotment.flpCode}</span>
                  </p>
                  <p>
                    <strong>Mobile No:</strong> {allotment.mobileNo}
                  </p>
                </td>
                <td className="border border-slate-800 px-3 py-2 align-top w-1/2 space-y-3">
                  <p>
                    <strong>Name of Issuer (EMP):</strong> {allotment.executiveName}
                    {allotment.executiveEmpId ? ` (${allotment.executiveEmpId})` : ''}
                  </p>
                  <p className="pt-4">
                    <strong>Signature of Issuer (EMP):</strong> _______________________
                  </p>
                </td>
              </tr>
              <tr>
                <td colSpan={2} className="border border-slate-800 px-3 py-2 space-y-2">
                  <p>
                    <strong>Witness Name and Signature:</strong>{' '}
                    {allotment.witness1Name
                      ? `${allotment.witness1Name}  _______________________`
                      : '____________________________________________________'}
                  </p>
                  <p>
                    <strong>Witness Name and Signature:</strong>{' '}
                    {allotment.witness2Name
                      ? `${allotment.witness2Name}  _______________________`
                      : '____________________________________________________'}
                  </p>
                  <p className="pt-1">
                    <strong>Date:</strong> {allotment.allotmentDate}
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};
