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
    <div className="w-full overflow-hidden border-[3px] border-black bg-white">
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-6 border-b-[3px] border-black bg-[#f7f7f7] px-5 py-4">
        <div className="flex items-center justify-center">
          <img src="/kd-logo.png" alt="Kays Diamonds logo" className="h-[140px] w-[140px] object-contain" />
        </div>

        <div className="min-w-0">
          <h2 className="text-[clamp(2rem,3vw,4rem)] font-black uppercase tracking-tight text-black">{shop || 'KAYS DIAMONDS'}</h2>
          <div className="mt-2 text-lg font-medium text-black">G-1111, Surat Diamond Bourse, Surat, Gujarat, 395007</div>
          <div className="mt-1 text-lg font-medium text-black">Contact: +91 823 7682001</div>
          <div className="mt-1 text-lg font-medium text-black">GSTIN: 24EEFPG4417A1Z5</div>
          <div className="mt-2 text-lg font-bold text-blue-700 underline decoration-blue-700 underline-offset-2">
            website: <a href="https://www.kaysdiamonds.com" target="_blank" rel="noreferrer" className="text-blue-700">www.kaysdiamonds.com</a>
          </div>
        </div>
      </div>

      <div className="bg-[#d9d9d9] border-b-[3px] border-black px-3 py-3 text-center text-3xl font-black uppercase tracking-[0.08em] text-black">
        Invoice
      </div>

      <div className="grid grid-cols-2 border-b-[3px] border-black bg-white">
        <div className="border-r-[3px] border-black p-5">
          <h3 className="mb-5 text-2xl font-extrabold text-black">Client Details</h3>
          <div className="space-y-4 text-xl font-bold text-black">
            <div className="flex items-center justify-between gap-4">
              <span>Client Name:</span>
              <input type="text" value={cust} onChange={(e) => setCust(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" placeholder="CG" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Phone:</span>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" placeholder="Phone" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Address:</span>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" placeholder="Address" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Email id:</span>
              <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" placeholder="Email" />
            </div>
          </div>
        </div>

        <div className="p-5">
          <h3 className="mb-5 text-2xl font-extrabold text-black">Invoice Details</h3>
          <div className="space-y-4 text-xl font-bold text-black">
            <div className="flex items-center justify-between gap-4">
              <span>Inv No.:</span>
              <input type="text" value={billno} onChange={(e) => setBillno(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" placeholder="26 27 9071" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Date:</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Due Date:</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-2/3 rounded border border-slate-300 bg-white px-2 py-1 text-right text-base font-semibold text-slate-800 outline-none focus:border-teal-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="mx-auto max-w-[1080px] px-4 pb-24 pt-6">
        <header className="mb-6">
          <h1 className="text-3xl font-black uppercase tracking-tight text-black">Jewel Bill Builder</h1>
          <p className="mt-2 text-sm text-slate-600">Upload the manufacturer&apos;s invoice PDF. Every item shows with its photo. Tick the pieces you are selling, set your price, and the customer bill builds itself.</p>
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
              <strong className="block text-base font-semibold text-slate-900">1. Add the manufacturer&apos;s PDF</strong>
              <div className="text-sm text-slate-500">Drop one or more PDFs here. They are read inside your browser and are not uploaded anywhere.</div>
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
            <label className="w-[120px] text-xs font-medium uppercase tracking-wide text-slate-500">
              Markup %
              <input type="number" min="0" step="0.5" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" value={markup} onChange={(e) => { const v = Math.max(0, Number.parseFloat(e.target.value) || 0); setMarkup(v); store(STORAGE_KEYS.markup, String(v)); }} />
            </label>
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-teal-500 hover:text-teal-700" type="button" onClick={() => setAllSelected(true)}>Tick all shown</button>
            <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-teal-500 hover:text-teal-700" type="button" onClick={() => setAllSelected(false)}>Untick all</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">No items yet. Add a manufacturer PDF above and its items will appear here with their photos.</div>
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
            <p className="text-sm text-slate-500">Prices start from the manufacturer&apos;s amount plus your markup. Change any price on its card.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Your shop name
              <input type="text" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" placeholder="Shop name" value={shop} onChange={(e) => { setShop(e.target.value); store(STORAGE_KEYS.shop, e.target.value); }} />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Customer
              <input type="text" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" placeholder="Customer name" value={cust} onChange={(e) => setCust(e.target.value)} />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bill no.
              <input type="text" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" placeholder="e.g. 101" value={billno} onChange={(e) => setBillno(e.target.value)} />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Date
              <input type="date" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              GST %
              <input type="number" min="0" step="0.1" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-500" value={gstPct} onChange={(e) => { const v = Math.max(0, Number.parseFloat(e.target.value) || 0); setGstPct(v); store(STORAGE_KEYS.gst, String(v)); }} />
            </label>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Photos</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showWt} onChange={(e) => setShowWt(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Karat and net weight</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showDia} onChange={(e) => setShowDia(e.target.checked)} className="h-4 w-4 accent-teal-600" /> Diamond details</label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-800" type="button" onClick={handleCopyRows}>Copy rows for Google Sheets</button>
          </div>

          <textarea ref={fallbackRef} className="hidden w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800" readOnly value={copyFallbackText} onChange={(e) => setCopyFallbackText(e.target.value)} />

          <article className="overflow-hidden border-[3px] border-black bg-white" id="print-invoice">
            {picked.length === 0 ? (
              <div className="p-10 text-center text-slate-500">Tick items above and they will be listed here.</div>
            ) : (
              <>
                {renderBillHeader()}

                <div className="overflow-x-auto border-t-[3px] border-black bg-white">
                  <table className="min-w-[640px] w-full border-collapse text-sm text-slate-800">
                    <thead>
                      <tr className="border-b border-slate-300 bg-slate-100 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-600">
                        <th className="px-3 py-3">#</th>
                        {showPhoto ? <th className="px-3 py-3">Photo</th> : null}
                        <th className="px-3 py-3">Item</th>
                        {showWt ? <th className="px-3 py-3 text-right">Net wt (g)</th> : null}
                        {showDia ? <th className="px-3 py-3 text-right">Diamond</th> : null}
                        <th className="px-3 py-3 text-right">Qty</th>
                        <th className="px-3 py-3 text-right">Rate</th>
                        <th className="px-3 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picked.map((it, n) => (
                        <tr key={it.id} className="border-b border-slate-200 align-top">
                          <td className="px-3 py-3 font-medium">{n + 1}</td>
                          {showPhoto ? <td className="px-3 py-3"><div className="h-[72px] w-[100px] overflow-hidden rounded bg-white">{it.img ? <img alt="" src={it.img} className="h-full w-full object-contain" /> : null}</div></td> : null}
                          <td className="px-3 py-3">
                            <div className="font-bold text-slate-900">{it.design || it.itemCode}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {it.description}
                              {showWt && it.kt ? ` · ${it.kt}` : ''}
                            </div>
                          </td>
                          {showWt ? <td className="px-3 py-3 text-right font-medium">{it.nwt.toFixed(3)}</td> : null}
                          {showDia ? (
                            <td className="px-3 py-3 text-right font-medium">
                              {it.dPcs ? (
                                <>
                                  {it.dPcs} pcs
                                  <div className="text-xs text-slate-500">{it.dWt.toFixed(3)} ct</div>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          ) : null}
                          <td className="px-3 py-3 text-right font-medium">
                            <input type="number" min="1" step="1" value={it.bq} onChange={(e) => { const nextQty = Math.max(1, Number.parseInt(e.target.value, 10) || 1); updateItem(it.id, { bq: nextQty }); }} className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-800 outline-none transition focus:border-teal-500" />
                          </td>
                          <td className="px-3 py-3 text-right font-medium">
                            <input type="number" min="0" step="1" value={unitPrice(it)} onChange={(e) => { const value = Number.parseFloat(e.target.value); updateItem(it.id, { price: Number.isNaN(value) ? null : Math.max(0, value) }); }} className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-right text-sm text-slate-800 outline-none transition focus:border-teal-500" />
                          </td>
                          <td className="px-3 py-3 text-right font-medium">{inr(lineAmt(it))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="ml-auto mt-4 w-full max-w-[320px] space-y-2 px-3 pb-5 pt-2 text-base text-slate-800">
                  <div className="flex items-center justify-between"><span>Subtotal</span><span>{inr(totals.sub)}</span></div>
                  {gstPct > 0 ? <div className="flex items-center justify-between"><span>GST {gstPct}%</span><span>{inr(totals.gst)}</span></div> : null}
                  <div className="flex items-center justify-between border-t border-black pt-2 text-lg font-black"><span>Total</span><span>{inr(totals.total)}</span></div>
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