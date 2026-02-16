const selfsigned = require('selfsigned');
const sslAttrs = [{ name: 'commonName', value: 'rtmp-hub-spot.local' }];

async function run() {
    try {
        console.log('Starting generation...');
        const sslPems = await selfsigned.generate(sslAttrs, { days: 365 });
        console.log('Keys:', Object.keys(sslPems));
        if (sslPems.private) console.log('Private length:', sslPems.private.length);
        else console.log('Private is UNDEFINED');
        if (sslPems.cert) console.log('Cert length:', sslPems.cert.length);
        else console.log('Cert is UNDEFINED');
    } catch (e) {
        console.error('Error generating:', e);
    }
}

run();
