const xrpl = require('xrpl');
(async ()=>{
  const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
  await client.connect();
  const fund = await client.fundWallet();
  console.log('address:', fund.wallet.classicAddress);
  console.log('seed:', fund.wallet.seed);
  await client.disconnect();
})();
