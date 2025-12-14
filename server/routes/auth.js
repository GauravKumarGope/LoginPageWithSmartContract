// auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./user');
const xrpl = require('xrpl');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

function basicEmailOK(e) {
  return typeof e === 'string' && /\S+@\S+\.\S+/.test(e);
}
function basicXRPLOK(a) {
  return typeof a === 'string' && (a === '' || /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a));
}

function makeToken(u) {
  return jwt.sign({ id: u._id, email: u.email, type: u.type }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

router.post('/signup', async (req, res) => {
    try {
      const { email, password, type = "normal" } = req.body;
  
      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);
  
      // Generate XRPL wallet
      const wallet = await generateXRPLWallet();
  
      // Create user in DB
      const user = await User.create({
        email,
        password: passwordHash,
        type,
        xrplAddress: wallet.xrpl_address,
        xrplSeedEncrypted: wallet.xrpl_seed,  // optional — encrypt later
      });
  
      // Issue JWT token
      const token = makeToken(user);
  
      return res.json({
        message: "Account created",
        token,
        user: {
          id: user._id,
          email: user.email,
          xrplAddress: user.xrplAddress,
          type: user.type
        }
      });
  
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Signup error" });
    }
  });
  

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email & password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const token = makeToken(user);
    res.json({ message: 'ok', token, user: { id: user._id, email: user.email, type: user.type, xrplAddress: user.xrplAddress } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const h = req.headers['authorization'];
    if (!h) return res.status(401).json({ message: 'no auth header' });
    const p = h.split(' ');
    if (p.length !== 2 || p[0] !== 'Bearer') return res.status(401).json({ message: 'bad auth header' });
    const token = p[1];
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) { return res.status(401).json({ message: 'invalid token' }); }
    const user = await User.findById(payload.id).select('-password');
    if (!user) return res.status(404).json({ message: 'not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'server error' });
  }
});

router.post('/logout', (req, res) => {
  // Stateless JWT - client should drop token.
  res.json({ message: 'ok' });
});

module.exports = router;

//XRPL

async function generateXRPLWallet() {
    const wallet = xrpl.Wallet.generate();
    return {
      xrpl_address: wallet.classicAddress,
      xrpl_seed: wallet.seed,
      public_key: wallet.publicKey,
      private_key: wallet.privateKey
    };
}
