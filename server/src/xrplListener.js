// server/src/xrplListener.js
require('dotenv').config();
const xrpl = require('xrpl');
const { Invoice } = require('./db');

const WSS = process.env.XRPL_WSS;
const WATCH_ADDR = process.env.XRPL_DEPOSIT_ADDR;

async function main(){
  const client = new xrpl.Client(WSS);
  await client.connect();
  console.log('XRPL listener connected to', WSS);

  await client.request({ command: 'subscribe', accounts: [WATCH_ADDR] });
  client.on('transaction', async (evt) => {
    try {
      const tx = evt.transaction;
      if (!tx) return;
      if (tx.TransactionType !== 'Payment') return;
      if (tx.Destination !== WATCH_ADDR) return;
      const success = evt.meta && evt.meta.TransactionResult === 'tesSUCCESS';
      if (!success) return;
      const amount = xrpl.dropsToXrp(tx.Amount);

      // extract memo if present
      let memo = null;
      if (tx.Memos && tx.Memos.length) {
        try {
          const hex = tx.Memos[0].Memo.MemoData;
          memo = Buffer.from(hex, 'hex').toString();
        } catch(e){ memo = null; }
      }

      console.log('XRPL payment observed:', { from: tx.Account, amount, memo, hash: tx.hash });

      if (memo) {
        // find invoice by memo
        const invoice = await Invoice.findOne({ xrpl_memo: memo });
        if (invoice) {
          invoice.status = 'paid';
          invoice.xrpl_tx_hash = tx.hash;
          await invoice.save();
          console.log('Invoice marked paid:', invoice._id);
          return;
        }
      }

      // fallback: create orphan record keyed by tx.hash
      const existing = await Invoice.findById(tx.hash);
      if (!existing) {
        const orphan = new Invoice({
          _id: tx.hash,
          xrpl_destination: WATCH_ADDR,
          xrpl_memo: memo || null,
          amount_xrp: Number(amount) || 0,
          status: 'orphaned',
          xrpl_tx_hash: tx.hash
        });
        await orphan.save();
        console.log('Orphan payment recorded:', tx.hash);
      } else {
        console.log('Orphan already recorded:', tx.hash);
      }
    } catch(e){
      console.error('xrpl listener error', e);
    }
  });
}

main().catch(e => console.error(e));
