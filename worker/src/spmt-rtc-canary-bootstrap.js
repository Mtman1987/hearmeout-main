'use strict';

const express = require('express');
const { attachSpmtRtcCanary } = require('./spmt-rtc-canary');

const originalListen = express.application.listen;
if (!originalListen.__spmtRtcWrapped) {
  function wrappedListen(...args) {
    const server = originalListen.apply(this, args);
    const enabled = process.env.SPMT_RTC_AUTH_MODE === 'canary-hmac';
    if (enabled) {
      const relay = attachSpmtRtcCanary(server, {
        enabled: true,
        secret: process.env.SPMT_RTC_CANARY_SECRET,
        tenantId: process.env.SPMT_RTC_CANARY_TENANT,
        roomId: process.env.SPMT_RTC_CANARY_ROOM,
      });
      server.once('close', () => relay.close());
      console.log('[SPMT RTC] Fenced zero-provider canary relay enabled on existing worker listener');
    }
    return server;
  }
  wrappedListen.__spmtRtcWrapped = true;
  express.application.listen = wrappedListen;
}
