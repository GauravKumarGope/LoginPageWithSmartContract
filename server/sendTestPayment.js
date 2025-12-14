// server/sendTestPayment.js
require('dotenv').config();
const xrpl = require('xrpl');

(async () => {
  try {
    const { SENDER_SEED, INVOICE_ID, XRPL_DEPOSIT_ADDR, XRPL_WSS } = process.env;

    if (!SENDER_SEED || !INVOICE_ID || !XRPL_DEPOSIT_ADDR) {
      console.error("Missing env vars. Required: SENDER_SEED, INVOICE_ID, XRPL_DEPOSIT_ADDR");
      process.exit(1);
    }

    const client = new xrpl.Client(XRPL_WSS || "wss://s.altnet.rippletest.net:51233");
    await client.connect();

    const wallet = xrpl.Wallet.fromSeed(SENDER_SEED);

    const payment = {
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: XRPL_DEPOSIT_ADDR,
      Amount: xrpl.xrpToDrops("1"),
      Memos: [
        {
          Memo: {
            MemoData: Buffer.from(INVOICE_ID).toString("hex").toUpperCase()
          }
        }
      ]
    };

    console.log("Preparing payment...");
    const prepared = await client.autofill(payment);
    const signed = wallet.sign(prepared);

    console.log("Submitting...");
    // submitAndWait returns different shapes between versions; capture result safely
    const txResponse = await client.submitAndWait(signed.tx_blob);
    // print whole result for debugging (safe)
    // console.log('full response', JSON.stringify(txResponse, null, 2));

    // attempt to extract tx hash robustly
    const maybeHash =
      (txResponse && txResponse.result && txResponse.result.tx && txResponse.result.tx.hash) ||
      (txResponse && txResponse.tx && txResponse.tx.hash) ||
      (txResponse && txResponse.result && txResponse.result.hash) ||
      (txResponse && txResponse.transaction && txResponse.transaction.hash);

    const txResult =
      (txResponse && txResponse.result && txResponse.result.meta && txResponse.result.meta.TransactionResult) ||
      (txResponse && txResponse.result && txResponse.result.engine_result) ||
      (txResponse && txResponse.engine_result) ||
      'unknown';

    console.log('submit result', txResult);
    console.log('tx hash', maybeHash || '(hash not found in response)');

    await client.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Payment error:", err);
    process.exit(1);
  }
})();
