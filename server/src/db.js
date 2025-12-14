// server/src/db.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fassets_mvp';

mongoose.set('strictQuery', false);

async function connect() {
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Mongo connected:', MONGO_URI);
}

const InvoiceSchema = new Schema({
  _id: { type: String }, // use UUID as _id
  xrpl_memo: { type: String, index: true, unique: true, sparse: true },
  xrpl_destination: String,
  flare_address: String,
  amount_xrp: Number,
  status: { type: String, default: 'pending', index: true },
  xrpl_tx_hash: String,
  flare_tx_hash: String,
  created_at: { type: Date, default: Date.now }
});

// Use this to avoid duplicate key errors on missing memo:
// sparse:true on xrpl_memo lets documents without memo exist.
const Invoice = mongoose.model('Invoice', InvoiceSchema);

module.exports = { connect, Invoice };
