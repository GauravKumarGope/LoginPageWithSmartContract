// AuthForm.jsx
// Place this at frontend/src/components/AuthForm.jsx
import React, { useState, useEffect } from "react";
import * as ethers from "ethers";
import "./AuthForm.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api/auth";
const TOKEN_KEY = "auth_token";

export default function AuthForm({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [type, setType] = useState("normal");
  const [xrplAddress, setXrplAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [xrplSeed, setXrplSeed] = useState(null);

  // --- Smart contract / wallet UI state (minimal, non-invasive) ---
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [walletSigner, setWalletSigner] = useState(null);
  const [consentContractAddress, setConsentContractAddress] = useState(import.meta.env.VITE_CONSENT_ADDRESS || "");
  const [ipfsHash, setIpfsHash] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [consentTxInfo, setConsentTxInfo] = useState(null);

  useEffect(() => {
    // detect already connected MetaMask accounts
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (accounts && accounts.length) connectWalletInternal(accounts[0]);
      }).catch(() => {});
    }
  }, []);

  function saveToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (e) { body = { message: text }; }
    if (!res.ok) {
      const err = new Error(body.message || "Request failed");
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError(""); setInfo(""); setXrplSeed(null);
    if (!email || !password) { setError("Email and password required"); return; }
    setLoading(true);
    try {
      const payload = { email, password, type, xrplAddress };
      const res = await apiRequest("/signup", { method: "POST", body: JSON.stringify(payload) });
      if (res.token) saveToken(res.token);
      if (res.user && onAuth) onAuth(res.user);
      if (res.xrplSeed) { setXrplSeed(res.xrplSeed); setInfo("Account created — seed returned once. Save it now."); }
      else setInfo(res.notice || "Account created");
    } catch (err) {
      setError(err?.body?.message || err.message || "Signup failed");
    } finally { setLoading(false); }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError(""); setInfo(""); setXrplSeed(null);
    if (!email || !password) { setError("Email and password required"); return; }
    setLoading(true);
    try {
      const res = await apiRequest("/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (res.token) saveToken(res.token);
      if (res.user && onAuth) onAuth(res.user);
      setInfo("Logged in");
    } catch (err) {
      setError(err?.body?.message || err.message || "Login failed");
    } finally { setLoading(false); }
  }

  function switchMode(next) {
    setMode(next); setError(""); setInfo(""); setXrplSeed(null);
  }

  function copyToClipboard(text) {
    if (!navigator.clipboard) {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      alert("Copied to clipboard");
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      alert("Copied to clipboard");
    });
  }

  // ---------------- Wallet helpers (minimal) ----------------
  function connectWalletInternal(account) {
    setWalletAddress(account);
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      setWalletProvider(p);
      const s = p.getSigner();
      setWalletSigner(s);
    } catch (e) {
      console.warn('wallet init failed', e);
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      alert('No injected wallet found (MetaMask). Please install MetaMask or use a browser with an injected provider.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length) connectWalletInternal(accounts[0]);
    } catch (e) {
      console.error('connectWallet failed', e);
      setError('Wallet connection failed');
    }
  }

  async function disconnectWallet() {
    setWalletAddress(null);
    setWalletProvider(null);
    setWalletSigner(null);
  }

  // ---------------- Consent actions ----------------
  // 1) Call server-side record endpoint (requires auth token)
  async function recordConsentServer() {
    setError(''); setInfo(''); setConsentTxInfo(null);
    if (!ipfsHash) { setError('IPFS hash required'); return; }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setError('You must be logged in to record consent'); return; }
    setLoading(true);
    try {
      const body = { userId: email || (new Date().getTime().toString()), timestamp: Math.floor(Date.now()/1000), transcriptText: transcriptText || '', ipfsHash };
      const res = await fetch((API_BASE.replace('/auth','')) + '/consent/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'server failed');
      setConsentTxInfo({ type: 'server', data });
      setInfo('Consent recorded server-side');
    } catch (e) {
      console.error('recordConsentServer', e);
      setError(String(e.message || e));
    } finally { setLoading(false); }
  }

  // 2) Give consent directly on-chain using connected wallet (requires user-supplied contract address & ABI minimal)
  async function giveConsentOnChain() {
    setError(''); setInfo(''); setConsentTxInfo(null);
    if (!walletSigner) { setError('Connect your wallet first'); return; }
    if (!consentContractAddress) { setError('Consent contract address required'); return; }
    if (!ipfsHash) { setError('IPFS hash required'); return; }

    setLoading(true);
    try {
      // Minimal ABI that matches server: giveConsent(bytes32,string)
      const abi = [ 'function giveConsent(bytes32 key, string ipfsHash) external' ];
      const contract = new ethers.Contract(consentContractAddress, abi, walletSigner);

      // Create deterministic key locally: use email as userId if available, else use wallet address
      const userId = email || walletAddress || 'anonymous';
      const timestamp = Math.floor(Date.now() / 1000);

      // Compute transcript hash (keccak256 of transcriptText)
      const transcriptHash = ethers.hexlify(ethers.keccak256(ethers.toUtf8Bytes(transcriptText || '')));

      // solidityPackedKeccak256 to match server makeKey
      const key = ethers.solidityPackedKeccak256(["string","uint256","bytes32"],[String(userId), BigInt(Number(timestamp)), transcriptHash]);

      const tx = await contract.giveConsent(key, ipfsHash);
      const receipt = await tx.wait();
      setConsentTxInfo({ type: 'onchain', txHash: tx.hash, receipt });
      setInfo('Consent transaction submitted; check wallet or explorer for details');
    } catch (e) {
      console.error('giveConsentOnChain', e);
      setError(String(e.message || e));
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" role="region" aria-label="Authentication form">
        <header className="auth-header">
          <h3 className="auth-title">{mode === "login" ? "Sign in" : "Create account"}</h3>
          <button
            className="auth-switch"
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            aria-pressed={mode !== "login"}
            type="button"
          >
            {mode === "login" ? "Switch to Signup" : "Switch to Login"}
          </button>
        </header>

        <form className="auth-form" onSubmit={mode === "login" ? handleLogin : handleSignup}>
          <label className="field">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              placeholder="min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {mode === "signup" && (
            <>
              <div className="row">
                <label className="field-inline">
                  <span className="label">Type</span>
                  <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="normal">normal</option>
                    <option value="deaf">deaf</option>
                  </select>
                </label>

                <label className="field-inline" style={{ flex: 1 }}>
                  <span className="label">XRPL address (optional)</span>
                  <input
                    className="input"
                    type="text"
                    placeholder="r... (leave empty to auto-generate)"
                    value={xrplAddress}
                    onChange={(e) => setXrplAddress(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <div className="actions">
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? (mode === "login" ? "Signing in…" : "Creating…") : (mode === "login" ? "Sign in" : "Create account")}
            </button>

            <button
              className="btn ghost"
              type="button"
              onClick={() => { setEmail(""); setPassword(""); setError(""); setInfo(""); setXrplSeed(null); }}
            >
              Reset
            </button>
          </div>

          {error && <div className="msg error" role="alert">{error}</div>}
          {info && <div className="msg info">{info}</div>}

          {xrplSeed && (
            <div className="seed-card" aria-live="polite">
              <div className="seed-title">Important — XRPL seed (save now)</div>
              <pre className="seed-text">{xrplSeed}</pre>
              <div className="seed-actions">
                <button className="btn small" type="button" onClick={() => copyToClipboard(xrplSeed)}>Copy seed</button>
                <button className="btn ghost small" type="button" onClick={() => { setXrplSeed(null); alert("Seed hidden. Make sure you saved it."); }}>Hide</button>
              </div>
              <div className="seed-note">Warning: keep this seed secret. If the server stored seed encrypted, you may not receive it.</div>
            </div>
          )}
        </form>

        {/* ---------- Compact Smart-contract UI placed below form (non-invasive) ---------- */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Wallet / Consent</strong>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{walletAddress ? `Wallet: ${walletAddress}` : 'No wallet'}</div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            {!walletAddress ? (
              <button className="btn small" onClick={connectWallet} type="button">Connect Wallet (MetaMask)</button>
            ) : (
              <button className="btn ghost small" onClick={disconnectWallet} type="button">Disconnect Wallet</button>
            )}

            <input className="input" style={{ flex: 1 }} value={consentContractAddress} onChange={(e) => setConsentContractAddress(e.target.value)} placeholder="Consent contract address (optional for on-chain)" />
          </div>

          <label className="field" style={{ marginTop: 8 }}>
            <span className="label">IPFS Hash (consent payload)</span>
            <input className="input" value={ipfsHash} onChange={(e) => setIpfsHash(e.target.value)} placeholder="Qm... or CID" />
          </label>

          <label className="field">
            <span className="label">Transcript (optional)</span>
            <input className="input" value={transcriptText} onChange={(e) => setTranscriptText(e.target.value)} placeholder="Short transcript text" />
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary small" onClick={recordConsentServer} type="button" disabled={loading}>Record consent (server)</button>
            <button className="btn small" onClick={giveConsentOnChain} type="button" disabled={loading || !walletSigner}>Give consent on-chain (wallet)</button>
          </div>

          {consentTxInfo && (
            <div className="msg info" style={{ marginTop: 8 }}>
              <div>Result: {consentTxInfo.type}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(consentTxInfo.data || consentTxInfo, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
