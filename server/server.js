require('dotenv').config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const WebSocket = require("ws");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const xrpl = require('xrpl');
const crypto = require('crypto');
const QRCode = require('qrcode');

// NEW: ethers for smart contract interactions (v6)
const { ethers } = require("ethers");

const app = express();
const server = http.createServer(app);

// ---------- translate loader (unchanged shape, robust) ----------
let translateApiFn = null;
let translateModuleShape = null;

try {
  const mod = require("@vitalets/google-translate-api");
  translateModuleShape = mod;
  translateApiFn = (mod && mod.default) ? mod.default : mod;
  console.log("Loaded @vitalets/google-translate-api via require()");
} catch (err) {
  console.warn("Require failed (package may be ESM-only). Will try dynamic import if needed.", err && err.message);
}

async function ensureTranslateApi() {
  if (typeof translateApiFn === "function") return;
  try {
    const imported = await import("@vitalets/google-translate-api");
    translateModuleShape = imported;
    translateApiFn = imported.default || imported;
    console.log("Loaded @vitalets/google-translate-api via dynamic import()");
  } catch (err) {
    console.error("Dynamic import failed:", err && err.message);
    throw err;
  }
}

function debugModuleShape(label) {
  try {
    console.log(`--- DEBUG: ${label} ---`);
    console.log("typeof translateApiFn:", typeof translateApiFn);
    if (translateModuleShape) {
      const keys = Object.keys(translateModuleShape);
      console.log("translateModuleShape keys:", keys);
      console.dir(translateModuleShape, { depth: 1 });
    } else {
      console.log("translateModuleShape: <not set>");
    }
    console.log("--- end debug ---");
  } catch (e) {
    console.error("debugModuleShape failed:", e && e.message);
  }
}

async function translateToEnglish(text) {
  if (!text) throw new Error("empty_text");

  if (typeof fetch === "undefined") {
    const { default: fetchFn } = await import("node-fetch");
    global.fetch = fetchFn;
  }

  try {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" +
      encodeURIComponent(text);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "node/translate-test",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`translate_http_error:${resp.status} ${txt}`);
    }

    const data = await resp.json();

    const translated = Array.isArray(data[0])
      ? data[0].map((seg) => (Array.isArray(seg) ? seg[0] : "")).join("")
      : String(data);

    const srcLang = data[2] || (data[0] && data[0][0] && data[0][0][2]) || "auto";

    return {
      translated,
      srcLang,
      confidence: 1.0,
    };
  } catch (err) {
    console.error("translateToEnglish (A) failed:", err && err.message ? err.message : err);
    throw err;
  }
}

/* ----------------- CORS & Express setup ----------------- */

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// -------------------------
// MongoDB connection + Models
// -------------------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/hackathon-auth";
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => { console.error("Mongo error:", err); });

// User model
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  type: { type: String, enum: ['normal','deaf'], default: 'normal' },
  xrplAddress: { type: String, default: '' },
  xrplSeedEncrypted: { type: String, default: '' }
}, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', userSchema);

// Invoice model for FAssets payments
const invoiceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount_xrp: { type: String, required: true },
  flare_address: { type: String, default: '' },
  xrpl_deposit: { type: String, required: true }, // XRPL address to send XRP to
  xrpl_memo: { type: String, required: true }, // Unique memo for this invoice
  status: { type: String, enum: ['pending', 'paid', 'failed', 'expired'], default: 'pending' },
  xrpl_tx_hash: { type: String, default: '' },
  flare_tx_hash: { type: String, default: '' },
  qrData: { type: String, default: '' }, // base64 QR code
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) } // 30 min expiry
}, { timestamps: true });
const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

// -------------------------
// JWT helpers & middleware
// -------------------------
const JWT_SECRET = process.env.JWT_SECRET || "please_change_this_secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

function createToken(user) {
  return jwt.sign({ id: user._id, email: user.email, type: user.type }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authRequired(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'No authorization header' });
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ message: 'Malformed authorization header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// -------------------------
// Simple validators
// -------------------------
function basicEmailOK(e) {
  return typeof e === 'string' && /\S+@\S+\.\S+/.test(e);
}
function basicXRPLOK(a) {
  return typeof a === 'string' && (a === '' || /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a));
}

// -------------------------
// Seed encryption helpers
// -------------------------
function encryptSeed(seed) {
  const keyHex = process.env.SEED_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('No SEED_ENCRYPTION_KEY provided');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('SEED_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSeed(encryptedStr) {
  const keyHex = process.env.SEED_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('No SEED_ENCRYPTION_KEY provided');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('SEED_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');

  const [ivHex, tagHex, cipherHex] = encryptedStr.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const cipherText = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString('utf8');
}

// -------------------------
// Smart contract / Flare setup
// -------------------------
const FLARE_RPC = process.env.FLARE_RPC || "https://coston2-api.flare.network/ext/C/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const CONSENT_ADDRESS = process.env.CONSENT_ADDRESS || "";
const REWARD_ADDRESS = process.env.REWARD_ADDRESS || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

// XRPL Configuration for FAssets
const XRPL_SERVER = process.env.XRPL_SERVER || "wss://s.altnet.rippletest.net:51233"; // testnet
const XRPL_DEPOSIT_ADDRESS = process.env.XRPL_DEPOSIT_ADDRESS || ""; // Your XRPL wallet that receives payments

if (!PRIVATE_KEY) {
  console.warn("WARNING: PRIVATE_KEY not set. Contract endpoints will fail until PRIVATE_KEY is provided.");
}

if (!CONSENT_ADDRESS || !REWARD_ADDRESS) {
  console.warn("WARNING: CONSENT_ADDRESS or REWARD_ADDRESS not set. Set them after deployment.");
}

if (!XRPL_DEPOSIT_ADDRESS) {
  console.warn("WARNING: XRPL_DEPOSIT_ADDRESS not set. Invoice creation will fail.");
}

let provider, signer, consentContract, rewardContract;
try {
  provider = new ethers.JsonRpcProvider(FLARE_RPC);
  if (PRIVATE_KEY) {
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
  } else {
    signer = null;
  }
} catch (e) {
  console.error("Failed to create ethers provider/signer:", e && e.message);
}

const consentAbi = [
  "function giveConsent(bytes32 key, string ipfsHash) external",
  "event ConsentGiven(bytes32 indexed key, address indexed signer, uint64 timestamp, string ipfsHash)"
];
const rewardAbi = [
  "function mint(address to, uint256 amount) external"
];

if (signer && CONSENT_ADDRESS) {
  consentContract = new ethers.Contract(CONSENT_ADDRESS, consentAbi, signer);
}
if (signer && REWARD_ADDRESS) {
  rewardContract = new ethers.Contract(REWARD_ADDRESS, rewardAbi, signer);
}

function makeKey(userId, timestamp, transcriptHashOrText) {
  let transcriptHash;
  if (typeof transcriptHashOrText === "string" && /^0x[0-9a-fA-F]{64}$/.test(transcriptHashOrText)) {
    transcriptHash = transcriptHashOrText;
  } else {
    const text = String(transcriptHashOrText || "");
    transcriptHash = ethers.keccak256(ethers.toUtf8Bytes(text));
  }

  const key = ethers.solidityPackedKeccak256(
    ["string", "uint256", "bytes32"],
    [String(userId), BigInt(Number(timestamp)), transcriptHash]
  );
  return key;
}

// -------------------------
// XRPL Client for monitoring payments
// -------------------------
let xrplClient = null;

async function getXRPLClient() {
  if (xrplClient && xrplClient.isConnected()) {
    return xrplClient;
  }
  xrplClient = new xrpl.Client(XRPL_SERVER);
  await xrplClient.connect();
  console.log('XRPL client connected');
  return xrplClient;
}

// -------------------------
// Auth routes
// -------------------------
const authRouter = express.Router();

authRouter.post('/signup', async (req, res) => {
  try {
    const { email, password, type = 'normal', xrplAddress = '' } = req.body;

    if (!email || !password) return res.status(400).json({ message: 'email & password required' });
    if (!basicEmailOK(email)) return res.status(400).json({ message: 'invalid email' });
    if (!['normal','deaf'].includes(type)) return res.status(400).json({ message: 'invalid type' });
    if (xrplAddress && !basicXRPLOK(xrplAddress)) return res.status(400).json({ message: 'invalid xrpl address' });

    if (await User.findOne({ email })) return res.status(409).json({ message: 'email exists' });

    const hash = await bcrypt.hash(password, 10);

    const wallet = xrpl.Wallet.generate();
    const generatedAddress = wallet.classicAddress;
    const generatedSeed = wallet.seed;

    let xrplSeedEncrypted = '';
    let seedReturnedToClient = null;

    if (process.env.SEED_ENCRYPTION_KEY) {
      try {
        xrplSeedEncrypted = encryptSeed(generatedSeed);
      } catch (encErr) {
        console.error('Seed encryption failed:', encErr && encErr.message ? encErr.message : encErr);
        return res.status(500).json({ message: 'seed encryption failed' });
      }
    } else {
      seedReturnedToClient = generatedSeed;
    }

    const user = await User.create({
      email,
      password: hash,
      type,
      xrplAddress: generatedAddress,
      xrplSeedEncrypted: xrplSeedEncrypted
    });

    const token = createToken(user);

    const resp = {
      message: 'created',
      token,
      user: { id: user._id, email: user.email, type: user.type, xrplAddress: user.xrplAddress }
    };
    if (seedReturnedToClient) {
      resp.xrplSeed = seedReturnedToClient;
      resp.notice = 'xrplSeed returned once — store it securely. Server did not save it.';
    } else {
      resp.notice = 'xrpl seed encrypted and stored server-side (SEED_ENCRYPTION_KEY used).';
    }

    res.status(201).json(resp);
  } catch (err) {
    console.error('signup error', err && err.message ? err.message : err);
    res.status(500).json({ message: 'server error' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email & password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const token = createToken(user);
    res.json({ message: 'ok', token, user: { id: user._id, email: user.email, type: user.type, xrplAddress: user.xrplAddress } });
  } catch (err) {
    console.error('login error', err && err.message ? err.message : err);
    res.status(500).json({ message: 'server error' });
  }
});

authRouter.get('/me', authRequired, async (req, res) => {
  try {
    const id = req.user && req.user.id;
    if (!id) return res.status(401).json({ message: 'invalid token payload' });

    const user = await User.findById(id).select('-password -xrplSeedEncrypted');
    if (!user) return res.status(404).json({ message: 'user not found' });

    res.json(user);
  } catch (err) {
    console.error('me error', err && err.message ? err.message : err);
    res.status(500).json({ message: 'server error' });
  }
});

authRouter.post('/logout', (req, res) => {
  res.json({ message: 'ok' });
});

app.use('/api/auth', authRouter);

// -------------------------
// Invoice / FAssets endpoints
// -------------------------

// POST /api/invoice - Create new invoice
app.post('/api/invoice', authRequired, async (req, res) => {
  try {
    const { amount_xrp, flare_address = '' } = req.body;
    
    if (!amount_xrp || isNaN(parseFloat(amount_xrp)) || parseFloat(amount_xrp) <= 0) {
      return res.status(400).json({ message: 'valid amount_xrp required' });
    }

    if (!XRPL_DEPOSIT_ADDRESS) {
      return res.status(500).json({ message: 'XRPL_DEPOSIT_ADDRESS not configured on server' });
    }

    // Generate unique memo for this invoice
    const memo = crypto.randomBytes(16).toString('hex');

    // Create invoice in DB
    const invoice = await Invoice.create({
      userId: req.user.id,
      amount_xrp: amount_xrp.toString(),
      flare_address,
      xrpl_deposit: XRPL_DEPOSIT_ADDRESS,
      xrpl_memo: memo,
      status: 'pending'
    });

    // Generate QR code for payment
    const paymentUri = `https://xrpl.org/?to=${XRPL_DEPOSIT_ADDRESS}&amount=${amount_xrp}&dt=${memo}`;
    let qrData = '';
    try {
      qrData = await QRCode.toDataURL(paymentUri);
    } catch (qrErr) {
      console.error('QR generation failed:', qrErr);
    }

    invoice.qrData = qrData;
    await invoice.save();

    // Start monitoring this invoice (in background)
    monitorInvoice(invoice._id.toString(), memo);

    res.status(201).json({
      id: invoice._id,
      amount_xrp: invoice.amount_xrp,
      flare_address: invoice.flare_address,
      xrpl_deposit: invoice.xrpl_deposit,
      xrpl_memo: invoice.xrpl_memo,
      status: invoice.status,
      qrData: invoice.qrData,
      xrpl_tx_hash: invoice.xrpl_tx_hash,
      flare_tx_hash: invoice.flare_tx_hash
    });
  } catch (err) {
    console.error('invoice create error', err);
    res.status(500).json({ message: 'server error' });
  }
});

// GET /api/invoice/:id - Get invoice status
app.get('/api/invoice/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'invoice not found' });

    res.json({
      id: invoice._id,
      amount_xrp: invoice.amount_xrp,
      flare_address: invoice.flare_address,
      xrpl_deposit: invoice.xrpl_deposit,
      xrpl_memo: invoice.xrpl_memo,
      status: invoice.status,
      qrData: invoice.qrData,
      xrpl_tx_hash: invoice.xrpl_tx_hash,
      flare_tx_hash: invoice.flare_tx_hash
    });
  } catch (err) {
    console.error('invoice get error', err);
    res.status(500).json({ message: 'server error' });
  }
});

// Background monitoring for XRPL payments
const monitoringInvoices = new Map();

async function monitorInvoice(invoiceId, memo) {
  if (monitoringInvoices.has(invoiceId)) return; // already monitoring
  
  console.log(`Starting to monitor invoice ${invoiceId} with memo ${memo}`);
  
  const checkInterval = setInterval(async () => {
    try {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice || invoice.status !== 'pending') {
        clearInterval(checkInterval);
        monitoringInvoices.delete(invoiceId);
        return;
      }

      // Check if expired
      if (new Date() > invoice.expiresAt) {
        invoice.status = 'expired';
        await invoice.save();
        clearInterval(checkInterval);
        monitoringInvoices.delete(invoiceId);
        console.log(`Invoice ${invoiceId} expired`);
        return;
      }

      // Check XRPL for payment
      const client = await getXRPLClient();
      const response = await client.request({
        command: 'account_tx',
        account: XRPL_DEPOSIT_ADDRESS,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 20
      });

      if (response.result && response.result.transactions) {
        for (const tx of response.result.transactions) {
          const txData = tx.tx;
          if (txData.TransactionType === 'Payment' && 
              txData.Destination === XRPL_DEPOSIT_ADDRESS) {
            
            // Check memo
            const memos = txData.Memos || [];
            let foundMemo = false;
            for (const memoObj of memos) {
              if (memoObj.Memo && memoObj.Memo.MemoData) {
                const decodedMemo = Buffer.from(memoObj.Memo.MemoData, 'hex').toString('utf8');
                if (decodedMemo === memo) {
                  foundMemo = true;
                  break;
                }
              }
            }

            if (foundMemo) {
              // Payment found!
              const amountDrops = txData.Amount;
              const amountXRP = parseFloat(amountDrops) / 1000000;
              
              console.log(`Payment received for invoice ${invoiceId}: ${amountXRP} XRP, tx: ${txData.hash}`);
              
              invoice.status = 'paid';
              invoice.xrpl_tx_hash = txData.hash;
              await invoice.save();

              // TODO: Mint FAssets on Flare
              // If flare_address provided, mint FAssets there
              if (invoice.flare_address && rewardContract) {
                try {
                  const amountToMint = ethers.parseUnits(invoice.amount_xrp, 18);
                  const mintTx = await rewardContract.mint(invoice.flare_address, amountToMint);
                  const receipt = await mintTx.wait();
                  invoice.flare_tx_hash = mintTx.hash;
                  await invoice.save();
                  console.log(`Minted FAssets to ${invoice.flare_address}, tx: ${mintTx.hash}`);
                } catch (mintErr) {
                  console.error('FAsset minting failed:', mintErr);
                }
              }

              clearInterval(checkInterval);
              monitoringInvoices.delete(invoiceId);
              return;
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error monitoring invoice ${invoiceId}:`, err);
    }
  }, 5000); 

  monitoringInvoices.set(invoiceId, checkInterval);
}

// -------------------------
// Smart-contract endpoints
// -------------------------

app.post('/api/consent/record', authRequired, async (req, res) => {
  try {
    if (!signer || !consentContract) {
      return res.status(500).json({ ok: false, error: 'contract_not_configured' });
    }

    const { userId, timestamp: tsIn, transcriptText, transcriptHash, ipfsHash } = req.body;

    if (!userId) return res.status(400).json({ ok: false, error: 'userId_required' });

    const timestamp = tsIn ? Number(tsIn) : Math.floor(Date.now() / 1000);
    if (!ipfsHash) return res.status(400).json({ ok: false, error: 'ipfsHash_required' });

    const transcriptHashInput = transcriptHash || transcriptText || "";
    const key = makeKey(userId, timestamp, transcriptHashInput);

    console.log(`Recording consent for user=${userId} key=${key} ipfs=${ipfsHash} signer=${req.user.email}`);

    const tx = await consentContract.giveConsent(key, ipfsHash);
    const receipt = await tx.wait();

    res.json({ ok: true, txHash: tx.hash, key, receipt: { blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex } });
  } catch (err) {
    console.error('consent.record error', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

app.post('/api/reward/mint', async (req, res) => {
  try {
    const provided = req.headers['x-admin-secret'] || '';
    if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    if (!signer || !rewardContract) {
      return res.status(500).json({ ok: false, error: 'contract_not_configured' });
    }

    const { contributorAddress, amount } = req.body;
    if (!contributorAddress || !amount) return res.status(400).json({ ok: false, error: 'missing_params' });

    const bnAmount = typeof amount === 'bigint' ? amount : ethers.parseUnits(String(amount), 18);

    const tx = await rewardContract.mint(contributorAddress, bnAmount);
    const receipt = await tx.wait();

    console.log(`Minted ${bnAmount.toString()} to ${contributorAddress}; tx ${tx.hash}`);
    res.json({ ok: true, txHash: tx.hash, receipt: { blockNumber: receipt.blockNumber } });
  } catch (err) {
    console.error('reward.mint error', err && err.message ? err.message : err);
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Basic API route
app.get("/api", (req, res) => {
  res.json({ fruits: ["apple", "banana", "orange"] });
});

// WebSocket server
const wss = new WebSocket.Server({ server, path: "/ws" });

function sendJSON(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on("connection", (ws) => {
  console.log("WS client connected");
  sendJSON(ws, { type: "welcome", message: "connected to server" });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn("Received non-JSON message, ignoring.");
      return;
    }

    if (msg.type === "transcript") {
      const text = (msg.text || "").trim();
      if (!text) return;

      sendJSON(ws, { type: "raw_transcript", text });

      try {
        const { translated, srcLang, confidence } = await translateToEnglish(text);

        sendJSON(ws, {
          type: "translation",
          text: translated,
          srcText: text,
          srcLang,
          confidence,
          timestamp: Date.now(),
        });

        console.log(`[${srcLang}] ${text}  ->  ${translated}`);
      } catch (err) {
        console.error("Translation error (sending to client):", err && err.message);
        sendJSON(ws, {
          type: "error",
          message: "translation_failed",
          detail: String(err && err.message ? err.message : err),
        });
      }
    }
  });

  ws.on("close", () => console.log("WS client disconnected"));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`HTTP server running on http://localhost:${PORT}/api`);
  console.log(`WebSocket running at ws://localhost:${PORT}/ws`);
});