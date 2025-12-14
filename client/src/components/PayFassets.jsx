import React, { useState, useEffect, useRef } from "react";
import "./PayFassets.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

const TOKEN_KEY = "auth_token";

export default function PayFassets({ onPaid }) {
  const [amount, setAmount] = useState("1");
  const [flareAddr, setFlareAddr] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [user, setUser] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      // naive decode to get email if needed; you can call /me endpoint if implemented
      setUser({ token });
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function createInvoice() {
    setErr(null);
    setLoading(true);
    setInvoice(null);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) throw new Error('Please log in before creating an invoice');

      const res = await fetch(`${API_BASE}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ amount_xrp: amount, flare_address: flareAddr })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Create invoice failed: ${res.status} ${text}`);
      }
      const j = await res.json();
      setInvoice(j);

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/invoice/${j.id}`);
          if (!r.ok) { console.warn("poll failed", r.status); return; }
          const data = await r.json();
          setInvoice(data);
          if (data.status && data.status !== "pending") {
            clearInterval(pollRef.current);
            pollRef.current = null;
            if (onPaid && data.status === "paid") onPaid(data);
          }
        } catch (e) { console.error("poll error", e); }
      }, 2000);
    } catch (e) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function cancelInvoice() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setInvoice(null);
    setErr(null);
  }

  return (
    <div className="pf-container">
      <div className="pf-card">
        <h2 className="pf-title">Pay with FAssets (XRPL)</h2>

        {!localStorage.getItem(TOKEN_KEY) && (
          <div style={{ marginBottom: 12, color: '#FDE68A' }}>
            Please log in first to create an invoice.
          </div>
        )}

        {/* form area unchanged except header above */}
        {!invoice && (
          <div className="pf-form">
            <label className="pf-label">Amount (XRP)
              <input className="pf-input" value={amount} onChange={(e)=>setAmount(e.target.value)} type="number" min="0.000001" />
            </label>

            <label className="pf-label">Your Flare address (optional)
              <input className="pf-input" value={flareAddr} onChange={(e)=>setFlareAddr(e.target.value)} placeholder="0x..." />
            </label>

            <div className="pf-actions">
              <button className="pf-btn-primary" onClick={createInvoice} disabled={loading || !localStorage.getItem(TOKEN_KEY)}>
                {loading ? "Creating..." : "Create Invoice"}
              </button>
              <button className="pf-btn-ghost" onClick={()=>{ setAmount("1"); setFlareAddr(""); }}>
                Reset
              </button>
            </div>

            {err && <div className="pf-error">Error: {err}</div>}
          </div>
        )}

        {/* invoice rendering unchanged - reuse your existing UI */}
        {invoice && (
          <div className="pf-invoice">
            <div className="pf-invoice-row">
              <div>
                <div className="pf-small">Invoice ID</div>
                <div className="pf-big">{invoice.id}</div>
              </div>
              <div>
                <div className="pf-small">Amount</div>
                <div className="pf-big">{invoice.amount_xrp || "—"} XRP</div>
              </div>
            </div>

            <div className="pf-section">
              <div className="pf-small">Send XRP to</div>
              <div className="pf-mono">{invoice.xrpl_deposit}</div>
              <div className="pf-small">Memo (must match)</div>
              <div className="pf-mono">{invoice.xrpl_memo}</div>
            </div>

            <div className="pf-payment-row">
              {invoice.qrData ? <img src={invoice.qrData} alt="qr" className="pf-qr" /> : <div className="pf-qr pf-qr-empty">QR</div>}
              <div className="pf-payment-info">
                <p className="pf-status">Status: <strong>{(invoice.status || 'pending').toUpperCase()}</strong></p>
                {invoice.status === 'pending' && <p className="pf-hint">Waiting for XRPL payment. Send XRP with the memo above (or scan QR).</p>}
                {invoice.status === 'paid' && <p className="pf-success">Payment received — awaiting mint/confirm.</p>}
                {invoice.xrpl_tx_hash && <p className="pf-small">XRPL TX: <span className="pf-mono">{invoice.xrpl_tx_hash}</span></p>}
                {invoice.flare_tx_hash && <p className="pf-small">Flare TX: <span className="pf-mono">{invoice.flare_tx_hash}</span></p>}
              </div>
            </div>

            <div className="pf-invoice-actions">
              <button className="pf-btn-ghost" onClick={cancelInvoice}>Close</button>
              <a className="pf-link" href={`https://test.xrpl.org/transactions/${invoice.xrpl_tx_hash || ''}`} target="_blank" rel="noreferrer">View TX on XRPL Explorer</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
