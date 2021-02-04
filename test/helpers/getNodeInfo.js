const tronWebBuilder = require('./tronWebBuilder');
const tronWeb = tronWebBuilder.createInstance();

(async function () {
    console.log("getNodeInfo(): \n", await tronWeb.trx.getNodeInfo());
})()

