import React, { useState, useEffect } from 'react'

export default function CryptoRegistry() {
  const emptyForm = {
    datetime: '',
    network: '',
    account: '',
    type: 'in',
    base: '',
    quote: '',
    qtyBase: '',
    qtyQuote: '',
    priceUSD: '',
    priceBRL: '',
    totalUSD: '',
    totalBRL: '',
    feeAsset: '',
    qtyFee: '',
    feeUSD: '',
    feeBRL: '',
    txid: '',
    notes: ''
  }

  const [form, setForm] = useState(emptyForm)
  const [entries, setEntries] = useState([])
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)

  useEffect(() => {
    const saved = localStorage.getItem('crypto-transaction-log')
    if (saved) setEntries(JSON.parse(saved))
  }, [])

  useEffect(() => {
    localStorage.setItem('crypto-transaction-log', JSON.stringify(entries))
  }, [entries])

  function normalizeDecimal(value) {
    if (!value && value !== 0) return '';

    let v = String(value).replace(/,/g, '.');

    const parts = v.split('.');
    if (parts.length > 1) {
      v = parts[0] + '.' + parts.slice(1).join('');
    }

    v = v.replace(/[^0-9.-]/g, '');

    if (v === '.' || v === '-' || v === '-.') return '';
    if (isNaN(Number(v))) return '';

    return v;
  }

  function formatDisplayNumber(value, decimals = 8) {
    if (value === '' || value === null || value === undefined) return ''
    const num = Number(String(value).replace(/,/g, '.'))
    if (isNaN(num)) return ''
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  }

  function formatBRL(value) {
    if (value === '' || value === null || value === undefined) return ''
    const num = Number(String(value).replace(/,/g, '.'))
    if (isNaN(num)) return ''
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num)
  }

  // --- Binance price helpers ---
  function toTimestampMs(datetimeLocalString) {
    if (!datetimeLocalString) return null
    const dt = new Date(datetimeLocalString)
    if (isNaN(dt.getTime())) return null
    return dt.getTime()
  }

  async function fetchKlinePrice(symbol, timestampMs) {
    try {
      const start = Math.max(0, timestampMs - 30 * 1000)
      const end = timestampMs + 30 * 1000
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${start}&endTime=${end}&limit=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return null
      const close = parseFloat(data[0][4])
      return close
    } catch (err) {
      console.debug('fetchKlinePrice error', err)
      return null
    }
  }

  async function fetchUSDToBRL(timestampMs) {
    const trySymbols = ['USDTBRL', 'USDCBRL']
    for (const s of trySymbols) {
      const price = await fetchKlinePrice(s, timestampMs)
      if (price) return price
    }
    try {
      const dt = new Date(timestampMs).toISOString().slice(0, 10)
      const res = await fetch(`https://api.exchangerate.host/${dt}?base=USD&symbols=BRL`)
      if (!res.ok) return null
      const j = await res.json()
      if (j && j.rates && j.rates.BRL) return j.rates.BRL
    } catch (err) {
      console.debug('fetchUSDToBRL error', err)
    }
    return null
  }

  // Price lookup for an arbitrary asset -> USD and BRL
  async function lookupPricesForAsset(asset, timestampMs) {
    if (!asset) return { usd: null, brl: null }
    const upper = asset.toUpperCase()
    // If asset is a quoted USD stablecoin, price in USD is 1
    const stableUSD = ['USDT', 'USDC', 'BUSD', 'USD']
    if (stableUSD.includes(upper)) {
      const usd = 1
      const brl = await fetchUSDToBRL(timestampMs)
      return { usd, brl }
    }

    // try assetUSDT, assetUSD, assetBRL
    let usd = await fetchKlinePrice(`${upper}USDT`, timestampMs)
    if (!usd) usd = await fetchKlinePrice(`${upper}USD`, timestampMs)
    let brl = await fetchKlinePrice(`${upper}BRL`, timestampMs)

    if (!brl && usd) {
      const usdToBrl = await fetchUSDToBRL(timestampMs)
      if (usdToBrl) brl = usd * usdToBrl
    }

    return { usd, brl }
  }

  async function autofillPrices() {
    setError('')
    setLoadingPrice(true)
    try {
      const { base, quote, datetime, qtyBase, feeAsset, qtyFee } = form
      const ts = toTimestampMs(datetime)
      if (!ts) {
        setError('Please fill in the date/time before searching for the historical price.')
        setLoadingPrice(false)
        return
      }

      // --- base price
      let priceUSD = null
      const quoteUpper = (quote || '').toUpperCase()
      const usdQuoteCandidates = ['USDT', 'BUSD', 'USDC', 'USD']
      if (usdQuoteCandidates.includes(quoteUpper)) {
        priceUSD = await fetchKlinePrice(`${base}${quoteUpper}`, ts)
      }
      if (!priceUSD) priceUSD = await fetchKlinePrice(`${base}USDT`, ts)
      if (!priceUSD) priceUSD = await fetchKlinePrice(`${base}USD`, ts)

      let priceBRL = await fetchKlinePrice(`${base}BRL`, ts)
      if (!priceBRL && priceUSD) {
        const usdToBrl = await fetchUSDToBRL(ts)
        if (usdToBrl) priceBRL = priceUSD * usdToBrl
      }

      // --- fee asset price
      const feePrices = await lookupPricesForAsset(feeAsset, ts)
      const feeUSDPrice = feePrices.usd
      const feeBRLPrice = feePrices.brl

      if (!priceUSD && !priceBRL && !feeUSDPrice && !feeBRLPrice) {
        setError('It was not possible to obtain historical prices for the assets listed on Binance.')
        setLoadingPrice(false)
        return
      }

      const qtyBaseNum = Number(normalizeDecimal(qtyBase)) || 0
      const pUSD = priceUSD ? Number(Number(priceUSD).toFixed(8)) : ''
      const pBRL = priceBRL ? Number(Number(priceBRL).toFixed(4)) : ''
      const qtyQuote = qtyBaseNum && pUSD ? Number((qtyBaseNum * pUSD).toFixed(8)) : ''
      const totalUSD = qtyBaseNum && pUSD ? Number((qtyBaseNum * pUSD).toFixed(2)) : ''
      const totalBRL = qtyBaseNum && pBRL ? Number((qtyBaseNum * pBRL).toFixed(2)) : ''

      // fee calculations
      const qtyFeeNum = Number(normalizeDecimal(qtyFee)) || 0
      let feeUSD = ''
      let feeBRL = ''

      if (qtyFeeNum) {
        // if fee asset is USD-stable, feeUSD = qtyFee
        const upperFee = (feeAsset || '').toUpperCase()
        if (['USDT', 'USDC', 'BUSD', 'USD'].includes(upperFee)) {
          feeUSD = Number(qtyFeeNum.toFixed(8))
          // convert to BRL
          const usdToBrl = feeBRLPrice || await fetchUSDToBRL(ts)
          feeBRL = usdToBrl ? Number((feeUSD * usdToBrl).toFixed(2)) : ''
        } else if (feeUSDPrice) {
          feeUSD = Number((qtyFeeNum * feeUSDPrice).toFixed(8))
          feeBRL = feeBRLPrice ? Number((qtyFeeNum * feeBRLPrice).toFixed(2)) : ''
          if (!feeBRL && feeUSD) {
            const usdToBrl = await fetchUSDToBRL(ts)
            feeBRL = usdToBrl ? Number((feeUSD * usdToBrl).toFixed(2)) : ''
          }
        } else if (feeBRLPrice) {
          feeBRL = Number((qtyFeeNum * feeBRLPrice).toFixed(2))
          const usdToBrl = await fetchUSDToBRL(ts)
          feeUSD = usdToBrl ? Number((qtyFeeNum * feeBRLPrice / usdToBrl).toFixed(8)) : ''
        }
      }

      setForm(prev => ({
        ...prev,
        priceUSD: pUSD === '' ? '' : String(pUSD),
        priceBRL: pBRL === '' ? '' : String(pBRL),
        qtyQuote: qtyQuote === '' ? '' : String(qtyQuote),
        totalUSD: totalUSD === '' ? '' : String(totalUSD),
        totalBRL: totalBRL === '' ? '' : String(totalBRL),
        feeUSD: feeUSD === '' ? '' : String(feeUSD),
        feeBRL: feeBRL === '' ? '' : String(feeBRL)
      }))
    } catch (err) {
      console.error(err)
      setError('Error when searching for prices: ' + (err.message || err))
    } finally {
      setLoadingPrice(false)
    }
  }

  // --- Form handling with simple masks (focus/unfocus) ---
  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  function handleNumericInput(name, rawValue, decimals = 8) {
    let v = String(rawValue).replace(/[^0-9.,-]/g, '');

    const firstComma = v.indexOf(',');
    const firstDot = v.indexOf('.');
    // decidir qual separador aconteceu primeiro (se houver)
    const sepIndex = (firstComma === -1) ? firstDot
      : (firstDot === -1) ? firstComma
        : Math.min(firstComma, firstDot);

    if (sepIndex !== -1) {
      const intPart = v.slice(0, sepIndex).replace(/[^0-9-]/g, '');
      let fracPart = v.slice(sepIndex + 1).replace(/[^0-9]/g, '');
      fracPart = fracPart.slice(0, decimals);
      const sepChar = v[sepIndex]; // mantém ',' ou '.'
      v = intPart + (fracPart.length > 0 ? sepChar + fracPart : sepChar);
    } else {
      v = v.replace(/[^0-9-]/g, '');
    }

    setForm(prev => ({ ...prev, [name]: v }));
  }


  function onFocusUnformat(e) {
    const { name } = e.target
    const raw = String(form[name] ?? '')
    const un = raw.replace(/[^0-9.,-]/g, '')
    setForm(prev => ({ ...prev, [name]: un }))
  }

  function onBlurFormat(e, decimals = 8, isBRL = false) {
    const { name } = e.target
    const val = normalizeDecimal(form[name])
    if (val === '') return setForm(prev => ({ ...prev, [name]: '' }))
    const num = Number(val)
    if (isNaN(num)) return
    if (isBRL) setForm(prev => ({ ...prev, [name]: String(Number(num.toFixed(2))) }))
    else setForm(prev => ({ ...prev, [name]: String(Number(num.toFixed(decimals))) }))
  }

  // --- CRUD: add / update / delete ---
  function validateForm() {
    if (!form.datetime) return 'Date/time is required.'
    if (!form.base) return 'Base asset required.'
    if (!form.qtyBase || Number(normalizeDecimal(form.qtyBase)) === 0) return 'The base quantity must be greater than zero.'
    return null
  }

  function saveEntry(e) {
    e.preventDefault()
    const v = validateForm()
    if (v) {
      setError(v)
      return
    }
    setError('')

    const payload = { ...form }
    if (editingId) {
      setEntries(prev => prev.map(it => (it.id === editingId ? { ...payload, id: editingId } : it)))
      setEditingId(null)
    } else {
      payload.id = Date.now()
      setEntries(prev => [payload, ...prev])
    }
    setForm(emptyForm)
  }

  function startEditing(entry) {
    setEditingId(entry.id)
    setForm(entry)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
  }

  function removeEntry(id) {
    if (!confirm('Remove transaction?')) return
    setEntries(prev => prev.filter(x => x.id !== id))
    if (editingId === id) cancelEdit()
  }

  function copyRowWithHeader(entry) {
    const header = [
      'Date', 'Network', 'Account', 'Type', 'Asset', 'Qty Base', 'Qty Quote', 'Price USD', 'Price BRL',
      'Total USD', 'Total BRL', 'Fee Asset', 'Qty Fee', 'Fee USD', 'Fee BRL', 'TxID', 'Notes'
    ];

    const num = (v) => {
      if (v === null || v === undefined || v === '') return '';
      const n = Number(v);
      if (isNaN(n)) return v;
      return String(v).replace('.', ',');
    };

    const cols = [
      entry.datetime || '',
      entry.network || '',
      entry.account || '',
      entry.type || '',
      `${entry.base || ''}/${entry.quote || ''}`,
      num(entry.qtyBase),
      num(entry.qtyQuote),
      num(entry.priceUSD),
      num(entry.priceBRL),
      num(entry.totalUSD),
      num(entry.totalBRL),
      entry.feeAsset || '',
      num(entry.qtyFee),
      num(entry.feeUSD),
      num(entry.feeBRL),
      entry.txid || '',
      entry.notes || ''
    ];

    const tsv = header.join('\t') + '\r\n' + cols.join('\t') + '\r\n';

    navigator.clipboard.writeText(tsv)
      .then(() => {
        setError('Line + titles copied with comma as decimal (Excel BR).');
        setTimeout(() => setError(''), 1800);
      })
      .catch(err => setError('Error copying: ' + (err?.message || err)));
  }

  function exportCSV() {
    const header = [
      'Date', 'Network', 'Account', 'Asset', 'Type', 'Qty Base', 'Qty Quote', 'Price USD', 'Price BRL',
      'Total USD', 'Total BRL', 'Fee Asset', 'Qty Fee', 'Fee USD', 'Fee BRL',
      'TxID', 'Notes'
    ];

    const toBR = (v) => {
      if (v === null || v === undefined || v === '') return '';
      const n = Number(String(v).replace(/,/g, '.'));
      if (isNaN(n)) return String(v);
      return String(n).replace('.', ',');
    };

    const rows = entries.map(entry => {
      const cols = [
        entry.datetime || '',
        entry.network || '',
        entry.account || '',
        entry.base ? `${entry.base}/${entry.quote || ''}` : '',
        entry.type || '',
        toBR(entry.qtyBase),
        toBR(entry.qtyQuote),
        toBR(entry.priceUSD),
        toBR(entry.priceBRL),
        toBR(entry.totalUSD),
        toBR(entry.totalBRL),
        entry.feeAsset || '',
        toBR(entry.qtyFee),
        toBR(entry.feeUSD),
        toBR(entry.feeBRL),
        entry.txid || '',
        entry.notes || ''
      ];
      return cols.join('\t');
    });
    const content = header.join('\t') + '\r\n' + rows.join('\r\n') + '\r\n';

    const blob = new Blob(
      [content],
      { type: 'application/vnd.ms-excel;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crypto_entries.xls'; // extensão Excel
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- UI ---
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Crypto Transaction Log — Fees Included</h1>
        <div style={{ marginLeft: 'auto', color: '#666' }}>{editingId ? 'Edit mode' : 'New entry'}</div>
      </header>

      <form onSubmit={saveEntry} style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 10 }}>
        <label style={{ gridColumn: 'span 4' }}>
          Date & Time (UTC)
          <input type="datetime-local" name="datetime" value={form.datetime} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 4' }}>
          Network / Exchange
          <input name="network" value={form.network} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 4' }}>
          Account / Wallet
          <input name="account" value={form.account} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Type
          <select name="type" value={form.type} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }}>
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Base Asset
          <input name="base" value={form.base} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Quote Asset
          <input name="quote" value={form.quote} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Qty Base
          <input name="qtyBase" value={form.qtyBase} onChange={(e) => handleNumericInput('qtyBase', e.target.value, 8)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 8)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Qty Quote (auto)
          <input name="qtyQuote" value={formatDisplayNumber(form.qtyQuote, 8)} onChange={(e) => handleNumericInput('qtyQuote', e.target.value, 8)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 8)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Price USD (auto)
          <input name="priceUSD" value={formatDisplayNumber(form.priceUSD, 8)} onChange={(e) => handleNumericInput('priceUSD', e.target.value, 8)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 8)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Price BRL (auto)
          <input name="priceBRL" value={formatDisplayNumber(form.priceBRL, 4)} onChange={(e) => handleNumericInput('priceBRL', e.target.value, 4)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 4, true)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Total USD (auto)
          <input name="totalUSD" value={formatDisplayNumber(form.totalUSD, 2)} onChange={(e) => handleNumericInput('totalUSD', e.target.value, 2)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 2)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Total BRL (auto)
          <input name="totalBRL" value={form.totalBRL ? formatBRL(form.totalBRL) : ''} onChange={(e) => handleNumericInput('totalBRL', e.target.value, 2)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 2, true)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        {/* Fee fields */}
        <label style={{ gridColumn: 'span 2' }}>
          Fee Asset
          <input name="feeAsset" value={form.feeAsset} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Qty Fee
          <input name="qtyFee" value={form.qtyFee} onChange={(e) => handleNumericInput('qtyFee', e.target.value, 8)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 8)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Fee USD (auto)
          <input name="feeUSD" value={formatDisplayNumber(form.feeUSD, 8)} onChange={(e) => handleNumericInput('feeUSD', e.target.value, 8)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 8)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 2' }}>
          Fee BRL (auto)
          <input name="feeBRL" value={form.feeBRL ? formatBRL(form.feeBRL) : ''} onChange={(e) => handleNumericInput('feeBRL', e.target.value, 2)} onFocus={onFocusUnformat} onBlur={(e) => onBlurFormat(e, 2, true)} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 6' }}>
          TxID
          <input name="txid" value={form.txid} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <label style={{ gridColumn: 'span 6' }}>
          Notes
          <input name="notes" value={form.notes} onChange={handleChange} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>

        <div style={{ gridColumn: 'span 12', display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button type="button" onClick={autofillPrices} disabled={loadingPrice} style={{ padding: '8px 12px', borderRadius: 6, background: '#2563eb', color: 'white', border: 'none' }}>{loadingPrice ? 'Fetching...' : 'Auto-fill prices'}</button>
          <button type="submit" style={{ padding: '8px 12px', borderRadius: 6, background: '#059669', color: 'white', border: 'none' }}>{editingId ? 'Save changes' : 'Save entry'}</button>
          {editingId && <button type="button" onClick={cancelEdit} style={{ padding: '8px 12px', borderRadius: 6, background: '#ef4444', color: 'white', border: 'none' }}>Cancel edit</button>}
          <button type="button" onClick={() => { setForm(emptyForm); setError(''); setEditingId(null) }} style={{ padding: '8px 12px', borderRadius: 6 }}>Clear</button>

          <div style={{ marginLeft: 'auto' }}>
            <button type="button" onClick={exportCSV} style={{ padding: '8px 12px', borderRadius: 6 }}>Export XLS</button>
            <button type="button" onClick={() => window.open("/indexGetHistorical.html", "_blank")} style={{ padding: '8px 12px', borderRadius: 6 }}>Crypto Historical Prices</button>
          </div>
        </div>
      </form>

      {error && <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div>}

      <hr style={{ margin: '18px 0' }} />

      <h2 style={{ fontSize: 18 }}>Entries ({entries.length})</h2>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Date</th>
              <th style={{ padding: 8 }}>Network</th>
              <th style={{ padding: 8 }}>Asset</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Qty Base</th>
              <th style={{ padding: 8 }}>Qty Quote</th>
              <th style={{ padding: 8 }}>Price USD</th>
              <th style={{ padding: 8 }}>Total USD</th>
              <th style={{ padding: 8 }}>Total BRL</th>
              <th style={{ padding: 8 }}>Fee USD</th>
              <th style={{ padding: 8 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: 8 }}>{e.datetime}</td>
                <td style={{ padding: 8 }}>{e.network}</td>
                <td style={{ padding: 8 }}>{e.base}/{e.quote}</td>
                <td style={{ padding: 8 }}>{e.type}</td>
                <td style={{ padding: 8 }}>{formatDisplayNumber(e.qtyBase, 8)}</td>
                <td style={{ padding: 8 }}>{formatDisplayNumber(e.qtyQuote, 8)}</td>
                <td style={{ padding: 8 }}>{formatDisplayNumber(e.priceUSD, 8)}</td>
                <td style={{ padding: 8 }}>{formatDisplayNumber(e.totalUSD, 2)}</td>
                <td style={{ padding: 8 }}>{e.totalBRL ? formatBRL(e.totalBRL) : ''}</td>
                <td style={{ padding: 8 }}>{formatDisplayNumber(e.feeUSD, 8)}</td>
                <td style={{ padding: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => startEditing(e)} style={{ padding: '6px 8px', borderRadius: 6, background: '#f59e0b', color: 'white', border: 'none' }}>Edit</button>
                    <button onClick={() => removeEntry(e.id)} style={{ padding: '6px 8px', borderRadius: 6, background: '#ef4444', color: 'white', border: 'none' }}>Delete</button>
                    <button
                      onClick={() => copyRowWithHeader(e)}
                      style={{ padding: '6px 8px', borderRadius: 6, background: '#2563eb', color: 'white', border: 'none' }}
                    >
                      Copy+
                    </button>

                  </div>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={17} style={{ padding: 12, color: '#6b7280' }}>No entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <footer style={{ marginTop: 20, color: '#6b7280' }}>
        <small>Client-side demo. For production/legal workflows consider: server-side persistence (encrypted), audit log, timezone normalization (UTC), documented price sources and receipts.</small>
      </footer>
    </div>
  )
}
