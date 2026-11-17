'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Item = {
  id: number;
  billNo: string;
  sample: boolean;
  itemCode: string;
  design: string;
  description: string;
  qty: number;
  kt: string;
  gwt: number;
  nwt: number;
  dShape: string;
  dSize: string;
  dPcs: number;
  dWt: number;
  amount: number;
  img: string;
  sel: boolean;
  bq: number;
  price: number | null;
};

type ParsedInvoiceItem = {
  itemCode: string;
  design: string;
  description: string;
  qty: number;
  kt: string;
  gwt: number;
  nwt: number;
  dShape: string;
  dSize: string;
  dPcs: number;
  dWt: number;
  amount: number;
  img: string;
};

const DEFAULT_COLS = { sr: 23.3, qty: 130, kt: 149.5, shape: 323.3, size: 370.1, pcs: 400.1, wt: 426.2 };
const STORAGE_KEYS = {
  markup: 'markup',
  gst: 'gst',
  shop: 'shop',
} as const;

function toNum(s: string | number | null | undefined): number {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function unitPrice(it: Item): number {
  const base = it.amount || 0;
  if (it.price != null) return it.price;
  return base;
}

function lineAmt(it: Item): number {
  return unitPrice(it) * (it.bq || 1);
}

const load = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
};

const store = (key: string, value: string) => {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
};

const parseStoredNumber = (value: string | null): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getTodayInputDate = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function mulM(m: number[], n: number[]) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function readColumns(tokens: any[], headerY: number, prev: any = DEFAULT_COLS) {
  const cols = { ...prev };
  const hdr = tokens.filter((t) => Math.abs(t.y - headerY) < 3).sort((a, b) => a.x - b.x);
  const first = (name: string) => {
    const t = hdr.find((h) => h.s === name);
    return t ? t.x : null;
  };

  ['Sr.:sr', 'Qty:qty', 'KT:kt', 'Shape:shape', 'Size:size', 'Pcs:pcs', 'Wt:wt'].forEach((p) => {
    const a = p.split(':');
    const v = first(a[0]);
    if (v != null) cols[a[1]] = v;
  });

  return cols;
}

async function parseInvoicePage(pdfjsLib: any, page: any, imgToUrl: (obj: any) => Promise<string>, prevCols: any) {
  const tc = await page.getTextContent();
  const tokens = tc.items.filter((i: any) => i.str && i.str.trim()).map((i: any) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));

  const srHeaders = tokens.filter((t: any) => t.s === 'Sr.').sort((a: any, b: any) => b.y - a.y);
  if (!srHeaders.length) return { rows: [], cols: prevCols, meta: {} };

  const headerY = srHeaders[0].y;
  const endHeaderY = srHeaders.length > 1 ? srHeaders[1].y + 30 : null;
  const cols = readColumns(tokens, headerY, prevCols);

  const anchors = tokens
    .filter((t: any) => /^\d+$/.test(t.s) && Math.abs(t.x - cols.sr) < 12 && t.y < headerY - 3 && (endHeaderY == null || t.y > endHeaderY))
    .sort((a: any, b: any) => b.y - a.y);

  const rows = anchors.map((a: any, i: number) => {
    const next = anchors[i + 1];
    const bottom = next ? next.y + 6 : endHeaderY != null ? endHeaderY - 20 : a.y - 120;
    return { sr: toNum(a.s), lineY: a.y, top: a.y + 12, bottom };
  });

  rows.forEach((r: any) => {
    const band = tokens.filter((t: any) => t.y <= r.top && t.y > r.bottom);
    const main = band.filter((t: any) => Math.abs(t.y - r.lineY) <= 4.5).sort((a: any, b: any) => a.x - b.x);
    const left = band.filter((t: any) => t.x < cols.qty - 20 && t.x > cols.sr + 5).sort((a: any, b: any) => b.y - a.y);

    r.itemCode = left[0] ? left[0].s : '';
    r.design = left[1] ? left[1].s : '';
    r.description = left.slice(2).map((t: any) => t.s).join(' ');

    const qtyTok = main.filter((t: any) => /^\d+$/.test(t.s) && t.x >= cols.qty - 12 && t.x < cols.kt - 5)[0];
    r.qty = qtyTok ? toNum(qtyTok.s) : 1;

    const ktTok = main.filter((t: any) => /^[A-Za-z]?\d{1,2}[Kk]$/.test(t.s))[0];
    r.kt = ktTok ? ktTok.s : '';

    const w3 = main.filter((t: any) => /^\d[\d,]*\.\d{3}$/.test(t.s) && t.x > cols.kt && t.x < cols.shape - 40);
    r.gwt = w3[0] ? toNum(w3[0].s) : 0;
    r.nwt = w3[1] ? toNum(w3[1].s) : 0;
    r.fine = w3[2] ? toNum(w3[2].s) : 0;

    const shapeTok = main.filter((t: any) => /^[A-Za-z]+$/.test(t.s) && t.x >= cols.shape - 10 && t.x < cols.size - 20)[0];
    r.dShape = shapeTok ? shapeTok.s : '';

    const sizeTok = main.filter((t: any) => t.x >= cols.size - 22 && t.x < cols.pcs - 15)[0];
    r.dSize = sizeTok ? sizeTok.s : '';

    const pcsTok = main.filter((t: any) => /^\d+$/.test(t.s) && Math.abs(t.x - cols.pcs) < 16)[0];
    r.dPcs = pcsTok ? toNum(pcsTok.s) : 0;

    const dwTok = main.filter((t: any) => /^\d*\.\d+$/.test(t.s) && Math.abs(t.x - cols.wt) < 16)[0];
    r.dWt = dwTok ? toNum(dwTok.s) : 0;

    const money = main.filter((t: any) => t.x > 735 && /^[\d,]+(\.\d+)?$/.test(t.s)).sort((a: any, b: any) => a.x - b.x);
    const n = money.length;
    r.amount = n ? toNum(money[n - 1].s) : 0;
    r.labourAmt = n > 1 ? toNum(money[n - 2].s) : r.amount;
    r.labourRate = n > 2 ? toNum(money[n - 3].s) : 0;
  });

  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const imgs: any[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (f === OPS.save) stack.push(ctm.slice());
    else if (f === OPS.restore) {
      if (stack.length) ctm = stack.pop() || ctm;
    } else if (f === OPS.transform) {
      ctm = mulM(ctm, a);
    } else if (f === OPS.paintImageXObject) {
      imgs.push({ name: a[0], cx: ctm[4] + ctm[0] / 2, cy: ctm[5] + ctm[3] / 2, w: Math.abs(ctm[0]), h: Math.abs(ctm[3]) });
    }
  }

  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const cand = imgs
      .filter((im: any) => im.cy <= r.top + 2 && im.cy > r.bottom && im.w > 20 && im.h > 15 && im.cx < cols.qty)
      .sort((p: any, q: any) => q.w * q.h - p.w * p.h)[0];

    if (cand) {
      const obj = await new Promise((res) => {
        try {
          page.objs.get(cand.name, res);
        } catch {
          res(null);
        }
      });
      if (obj) r.img = await imgToUrl(obj);
    }
  }

  const meta: { billNo?: string; date?: string } = {};
  const billNoTok = tokens.find((t: any) => t.s === 'BILL NO');
  if (billNoTok) {
    const t1 = tokens
      .filter((t: any) => Math.abs(t.y - billNoTok.y) < 3 && t.x > billNoTok.x + 35 && t.s !== ':')
      .sort((a: any, b: any) => b.x - a.x)[0];
    if (t1) meta.billNo = t1.s;
  }

  const dateTok = tokens.find((t: any) => t.s === 'DATE');
  if (dateTok) {
    const t2 = tokens
      .filter((t: any) => Math.abs(t.y - dateTok.y) < 3 && t.x > dateTok.x + 35 && t.s !== ':')
      .sort((a: any, b: any) => b.x - a.x)[0];
    if (t2) meta.date = t2.s;
  }

  return { rows, cols, meta };
}

async function parseInvoicePdf(data: Uint8Array, imgToUrl: (obj: any) => Promise<string>) {
  if (typeof window === 'undefined') return { meta: {}, items: [] as ParsedInvoiceItem[] };

  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF reader failed to load. Check your internet connection and reload the page.');

  const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  const items: any[] = [];
  const meta: { billNo?: string; date?: string } = {};
  let cols: any = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const res = await parseInvoicePage(pdfjsLib, page, imgToUrl, cols);
    cols = res.cols;
    if (res.meta.billNo && !meta.billNo) meta.billNo = res.meta.billNo;
    if (res.meta.date && !meta.date) meta.date = res.meta.date;
    res.rows.forEach((r: any) => items.push(r));
  }

  return {
    meta,
    items: items.map((r) => ({
      itemCode: r.itemCode || '',
      design: r.design || '',
      description: r.description || '',
      qty: r.qty || 1,
      kt: r.kt || '',
      gwt: r.gwt || 0,
      nwt: r.nwt || 0,
      dShape: r.dShape || '',
      dSize: r.dSize || '',
      dPcs: r.dPcs || 0,
      dWt: r.dWt || 0,
      amount: r.amount || 0,
      img: r.img || '',
    })),
  };
}

const loadPdfJs = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);

  const win = window as any;
  if (win.pdfjsLib) return Promise.resolve(win.pdfjsLib);
  if (win.__kdPdfJsPromise) return win.__kdPdfJsPromise;

  win.__kdPdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if (win.pdfjsLib) resolve(win.pdfjsLib);
      else reject(new Error('PDF.js failed to load.'));
    };
    script.onerror = () => reject(new Error('PDF.js failed to load.'));
    document.body.appendChild(script);
  });

  return win.__kdPdfJsPromise;
};

const imgToUrl = async (o: any) => {
  if (!o) return '';

  const w = o.width || 1;
  const h = o.height || 1;
  const scale = Math.min(1, 900 / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (o.bitmap) {
    ctx.drawImage(o.bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  if (!tctx) return '';

  const id = tctx.createImageData(w, h);
  const out = id.data;
  const d = o.data;

  if (o.kind === 3) {
    out.set(d);
  } else if (o.kind === 2) {
    for (let i = 0, j = 0; i < d.length; i += 3, j += 4) {
      out[j] = d[i];
      out[j + 1] = d[i + 1];
      out[j + 2] = d[i + 2];
      out[j + 3] = 255;
    }
  } else {
    const rb = (w + 7) >> 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = ((d[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0;
        const p = (y * w + x) * 4;
        out[p] = out[p + 1] = out[p + 2] = v;
        out[p + 3] = 255;
      }
    }
  }

  tctx.putImageData(id, 0, 0);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
};

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [markup, setMarkup] = useState(0);
  const [gstPct, setGstPct] = useState(0);
  const [shop, setShop] = useState('');
  const [cust, setCust] = useState('');
  const [billno, setBillno] = useState('');
  const [date, setDate] = useState('');
  const [showPhoto, setShowPhoto] = useState(true);
  const [showWt, setShowWt] = useState(true);
  const [showDia, setShowDia] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [statusErr, setStatusErr] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copyFallbackText, setCopyFallbackText] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedMarkup = load(STORAGE_KEYS.markup);
    const savedGst = load(STORAGE_KEYS.gst);
    const savedShop = load(STORAGE_KEYS.shop);

    setDate(getTodayInputDate());
    setMarkup(parseStoredNumber(savedMarkup));
    setGstPct(parseStoredNumber(savedGst));
    if (savedShop) setShop(savedShop);
  }, []);

  useEffect(() => {
    store(STORAGE_KEYS.markup, String(markup));
    store(STORAGE_KEYS.gst, String(gstPct));
    if (shop) store(STORAGE_KEYS.shop, shop);
  }, [markup, gstPct, shop]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDragging) root.style.setProperty('--drop-bg', '#e0f1ef');
    else root.style.removeProperty('--drop-bg');
  }, [isDragging]);

  const picked = useMemo(() => items.filter((it) => it.sel), [items]);

  const totals = useMemo(() => {
    const sub = picked.reduce((sum, item) => sum + lineAmt(item), 0);
    const gst = (sub * gstPct) / 100;
    return { sub, gst, total: sub + gst };
  }, [picked, gstPct]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;

    return items.filter((it) => {
      const hay = `${it.design} ${it.description} ${it.itemCode} ${it.kt}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, search]);

  const selectedCount = picked.length;

  const addItems = (list: ParsedInvoiceItem[], billNo: string, sample: boolean) => {
    setItems((prev) => {
      const startId = prev.reduce((max, item) => Math.max(max, item.id), 0) + 1;

      return [
        ...prev,
        ...list.map((r, idx) => ({
          id: startId + idx,
          billNo: billNo || '',
          sample: !!sample,
          itemCode: r.itemCode,
          design: r.design,
          description: r.description,
          qty: r.qty || 1,
          kt: r.kt,
          gwt: r.gwt,
          nwt: r.nwt,
          dShape: r.dShape,
          dSize: r.dSize,
          dPcs: r.dPcs,
          dWt: r.dWt,
          amount: r.amount,
          img: r.img || '',
          sel: false,
          bq: r.qty || 1,
          price: null,
        })),
      ];
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;

    for (const file of fileList) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        setStatus(`${file.name} is not a PDF.`);
        setStatusErr(true);
        continue;
      }

      setStatus(`Reading ${file.name}…`);
      setStatusErr(false);

      try {
        const pdfjsLib = await loadPdfJs();
        if (!pdfjsLib) throw new Error('PDF reader failed to load. Check your internet connection and reload the page.');

        const buf = new Uint8Array(await file.arrayBuffer());
        const parsed = await parseInvoicePdf(buf, imgToUrl);

        if (!parsed.items.length) {
          setStatus(`No items were found in ${file.name}. This tool reads text-based invoices like the Shree Tulsi Jewel format. Scanned pages cannot be read.`);
          setStatusErr(true);
          continue;
        }

        const fresh = parsed.items.filter((r) => !items.some((x) => x.billNo === (parsed.meta.billNo || '') && x.itemCode === r.itemCode));
        if (!fresh.length) {
          setStatus(`${file.name} is already added.`);
          setStatusErr(true);
          continue;
        }

        addItems(fresh, parsed.meta.billNo || '', false);
        setStatus(`Added ${fresh.length} item${fresh.length === 1 ? '' : 's'}. Tick the ones for your customer.`);
      } catch (err: any) {
        setStatus(`Could not read ${file.name}. ${err?.message || ''}`);
        setStatusErr(true);
      }
    }
  };

  const buildBillHtml = () => {
    const lines = picked
      .map((it, n) => `
        <tr>
          <td>${n + 1}</td>
          ${showPhoto && it.img ? `<td><img src="${it.img}" alt="" /></td>` : '<td></td>'}
          <td>
            <strong>${(it.design || it.itemCode).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong><br />
            <span>${(it.description || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}${showWt && it.kt ? ` · ${it.kt}` : ''}</span>
          </td>
          ${showWt ? `<td class="r">${it.nwt.toFixed(3)}</td>` : ''}
          ${showDia ? `<td class="r">${it.dPcs ? `${it.dPcs} pcs<br /><span>${it.dWt.toFixed(3)} ct</span>` : '—'}</td>` : ''}
          <td class="r">${it.bq}</td>
          <td class="r">${inr(unitPrice(it))}</td>
          <td class="r">${inr(lineAmt(it))}</td>
        </tr>
      `)
      .join('');

    return `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${(shop || 'Customer Bill').replace(/&/g, '&amp;')}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 32px; color: #182022; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #182022; padding-bottom: 12px; margin-bottom: 18px; }
            .meta { text-align: right; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 14px; }
            th, td { border-bottom: 1px solid #d9e1e2; padding: 10px 8px; text-align: left; vertical-align: top; }
            .r { text-align: right; }
            .totals { margin-top: 16px; margin-left: auto; width: min(320px, 100%); }
            .totals div { display: flex; justify-content: space-between; margin: 8px 0; }
            .grand { font-weight: 700; font-size: 18px; border-top: 2px solid #182022; padding-top: 10px; }
            img { width: 90px; height: 72px; object-fit: contain; background: #fff; }
            span { color: #5a6a6d; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h2>${(shop || 'Your shop name').replace(/&/g, '&amp;')}</h2>
              <div>Estimate for ${(cust || 'customer').replace(/&/g, '&amp;')}</div>
            </div>
            <div class="meta">
              <div>Bill no. <strong>${(billno || '—').replace(/&/g, '&amp;')}</strong></div>
              <div>Date <strong>${date ? date.split('-').reverse().join('-') : '—'}</strong></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                ${showPhoto ? '<th>Photo</th>' : ''}
                <th>Item</th>
                ${showWt ? '<th class="r">Net wt (g)</th>' : ''}
                ${showDia ? '<th class="r">Diamond</th>' : ''}
                <th class="r">Qty</th>
                <th class="r">Rate</th>
                <th class="r">Amount</th>
              </tr>
            </thead>
            <tbody>${lines}</tbody>
          </table>

          <div class="totals">
            <div><span>Subtotal</span><span>${inr(totals.sub)}</span></div>
            ${gstPct > 0 ? `<div><span>GST ${gstPct}%</span><span>${inr(totals.gst)}</span></div>` : ''}
            <div class="grand"><span>Total</span><span>${inr(totals.total)}</span></div>
          </div>
        </body>
      </html>
    `;
  };

  const handleBillPreview = () => {
    if (!picked.length) {
      setStatus('Tick at least one item first.');
      setStatusErr(true);
      return;
    }

    setPreviewHtml(buildBillHtml());
    setIsPreviewOpen(true);
  };

  const handleDownloadBill = () => {
    if (!picked.length) {
      setStatus('Tick at least one item first.');
      setStatusErr(true);
      return;
    }

    const blob = new Blob([buildBillHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(shop || 'customer-bill').replace(/\s+/g, '-').toLowerCase()}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Customer bill downloaded.');
    setStatusErr(false);
  };

  const handleCopyRows = async () => {
    if (!picked.length) {
      setStatus('Tick at least one item first.');
      setStatusErr(true);
      return;
    }

    const lines = [['Sr', 'Design', 'Description', 'KT', 'Net wt (g)', 'Diamond pcs', 'Diamond wt (ct)', 'Qty', 'Rate', 'Amount'].join('\t')];
    picked.forEach((it, n) => {
      lines.push([n + 1, it.design, it.description, it.kt, it.nwt.toFixed(3), it.dPcs || 0, (it.dWt || 0).toFixed(3), it.bq, unitPrice(it), lineAmt(it)].join('\t'));
    });

    const text = lines.join('\n');
    const fallback = () => {
      setCopyFallbackText(text);
      requestAnimationFrame(() => {
        if (fallbackRef.current) {
          fallbackRef.current.hidden = false;
          fallbackRef.current.focus();
          fallbackRef.current.select();
        }
      });
      setStatus('Press Ctrl+C (Cmd+C on Mac) to copy, then paste into Google Sheets.');
      setStatusErr(false);
    };

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyFallbackText('');
        if (fallbackRef.current) fallbackRef.current.hidden = true;
        setStatus(`Copied ${picked.length} rows. Click a cell in Google Sheets and paste.`);
        setStatusErr(false);
        return;
      }
      fallback();
    } catch {
      fallback();
    }
  };

  const clearAllItems = () => {
    setItems([]);
    setStatus('All items cleared. Add a PDF to start.');
    setStatusErr(false);
  };

  const updateItem = (id: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  };

  const setAllSelected = (selected: boolean) => {
    setItems((prev) => prev.map((item) => ({ ...item, sel: selected })));
  };

  const renderBillHeader = () => (
    <div className="company-header">
      <div className="logo-box">
        <div className="company-logo-placeholder">
          <span>KD</span>
        </div>
      </div>

      <div className="company-meta">
        <h2 className="company-name">{shop || 'KAYS DIAMONDS'}</h2>
        <div className="company-info-line">G-1111, Surat Diamond Bourse, Surat, Gujarat, 395007</div>
        <div className="company-info-line">Contact: +91 823 7682001</div>
        <div className="company-info-line">GSTIN: 24EEFPG4417A1Z5</div>
        <div className="company-info-line website">website: <a href="https://www.kaysdiamonds.com" target="_blank" rel="noreferrer">www.kaysdiamonds.com</a></div>
      </div>
    </div>
  );

  return (
    <>
      <style jsx>{`
        :root {
          --bg: #f4f6f6;
          --surface: #ffffff;
          --fg: #182022;
          --muted: #5a6a6d;
          --line: #d9e1e2;
          --accent: #0e6a65;
          --accent-fg: #ffffff;
          --accent-soft: #e0f1ef;
          --photo-bg: #ffffff;
          --danger: #a3361f;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
          font-family: Inter, system-ui, sans-serif;
          background: var(--bg);
          color: var(--fg);
        }
        .wrap {
          max-width: 1080px;
          margin: 0 auto;
          padding: 24px 16px 96px;
        }
        h1, h2, h3 { margin: 0; font-family: 'Space Grotesk', 'Inter', sans-serif; }
        .lede { color: var(--muted); margin-top: 8px; }
        .step { display: flex; flex-direction: column; gap: 14px; }
        .drop {
          display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; padding: 18px; border: 1.5px dashed var(--line); border-radius: 12px; background: var(--surface);
        }
        .drop.over { border-color: var(--accent); background: var(--accent-soft); }
        .drop strong { font-size: 16px; }
        .drop .grow { flex: 1 1 260px; }
        .drop .sub { color: var(--muted); font-size: 13.5px; }
        .btn {
          border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 8px 14px; font-weight: 500; cursor: pointer;
        }
        .btn:hover { border-color: var(--accent); }
        .btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
        .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
        .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--muted); font-size: 12.5px; }
        .search { flex: 1 1 200px; }
        .small { width: 120px; }
        input[type='text'], input[type='number'], input[type='search'], input[type='date'] {
          background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; width: 100%;
        }
        input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--accent); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
        .card {
          background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;
        }
        .card.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .pick { display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; font-weight: 600; border-bottom: 1px solid var(--line); }
        .ph { background: var(--photo-bg); aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; }
        .ph img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .meta { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .meta h3 { font-size: 17px; }
        .desc { color: var(--muted); font-size: 13.5px; margin: 0; }
        .facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: 13px; }
        .facts dt { color: var(--muted); }
        .facts dd { margin: 0; text-align: right; }
        .ctl { display: none; grid-template-columns: 1fr 1fr; gap: 10px; padding-top: 4px; }
        .card.on .ctl { display: grid; }
        .chip { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); }
        .setup { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
        .toggles { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13.5px; }
        .toggles label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .hint { color: var(--muted); font-size: 13px; margin: 0; }
        .section-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
        .section-head p { margin: 0; color: var(--muted); font-size: 13.5px; }
        .bill { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 22px; min-width: 0; }
        .bill-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; padding-bottom: 14px; border-bottom: 2px solid var(--fg); }
        .bill-head h2 { font-size: 22px; }
        .bill-head .r { text-align: right; font-size: 13.5px; }
        .bill-head .to { margin-top: 4px; color: var(--muted); font-size: 14px; }
        .bill-wide { overflow-x: auto; margin-top: 4px; }
        table.lines { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 520px; }
        table.lines th { text-align: left; font-size: 11.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); padding: 10px 8px; border-bottom: 1px solid var(--line); font-weight: 600; }
        table.lines td { padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        table.lines .r { text-align: right; }
        table.lines td.pic { width: 110px; }
        table.lines td.pic img { width: 100px; height: 72px; object-fit: contain; background: var(--photo-bg); display: block; border-radius: 4px; }
        .d { font-weight: 600; }
        .s { color: var(--muted); font-size: 12.5px; }
        .totals { margin-left: auto; width: min(320px, 100%); padding-top: 14px; display: flex; flex-direction: column; gap: 6px; }
        .totals div { display: flex; justify-content: space-between; gap: 12px; }
        .totals .grand { font-size: 20px; font-weight: 700; border-top: 2px solid var(--fg); padding-top: 8px; margin-top: 4px; }
        .empty { padding: 28px 12px; text-align: center; color: var(--muted); }
        .bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--line); padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px)); }
        .bar-in { max-width: 1080px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .bar b { font-size: 18px; }
        #status { font-size: 13.5px; min-height: 20px; }
        #status.err { color: var(--danger); }
        #fallback { width: 100%; min-height: 110px; font: 12px/1.4 ui-monospace, Menlo, monospace; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px; color: var(--fg); }
        .preview-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(10, 15, 18, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 50;
        }
        .preview-modal {
          width: min(980px, 100%);
          max-height: 90vh;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
          overflow: hidden;
        }
        .preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid var(--line);
        }
        .preview-header h3 { font-size: 18px; }
        .preview-frame {
          width: 100%;
          height: 70vh;
          border: 0;
          background: #fff;
        }
        .preview-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 20px;
          border-top: 1px solid var(--line);
          background: #fafbfb;
        }
        @media (max-width: 700px) { .ctl { grid-template-columns: 1fr; } }
        @media print {
          body { background: #fff; }
          .bar { display: none !important; }
          .bill { border: 0 !important; background: #fff !important; }
          .bill, .bill * { color: #000 !important; }
        }

        .company-header {
          display: grid;
          grid-template-columns: 180px minmax(0, 1fr);
          align-items: center;
          gap: 18px;
          border: 2px solid #000;
          border-bottom: 0;
          padding: 18px 20px 12px;
          background: #f7f7f7;
        }
        .logo-box {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 140px;
        }
        .company-logo {
          width: 140px;
          height: 140px;
          object-fit: contain;
          display: block;
        }
        .logo-placeholder {
          width: 140px;
          height: 140px;
          border: 2px dashed #3f3f3f;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #333;
          font-weight: 700;
          text-align: center;
          padding: 10px;
          background: #fff;
        }
        .company-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .company-name {
          font-size: clamp(2rem, 3vw, 4rem);
          font-weight: 900;
          letter-spacing: 1px;
          margin: 0;
          line-height: 1.05;
          text-transform: uppercase;
        }
        .company-info-line {
          font-size: 17px;
          color: #111;
          line-height: 1.35;
          font-weight: 500;
        }
        .company-info-line.website {
          color: #0d3cdd;
          font-weight: 700;
        }
        .company-info-line a {
          color: #0d3cdd;
          text-decoration: none;
        }
        .invoice-banner {
          background: #d9d9d9;
          border: 2px solid #000;
          border-top: 0;
          border-bottom: 0;
          text-align: center;
          font-weight: 900;
          font-size: 18px;
          letter-spacing: 0.08em;
          padding: 10px 12px;
          text-transform: uppercase;
        }
        .invoice-detail-box {
          border: 2px solid #000;
          border-top: 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          background: #fff;
        }
        .detail-panel {
          padding: 18px 20px;
          min-height: 180px;
        }
        .detail-panel + .detail-panel {
          border-left: 2px solid #000;
        }
        .detail-panel h3 {
          font-size: 18px;
          margin: 0 0 18px;
          font-weight: 800;
          text-transform: none;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
          font-size: 18px;
          font-weight: 700;
        }
        .detail-row span:first-child {
          font-weight: 700;
        }
        .detail-row span:last-child {
          font-weight: 700;
          text-align: right;
        }
        .detail-label {
          font-weight: 700;
        }
        .detail-value {
          font-weight: 700;
        }
      `}</style>

      <div className="wrap">
        <header>
          <h1>Jewel Bill Builder</h1>
          <p className="lede">Upload the manufacturer&apos;s invoice PDF. Every item shows with its photo. Tick the pieces you are selling, set your price, and the customer bill builds itself.</p>
        </header>

        <section className="step">
          <div
            className={`drop ${isDragging ? 'over' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              const next = e.relatedTarget as Node | null;
              if (!e.currentTarget.contains(next)) setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="grow">
              <strong>1. Add the manufacturer&apos;s PDF</strong>
              <div className="sub">Drop one or more PDFs here. They are read inside your browser and are not uploaded anywhere.</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              id="file"
              onChange={(e) => {
                const list = e.target.files;
                if (list) handleFiles(list);
                e.target.value = '';
              }}
            />
            <button className="btn primary" type="button" onClick={() => fileInputRef.current?.click()}>Choose PDF</button>
            <button className="btn" type="button" onClick={clearAllItems}>Clear all items</button>
          </div>
          <div id="status" className={statusErr ? 'err' : ''}>{status}</div>
        </section>

        <section className="step">
          <div className="section-head">
            <h2>2. Tick the items for this bill</h2>
            <p>{items.length ? `${picked.length} ticked · ${filteredItems.length} of ${items.length} shown` : ''}</p>
          </div>

          <div className="toolbar">
            <label className="field search">
              Search
              <input type="search" placeholder="Design code or type, e.g. ring" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="field small">
              Markup %
              <input
                type="number"
                min="0"
                step="0.5"
                value={markup}
                onChange={(e) => {
                  const v = Math.max(0, Number.parseFloat(e.target.value) || 0);
                  setMarkup(v);
                  store(STORAGE_KEYS.markup, String(v));
                }}
              />
            </label>
            <button className="btn" type="button" onClick={() => setAllSelected(true)}>Tick all shown</button>
            <button className="btn" type="button" onClick={() => setAllSelected(false)}>Untick all</button>
          </div>

          <div className="grid">
            {items.length === 0 ? (
              <div className="empty" style={{ gridColumn: '1 / -1' }}>No items yet. Add a manufacturer PDF above and its items will appear here with their photos.</div>
            ) : (
              filteredItems.map((it) => (
                <article key={it.id} className={`card${it.sel ? ' on' : ''}`} data-id={it.id}>
                  <label className="pick">
                    <input
                      type="checkbox"
                      className="sel"
                      checked={it.sel}
                      onChange={(e) => updateItem(it.id, { sel: e.target.checked })}
                    />
                    <span>Add to bill</span>
                  </label>
                  <div className="ph">
                    {it.img ? <img alt={it.design || it.itemCode} src={it.img} /> : <span>No photo found</span>}
                  </div>
                  <div className="meta">
                    <div>
                      <h3>
                        {it.design || it.itemCode}
                        {it.sample ? <span className="chip">Sample</span> : null}
                      </h3>
                      <p className="desc">
                        {it.description}
                        {it.kt ? ` · ${it.kt}` : ''}
                      </p>
                    </div>
                    <dl className="facts num">
                      <dt>Net weight</dt>
                      <dd>{it.nwt.toFixed(3)} g</dd>
                      <dt>Diamond</dt>
                      <dd>{it.dPcs ? `${it.dPcs} pcs · ${it.dWt.toFixed(3)} ct` : 'none'}</dd>
                      <dt>Manufacturer price</dt>
                      <dd>
                        {inr(it.amount)}
                        {it.qty > 1 ? ` for ${it.qty}` : ''}
                      </dd>
                      {it.billNo ? (
                        <>
                          <dt>Invoice</dt>
                          <dd>{it.billNo}</dd>
                        </>
                      ) : null}
                    </dl>
                    <div className="ctl">
                      <label className="field">
                        Qty
                        <input
                          type="number"
                          className="bq"
                          min="1"
                          step="1"
                          value={it.bq}
                          onChange={(e) => {
                            const nextQty = Math.max(1, Number.parseInt(e.target.value, 10) || 1);
                            updateItem(it.id, { bq: nextQty });
                          }}
                        />
                      </label>
                      <label className="field">
                        Your price each (₹)
                        <input
                          type="number"
                          className="pr"
                          min="0"
                          step="1"
                          value={unitPrice(it)}
                          onChange={(e) => {
                            const value = Number.parseFloat(e.target.value);
                            updateItem(it.id, { price: Number.isNaN(value) ? null : Math.max(0, value) });
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="step" id="billSec">
          <div className="section-head">
            <h2>3. Customer bill</h2>
            <p>Prices start from the manufacturer&apos;s amount plus your markup. Change any price on its card.</p>
          </div>

          <div className="setup">
            <label className="field">
              Your shop name
              <input type="text" placeholder="Shop name" value={shop} onChange={(e) => { setShop(e.target.value); store(STORAGE_KEYS.shop, e.target.value); }} />
            </label>
            <label className="field">
              Customer
              <input type="text" placeholder="Customer name" value={cust} onChange={(e) => setCust(e.target.value)} />
            </label>
            <label className="field">
              Bill no.
              <input type="text" placeholder="e.g. 101" value={billno} onChange={(e) => setBillno(e.target.value)} />
            </label>
            <label className="field">
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              GST %
              <input
                type="number"
                min="0"
                step="0.1"
                value={gstPct}
                onChange={(e) => {
                  const v = Math.max(0, Number.parseFloat(e.target.value) || 0);
                  setGstPct(v);
                  store(STORAGE_KEYS.gst, String(v));
                }}
              />
            </label>
          </div>

          <div className="toggles">
            <label><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /> Photos</label>
            <label><input type="checkbox" checked={showWt} onChange={(e) => setShowWt(e.target.checked)} /> Karat and net weight</label>
            <label><input type="checkbox" checked={showDia} onChange={(e) => setShowDia(e.target.checked)} /> Diamond details</label>
          </div>

          <div className="actions">
            <button className="btn primary" type="button" onClick={handleCopyRows}>Copy rows for Google Sheets</button>
            <button className="btn" type="button" onClick={handleBillPreview}>Preview bill</button>
            <button className="btn" type="button" onClick={handleDownloadBill}>Download bill</button>
            <p className="hint">To print or save as PDF, use your browser&apos;s print (Ctrl+P, or Cmd+P on Mac). Only the bill is printed.</p>
          </div>

          <textarea ref={fallbackRef} id="fallback" hidden readOnly value={copyFallbackText} onChange={(e) => setCopyFallbackText(e.target.value)} />

          <article className="bill" id="bill">
            {picked.length === 0 ? (
              <div className="empty">Tick items above and they will be listed here.</div>
            ) : (
              <>
                {renderBillHeader()}

                <div className="bill-head">
                  <div>
                    <label className="field" style={{ minWidth: 220 }}>
                      <span>Shop name</span>
                      <input type="text" value={shop} onChange={(e) => setShop(e.target.value)} />
                    </label>
                    <div className="to">Estimate for</div>
                    <label className="field" style={{ minWidth: 220, marginTop: 6 }}>
                      <span>Customer</span>
                      <input type="text" value={cust} onChange={(e) => setCust(e.target.value)} />
                    </label>
                  </div>
                  <div className="r num">
                    <label className="field" style={{ minWidth: 150, textAlign: 'left' }}>
                      <span>Bill no.</span>
                      <input type="text" value={billno} onChange={(e) => setBillno(e.target.value)} />
                    </label>
                    <label className="field" style={{ minWidth: 150, marginTop: 8, textAlign: 'left' }}>
                      <span>Date</span>
                      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </label>
                  </div>
                </div>

                <div className="bill-wide">
                  <table className="lines">
                    <thead>
                      <tr>
                        <th>#</th>
                        {showPhoto ? <th>Photo</th> : null}
                        <th>Item</th>
                        {showWt ? <th className="r">Net wt (g)</th> : null}
                        {showDia ? <th className="r">Diamond</th> : null}
                        <th className="r">Qty</th>
                        <th className="r">Rate</th>
                        <th className="r">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picked.map((it, n) => (
                        <tr key={it.id}>
                          <td className="num">{n + 1}</td>
                          {showPhoto ? <td className="pic">{it.img ? <img alt="" src={it.img} /> : null}</td> : null}
                          <td>
                            <div className="d">{it.design || it.itemCode}</div>
                            <div className="s">
                              {it.description}
                              {showWt && it.kt ? ` · ${it.kt}` : ''}
                            </div>
                          </td>
                          {showWt ? <td className="r num">{it.nwt.toFixed(3)}</td> : null}
                          {showDia ? (
                            <td className="r num">
                              {it.dPcs ? (
                                <>
                                  {it.dPcs} pcs
                                  <div className="s">{it.dWt.toFixed(3)} ct</div>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          ) : null}
                          <td className="r num">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={it.bq}
                              onChange={(e) => {
                                const nextQty = Math.max(1, Number.parseInt(e.target.value, 10) || 1);
                                updateItem(it.id, { bq: nextQty });
                              }}
                              style={{ width: 72 }}
                            />
                          </td>
                          <td className="r num">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={unitPrice(it)}
                              onChange={(e) => {
                                const value = Number.parseFloat(e.target.value);
                                updateItem(it.id, { price: Number.isNaN(value) ? null : Math.max(0, value) });
                              }}
                              style={{ width: 96 }}
                            />
                          </td>
                          <td className="r num">{inr(lineAmt(it))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="totals num">
                  <div><span>Subtotal</span><span>{inr(totals.sub)}</span></div>
                  {gstPct > 0 ? <div><span>GST {gstPct}%</span><span>{inr(totals.gst)}</span></div> : null}
                  <div className="grand"><span>Total</span><span>{inr(totals.total)}</span></div>
                </div>
              </>
            )}
          </article>
        </section>
      </div>

      <div className="bar">
        <div className="bar-in">
          <div>
            <span>{selectedCount} item{selectedCount === 1 ? '' : 's'}</span> &middot; <b className="num">{inr(totals.total)}</b>
          </div>
        </div>
      </div>

      {isPreviewOpen ? (
        <div className="preview-backdrop" onClick={() => setIsPreviewOpen(false)}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <h3>Customer bill preview</h3>
              <button className="btn" type="button" onClick={() => setIsPreviewOpen(false)}>Close</button>
            </div>
            <iframe title="Customer bill preview" srcDoc={previewHtml} className="preview-frame" />
            <div className="preview-actions">
              <button className="btn" type="button" onClick={() => setIsPreviewOpen(false)}>Back</button>
              <button className="btn primary" type="button" onClick={handleDownloadBill}>Download</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}