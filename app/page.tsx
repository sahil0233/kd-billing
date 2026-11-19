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
  phone: 'phone',
  address: 'address',
  email: 'email',
  dueDate: 'dueDate',
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

function amountInWords(value: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const belowHundred = (n: number): string => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;
  const belowThousand = (n: number): string => `${n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${n % 100 ? belowHundred(n % 100) : ''}`;

  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'Zero Rupees Only';

  const parts: string[] = [];
  if (n >= 10000000) { parts.push(`${belowThousand(Math.floor(n / 10000000))} Crore`); n %= 10000000; }
  if (n >= 100000) { parts.push(`${belowHundred(Math.floor(n / 100000))} Lakh`); n %= 100000; }
  if (n >= 1000) { parts.push(`${belowHundred(Math.floor(n / 1000))} Thousand`); n %= 1000; }
  if (n >= 1) parts.push(belowThousand(n));

  return `${parts.join(' ')} Rupees Only`;
}

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [markup, setMarkup] = useState(0);
  const [gstPct, setGstPct] = useState(0);
  const [shop, setShop] = useState('');
  const [cust, setCust] = useState('');
  const [billno, setBillno] = useState('');
  const [date, setDate] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showPhoto, setShowPhoto] = useState(true);
  const [showWt, setShowWt] = useState(true);
  const [showDia, setShowDia] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [statusErr, setStatusErr] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copyFallbackText, setCopyFallbackText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedMarkup = load(STORAGE_KEYS.markup);
    const savedGst = load(STORAGE_KEYS.gst);
    const savedShop = load(STORAGE_KEYS.shop);
    const savedPhone = load(STORAGE_KEYS.phone);
    const savedAddress = load(STORAGE_KEYS.address);
    const savedEmail = load(STORAGE_KEYS.email);
    const savedDueDate = load(STORAGE_KEYS.dueDate);

    setDate(getTodayInputDate());
    setMarkup(parseStoredNumber(savedMarkup));
    setGstPct(parseStoredNumber(savedGst));
    if (savedShop) setShop(savedShop);
    if (savedPhone) setPhone(savedPhone);
    if (savedAddress) setAddress(savedAddress);
    if (savedEmail) setEmail(savedEmail);
    if (savedDueDate) setDueDate(savedDueDate);
  }, []);

  useEffect(() => {
    store(STORAGE_KEYS.markup, String(markup));
    store(STORAGE_KEYS.gst, String(gstPct));
    if (shop) store(STORAGE_KEYS.shop, shop);
    if (phone) store(STORAGE_KEYS.phone, phone);
    if (address) store(STORAGE_KEYS.address, address);
    if (email) store(STORAGE_KEYS.email, email);
    if (dueDate) store(STORAGE_KEYS.dueDate, dueDate);
  }, [markup, gstPct, shop, phone, address, email, dueDate]);

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
    <div className="w-full overflow-hidden border-[1.5px] border-black bg-white">
      <div className="grid grid-cols-[175px_minmax(0,1fr)] items-center border-b-[1.5px] border-black px-4 py-3">
        <div className="flex items-center justify-center">
          <img src="/kd-logo.png" alt="Kays Diamonds logo" className="h-[118px] w-[118px] object-contain" />
        </div>

        <div className="min-w-0 text-black">
          <h2 className="text-[31px] leading-none font-black uppercase tracking-tight">{shop || 'KAYS DIAMONDS'}</h2>
          <div className="mt-2 text-[12px] leading-tight font-medium">G-1111, Surat Diamond Bourse, Surat, Gujarat, 395007</div>
          <div className="mt-0.5 text-[12px] leading-tight font-medium">Contact: +91 823 7682001</div>
          <div className="mt-0.5 text-[12px] leading-tight font-medium">GSTIN: 24EEFPG4417A1Z5</div>
          <div className="mt-1 text-[12px] leading-tight font-bold text-black">
            website: <a href="https://www.kaysdiamonds.com" target="_blank" rel="noreferrer" className="underline">www.kaysdiamonds.com</a>
          </div>
        </div>
      </div>

      <div className="border-b-[1.5px] border-black py-1 text-center text-[16px] font-black uppercase tracking-wide text-black">
        Invoice
      </div>

      <div className="grid grid-cols-2 text-[12px] text-black ">
        <div className="border-r-[1.5px] border-black p-3">
          <h3 className="mb-2 text-center text-[12px] font-black">Client Details</h3>
          <div className="space-y-1">
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Client Name:</span><input type="text" value={cust} onChange={(e) => setCust(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none"/></div>
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Phone:</span><input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none"/></div>
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Address:</span><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none"/></div>
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Email id:</span><input type="text" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none"/></div>
          </div>
        </div>

        <div className="p-3">
          <h3 className="mb-2 text-center text-[12px] font-black">Invoice Details</h3>
          <div className="space-y-1">
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Inv No.:</span><input type="text" value={billno} onChange={(e) => setBillno(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] font-bold outline-none" /></div>
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Date:</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none" /></div>
            <div className="grid grid-cols-[82px_1fr] items-center gap-2"><span className="font-bold">Due Date:</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="min-w-0 border-b border-slate-300 px-1 py-0.5 text-[12px] outline-none" /></div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="mx-auto max-w-[1080px] px-4 pb-24 pt-6">
        <header className="mb-6">
          <h1 className="text-3xl font-black uppercase tracking-tight text-black">Kays Diamonds Billing</h1>
        </header>

        <section className="mb-8 space-y-4">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 ${isDragging ? 'border-teal-500 bg-teal-50' : ''}`}
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
            <div className="min-w-[220px] flex-1">
              <strong className="block text-base font-semibold text-slate-900">1. Add PDF</strong>
              <div className="text-sm text-slate-500">Drop one or more PDFs here.</div>
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
            <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium text-slate-800 transition hover:border-teal-500 hover:text-teal-700" type="button" onClick={() => fileInputRef.current?.click()}>Choose PDF</button>
            <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium text-slate-800 transition hover:border-teal-500 hover:text-teal-700" type="button" onClick={clearAllItems}>Clear all items</button>
          </div>
          <div id="status" className={`text-sm ${statusErr ? 'text-red-700' : 'text-slate-600'}`}>{status}</div>
        </section>

        <section className="mb-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-black text-slate-900">2. Tick the items for this bill</h2>
            <p className="text-sm text-slate-500">{items.length ? `${picked.length} ticked · ${filteredItems.length} of ${items.length} shown` : ''}</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Search
              <input type="search" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" placeholder="Design code or type, e.g. ring" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-teal-500 hover:text-teal-700" type="button" onClick={() => setAllSelected(true)}>Tick all shown</button>
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-teal-500 hover:text-teal-700" type="button" onClick={() => setAllSelected(false)}>Untick all</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">No items yet.</div>
            ) : (
              filteredItems.map((it) => (
                <article key={it.id} className={`overflow-hidden rounded-xl border bg-white ${it.sel ? 'border-teal-500 shadow-sm ring-1 ring-teal-500' : 'border-slate-200'}`} data-id={it.id}>
                  <label className="flex cursor-pointer items-center gap-3 border-b border-slate-200 px-3 py-2 font-semibold text-slate-800">
                    <input type="checkbox" checked={it.sel} onChange={(e) => updateItem(it.id, { sel: e.target.checked })} className="h-4 w-4 accent-teal-600" />
                    <span>Add to bill</span>
                  </label>
                  <div className="flex h-40 items-center justify-center bg-white">
                    {it.img ? <img alt={it.design || it.itemCode} src={it.img} className="h-full w-full object-contain" /> : <span className="text-sm text-slate-500">No photo found</span>}
                  </div>
                  <div className="space-y-3 p-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{it.design || it.itemCode}{it.sample ? <span className="ml-2 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-700">Sample</span> : null}</h3>
                      <p className="mt-1 text-sm text-slate-500">{it.description}{it.kt ? ` · ${it.kt}` : ''}</p>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-slate-700">
                      <dt className="text-slate-500">Net weight</dt>
                      <dd className="text-right font-medium">{it.nwt.toFixed(3)} g</dd>
                      <dt className="text-slate-500">Diamond</dt>
                      <dd className="text-right font-medium">{it.dPcs ? `${it.dPcs} pcs · ${it.dWt.toFixed(3)} ct` : 'none'}</dd>
                      <dt className="text-slate-500">Manufacturer price</dt>
                      <dd className="text-right font-medium">{inr(it.amount)}{it.qty > 1 ? ` for ${it.qty}` : ''}</dd>
                      {it.billNo ? (<><dt className="text-slate-500">Invoice</dt><dd className="text-right font-medium">{it.billNo}</dd></>) : null}
                    </dl>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Qty
                        <input type="number" min="1" step="1" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" value={it.bq} onChange={(e) => { const nextQty = Math.max(1, Number.parseInt(e.target.value, 10) || 1); updateItem(it.id, { bq: nextQty }); }} />
                      </label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Your price each (₹)
                        <input type="number" min="0" step="1" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" value={unitPrice(it)} onChange={(e) => { const value = Number.parseFloat(e.target.value); updateItem(it.id, { price: Number.isNaN(value) ? null : Math.max(0, value) }); }} />
                      </label>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="mb-8 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-black text-slate-900">3. Customer bill</h2>
          </div>

          <textarea ref={fallbackRef} className="hidden w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800" readOnly value={copyFallbackText} onChange={(e) => setCopyFallbackText(e.target.value)} />

          <article className="overflow-hidden border-[1.5px] border-black bg-white" id="print-invoice">
            {picked.length === 0 ? (
              <div className="p-10 text-center text-slate-500">Tick items above and they will be listed here.</div>
            ) : (
              <>
                {renderBillHeader()}

                <div className="border-t-[1.5px] border-black">
                  <div className="border-b-[1.5px] border-black bg-white py-1 text-center text-[13px] font-black uppercase text-black">Particulars</div>
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse text-[8px] text-black" style={{ minWidth: '1020px' }}>
                      <thead>
                        <tr className="border-b-[1.5px] border-black bg-[#d9d9d9] text-center font-black">
                          <th className="w-7 border-r border-black px-1 py-1">#</th>
                          {showPhoto ? <th className="w-[52px] border-r border-black px-1 py-1">Design</th> : null}
                          <th className="w-[110px] border-r border-black px-1 py-1 text-left">Item</th>
                          <th className="w-8 border-r border-black px-1 py-1">Qty</th>
                          {showWt ? <>
                            <th className="w-12 border-r border-black px-1 py-1">G. Wt (g)</th>
                            <th className="w-12 border-r border-black px-1 py-1">N. Wt (g)</th>
                            <th className="w-8 border-r border-black px-1 py-1">KT</th>
                            <th className="w-10 border-r border-black px-1 py-1">Fine</th>
                          </> : null}
                          <th className="w-12 border-r border-black px-1 py-1">Making<br />Rate</th>
                          <th className="w-12 border-r border-black px-1 py-1">Making<br />Amt (₹)</th>
                          {showDia ? <>
                            <th className="w-12 border-r border-black px-1 py-1">Shape</th>
                            <th className="w-10 border-r border-black px-1 py-1">Size</th>
                            <th className="w-8 border-r border-black px-1 py-1">Pcs</th>
                            <th className="w-10 border-r border-black px-1 py-1">Wt (ct)</th>
                            <th className="w-12 border-r border-black px-1 py-1">Diamond / Stone Rate</th>
                            <th className="w-12 border-r border-black px-1 py-1">Diamond / Stone Amt</th>
                          </> : null}
                          <th className="w-16 px-1 py-1">Amt (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {picked.map((it, n) => (
                          <tr key={it.id} className="h-[82px] align-top">
                            <td className="border-r border-black px-1 py-2 text-center">{n + 1}</td>
                            {showPhoto ? (
                              <td className="border-r border-black p-1">
                                {it.img ? <img alt="" src={it.img} className="h-[68px] w-[50px] object-contain" /> : null}
                              </td>
                            ) : null}
                            <td className="border-r border-black px-1.5 py-2">
                              <div className="font-black">{it.design || it.itemCode}</div>
                              {it.description ? <div className="mt-1">{it.description}</div> : null}
                            </td>
                            <td className="border-r border-black px-1 py-2 text-right">
                              <input type="number" min="1" step="1" value={it.bq} onChange={(e) => { const nextQty = Math.max(1, Number.parseInt(e.target.value, 10) || 1); updateItem(it.id, { bq: nextQty }); }} className="w-full bg-transparent text-right outline-none" />
                            </td>
                            {showWt ? <>
                              <td className="border-r border-black px-1 py-2 text-right">{it.gwt.toFixed(3)}</td>
                              <td className="border-r border-black px-1 py-2 text-right">{it.nwt.toFixed(3)}</td>
                              <td className="border-r border-black px-1 py-2 text-center">{it.kt || '—'}</td>
                              <td className="border-r border-black px-1 py-2 text-right">—</td>
                            </> : null}
                            <td className="border-r border-black px-1 py-2 text-right">
                              <input type="number" min="0" step="1" value={unitPrice(it)} onChange={(e) => { const value = Number.parseFloat(e.target.value); updateItem(it.id, { price: Number.isNaN(value) ? null : Math.max(0, value) }); }} className="w-full bg-transparent text-right outline-none" />
                            </td>
                            <td className="border-r border-black px-1 py-2 text-right">{inr(unitPrice(it) * it.bq)}</td>
                            {showDia ? <>
                              <td className="border-r border-black px-1 py-2 text-center">{it.dShape || '—'}</td>
                              <td className="border-r border-black px-1 py-2 text-center">{it.dSize || '—'}</td>
                              <td className="border-r border-black px-1 py-2 text-right">{it.dPcs || '—'}</td>
                              <td className="border-r border-black px-1 py-2 text-right">{it.dWt ? it.dWt.toFixed(3) : '—'}</td>
                              <td className="border-r border-black px-1 py-2 text-right">—</td>
                              <td className="border-r border-black px-1 py-2 text-right">—</td>
                            </> : null}
                            <td className="px-1 py-2 text-right font-black">{inr(lineAmt(it))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="border-t-[1.5px] border-black">
                  <div className="grid grid-cols-[1fr_220px] border-t border-black text-[11px]">
                    <div />
                    <div>
                      <div className="flex justify-between border-b border-black px-2 py-1"><span>Total</span><span className="font-black">{inr(totals.sub)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="border-t-[1.5px] border-black">
                  <div className="grid grid-cols-[1fr_220px] text-[11px]">
                    <div className="border-r border-black px-2 py-2"><span className="font-black">Amount in Words - :</span><span className="ml-2">{amountInWords(totals.total)}</span></div>
                  </div>
                  <div className="border-t border-black px-2 py-2 text-[11px]"><span className="font-black">Declaration:</span></div>
                  <div className="grid grid-cols-2 border-t border-black text-center text-[11px]">
                    <div className="h-[72px] border-r-[1.5px] border-black px-3 pb-2 pt-14 font-bold">Client Signature</div>
                    <div className="h-[72px] px-3 pb-2 pt-14 font-bold">Authorised Signatory</div>
                  </div>
                </div>
              </>
            )}
          </article>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 text-sm text-slate-700">
          <div>
            <span>{selectedCount} item{selectedCount === 1 ? '' : 's'}</span> &middot; <b className="font-black text-slate-900">{inr(totals.total)}</b>
          </div>
        </div>
      </div>
    </>
  );
}